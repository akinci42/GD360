-- 014: Dedupe suggestions
--
-- Stores candidate duplicate customer pairs produced by the fuzzy scanner
-- (scripts/dedupe_scanner.py). Owner/coordinator review each pair in the
-- admin dedupe page and either merge (one becomes master, other is removed
-- and its offers/contacts/historical_quotes_raw re-parented) or reject.

CREATE TABLE IF NOT EXISTS dedupe_suggestions (
  id               UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_a_id    UUID          NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  customer_b_id    UUID          NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  similarity_score NUMERIC(5,3)  NOT NULL
                     CHECK (similarity_score >= 0 AND similarity_score <= 1),
  match_reason     TEXT          NOT NULL,
  status           TEXT          NOT NULL DEFAULT 'pending'
                     CHECK (status IN ('pending','merged','rejected','under_review')),
  merged_into_id   UUID          REFERENCES customers(id) ON DELETE SET NULL,
  reviewed_by      UUID          REFERENCES users(id)     ON DELETE SET NULL,
  reviewed_at      TIMESTAMPTZ,
  review_notes     TEXT,
  created_at       TIMESTAMPTZ   NOT NULL DEFAULT now(),

  CONSTRAINT dedupe_distinct_pair CHECK (customer_a_id <> customer_b_id),
  CONSTRAINT dedupe_unique_pair   UNIQUE (customer_a_id, customer_b_id)
);

CREATE INDEX IF NOT EXISTS idx_dedupe_status ON dedupe_suggestions(status);
CREATE INDEX IF NOT EXISTS idx_dedupe_score  ON dedupe_suggestions(similarity_score DESC);
CREATE INDEX IF NOT EXISTS idx_dedupe_a      ON dedupe_suggestions(customer_a_id);
CREATE INDEX IF NOT EXISTS idx_dedupe_b      ON dedupe_suggestions(customer_b_id);

ALTER TABLE dedupe_suggestions ENABLE ROW LEVEL SECURITY;

-- owner/coordinator: full access
-- sales/viewer: SELECT only suggestions involving customers assigned to them
CREATE POLICY dedupe_select ON dedupe_suggestions FOR SELECT USING (
  current_setting('app.user_role', TRUE) IN ('owner', 'coordinator')
  OR customer_a_id IN (
       SELECT id FROM customers
       WHERE assigned_to::TEXT = current_setting('app.user_id', TRUE)
     )
  OR customer_b_id IN (
       SELECT id FROM customers
       WHERE assigned_to::TEXT = current_setting('app.user_id', TRUE)
     )
);

CREATE POLICY dedupe_insert ON dedupe_suggestions FOR INSERT WITH CHECK (
  current_setting('app.user_role', TRUE) IN ('owner', 'coordinator')
);

CREATE POLICY dedupe_update ON dedupe_suggestions FOR UPDATE USING (
  current_setting('app.user_role', TRUE) IN ('owner', 'coordinator')
);

CREATE POLICY dedupe_delete ON dedupe_suggestions FOR DELETE USING (
  current_setting('app.user_role', TRUE) IN ('owner', 'coordinator')
);
