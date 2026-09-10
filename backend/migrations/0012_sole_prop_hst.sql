-- HST peeled off each deposit, plus a separate annual GST remittance schedule.
ALTER TABLE sole_prop_deposits ADD COLUMN hst_owed REAL NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS sole_prop_gst_remittances (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES company_settings(id),
  tax_year INTEGER NOT NULL,
  due_date TEXT NOT NULL,
  amount REAL NOT NULL DEFAULT 0,
  paid INTEGER NOT NULL DEFAULT 0,
  paid_date TEXT,
  UNIQUE(company_id, tax_year)
);
