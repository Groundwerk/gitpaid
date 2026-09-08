import { Hono } from 'hono';
import { encryptText, decryptText } from '../utils/crypto';
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
    const amount = Number(foreign_amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      return c.json({ error: 'foreign_amount must be a positive number' }, 400);
    }
    const currency = String(rawCurrency ?? 'USD').toUpperCase();
    if (!FX_CURRENCIES.includes(currency)) {
      return c.json({ error: `Currency must be one of ${FX_CURRENCIES.join(', ')}` }, 400);
    }

    let rate = Number(fx_rate);
    let dateUsed = received_date;
    if (currency === 'CAD' && (fx_rate === undefined || fx_rate === null || fx_rate === '')) {
      rate = 1;
    } else if (fx_rate === undefined || fx_rate === null || fx_rate === '') {
      const fx = await fetchCadRate(currency, received_date);
      if (!fx) return c.json({ error: 'Exchange rate unavailable. Enter the rate manually.' }, 502);
      rate = fx.rate;
      dateUsed = fx.dateUsed;
    } else if (!Number.isFinite(rate) || rate <= 0) {
      return c.json({ error: 'fx_rate must be a positive number' }, 400);
    }

    const cadAmount = round2(amount * rate);
    const prior = await liveDeposits(c.env.DB, companyId);
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

    const inserted = await c.env.DB.prepare(`
      INSERT INTO sole_prop_deposits
        (company_id, received_date, foreign_amount, currency, fx_rate, fx_date_used, cad_amount, tax_owed, cpp_owed, cpp2_owed, note)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      companyId, received_date, amount, currency, rate, dateUsed, cadAmount,
      owed.incomeTax, owed.cpp, owed.cpp2, note ?? null
    ).run();

    await reallocate(c.env.DB, companyId, profile);

    const deposit = await c.env.DB.prepare(
      'SELECT * FROM sole_prop_deposits WHERE id = ? AND company_id = ?'
    ).bind(inserted.meta.last_row_id, companyId).first();

    return c.json({ deposit, overview: await buildOverview(c.env.DB, companyId, profile) });
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

export default router;
