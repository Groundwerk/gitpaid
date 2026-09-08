# Sole Proprietor Support Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a fixed-at-onboarding "sole proprietor" workspace to Gitpaid with manual USD deposits, frankfurter.dev FX, 2025/2026 CRA tax + CPP/CPP2 instalment engine, CRA quarterly schedule, $30k GST threshold banner, and mark-paid reminders.

**Architecture:** New `account_type` column on `company_settings` plus three dedicated tables (`sole_prop_profile`, `sole_prop_deposits`, `sole_prop_instalments`); new `soleprop` Hono router reusing the JWT `companyId` pattern; pure-function engine beside `taxEngine.ts`; frontend branches on `settings.account_type`. Payroll tables and routes untouched.

**Tech Stack:** Hono + Cloudflare D1 (backend, vitest), React + Vite + Tailwind (frontend, vitest + testing-library), frankfurter.dev FX API.

**Spec:** `docs/superpowers/specs/2026-09-08-sole-proprietor-design.md`

## Global Constraints

- All SQL via D1 migrations in `backend/migrations/`, numbered sequentially (`0009_...` next); apply locally with `npm run db:migrate:local` from the `gitpaid/` root.
- Backend tests: vitest (`npm --prefix backend test` full suite, `npx vitest run <file>` single file from `gitpaid/backend/`).
- Frontend tests: vitest (`npx vitest run <file>` from `gitpaid/frontend/`); build check `npm --prefix frontend run build`.
- Money rounded to 2 decimals at every engine output (`Math.round(x * 100) / 100`), mirroring `taxEngine.ts`.
- Dates as `YYYY-MM-DD` strings, parsed as UTC (mirror `payroll.ts` `parseDate` using `Date.UTC`).
- UI copy uses CRA term "instalment", never "remittance", for sole-prop surfaces.
- All sole-prop figures labeled "estimate" in UI (engine uses max federal BPA, ignores Ontario surtax/health premium).
- Existing payroll behavior byte-for-byte unchanged; 2024 brackets in `taxEngine.ts` never referenced by sole-prop code.

---

## File Map

| File | Responsibility |
|---|---|
| `backend/migrations/0009_sole_prop_support.sql` (create) | `account_type` column + 3 new tables + index |
| `backend/src/services/solePropTaxTables.ts` (create) | Verified 2025/2026 CRA figures, `tablesForYear()` |
| `backend/src/services/solePropEngine.ts` (create) | `calculateSolePropObligations()`, `buildInstalmentSchedule()`, `allocateToInstalments()`, `gstStatus()` |
| `backend/src/services/solePropEngine.test.ts` (create) | Engine + schedule + allocation + GST unit tests |
| `backend/src/routes/soleprop.ts` (create) | 6 endpoints + frankfurter fetch + `requireSoleProp` guard |
| `backend/src/routes/soleprop.test.ts` (create) | Route tests with stubbed `fetch` and in-memory D1 mock |
| `backend/src/routes/settings.ts` (modify) | Accept `account_type`; sole-prop onboarding branch |
| `backend/src/index.ts` (modify) | Mount soleprop router at `/api/soleprop` |
| `frontend/src/types.ts` (modify) | `account_type` + 3 new interfaces |
| `frontend/src/utils/api.ts` (modify) | 6 sole-prop client methods |
| `frontend/src/views/OnboardingView.tsx` (modify) | Step-0 picker + sole-prop branch + submit |
| `frontend/src/views/SolePropDashboardView.tsx` (create) | Ledger dashboard: banner, totals, deposit form/list, instalment cards |
| `frontend/src/views/SolePropDashboardView.test.tsx` (create) | Banner + mark-paid interaction test |
| `frontend/src/App.tsx` (modify) | `accountType` state, branched render + titles |
| `frontend/src/components/Sidebar.tsx` (modify) | `accountType` prop, conditional nav items |

---

### Task 1: Database migration

**Files:**
- Create: `backend/migrations/0009_sole_prop_support.sql`
- Test: local D1 + `sqlite3` schema inspection (no vitest file; verification is the migration run itself)

**Interfaces:**
- Consumes: existing `company_settings(id)` PK, `remittance_payments` table (for later mirroring).
- Produces: `company_settings.account_type`, `sole_prop_profile`, `sole_prop_deposits`, `sole_prop_instalments` for Tasks 4–6.

- [ ] **Step 1: Write the migration**

```sql
-- Migration: Sole proprietor workspace support
ALTER TABLE company_settings ADD COLUMN account_type TEXT NOT NULL DEFAULT 'company';

CREATE TABLE IF NOT EXISTS sole_prop_profile (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL UNIQUE REFERENCES company_settings(id),
  business_number TEXT,
  start_date TEXT NOT NULL,
  province TEXT NOT NULL DEFAULT 'ON',
  ytd_pensionable_opening REAL NOT NULL DEFAULT 0,
  ytd_cpp_opening REAL NOT NULL DEFAULT 0,
  ytd_cpp2_opening REAL NOT NULL DEFAULT 0,
  instalment_mode TEXT NOT NULL DEFAULT 'quarterly'
);

CREATE TABLE IF NOT EXISTS sole_prop_deposits (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES company_settings(id),
  received_date TEXT NOT NULL,
  foreign_amount REAL NOT NULL,
  currency TEXT NOT NULL DEFAULT 'USD',
  fx_rate REAL NOT NULL,
  fx_date_used TEXT NOT NULL,
  cad_amount REAL NOT NULL,
  tax_owed REAL NOT NULL DEFAULT 0,
  cpp_owed REAL NOT NULL DEFAULT 0,
  cpp2_owed REAL NOT NULL DEFAULT 0,
  note TEXT,
  voided INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_sole_deposits_company_date
  ON sole_prop_deposits(company_id, received_date);

CREATE TABLE IF NOT EXISTS sole_prop_instalments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES company_settings(id),
  tax_year INTEGER NOT NULL,
  due_date TEXT NOT NULL,
  kind TEXT NOT NULL,
  tax_amount REAL NOT NULL DEFAULT 0,
  cpp_amount REAL NOT NULL DEFAULT 0,
  cpp2_amount REAL NOT NULL DEFAULT 0,
  total_amount REAL NOT NULL DEFAULT 0,
  paid INTEGER NOT NULL DEFAULT 0,
  paid_date TEXT,
  UNIQUE(company_id, due_date)
);
```

