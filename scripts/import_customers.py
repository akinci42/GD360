#!/usr/bin/env python3
"""
CRM Import Script — Hybrid Model
CSV → historical_quotes_raw → customers (dedupe + auto-assign)

Usage:
  python scripts/import_customers.py data/customers.csv
  python scripts/import_customers.py data/customers.csv --dry-run
  python scripts/import_customers.py data/customers.csv --dry-run --use-haiku
"""

import argparse
import csv
import io
import os
import re
import sys
import uuid
from datetime import date, datetime
from pathlib import Path

import psycopg2
import psycopg2.extras
from dotenv import load_dotenv
from tqdm import tqdm

# ─── Config ───────────────────────────────────────────────────────────────────

ROOT = Path(__file__).parent.parent
load_dotenv(ROOT / "backend" / ".env")

DATABASE_URL = os.getenv(
    "DATABASE_URL",
    "postgresql://gd360:gd360pass@localhost:5432/gd360",
)

# Sales rep assignment: country code → email prefix
ULKE_TO_REP: dict[str, str] = {
    # Orhan: domestic Turkey
    "TR": "orhan",
    # Sinan: MENA / GCC
    "SA": "sinan", "AE": "sinan", "QA": "sinan", "KW": "sinan",
    "BH": "sinan", "OM": "sinan", "YE": "sinan", "IQ": "sinan",
    "SY": "sinan", "JO": "sinan", "LB": "sinan", "PS": "sinan",
    "EG": "sinan", "LY": "sinan", "TN": "sinan", "DZ": "sinan",
    "MA": "sinan", "SD": "sinan",
    # Sanzhar: Central Asia / CIS
    "KZ": "sanzhar", "UZ": "sanzhar", "KG": "sanzhar", "TJ": "sanzhar",
    "TM": "sanzhar", "AZ": "sanzhar", "AM": "sanzhar", "GE": "sanzhar",
    "RU": "sanzhar", "BY": "sanzhar", "UA": "sanzhar", "MD": "sanzhar",
    # Ramazan: Sub-Saharan Africa + South Asia
    "NG": "ramazan", "ET": "ramazan", "KE": "ramazan", "TZ": "ramazan",
    "UG": "ramazan", "ZM": "ramazan", "ZW": "ramazan", "SN": "ramazan",
    "GH": "ramazan", "CI": "ramazan", "PK": "ramazan", "BD": "ramazan",
    "AF": "ramazan", "IN": "ramazan",
    # Sami: Europe + Americas + other
}
# Sami is the fallback for everything not mapped above

# Channel type → (customer_type, partner_subtype)
KANAL_MAP: dict[str, tuple[str, str | None]] = {
    "Distribütör": ("partner", "distributor"),
    "Distributor":  ("partner", "distributor"),
    "Bölge Ofisi":  ("partner", "regional_office"),
    "Bolge Ofisi":  ("partner", "regional_office"),
    "Yurtiçi":      ("direct", None),
    "Yurtici":      ("direct", None),
    "Belirtilmemiş": ("direct", None),
    "Belirtilmamis": ("direct", None),
}

# Regex patterns for end_customer extraction from Açıklama
END_CUSTOMER_PATTERNS = [
    re.compile(r"(?:son kullanici|end.?customer|nihai kullanici)[:\s]+([^,\n]{3,60})", re.IGNORECASE),
    re.compile(r"(?:proje|project)[:\s]+([^,\n]{3,60})", re.IGNORECASE),
    re.compile(r"(?:firma|company|musteri)[:\s]+([^,\n]{3,60})", re.IGNORECASE),
]

# Language detection: first token from Dil field → ISO code
DİL_MAP: dict[str, str] = {
    "Türkçe": "TR", "Turkce": "TR", "TR": "TR",
    "İngilizce": "EN", "Ingilizce": "EN", "EN": "EN", "English": "EN",
    "Rusça": "RU", "Rusca": "RU", "RU": "RU", "Russian": "RU",
    "Arapça": "AR", "Arapca": "AR", "AR": "AR", "Arabic": "AR",
    "Fransızca": "FR", "Fransizca": "FR", "FR": "FR", "French": "FR",
}

