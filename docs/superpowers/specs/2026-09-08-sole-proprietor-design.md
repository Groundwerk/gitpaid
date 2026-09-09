# Sole Proprietor Support — Design (2026-09-08)

Status: approved in brainstorming, pending spec file review.
V1 scope: onboarding account-type split + sole-prop ledger/FX/tax-instalment engine + $30k GST threshold banner. V2 (separate spec): Wise personal-token sync + daily cron; HST/GST collection math.

Terminology: CRA calls sole-prop prepayments **instalments**, not remittances. UI and code use "instalment".

## 1. Data model + onboarding

`company_settings.account_type`: `'company'` (default, existing rows) | `'sole_prop'`. Fixed at signup; one login owns one workspace.

New tables (D1 migrations):

- `sole_prop_profile`: `company_id` UNIQUE FK, `business_number` NULL, `start_date` (YYYY-MM-DD), `province` default `'ON'` (locked V1), `ytd_pensionable_opening`, `ytd_cpp_opening`, `ytd_cpp2_opening`, `instalment_mode` default `'quarterly'`.
- `sole_prop_deposits`: `company_id` FK, `received_date`, `foreign_amount`, `currency` (default `'USD'`), `fx_rate`, `cad_amount`, `tax_owed`, `cpp_owed`, `cpp2_owed`, `note`, `created_at`. Rate + computed fields immutable after save; correcting = void + re-enter (keeps running totals auditable).
- `sole_prop_instalments`: `company_id` FK, `tax_year`, `due_date`, `tax_amount`, `cpp_amount`, `cpp2_amount`, `total_amount`, `paid` (0/1), `paid_date` NULL. Paid rows also mirrored to `remittance_payments` with `type='INSTALMENT'` for reporting consistency.

Onboarding: step-0 picker — "Register a company" vs "Register as sole proprietor". Sole-prop branch collects legal name, optional BN (format-validated, may skip), province locked ON, start date, opening 2026 YTD pensionable/CPP/CPP2 balances (supports the over-max case: engine then owes ~$0 further CPP), and shows the first-year deferral note. Existing payroll onboarding untouched. App/dashboard branch by `account_type`; payroll routes return 404/empty for sole-prop workspaces.

## 2. Tax + instalment engine

New `calculateSolePropObligations()` in backend next to `calculatePayrollDeductions()` (shared `calculateProgressiveTax()` helper). New `solePropTaxTables.ts`: 2026 CRA figures single source (federal + Ontario brackets, CPP rate/ YMPE, CPP2 rate/YAMPE, basic exemptions); 2025 backfill for partial-year starts. Current 2024 tables stay for payroll; sole-prop never reads them.

Per-deposit math: federal + Ontario progressive tax on cumulative CAD net, keyed by the deposit's tax year (2025 vs 2026 tables); CPP at 2x employee rate on pensionable earnings up to YMPE minus opening balances; CPP2 on YMPE→YAMPE band minus opening; EI = 0.
Schedule rule: start calendar year = one annual row due Apr 30 Y+1 (covers the Aug-2026 → Apr-30-2027 case: track running estimate, nothing payable before then). From Jan Y2, auto-generate quarterly rows due Mar 15 / Jun 15 / Sep 15 / Dec 15, each sized from deposits since the previous due date. Backdated deposits recompute all downstream rows with a UI warning.

## 3. Deposits, FX, GST threshold

Manual deposit form: received date, foreign amount + currency (USD default). Backend fetches frankfurter.dev rate for that date (weekend/holiday → last available day), pre-fills, user may override before save; rate + CAD amount stored immutably.

$30k tracker: rolling 4-quarter CAD sum. Crossing with no BN on file raises a blocking dashboard banner with crossing date + 29-day registration deadline countdown; clears only when a BN is saved. V1 tracks the threshold only — no HST collection/remittance math (user does not collect GST/HST).

## 4. Reminders, errors, testing

Dashboard reminder cards per upcoming instalment: due date + tax/CPP/CPP2/total breakdown, "Mark paid" sets paid flag + date (mirrors to `remittance_payments`). Overdue unpaid rows render red. First-year annual row shows "due Apr 30 Y+1 — no quarterly payments required yet".

Errors: frankfurter outage blocks save with explicit retry/override (never silently defaults a rate); BN format-validated; unauthenticated FX/ledger routes rejected; sole-prop/company route isolation enforced server-side, not just UI-hidden.

Tests (earn their place): engine unit tests — bracket boundaries, CPP cap with over-max openings, CPP2 band, first-year-annual vs quarterly schedule incl. Aug-2026→Apr-2027→Sep/Dec-2027 case, $30k rolling window + 29-day math, backdate recompute. One deposit→FX(stubbed)→instalment integration test. No plumbing/forwarding tests.

## Out of scope (V1)

HST filing calculation, Wise token storage/sync/cron + employer-recipient mapping (V2 spec), multi-profile logins, payroll report reuse for sole-prop, non-Ontario provinces, non-quarterly instalment modes.
