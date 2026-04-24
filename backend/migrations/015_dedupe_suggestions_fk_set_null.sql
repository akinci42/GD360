-- 015: Preserve merged/rejected suggestion history after customer delete
--
-- Migration 014 created dedupe_suggestions with customer_a_id and
-- customer_b_id as NOT NULL + ON DELETE CASCADE. That choice made
-- sense for pending pairs, but the merge flow itself deletes one of
-- the two customers — which cascaded and wiped the suggestion row,
-- erasing the merged-status history we needed for stats and audit.
--
-- Switch both FKs to ON DELETE SET NULL and drop the NOT NULL so that
-- a suggestion row can survive as a historical record after merge or
-- customer cleanup. The merged_into_id still holds the surviving
-- master, and audit_log retains the full snapshot of the deleted row.

ALTER TABLE dedupe_suggestions
  DROP CONSTRAINT dedupe_suggestions_customer_a_id_fkey,
  DROP CONSTRAINT dedupe_suggestions_customer_b_id_fkey;

ALTER TABLE dedupe_suggestions
  ALTER COLUMN customer_a_id DROP NOT NULL,
  ALTER COLUMN customer_b_id DROP NOT NULL;

ALTER TABLE dedupe_suggestions
  ADD CONSTRAINT dedupe_suggestions_customer_a_id_fkey
    FOREIGN KEY (customer_a_id) REFERENCES customers(id) ON DELETE SET NULL,
  ADD CONSTRAINT dedupe_suggestions_customer_b_id_fkey
    FOREIGN KEY (customer_b_id) REFERENCES customers(id) ON DELETE SET NULL;
