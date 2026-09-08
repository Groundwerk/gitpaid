import { Hono } from 'hono';
import { encryptText, decryptText } from '../utils/crypto';
import { fetchCredits, normalizeSender, WiseApiError, type WiseCredit } from '../services/wiseSync';
import {
  calculateSolePropObligations,
  allocateToInstalments,
  gstStatus,
  nextQuarterlyAfter,
} from '../services/solePropEngine';

const router = new Hono<{
  Bindings: {
    DB: D1Database;
    JWT_SECRET: string;
  };
}>();
const FX_CURRENCIES = [
  'AUD', 'BRL', 'CAD', 'CHF', 'CNY', 'CZK', 'DKK', 'EUR', 'GBP', 'HKD',
  'HUF', 'IDR', 'ILS', 'INR', 'ISK', 'JPY', 'KRW', 'MXN', 'MYR', 'NOK',
  'NZD', 'PHP', 'PLN', 'RON', 'SEK', 'SGD', 'THB', 'TRY', 'USD', 'ZAR',
];

const round2 = (x: number) => Math.round(x * 100) / 100;

function getCompanyId(c: any): number {
  const payload = c.get('jwtPayload');
  return payload?.companyId;
}

function todayStr(): string {
  return new Date().toISOString().split('T')[0];
}

async function loadWorkspace(db: any, companyId: number) {
  const settings = await db
    .prepare('SELECT * FROM company_settings WHERE id = ?')
    .bind(companyId)
    .first() as any;
  if (!settings || settings.account_type !== 'sole_prop') {
    return { error: 'Sole proprietor workspace required', status: 403 as const };
  }
  const profile = await db
    .prepare('SELECT * FROM sole_prop_profile WHERE company_id = ?')
    .bind(companyId)
    .first() as any;
  if (!profile) {
    return { error: 'Sole proprietor profile not found', status: 404 as const };
  }
  return { settings, profile };
}

async function liveDeposits(db: any, companyId: number) {
  const res = await db
    .prepare('SELECT * FROM sole_prop_deposits WHERE company_id = ? ORDER BY received_date ASC, id ASC')
    .bind(companyId)
    .all() as any;
  const rows: any[] = res?.results ?? [];
  return rows.filter((d) => !d.voided);
}

async function buildOverview(db: any, companyId: number, profile: any) {
  const deposits = await liveDeposits(db, companyId);
  const totals = {
    cad: round2(deposits.reduce((s, d) => s + d.cad_amount, 0)),
    tax: round2(deposits.reduce((s, d) => s + d.tax_owed, 0)),
    cpp: round2(deposits.reduce((s, d) => s + d.cpp_owed, 0)),
    cpp2: round2(deposits.reduce((s, d) => s + d.cpp2_owed, 0)),
  };
  const instRes = await db
    .prepare('SELECT * FROM sole_prop_instalments WHERE company_id = ? ORDER BY due_date ASC')
    .bind(companyId)
    .all() as any;
  const gst = gstStatus(
    deposits.map((d) => ({ received_date: d.received_date, cad_amount: d.cad_amount, voided: 0 })),
    todayStr()
  );
  return {
    profile,
    totals,
    deposits: deposits.map((d) => ({
      id: d.id, received_date: d.received_date, foreign_amount: d.foreign_amount,
      currency: d.currency, fx_rate: d.fx_rate, fx_date_used: d.fx_date_used,
      cad_amount: d.cad_amount, tax_owed: d.tax_owed, cpp_owed: d.cpp_owed,
      cpp2_owed: d.cpp2_owed, note: d.note, voided: d.voided,
    })),
    upcoming: instRes?.results ?? [],
    gst: { ...gst, hasBN: !!profile.business_number },
  };
}

