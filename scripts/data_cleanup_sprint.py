#!/usr/bin/env python3
"""
Data Cleanup Sprint 013
Fixes 3 categories of data quality issues:
  Cat 1 (19 rows): company_name = country name → (Kimliği Belirsiz) {Country}
  Cat 3 (1 row):   BAKÜ → (Kimliği Belirsiz) Azerbaycan
  Cat 9 (1 row):   TEKNOMAK (single word, DZ) → TEKNOMAK - CEZAYİR

Usage:
  python scripts/data_cleanup_sprint.py --dry-run
  python scripts/data_cleanup_sprint.py
"""

import argparse
import os
import sys
from pathlib import Path

# Force UTF-8 output on Windows
if sys.platform == "win32":
    import io
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
    sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding="utf-8", errors="replace")

import psycopg2
import psycopg2.extras
from dotenv import load_dotenv

ROOT = Path(__file__).parent.parent
load_dotenv(ROOT / "backend" / ".env")

DATABASE_URL = os.getenv("DATABASE_URL", "postgresql://gd360:gd360pass@localhost:5432/gd360")

# ─── Category 1 mapping ───────────────────────────────────────────────────────
# (old_company_name, iso2, tr_display_name, rep_prefix)
CATEGORY_1 = [
    ("LİBYA",      "LY", "Libya",      "sami"),
    ("KAZAKİSTAN", "KZ", "Kazakistan", "ramazan"),
    ("RUSYA",      "RU", "Rusya",      "ramazan"),
    ("PAKİSTAN",   "PK", "Pakistan",   "sinan"),
    ("SIRBİSTAN",  "RS", "Sırbistan",  "sinan"),
    ("MISIR",      "EG", "Mısır",      "sami"),
    ("ETYOPYA",    "ET", "Etiyopya",   "sinan"),
    ("KENYA",      "KE", "Kenya",      "sinan"),
    ("SURİYE",     "SY", "Suriye",     "sami"),
    ("HİNDİSTAN",  "IN", "Hindistan",  "sinan"),
    ("IRAK",       "IQ", "Irak",       "sami"),
    ("ÖZBEKİSTAN", "UZ", "Özbekistan", "ramazan"),
    ("TACİKİSTAN", "TJ", "Tacikistan", "ramazan"),
    ("AFGANİSTAN", "AF", "Afganistan", "sinan"),
    ("MORİTANYA",  "MR", "Moritanya",  "ahmet"),  # MR not in ULKE_TO_REP → coordinator
    ("AZERBAYCAN", "AZ", "Azerbaycan", "ramazan"),
    ("KATAR",      "QA", "Katar",      "sami"),
    ("UKRAYNA",    "UA", "Ukrayna",    "ramazan"),
    ("FRANSA",     "FR", "Fransa",     "sinan"),
]


def unidentified_name(tr_country: str) -> str:
    return f"(Kimliği Belirsiz) {tr_country}"


