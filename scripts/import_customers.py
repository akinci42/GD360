#!/usr/bin/env python3
"""
CRM Import Script — Hybrid Model
CSV → historical_quotes_raw → customers (dedupe + auto-assign)

Usage:
  python scripts/import_customers.py data/gd360_crm_raw_export.csv
  python scripts/import_customers.py data/gd360_crm_raw_export.csv --dry-run
  python scripts/import_customers.py data/gd360_crm_raw_export.csv --dry-run --use-haiku
  python scripts/import_customers.py --synthetic   # built-in 10-row test
"""

import argparse
import csv
import io
import os
import re
import sys
import time
import uuid
from collections import Counter, defaultdict
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

# Turkish full country name → ISO-2
TR_COUNTRY_TO_ISO: dict[str, str] = {
    "Türkiye": "TR", "Turkiye": "TR",
    "Özbekistan": "UZ", "Ozbekistan": "UZ",
    "Kazakistan": "KZ",
    "Rusya": "RU", "Rusya Federasyonu": "RU",
    "Cezayir": "DZ",
    "Irak": "IQ",
    "Mısır": "EG", "Misir": "EG",
    "İran": "IR", "Iran": "IR",
    "Ukrayna": "UA",
    "Etiyopya": "ET",
    "Kenya": "KE",
    "Libya": "LY",
    "Fas": "MA",
    "Azerbaycan": "AZ",
    "Bulgaristan": "BG",
    "Pakistan": "PK",
    "Romanya": "RO",
    "Hindistan": "IN",
    "Tacikistan": "TJ",
    "Kırgızistan": "KG", "Kirgizistan": "KG",
    "Türkmenistan": "TM", "Turkmenistan": "TM",
    "Sudan": "SD",
    "Nijerya": "NG",
    "Tanzanya": "TZ",
    "Uganda": "UG",
    "Gana": "GH",
    "Senegal": "SN",
    "Kamerun": "CM",
    "İvoryakıyısı": "CI", "Fildişi Sahili": "CI",
    "Gürcistan": "GE", "Gurcistan": "GE",
    "Ermenistan": "AM",
    "Moldova": "MD",
    "Belarus": "BY",
    "Polonya": "PL",
    "Almanya": "DE",
    "Fransa": "FR",
    "İspanya": "ES", "Ispanya": "ES",
    "İtalya": "IT", "Italya": "IT",
    "Hollanda": "NL",
    "Belçika": "BE", "Belcika": "BE",
    "İsveç": "SE", "Isvec": "SE",
    "Norveç": "NO", "Norvec": "NO",
    "Finlandiya": "FI",
    "Danimarka": "DK",
    "Avusturya": "AT",
    "İsviçre": "CH", "Isvicre": "CH",
    "Çekya": "CZ", "Cekya": "CZ",
    "Macaristan": "HU",
    "Yunanistan": "GR",
    "Sırbistan": "RS", "Sirbistan": "RS",
    "Hırvatistan": "HR", "Hirvatistan": "HR",
    "Bosna Hersek": "BA",
    "Arnavutluk": "AL",
    "Kuzey Makedonya": "MK",
    "Slovenya": "SI",
    "Slovakya": "SK",
    "Litvanya": "LT",
    "Letonya": "LV",
    "Estonya": "EE",
    "Portekiz": "PT",
    "İngiltere": "GB", "Ingiltere": "GB", "Birleşik Krallık": "GB",
    "İrlanda": "IE", "Irlanda": "IE",
    "Suudi Arabistan": "SA",
    "BAE": "AE", "Birleşik Arap Emirlikleri": "AE",
    "Katar": "QA",
    "Kuveyt": "KW",
    "Bahreyn": "BH",
    "Umman": "OM",
    "Yemen": "YE",
    "Suriye": "SY",
    "Ürdün": "JO", "Urdun": "JO",
    "Lübnan": "LB", "Lubnan": "LB",
    "Filistin": "PS",
    "Tunus": "TN",
    "Somali": "SO",
    "Zambia": "ZM", "Zambiya": "ZM",
    "Zimbabve": "ZW",
    "Bangladeş": "BD", "Banglades": "BD",
    "Afganistan": "AF",
    "Arjantin": "AR",
    "Brezilya": "BR",
    "Kolombiya": "CO",
    "Meksika": "MX",
    "ABD": "US", "Amerika": "US",
    "Kanada": "CA",
    "Avustralya": "AU",
    "Çin": "CN", "Cin": "CN",
    "Japonya": "JP",
    "Güney Kore": "KR",
    "Malezya": "MY",
    "Endonezya": "ID",
    "Tayland": "TH",
    "Filipinler": "PH",
    "Vietnam": "VN",
    "Sri Lanka": "LK",
    "Bilinmiyor": None,
    "": None,
}

