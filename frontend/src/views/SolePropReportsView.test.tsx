import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import SolePropReportsView, { buildEarningsCsv } from './SolePropReportsView';
import { api } from '../utils/api';

vi.mock('../utils/api', () => ({ api: {
  getSolePropOverview: vi.fn(),
} }));

const overview: any = {
  profile: {
    business_number: null, start_date: '2026-08-15', province: 'ON',
    ytd_pensionable_opening: 190000, ytd_cpp_opening: 8460.9, ytd_cpp2_opening: 832,
  },
  totals: { cad: 20700, tax: 984.13, cpp: 2046.8, cpp2: 0, hst: 0 },
  deposits: [
    { id: 1, received_date: '2026-09-01', foreign_amount: 5000, currency: 'USD', fx_rate: 1.38, fx_date_used: '2026-09-01', cad_amount: 6900, tax_owed: 0, cpp_owed: 404.6, cpp2_owed: 0, hst_owed: 0, note: null, voided: 0 },
    { id: 2, received_date: '2026-10-01', foreign_amount: 10000, currency: 'USD', fx_rate: 1.38, fx_date_used: '2026-10-01', cad_amount: 13800, tax_owed: 984.13, cpp_owed: 1642.2, cpp2_owed: 0, hst_owed: 0, note: 'Deel, Oct', voided: 0 },
    { id: 3, received_date: '2027-01-15', foreign_amount: 2000, currency: 'USD', fx_rate: 1.4, fx_date_used: '2027-01-15', cad_amount: 2800, tax_owed: 100, cpp_owed: 0, cpp2_owed: 0, hst_owed: 130, note: null, voided: 0 },
  ],
  upcoming: [],
  gst_remittances: [],
  gst: { rollingTotal: 23500, crossed: false, crossingDate: null, deadline: null, hasBN: false },
};

describe('buildEarningsCsv', () => {
  it('emits a header plus one row per deposit', () => {
    const csv = buildEarningsCsv(overview.deposits);
    const lines = csv.trim().split('\n');
    expect(lines[0]).toBe('received_date,currency,foreign_amount,fx_rate,fx_date_used,cad_amount,tax_owed,cpp_owed,cpp2_owed,hst_owed,note');
    expect(lines).toHaveLength(4);
    expect(lines[1]).toBe('2026-09-01,USD,5000,1.38,2026-09-01,6900,0,404.6,0,0,');
    expect(lines[2]).toContain('Deel, Oct');
    expect(lines[3]).toContain(',130,');
  });
});

describe('SolePropReportsView', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.getSolePropOverview).mockResolvedValue(overview);
  });

  it('groups totals by tax year', async () => {
    render(<SolePropReportsView triggerToast={() => {}} />);
    expect(await screen.findByText(/Earnings report/i)).toBeInTheDocument();
    const rows2026 = await screen.findByText('2026');
    expect(rows2026).toBeInTheDocument();
    expect(screen.getByText('2027')).toBeInTheDocument();
  });

  it('downloads a CSV of all deposits', async () => {
    const blobParts: unknown[][] = [];
    vi.stubGlobal('Blob', class {
      parts: unknown[];
      constructor(parts: unknown[]) { this.parts = parts; blobParts.push(parts); }
    });
    vi.stubGlobal('URL', { ...URL, createObjectURL: () => 'blob:mock-csv', revokeObjectURL: () => {} });
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    render(<SolePropReportsView triggerToast={() => {}} />);
    fireEvent.click(await screen.findByRole('button', { name: /download csv/i }));
    expect(clickSpy).toHaveBeenCalledTimes(1);
    expect(blobParts).toHaveLength(1);
    const text = String(blobParts[0][0]);
    expect(text).toContain('received_date,currency,foreign_amount');
    expect(text).toContain('2026-10-01');
    vi.unstubAllGlobals();
  });
});
