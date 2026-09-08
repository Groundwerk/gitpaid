import { describe, expect, it, vi, beforeEach } from 'vitest';
import { sign } from 'hono/jwt';
import app from '../index';

const SECRET = 'test-secret-12345';

function makeState() {
  return {
    settings: { id: 1, legal_name: 'Jane Doe', business_number: null, account_type: 'sole_prop' },
    profile: {
      id: 1, company_id: 1, business_number: null, start_date: '2026-08-15',
      province: 'ON', ytd_pensionable_opening: 0, ytd_cpp_opening: 0,
      ytd_cpp2_opening: 0, instalment_mode: 'quarterly',
    },
    deposits: [] as any[],
    instalments: [] as any[],
    remittances: [] as any[],
    ids: { deposit: 0, instalment: 0, remittance: 0 },
  };
}
let state = makeState();

const mockDb = {
  prepare: (sql: string) => ({
    bind: (...args: any[]) => ({
      first: async () => {
        if (sql.includes('FROM company_settings')) return state.settings;
        if (sql.includes('FROM sole_prop_profile')) return state.profile;
        if (sql.includes('FROM sole_prop_deposits WHERE id')) {
          return state.deposits.find((d) => d.id === args[0] && d.company_id === args[1]) ?? null;
        }
        if (sql.includes('FROM sole_prop_instalments WHERE id')) {
          return state.instalments.find((r) => r.id === args[0] && r.company_id === args[1]) ?? null;
        }
        return null;
      },
      all: async () => {
        if (sql.includes('FROM sole_prop_deposits')) {
          return { results: state.deposits.filter((d) => d.company_id === args[0]) };
        }
        if (sql.includes('FROM sole_prop_instalments')) {
          return { results: state.instalments.filter((r) => r.company_id === args[0]) };
        }
        return { results: [] };
      },
      run: async () => {
        if (sql.includes('INSERT INTO company_settings')) {
          return { success: true, meta: { last_row_id: 1 } };
        }
        if (sql.includes('INSERT INTO sole_prop_profile')) {
          state.profile = {
            id: 1, company_id: args[0], business_number: args[1], start_date: args[2],
            province: 'ON', ytd_pensionable_opening: args[3], ytd_cpp_opening: args[4],
            ytd_cpp2_opening: args[5], instalment_mode: 'quarterly',
          };
          return { success: true, meta: {} };
        }
        if (sql.includes('INSERT INTO sole_prop_deposits')) {
          const id = ++state.ids.deposit;
          state.deposits.push({
            id, company_id: args[0], received_date: args[1], foreign_amount: args[2],
            currency: args[3], fx_rate: args[4], fx_date_used: args[5], cad_amount: args[6],
            tax_owed: args[7], cpp_owed: args[8], cpp2_owed: args[9], note: args[10] ?? null,
            voided: 0,
          });
          return { success: true, meta: { last_row_id: id } };
        }
        if (sql.includes('SET voided = 1')) {
          const d = state.deposits.find((x) => x.id === args[0] && x.company_id === args[1]);
          if (d) d.voided = 1;
          return { success: true, meta: {} };
        }
        if (sql.includes('INSERT OR IGNORE INTO sole_prop_instalments')) {
          const exists = state.instalments.some((r) => r.company_id === args[0] && r.due_date === args[2]);
          if (!exists) {
            state.instalments.push({
              id: ++state.ids.instalment, company_id: args[0], tax_year: args[1],
              due_date: args[2], kind: args[3], tax_amount: 0, cpp_amount: 0,
              cpp2_amount: 0, total_amount: 0, paid: 0, paid_date: null,
            });
          }
          return { success: true, meta: {} };
        }
        if (sql.includes('SET tax_amount')) {
          const r = state.instalments.find((x) => x.company_id === args[4] && x.due_date === args[5] && x.paid === 0);
          if (r) {
            r.tax_amount = args[0]; r.cpp_amount = args[1];
            r.cpp2_amount = args[2]; r.total_amount = args[3];
          }
          return { success: true, meta: {} };
        }
        if (sql.includes('SET paid = 1')) {
          const r = state.instalments.find((x) => x.id === args[1] && x.company_id === args[2]);
          if (r) { r.paid = 1; r.paid_date = args[0]; }
          return { success: true, meta: {} };
        }
        if (sql.includes('DELETE FROM sole_prop_instalments')) {
          state.instalments = state.instalments.filter((x) => !(x.id === args[0] && x.company_id === args[1]));
          return { success: true, meta: {} };
        }
        if (sql.includes('INSERT INTO remittance_payments')) {
          state.remittances.push({
            id: ++state.ids.remittance, company_id: args[0], type: 'INSTALMENT',
            payment_date: args[1], amount: args[2], period_end: args[3],
          });
          return { success: true, meta: {} };
        }
      },
    }),
  }),
};

