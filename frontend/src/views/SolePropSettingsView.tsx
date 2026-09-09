import React, { useEffect, useState } from 'react';
import type { SolePropOverview } from '../types';
import { api } from '../utils/api';

interface SolePropSettingsViewProps {
  triggerToast: (msg: string, type: 'success' | 'error') => void;
  onSettingsUpdate?: () => void;
}

export const SolePropSettingsView: React.FC<SolePropSettingsViewProps> = ({
  triggerToast,
  onSettingsUpdate,
}) => {
  const [overview, setOverview] = useState<SolePropOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [savingName, setSavingName] = useState(false);
  const [savingBn, setSavingBn] = useState(false);
  const [name, setName] = useState('');
  const [bn, setBn] = useState('');
  const [wise, setWise] = useState<{ connected: boolean; last4: string | null; label: string | null; updated_at: string | null } | null>(null);
  const [wiseToken, setWiseToken] = useState('');
  const [wiseBusy, setWiseBusy] = useState(false);
  const [openings, setOpenings] = useState({ pens: '', cpp: '', cpp2: '' });
  const [savingOpenings, setSavingOpenings] = useState(false);

  useEffect(() => {
    async function load() {
      try {
        const [data, settings] = await Promise.all([
          api.getSolePropOverview(),
          api.getSettings().catch(() => null),
        ]);
        setOverview(data);
        if (settings?.legal_name) setName(settings.legal_name);
        setWise(await api.getWiseStatus());
      } catch (error: any) {
        console.error('Failed to load sole-prop settings:', error);
        triggerToast(error.message || 'Failed to load settings.', 'error');
      } finally {
        setLoading(false);
      }
    }
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSaveName = async () => {
    if (!name.trim()) {
      triggerToast('Your name is required.', 'error');
      return;
    }
    try {
      setSavingName(true);
      await api.updateSettings({ legal_name: name.trim() });
      triggerToast('Name saved.', 'success');
      if (onSettingsUpdate) onSettingsUpdate();
    } catch (error: any) {
      triggerToast(error.message || 'Failed to save name.', 'error');
    } finally {
      setSavingName(false);
    }
  };

  const handleSaveBn = async () => {
    const digits = bn.replace(/\D/g, '');
    if (!/^\d{9}$/.test(digits)) {
      triggerToast('Business Number must be 9 digits.', 'error');
      return;
    }
    try {
      setSavingBn(true);
      const res = await api.updateSolePropProfile({ business_number: digits });
      setOverview(prev => (prev ? { ...prev, profile: res.profile, gst: { ...prev.gst, hasBN: true } } : prev));
      setBn('');
      triggerToast('Business Number saved.', 'success');
      if (onSettingsUpdate) onSettingsUpdate();
    } catch (error: any) {
      triggerToast(error.message || 'Failed to save Business Number.', 'error');
    } finally {
      setSavingBn(false);
    }
  };

  const handleSaveOpenings = async () => {
    const toNum = (v: string, label: string): number | undefined => {
      if (v.trim() === '') return undefined;
      const n = Number(v);
      if (!Number.isFinite(n) || n < 0) {
        triggerToast(`${label} must be a non-negative number.`, 'error');
        throw new Error('invalid');
      }
      return n;
    };
    let payload: { ytd_pensionable_opening?: number; ytd_cpp_opening?: number; ytd_cpp2_opening?: number };
    try {
      payload = {
        ytd_pensionable_opening: toNum(openings.pens, 'Pensionable earnings'),
        ytd_cpp_opening: toNum(openings.cpp, 'CPP paid'),
        ytd_cpp2_opening: toNum(openings.cpp2, 'CPP2 paid'),
      };
    } catch {
      return;
    }
    if (payload.ytd_pensionable_opening === undefined && payload.ytd_cpp_opening === undefined && payload.ytd_cpp2_opening === undefined) {
      triggerToast('Enter at least one value to update.', 'error');
      return;
    }
    const liveCount = overview?.deposits.length ?? 0;
    const paidCount = overview?.upcoming.filter(i => i.paid).length ?? 0;
    if (liveCount > 0) {
      const msg = paidCount > 0
        ? `${paidCount} instalment(s) already marked paid and will stay frozen as history; only unpaid amounts change. Recalculate all ${liveCount} deposit(s)?`
        : `This recomputes tax/CPP on all ${liveCount} recorded deposit(s). Nothing is paid yet, so nothing is locked in. Continue?`;
      if (!window.confirm(msg)) return;
    }
    try {
      setSavingOpenings(true);
      const res = await api.updateSolePropProfile(payload);
      setOverview(prev => (prev ? { ...prev, profile: res.profile } : prev));
      const refreshed = await api.getSolePropOverview();
      setOverview(refreshed);
      setOpenings({ pens: '', cpp: '', cpp2: '' });
      triggerToast('Openings saved — ledger recomputed.', 'success');
      if (onSettingsUpdate) onSettingsUpdate();
    } catch (error: any) {
      triggerToast(error.message || 'Failed to save openings.', 'error');
    } finally {
      setSavingOpenings(false);
    }
  };

  const handleSaveWise = async () => {
    if (wiseToken.trim().length < 8) {
      triggerToast('Paste a Wise personal token first.', 'error');
      return;
    }
    try {
      setWiseBusy(true);
      const status = await api.saveWiseToken({ token: wiseToken.trim() });
      setWise(status);
      setWiseToken('');
      triggerToast('Wise token verified and saved.', 'success');
    } catch (error: any) {
      triggerToast(error.message || 'Wise rejected this token.', 'error');
    } finally {
      setWiseBusy(false);
    }
  };

  const handleTestWise = async () => {
    try {
      setWiseBusy(true);
      const res = await api.testWiseToken();
      triggerToast(res.ok ? `Wise connected (${res.profiles} profile${res.profiles === 1 ? '' : 's'}).` : 'Wise test failed.', res.ok ? 'success' : 'error');
    } catch (error: any) {
      triggerToast(error.message || 'Wise test failed.', 'error');
    } finally {
      setWiseBusy(false);
    }
  };

  const handleRemoveWise = async () => {
    if (!window.confirm('Remove the saved Wise token? Automatic import stops.')) return;
    try {
      setWiseBusy(true);
      setWise(await api.deleteWiseToken());
      triggerToast('Wise token removed.', 'success');
    } catch (error: any) {
      triggerToast(error.message || 'Failed to remove token.', 'error');
    } finally {
      setWiseBusy(false);
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
        <p className="text-sm text-on-surface-variant">Settings unavailable. Try reloading.</p>
      </div>
    );
  }

  const p = overview.profile;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-3xl font-bold text-on-surface mb-1">Sole proprietor settings</h1>
        <p className="text-sm text-on-surface-variant">Just the essentials for tracking income and instalments.</p>
      </div>

      <div className="bg-surface-container-lowest border border-outline-variant rounded-xl p-4 md:p-6 shadow-sm flex flex-col gap-4">
        <h2 className="text-sm font-bold text-primary uppercase tracking-wider border-b border-outline-variant pb-2">Profile</h2>
        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-bold text-on-surface-variant uppercase tracking-wider" htmlFor="sps-name">Your name</label>
          <div className="flex gap-2">
            <input
              id="sps-name" type="text" value={name} onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Jane Doe"
              className="h-10 border border-outline-variant rounded px-3 text-sm focus:outline-none focus:ring-2 focus:ring-highlight bg-transparent w-full"
            />
            <button
              type="button" onClick={handleSaveName} disabled={savingName}
              className="h-10 px-4 rounded-lg bg-highlight text-on-highlight text-sm font-bold hover:opacity-90 transition-opacity disabled:opacity-50 whitespace-nowrap"
            >
              Save
            </button>
          </div>
        </div>
        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-bold text-on-surface-variant uppercase tracking-wider" htmlFor="sps-bn">CRA Business Number</label>
          <div className="flex gap-2">
            <input
              id="sps-bn" type="text" value={bn || p.business_number || ''} onChange={(e) => setBn(e.target.value)}
              placeholder="9 digits, if you have one"
              className="h-10 border border-outline-variant rounded px-3 text-sm focus:outline-none focus:ring-2 focus:ring-highlight bg-transparent w-full"
            />
            <button
              type="button" onClick={handleSaveBn} disabled={savingBn}
              className="h-10 px-4 rounded-lg bg-highlight text-on-highlight text-sm font-bold hover:opacity-90 transition-opacity disabled:opacity-50 whitespace-nowrap"
            >
              Save Business Number
            </button>
          </div>
          {p.business_number && (
            <p className="text-xs text-on-surface-variant">Registered: {p.business_number}</p>
          )}
        </div>
        <div className="grid sm:grid-cols-2 gap-4 text-sm">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-wider text-on-surface-variant">Province</p>
            <p className="font-semibold mt-0.5">Ontario (only supported province in V1)</p>
          </div>
          <div>
            <p className="text-[11px] font-bold uppercase tracking-wider text-on-surface-variant">Start date</p>
            <p className="font-semibold mt-0.5">{p.start_date}</p>
          </div>
        </div>
      </div>

      <div className="bg-surface-container-lowest border border-outline-variant rounded-xl p-4 md:p-6 shadow-sm flex flex-col gap-4">
        <h2 className="text-sm font-bold text-primary uppercase tracking-wider border-b border-outline-variant pb-2">2026 Opening Balances</h2>
        <div className="grid sm:grid-cols-3 gap-4">
          {([
            ['Pensionable earnings ($)', 'pens', overview.profile.ytd_pensionable_opening],
            ['CPP paid ($)', 'cpp', overview.profile.ytd_cpp_opening],
            ['CPP2 paid ($)', 'cpp2', overview.profile.ytd_cpp2_opening],
          ] as const).map(([label, key, current]) => (
            <div key={key} className="flex flex-col gap-1.5">
              <label className="text-xs font-bold text-on-surface-variant uppercase tracking-wider" htmlFor={`sps-${key}`}>
                {label}
              </label>
              <input
                id={`sps-${key}`} type="number" min="0" step="0.01"
                value={openings[key]} placeholder={String(current ?? 0)}
                onChange={(e) => setOpenings(prev => ({ ...prev, [key]: e.target.value }))}
                className="h-10 border border-outline-variant rounded px-3 text-sm focus:outline-none focus:ring-2 focus:ring-highlight bg-transparent w-full"
              />
            </div>
          ))}
        </div>
        <p className="text-xs text-on-surface-variant">
          Amounts earned and CPP paid outside Gitpaid this year. Saving recomputes every deposit and instalment.
          Leave blank to keep the current values.
        </p>
        <div>
          <button
            type="button" onClick={handleSaveOpenings} disabled={savingOpenings}
            className="h-10 px-4 rounded-lg bg-highlight text-on-highlight text-sm font-bold hover:opacity-90 transition-opacity disabled:opacity-50"
          >
            Save openings
          </button>
        </div>
      </div>

      <div className="bg-surface-container-lowest border border-outline-variant rounded-xl p-4 md:p-6 shadow-sm flex flex-col gap-4">
        <h2 className="text-sm font-bold text-primary uppercase tracking-wider border-b border-outline-variant pb-2">Bank connections</h2>
        {wise?.connected ? (
          <div className="flex flex-col gap-3">
            <p className="text-sm">
              Wise token saved <span className="font-mono font-semibold">••••{wise.last4}</span>
              {wise.label ? <span className="text-on-surface-variant"> ({wise.label})</span> : null}
            </p>
            <div className="flex flex-wrap gap-2">
              <button
                type="button" onClick={handleTestWise} disabled={wiseBusy}
                className="h-10 px-4 rounded-lg border border-outline-variant text-sm font-bold text-on-surface-variant hover:border-highlight transition-colors disabled:opacity-50"
              >
                Test connection
              </button>
              <button
                type="button" onClick={handleRemoveWise} disabled={wiseBusy}
                className="h-10 px-4 rounded-lg border border-outline-variant text-sm font-bold text-outline hover:text-error hover:border-error/20 transition-colors disabled:opacity-50"
              >
                Remove
              </button>
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            <p className="text-xs text-on-surface-variant">
              Paste a Wise personal token (read-only is enough) to enable automatic deposit import.
              It is verified live, stored encrypted, and never shown again.
            </p>
            <label className="text-xs font-bold text-on-surface-variant uppercase tracking-wider" htmlFor="sps-wise">
              Wise personal token
            </label>
            <div className="flex gap-2">
              <input
                id="sps-wise" type="password" value={wiseToken} onChange={(e) => setWiseToken(e.target.value)}
                placeholder="Paste token"
                autoComplete="off"
                className="h-10 border border-outline-variant rounded px-3 text-sm focus:outline-none focus:ring-2 focus:ring-highlight bg-transparent w-full font-mono"
              />
              <button
                type="button" onClick={handleSaveWise} disabled={wiseBusy}
                className="h-10 px-4 rounded-lg bg-highlight text-on-highlight text-sm font-bold hover:opacity-90 transition-opacity disabled:opacity-50 whitespace-nowrap"
              >
                Save token
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default SolePropSettingsView;