# ─── Turkish normalizer (mirrors SQL normalize_customer_name) ─────────────────

_TR_TABLE = str.maketrans(
    "çÇğĞıİşŞöÖüÜ",
    "cCgGiIsSOoUu" ,
)

def normalize_name(name: str) -> str:
    if not name:
        return ""
    v = name.translate(_TR_TABLE).upper()
    v = re.sub(r"[^A-Z0-9]", "", v)
    return v


# ─── Helpers ──────────────────────────────────────────────────────────────────

def parse_date(s: str) -> date | None:
    if not s:
        return None
    for fmt in ("%d.%m.%Y", "%Y-%m-%d", "%d/%m/%Y"):
        try:
            return datetime.strptime(s.strip(), fmt).date()
        except ValueError:
            continue
    return None


def extract_city(lokasyon: str) -> str | None:
    """Last segment after final comma is city, e.g. 'Konya, TR' → 'Konya'."""
    if not lokasyon:
        return None
    parts = [p.strip() for p in lokasyon.split(",")]
    # If only one part it's already the city; if last part looks like country code skip it
    if len(parts) >= 2 and len(parts[-1]) == 2 and parts[-1].isupper():
        return parts[-2] if len(parts) >= 2 else None
    return parts[0] if parts else None


def extract_country(lokasyon: str) -> str | None:
    """Last 2-letter segment → ISO country code."""
    if not lokasyon:
        return None
    parts = [p.strip() for p in lokasyon.split(",")]
    last = parts[-1]
    if len(last) == 2 and last.isupper():
        return last
    return None


def extract_language(dil: str) -> str | None:
    if not dil:
        return None
    first = dil.split(",")[0].strip()
    return DİL_MAP.get(first)


def extract_end_customer_suggestion(aciklama: str) -> str | None:
    if not aciklama:
        return None
    for pat in END_CUSTOMER_PATTERNS:
        m = pat.search(aciklama)
        if m:
            return m.group(1).strip()[:200]
    return None


def kanal_to_type(kanal: str) -> tuple[str, str | None]:
    return KANAL_MAP.get(kanal, ("direct", None))


# ─── Haiku fallback for country → rep ────────────────────────────────────────

def haiku_assign_rep(country: str, company_name: str) -> str:
    """Use Claude Haiku to guess which sales rep should own this customer."""
    try:
        import anthropic  # noqa: PLC0415

        client = anthropic.Anthropic()
        msg = client.messages.create(
            model="claude-haiku-4-5-20251001",
            max_tokens=20,
            messages=[
                {
                    "role": "user",
                    "content": (
                        f"Sales rep assignment for a milling machinery company. "
                        f"Reps: orhan (Turkey domestic), sinan (MENA/Middle East/North Africa), "
                        f"sanzhar (Central Asia/CIS/Russia), ramazan (Sub-Saharan Africa/South Asia), "
                        f"sami (Europe/Americas/other). "
                        f"Country: {country}, Company: {company_name}. "
                        f"Reply with only the rep name (one word)."
                    ),
                }
            ],
        )
        rep = msg.content[0].text.strip().lower().split()[0]
        if rep in ("orhan", "sinan", "sanzhar", "ramazan", "sami"):
            return rep
    except Exception:
        pass
    return "sami"


def assign_rep(country: str, company_name: str, use_haiku: bool) -> str:
    rep = ULKE_TO_REP.get(country)
    if rep:
        return rep
    if use_haiku:
        return haiku_assign_rep(country, company_name)
    return "sami"


# ─── Database helpers ─────────────────────────────────────────────────────────

def load_users(cur) -> dict[str, str]:
    """email_prefix → uuid"""
    cur.execute("SELECT id, email FROM users")
    result = {}
    for row in cur.fetchall():
        prefix = row["email"].split("@")[0]
        result[prefix] = str(row["id"])
    return result


