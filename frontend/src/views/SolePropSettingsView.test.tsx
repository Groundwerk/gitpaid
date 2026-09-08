import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import SolePropSettingsView from './SolePropSettingsView';
import { api } from '../utils/api';

vi.mock('../utils/api', () => ({ api: {
  getSolePropOverview: vi.fn(),
  updateSettings: vi.fn(),
  updateSolePropProfile: vi.fn(),
} }));

const overview: any = {
  profile: {
    business_number: null, start_date: '2026-08-15', province: 'ON',
    ytd_pensionable_opening: 190000, ytd_cpp_opening: 8460.9, ytd_cpp2_opening: 832,
  },
  totals: { cad: 0, tax: 0, cpp: 0, cpp2: 0 },
  deposits: [],
  upcoming: [],
  gst: { rollingTotal: 0, crossed: false, crossingDate: null, deadline: null, hasBN: false },
};

describe('SolePropSettingsView', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.getSolePropOverview).mockResolvedValue(overview);
  });

  it('shows profile fields with no payroll sections', async () => {
    render(<SolePropSettingsView triggerToast={() => {}} />);
    expect(await screen.findByText(/Sole proprietor settings/i)).toBeInTheDocument();
    expect(screen.getByText('2026-08-15')).toBeInTheDocument();
    expect(screen.queryByText(/pay group/i)).toBeNull();
    expect(screen.queryByText(/WSIB/i)).toBeNull();
    expect(screen.queryByText(/Employer Health Tax/i)).toBeNull();
  });

  it('saves a business number through the sole-prop API', async () => {
    vi.mocked(api.updateSolePropProfile).mockResolvedValue({ profile: { ...overview.profile, business_number: '123456789' } });
    render(<SolePropSettingsView triggerToast={() => {}} />);
    fireEvent.change(await screen.findByPlaceholderText(/9 digits/), { target: { value: '123456789' } });
    fireEvent.click(screen.getByRole('button', { name: /save business number/i }));
    await waitFor(() => expect(api.updateSolePropProfile).toHaveBeenCalledWith({ business_number: '123456789' }));
  });
});