# Sales rep assignment: ISO country code → email prefix
ULKE_TO_REP: dict[str, str] = {
    # Orhan: domestic Turkey
    "TR": "orhan",
    # Ramazan: CIS / former Soviet (main region)
    "UZ": "ramazan", "KZ": "ramazan", "RU": "ramazan", "AZ": "ramazan",
    "TJ": "ramazan", "UA": "ramazan", "GE": "ramazan", "AM": "ramazan",
    "BY": "ramazan", "MD": "ramazan",
    # Sanzhar: CIS support only (Kyrgyzstan + Turkmenistan)
    "KG": "sanzhar", "TM": "sanzhar",
    # Sami: MENA / Middle East / North Africa / Iran
    "SA": "sami", "AE": "sami", "QA": "sami", "KW": "sami",
    "BH": "sami", "OM": "sami", "YE": "sami", "IQ": "sami",
    "SY": "sami", "JO": "sami", "LB": "sami", "PS": "sami",
    "EG": "sami", "LY": "sami", "TN": "sami", "DZ": "sami",
    "MA": "sami", "SD": "sami", "SO": "sami", "IR": "sami",
    # Sinan: Sub-Saharan Africa + South Asia + Europe + Americas + other
    "NG": "sinan", "ET": "sinan", "KE": "sinan", "TZ": "sinan",
    "UG": "sinan", "ZM": "sinan", "ZW": "sinan", "SN": "sinan",
    "GH": "sinan", "CI": "sinan", "CM": "sinan",
    "PK": "sinan", "BD": "sinan", "AF": "sinan", "IN": "sinan", "LK": "sinan",
    # Europe
    "DE": "sinan", "FR": "sinan", "ES": "sinan", "IT": "sinan",
    "NL": "sinan", "BE": "sinan", "SE": "sinan", "NO": "sinan",
    "FI": "sinan", "DK": "sinan", "AT": "sinan", "CH": "sinan",
    "CZ": "sinan", "HU": "sinan", "GR": "sinan", "RS": "sinan",
    "HR": "sinan", "BA": "sinan", "AL": "sinan", "MK": "sinan",
    "SI": "sinan", "SK": "sinan", "LT": "sinan", "LV": "sinan",
    "EE": "sinan", "PT": "sinan", "GB": "sinan", "IE": "sinan",
    "PL": "sinan", "BG": "sinan", "RO": "sinan",
    # Americas
    "US": "sinan", "CA": "sinan", "AR": "sinan", "BR": "sinan",
    "CO": "sinan", "MX": "sinan",
    # Asia Pacific + other
    "AU": "sinan", "CN": "sinan", "JP": "sinan", "KR": "sinan",
    "MY": "sinan", "ID": "sinan", "TH": "sinan", "PH": "sinan",
    "VN": "sinan",
    # Sami is the fallback for any remaining mapped country
}

# Channel type → (customer_type, partner_subtype)
KANAL_MAP: dict[str, tuple[str, str | None]] = {
    "Distribütör":   ("partner", "distributor"),
    "Distributor":   ("partner", "distributor"),
    "Bölge Ofisi":   ("partner", "regional_office"),
    "Bolge Ofisi":   ("partner", "regional_office"),
    "Yurtiçi":       ("direct", None),
    "Yurtici":       ("direct", None),
    "Belirtilmemiş": ("direct", None),
    "Belirtilmamis": ("direct", None),
}

