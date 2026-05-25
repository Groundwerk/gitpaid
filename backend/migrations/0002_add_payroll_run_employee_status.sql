-- Migration: Add status column to payroll_run_employees
ALTER TABLE payroll_run_employees ADD COLUMN status TEXT DEFAULT 'paid';
