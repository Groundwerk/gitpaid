import React, { useEffect, useState } from 'react';
import { api } from '../utils/api';
import type { PayrollRun } from '../types';

interface ReportsViewProps {
  triggerToast: (msg: string, type: 'success' | 'error') => void;
}

export const ReportsView: React.FC<ReportsViewProps> = ({ triggerToast }) => {
  const [loading, setLoading] = useState(true);
  const [ytdData, setYtdData] = useState<any>(null);
  const [runs, setRuns] = useState<PayrollRun[]>([]);
  const [selectedRunId, setSelectedRunId] = useState<number | null>(null);
  const [runDetails, setRunDetails] = useState<any>(null);
  const [detailsLoading, setDetailsLoading] = useState(false);
  const [downloadingT4, setDownloadingT4] = useState(false);
  const [downloadingStubId, setDownloadingStubId] = useState<number | null>(null);

  // Filters & selection state
  const [hideFinalized, setHideFinalized] = useState(false);
  const [hideReversed, setHideReversed] = useState(false);
  const [hideReversedPayments, setHideReversedPayments] = useState(false);
  const [selectedEmployeeIds, setSelectedEmployeeIds] = useState<number[]>([]);
  const [openMenuEmployeeId, setOpenMenuEmployeeId] = useState<number | null>(null);

  // Button loading states
  const [finalizingRun, setFinalizingRun] = useState(false);
  const [reversingRun, setReversingRun] = useState(false);
  const [emailingStubs, setEmailingStubs] = useState(false);
  const [deletingRun, setDeletingRun] = useState(false);

  // Edit payment modal state
  const [editingEmployee, setEditingEmployee] = useState<any>(null);
  const [editHours, setEditHours] = useState('');
  const [editCommission, setEditCommission] = useState('');
  const [editVacationPayout, setEditVacationPayout] = useState('');
  const [editPaymentMethod, setEditPaymentMethod] = useState('e-Transfer');

  // Remittance Payments states
  const [payments, setPayments] = useState<any[]>([]);
  const [paymentType, setPaymentType] = useState<'CRA' | 'WSIB' | 'EHT'>('CRA');
  const [paymentDate, setPaymentDate] = useState('');
  const [paymentAmount, setPaymentAmount] = useState('');
  const [paymentPeriodEnd, setPaymentPeriodEnd] = useState('');
  const [customPeriodEnd, setCustomPeriodEnd] = useState(false);
  const [customPeriodEndDate, setCustomPeriodEndDate] = useState('');
  const [loggingPayment, setLoggingPayment] = useState(false);


  const handleDownloadT4 = async () => {
    try {
      setDownloadingT4(true);
      const token = localStorage.getItem('token');
      const headers: Record<string, string> = {};
      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
      }
      const res = await fetch(api.getT4ExportUrl(), { headers });
      if (!res.ok) {
        throw new Error(`Failed to export T4 XML: ${res.statusText}`);
      }
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 't4_xml_export.xml';
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      a.remove();
      triggerToast('T4 XML exported successfully.', 'success');
    } catch (err: any) {
      console.error(err);
      triggerToast(err.message || 'Failed to export T4 XML.', 'error');
    } finally {
      setDownloadingT4(false);
    }
  };

  const handleDownloadPaystub = async (employeeId: number, firstName: string, lastName: string) => {
    if (!runDetails) return;
    try {
      setDownloadingStubId(employeeId);
      const token = localStorage.getItem('token');
      const headers: Record<string, string> = {};
      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
      }
      const url = api.getPaystubUrl(runDetails.id, employeeId);
      const res = await fetch(url, { headers });
      if (!res.ok) {
        throw new Error(`Failed to download paystub: ${res.statusText}`);
      }
      const blob = await res.blob();
      const objectUrl = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = objectUrl;
      a.download = `paystub_${firstName}_${lastName}_run_${runDetails.id}.pdf`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(objectUrl);
      a.remove();
      triggerToast('Paystub PDF downloaded successfully.', 'success');
    } catch (err: any) {
      console.error(err);
      triggerToast(err.message || 'Failed to download paystub.', 'error');
    } finally {
      setDownloadingStubId(null);
    }
  };

  useEffect(() => {
    loadReportsData();
  }, []);

  const getPeriodEndOptions = (type: 'CRA' | 'WSIB' | 'EHT') => {
    const dates = new Set<string>();
    runs.forEach(run => {
      if (type === 'WSIB') {
        const [year, month] = run.period_end.split('-').map(Number);
        let qEnd = '';
        if (month >= 1 && month <= 3) qEnd = `${year}-03-31`;
        else if (month >= 4 && month <= 6) qEnd = `${year}-06-30`;
        else if (month >= 7 && month <= 9) qEnd = `${year}-09-30`;
        else qEnd = `${year}-12-31`;
        dates.add(qEnd);
      } else {
        const [year, month] = run.period_end.split('-').map(Number);
        const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
        const monthStr = String(month).padStart(2, '0');
        dates.add(`${year}-${monthStr}-${lastDay}`);
      }
    });
    return Array.from(dates).sort().reverse();
  };

  async function loadReportsData(preserveSelectedId?: number | null) {
    try {
      setLoading(true);
      const [ytd, runsData, paymentsData] = await Promise.all([
        api.getYtdReports(),
        api.getPayrollRuns(),
        api.getRemittancePayments()
      ]);
      setYtdData(ytd);
      setRuns(runsData);
      setPayments(paymentsData);
      
      // Auto-select or preserve selection
      const targetId = preserveSelectedId !== undefined ? preserveSelectedId : (runsData.length > 0 ? runsData[0].id : null);
      if (targetId !== null) {
        handleSelectRun(targetId);
      } else {
        setSelectedRunId(null);
        setRunDetails(null);
      }
    } catch (error) {
      console.error('Error loading reports data:', error);
      triggerToast('Failed to load compliance report summaries.', 'error');
    } finally {
      setLoading(false);
    }
  }

  const handleLogPayment = async (e: React.FormEvent) => {
    e.preventDefault();
    const amountVal = parseFloat(paymentAmount);
    if (isNaN(amountVal) || amountVal <= 0) {
      triggerToast('Please enter a valid positive payment amount.', 'error');
      return;
    }
    const targetPeriodEnd = customPeriodEnd ? customPeriodEndDate : paymentPeriodEnd;
    if (!targetPeriodEnd || !paymentDate) {
      triggerToast('Please provide both the payment date and the period end date covered.', 'error');
      return;
    }

    try {
      setLoggingPayment(true);
      await api.createRemittancePayment({
        type: paymentType,
        payment_date: paymentDate,
        amount: amountVal,
        period_end: targetPeriodEnd
      });
      triggerToast('Remittance payment logged successfully.', 'success');
      setPaymentAmount('');
      setPaymentDate('');
      setPaymentPeriodEnd('');
      setCustomPeriodEndDate('');
      await loadReportsData(selectedRunId);
    } catch (err: any) {
      console.error(err);
      triggerToast(err.message || 'Failed to log remittance payment.', 'error');
    } finally {
      setLoggingPayment(false);
    }
  };

  const handleDeletePayment = async (id: number) => {
    if (!confirm('Are you sure you want to delete this logged remittance payment? This will restore the liability in the due calculations.')) {
      return;
    }
    try {
      await api.deleteRemittancePayment(id);
      triggerToast('Remittance payment deleted successfully.', 'success');
      await loadReportsData(selectedRunId);
    } catch (err: any) {
      console.error(err);
      triggerToast(err.message || 'Failed to delete remittance payment.', 'error');
    }
  };

  const handleSelectRun = async (runId: number) => {
    setSelectedRunId(runId);
    setSelectedEmployeeIds([]);
    setOpenMenuEmployeeId(null);
    try {
      setDetailsLoading(true);
      const details = await api.getPayrollRunDetails(runId);
      setRunDetails(details);
    } catch (error) {
      console.error('Error fetching payroll run details:', error);
      triggerToast('Failed to load payroll run employee listing.', 'error');
    } finally {
      setDetailsLoading(false);
    }
  };

  const handleFinalizeRun = async () => {
    if (!selectedRunId) return;
    if (!confirm('Are you sure you want to finalize the entire payroll run? Once finalized, you can reverse it but cannot return it to draft (this action is unreversable).')) {
      return;
    }
    try {
      setFinalizingRun(true);
      const res = await api.finalizePayrollRun(selectedRunId);
      triggerToast(res.message || 'Payroll run finalized successfully.', 'success');
      await loadReportsData(selectedRunId);
    } catch (err: any) {
      console.error(err);
      triggerToast(err.message || 'Failed to finalize payroll run.', 'error');
    } finally {
      setFinalizingRun(false);
    }
  };

  const handleFinalizeEmployeePayment = async (employeeId: number, firstName: string, lastName: string) => {
    if (!selectedRunId) return;
    if (!confirm(`Are you sure you want to finalize the payment for ${firstName} ${lastName}? Once finalized, this payment cannot be returned to draft.`)) {
      return;
    }
    try {
      const res = await api.finalizeEmployeePayment(selectedRunId, employeeId);
      triggerToast(res.message || 'Employee payment finalized successfully.', 'success');
      await loadReportsData(selectedRunId);
    } catch (err: any) {
      console.error(err);
      triggerToast(err.message || 'Failed to finalize employee payment.', 'error');
    }
  };

  const handleDeleteRun = async () => {
    if (!selectedRunId) return;
    if (!confirm('Are you sure you want to delete this draft payroll run? This will permanently delete the run and all of its draft employee payment lines.')) {
      return;
    }
    try {
      setDeletingRun(true);
      const res = await api.deletePayrollRun(selectedRunId);
      triggerToast(res.message || 'Payroll run deleted successfully.', 'success');
      await loadReportsData(null); // Deselect deleted run
    } catch (err: any) {
      console.error(err);
      triggerToast(err.message || 'Failed to delete payroll run.', 'error');
    } finally {
      setDeletingRun(false);
    }
  };

  const handleSaveEditPayment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedRunId || !editingEmployee) return;
    try {
      const hours = parseFloat(editHours) || 0;
      const commission = parseFloat(editCommission) || 0;
      const vacation = parseFloat(editVacationPayout) || 0;

      const res = await api.updateEmployeePayment(selectedRunId, editingEmployee.employee_id, {
        hours_worked: hours,
        additional_commission: commission,
        vacation_payout_amount: vacation,
        payment_method: editPaymentMethod
      });

      triggerToast(res.message || 'Employee payment details updated successfully.', 'success');
      setEditingEmployee(null);
      await loadReportsData(selectedRunId);
    } catch (err: any) {
      console.error(err);
      triggerToast(err.message || 'Failed to update employee payment details.', 'error');
    }
  };

  const handleReverseRun = async () => {
    if (!selectedRunId) return;
    if (!confirm('WARNING: Are you sure you want to reverse this payroll run? This will deduct all remaining active payments from employee YTD accumulators. This action cannot be undone.')) {
      return;
    }
    try {
      setReversingRun(true);
      const res = await api.reversePayrollRun(selectedRunId);
      triggerToast(res.message || 'Payroll run reversed successfully.', 'success');
      await loadReportsData(selectedRunId);
    } catch (err: any) {
      console.error(err);
      triggerToast(err.message || 'Failed to reverse payroll run.', 'error');
    } finally {
      setReversingRun(false);
    }
  };

  const handleReverseEmployeePayment = async (employeeId: number, firstName: string, lastName: string) => {
    if (!selectedRunId) return;
    if (!confirm(`Are you sure you want to reverse the payment for ${firstName} ${lastName}? This will deduct their payment details from their YTD accumulators and the run totals.`)) {
      return;
    }
    try {
      const res = await api.reverseEmployeePayment(selectedRunId, employeeId);
      triggerToast(res.message || 'Employee payment reversed successfully.', 'success');
      await loadReportsData(selectedRunId);
    } catch (err: any) {
      console.error(err);
      triggerToast(err.message || 'Failed to reverse employee payment.', 'error');
    }
  };

  const handleEmailSelectedStubs = async () => {
    if (!selectedRunId || selectedEmployeeIds.length === 0) return;
    try {
      setEmailingStubs(true);
      triggerToast(`Initiating paystub delivery for ${selectedEmployeeIds.length} employee(s)...`, 'success');
      const res = await api.emailStubs(selectedRunId, selectedEmployeeIds);
      
      const failures = res.results ? res.results.filter(r => !r.success) : [];
      const successes = res.results ? res.results.filter(r => r.success) : [];

      if (failures.length > 0) {
        console.error('[EMAIL STUBS] Batch email delivery failed for some employees:', failures);
        const errMsg = failures[0].error || 'Gmail API permission error or connection failure.';
        triggerToast(`Failed to send ${failures.length} email(s). Error: ${errMsg}`, 'error');
      } else if (res.mocked) {
        triggerToast('Muted Send: Mock emails logged to worker console.', 'success');
      } else {
        triggerToast(`Paystubs emailed successfully to ${successes.length} employee(s).`, 'success');
      }
      setSelectedEmployeeIds([]);
    } catch (err: any) {
      console.error('[EMAIL STUBS] Batch email dispatch failed:', err);
      triggerToast(err.message || 'Failed to email paystubs.', 'error');
    } finally {
      setEmailingStubs(false);
    }
  };

  const handleEmailSingleStub = async (employeeId: number) => {
    if (!selectedRunId) return;
    try {
      triggerToast('Sending paystub email...', 'success');
      const res = await api.emailStubs(selectedRunId, [employeeId]);
      const result = res.results && res.results[0];
      
      if (result && !result.success) {
        throw new Error(result.error || 'Failed to deliver paystub email.');
      }
      
      if (res.mocked) {
        triggerToast('Muted Send: Mock email logged to worker console.', 'success');
      } else {
        triggerToast('Paystub email sent successfully.', 'success');
      }
    } catch (err: any) {
      console.error('[EMAIL STUBS] Single email dispatch failed:', err);
      triggerToast(err.message || 'Failed to send paystub email.', 'error');
    }
  };

  const toggleSelectEmployee = (employeeId: number | string) => {
    const id = Number(employeeId);
    setSelectedEmployeeIds(prev => 
      prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
    );
  };

  const formatCurrency = (val: number) => {
    return new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'CAD' }).format(val);
  };

  const todayStr = new Date().toISOString().split('T')[0];
  const isWithinActivePeriod = runDetails ? todayStr <= runDetails.period_end : false;

  // Filter runs based on active filters
  const filteredRuns = runs.filter(run => {
    if (hideFinalized && (run.status === 'finalized' || run.status === 'paid')) return false;
    if (hideReversed && run.status === 'reversed') return false;
    return true;
  });

  // Filter employees based on quick filter toggle
  const filteredEmployees = runDetails
    ? runDetails.employees.filter((emp: any) => {
        if (hideReversedPayments && emp.status === 'reversed') return false;
        return true;
      })
    : [];

  const activeEmployees = filteredEmployees.filter((emp: any) => emp.status !== 'reversed');
  const activeIds = activeEmployees.map((e: any) => Number(e.employee_id));
  const isAllSelected = activeIds.length > 0 && activeIds.every((id: number) => selectedEmployeeIds.includes(id));

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
        <h1 className="text-3xl font-bold text-on-surface mb-1">Reports &amp; Compliance</h1>
        <p className="text-sm text-on-surface-variant">Compile Ontario remittances, export T4s, and audit past pay cycles.</p>
      </div>

      {/* Remittances Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* CRA Card */}
        <div className="bg-surface-container-lowest border border-outline-variant rounded-xl p-6 shadow-sm relative overflow-hidden flex flex-col justify-between">
          <div>
            <div className="absolute top-0 left-0 w-full h-1 bg-primary"></div>
            <h3 className="text-sm font-bold text-primary uppercase tracking-wider mb-4 flex items-center gap-2">
              <span className="material-symbols-outlined text-secondary">account_balance</span>
              CRA Remittance Due
            </h3>
            <p className="text-2xl font-black text-on-surface">
              {ytdData ? formatCurrency(ytdData.craRemittance) : '$0.00'}
            </p>
            {ytdData?.craRemittanceUpcoming !== undefined && (
              <p className="text-xs font-semibold text-on-surface-variant mt-1.5 bg-surface-container-low px-2 py-1 rounded w-fit">
                Upcoming: <strong className="text-on-surface font-black">{formatCurrency(ytdData.craRemittanceUpcoming)}</strong>
              </p>
            )}
            <div className="text-[10px] text-on-surface-variant leading-relaxed mt-3">
              <p>• Employee CPP Deduct + Employer Match (1:1)</p>
              <p>• Employee EI Deduct + Employer Match (1.4:1)</p>
              <p>• Federal &amp; Provincial Income Withholdings</p>
            </div>
          </div>
          <div className="mt-4 pt-4 border-t border-outline-variant flex justify-between items-center">
            <span className="text-[10px] text-on-surface-variant font-bold">
              FREQUENCY: MONTHLY {ytdData?.craDueDate ? `• DUE ${ytdData.craDueDate}` : ''}
            </span>
            {ytdData ? (
              ytdData.craStatus === 'OVERDUE' ? (
                <span className="text-[10px] font-bold text-rose-700 bg-rose-50 px-2 py-0.5 rounded border border-rose-200 uppercase animate-pulse">OVERDUE</span>
              ) : ytdData.craStatus === 'DUE SOON' ? (
                <span className="text-[10px] font-bold text-amber-700 bg-amber-50 px-2 py-0.5 rounded border border-amber-200 uppercase">DUE SOON</span>
              ) : ytdData.craStatus === 'DUE' ? (
                <span className="text-[10px] font-bold text-orange-700 bg-orange-50 px-2 py-0.5 rounded border border-orange-200 uppercase">DUE</span>
              ) : (
                <span className="text-[10px] font-bold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200 uppercase">ON TIME</span>
              )
            ) : (
              <span className="text-[10px] font-bold text-green-600 bg-green-50 px-2 py-0.5 rounded border border-green-200">ON TIME</span>
            )}
          </div>
        </div>

        {/* WSIB Card */}
        <div className="bg-surface-container-lowest border border-outline-variant rounded-xl p-6 shadow-sm relative overflow-hidden flex flex-col justify-between">
          <div>
            <div className="absolute top-0 left-0 w-full h-1 bg-secondary"></div>
            <h3 className="text-sm font-bold text-primary uppercase tracking-wider mb-4 flex items-center gap-2">
              <span className="material-symbols-outlined text-secondary">medical_services</span>
              WSIB Premium Due
            </h3>
            <p className="text-2xl font-black text-on-surface">
              {ytdData ? formatCurrency(ytdData.wsibDue) : '$0.00'}
            </p>
            {ytdData?.wsibUpcoming !== undefined && (
              <p className="text-xs font-semibold text-on-surface-variant mt-1.5 bg-surface-container-low px-2 py-1 rounded w-fit">
                Upcoming: <strong className="text-on-surface font-black">{formatCurrency(ytdData.wsibUpcoming)}</strong>
              </p>
            )}
            <p className="text-[10px] text-on-surface-variant leading-relaxed mt-3">
              Ontario workers safety board premium. Calculated based on class rate against gross insurable earnings (capped at $112,500 annually per employee).
            </p>
          </div>
          <div className="mt-4 pt-4 border-t border-outline-variant flex justify-between items-center">
            <span className="text-[10px] text-on-surface-variant font-bold">
              FREQUENCY: QUARTERLY {ytdData?.wsibDueDate ? `• DUE ${ytdData.wsibDueDate}` : ''}
            </span>
            {ytdData ? (
              ytdData.wsibStatus === 'OVERDUE' ? (
                <span className="text-[10px] font-bold text-rose-700 bg-rose-50 px-2 py-0.5 rounded border border-rose-200 uppercase animate-pulse">OVERDUE</span>
              ) : ytdData.wsibStatus === 'DUE SOON' ? (
                <span className="text-[10px] font-bold text-amber-700 bg-amber-50 px-2 py-0.5 rounded border border-amber-200 uppercase">DUE SOON</span>
              ) : ytdData.wsibStatus === 'DUE' ? (
                <span className="text-[10px] font-bold text-orange-700 bg-orange-50 px-2 py-0.5 rounded border border-orange-200 uppercase">DUE</span>
              ) : (
                <span className="text-[10px] font-bold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200 uppercase">ON TIME</span>
              )
            ) : (
              <span className="text-[10px] font-bold text-green-600 bg-green-50 px-2 py-0.5 rounded border border-green-200">ON TIME</span>
            )}
          </div>
        </div>

        {/* EHT Card */}
        <div className="bg-surface-container-lowest border border-outline-variant rounded-xl p-6 shadow-sm relative overflow-hidden flex flex-col justify-between">
          <div>
            <div className="absolute top-0 left-0 w-full h-1 bg-tertiary"></div>
            <h3 className="text-sm font-bold text-primary uppercase tracking-wider mb-4 flex items-center gap-2">
              <span className="material-symbols-outlined text-tertiary">analytics</span>
              EHT Premium Due
            </h3>
            <p className="text-2xl font-black text-on-surface">
              {ytdData ? formatCurrency(ytdData.ehtDue) : '$0.00'}
            </p>
            {ytdData?.ehtUpcoming !== undefined && !ytdData.ehtExempt && (
              <p className="text-xs font-semibold text-on-surface-variant mt-1.5 bg-surface-container-low px-2 py-1 rounded w-fit">
                Upcoming: <strong className="text-on-surface font-black">{formatCurrency(ytdData.ehtUpcoming)}</strong>
              </p>
            )}
            <p className="text-[10px] text-on-surface-variant leading-relaxed mt-3">
              Employer Health Tax. Configured at 1.95% with private-sector exemption claimed on first $1,000,000 in Ontario payroll. Currently under exemption limit.
            </p>
          </div>
          <div className="mt-4 pt-4 border-t border-outline-variant flex justify-between items-center">
            <span className="text-[10px] text-on-surface-variant font-bold">
              EXEMPTION STATUS {ytdData?.ehtDueDate ? `• DUE ${ytdData.ehtDueDate}` : ''}
            </span>
            <div className="flex gap-2 items-center">
              {ytdData?.ehtExempt ? (
                <span className="text-[10px] font-bold text-amber-600 bg-amber-50 px-2 py-0.5 rounded border border-amber-200">EXEMPT CLAIMED</span>
              ) : (
                <>
                  <span className="text-[10px] font-bold text-blue-600 bg-blue-50 px-2 py-0.5 rounded border border-blue-200">NOT EXEMPT</span>
                  {ytdData ? (
                    ytdData.ehtStatus === 'OVERDUE' ? (
                      <span className="text-[10px] font-bold text-rose-700 bg-rose-50 px-2 py-0.5 rounded border border-rose-200 uppercase animate-pulse">OVERDUE</span>
                    ) : ytdData.ehtStatus === 'DUE SOON' ? (
                      <span className="text-[10px] font-bold text-amber-700 bg-amber-50 px-2 py-0.5 rounded border border-amber-200 uppercase">DUE SOON</span>
                    ) : ytdData.ehtStatus === 'DUE' ? (
                      <span className="text-[10px] font-bold text-orange-700 bg-orange-50 px-2 py-0.5 rounded border border-orange-200 uppercase">DUE</span>
                    ) : (
                      <span className="text-[10px] font-bold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200 uppercase">ON TIME</span>
                    )
                  ) : (
                    <span className="text-[10px] font-bold text-green-600 bg-green-50 px-2 py-0.5 rounded border border-green-200">ON TIME</span>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Compliance Center Actions */}
      <section className="bg-surface-container-lowest border border-outline-variant rounded-xl p-6 shadow-sm">
        <h3 className="text-base font-bold text-primary mb-2 border-b border-outline-variant pb-2 flex items-center gap-2">
          <span className="material-symbols-outlined text-secondary">file_download</span>
          Tax Forms Filing Center
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 items-center">
          <div>
            <h4 className="text-sm font-bold text-primary">CRA T4 XML Annual Return</h4>
            <p className="text-xs text-on-surface-variant leading-relaxed mt-1">
              Download the official T4 XML payload containing Box 14, 16, 18, 22, 50, and 52 ledger summaries for electronic submission to the Canada Revenue Agency.
            </p>
          </div>
          <div className="flex md:justify-end">
            <button 
              onClick={handleDownloadT4}
              disabled={downloadingT4}
              className="bg-primary hover:bg-opacity-95 disabled:opacity-50 text-on-primary font-bold py-2.5 px-6 rounded-lg text-sm shadow-sm flex items-center gap-2 active:scale-95 transition-transform cursor-pointer"
            >
              <span className="material-symbols-outlined">export_notes</span>
              {downloadingT4 ? 'Exporting...' : 'Export T4 XML Submission'}
            </button>
          </div>
        </div>
      </section>

      {/* Remittance Payments Ledger */}
      <section className="bg-surface-container-lowest border border-outline-variant rounded-xl p-6 shadow-sm">
        <h3 className="text-base font-bold text-primary mb-4 border-b border-outline-variant pb-2 flex items-center gap-2">
          <span className="material-symbols-outlined text-secondary">payments</span>
          Remittance Payments Ledger
        </h3>
        
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          {/* Log Payment Form */}
          <div className="lg:col-span-5 bg-surface-container-low border border-outline-variant rounded-xl p-4 flex flex-col gap-4">
            <h4 className="text-xs font-bold text-primary uppercase tracking-wider">Log Remittance Payment</h4>
            <form onSubmit={handleLogPayment} className="flex flex-col gap-3">
              <div className="flex flex-col gap-1">
                <label className="text-[10px] font-bold text-on-surface-variant uppercase">Agency / Remittance Type</label>
                <select
                  value={paymentType}
                  onChange={(e) => {
                    setPaymentType(e.target.value as any);
                    setPaymentPeriodEnd('');
                  }}
                  className="h-9 border border-outline-variant rounded px-2.5 text-xs focus:outline-none focus:ring-1 focus:ring-primary bg-transparent text-on-surface cursor-pointer"
                >
                  <option value="CRA">CRA (CPP, EI, Tax)</option>
                  <option value="WSIB">WSIB (Workers Compensation)</option>
                  <option value="EHT">EHT (Employer Health Tax)</option>
                </select>
              </div>

              <div className="flex flex-col gap-1">
                <label className="text-[10px] font-bold text-on-surface-variant uppercase">Payment Date</label>
                <input
                  type="date"
                  value={paymentDate}
                  onChange={(e) => setPaymentDate(e.target.value)}
                  className="h-9 border border-outline-variant rounded px-2.5 text-xs focus:outline-none focus:ring-1 focus:ring-primary bg-transparent text-on-surface"
                  required
                />
              </div>

              <div className="flex flex-col gap-1">
                <label className="text-[10px] font-bold text-on-surface-variant uppercase">Amount Paid ($)</label>
                <input
                  type="number"
                  step="0.01"
                  placeholder="0.00"
                  value={paymentAmount}
                  onChange={(e) => setPaymentAmount(e.target.value)}
                  className="h-9 border border-outline-variant rounded px-2.5 text-xs focus:outline-none focus:ring-1 focus:ring-primary bg-transparent text-on-surface"
                  required
                />
              </div>

              <div className="flex flex-col gap-1">
                <div className="flex justify-between items-center mb-1">
                  <label className="text-[10px] font-bold text-on-surface-variant uppercase">Period End Covered</label>
                  <button
                    type="button"
                    onClick={() => setCustomPeriodEnd(!customPeriodEnd)}
                    className="text-[9px] font-bold text-primary hover:underline bg-transparent border-none cursor-pointer"
                  >
                    {customPeriodEnd ? 'Select from runs' : 'Enter custom date'}
                  </button>
                </div>
                {customPeriodEnd ? (
                  <input
                    type="date"
                    value={customPeriodEndDate}
                    onChange={(e) => setCustomPeriodEndDate(e.target.value)}
                    className="h-9 border border-outline-variant rounded px-2.5 text-xs focus:outline-none focus:ring-1 focus:ring-primary bg-transparent text-on-surface"
                    required
                  />
                ) : (
                  <select
                    value={paymentPeriodEnd}
                    onChange={(e) => setPaymentPeriodEnd(e.target.value)}
                    className="h-9 border border-outline-variant rounded px-2.5 text-xs focus:outline-none focus:ring-1 focus:ring-primary bg-transparent text-on-surface cursor-pointer"
                    required
                  >
                    <option value="">-- Select Period End --</option>
                    {getPeriodEndOptions(paymentType).map(d => (
                      <option key={d} value={d}>{d}</option>
                    ))}
                  </select>
                )}
                <span className="text-[9px] text-on-surface-variant leading-tight">
                  Liabilities are grouped and netted by this period-end date.
                </span>
              </div>

              <button
                type="submit"
                disabled={loggingPayment}
                className="w-full bg-primary text-on-primary font-bold py-2 px-3 rounded-lg text-xs hover:bg-opacity-95 transition-all shadow-sm flex items-center justify-center gap-1.5 disabled:opacity-50 mt-1 cursor-pointer border-none"
              >
                <span className="material-symbols-outlined text-[16px]">add_task</span>
                {loggingPayment ? 'Logging Payment...' : 'Log Remittance Payment'}
              </button>
            </form>
          </div>

          {/* Payments History Table */}
          <div className="lg:col-span-7 bg-surface-container-low border border-outline-variant rounded-xl p-4 flex flex-col gap-3 h-[310px]">
            <h4 className="text-xs font-bold text-primary uppercase tracking-wider">Remittance Payments History</h4>
            <div className="flex-1 overflow-y-auto border border-outline-variant rounded-lg bg-surface-container-lowest">
              {payments.length > 0 ? (
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="bg-surface-container-low border-b border-outline-variant text-[9px] font-bold text-on-surface-variant uppercase tracking-wider">
                      <th className="py-2 px-3">Type</th>
                      <th className="py-2 px-3">Paid Date</th>
                      <th className="py-2 px-3">Period End</th>
                      <th className="py-2 px-3 text-right">Amount</th>
                      <th className="py-2 px-3 text-center w-10">Delete</th>
                    </tr>
                  </thead>
                  <tbody>
                    {payments.map((p) => (
                      <tr key={p.id} className="border-b border-outline-variant hover:bg-surface-container-low/20 transition-colors font-semibold">
                        <td className="py-2 px-3 font-bold text-primary">{p.type}</td>
                        <td className="py-2 px-3">{p.payment_date}</td>
                        <td className="py-2 px-3">{p.period_end}</td>
                        <td className="py-2 px-3 text-right font-bold text-emerald-700">{formatCurrency(p.amount)}</td>
                        <td className="py-2 px-3 text-center">
                          <button
                            onClick={() => handleDeletePayment(p.id)}
                            className="p-1 hover:bg-error-container hover:bg-opacity-20 rounded text-error bg-transparent border-none cursor-pointer flex items-center justify-center mx-auto"
                            title="Delete Payment"
                          >
                            <span className="material-symbols-outlined text-sm font-bold">delete</span>
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <div className="h-full flex items-center justify-center p-8 text-center text-xs text-on-surface-variant font-medium">
                  No remittance payments logged yet.
                </div>
              )}
            </div>
          </div>
        </div>
      </section>

      {/* Past Runs Details and Pay Stubs */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left: list of runs */}
        <div className="lg:col-span-4 bg-surface-container-lowest border border-outline-variant rounded-xl shadow-sm overflow-hidden flex flex-col h-[400px]">
          <div className="p-4 bg-surface-container-low border-b border-outline-variant flex flex-col gap-2">
            <h3 className="font-bold text-sm text-primary">Payroll Runs Archive</h3>
            <div className="flex gap-3 items-center">
              <label className="flex items-center gap-1 text-[10px] text-on-surface-variant font-bold cursor-pointer select-none">
                <input 
                  type="checkbox" 
                  checked={hideFinalized} 
                  onChange={(e) => setHideFinalized(e.target.checked)}
                  className="rounded border-outline-variant text-secondary focus:ring-secondary w-3 h-3 cursor-pointer"
                />
                Hide Finalized &amp; Paid
              </label>
              <label className="flex items-center gap-1 text-[10px] text-on-surface-variant font-bold cursor-pointer select-none">
                <input 
                  type="checkbox" 
                  checked={hideReversed} 
                  onChange={(e) => setHideReversed(e.target.checked)}
                  className="rounded border-outline-variant text-secondary focus:ring-secondary w-3 h-3 cursor-pointer"
                />
                Hide Reversed
              </label>
            </div>
          </div>
          <div className="flex-1 overflow-y-auto divide-y divide-outline-variant">
            {filteredRuns.length > 0 ? (
              filteredRuns.map((run) => {
                const isSelected = selectedRunId === run.id;
                const isDraft = run.status === 'draft';
                const isReversed = run.status === 'reversed';
                return (
                  <button
                    key={run.id}
                    onClick={() => handleSelectRun(run.id)}
                    className={`
                      w-full p-4 flex flex-col gap-1 text-left transition-colors
                      ${isSelected ? 'bg-primary/5 border-l-4 border-primary' : 'hover:bg-surface-container-low/20'}
                    `}
                  >
                    <div className="flex justify-between items-center">
                      <span className="text-xs font-bold text-primary">ID: #{run.id} • {run.run_date}</span>
                      <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded uppercase border ${
                        isDraft ? 'bg-amber-50 text-amber-800 border-amber-200' :
                        isReversed ? 'bg-rose-50 text-rose-800 border-rose-200' :
                        'bg-emerald-50 text-emerald-800 border-emerald-200'
                      }`}>
                        {run.status}
                      </span>
                    </div>
                    <span className="text-xs text-on-surface-variant font-medium">Period: {run.period_start} to {run.period_end}</span>
                    <span className="text-sm font-bold text-on-surface mt-1">{formatCurrency(run.total_gross)} Gross</span>
                  </button>
                );
              })
            ) : (
              <div className="p-8 text-center text-xs text-on-surface-variant font-semibold h-full flex items-center justify-center">
                No payroll runs found matching active filters.
              </div>
            )}
          </div>
        </div>

        {/* Right: run detail table (employee stub downloads) */}
        <div className="lg:col-span-8 bg-surface-container-lowest border border-outline-variant rounded-xl shadow-sm overflow-hidden flex flex-col h-[400px]">
          <div className="p-4 bg-surface-container-low border-b border-outline-variant flex justify-between items-center gap-4 flex-wrap">
            <div className="flex items-center gap-3">
              <h3 className="font-bold text-sm text-primary">
                {runDetails ? `Run Details: Period ${runDetails.period_start} - ${runDetails.period_end}` : 'Payroll Run Detail'}
              </h3>
              {runDetails && (
                <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full uppercase border ${
                  runDetails.status === 'draft' ? 'bg-amber-50 text-amber-800 border-amber-200' :
                  runDetails.status === 'reversed' ? 'bg-rose-50 text-rose-800 border-rose-200' :
                  'bg-emerald-50 text-emerald-800 border-emerald-200'
                }`}>
                  {runDetails.status}
                </span>
              )}
            </div>
            {runDetails && (
              <div className="flex items-center gap-2">
                {runDetails.status === 'draft' && (
                  <>
                    <button
                      onClick={handleDeleteRun}
                      disabled={deletingRun}
                      className="border border-error text-error hover:bg-error-container hover:bg-opacity-20 disabled:opacity-50 text-xs font-bold py-1.5 px-3 rounded-lg flex items-center gap-1 active:scale-95 transition-transform cursor-pointer bg-transparent"
                    >
                      <span className="material-symbols-outlined text-xs font-bold">delete</span>
                      {deletingRun ? 'Deleting...' : 'Delete Run'}
                    </button>
                    <button
                      onClick={handleFinalizeRun}
                      disabled={finalizingRun}
                      className="bg-secondary hover:bg-opacity-95 disabled:opacity-50 text-on-secondary text-xs font-bold py-1.5 px-3 rounded-lg flex items-center gap-1 active:scale-95 transition-transform cursor-pointer border-none"
                    >
                      <span className="material-symbols-outlined text-xs font-bold">done_all</span>
                      {finalizingRun ? 'Finalizing...' : 'Finalize Pay Run'}
                    </button>
                  </>
                )}
                {runDetails.status === 'finalized' && (
                  <button
                    onClick={handleReverseRun}
                    disabled={reversingRun || !isWithinActivePeriod}
                    title={!isWithinActivePeriod ? `Reversals are only allowed during the active period ending ${runDetails.period_end}` : ''}
                    className="border border-error text-error hover:bg-error-container hover:bg-opacity-20 disabled:opacity-50 text-xs font-bold py-1.5 px-3 rounded-lg flex items-center gap-1 active:scale-95 transition-transform cursor-pointer bg-transparent"
                  >
                    <span className="material-symbols-outlined text-xs font-bold">undo</span>
                    {reversingRun ? 'Reversing...' : 'Reverse Pay Run'}
                  </button>
                )}
              </div>
            )}
          </div>

          {/* Locked Period Warning Banner */}
          {runDetails && !isWithinActivePeriod && (runDetails.status === 'finalized' || runDetails.employees?.some((e: any) => e.status === 'finalized')) && (
            <div className="mx-4 mt-4 p-3 bg-amber-50 border border-amber-200 text-amber-900 rounded-xl text-xs flex items-center gap-2 font-medium">
              <span className="material-symbols-outlined text-amber-700 text-sm">info</span>
              <span>
                This pay period has ended (ended on <strong>{runDetails.period_end}</strong>). Payments and runs can no longer be reversed.
              </span>
            </div>
          )}

          {/* Gmail Integration Not Connected Alert */}
          {runDetails && !ytdData?.gmailConnected && (
            <div className="mx-4 mt-4 p-3 bg-blue-50 border border-blue-200 text-blue-900 rounded-xl text-xs flex items-center gap-2 font-medium">
              <span className="material-symbols-outlined text-blue-700 text-sm">info</span>
              <span className="flex-1">
                Gmail Integration is not configured. To email paystubs directly to employees, configure Gmail under **Company Settings**.
              </span>
            </div>
          )}

          {/* Quick Filters for Details Table */}
          {runDetails && (
            <div className="px-4 py-2 border-b border-outline-variant flex justify-between items-center bg-surface-container-lowest">
              <span className="text-[10px] text-on-surface-variant font-bold">QUICK FILTERS:</span>
              <label className="flex items-center gap-1.5 text-[10px] text-on-surface-variant font-bold cursor-pointer select-none">
                <input 
                  type="checkbox" 
                  checked={hideReversedPayments} 
                  onChange={(e) => setHideReversedPayments(e.target.checked)}
                  className="rounded border-outline-variant text-secondary focus:ring-secondary w-3 h-3 cursor-pointer"
                />
                Hide Reversed Payments
              </label>
            </div>
          )}

          {/* Selection Actions Header */}
          {runDetails && selectedEmployeeIds.length > 0 && (
            <div className="bg-primary text-on-primary px-4 py-2 flex justify-between items-center text-xs animate-fade-in">
              <div className="font-bold flex items-center gap-2">
                <span className="material-symbols-outlined text-sm">check_circle</span>
                {selectedEmployeeIds.length} employee{selectedEmployeeIds.length > 1 ? 's' : ''} selected
              </div>
              <div className="flex gap-2">
                <button
                  onClick={handleEmailSelectedStubs}
                  disabled={emailingStubs}
                  className="bg-secondary hover:bg-opacity-95 disabled:opacity-50 text-on-secondary text-[11px] font-bold py-1 px-3 rounded flex items-center gap-1 cursor-pointer border-none"
                >
                  <span className="material-symbols-outlined text-xs">mail</span>
                  {emailingStubs ? 'Sending...' : 'Email Selected Stubs'}
                </button>
                <button
                  onClick={() => setSelectedEmployeeIds([])}
                  className="border border-on-primary border-opacity-35 hover:bg-white/10 text-on-primary text-[11px] font-bold py-1 px-3 rounded cursor-pointer bg-transparent"
                >
                  Clear Selection
                </button>
              </div>
            </div>
          )}

          <div className="flex-1 overflow-y-auto">
            {detailsLoading ? (
              <div className="flex items-center justify-center h-full">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
              </div>
            ) : runDetails ? (
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-surface-container-low border-b border-outline-variant text-[10px] font-bold text-on-surface-variant uppercase tracking-wider">
                    {ytdData?.gmailConnected && (
                      <th className="py-2.5 px-4 w-10">
                        <input 
                          type="checkbox"
                          checked={isAllSelected}
                          onChange={() => {
                            if (isAllSelected) {
                              setSelectedEmployeeIds(selectedEmployeeIds.filter(id => !activeIds.includes(id)));
                            } else {
                              setSelectedEmployeeIds([...new Set([...selectedEmployeeIds, ...activeIds])]);
                            }
                          }}
                          className="rounded border-outline-variant text-secondary focus:ring-secondary w-3.5 h-3.5 cursor-pointer"
                        />
                      </th>
                    )}
                    <th className="py-2.5 px-4">Employee</th>
                    <th className="py-2.5 px-4 text-right">Gross</th>
                    <th className="py-2.5 px-4 text-right">Deductions</th>
                    <th className="py-2.5 px-4 text-right">Net Paid</th>
                    <th className="py-2.5 px-4 text-right w-16">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredEmployees.map((emp: any) => {
                    const totalDeductions = emp.cpp_employee + emp.ei_employee + emp.tax;
                    const isRowSelected = selectedEmployeeIds.includes(Number(emp.employee_id));
                    const isReversed = emp.status === 'reversed';
                    return (
                      <tr key={emp.employee_id} className={`border-b border-outline-variant hover:bg-surface-container-low/20 transition-colors text-xs font-semibold ${isRowSelected ? 'bg-surface-container-low' : ''} ${isReversed ? 'opacity-60' : ''}`}>
                        {ytdData?.gmailConnected && (
                          <td className="py-3 px-4">
                            <input 
                              type="checkbox"
                              checked={isRowSelected}
                              disabled={isReversed}
                              onChange={() => toggleSelectEmployee(emp.employee_id)}
                              className="rounded border-outline-variant text-secondary focus:ring-secondary w-3.5 h-3.5 cursor-pointer disabled:opacity-50"
                            />
                          </td>
                        )}
                        <td className="py-3 px-4 font-bold text-on-surface">
                          <span className={isReversed ? 'line-through text-on-surface-variant' : ''}>
                            {emp.first_name} {emp.last_name}
                          </span>
                          {isReversed && (
                            <span className="ml-2 text-[9px] font-bold text-rose-700 bg-rose-50 px-1.5 py-0.5 rounded border border-rose-200 uppercase">
                              Reversed
                            </span>
                          )}
                          {emp.status === 'draft' && (
                            <span className="ml-2 text-[9px] font-bold text-amber-700 bg-amber-50 px-1.5 py-0.5 rounded border border-amber-200 uppercase">
                              Draft
                            </span>
                          )}
                        </td>
                        <td className={`py-3 px-4 text-right ${isReversed ? 'line-through text-on-surface-variant' : ''}`}>{formatCurrency(emp.gross_pay)}</td>
                        <td className={`py-3 px-4 text-right ${isReversed ? 'line-through text-on-surface-variant' : 'text-red-600'}`}>-${totalDeductions.toFixed(2)}</td>
                        <td className={`py-3 px-4 text-right font-bold ${isReversed ? 'line-through text-on-surface-variant' : 'text-primary'}`}>{formatCurrency(emp.net_pay)}</td>
                        <td className="py-3 px-4 text-right relative">
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setOpenMenuEmployeeId(openMenuEmployeeId === emp.employee_id ? null : emp.employee_id);
                            }}
                            className="p-1 hover:bg-surface-container-high rounded-full cursor-pointer flex items-center justify-center text-on-surface-variant bg-transparent border-none"
                          >
                            <span className="material-symbols-outlined text-[18px]">more_vert</span>
                          </button>

                          {openMenuEmployeeId === emp.employee_id && (
                            <>
                              <div 
                                className="fixed inset-0 z-10" 
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setOpenMenuEmployeeId(null);
                                }} 
                              />
                              <div className="absolute right-4 mt-1 w-48 bg-surface-container-lowest border border-outline-variant rounded-xl shadow-lg z-20 py-1 text-left animate-fade-in font-medium">
                                <button
                                  onClick={async (e) => {
                                    e.stopPropagation();
                                    setOpenMenuEmployeeId(null);
                                    await handleDownloadPaystub(emp.employee_id, emp.first_name, emp.last_name);
                                  }}
                                  disabled={downloadingStubId !== null}
                                  className="w-full text-left px-3 py-2 text-xs text-on-surface hover:bg-surface-container-low flex items-center gap-2 cursor-pointer bg-transparent border-none font-semibold disabled:opacity-50"
                                >
                                  <span className="material-symbols-outlined text-sm text-secondary animate-pulse">
                                    {downloadingStubId === emp.employee_id ? 'pending' : 'picture_as_pdf'}
                                  </span>
                                  {downloadingStubId === emp.employee_id ? 'Downloading...' : 'Download PDF Stub'}
                                </button>
                                
                                {ytdData?.gmailConnected && (
                                  <button
                                    onClick={async (e) => {
                                      e.stopPropagation();
                                      setOpenMenuEmployeeId(null);
                                      await handleEmailSingleStub(emp.employee_id);
                                    }}
                                    disabled={isReversed}
                                    className="w-full text-left px-3 py-2 text-xs text-on-surface hover:bg-surface-container-low flex items-center gap-2 cursor-pointer bg-transparent border-none font-semibold disabled:opacity-40"
                                  >
                                    <span className="material-symbols-outlined text-sm text-secondary">mail</span>
                                    Email Paystub
                                  </button>
                                )}

                                {emp.status === 'draft' && (
                                  <>
                                    <button
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        setOpenMenuEmployeeId(null);
                                        setEditingEmployee(emp);
                                        setEditHours(String(emp.hours_worked || 0));
                                        // Compute additional commission for commission employees:
                                        const rateVal = emp.rate || 0;
                                        const comm = Math.max(0, emp.gross_pay - rateVal - emp.vacation_paid);
                                        setEditCommission(comm.toFixed(2));
                                        setEditVacationPayout(String(emp.vacation_paid || 0));
                                        setEditPaymentMethod(emp.payment_method || 'e-Transfer');
                                      }}
                                      className="w-full text-left px-3 py-2 text-xs text-on-surface hover:bg-surface-container-low flex items-center gap-2 cursor-pointer bg-transparent border-none font-semibold border-t border-outline-variant"
                                    >
                                      <span className="material-symbols-outlined text-sm text-secondary">edit</span>
                                      Edit Details
                                    </button>

                                    <button
                                      onClick={async (e) => {
                                        e.stopPropagation();
                                        setOpenMenuEmployeeId(null);
                                        await handleFinalizeEmployeePayment(emp.employee_id, emp.first_name, emp.last_name);
                                      }}
                                      className="w-full text-left px-3 py-2 text-xs text-secondary hover:bg-surface-container-low flex items-center gap-2 cursor-pointer bg-transparent border-none font-semibold border-t border-outline-variant"
                                    >
                                      <span className="material-symbols-outlined text-sm text-secondary">done</span>
                                      Finalize Payment
                                    </button>
                                  </>
                                )}

                                {emp.status === 'finalized' && (runDetails.status === 'finalized' || runDetails.status === 'draft') && (
                                  <button
                                    onClick={async (e) => {
                                      e.stopPropagation();
                                      setOpenMenuEmployeeId(null);
                                      await handleReverseEmployeePayment(emp.employee_id, emp.first_name, emp.last_name);
                                    }}
                                    disabled={!isWithinActivePeriod}
                                    title={!isWithinActivePeriod ? `Reversals are only allowed during the active period ending ${runDetails.period_end}` : ''}
                                    className="w-full text-left px-3 py-2 text-xs text-error hover:bg-error-container hover:bg-opacity-20 flex items-center gap-2 cursor-pointer bg-transparent border-none font-semibold border-t border-outline-variant disabled:opacity-40"
                                  >
                                    <span className="material-symbols-outlined text-sm">undo</span>
                                    Reverse {emp.first_name}'s Pay
                                  </button>
                                )}
                              </div>
                            </>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            ) : (
              <div className="p-8 text-center text-on-surface-variant font-medium h-full flex items-center justify-center">
                Select a payroll run from the archive to inspect details and download employee pay stubs.
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Edit Payment Modal */}
      {editingEmployee && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-surface-container-lowest border border-outline-variant rounded-2xl p-6 w-full max-w-md shadow-2xl relative animate-fade-in text-on-surface">
            <button 
              onClick={() => setEditingEmployee(null)}
              className="absolute top-4 right-4 text-on-surface-variant hover:text-on-surface bg-transparent border-none cursor-pointer p-1 rounded-full flex items-center justify-center"
            >
              <span className="material-symbols-outlined text-lg">close</span>
            </button>

            <h3 className="text-lg font-bold text-primary mb-1">Edit Payment Details</h3>
            <p className="text-xs text-on-surface-variant mb-6">
              Adjust draft details for <strong>{editingEmployee.first_name} {editingEmployee.last_name}</strong>.
            </p>

            <form onSubmit={handleSaveEditPayment} className="flex flex-col gap-4">
              {/* Pay Type Info */}
              <div className="bg-surface-container-low rounded-xl p-3 text-xs border border-outline-variant flex justify-between items-center">
                <span className="font-bold text-on-surface-variant">Pay Type:</span>
                <span className="font-bold text-primary capitalize">{editingEmployee.pay_type?.replace('_', ' ') || ''}</span>
              </div>

              {editingEmployee.pay_type === 'hourly' && (
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-bold text-on-surface-variant">Hours Worked</label>
                  <input 
                    type="number"
                    step="any"
                    value={editHours}
                    onChange={(e) => setEditHours(e.target.value)}
                    className="bg-surface border border-outline-variant rounded-lg p-2 text-sm text-on-surface focus:outline-none focus:border-secondary w-full"
                    placeholder="Enter hours worked"
                    required
                  />
                  <span className="text-[10px] text-on-surface-variant">Hourly rate: {formatCurrency(editingEmployee.rate)}/hr</span>
                </div>
              )}

              {editingEmployee.pay_type === 'salary_commission' && (
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-bold text-on-surface-variant">Additional Commission ($)</label>
                  <input 
                    type="number"
                    step="any"
                    value={editCommission}
                    onChange={(e) => setEditCommission(e.target.value)}
                    className="bg-surface border border-outline-variant rounded-lg p-2 text-sm text-on-surface focus:outline-none focus:border-secondary w-full"
                    placeholder="Enter additional commission"
                    required
                  />
                  <span className="text-[10px] text-on-surface-variant">Base salary: {formatCurrency(editingEmployee.rate)}</span>
                </div>
              )}

              {/* Vacation Payout - common to all pay types */}
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-bold text-on-surface-variant">Vacation Payout ($)</label>
                <input 
                  type="number"
                  step="any"
                  value={editVacationPayout}
                  onChange={(e) => setEditVacationPayout(e.target.value)}
                  className="bg-surface border border-outline-variant rounded-lg p-2 text-sm text-on-surface focus:outline-none focus:border-secondary w-full"
                  placeholder="Enter vacation payout amount"
                  required
                />
              </div>

              {/* Payment Method Selector */}
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-bold text-on-surface-variant">Payment Method</label>
                <select 
                  value={editPaymentMethod}
                  onChange={(e) => setEditPaymentMethod(e.target.value)}
                  className="bg-surface border border-outline-variant rounded-lg p-2.5 text-sm text-on-surface focus:outline-none focus:border-secondary w-full cursor-pointer"
                >
                  <option value="e-Transfer">INTERAC e-Transfer</option>
                  <option value="Cheque">Physical Cheque</option>
                  <option value="Cash">Cash Outlay</option>
                </select>
              </div>

              <div className="flex justify-end gap-3 mt-4 pt-4 border-t border-outline-variant">
                <button
                  type="button"
                  onClick={() => setEditingEmployee(null)}
                  className="border border-outline hover:bg-surface-container-low text-on-surface-variant font-bold py-2 px-4 rounded-lg text-sm cursor-pointer bg-transparent"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="bg-primary hover:bg-opacity-95 text-on-primary font-bold py-2 px-4 rounded-lg text-sm cursor-pointer border-none"
                >
                  Save Changes
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default ReportsView;
