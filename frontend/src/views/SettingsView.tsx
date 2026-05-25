import React, { useEffect, useState } from 'react';
import { api } from '../utils/api';
import type { CompanySettings } from '../types';

interface SettingsViewProps {
  triggerToast: (msg: string, type: 'success' | 'error') => void;
  onSettingsUpdate?: () => void;
}

export const SettingsView: React.FC<SettingsViewProps> = ({ 
  triggerToast,
  onSettingsUpdate
}) => {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [settings, setSettings] = useState<CompanySettings>({
    id: 1,
    legal_name: '',
    operating_name: '',
    business_number: '',
    address_line1: '',
    city: '',
    postal_code: '',
    contact_name: '',
    contact_email: '',
    wsib_number: '',
    wsib_rate: 2.5,
    eht_exempt: 1,
    eht_rate: 1.95,
    vacation_rate: 4.0,
    pay_period: 'bi-weekly'
  });

  useEffect(() => {
    async function loadSettings() {
      try {
        setLoading(true);
        const data = await api.getSettings();
        if (data) {
          setSettings(data);
        }
      } catch (error) {
        console.error('Error fetching settings:', error);
        triggerToast('Failed to load company configuration settings.', 'error');
      } finally {
        setLoading(false);
      }
    }
    loadSettings();
  }, []);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { id, value, type } = e.target;
    if (type === 'checkbox') {
      const checked = (e.target as HTMLInputElement).checked;
      setSettings(prev => ({ ...prev, [id]: checked ? 1 : 0 }));
    } else {
      setSettings(prev => ({ 
        ...prev, 
        [id]: type === 'number' ? parseFloat(value) || 0 : value 
      }));
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!settings.legal_name || !settings.business_number) {
      triggerToast('Legal Name and Business Number are mandatory fields.', 'error');
      return;
    }

    try {
      setSaving(true);
      await api.updateSettings(settings);
      triggerToast('Company configuration updated successfully.', 'success');
      onSettingsUpdate?.();
    } catch (error: any) {
      console.error('Error saving settings:', error);
      triggerToast(error.message || 'Failed to save configuration settings.', 'error');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Title */}
      <div>
        <h1 className="text-3xl font-bold text-on-surface mb-1">Company Setup</h1>
        <p className="text-sm text-on-surface-variant">Configure legal entities, contact directories, and Ontario tax profiles.</p>
      </div>

      <form onSubmit={handleSubmit} className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left Column: Basic Details */}
        <div className="lg:col-span-8 flex flex-col gap-6">
          {/* Identity Card */}
          <section className="bg-surface-container-lowest border border-outline-variant rounded-xl p-6 shadow-sm">
            <h3 className="text-base font-bold text-primary mb-6 border-b border-outline-variant pb-2">Business Identity</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="flex flex-col gap-1.5 md:col-span-2">
                <label className="text-xs font-bold text-on-surface-variant uppercase tracking-wider" htmlFor="legal_name">Legal Company Name *</label>
                <input 
                  type="text" 
                  id="legal_name"
                  value={settings.legal_name}
                  onChange={handleChange}
                  placeholder="e.g. Acme Solutions Inc."
                  className="h-10 border border-outline-variant rounded px-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary bg-transparent w-full"
                  required
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-bold text-on-surface-variant uppercase tracking-wider" htmlFor="operating_name">Operating Name (DBA)</label>
                <input 
                  type="text" 
                  id="operating_name"
                  value={settings.operating_name}
                  onChange={handleChange}
                  placeholder="e.g. Acme Corp"
                  className="h-10 border border-outline-variant rounded px-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary bg-transparent w-full"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-bold text-on-surface-variant uppercase tracking-wider" htmlFor="business_number">CRA Business Number (BN15) *</label>
                <input 
                  type="text" 
                  id="business_number"
                  value={settings.business_number}
                  onChange={handleChange}
                  placeholder="123456789 RP 0001"
                  className="h-10 border border-outline-variant rounded px-3 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-primary bg-transparent w-full"
                  required
                />
              </div>
            </div>
          </section>

          {/* Location & Contact Card */}
          <section className="bg-surface-container-lowest border border-outline-variant rounded-xl p-6 shadow-sm">
            <h3 className="text-base font-bold text-primary mb-6 border-b border-outline-variant pb-2">Location &amp; Contact</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="flex flex-col gap-1.5 md:col-span-2">
                <label className="text-xs font-bold text-on-surface-variant uppercase tracking-wider" htmlFor="address_line1">Street Address</label>
                <input 
                  type="text" 
                  id="address_line1"
                  value={settings.address_line1}
                  onChange={handleChange}
                  className="h-10 border border-outline-variant rounded px-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary bg-transparent w-full"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-bold text-on-surface-variant uppercase tracking-wider" htmlFor="city">City</label>
                <input 
                  type="text" 
                  id="city"
                  value={settings.city}
                  onChange={handleChange}
                  className="h-10 border border-outline-variant rounded px-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary bg-transparent w-full"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-bold text-on-surface-variant uppercase tracking-wider" htmlFor="postal_code">Postal Code</label>
                <input 
                  type="text" 
                  id="postal_code"
                  value={settings.postal_code}
                  onChange={handleChange}
                  className="h-10 border border-outline-variant rounded px-3 text-sm uppercase focus:outline-none focus:ring-2 focus:ring-primary bg-transparent w-full"
                />
              </div>

              <div className="md:col-span-2 mt-4 pt-4 border-t border-outline-variant">
                <p className="text-xs font-bold text-primary mb-3">Primary Payroll Administrator</p>
              </div>

              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-bold text-on-surface-variant uppercase tracking-wider" htmlFor="contact_name">Full Name</label>
                <input 
                  type="text" 
                  id="contact_name"
                  value={settings.contact_name}
                  onChange={handleChange}
                  className="h-10 border border-outline-variant rounded px-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary bg-transparent w-full"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-bold text-on-surface-variant uppercase tracking-wider" htmlFor="contact_email">Email Address</label>
                <input 
                  type="email" 
                  id="contact_email"
                  value={settings.contact_email}
                  onChange={handleChange}
                  className="h-10 border border-outline-variant rounded px-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary bg-transparent w-full"
                />
              </div>
            </div>
          </section>
        </div>

        {/* Right Column: Ontario specific tax compliance */}
        <div className="lg:col-span-4 flex flex-col gap-6">
          {/* Card: Ontario Compliance */}
          <section className="bg-surface-container-low border border-primary-container/20 rounded-xl p-6 shadow-sm relative overflow-hidden">
            <div className="absolute top-0 left-0 w-full h-1 bg-secondary"></div>
            
            <h3 className="text-base font-bold text-primary-container mb-6 flex items-center gap-2">
              <span className="material-symbols-outlined text-secondary">account_balance</span>
              ON Compliance
            </h3>

            <div className="flex flex-col gap-4">
              {/* WSIB Account */}
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-bold text-on-surface-variant uppercase tracking-wider" htmlFor="wsib_number">WSIB Account Number</label>
                <input 
                  type="text" 
                  id="wsib_number"
                  value={settings.wsib_number}
                  onChange={handleChange}
                  placeholder="9-digit WSIB account"
                  className="h-10 border border-outline-variant bg-surface-container-lowest rounded px-3 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-primary w-full"
                />
              </div>

              {/* WSIB Rate */}
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-bold text-on-surface-variant uppercase tracking-wider" htmlFor="wsib_rate">WSIB Premium Rate (%)</label>
                <input 
                  type="number" 
                  step="0.01"
                  id="wsib_rate"
                  value={settings.wsib_rate}
                  onChange={handleChange}
                  className="h-10 border border-outline-variant bg-surface-container-lowest rounded px-3 text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-primary w-full"
                />
                <p className="text-[10px] text-on-surface-variant leading-tight">
                  Applied as employer premium rate on gross insurable earnings.
                </p>
              </div>

              <hr className="border-outline-variant/60" />

              {/* EHT Exemption */}
              <div className="flex flex-col gap-2">
                <label className="text-xs font-bold text-on-surface-variant uppercase tracking-wider">Employer Health Tax (EHT)</label>
                <div className="bg-surface-container-lowest border border-outline-variant rounded-lg p-3">
                  <label className="flex items-start gap-3 cursor-pointer group">
                    <div className="relative flex items-center justify-center mt-0.5">
                      <input 
                        type="checkbox" 
                        id="eht_exempt"
                        checked={settings.eht_exempt === 1}
                        onChange={handleChange}
                        className="peer sr-only"
                      />
                      <div className="w-5 h-5 border-2 border-outline rounded bg-transparent peer-checked:bg-primary peer-checked:border-primary transition-colors"></div>
                      <span className="material-symbols-outlined absolute text-on-primary text-[16px] opacity-0 peer-checked:opacity-100 transition-opacity">check</span>
                    </div>
                    <div className="flex flex-col">
                      <span className="text-sm font-semibold text-on-surface group-hover:text-primary transition-colors">Claim EHT Exemption</span>
                      <span className="text-[10px] text-on-surface-variant leading-tight mt-1">Private-sector employers with Ontario payroll under $1M are exempt.</span>
                    </div>
                  </label>
                </div>
              </div>

              {/* EHT Rate */}
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-bold text-on-surface-variant uppercase tracking-wider" htmlFor="eht_rate">EHT Premium Rate (%)</label>
                <input 
                  type="number" 
                  step="0.01"
                  id="eht_rate"
                  value={settings.eht_rate}
                  onChange={handleChange}
                  className="h-10 border border-outline-variant bg-surface-container-lowest rounded px-3 text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-primary w-full"
                />
              </div>
            </div>
          </section>

          {/* Card: Payroll Policies */}
          <section className="bg-surface-container-lowest border border-outline-variant rounded-xl p-6 shadow-sm">
            <h3 className="text-base font-bold text-primary mb-4 border-b border-outline-variant pb-2">Payroll Policies</h3>
            <div className="flex flex-col gap-4">
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-bold text-on-surface-variant uppercase tracking-wider" htmlFor="pay_period">Default Pay Period</label>
                <select 
                  id="pay_period" 
                  value={settings.pay_period} 
                  onChange={handleChange}
                  className="h-10 border border-outline-variant rounded px-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary bg-transparent w-full cursor-pointer"
                >
                  <option value="weekly">Weekly</option>
                  <option value="bi-weekly">Bi-weekly</option>
                  <option value="semi-monthly">Semi-monthly</option>
                  <option value="monthly">Monthly</option>
                </select>
              </div>

              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-bold text-on-surface-variant uppercase tracking-wider" htmlFor="vacation_rate">Default Vacation Accrual (%)</label>
                <input 
                  type="number" 
                  step="0.01"
                  id="vacation_rate"
                  value={settings.vacation_rate}
                  onChange={handleChange}
                  className="h-10 border border-outline-variant rounded px-3 text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-primary w-full"
                />
              </div>
            </div>
          </section>

          {/* Actions */}
          <div className="flex items-center justify-end gap-3 mt-4 pt-4 border-t border-outline-variant">
            <button 
              type="submit"
              disabled={saving}
              className="w-full px-5 py-3 rounded-lg bg-primary text-on-primary text-sm font-semibold hover:bg-opacity-90 transition-colors shadow-sm disabled:opacity-50"
            >
              {saving ? 'Saving...' : 'Save Configuration'}
            </button>
          </div>
        </div>
      </form>
    </div>
  );
};

export default SettingsView;
