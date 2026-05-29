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

  // Reporting sub-tab states
  const [activeSubTab, setActiveSubTab] = useState<'compliance' | 'payroll-reports'>('compliance');
  const [selectedReport, setSelectedReport] = useState<
    'net-pay' | 'pay-run-summary' | 'pay-statement' | 'remittance' | 'health-tax' |
    'deductions-expenses' | 'employee-information' | 'employee-variance' | 'payroll-detail' | 'payroll-variance' |
    'ytd-detail'
  >('net-pay');
  const [payGroupsList, setPayGroupsList] = useState<any[]>([]);
  const [reportFilterPayGroups, setReportFilterPayGroups] = useState<number[]>([]);
  const [reportFilterRunId, setReportFilterRunId] = useState<number | null>(null);
  const [reportFilterEmployeeId, setReportFilterEmployeeId] = useState<number | string>('all');
  const [reportFilterYear, setReportFilterYear] = useState<number>(new Date().getFullYear());
  const [reportFilterPaymentMethods, setReportFilterPaymentMethods] = useState<string[]>(['e-Transfer', 'Direct Deposit', 'Cheque', 'Cash']);
  const [reportFilterStartDate, setReportFilterStartDate] = useState<string>(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
  });
  const [reportFilterEndDate, setReportFilterEndDate] = useState<string>(() => {
    const d = new Date();
    return d.toISOString().split('T')[0];
  });
  const [reportData, setReportData] = useState<any>(null);
  const [reportLoading, setReportLoading] = useState<boolean>(false);
  const [downloadingReport, setDownloadingReport] = useState<boolean>(false);
  const [employeesList, setEmployeesList] = useState<any[]>([]);


  const handleDownloadT4 = async () => {
    try {
      setDownloadingT4(true);
      const blob = await api.downloadFile(api.getT4ExportUrl());
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
      const url = api.getPaystubUrl(runDetails.id, employeeId);
      const blob = await api.downloadFile(url);
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
      const [ytd, runsData, paymentsData, employeesData, payGroupsData] = await Promise.all([
        api.getYtdReports(),
        api.getPayrollRuns(),
        api.getRemittancePayments(),
        api.getEmployees(),
        api.getPayGroups()
      ]);
      setYtdData(ytd);
      setRuns(runsData);
      setPayments(paymentsData);
      setEmployeesList(employeesData);
      setPayGroupsList(payGroupsData || []);
      
      // Auto-select or preserve selection
      const targetId = preserveSelectedId !== undefined ? preserveSelectedId : (runsData.length > 0 ? runsData[0].id : null);
      if (targetId !== null) {
        handleSelectRun(targetId);
        setReportFilterRunId(targetId);
      } else {
        setSelectedRunId(null);
        setRunDetails(null);
        setReportFilterRunId(null);
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
      await loadReportsData(null); // Diselect deleted run
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

  const handleGenerateReportPreview = async () => {
    try {
      setReportLoading(true);
      setReportData(null);
      
      if (selectedReport === 'net-pay') {
        if (!reportFilterRunId) {
          triggerToast('Please select a pay run.', 'error');
          return;
        }
        const data = await api.getNetPayReportData(reportFilterRunId, reportFilterPaymentMethods.join(','));
        setReportData(data);
      } else if (selectedReport === 'pay-run-summary') {
        if (!reportFilterRunId) {
          triggerToast('Please select a pay run.', 'error');
          return;
        }
        const data = await api.getPayRunSummaryData(reportFilterRunId);
        setReportData(data);
      } else if (selectedReport === 'pay-statement') {
        setReportData({ message: 'Ready to generate.' });
      } else if (selectedReport === 'remittance') {
        if (!reportFilterStartDate || !reportFilterEndDate) {
          triggerToast('Please select start and end dates.', 'error');
          return;
        }
        const data = await api.getRemittanceReportData(reportFilterStartDate, reportFilterEndDate);
        setReportData(data);
      } else if (selectedReport === 'health-tax') {
        const data = await api.getHealthTaxReportData(reportFilterYear);
        setReportData(data);
      } else if (selectedReport === 'deductions-expenses') {
        if (!reportFilterStartDate || !reportFilterEndDate) {
          triggerToast('Please select start and end dates.', 'error');
          return;
        }
        const payGroupsStr = reportFilterPayGroups.length > 0 ? reportFilterPayGroups.join(',') : 'all';
        const data = await api.getDeductionsExpensesSummaryData(payGroupsStr, reportFilterStartDate, reportFilterEndDate);
        setReportData(data);
      } else if (selectedReport === 'employee-information') {
        const payGroupsStr = reportFilterPayGroups.length > 0 ? reportFilterPayGroups.join(',') : 'all';
        const data = await api.getEmployeeInformationReportData(payGroupsStr, reportFilterStartDate, reportFilterEndDate);
        setReportData(data);
      } else if (selectedReport === 'employee-variance') {
        if (!reportFilterRunId) {
          triggerToast('Please select a pay run.', 'error');
          return;
        }
        const data = await api.getEmployeeVarianceReportData(reportFilterRunId, String(reportFilterEmployeeId));
        setReportData(data);
      } else if (selectedReport === 'payroll-detail') {
        if (!reportFilterStartDate || !reportFilterEndDate) {
          triggerToast('Please select start and end dates.', 'error');
          return;
        }
        const payGroupsStr = reportFilterPayGroups.length > 0 ? reportFilterPayGroups.join(',') : 'all';
        const data = await api.getPayrollDetailReportData(payGroupsStr, reportFilterStartDate, reportFilterEndDate);
        setReportData(data);
      } else if (selectedReport === 'payroll-variance') {
        if (!reportFilterRunId) {
          triggerToast('Please select a pay run.', 'error');
          return;
        }
        const data = await api.getPayrollVarianceReportData(reportFilterRunId);
        setReportData(data);
      } else if (selectedReport === 'ytd-detail') {
        const payGroupsStr = reportFilterPayGroups.length > 0 ? reportFilterPayGroups.join(',') : 'all';
        const data = await api.getYtdDetailReportData(reportFilterYear, payGroupsStr, String(reportFilterEmployeeId));
        setReportData(data);
      }
      triggerToast('Report preview generated successfully.', 'success');
    } catch (err: any) {
      console.error(err);
      triggerToast(err.message || 'Failed to load report data preview.', 'error');
    } finally {
      setReportLoading(false);
    }
  };

  const handleDownloadReportPdf = async () => {
    try {
      setDownloadingReport(true);
      
      let url = '';
      let filename = '';
      
      if (selectedReport === 'net-pay') {
        if (!reportFilterRunId) {
          triggerToast('Please select a pay run.', 'error');
          return;
        }
        url = api.getNetPayReportUrl(reportFilterRunId, reportFilterPaymentMethods.join(','));
        filename = `net_pay_report_${reportFilterRunId}.pdf`;
      } else if (selectedReport === 'pay-run-summary') {
        if (!reportFilterRunId) {
          triggerToast('Please select a pay run.', 'error');
          return;
        }
        url = api.getPayRunSummaryUrl(reportFilterRunId);
        filename = `pay_run_summary_${reportFilterRunId}.pdf`;
      } else if (selectedReport === 'pay-statement') {
        url = api.getPayStatementUrl(reportFilterRunId || 'all', reportFilterEmployeeId, reportFilterPaymentMethods.join(','));
        filename = `pay_statements_run_${reportFilterRunId || 'all'}_emp_${reportFilterEmployeeId}.pdf`;
      } else if (selectedReport === 'remittance') {
        if (!reportFilterStartDate || !reportFilterEndDate) {
          triggerToast('Please select start and end dates.', 'error');
          return;
        }
        url = api.getRemittanceReportUrl(reportFilterStartDate, reportFilterEndDate);
        filename = `remittance_report_${reportFilterStartDate}_to_${reportFilterEndDate}.pdf`;
      } else if (selectedReport === 'health-tax') {
        url = api.getHealthTaxReportUrl(reportFilterYear);
        filename = `provincial_health_tax_${reportFilterYear}.pdf`;
      } else if (selectedReport === 'deductions-expenses') {
        if (!reportFilterStartDate || !reportFilterEndDate) {
          triggerToast('Please select start and end dates.', 'error');
          return;
        }
        const payGroupsStr = reportFilterPayGroups.length > 0 ? reportFilterPayGroups.join(',') : 'all';
        url = api.getDeductionsExpensesSummaryUrl(payGroupsStr, reportFilterStartDate, reportFilterEndDate);
        filename = `deductions_expenses_summary_${reportFilterStartDate}_to_${reportFilterEndDate}.pdf`;
      } else if (selectedReport === 'employee-information') {
        const payGroupsStr = reportFilterPayGroups.length > 0 ? reportFilterPayGroups.join(',') : 'all';
        url = api.getEmployeeInformationReportUrl(payGroupsStr, reportFilterStartDate, reportFilterEndDate);
        filename = `employee_information_report.pdf`;
      } else if (selectedReport === 'employee-variance') {
        if (!reportFilterRunId) {
          triggerToast('Please select a pay run.', 'error');
          return;
        }
        url = api.getEmployeeVarianceReportUrl(reportFilterRunId, String(reportFilterEmployeeId));
        filename = `employee_variance_run_${reportFilterRunId}_emp_${reportFilterEmployeeId}.pdf`;
      } else if (selectedReport === 'payroll-detail') {
        if (!reportFilterStartDate || !reportFilterEndDate) {
          triggerToast('Please select start and end dates.', 'error');
          return;
        }
        const payGroupsStr = reportFilterPayGroups.length > 0 ? reportFilterPayGroups.join(',') : 'all';
        url = api.getPayrollDetailReportUrl(payGroupsStr, reportFilterStartDate, reportFilterEndDate);
        filename = `payroll_detail_report_${reportFilterStartDate}_to_${reportFilterEndDate}.pdf`;
      } else if (selectedReport === 'payroll-variance') {
        if (!reportFilterRunId) {
          triggerToast('Please select a pay run.', 'error');
          return;
        }
        url = api.getPayrollVarianceReportUrl(reportFilterRunId);
        filename = `payroll_variance_run_${reportFilterRunId}.pdf`;
      } else if (selectedReport === 'ytd-detail') {
        const payGroupsStr = reportFilterPayGroups.length > 0 ? reportFilterPayGroups.join(',') : 'all';
        url = api.getYtdDetailReportUrl(reportFilterYear, payGroupsStr, String(reportFilterEmployeeId));
        filename = `ytd_detail_report_${reportFilterYear}.pdf`;
      }
      
      const blob = await api.downloadFile(url);
      const objectUrl = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = objectUrl;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(objectUrl);
      a.remove();
      triggerToast('Report PDF downloaded successfully.', 'success');
    } catch (err: any) {
      console.error(err);
      triggerToast(err.message || 'Failed to download report PDF.', 'error');
    } finally {
      setDownloadingReport(false);
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
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-highlight"></div>
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

      {/* Sub-Tabs Nav */}
      <div className="flex border-b border-outline-variant gap-6 mb-2">
        <button
          onClick={() => setActiveSubTab('compliance')}
          className={`pb-3 text-sm font-bold border-b-2 px-1 transition-all flex items-center gap-2 cursor-pointer bg-transparent border-none ${
            activeSubTab === 'compliance'
              ? 'border-highlight text-primary'
              : 'border-transparent text-on-surface-variant hover:text-on-surface'
          }`}
        >
          <span className="material-symbols-outlined text-[18px]">verified_user</span>
          Compliance &amp; Remittances
        </button>
        <button
          onClick={() => setActiveSubTab('payroll-reports')}
          className={`pb-3 text-sm font-bold border-b-2 px-1 transition-all flex items-center gap-2 cursor-pointer bg-transparent border-none ${
            activeSubTab === 'payroll-reports'
              ? 'border-highlight text-primary'
              : 'border-transparent text-on-surface-variant hover:text-on-surface'
          }`}
        >
          <span className="material-symbols-outlined text-[18px]">description</span>
          Payroll Reports
        </button>
      </div>

      {activeSubTab === 'compliance' ? (
        <>
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
                  className="bg-highlight hover:bg-opacity-95 disabled:opacity-50 text-on-highlight font-bold py-2.5 px-6 rounded-lg text-sm shadow-sm flex items-center gap-2 active:scale-95 transition-transform cursor-pointer"
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
                      className="h-9 border border-outline-variant rounded px-2.5 text-xs focus:outline-none focus:ring-1 focus:ring-highlight bg-transparent text-on-surface cursor-pointer"
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
                      className="h-9 border border-outline-variant rounded px-2.5 text-xs focus:outline-none focus:ring-1 focus:ring-highlight bg-transparent text-on-surface"
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
                      className="h-9 border border-outline-variant rounded px-2.5 text-xs focus:outline-none focus:ring-1 focus:ring-highlight bg-transparent text-on-surface"
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
                        className="h-9 border border-outline-variant rounded px-2.5 text-xs focus:outline-none focus:ring-1 focus:ring-highlight bg-transparent text-on-surface"
                        required
                      />
                    ) : (
                      <select
                        value={paymentPeriodEnd}
                        onChange={(e) => setPaymentPeriodEnd(e.target.value)}
                        className="h-9 border border-outline-variant rounded px-2.5 text-xs focus:outline-none focus:ring-1 focus:ring-highlight bg-transparent text-on-surface cursor-pointer"
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
                    className="w-full bg-highlight text-on-highlight font-bold py-2 px-3 rounded-lg text-xs hover:bg-opacity-95 transition-all shadow-sm flex items-center justify-center gap-1.5 disabled:opacity-50 mt-1 cursor-pointer border-none"
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
                          w-full p-4 flex flex-col gap-1 text-left transition-colors bg-transparent border-none cursor-pointer
                          ${isSelected ? 'bg-highlight/5 border-l-4 border-highlight pl-3 font-bold' : 'hover:bg-surface-container-low/20'}
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
                    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-highlight"></div>
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
                                <span className="ml-2 text-[9px] font-bold text-rose-700 bg-rose-50 px-1.5 py-0.5 rounded border border-rose-200 uppercase">
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
                                title="Actions Menu"
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
        </>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start animate-fade-in text-on-surface">
          {/* Report Selector List (Left Column) */}
          <div className="lg:col-span-3 bg-surface-container-lowest border border-outline-variant rounded-xl shadow-sm overflow-hidden flex flex-col">
            <div className="p-4 bg-surface-container-low border-b border-outline-variant">
              <h3 className="font-bold text-xs text-primary uppercase tracking-wider">Report Type</h3>
            </div>
            <div className="flex flex-col divide-y divide-outline-variant">
              {[
                { id: 'net-pay', label: 'Net Pay Detail', icon: 'payments', desc: 'Employee payment breakdown per run', category: 'payroll' },
                { id: 'pay-run-summary', label: 'Pay Run Summary', icon: 'summarize', desc: 'Earnings, deductions & employer taxes', category: 'payroll' },
                { id: 'pay-statement', label: 'Pay Statement (Stub)', icon: 'receipt_long', desc: 'Printable employee pay statements', category: 'payroll' },
                { id: 'remittance', label: 'Remittance Report', icon: 'account_balance', desc: 'Federal, WSIB & EHT periods', category: 'payroll' },
                { id: 'health-tax', label: 'Provincial Health Tax', icon: 'domain', desc: 'Ontario EHT annual summary', category: 'payroll' },
                { id: 'deductions-expenses', label: 'Deductions & Expenses', icon: 'percent', desc: 'Statutory and other employer deductions', category: 'adhoc' },
                { id: 'employee-information', label: 'Employee Information', icon: 'badge', desc: 'Active employee files and settings', category: 'adhoc' },
                { id: 'employee-variance', label: 'Employee Variance', icon: 'compare_arrows', desc: 'Employee change check since last payrun', category: 'adhoc' },
                { id: 'payroll-detail', label: 'Payroll Detail', icon: 'list_alt', desc: 'Detailed earnings & deductions ledger', category: 'adhoc' },
                { id: 'payroll-variance', label: 'Payroll Variance', icon: 'difference', desc: 'Paygroup change check since last payrun', category: 'adhoc' },
                { id: 'ytd-detail', label: 'Year to Date Detail', icon: 'calendar_month', desc: 'Employee YTD pay components per month', category: 'adhoc' }
              ].map((rpt, idx, arr) => {
                const showHeader = idx === 0 || rpt.category !== arr[idx - 1].category;
                const isSel = selectedReport === rpt.id;
                return (
                  <React.Fragment key={rpt.id}>
                    {showHeader && (
                      <div className="p-3 bg-surface-container-low text-[9px] font-black text-primary uppercase tracking-wider border-t border-outline-variant first:border-t-0 text-left">
                        {rpt.category === 'payroll' ? 'Payroll Reports' : 'Adhoc Reports'}
                      </div>
                    )}
                    <button
                      onClick={() => {
                        setSelectedReport(rpt.id as any);
                        setReportData(null);
                      }}
                      className={`w-full p-4 flex flex-col gap-1 text-left transition-all bg-transparent border-none cursor-pointer hover:bg-surface-container-low/20 ${
                        isSel ? 'bg-highlight/5 border-l-4 border-highlight pl-3 font-bold' : ''
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        <span className={`material-symbols-outlined text-[18px] ${isSel ? 'text-highlight' : 'text-on-surface-variant'}`}>{rpt.icon}</span>
                        <span className={`text-xs font-bold ${isSel ? 'text-primary' : 'text-on-surface'}`}>{rpt.label}</span>
                      </div>
                      <span className="text-[10px] text-on-surface-variant leading-tight pl-6">{rpt.desc}</span>
                    </button>
                  </React.Fragment>
                );
              })}
            </div>
          </div>

          {/* Configuration and Preview (Right Column) */}
          <div className="lg:col-span-9 flex flex-col gap-6">
            {/* Filters Form Panel */}
            <div className="bg-surface-container-lowest border border-outline-variant rounded-xl p-5 shadow-sm flex flex-col gap-4">
              <h3 className="text-sm font-bold text-primary flex items-center gap-1.5 uppercase tracking-wider">
                <span className="material-symbols-outlined text-[16px]">tune</span>
                Report Parameters
              </h3>
              
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 items-end">
                {/* 1. Pay Run Selector (Net Pay, Pay Run Summary, Pay Statement, Employee Variance, Payroll Variance) */}
                {(selectedReport === 'net-pay' || selectedReport === 'pay-run-summary' || selectedReport === 'pay-statement' || selectedReport === 'employee-variance' || selectedReport === 'payroll-variance') && (
                  <div className="flex flex-col gap-1">
                    <label className="text-[10px] font-bold text-on-surface-variant uppercase">
                      Pay Run Period {selectedReport === 'pay-statement' && '(or All)'}
                    </label>
                    <select
                      value={reportFilterRunId || ''}
                      onChange={(e) => setReportFilterRunId(e.target.value ? (e.target.value === 'all' ? 'all' as any : Number(e.target.value)) : null)}
                      className="h-9 border border-outline-variant rounded px-2.5 text-xs focus:outline-none focus:ring-1 focus:ring-highlight bg-transparent text-on-surface cursor-pointer"
                    >
                      {selectedReport === 'pay-statement' && (
                        <option value="all">-- All Finalized/Paid Runs --</option>
                      )}
                      {runs.filter(r => r.status !== 'draft').map(r => (
                        <option key={r.id} value={r.id}>
                          Run #{r.id} ({r.run_date}) - {r.period_start} to {r.period_end}
                        </option>
                      ))}
                      {runs.length === 0 && (
                        <option value="">No completed runs available</option>
                      )}
                    </select>
                  </div>
                )}

                {/* 2. Employee Selector (Pay Statement, Employee Variance, YTD Detail) */}
                {(selectedReport === 'pay-statement' || selectedReport === 'employee-variance' || selectedReport === 'ytd-detail') && (
                  <div className="flex flex-col gap-1">
                    <label className="text-[10px] font-bold text-on-surface-variant uppercase">Employee</label>
                    <select
                      value={reportFilterEmployeeId}
                      onChange={(e) => setReportFilterEmployeeId(e.target.value)}
                      className="h-9 border border-outline-variant rounded px-2.5 text-xs focus:outline-none focus:ring-1 focus:ring-highlight bg-transparent text-on-surface cursor-pointer"
                    >
                      <option value="all">-- All Employees --</option>
                      {employeesList.map(emp => (
                        <option key={emp.id} value={emp.id}>{emp.last_name}, {emp.first_name}</option>
                      ))}
                    </select>
                  </div>
                )}

                {/* 3. Date Range (Remittance Report, Deductions & Expenses, Employee Info, Payroll Detail) */}
                {(selectedReport === 'remittance' || selectedReport === 'deductions-expenses' || selectedReport === 'employee-information' || selectedReport === 'payroll-detail') && (
                  <>
                    <div className="flex flex-col gap-1">
                      <label className="text-[10px] font-bold text-on-surface-variant uppercase">Start Date</label>
                      <input
                        type="date"
                        value={reportFilterStartDate}
                        onChange={(e) => setReportFilterStartDate(e.target.value)}
                        className="h-9 border border-outline-variant rounded px-2.5 text-xs focus:outline-none focus:ring-1 focus:ring-highlight bg-transparent text-on-surface"
                      />
                    </div>
                    <div className="flex flex-col gap-1">
                      <label className="text-[10px] font-bold text-on-surface-variant uppercase">End Date</label>
                      <input
                        type="date"
                        value={reportFilterEndDate}
                        onChange={(e) => setReportFilterEndDate(e.target.value)}
                        className="h-9 border border-outline-variant rounded px-2.5 text-xs focus:outline-none focus:ring-1 focus:ring-highlight bg-transparent text-on-surface"
                      />
                    </div>
                  </>
                )}

                {/* 4. Tax Year Selector (Health Tax, YTD Detail) */}
                {(selectedReport === 'health-tax' || selectedReport === 'ytd-detail') && (
                  <div className="flex flex-col gap-1">
                    <label className="text-[10px] font-bold text-on-surface-variant uppercase">Tax Year</label>
                    <select
                      value={reportFilterYear}
                      onChange={(e) => setReportFilterYear(Number(e.target.value))}
                      className="h-9 border border-outline-variant rounded px-2.5 text-xs focus:outline-none focus:ring-1 focus:ring-highlight bg-transparent text-on-surface cursor-pointer"
                    >
                      {[2024, 2025, 2026, 2027].map(yr => (
                        <option key={yr} value={yr}>{yr}</option>
                      ))}
                    </select>
                  </div>
                )}

                {/* 5. Payment Methods (Net Pay, Pay Statement) */}
                {(selectedReport === 'net-pay' || selectedReport === 'pay-statement') && (
                  <div className="flex flex-col gap-1 lg:col-span-2">
                    <label className="text-[10px] font-bold text-on-surface-variant uppercase mb-1">Payment Method Filtering</label>
                    <div className="flex gap-4 items-center h-9">
                      {['e-Transfer', 'Direct Deposit', 'Cheque', 'Cash'].map(method => (
                        <label key={method} className="flex items-center gap-1.5 text-xs text-on-surface cursor-pointer select-none">
                          <input
                            type="checkbox"
                            checked={reportFilterPaymentMethods.includes(method)}
                            onChange={(e) => {
                              if (e.target.checked) {
                                setReportFilterPaymentMethods([...reportFilterPaymentMethods, method]);
                              } else {
                                setReportFilterPaymentMethods(reportFilterPaymentMethods.filter(m => m !== method));
                              }
                            }}
                            className="rounded border-outline-variant text-secondary focus:ring-secondary w-3.5 h-3.5 cursor-pointer"
                          />
                          {method}
                        </label>
                      ))}
                    </div>
                  </div>
                )}

                {/* 6. Pay Groups Multi-Select Checklist (Deductions & Expenses, Employee Info, Payroll Detail, YTD Detail) */}
                {(selectedReport === 'deductions-expenses' || selectedReport === 'employee-information' || selectedReport === 'payroll-detail' || selectedReport === 'ytd-detail') && (
                  <div className="flex flex-col gap-1 lg:col-span-2">
                    <label className="text-[10px] font-bold text-on-surface-variant uppercase mb-1 font-bold">Pay Groups Filtering</label>
                    <div className="flex flex-wrap gap-4 items-center h-9">
                      <label className="flex items-center gap-1.5 text-xs text-on-surface cursor-pointer select-none font-semibold">
                        <input
                          type="checkbox"
                          checked={reportFilterPayGroups.length === 0}
                          onChange={(e) => {
                            if (e.target.checked) {
                              setReportFilterPayGroups([]);
                            }
                          }}
                          className="rounded border-outline-variant text-secondary focus:ring-secondary w-3.5 h-3.5 cursor-pointer"
                        />
                        All Groups
                      </label>
                      {payGroupsList.map(group => {
                        const isChecked = reportFilterPayGroups.includes(group.id);
                        return (
                          <label key={group.id} className="flex items-center gap-1.5 text-xs text-on-surface cursor-pointer select-none font-semibold">
                            <input
                              type="checkbox"
                              checked={isChecked}
                              onChange={(e) => {
                                if (e.target.checked) {
                                  setReportFilterPayGroups([...reportFilterPayGroups.filter(id => id !== group.id), group.id]);
                                } else {
                                  setReportFilterPayGroups(reportFilterPayGroups.filter(id => id !== group.id));
                                }
                              }}
                              className="rounded border-outline-variant text-secondary focus:ring-secondary w-3.5 h-3.5 cursor-pointer"
                            />
                            {group.name}
                          </label>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Action Buttons Panel */}
                <div className={`flex gap-3 justify-end ${
                  selectedReport === 'net-pay' || selectedReport === 'pay-statement' ? 'md:col-span-2 lg:col-span-1' : ''
                }`}>
                  {selectedReport !== 'pay-statement' && (
                    <button
                      onClick={handleGenerateReportPreview}
                      disabled={reportLoading}
                      className="bg-secondary text-on-secondary hover:bg-opacity-95 disabled:opacity-50 text-xs font-bold py-2 px-4 rounded-lg flex items-center justify-center gap-1.5 active:scale-95 transition-all cursor-pointer h-9 shadow-sm border-none"
                    >
                      <span className="material-symbols-outlined text-[16px]">visibility</span>
                      {reportLoading ? 'Generating...' : 'Preview'}
                    </button>
                  )}
                  <button
                    onClick={handleDownloadReportPdf}
                    disabled={downloadingReport}
                    className="bg-highlight text-on-highlight hover:bg-opacity-95 disabled:opacity-50 text-xs font-bold py-2 px-4 rounded-lg flex items-center justify-center gap-1.5 active:scale-95 transition-all cursor-pointer h-9 shadow-sm border-none"
                  >
                    <span className="material-symbols-outlined text-[16px]">picture_as_pdf</span>
                    {downloadingReport ? 'Downloading...' : 'Download PDF'}
                  </button>
                </div>
              </div>
            </div>

            {/* Preview Output Table */}
            <div className="bg-surface-container-lowest border border-outline-variant rounded-xl p-6 shadow-sm min-h-[300px] flex flex-col gap-4">
              <div className="flex justify-between items-center border-b border-outline-variant pb-3">
                <h3 className="text-sm font-bold text-primary uppercase tracking-wider flex items-center gap-1.5">
                  <span className="material-symbols-outlined text-[16px]">table_chart</span>
                  HTML Report Preview
                </h3>
                {reportData && (
                  <span className="text-[10px] text-on-surface-variant font-bold">
                    AS OF {new Date().toLocaleDateString('en-CA')}
                  </span>
                )}
              </div>

              {reportLoading ? (
                <div className="flex-1 flex flex-col items-center justify-center gap-2 h-48">
                  <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-highlight"></div>
                  <span className="text-xs text-on-surface-variant">Generating report preview...</span>
                </div>
              ) : reportData ? (
                <div className="flex-grow overflow-x-auto text-xs text-on-surface">
                  {/* Render preview for Net Pay */}
                  {selectedReport === 'net-pay' && (
                    <div className="flex flex-col gap-4">
                      {/* Gitpaid style headers */}
                      <div className="flex flex-col md:flex-row justify-between border-b border-outline-variant pb-2 mb-2">
                        <div>
                          <p className="text-sm font-bold text-primary">{reportData.companyName}</p>
                          <p className="text-xs font-semibold text-on-surface-variant font-bold">Net Pay Detail Report</p>
                          <p className="text-[10px] text-on-surface-variant font-medium">Pay Group: {reportData.payGroup}</p>
                        </div>
                        <div className="text-right mt-2 md:mt-0">
                          <p className="text-[10px] text-on-surface-variant font-bold">Pay period range:</p>
                          <p className="text-xs font-bold text-secondary">{reportData.periodStart} to {reportData.periodEnd}</p>
                        </div>
                      </div>

                      <table className="w-full border-collapse">
                        <thead>
                          <tr className="border-b border-outline text-[10px] font-bold text-on-surface-variant uppercase text-left bg-surface-container-low">
                            <th className="py-2 px-3">Employee Name</th>
                            <th className="py-2 px-3">Employee Code</th>
                            <th className="py-2 px-3 text-right">Net Pay</th>
                          </tr>
                        </thead>
                        <tbody>
                          {reportData.groups?.map((group: any) => (
                            <React.Fragment key={group.paymentMethod}>
                              <tr className="border-b border-outline-variant bg-surface-container-lowest font-bold text-primary">
                                <td colSpan={3} className="py-2 px-3 text-left">
                                  Payment Type: {group.paymentMethod}
                                </td>
                              </tr>
                              {group.employees?.map((emp: any) => (
                                <tr key={emp.id} className="border-b border-outline-variant hover:bg-surface-container-low/20 transition-colors font-medium">
                                  <td className="py-2 px-3 pl-6 text-left">{emp.name}</td>
                                  <td className="py-2 px-3 text-on-surface-variant text-left">{emp.code}</td>
                                  <td className="py-2 px-3 text-right">{formatCurrency(emp.netPay)}</td>
                                </tr>
                              ))}
                              <tr className="border-b border-outline bg-surface-container-low/40 font-bold">
                                <td className="py-2 px-3 pl-4 text-left">{group.paymentMethod} Total</td>
                                <td className="py-2 px-3 text-on-surface-variant text-[10px] text-left">Employee Count: {group.employeeCount}</td>
                                <td className="py-2 px-3 text-right text-secondary">{formatCurrency(group.totalNetPay)}</td>
                              </tr>
                            </React.Fragment>
                          ))}
                          <tr className="font-bold text-sm bg-surface-container-low">
                            <td colSpan={2} className="py-3 px-3 text-left">Grand Total</td>
                            <td className="py-3 px-3 text-right border-t border-b-4 border-double border-primary text-primary">
                              {formatCurrency(reportData.grandTotal)}
                            </td>
                          </tr>
                        </tbody>
                      </table>
                    </div>
                  )}

                  {/* Render preview for Pay Run Summary */}
                  {selectedReport === 'pay-run-summary' && (
                    <div className="flex flex-col gap-4">
                      {/* Gitpaid style headers */}
                      <div className="flex flex-col md:flex-row justify-between border-b border-outline-variant pb-2 mb-2">
                        <div>
                          <p className="text-sm font-bold text-primary">{reportData.companyName}</p>
                          <p className="text-xs font-semibold text-on-surface-variant font-bold">Pay Run Summary Report</p>
                          <p className="text-[10px] text-on-surface-variant font-medium">Pay Group: {reportData.payGroup}</p>
                        </div>
                        <div className="text-right mt-2 md:mt-0">
                          <p className="text-[10px] text-on-surface-variant font-bold">Pay period range:</p>
                          <p className="text-xs font-bold text-secondary">{reportData.periodStart} to {reportData.periodEnd}</p>
                        </div>
                      </div>

                      <table className="w-full border-collapse">
                        <thead>
                          <tr className="border-b border-outline text-[10px] font-bold text-on-surface-variant uppercase text-left bg-surface-container-low">
                            <th className="py-2 px-3">Components</th>
                            <th className="py-2 px-3">Quantity/Hours</th>
                            <th className="py-2 px-3 text-right">Current Period</th>
                            <th className="py-2 px-3 text-right">YTD + Current Period</th>
                          </tr>
                        </thead>
                        <tbody>
                          {/* 1. Earnings */}
                          <tr className="bg-surface-container-lowest font-bold text-primary border-b border-outline-variant">
                            <td colSpan={4} className="py-2 px-3 text-left">Earnings</td>
                          </tr>
                          {reportData.earnings?.salary && (reportData.earnings.salary.cur > 0 || reportData.earnings.salary.ytd > 0) && (
                            <tr className="border-b border-outline-variant font-medium">
                              <td className="py-2 px-3 pl-6 text-left">Salary</td>
                              <td className="py-2 px-3 text-left"></td>
                              <td className="py-2 px-3 text-right">{formatCurrency(reportData.earnings.salary.cur)}</td>
                              <td className="py-2 px-3 text-right">{formatCurrency(reportData.earnings.salary.ytd)}</td>
                            </tr>
                          )}
                          {reportData.earnings?.hourly && (reportData.earnings.hourly.cur > 0 || reportData.earnings.hourly.ytd > 0) && (
                            <tr className="border-b border-outline-variant font-medium">
                              <td className="py-2 px-3 pl-6 text-left">Hourly Wages</td>
                              <td className="py-2 px-3 text-left">{reportData.totalHours > 0 ? reportData.totalHours.toFixed(2) : ''}</td>
                              <td className="py-2 px-3 text-right">{formatCurrency(reportData.earnings.hourly.cur)}</td>
                              <td className="py-2 px-3 text-right">{formatCurrency(reportData.earnings.hourly.ytd)}</td>
                            </tr>
                          )}
                          {reportData.earnings?.commission && (reportData.earnings.commission.cur > 0 || reportData.earnings.commission.ytd > 0) && (
                            <tr className="border-b border-outline-variant font-medium">
                              <td className="py-2 px-3 pl-6 text-left">Commission</td>
                              <td className="py-2 px-3 text-left"></td>
                              <td className="py-2 px-3 text-right">{formatCurrency(reportData.earnings.commission.cur)}</td>
                              <td className="py-2 px-3 text-right">{formatCurrency(reportData.earnings.commission.ytd)}</td>
                            </tr>
                          )}
                          {reportData.earnings?.vacationPaid && (reportData.earnings.vacationPaid.cur > 0 || reportData.earnings.vacationPaid.ytd > 0) && (
                            <tr className="border-b border-outline-variant font-medium">
                              <td className="py-2 px-3 pl-6 text-left">Vacation Paid Out</td>
                              <td className="py-2 px-3 text-left"></td>
                              <td className="py-2 px-3 text-right">{formatCurrency(reportData.earnings.vacationPaid.cur)}</td>
                              <td className="py-2 px-3 text-right">{formatCurrency(reportData.earnings.vacationPaid.ytd)}</td>
                            </tr>
                          )}
                          <tr className="border-b border-outline bg-surface-container-low/20 font-bold">
                            <td className="py-2 px-3 pl-4 text-left">Total Earnings</td>
                            <td className="py-2 px-3 text-left"></td>
                            <td className="py-2 px-3 text-right">{formatCurrency(reportData.earnings?.total?.cur || 0)}</td>
                            <td className="py-2 px-3 text-right">{formatCurrency(reportData.earnings?.total?.ytd || 0)}</td>
                          </tr>

                          {/* 2. Tax */}
                          <tr className="bg-surface-container-lowest font-bold text-primary border-b border-outline-variant mt-2">
                            <td colSpan={4} className="py-2 px-3 text-left">Tax</td>
                          </tr>
                          <tr className="border-b border-outline-variant font-medium">
                            <td className="py-2 px-3 pl-6 text-left">CPP (employee contribution)</td>
                            <td className="py-2 px-3 text-left"></td>
                            <td className="py-2 px-3 text-right">{formatCurrency(reportData.tax?.cppEmployee?.cur || 0)}</td>
                            <td className="py-2 px-3 text-right">{formatCurrency(reportData.tax?.cppEmployee?.ytd || 0)}</td>
                          </tr>
                          <tr className="border-b border-outline-variant font-medium">
                            <td className="py-2 px-3 pl-6 text-left">Federal income tax</td>
                            <td className="py-2 px-3 text-left"></td>
                            <td className="py-2 px-3 text-right">{formatCurrency(reportData.tax?.fedTax?.cur || 0)}</td>
                            <td className="py-2 px-3 text-right">{formatCurrency(reportData.tax?.fedTax?.ytd || 0)}</td>
                          </tr>
                          <tr className="border-b border-outline-variant font-medium">
                            <td className="py-2 px-3 pl-6 text-left">Ontario component of FIT</td>
                            <td className="py-2 px-3 text-left"></td>
                            <td className="py-2 px-3 text-right">{formatCurrency(reportData.tax?.provTax?.cur || 0)}</td>
                            <td className="py-2 px-3 text-right">{formatCurrency(reportData.tax?.provTax?.ytd || 0)}</td>
                          </tr>
                          <tr className="border-b border-outline bg-surface-container-low/20 font-bold">
                            <td className="py-2 px-3 pl-4 text-left">Total Tax</td>
                            <td className="py-2 px-3 text-left"></td>
                            <td className="py-2 px-3 text-right">{formatCurrency(reportData.tax?.total?.cur || 0)}</td>
                            <td className="py-2 px-3 text-right">{formatCurrency(reportData.tax?.total?.ytd || 0)}</td>
                          </tr>

                          {/* 3. Other Expenses */}
                          <tr className="bg-surface-container-lowest font-bold text-primary border-b border-outline-variant mt-2">
                            <td colSpan={4} className="py-2 px-3 text-left">Other Expenses</td>
                          </tr>
                          <tr className="border-b border-outline-variant font-medium">
                            <td className="py-2 px-3 pl-6 text-left">CPP (employer contribution)</td>
                            <td className="py-2 px-3 text-left"></td>
                            <td className="py-2 px-3 text-right">{formatCurrency(reportData.otherExpenses?.cppEmployer?.cur || 0)}</td>
                            <td className="py-2 px-3 text-right">{formatCurrency(reportData.otherExpenses?.cppEmployer?.ytd || 0)}</td>
                          </tr>
                          <tr className="border-b border-outline-variant font-medium">
                            <td className="py-2 px-3 pl-6 text-left">EI (employer contribution)</td>
                            <td className="py-2 px-3 text-left"></td>
                            <td className="py-2 px-3 text-right">{formatCurrency(reportData.otherExpenses?.eiEmployer?.cur || 0)}</td>
                            <td className="py-2 px-3 text-right">{formatCurrency(reportData.otherExpenses?.eiEmployer?.ytd || 0)}</td>
                          </tr>
                          <tr className="border-b border-outline-variant font-medium">
                            <td className="py-2 px-3 pl-6 text-left">WSIB premium</td>
                            <td className="py-2 px-3 text-left"></td>
                            <td className="py-2 px-3 text-right">{formatCurrency(reportData.otherExpenses?.wsib?.cur || 0)}</td>
                            <td className="py-2 px-3 text-right">{formatCurrency(reportData.otherExpenses?.wsib?.ytd || 0)}</td>
                          </tr>
                          <tr className="border-b border-outline-variant font-medium">
                            <td className="py-2 px-3 pl-6 text-left">EHT premium</td>
                            <td className="py-2 px-3 text-left"></td>
                            <td className="py-2 px-3 text-right">{formatCurrency(reportData.otherExpenses?.eht?.cur || 0)}</td>
                            <td className="py-2 px-3 text-right">{formatCurrency(reportData.otherExpenses?.eht?.ytd || 0)}</td>
                          </tr>
                          <tr className="border-b border-outline bg-surface-container-low/20 font-bold">
                            <td className="py-2 px-3 pl-4 text-left">Total Other Expenses</td>
                            <td className="py-2 px-3 text-left"></td>
                            <td className="py-2 px-3 text-right">{formatCurrency(reportData.otherExpenses?.total?.cur || 0)}</td>
                            <td className="py-2 px-3 text-right">{formatCurrency(reportData.otherExpenses?.total?.ytd || 0)}</td>
                          </tr>

                          {/* 4. Other Totals */}
                          <tr className="bg-surface-container-lowest font-bold text-primary border-b border-outline-variant mt-2">
                            <td colSpan={4} className="py-2 px-3 text-left">Other Totals</td>
                          </tr>
                          <tr className="border-b border-outline font-medium">
                            <td className="py-2 px-3 pl-6 text-left">Net pay: To employee: earnings - deductions</td>
                            <td className="py-2 px-3 text-left"></td>
                            <td className="py-2 px-3 text-right font-bold text-secondary">{formatCurrency(reportData.totals?.netPay?.cur || 0)}</td>
                            <td className="py-2 px-3 text-right font-bold text-secondary">{formatCurrency(reportData.totals?.netPay?.ytd || 0)}</td>
                          </tr>
                          
                          {/* 5. Total Salary Cost */}
                          <tr className="font-bold text-xs bg-surface-container-low">
                            <td className="py-3 px-3 pl-4 text-left">
                              <p className="font-bold">Total salary cost</p>
                              <p className="text-[9px] font-normal text-on-surface-variant leading-relaxed">
                                To company: total earnings + total benefits + total company contributions
                              </p>
                            </td>
                            <td className="py-3 px-3 text-left"></td>
                            <td className="py-3 px-3 text-right text-primary border-t border-b border-primary">
                              {formatCurrency(reportData.totals?.salaryCost?.cur || 0)}
                            </td>
                            <td className="py-3 px-3 text-right text-primary border-t border-b border-primary">
                              {formatCurrency(reportData.totals?.salaryCost?.ytd || 0)}
                            </td>
                          </tr>
                        </tbody>
                      </table>
                    </div>
                  )}

                  {/* Render preview for Pay Statement (just a summary info) */}
                  {selectedReport === 'pay-statement' && (
                    <div className="flex flex-col items-center justify-center p-8 text-center text-on-surface-variant gap-4 bg-surface-container-low/20 border border-dashed border-outline rounded-xl h-48">
                      <span className="material-symbols-outlined text-4xl text-primary animate-pulse">picture_as_pdf</span>
                      <div>
                        <p className="font-bold text-on-surface text-sm">Pay Statements PDF Generator Ready</p>
                        <p className="text-xs text-on-surface-variant mt-1">
                          You can download pay statement voucher cheques directly for the selected parameters.
                        </p>
                      </div>
                    </div>
                  )}

                  {/* Render preview for Remittance Report */}
                  {selectedReport === 'remittance' && (
                    <div className="flex flex-col gap-6">
                      {/* Gitpaid style headers */}
                      <div className="flex flex-col md:flex-row justify-between border-b border-outline-variant pb-2 mb-2">
                        <div>
                          <p className="text-sm font-bold text-primary">{reportData.companyName}</p>
                          <p className="text-xs font-semibold text-on-surface-variant font-bold">Statutory Remittance Report</p>
                        </div>
                        <div className="text-right mt-2 md:mt-0">
                          <p className="text-[10px] text-on-surface-variant font-bold">Reporting range:</p>
                          <p className="text-xs font-bold text-secondary">{reportData.startDate} to {reportData.endDate}</p>
                        </div>
                      </div>

                      {/* Summary Table */}
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        {/* Federal Box */}
                        <div className="border border-outline-variant rounded-xl p-4 bg-surface-container-low/20">
                          <h4 className="font-bold text-primary mb-3 border-b border-outline-variant pb-1 flex items-center justify-between">
                            <span>Federal Statutory</span>
                            <span className="text-[10px] bg-blue-50 text-blue-800 border border-blue-200 px-1.5 py-0.5 rounded font-semibold uppercase">CRA</span>
                          </h4>
                          <div className="flex flex-col gap-2 font-medium">
                            <div className="flex justify-between">
                              <span className="text-on-surface-variant font-semibold">CPP (Employee + Employer):</span>
                              <span>{formatCurrency(reportData.federal.cpp)}</span>
                            </div>
                            <div className="flex justify-between">
                              <span className="text-on-surface-variant font-semibold">EI (Employee + Employer):</span>
                              <span>{formatCurrency(reportData.federal.ei)}</span>
                            </div>
                            <div className="flex justify-between">
                              <span className="text-on-surface-variant font-semibold">Federal Income Tax:</span>
                              <span>{formatCurrency(reportData.federal.fedTax)}</span>
                            </div>
                            <div className="flex justify-between border-t border-outline-variant pt-2 font-bold text-secondary">
                              <span>Amount Payable:</span>
                              <span>{formatCurrency(reportData.federal.amountPayable)}</span>
                            </div>
                            <div className="flex justify-between border-t border-dashed border-outline-variant pt-2 text-[10px] text-on-surface-variant">
                              <span>Gross Payroll:</span>
                              <span>{formatCurrency(reportData.federal.grossPayroll)}</span>
                            </div>
                            <div className="flex justify-between text-[10px] text-on-surface-variant">
                              <span>Remitted Employees:</span>
                              <span>{reportData.federal.employeeCount}</span>
                            </div>
                          </div>
                        </div>

                        {/* Quebec Box (Placeholder) */}
                        <div className="border border-outline-variant rounded-xl p-4 bg-surface-container-low/20 opacity-70">
                          <h4 className="font-bold text-primary mb-3 border-b border-outline-variant pb-1 flex items-center justify-between">
                            <span>Quebec Statutory</span>
                            <span className="text-[10px] bg-zinc-50 text-zinc-600 border border-zinc-200 px-1.5 py-0.5 rounded font-semibold uppercase">Revenu Québec</span>
                          </h4>
                          <div className="flex flex-col gap-2 text-on-surface-variant">
                            <div className="flex justify-between">
                              <span>QPP (box B):</span>
                              <span>$0.00</span>
                            </div>
                            <div className="flex justify-between">
                              <span>QPIP (box D):</span>
                              <span>$0.00</span>
                            </div>
                            <div className="flex justify-between">
                              <span>Quebec Income Tax (box A):</span>
                              <span>$0.00</span>
                            </div>
                            <div className="flex justify-between border-t border-outline-variant pt-2 font-bold text-on-surface">
                              <span>Amount Payable:</span>
                              <span>$0.00</span>
                            </div>
                          </div>
                        </div>
                      </div>

                      {/* Provincial Assessments Table */}
                      <div className="border border-outline-variant rounded-xl p-4 bg-surface-container-lowest">
                        <h4 className="font-bold text-primary mb-3 border-b border-outline-variant pb-1 text-left">Ontario Provincial Contributions</h4>
                        <table className="w-full text-left">
                          <thead>
                            <tr className="text-[10px] font-bold text-on-surface-variant uppercase border-b border-outline bg-surface-container-low">
                              <th className="py-2 px-3">Province</th>
                              <th className="py-2 px-3">Agency / Item</th>
                              <th className="py-2 px-3 text-right">Insurable / Assessable Earnings</th>
                              <th className="py-2 px-3 text-right">Tax / Premium Accrued</th>
                            </tr>
                          </thead>
                          <tbody className="font-medium">
                            <tr className="border-b border-outline-variant">
                              <td className="py-2 px-3 text-left">Ontario</td>
                              <td className="py-2 px-3 font-bold text-primary text-left">{reportData.provincialHealthTax.name} (Health Tax)</td>
                              <td className="py-2 px-3 text-right">{formatCurrency(reportData.provincialHealthTax.ytdPayroll)}</td>
                              <td className="py-2 px-3 text-right text-secondary">{formatCurrency(reportData.provincialHealthTax.taxAmount)}</td>
                            </tr>
                            <tr className="border-b border-outline-variant">
                              <td className="py-2 px-3 text-left">Ontario</td>
                              <td className="py-2 px-3 font-bold text-primary text-left">{reportData.provincialWorkersComp.name} (Compensation Premium)</td>
                              <td className="py-2 px-3 text-right">{formatCurrency(reportData.provincialWorkersComp.assessableEarnings)}</td>
                              <td className="py-2 px-3 text-right text-secondary">{formatCurrency(reportData.provincialWorkersComp.premium)}</td>
                            </tr>
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}

                  {/* Render preview for Health Tax */}
                  {selectedReport === 'health-tax' && (
                    <div className="flex flex-col gap-4">
                      {/* Gitpaid style headers */}
                      <div className="flex flex-col md:flex-row justify-between border-b border-outline-variant pb-2 mb-2">
                        <div>
                          <p className="text-sm font-bold text-primary">{reportData.companyName}</p>
                          <p className="text-xs font-semibold text-on-surface-variant font-bold">Provincial Health Tax Report (Ontario EHT)</p>
                        </div>
                        <div className="text-right mt-2 md:mt-0">
                          <p className="text-[10px] text-on-surface-variant font-bold">Tax Year:</p>
                          <p className="text-xs font-bold text-secondary">{reportData.year}</p>
                        </div>
                      </div>

                      <table className="w-full border-collapse">
                        <thead>
                          <tr className="border-b border-outline text-[10px] font-bold text-on-surface-variant uppercase text-left bg-surface-container-low">
                            <th className="py-2 px-3">Province</th>
                            <th className="py-2 px-3 text-right">YTD Payroll (Gross)</th>
                            <th className="py-2 px-3 text-right">YTD Health Tax Accrued</th>
                          </tr>
                        </thead>
                        <tbody className="font-semibold">
                          <tr className="border-b border-outline-variant hover:bg-surface-container-low/20 transition-colors">
                            <td className="py-3 px-3 text-primary font-bold text-left">Ontario (EHT)</td>
                            <td className="py-3 px-3 text-right">{formatCurrency(reportData.ytdPayroll)}</td>
                            <td className="py-3 px-3 text-right text-secondary">{formatCurrency(reportData.ytdTaxAccrued)}</td>
                          </tr>
                          <tr className="font-bold text-sm bg-surface-container-low">
                            <td className="py-3 px-3 text-left">Total</td>
                            <td className="py-3 px-3 text-right border-t border-b border-primary">{formatCurrency(reportData.ytdPayroll)}</td>
                            <td className="py-3 px-3 text-right border-t border-b border-primary text-primary">{formatCurrency(reportData.ytdTaxAccrued)}</td>
                          </tr>
                        </tbody>
                      </table>
                    </div>
                  )}

                  {/* Render preview for Deductions & Expenses Summary */}
                  {selectedReport === 'deductions-expenses' && (
                    <div className="flex flex-col gap-4">
                      {/* Gitpaid style headers */}
                      <div className="flex flex-col md:flex-row justify-between border-b border-outline-variant pb-2 mb-2">
                        <div>
                          <p className="text-sm font-bold text-primary">{reportData.companyName}</p>
                          <p className="text-xs font-semibold text-on-surface-variant font-bold">Deductions &amp; expenses summary</p>
                        </div>
                        <div className="text-right mt-2 md:mt-0">
                          <p className="text-[10px] text-on-surface-variant font-bold">Reporting range:</p>
                          <p className="text-xs font-bold text-secondary">{reportData.startDate} to {reportData.endDate}</p>
                        </div>
                      </div>

                      <table className="w-full border-collapse">
                        <thead>
                          <tr className="border-b border-outline text-[10px] font-bold text-on-surface-variant uppercase text-left bg-surface-container-low">
                            <th className="py-2 px-3">Deductions &amp; expenses</th>
                            <th className="py-2 px-3 text-right">Employee</th>
                            <th className="py-2 px-3 text-right">Employer</th>
                            <th className="py-2 px-3 text-right">Total</th>
                            <th className="py-2 px-3 text-right">No. of employees</th>
                          </tr>
                        </thead>
                        <tbody className="font-semibold">
                          <tr className="bg-surface-container-lowest font-bold text-primary border-b border-outline-variant">
                            <td colSpan={5} className="py-2 px-3 text-left">Statutory</td>
                          </tr>
                          {reportData.rows?.map((row: any, idx: number) => (
                            <tr key={idx} className="border-b border-outline-variant hover:bg-surface-container-low/20 transition-colors font-medium">
                              <td className="py-2 px-3 pl-6 text-left">{row.name}</td>
                              <td className="py-2 px-3 text-right">{formatCurrency(row.employee)}</td>
                              <td className="py-2 px-3 text-right">{formatCurrency(row.employer)}</td>
                              <td className="py-2 px-3 text-right">{formatCurrency(row.total)}</td>
                              <td className="py-2 px-3 text-right text-on-surface-variant">{row.employeeCount}</td>
                            </tr>
                          ))}
                          <tr className="font-bold text-sm bg-surface-container-low border-t border-primary">
                            <td className="py-2 px-3 text-left">Statutory total</td>
                            <td className="py-2 px-3 text-right">{formatCurrency(reportData.totals?.employee)}</td>
                            <td className="py-2 px-3 text-right">{formatCurrency(reportData.totals?.employer)}</td>
                            <td className="py-2 px-3 text-right">{formatCurrency(reportData.totals?.total)}</td>
                            <td className="py-2 px-3 text-right text-primary">{reportData.totals?.employeeCount}</td>
                          </tr>
                          <tr className="font-bold text-sm bg-surface-container-low border-b-4 border-double border-primary">
                            <td className="py-3 px-3 text-left">Grand Total</td>
                            <td className="py-3 px-3 text-right">{formatCurrency(reportData.totals?.employee)}</td>
                            <td className="py-3 px-3 text-right">{formatCurrency(reportData.totals?.employer)}</td>
                            <td className="py-3 px-3 text-right text-primary">{formatCurrency(reportData.totals?.total)}</td>
                            <td className="py-3 px-3 text-right text-primary">{reportData.totals?.employeeCount}</td>
                          </tr>
                        </tbody>
                      </table>
                    </div>
                  )}

                  {/* Render preview for Employee Information */}
                  {selectedReport === 'employee-information' && (
                    <div className="flex flex-col gap-6">
                      {/* Gitpaid style headers */}
                      <div className="flex flex-col md:flex-row justify-between border-b border-outline-variant pb-2 mb-2">
                        <div>
                          <p className="text-sm font-bold text-primary">{reportData.companyName}</p>
                          <p className="text-xs font-semibold text-on-surface-variant font-bold">Employee Information Report</p>
                        </div>
                        {reportData.startDate && reportData.endDate && (
                          <div className="text-right mt-2 md:mt-0">
                            <p className="text-[10px] text-on-surface-variant font-bold">Reporting range:</p>
                            <p className="text-xs font-bold text-secondary">{reportData.startDate} to {reportData.endDate}</p>
                          </div>
                        )}
                      </div>

                      {reportData.groups?.map((group: any, groupIdx: number) => (
                        <div key={groupIdx} className="flex flex-col gap-2 border border-outline-variant rounded-xl p-4 bg-surface-container-lowest">
                          <h4 className="font-bold text-primary border-b border-outline-variant pb-1 flex items-center justify-between">
                            <span>Pay Group: {group.payGroupName}</span>
                            <span className="text-[10px] bg-secondary/10 text-secondary border border-secondary/20 px-1.5 py-0.5 rounded font-semibold uppercase">
                              {group.employees?.length || 0} Employees
                            </span>
                          </h4>
                          <div className="overflow-x-auto w-full">
                            <table className="w-full text-left border-collapse min-w-[1000px]">
                              <thead>
                                <tr className="text-[10px] font-bold text-on-surface-variant uppercase border-b border-outline bg-surface-container-low">
                                  <th className="py-2 px-3">Employee</th>
                                  <th className="py-2 px-3">SIN</th>
                                  <th className="py-2 px-3">Birth date</th>
                                  <th className="py-2 px-3">Start date</th>
                                  <th className="py-2 px-3">Status</th>
                                  <th className="py-2 px-3">Type</th>
                                  <th className="py-2 px-3">Phone</th>
                                  <th className="py-2 px-3">Address</th>
                                  <th className="py-2 px-3">Frequency</th>
                                  <th className="py-2 px-3 text-right">Fed. tax credit</th>
                                  <th className="py-2 px-3 text-right">Prov. tax credit</th>
                                </tr>
                              </thead>
                              <tbody className="font-medium text-[11px]">
                                {group.employees?.map((emp: any, empIdx: number) => (
                                  <tr key={empIdx} className="border-b border-outline-variant hover:bg-surface-container-low/20 transition-colors">
                                    <td className="py-2 px-3 font-bold text-primary">{emp.name}</td>
                                    <td className="py-2 px-3 text-on-surface-variant">{emp.sin}</td>
                                    <td className="py-2 px-3">{emp.birthDate}</td>
                                    <td className="py-2 px-3">{emp.startDate}</td>
                                    <td className="py-2 px-3">
                                      <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                                        emp.status === 'Active' ? 'bg-green-50 text-green-700 border border-green-200' : 'bg-zinc-100 text-zinc-600 border border-zinc-200'
                                      }`}>
                                        {emp.status}
                                      </span>
                                    </td>
                                    <td className="py-2 px-3 text-on-surface-variant">{emp.type}</td>
                                    <td className="py-2 px-3 text-on-surface-variant">{emp.phone}</td>
                                    <td className="py-2 px-3 max-w-[200px] truncate" title={emp.address}>{emp.address}</td>
                                    <td className="py-2 px-3">{emp.frequency}</td>
                                    <td className="py-2 px-3 text-right font-semibold text-secondary">{emp.fedCredit}</td>
                                    <td className="py-2 px-3 text-right font-semibold text-secondary">{emp.provCredit}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      ))}
                      <div className="text-[10px] text-on-surface-variant italic mt-2 font-medium">
                        * BPA is the basic personal amount for federal and provincial tax credits.
                      </div>
                    </div>
                  )}

                  {/* Render preview for Employee Variance */}
                  {selectedReport === 'employee-variance' && (
                    <div className="flex flex-col gap-6">
                      {/* Gitpaid style headers */}
                      <div className="flex flex-col md:flex-row justify-between border-b border-outline-variant pb-2 mb-2">
                        <div>
                          <p className="text-sm font-bold text-primary">{reportData.companyName}</p>
                          <p className="text-xs font-semibold text-on-surface-variant font-bold">Employee Variance Report</p>
                          <p className="text-[10px] text-on-surface-variant font-medium">Pay Group: {reportData.payGroup}</p>
                        </div>
                        <div className="text-right mt-2 md:mt-0">
                          <p className="text-[10px] text-on-surface-variant font-bold">Pay period range:</p>
                          <p className="text-xs font-bold text-secondary">{reportData.periodStart} to {reportData.periodEnd}</p>
                        </div>
                      </div>

                      {reportData.employees?.map((emp: any, empIdx: number) => (
                        <div key={empIdx} className="flex flex-col gap-3 border border-outline-variant rounded-xl p-4 bg-surface-container-lowest">
                          <h4 className="font-bold text-primary border-b border-outline-variant pb-1 flex items-center justify-between">
                            <span>Employee: {emp.employeeName}</span>
                            {emp.employeeCode && (
                              <span className="text-xs text-on-surface-variant font-medium">Code: {emp.employeeCode}</span>
                            )}
                          </h4>
                          <table className="w-full border-collapse">
                            <thead>
                              <tr className="border-b border-outline text-[10px] font-bold text-on-surface-variant uppercase text-left bg-surface-container-low">
                                <th className="py-2 px-3">Components</th>
                                <th className="py-2 px-3 text-right">Previous Period</th>
                                <th className="py-2 px-3 text-right">This Pay Period</th>
                                <th className="py-2 px-3 text-right">Variance</th>
                              </tr>
                            </thead>
                            <tbody>
                              {/* Earnings */}
                              <tr className="bg-surface-container-lowest font-bold text-primary border-b border-outline-variant">
                                <td colSpan={4} className="py-2 px-3 text-left">Earnings</td>
                              </tr>
                              {(emp.earnings.salary.prev > 0 || emp.earnings.salary.curr > 0) && (
                                <tr className="border-b border-outline-variant font-medium">
                                  <td className="py-2 px-3 pl-6 text-left">Salary</td>
                                  <td className="py-2 px-3 text-right">{formatCurrency(emp.earnings.salary.prev)}</td>
                                  <td className="py-2 px-3 text-right">{formatCurrency(emp.earnings.salary.curr)}</td>
                                  <td className="py-2 px-3 text-right font-bold text-secondary">{formatCurrency(emp.earnings.salary.var)}</td>
                                </tr>
                              )}
                              {(emp.earnings.hourly.prev > 0 || emp.earnings.hourly.curr > 0) && (
                                <tr className="border-b border-outline-variant font-medium">
                                  <td className="py-2 px-3 pl-6 text-left">Hourly Wages</td>
                                  <td className="py-2 px-3 text-right">{formatCurrency(emp.earnings.hourly.prev)}</td>
                                  <td className="py-2 px-3 text-right">{formatCurrency(emp.earnings.hourly.curr)}</td>
                                  <td className="py-2 px-3 text-right font-bold text-secondary">{formatCurrency(emp.earnings.hourly.var)}</td>
                                </tr>
                              )}
                              {(emp.earnings.commission.prev > 0 || emp.earnings.commission.curr > 0) && (
                                <tr className="border-b border-outline-variant font-medium">
                                  <td className="py-2 px-3 pl-6 text-left">Commission</td>
                                  <td className="py-2 px-3 text-right">{formatCurrency(emp.earnings.commission.prev)}</td>
                                  <td className="py-2 px-3 text-right">{formatCurrency(emp.earnings.commission.curr)}</td>
                                  <td className="py-2 px-3 text-right font-bold text-secondary">{formatCurrency(emp.earnings.commission.var)}</td>
                                </tr>
                              )}
                              {(emp.earnings.vacation.prev > 0 || emp.earnings.vacation.curr > 0) && (
                                <tr className="border-b border-outline-variant font-medium">
                                  <td className="py-2 px-3 pl-6 text-left">Vacation Paid Out</td>
                                  <td className="py-2 px-3 text-right">{formatCurrency(emp.earnings.vacation.prev)}</td>
                                  <td className="py-2 px-3 text-right">{formatCurrency(emp.earnings.vacation.curr)}</td>
                                  <td className="py-2 px-3 text-right font-bold text-secondary">{formatCurrency(emp.earnings.vacation.var)}</td>
                                </tr>
                              )}
                              <tr className="border-b border-outline bg-surface-container-low/20 font-bold">
                                <td className="py-2 px-3 pl-4 text-left">Total Earnings</td>
                                <td className="py-2 px-3 text-right">{formatCurrency(emp.earnings.total.prev)}</td>
                                <td className="py-2 px-3 text-right">{formatCurrency(emp.earnings.total.curr)}</td>
                                <td className="py-2 px-3 text-right text-secondary">{formatCurrency(emp.earnings.total.var)}</td>
                              </tr>

                              {/* Tax */}
                              <tr className="bg-surface-container-lowest font-bold text-primary border-b border-outline-variant mt-2">
                                <td colSpan={4} className="py-2 px-3 text-left">Tax</td>
                              </tr>
                              <tr className="border-b border-outline-variant font-medium">
                                <td className="py-2 px-3 pl-6 text-left">CPP (employee contribution)</td>
                                <td className="py-2 px-3 text-right">{formatCurrency(emp.tax.cpp.prev)}</td>
                                <td className="py-2 px-3 text-right">{formatCurrency(emp.tax.cpp.curr)}</td>
                                <td className="py-2 px-3 text-right font-bold text-secondary">{formatCurrency(emp.tax.cpp.var)}</td>
                              </tr>
                              <tr className="border-b border-outline-variant font-medium">
                                <td className="py-2 px-3 pl-6 text-left">Federal income tax</td>
                                <td className="py-2 px-3 text-right">{formatCurrency(emp.tax.fedTax.prev)}</td>
                                <td className="py-2 px-3 text-right">{formatCurrency(emp.tax.fedTax.curr)}</td>
                                <td className="py-2 px-3 text-right font-bold text-secondary">{formatCurrency(emp.tax.fedTax.var)}</td>
                              </tr>
                              <tr className="border-b border-outline-variant font-medium">
                                <td className="py-2 px-3 pl-6 text-left">Ontario component of FIT</td>
                                <td className="py-2 px-3 text-right">{formatCurrency(emp.tax.provTax.prev)}</td>
                                <td className="py-2 px-3 text-right">{formatCurrency(emp.tax.provTax.curr)}</td>
                                <td className="py-2 px-3 text-right font-bold text-secondary">{formatCurrency(emp.tax.provTax.var)}</td>
                              </tr>
                              <tr className="border-b border-outline bg-surface-container-low/20 font-bold">
                                <td className="py-2 px-3 pl-4 text-left">Total Tax</td>
                                <td className="py-2 px-3 text-right">{formatCurrency(emp.tax.total.prev)}</td>
                                <td className="py-2 px-3 text-right">{formatCurrency(emp.tax.total.curr)}</td>
                                <td className="py-2 px-3 text-right text-secondary">{formatCurrency(emp.tax.total.var)}</td>
                              </tr>

                              {/* Other Expenses */}
                              <tr className="bg-surface-container-lowest font-bold text-primary border-b border-outline-variant mt-2">
                                <td colSpan={4} className="py-2 px-3 text-left">Other Expenses</td>
                              </tr>
                              <tr className="border-b border-outline-variant font-medium">
                                <td className="py-2 px-3 pl-6 text-left">CPP (employer contribution)</td>
                                <td className="py-2 px-3 text-right">{formatCurrency(emp.otherExpenses.cppEmployer.prev)}</td>
                                <td className="py-2 px-3 text-right">{formatCurrency(emp.otherExpenses.cppEmployer.curr)}</td>
                                <td className="py-2 px-3 text-right font-bold text-secondary">{formatCurrency(emp.otherExpenses.cppEmployer.var)}</td>
                              </tr>
                              <tr className="border-b border-outline-variant font-medium">
                                <td className="py-2 px-3 pl-6 text-left">EI (employer contribution)</td>
                                <td className="py-2 px-3 text-right">{formatCurrency(emp.otherExpenses.eiEmployer.prev)}</td>
                                <td className="py-2 px-3 text-right">{formatCurrency(emp.otherExpenses.eiEmployer.curr)}</td>
                                <td className="py-2 px-3 text-right font-bold text-secondary">{formatCurrency(emp.otherExpenses.eiEmployer.var)}</td>
                              </tr>
                              <tr className="border-b border-outline-variant font-medium">
                                <td className="py-2 px-3 pl-6 text-left">WSIB premium</td>
                                <td className="py-2 px-3 text-right">{formatCurrency(emp.otherExpenses.wsib.prev)}</td>
                                <td className="py-2 px-3 text-right">{formatCurrency(emp.otherExpenses.wsib.curr)}</td>
                                <td className="py-2 px-3 text-right font-bold text-secondary">{formatCurrency(emp.otherExpenses.wsib.var)}</td>
                              </tr>
                              <tr className="border-b border-outline-variant font-medium">
                                <td className="py-2 px-3 pl-6 text-left">EHT premium</td>
                                <td className="py-2 px-3 text-right">{formatCurrency(emp.otherExpenses.eht.prev)}</td>
                                <td className="py-2 px-3 text-right">{formatCurrency(emp.otherExpenses.eht.curr)}</td>
                                <td className="py-2 px-3 text-right font-bold text-secondary">{formatCurrency(emp.otherExpenses.eht.var)}</td>
                              </tr>
                              <tr className="border-b border-outline bg-surface-container-low/20 font-bold">
                                <td className="py-2 px-3 pl-4 text-left">Total Other Expenses</td>
                                <td className="py-2 px-3 text-right">{formatCurrency(emp.otherExpenses.total.prev)}</td>
                                <td className="py-2 px-3 text-right">{formatCurrency(emp.otherExpenses.total.curr)}</td>
                                <td className="py-2 px-3 text-right text-secondary">{formatCurrency(emp.otherExpenses.total.var)}</td>
                              </tr>

                              {/* Other Totals */}
                              <tr className="bg-surface-container-lowest font-bold text-primary border-b border-outline-variant mt-2">
                                <td colSpan={4} className="py-2 px-3 text-left">Other Totals</td>
                              </tr>
                              <tr className="border-b border-outline-variant font-semibold">
                                <td className="py-2 px-3 pl-6 text-left">Net pay: To employee: earnings - deductions</td>
                                <td className="py-2 px-3 text-right font-bold text-secondary">{formatCurrency(emp.otherTotals.netPay.prev)}</td>
                                <td className="py-2 px-3 text-right font-bold text-secondary">{formatCurrency(emp.otherTotals.netPay.curr)}</td>
                                <td className="py-2 px-3 text-right font-bold text-primary">{formatCurrency(emp.otherTotals.netPay.var)}</td>
                              </tr>
                              <tr className="border-b border-outline bg-surface-container-low font-bold text-sm">
                                <td className="py-2.5 px-3 pl-4 text-left">Total salary cost</td>
                                <td className="py-2.5 px-3 text-right">{formatCurrency(emp.otherTotals.salaryCost.prev)}</td>
                                <td className="py-2.5 px-3 text-right">{formatCurrency(emp.otherTotals.salaryCost.curr)}</td>
                                <td className="py-2.5 px-3 text-right text-primary">{formatCurrency(emp.otherTotals.salaryCost.var)}</td>
                              </tr>
                            </tbody>
                          </table>
                        </div>
                      ))}

                      {/* Render Grand Totals at the end of the report (especially useful when employee_id = "all") */}
                      {reportData.employees?.length > 1 && (
                        <div className="flex flex-col gap-3 border border-outline rounded-xl p-4 bg-surface-container-low/40">
                          <h4 className="font-bold text-secondary border-b border-outline pb-1 text-left uppercase text-[10px] tracking-wider">
                            Grand Totals
                          </h4>
                          <table className="w-full border-collapse">
                            <thead>
                              <tr className="border-b border-outline text-[10px] font-bold text-on-surface-variant uppercase text-left bg-surface-container-low">
                                <th className="py-2 px-3">Component Summary</th>
                                <th className="py-2 px-3 text-right">Previous Period</th>
                                <th className="py-2 px-3 text-right">This Pay Period</th>
                                <th className="py-2 px-3 text-right">Variance</th>
                              </tr>
                            </thead>
                            <tbody className="font-bold text-xs">
                              <tr className="border-b border-outline-variant hover:bg-surface-container-low/20 transition-colors font-medium">
                                <td className="py-2.5 px-3 text-left">Total Earnings</td>
                                <td className="py-2.5 px-3 text-right">{formatCurrency(reportData.grandTotals?.prev?.earnings)}</td>
                                <td className="py-2.5 px-3 text-right">{formatCurrency(reportData.grandTotals?.curr?.earnings)}</td>
                                <td className="py-2.5 px-3 text-right text-secondary">{formatCurrency(reportData.grandTotals?.var?.earnings)}</td>
                              </tr>
                              <tr className="border-b border-outline-variant hover:bg-surface-container-low/20 transition-colors font-medium">
                                <td className="py-2.5 px-3 text-left">Total Tax</td>
                                <td className="py-2.5 px-3 text-right">{formatCurrency(reportData.grandTotals?.prev?.taxTotal)}</td>
                                <td className="py-2.5 px-3 text-right">{formatCurrency(reportData.grandTotals?.curr?.taxTotal)}</td>
                                <td className="py-2.5 px-3 text-right text-secondary">{formatCurrency(reportData.grandTotals?.var?.taxTotal)}</td>
                              </tr>
                              <tr className="border-b border-outline-variant hover:bg-surface-container-low/20 transition-colors font-medium">
                                <td className="py-2.5 px-3 text-left">Total Other Expenses</td>
                                <td className="py-2.5 px-3 text-right">{formatCurrency(reportData.grandTotals?.prev?.otherExpTotal)}</td>
                                <td className="py-2.5 px-3 text-right">{formatCurrency(reportData.grandTotals?.curr?.otherExpTotal)}</td>
                                <td className="py-2.5 px-3 text-right text-secondary">{formatCurrency(reportData.grandTotals?.var?.otherExpTotal)}</td>
                              </tr>
                              <tr className="border-b border-outline-variant hover:bg-surface-container-low/20 transition-colors text-sm text-secondary">
                                <td className="py-2.5 px-3 text-left">Net Pay</td>
                                <td className="py-2.5 px-3 text-right">{formatCurrency(reportData.grandTotals?.prev?.netPay)}</td>
                                <td className="py-2.5 px-3 text-right">{formatCurrency(reportData.grandTotals?.curr?.netPay)}</td>
                                <td className="py-2.5 px-3 text-right text-primary">{formatCurrency(reportData.grandTotals?.var?.netPay)}</td>
                              </tr>
                              <tr className="bg-surface-container-low font-bold text-sm border-t border-b-4 border-double border-primary text-primary">
                                <td className="py-3 px-3 text-left">Total Salary Cost</td>
                                <td className="py-3 px-3 text-right">{formatCurrency(reportData.grandTotals?.prev?.salaryCost)}</td>
                                <td className="py-3 px-3 text-right">{formatCurrency(reportData.grandTotals?.curr?.salaryCost)}</td>
                                <td className="py-3 px-3 text-right">{formatCurrency(reportData.grandTotals?.var?.salaryCost)}</td>
                              </tr>
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Render preview for Payroll Detail */}
                  {selectedReport === 'payroll-detail' && (
                    <div className="flex flex-col gap-6">
                      {/* Gitpaid style headers */}
                      <div className="flex flex-col md:flex-row justify-between border-b border-outline-variant pb-2 mb-2">
                        <div>
                          <p className="text-sm font-bold text-primary">{reportData.companyName}</p>
                          <p className="text-xs font-semibold text-on-surface-variant font-bold">Payroll Detail Report</p>
                        </div>
                        <div className="text-right mt-2 md:mt-0">
                          <p className="text-[10px] text-on-surface-variant font-bold">Reporting range:</p>
                          <p className="text-xs font-bold text-secondary">{reportData.startDate} to {reportData.endDate}</p>
                        </div>
                      </div>

                      {reportData.groups?.map((group: any, groupIdx: number) => (
                        <div key={groupIdx} className="flex flex-col gap-3 border border-outline-variant rounded-xl p-4 bg-surface-container-lowest">
                          <h4 className="font-bold text-primary border-b border-outline-variant pb-1 flex items-center justify-between">
                            <span>Pay Group: {group.payGroupName}</span>
                          </h4>
                          <div className="overflow-x-auto w-full">
                            <table className="w-full text-left border-collapse min-w-[1000px]">
                              <thead>
                                <tr className="text-[10px] font-bold text-on-surface-variant uppercase border-b border-outline bg-surface-container-low">
                                  <th className="py-2 px-3">Pay Date</th>
                                  <th className="py-2 px-3">Details</th>
                                  <th className="py-2 px-3 text-right">Hours</th>
                                  <th className="py-2 px-3 text-right">Gross</th>
                                  <th className="py-2 px-3 text-right">CPP</th>
                                  <th className="py-2 px-3 text-right">QPP</th>
                                  <th className="py-2 px-3 text-right">EI</th>
                                  <th className="py-2 px-3 text-right">QPIP</th>
                                  <th className="py-2 px-3 text-right">Tax</th>
                                  <th className="py-2 px-3 text-right">Prov. Tax</th>
                                  <th className="py-2 px-3 text-right">Other Ded.</th>
                                  <th className="py-2 px-3 text-right">Add.</th>
                                  <th className="py-2 px-3 text-right">Net Pay</th>
                                </tr>
                              </thead>
                              <tbody className="font-medium text-[11px]">
                                {group.employees?.map((emp: any, empIdx: number) => (
                                  <React.Fragment key={empIdx}>
                                    <tr className="bg-surface-container-low/20 font-bold">
                                      <td colSpan={13} className="py-1.5 px-3 text-left text-primary">
                                        Employee: {emp.employeeName}
                                      </td>
                                    </tr>
                                    {emp.runs?.map((run: any, runIdx: number) => (
                                      <tr key={runIdx} className="border-b border-outline-variant hover:bg-surface-container-low/10 transition-colors">
                                        <td className="py-2 px-3">{run.payDate}</td>
                                        <td className="py-2 px-3 text-on-surface-variant">{run.details}</td>
                                        <td className="py-2 px-3 text-right">{run.hours > 0 ? run.hours.toFixed(2) : ''}</td>
                                        <td className="py-2 px-3 text-right">{formatCurrency(run.gross)}</td>
                                        <td className="py-2 px-3 text-right">{formatCurrency(run.cpp)}</td>
                                        <td className="py-2 px-3 text-right">{formatCurrency(run.qpp)}</td>
                                        <td className="py-2 px-3 text-right">{formatCurrency(run.ei)}</td>
                                        <td className="py-2 px-3 text-right">{formatCurrency(run.qpip)}</td>
                                        <td className="py-2 px-3 text-right">{formatCurrency(run.tax)}</td>
                                        <td className="py-2 px-3 text-right">{formatCurrency(run.provTax)}</td>
                                        <td className="py-2 px-3 text-right">{formatCurrency(run.otherDed)}</td>
                                        <td className="py-2 px-3 text-right">{formatCurrency(run.add)}</td>
                                        <td className="py-2 px-3 text-right font-semibold text-secondary">{formatCurrency(run.netPay)}</td>
                                      </tr>
                                    ))}
                                    <tr className="border-b border-outline-variant bg-surface-container-lowest font-semibold italic text-[10px]">
                                      <td colSpan={2} className="py-1.5 px-3 text-left pl-6">
                                        Subtotal for {emp.employeeName}
                                      </td>
                                      <td className="py-1.5 px-3 text-right">{emp.subtotals.hours > 0 ? emp.subtotals.hours.toFixed(2) : ''}</td>
                                      <td className="py-1.5 px-3 text-right">{formatCurrency(emp.subtotals.gross)}</td>
                                      <td className="py-1.5 px-3 text-right">{formatCurrency(emp.subtotals.cpp)}</td>
                                      <td className="py-1.5 px-3 text-right">{formatCurrency(emp.subtotals.qpp)}</td>
                                      <td className="py-1.5 px-3 text-right">{formatCurrency(emp.subtotals.ei)}</td>
                                      <td className="py-1.5 px-3 text-right">{formatCurrency(emp.subtotals.qpip)}</td>
                                      <td className="py-1.5 px-3 text-right">{formatCurrency(emp.subtotals.tax)}</td>
                                      <td className="py-1.5 px-3 text-right">{formatCurrency(emp.subtotals.provTax)}</td>
                                      <td className="py-1.5 px-3 text-right">{formatCurrency(emp.subtotals.otherDed)}</td>
                                      <td className="py-1.5 px-3 text-right">{formatCurrency(emp.subtotals.add)}</td>
                                      <td className="py-1.5 px-3 text-right text-secondary">{formatCurrency(emp.subtotals.netPay)}</td>
                                    </tr>
                                  </React.Fragment>
                                ))}
                                <tr className="font-bold bg-surface-container-low border-t border-b-2 border-primary">
                                  <td colSpan={2} className="py-2 px-3 text-left text-primary">
                                    Total - {group.payGroupName} (Employees: {group.totals.employeeCount})
                                  </td>
                                  <td className="py-2 px-3 text-right">{group.totals.hours > 0 ? group.totals.hours.toFixed(2) : ''}</td>
                                  <td className="py-2 px-3 text-right">{formatCurrency(group.totals.gross)}</td>
                                  <td className="py-2 px-3 text-right">{formatCurrency(group.totals.cpp)}</td>
                                  <td className="py-2 px-3 text-right">{formatCurrency(group.totals.qpp)}</td>
                                  <td className="py-2 px-3 text-right">{formatCurrency(group.totals.ei)}</td>
                                  <td className="py-2 px-3 text-right">{formatCurrency(group.totals.qpip)}</td>
                                  <td className="py-2 px-3 text-right">{formatCurrency(group.totals.tax)}</td>
                                  <td className="py-2 px-3 text-right">{formatCurrency(group.totals.provTax)}</td>
                                  <td className="py-2 px-3 text-right">{formatCurrency(group.totals.otherDed)}</td>
                                  <td className="py-2 px-3 text-right">{formatCurrency(group.totals.add)}</td>
                                  <td className="py-2 px-3 text-right text-secondary">{formatCurrency(group.totals.netPay)}</td>
                                </tr>
                              </tbody>
                            </table>
                          </div>
                        </div>
                      ))}

                      {/* Grand Totals */}
                      <div className="border border-outline rounded-xl p-4 bg-surface-container-low/40">
                        <h4 className="font-bold text-primary border-b border-outline pb-1 text-left uppercase text-[10px] tracking-wider">
                          Grand Summary
                        </h4>
                        <div className="overflow-x-auto w-full">
                          <table className="w-full text-left border-collapse min-w-[1000px] text-[11px] font-bold">
                            <thead>
                              <tr className="text-[10px] font-bold text-on-surface-variant uppercase border-b border-outline bg-surface-container-low">
                                <th colSpan={2} className="py-2 px-3">Total Employees: {reportData.grandTotals?.employeeCount}</th>
                                <th className="py-2 px-3 text-right">Hours</th>
                                <th className="py-2 px-3 text-right">Gross</th>
                                <th className="py-2 px-3 text-right">CPP</th>
                                <th className="py-2 px-3 text-right">QPP</th>
                                <th className="py-2 px-3 text-right">EI</th>
                                <th className="py-2 px-3 text-right">QPIP</th>
                                <th className="py-2 px-3 text-right">Tax</th>
                                <th className="py-2 px-3 text-right">Prov. Tax</th>
                                <th className="py-2 px-3 text-right">Other Ded.</th>
                                <th className="py-2 px-3 text-right">Add.</th>
                                <th className="py-2 px-3 text-right">Net Pay</th>
                              </tr>
                            </thead>
                            <tbody>
                              <tr className="bg-surface-container-low text-primary border-t border-b-4 border-double border-primary">
                                <td colSpan={2} className="py-3 px-3 text-left">Grand Totals</td>
                                <td className="py-3 px-3 text-right">{reportData.grandTotals?.hours > 0 ? reportData.grandTotals.hours.toFixed(2) : ''}</td>
                                <td className="py-3 px-3 text-right">{formatCurrency(reportData.grandTotals?.gross)}</td>
                                <td className="py-3 px-3 text-right">{formatCurrency(reportData.grandTotals?.cpp)}</td>
                                <td className="py-3 px-3 text-right">{formatCurrency(reportData.grandTotals?.qpp)}</td>
                                <td className="py-3 px-3 text-right">{formatCurrency(reportData.grandTotals?.ei)}</td>
                                <td className="py-3 px-3 text-right">{formatCurrency(reportData.grandTotals?.qpip)}</td>
                                <td className="py-3 px-3 text-right">{formatCurrency(reportData.grandTotals?.tax)}</td>
                                <td className="py-3 px-3 text-right">{formatCurrency(reportData.grandTotals?.provTax)}</td>
                                <td className="py-3 px-3 text-right">{formatCurrency(reportData.grandTotals?.otherDed)}</td>
                                <td className="py-3 px-3 text-right">{formatCurrency(reportData.grandTotals?.add)}</td>
                                <td className="py-3 px-3 text-right text-secondary">{formatCurrency(reportData.grandTotals?.netPay)}</td>
                              </tr>
                            </tbody>
                          </table>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Render preview for Payroll Variance */}
                  {selectedReport === 'payroll-variance' && (
                    <div className="flex flex-col gap-4">
                      {/* Gitpaid style headers */}
                      <div className="flex flex-col md:flex-row justify-between border-b border-outline-variant pb-2 mb-2">
                        <div>
                          <p className="text-sm font-bold text-primary">{reportData.companyName}</p>
                          <p className="text-xs font-semibold text-on-surface-variant font-bold">Payroll Variance Report</p>
                          <p className="text-[10px] text-on-surface-variant font-medium">Pay Group: {reportData.payGroup}</p>
                        </div>
                        <div className="text-right mt-2 md:mt-0">
                          <p className="text-[10px] text-on-surface-variant font-bold">Pay period range:</p>
                          <p className="text-xs font-bold text-secondary">{reportData.periodStart} to {reportData.periodEnd}</p>
                        </div>
                      </div>

                      <table className="w-full border-collapse">
                        <thead>
                          <tr className="border-b border-outline text-[10px] font-bold text-on-surface-variant uppercase text-left bg-surface-container-low">
                            <th className="py-2 px-3">Components</th>
                            <th className="py-2 px-3 text-right">Previous Period</th>
                            <th className="py-2 px-3 text-right">This Period</th>
                            <th className="py-2 px-3 text-right">Variance</th>
                          </tr>
                        </thead>
                        <tbody>
                          {/* Earnings */}
                          <tr className="bg-surface-container-lowest font-bold text-primary border-b border-outline-variant">
                            <td colSpan={4} className="py-2 px-3 text-left">Earnings</td>
                          </tr>
                          {(reportData.totals?.prev?.salary > 0 || reportData.totals?.curr?.salary > 0) && (
                            <tr className="border-b border-outline-variant font-medium">
                              <td className="py-2 px-3 pl-6 text-left">Salary</td>
                              <td className="py-2 px-3 text-right">{formatCurrency(reportData.totals.prev.salary)}</td>
                              <td className="py-2 px-3 text-right">{formatCurrency(reportData.totals.curr.salary)}</td>
                              <td className="py-2 px-3 text-right font-bold text-secondary">{formatCurrency(reportData.totals.var.salary)}</td>
                            </tr>
                          )}
                          {(reportData.totals?.prev?.hourly > 0 || reportData.totals?.curr?.hourly > 0) && (
                            <tr className="border-b border-outline-variant font-medium">
                              <td className="py-2 px-3 pl-6 text-left">Hourly Wages</td>
                              <td className="py-2 px-3 text-right">{formatCurrency(reportData.totals.prev.hourly)}</td>
                              <td className="py-2 px-3 text-right">{formatCurrency(reportData.totals.curr.hourly)}</td>
                              <td className="py-2 px-3 text-right font-bold text-secondary">{formatCurrency(reportData.totals.var.hourly)}</td>
                            </tr>
                          )}
                          {(reportData.totals?.prev?.commission > 0 || reportData.totals?.curr?.commission > 0) && (
                            <tr className="border-b border-outline-variant font-medium">
                              <td className="py-2 px-3 pl-6 text-left">Commission</td>
                              <td className="py-2 px-3 text-right">{formatCurrency(reportData.totals.prev.commission)}</td>
                              <td className="py-2 px-3 text-right">{formatCurrency(reportData.totals.curr.commission)}</td>
                              <td className="py-2 px-3 text-right font-bold text-secondary">{formatCurrency(reportData.totals.var.commission)}</td>
                            </tr>
                          )}
                          {(reportData.totals?.prev?.vacation > 0 || reportData.totals?.curr?.vacation > 0) && (
                            <tr className="border-b border-outline-variant font-medium">
                              <td className="py-2 px-3 pl-6 text-left">Vacation Paid Out</td>
                              <td className="py-2 px-3 text-right">{formatCurrency(reportData.totals.prev.vacation)}</td>
                              <td className="py-2 px-3 text-right">{formatCurrency(reportData.totals.curr.vacation)}</td>
                              <td className="py-2 px-3 text-right font-bold text-secondary">{formatCurrency(reportData.totals.var.vacation)}</td>
                            </tr>
                          )}
                          <tr className="border-b border-outline bg-surface-container-low/20 font-bold">
                            <td className="py-2 px-3 pl-4 text-left">Total Earnings</td>
                            <td className="py-2 px-3 text-right">{formatCurrency(reportData.totals?.prev?.earningsTotal)}</td>
                            <td className="py-2 px-3 text-right">{formatCurrency(reportData.totals?.curr?.earningsTotal)}</td>
                            <td className="py-2 px-3 text-right text-secondary">{formatCurrency(reportData.totals?.var?.earningsTotal)}</td>
                          </tr>

                          {/* Tax */}
                          <tr className="bg-surface-container-lowest font-bold text-primary border-b border-outline-variant mt-2">
                            <td colSpan={4} className="py-2 px-3 text-left">Tax</td>
                          </tr>
                          <tr className="border-b border-outline-variant font-medium">
                            <td className="py-2 px-3 pl-6 text-left">CPP (employee contribution)</td>
                            <td className="py-2 px-3 text-right">{formatCurrency(reportData.totals?.prev?.cpp)}</td>
                            <td className="py-2 px-3 text-right">{formatCurrency(reportData.totals?.curr?.cpp)}</td>
                            <td className="py-2 px-3 text-right font-bold text-secondary">{formatCurrency(reportData.totals?.var?.cpp)}</td>
                          </tr>
                          <tr className="border-b border-outline-variant font-medium">
                            <td className="py-2 px-3 pl-6 text-left">Federal income tax</td>
                            <td className="py-2 px-3 text-right">{formatCurrency(reportData.totals?.prev?.fedTax)}</td>
                            <td className="py-2 px-3 text-right">{formatCurrency(reportData.totals?.curr?.fedTax)}</td>
                            <td className="py-2 px-3 text-right font-bold text-secondary">{formatCurrency(reportData.totals?.var?.fedTax)}</td>
                          </tr>
                          <tr className="border-b border-outline-variant font-medium">
                            <td className="py-2 px-3 pl-6 text-left">Ontario component of FIT</td>
                            <td className="py-2 px-3 text-right">{formatCurrency(reportData.totals?.prev?.provTax)}</td>
                            <td className="py-2 px-3 text-right">{formatCurrency(reportData.totals?.curr?.provTax)}</td>
                            <td className="py-2 px-3 text-right font-bold text-secondary">{formatCurrency(reportData.totals?.var?.provTax)}</td>
                          </tr>
                          <tr className="border-b border-outline bg-surface-container-low/20 font-bold">
                            <td className="py-2 px-3 pl-4 text-left">Total Tax</td>
                            <td className="py-2 px-3 text-right">{formatCurrency(reportData.totals?.prev?.taxTotal)}</td>
                            <td className="py-2 px-3 text-right">{formatCurrency(reportData.totals?.curr?.taxTotal)}</td>
                            <td className="py-2 px-3 text-right text-secondary">{formatCurrency(reportData.totals?.var?.taxTotal)}</td>
                          </tr>

                          {/* Other Expenses */}
                          <tr className="bg-surface-container-lowest font-bold text-primary border-b border-outline-variant mt-2">
                            <td colSpan={4} className="py-2 px-3 text-left">Other Expenses</td>
                          </tr>
                          <tr className="border-b border-outline-variant font-medium">
                            <td className="py-2 px-3 pl-6 text-left">CPP (employer contribution)</td>
                            <td className="py-2 px-3 text-right">{formatCurrency(reportData.totals?.prev?.cppEmployer)}</td>
                            <td className="py-2 px-3 text-right">{formatCurrency(reportData.totals?.curr?.cppEmployer)}</td>
                            <td className="py-2 px-3 text-right font-bold text-secondary">{formatCurrency(reportData.totals?.var?.cppEmployer)}</td>
                          </tr>
                          <tr className="border-b border-outline-variant font-medium">
                            <td className="py-2 px-3 pl-6 text-left">EI (employer contribution)</td>
                            <td className="py-2 px-3 text-right">{formatCurrency(reportData.totals?.prev?.eiEmployer)}</td>
                            <td className="py-2 px-3 text-right">{formatCurrency(reportData.totals?.curr?.eiEmployer)}</td>
                            <td className="py-2 px-3 text-right font-bold text-secondary">{formatCurrency(reportData.totals?.var?.eiEmployer)}</td>
                          </tr>
                          <tr className="border-b border-outline-variant font-medium">
                            <td className="py-2 px-3 pl-6 text-left">WSIB premium</td>
                            <td className="py-2 px-3 text-right">{formatCurrency(reportData.totals?.prev?.wsib)}</td>
                            <td className="py-2 px-3 text-right">{formatCurrency(reportData.totals?.curr?.wsib)}</td>
                            <td className="py-2 px-3 text-right font-bold text-secondary">{formatCurrency(reportData.totals?.var?.wsib)}</td>
                          </tr>
                          <tr className="border-b border-outline-variant font-medium">
                            <td className="py-2 px-3 pl-6 text-left">EHT premium</td>
                            <td className="py-2 px-3 text-right">{formatCurrency(reportData.totals?.prev?.eht)}</td>
                            <td className="py-2 px-3 text-right">{formatCurrency(reportData.totals?.curr?.eht)}</td>
                            <td className="py-2 px-3 text-right font-bold text-secondary">{formatCurrency(reportData.totals?.var?.eht)}</td>
                          </tr>
                          <tr className="border-b border-outline bg-surface-container-low/20 font-bold">
                            <td className="py-2 px-3 pl-4 text-left">Total Other Expenses</td>
                            <td className="py-2 px-3 text-right">{formatCurrency(reportData.totals?.prev?.otherExpTotal)}</td>
                            <td className="py-2 px-3 text-right">{formatCurrency(reportData.totals?.curr?.otherExpTotal)}</td>
                            <td className="py-2 px-3 text-right text-secondary">{formatCurrency(reportData.totals?.var?.otherExpTotal)}</td>
                          </tr>

                          {/* Other Totals */}
                          <tr className="bg-surface-container-lowest font-bold text-primary border-b border-outline-variant mt-2">
                            <td colSpan={4} className="py-2 px-3 text-left">Other Totals</td>
                          </tr>
                          <tr className="border-b border-outline-variant font-semibold">
                            <td className="py-2 px-3 pl-6 text-left">Net pay: To employee: earnings - deductions</td>
                            <td className="py-2 px-3 text-right font-bold text-secondary">{formatCurrency(reportData.totals?.prev?.netPay)}</td>
                            <td className="py-2 px-3 text-right font-bold text-secondary">{formatCurrency(reportData.totals?.curr?.netPay)}</td>
                            <td className="py-2 px-3 text-right font-bold text-primary">{formatCurrency(reportData.totals?.var?.netPay)}</td>
                          </tr>
                          <tr className="border-b border-outline bg-surface-container-low font-bold text-sm">
                            <td className="py-2.5 px-3 pl-4 text-left">Total salary cost</td>
                            <td className="py-2.5 px-3 text-right">{formatCurrency(reportData.totals?.prev?.salaryCost)}</td>
                            <td className="py-2.5 px-3 text-right">{formatCurrency(reportData.totals?.curr?.salaryCost)}</td>
                            <td className="py-2.5 px-3 text-right text-primary">{formatCurrency(reportData.totals?.var?.salaryCost)}</td>
                          </tr>
                        </tbody>
                      </table>
                    </div>
                  )}

                  {/* Render preview for Year to Date Detail */}
                  {selectedReport === 'ytd-detail' && (
                    <div className="flex flex-col gap-8 text-left">
                      {/* Gitpaid style headers */}
                      <div className="flex flex-col md:flex-row justify-between border-b border-outline-variant pb-3 mb-2">
                        <div>
                          <p className="text-sm font-bold text-primary">{reportData.companyName}</p>
                          <p className="text-xs font-semibold text-on-surface-variant font-bold">Year to Date Detail Report</p>
                        </div>
                        <div className="text-right mt-2 md:mt-0 flex flex-col gap-1 text-[10px] text-on-surface-variant font-bold">
                          <div>Tax Year: <span className="text-secondary">{reportData.year}</span></div>
                          <div>Pay Group: <span className="text-secondary">{reportData.payGroupSelection}</span></div>
                          <div>Employee Selection: <span className="text-secondary">{reportData.employeeSelection}</span></div>
                        </div>
                      </div>

                      {/* Employee detail sheets */}
                      {reportData.employees?.map((emp: any) => (
                        <div key={emp.employeeId} className="flex flex-col gap-3 border border-outline-variant rounded-xl p-4 bg-surface-container-lowest shadow-sm">
                          <div className="flex flex-wrap justify-between items-center border-b border-outline-variant pb-2 font-bold text-primary text-xs gap-2">
                            <span>Employee: {emp.employeeName}</span>
                            <div className="flex gap-4 text-[10px] font-medium text-on-surface-variant">
                              <span>Code: {emp.employeeCode}</span>
                              <span>Start Date: {emp.startDate}</span>
                            </div>
                          </div>
                          <div className="overflow-x-auto w-full">
                            <table className="w-full text-left border-collapse min-w-[1000px] text-[11px]">
                              <thead>
                                <tr className="text-[10px] font-bold text-on-surface-variant uppercase border-b border-outline bg-surface-container-low">
                                  <th className="py-2 px-3 w-[180px]">Pay component</th>
                                  {['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'].map(m => (
                                    <th key={m} className="py-2 px-1.5 text-right w-[60px]">{m}</th>
                                  ))}
                                  <th className="py-2 px-3 text-right w-[80px]">Total</th>
                                </tr>
                              </thead>
                              <tbody>
                                {/* Earnings */}
                                <tr className="bg-surface-container-lowest font-bold text-primary border-b border-outline-variant">
                                  <td colSpan={14} className="py-1.5 px-3 text-left font-bold">Earnings</td>
                                </tr>
                                {emp.earnings?.map((row: any, idx: number) => (
                                  <tr key={idx} className="border-b border-outline-variant hover:bg-surface-container-low/10 transition-colors font-medium">
                                    <td className="py-1.5 px-3 pl-6 text-left text-on-surface-variant">{row.name}</td>
                                    {row.monthly.map((val: number, m: number) => (
                                      <td key={m} className="py-1.5 px-1.5 text-right">{formatCurrency(val)}</td>
                                    ))}
                                    <td className="py-1.5 px-3 text-right font-bold text-secondary">{formatCurrency(row.total)}</td>
                                  </tr>
                                ))}
                                <tr className="border-b border-outline bg-surface-container-low/20 font-bold">
                                  <td className="py-1.5 px-4 text-left">Total earnings</td>
                                  {emp.earningsTotal.monthly.map((val: number, m: number) => (
                                    <td key={m} className="py-1.5 px-1.5 text-right">{formatCurrency(val)}</td>
                                  ))}
                                  <td className="py-1.5 px-3 text-right text-secondary">{formatCurrency(emp.earningsTotal.total)}</td>
                                </tr>

                                {/* Tax */}
                                <tr className="bg-surface-container-lowest font-bold text-primary border-b border-outline-variant">
                                  <td colSpan={14} className="py-1.5 px-3 text-left font-bold">Tax</td>
                                </tr>
                                {emp.tax?.map((row: any, idx: number) => (
                                  <tr key={idx} className="border-b border-outline-variant hover:bg-surface-container-low/10 transition-colors font-medium">
                                    <td className="py-1.5 px-3 pl-6 text-left text-on-surface-variant">{row.name}</td>
                                    {row.monthly.map((val: number, m: number) => (
                                      <td key={m} className="py-1.5 px-1.5 text-right">{formatCurrency(val)}</td>
                                    ))}
                                    <td className="py-1.5 px-3 text-right font-bold text-secondary">{formatCurrency(row.total)}</td>
                                  </tr>
                                ))}
                                <tr className="border-b border-outline bg-surface-container-low/20 font-bold">
                                  <td className="py-1.5 px-4 text-left">Total tax</td>
                                  {emp.taxTotal.monthly.map((val: number, m: number) => (
                                    <td key={m} className="py-1.5 px-1.5 text-right">{formatCurrency(val)}</td>
                                  ))}
                                  <td className="py-1.5 px-3 text-right text-secondary">{formatCurrency(emp.taxTotal.total)}</td>
                                </tr>

                                {/* Other Expenses */}
                                <tr className="bg-surface-container-lowest font-bold text-primary border-b border-outline-variant">
                                  <td colSpan={14} className="py-1.5 px-3 text-left font-bold">Other expenses</td>
                                </tr>
                                {emp.otherExpenses?.map((row: any, idx: number) => (
                                  <tr key={idx} className="border-b border-outline-variant hover:bg-surface-container-low/10 transition-colors font-medium">
                                    <td className="py-1.5 px-3 pl-6 text-left text-on-surface-variant">{row.name}</td>
                                    {row.monthly.map((val: number, m: number) => (
                                      <td key={m} className="py-1.5 px-1.5 text-right">{formatCurrency(val)}</td>
                                    ))}
                                    <td className="py-1.5 px-3 text-right font-bold text-secondary">{formatCurrency(row.total)}</td>
                                  </tr>
                                ))}
                                <tr className="border-b border-outline bg-surface-container-low/20 font-bold">
                                  <td className="py-1.5 px-4 text-left">Total other expenses</td>
                                  {emp.otherExpensesTotal.monthly.map((val: number, m: number) => (
                                    <td key={m} className="py-1.5 px-1.5 text-right">{formatCurrency(val)}</td>
                                  ))}
                                  <td className="py-1.5 px-3 text-right text-secondary">{formatCurrency(emp.otherExpensesTotal.total)}</td>
                                </tr>

                                {/* Other Totals */}
                                <tr className="bg-surface-container-lowest font-bold text-primary border-b border-outline-variant">
                                  <td colSpan={14} className="py-1.5 px-3 text-left font-bold">Other totals</td>
                                </tr>
                                <tr className="border-b border-outline-variant hover:bg-surface-container-low/10 transition-colors font-semibold">
                                  <td className="py-1.5 px-6 text-left text-on-surface">{emp.netPay.name}</td>
                                  {emp.netPay.monthly.map((val: number, m: number) => (
                                    <td key={m} className="py-1.5 px-1.5 text-right">{formatCurrency(val)}</td>
                                  ))}
                                  <td className="py-1.5 px-3 text-right text-primary font-bold">{formatCurrency(emp.netPay.total)}</td>
                                </tr>
                                <tr className="bg-surface-container-low font-bold text-xs border-t border-b-4 border-double border-primary text-primary">
                                  <td className="py-2.5 px-4 text-left">{emp.salaryCost.name}</td>
                                  {emp.salaryCost.monthly.map((val: number, m: number) => (
                                    <td key={m} className="py-2.5 px-1.5 text-right">{formatCurrency(val)}</td>
                                  ))}
                                  <td className="py-2.5 px-3 text-right">{formatCurrency(emp.salaryCost.total)}</td>
                                </tr>
                              </tbody>
                            </table>
                          </div>
                        </div>
                      ))}

                      {/* Pay Group Totals */}
                      {reportData.payGroupTotals?.map((pg: any, pgIdx: number) => (
                        <div key={pgIdx} className="flex flex-col gap-3 border border-outline-variant rounded-xl p-4 bg-surface-container-low/30 shadow-sm">
                          <div className="border-b border-outline pb-2 font-bold text-secondary text-xs text-left uppercase">
                            Pay Group Total: {pg.payGroupName}
                          </div>
                          <div className="overflow-x-auto w-full">
                            <table className="w-full text-left border-collapse min-w-[1000px] text-[11px]">
                              <thead>
                                <tr className="text-[10px] font-bold text-on-surface-variant uppercase border-b border-outline bg-surface-container-low">
                                  <th className="py-2 px-3 w-[180px]">Pay component</th>
                                  {['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'].map(m => (
                                    <th key={m} className="py-2 px-1.5 text-right w-[60px]">{m}</th>
                                  ))}
                                  <th className="py-2 px-3 text-right w-[80px]">Total</th>
                                </tr>
                              </thead>
                              <tbody>
                                <tr className="bg-surface-container-lowest font-bold text-primary border-b border-outline-variant">
                                  <td colSpan={14} className="py-1.5 px-3 text-left font-bold">Earnings</td>
                                </tr>
                                {pg.earnings?.map((row: any, idx: number) => (
                                  <tr key={idx} className="border-b border-outline-variant hover:bg-surface-container-low/10 transition-colors font-medium">
                                    <td className="py-1.5 px-3 pl-6 text-left text-on-surface-variant">{row.name}</td>
                                    {row.monthly.map((val: number, m: number) => (
                                      <td key={m} className="py-1.5 px-1.5 text-right">{formatCurrency(val)}</td>
                                    ))}
                                    <td className="py-1.5 px-3 text-right font-bold text-secondary">{formatCurrency(row.total)}</td>
                                  </tr>
                                ))}
                                <tr className="border-b border-outline bg-surface-container-low/20 font-bold">
                                  <td className="py-1.5 px-4 text-left">Total earnings</td>
                                  {pg.earningsTotal.monthly.map((val: number, m: number) => (
                                    <td key={m} className="py-1.5 px-1.5 text-right">{formatCurrency(val)}</td>
                                  ))}
                                  <td className="py-1.5 px-3 text-right text-secondary">{formatCurrency(pg.earningsTotal.total)}</td>
                                </tr>

                                <tr className="bg-surface-container-lowest font-bold text-primary border-b border-outline-variant">
                                  <td colSpan={14} className="py-1.5 px-3 text-left font-bold">Tax</td>
                                </tr>
                                {pg.tax?.map((row: any, idx: number) => (
                                  <tr key={idx} className="border-b border-outline-variant hover:bg-surface-container-low/10 transition-colors font-medium">
                                    <td className="py-1.5 px-3 pl-6 text-left text-on-surface-variant">{row.name}</td>
                                    {row.monthly.map((val: number, m: number) => (
                                      <td key={m} className="py-1.5 px-1.5 text-right">{formatCurrency(val)}</td>
                                    ))}
                                    <td className="py-1.5 px-3 text-right font-bold text-secondary">{formatCurrency(row.total)}</td>
                                  </tr>
                                ))}
                                <tr className="border-b border-outline bg-surface-container-low/20 font-bold">
                                  <td className="py-1.5 px-4 text-left">Total tax</td>
                                  {pg.taxTotal.monthly.map((val: number, m: number) => (
                                    <td key={m} className="py-1.5 px-1.5 text-right">{formatCurrency(val)}</td>
                                  ))}
                                  <td className="py-1.5 px-3 text-right text-secondary">{formatCurrency(pg.taxTotal.total)}</td>
                                </tr>

                                <tr className="bg-surface-container-lowest font-bold text-primary border-b border-outline-variant">
                                  <td colSpan={14} className="py-1.5 px-3 text-left font-bold">Other expenses</td>
                                </tr>
                                {pg.otherExpenses?.map((row: any, idx: number) => (
                                  <tr key={idx} className="border-b border-outline-variant hover:bg-surface-container-low/10 transition-colors font-medium">
                                    <td className="py-1.5 px-3 pl-6 text-left text-on-surface-variant">{row.name}</td>
                                    {row.monthly.map((val: number, m: number) => (
                                      <td key={m} className="py-1.5 px-1.5 text-right">{formatCurrency(val)}</td>
                                    ))}
                                    <td className="py-1.5 px-3 text-right font-bold text-secondary">{formatCurrency(row.total)}</td>
                                  </tr>
                                ))}
                                <tr className="border-b border-outline bg-surface-container-low/20 font-bold">
                                  <td className="py-1.5 px-4 text-left">Total other expenses</td>
                                  {pg.otherExpensesTotal.monthly.map((val: number, m: number) => (
                                    <td key={m} className="py-1.5 px-1.5 text-right">{formatCurrency(val)}</td>
                                  ))}
                                  <td className="py-1.5 px-3 text-right text-secondary">{formatCurrency(pg.otherExpensesTotal.total)}</td>
                                </tr>

                                <tr className="bg-surface-container-lowest font-bold text-primary border-b border-outline-variant">
                                  <td colSpan={14} className="py-1.5 px-3 text-left font-bold">Other totals</td>
                                </tr>
                                <tr className="border-b border-outline-variant hover:bg-surface-container-low/10 transition-colors font-semibold">
                                  <td className="py-1.5 px-6 text-left text-on-surface">{pg.netPay.name}</td>
                                  {pg.netPay.monthly.map((val: number, m: number) => (
                                    <td key={m} className="py-1.5 px-1.5 text-right">{formatCurrency(val)}</td>
                                  ))}
                                  <td className="py-1.5 px-3 text-right text-primary font-bold">{formatCurrency(pg.netPay.total)}</td>
                                </tr>
                                <tr className="bg-surface-container-low font-bold text-xs border-t border-b-4 border-double border-primary text-primary">
                                  <td className="py-2.5 px-4 text-left">{pg.salaryCost.name}</td>
                                  {pg.salaryCost.monthly.map((val: number, m: number) => (
                                    <td key={m} className="py-2.5 px-1.5 text-right">{formatCurrency(val)}</td>
                                  ))}
                                  <td className="py-2.5 px-3 text-right">{formatCurrency(pg.salaryCost.total)}</td>
                                </tr>
                              </tbody>
                            </table>
                          </div>
                        </div>
                      ))}

                      {/* Report Totals Summary Card */}
                      {reportData.employees?.length > 1 && (
                        <div className="flex flex-col gap-3 border border-outline rounded-xl p-4 bg-surface-container-low/60 shadow-sm">
                          <div className="border-b border-outline pb-2 font-bold text-primary text-xs text-left uppercase">
                            Report Totals
                          </div>
                          <div className="overflow-x-auto w-full">
                            <table className="w-full text-left border-collapse min-w-[1000px] text-[11px]">
                              <thead>
                                <tr className="text-[10px] font-bold text-on-surface-variant uppercase border-b border-outline bg-surface-container-low">
                                  <th className="py-2 px-3 w-[180px]">Pay component</th>
                                  {['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'].map(m => (
                                    <th key={m} className="py-2 px-1.5 text-right w-[60px]">{m}</th>
                                  ))}
                                  <th className="py-2 px-3 text-right w-[80px]">Total</th>
                                </tr>
                              </thead>
                              <tbody>
                                <tr className="bg-surface-container-lowest font-bold text-primary border-b border-outline-variant">
                                  <td colSpan={14} className="py-1 px-3 text-left font-bold">Earnings</td>
                                </tr>
                                {reportData.reportTotals.earnings?.map((row: any, idx: number) => (
                                  <tr key={idx} className="border-b border-outline-variant hover:bg-surface-container-low/10 transition-colors font-medium">
                                    <td className="py-1.5 px-3 pl-6 text-left text-on-surface-variant">{row.name}</td>
                                    {row.monthly.map((val: number, m: number) => (
                                      <td key={m} className="py-1.5 px-1.5 text-right">{formatCurrency(val)}</td>
                                    ))}
                                    <td className="py-1.5 px-3 text-right font-bold text-secondary">{formatCurrency(row.total)}</td>
                                  </tr>
                                ))}
                                <tr className="border-b border-outline bg-surface-container-low/20 font-bold">
                                  <td className="py-1.5 px-4 text-left">Total earnings</td>
                                  {reportData.reportTotals.earningsTotal.monthly.map((val: number, m: number) => (
                                    <td key={m} className="py-1.5 px-1.5 text-right">{formatCurrency(val)}</td>
                                  ))}
                                  <td className="py-1.5 px-3 text-right text-secondary">{formatCurrency(reportData.reportTotals.earningsTotal.total)}</td>
                                </tr>

                                <tr className="bg-surface-container-lowest font-bold text-primary border-b border-outline-variant">
                                  <td colSpan={14} className="py-1.5 px-3 text-left font-bold">Tax</td>
                                </tr>
                                {reportData.reportTotals.tax?.map((row: any, idx: number) => (
                                  <tr key={idx} className="border-b border-outline-variant hover:bg-surface-container-low/10 transition-colors font-medium">
                                    <td className="py-1.5 px-3 pl-6 text-left text-on-surface-variant">{row.name}</td>
                                    {row.monthly.map((val: number, m: number) => (
                                      <td key={m} className="py-1.5 px-1.5 text-right">{formatCurrency(val)}</td>
                                    ))}
                                    <td className="py-1.5 px-3 text-right font-bold text-secondary">{formatCurrency(row.total)}</td>
                                  </tr>
                                ))}
                                <tr className="border-b border-outline bg-surface-container-low/20 font-bold">
                                  <td className="py-1.5 px-4 text-left">Total tax</td>
                                  {reportData.reportTotals.taxTotal.monthly.map((val: number, m: number) => (
                                    <td key={m} className="py-1.5 px-1.5 text-right">{formatCurrency(val)}</td>
                                  ))}
                                  <td className="py-1.5 px-3 text-right text-secondary">{formatCurrency(reportData.reportTotals.taxTotal.total)}</td>
                                </tr>

                                <tr className="bg-surface-container-lowest font-bold text-primary border-b border-outline-variant">
                                  <td colSpan={14} className="py-1.5 px-3 text-left font-bold">Other expenses</td>
                                </tr>
                                {reportData.reportTotals.otherExpenses?.map((row: any, idx: number) => (
                                  <tr key={idx} className="border-b border-outline-variant hover:bg-surface-container-low/10 transition-colors font-medium">
                                    <td className="py-1.5 px-3 pl-6 text-left text-on-surface-variant">{row.name}</td>
                                    {row.monthly.map((val: number, m: number) => (
                                      <td key={m} className="py-1.5 px-1.5 text-right">{formatCurrency(val)}</td>
                                    ))}
                                    <td className="py-1.5 px-3 text-right font-bold text-secondary">{formatCurrency(row.total)}</td>
                                  </tr>
                                ))}
                                <tr className="border-b border-outline bg-surface-container-low/20 font-bold">
                                  <td className="py-1.5 px-4 text-left">Total other expenses</td>
                                  {reportData.reportTotals.otherExpensesTotal.monthly.map((val: number, m: number) => (
                                    <td key={m} className="py-1.5 px-1.5 text-right">{formatCurrency(val)}</td>
                                  ))}
                                  <td className="py-1.5 px-3 text-right text-secondary">{formatCurrency(reportData.reportTotals.otherExpensesTotal.total)}</td>
                                </tr>

                                <tr className="bg-surface-container-lowest font-bold text-primary border-b border-outline-variant">
                                  <td colSpan={14} className="py-1.5 px-3 text-left font-bold">Other totals</td>
                                </tr>
                                <tr className="border-b border-outline-variant hover:bg-surface-container-low/10 transition-colors font-semibold">
                                  <td className="py-1.5 px-6 text-left text-on-surface">{reportData.reportTotals.netPay.name}</td>
                                  {reportData.reportTotals.netPay.monthly.map((val: number, m: number) => (
                                    <td key={m} className="py-1.5 px-1.5 text-right">{formatCurrency(val)}</td>
                                  ))}
                                  <td className="py-1.5 px-3 text-right text-primary font-bold">{formatCurrency(reportData.reportTotals.netPay.total)}</td>
                                </tr>
                                <tr className="bg-surface-container-low font-bold text-xs border-t border-b-4 border-double border-primary text-primary">
                                  <td className="py-2.5 px-4 text-left">{reportData.reportTotals.salaryCost.name}</td>
                                  {reportData.reportTotals.salaryCost.monthly.map((val: number, m: number) => (
                                    <td key={m} className="py-2.5 px-1.5 text-right">{formatCurrency(val)}</td>
                                  ))}
                                  <td className="py-2.5 px-3 text-right">{formatCurrency(reportData.reportTotals.salaryCost.total)}</td>
                                </tr>
                              </tbody>
                            </table>
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ) : (
                <div className="flex-1 flex flex-col items-center justify-center p-8 text-center text-on-surface-variant gap-2 h-48 bg-surface-container-low/20 border border-dashed border-outline rounded-xl">
                  <span className="material-symbols-outlined text-4xl text-on-surface-variant">report</span>
                  <div>
                    <p className="font-bold text-on-surface text-sm">No Preview Generated</p>
                    <p className="text-xs text-on-surface-variant mt-1">
                      Configure the filters above and click **Preview** to display the HTML report content here.
                    </p>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

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

