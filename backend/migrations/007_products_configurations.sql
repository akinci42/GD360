-- Product catalog
CREATE TABLE IF NOT EXISTS products (
  id          UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT          NOT NULL,
  sku         TEXT          UNIQUE,
  category    TEXT,
  description TEXT,
  base_price  NUMERIC(15,2) NOT NULL DEFAULT 0,
  currency    TEXT          NOT NULL DEFAULT 'USD',
  unit        TEXT          NOT NULL DEFAULT 'pcs',
  specs       JSONB         NOT NULL DEFAULT '{}',
  is_active   BOOLEAN       NOT NULL DEFAULT TRUE,
  created_by  UUID          NOT NULL REFERENCES users(id),
  created_at  TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE TRIGGER products_updated_at
  BEFORE UPDATE ON products
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX idx_products_category   ON products(category);
CREATE INDEX idx_products_is_active  ON products(is_active);

-- Configurations (saved configurator baskets)
CREATE TABLE IF NOT EXISTS configurations (
  id             UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  name           TEXT          NOT NULL,
  customer_id    UUID          REFERENCES customers(id) ON DELETE SET NULL,
  opportunity_id UUID          REFERENCES opportunities(id) ON DELETE SET NULL,
  notes          TEXT,
  total_price    NUMERIC(15,2) NOT NULL DEFAULT 0,
  currency       TEXT          NOT NULL DEFAULT 'USD',
  created_by     UUID          NOT NULL REFERENCES users(id),
  created_at     TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS configuration_items (
  id               UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  configuration_id UUID          NOT NULL REFERENCES configurations(id) ON DELETE CASCADE,
  product_id       UUID          NOT NULL REFERENCES products(id),
  quantity         NUMERIC(10,2) NOT NULL DEFAULT 1,
  unit_price       NUMERIC(15,2) NOT NULL DEFAULT 0,
  specs            JSONB         NOT NULL DEFAULT '{}',
  notes            TEXT,
  sort_order       INTEGER       NOT NULL DEFAULT 0
);

CREATE TRIGGER configurations_updated_at
  BEFORE UPDATE ON configurations
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX idx_configurations_customer    ON configurations(customer_id);
CREATE INDEX idx_configurations_created_by  ON configurations(created_by);
CREATE INDEX idx_config_items_config        ON configuration_items(configuration_id);
CREATE INDEX idx_config_items_product       ON configuration_items(product_id);

-- RLS: products readable by all, writable by owner/coordinator
ALTER TABLE products           ENABLE ROW LEVEL SECURITY;
ALTER TABLE configurations     ENABLE ROW LEVEL SECURITY;
ALTER TABLE configuration_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY products_select ON products FOR SELECT USING (TRUE);

CREATE POLICY products_write ON products FOR ALL
  USING (current_setting('app.user_role', TRUE) IN ('owner','coordinator'))
  WITH CHECK (current_setting('app.user_role', TRUE) IN ('owner','coordinator'));

CREATE POLICY configurations_select ON configurations FOR SELECT
  USING (
    current_setting('app.user_role', TRUE) IN ('owner','coordinator','viewer')
    OR created_by::TEXT = current_setting('app.user_id', TRUE)
  );

CREATE POLICY configurations_insert ON configurations FOR INSERT
  WITH CHECK (
    current_setting('app.user_role', TRUE) IN ('owner','coordinator','sales')
    AND created_by::TEXT = current_setting('app.user_id', TRUE)
  );

CREATE POLICY configurations_update ON configurations FOR UPDATE
  USING (
    current_setting('app.user_role', TRUE) IN ('owner','coordinator')
    OR created_by::TEXT = current_setting('app.user_id', TRUE)
  );

CREATE POLICY configurations_delete ON configurations FOR DELETE
  USING (
    current_setting('app.user_role', TRUE) IN ('owner','coordinator')
    OR created_by::TEXT = current_setting('app.user_id', TRUE)
  );

CREATE POLICY config_items_all ON configuration_items FOR ALL
  USING (
    configuration_id IN (SELECT id FROM configurations)
  )
  WITH CHECK (
    configuration_id IN (SELECT id FROM configurations)
  );
