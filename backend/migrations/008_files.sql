-- 008: File attachments
CREATE TABLE IF NOT EXISTS files (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id    UUID REFERENCES customers(id) ON DELETE CASCADE,
  opportunity_id UUID REFERENCES opportunities(id) ON DELETE SET NULL,
  file_name      TEXT NOT NULL,
  file_path      TEXT NOT NULL,
  mime_type      TEXT,
  file_size      INTEGER DEFAULT 0,
  category       TEXT NOT NULL DEFAULT 'general',
  notes          TEXT,
  created_by     UUID NOT NULL REFERENCES users(id),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS files_customer_idx    ON files(customer_id);
CREATE INDEX IF NOT EXISTS files_created_by_idx  ON files(created_by);

ALTER TABLE files ENABLE ROW LEVEL SECURITY;

CREATE POLICY files_select ON files FOR SELECT USING (
  current_setting('app.user_role', TRUE) IN ('owner', 'coordinator', 'viewer')
  OR created_by::TEXT = current_setting('app.user_id', TRUE)
  OR customer_id IN (
    SELECT id FROM customers
    WHERE assigned_to::TEXT = current_setting('app.user_id', TRUE)
  )
);

CREATE POLICY files_insert ON files FOR INSERT WITH CHECK (
  current_setting('app.user_role', TRUE) IN ('owner', 'coordinator', 'sales')
);

CREATE POLICY files_update ON files FOR UPDATE USING (
  current_setting('app.user_role', TRUE) IN ('owner', 'coordinator')
  OR created_by::TEXT = current_setting('app.user_id', TRUE)
);

CREATE POLICY files_delete ON files FOR DELETE USING (
  current_setting('app.user_role', TRUE) IN ('owner', 'coordinator')
  OR created_by::TEXT = current_setting('app.user_id', TRUE)
);

CREATE TRIGGER set_files_updated_at
  BEFORE UPDATE ON files
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
