import { tablesForYear, type Bracket, type SolePropTaxTables } from './solePropTaxTables';

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

interface CumulativeOwed { fed: number; prov: number; cpp: number; cpp2: number; }

function cumulativeObligations(cumulativeCad: number, ytdPensionableOpening: number, t: SolePropTaxTables): CumulativeOwed {
  const fedTaxable = Math.max(0, cumulativeCad - t.fedBPA);
  const provTaxable = Math.max(0, cumulativeCad - t.provCredit);
  const totalPensionable = ytdPensionableOpening + cumulativeCad;
  const contributory = Math.max(0, Math.min(totalPensionable, t.ympe) - t.ybe);
  const band = Math.max(0, Math.min(totalPensionable, t.yampe) - t.ympe);
  return {
    fed: progressiveTax(fedTaxable, t.federalBrackets),
    prov: progressiveTax(provTaxable, t.ontarioBrackets),
    cpp: Math.min(round2(contributory * t.cppSelfRate), t.cppSelfMax),
    cpp2: Math.min(round2(band * t.cpp2SelfRate), t.cpp2SelfMax),
  };
}

export function calculateSolePropObligations(i: SolePropInputs): SolePropOutputs {
  const t = tablesForYear(i.taxYear);
  const cum = cumulativeObligations(i.cumulativeCad, i.ytdPensionableOpening, t);
  const cumTax = round2(cum.fed + cum.prov);
  const incomeTax = Math.max(0, round2(cumTax - i.priorTax));
  const cpp = Math.max(0, round2(cum.cpp - i.ytdCppOpening - i.priorCpp));
  const cpp2 = Math.max(0, round2(cum.cpp2 - i.ytdCpp2Opening - i.priorCpp2));
  return { incomeTax, cpp, cpp2, total: round2(incomeTax + cpp + cpp2) };
}
// Guards YTD opening balances at entry: nobody can have paid more than
// the annual maximums, so anything above is a typo. Returns an error
// message, or null when the figures are possible.
export function validateOpenings(pens: number | null, cpp: number | null, cpp2: number | null): string | null {
  const t = tablesForYear(2026);
  if (cpp !== null && cpp > t.cppSelfMax) {
    return `CPP paid cannot exceed the 2026 self-employed maximum of $${t.cppSelfMax.toLocaleString('en-CA')}`;
  }
  if (cpp2 !== null && cpp2 > t.cpp2SelfMax) {
    return `CPP2 paid cannot exceed the 2026 self-employed maximum of $${t.cpp2SelfMax.toLocaleString('en-CA')}`;
  }
  return null;
}

export interface DepositSlice {
  cumulativeBefore: number;
  cumulativeAfter: number;
  fedTax: number;
  provTax: number;
  cppRoomAfter: number;
}

// Marginal breakdown per deposit in chronological order: which cumulative
// dollars each row covers and the federal/provincial split behind its share.
// fed+prov always sums to the row's stored income-tax share.
export function ledgerBreakdown(
  cads: { cad: number; date: string }[],
  openings: { ytdPensionableOpening: number; ytdCppOpening: number }
): DepositSlice[] {
  let running = 0;
  return cads.map(({ cad, date }) => {
    const t = tablesForYear(Number(date.slice(0, 4)));
    const before = cumulativeObligations(running, openings.ytdPensionableOpening, t);
    const afterCum = round2(running + cad);
    const after = cumulativeObligations(afterCum, openings.ytdPensionableOpening, t);
    const fedTax = round2(after.fed - before.fed);
    const taxDelta = round2(round2(after.fed + after.prov) - round2(before.fed + before.prov));
    const cppRoomAfter = round2(Math.max(0, t.cppSelfMax - openings.ytdCppOpening - after.cpp));
    const slice = {
      cumulativeBefore: running,
      cumulativeAfter: afterCum,
      fedTax,
      provTax: round2(taxDelta - fedTax),
      cppRoomAfter,
    };
    running = afterCum;
    return slice;
  });
}
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

export function nextQuarterlyAfter(dateStr: string): string {
  const y = Number(dateStr.slice(0, 4));
  const cands = [`${y}-03-15`, `${y}-06-15`, `${y}-09-15`, `${y}-12-15`, `${y + 1}-03-15`];
  const found = cands.find((c) => c > dateStr);
  if (!found) throw new Error(`No quarterly date after ${dateStr}`);
  return found;
}

export function allocateToInstalments(
  deposits: AllocatableDeposit[],
  schedule: InstalmentRow[]
): Record<string, Allocation> {
  const ordered = [...schedule].sort((a, b) =>
    a.due_date < b.due_date ? -1 : a.due_date > b.due_date ? 1 : 0
  );
  const out: Record<string, Allocation> = {};
  for (const r of ordered) out[r.due_date] = { tax: 0, cpp: 0, cpp2: 0, total: 0 };
  for (const d of deposits) {
    if (d.voided) continue;
    const sameYearAnnual = ordered.find(
      (r) => r.kind === 'annual' && r.tax_year === Number(d.received_date.slice(0, 4))
    );
    const quarterlies = ordered.filter((r) => r.kind === 'quarterly');
    const target =
      sameYearAnnual ??
      quarterlies.find((r) => r.due_date > d.received_date) ??
      quarterlies[quarterlies.length - 1];
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
  let crossingDate: string | null = null;
  for (const d of [...live].sort((a, b) =>
    a.received_date < b.received_date ? -1 : a.received_date > b.received_date ? 1 : 0
  )) {
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
  return {
    rollingTotal,
    crossed: rollingTotal >= 30000,
    crossingDate,
    deadline: crossingDate ? addDays(crossingDate, 29) : null,
  };
}
