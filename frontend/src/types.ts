export interface CompanySettings {
  id: number;
  legal_name: string;
  operating_name: string;
  business_number: string;
  address_line1: string;
  city: string;
  postal_code: string;
  contact_name: string;
  contact_email: string;
  wsib_number: string;
  wsib_rate: number;
  eht_exempt: number; // 0 or 1
  eht_rate: number;
  vacation_rate: number;
  pay_period: string;
  owner_sin?: string;
  business_type?: string;
  remittance_frequency?: string;
  contact_phone?: string;
  address_line2?: string;
  province?: string;
  override_ei_employer_rate?: number;
  gmail_refresh_token?: string;
  gmail_email?: string | null;
}

export interface Employee {
  id: number;
  first_name: string;
  last_name: string;
  email: string;
  role: string;
  department: string;
  pay_type: 'salary' | 'hourly' | 'salary_commission';
  rate: number;
  status: 'active' | 'leave' | 'terminated';
  cpp_exempt: number; // 0 or 1
  ei_exempt: number;
  tax_exempt: number;
  avatar: string;
  ytd_gross: number;
  ytd_net: number;
  ytd_cpp: number;
  ytd_cpp_employer?: number;
  ytd_ei: number;
  ytd_ei_employer?: number;
  ytd_tax: number;
  ytd_wsib: number;
  ytd_eht: number;
  ytd_vacation_accrued: number;
  ytd_vacation_paid: number;
  pay_interval?: 'company' | 'weekly' | 'bi-weekly' | 'semi-monthly' | 'monthly';
  pay_group_id?: number | null;
  sin?: string;
  start_date?: string;
  fit_exempt?: number;
  fit_withholding_amount?: number;
  override_fed_tax_credit?: number;
  fed_tax_credit_amount?: number;
  override_prov_tax_credit?: number;
  prov_tax_credit_amount?: number;
  wcb_exempt?: number;
  wcb_rate?: number;
  has_payruns?: boolean;
  payment_method?: string;
}

export interface PayGroup {
  id: number;
  company_id: number;
  name: string;
  pay_frequency: 'weekly' | 'bi-weekly' | 'semi-monthly' | 'monthly';
  employee_count?: number;
}

export interface PaySchedule {
  id: number;
  pay_group_id: number;
  period_start: string;
  period_end: string;
  payment_date: string;
  status: 'open' | 'processed';
  pay_group_name?: string;
  pay_frequency?: string;
}


export interface PayrollRun {
  id: number;
  run_date: string;
  period_start: string;
  period_end: string;
  total_gross: number;
  total_net: number;
  total_cpp_employee: number;
  total_cpp_employer: number;
  total_ei_employee: number;
  total_ei_employer: number;
  total_tax: number;
  total_wsib: number;
  total_eht: number;
  total_vacation_accrued: number;
  payment_method: string;
  status: string;
}

export interface PayrollRunEmployee {
  id: number;
  run_id: number;
  employee_id: number;
  gross_pay: number;
  net_pay: number;
  cpp_employee: number;
  cpp_employer: number;
  ei_employee: number;
  ei_employer: number;
  tax: number;
  wsib_premium: number;
  eht_premium: number;
  vacation_accrued: number;
  vacation_paid: number;
  hours_worked: number;
  first_name?: string;
  last_name?: string;
  role?: string;
  department?: string;
  avatar?: string;
  status?: string;
  payment_method?: string;
}
