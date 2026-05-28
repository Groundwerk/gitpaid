import React, { useState } from 'react';
import { api } from '../utils/api';
import { sanitizeNumericInput } from '../utils/helpers';
import type { CompanySettings } from '../types';

interface OnboardingViewProps {
  onOnboardingComplete: (token: string, companyId: number) => void;
  triggerToast: (msg: string, type: 'success' | 'error') => void;
  onLogout: () => void;
}

export const OnboardingView: React.FC<OnboardingViewProps> = ({
  onOnboardingComplete,
  triggerToast,
  onLogout
}) => {
  const [step, setStep] = useState(1);
  const [saving, setSaving] = useState(false);
  const [connectingGmail, setConnectingGmail] = useState(false);
  const [onboardingResponse, setOnboardingResponse] = useState<{ token: string; companyId: number } | null>(null);
  const [settings, setSettings] = useState<Partial<CompanySettings>>({
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
    pay_period: 'bi-weekly',
    owner_sin: '',
    business_type: 'Corporation',
    remittance_frequency: 'monthly',
    contact_phone: '',
    address_line2: '',
    province: 'ON',
    override_ei_employer_rate: 1.4
  });

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { id, value, type } = e.target;
    if (type === 'checkbox') {
      const checked = (e.target as HTMLInputElement).checked;
      setSettings(prev => ({ ...prev, [id]: checked ? 1 : 0 }));
    } else {
      setSettings(prev => ({
        ...prev,
        [id]: type === 'number' ? sanitizeNumericInput(value) : value
      }));
    }
  };

  const validateStep = () => {
    if (step === 1) {
      if (!settings.legal_name?.trim()) {
        triggerToast('Legal Company Name is required.', 'error');
        return false;
      }
      if (!settings.business_number?.trim()) {
        triggerToast('CRA Business Number is required.', 'error');
        return false;
      }
      // Basic BN15 validation: 9 digits + RP + 4 digits
      const bnPattern = /^\d{9}RP\d{4}$/i;
      const cleanBN = settings.business_number.replace(/\s+/g, '');
      if (!bnPattern.test(cleanBN)) {
        triggerToast('CRA Business Number must be 15 characters in the format: 123456789RP0001.', 'error');
        return false;
      }
    }
    if (step === 2) {
      if (!settings.contact_name?.trim()) {
        triggerToast('Primary Contact Name is required.', 'error');
        return false;
      }
      if (!settings.contact_email?.trim() || !settings.contact_email.includes('@')) {
        triggerToast('A valid Contact Email is required.', 'error');
        return false;
      }
    }
    return true;
  };

  const handleNext = () => {
    if (validateStep()) {
      setStep(prev => prev + 1);
    }
  };

  const handleBack = () => {
    setStep(prev => prev - 1);
  };

  const handleConnectGmail = async () => {
    try {
      setConnectingGmail(true);
      const res = await api.getGmailAuthUrl(window.location.origin);
      if (res && res.url) {
        window.location.href = res.url;
      } else {
        throw new Error('OAuth URL not returned');
      }
    } catch (error: any) {
      console.error('Failed to get Gmail auth url:', error);
      triggerToast(error.message || 'Failed to initiate Gmail connection.', 'error');
      setConnectingGmail(false);
    }
  };

  const handleSkipGmail = () => {
    if (onboardingResponse) {
      onOnboardingComplete(onboardingResponse.token, onboardingResponse.companyId);
    } else {
      const token = localStorage.getItem('token');
      const companyIdVal = localStorage.getItem('companyId');
      if (token && companyIdVal) {
        onOnboardingComplete(token, parseInt(companyIdVal, 10));
      } else {
        triggerToast('Session error. Please try logging in again.', 'error');
        onLogout();
      }
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validateStep()) return;

    try {
      setSaving(true);
      const response: any = await api.updateSettings(settings);
      
      if (response && response.token && response.companyId) {
        triggerToast('Company profile and payroll setup complete!', 'success');
        localStorage.setItem('token', response.token);
        localStorage.setItem('companyId', response.companyId.toString());
        setOnboardingResponse({ token: response.token, companyId: response.companyId });
        setStep(4);
      } else {
        throw new Error('Onboarding did not return session token');
      }
    } catch (error: any) {
      console.error('Onboarding save error:', error);
      triggerToast(error.message || 'Failed to complete company setup.', 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="min-h-[85vh] flex items-center justify-center p-4">
      <div className="bg-surface-container-lowest border border-outline-variant shadow-lg rounded-2xl p-6 md:p-8 max-w-2xl w-full">
        
        {/* Header */}
        <div className="flex justify-between items-start mb-6">
          <div>
            <h2 className="text-2xl font-bold text-primary tracking-tight">Onboard Your Business</h2>
            <p className="text-xs text-on-surface-variant font-medium mt-1">
              Complete your profile to unlock Ontario-compliant payroll tools.
            </p>
          </div>
          <button 
            onClick={onLogout}
            className="text-xs font-bold text-outline hover:text-error transition-colors flex items-center gap-1 py-1 px-2.5 rounded-lg border border-outline-variant hover:border-error/20"
          >
            <span className="material-symbols-outlined text-[16px]">logout</span>
            Sign Out
          </button>
        </div>

        {/* Step Indicator */}
        <div className="flex items-center justify-between mb-8 relative px-4">
          <div className="absolute left-8 right-8 h-0.5 bg-outline-variant -translate-y-1/2 z-0" style={{ top: '16px' }}>
            <div className="h-full bg-highlight transition-all duration-300" style={{ width: `${(step - 1) * 33.33}%` }}></div>
          </div>

          <div className="relative z-10 flex flex-col items-center">
            <div className={`w-8 h-8 rounded-full flex items-center justify-center font-bold text-xs shadow-sm transition-all ${step >= 1 ? 'bg-highlight text-on-highlight' : 'bg-surface-container border border-outline-variant text-on-surface-variant'}`}>
              {step > 1 ? <span className="material-symbols-outlined text-[16px]">check</span> : '1'}
            </div>
            <span className={`text-[10px] font-bold uppercase tracking-wider mt-1.5 ${step >= 1 ? 'text-primary' : 'text-on-surface-variant'}`}>Company</span>
          </div>

          <div className="relative z-10 flex flex-col items-center">
            <div className={`w-8 h-8 rounded-full flex items-center justify-center font-bold text-xs shadow-sm transition-all ${step >= 2 ? 'bg-highlight text-on-highlight' : 'bg-surface-container border border-outline-variant text-on-surface-variant'}`}>
              {step > 2 ? <span className="material-symbols-outlined text-[16px]">check</span> : '2'}
            </div>
            <span className={`text-[10px] font-bold uppercase tracking-wider mt-1.5 ${step >= 2 ? 'text-primary' : 'text-on-surface-variant'}`}>Contact</span>
          </div>

          <div className="relative z-10 flex flex-col items-center">
            <div className={`w-8 h-8 rounded-full flex items-center justify-center font-bold text-xs shadow-sm transition-all ${step >= 3 ? 'bg-highlight text-on-highlight' : 'bg-surface-container border border-outline-variant text-on-surface-variant'}`}>
              {step > 3 ? <span className="material-symbols-outlined text-[16px]">check</span> : '3'}
            </div>
            <span className={`text-[10px] font-bold uppercase tracking-wider mt-1.5 ${step >= 3 ? 'text-primary' : 'text-on-surface-variant'}`}>Payroll &amp; Tax</span>
          </div>

          <div className="relative z-10 flex flex-col items-center">
            <div className={`w-8 h-8 rounded-full flex items-center justify-center font-bold text-xs shadow-sm transition-all ${step >= 4 ? 'bg-highlight text-on-highlight' : 'bg-surface-container border border-outline-variant text-on-surface-variant'}`}>
              4
            </div>
            <span className={`text-[10px] font-bold uppercase tracking-wider mt-1.5 ${step >= 4 ? 'text-primary' : 'text-on-surface-variant'}`}>Email Stubs</span>
          </div>
        </div>

        {/* Step Content */}
        <form onSubmit={handleSubmit} className="flex flex-col gap-6">
          {step === 1 && (
            <div className="flex flex-col gap-4 animate-fade-in">
              <h3 className="text-sm font-bold text-primary uppercase tracking-wider border-b border-outline-variant pb-1">Business Profile</h3>
              
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-bold text-on-surface-variant uppercase tracking-wider" htmlFor="legal_name">
                  Legal Company Name *
                </label>
                <input 
                  type="text" 
                  id="legal_name"
                  value={settings.legal_name}
                  onChange={handleChange}
                  placeholder="e.g. Ontario Tech Solutions Inc."
                  className="h-10 border border-outline-variant rounded px-3 text-sm focus:outline-none focus:ring-2 focus:ring-highlight bg-transparent w-full"
                  required
                />
              </div>

              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-bold text-on-surface-variant uppercase tracking-wider" htmlFor="operating_name">
                  Operating Name (DBA)
                </label>
                <input 
                  type="text" 
                  id="operating_name"
                  value={settings.operating_name}
                  onChange={handleChange}
                  placeholder="e.g. OTS Labs (Leave empty if same as legal)"
                  className="h-10 border border-outline-variant rounded px-3 text-sm focus:outline-none focus:ring-2 focus:ring-highlight bg-transparent w-full"
                />
              </div>

              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-bold text-on-surface-variant uppercase tracking-wider" htmlFor="business_number">
                  CRA Business Number (BN15) *
                </label>
                <input 
                  type="text" 
                  id="business_number"
                  value={settings.business_number}
                  onChange={handleChange}
                  placeholder="123456789 RP 0001"
                  className="h-10 border border-outline-variant rounded px-3 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-highlight bg-transparent w-full"
                  required
                />
                <p className="text-[10px] text-on-surface-variant leading-tight">
                  Must be in the format: 9 digits, then "RP", then 4 digits. Used for remittances to CRA.
                </p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-bold text-on-surface-variant uppercase tracking-wider" htmlFor="business_type">
                    Type of Business
                  </label>
                  <select 
                    id="business_type"
                    value={settings.business_type || 'Corporation'}
                    onChange={handleChange}
                    className="h-10 border border-outline-variant rounded px-3 text-sm focus:outline-none focus:ring-2 focus:ring-highlight bg-transparent w-full cursor-pointer"
                  >
                    <option value="Corporation">Corporation</option>
                    <option value="Sole Proprietorship">Sole Proprietorship</option>
                    <option value="Partnership">Partnership</option>
                    <option value="Other">Other</option>
                  </select>
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-bold text-on-surface-variant uppercase tracking-wider" htmlFor="owner_sin">
                    Owner's SIN
                  </label>
                  <input 
                    type="text" 
                    id="owner_sin"
                    value={settings.owner_sin || ''}
                    onChange={handleChange}
                    placeholder="e.g. 123-456-789"
                    className="h-10 border border-outline-variant rounded px-3 text-sm focus:outline-none focus:ring-2 focus:ring-highlight bg-transparent w-full"
                  />
                </div>
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="flex flex-col gap-4 animate-fade-in">
              <h3 className="text-sm font-bold text-primary uppercase tracking-wider border-b border-outline-variant pb-1">Location &amp; Administration</h3>
              
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-bold text-on-surface-variant uppercase tracking-wider" htmlFor="address_line1">
                    Street Address
                  </label>
                  <input 
                    type="text" 
                    id="address_line1"
                    value={settings.address_line1}
                    onChange={handleChange}
                    placeholder="123 Bay Street"
                    className="h-10 border border-outline-variant rounded px-3 text-sm focus:outline-none focus:ring-2 focus:ring-highlight bg-transparent w-full"
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-bold text-on-surface-variant uppercase tracking-wider" htmlFor="address_line2">
                    Address Line 2
                  </label>
                  <input 
                    type="text" 
                    id="address_line2"
                    value={settings.address_line2 || ''}
                    onChange={handleChange}
                    placeholder="Suite, Unit, Apt #"
                    className="h-10 border border-outline-variant rounded px-3 text-sm focus:outline-none focus:ring-2 focus:ring-highlight bg-transparent w-full"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-bold text-on-surface-variant uppercase tracking-wider" htmlFor="city">
                    City
                  </label>
                  <input 
                    type="text" 
                    id="city"
                    value={settings.city}
                    onChange={handleChange}
                    placeholder="Toronto"
                    className="h-10 border border-outline-variant rounded px-3 text-sm focus:outline-none focus:ring-2 focus:ring-highlight bg-transparent w-full"
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-bold text-on-surface-variant uppercase tracking-wider" htmlFor="province">
                    Province
                  </label>
                  <select 
                    id="province"
                    value={settings.province || 'ON'}
                    onChange={handleChange}
                    className="h-10 border border-outline-variant rounded px-3 text-sm focus:outline-none focus:ring-2 focus:ring-highlight bg-transparent w-full cursor-pointer"
                  >
                    <option value="ON">Ontario (ON)</option>
                    <option value="AB">Alberta (AB)</option>
                    <option value="BC">British Columbia (BC)</option>
                    <option value="MB">Manitoba (MB)</option>
                    <option value="NB">New Brunswick (NB)</option>
                    <option value="NL">Newfoundland (NL)</option>
                    <option value="NS">Nova Scotia (NS)</option>
                    <option value="PE">Prince Edward Island (PE)</option>
                    <option value="QC">Quebec (QC)</option>
                    <option value="SK">Saskatchewan (SK)</option>
                  </select>
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-bold text-on-surface-variant uppercase tracking-wider" htmlFor="postal_code">
                    Postal Code
                  </label>
                  <input 
                    type="text" 
                    id="postal_code"
                    value={settings.postal_code}
                    onChange={handleChange}
                    placeholder="M5H 2Y2"
                    className="h-10 border border-outline-variant rounded px-3 text-sm uppercase focus:outline-none focus:ring-2 focus:ring-highlight bg-transparent w-full"
                  />
                </div>
              </div>

              <div className="mt-2 pt-2 border-t border-outline-variant">
                <p className="text-xs font-bold text-primary mb-3">Primary Payroll Contact *</p>
              </div>

              <div className="flex flex-col gap-4">
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-bold text-on-surface-variant uppercase tracking-wider" htmlFor="contact_name">
                    Contact Name *
                  </label>
                  <input 
                    type="text" 
                    id="contact_name"
                    value={settings.contact_name}
                    onChange={handleChange}
                    placeholder="Jane Doe"
                    className="h-10 border border-outline-variant rounded px-3 text-sm focus:outline-none focus:ring-2 focus:ring-highlight bg-transparent w-full"
                    required
                  />
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="flex flex-col gap-1.5">
                    <label className="text-xs font-bold text-on-surface-variant uppercase tracking-wider" htmlFor="contact_email">
                      Contact Email *
                    </label>
                    <input 
                      type="email" 
                      id="contact_email"
                      value={settings.contact_email}
                      onChange={handleChange}
                      placeholder="payroll@yourcompany.ca"
                      className="h-10 border border-outline-variant rounded px-3 text-sm focus:outline-none focus:ring-2 focus:ring-highlight bg-transparent w-full"
                      required
                    />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <label className="text-xs font-bold text-on-surface-variant uppercase tracking-wider" htmlFor="contact_phone">
                      Contact Phone
                    </label>
                    <input 
                      type="text" 
                      id="contact_phone"
                      value={settings.contact_phone || ''}
                      onChange={handleChange}
                      placeholder="e.g. 416-555-0199"
                      className="h-10 border border-outline-variant rounded px-3 text-sm focus:outline-none focus:ring-2 focus:ring-highlight bg-transparent w-full"
                    />
                  </div>
                </div>
              </div>
            </div>
          )}

          {step === 3 && (
            <div className="flex flex-col gap-4 animate-fade-in">
              <h3 className="text-sm font-bold text-primary uppercase tracking-wider border-b border-outline-variant pb-1">Ontario Tax Compliance &amp; Policies</h3>
              
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-bold text-on-surface-variant uppercase tracking-wider" htmlFor="pay_period">
                    Default Pay Period
                  </label>
                  <select 
                    id="pay_period" 
                    value={settings.pay_period} 
                    onChange={handleChange}
                    className="h-10 border border-outline-variant rounded px-3 text-sm focus:outline-none focus:ring-2 focus:ring-highlight bg-transparent w-full cursor-pointer"
                  >
                    <option value="weekly">Weekly</option>
                    <option value="bi-weekly">Bi-weekly</option>
                    <option value="semi-monthly">Semi-monthly</option>
                    <option value="monthly">Monthly</option>
                  </select>
                </div>

                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-bold text-on-surface-variant uppercase tracking-wider" htmlFor="vacation_rate">
                    Vacation Accrual Rate (%)
                  </label>
                  <input 
                    type="number" 
                    step="0.01"
                    id="vacation_rate"
                    value={settings.vacation_rate}
                    onChange={handleChange}
                    className="h-10 border border-outline-variant rounded px-3 text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-highlight w-full"
                  />
                  <p className="text-[9px] text-on-surface-variant">Ontario minimum is 4.0% (2 weeks vacation).</p>
                </div>
              </div>

              <div className="border-t border-outline-variant pt-3 flex flex-col gap-4">
                {/* WSIB Profile */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="flex flex-col gap-1.5">
                    <label className="text-xs font-bold text-on-surface-variant uppercase tracking-wider" htmlFor="wsib_number">
                      WSIB Account Number
                    </label>
                    <input 
                      type="text" 
                      id="wsib_number"
                      value={settings.wsib_number}
                      onChange={handleChange}
                      placeholder="e.g. 123456789"
                      className="h-10 border border-outline-variant rounded px-3 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-highlight w-full"
                    />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <label className="text-xs font-bold text-on-surface-variant uppercase tracking-wider" htmlFor="wsib_rate">
                      WSIB Rate (%)
                    </label>
                    <input 
                      type="number" 
                      step="0.01"
                      id="wsib_rate"
                      value={settings.wsib_rate}
                      onChange={handleChange}
                      className="h-10 border border-outline-variant rounded px-3 text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-highlight w-full"
                    />
                  </div>
                </div>

                {/* EHT Exemption */}
                <div className="bg-surface-container-low border border-outline-variant/60 rounded-xl p-4 flex flex-col gap-3">
                  <div className="flex items-start gap-3 cursor-pointer group">
                    <div className="relative flex items-center justify-center mt-0.5">
                      <input 
                        type="checkbox" 
                        id="eht_exempt"
                        checked={settings.eht_exempt === 1}
                        onChange={handleChange}
                        className="peer sr-only"
                      />
                      <div className="w-5 h-5 border-2 border-outline rounded bg-transparent peer-checked:bg-highlight peer-checked:border-highlight transition-colors"></div>
                      <span className="material-symbols-outlined absolute text-on-highlight text-[16px] opacity-0 peer-checked:opacity-100 transition-opacity">check</span>
                    </div>
                    <div className="flex flex-col">
                      <span className="text-sm font-semibold text-on-surface group-hover:text-primary transition-colors">Claim EHT Exemption</span>
                      <span className="text-[10px] text-on-surface-variant leading-tight mt-1">
                        Ontario Private-sector employers are exempt from Employer Health Tax on the first $1,000,000 of payroll.
                      </span>
                    </div>
                  </div>

                  <div className="flex flex-col gap-1.5">
                    <label className="text-xs font-bold text-on-surface-variant uppercase tracking-wider" htmlFor="eht_rate">
                      EHT Rate (%) (If over threshold)
                    </label>
                    <input 
                      type="number" 
                      step="0.01"
                      id="eht_rate"
                      value={settings.eht_rate}
                      onChange={handleChange}
                      className="h-10 border border-outline-variant bg-surface-container-lowest rounded px-3 text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-highlight w-full"
                    />
                  </div>
                </div>

                {/* Remittance & EI Overrides */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 border-t border-outline-variant pt-4">
                  <div className="flex flex-col gap-1.5">
                    <label className="text-xs font-bold text-on-surface-variant uppercase tracking-wider" htmlFor="remittance_frequency">
                      Remittance Frequency
                    </label>
                    <select 
                      id="remittance_frequency"
                      value={settings.remittance_frequency || 'monthly'}
                      onChange={handleChange}
                      className="h-10 border border-outline-variant rounded px-3 text-sm focus:outline-none focus:ring-2 focus:ring-highlight bg-transparent w-full cursor-pointer"
                    >
                      <option value="quarterly">Quarterly</option>
                      <option value="monthly">Monthly</option>
                      <option value="2x/month">Up to 2x / month</option>
                      <option value="4x/month">Up to 4x / month</option>
                    </select>
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <label className="text-xs font-bold text-on-surface-variant uppercase tracking-wider" htmlFor="override_ei_employer_rate">
                      EI Employer Premium Rate Override
                    </label>
                    <input 
                      type="number" 
                      step="0.01"
                      id="override_ei_employer_rate"
                      value={settings.override_ei_employer_rate !== undefined ? settings.override_ei_employer_rate : 1.4}
                      onChange={handleChange}
                      className="h-10 border border-outline-variant rounded px-3 text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-highlight w-full"
                    />
                    <p className="text-[9px] text-on-surface-variant">Default is 1.4. Applied as match multiplier on employee EI deduction.</p>
                  </div>
                </div>
              </div>
            </div>
          )}

          {step === 4 && (
            <div className="flex flex-col items-center text-center gap-6 animate-fade-in py-4">
              <div className="w-16 h-16 rounded-full bg-highlight/10 flex items-center justify-center text-highlight">
                <span className="material-symbols-outlined text-3xl">mail</span>
              </div>
              <div>
                <h3 className="text-lg font-bold text-on-surface">Enable Email Paystubs</h3>
                <p className="text-sm text-on-surface-variant mt-2 max-w-md">
                  Securely link your Gmail account to send professional, Ontario-compliant paystubs directly to employees from your email address. 
                </p>
                <p className="text-xs text-outline mt-3 max-w-sm">
                  If skipped, paystub email buttons and actions will be disabled and hidden throughout the application. You can always enable this later in settings.
                </p>
              </div>

              <div className="flex flex-col gap-3 w-full max-w-xs mt-2">
                <button
                  type="button"
                  onClick={handleConnectGmail}
                  disabled={connectingGmail}
                  className="w-full h-11 bg-highlight text-on-highlight rounded-xl font-bold text-sm hover:bg-opacity-90 transition-all shadow-sm flex items-center justify-center gap-2"
                >
                  {connectingGmail ? (
                    <>
                      <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-on-highlight"></div>
                      Connecting...
                    </>
                  ) : (
                    <>
                      <span className="material-symbols-outlined text-[18px]">key</span>
                      Connect Gmail Account
                    </>
                  )}
                </button>

                <button
                  type="button"
                  onClick={handleSkipGmail}
                  className="w-full h-11 border border-outline-variant hover:bg-surface-container-low rounded-xl font-bold text-sm text-highlight transition-colors"
                >
                  Skip &amp; Go to Dashboard
                </button>
              </div>
            </div>
          )}

          {/* Navigation Buttons */}
          {step < 4 && (
            <div className="flex items-center justify-between mt-4 pt-4 border-t border-outline-variant">
              {step > 1 ? (
                <button 
                  type="button" 
                  onClick={handleBack}
                  className="px-5 py-2.5 rounded-xl border border-outline-variant hover:bg-surface-container-low text-xs font-bold text-highlight transition-colors flex items-center gap-1"
                >
                  <span className="material-symbols-outlined text-[16px]">arrow_back</span>
                  Back
                </button>
              ) : (
                <div />
              )}

              {step < 3 ? (
                <button 
                  type="button" 
                  onClick={handleNext}
                  className="px-5 py-2.5 rounded-xl bg-highlight text-on-highlight text-xs font-bold hover:bg-opacity-90 transition-all shadow-sm flex items-center gap-1"
                >
                  Continue
                  <span className="material-symbols-outlined text-[16px]">arrow_forward</span>
                </button>
              ) : (
                <button 
                  type="submit"
                  disabled={saving}
                  className="px-6 py-2.5 rounded-xl bg-highlight text-on-highlight text-xs font-bold hover:bg-opacity-90 transition-all shadow-sm disabled:opacity-50 flex items-center gap-1"
                >
                  {saving ? (
                    <>
                      <div className="animate-spin rounded-full h-3 w-3 border-b-2 border-on-highlight mr-1"></div>
                      Setting up...
                    </>
                  ) : (
                    <>
                      <span className="material-symbols-outlined text-[16px]">rocket_launch</span>
                      Finish Setup &amp; Enter Dashboard
                    </>
                  )}
                </button>
              )}
            </div>
          )}
        </form>
      </div>
    </div>
  );
};

export default OnboardingView;
