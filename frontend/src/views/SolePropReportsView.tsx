import React, { useEffect, useState } from 'react';
import type { SolePropDeposit, SolePropOverview } from '../types';
import { api } from '../utils/api';

interface SolePropReportsViewProps {
  triggerToast: (msg: string, type: 'success' | 'error') => void;
}

const CSV_HEADER = 'received_date,currency,foreign_amount,fx_rate,fx_date_used,cad_amount,tax_owed,cpp_owed,cpp2_owed,hst_owed,note';

function csvCell(v: string | number | null): string {
  const s = v === null || v === undefined ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function buildEarningsCsv(deposits: SolePropDeposit[]): string {
  const rows = [...deposits].sort((a, b) =>
    a.received_date < b.received_date ? -1 : a.received_date > b.received_date ? 1 : a.id - b.id
  );
  const lines = rows.map(d => [
    d.received_date, d.currency, d.foreign_amount, d.fx_rate, d.fx_date_used,
    d.cad_amount, d.tax_owed, d.cpp_owed, d.cpp2_owed, d.hst_owed ?? 0, d.note,
  ].map(csvCell).join(','));
  return [CSV_HEADER, ...lines].join('\n') + '\n';
}

interface YearTotals {
  year: number;
  count: number;
  cad: number;
  tax: number;
  cpp: number;
  cpp2: number;
  hst: number;
}

export const SolePropReportsView: React.FC<SolePropReportsViewProps> = ({ triggerToast }) => {
  const [overview, setOverview] = useState<SolePropOverview | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      try {
        setOverview(await api.getSolePropOverview());
      } catch (error: any) {
        console.error('Failed to load earnings report:', error);
        triggerToast(error.message || 'Failed to load report.', 'error');
      } finally {
        setLoading(false);
      }
    }
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const money = (v: number) => new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'CAD' }).format(v);

  const handleDownloadCsv = () => {
    if (!overview || overview.deposits.length === 0) {
      triggerToast('Nothing to export yet.', 'error');
      return;
    }
    try {
      const blob = new Blob([buildEarningsCsv(overview.deposits)], { type: 'text/csv' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'sole-prop-earnings.csv';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (error: any) {
      triggerToast(error.message || 'CSV export failed in this browser.', 'error');
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-highlight"></div>
      </div>
    );
  }

  if (!overview) {
    return (
      <div className="p-8 text-center bg-surface-container-lowest border border-outline-variant rounded-xl shadow-sm">
        <p className="text-sm text-on-surface-variant">Report unavailable. Try reloading.</p>
      </div>
    );
  }

  const years = new Map<number, YearTotals>();
  for (const d of overview.deposits) {
    const year = Number(d.received_date.slice(0, 4));
    const t = years.get(year) ?? { year, count: 0, cad: 0, tax: 0, cpp: 0, cpp2: 0, hst: 0 };
    t.count += 1;
    t.cad = Math.round((t.cad + d.cad_amount) * 100) / 100;
    t.tax = Math.round((t.tax + d.tax_owed) * 100) / 100;
    t.cpp = Math.round((t.cpp + d.cpp_owed) * 100) / 100;
    t.cpp2 = Math.round((t.cpp2 + d.cpp2_owed) * 100) / 100;
    t.hst = Math.round((t.hst + (d.hst_owed ?? 0)) * 100) / 100;
    years.set(year, t);
  }
  const yearRows = [...years.values()].sort((a, b) => a.year - b.year);

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-on-surface mb-1">Earnings report</h1>
          <p className="text-sm text-on-surface-variant">
            Per-tax-year income with estimated tax and CPP. Per-deposit figures already reflect
            your opening balances — use the yearly totals at filing time. All figures are estimates.
          </p>
        </div>
        <button
          type="button" onClick={handleDownloadCsv}
          className="h-10 px-4 rounded-lg bg-highlight text-on-highlight text-sm font-bold hover:opacity-90 transition-opacity whitespace-nowrap self-start"
        >
          Download CSV
        </button>
      </div>

      <div className="bg-surface-container-lowest border border-outline-variant rounded-xl p-4 md:p-6 shadow-sm">
        <h2 className="text-sm font-bold text-primary uppercase tracking-wider border-b border-outline-variant pb-2 mb-4">By tax year</h2>
        {yearRows.length === 0 ? (
          <p className="text-sm text-on-surface-variant">No deposits recorded yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-wider text-on-surface-variant border-b border-outline-variant">
                  <th className="py-2 pr-3">Year</th>
                  <th className="py-2 pr-3">Deposits</th>
                  <th className="py-2 pr-3">Income (CAD)</th>
                  <th className="py-2 pr-3">Income tax</th>
                  <th className="py-2 pr-3">CPP</th>
                  <th className="py-2 pr-3">CPP2</th>
                  <th className="py-2 pr-3">HST</th>
                  <th className="py-2 pr-3">Total owed</th>
                </tr>
              </thead>
              <tbody>
                {yearRows.map(y => (
                  <tr key={y.year} className="border-b border-outline-variant last:border-0">
                    <td className="py-2 pr-3 font-bold">{y.year}</td>
                    <td className="py-2 pr-3">{y.count}</td>
                    <td className="py-2 pr-3 font-semibold">{money(y.cad)}</td>
                    <td className="py-2 pr-3">{money(y.tax)}</td>
                    <td className="py-2 pr-3">{money(y.cpp)}</td>
                    <td className="py-2 pr-3">{money(y.cpp2)}</td>
                    <td className="py-2 pr-3">{money(y.hst)}</td>
                    <td className="py-2 pr-3 font-semibold">{money(y.tax + y.cpp + y.cpp2 + y.hst)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="bg-surface-container-lowest border border-outline-variant rounded-xl p-4 md:p-6 shadow-sm">
        <h2 className="text-sm font-bold text-primary uppercase tracking-wider border-b border-outline-variant pb-2 mb-4">Deposit detail</h2>
        {overview.deposits.length === 0 ? (
          <p className="text-sm text-on-surface-variant">No deposits recorded yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-wider text-on-surface-variant border-b border-outline-variant">
                  <th className="py-2 pr-3">Date</th>
                  <th className="py-2 pr-3">Paid</th>
                  <th className="py-2 pr-3">Rate</th>
                  <th className="py-2 pr-3">CAD</th>
                  <th className="py-2 pr-3">Tax</th>
                  <th className="py-2 pr-3">CPP</th>
                  <th className="py-2 pr-3">CPP2</th>
                  <th className="py-2 pr-3">HST</th>
                  <th className="py-2 pr-3">Note</th>
                </tr>
              </thead>
              <tbody>
                {overview.deposits.map(d => (
                  <tr key={d.id} className="border-b border-outline-variant last:border-0">
                    <td className="py-2 pr-3 whitespace-nowrap">{d.received_date}</td>
                    <td className="py-2 pr-3 whitespace-nowrap">{d.foreign_amount.toLocaleString('en-CA')} {d.currency}</td>
                    <td className="py-2 pr-3">{d.fx_rate}</td>
                    <td className="py-2 pr-3 font-semibold">{money(d.cad_amount)}</td>
                    <td className="py-2 pr-3">{money(d.tax_owed)}</td>
                    <td className="py-2 pr-3">{money(d.cpp_owed)}</td>
                    <td className="py-2 pr-3">{money(d.cpp2_owed)}</td>
                    <td className="py-2 pr-3">{money(d.hst_owed ?? 0)}</td>
                    <td className="py-2 pr-3 text-on-surface-variant">{d.note ?? ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};

export default SolePropReportsView;