# End-customer extraction patterns
END_CUSTOMER_PATTERNS = [
    # "(Fransa İçin)", "(Irak İçin)" etc. — destination country/company
    re.compile(r"\(([^)]{2,60})\s+[İi][çc]in\)", re.IGNORECASE),
    # Explicit labels
    re.compile(r"(?:son kullan[ıi]c[ıi]|end.?customer|nihai kullan[ıi]c[ıi])[:\s→]+([^,\n\(]{3,60})", re.IGNORECASE),
    re.compile(r"(?:proje|project)[:\s→]+([^,\n\(]{3,60})", re.IGNORECASE),
    re.compile(r"(?:firma|company|m[uü][şs]teri)[:\s→]+([^,\n\(]{3,60})", re.IGNORECASE),
]

# Language map: normalize Dil field (handles TR/RU, TR / EN, etc.)
DİL_NORM: dict[str, str] = {
    "TR": "TR", "EN": "EN", "RU": "RU", "AR": "AR", "FR": "FR",
    "TE": "TR",  # typo in data
}

# ─── Turkish name normalizer ──────────────────────────────────────────────────

_TR_TABLE = str.maketrans("çÇğĞıİşŞöÖüÜ", "cCgGiIsSOoUu")

def normalize_name(name: str) -> str:
    if not name:
        return ""
    v = name.translate(_TR_TABLE).upper()
    return re.sub(r"[^A-Z0-9]", "", v)

# ─── Field parsers ────────────────────────────────────────────────────────────

def parse_date(s: str) -> date | None:
    if not s:
        return None
    for fmt in ("%Y-%m-%d", "%d.%m.%Y", "%d/%m/%Y"):
        try:
            return datetime.strptime(s.strip(), fmt).date()
        except ValueError:
            continue
    return None


def country_to_iso(raw: str) -> str | None:
    """Map Turkish country name (or ISO code) to ISO-2."""
    if not raw:
        return None
    raw = raw.strip()
    # Already ISO-2?
    if len(raw) == 2 and raw.isupper():
        return raw
    return TR_COUNTRY_TO_ISO.get(raw)


def extract_city(lokasyon: str) -> str | None:
    if not lokasyon:
        return None
    parts = [p.strip() for p in lokasyon.split(",")]
    return parts[0] if parts[0] else None


def extract_language(dil: str) -> str | None:
    """Take first valid language token from e.g. 'TR/RU', 'TR / EN', 'TR/RU/\nEN'."""
    if not dil:
        return None
    # Split on / ; , whitespace newline
    tokens = re.split(r"[/;,\s\n]+", dil.strip())
    for t in tokens:
        t = t.strip().upper()
        if t in DİL_NORM:
            return DİL_NORM[t]
    return None


def extract_end_customer_suggestion(aciklama: str) -> str | None:
    if not aciklama:
        return None
    for pat in END_CUSTOMER_PATTERNS:
        m = pat.search(aciklama)
        if m:
            result = m.group(1).strip().rstrip("→").strip()
            if len(result) >= 3:
                return result[:200]
    return None


def kanal_to_type(kanal: str) -> tuple[str, str | None]:
    return KANAL_MAP.get(kanal.strip(), ("direct", None))


# ─── Haiku fallback ───────────────────────────────────────────────────────────

def haiku_assign_rep(country_iso: str, company_name: str) -> str:
    try:
        import anthropic
        client = anthropic.Anthropic()
        msg = client.messages.create(
            model="claude-haiku-4-5-20251001",
            max_tokens=20,
            messages=[{
                "role": "user",
                "content": (
                    f"Sales rep assignment for a milling machinery company. "
                    f"Reps: orhan (Turkey), sinan (MENA/Middle East/North Africa), "
                    f"sanzhar (Central Asia/CIS/Russia), ramazan (Sub-Saharan Africa/South Asia), "
                    f"sami (Europe/Americas/other). "
                    f"Country ISO: {country_iso}, Company: {company_name}. "
                    f"Reply with only the rep name (one word)."
                ),
            }],
        )
        rep = msg.content[0].text.strip().lower().split()[0]
        if rep in ("orhan", "sinan", "sanzhar", "ramazan", "sami"):
            return rep
    except Exception:
        pass
    return "sami"


def assign_rep(country_iso: str | None, company_name: str, use_haiku: bool) -> str:
    if country_iso:
        rep = ULKE_TO_REP.get(country_iso)
        if rep:
            return rep
        if use_haiku:
            return haiku_assign_rep(country_iso, company_name)
        return "sami"
    # country_iso is None (Bilinmiyor) → coordinator reviews
    return "ahmet"


