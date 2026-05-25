-- Migration: Add new employee and company settings fields

-- 1. Alter company_settings
ALTER TABLE company_settings ADD COLUMN owner_sin TEXT;
ALTER TABLE company_settings ADD COLUMN business_type TEXT;
ALTER TABLE company_settings ADD COLUMN remittance_frequency TEXT DEFAULT 'monthly';
ALTER TABLE company_settings ADD COLUMN contact_phone TEXT;
ALTER TABLE company_settings ADD COLUMN address_line2 TEXT;
ALTER TABLE company_settings ADD COLUMN province TEXT DEFAULT 'ON';
ALTER TABLE company_settings ADD COLUMN override_ei_employer_rate REAL DEFAULT 1.4;

-- 2. Alter employees
ALTER TABLE employees ADD COLUMN pay_interval TEXT DEFAULT 'company';
ALTER TABLE employees ADD COLUMN sin TEXT;
ALTER TABLE employees ADD COLUMN start_date TEXT;
ALTER TABLE employees ADD COLUMN fit_exempt INTEGER DEFAULT 0;
ALTER TABLE employees ADD COLUMN fit_withholding_amount REAL DEFAULT 0.0;
ALTER TABLE employees ADD COLUMN override_fed_tax_credit INTEGER DEFAULT 0;
ALTER TABLE employees ADD COLUMN fed_tax_credit_amount REAL DEFAULT 15705.0;
ALTER TABLE employees ADD COLUMN override_prov_tax_credit INTEGER DEFAULT 0;
ALTER TABLE employees ADD COLUMN prov_tax_credit_amount REAL DEFAULT 12399.0;
ALTER TABLE employees ADD COLUMN wcb_exempt INTEGER DEFAULT 0;
ALTER TABLE employees ADD COLUMN wcb_rate REAL DEFAULT 0.0;
