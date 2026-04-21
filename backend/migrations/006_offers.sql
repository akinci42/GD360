-- Offers (Teklifler)
CREATE TABLE IF NOT EXISTS offers (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  offer_number   TEXT        NOT NULL UNIQUE,
  customer_id    UUID        NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  opportunity_id UUID        REFERENCES opportunities(id) ON DELETE SET NULL,
  status         TEXT        NOT NULL DEFAULT 'draft'
                   CHECK (status IN ('draft','sent','accepted','rejected','expired')),
  title          TEXT        NOT NULL,
  currency       TEXT        NOT NULL DEFAULT 'USD',
  validity_days  INTEGER     NOT NULL DEFAULT 30,
  notes          TEXT,
  sent_at        TIMESTAMPTZ,
  valid_until    DATE,
  total_amount   NUMERIC(15,2) NOT NULL DEFAULT 0,
  created_by     UUID        NOT NULL REFERENCES users(id),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS offer_items (
  id            UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  offer_id      UUID          NOT NULL REFERENCES offers(id) ON DELETE CASCADE,
  product_name  TEXT          NOT NULL,
  description   TEXT,
  quantity      NUMERIC(10,2) NOT NULL DEFAULT 1,
  unit          TEXT          NOT NULL DEFAULT 'pcs',
  unit_price    NUMERIC(15,2) NOT NULL DEFAULT 0,
  discount_pct  NUMERIC(5,2)  NOT NULL DEFAULT 0,
  line_total    NUMERIC(15,2) GENERATED ALWAYS AS
                  (quantity * unit_price * (1 - discount_pct / 100)) STORED,
  sort_order    INTEGER       NOT NULL DEFAULT 0
);

-- Auto-increment offer number per year: OFR-YYYY-NNN
CREATE OR REPLACE FUNCTION generate_offer_number()
RETURNS TRIGGER AS $$
DECLARE
  v_year TEXT;
  v_seq  INTEGER;
BEGIN
  v_year := to_char(NOW(), 'YYYY');
  SELECT COALESCE(MAX(split_part(offer_number, '-', 3)::INTEGER), 0) + 1
  INTO v_seq
  FROM offers
  WHERE offer_number LIKE 'OFR-' || v_year || '-%';
  NEW.offer_number := 'OFR-' || v_year || '-' || lpad(v_seq::TEXT, 3, '0');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_offer_number
  BEFORE INSERT ON offers
  FOR EACH ROW EXECUTE FUNCTION generate_offer_number();

-- Recalculate offer total when items change
CREATE OR REPLACE FUNCTION sync_offer_total()
RETURNS TRIGGER AS $$
DECLARE
  v_offer_id UUID;
BEGIN
  v_offer_id := COALESCE(NEW.offer_id, OLD.offer_id);
  UPDATE offers
  SET total_amount = (
        SELECT COALESCE(SUM(line_total), 0)
        FROM offer_items
        WHERE offer_id = v_offer_id
      ),
      updated_at = NOW()
  WHERE id = v_offer_id;
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_offer_items_total
  AFTER INSERT OR UPDATE OR DELETE ON offer_items
  FOR EACH ROW EXECUTE FUNCTION sync_offer_total();

-- Updated-at trigger for offers
CREATE TRIGGER offers_updated_at
  BEFORE UPDATE ON offers
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Indexes
CREATE INDEX idx_offers_customer    ON offers(customer_id);
CREATE INDEX idx_offers_status      ON offers(status);
CREATE INDEX idx_offers_created_by  ON offers(created_by);
CREATE INDEX idx_offer_items_offer  ON offer_items(offer_id);

-- RLS
ALTER TABLE offers      ENABLE ROW LEVEL SECURITY;
ALTER TABLE offer_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY offers_select ON offers FOR SELECT
  USING (
    current_setting('app.user_role', TRUE) IN ('owner','coordinator','viewer')
    OR created_by::TEXT = current_setting('app.user_id', TRUE)
    OR customer_id IN (
      SELECT id FROM customers
      WHERE assigned_to::TEXT = current_setting('app.user_id', TRUE)
    )
  );

CREATE POLICY offers_insert ON offers FOR INSERT
  WITH CHECK (
    current_setting('app.user_role', TRUE) IN ('owner','coordinator','sales')
    AND created_by::TEXT = current_setting('app.user_id', TRUE)
  );

CREATE POLICY offers_update ON offers FOR UPDATE
  USING (
    current_setting('app.user_role', TRUE) IN ('owner','coordinator')
    OR created_by::TEXT = current_setting('app.user_id', TRUE)
  );

CREATE POLICY offers_delete ON offers FOR DELETE
  USING (current_setting('app.user_role', TRUE) IN ('owner','coordinator'));

-- offer_items inherit access via parent offer
CREATE POLICY offer_items_all ON offer_items FOR ALL
  USING (
    offer_id IN (SELECT id FROM offers)
  )
  WITH CHECK (
    offer_id IN (SELECT id FROM offers)
  );