async function reallocate(db: any, companyId: number, profile: any) {
  const today = todayStr();
  const deposits = await liveDeposits(db, companyId);
  const startYear = Number(String(profile.start_date).slice(0, 4));
  const annualDue = `${startYear + 1}-04-30`;

  const existingRes = await db
    .prepare('SELECT * FROM sole_prop_instalments WHERE company_id = ?')
    .bind(companyId)
    .all() as any;
  const existing: any[] = existingRes?.results ?? [];

  // The gate: quarterly instalments only exist after the first annual
  // balance (or any quarterly) is paid — mirroring CRA assessment.
  // Until then the annual row is the only row and accumulates everything.
  const gateOpen =
    existing.some((r) => r.kind === 'annual' && r.paid === 1) ||
    existing.some((r) => r.kind === 'quarterly' && r.paid === 1);

  // Rows eligible to receive money: the unpaid annual row plus all
  // unpaid quarterly rows. Paid rows keep their frozen amounts.
  const wanted: { tax_year: number; due_date: string; kind: string }[] = [
    { tax_year: startYear, due_date: annualDue, kind: 'annual' },
  ];
  if (gateOpen) {
    const quarterlies = existing.filter((r) => r.kind === 'quarterly');
    const hasUpcoming = quarterlies.some((r) => r.paid !== 1 && r.due_date >= today);
    if (!hasUpcoming) {
      const latest = quarterlies.map((r) => r.due_date).sort().pop();
      const base = [today, latest ?? today].sort().pop() as string;
      const due = nextQuarterlyAfter(base);
      wanted.push({ tax_year: Number(due.slice(0, 4)), due_date: due, kind: 'quarterly' });
    }
    // Keep overdue unpaid quarterlies as reminders, plus the single horizon row.
    const horizon = wanted.find((w) => w.kind === 'quarterly');
    for (const r of quarterlies) {
      if (r.paid === 1) continue;
      if (r.due_date < today || (horizon && r.due_date === horizon.due_date)) {
        wanted.push({ tax_year: r.tax_year, due_date: r.due_date, kind: 'quarterly' });
      }
    }
  }

  const eligible = wanted.filter((w) => {
    if (w.kind === 'annual') {
      return !existing.some((r) => r.kind === 'annual' && r.due_date === w.due_date && r.paid === 1);
    }
    return true;
  });
  const alloc = allocateToInstalments(
    deposits.map((d) => ({
      received_date: d.received_date,
      tax_owed: d.tax_owed,
      cpp_owed: d.cpp_owed,
      cpp2_owed: d.cpp2_owed,
      voided: 0,
    })),
    eligible.map((w) => ({ tax_year: w.tax_year, due_date: w.due_date, kind: w.kind as 'annual' | 'quarterly' }))
  );
  const wantedDates = new Set(wanted.map((w) => w.due_date));
  for (const row of wanted) {
    await db
      .prepare('INSERT OR IGNORE INTO sole_prop_instalments (company_id, tax_year, due_date, kind) VALUES (?, ?, ?, ?)')
      .bind(companyId, row.tax_year, row.due_date, row.kind)
      .run();
    const a = alloc[row.due_date] ?? { tax: 0, cpp: 0, cpp2: 0, total: 0 };
    await db
      .prepare('UPDATE sole_prop_instalments SET tax_amount = ?, cpp_amount = ?, cpp2_amount = ?, total_amount = ? WHERE company_id = ? AND due_date = ? AND paid = 0')
      .bind(a.tax, a.cpp, a.cpp2, a.total, companyId, row.due_date)
      .run();
  }
  // Prune unpaid rows outside the wanted set (stale rows from earlier
  // scheduling rules). Paid rows are never touched.
  for (const row of existing) {
    if (!row.paid && !wantedDates.has(row.due_date)) {
      await db
        .prepare('DELETE FROM sole_prop_instalments WHERE id = ? AND company_id = ?')
        .bind(row.id, companyId)
        .run();
    }
  }
}

