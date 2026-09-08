-- Migration: Wise auto-sync support
ALTER TABLE sole_prop_deposits ADD COLUMN wise_transfer_id TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_sole_deposits_wise_key
  ON sole_prop_deposits(company_id, wise_transfer_id);

ALTER TABLE wise_tokens ADD COLUMN auto_sync INTEGER NOT NULL DEFAULT 0;
ALTER TABLE wise_tokens ADD COLUMN employer_key TEXT;
ALTER TABLE wise_tokens ADD COLUMN employer_label TEXT;
ALTER TABLE wise_tokens ADD COLUMN last_sync_at TEXT;
ALTER TABLE wise_tokens ADD COLUMN profile_id INTEGER;
ALTER TABLE wise_tokens ADD COLUMN balance_id INTEGER;
