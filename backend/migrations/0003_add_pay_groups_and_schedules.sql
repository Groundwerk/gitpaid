-- Migration: Add pay groups and pay schedules support

-- 1. Create pay_groups table
CREATE TABLE IF NOT EXISTS pay_groups (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES company_settings(id),
  name TEXT NOT NULL,
  pay_frequency TEXT NOT NULL
);

-- 2. Create pay_schedules table
CREATE TABLE IF NOT EXISTS pay_schedules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  pay_group_id INTEGER NOT NULL REFERENCES pay_groups(id) ON DELETE CASCADE,
  period_start TEXT NOT NULL,
  period_end TEXT NOT NULL,
  payment_date TEXT NOT NULL,
  status TEXT DEFAULT 'open'
);

-- 3. Add pay_group_id to employees
ALTER TABLE employees ADD COLUMN pay_group_id INTEGER REFERENCES pay_groups(id) ON DELETE SET NULL;

-- 4. Add pay_schedule_id and pay_group_id to payroll_runs
ALTER TABLE payroll_runs ADD COLUMN pay_schedule_id INTEGER REFERENCES pay_schedules(id) ON DELETE SET NULL;
ALTER TABLE payroll_runs ADD COLUMN pay_group_id INTEGER REFERENCES pay_groups(id) ON DELETE SET NULL;

-- 5. Seed default pay groups for all existing companies
INSERT INTO pay_groups (company_id, name, pay_frequency)
SELECT id, 'Default Weekly Group', 'weekly' FROM company_settings;

INSERT INTO pay_groups (company_id, name, pay_frequency)
SELECT id, 'Default Bi-Weekly Group', 'bi-weekly' FROM company_settings;

INSERT INTO pay_groups (company_id, name, pay_frequency)
SELECT id, 'Default Semi-Monthly Group', 'semi-monthly' FROM company_settings;

INSERT INTO pay_groups (company_id, name, pay_frequency)
SELECT id, 'Default Monthly Group', 'monthly' FROM company_settings;

-- 6. Map existing employees to their default groups based on current pay_interval
UPDATE employees
SET pay_group_id = (
  SELECT id FROM pay_groups 
  WHERE pay_groups.company_id = employees.company_id 
    AND pay_groups.pay_frequency = employees.pay_interval
)
WHERE pay_interval IN ('weekly', 'bi-weekly', 'semi-monthly', 'monthly');

-- For employees with 'company' or NULL pay_interval, map to the company settings' pay_period group
UPDATE employees
SET pay_group_id = (
  SELECT pg.id FROM pay_groups pg
  JOIN company_settings cs ON pg.company_id = cs.id
  WHERE pg.company_id = employees.company_id 
    AND pg.pay_frequency = cs.pay_period
)
WHERE pay_interval = 'company' OR pay_interval IS NULL;