def load_existing_customers(cur) -> dict[str, str]:
    """name_normalized → uuid"""
    cur.execute("SELECT id, name_normalized FROM customers WHERE name_normalized IS NOT NULL")
    return {row["name_normalized"]: str(row["id"]) for row in cur.fetchall()}


# ─── Core import logic ────────────────────────────────────────────────────────

def import_row(
    cur,
    row: dict,
    row_num: int,
    users: dict[str, str],
    existing: dict[str, str],
    use_haiku: bool,
    stats: dict,
):
    musteri      = (row.get("Müşteri") or row.get("Musteri") or "").strip()
    kanal_tipi   = (row.get("Kanal Tipi") or "").strip()
    lokasyon     = (row.get("Lokasyon") or "").strip()
    ref_no       = (row.get("Ref No") or row.get("RefNo") or "").strip()
    tarih_str    = (row.get("Tarih") or "").strip()
    ulke         = (row.get("Ülke") or row.get("Ulke") or "").strip()
    kapasite_str = (row.get("Kapasite (TG)") or row.get("Kapasite") or "").strip()
    proje_tipi   = (row.get("Proje Tipi") or "").strip()
    vals_str     = (row.get("Vals") or "").strip()
    aciklama     = (row.get("Açıklama") or row.get("Aciklama") or "").strip()
    dil          = (row.get("Dil") or "").strip()

    if not musteri:
        stats["skipped"] += 1
        return

    tarih = parse_date(tarih_str)
    try:
        kapasite = int(kapasite_str) if kapasite_str else None
    except ValueError:
        kapasite = None
    try:
        vals = int(vals_str) if vals_str else None
    except ValueError:
        vals = None

    # ── Step 1: INSERT into historical_quotes_raw (idempotent on ref_no) ──────
    cur.execute(
        """
        INSERT INTO historical_quotes_raw
          (row_number, musteri, kanal_tipi, lokasyon, ref_no, tarih,
           ulke, kapasite_tg, proje_tipi, vals, aciklama, dil,
           end_customer_suggestion)
        VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
        ON CONFLICT DO NOTHING
        RETURNING id
        """,
        (
            row_num, musteri, kanal_tipi, lokasyon, ref_no, tarih,
            ulke or None, kapasite, proje_tipi, vals, aciklama, dil,
            extract_end_customer_suggestion(aciklama),
        ),
    )
    raw_result = cur.fetchone()
    # If ON CONFLICT DO NOTHING fired, fetch existing id
    if raw_result is None:
        if ref_no:
            cur.execute(
                "SELECT id FROM historical_quotes_raw WHERE ref_no = %s LIMIT 1",
                (ref_no,),
            )
            raw_result = cur.fetchone()
        if raw_result is None:
            stats["skipped"] += 1
            return
    raw_id = str(raw_result["id"])

    # ── Step 2: Dedupe / find or create customer ──────────────────────────────
    name_norm = normalize_name(musteri)
    customer_type, partner_subtype = kanal_to_type(kanal_tipi)
    country = ulke or extract_country(lokasyon) or None
    city    = extract_city(lokasyon)
    lang    = extract_language(dil)
    rep_key = assign_rep(country or "", musteri, use_haiku)
    assigned_to = users.get(rep_key) or users.get("sami")
    created_by  = users.get("remzi") or users.get("ahmet")

    existing_id = existing.get(name_norm)
    if existing_id:
        customer_id = existing_id
        stats["deduped"] += 1
    else:
        # Validate business rules before insert
        if customer_type == "partner" and partner_subtype is None:
            partner_subtype = "distributor"  # safe default
        if customer_type == "end_customer":
            # end_customer requires parent_id — treat as direct for now
            customer_type = "direct"

        new_id = str(uuid.uuid4())
        cur.execute(
            """
            INSERT INTO customers
              (id, company_name, customer_type, partner_subtype,
               country, city, primary_language,
               source, status,
               assigned_to, created_by,
               imported_from_raw_id)
            VALUES
              (%s,%s,%s,%s,%s,%s,%s,'import_2026','active',%s,%s,%s)
            """,
            (
                new_id, musteri, customer_type, partner_subtype,
                country, city, lang,
                assigned_to, created_by, raw_id,
            ),
        )
        customer_id = new_id
        existing[name_norm] = customer_id
        stats["inserted"] += 1

    # ── Step 3: link raw row → customer ──────────────────────────────────────
    cur.execute(
        "UPDATE historical_quotes_raw SET customer_id = %s WHERE id = %s",
        (customer_id, raw_id),
    )


