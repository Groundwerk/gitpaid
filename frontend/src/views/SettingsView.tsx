import React, { useEffect, useState } from 'react';
import { api } from '../utils/api';
import { sanitizeNumericInput } from '../utils/helpers';
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
  const [activeTab, setActiveTab] = useState<'company' | 'paygroups'>('company');
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
    pay_period: 'bi-weekly',
    owner_sin: '',
    business_type: 'Corporation',
    remittance_frequency: 'monthly',
    contact_phone: '',
    address_line2: '',
    province: 'ON',
    override_ei_employer_rate: 1.4
  });

  // Pay Groups & Schedules state
  const [payGroups, setPayGroups] = useState<any[]>([]);
  const [payGroupsLoading, setPayGroupsLoading] = useState(false);
  const [selectedGroupId, setSelectedGroupId] = useState<number | null>(null);
  const [schedules, setSchedules] = useState<any[]>([]);
  const [schedulesLoading, setSchedulesLoading] = useState(false);
  
  // Create Pay Group Form state
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newGroupName, setNewGroupName] = useState('');
  const [newGroupFrequency, setNewGroupFrequency] = useState('bi-weekly');
  const [firstStart, setFirstStart] = useState('');
  const [firstEnd, setFirstEnd] = useState('');
  const [firstPayment, setFirstPayment] = useState('');

  // Inline generate schedules state
  const [genStart, setGenStart] = useState('');
  const [genEnd, setGenEnd] = useState('');
  const [genPayment, setGenPayment] = useState('');
  const [generatingSchedules, setGeneratingSchedules] = useState(false);

  // Inline edit schedules state
  const [editingScheduleId, setEditingScheduleId] = useState<number | null>(null);
  const [editStart, setEditStart] = useState('');
  const [editEnd, setEditEnd] = useState('');
  const [editPayment, setEditPayment] = useState('');

  const [connectingGmail, setConnectingGmail] = useState(false);
  const [disconnectingGmail, setDisconnectingGmail] = useState(false);

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
    } finally {
      setConnectingGmail(false);
    }
  };

  const handleDisconnectGmail = async () => {
    if (!window.confirm('Are you sure you want to disconnect Gmail? All email stub features will be hidden.')) {
      return;
    }
    try {
      setDisconnectingGmail(true);
      await api.disconnectGmail();
      triggerToast('Gmail account disconnected successfully!', 'success');
      
      const data = await api.getSettings();
      if (data) {
        setSettings(data);
      }
      if (onSettingsUpdate) onSettingsUpdate();
    } catch (error: any) {
      console.error('Failed to disconnect Gmail:', error);
      triggerToast(error.message || 'Failed to disconnect Gmail account.', 'error');
    } finally {
      setDisconnectingGmail(false);
    }
  };

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

  const getSensibleDefaults = (frequency: string) => {
    const today = new Date();
    const formatDate = (d: Date) => {
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      return `${y}-${m}-${day}`;
    };

    if (frequency === 'weekly') {
      const currentDay = today.getDay();
      const distanceToMon = currentDay === 0 ? -6 : 1 - currentDay;
      const start = new Date(today);
      start.setDate(today.getDate() + distanceToMon);
      
      const end = new Date(start);
      end.setDate(start.getDate() + 6);
      
      const payment = new Date(start);
      payment.setDate(start.getDate() + 11); // Friday of the week
      return { start: formatDate(start), end: formatDate(end), payment: formatDate(payment) };
    } else if (frequency === 'bi-weekly') {
      const currentDay = today.getDay();
      const distanceToMon = currentDay === 0 ? -6 : 1 - currentDay;
      const start = new Date(today);
      start.setDate(today.getDate() + distanceToMon);
      
      const end = new Date(start);
      end.setDate(start.getDate() + 13);
      
      const payment = new Date(start);
      payment.setDate(start.getDate() + 18); // Friday of next week
      return { start: formatDate(start), end: formatDate(end), payment: formatDate(payment) };
    } else if (frequency === 'semi-monthly') {
      const day = today.getDate();
      const year = today.getFullYear();
      const month = today.getMonth();
      if (day <= 15) {
        const start = new Date(year, month, 1);
        const end = new Date(year, month, 15);
        const payment = new Date(year, month, 20);
        return { start: formatDate(start), end: formatDate(end), payment: formatDate(payment) };
      } else {
        const start = new Date(year, month, 16);
        const end = new Date(year, month + 1, 0); // Last day of month
        const payment = new Date(year, month + 1, 5); // 5th of next month
        return { start: formatDate(start), end: formatDate(end), payment: formatDate(payment) };
      }
    } else { // monthly
      const year = today.getFullYear();
      const month = today.getMonth();
      const start = new Date(year, month, 1);
      const end = new Date(year, month + 1, 0); // Last day of month
      const payment = new Date(year, month + 1, 1); // 1st of next month
      return { start: formatDate(start), end: formatDate(end), payment: formatDate(payment) };
    }
  };

  const loadPayGroups = async () => {
    try {
      setPayGroupsLoading(true);
      const data = await api.getPayGroups();
      setPayGroups(data);
      if (selectedGroupId) {
        await loadGroupSchedules(selectedGroupId, data);
      }
    } catch (err: any) {
      console.error(err);
      triggerToast('Failed to load pay groups.', 'error');
    } finally {
      setPayGroupsLoading(false);
    }
  };

  const loadGroupSchedules = async (groupId: number, currentGroupsList?: any[]) => {
    setSelectedGroupId(groupId);
    try {
      setSchedulesLoading(true);
      const data = await api.getPayGroupSchedules(groupId);
      setSchedules(data);
      
      const groups = currentGroupsList || payGroups;
      const group = groups.find(g => g.id === groupId);
      if (group && data.length === 0) {
        const defaults = getSensibleDefaults(group.pay_frequency);
        setGenStart(defaults.start);
        setGenEnd(defaults.end);
        setGenPayment(defaults.payment);
      }
    } catch (err: any) {
      console.error(err);
      triggerToast('Failed to load schedules for this pay group.', 'error');
    } finally {
      setSchedulesLoading(false);
    }
  };

  useEffect(() => {
    if (showCreateModal) {
      const defaults = getSensibleDefaults(newGroupFrequency);
      setFirstStart(defaults.start);
      setFirstEnd(defaults.end);
      setFirstPayment(defaults.payment);
    }
  }, [showCreateModal, newGroupFrequency]);


  useEffect(() => {
    if (activeTab === 'paygroups') {
      loadPayGroups();
    }
  }, [activeTab]);

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

  const handleCreatePayGroup = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newGroupName.trim() || !firstStart || !firstEnd || !firstPayment) {
      triggerToast('Please fill in all fields.', 'error');
      return;
    }
    try {
      setSaving(true);
      await api.createPayGroup({
        name: newGroupName,
        pay_frequency: newGroupFrequency,
        first_period_start: firstStart,
        first_period_end: firstEnd,
        first_payment_date: firstPayment,
        num_periods: 1
      });
      triggerToast('Pay Group and schedule calendar created successfully!', 'success');
      setShowCreateModal(false);
      
      // Reset form
      setNewGroupName('');
      setNewGroupFrequency('bi-weekly');
      setFirstStart('');
      setFirstEnd('');
      setFirstPayment('');
      
      await loadPayGroups();
    } catch (err: any) {
      console.error(err);
      triggerToast(err.message || 'Failed to create pay group.', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleGenerateSchedules = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedGroupId) return;
    if (!genStart || !genEnd || !genPayment) {
      triggerToast('Please provide all schedule start, end, and payment dates.', 'error');
      return;
    }
    try {
      setGeneratingSchedules(true);
      await api.generateSchedulesForGroup(selectedGroupId, {
        first_period_start: genStart,
        first_period_end: genEnd,
        first_payment_date: genPayment,
        num_periods: 1
      });
      triggerToast('Schedule calendar generated successfully!', 'success');
      setGenStart('');
      setGenEnd('');
      setGenPayment('');
      await loadGroupSchedules(selectedGroupId);
    } catch (err: any) {
      console.error(err);
      triggerToast(err.message || 'Failed to generate schedules.', 'error');
    } finally {
      setGeneratingSchedules(false);
    }
  };

  const handleDeletePayGroup = async (id: number, name: string) => {
    if (!confirm(`Are you sure you want to delete the Pay Group "${name}"? This will permanently delete all open schedules for this group.`)) {
      return;
    }
    try {
      await api.deletePayGroup(id);
      triggerToast('Pay Group successfully deleted.', 'success');
      if (selectedGroupId === id) {
        setSelectedGroupId(null);
        setSchedules([]);
      }
      await loadPayGroups();
    } catch (err: any) {
      console.error(err);
      triggerToast(err.message || 'Failed to delete pay group.', 'error');
    }
  };

  const handleSaveScheduleEdit = async (s: any) => {
    if (!editStart || !editEnd || !editPayment) {
      triggerToast('Please fill in all date fields.', 'error');
      return;
    }
    try {
      setSaving(true);
      await api.updateScheduleDates(s.pay_group_id, s.id, {
        period_start: editStart,
        period_end: editEnd,
        payment_date: editPayment
      });
      triggerToast('Schedule period updated successfully.', 'success');
      setEditingScheduleId(null);
      await loadGroupSchedules(s.pay_group_id);
    } catch (err: any) {
      console.error(err);
      triggerToast(err.message || 'Failed to update schedule period.', 'error');
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
        <p className="text-sm text-on-surface-variant">Configure legal entities, contact directories, and pay schedules.</p>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-outline-variant gap-4">
        <button
          onClick={() => setActiveTab('company')}
          className={`pb-2.5 px-4 text-sm font-bold border-b-2 transition-colors cursor-pointer bg-transparent border-none ${
            activeTab === 'company' 
              ? 'border-primary text-primary font-black' 
              : 'border-transparent text-on-surface-variant hover:text-on-surface'
          }`}
        >
          Company Profile &amp; Policies
        </button>
        <button
          onClick={() => setActiveTab('paygroups')}
          className={`pb-2.5 px-4 text-sm font-bold border-b-2 transition-colors cursor-pointer bg-transparent border-none ${
            activeTab === 'paygroups' 
              ? 'border-primary text-primary font-black' 
              : 'border-transparent text-on-surface-variant hover:text-on-surface'
          }`}
        >
          Pay Groups &amp; Schedules
        </button>
      </div>

      {activeTab === 'company' && (
        <form onSubmit={handleSubmit} className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start animate-fade-in">
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
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-bold text-on-surface-variant uppercase tracking-wider" htmlFor="business_type">Type of Business</label>
                  <select 
                    id="business_type"
                    value={settings.business_type || 'Corporation'}
                    onChange={handleChange}
                    className="h-10 border border-outline-variant rounded px-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary bg-transparent w-full cursor-pointer"
                  >
                    <option value="Corporation">Corporation</option>
                    <option value="Sole Proprietorship">Sole Proprietorship</option>
                    <option value="Partnership">Partnership</option>
                    <option value="Other">Other</option>
                  </select>
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-bold text-on-surface-variant uppercase tracking-wider" htmlFor="owner_sin">Owner's SIN</label>
                  <input 
                    type="text" 
                    id="owner_sin"
                    value={settings.owner_sin || ''}
                    onChange={handleChange}
                    placeholder="e.g. 123-456-789"
                    className="h-10 border border-outline-variant rounded px-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary bg-transparent w-full"
                  />
                </div>
              </div>
            </section>

            {/* Location & Contact Card */}
            <section className="bg-surface-container-lowest border border-outline-variant rounded-xl p-6 shadow-sm">
              <h3 className="text-base font-bold text-primary mb-6 border-b border-outline-variant pb-2">Location &amp; Contact</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="flex flex-col gap-1.5">
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
                  <label className="text-xs font-bold text-on-surface-variant uppercase tracking-wider" htmlFor="address_line2">Address Line 2</label>
                  <input 
                    type="text" 
                    id="address_line2"
                    value={settings.address_line2 || ''}
                    onChange={handleChange}
                    className="h-10 border border-outline-variant rounded px-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary bg-transparent w-full"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-4">
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
                  <label className="text-xs font-bold text-on-surface-variant uppercase tracking-wider" htmlFor="province">Province</label>
                  <select 
                    id="province"
                    value={settings.province || 'ON'}
                    onChange={handleChange}
                    className="h-10 border border-outline-variant rounded px-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary bg-transparent w-full cursor-pointer"
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
                  <label className="text-xs font-bold text-on-surface-variant uppercase tracking-wider" htmlFor="postal_code">Postal Code</label>
                  <input 
                    type="text" 
                    id="postal_code"
                    value={settings.postal_code}
                    onChange={handleChange}
                    className="h-10 border border-outline-variant rounded px-3 text-sm uppercase focus:outline-none focus:ring-2 focus:ring-primary bg-transparent w-full"
                  />
                </div>
              </div>

              <div className="mt-4 pt-4 border-t border-outline-variant">
                <p className="text-xs font-bold text-primary mb-3">Primary Payroll Administrator</p>
              </div>

              <div className="flex flex-col gap-4">
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
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
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
                  <div className="flex flex-col gap-1.5">
                    <label className="text-xs font-bold text-on-surface-variant uppercase tracking-wider" htmlFor="contact_phone">Phone Number</label>
                    <input 
                      type="text" 
                      id="contact_phone"
                      value={settings.contact_phone || ''}
                      onChange={handleChange}
                      className="h-10 border border-outline-variant rounded px-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary bg-transparent w-full"
                    />
                  </div>
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

                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-bold text-on-surface-variant uppercase tracking-wider" htmlFor="remittance_frequency">Remittance Frequency</label>
                  <select 
                    id="remittance_frequency" 
                    value={settings.remittance_frequency || 'monthly'} 
                    onChange={handleChange}
                    className="h-10 border border-outline-variant rounded px-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary bg-transparent w-full cursor-pointer"
                  >
                    <option value="quarterly">Quarterly</option>
                    <option value="monthly">Monthly</option>
                    <option value="2x/month">Up to 2x / month</option>
                    <option value="4x/month">Up to 4x / month</option>
                  </select>
                </div>

                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-bold text-on-surface-variant uppercase tracking-wider" htmlFor="override_ei_employer_rate">EI Employer Rate Override</label>
                  <input 
                    type="number" 
                    step="0.01"
                    id="override_ei_employer_rate"
                    value={settings.override_ei_employer_rate !== undefined ? settings.override_ei_employer_rate : 1.4}
                    onChange={handleChange}
                    className="h-10 border border-outline-variant rounded px-3 text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-primary w-full"
                  />
                  <p className="text-[10px] text-on-surface-variant leading-tight">
                    Default is 1.4. Applied as match multiplier on employee EI.
                  </p>
                </div>
              </div>
            </section>

            {/* Card: Email Paystubs Integration */}
            <section className="bg-surface-container-lowest border border-outline-variant rounded-xl p-6 shadow-sm">
              <h3 className="text-base font-bold text-primary mb-4 border-b border-outline-variant pb-2 flex items-center gap-2">
                <span className="material-symbols-outlined text-[20px]">mail</span>
                Email Paystubs Integration
              </h3>
              
              <div className="flex flex-col gap-4">
                {settings.gmail_email ? (
                  <div className="flex flex-col gap-3">
                    <div className="flex items-center gap-2 bg-green-50 border border-green-200 text-green-800 rounded-lg p-3 text-xs font-semibold">
                      <span className="material-symbols-outlined text-[18px]">check_circle</span>
                      <div className="flex-1">
                        <div className="font-bold text-[11px] uppercase tracking-wider">Connected</div>
                        <div className="text-[13px] font-mono mt-0.5">{settings.gmail_email}</div>
                      </div>
                    </div>
                    <p className="text-[11px] text-on-surface-variant leading-relaxed">
                      All PDF paystub email features are enabled. Paystubs will be sent to employees from this Gmail address.
                    </p>
                    <button
                      type="button"
                      onClick={handleDisconnectGmail}
                      disabled={disconnectingGmail}
                      className="w-full px-4 py-2.5 rounded-lg border border-red-200 hover:bg-red-50 text-xs font-bold text-red-600 transition-colors flex items-center justify-center gap-1.5 cursor-pointer bg-transparent"
                    >
                      {disconnectingGmail ? (
                        <>
                          <div className="animate-spin rounded-full h-3.5 w-3.5 border-b-2 border-red-600"></div>
                          Disconnecting...
                        </>
                      ) : (
                        <>
                          <span className="material-symbols-outlined text-[16px]">link_off</span>
                          Disconnect Gmail Account
                        </>
                      )}
                    </button>
                  </div>
                ) : (
                  <div className="flex flex-col gap-3">
                    <div className="flex items-center gap-2 bg-surface-container-low border border-outline-variant text-on-surface-variant rounded-lg p-3 text-xs font-semibold">
                      <span className="material-symbols-outlined text-[18px]">info</span>
                      <div className="flex-1">
                        <div className="font-bold text-[11px] uppercase tracking-wider">Not Connected</div>
                        <div className="text-[13px] mt-0.5">Gmail integration is inactive.</div>
                      </div>
                    </div>
                    <p className="text-[11px] text-on-surface-variant leading-relaxed">
                      Link your Gmail account to enable direct emailing of paystubs. If not linked, all paystub email features will be hidden.
                    </p>
                    <button
                      type="button"
                      onClick={handleConnectGmail}
                      disabled={connectingGmail}
                      className="w-full px-4 py-2.5 rounded-lg bg-primary text-on-primary text-xs font-bold hover:bg-opacity-95 transition-all shadow-sm flex items-center justify-center gap-1.5 cursor-pointer border-none"
                    >
                      {connectingGmail ? (
                        <>
                          <div className="animate-spin rounded-full h-3.5 w-3.5 border-b-2 border-on-primary"></div>
                          Connecting...
                        </>
                      ) : (
                        <>
                          <span className="material-symbols-outlined text-[16px]">key</span>
                          Connect Gmail Account
                        </>
                      )}
                    </button>
                  </div>
                )}
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
      )}

      {activeTab === 'paygroups' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start animate-fade-in">
          {/* Left Column: Groups List */}
          <div className="lg:col-span-6 bg-surface-container-lowest border border-outline-variant rounded-xl shadow-sm overflow-hidden flex flex-col">
            <div className="p-4 bg-surface-container-low border-b border-outline-variant flex justify-between items-center">
              <h3 className="font-bold text-sm text-primary">Configured Pay Groups</h3>
              <button
                onClick={() => setShowCreateModal(true)}
                className="bg-primary hover:bg-opacity-95 text-on-primary text-xs font-bold py-1.5 px-3 rounded-lg flex items-center gap-1 cursor-pointer border-none"
              >
                <span className="material-symbols-outlined text-xs font-bold">add</span>
                Add Pay Group
              </button>
            </div>
            
            <div className="divide-y divide-outline-variant">
              {payGroupsLoading ? (
                <div className="p-8 text-center text-xs">Loading pay groups...</div>
              ) : payGroups.length > 0 ? (
                payGroups.map((group) => {
                  const isSelected = selectedGroupId === group.id;
                  return (
                    <div
                      key={group.id}
                      onClick={() => loadGroupSchedules(group.id)}
                      className={`p-4 flex justify-between items-center transition-colors cursor-pointer ${
                        isSelected ? 'bg-primary/5 border-l-4 border-primary' : 'hover:bg-surface-container-low/20'
                      }`}
                    >
                      <div>
                        <h4 className="text-sm font-bold text-primary">{group.name}</h4>
                        <p className="text-[10px] text-on-surface-variant font-medium uppercase mt-0.5">
                          {group.pay_frequency} • {group.employee_count || 0} Member(s)
                        </p>
                      </div>
                      <div className="flex gap-2" onClick={(e) => e.stopPropagation()}>
                        <button
                          onClick={() => loadGroupSchedules(group.id)}
                          className="p-1 hover:bg-surface-container-high rounded text-secondary bg-transparent border-none cursor-pointer flex items-center justify-center"
                          title="View Schedule Calendar"
                        >
                          <span className="material-symbols-outlined text-sm">calendar_month</span>
                        </button>
                        <button
                          onClick={() => handleDeletePayGroup(group.id, group.name)}
                          className="p-1 hover:bg-error-container hover:bg-opacity-20 rounded text-error bg-transparent border-none cursor-pointer flex items-center justify-center"
                          title="Delete Pay Group"
                        >
                          <span className="material-symbols-outlined text-sm">delete</span>
                        </button>
                      </div>
                    </div>
                  );
                })
              ) : (
                <div className="p-8 text-center text-xs text-on-surface-variant font-medium">
                  No pay groups configured. Click "Add Pay Group" to create one.
                </div>
              )}
            </div>
          </div>

          {/* Right Column: Schedule Calendar */}
          <div className="lg:col-span-6 bg-surface-container-lowest border border-outline-variant rounded-xl shadow-sm overflow-hidden flex flex-col h-[450px]">
            <div className="p-4 bg-surface-container-low border-b border-outline-variant">
              <h3 className="font-bold text-sm text-primary">Schedule Calendar periods</h3>
            </div>
            <div className="flex-1 overflow-y-auto divide-y divide-outline-variant">
              {schedulesLoading ? (
                <div className="p-8 text-center text-xs">Loading schedule periods...</div>
              ) : selectedGroupId ? (
                schedules.length > 0 ? (
                  schedules.map((s) => {
                    const isProcessed = s.status === 'processed';
                    const isEditing = editingScheduleId === s.id;

                    if (isEditing) {
                      return (
                        <div key={s.id} className="p-3 flex flex-col gap-2 bg-surface-container-low/50">
                          <div className="grid grid-cols-2 gap-2">
                            <div className="flex flex-col gap-1">
                              <label className="text-[9px] font-bold text-on-surface-variant uppercase">Start Date</label>
                              <input 
                                type="date"
                                value={editStart}
                                onChange={(e) => setEditStart(e.target.value)}
                                className="h-8 border border-outline-variant rounded px-2 text-xs focus:outline-none focus:ring-1 focus:ring-primary bg-transparent text-on-surface"
                              />
                            </div>
                            <div className="flex flex-col gap-1">
                              <label className="text-[9px] font-bold text-on-surface-variant uppercase">End Date</label>
                              <input 
                                type="date"
                                value={editEnd}
                                onChange={(e) => setEditEnd(e.target.value)}
                                className="h-8 border border-outline-variant rounded px-2 text-xs focus:outline-none focus:ring-1 focus:ring-primary bg-transparent text-on-surface"
                              />
                            </div>
                          </div>
                          <div className="flex flex-col gap-1">
                            <label className="text-[9px] font-bold text-on-surface-variant uppercase">Pay Date</label>
                            <input 
                              type="date"
                              value={editPayment}
                              onChange={(e) => setEditPayment(e.target.value)}
                              className="h-8 border border-outline-variant rounded px-2 text-xs focus:outline-none focus:ring-1 focus:ring-primary bg-transparent text-on-surface w-full"
                            />
                          </div>
                          <div className="flex justify-end gap-2 mt-1">
                            <button
                              type="button"
                              onClick={() => setEditingScheduleId(null)}
                              className="px-2.5 py-1 text-[10px] font-bold border border-outline rounded hover:bg-surface-container-high bg-transparent text-on-surface-variant cursor-pointer"
                            >
                              Cancel
                            </button>
                            <button
                              type="button"
                              onClick={() => handleSaveScheduleEdit(s)}
                              disabled={saving}
                              className="px-2.5 py-1 text-[10px] font-bold bg-primary text-on-primary rounded hover:bg-opacity-90 cursor-pointer border-none"
                            >
                              {saving ? 'Saving...' : 'Save'}
                            </button>
                          </div>
                        </div>
                      );
                    }

                    return (
                      <div key={s.id} className="p-3 flex justify-between items-center text-xs font-semibold group/schedule">
                        <div>
                          <div className="text-on-surface">Period: <strong>{s.period_start}</strong> to <strong>{s.period_end}</strong></div>
                          <div className="text-[10px] text-on-surface-variant mt-0.5">Pay Date: <strong>{s.payment_date}</strong></div>
                        </div>
                        <div className="flex items-center gap-2">
                          {!isProcessed && (
                            <button
                              onClick={() => {
                                setEditingScheduleId(s.id);
                                setEditStart(s.period_start);
                                setEditEnd(s.period_end);
                                setEditPayment(s.payment_date);
                              }}
                              className="p-1 hover:bg-surface-container-high rounded text-secondary bg-transparent border-none cursor-pointer flex items-center justify-center opacity-60 hover:opacity-100 transition-opacity"
                              title="Edit Period Dates"
                            >
                              <span className="material-symbols-outlined text-sm">edit</span>
                            </button>
                          )}
                          <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded uppercase border ${
                            isProcessed 
                              ? 'bg-emerald-50 text-emerald-800 border-emerald-200' 
                              : 'bg-amber-50 text-amber-800 border-amber-200'
                          }`}>
                            {s.status}
                          </span>
                        </div>
                      </div>
                    );
                  })
                ) : (
                  <div className="p-6">
                    <p className="text-xs font-semibold text-on-surface-variant mb-4 leading-relaxed">
                      No schedule calendar generated for this group yet. Configure and generate its pay cycles:
                    </p>
                    <form onSubmit={handleGenerateSchedules} className="space-y-4">
                      <div className="grid grid-cols-2 gap-3">
                        <div className="flex flex-col gap-1">
                          <label className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wider">First Period Start</label>
                          <input 
                            type="date" 
                            value={genStart}
                            onChange={(e) => setGenStart(e.target.value)}
                            className="h-9 border border-outline-variant rounded px-2.5 text-xs focus:outline-none focus:ring-2 focus:ring-primary bg-transparent"
                            required
                          />
                        </div>
                        <div className="flex flex-col gap-1">
                          <label className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wider">First Period End</label>
                          <input 
                            type="date" 
                            value={genEnd}
                            onChange={(e) => setGenEnd(e.target.value)}
                            className="h-9 border border-outline-variant rounded px-2.5 text-xs focus:outline-none focus:ring-2 focus:ring-primary bg-transparent"
                            required
                          />
                        </div>
                      </div>

                      <div className="flex flex-col gap-1">
                        <label className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wider">First Payment Date</label>
                        <input 
                          type="date" 
                          value={genPayment}
                          onChange={(e) => setGenPayment(e.target.value)}
                          className="h-9 border border-outline-variant rounded px-2.5 text-xs focus:outline-none focus:ring-2 focus:ring-primary bg-transparent w-full"
                          required
                        />
                      </div>

                      <button
                        type="submit"
                        disabled={generatingSchedules}
                        className="w-full bg-primary text-on-primary font-bold py-2 px-3 rounded-lg text-xs hover:bg-opacity-95 transition-all shadow-sm flex items-center justify-center gap-1.5 disabled:opacity-50"
                      >
                        <span className="material-symbols-outlined text-[16px]">calendar_month</span>
                        {generatingSchedules ? 'Generating Calendar...' : 'Generate Schedule Calendar'}
                      </button>
                    </form>
                  </div>
                )
              ) : (
                <div className="p-8 text-center text-xs text-on-surface-variant font-medium h-full flex items-center justify-center">
                  Select a pay group from the list to view its generated schedule cycles.
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Create Pay Group Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-surface-container-lowest border border-outline-variant rounded-2xl p-6 w-full max-w-md shadow-2xl relative text-on-surface animate-fade-in">
            <button 
              onClick={() => setShowCreateModal(false)}
              className="absolute top-4 right-4 text-on-surface-variant hover:text-on-surface bg-transparent border-none cursor-pointer p-1 rounded-full flex items-center justify-center"
            >
              <span className="material-symbols-outlined text-lg">close</span>
            </button>

            <h3 className="text-lg font-bold text-primary mb-1">Create Pay Group</h3>
            <p className="text-xs text-on-surface-variant mb-6">
              Create a pay cohort and automatically generate its payment schedules.
            </p>

            <form onSubmit={handleCreatePayGroup} className="flex flex-col gap-4">
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-bold text-on-surface-variant uppercase tracking-wider">Pay Group Name *</label>
                <input 
                  type="text" 
                  value={newGroupName}
                  onChange={(e) => setNewGroupName(e.target.value)}
                  className="bg-surface border border-outline-variant rounded-lg p-2 text-sm text-on-surface focus:outline-none focus:border-secondary w-full"
                  placeholder="e.g. Ontario Hourly Staff"
                  required
                />
              </div>

              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-bold text-on-surface-variant uppercase tracking-wider">Frequency *</label>
                <select 
                  value={newGroupFrequency}
                  onChange={(e) => setNewGroupFrequency(e.target.value)}
                  className="bg-surface border border-outline-variant rounded-lg p-2 text-sm text-on-surface focus:outline-none focus:border-secondary w-full cursor-pointer"
                >
                  <option value="weekly">Weekly</option>
                  <option value="bi-weekly">Bi-weekly</option>
                  <option value="semi-monthly">Semi-monthly</option>
                  <option value="monthly">Monthly</option>
                </select>
              </div>

              <div className="grid grid-cols-2 gap-4 pt-2 border-t border-outline-variant/60">
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-bold text-on-surface-variant uppercase tracking-wider">First Period Start *</label>
                  <input 
                    type="date" 
                    value={firstStart}
                    onChange={(e) => setFirstStart(e.target.value)}
                    className="bg-surface border border-outline-variant rounded-lg p-2 text-sm text-on-surface focus:outline-none focus:border-secondary w-full"
                    required
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-bold text-on-surface-variant uppercase tracking-wider">First Period End *</label>
                  <input 
                    type="date" 
                    value={firstEnd}
                    onChange={(e) => setFirstEnd(e.target.value)}
                    className="bg-surface border border-outline-variant rounded-lg p-2 text-sm text-on-surface focus:outline-none focus:border-secondary w-full"
                    required
                  />
                </div>
              </div>

              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-bold text-on-surface-variant uppercase tracking-wider">First Payment Date *</label>
                <input 
                  type="date" 
                  value={firstPayment}
                  onChange={(e) => setFirstPayment(e.target.value)}
                  className="bg-surface border border-outline-variant rounded-lg p-2 text-sm text-on-surface focus:outline-none focus:border-secondary w-full"
                  required
                />
              </div>

              <div className="flex justify-end gap-3 mt-4 pt-4 border-t border-outline-variant">
                <button
                  type="button"
                  onClick={() => setShowCreateModal(false)}
                  className="border border-outline hover:bg-surface-container-low text-on-surface-variant font-bold py-2 px-4 rounded-lg text-sm cursor-pointer bg-transparent"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="bg-primary hover:bg-opacity-95 text-on-primary font-bold py-2 px-4 rounded-lg text-sm cursor-pointer border-none"
                >
                  {saving ? 'Creating...' : 'Create Group'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default SettingsView;
