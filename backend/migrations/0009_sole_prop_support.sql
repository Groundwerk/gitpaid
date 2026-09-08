-- Migration: Sole proprietor workspace support
ALTER TABLE company_settings ADD COLUMN account_type TEXT NOT NULL DEFAULT 'company';

CREATE TABLE IF NOT EXISTS sole_prop_profile (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL UNIQUE REFERENCES company_settings(id),
  business_number TEXT,
  start_date TEXT NOT NULL,
  province TEXT NOT NULL DEFAULT 'ON',
  ytd_pensionable_opening REAL NOT NULL DEFAULT 0,
  ytd_cpp_opening REAL NOT NULL DEFAULT 0,
  ytd_cpp2_opening REAL NOT NULL DEFAULT 0,
  instalment_mode TEXT NOT NULL DEFAULT 'quarterly'
);

CREATE TABLE IF NOT EXISTS sole_prop_deposits (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES company_settings(id),
  received_date TEXT NOT NULL,
  foreign_amount REAL NOT NULL,
  currency TEXT NOT NULL DEFAULT 'USD',
  fx_rate REAL NOT NULL,
  fx_date_used TEXT NOT NULL,
  cad_amount REAL NOT NULL,
  tax_owed REAL NOT NULL DEFAULT 0,
  cpp_owed REAL NOT NULL DEFAULT 0,
  cpp2_owed REAL NOT NULL DEFAULT 0,
  note TEXT,
  voided INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_sole_deposits_company_date
  ON sole_prop_deposits(company_id, received_date);

CREATE TABLE IF NOT EXISTS sole_prop_instalments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES company_settings(id),
  tax_year INTEGER NOT NULL,
  due_date TEXT NOT NULL,
  kind TEXT NOT NULL,
  tax_amount REAL NOT NULL DEFAULT 0,
  cpp_amount REAL NOT NULL DEFAULT 0,
  cpp2_amount REAL NOT NULL DEFAULT 0,
  total_amount REAL NOT NULL DEFAULT 0,
  paid INTEGER NOT NULL DEFAULT 0,
  paid_date TEXT,
  UNIQUE(company_id, due_date)
);