async function fetchCadRate(currency: string, date: string): Promise<{ rate: number; dateUsed: string } | null> {
  const [y, m, d] = date.split('-').map(Number);
  for (let back = 0; back < 5; back++) {
    const ds = new Date(Date.UTC(y, m - 1, d - back)).toISOString().split('T')[0];
    try {
      const res = await fetch(`https://api.frankfurter.dev/v1/${ds}?base=${currency}&symbols=CAD`);
      if (!res.ok) continue;
      const json = (await res.json()) as any;
      const rate = json?.rates?.CAD;
      if (typeof rate === 'number' && rate > 0) return { rate, dateUsed: ds };
    } catch {
      // try the previous day
    }
  }
  return null;
}

function validDate(s: any): boolean {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

// GET /api/soleprop/overview
router.get('/overview', async (c) => {
  const companyId = getCompanyId(c);
  if (!companyId) return c.json({ error: 'Company settings not initialized. Complete onboarding.' }, 404);
  const ws = await loadWorkspace(c.env.DB, companyId);
  if ('error' in ws) return c.json({ error: ws.error }, ws.status);
  return c.json(await buildOverview(c.env.DB, companyId, ws.profile));
});

// GET /api/soleprop/fx-preview?date=YYYY-MM-DD&currency=USD
router.get('/fx-preview', async (c) => {
  const companyId = getCompanyId(c);
  if (!companyId) return c.json({ error: 'Company settings not initialized. Complete onboarding.' }, 404);
  const ws = await loadWorkspace(c.env.DB, companyId);
  if ('error' in ws) return c.json({ error: ws.error }, ws.status);
  const date = c.req.query('date') ?? '';
  const currency = (c.req.query('currency') ?? 'USD').toUpperCase();
  if (!validDate(date)) return c.json({ error: 'Valid date (YYYY-MM-DD) is required' }, 400);
  if (!FX_CURRENCIES.includes(currency)) {
    return c.json({ error: `Currency must be one of ${FX_CURRENCIES.join(', ')}` }, 400);
  }
  if (currency === 'CAD') return c.json({ rate: 1, dateUsed: date, currency });
  const fx = await fetchCadRate(currency, date);
  if (!fx) return c.json({ error: 'Exchange rate unavailable. Enter the rate manually.' }, 502);
  return c.json({ rate: fx.rate, dateUsed: fx.dateUsed, currency });
});

export interface DepositInput {
  received_date: string;
  foreign_amount: number;
  currency: string;
  fx_rate?: number | null;
  note?: string | null;
  wiseKey?: string | null;
}

export class DepositError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

// Shared by manual entry and Wise sync: resolves FX, computes obligations
// incrementally, stores the deposit, and reallocates instalments.
export async function recordDeposit(db: any, companyId: number, profile: any, input: DepositInput) {
  const { received_date, foreign_amount, currency } = input;
  const amount = Number(foreign_amount);
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new DepositError(400, 'foreign_amount must be a positive number');
  }
  let rate = Number(input.fx_rate);
  let dateUsed = received_date;
  if (currency === 'CAD' && (input.fx_rate === undefined || input.fx_rate === null || (input.fx_rate as any) === '')) {
    rate = 1;
  } else if (input.fx_rate === undefined || input.fx_rate === null || (input.fx_rate as any) === '') {
    const fx = await fetchCadRate(currency, received_date);
    if (!fx) throw new DepositError(502, 'Exchange rate unavailable. Enter the rate manually.');
    rate = fx.rate;
    dateUsed = fx.dateUsed;
  } else if (!Number.isFinite(rate) || rate <= 0) {
    throw new DepositError(400, 'fx_rate must be a positive number');
  }

  const cadAmount = round2(amount * rate);
  const prior = await liveDeposits(db, companyId);
  const priorCad = round2(prior.reduce((s, d) => s + d.cad_amount, 0));
  const priorTax = round2(prior.reduce((s, d) => s + d.tax_owed, 0));
  const priorCpp = round2(prior.reduce((s, d) => s + d.cpp_owed, 0));
  const priorCpp2 = round2(prior.reduce((s, d) => s + d.cpp2_owed, 0));

  const owed = calculateSolePropObligations({
    cumulativeCad: round2(priorCad + cadAmount),
    priorTax,
    priorCpp,
    priorCpp2,
    ytdPensionableOpening: profile.ytd_pensionable_opening ?? 0,
    ytdCppOpening: profile.ytd_cpp_opening ?? 0,
    ytdCpp2Opening: profile.ytd_cpp2_opening ?? 0,
    taxYear: Number(received_date.slice(0, 4)),
  });

  const inserted = await db.prepare(`
    INSERT INTO sole_prop_deposits
      (company_id, received_date, foreign_amount, currency, fx_rate, fx_date_used, cad_amount, tax_owed, cpp_owed, cpp2_owed, note, wise_transfer_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    companyId, received_date, amount, currency, rate, dateUsed, cadAmount,
    owed.incomeTax, owed.cpp, owed.cpp2, input.note ?? null, input.wiseKey ?? null
  ).run();

  await reallocate(db, companyId, profile);

  return db.prepare(
    'SELECT * FROM sole_prop_deposits WHERE id = ? AND company_id = ?'
  ).bind(inserted.meta.last_row_id, companyId).first();
}

// POST /api/soleprop/deposits
router.post('/deposits', async (c) => {
  try {
    const companyId = getCompanyId(c);
    if (!companyId) return c.json({ error: 'Company settings not initialized. Complete onboarding.' }, 404);
    const ws = await loadWorkspace(c.env.DB, companyId);
    if ('error' in ws) return c.json({ error: ws.error }, ws.status);
    const { profile } = ws;

    const { received_date, foreign_amount, currency: rawCurrency, fx_rate, note } = await c.req.json();
    if (!validDate(received_date)) return c.json({ error: 'Valid received_date (YYYY-MM-DD) is required' }, 400);
    const currency = String(rawCurrency ?? 'USD').toUpperCase();
    if (!FX_CURRENCIES.includes(currency)) {
      return c.json({ error: `Currency must be one of ${FX_CURRENCIES.join(', ')}` }, 400);
    }

    try {
      const deposit = await recordDeposit(c.env.DB, companyId, profile, {
        received_date, foreign_amount: Number(foreign_amount), currency, fx_rate, note,
      });
      return c.json({ deposit, overview: await buildOverview(c.env.DB, companyId, profile) });
    } catch (e: any) {
      if (e instanceof DepositError) return c.json({ error: e.message }, e.status as any);
      throw e;
    }
  } catch (error: any) {
    return c.json({ error: error.message }, 500);
  }
});

// POST /api/soleprop/deposits/:id/void
router.post('/deposits/:id/void', async (c) => {
  try {
    const companyId = getCompanyId(c);
    if (!companyId) return c.json({ error: 'Company settings not initialized. Complete onboarding.' }, 404);
    const ws = await loadWorkspace(c.env.DB, companyId);
    if ('error' in ws) return c.json({ error: ws.error }, ws.status);
    const id = Number(c.req.param('id'));
    const deposit = await c.env.DB.prepare(
      'SELECT * FROM sole_prop_deposits WHERE id = ? AND company_id = ?'
    ).bind(id, companyId).first() as any;
    if (!deposit) return c.json({ error: 'Deposit not found' }, 404);
    await c.env.DB.prepare(
      'UPDATE sole_prop_deposits SET voided = 1 WHERE id = ? AND company_id = ?'
    ).bind(id, companyId).run();
    await reallocate(c.env.DB, companyId, ws.profile);
    return c.json({ overview: await buildOverview(c.env.DB, companyId, ws.profile) });
  } catch (error: any) {
    return c.json({ error: error.message }, 500);
  }
});

// POST /api/soleprop/instalments/:id/pay
router.post('/instalments/:id/pay', async (c) => {
  try {
    const companyId = getCompanyId(c);
    if (!companyId) return c.json({ error: 'Company settings not initialized. Complete onboarding.' }, 404);
    const ws = await loadWorkspace(c.env.DB, companyId);
    if ('error' in ws) return c.json({ error: ws.error }, ws.status);
    const id = Number(c.req.param('id'));
    const instalment = await c.env.DB.prepare(
      'SELECT * FROM sole_prop_instalments WHERE id = ? AND company_id = ?'
    ).bind(id, companyId).first() as any;
    if (!instalment) return c.json({ error: 'Instalment not found' }, 404);
    if (!instalment.paid) {
      const body = await c.req.json().catch(() => ({}));
      const paidDate = validDate(body?.paid_date) ? body.paid_date : todayStr();
      await c.env.DB.prepare(
        'UPDATE sole_prop_instalments SET paid = 1, paid_date = ? WHERE id = ? AND company_id = ?'
      ).bind(paidDate, id, companyId).run();
      await c.env.DB.prepare(`
        INSERT INTO remittance_payments (company_id, type, payment_date, amount, period_end)
        VALUES (?, 'INSTALMENT', ?, ?, ?)
      `).bind(companyId, paidDate, instalment.total_amount, instalment.due_date).run();
    }
    // Paying the annual balance opens the quarterly gate: materialize the
    // next quarterly row (and prune anything stale) right away.
    await reallocate(c.env.DB, companyId, ws.profile);
    const updated = await c.env.DB.prepare(
      'SELECT * FROM sole_prop_instalments WHERE id = ? AND company_id = ?'
    ).bind(id, companyId).first();
    return c.json({ instalment: updated });
  } catch (error: any) {
    return c.json({ error: error.message }, 500);
  }
});

// PUT /api/soleprop/profile
router.put('/profile', async (c) => {
  try {
    const companyId = getCompanyId(c);
    if (!companyId) return c.json({ error: 'Company settings not initialized. Complete onboarding.' }, 404);
    const ws = await loadWorkspace(c.env.DB, companyId);
    if ('error' in ws) return c.json({ error: ws.error }, ws.status);
    const { business_number } = await c.req.json();
    const digits = String(business_number ?? '').replace(/\D/g, '');
    if (digits.length !== 9) {
      return c.json({ error: 'Business number must be 9 digits' }, 400);
    }
    await c.env.DB.prepare(
      'UPDATE sole_prop_profile SET business_number = ? WHERE company_id = ?'
    ).bind(digits, companyId).run();
    const profile = await c.env.DB.prepare(
      'SELECT * FROM sole_prop_profile WHERE company_id = ?'
    ).bind(companyId).first();
    return c.json({ profile });
  } catch (error: any) {
    return c.json({ error: error.message }, 500);
  }
});

// Wise personal-token storage. The token is validated live against Wise,
// stored AES-GCM encrypted (same crypto.ts + JWT_SECRET precedent as Gmail
// refresh tokens), and never returned by any endpoint — only metadata.
async function validateWiseToken(token: string): Promise<{ ok: boolean; profiles: number }> {
  try {
    const res = await fetch('https://api.wise.com/v1/profiles', {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return { ok: false, profiles: 0 };
    const json = (await res.json()) as unknown;
    return { ok: true, profiles: Array.isArray(json) ? json.length : 0 };
  } catch {
    return { ok: false, profiles: 0 };
  }
}

async function wiseStatus(db: any, companyId: number) {
  const row = (await db
    .prepare('SELECT * FROM wise_tokens WHERE company_id = ?')
    .bind(companyId)
    .first()) as any;
  if (!row) return { connected: false, last4: null, label: null, updated_at: null };
  return { connected: true, last4: row.last4, label: row.label ?? null, updated_at: row.updated_at };
}

// GET /api/soleprop/wise/status
router.get('/wise/status', async (c) => {
  const companyId = getCompanyId(c);
  if (!companyId) return c.json({ error: 'Company settings not initialized. Complete onboarding.' }, 404);
  const ws = await loadWorkspace(c.env.DB, companyId);
  if ('error' in ws) return c.json({ error: ws.error }, ws.status);
  return c.json(await wiseStatus(c.env.DB, companyId));
});

// POST /api/soleprop/wise/token — validate live, then store encrypted
router.post('/wise/token', async (c) => {
  try {
    const companyId = getCompanyId(c);
    if (!companyId) return c.json({ error: 'Company settings not initialized. Complete onboarding.' }, 404);
    const ws = await loadWorkspace(c.env.DB, companyId);
    if ('error' in ws) return c.json({ error: ws.error }, ws.status);
    if (!c.env.JWT_SECRET) return c.json({ error: 'Server encryption secret is not configured.' }, 500);
    const { token, label } = await c.req.json();
    if (typeof token !== 'string' || token.trim().length < 8) {
      return c.json({ error: 'A valid Wise personal token is required.' }, 400);
    }
    const check = await validateWiseToken(token.trim());
    if (!check.ok) return c.json({ error: 'Wise rejected this token. Check it has read access and try again.' }, 400);
    const encrypted = await encryptText(token.trim(), c.env.JWT_SECRET);
    const now = new Date().toISOString();
    await c.env.DB.prepare(`
      INSERT INTO wise_tokens (company_id, encrypted_token, last4, label, updated_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(company_id) DO UPDATE SET
        encrypted_token = excluded.encrypted_token,
        last4 = excluded.last4,
        label = excluded.label,
        updated_at = excluded.updated_at
    `).bind(companyId, encrypted, token.trim().slice(-4), String(label ?? '').slice(0, 60) || null, now).run();
    return c.json(await wiseStatus(c.env.DB, companyId));
  } catch (error: any) {
    return c.json({ error: error.message }, 500);
  }
});

// POST /api/soleprop/wise/test — re-validate the stored token
router.post('/wise/test', async (c) => {
  try {
    const companyId = getCompanyId(c);
    if (!companyId) return c.json({ error: 'Company settings not initialized. Complete onboarding.' }, 404);
    const ws = await loadWorkspace(c.env.DB, companyId);
    if ('error' in ws) return c.json({ error: ws.error }, ws.status);
    if (!c.env.JWT_SECRET) return c.json({ error: 'Server encryption secret is not configured.' }, 500);
    const row = (await c.env.DB
      .prepare('SELECT * FROM wise_tokens WHERE company_id = ?')
      .bind(companyId)
      .first()) as any;
    if (!row) return c.json({ error: 'No Wise token saved.' }, 404);
    const check = await validateWiseToken(await decryptText(row.encrypted_token, c.env.JWT_SECRET));
    if (!check.ok) return c.json({ error: 'Stored Wise token is no longer valid.' }, 400);
    return c.json({ ok: true, profiles: check.profiles });
  } catch (error: any) {
    return c.json({ error: error.message }, 500);
  }
});

// DELETE /api/soleprop/wise/token
router.delete('/wise/token', async (c) => {
  try {
    const companyId = getCompanyId(c);
    if (!companyId) return c.json({ error: 'Company settings not initialized. Complete onboarding.' }, 404);
    const ws = await loadWorkspace(c.env.DB, companyId);
    if ('error' in ws) return c.json({ error: ws.error }, ws.status);
    await c.env.DB.prepare('DELETE FROM wise_tokens WHERE company_id = ?').bind(companyId).run();
    return c.json(await wiseStatus(c.env.DB, companyId));
  } catch (error: any) {
    return c.json({ error: error.message }, 500);
  }
});

// ---- Wise statement sync ----

async function getWiseContext(db: any, companyId: number, jwtSecret: string) {
  const ws = await loadWorkspace(db, companyId);
  if ('error' in ws) throw new DepositError(ws.status, ws.error);
  if (!jwtSecret) throw new DepositError(500, 'Server encryption secret is not configured.');
  const tokenRow = (await db
    .prepare('SELECT * FROM wise_tokens WHERE company_id = ?')
    .bind(companyId)
    .first()) as any;
  if (!tokenRow) throw new DepositError(404, 'No Wise token saved.');
  const token = await decryptText(tokenRow.encrypted_token, jwtSecret);
  return { profile: ws.profile, tokenRow, token };
}

async function importedWiseKeys(db: any, companyId: number): Promise<Set<string>> {
  const res = (await db
    .prepare('SELECT wise_transfer_id FROM sole_prop_deposits WHERE company_id = ? AND wise_transfer_id IS NOT NULL')
    .bind(companyId)
    .all()) as any;
  return new Set((res?.results ?? []).map((r: any) => r.wise_transfer_id));
}

// GET /api/soleprop/wise/preview?days=90&currency=USD — list incoming credits, no writes
router.get('/wise/preview', async (c) => {
  try {
    const companyId = getCompanyId(c);
    if (!companyId) return c.json({ error: 'Company settings not initialized. Complete onboarding.' }, 404);
    const { tokenRow, token } = await getWiseContext(c.env.DB, companyId, c.env.JWT_SECRET);
    const days = Math.min(Math.max(Number(c.req.query('days')) || 90, 1), 365);
    const currency = String(c.req.query('currency') ?? 'USD').toUpperCase();
    const credits = await fetchCredits(token, { currency, days });
    const imported = await importedWiseKeys(c.env.DB, companyId);
    return c.json({
      employer: tokenRow.employer_key
        ? { key: tokenRow.employer_key, label: tokenRow.employer_label }
        : null,
      autoSync: tokenRow.auto_sync === 1,
      candidates: credits.map((cr) => ({ ...cr, alreadyImported: imported.has(cr.key) })),
    });
  } catch (error: any) {
    if (error instanceof DepositError) return c.json({ error: error.message }, error.status as any);
    if (error instanceof WiseApiError) return c.json({ error: error.message }, error.status as any);
    return c.json({ error: error.message }, 500);
  }
});

// POST /api/soleprop/wise/import { keys[], employerKey?, employerLabel? }
router.post('/wise/import', async (c) => {
  try {
    const companyId = getCompanyId(c);
    if (!companyId) return c.json({ error: 'Company settings not initialized. Complete onboarding.' }, 404);
    const { profile, token } = await getWiseContext(c.env.DB, companyId, c.env.JWT_SECRET);
    const { keys, employerKey, employerLabel } = await c.req.json();
    if (!Array.isArray(keys) || keys.length === 0 || keys.length > 100) {
      return c.json({ error: 'Select 1–100 transfers to import.' }, 400);
    }
    const credits = await fetchCredits(token, { days: 365 });
    const byKey = new Map(credits.map((cr) => [cr.key, cr]));
    const imported = await importedWiseKeys(c.env.DB, companyId);
    let count = 0;
    for (const key of keys) {
      const cr = byKey.get(String(key));
      if (!cr || imported.has(cr.key)) continue;
      try {
        await recordDeposit(c.env.DB, companyId, profile, {
          received_date: cr.date,
          foreign_amount: cr.amount,
          currency: cr.currency,
          note: `Wise import — ${cr.sender}`,
          wiseKey: cr.key,
        });
        imported.add(cr.key);
        count += 1;
      } catch {
        // FX outage on one row must not abort the batch; user retries.
        continue;
      }
    }
    if (employerKey) {
      await c.env.DB.prepare(
        'UPDATE wise_tokens SET employer_key = ?, employer_label = ? WHERE company_id = ?'
      ).bind(
        normalizeSender(String(employerKey)),
        String(employerLabel ?? employerKey).slice(0, 120),
        companyId
      ).run();
    }
    return c.json({ imported: count, overview: await buildOverview(c.env.DB, companyId, profile) });
  } catch (error: any) {
    if (error instanceof DepositError) return c.json({ error: error.message }, error.status as any);
    if (error instanceof WiseApiError) return c.json({ error: error.message }, error.status as any);
    return c.json({ error: error.message }, 500);
  }
});

// PUT /api/soleprop/wise/auto-sync { enabled }
router.put('/wise/auto-sync', async (c) => {
  try {
    const companyId = getCompanyId(c);
    if (!companyId) return c.json({ error: 'Company settings not initialized. Complete onboarding.' }, 404);
    const ws = await loadWorkspace(c.env.DB, companyId);
    if ('error' in ws) return c.json({ error: ws.error }, ws.status);
    const { enabled } = await c.req.json();
    const tokenRow = (await c.env.DB
      .prepare('SELECT * FROM wise_tokens WHERE company_id = ?')
      .bind(companyId)
      .first()) as any;
    if (!tokenRow) return c.json({ error: 'No Wise token saved.' }, 404);
    if (enabled && !tokenRow.employer_key) {
      return c.json({ error: 'Pick your employer from a sync preview first — auto-sync only imports their transfers.' }, 400);
    }
    await c.env.DB.prepare(
      'UPDATE wise_tokens SET auto_sync = ?, last_sync_at = ? WHERE company_id = ?'
    ).bind(enabled ? 1 : 0, enabled ? todayStr() : tokenRow.last_sync_at, companyId).run();
    return c.json(await wiseStatus(c.env.DB, companyId));
  } catch (error: any) {
    return c.json({ error: error.message }, 500);
  }
});

// Shared by the run-now route and the daily cron: import new employer
// credits since the last sync. Returns counts per company.
export async function runWiseAutoSync(env: any, onlyCompanyId?: number) {
  const res = (await env.DB.prepare(`
    SELECT cs.id AS company_id, wt.* FROM company_settings cs
    JOIN wise_tokens wt ON wt.company_id = cs.id
    WHERE cs.account_type = 'sole_prop' AND wt.auto_sync = 1 AND wt.employer_key IS NOT NULL
    ${onlyCompanyId ? 'AND cs.id = ?' : ''}
  `).bind(...(onlyCompanyId ? [onlyCompanyId] : [])).all()) as any;
  const results: { companyId: number; imported: number }[] = [];
  for (const row of res?.results ?? []) {
    const companyId = row.company_id;
    try {
      const profile = (await env.DB
        .prepare('SELECT * FROM sole_prop_profile WHERE company_id = ?')
        .bind(companyId)
        .first()) as any;
      if (!profile) continue;
      const token = await decryptText(row.encrypted_token, env.JWT_SECRET);
      const since = row.last_sync_at ?? new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
      const credits = await fetchCredits(token, { since });
      const imported = await importedWiseKeys(env.DB, companyId);
      let count = 0;
      for (const cr of credits.filter((cc) => cc.senderKey === row.employer_key)) {
        if (imported.has(cr.key)) continue;
        try {
          await recordDeposit(env.DB, companyId, profile, {
            received_date: cr.date,
            foreign_amount: cr.amount,
            currency: cr.currency,
            note: `Wise auto-sync — ${cr.sender}`,
            wiseKey: cr.key,
          });
          imported.add(cr.key);
          count += 1;
        } catch {
          continue;
        }
      }
      await env.DB.prepare('UPDATE wise_tokens SET last_sync_at = ? WHERE company_id = ?')
        .bind(todayStr(), companyId)
        .run();
      results.push({ companyId, imported: count });
    } catch {
      // One company's revoked token must not abort the rest.
      continue;
    }
  }
  return results;
}

// POST /api/soleprop/wise/run-now — manual trigger of this company's auto-sync
router.post('/wise/run-now', async (c) => {
  try {
    const companyId = getCompanyId(c);
    if (!companyId) return c.json({ error: 'Company settings not initialized. Complete onboarding.' }, 404);
    const ws = await loadWorkspace(c.env.DB, companyId);
    if ('error' in ws) return c.json({ error: ws.error }, ws.status);
    const results = await runWiseAutoSync(c.env as any, companyId);
    return c.json({
      imported: results.find((r) => r.companyId === companyId)?.imported ?? 0,
      overview: await buildOverview(c.env.DB, companyId, ws.profile),
    });
  } catch (error: any) {
    return c.json({ error: error.message }, 500);
  }
});

export default router;
