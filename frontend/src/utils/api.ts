import type { CompanySettings, Employee, PayrollRun } from '../types';

export const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:5001/api';

async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const token = localStorage.getItem('token');
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options?.headers as Record<string, string> || {})
  };
  
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const res = await fetch(`${API_BASE}${url}`, {
    ...options,
    headers,
  });
  if (!res.ok) {
    if (res.status === 401) {
      window.dispatchEvent(new CustomEvent('auth-unauthorized'));
    }
    const err = await res.json().catch(() => ({ error: 'An unknown error occurred' }));
    throw new Error(err.error || `HTTP error ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export const api = {
  // Download file helper (with authentication)
  downloadFile: async (url: string): Promise<Blob> => {
    const token = localStorage.getItem('token');
    const headers: Record<string, string> = {};
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }
    const res = await fetch(url, { headers });
    if (!res.ok) {
      if (res.status === 401) {
        window.dispatchEvent(new CustomEvent('auth-unauthorized'));
      }
      throw new Error(`HTTP error ${res.status}`);
    }
    return res.blob();
  },

  // Settings
  getSettings: () => request<CompanySettings>('/settings'),
  updateSettings: (settings: Partial<CompanySettings>) => 
    request<CompanySettings>('/settings', { method: 'PUT', body: JSON.stringify(settings) }),

  // Employees
  getEmployees: () => request<Employee[]>('/employees'),
  getEmployee: (id: number) => request<Employee>(`/employees/${id}`),
  createEmployee: (employee: Partial<Employee>) => 
    request<Employee>('/employees', { method: 'POST', body: JSON.stringify(employee) }),
  updateEmployee: (id: number, employee: Partial<Employee>) => 
    request<Employee>(`/employees/${id}`, { method: 'PUT', body: JSON.stringify(employee) }),
  deleteEmployee: (id: number) => 
    request<{ message: string }>(`/employees/${id}`, { method: 'DELETE' }),

  // Payroll Runs
  getPayrollRuns: () => request<PayrollRun[]>('/payroll-runs'),
  getPayrollRunDetails: (id: number) => 
    request<PayrollRun & { employees: any[] }>(`/payroll-runs/${id}`),
  calculatePayrollPreview: (employeesInput: any[]) => 
    request<{ employees: any[]; totals: any }>('/payroll-runs/calculate', { 
      method: 'POST', 
      body: JSON.stringify({ employeesInput }) 
    }),
  submitPayrollRun: (runData: { 
    period_start: string; 
    period_end: string; 
    payment_method: string; 
    employeesInput: any[]; 
    pay_schedule_id?: number | null; 
    pay_group_id?: number | null; 
  }) => 
    request<{ id: number; message: string }>('/payroll-runs', { 
      method: 'POST', 
      body: JSON.stringify(runData) 
    }),
  finalizePayrollRun: (id: number) => 
    request<{ message: string }>(`/payroll-runs/${id}/finalize`, { method: 'PUT' }),
  reversePayrollRun: (id: number) => 
    request<{ message: string }>(`/payroll-runs/${id}/reverse`, { method: 'PUT' }),
  reverseEmployeePayment: (runId: number, employeeId: number) => 
    request<{ message: string }>(`/payroll-runs/${runId}/employees/${employeeId}/reverse`, { method: 'PUT' }),
  finalizeEmployeePayment: (runId: number, employeeId: number) => 
    request<{ message: string }>(`/payroll-runs/${runId}/employees/${employeeId}/finalize`, { method: 'PUT' }),
  deletePayrollRun: (id: number) => 
    request<{ message: string }>(`/payroll-runs/${id}`, { method: 'DELETE' }),
  updateEmployeePayment: (runId: number, employeeId: number, data: { hours_worked: number; additional_commission: number; vacation_payout_amount: number; payment_method?: string }) => 
    request<{ message: string }>(`/payroll-runs/${runId}/employees/${employeeId}`, { method: 'PUT', body: JSON.stringify(data) }),

  // Reports
  getYtdReports: () => request<{
    totalGross: number;
    totalNet: number;
    totalCpp: number;
    totalEi: number;
    totalTax: number;
    totalWsib: number;
    totalEht: number;
    craRemittance: number;
    craRemittanceYTD?: number;
    wsibDue?: number;
    ehtDue?: number;
    ehtExempt?: boolean;
    craDueDate?: string | null;
    craStatus?: string;
    wsibDueDate?: string | null;
    wsibStatus?: string;
    ehtDueDate?: string | null;
    ehtStatus?: string;
    gmailConnected?: boolean;
    gmailEmail?: string | null;
  }>('/reports/ytd'),

  getPaystubUrl: (runId: number, employeeId: number) => 
    `${API_BASE}/reports/paystub/${runId}/${employeeId}`,
  
  getT4ExportUrl: () => 
    `${API_BASE}/reports/t4/export`,

  getNetPayReportUrl: (runId: number, paymentMethods: string) => 
    `${API_BASE}/reports/net-pay?run_id=${runId}&payment_methods=${encodeURIComponent(paymentMethods)}&format=pdf`,
  
  getNetPayReportData: (runId: number, paymentMethods: string) => 
    request<any>(`/reports/net-pay?run_id=${runId}&payment_methods=${encodeURIComponent(paymentMethods)}`),

  getPayRunSummaryUrl: (runId: number) => 
    `${API_BASE}/reports/pay-run-summary?run_id=${runId}&format=pdf`,

  getPayRunSummaryData: (runId: number) => 
    request<any>(`/reports/pay-run-summary?run_id=${runId}`),

  getPayStatementUrl: (runId: string | number, employeeId: string | number, paymentMethods: string) => 
    `${API_BASE}/reports/pay-statement?run_id=${runId}&employee_id=${employeeId}&payment_methods=${encodeURIComponent(paymentMethods)}`,

  getRemittanceReportUrl: (startDate: string, endDate: string) => 
    `${API_BASE}/reports/remittance-report?start_date=${startDate}&end_date=${endDate}&format=pdf`,

  getRemittanceReportData: (startDate: string, endDate: string) => 
    request<any>(`/reports/remittance-report?start_date=${startDate}&end_date=${endDate}`),

  getHealthTaxReportUrl: (year: string | number) => 
    `${API_BASE}/reports/health-tax-report?tax_year=${year}&format=pdf`,

  getHealthTaxReportData: (year: string | number) => 
    request<any>(`/reports/health-tax-report?tax_year=${year}`),

  getDeductionsExpensesSummaryUrl: (payGroupIds: string, startDate: string, endDate: string) => 
    `${API_BASE}/reports/deductions-expenses-summary?pay_group_ids=${encodeURIComponent(payGroupIds)}&start_date=${startDate}&end_date=${endDate}&format=pdf`,

  getDeductionsExpensesSummaryData: (payGroupIds: string, startDate: string, endDate: string) => 
    request<any>(`/reports/deductions-expenses-summary?pay_group_ids=${encodeURIComponent(payGroupIds)}&start_date=${startDate}&end_date=${endDate}`),

  getEmployeeInformationReportUrl: (payGroupIds: string, startDate?: string, endDate?: string) => 
    `${API_BASE}/reports/employee-information?pay_group_ids=${encodeURIComponent(payGroupIds)}${startDate ? `&start_date=${startDate}` : ''}${endDate ? `&end_date=${endDate}` : ''}&format=pdf`,

  getEmployeeInformationReportData: (payGroupIds: string, startDate?: string, endDate?: string) => 
    request<any>(`/reports/employee-information?pay_group_ids=${encodeURIComponent(payGroupIds)}${startDate ? `&start_date=${startDate}` : ''}${endDate ? `&end_date=${endDate}` : ''}`),

  getEmployeeVarianceReportUrl: (runId: string | number, employeeId: string) => 
    `${API_BASE}/reports/employee-variance?run_id=${runId}&employee_id=${employeeId}&format=pdf`,

  getEmployeeVarianceReportData: (runId: string | number, employeeId: string) => 
    request<any>(`/reports/employee-variance?run_id=${runId}&employee_id=${employeeId}`),

  getPayrollDetailReportUrl: (payGroupIds: string, startDate: string, endDate: string) => 
    `${API_BASE}/reports/payroll-detail?pay_group_ids=${encodeURIComponent(payGroupIds)}&start_date=${startDate}&end_date=${endDate}&format=pdf`,

  getPayrollDetailReportData: (payGroupIds: string, startDate: string, endDate: string) => 
    request<any>(`/reports/payroll-detail?pay_group_ids=${encodeURIComponent(payGroupIds)}&start_date=${startDate}&end_date=${endDate}`),

  getPayrollVarianceReportUrl: (runId: string | number) => 
    `${API_BASE}/reports/payroll-variance?run_id=${runId}&format=pdf`,

  getPayrollVarianceReportData: (runId: string | number) => 
    request<any>(`/reports/payroll-variance?run_id=${runId}`),

  getYtdDetailReportUrl: (taxYear: number, payGroupIds: string, employeeId: string) => 
    `${API_BASE}/reports/ytd-detail?tax_year=${taxYear}&pay_group_ids=${encodeURIComponent(payGroupIds)}&employee_id=${employeeId}&format=pdf`,

  getYtdDetailReportData: (taxYear: number, payGroupIds: string, employeeId: string) => 
    request<any>(`/reports/ytd-detail?tax_year=${taxYear}&pay_group_ids=${encodeURIComponent(payGroupIds)}&employee_id=${employeeId}`),

  emailStubs: (runId: number, employeeIds: number[]) => 
    request<{ message: string; mocked: boolean; results: any[] }>('/reports/email-stubs', {
      method: 'POST',
      body: JSON.stringify({ runId, employeeIds })
    }),

  getGmailAuthUrl: (origin: string) => 
    request<{ url: string }>(`/auth/google/login-url?origin=${encodeURIComponent(origin)}`),

  disconnectGmail: () => 
    request<{ message: string }>('/settings/gmail', { method: 'DELETE' }),

  // Pay Groups & Schedules
  getPayGroups: () => request<any[]>('/pay-groups'),
  createPayGroup: (data: any) => 
    request<any>('/pay-groups', { method: 'POST', body: JSON.stringify(data) }),
  deletePayGroup: (id: number) => 
    request<{ message: string }>(`/pay-groups/${id}`, { method: 'DELETE' }),
  getPayGroupSchedules: (id: number) => 
    request<any[]>(`/pay-groups/${id}/schedules`),
  generateSchedulesForGroup: (id: number, data: any) => 
    request<any>(`/pay-groups/${id}/generate-schedules`, { method: 'POST', body: JSON.stringify(data) }),
  getUpcomingSchedules: () => 
    request<any[]>('/pay-groups/upcoming-schedules'),
  updateScheduleDates: (groupId: number, scheduleId: number, dates: { period_start: string; period_end: string; payment_date: string }) =>
    request<{ message: string }>(`/pay-groups/${groupId}/schedules/${scheduleId}`, { method: 'PUT', body: JSON.stringify(dates) }),

  // Remittance Payments
  getRemittancePayments: () =>
    request<any[]>('/reports/remittances'),
  createRemittancePayment: (data: { type: string; payment_date: string; amount: number; period_end: string }) =>
    request<{ id: number; message: string }>('/reports/remittances', { method: 'POST', body: JSON.stringify(data) }),
  deleteRemittancePayment: (id: number) =>
    request<{ message: string }>(`/reports/remittances/${id}`, { method: 'DELETE' })
};
export default api;
