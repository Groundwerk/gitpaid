-- D1 Migration DDL Schema

-- 1. Company Settings
CREATE TABLE IF NOT EXISTS company_settings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  legal_name TEXT NOT NULL,
  operating_name TEXT,
  business_number TEXT NOT NULL,
  address_line1 TEXT,
  city TEXT,
  postal_code TEXT,
  contact_name TEXT,
  contact_email TEXT,
  wsib_number TEXT,
  wsib_rate REAL DEFAULT 2.5,
  eht_exempt INTEGER DEFAULT 1,
  eht_rate REAL DEFAULT 1.95,
  vacation_rate REAL DEFAULT 4.0,
  pay_period TEXT DEFAULT 'bi-weekly'
);

-- 2. Users linked to Company Settings
CREATE TABLE IF NOT EXISTS users (
  email TEXT PRIMARY KEY,
  name TEXT,
  avatar TEXT,
  company_id INTEGER REFERENCES company_settings(id)
);

-- 3. Employees
CREATE TABLE IF NOT EXISTS employees (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES company_settings(id),
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  email TEXT NOT NULL,
  role TEXT,
  department TEXT,
  pay_type TEXT NOT NULL,
  rate REAL NOT NULL,
  status TEXT DEFAULT 'active',
  cpp_exempt INTEGER DEFAULT 0,
  ei_exempt INTEGER DEFAULT 0,
  tax_exempt INTEGER DEFAULT 0,
  avatar TEXT,
  ytd_gross REAL DEFAULT 0,
  ytd_net REAL DEFAULT 0,
  ytd_cpp REAL DEFAULT 0,
  ytd_ei REAL DEFAULT 0,
  ytd_tax REAL DEFAULT 0,
  ytd_wsib REAL DEFAULT 0,
  ytd_eht REAL DEFAULT 0,
  ytd_vacation_accrued REAL DEFAULT 0,
  ytd_vacation_paid REAL DEFAULT 0
);

-- 4. Payroll Runs
CREATE TABLE IF NOT EXISTS payroll_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES company_settings(id),
  run_date TEXT NOT NULL,
  period_start TEXT NOT NULL,
  period_end TEXT NOT NULL,
  total_gross REAL NOT NULL,
  total_net REAL NOT NULL,
  total_cpp_employee REAL NOT NULL,
  total_cpp_employer REAL NOT NULL,
  total_ei_employee REAL NOT NULL,
  total_ei_employer REAL NOT NULL,
  total_tax REAL NOT NULL,
  total_wsib REAL NOT NULL,
  total_eht REAL NOT NULL,
  total_vacation_accrued REAL NOT NULL,
  payment_method TEXT NOT NULL,
  status TEXT DEFAULT 'paid'
);

-- 5. Payroll Run Employees
CREATE TABLE IF NOT EXISTS payroll_run_employees (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id INTEGER NOT NULL REFERENCES payroll_runs(id) ON DELETE CASCADE,
  employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  gross_pay REAL NOT NULL,
  net_pay REAL NOT NULL,
  cpp_employee REAL NOT NULL,
  cpp_employer REAL NOT NULL,
  ei_employee REAL NOT NULL,
  ei_employer REAL NOT NULL,
  tax REAL NOT NULL,
  wsib_premium REAL NOT NULL,
  eht_premium REAL NOT NULL,
  vacation_accrued REAL NOT NULL,
  vacation_paid REAL NOT NULL,
  hours_worked REAL DEFAULT 0
);
