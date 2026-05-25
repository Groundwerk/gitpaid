-- Migration: Add remittance_payments table to log tax agency compliance payments

CREATE TABLE IF NOT EXISTS remittance_payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES company_settings(id),
  type TEXT NOT NULL, -- 'CRA', 'WSIB', 'EHT'
  payment_date TEXT NOT NULL, -- YYYY-MM-DD
  amount REAL NOT NULL,
  period_end TEXT NOT NULL -- YYYY-MM-DD (covers period ending on this date)
);