# ─── DB helpers ───────────────────────────────────────────────────────────────

def load_users(cur) -> dict[str, str]:
    cur.execute("SELECT id, email FROM users")
    return {row["email"].split("@")[0]: str(row["id"]) for row in cur.fetchall()}


def load_existing_customers(cur) -> dict[str, str]:
    cur.execute("SELECT id, name_normalized FROM customers WHERE name_normalized IS NOT NULL")
    return {row["name_normalized"]: str(row["id"]) for row in cur.fetchall()}


def ref_exists(cur, ref_no: str) -> str | None:
    """Return existing raw row id for this ref_no, or None."""
    if not ref_no:
        return None
    cur.execute("SELECT id FROM historical_quotes_raw WHERE ref_no = %s LIMIT 1", (ref_no,))
    row = cur.fetchone()
    return str(row["id"]) if row else None


# ─── Core row processor ───────────────────────────────────────────────────────

def import_row(
    cur,
    row: dict,
    row_num: int,
    users: dict[str, str],
    existing: dict[str, str],
    use_haiku: bool,
    stats: dict,
    report: dict,
):
    musteri    = (row.get("Müşteri") or row.get("Musteri") or "").strip()
    kanal      = (row.get("Kanal Tipi") or "").strip()
    lokasyon   = (row.get("Lokasyon") or "").strip()
    ref_no     = (row.get("Ref No") or row.get("RefNo") or "").strip()
    tarih_str  = (row.get("Tarih") or "").strip()
    ulke_raw   = (row.get("Ülke") or row.get("Ulke") or "").strip()
    kap_str    = (row.get("Kapasite (T/G)") or row.get("Kapasite (TG)") or row.get("Kapasite") or "").strip()
    proje_tipi = (row.get("Proje Tipi") or "").strip()
    vals_str   = (row.get("Vals") or "").strip()
    aciklama   = (row.get("Açıklama") or row.get("Aciklama") or "").strip()
    dil        = (row.get("Dil") or "").strip()

    if not musteri:
        stats["skipped"] += 1
        report["errors"].append(f"Row {row_num}: empty Müşteri — skipped")
        return

    tarih = parse_date(tarih_str)
    try:
        kapasite = int(kap_str) if kap_str else None
    except ValueError:
        kapasite = None
    try:
        vals = int(vals_str) if vals_str else None
    except ValueError:
        vals = None

    country_iso = country_to_iso(ulke_raw)
    city        = extract_city(lokasyon)
    lang        = extract_language(dil)
    end_sugg    = extract_end_customer_suggestion(aciklama)

    # ── historical_quotes_raw: skip if ref_no already exists ─────────────────
    existing_raw_id = ref_exists(cur, ref_no) if ref_no else None
    if existing_raw_id:
        raw_id = existing_raw_id
        stats["raw_skipped"] += 1
    else:
        new_raw_id = str(uuid.uuid4())
        cur.execute(
            """
            INSERT INTO historical_quotes_raw
              (id, row_number, musteri, kanal_tipi, lokasyon, ref_no, tarih,
               ulke, kapasite_tg, proje_tipi, vals, aciklama, dil,
               end_customer_suggestion)
            VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
            """,
            (new_raw_id, row_num, musteri, kanal, lokasyon, ref_no or None,
             tarih, country_iso, kapasite, proje_tipi, vals, aciklama, dil,
             end_sugg),
        )
        raw_id = new_raw_id
        stats["raw_inserted"] += 1

    if end_sugg:
        stats["end_suggestions"] += 1
        if len(report["end_suggestion_samples"]) < 10:
            report["end_suggestion_samples"].append((musteri, aciklama[:80], end_sugg))

    # ── Country stats ─────────────────────────────────────────────────────────
    report["country_counter"][ulke_raw or "Bilinmiyor"] += 1

    # ── Dedupe / find or create customer ─────────────────────────────────────
    name_norm = normalize_name(musteri)
    customer_type, partner_subtype = kanal_to_type(kanal)
    rep_key     = assign_rep(country_iso, musteri, use_haiku)
    assigned_to = users.get(rep_key) or users.get("sami")
    created_by  = users.get("remzi") or users.get("ahmet")

    # Track rep stats
    report["rep_counter"][rep_key] += 1

    existing_id = existing.get(name_norm)
    if existing_id:
        customer_id = existing_id
        stats["deduped"] += 1
        # Track dedupe group
        report["dedupe_groups"][name_norm].append(musteri)
    else:
        if customer_type == "partner" and partner_subtype is None:
            partner_subtype = "distributor"
        if customer_type == "end_customer":
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
            VALUES (%s,%s,%s,%s,%s,%s,%s,'import_2026','active',%s,%s,%s)
            """,
            (new_id, musteri, customer_type, partner_subtype,
             country_iso, city, lang,
             assigned_to, created_by, raw_id),
        )
        customer_id = new_id
        existing[name_norm] = customer_id
        stats["inserted"] += 1

        # Track type breakdown
        if customer_type == "partner":
            report["type_counter"][f"partner_{partner_subtype}"] += 1
        else:
            report["type_counter"][customer_type] += 1

    # Link raw → customer
    cur.execute(
        "UPDATE historical_quotes_raw SET customer_id = %s WHERE id = %s",
        (customer_id, raw_id),
    )


# ─── Groups ───────────────────────────────────────────────────────────────────

def ensure_groups(cur, users: dict) -> dict:
    created_by = users.get("remzi") or users.get("ahmet")
    groups = [
        {"name": "TEKNOMAK Ağı",      "description": "TEKNOMAK distribütör ve bayi ağı",  "group_type": "distributor_network"},
        {"name": "GD Bölge Ofisleri", "description": "Genc Degirmen bölge ofisleri",       "group_type": "distributor_network"},
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


def populate_groups(cur, group_ids: dict, users: dict, report: dict):
    added_by = users.get("remzi") or users.get("ahmet")

    cur.execute(
        """
        INSERT INTO customer_group_members (customer_id, group_id, added_by)
        SELECT c.id, %s, %s
        FROM customers c
        WHERE c.customer_type = 'partner'
          AND c.partner_subtype = 'distributor'
          AND c.source = 'import_2026'
        ON CONFLICT DO NOTHING
        RETURNING customer_id
        """,
        (group_ids.get("TEKNOMAK Ağı"), added_by),
    )
    dist_ids = [str(r["customer_id"]) for r in cur.fetchall()]
    report["group_members"]["TEKNOMAK Ağı"] = dist_ids

    cur.execute(
        """
        INSERT INTO customer_group_members (customer_id, group_id, added_by)
        SELECT c.id, %s, %s
        FROM customers c
        WHERE c.customer_type = 'partner'
          AND c.partner_subtype = 'regional_office'
          AND c.source = 'import_2026'
        ON CONFLICT DO NOTHING
        RETURNING customer_id
        """,
        (group_ids.get("GD Bölge Ofisleri"), added_by),
    )
    office_ids = [str(r["customer_id"]) for r in cur.fetchall()]
    report["group_members"]["GD Bölge Ofisleri"] = office_ids


def get_group_names(cur, ids: list[str]) -> list[str]:
    if not ids:
        return []
    cur.execute(
        "SELECT company_name FROM customers WHERE id::text = ANY(%s) ORDER BY company_name",
        (ids,),
    )
    return [r["company_name"] for r in cur.fetchall()]


# ─── Report printer ───────────────────────────────────────────────────────────

def print_report(stats: dict, report: dict, elapsed: float, dry_run: bool, cur=None):
    mode = "[DRY RUN] " if dry_run else ""
    sep = "═" * 60

    print(f"\n{sep}")
    print(f"  {mode}CRM Import Report")
    print(sep)

    # 1. Toplam satır
    print(f"\n① Toplam satır okundu          : {stats['processed']:>6}")

    # 2. historical_quotes_raw
    print(f"\n② historical_quotes_raw")
    print(f"   Yazılacak (yeni)             : {stats['raw_inserted']:>6}")
    print(f"   Zaten mevcut (ref_no match)  : {stats['raw_skipped']:>6}")

    # 3. Unique customer breakdown
    tc = report["type_counter"]
    total_customers = stats["inserted"]
    dist = tc.get("partner_distributor", 0)
    roff = tc.get("partner_regional_office", 0)
    direct = tc.get("direct", 0)
    ec = tc.get("end_customer", 0)
    print(f"\n③ Unique müşteri → {total_customers} yeni kayıt")
    print(f"   partner / distributor        : {dist:>6}")
    print(f"   partner / regional_office    : {roff:>6}")
    print(f"   direct                       : {direct:>6}")
    print(f"   end_customer (→ direct)      : {ec:>6}")

    # 4. Dedupe
    multi = {k: v for k, v in report["dedupe_groups"].items() if len(v) > 1}
    print(f"\n④ Dedupe ile birleşen grup      : {len(multi):>6}")
    sample_groups = sorted(multi.items(), key=lambda x: -len(x[1]))[:5]
    if sample_groups:
        print("   Örnek 5 grup:")
        for norm, names in sample_groups:
            unique_names = sorted(set(names))
            print(f"   • [{norm}] → {' | '.join(unique_names[:4])}")

    # 5. Sales rep dağılımı
    rc = report["rep_counter"]
    total_assigned = sum(rc.values())
    print(f"\n⑤ Sales rep dağılımı (toplam atanan: {total_assigned})")
    for rep in ("orhan", "ramazan", "sanzhar", "sami", "sinan", "ahmet"):
        n = rc.get(rep, 0)
        pct = n / total_assigned * 100 if total_assigned else 0
        suffix = "  (Bilinmiyor → coordinator)" if rep == "ahmet" else ""
        print(f"   {rep:<10}: {n:>6}  ({pct:.1f}%){suffix}")

    # 6. End-customer önerileri
    print(f"\n⑥ end_customer_suggestion bulunan : {stats['end_suggestions']:>6}")
    if report["end_suggestion_samples"]:
        print("   Örnek 10 öneri (ham açıklama → çıkarılan öneri):")
        for musteri, raw, sugg in report["end_suggestion_samples"]:
            print(f"   • {musteri[:30]:<32} | {raw[:50]:<52} → {sugg}")

    # 7. Customer groups
    print(f"\n⑦ Customer Groups")
    for gname, ids in report["group_members"].items():
        print(f"   {gname}: {len(ids)} üye")
        if cur and ids:
            names = get_group_names(cur, ids)
            for n in names[:10]:
                print(f"     - {n}")
            if len(names) > 10:
                print(f"     ... (+{len(names)-10} daha)")

    # 8. Hatalar
    print(f"\n⑧ Hata / atlanan")
    print(f"   Atlanan satır (boş Müşteri)  : {stats['skipped']:>6}")
    print(f"   İşlem hatası                 : {stats['errors']:>6}")
    if report["errors"]:
        for e in report["errors"][:5]:
            print(f"   • {e}")

    # 9. Ülke dağılımı top 10
    print(f"\n⑨ Ülke dağılımı (Top 10 — ham değer)")
    for country, cnt in report["country_counter"].most_common(10):
        print(f"   {country:<30}: {cnt:>6}")

    # 10. Toplam süre
    print(f"\n⑩ Toplam süre                   : {elapsed:.1f}s")

    if dry_run:
        print(f"\n  ⚠  Transaction ROLLED BACK — veritabanında değişiklik YOK.")
    else:
        print(f"\n  ✓  Değişiklikler commit edildi.")

    print(f"\n{sep}\n")


# ─── Synthetic data ───────────────────────────────────────────────────────────

SYNTHETIC_CSV = """Müşteri;Kanal Tipi;Lokasyon;Ref No;Tarih;Ülke;Kapasite (T/G);Proje Tipi;Vals;Açıklama;Dil
TEKNOMAK A.Ş.;Distribütör;Konya, TR;REF-001;2024-03-15;Türkiye;200;Roller;4;Son kullanici: DOĞUŞ UN FABRİKASI;TR
Al-Faris Trading;Distribütör;Riyadh;REF-002;2024-03-20;Suudi Arabistan;500;Roller;6;End customer: AL MARAI;TR/EN
Central Asia Mills;Bölge Ofisi;Almaty;REF-003;2024-04-01;Kazakistan;300;Plansifter;4;Proje: Astana Mill;TR/RU
EuroBake GmbH;Belirtilmemiş;Berlin;REF-004;2024-04-05;Almanya;150;Roller;2;;TR/EN
Makina Dünyası;Yurtiçi;İstanbul;REF-005;2024-04-10;Türkiye;100;Plansifter;2;Son kullanici: ÜLKER;TR
Nigeria Flour Mills;Distribütör;Lagos;REF-006;2024-04-12;Nijerya;400;Roller;6;End customer: NB FLOUR;TR/EN
Tashkent Milling Co;Bölge Ofisi;Tashkent;REF-007;2024-04-15;Özbekistan;250;Roller;4;;TR/RU
TEKNOMAK A.Ş.;Distribütör;Konya;REF-008;2024-04-18;Türkiye;200;Plansifter;2;Firma: YENİ UN;TR
Cairo Trade LLC;Distribütör;Cairo;REF-009;2024-04-20;Mısır;350;Roller;4;End customer: CAIRO FLOUR;TR/EN
Bogota Molinos S.A.;Belirtilmemiş;Bogota;REF-010;2024-04-22;Kolombiya;180;Roller;2;;TR/EN
"""


# ─── Main ─────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description="Import CRM customers from CSV")
    parser.add_argument("csv_file", nargs="?", help="CSV file path (UTF-8-sig, separator ;)")
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--use-haiku", action="store_true")
    parser.add_argument("--synthetic", action="store_true")
    args = parser.parse_args()

    if args.synthetic or args.csv_file is None:
        print("Using synthetic test data (10 rows) — forcing --dry-run...")
        csv_source = io.StringIO(SYNTHETIC_CSV)
        args.dry_run = True
    else:
        csv_path = Path(args.csv_file)
        if not csv_path.exists():
            print(f"ERROR: File not found: {csv_path}", file=sys.stderr)
            sys.exit(1)
        csv_source = open(csv_path, encoding="utf-8-sig")

    stats = {
        "processed": 0, "raw_inserted": 0, "raw_skipped": 0,
        "inserted": 0, "deduped": 0, "skipped": 0, "errors": 0,
        "end_suggestions": 0,
    }
    report = {
        "type_counter": Counter(),
        "rep_counter": Counter(),
        "country_counter": Counter(),
        "dedupe_groups": defaultdict(list),
        "end_suggestion_samples": [],
        "group_members": {},
        "errors": [],
    }

    t0 = time.time()

    conn = psycopg2.connect(DATABASE_URL, cursor_factory=psycopg2.extras.RealDictCursor)
    try:
        cur = conn.cursor()
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
                import_row(cur, row, i, users, existing, args.use_haiku, stats, report)
            except Exception as e:
                print(f"\n  ERROR row {i}: {e}", file=sys.stderr)
                stats["errors"] += 1
                report["errors"].append(f"Row {i}: {e}")

        group_ids = ensure_groups(cur, users)
        populate_groups(cur, group_ids, users, report)

        elapsed = time.time() - t0

        print_report(stats, report, elapsed, args.dry_run, cur)

        # Verification counts BEFORE rollback/commit
        cur.execute("SELECT COUNT(*) AS n FROM customers")
        cust_count = cur.fetchone()["n"]
        cur.execute("SELECT COUNT(*) AS n FROM historical_quotes_raw")
        raw_count = cur.fetchone()["n"]

        if args.dry_run:
            conn.rollback()
        else:
            conn.commit()

        # Post-rollback verification
        cur2 = conn.cursor()
        cur2.execute("SELECT COUNT(*) AS n FROM customers")
        cust_after = cur2.fetchone()["n"]
        cur2.execute("SELECT COUNT(*) AS n FROM historical_quotes_raw")
        raw_after = cur2.fetchone()["n"]

        if args.dry_run:
            print(f"Verification (transaction sırasında): customers={cust_count}, historical_quotes_raw={raw_count}")
            print(f"Verification (ROLLBACK sonrası)    : customers={cust_after}, historical_quotes_raw={raw_after}")
            ok = cust_after == 0 and raw_after == 0
            print(f"Tablolar boş mu?                   : {'✓ EVET' if ok else '✗ HAYIR — beklenmedik kayıt var!'}")
        else:
            print(f"Final counts: customers={cust_after}, historical_quotes_raw={raw_after}")

    finally:
        conn.close()
        if not (args.synthetic or args.csv_file is None):
            csv_source.close()


if __name__ == "__main__":
    main()
