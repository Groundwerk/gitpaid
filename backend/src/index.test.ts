import { describe, expect, it, vi } from 'vitest';
import app from './index';
import { calculatePayrollDeductions, TaxInputs } from './services/taxEngine';
import { sign } from 'hono/jwt';

describe('1. Progressive Tax Engine Calculations', () => {
  it('should calculate CPP correctly with exemption basic bounds', () => {
    const inputs: TaxInputs = {
      gross: 2000.00, // Bi-weekly
      ytdGross: 10000.00,
      ytdCpp: 595.00,
      ytdEi: 166.00,
      ytdTax: 1200.00,
      cppExempt: false,
      eiExempt: false,
      taxExempt: false,
      payPeriod: 'bi-weekly',
      wsibRate: 2.50,
      ehtExempt: true,
      ehtRate: 1.95,
      vacationRate: 4.00,
      companyYtdGross: 50000.00
    };

    const results = calculatePayrollDeductions(inputs);
    
    // Bi-weekly exemption = 3500 / 26 = 134.615
    // Contributory = 2000 - 134.615 = 1865.385
    // CPP = 1865.385 * 0.0595 = 111.00
    expect(results.cppEmployee).toBe(110.99); // Rounded
    expect(results.cppEmployer).toBe(110.99);
  });

  it('should apply maximum caps on CPP and EI contributions', () => {
    const inputs: TaxInputs = {
      gross: 5000.00,
      ytdGross: 68000.00,
      ytdCpp: 3850.00, // Max is 3867.50, only $17.50 left
      ytdEi: 1040.00,  // Max is 1049.12, only $9.12 left
      ytdTax: 0.00,
      cppExempt: false,
      eiExempt: false,
      taxExempt: false,
      payPeriod: 'bi-weekly',
      wsibRate: 2.50,
      ehtExempt: true,
      ehtRate: 1.95,
      vacationRate: 4.00,
      companyYtdGross: 200000.00
    };

    const results = calculatePayrollDeductions(inputs);
    expect(results.cppEmployee).toBe(17.50);
    expect(results.eiEmployee).toBe(9.12);
  });

  it('should respect exemption flags', () => {
    const inputs: TaxInputs = {
      gross: 2000.00,
      ytdGross: 10000.00,
      ytdCpp: 500.00,
      ytdEi: 160.00,
      ytdTax: 1000.00,
      cppExempt: true,
      eiExempt: true,
      taxExempt: true,
      payPeriod: 'bi-weekly',
      wsibRate: 2.50,
      ehtExempt: true,
      ehtRate: 1.95,
      vacationRate: 4.00,
      companyYtdGross: 50000.00
    };

    const results = calculatePayrollDeductions(inputs);
    expect(results.cppEmployee).toBe(0);
    expect(results.eiEmployee).toBe(0);
    expect(results.incomeTax).toBe(0);
  });
});

describe('2. Hono REST API Routes Integration', () => {
  // Mock D1 Database Environment
  const mockDb = {
    prepare: (sql: string) => {
      return {
        bind: (...args: any[]) => {
          return {
            first: async () => {
              if (sql.includes('SELECT * FROM company_settings')) {
                return {
                  id: 1,
                  legal_name: 'Acme Test Solutions',
                  business_number: '123456789 RP 0001',
                  wsib_rate: 2.5,
                  eht_exempt: 1,
                  eht_rate: 1.95,
                  vacation_rate: 4.0,
                  pay_period: 'bi-weekly',
                  owner_sin: '123456789',
                  business_type: 'Corporation',
                  remittance_frequency: 'monthly',
                  contact_phone: '416-555-0199',
                  address_line2: 'Suite 400',
                  province: 'ON',
                  override_ei_employer_rate: 1.4
                };
              }
              if (sql.includes('SELECT * FROM users')) {
                return {
                  email: 'admin@company.com',
                  name: 'Mock Admin',
                  avatar: '',
                  company_id: 1
                };
              }
              return null;
            },
            all: async () => {
              if (sql.includes('SELECT * FROM employees')) {
                return {
                  results: [
                    { id: 1, first_name: 'Sarah', last_name: 'Jenkins', email: 'sarah.j@company.com', pay_type: 'salary', rate: 4500, status: 'active', cpp_exempt: 0, ei_exempt: 0, tax_exempt: 0, avatar: 'SJ', ytd_gross: 0, ytd_cpp: 0, ytd_ei: 0, ytd_tax: 0, pay_interval: 'company', sin: '987654321', start_date: '2026-01-01', fit_exempt: 0, fit_withholding_amount: 0, override_fed_tax_credit: 0, fed_tax_credit_amount: 15705, override_prov_tax_credit: 0, prov_tax_credit_amount: 12399, wcb_exempt: 0, wcb_rate: 0 }
                  ]
                };
              }
              return { results: [] };
            },
            run: async () => {
              return { success: true, meta: { last_row_id: 1 } };
            }
          };
        },
        first: async () => null,
        all: async () => ({ results: [] }),
        run: async () => ({ success: true, meta: { last_row_id: 1 } })
      };
    },
    batch: async () => {
      return [{ success: true }];
    }
  };

  const testEnv = {
    DB: mockDb as any,
    JWT_SECRET: 'test-secret-12345',
    GOOGLE_CLIENT_ID: 'test-client-id',
    ALLOW_MOCK_LOGIN: 'true'
  };

  it('GET /api/health should return worker identity status', async () => {
    const res = await app.request('/api/health', {}, testEnv);
    expect(res.status).toBe(200);
    const json = await res.json() as any;
    expect(json.status).toBe('healthy');
    expect(json.worker).toBe('Cloudflare');
  });

  it('POST /api/auth/google should handle mock login and issue session token', async () => {
    const res = await app.request('/api/auth/google', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ idToken: 'mock-google-token-admin' })
    }, testEnv);

    expect(res.status).toBe(200);
    const json = await res.json() as any;
    expect(json.token).toBeDefined();
    expect(json.email).toBe('admin@company.com');
    expect(json.needsOnboarding).toBe(false);
  });

  it('GET /api/settings should block requests without authorization headers', async () => {
    const res = await app.request('/api/settings', {}, testEnv);
    expect(res.status).toBe(401);
  });

  it('GET /api/settings should allow authorized requests', async () => {
    const token = await sign({ email: 'admin@company.com', name: 'Mock Admin', companyId: 1, exp: Math.floor(Date.now() / 1000) + 100 }, 'test-secret-12345');
    const res = await app.request('/api/settings', {
      headers: {
        'Authorization': `Bearer ${token}`
      }
    }, testEnv);

    expect(res.status).toBe(200);
    const json = await res.json() as any;
    expect(json.legal_name).toBe('Acme Test Solutions');
  });
});
