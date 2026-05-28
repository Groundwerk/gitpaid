-- Migration: Add company branding customization fields
-- logo_url: Base64 data URL or external URL for the company logo
-- brand_color: Hex color code (e.g. #001e40) for portal accent/primary color
-- use_company_branding: 1 = replace "Gitpaid" with company name in sidebar and report footers
ALTER TABLE company_settings ADD COLUMN logo_url TEXT;
ALTER TABLE company_settings ADD COLUMN brand_color TEXT;
ALTER TABLE company_settings ADD COLUMN use_company_branding INTEGER DEFAULT 0;