- [ ] **Step 2: Apply locally and verify**

```bash
npm run db:migrate:local
```

Then confirm the objects exist (run from `gitpaid/`):

```bash
npx wrangler d1 execute DB --local --command "SELECT name FROM sqlite_master WHERE name LIKE 'sole_prop%' OR (name='company_settings');"
```

Expected: rows `company_settings`, `sole_prop_profile`, `sole_prop_deposits`, `sole_prop_instalments`, plus the auto index `sqlite_autoindex_sole_prop_instalments_1`.

```bash
npx wrangler d1 execute DB --local --command "PRAGMA table_info(company_settings);" | grep account_type
```

Expected: a line containing `account_type`.

- [ ] **Step 3: Commit**

```bash
git add backend/migrations/0009_sole_prop_support.sql
git commit -m "feat: add sole-prop tables and account_type migration"
```

---

### Task 2: Tax tables + obligation engine

**Files:**
- Create: `backend/src/services/solePropTaxTables.ts`
- Create: `backend/src/services/solePropEngine.ts`
- Test: `backend/src/services/solePropEngine.test.ts`

**Interfaces:**
- Consumes: nothing (imports only `calculateProgressiveTax` type-shape logic — re-implement locally, do NOT import from `taxEngine.ts` to avoid coupling payroll changes to sole-prop).
- Produces for Task 4: `tablesForYear(year)`, `calculateSolePropObligations(inputs)`.

Figure sources (verified 2026-09-08 against canada.ca T4032-ON and CPP statistics pages):
- 2026 federal brackets: 58523@14%, 117045@20.5%, 181440@26%, 258482@29%, Infinity@33%; fed BPA max 16452.
- 2026 Ontario brackets: 53891@5.05%, 107785@9.15%, 150000@11.16%, 220000@12.16%, Infinity@13.16%; provincial credit 12989.
- 2026 CPP: YBE 3500, YMPE 74600, self rate 11.9%, self max 8460.90; CPP2: YAMPE 85000, self rate 8%, self max 832.
- 2025 federal brackets: 57375@14.5%, 114750@20.5%, 177882@26%, 253414@29%, Infinity@33%; fed BPA max 16129.
- 2025 Ontario brackets: 52886@5.05%, 105775@9.15%, 150000@11.16%, 220000@12.16%, Infinity@13.16%; provincial credit 12747.
- 2025 CPP: YBE 3500, YMPE 71300, self rate 11.9%, self max 8068.20; CPP2: YAMPE 81200, self rate 8%, self max 792.

Documented simplifications (also surfaced as UI "estimate" labels in Task 6): max federal BPA for all incomes (no high-income phase-out), Ontario surtax and health premium excluded, every deposit CAD counts 1:1 as pensionable earnings.

- [ ] **Step 1: Write the failing test** (`backend/src/services/solePropEngine.test.ts`)

```ts
import { describe, expect, it } from 'vitest';
import { calculateSolePropObligations } from './solePropEngine';

describe('calculateSolePropObligations', () => {
  it('computes tax + CPP on a mid-range cumulative total (2026)', () => {
    const out = calculateSolePropObligations({
      cumulativeCad: 50000,
      priorTax: 0, priorCpp: 0, priorCpp2: 0,
      ytdPensionableOpening: 0, ytdCppOpening: 0, ytdCpp2Opening: 0,
      taxYear: 2026,
    });
    // Federal: (50000-16452)=33548 @14% = 4696.72
    // Ontario: (50000-12989)=37011 @5.05% = 1869.06
    expect(out.incomeTax).toBe(6565.78);
    // CPP: (50000-3500)=46500 x11.9% = 5533.50
    expect(out.cpp).toBe(5533.5);
    expect(out.cpp2).toBe(0);
    expect(out.total).toBe(12099.28);
  });

  it('owes no further CPP when openings already exceed maximums (2026)', () => {
    const out = calculateSolePropObligations({
      cumulativeCad: 200000,
      priorTax: 40000, priorCpp: 8460.9, priorCpp2: 832,
      ytdPensionableOpening: 190000, ytdCppOpening: 8460.9, ytdCpp2Opening: 832,
      taxYear: 2026,
    });
    expect(out.cpp).toBe(0);
    expect(out.cpp2).toBe(0);
    // Cumulative tax on 200000: federal 37544.25 + Ontario 16864.53 = 54408.78;
    // per-deposit tax = 54408.78 - 40000 prior = 14408.78
    expect(out.incomeTax).toBe(14408.78);
  });

  it('applies CPP2 inside the YMPE-YAMPE band (2026)', () => {
    const out = calculateSolePropObligations({
      cumulativeCad: 80000,
      priorTax: 0, priorCpp: 0, priorCpp2: 0,
      ytdPensionableOpening: 0, ytdCppOpening: 0, ytdCpp2Opening: 0,
      taxYear: 2026,
    });
    expect(out.cpp).toBe(8460.9);
    // (80000-74600)=5400 x8% = 432.00
    expect(out.cpp2).toBe(432);
  });

  it('uses 2025 tables for 2025 deposits', () => {
    const out = calculateSolePropObligations({
      cumulativeCad: 50000,
      priorTax: 0, priorCpp: 0, priorCpp2: 0,
      ytdPensionableOpening: 0, ytdCppOpening: 0, ytdCpp2Opening: 0,
      taxYear: 2025,
    });
    // Federal: (50000-16129)=33871 @14.5% = 4911.30 (rounded 4911.3)
    // Ontario: (50000-12747)=37253 @5.05% = 1881.28
    expect(out.incomeTax).toBe(6792.58);
    // CPP: 46500 x11.9% = 5533.50 (same rate, under 2025 max 8068.20)
    expect(out.cpp).toBe(5533.5);
    expect(out.cpp2).toBe(0);
  });

  it('floors per-deposit amounts at zero and rounds to cents', () => {
    const out = calculateSolePropObligations({
      cumulativeCad: 1000,
      priorTax: 99999, priorCpp: 99999, priorCpp2: 99999,
      ytdPensionableOpening: 0, ytdCppOpening: 0, ytdCpp2Opening: 0,
      taxYear: 2026,
    });
    expect(out.incomeTax).toBe(0);
    expect(out.cpp).toBe(0);
    expect(out.cpp2).toBe(0);
    expect(out.total).toBe(0);
  });
});
```

