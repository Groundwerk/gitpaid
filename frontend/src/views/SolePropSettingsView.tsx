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

  useEffect(() => {
    async function load() {
      try {
        const data = await api.getSolePropOverview();
        setOverview(data);
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
  const money = (v: number) => new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'CAD' }).format(v);

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
        <div className="grid sm:grid-cols-3 gap-4 text-sm">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-wider text-on-surface-variant">Pensionable earnings</p>
            <p className="font-semibold mt-0.5">{money(p.ytd_pensionable_opening)}</p>
          </div>
          <div>
            <p className="text-[11px] font-bold uppercase tracking-wider text-on-surface-variant">CPP paid</p>
            <p className="font-semibold mt-0.5">{money(p.ytd_cpp_opening)}</p>
          </div>
          <div>
            <p className="text-[11px] font-bold uppercase tracking-wider text-on-surface-variant">CPP2 paid</p>
            <p className="font-semibold mt-0.5">{money(p.ytd_cpp2_opening)}</p>
          </div>
        </div>
        <p className="text-xs text-on-surface-variant">
          Locked after onboarding — every CPP calculation builds on these figures.
        </p>
      </div>
    </div>
  );
};

export default SolePropSettingsView;
