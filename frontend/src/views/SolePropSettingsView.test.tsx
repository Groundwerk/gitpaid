import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import SolePropSettingsView from './SolePropSettingsView';
import { api } from '../utils/api';

vi.mock('../utils/api', () => ({ api: {
  getSolePropOverview: vi.fn(),
  updateSettings: vi.fn(),
  updateSolePropProfile: vi.fn(),
  getWiseStatus: vi.fn(),
  saveWiseToken: vi.fn(),
  testWiseToken: vi.fn(),
  deleteWiseToken: vi.fn(),
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
    vi.mocked(api.getWiseStatus).mockResolvedValue({ connected: false, last4: null, label: null, updated_at: null });
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
  it('renders a masked token field when disconnected', async () => {
    render(<SolePropSettingsView triggerToast={() => {}} />);
    const input = await screen.findByPlaceholderText(/paste token/i) as HTMLInputElement;
    expect(input.type).toBe('password');
  });

  it('saves the token without ever displaying it', async () => {
    vi.mocked(api.saveWiseToken).mockResolvedValue({ connected: true, last4: 'c123', label: null, updated_at: '2026-09-08' });
    render(<SolePropSettingsView triggerToast={() => {}} />);
    fireEvent.change(await screen.findByPlaceholderText(/paste token/i), { target: { value: 'live-test-token-abc123' } });
    fireEvent.click(screen.getByRole('button', { name: /save token/i }));
    await waitFor(() => expect(api.saveWiseToken).toHaveBeenCalledWith({ token: 'live-test-token-abc123' }));
    expect(await screen.findByText(/••••c123/)).toBeInTheDocument();
    expect(screen.queryByDisplayValue('live-test-token-abc123')).toBeNull();
  });

  it('shows test and remove actions when connected', async () => {
    vi.mocked(api.getWiseStatus).mockResolvedValue({ connected: true, last4: 'c123', label: 'Personal', updated_at: '2026-09-08' });
    vi.mocked(api.testWiseToken).mockResolvedValue({ ok: true, profiles: 1 });
    render(<SolePropSettingsView triggerToast={() => {}} />);
    fireEvent.click(await screen.findByRole('button', { name: /test connection/i }));
    await waitFor(() => expect(api.testWiseToken).toHaveBeenCalledTimes(1));
  });

  it('saves corrected openings and refreshes the ledger', async () => {
    vi.mocked(api.updateSolePropProfile).mockResolvedValue({ profile: { ...overview.profile, ytd_cpp_opening: 8460.9 } });
    render(<SolePropSettingsView triggerToast={() => {}} />);
    fireEvent.change(await screen.findByLabelText(/CPP paid \(\$\)/i), { target: { value: '8460.9' } });
    fireEvent.click(screen.getByRole('button', { name: /save openings/i }));
    await waitFor(() => expect(api.updateSolePropProfile).toHaveBeenCalledWith(
      { ytd_pensionable_opening: undefined, ytd_cpp_opening: 8460.9, ytd_cpp2_opening: undefined }
    ));
    expect(api.getSolePropOverview).toHaveBeenCalledTimes(2);
  });

});
