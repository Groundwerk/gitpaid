-- Migration: Encrypted Wise personal-token storage (one token per workspace).
-- The token is AES-GCM encrypted with JWT_SECRET via crypto.ts before storage;
-- it is never stored nor returned in plaintext.
CREATE TABLE IF NOT EXISTS wise_tokens (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL UNIQUE REFERENCES company_settings(id),
  encrypted_token TEXT NOT NULL,
  last4 TEXT NOT NULL,
  label TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
