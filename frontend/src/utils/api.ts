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
    const err = await res.json().catch(() => ({ error: 'An unknown error occurred' }));
    throw new Error(err.error || `HTTP error ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export const api = {
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
  }>('/reports/ytd'),

  getPaystubUrl: (runId: number, employeeId: number) => 
    `${API_BASE}/reports/paystub/${runId}/${employeeId}`,
  
  getT4ExportUrl: () => 
    `${API_BASE}/reports/t4/export`,

  emailStubs: (runId: number, employeeIds: number[]) => 
    request<{ message: string; mocked: boolean; results: any[] }>('/reports/email-stubs', {
      method: 'POST',
      body: JSON.stringify({ runId, employeeIds })
    }),

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