const testEnv = {
  DB: mockDb as any,
  JWT_SECRET: SECRET,
  GOOGLE_CLIENT_ID: 'test-client-id',
  ALLOW_MOCK_LOGIN: 'true',
};

async function authHeaders() {
  const token = await sign(
    { email: 'jane@example.com', name: 'Jane', companyId: 1, exp: Math.floor(Date.now() / 1000) + 100 },
    SECRET
  );
  return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
}

const okFx = async (url: string) => {
  if (String(url).includes('frankfurter')) {
    return { ok: true, json: async () => ({ rates: { CAD: 1.38 } }) } as any;
  }
  throw new Error('unexpected fetch ' + url);
};

describe('soleprop routes', () => {
  beforeEach(() => {
    state = makeState();
    vi.stubGlobal('fetch', okFx);
  });

  it('rejects company workspaces with 403', async () => {
    state.settings.account_type = 'company';
    const res = await app.request('/api/soleprop/overview', { headers: await authHeaders() }, testEnv);
    expect(res.status).toBe(403);
  });

  it('creates a deposit with fetched FX and incremental obligations', async () => {
    const res = await app.request('/api/soleprop/deposits', {
      method: 'POST',
      headers: await authHeaders(),
      body: JSON.stringify({ received_date: '2026-09-01', foreign_amount: 5000, currency: 'USD' }),
    }, testEnv);
    expect(res.status).toBe(200);
    const json = await res.json() as any;
    // 5000 x 1.38 = 6900 CAD; below BPA so no tax; CPP (6900-3500)=3400 x11.9% = 404.60
    expect(json.deposit.cad_amount).toBe(6900);
    expect(json.deposit.fx_rate).toBe(1.38);
    expect(json.deposit.fx_date_used).toBe('2026-09-01');
    expect(json.deposit.tax_owed).toBe(0);
    expect(json.deposit.cpp_owed).toBe(404.6);
    const annual = json.overview.upcoming.find((r: any) => r.due_date === '2027-04-30');
    expect(annual.total_amount).toBe(404.6);
  });

  it('second deposit stores only the increment', async () => {
    const headers = await authHeaders();
    await app.request('/api/soleprop/deposits', {
      method: 'POST', headers,
      body: JSON.stringify({ received_date: '2026-09-01', foreign_amount: 5000, currency: 'USD' }),
    }, testEnv);
    const res = await app.request('/api/soleprop/deposits', {
      method: 'POST', headers,
      body: JSON.stringify({ received_date: '2026-10-01', foreign_amount: 10000, currency: 'USD' }),
    }, testEnv);
    const json = await res.json() as any;
    // cumulative 20700: fed (20700-16452)=4248 x14% = 594.72;
    // ont (20700-12989)=7711 x5.05% = 389.4055; engine rounds sum 984.1255 -> 984.13
    expect(json.deposit.tax_owed).toBe(984.13);
    // CPP cumulative (20700-3500)=17200 x11.9% = 2046.80 minus prior 404.60
    expect(json.deposit.cpp_owed).toBe(1642.2);
  });

  it('over-max CPP openings zero out CPP owed', async () => {
    state.profile.ytd_pensionable_opening = 190000;
    state.profile.ytd_cpp_opening = 8460.9;
    state.profile.ytd_cpp2_opening = 832;
    const res = await app.request('/api/soleprop/deposits', {
      method: 'POST',
      headers: await authHeaders(),
      body: JSON.stringify({ received_date: '2026-09-01', foreign_amount: 5000, currency: 'USD' }),
    }, testEnv);
    const json = await res.json() as any;
    expect(json.deposit.cpp_owed).toBe(0);
    expect(json.deposit.cpp2_owed).toBe(0);
  });

  it('void excludes the deposit and reallocates', async () => {
    const headers = await authHeaders();
    await app.request('/api/soleprop/deposits', {
      method: 'POST', headers,
      body: JSON.stringify({ received_date: '2026-09-01', foreign_amount: 5000, currency: 'USD' }),
    }, testEnv);
    const second = await app.request('/api/soleprop/deposits', {
      method: 'POST', headers,
      body: JSON.stringify({ received_date: '2026-10-01', foreign_amount: 10000, currency: 'USD' }),
    }, testEnv);
    const secondId = ((await second.json()) as any).deposit.id;
    const res = await app.request(`/api/soleprop/deposits/${secondId}/void`, {
      method: 'POST', headers,
    }, testEnv);
    expect(res.status).toBe(200);
    const json = await res.json() as any;
    expect(json.overview.totals.cad).toBe(6900);
    const annual = json.overview.upcoming.find((r: any) => r.due_date === '2027-04-30');
    expect(annual.total_amount).toBe(404.6);
  });

  it('pay marks instalment and mirrors remittance_payments', async () => {
    const headers = await authHeaders();
    const created = await app.request('/api/soleprop/deposits', {
      method: 'POST', headers,
      body: JSON.stringify({ received_date: '2026-09-01', foreign_amount: 5000, currency: 'USD' }),
    }, testEnv);
    const annual = ((await created.json()) as any).overview.upcoming.find((r: any) => r.due_date === '2027-04-30');
    const res = await app.request(`/api/soleprop/instalments/${annual.id}/pay`, {
      method: 'POST', headers, body: JSON.stringify({ paid_date: '2027-04-15' }),
    }, testEnv);
    expect(res.status).toBe(200);
    const json = await res.json() as any;
    expect(json.instalment.paid).toBe(1);
    expect(json.instalment.paid_date).toBe('2027-04-15');
    expect(state.remittances).toHaveLength(1);
    expect(state.remittances[0].type).toBe('INSTALMENT');
    expect(state.remittances[0].amount).toBe(404.6);
  });

  it('fx-preview returns 502 when frankfurter is down', async () => {
    vi.stubGlobal('fetch', async () => ({ ok: false, status: 500, json: async () => ({}) } as any));
    const res = await app.request(
      '/api/soleprop/fx-preview?date=2026-09-01&currency=USD',
      { headers: await authHeaders() },
      testEnv
    );
    expect(res.status).toBe(502);
  });

  it('onboards a sole proprietor without a business number', async () => {
    const token = await sign(
      { email: 'new@example.com', name: 'New', companyId: null, exp: Math.floor(Date.now() / 1000) + 100 },
      SECRET
    );
    const res = await app.request('/api/settings', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        legal_name: 'Jane Doe Sole Prop',
        account_type: 'sole_prop',
        sole_prop_start_date: '2026-08-15',
        sole_prop_ytd_pensionable: 190000,
        sole_prop_ytd_cpp: 8460.9,
        sole_prop_ytd_cpp2: 832,
      }),
    }, testEnv);
    expect(res.status).toBe(200);
    const json = await res.json() as any;
    expect(json.companyId).toBe(1);
    expect(json.token).toBeDefined();
    expect(state.profile.start_date).toBe('2026-08-15');
    expect(state.profile.ytd_cpp_opening).toBe(8460.9);
    expect(state.profile.business_number).toBeNull();
  });
  it('shows only the annual row until it is paid', async () => {
    const res = await app.request('/api/soleprop/deposits', {
      method: 'POST',
      headers: await authHeaders(),
      body: JSON.stringify({ received_date: '2026-09-01', foreign_amount: 5000, currency: 'USD' }),
    }, testEnv);
    const json = await res.json() as any;
    expect(json.overview.upcoming).toHaveLength(1);
    expect(json.overview.upcoming[0]).toMatchObject({ kind: 'annual', due_date: '2027-04-30' });
  });

  it('opens the quarterly gate once the annual balance is paid', async () => {
    const headers = await authHeaders();
    const created = await app.request('/api/soleprop/deposits', {
      method: 'POST', headers,
      body: JSON.stringify({ received_date: '2026-09-01', foreign_amount: 5000, currency: 'USD' }),
    }, testEnv);
    const annual = ((await created.json()) as any).overview.upcoming[0];
    const paid = await app.request(`/api/soleprop/instalments/${annual.id}/pay`, {
      method: 'POST', headers, body: JSON.stringify({ paid_date: '2027-04-15' }),
    }, testEnv);
    expect(paid.status).toBe(200);
    const overviewRes = await app.request('/api/soleprop/overview', { headers }, testEnv);
    const overview = ((await overviewRes.json()) as any);
    const quarterlies = overview.upcoming.filter((r: any) => r.kind === 'quarterly');
    expect(quarterlies).toHaveLength(1);
    const today = new Date().toISOString().split('T')[0];
    for (const q of quarterlies) expect(q.due_date > today).toBe(true);
  });
  it('prunes stale future rows but keeps paid ones', async () => {
    const headers = await authHeaders();
    await app.request('/api/soleprop/deposits', {
      method: 'POST', headers,
      body: JSON.stringify({ received_date: '2026-09-01', foreign_amount: 5000, currency: 'USD' }),
    }, testEnv);
    state.instalments.push(
      { id: 900, company_id: 1, tax_year: 2099, due_date: '2099-03-15', kind: 'quarterly', tax_amount: 0, cpp_amount: 0, cpp2_amount: 0, total_amount: 0, paid: 0, paid_date: null },
      { id: 901, company_id: 1, tax_year: 2099, due_date: '2099-06-15', kind: 'quarterly', tax_amount: 10, cpp_amount: 0, cpp2_amount: 0, total_amount: 10, paid: 1, paid_date: '2099-06-01' },
    );
    const res = await app.request('/api/soleprop/deposits', {
      method: 'POST', headers,
      body: JSON.stringify({ received_date: '2026-10-01', foreign_amount: 1000, currency: 'USD' }),
    }, testEnv);
    const json = await res.json() as any;
    const dueDates = json.overview.upcoming.map((r: any) => r.due_date);
    expect(dueDates).not.toContain('2099-03-15');
    expect(dueDates).toContain('2099-06-15');
  });

  it('records CAD deposits at par without fetching FX', async () => {
    let fetched = 0;
    vi.stubGlobal('fetch', async () => { fetched += 1; return { ok: true, json: async () => ({ rates: { CAD: 1.38 } }) } as any; });
    const res = await app.request('/api/soleprop/deposits', {
      method: 'POST',
      headers: await authHeaders(),
      body: JSON.stringify({ received_date: '2026-09-01', foreign_amount: 1000, currency: 'CAD' }),
    }, testEnv);
    expect(res.status).toBe(200);
    const json = await res.json() as any;
    expect(json.deposit.fx_rate).toBe(1);
    expect(json.deposit.cad_amount).toBe(1000);
    expect(fetched).toBe(0);
  });

  it('accepts other frankfurter currencies', async () => {
    const res = await app.request('/api/soleprop/deposits', {
      method: 'POST',
      headers: await authHeaders(),
      body: JSON.stringify({ received_date: '2026-09-01', foreign_amount: 100000, currency: 'JPY' }),
    }, testEnv);
    expect(res.status).toBe(200);
    const json = await res.json() as any;
    expect(json.deposit.currency).toBe('JPY');
    expect(json.deposit.cad_amount).toBe(138000);
  });

  it('rejects unsupported currencies', async () => {
    const res = await app.request('/api/soleprop/deposits', {
      method: 'POST',
      headers: await authHeaders(),
      body: JSON.stringify({ received_date: '2026-09-01', foreign_amount: 100, currency: 'XX' }),
    }, testEnv);
    expect(res.status).toBe(400);
  });

});