Check the 2025 vector arithmetic before running: federal 33871 × 0.145 = 4911.295 → 4911.3 (rounded). Ontario 37253 × 0.0505 = 1881.2765 → 1881.28. Sum = 6792.58. ✓ (Engine rounds each component to cents then sums.)

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run src/services/solePropEngine.test.ts
```

Expected: FAIL with "Failed to resolve import ./solePropEngine".

- [ ] **Step 3: Write minimal implementation**

`backend/src/services/solePropTaxTables.ts`:

```ts
export interface Bracket { threshold: number; rate: number; }
export interface SolePropTaxTables {
  federalBrackets: Bracket[];
  ontarioBrackets: Bracket[];
  fedBPA: number;
  provCredit: number;
  ybe: number;
  ympe: number;
  yampe: number;
  cppSelfRate: number;
  cppSelfMax: number;
  cpp2SelfRate: number;
  cpp2SelfMax: number;
}

const TABLES_2026: SolePropTaxTables = {
  federalBrackets: [
    { threshold: 58523, rate: 0.14 },
    { threshold: 117045, rate: 0.205 },
    { threshold: 181440, rate: 0.26 },
    { threshold: 258482, rate: 0.29 },
    { threshold: Infinity, rate: 0.33 },
  ],
  ontarioBrackets: [
    { threshold: 53891, rate: 0.0505 },
    { threshold: 107785, rate: 0.0915 },
    { threshold: 150000, rate: 0.1116 },
    { threshold: 220000, rate: 0.1216 },
    { threshold: Infinity, rate: 0.1316 },
  ],
  fedBPA: 16452,
  provCredit: 12989,
  ybe: 3500,
  ympe: 74600,
  yampe: 85000,
  cppSelfRate: 0.119,
  cppSelfMax: 8460.9,
  cpp2SelfRate: 0.08,
  cpp2SelfMax: 832,
};

const TABLES_2025: SolePropTaxTables = {
  federalBrackets: [
    { threshold: 57375, rate: 0.145 },
    { threshold: 114750, rate: 0.205 },
    { threshold: 177882, rate: 0.26 },
    { threshold: 253414, rate: 0.29 },
    { threshold: Infinity, rate: 0.33 },
  ],
  ontarioBrackets: [
    { threshold: 52886, rate: 0.0505 },
    { threshold: 105775, rate: 0.0915 },
    { threshold: 150000, rate: 0.1116 },
    { threshold: 220000, rate: 0.1216 },
    { threshold: Infinity, rate: 0.1316 },
  ],
  fedBPA: 16129,
  provCredit: 12747,
  ybe: 3500,
  ympe: 71300,
  yampe: 81200,
  cppSelfRate: 0.119,
  cppSelfMax: 8068.2,
  cpp2SelfRate: 0.08,
  cpp2SelfMax: 792,
};

export function tablesForYear(year: number): SolePropTaxTables {
  if (year === 2025) return TABLES_2025;
  return TABLES_2026;
}
```

`backend/src/services/solePropEngine.ts` (calculation part; schedule/allocation/GST arrive in Task 3 — same file, appended then):

```ts
import { tablesForYear, type Bracket } from './solePropTaxTables';

export interface SolePropInputs {
  cumulativeCad: number;
  priorTax: number;
  priorCpp: number;
  priorCpp2: number;
  ytdPensionableOpening: number;
  ytdCppOpening: number;
  ytdCpp2Opening: number;
  taxYear: number;
}

export interface SolePropOutputs {
  incomeTax: number;
  cpp: number;
  cpp2: number;
  total: number;
}

const round2 = (x: number) => Math.round(x * 100) / 100;

function progressiveTax(income: number, brackets: Bracket[]): number {
  let tax = 0;
  let remaining = income;
  let prev = 0;
  for (const { threshold, rate } of brackets) {
    const taxable = Math.min(remaining, threshold - prev);
    tax += taxable * rate;
    remaining -= taxable;
    prev = threshold;
    if (remaining <= 0) break;
  }
  if (remaining > 0) tax += remaining * brackets[brackets.length - 1].rate;
  return tax;
}

