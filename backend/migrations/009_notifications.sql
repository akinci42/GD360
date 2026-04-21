-- 009: Notifications
CREATE TABLE IF NOT EXISTS notifications (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type         TEXT NOT NULL DEFAULT 'system',
  title        TEXT NOT NULL,
  body         TEXT,
  related_type TEXT,
  related_id   UUID,
  is_read      BOOLEAN NOT NULL DEFAULT FALSE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS notif_user_idx    ON notifications(user_id);
CREATE INDEX IF NOT EXISTS notif_read_idx    ON notifications(user_id, is_read);
CREATE INDEX IF NOT EXISTS notif_created_idx ON notifications(created_at DESC);

ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY notif_select ON notifications FOR SELECT USING (
  user_id::TEXT = current_setting('app.user_id', TRUE)
  OR current_setting('app.user_role', TRUE) IN ('owner', 'coordinator')
);

CREATE POLICY notif_insert ON notifications FOR INSERT WITH CHECK (TRUE);

CREATE POLICY notif_update ON notifications FOR UPDATE USING (
  user_id::TEXT = current_setting('app.user_id', TRUE)
  OR current_setting('app.user_role', TRUE) IN ('owner', 'coordinator')
);

CREATE POLICY notif_delete ON notifications FOR DELETE USING (
  user_id::TEXT = current_setting('app.user_id', TRUE)
  OR current_setting('app.user_role', TRUE) IN ('owner', 'coordinator')
);
