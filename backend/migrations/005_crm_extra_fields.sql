-- Extra fields for customers
ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS channel_type TEXT CHECK (channel_type IN ('distributor','direct','broker','office')),
  ADD COLUMN IF NOT EXISTS phone       TEXT,
  ADD COLUMN IF NOT EXISTS tax_number  TEXT,
  ADD COLUMN IF NOT EXISTS address     TEXT;

-- Extra fields for customer_contacts
ALTER TABLE customer_contacts
  ADD COLUMN IF NOT EXISTS whatsapp TEXT,
  ADD COLUMN IF NOT EXISTS language TEXT;

CREATE INDEX IF NOT EXISTS idx_customers_channel ON customers(channel_type);
CREATE INDEX IF NOT EXISTS idx_customers_country  ON customers(country);
