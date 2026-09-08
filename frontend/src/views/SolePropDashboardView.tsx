import React, { useEffect, useState } from 'react';
import type { SolePropOverview } from '../types';
import { api } from '../utils/api';

interface SolePropDashboardViewProps {
  triggerToast: (msg: string, type: 'success' | 'error') => void;
}

export const SolePropDashboardView: React.FC<SolePropDashboardViewProps> = ({ triggerToast }) => {
  const [overview, setOverview] = useState<SolePropOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [bn, setBn] = useState('');
  const [form, setForm] = useState({
    received_date: new Date().toISOString().split('T')[0],
    foreign_amount: '',
    currency: 'USD',
    fx_rate: '',
    note: '',
  });

  const load = async () => {
    try {
      const data = await api.getSolePropOverview();
      setOverview(data);
    } catch (error: any) {
      console.error('Failed to load sole-prop overview:', error);
      triggerToast(error.message || 'Failed to load ledger.', 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const formatCurrency = (val: number) => {
    return new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'CAD' }).format(val);
  };

  const isOverdue = (dueDate: string, paid: number) => {
    if (paid) return false;
    const today = new Date().toISOString().split('T')[0];
    return dueDate < today;
  };

  const handleFetchRate = async () => {
    try {
      const fx = await api.previewFx(form.received_date, form.currency);
      setForm(prev => ({ ...prev, fx_rate: String(fx.rate) }));
      if (fx.dateUsed !== form.received_date) {
        triggerToast(`Weekend/holiday: using ${fx.dateUsed} rate.`, 'success');
      }
    } catch (error: any) {
      triggerToast(error.message || 'Rate unavailable — enter manually.', 'error');
    }
  };

  const handleCreateDeposit = async (e: React.FormEvent) => {
    e.preventDefault();
    const amount = Number(form.foreign_amount);
    if (!form.received_date || !Number.isFinite(amount) || amount <= 0) {
      triggerToast('Enter a received date and a positive amount.', 'error');
      return;
    }
    try {
      setSaving(true);
      const res = await api.createSolePropDeposit({
        received_date: form.received_date,
        foreign_amount: amount,
        currency: form.currency,
        fx_rate: form.fx_rate.trim() ? Number(form.fx_rate) : undefined,
        note: form.note.trim() || undefined,
      });
      setOverview(res.overview);
      setForm(prev => ({ ...prev, foreign_amount: '', fx_rate: '', note: '' }));
      triggerToast(`Recorded ${formatCurrency(res.deposit.cad_amount)}.`, 'success');
    } catch (error: any) {
      triggerToast(error.message || 'Failed to record deposit.', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleVoid = async (id: number) => {
    if (!window.confirm('Void this deposit? Running instalment amounts will be recomputed.')) return;
    try {
      const res = await api.voidSolePropDeposit(id);
      setOverview(res.overview);
      triggerToast('Deposit voided.', 'success');
    } catch (error: any) {
      triggerToast(error.message || 'Failed to void deposit.', 'error');
    }
  };

  const handlePay = async (id: number) => {
    try {
      await api.paySolePropInstalment(id, undefined);
      triggerToast('Instalment marked paid.', 'success');
      await load();
    } catch (error: any) {
      triggerToast(error.message || 'Failed to mark paid.', 'error');
    }
  };

  const handleSaveBn = async () => {
    const digits = bn.replace(/\D/g, '');
    if (!/^\d{9}$/.test(digits)) {
      triggerToast('Business Number must be 9 digits.', 'error');
      return;
    }
    try {
      await api.updateSolePropProfile({ business_number: digits });
      triggerToast('Business Number saved.', 'success');
      setBn('');
      await load();
    } catch (error: any) {
      triggerToast(error.message || 'Failed to save Business Number.', 'error');
    }
  };

  const renderInstCard = (inst: { id: number; kind: string; due_date: string; tax_amount: number; cpp_amount: number; cpp2_amount: number; total_amount: number; paid: number; paid_date: string | null }) => {
    const overdue = isOverdue(inst.due_date, inst.paid);
    return (
      <div
        key={inst.id}
        className={`p-4 border rounded-xl flex flex-col md:flex-row md:items-center justify-between gap-4 shadow-sm ${
          inst.paid
            ? 'bg-surface-container border-outline-variant opacity-70'
            : overdue
              ? 'bg-rose-50 border-rose-200 text-rose-900'
              : 'bg-amber-50 border-amber-200 text-amber-900'
        }`}
      >
        <div>
          <p className="text-sm font-bold">
            {inst.kind === 'annual' ? 'Annual balance' : 'Quarterly instalment'} — due {inst.due_date}
            {inst.kind === 'annual' && !inst.paid && (
              <span className="block text-xs font-medium mt-0.5">No quarterly payments required yet — due April 30.</span>
            )}
          </p>
          <p className="text-xs mt-1">
            Tax {formatCurrency(inst.tax_amount)} · CPP {formatCurrency(inst.cpp_amount)} · CPP2 {formatCurrency(inst.cpp2_amount)} ·
            Total {formatCurrency(inst.total_amount)}
          </p>
          {inst.paid && inst.paid_date && (
            <p className="text-xs mt-1">Paid {inst.paid_date}</p>
          )}
        </div>
        {!inst.paid && (
          <button
            type="button" onClick={() => handlePay(inst.id)}
            className="h-10 px-4 rounded-lg bg-highlight text-on-highlight text-sm font-bold hover:opacity-90 transition-opacity whitespace-nowrap self-start md:self-center"
          >
            Mark paid
          </button>
        )}
      </div>
    );
  };

  const sortedUpcoming = [...(overview?.upcoming ?? [])].sort((a, b) =>
    a.due_date < b.due_date ? -1 : 1
  );
  const unpaidSorted = sortedUpcoming.filter(i => !i.paid);
  const overdueRows = unpaidSorted.filter(i => isOverdue(i.due_date, i.paid));
  const nextRow = unpaidSorted.find(i => !isOverdue(i.due_date, i.paid)) ?? null;
  const laterRows = nextRow ? unpaidSorted.filter(i => i.id !== nextRow.id && !isOverdue(i.due_date, i.paid)) : [];
  const paidRows = sortedUpcoming.filter(i => i.paid);

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
        <p className="text-sm text-on-surface-variant">Ledger unavailable. Try reloading.</p>
      </div>
    );
  }

  const showGstBanner = overview.gst.crossed && !overview.gst.hasBN;

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="text-3xl font-bold text-on-surface mb-1">Sole Proprietor Ledger</h1>
        <p className="text-sm text-on-surface-variant">Deposits, estimated instalments, and GST registration tracking. All figures are estimates.</p>
      </div>

      {showGstBanner && (
        <div className="p-4 border rounded-xl flex flex-col gap-4 shadow-sm bg-rose-50 border-rose-200 text-rose-900">
          <div className="flex items-start gap-3">
            <span className="material-symbols-outlined mt-0.5 text-rose-700">warning</span>
            <div>
              <h2 className="text-sm font-bold">GST/HST registration required</h2>
              <p className="text-xs mt-1">
                Rolling 4-quarter revenue is {formatCurrency(overview.gst.rollingTotal)}, over the $30,000 threshold.
                Register with the CRA within 29 days{overview.gst.deadline ? ` — by ${overview.gst.deadline}` : ''}.
              </p>
            </div>
          </div>
          <div className="flex flex-col sm:flex-row gap-2">
            <input
              type="text"
              value={bn}
              onChange={(e) => setBn(e.target.value)}
              placeholder="9-digit Business Number"
              className="h-10 border border-rose-200 rounded px-3 text-sm focus:outline-none focus:ring-2 focus:ring-highlight bg-white w-full sm:max-w-xs"
            />
            <button
              type="button"
              onClick={handleSaveBn}
              className="h-10 px-4 rounded-lg bg-rose-700 text-white text-sm font-bold hover:opacity-90 transition-opacity"
            >
              Save BN
            </button>
          </div>
        </div>
      )}

      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: 'Received (fiscal CAD)', value: overview.totals.cad },
          { label: 'Est. income tax owed', value: overview.totals.tax },
          { label: 'Est. CPP owed', value: overview.totals.cpp },
          { label: 'Est. CPP2 owed', value: overview.totals.cpp2 },
        ].map(card => (
          <div key={card.label} className="bg-surface-container-lowest border border-outline-variant rounded-xl p-4 shadow-sm">
            <p className="text-[11px] font-bold uppercase tracking-wider text-on-surface-variant">{card.label}</p>
            <p className="text-2xl font-bold text-primary mt-1">{formatCurrency(card.value)}</p>
          </div>
        ))}
      </div>

      <div className="bg-surface-container-lowest border border-outline-variant rounded-xl p-4 md:p-6 shadow-sm">
        <h2 className="text-sm font-bold text-primary uppercase tracking-wider border-b border-outline-variant pb-2 mb-4">Record Deposit</h2>
        <form onSubmit={handleCreateDeposit} className="grid md:grid-cols-3 gap-4">
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-bold text-on-surface-variant uppercase tracking-wider" htmlFor="spd-date">Received date</label>
            <input
              id="spd-date" type="date" value={form.received_date}
              onChange={(e) => setForm(prev => ({ ...prev, received_date: e.target.value }))}
              className="h-10 border border-outline-variant rounded px-3 text-sm focus:outline-none focus:ring-2 focus:ring-highlight bg-transparent w-full"
              required
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-bold text-on-surface-variant uppercase tracking-wider" htmlFor="spd-amount">Amount paid</label>
            <input
              id="spd-amount" type="number" min="0" step="0.01" value={form.foreign_amount}
              onChange={(e) => setForm(prev => ({ ...prev, foreign_amount: e.target.value }))}
              placeholder="5000.00"
              className="h-10 border border-outline-variant rounded px-3 text-sm focus:outline-none focus:ring-2 focus:ring-highlight bg-transparent w-full"
              required
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-bold text-on-surface-variant uppercase tracking-wider" htmlFor="spd-currency">Currency</label>
            <select
              id="spd-currency" value={form.currency}
              onChange={(e) => setForm(prev => ({ ...prev, currency: e.target.value, fx_rate: '' }))}
              className="h-10 border border-outline-variant rounded px-3 text-sm focus:outline-none focus:ring-2 focus:ring-highlight bg-transparent w-full"
            >
              <option value="USD">USD</option>
              <option value="EUR">EUR</option>
              <option value="GBP">GBP</option>
            </select>
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-bold text-on-surface-variant uppercase tracking-wider" htmlFor="spd-rate">FX rate to CAD</label>
            <div className="flex gap-2">
              <input
                id="spd-rate" type="number" min="0" step="0.0001" value={form.fx_rate}
                onChange={(e) => setForm(prev => ({ ...prev, fx_rate: e.target.value }))}
                placeholder="auto"
                className="h-10 border border-outline-variant rounded px-3 text-sm focus:outline-none focus:ring-2 focus:ring-highlight bg-transparent w-full"
              />
              <button
                type="button" onClick={handleFetchRate}
                className="h-10 px-3 rounded-lg border border-outline-variant text-xs font-bold text-on-surface-variant hover:border-highlight transition-colors whitespace-nowrap"
              >
                Fetch rate
              </button>
            </div>
          </div>
          <div className="flex flex-col gap-1.5 md:col-span-2">
            <label className="text-xs font-bold text-on-surface-variant uppercase tracking-wider" htmlFor="spd-note">Note (optional)</label>
            <input
              id="spd-note" type="text" value={form.note}
              onChange={(e) => setForm(prev => ({ ...prev, note: e.target.value }))}
              placeholder="e.g. Deel invoice August"
              className="h-10 border border-outline-variant rounded px-3 text-sm focus:outline-none focus:ring-2 focus:ring-highlight bg-transparent w-full"
            />
          </div>
          <div className="md:col-span-3">
            <button
              type="submit" disabled={saving}
              className="h-10 px-6 rounded-lg bg-highlight text-on-highlight text-sm font-bold hover:opacity-90 transition-opacity disabled:opacity-50"
            >
              {saving ? 'Recording…' : 'Record deposit'}
            </button>
          </div>
        </form>
      </div>

      <div className="bg-surface-container-lowest border border-outline-variant rounded-xl p-4 md:p-6 shadow-sm">
        <h2 className="text-sm font-bold text-primary uppercase tracking-wider border-b border-outline-variant pb-2 mb-4">Deposits</h2>
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
                  <th className="py-2 pr-3"><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody>
                {overview.deposits.map(d => (
                  <tr key={d.id} className="border-b border-outline-variant last:border-0">
                    <td className="py-2 pr-3 whitespace-nowrap">{d.received_date}</td>
                    <td className="py-2 pr-3 whitespace-nowrap">{d.foreign_amount.toLocaleString('en-CA')} {d.currency}</td>
                    <td className="py-2 pr-3">{d.fx_rate}</td>
                    <td className="py-2 pr-3 font-semibold">{formatCurrency(d.cad_amount)}</td>
                    <td className="py-2 pr-3">{formatCurrency(d.tax_owed)}</td>
                    <td className="py-2 pr-3">{formatCurrency(d.cpp_owed)}</td>
                    <td className="py-2 pr-3">{formatCurrency(d.cpp2_owed)}</td>
                    <td className="py-2">
                      <button
                        type="button" onClick={() => handleVoid(d.id)}
                        className="text-xs font-bold text-outline hover:text-error transition-colors"
                      >
                        Void
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="bg-surface-container-lowest border border-outline-variant rounded-xl p-4 md:p-6 shadow-sm">
        <h2 className="text-sm font-bold text-primary uppercase tracking-wider border-b border-outline-variant pb-2 mb-4">Instalments</h2>
        <div className="flex flex-col gap-3">
          {unpaidSorted.length === 0 && paidRows.length === 0 && (
            <p className="text-sm text-on-surface-variant">No instalments yet — record a deposit to start the estimate.</p>
          )}
          {overdueRows.map(renderInstCard)}
          {nextRow && (
            <>
              {overdueRows.length > 0 && (
                <p className="text-[11px] font-bold uppercase tracking-wider text-on-surface-variant mt-1">Next due</p>
              )}
              {renderInstCard(nextRow)}
            </>
          )}
          {laterRows.length > 0 && (
            <details className="border border-outline-variant rounded-xl">
              <summary className="cursor-pointer px-4 py-3 text-xs font-bold uppercase tracking-wider text-on-surface-variant">
                Later instalments ({laterRows.length})
              </summary>
              <div className="flex flex-col gap-3 px-4 pb-4">{laterRows.map(renderInstCard)}</div>
            </details>
          )}
          {paidRows.length > 0 && (
            <details className="border border-outline-variant rounded-xl">
              <summary className="cursor-pointer px-4 py-3 text-xs font-bold uppercase tracking-wider text-on-surface-variant">
                Paid ({paidRows.length})
              </summary>
              <div className="flex flex-col gap-3 px-4 pb-4">{paidRows.map(renderInstCard)}</div>
            </details>
          )}
        </div>
      </div>
    </div>
  );
};

export default SolePropDashboardView;
