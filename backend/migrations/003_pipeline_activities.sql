-- Pipeline opportunities (Sales Radar)
CREATE TABLE IF NOT EXISTS opportunities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  contact_id UUID REFERENCES customer_contacts(id) ON DELETE SET NULL,
  stage TEXT NOT NULL DEFAULT 'lead'
    CHECK (stage IN ('lead','qualified','proposal','negotiation','won','lost','on_hold')),
  value NUMERIC(14,2),
  currency TEXT NOT NULL DEFAULT 'USD',
  probability INTEGER CHECK (probability BETWEEN 0 AND 100),
  expected_close_date DATE,
  lost_reason TEXT,
  notes TEXT,
  assigned_to UUID REFERENCES users(id) ON DELETE SET NULL,
  created_by UUID NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER opportunities_updated_at
  BEFORE UPDATE ON opportunities
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX idx_opp_customer ON opportunities(customer_id);
CREATE INDEX idx_opp_stage ON opportunities(stage);
CREATE INDEX idx_opp_assigned ON opportunities(assigned_to);
CREATE INDEX idx_opp_created_by ON opportunities(created_by);

ALTER TABLE opportunities ENABLE ROW LEVEL SECURITY;

CREATE POLICY opp_select ON opportunities
  FOR SELECT
  USING (
    current_setting('app.user_role', TRUE) IN ('owner', 'coordinator', 'viewer')
    OR assigned_to::TEXT = current_setting('app.user_id', TRUE)
    OR created_by::TEXT = current_setting('app.user_id', TRUE)
  );

CREATE POLICY opp_insert ON opportunities
  FOR INSERT
  WITH CHECK (
    current_setting('app.user_role', TRUE) IN ('owner', 'coordinator', 'sales')
    AND created_by::TEXT = current_setting('app.user_id', TRUE)
  );

CREATE POLICY opp_update ON opportunities
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

CREATE POLICY opp_delete ON opportunities
  FOR DELETE
  USING (current_setting('app.user_role', TRUE) IN ('owner', 'coordinator'));

-- Stage history log (immutable audit trail)
CREATE TABLE IF NOT EXISTS opportunity_stage_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  opportunity_id UUID NOT NULL REFERENCES opportunities(id) ON DELETE CASCADE,
  from_stage TEXT,
  to_stage TEXT NOT NULL,
  changed_by UUID NOT NULL REFERENCES users(id),
  changed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  notes TEXT
);

CREATE INDEX idx_stage_log_opp ON opportunity_stage_log(opportunity_id);

-- Follow-ups / Activities with 48-hour lock mechanism
CREATE TABLE IF NOT EXISTS followups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  opportunity_id UUID REFERENCES opportunities(id) ON DELETE CASCADE,
  customer_id UUID REFERENCES customers(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('call','email','meeting','demo','site_visit','other')),
  subject TEXT NOT NULL,
  notes TEXT,
  scheduled_at TIMESTAMPTZ NOT NULL,
  completed_at TIMESTAMPTZ,
  -- 48-hour lock: only the assigned user can edit within 48h of creation
  locked_by UUID REFERENCES users(id) ON DELETE SET NULL,
  locked_until TIMESTAMPTZ,
  assigned_to UUID REFERENCES users(id) ON DELETE SET NULL,
  created_by UUID NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT check_customer_or_opportunity CHECK (
    customer_id IS NOT NULL OR opportunity_id IS NOT NULL
  )
);

CREATE TRIGGER followups_updated_at
  BEFORE UPDATE ON followups
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX idx_followups_opp ON followups(opportunity_id);
CREATE INDEX idx_followups_customer ON followups(customer_id);
CREATE INDEX idx_followups_assigned ON followups(assigned_to);
CREATE INDEX idx_followups_scheduled ON followups(scheduled_at);
CREATE INDEX idx_followups_locked_until ON followups(locked_until);

ALTER TABLE followups ENABLE ROW LEVEL SECURITY;

CREATE POLICY followups_select ON followups
  FOR SELECT
  USING (
    current_setting('app.user_role', TRUE) IN ('owner', 'coordinator', 'viewer')
    OR assigned_to::TEXT = current_setting('app.user_id', TRUE)
    OR created_by::TEXT = current_setting('app.user_id', TRUE)
  );

CREATE POLICY followups_insert ON followups
  FOR INSERT
  WITH CHECK (
    current_setting('app.user_role', TRUE) IN ('owner', 'coordinator', 'sales')
    AND created_by::TEXT = current_setting('app.user_id', TRUE)
  );

-- Sales can only edit if lock is expired OR they hold the lock
CREATE POLICY followups_update ON followups
  FOR UPDATE
  USING (
    current_setting('app.user_role', TRUE) IN ('owner', 'coordinator')
    OR (
      current_setting('app.user_role', TRUE) = 'sales'
      AND (
        locked_until IS NULL
        OR locked_until < NOW()
        OR locked_by::TEXT = current_setting('app.user_id', TRUE)
      )
      AND (
        assigned_to::TEXT = current_setting('app.user_id', TRUE)
        OR created_by::TEXT = current_setting('app.user_id', TRUE)
      )
    )
  );

CREATE POLICY followups_delete ON followups
  FOR DELETE
  USING (current_setting('app.user_role', TRUE) IN ('owner', 'coordinator'));