def run(dry_run: bool) -> None:
    tag = "[DRY-RUN] " if dry_run else ""
    conn = psycopg2.connect(DATABASE_URL)
    conn.autocommit = False

    with conn:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            # Bypass RLS
            cur.execute("SET LOCAL app.user_role = 'owner'")
            cur.execute("SELECT id::text FROM users WHERE email = 'ahmet@gencdegirmen.com.tr'")
            ahmet_id_row = cur.fetchone()
            ahmet_id_str = ahmet_id_row["id"] if ahmet_id_row else None
            if ahmet_id_str:
                cur.execute(f"SET LOCAL app.user_id = '{ahmet_id_str}'")

            # ── Pre-flight: load user ID map ──────────────────────────────────
            cur.execute("SELECT email, id FROM users")
            user_map = {row["email"].split("@")[0]: str(row["id"]) for row in cur.fetchall()}
            coordinator_id = user_map.get("ahmet")

            # ── Stats ─────────────────────────────────────────────────────────
            created_count  = 0
            deleted_count  = 0
            rerouted_count = 0
            cat_stats      = []

            # ══════════════════════════════════════════════════════════════════
            # ADIM 1 — Category 1: country-name customers
            # ══════════════════════════════════════════════════════════════════
            print("\n── ADIM 1: Country-name customers ─────────────────────────")

            # Track new card IDs created (keyed by tr_name)
            new_card_ids: dict[str, str] = {}

            for (old_name, iso, tr_name, rep_prefix) in CATEGORY_1:
                new_company = unidentified_name(tr_name)
                assigned_id = user_map.get(rep_prefix, coordinator_id)

                # Find old customer
                cur.execute(
                    "SELECT id FROM customers WHERE company_name = %s",
                    (old_name,)
                )
                old_row = cur.fetchone()
                if not old_row:
                    print(f"  SKIP  {old_name!r} — kayıt bulunamadı (zaten temizlenmiş?)")
                    continue
                old_id = str(old_row["id"])

                # Count quotes to reroute
                cur.execute(
                    "SELECT COUNT(*) as cnt FROM historical_quotes_raw WHERE customer_id = %s",
                    (old_id,)
                )
                hq_count = cur.fetchone()["cnt"]

                # Check if new card already exists
                cur.execute(
                    "SELECT id FROM customers WHERE company_name = %s",
                    (new_company,)
                )
                existing_new = cur.fetchone()

                if existing_new:
                    new_id = str(existing_new["id"])
                    print(f"  EXIST {new_company!r} (zaten var) — {hq_count} teklif yönlendirilecek")
                else:
                    notes = (
                        f"Bu kart, müşteri adı doldurulmamış {hq_count} teklifi temsil eder. "
                        f"Ekip kimlik tespit ettikçe gerçek müşteriye taşınmalı."
                    )
                    if not dry_run:
                        cur.execute(
                            """INSERT INTO customers
                                 (company_name, country, customer_type, status, source,
                                  data_quality_flag, assigned_to, created_by, notes)
                               VALUES (%s, %s, 'direct', 'unidentified', 'import_2026',
                                       'cleanup_013_country_name', %s, %s, %s)
                               RETURNING id""",
                            (new_company, iso, assigned_id, coordinator_id, notes)
                        )
                        new_id = str(cur.fetchone()["id"])
                    else:
                        new_id = "<new-uuid>"
                    print(f"  {tag}CREATE  {new_company!r}  ({iso}, rep={rep_prefix}, {hq_count} teklif)")
                    created_count += 1

                new_card_ids[tr_name] = new_id

                # Reroute quotes
                if not dry_run:
                    cur.execute(
                        "UPDATE historical_quotes_raw SET customer_id = %s WHERE customer_id = %s",
                        (new_id, old_id)
                    )
                rerouted_count += hq_count

                # Delete old card
                if not dry_run:
                    cur.execute("DELETE FROM customers WHERE id = %s", (old_id,))
                deleted_count += 1
                print(f"  {tag}DELETE  {old_name!r}  (id={old_id[:8]}…)  →  {hq_count} teklif taşındı")
                cat_stats.append((old_name, new_company, hq_count))

            # ══════════════════════════════════════════════════════════════════
            # ADIM 2 — Category 3: BAKÜ → (Kimliği Belirsiz) Azerbaycan
            # ══════════════════════════════════════════════════════════════════
            print("\n── ADIM 2: BAKÜ → (Kimliği Belirsiz) Azerbaycan ──────────")

            az_company = unidentified_name("Azerbaycan")
            cur.execute("SELECT id FROM customers WHERE company_name = %s", ("BAKÜ",))
            baku_row = cur.fetchone()

            if not baku_row:
                print("  SKIP  'BAKÜ' — kayıt bulunamadı")
            else:
                baku_id = str(baku_row["id"])
                cur.execute(
                    "SELECT COUNT(*) as cnt FROM historical_quotes_raw WHERE customer_id = %s",
                    (baku_id,)
                )
                baku_hq = cur.fetchone()["cnt"]

                # Find target card (created in ADIM 1 or already in DB)
                az_id = new_card_ids.get("Azerbaycan")
                if not az_id:
                    cur.execute("SELECT id FROM customers WHERE company_name = %s", (az_company,))
                    az_row = cur.fetchone()
                    az_id = str(az_row["id"]) if az_row else None

                if not az_id:
                    print(f"  WARN  '{az_company}' kartı bulunamadı — BAKÜ temizlenemedi")
                else:
                    if not dry_run:
                        cur.execute(
                            "UPDATE historical_quotes_raw SET customer_id = %s WHERE customer_id = %s",
                            (az_id, baku_id)
                        )
                        cur.execute("DELETE FROM customers WHERE id = %s", (baku_id,))
                    rerouted_count += baku_hq
                    deleted_count += 1
                    print(f"  {tag}DELETE  'BAKÜ'  →  {baku_hq} teklif → {az_company!r}")

            # ══════════════════════════════════════════════════════════════════
            # ADIM 3 — Category 9: TEKNOMAK (tek kelime) → TEKNOMAK - CEZAYİR
            # ══════════════════════════════════════════════════════════════════
            print("\n── ADIM 3: TEKNOMAK (tek) → TEKNOMAK - CEZAYİR ───────────")

            cur.execute("SELECT id, country FROM customers WHERE name_normalized = 'TEKNOMAK'")
            teknomak_rows = cur.fetchall()

            for tek in teknomak_rows:
                tek_id  = str(tek["id"])
                tek_iso = tek["country"] or ""

                cur.execute(
                    "SELECT COUNT(*) as cnt FROM historical_quotes_raw WHERE customer_id = %s",
                    (tek_id,)
                )
                tek_hq = cur.fetchone()["cnt"]

                # Find target: same ISO → TEKNOMAK {country}
                target_id = None
                if tek_iso == "DZ":
                    # Exact match: TEKNOMAK - CEZAYİR (name_normalized = 'TEKNOMAKCEZAYIR')
                    cur.execute(
                        "SELECT id FROM customers WHERE name_normalized = 'TEKNOMAKCEZAYIR'"
                    )
                    t = cur.fetchone()
                    target_id = str(t["id"]) if t else None
                elif tek_iso:
                    cur.execute(
                        "SELECT id FROM customers WHERE name_normalized LIKE %s ORDER BY name_normalized LIMIT 1",
                        (f"TEKNOMAK{tek_iso}%",)
                    )
                    t = cur.fetchone()
                    target_id = str(t["id"]) if t else None

                if not target_id:
                    # Create a catch-all unidentified TEKNOMAK card
                    catch_name = "(Kimliği Belirsiz) — TEKNOMAK Bilinmeyen Ülke"
                    cur.execute("SELECT id FROM customers WHERE company_name = %s", (catch_name,))
                    catch_row = cur.fetchone()
                    if catch_row:
                        target_id = str(catch_row["id"])
                    else:
                        if not dry_run:
                            cur.execute(
                                """INSERT INTO customers
                                     (company_name, customer_type, status, source,
                                      data_quality_flag, assigned_to, created_by)
                                   VALUES (%s, 'direct', 'unidentified', 'import_2026',
                                           'cleanup_013_teknomak_branch', %s, %s)
                                   RETURNING id""",
                                (catch_name, coordinator_id, coordinator_id)
                            )
                            target_id = str(cur.fetchone()["id"])
                        else:
                            target_id = "<new-uuid>"
                        created_count += 1
                        print(f"  {tag}CREATE  {catch_name!r}")

                if not dry_run:
                    cur.execute(
                        "UPDATE historical_quotes_raw SET customer_id = %s WHERE customer_id = %s",
                        (target_id, tek_id)
                    )
                    cur.execute("DELETE FROM customers WHERE id = %s", (tek_id,))

                rerouted_count += tek_hq
                deleted_count += 1
                print(f"  {tag}DELETE  'TEKNOMAK' (country={tek_iso})  →  {tek_hq} teklif → target")

            # ══════════════════════════════════════════════════════════════════
            # ADIM 4 — Rapor
            # ══════════════════════════════════════════════════════════════════
            print("\n" + "═" * 60)
            print(f"  {'DRY-RUN ' if dry_run else ''}SPRINT RAPORU")
            print("═" * 60)
            print(f"  Oluşturulan yeni kart (unidentified): {created_count}")
            print(f"  Silinen eski kart:                    {deleted_count}")
            print(f"  Yönlendirilen historical_quotes satır: {rerouted_count}")

            # Current customers total
            cur.execute("SELECT COUNT(*) as cnt FROM customers")
            total_now = cur.fetchone()["cnt"]
            print(f"  Anlık customers toplamı:              {total_now}"
                  + ("  (commit sonrası)" if not dry_run else "  (tahmini)"))

            print("\n  Kategori detayı:")
            print(f"  {'Eski ad':<25} {'Yeni kart':<40} {'Teklif':>6}")
            print(f"  {'-'*25} {'-'*40} {'-'*6}")
            for old_n, new_n, hq in cat_stats:
                print(f"  {old_n:<25} {new_n:<40} {hq:>6}")

            # ══════════════════════════════════════════════════════════════════
            # ADIM 5 — Doğrulama (sadece real run için)
            # ══════════════════════════════════════════════════════════════════
            if not dry_run:
                print("\n── ADIM 5: Doğrulama ──────────────────────────────────────")
                country_names = [r[0] for r in CATEGORY_1] + ["BAKÜ", "TEKNOMAK"]
                cur.execute(
                    "SELECT COUNT(*) as cnt FROM customers WHERE company_name = ANY(%s)",
                    (country_names,)
                )
                leftover = cur.fetchone()["cnt"]
                status = "✓" if leftover == 0 else "✗ HATA"
                print(f"  {status} Eski ulke/tek-kelime kartı kalan: {leftover}  (beklenti: 0)")

                cur.execute("SELECT COUNT(*) as cnt FROM customers WHERE status = 'unidentified'")
                unid = cur.fetchone()["cnt"]
                print(f"  ✓ status=unidentified kart sayısı: {unid}")

                cur.execute("SELECT COUNT(*) as cnt FROM historical_quotes_raw WHERE customer_id IS NULL")
                orphan = cur.fetchone()["cnt"]
                status2 = "✓" if orphan == 0 else "✗ HATA"
                print(f"  {status2} Sahipsiz historical_quotes satır: {orphan}  (beklenti: 0)")

                cur.execute(
                    "SELECT COUNT(*) as cnt FROM historical_quotes_raw WHERE customer_id = (SELECT id FROM customers WHERE name_normalized = 'TEKNOMAKCEZAYIR')"
                )
                tek_cez = cur.fetchone()["cnt"]
                print(f"  ✓ TEKNOMAK-CEZAYİR toplam teklif: {tek_cez}  (önceden 526, +15 TEKNOMAK → 541 beklenti)")

            if dry_run:
                conn.rollback()
                print("\n  [DRY-RUN] — hiçbir değişiklik kaydedilmedi.")
            else:
                conn.commit()
                print("\n  Tüm değişiklikler commit edildi.")

    conn.close()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Data Cleanup Sprint 013")
    parser.add_argument("--dry-run", action="store_true", help="Değişiklik yapmadan rapor göster")
    args = parser.parse_args()
    run(dry_run=args.dry_run)
