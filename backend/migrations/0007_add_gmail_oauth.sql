-- Migration: Add gmail_refresh_token and gmail_email columns to company_settings for automated Gmail OAuth flow
ALTER TABLE company_settings ADD COLUMN gmail_refresh_token TEXT;
ALTER TABLE company_settings ADD COLUMN gmail_email TEXT;
