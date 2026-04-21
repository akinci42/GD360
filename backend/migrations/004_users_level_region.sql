-- Add level and region fields to users
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS level   INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS region  TEXT;
