-- Customers table
CREATE TABLE IF NOT EXISTS customers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_name TEXT NOT NULL,
  country TEXT,
  city TEXT,
  industry TEXT,
  website TEXT,
  notes TEXT,
  assigned_to UUID REFERENCES users(id) ON DELETE SET NULL,
  created_by UUID NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER customers_updated_at
  BEFORE UPDATE ON customers
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX idx_customers_assigned_to ON customers(assigned_to);
CREATE INDEX idx_customers_created_by ON customers(created_by);
CREATE INDEX idx_customers_company_name ON customers(company_name);

ALTER TABLE customers ENABLE ROW LEVEL SECURITY;

-- owner + coordinator see all; sales see assigned or own; viewer sees all (read)
CREATE POLICY customers_select ON customers
  FOR SELECT
  USING (
    current_setting('app.user_role', TRUE) IN ('owner', 'coordinator', 'viewer')
    OR assigned_to::TEXT = current_setting('app.user_id', TRUE)
    OR created_by::TEXT = current_setting('app.user_id', TRUE)
  );

CREATE POLICY customers_insert ON customers
  FOR INSERT
  WITH CHECK (
    current_setting('app.user_role', TRUE) IN ('owner', 'coordinator', 'sales')
    AND created_by::TEXT = current_setting('app.user_id', TRUE)
  );

CREATE POLICY customers_update ON customers
  FOR UPDATE
  USING (
    current_setting('app.user_role', TRUE) IN ('owner', 'coordinator')
    OR (
      current_setting('app.user_role', TRUE) = 'sales'
      AND (
        assigned_to::TEXT = current_setting('app.user_id', TRUE)
        OR created_by::TEXT = current_setting('app.user_id', TRUE)
      )
    )
  );

CREATE POLICY customers_delete ON customers
  FOR DELETE
  USING (current_setting('app.user_role', TRUE) IN ('owner', 'coordinator'));

-- Customer contacts table
CREATE TABLE IF NOT EXISTS customer_contacts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  full_name TEXT NOT NULL,
  title TEXT,
  email TEXT,
  phone TEXT,
  is_primary BOOLEAN NOT NULL DEFAULT FALSE,
  notes TEXT,
  created_by UUID NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER customer_contacts_updated_at
  BEFORE UPDATE ON customer_contacts
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX idx_contacts_customer ON customer_contacts(customer_id);

ALTER TABLE customer_contacts ENABLE ROW LEVEL SECURITY;

-- Contacts inherit visibility from their customer
CREATE POLICY contacts_select ON customer_contacts
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM customers c WHERE c.id = customer_id
      AND (
        current_setting('app.user_role', TRUE) IN ('owner', 'coordinator', 'viewer')
        OR c.assigned_to::TEXT = current_setting('app.user_id', TRUE)
        OR c.created_by::TEXT = current_setting('app.user_id', TRUE)
      )
    )
  );

CREATE POLICY contacts_insert ON customer_contacts
  FOR INSERT
  WITH CHECK (
    current_setting('app.user_role', TRUE) IN ('owner', 'coordinator', 'sales')
    AND created_by::TEXT = current_setting('app.user_id', TRUE)
  );

CREATE POLICY contacts_update ON customer_contacts
  FOR UPDATE
  USING (
    current_setting('app.user_role', TRUE) IN ('owner', 'coordinator')
    OR created_by::TEXT = current_setting('app.user_id', TRUE)
  );

CREATE POLICY contacts_delete ON customer_contacts
  FOR DELETE
  USING (current_setting('app.user_role', TRUE) IN ('owner', 'coordinator'));
