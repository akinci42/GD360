#!/usr/bin/env python3
"""
Dedupe Fuzzy Scanner — GD360

Finds suspected-duplicate customer pairs by running Levenshtein, token-
overlap and substring rules over customers.name_normalized. Writes
candidate pairs into dedupe_suggestions for owner/coordinator review in
the admin dedupe page.

Rules (OR — the highest matching score wins per pair):
  - Levenshtein distance == 1  AND same country  -> 0.95
  - Levenshtein distance == 2  AND same country  -> 0.85
  - Jaccard token overlap >= 0.9 (any country)   -> 0.80
  - One name substring of the other AND same country
    AND length delta >= 2 (i.e. not identical)   -> 0.75

Performance: pairs are bucketed by country for the Levenshtein and
substring rules, and by first token for the overlap rule. This brings a
naive 1.7M pair sweep down to a few tens of thousands of comparisons.

Usage:
  python scripts/dedupe_scanner.py --dry-run     # report only, no INSERT
  python scripts/dedupe_scanner.py               # INSERT (ON CONFLICT DO NOTHING)
"""

import argparse
import os
import sys
import time
from collections import defaultdict
from pathlib import Path

import psycopg2
import psycopg2.extras
import Levenshtein
from dotenv import load_dotenv

ROOT = Path(__file__).parent.parent
load_dotenv(ROOT / "backend" / ".env")

DATABASE_URL = os.getenv(
    "DATABASE_URL",
    "postgresql://gd360:gd360pass@localhost:5432/gd360",
)

# Rule thresholds and scores
SCORE_LEV1    = 0.95
SCORE_LEV2    = 0.85
SCORE_OVERLAP = 0.80
SCORE_SUBSTR  = 0.75
MIN_SCORE_TO_RECORD = 0.75
TOKEN_OVERLAP_THRESHOLD = 0.90


def fetch_active_customers(cur):
    cur.execute("""
        SELECT id, company_name, country, name_normalized
        FROM customers
        WHERE status = 'active'
          AND name_normalized IS NOT NULL
          AND name_normalized <> ''
    """)
    return cur.fetchall()


def token_set(name: str) -> set[str]:
    return {t for t in name.split() if len(t) >= 2}


def jaccard(a: set[str], b: set[str]) -> float:
    if not a or not b:
        return 0.0
    inter = len(a & b)
    union = len(a | b)
    return inter / union if union else 0.0


def first_token(name: str) -> str | None:
    toks = name.split()
    return toks[0] if toks else None


def pair_key(id_a: str, id_b: str) -> tuple[str, str]:
    """Return a deterministic (smaller_id, larger_id) key so A/B order doesn't matter."""
    return (id_a, id_b) if id_a < id_b else (id_b, id_a)


def scan(customers):
    """Return dict: {(id_a, id_b): (score, reason, name_a, name_b)}."""
    best: dict[tuple[str, str], tuple[float, str, str, str]] = {}

    def consider(a, b, score, reason):
        key = pair_key(str(a["id"]), str(b["id"]))
        cur = best.get(key)
        if cur is None or score > cur[0]:
            # Keep the pair in key order for the (a_name, b_name) fields
            if str(a["id"]) < str(b["id"]):
                name_a, name_b = a["company_name"], b["company_name"]
            else:
                name_a, name_b = b["company_name"], a["company_name"]
            best[key] = (score, reason, name_a, name_b)

    # ── Pass 1: Levenshtein + substring, bucketed by country ───────────────
    by_country: dict[str, list] = defaultdict(list)
    for c in customers:
        if c["country"]:
            by_country[c["country"]].append(c)

    for country, group in by_country.items():
        n = len(group)
        if n < 2:
            continue
        for i in range(n):
            a = group[i]
            a_name = a["name_normalized"]
            a_len  = len(a_name)
            for j in range(i + 1, n):
                b = group[j]
                b_name = b["name_normalized"]
                b_len  = len(b_name)

                len_diff = abs(a_len - b_len)

                # Levenshtein has lower bound of |len_a - len_b|; skip if out of reach
                if len_diff <= 2:
                    d = Levenshtein.distance(a_name, b_name)
                    if d == 1:
                        consider(a, b, SCORE_LEV1, "levenshtein_1|country_match")
                        continue
                    elif d == 2:
                        consider(a, b, SCORE_LEV2, "levenshtein_2|country_match")
                        continue

                # Substring rule — must not be identical (len_diff >= 2)
                if len_diff >= 2 and (a_name in b_name or b_name in a_name):
                    consider(a, b, SCORE_SUBSTR, "substring|country_match")

    # ── Pass 2: Token overlap (any country), bucketed by first token ───────
    by_first: dict[str, list] = defaultdict(list)
    for c in customers:
        ft = first_token(c["name_normalized"])
        if ft:
            by_first[ft].append(c)

    for _ft, group in by_first.items():
        n = len(group)
        if n < 2:
            continue
        token_sets = [token_set(c["name_normalized"]) for c in group]
        for i in range(n):
            a_tokens = token_sets[i]
            if len(a_tokens) < 2:
                continue
            for j in range(i + 1, n):
                b_tokens = token_sets[j]
                if len(b_tokens) < 2:
                    continue
                overlap = jaccard(a_tokens, b_tokens)
                if overlap >= TOKEN_OVERLAP_THRESHOLD:
                    consider(group[i], group[j], SCORE_OVERLAP,
                             f"token_overlap_{int(overlap * 100)}")

    return best


