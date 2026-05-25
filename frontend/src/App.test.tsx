import { render, screen, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { App } from './App';

// Mock the API helpers
vi.mock('./utils/api', () => {
  return {
    api: {
      getSettings: vi.fn().mockResolvedValue({
        id: 1,
        legal_name: 'Dynamic Acme Solutions',
        business_number: '123456789 RP 0001',
        wsib_rate: 2.5,
        eht_exempt: 1,
        eht_rate: 1.95,
        vacation_rate: 4.0,
        pay_period: 'bi-weekly'
      }),
      updateSettings: vi.fn(),
      getEmployees: vi.fn().mockResolvedValue([]),
      getPayrollRuns: vi.fn().mockResolvedValue([]),
      getYtdReports: vi.fn().mockResolvedValue({
        totalGross: 0,
        totalNet: 0,
        totalCpp: 0,
        totalEi: 0,
        totalTax: 0,
        totalWsib: 0,
        totalEht: 0,
        craRemittance: 0
      })
    },
    API_BASE: 'http://localhost:5001/api'
  };
});

describe('Frontend App Authentication States', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
  });

  it('renders LoginView when unauthenticated', async () => {
    render(<App />);
    expect(screen.getByText('Ontario Payroll Portal')).toBeInTheDocument();
    expect(screen.getByText('Bypass Auth for Live Testing')).toBeInTheDocument();
  });

  it('renders OnboardingView when authenticated but missing company settings profile', async () => {
    localStorage.setItem('token', 'mock-jwt-token');
    localStorage.setItem('email', 'admin@company.com');
    localStorage.setItem('name', 'Admin User');
    localStorage.setItem('avatar', '');
    // No companyId in localStorage
    
    render(<App />);
    
    expect(screen.getByText('Onboard Your Business')).toBeInTheDocument();
    expect(screen.getByText('Company')).toBeInTheDocument();
    expect(screen.getByText('Contact')).toBeInTheDocument();
    expect(screen.getByText('Payroll & Tax')).toBeInTheDocument();
  });

  it('renders DashboardView when authenticated and company settings profile is complete', async () => {
    localStorage.setItem('token', 'mock-jwt-token');
    localStorage.setItem('email', 'admin@company.com');
    localStorage.setItem('name', 'Admin User');
    localStorage.setItem('avatar', '');
    localStorage.setItem('companyId', '1');

    render(<App />);

    // Header and navigation should render
    await waitFor(() => {
      expect(screen.getByText('Dynamic Acme Solutions')).toBeInTheDocument();
    });
    expect(screen.getByText('Overview')).toBeInTheDocument();
    expect(screen.getByText('Run Payroll')).toBeInTheDocument();
  });
});
