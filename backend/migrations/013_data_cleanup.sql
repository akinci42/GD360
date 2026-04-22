-- Migration 013: data_cleanup
-- Adds 'unidentified' status value and data_quality_flag column
-- Required by cleanup_sprint_013 (72 rows: country-name customers, BAKÜ, TEKNOMAK)

BEGIN;

-- 1. Expand status CHECK to allow 'unidentified'
ALTER TABLE customers DROP CONSTRAINT IF EXISTS customers_status_check;
ALTER TABLE customers ADD CONSTRAINT customers_status_check
  CHECK (status IN ('active','passive','blacklisted','unidentified'));

-- 2. Audit column for cleanup traceability
ALTER TABLE customers ADD COLUMN IF NOT EXISTS data_quality_flag text;
COMMENT ON COLUMN customers.data_quality_flag IS
  'cleanup_sprint_013 tag — hangi kategoriden temizlendi (cleanup_013_country_name | cleanup_013_baku | cleanup_013_teknomak_branch)';

COMMIT;