# ─── Group creation ───────────────────────────────────────────────────────────

def ensure_groups(cur, users: dict[str, str]):
    created_by = users.get("remzi") or users.get("ahmet")

    groups = [
        {
            "name": "TEKNOMAK Ağı",
            "description": "TEKNOMAK distribütör ve bayi ağı",
            "group_type": "distributor_network",
        },
        {
            "name": "GD Bölge Ofisleri",
            "description": "Genc Degirmen bölge ofisleri",
            "group_type": "distributor_network",
        },
    ]
    group_ids = {}
    for g in groups:
        cur.execute(
            """
            INSERT INTO customer_groups (name, description, group_type, created_by)
            VALUES (%s,%s,%s,%s)
            ON CONFLICT (name) DO NOTHING
            RETURNING id
            """,
            (g["name"], g["description"], g["group_type"], created_by),
        )
        row = cur.fetchone()
        if row:
            group_ids[g["name"]] = str(row["id"])
        else:
            cur.execute("SELECT id FROM customer_groups WHERE name = %s", (g["name"],))
            group_ids[g["name"]] = str(cur.fetchone()["id"])
    return group_ids


def populate_groups(cur, group_ids: dict, users: dict):
    added_by = users.get("remzi") or users.get("ahmet")

    # TEKNOMAK Ağı → all distributors
    cur.execute(
        """
        INSERT INTO customer_group_members (customer_id, group_id, added_by)
        SELECT c.id, %s, %s
        FROM customers c
        WHERE c.customer_type = 'partner'
          AND c.partner_subtype = 'distributor'
          AND c.source = 'import_2026'
        ON CONFLICT DO NOTHING
        """,
        (group_ids.get("TEKNOMAK Ağı"), added_by),
    )

    # GD Bölge Ofisleri → all regional offices
    cur.execute(
        """
        INSERT INTO customer_group_members (customer_id, group_id, added_by)
        SELECT c.id, %s, %s
        FROM customers c
        WHERE c.customer_type = 'partner'
          AND c.partner_subtype = 'regional_office'
          AND c.source = 'import_2026'
        ON CONFLICT DO NOTHING
        """,
        (group_ids.get("GD Bölge Ofisleri"), added_by),
    )


# ─── Synthetic test data ──────────────────────────────────────────────────────

SYNTHETIC_CSV = """Müşteri;Kanal Tipi;Lokasyon;Ref No;Tarih;Ülke;Kapasite (TG);Proje Tipi;Vals;Açıklama;Dil
TEKNOMAK A.Ş.;Distribütör;Konya, TR;REF-001;15.03.2024;TR;200;Roller;4;Son kullanici: DOĞUŞ UN FABRİKASI;Türkçe
Al-Faris Trading;Distribütör;Riyadh, SA;REF-002;20.03.2024;SA;500;Roller;6;End customer: AL MARAI;İngilizce
Central Asia Mills;Bölge Ofisi;Almaty, KZ;REF-003;01.04.2024;KZ;300;Plansifter;4;Proje: Astana Mill;Rusça
EuroBake GmbH;Belirtilmemiş;Berlin, DE;REF-004;05.04.2024;DE;150;Roller;2;;İngilizce
Makina Dünyası;Yurtiçi;İstanbul, TR;REF-005;10.04.2024;TR;100;Plansifter;2;Son kullanici: ÜLKER;Türkçe
Nigeria Flour Mills;Distribütör;Lagos, NG;REF-006;12.04.2024;NG;400;Roller;6;End customer: NB FLOUR;İngilizce
Tashkent Milling Co;Bölge Ofisi;Tashkent, UZ;REF-007;15.04.2024;UZ;250;Roller;4;;Rusça
TEKNOMAK A.Ş.;Distribütör;Konya, TR;REF-008;18.04.2024;TR;200;Plansifter;2;Firma: YENİ UN;Türkçe
Cairo Trade LLC;Distribütör;Cairo, EG;REF-009;20.04.2024;EG;350;Roller;4;End customer: CAIRO FLOUR;Arapça
Bogota Molinos S.A.;Belirtilmemiş;Bogota, CO;REF-010;22.04.2024;CO;180;Roller;2;;İngilizce
"""


