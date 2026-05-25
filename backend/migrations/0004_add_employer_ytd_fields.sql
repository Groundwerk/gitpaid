-- Migration: Add employer YTD CPP and EI fields to employees
ALTER TABLE employees ADD COLUMN ytd_cpp_employer REAL DEFAULT 0.0;
ALTER TABLE employees ADD COLUMN ytd_ei_employer REAL DEFAULT 0.0;

-- Initialize existing records to match the 1.0x and 1.4x standard rates based on their current employee YTD values
UPDATE employees SET ytd_cpp_employer = ytd_cpp;
UPDATE employees SET ytd_ei_employer = ROUND(ytd_ei * 1.4, 2);
