import React, { useEffect, useState } from 'react';
import { api } from '../utils/api';
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

  // Form State
  const [formData, setFormData] = useState<Partial<Employee>>({
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
    ytd_ei: 0,
    ytd_tax: 0,
    ytd_wsib: 0,
    ytd_eht: 0,
    ytd_vacation_accrued: 0,
    ytd_vacation_paid: 0
  });

  useEffect(() => {
    if (isEdit && employeeId) {
      async function loadEmployee() {
        try {
          setLoading(true);
          const data = await api.getEmployee(employeeId as number);
          setFormData(data);
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

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { id, value, type } = e.target;
    if (type === 'checkbox') {
      const checked = (e.target as HTMLInputElement).checked;
      setFormData(prev => ({ ...prev, [id]: checked ? 1 : 0 }));
    } else {
      setFormData(prev => ({ 
        ...prev, 
        [id]: type === 'number' ? parseFloat(value) || 0 : value 
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
      if (isEdit && employeeId) {
        await api.updateEmployee(employeeId, formData);
        triggerToast('Employee profile updated successfully.', 'success');
      } else {
        await api.createEmployee(formData);
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
            </div>
          </section>

          {/* Migration Ledger Card */}
          <section className="bg-surface-container-lowest border border-outline-variant rounded-xl p-6 shadow-sm">
            <div className="flex items-center justify-between mb-4 border-b border-outline-variant pb-2">
              <h3 className="text-base font-bold text-primary">Migration YTD Ledger</h3>
              <span className="text-[10px] font-bold text-secondary uppercase bg-secondary-container px-2 py-0.5 rounded border border-outline-variant/30">
                Mid-Year Transfer
              </span>
            </div>
            <p className="text-xs text-on-surface-variant leading-relaxed mb-6">
              Enter existing year-to-date totals from your previous payroll system. Submitting new payroll runs will add to these totals automatically.
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-bold text-on-surface-variant uppercase tracking-wider" htmlFor="ytd_gross">YTD Gross Earnings</label>
                <input 
                  type="number" 
                  step="0.01"
                  id="ytd_gross" 
                  value={formData.ytd_gross || 0} 
                  onChange={handleChange}
                  className="h-10 border border-outline-variant rounded px-3 text-sm font-semibold text-primary focus:ring-2 focus:ring-primary bg-transparent w-full"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-bold text-on-surface-variant uppercase tracking-wider" htmlFor="ytd_net">YTD Net Pay</label>
                <input 
                  type="number" 
                  step="0.01"
                  id="ytd_net" 
                  value={formData.ytd_net || 0} 
                  onChange={handleChange}
                  className="h-10 border border-outline-variant rounded px-3 text-sm font-semibold text-primary focus:ring-2 focus:ring-primary bg-transparent w-full"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-bold text-on-surface-variant uppercase tracking-wider" htmlFor="ytd_cpp">YTD CPP Deducted</label>
                <input 
                  type="number" 
                  step="0.01"
                  id="ytd_cpp" 
                  value={formData.ytd_cpp || 0} 
                  onChange={handleChange}
                  className="h-10 border border-outline-variant rounded px-3 text-sm font-semibold text-primary focus:ring-2 focus:ring-primary bg-transparent w-full"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-bold text-on-surface-variant uppercase tracking-wider" htmlFor="ytd_ei">YTD EI Deducted</label>
                <input 
                  type="number" 
                  step="0.01"
                  id="ytd_ei" 
                  value={formData.ytd_ei || 0} 
                  onChange={handleChange}
                  className="h-10 border border-outline-variant rounded px-3 text-sm font-semibold text-primary focus:ring-2 focus:ring-primary bg-transparent w-full"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-bold text-on-surface-variant uppercase tracking-wider" htmlFor="ytd_tax">YTD Income Tax</label>
                <input 
                  type="number" 
                  step="0.01"
                  id="ytd_tax" 
                  value={formData.ytd_tax || 0} 
                  onChange={handleChange}
                  className="h-10 border border-outline-variant rounded px-3 text-sm font-semibold text-primary focus:ring-2 focus:ring-primary bg-transparent w-full"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-bold text-on-surface-variant uppercase tracking-wider" htmlFor="ytd_wsib">YTD WSIB Premium</label>
                <input 
                  type="number" 
                  step="0.01"
                  id="ytd_wsib" 
                  value={formData.ytd_wsib || 0} 
                  onChange={handleChange}
                  className="h-10 border border-outline-variant rounded px-3 text-sm font-semibold text-primary focus:ring-2 focus:ring-primary bg-transparent w-full"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-bold text-on-surface-variant uppercase tracking-wider" htmlFor="ytd_eht">YTD EHT Premium</label>
                <input 
                  type="number" 
                  step="0.01"
                  id="ytd_eht" 
                  value={formData.ytd_eht || 0} 
                  onChange={handleChange}
                  className="h-10 border border-outline-variant rounded px-3 text-sm font-semibold text-primary focus:ring-2 focus:ring-primary bg-transparent w-full"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-bold text-on-surface-variant uppercase tracking-wider" htmlFor="ytd_vacation_accrued">YTD Vacation Accrued</label>
                <input 
                  type="number" 
                  step="0.01"
                  id="ytd_vacation_accrued" 
                  value={formData.ytd_vacation_accrued || 0} 
                  onChange={handleChange}
                  className="h-10 border border-outline-variant rounded px-3 text-sm font-semibold text-primary focus:ring-2 focus:ring-primary bg-transparent w-full"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-bold text-on-surface-variant uppercase tracking-wider" htmlFor="ytd_vacation_paid">YTD Vacation Paid</label>
                <input 
                  type="number" 
                  step="0.01"
                  id="ytd_vacation_paid" 
                  value={formData.ytd_vacation_paid || 0} 
                  onChange={handleChange}
                  className="h-10 border border-outline-variant rounded px-3 text-sm font-semibold text-primary focus:ring-2 focus:ring-primary bg-transparent w-full"
                />
              </div>
            </div>
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
                <label className="text-xs font-bold text-on-surface-variant uppercase tracking-wider" htmlFor="rate">
                  {formData.pay_type === 'hourly' ? 'Hourly Pay Rate ($)' : 'Period Base Salary ($)'} *
                </label>
                <input 
                  type="number" 
                  step="0.01"
                  id="rate" 
                  value={formData.rate || 0} 
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
