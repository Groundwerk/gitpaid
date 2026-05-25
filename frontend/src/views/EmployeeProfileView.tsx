import React, { useEffect, useState } from 'react';
import { api } from '../utils/api';
import { sanitizeNumericInput } from '../utils/helpers';
import type { Employee } from '../types';

interface EmployeeProfileViewProps {
  employeeId: number | null; // null for creating new
  onBack: () => void;
  triggerToast: (msg: string, type: 'success' | 'error') => void;
}

export const EmployeeProfileView: React.FC<EmployeeProfileViewProps> = ({
  employeeId,
  onBack,
  triggerToast
}) => {
  const isEdit = employeeId !== null;
  const [loading, setLoading] = useState(isEdit);
  const [saving, setSaving] = useState(false);
  const [isYtdMigrationEnabled, setIsYtdMigrationEnabled] = useState(false);
  const [payGroups, setPayGroups] = useState<any[]>([]);

  // Form State
  const [formData, setFormData] = useState<Partial<Employee>>({
    pay_group_id: null,
    first_name: '',
    last_name: '',
    email: '',
    role: '',
    department: 'Engineering',
    pay_type: 'salary',
    rate: 0,
    status: 'active',
    cpp_exempt: 0,
    ei_exempt: 0,
    tax_exempt: 0,
    avatar: '',
    ytd_gross: 0,
    ytd_net: 0,
    ytd_cpp: 0,
    ytd_cpp_employer: 0,
    ytd_ei: 0,
    ytd_ei_employer: 0,
    ytd_tax: 0,
    ytd_wsib: 0,
    ytd_eht: 0,
    ytd_vacation_accrued: 0,
    ytd_vacation_paid: 0,
    pay_interval: 'company',
    sin: '',
    start_date: '',
    fit_exempt: 0,
    fit_withholding_amount: 0.0,
    override_fed_tax_credit: 0,
    fed_tax_credit_amount: 15705.0,
    override_prov_tax_credit: 0,
    prov_tax_credit_amount: 12399.0,
    wcb_exempt: 0,
    wcb_rate: 0.0
  });

  useEffect(() => {
    async function loadPayGroups() {
      try {
        const groups = await api.getPayGroups();
        setPayGroups(groups);
      } catch (error) {
        console.error('Error loading pay groups:', error);
      }
    }
    loadPayGroups();
  }, []);

  useEffect(() => {
    if (isEdit && employeeId) {
      async function loadEmployee() {
        try {
          setLoading(true);
          const data = await api.getEmployee(employeeId as number);
          setFormData(data);
          const hasYtdValue = (data.ytd_gross || 0) > 0 ||
                              (data.ytd_net || 0) > 0 ||
                              (data.ytd_cpp || 0) > 0 ||
                              (data.ytd_ei || 0) > 0 ||
                              (data.ytd_tax || 0) > 0 ||
                              (data.ytd_wsib || 0) > 0 ||
                              (data.ytd_eht || 0) > 0 ||
                              (data.ytd_vacation_accrued || 0) > 0 ||
                              (data.ytd_vacation_paid || 0) > 0;
          setIsYtdMigrationEnabled(hasYtdValue || !!data.has_payruns);
        } catch (error) {
          console.error('Error loading employee profile:', error);
          triggerToast('Failed to load employee details.', 'error');
          onBack();
        } finally {
          setLoading(false);
        }
      }
      loadEmployee();
    }
  }, [employeeId, isEdit]);

  const hasYtdHistory = (formData.ytd_gross || 0) > 0 ||
                        (formData.ytd_net || 0) > 0 ||
                        (formData.ytd_cpp || 0) > 0 ||
                        (formData.ytd_ei || 0) > 0 ||
                        (formData.ytd_tax || 0) > 0 ||
                        (formData.ytd_wsib || 0) > 0 ||
                        (formData.ytd_eht || 0) > 0 ||
                        (formData.ytd_vacation_accrued || 0) > 0 ||
                        (formData.ytd_vacation_paid || 0) > 0;
  const isYtdLocked = hasYtdHistory || !!formData.has_payruns;

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { id, value, type } = e.target;
    if (type === 'checkbox') {
      const checked = (e.target as HTMLInputElement).checked;
      setFormData(prev => ({ ...prev, [id]: checked ? 1 : 0 }));
    } else {
      setFormData(prev => ({ 
        ...prev, 
        [id]: type === 'number' ? sanitizeNumericInput(value) : value 
      }));
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.first_name || !formData.last_name || !formData.email) {
      triggerToast('Please fill in all required identity details.', 'error');
      return;
    }

    try {
      setSaving(true);
      const submissionData = { ...formData };
      if (!isYtdMigrationEnabled && !isYtdLocked) {
        submissionData.ytd_gross = 0;
        submissionData.ytd_net = 0;
        submissionData.ytd_cpp = 0;
        submissionData.ytd_cpp_employer = 0;
        submissionData.ytd_ei = 0;
        submissionData.ytd_ei_employer = 0;
        submissionData.ytd_tax = 0;
        submissionData.ytd_wsib = 0;
        submissionData.ytd_eht = 0;
        submissionData.ytd_vacation_accrued = 0;
        submissionData.ytd_vacation_paid = 0;
      }
      if (isEdit && employeeId) {
        await api.updateEmployee(employeeId, submissionData);
        triggerToast('Employee profile updated successfully.', 'success');
      } else {
        await api.createEmployee(submissionData);
        triggerToast('Employee onboarded successfully.', 'success');
      }
      onBack();
    } catch (error: any) {
      console.error('Error saving employee:', error);
      triggerToast(error.message || 'Failed to save employee record.', 'error');
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
      {/* Header */}
      <div className="flex items-center gap-4">
        <button 
          onClick={onBack}
          className="text-on-surface-variant hover:text-on-surface p-1 rounded-lg hover:bg-surface-container-high transition-colors"
        >
          <span className="material-symbols-outlined text-[24px]">arrow_back</span>
        </button>
        <div>
          <h1 className="text-3xl font-bold text-on-surface mb-1">
            {isEdit ? 'Edit Employee Profile' : 'Onboard New Employee'}
          </h1>
          <p className="text-sm text-on-surface-variant">
            {isEdit ? 'Configure compensation settings and manage YTD history.' : 'Add a new member to your payroll system.'}
          </p>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left Column: Primary details */}
        <div className="lg:col-span-8 flex flex-col gap-6">
          {/* Identity Card */}
          <section className="bg-surface-container-lowest border border-outline-variant rounded-xl p-6 shadow-sm">
            <h3 className="text-base font-bold text-primary mb-6 border-b border-outline-variant pb-2">Business Identity</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-bold text-on-surface-variant uppercase tracking-wider" htmlFor="first_name">First Name *</label>
                <input 
                  type="text" 
                  id="first_name" 
                  value={formData.first_name || ''} 
                  onChange={handleChange}
                  placeholder="e.g. Sarah"
                  className="h-10 border border-outline-variant rounded px-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2 bg-transparent w-full"
                  required
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-bold text-on-surface-variant uppercase tracking-wider" htmlFor="last_name">Last Name *</label>
                <input 
                  type="text" 
                  id="last_name" 
                  value={formData.last_name || ''} 
                  onChange={handleChange}
                  placeholder="e.g. Jenkins"
                  className="h-10 border border-outline-variant rounded px-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2 bg-transparent w-full"
                  required
                />
              </div>
              <div className="flex flex-col gap-1.5 md:col-span-2">
                <label className="text-xs font-bold text-on-surface-variant uppercase tracking-wider" htmlFor="email">Email Address *</label>
                <input 
                  type="email" 
                  id="email" 
                  value={formData.email || ''} 
                  onChange={handleChange}
                  placeholder="e.g. sarah.j@company.com"
                  className="h-10 border border-outline-variant rounded px-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2 bg-transparent w-full"
                  required
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-bold text-on-surface-variant uppercase tracking-wider" htmlFor="role">Role / Job Title</label>
                <input 
                  type="text" 
                  id="role" 
                  value={formData.role || ''} 
                  onChange={handleChange}
                  placeholder="e.g. Senior Developer"
                  className="h-10 border border-outline-variant rounded px-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2 bg-transparent w-full"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-bold text-on-surface-variant uppercase tracking-wider" htmlFor="department">Department</label>
                <select 
                  id="department" 
                  value={formData.department || 'Engineering'} 
                  onChange={handleChange}
                  className="h-10 border border-outline-variant rounded px-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary bg-transparent w-full"
                >
                  <option value="Engineering">Engineering</option>
                  <option value="Sales">Sales</option>
                  <option value="Marketing">Marketing</option>
                  <option value="Operations">Operations</option>
                  <option value="HR">Human Resources</option>
                </select>
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-bold text-on-surface-variant uppercase tracking-wider" htmlFor="status">Status</label>
                <select 
                  id="status" 
                  value={formData.status || 'active'} 
                  onChange={handleChange}
                  className="h-10 border border-outline-variant rounded px-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary bg-transparent w-full"
                >
                  <option value="active">Active</option>
                  <option value="leave">On Leave</option>
                  <option value="terminated">Terminated</option>
                </select>
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-bold text-on-surface-variant uppercase tracking-wider" htmlFor="avatar">Avatar Url / Initials</label>
                <input 
                  type="text" 
                  id="avatar" 
                  value={formData.avatar || ''} 
                  onChange={handleChange}
                  placeholder="Initials (e.g. SJ) or Image URL"
                  className="h-10 border border-outline-variant rounded px-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2 bg-transparent w-full"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-bold text-on-surface-variant uppercase tracking-wider" htmlFor="sin">SIN (Social Insurance Number)</label>
                <input 
                  type="text" 
                  id="sin" 
                  value={formData.sin || ''} 
                  onChange={handleChange}
                  placeholder="e.g. 123 456 789"
                  className="h-10 border border-outline-variant rounded px-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2 bg-transparent w-full"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-bold text-on-surface-variant uppercase tracking-wider" htmlFor="start_date">Employment Start Date</label>
                <input 
                  type="date" 
                  id="start_date" 
                  value={formData.start_date || ''} 
                  onChange={handleChange}
                  className="h-10 border border-outline-variant rounded px-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2 bg-transparent w-full"
                />
              </div>
            </div>
          </section>

          {/* Migration Ledger Card */}
          <section className="bg-surface-container-lowest border border-outline-variant rounded-xl p-6 shadow-sm">
            <div className="flex items-center justify-between mb-4 border-b border-outline-variant pb-2">
              <h3 className="text-base font-bold text-primary">Migration YTD Ledger</h3>
              <div className="flex items-center gap-3">
                <label className="flex items-center gap-2 cursor-pointer text-xs font-semibold text-on-surface">
                  <input
                    type="checkbox"
                    checked={isYtdMigrationEnabled || isYtdLocked}
                    disabled={isYtdLocked}
                    onChange={(e) => setIsYtdMigrationEnabled(e.target.checked)}
                    className="rounded border-outline-variant text-primary focus:ring-primary h-4 w-4 cursor-pointer"
                  />
                  Enable Mid-Year YTD Transfer
                </label>
                {isYtdLocked && (
                  <span className="text-[10px] font-bold text-outline uppercase bg-surface-container-high px-2 py-0.5 rounded border border-outline-variant/30">
                    Locked
                  </span>
                )}
              </div>
            </div>
            <p className="text-xs text-on-surface-variant leading-relaxed mb-6">
              Enter existing year-to-date totals from your previous payroll system. Submitting new payroll runs will add to these totals automatically.
            </p>
            {(isYtdMigrationEnabled || isYtdLocked) ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-bold text-on-surface-variant uppercase tracking-wider" htmlFor="ytd_gross">YTD Gross Earnings</label>
                  <input 
                    type="number" 
                    step="0.01"
                    id="ytd_gross" 
                    value={formData.ytd_gross || ''} 
                    onChange={handleChange}
                    disabled={isYtdLocked}
                    className="h-10 border border-outline-variant rounded px-3 text-sm font-semibold text-primary focus:ring-2 focus:ring-primary bg-transparent w-full disabled:opacity-60 disabled:cursor-not-allowed"
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-bold text-on-surface-variant uppercase tracking-wider" htmlFor="ytd_net">YTD Net Pay</label>
                  <input 
                    type="number" 
                    step="0.01"
                    id="ytd_net" 
                    value={formData.ytd_net || ''} 
                    onChange={handleChange}
                    disabled={isYtdLocked}
                    className="h-10 border border-outline-variant rounded px-3 text-sm font-semibold text-primary focus:ring-2 focus:ring-primary bg-transparent w-full disabled:opacity-60 disabled:cursor-not-allowed"
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-bold text-on-surface-variant uppercase tracking-wider" htmlFor="ytd_cpp">YTD CPP Deducted (Employee)</label>
                  <input 
                    type="number" 
                    step="0.01"
                    id="ytd_cpp" 
                    value={formData.ytd_cpp || ''} 
                    onChange={handleChange}
                    disabled={isYtdLocked}
                    className="h-10 border border-outline-variant rounded px-3 text-sm font-semibold text-primary focus:ring-2 focus:ring-primary bg-transparent w-full disabled:opacity-60 disabled:cursor-not-allowed"
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-bold text-on-surface-variant uppercase tracking-wider" htmlFor="ytd_cpp_employer">YTD CPP Match (Employer)</label>
                  <input 
                    type="number" 
                    step="0.01"
                    id="ytd_cpp_employer" 
                    value={formData.ytd_cpp_employer || ''} 
                    onChange={handleChange}
                    disabled={isYtdLocked}
                    className="h-10 border border-outline-variant rounded px-3 text-sm font-semibold text-primary focus:ring-2 focus:ring-primary bg-transparent w-full disabled:opacity-60 disabled:cursor-not-allowed"
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-bold text-on-surface-variant uppercase tracking-wider" htmlFor="ytd_ei">YTD EI Deducted (Employee)</label>
                  <input 
                    type="number" 
                    step="0.01"
                    id="ytd_ei" 
                    value={formData.ytd_ei || ''} 
                    onChange={handleChange}
                    disabled={isYtdLocked}
                    className="h-10 border border-outline-variant rounded px-3 text-sm font-semibold text-primary focus:ring-2 focus:ring-primary bg-transparent w-full disabled:opacity-60 disabled:cursor-not-allowed"
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-bold text-on-surface-variant uppercase tracking-wider" htmlFor="ytd_ei_employer">YTD EI Match (Employer)</label>
                  <input 
                    type="number" 
                    step="0.01"
                    id="ytd_ei_employer" 
                    value={formData.ytd_ei_employer || ''} 
                    onChange={handleChange}
                    disabled={isYtdLocked}
                    className="h-10 border border-outline-variant rounded px-3 text-sm font-semibold text-primary focus:ring-2 focus:ring-primary bg-transparent w-full disabled:opacity-60 disabled:cursor-not-allowed"
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-bold text-on-surface-variant uppercase tracking-wider" htmlFor="ytd_tax">YTD Income Tax</label>
                  <input 
                    type="number" 
                    step="0.01"
                    id="ytd_tax" 
                    value={formData.ytd_tax || ''} 
                    onChange={handleChange}
                    disabled={isYtdLocked}
                    className="h-10 border border-outline-variant rounded px-3 text-sm font-semibold text-primary focus:ring-2 focus:ring-primary bg-transparent w-full disabled:opacity-60 disabled:cursor-not-allowed"
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-bold text-on-surface-variant uppercase tracking-wider" htmlFor="ytd_wsib">YTD WSIB Premium</label>
                  <input 
                    type="number" 
                    step="0.01"
                    id="ytd_wsib" 
                    value={formData.ytd_wsib || ''} 
                    onChange={handleChange}
                    disabled={isYtdLocked}
                    className="h-10 border border-outline-variant rounded px-3 text-sm font-semibold text-primary focus:ring-2 focus:ring-primary bg-transparent w-full disabled:opacity-60 disabled:cursor-not-allowed"
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-bold text-on-surface-variant uppercase tracking-wider" htmlFor="ytd_eht">YTD EHT Premium</label>
                  <input 
                    type="number" 
                    step="0.01"
                    id="ytd_eht" 
                    value={formData.ytd_eht || ''} 
                    onChange={handleChange}
                    disabled={isYtdLocked}
                    className="h-10 border border-outline-variant rounded px-3 text-sm font-semibold text-primary focus:ring-2 focus:ring-primary bg-transparent w-full disabled:opacity-60 disabled:cursor-not-allowed"
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-bold text-on-surface-variant uppercase tracking-wider" htmlFor="ytd_vacation_accrued">YTD Vacation Accrued</label>
                  <input 
                    type="number" 
                    step="0.01"
                    id="ytd_vacation_accrued" 
                    value={formData.ytd_vacation_accrued || ''} 
                    onChange={handleChange}
                    disabled={isYtdLocked}
                    className="h-10 border border-outline-variant rounded px-3 text-sm font-semibold text-primary focus:ring-2 focus:ring-primary bg-transparent w-full disabled:opacity-60 disabled:cursor-not-allowed"
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-bold text-on-surface-variant uppercase tracking-wider" htmlFor="ytd_vacation_paid">YTD Vacation Paid</label>
                  <input 
                    type="number" 
                    step="0.01"
                    id="ytd_vacation_paid" 
                    value={formData.ytd_vacation_paid || ''} 
                    onChange={handleChange}
                    disabled={isYtdLocked}
                    className="h-10 border border-outline-variant rounded px-3 text-sm font-semibold text-primary focus:ring-2 focus:ring-primary bg-transparent w-full disabled:opacity-60 disabled:cursor-not-allowed"
                  />
                </div>
              </div>
            ) : (
              <div className="p-6 border border-dashed border-outline-variant rounded-xl text-center text-sm font-semibold text-on-surface-variant bg-surface-container-low/30">
                Mid-Year YTD Transfer is disabled. Check the option above to enter historical YTD totals.
              </div>
            )}
          </section>
        </div>

        {/* Right Column: Compensation & Exemptions */}
        <div className="lg:col-span-4 flex flex-col gap-6">
          {/* Card: Compensation Config */}
          <section className="bg-surface-container-lowest border border-outline-variant rounded-xl p-6 shadow-sm relative overflow-hidden">
            <div className="absolute top-0 left-0 w-full h-1 bg-secondary"></div>
            <h3 className="text-base font-bold text-primary mb-6 flex items-center gap-2">
              <span className="material-symbols-outlined text-secondary">payments</span>
              Compensation Settings
            </h3>
            
             <div className="flex flex-col gap-4">
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-bold text-on-surface-variant uppercase tracking-wider" htmlFor="pay_type">Pay Type</label>
                <select 
                  id="pay_type" 
                  value={formData.pay_type || 'salary'} 
                  onChange={handleChange}
                  className="h-10 border border-outline-variant rounded px-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary bg-transparent w-full cursor-pointer"
                >
                  <option value="salary">Salary</option>
                  <option value="hourly">Hourly</option>
                  <option value="salary_commission">Salary + Commission</option>
                </select>
              </div>

              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-bold text-on-surface-variant uppercase tracking-wider" htmlFor="pay_group_id">Pay Group *</label>
                <select 
                  id="pay_group_id" 
                  value={formData.pay_group_id || ''} 
                  onChange={(e) => {
                    const selectedId = e.target.value ? parseInt(e.target.value) : null;
                    const group = payGroups.find(g => g.id === selectedId);
                    setFormData(prev => ({
                      ...prev,
                      pay_group_id: selectedId,
                      pay_interval: group ? group.pay_frequency : prev.pay_interval
                    }));
                  }}
                  className="h-10 border border-outline-variant rounded px-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary bg-transparent w-full cursor-pointer"
                  required
                >
                  <option value="" disabled>Select a Pay Group...</option>
                  {payGroups.map(group => (
                    <option key={group.id} value={group.id}>
                      {group.name} ({group.pay_frequency})
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-bold text-on-surface-variant uppercase tracking-wider" htmlFor="rate">
                  {formData.pay_type === 'hourly' ? 'Hourly Pay Rate ($)' : 'Period Base Salary ($)'} *
                </label>
                <input 
                  type="number" 
                  step="0.01"
                  id="rate" 
                  value={formData.rate || ''} 
                  onChange={handleChange}
                  className="h-10 border border-outline-variant rounded px-3 text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-primary bg-transparent w-full"
                  required
                />
                <p className="text-[10px] text-on-surface-variant leading-tight">
                  {formData.pay_type === 'hourly' 
                    ? 'Applied per hours worked in each pay period run.' 
                    : 'Base amount paid out for each scheduled payroll run (e.g. bi-weekly).'
                  }
                </p>
              </div>
            </div>
          </section>

          {/* Card: CRA Exemptions */}
          <section className="bg-surface-container-low border border-primary-container/20 rounded-xl p-6 shadow-sm">
            <h3 className="text-base font-bold text-primary-container mb-6 flex items-center gap-2">
              <span className="material-symbols-outlined text-primary">security</span>
              CRA Tax Exemptions
            </h3>

            <div className="flex flex-col gap-4">
              {/* CPP Exempt */}
              <label className="flex items-start gap-3 cursor-pointer group">
                <div className="relative flex items-center justify-center mt-0.5">
                  <input 
                    type="checkbox" 
                    id="cpp_exempt" 
                    checked={formData.cpp_exempt === 1}
                    onChange={handleChange}
                    className="peer sr-only"
                  />
                  <div className="w-5 h-5 border-2 border-outline rounded bg-transparent peer-checked:bg-primary peer-checked:border-primary transition-colors"></div>
                  <span className="material-symbols-outlined absolute text-on-primary text-[16px] opacity-0 peer-checked:opacity-100 transition-opacity">check</span>
                </div>
                <div className="flex flex-col">
                  <span className="text-sm font-semibold text-on-surface group-hover:text-primary transition-colors">CPP Exempt</span>
                  <span className="text-[10px] text-on-surface-variant leading-tight mt-0.5">Stop deduction of Canada Pension Plan (e.g. age under 18 or over 70).</span>
                </div>
              </label>

              <hr className="border-outline-variant/50" />

              {/* EI Exempt */}
              <label className="flex items-start gap-3 cursor-pointer group">
                <div className="relative flex items-center justify-center mt-0.5">
                  <input 
                    type="checkbox" 
                    id="ei_exempt" 
                    checked={formData.ei_exempt === 1}
                    onChange={handleChange}
                    className="peer sr-only"
                  />
                  <div className="w-5 h-5 border-2 border-outline rounded bg-transparent peer-checked:bg-primary peer-checked:border-primary transition-colors"></div>
                  <span className="material-symbols-outlined absolute text-on-primary text-[16px] opacity-0 peer-checked:opacity-100 transition-opacity">check</span>
                </div>
                <div className="flex flex-col">
                  <span className="text-sm font-semibold text-on-surface group-hover:text-primary transition-colors">EI Exempt</span>
                  <span className="text-[10px] text-on-surface-variant leading-tight mt-0.5">Stop Employment Insurance deduction (e.g. shareholder owning &gt;40% shares).</span>
                </div>
              </label>

              <hr className="border-outline-variant/50" />

              {/* Income Tax Exempt */}
              <label className="flex items-start gap-3 cursor-pointer group">
                <div className="relative flex items-center justify-center mt-0.5">
                  <input 
                    type="checkbox" 
                    id="tax_exempt" 
                    checked={formData.tax_exempt === 1}
                    onChange={handleChange}
                    className="peer sr-only"
                  />
                  <div className="w-5 h-5 border-2 border-outline rounded bg-transparent peer-checked:bg-primary peer-checked:border-primary transition-colors"></div>
                  <span className="material-symbols-outlined absolute text-on-primary text-[16px] opacity-0 peer-checked:opacity-100 transition-opacity">check</span>
                </div>
                <div className="flex flex-col">
                  <span className="text-sm font-semibold text-on-surface group-hover:text-primary transition-colors">Income Tax Exempt</span>
                  <span className="text-[10px] text-on-surface-variant leading-tight mt-0.5">Stop Federal &amp; Provincial income tax deduction.</span>
                </div>
              </label>

              <hr className="border-outline-variant/50" />

              {/* FIT Exempt & withholding */}
              <div className="flex flex-col gap-3">
                <label className="flex items-start gap-3 cursor-pointer group">
                  <div className="relative flex items-center justify-center mt-0.5">
                    <input 
                      type="checkbox" 
                      id="fit_exempt" 
                      checked={formData.fit_exempt === 1}
                      onChange={handleChange}
                      className="peer sr-only"
                    />
                    <div className="w-5 h-5 border-2 border-outline rounded bg-transparent peer-checked:bg-primary peer-checked:border-primary transition-colors"></div>
                    <span className="material-symbols-outlined absolute text-on-primary text-[16px] opacity-0 peer-checked:opacity-100 transition-opacity">check</span>
                  </div>
                  <div className="flex flex-col">
                    <span className="text-sm font-semibold text-on-surface group-hover:text-primary transition-colors">FIT Exempt</span>
                    <span className="text-[10px] text-on-surface-variant leading-tight mt-0.5">Exempt from Federal Income Tax withholding.</span>
                  </div>
                </label>

                {formData.fit_exempt !== 1 && (
                  <div className="flex flex-col gap-1.5 pl-8 animate-fade-in">
                    <label className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wider" htmlFor="fit_withholding_amount">Additional Withholding ($)</label>
                    <input 
                      type="number" 
                      step="0.01"
                      id="fit_withholding_amount" 
                      value={formData.fit_withholding_amount || ''} 
                      onChange={handleChange}
                      className="h-9 border border-outline-variant bg-surface-container-lowest rounded px-2.5 text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-primary w-full"
                    />
                  </div>
                )}
              </div>

              <hr className="border-outline-variant/50" />

              {/* Federal Tax Credit Override */}
              <div className="flex flex-col gap-3">
                <label className="flex items-start gap-3 cursor-pointer group">
                  <div className="relative flex items-center justify-center mt-0.5">
                    <input 
                      type="checkbox" 
                      id="override_fed_tax_credit" 
                      checked={formData.override_fed_tax_credit === 1}
                      onChange={handleChange}
                      className="peer sr-only"
                    />
                    <div className="w-5 h-5 border-2 border-outline rounded bg-transparent peer-checked:bg-primary peer-checked:border-primary transition-colors"></div>
                    <span className="material-symbols-outlined absolute text-on-primary text-[16px] opacity-0 peer-checked:opacity-100 transition-opacity">check</span>
                  </div>
                  <div className="flex flex-col">
                    <span className="text-sm font-semibold text-on-surface group-hover:text-primary transition-colors">Override Federal Basic Claim</span>
                    <span className="text-[10px] text-on-surface-variant leading-tight mt-0.5">Customize the Federal Basic Personal Amount (default: $15,705).</span>
                  </div>
                </label>

                {formData.override_fed_tax_credit === 1 && (
                  <div className="flex flex-col gap-1.5 pl-8 animate-fade-in">
                    <label className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wider" htmlFor="fed_tax_credit_amount">Claim Amount ($)</label>
                    <input 
                      type="number" 
                      step="0.01"
                      id="fed_tax_credit_amount" 
                      value={formData.fed_tax_credit_amount || ''} 
                      onChange={handleChange}
                      className="h-9 border border-outline-variant bg-surface-container-lowest rounded px-2.5 text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-primary w-full"
                    />
                  </div>
                )}
              </div>

              <hr className="border-outline-variant/50" />

              {/* Provincial Tax Credit Override */}
              <div className="flex flex-col gap-3">
                <label className="flex items-start gap-3 cursor-pointer group">
                  <div className="relative flex items-center justify-center mt-0.5">
                    <input 
                      type="checkbox" 
                      id="override_prov_tax_credit" 
                      checked={formData.override_prov_tax_credit === 1}
                      onChange={handleChange}
                      className="peer sr-only"
                    />
                    <div className="w-5 h-5 border-2 border-outline rounded bg-transparent peer-checked:bg-primary peer-checked:border-primary transition-colors"></div>
                    <span className="material-symbols-outlined absolute text-on-primary text-[16px] opacity-0 peer-checked:opacity-100 transition-opacity">check</span>
                  </div>
                  <div className="flex flex-col">
                    <span className="text-sm font-semibold text-on-surface group-hover:text-primary transition-colors">Override Ontario Basic Claim</span>
                    <span className="text-[10px] text-on-surface-variant leading-tight mt-0.5">Customize the Ontario Basic Personal Amount (default: $12,399).</span>
                  </div>
                </label>

                {formData.override_prov_tax_credit === 1 && (
                  <div className="flex flex-col gap-1.5 pl-8 animate-fade-in">
                    <label className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wider" htmlFor="prov_tax_credit_amount">Claim Amount ($)</label>
                    <input 
                      type="number" 
                      step="0.01"
                      id="prov_tax_credit_amount" 
                      value={formData.prov_tax_credit_amount || ''} 
                      onChange={handleChange}
                      className="h-9 border border-outline-variant bg-surface-container-lowest rounded px-2.5 text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-primary w-full"
                    />
                  </div>
                )}
              </div>

              <hr className="border-outline-variant/50" />

              {/* WCB Exemption & Rate */}
              <div className="flex flex-col gap-3">
                <label className="flex items-start gap-3 cursor-pointer group">
                  <div className="relative flex items-center justify-center mt-0.5">
                    <input 
                      type="checkbox" 
                      id="wcb_exempt" 
                      checked={formData.wcb_exempt === 1}
                      onChange={handleChange}
                      className="peer sr-only"
                    />
                    <div className="w-5 h-5 border-2 border-outline rounded bg-transparent peer-checked:bg-primary peer-checked:border-primary transition-colors"></div>
                    <span className="material-symbols-outlined absolute text-on-primary text-[16px] opacity-0 peer-checked:opacity-100 transition-opacity">check</span>
                  </div>
                  <div className="flex flex-col">
                    <span className="text-sm font-semibold text-on-surface group-hover:text-primary transition-colors">WSIB (WCB) Exempt</span>
                    <span className="text-[10px] text-on-surface-variant leading-tight mt-0.5">Stop Employer WSIB premium calculation for this employee.</span>
                  </div>
                </label>

                {formData.wcb_exempt !== 1 && (
                  <div className="flex flex-col gap-1.5 pl-8 animate-fade-in">
                    <label className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wider" htmlFor="wcb_rate">WSIB Rate Override (%)</label>
                    <input 
                      type="number" 
                      step="0.01"
                      id="wcb_rate" 
                      value={formData.wcb_rate || ''} 
                      onChange={handleChange}
                      placeholder="Use Company Rate"
                      className="h-9 border border-outline-variant bg-surface-container-lowest rounded px-2.5 text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-primary w-full"
                    />
                  </div>
                )}
              </div>
            </div>
          </section>

          {/* Sticky actions */}
          <div className="flex items-center justify-end gap-3 mt-4 pt-4 border-t border-outline-variant">
            <button 
              type="button"
              onClick={onBack}
              className="px-5 py-2 rounded-lg text-sm font-semibold text-primary hover:bg-surface-container-high transition-colors"
            >
              Cancel
            </button>
            <button 
              type="submit"
              disabled={saving}
              className="px-5 py-2 rounded-lg bg-primary text-on-primary text-sm font-semibold hover:bg-opacity-90 transition-colors shadow-sm disabled:opacity-50"
            >
              {saving ? 'Saving...' : isEdit ? 'Save Changes' : 'Onboard Employee'}
            </button>
          </div>
        </div>
      </form>
    </div>
  );
};

export default EmployeeProfileView;
