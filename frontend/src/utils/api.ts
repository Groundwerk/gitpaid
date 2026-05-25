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
  submitPayrollRun: (runData: { period_start: string; period_end: string; payment_method: string; employeesInput: any[] }) => 
    request<{ id: number; message: string }>('/payroll-runs', { 
      method: 'POST', 
      body: JSON.stringify(runData) 
    }),

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
  }>('/reports/ytd'),

  getPaystubUrl: (runId: number, employeeId: number) => 
    `${API_BASE}/reports/paystub/${runId}/${employeeId}`,
  
  getT4ExportUrl: () => 
    `${API_BASE}/reports/t4/export`
};
export default api;