# ─── Report ───────────────────────────────────────────────────────────────────

def print_report(stats: dict, dry_run: bool):
    mode = "[DRY RUN] " if dry_run else ""
    print(f"\n{'='*55}")
    print(f"  {mode}Import Report")
    print(f"{'='*55}")
    print(f"  Rows processed : {stats['processed']:>6}")
    print(f"  Customers new  : {stats['inserted']:>6}")
    print(f"  Deduped        : {stats['deduped']:>6}")
    print(f"  Skipped        : {stats['skipped']:>6}")
    print(f"  Errors         : {stats['errors']:>6}")
    if dry_run:
        print(f"\n  Transaction ROLLED BACK — no changes persisted.")
    else:
        print(f"\n  Changes committed to database.")
    print(f"{'='*55}\n")


# ─── Main ─────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description="Import CRM customers from CSV")
    parser.add_argument("csv_file", nargs="?", help="Path to CSV file (UTF-8-sig, separator ;)")
    parser.add_argument("--dry-run", action="store_true", help="Parse and validate but roll back transaction")
    parser.add_argument("--use-haiku", action="store_true", help="Use Claude Haiku for unmapped country → rep assignment")
    parser.add_argument("--synthetic", action="store_true", help="Use built-in 10-row synthetic test data")
    args = parser.parse_args()

    if args.synthetic or args.csv_file is None:
        print("Using synthetic test data (10 rows)...")
        csv_source = io.StringIO(SYNTHETIC_CSV)
        args.dry_run = True
    else:
        csv_path = Path(args.csv_file)
        if not csv_path.exists():
            print(f"ERROR: File not found: {csv_path}", file=sys.stderr)
            sys.exit(1)
        csv_source = open(csv_path, encoding="utf-8-sig")

    stats = {"processed": 0, "inserted": 0, "deduped": 0, "skipped": 0, "errors": 0}

    conn = psycopg2.connect(DATABASE_URL, cursor_factory=psycopg2.extras.RealDictCursor)
    try:
        with conn:
            with conn.cursor() as cur:
                # Bypass RLS for the import session
                cur.execute("SET app.user_role = 'owner'")
                cur.execute("SET app.user_id = ''")

                users    = load_users(cur)
                existing = load_existing_customers(cur)

                print(f"Loaded {len(users)} users, {len(existing)} existing customers.")

                reader = csv.DictReader(csv_source, delimiter=";")
                rows = list(reader)
                print(f"CSV rows: {len(rows)}")

                for i, row in enumerate(tqdm(rows, desc="Importing", unit="row"), start=1):
                    stats["processed"] += 1
                    try:
                        import_row(cur, row, i, users, existing, args.use_haiku, stats)
                    except Exception as e:
                        print(f"\n  ERROR row {i}: {e}", file=sys.stderr)
                        stats["errors"] += 1

                # Create groups and populate memberships
                group_ids = ensure_groups(cur, users)
                populate_groups(cur, group_ids, users)

                if args.dry_run:
                    conn.rollback()
                else:
                    conn.commit()

    finally:
        conn.close()
        if not (args.synthetic or args.csv_file is None):
            csv_source.close()

    print_report(stats, args.dry_run)


if __name__ == "__main__":
    main()
