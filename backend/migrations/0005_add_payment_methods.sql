-- Migration: Add payment_method to employees and payroll_run_employees

-- 1. Add payment_method preference to employees
ALTER TABLE employees ADD COLUMN payment_method TEXT DEFAULT 'e-Transfer';

-- 2. Add individual payment_method override to payroll_run_employees
ALTER TABLE payroll_run_employees ADD COLUMN payment_method TEXT;

-- 3. Populate existing payroll_run_employees records with their parent run's payment method
UPDATE payroll_run_employees 
SET payment_method = (
  SELECT payment_method 
  FROM payroll_runs 
  WHERE payroll_runs.id = payroll_run_employees.run_id
);
