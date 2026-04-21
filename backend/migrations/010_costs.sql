-- 010: Cost centre
CREATE TABLE IF NOT EXISTS cost_categories (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name       TEXT NOT NULL UNIQUE,
  color      TEXT NOT NULL DEFAULT '#6366f1',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO cost_categories (name, color) VALUES
  ('Seyahat & Konaklama', '#f59e0b'),
  ('Fuar & Etkinlik',      '#8b5cf6'),
  ('Pazarlama',            '#ec4899'),
  ('Numune & Test',        '#06b6d4'),
  ('Ofis & Genel',         '#6b7280'),
  ('Diger',                '#9ca3af')
ON CONFLICT (name) DO NOTHING;

CREATE TABLE IF NOT EXISTS costs (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  category_id    UUID REFERENCES cost_categories(id) ON DELETE SET NULL,
  title          TEXT NOT NULL,
  amount         NUMERIC(15,2) NOT NULL,
  currency       TEXT NOT NULL DEFAULT 'USD',
  cost_date      DATE NOT NULL,
  notes          TEXT,
  customer_id    UUID REFERENCES customers(id) ON DELETE SET NULL,
  opportunity_id UUID REFERENCES opportunities(id) ON DELETE SET NULL,
  created_by     UUID NOT NULL REFERENCES users(id),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS costs_date_idx    ON costs(cost_date DESC);
CREATE INDEX IF NOT EXISTS costs_created_idx ON costs(created_by);

ALTER TABLE cost_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE costs           ENABLE ROW LEVEL SECURITY;

CREATE POLICY cost_cats_select ON cost_categories FOR SELECT USING (TRUE);
CREATE POLICY cost_cats_write  ON cost_categories FOR ALL    USING (
  current_setting('app.user_role', TRUE) IN ('owner', 'coordinator')
);

CREATE POLICY costs_select ON costs FOR SELECT USING (
  current_setting('app.user_role', TRUE) IN ('owner', 'coordinator')
);
CREATE POLICY costs_insert ON costs FOR INSERT WITH CHECK (
  current_setting('app.user_role', TRUE) IN ('owner', 'coordinator')
);
CREATE POLICY costs_update ON costs FOR UPDATE USING (
  current_setting('app.user_role', TRUE) IN ('owner', 'coordinator')
);
CREATE POLICY costs_delete ON costs FOR DELETE USING (
  current_setting('app.user_role', TRUE) IN ('owner', 'coordinator')
);

CREATE TRIGGER set_costs_updated_at
  BEFORE UPDATE ON costs
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