export function calculateSolePropObligations(i: SolePropInputs): SolePropOutputs {
  const t = tablesForYear(i.taxYear);
  const fedTaxable = Math.max(0, i.cumulativeCad - t.fedBPA);
  const provTaxable = Math.max(0, i.cumulativeCad - t.provCredit);
  const cumTax = round2(
    progressiveTax(fedTaxable, t.federalBrackets) +
    progressiveTax(provTaxable, t.ontarioBrackets)
  );
  const totalPensionable = i.ytdPensionableOpening + i.cumulativeCad;
  const contributory = Math.max(0, Math.min(totalPensionable, t.ympe) - t.ybe);
  const cumCpp = Math.min(round2(contributory * t.cppSelfRate), t.cppSelfMax);
  const band = Math.max(0, Math.min(totalPensionable, t.yampe) - t.ympe);
  const cumCpp2 = Math.min(round2(band * t.cpp2SelfRate), t.cpp2SelfMax);
  const incomeTax = Math.max(0, round2(cumTax - i.priorTax));
  const cpp = Math.max(0, round2(cumCpp - i.ytdCppOpening - i.priorCpp));
  const cpp2 = Math.max(0, round2(cumCpp2 - i.ytdCpp2Opening - i.priorCpp2));
  return { incomeTax, cpp, cpp2, total: round2(incomeTax + cpp + cpp2) };
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run src/services/solePropEngine.test.ts
```

Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/solePropTaxTables.ts backend/src/services/solePropEngine.ts backend/src/services/solePropEngine.test.ts
git commit -m "feat: add sole-prop CRA tax tables and obligation engine"
```

---

### Task 3: Schedule, allocation, and GST helpers

**Files:**
- Modify: `backend/src/services/solePropEngine.ts` (append pure helpers)
- Modify: `backend/src/services/solePropEngine.test.ts` (append suites)

**Interfaces:**
- Consumes: `SolePropOutputs`-shaped deposit sums from Task 4.
- Produces for Task 4: `buildInstalmentSchedule()`, `allocateToInstalments()`, `gstStatus()`.

Allocation rule (exact): target row for a deposit = earliest schedule row with `due_date > received_date`. Schedule for year-span always built from start-year through (current year + 1) so December deposits land on next March's row. Paid rows are never rewritten by the router (router upserts only `paid = 0` rows; helper itself is allocation-pure and unaware of paid state).

GST rule (exact): calendar quarters (Q1 Jan–Mar …). Rolling total = sum of non-voided deposit CAD in the quarter containing `asOf` plus the 3 preceding quarters. `crossed` = total ≥ 30000. `crossingDate` = received_date of the deposit (replaying non-voided deposits in date order, then id order) that first pushed the rolling total ≥ 30000. `deadline` = crossingDate + 29 days (UTC date arithmetic).

- [ ] **Step 1: Write the failing tests** (append to `backend/src/services/solePropEngine.test.ts`)

```ts
import { buildInstalmentSchedule, allocateToInstalments, gstStatus } from './solePropEngine';

describe('buildInstalmentSchedule', () => {
  it('gives an August 2026 start an annual row then CRA quarterly rows', () => {
    const rows = buildInstalmentSchedule('2026-08-15', 2027);
    expect(rows).toEqual([
      { tax_year: 2026, due_date: '2027-04-30', kind: 'annual' },
      { tax_year: 2027, due_date: '2027-03-15', kind: 'quarterly' },
      { tax_year: 2027, due_date: '2027-06-15', kind: 'quarterly' },
      { tax_year: 2027, due_date: '2027-09-15', kind: 'quarterly' },
      { tax_year: 2027, due_date: '2027-12-15', kind: 'quarterly' },
    ]);
  });

  it('gives a January start the same first-year annual treatment', () => {
    const rows = buildInstalmentSchedule('2026-01-10', 2026);
    expect(rows).toEqual([{ tax_year: 2026, due_date: '2027-04-30', kind: 'annual' }]);
  });
});

describe('allocateToInstalments', () => {
  it('routes start-year deposits to the annual row and later deposits to the next due date', () => {
    const schedule = buildInstalmentSchedule('2026-08-15', 2027);
    const alloc = allocateToInstalments(
      [
        { received_date: '2026-09-01', tax_owed: 100, cpp_owed: 50, cpp2_owed: 0, voided: 0 },
        { received_date: '2027-02-01', tax_owed: 200, cpp_owed: 100, cpp2_owed: 10, voided: 0 },
        { received_date: '2027-04-01', tax_owed: 300, cpp_owed: 0, cpp2_owed: 0, voided: 0 },
        { received_date: '2026-10-01', tax_owed: 999, cpp_owed: 0, cpp2_owed: 0, voided: 1 },
      ],
      schedule
    );
    expect(alloc['2027-04-30']).toEqual({ tax: 100, cpp: 50, cpp2: 0, total: 150 });
    expect(alloc['2027-03-15']).toEqual({ tax: 200, cpp: 100, cpp2: 10, total: 310 });
    expect(alloc['2027-06-15']).toEqual({ tax: 300, cpp: 0, cpp2: 0, total: 300 });
    expect(alloc['2027-09-15']).toEqual({ tax: 0, cpp: 0, cpp2: 0, total: 0 });
  });
});

describe('gstStatus', () => {
  it('detects crossing with a 29-day deadline', () => {
    const status = gstStatus(
      [
        { received_date: '2026-09-15', cad_amount: 12000, voided: 0 },
        { received_date: '2026-12-01', cad_amount: 12000, voided: 0 },
        { received_date: '2027-02-10', cad_amount: 9000, voided: 0 },
      ],
      '2027-02-10'
    );
    expect(status.rollingTotal).toBe(33000);
    expect(status.crossed).toBe(true);
    expect(status.crossingDate).toBe('2027-02-10');
    expect(status.deadline).toBe('2027-03-11');
  });

  it('drops old quarters and ignores voided deposits', () => {
    const status = gstStatus(
      [
        { received_date: '2026-01-15', cad_amount: 29000, voided: 0 },
        { received_date: '2026-06-01', cad_amount: 5000, voided: 1 },
        { received_date: '2027-05-01', cad_amount: 1000, voided: 0 },
      ],
      '2027-05-01'
    );
    expect(status.rollingTotal).toBe(1000);
    expect(status.crossed).toBe(false);
    expect(status.crossingDate).toBeNull();
    expect(status.deadline).toBeNull();
  });
});
```

Deadline check: 2027-02-10 + 29 days = 2027-03-11. ✓ (Feb 2027 has 28 days: 10 + 29 = Mar 11. ✓)

- [ ] **Step 2: Run to verify they fail**

```bash
npx vitest run src/services/solePropEngine.test.ts
```

Expected: FAIL with "buildInstalmentSchedule is not a function" (import error).

- [ ] **Step 3: Append the implementations** to `backend/src/services/solePropEngine.ts`

```ts
export interface InstalmentRow { tax_year: number; due_date: string; kind: 'annual' | 'quarterly'; }
export interface AllocatableDeposit {
  received_date: string;
  tax_owed: number;
  cpp_owed: number;
  cpp2_owed: number;
  voided: number;
}
export interface Allocation { tax: number; cpp: number; cpp2: number; total: number; }

export function buildInstalmentSchedule(startDate: string, throughYear: number): InstalmentRow[] {
  const startYear = Number(startDate.slice(0, 4));
  const rows: InstalmentRow[] = [{ tax_year: startYear, due_date: `${startYear + 1}-04-30`, kind: 'annual' }];
  for (let y = startYear + 1; y <= throughYear; y++) {
    for (const md of ['03-15', '06-15', '09-15', '12-15']) {
      rows.push({ tax_year: y, due_date: `${y}-${md}`, kind: 'quarterly' });
    }
  }
  return rows;
}

export function allocateToInstalments(
  deposits: AllocatableDeposit[],
  schedule: InstalmentRow[]
): Record<string, Allocation> {
  const out: Record<string, Allocation> = {};
  for (const r of schedule) out[r.due_date] = { tax: 0, cpp: 0, cpp2: 0, total: 0 };
  for (const d of deposits) {
    if (d.voided) continue;
    const target = schedule.find((r) => r.due_date > d.received_date);
    if (!target) continue;
    const a = out[target.due_date];
    a.tax = round2(a.tax + d.tax_owed);
    a.cpp = round2(a.cpp + d.cpp_owed);
    a.cpp2 = round2(a.cpp2 + d.cpp2_owed);
    a.total = round2(a.tax + a.cpp + a.cpp2);
  }
  return out;
}

export interface GstDeposit { received_date: string; cad_amount: number; voided: number; }
export interface GstStatus {
  rollingTotal: number;
  crossed: boolean;
  crossingDate: string | null;
  deadline: string | null;
}

function quarterStart(dateStr: string): string {
  const [y, m] = dateStr.split('-').map(Number);
  const qm = Math.floor((m - 1) / 3) * 3 + 1;
  return `${y}-${String(qm).padStart(2, '0')}-01`;
}

function addDays(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return dt.toISOString().split('T')[0];
}

function addMonths(dateStr: string, months: number): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1 + months, d));
  return dt.toISOString().split('T')[0];
}

export function gstStatus(deposits: GstDeposit[], asOf: string): GstStatus {
  const live = deposits.filter((d) => !d.voided && d.received_date <= asOf);
  const windowStart = addMonths(quarterStart(asOf), -9);
  const rollingTotal = round2(
    live.filter((d) => d.received_date >= windowStart).reduce((s, d) => s + d.cad_amount, 0)
  );
  let running = 0;
  let crossingDate: string | null = null;
  for (const d of [...live].sort((a, b) =>
    a.received_date < b.received_date ? -1 : a.received_date > b.received_date ? 1 : 0
  )) {
    running = round2(running + d.cad_amount);
    const winStart = addMonths(quarterStart(d.received_date), -9);
    const windowed = round2(
      live
        .filter((x) => x.received_date <= d.received_date && x.received_date >= winStart)
        .reduce((s, x) => s + x.cad_amount, 0)
    );
    if (windowed >= 30000) {
      crossingDate = d.received_date;
      break;
    }
  }
  void running;
  return {
    rollingTotal,
    crossed: rollingTotal >= 30000,
    crossingDate,
    deadline: crossingDate ? addDays(crossingDate, 29) : null,
  };
}
```

Note: the unused `running` accumulator is intentional dead weight — remove it before committing (the windowed replay is the real crossing computation). Delete the `running` lines so the final code has no dead variables.

- [ ] **Step 4: Run to verify pass**

```bash
npx vitest run src/services/solePropEngine.test.ts
```

Expected: PASS (all suites). Also run the full backend suite to catch regressions:

```bash
npm --prefix backend test
```

Expected: all green.

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/solePropEngine.ts backend/src/services/solePropEngine.test.ts
git commit -m "feat: add sole-prop instalment schedule, allocation, and GST helpers"
```

---

### Task 4: Backend router + onboarding support

**Files:**
- Create: `backend/src/routes/soleprop.ts`
- Create: `backend/src/routes/soleprop.test.ts`
- Modify: `backend/src/routes/settings.ts` (sole-prop onboarding branch)
- Modify: `backend/src/index.ts` (mount router)

**Interfaces:**
- Consumes: Task 1 tables, Task 2–3 engine functions.
- Produces for Tasks 5–6: HTTP contract below (frozen; frontend codes against it).

Frozen HTTP contract (`Authorization: Bearer <JWT>` on all; `companyId` from `jwtPayload` exactly like `payroll.ts#getCompanyId`):

- `GET /api/soleprop/overview` → `{ profile, totals: { cad, tax, cpp, cpp2 }, upcoming: [{ id, tax_year, due_date, kind, tax_amount, cpp_amount, cpp2_amount, total_amount, paid, paid_date }], gst: { rollingTotal, crossed, crossingDate, deadline, hasBN } }`
- `GET /api/soleprop/fx-preview?date=YYYY-MM-DD&currency=USD` → `{ rate, dateUsed, currency }` (400 on invalid date/currency; 502 with `{ error }` when frankfurter unreachable after fallback).
- `POST /api/soleprop/deposits` body `{ received_date, foreign_amount, currency?, fx_rate?, note? }` → creates deposit (server computes CAD + obligations + reallocates unpaid rows), returns `{ deposit, overview }`. 400 on bad input; 502 when no FX rate available and none supplied.
- `POST /api/soleprop/deposits/:id/void` → sets `voided = 1`, reallocates unpaid rows, returns `{ overview }`.
- `POST /api/soleprop/instalments/:id/pay` body `{ paid_date? }` → sets paid, mirrors a row into `remittance_payments` (`type='INSTALMENT'`, `payment_date`, `amount=total_amount`, `period_end=due_date`), returns `{ instalment }`.
- `PUT /api/soleprop/profile` body `{ business_number }` → validates 9 digits after stripping non-digits, updates profile, returns `{ profile }`.
- Every route first loads `company_settings`; non-`sole_prop` → 403 `{ error: 'Sole proprietor workspace required' }`; missing profile → 404.

FX fetch (exact): `GET https://api.frankfurter.dev/v1/{date}?base={CUR}&symbols=CAD`, parse `json.rates.CAD` as number. If fetch throws, status non-200, or rate missing/non-numeric, step back one UTC day and retry, max 5 attempts total. Record `fx_date_used` (the date that yielded the rate). Supported currencies V1: `USD`, `EUR`, `GBP` (regex `^[A-Z]{3}$` plus allowlist).

Deposit computation (exact): prior sums = `SUM(tax_owed/cpp_owed/cpp2_owed)` over non-voided deposits of this company; `cumulativeCad` = prior CAD sum + new `cadAmount`; `taxYear` = year of `received_date`; call `calculateSolePropObligations`; store outputs. Reallocation: rebuild schedule via `buildInstalmentSchedule(profile.start_date, currentYear + 1)`, `allocateToInstalments(all live deposits)`, then for each schedule row: `INSERT … ON CONFLICT(company_id, due_date) DO UPDATE` only where `paid = 0` (paid rows keep their frozen amounts).

`settings.ts` onboarding branch (read `settings.ts:115-204` first to mirror the token-refresh response shape exactly): accept `account_type` in the destructured body; when `account_type === 'sole_prop'`: require only `legal_name` (business_number optional, stored NULL when absent); insert `company_settings` with `account_type='sole_prop'`; insert `sole_prop_profile` from body fields `sole_prop_start_date` (default today), `sole_prop_ytd_pensionable/cpp/cpp2` (default 0), `sole_prop_business_number`; skip the 4-pay-group seeding block; return the identical `{ token, companyId }` JSON as the company path. Company path unchanged.

- [ ] **Step 1: Write the failing route test** (`backend/src/routes/soleprop.test.ts`)

Follow the D1 mock pattern in `src/index.test.ts:82-216` (read it first). Minimum cases:

```ts
import { describe, expect, it, vi, beforeEach } from 'vitest';
import app from '../index';

function authHeader(db: any) { /* same JWT helper style as index.test.ts: sign a payload with companyId */ }

describe('soleprop routes', () => {
  beforeEach(() => { vi.stubGlobal('fetch', async (url: string) => {
    if (String(url).includes('frankfurter')) {
      return { ok: true, json: async () => ({ rates: { CAD: 1.38 } }) } as any;
    }
    throw new Error('unexpected fetch ' + url);
  }); });

  it('rejects company workspaces with 403', async () => { /* seed company_settings account_type=company; GET /api/soleprop/overview → 403 */ });
  it('creates a deposit with fetched FX and incremental obligations', async () => {
    /* seed sole_prop company + profile; POST deposit { received_date: '2026-09-01', foreign_amount: 5000, currency: 'USD' };
       expect deposit.cad_amount 6900, fx_rate 1.38, fx_date_used '2026-09-01';
       expect overview.upcoming annual row due 2027-04-30 totals equal deposit totals */
  });
  it('second deposit stores only the increment', async () => { /* cumulative math check via two posts */ });
  it('void excludes the deposit and reallocates', async () => { /* POST void → overview totals drop */ });
  it('pay marks instalment and mirrors remittance_payments', async () => { /* POST pay → paid=1 + INSTALMENT row exists */ });
  it('fx-preview returns 502 when frankfurter is down', async () => {
    vi.stubGlobal('fetch', async () => ({ ok: false, status: 500, json: async () => ({}) } as any));
    /* GET /api/soleprop/fx-preview?date=2026-09-01&currency=USD → 502 */
  });
});
```

Flesh out the DB seeding using the mock helpers from `index.test.ts` — that file's mock supports `prepare().bind().first()/all()/run()`; mirror its style exactly.

- [ ] **Step 2: Run to verify it fails**

```bash
npx vitest run src/routes/soleprop.test.ts
```

Expected: FAIL (404 — route not mounted).

- [ ] **Step 3: Implement `soleprop.ts`, mount in `index.ts`, branch `settings.ts`**

Write the router per the frozen contract above. Mount in `backend/src/index.ts` next to the other `app.route` lines:

```ts
import solepropRouter from './routes/soleprop';
app.route('/api/soleprop', solepropRouter);
```

- [ ] **Step 4: Run tests**

```bash
npx vitest run src/routes/soleprop.test.ts
```

Expected: PASS. Then regression:

```bash
npm --prefix backend test
```

Expected: full suite green.

- [ ] **Step 5: Smoke-test against local D1** (real SQLite, catches mock-drift)

```bash
npm run db:migrate:local
```

then boot the worker (`npm run dev:backend` from `gitpaid/`) and `curl http://localhost:5001/api/health`. If already running, skip the boot. Report the health JSON in the task transcript.

- [ ] **Step 6: Commit**

```bash
git add backend/src/routes/soleprop.ts backend/src/routes/soleprop.test.ts backend/src/routes/settings.ts backend/src/index.ts
git commit -m "feat: add sole-prop API routes and onboarding branch"
```

---

### Task 5: Frontend types, API client, onboarding branch

**Files:**
- Modify: `frontend/src/types.ts` (append interfaces, extend `CompanySettings`)
- Modify: `frontend/src/utils/api.ts` (append 6 methods)
- Modify: `frontend/src/views/OnboardingView.tsx` (step-0 picker + sole-prop flow)

**Interfaces:**
- Consumes: Task 4 frozen HTTP contract.
- Produces for Task 6: `api.getSolePropOverview()` etc. + `account_type` on settings.

- [ ] **Step 1: Extend types** (`frontend/src/types.ts`)

```ts
export interface SolePropProfile {
  id: number;
  company_id: number;
  business_number: string | null;
  start_date: string;
  province: string;
  ytd_pensionable_opening: number;
  ytd_cpp_opening: number;
  ytd_cpp2_opening: number;
  instalment_mode: string;
}

export interface SolePropDeposit {
  id: number;
  received_date: string;
  foreign_amount: number;
  currency: string;
  fx_rate: number;
  fx_date_used: string;
  cad_amount: number;
  tax_owed: number;
  cpp_owed: number;
  cpp2_owed: number;
  note: string | null;
  voided: number;
}

export interface SolePropInstalment {
  id: number;
  tax_year: number;
  due_date: string;
  kind: 'annual' | 'quarterly';
  tax_amount: number;
  cpp_amount: number;
  cpp2_amount: number;
  total_amount: number;
  paid: number;
  paid_date: string | null;
}

export interface SolePropOverview {
  profile: SolePropProfile;
  totals: { cad: number; tax: number; cpp: number; cpp2: number };
  upcoming: SolePropInstalment[];
  gst: { rollingTotal: number; crossed: boolean; crossingDate: string | null; deadline: string | null; hasBN: boolean };
}
```

And add `account_type?: string;` to `CompanySettings`.

- [ ] **Step 2: Extend the API client** (append inside the `api` object in `frontend/src/utils/api.ts`)

```ts
// Sole proprietor
getSolePropOverview: () => request<SolePropOverview>('/soleprop/overview'),
previewFx: (date: string, currency: string) =>
  request<{ rate: number; dateUsed: string; currency: string }>(
    `/soleprop/fx-preview?date=${encodeURIComponent(date)}&currency=${encodeURIComponent(currency)}`
  ),
createSolePropDeposit: (deposit: { received_date: string; foreign_amount: number; currency?: string; fx_rate?: number; note?: string }) =>
  request<{ deposit: SolePropDeposit; overview: SolePropOverview }>('/soleprop/deposits', { method: 'POST', body: JSON.stringify(deposit) }),
voidSolePropDeposit: (id: number) =>
  request<{ overview: SolePropOverview }>(`/soleprop/deposits/${id}/void`, { method: 'POST' }),
paySolePropInstalment: (id: number, paid_date?: string) =>
  request<{ instalment: SolePropInstalment }>(`/soleprop/instalments/${id}/pay`, { method: 'POST', body: JSON.stringify({ paid_date }) }),
updateSolePropProfile: (profile: { business_number: string }) =>
  request<{ profile: SolePropProfile }>('/soleprop/profile', { method: 'PUT', body: JSON.stringify(profile) }),
```

- [ ] **Step 3: Branch onboarding** (`frontend/src/views/OnboardingView.tsx`; read lines 188-723 first for the step renderer)

Add `const [accountType, setAccountType] = useState<'company' | 'sole_prop' | null>(null);` Render a step-0 picker when `accountType === null`: two cards — "Register a company" (existing 3-step company flow) and "Register as sole proprietor" (new flow reusing `FormattedInput`, Tailwind classes, and `sanitizeNumericInput`/`cleanBusinessNumber` helpers already imported). Sole-prop flow fields: legal name (required), BN (optional, validated with `cleanBusinessNumber` only when non-empty), start date (default today), 2026 YTD pensionable earnings + CPP paid + CPP2 paid (three numeric inputs, default 0), and a static note: "First-year instalments are deferred — your running estimate is due April 30 of next year. Quarterly instalments (Mar 15 / Jun 15 / Sep 15 / Dec 15) start the following year." Submit posts to `/settings` (via `api` + `fetch` style already used in `handleSubmit`) with `account_type: 'sole_prop'`, `legal_name`, `business_number` (or null), `province: 'ON'`, `sole_prop_start_date`, `sole_prop_ytd_pensionable`, `sole_prop_ytd_cpp`, `sole_prop_ytd_cpp2`; on success call `onOnboardingComplete(token, companyId)` exactly like the company path. Company flow untouched (existing validation requiring BN stays).

- [ ] **Step 4: Typecheck**

```bash
npm --prefix frontend run build
```

Expected: clean `tsc -b` (build may emit; type errors are the gate).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/types.ts frontend/src/utils/api.ts frontend/src/views/OnboardingView.tsx
git commit -m "feat: add sole-prop onboarding flow and API client"
```

---

### Task 6: Sole-prop dashboard + app branching

**Files:**
- Create: `frontend/src/views/SolePropDashboardView.tsx`
- Create: `frontend/src/views/SolePropDashboardView.test.tsx`
- Modify: `frontend/src/App.tsx`
- Modify: `frontend/src/components/Sidebar.tsx`

**Interfaces:**
- Consumes: Task 5 types + client.
- Produces: the complete V1 user surface. No later tasks depend on it.

`SolePropDashboardView` props: `{ triggerToast: (msg: string, type: 'success' | 'error') => void }`. Sections (read `DashboardView.tsx` first and reuse its card/table Tailwind vocabulary):
1. GST banner (only when `overview.gst.crossed && !overview.gst.hasBN`): red banner with rolling total, crossing date, 29-day `deadline`, plus inline BN input + Save (calls `updateSolePropProfile`, shows toast, refetches).
2. Totals cards: fiscal-year CAD received, estimated income tax, CPP, CPP2 (each suffixed "estimate").
3. Deposit form: received date, foreign amount, currency select (USD/EUR/GBP), "Fetch rate" button (calls `previewFx`, fills rate, shows `dateUsed` when it differs), editable rate field, note; submit → `createSolePropDeposit` → toast + refetch. FX 502 → error toast "Rate unavailable — enter manually".
4. Deposit list: date, foreign amount + currency, rate, CAD, computed tax/CPP/CPP2, Void button (confirm via `window.confirm`, then refetch).
5. Instalment cards: one per `upcoming` row — due date, kind label ("Annual" / "Quarterly instalment"), tax/CPP/CPP2/total breakdown, "Mark paid" button (→ `paySolePropInstalment` → toast + refetch); overdue unpaid rows styled red; paid rows show paid date and no button. First-year annual row shows sub-note "No quarterly payments required yet — due April 30."

`App.tsx` changes: add `const [accountType, setAccountType] = useState<string>('company');` set it from `settings.account_type || 'company'` in both `getSettings` effects; `getPageTitle` returns 'Sole Proprietor' for sole-prop dashboard; `renderContent` returns `<SolePropDashboardView triggerToast={triggerToast} />` for `activeTab === 'dashboard'` when sole-prop, and falls through to the same for employees/run-payroll/reports (unreachable via nav, safe default); settings tab unchanged. `Header` gets `onNewEmployeeClick={accountType === 'sole_prop' ? () => {} : () => setIsOnboardingNew(true)}`. Pass `accountType={accountType}` to `Sidebar`.

`Sidebar.tsx` changes: add `accountType?: string` to props (default `'company'`); `const navItems = accountType === 'sole_prop' ? [{ dashboard, settings }] : [existing five]` with identical object shape.

- [ ] **Step 1: Write the failing view test** (`frontend/src/views/SolePropDashboardView.test.tsx`)

Check `frontend/src/App.test.tsx` and `src/test/setup.ts` first for the render harness, then:

```tsx
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import SolePropDashboardView from './SolePropDashboardView';
import { api } from '../utils/api';

vi.mock('../utils/api', () => ({ api: {
  getSolePropOverview: vi.fn(),
  previewFx: vi.fn(),
  createSolePropDeposit: vi.fn(),
  voidSolePropDeposit: vi.fn(),
  paySolePropInstalment: vi.fn(),
  updateSolePropProfile: vi.fn(),
} }));

const overview: any = {
  profile: { business_number: null, start_date: '2026-08-15' },
  totals: { cad: 33000, tax: 5000, cpp: 3000, cpp2: 0 },
  upcoming: [{ id: 1, tax_year: 2026, due_date: '2027-04-30', kind: 'annual',
    tax_amount: 5000, cpp_amount: 3000, cpp2_amount: 0, total_amount: 8000, paid: 0, paid_date: null }],
  gst: { rollingTotal: 33000, crossed: true, crossingDate: '2027-02-10', deadline: '2027-03-11', hasBN: false },
};

describe('SolePropDashboardView', () => {
  beforeEach(() => { vi.mocked(api.getSolePropOverview).mockResolvedValue(overview); });

  it('shows the blocking GST banner until a BN is saved', async () => {
    render(<SolePropDashboardView triggerToast={() => {}} />);
    expect(await screen.findByText(/GST\/HST registration required/i)).toBeInTheDocument();
    expect(screen.getByText(/2027-03-11/)).toBeInTheDocument();
  });

  it('mark-paid calls the API and refetches', async () => {
    vi.mocked(api.paySolePropInstalment).mockResolvedValue({ instalment: { ...overview.upcoming[0], paid: 1 } });
    render(<SolePropDashboardView triggerToast={() => {}} />);
    fireEvent.click(await screen.findByRole('button', { name: /mark paid/i }));
    await waitFor(() => expect(api.paySolePropInstalment).toHaveBeenCalledWith(1, undefined));
    expect(api.getSolePropOverview).toHaveBeenCalledTimes(2);
  });
});
```

(Banner copy must contain the literal "GST/HST registration required" heading for the test to pass — implement it verbatim.)

- [ ] **Step 2: Run to verify it fails**

```bash
npx vitest run src/views/SolePropDashboardView.test.tsx
```

Expected: FAIL (module not found).

- [ ] **Step 3: Implement the view, App branching, and Sidebar prop**

Per the section list above.

- [ ] **Step 4: Run tests + typecheck**

```bash
npx vitest run src/views/SolePropDashboardView.test.tsx
```

Expected: PASS. Then:

```bash
npm --prefix frontend test
npm --prefix frontend run build
```

Expected: full frontend suite green, `tsc -b` clean.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/views/SolePropDashboardView.tsx frontend/src/views/SolePropDashboardView.test.tsx frontend/src/App.tsx frontend/src/components/Sidebar.tsx
git commit -m "feat: add sole-prop dashboard and workspace branching"
```

---

### Task 7: End-to-end verification

No new code. Proves the whole slice works against the real local stack.

- [ ] **Step 1: Migrate + run both suites**

```bash
npm run db:migrate:local
npm --prefix backend test
npm --prefix frontend test
```

Expected: all green. If the backend suite touches the new tables, it uses mocks — no seed needed.

- [ ] **Step 2: Manual smoke via mock login**

1. Set `VITE_ALLOW_BYPASS="true"` (frontend `.env`) and `ALLOW_MOCK_LOGIN="true"` (`backend/.dev.vars`), start both servers (`npm run dev:backend`, `npm run dev:frontend`).
2. Log in with `mock-google-token-testuser`, choose "Register as sole proprietor", submit with YTD CPP at max (8460.90/832) to mirror the over-max case.
3. Add a USD 5000 deposit dated 2026-09-01; confirm CAD ≈ 5000 × fetched rate, CPP owed ≈ 0 MIA, instalment card due 2027-04-30.
4. Confirm no console errors and payroll login still shows the company flow (regression glance with `mock-google-token-admin`).

- [ ] **Step 3: Record the result**

Append a `## Verification (2026-09-08)` section to the spec doc noting suites green + smoke outcome. Commit:

```bash
git add docs/superpowers/specs/2026-09-08-sole-proprietor-design.md
git commit -m "docs: record sole-prop V1 verification"
```

---

## Sources

- CRA figures: https://www.canada.ca/en/revenue-agency/services/forms-publications/payroll/t4032-payroll-deductions-tables/t4032on-jan/t4032on-january-general-information.html (2026 federal/Ontario brackets, BPA)
- 2025 figures: https://www.canada.ca/en/revenue-agency/services/tax/individuals/tax-rates-brackets/last-year.html and https://www.canada.ca/en/employment-social-development/programs/pensions/pension/statistics/2025-quarterly-july-september.html (CPP/YMPE/YAMPE)
- 2026 CPP maximums: https://www.canada.ca/en/employment-social-development/programs/pensions/pension/statistics/2026-quarterly-april-june.html
- FX: https://frankfurter.dev/ — `GET https://api.frankfurter.dev/v1/{date}?base={CUR}&symbols=CAD`
- Wise personal tokens (V2): https://docs.wise.com/guides/developer/auth-and-security/personal-api-token