def print_report(best, elapsed):
    n = len(best)
    buckets = {"0.95+": 0, "0.85-0.95": 0, "0.75-0.85": 0}
    for score, *_ in best.values():
        if score >= 0.95:
            buckets["0.95+"] += 1
        elif score >= 0.85:
            buckets["0.85-0.95"] += 1
        else:
            buckets["0.75-0.85"] += 1

    print()
    print(f"Suggestions generated: {n}")
    print(f"  score >= 0.95     : {buckets['0.95+']}")
    print(f"  score 0.85-0.95   : {buckets['0.85-0.95']}")
    print(f"  score 0.75-0.85   : {buckets['0.75-0.85']}")
    print(f"Scan time           : {elapsed:.2f}s")

    top = sorted(best.items(), key=lambda kv: -kv[1][0])[:10]
    print()
    print("Top 10 pairs:")
    for (a_id, b_id), (score, reason, name_a, name_b) in top:
        print(f"  [{score:.2f}] {name_a}  <->  {name_b}   ({reason})")


def insert_suggestions(cur, best):
    rows = []
    for (id_a, id_b), (score, reason, *_) in best.items():
        rows.append((id_a, id_b, score, reason))

    psycopg2.extras.execute_values(
        cur,
        """
        INSERT INTO dedupe_suggestions (customer_a_id, customer_b_id, similarity_score, match_reason)
        VALUES %s
        ON CONFLICT (customer_a_id, customer_b_id) DO NOTHING
        """,
        rows,
        template="(%s, %s, %s, %s)",
        page_size=500,
    )
    return cur.rowcount  # inserted count (excluding conflicts)


def main() -> int:
    parser = argparse.ArgumentParser(description="Fuzzy dedupe scanner for customers.")
    parser.add_argument("--dry-run", action="store_true",
                        help="Report only; do not INSERT into dedupe_suggestions.")
    args = parser.parse_args()

    t0 = time.time()
    conn = psycopg2.connect(DATABASE_URL)
    conn.autocommit = False
    try:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            # Set RLS session so INSERT passes (policy requires owner/coordinator)
            cur.execute("SELECT set_config('app.user_role', 'coordinator', false)")
            customers = fetch_active_customers(cur)
            print(f"Active customers scanned: {len(customers)}")

            best = scan(customers)
            elapsed = time.time() - t0
            print_report(best, elapsed)

            if args.dry_run:
                print("\n--dry-run: no rows written to dedupe_suggestions.")
                conn.rollback()
                return 0

            inserted = insert_suggestions(cur, best)
            conn.commit()
            print(f"\nINSERTed {inserted} new suggestions "
                  f"({len(best) - inserted} already existed).")
            return 0
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


if __name__ == "__main__":
    sys.exit(main())
