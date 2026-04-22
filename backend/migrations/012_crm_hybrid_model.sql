-- ═══════════════════════════════════════════════════════════════════
-- Migration 012: Hybrid CRM Model
-- customer_type hiyerarşisi, gruplar, ham CSV tablosu
-- ═══════════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────────────────────────
-- BÖLÜM 1: normalize_customer_name() — fuzzy dedupe için
-- ─────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION normalize_customer_name(p_name text)
RETURNS text LANGUAGE plpgsql IMMUTABLE STRICT AS $$
DECLARE
  v text;
BEGIN
  -- Türkçe karakterleri ASCII karşılıklarıyla değiştir
  v := replace(replace(replace(replace(replace(replace(
       replace(replace(replace(replace(replace(replace(
         p_name,
         'ç','c'), 'Ç','C'), 'ğ','g'), 'Ğ','G'),
         'ı','i'), 'İ','I'), 'ş','s'), 'Ş','S'),
         'ö','o'), 'Ö','O'), 'ü','u'), 'Ü','U');
  -- Büyük harfe çevir
  v := upper(v);
  -- Harf ve rakam dışındakileri sil
  v := regexp_replace(v, '[^A-Z0-9]', '', 'g');
  RETURN v;
END;
$$;

-- ─────────────────────────────────────────────────────────────────
-- BÖLÜM 2: customers tablosuna yeni alanlar
-- ─────────────────────────────────────────────────────────────────
ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS customer_type     text NOT NULL DEFAULT 'direct'
    CHECK (customer_type IN ('partner','direct','end_customer')),
  ADD COLUMN IF NOT EXISTS partner_subtype   text
    CHECK (partner_subtype IN ('distributor','regional_office') OR partner_subtype IS NULL),
  ADD COLUMN IF NOT EXISTS parent_id         uuid REFERENCES customers(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS name_normalized   text,
  ADD COLUMN IF NOT EXISTS source            text NOT NULL DEFAULT 'manual'
    CHECK (source IN ('import_2026','manual','lead')),
  ADD COLUMN IF NOT EXISTS status            text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active','passive','blacklisted')),
  ADD COLUMN IF NOT EXISTS primary_language  text
    CHECK (primary_language IN ('TR','EN','RU','AR','FR') OR primary_language IS NULL),
  ADD COLUMN IF NOT EXISTS tax_number        text,
  ADD COLUMN IF NOT EXISTS address           text,
  ADD COLUMN IF NOT EXISTS imported_from_raw_id uuid;  -- FK sonraki bölümde eklenir

-- Çok sütunlu iş kuralı CHECK:
--   partner      → partner_subtype zorunlu
--   end_customer → parent_id zorunlu
--   direct       → ikisi de NULL
ALTER TABLE customers
  ADD CONSTRAINT customers_type_rules CHECK (
    (customer_type = 'partner'      AND partner_subtype IS NOT NULL) OR
    (customer_type = 'end_customer' AND parent_id IS NOT NULL) OR
    (customer_type = 'direct'       AND partner_subtype IS NULL AND parent_id IS NULL)
  );

-- İndeksler
CREATE INDEX IF NOT EXISTS idx_customers_name_normalized ON customers(name_normalized);
CREATE INDEX IF NOT EXISTS idx_customers_customer_type   ON customers(customer_type);
CREATE INDEX IF NOT EXISTS idx_customers_parent_id       ON customers(parent_id);
CREATE INDEX IF NOT EXISTS idx_customers_country_type    ON customers(country, customer_type);

-- Trigger: INSERT/UPDATE sırasında name_normalized otomatik doldur
CREATE OR REPLACE FUNCTION customers_set_name_normalized()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.name_normalized := normalize_customer_name(NEW.company_name);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_customers_name_normalized ON customers;
CREATE TRIGGER trg_customers_name_normalized
  BEFORE INSERT OR UPDATE OF company_name ON customers
  FOR EACH ROW EXECUTE FUNCTION customers_set_name_normalized();

-- Mevcut satırları backfill et
UPDATE customers SET name_normalized = normalize_customer_name(company_name);

-- ─────────────────────────────────────────────────────────────────
-- BÖLÜM 3: customer_groups
-- ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS customer_groups (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text        NOT NULL UNIQUE,
  description text,
  group_type  text        CHECK (group_type IN ('distributor_network','ownership_group','geographic','custom')),
  created_by  uuid        NOT NULL REFERENCES users(id),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE customer_groups ENABLE ROW LEVEL SECURITY;

CREATE POLICY cg_select ON customer_groups FOR SELECT USING (true);
CREATE POLICY cg_insert ON customer_groups FOR INSERT
  WITH CHECK (current_setting('app.user_role', TRUE) IN ('owner','coordinator'));
CREATE POLICY cg_update ON customer_groups FOR UPDATE
  USING (current_setting('app.user_role', TRUE) IN ('owner','coordinator'));
CREATE POLICY cg_delete ON customer_groups FOR DELETE
  USING (current_setting('app.user_role', TRUE) IN ('owner','coordinator'));

CREATE TRIGGER customer_groups_updated_at
  BEFORE UPDATE ON customer_groups
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ─────────────────────────────────────────────────────────────────
-- BÖLÜM 4: customer_group_members (many-to-many)
-- ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS customer_group_members (
  customer_id uuid NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  group_id    uuid NOT NULL REFERENCES customer_groups(id) ON DELETE CASCADE,
  added_by    uuid REFERENCES users(id) ON DELETE SET NULL,
  added_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (customer_id, group_id)
);

ALTER TABLE customer_group_members ENABLE ROW LEVEL SECURITY;

CREATE POLICY cgm_select ON customer_group_members FOR SELECT USING (true);
CREATE POLICY cgm_insert ON customer_group_members FOR INSERT
  WITH CHECK (current_setting('app.user_role', TRUE) IN ('owner','coordinator'));
CREATE POLICY cgm_delete ON customer_group_members FOR DELETE
  USING (current_setting('app.user_role', TRUE) IN ('owner','coordinator'));

-- ─────────────────────────────────────────────────────────────────
-- BÖLÜM 5: historical_quotes_raw — ham CSV tablosu (değişmez)
-- ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS historical_quotes_raw (
  id                        uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  row_number                int,
  musteri                   text,
  kanal_tipi                text,
  lokasyon                  text,
  ref_no                    text,
  tarih                     date,
  ulke                      text,
  kapasite_tg               int,
  proje_tipi                text,
  vals                      int,
  aciklama                  text,
  dil                       text,
  -- Dedupe sonrası bağlantılar
  customer_id               uuid REFERENCES customers(id) ON DELETE SET NULL,
  end_customer_id           uuid REFERENCES customers(id) ON DELETE SET NULL,
  -- Yarı-otomatik end_customer tespiti
  end_customer_suggestion   text,
  end_customer_reviewed     boolean NOT NULL DEFAULT false,
  end_customer_review_notes text,
  imported_at               timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_hqr_ref_no          ON historical_quotes_raw(ref_no);
CREATE INDEX IF NOT EXISTS idx_hqr_customer_id     ON historical_quotes_raw(customer_id);
CREATE INDEX IF NOT EXISTS idx_hqr_end_customer_id ON historical_quotes_raw(end_customer_id);
CREATE INDEX IF NOT EXISTS idx_hqr_reviewed        ON historical_quotes_raw(end_customer_reviewed)
  WHERE end_customer_reviewed = false;

ALTER TABLE historical_quotes_raw ENABLE ROW LEVEL SECURITY;

-- SELECT: owner/coordinator/viewer hepsini, sales sadece kendi müşterisine bağlı satırları görür
CREATE POLICY hqr_select ON historical_quotes_raw FOR SELECT
  USING (
    current_setting('app.user_role', TRUE) IN ('owner','coordinator','viewer')
    OR EXISTS (
      SELECT 1 FROM customers c
      WHERE c.id = historical_quotes_raw.customer_id
        AND (
          c.assigned_to::text = current_setting('app.user_id', TRUE)
          OR c.created_by::text = current_setting('app.user_id', TRUE)
        )
    )
  );

CREATE POLICY hqr_insert ON historical_quotes_raw FOR INSERT
  WITH CHECK (current_setting('app.user_role', TRUE) IN ('owner','coordinator'));
CREATE POLICY hqr_update ON historical_quotes_raw FOR UPDATE
  USING (current_setting('app.user_role', TRUE) IN ('owner','coordinator'));
CREATE POLICY hqr_delete ON historical_quotes_raw FOR DELETE
  USING (current_setting('app.user_role', TRUE) IN ('owner','coordinator'));

-- ─────────────────────────────────────────────────────────────────
-- BÖLÜM 6: customers.imported_from_raw_id FK (tablo artık mevcut)
-- ─────────────────────────────────────────────────────────────────
ALTER TABLE customers
  ADD CONSTRAINT fk_customers_raw
  FOREIGN KEY (imported_from_raw_id) REFERENCES historical_quotes_raw(id)
  ON DELETE SET NULL;
