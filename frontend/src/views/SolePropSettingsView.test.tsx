import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import SolePropSettingsView from './SolePropSettingsView';
import { api } from '../utils/api';

vi.mock('../utils/api', () => ({ api: {
  getSolePropOverview: vi.fn(),
  getSettings: vi.fn(),
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
  totals: { cad: 0, tax: 0, cpp: 0, cpp2: 0, hst: 0 },
  deposits: [],
  upcoming: [],
  gst_remittances: [],
  gst: { rollingTotal: 0, crossed: false, crossingDate: null, deadline: null, hasBN: false },
};
describe('SolePropSettingsView', () => {

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.getSolePropOverview).mockResolvedValue(overview);
    vi.mocked(api.getSettings).mockRejectedValue(new Error('no settings'));
    vi.mocked(api.getWiseStatus).mockResolvedValue({ connected: false, last4: null, label: null, updated_at: null, autoSync: false, employer: null });
  });
  it('prefills the saved legal name', async () => {
    vi.mocked(api.getSettings).mockResolvedValue({ legal_name: 'Jane Doe' } as any);
    render(<SolePropSettingsView triggerToast={() => {}} />);
    expect(await screen.findByDisplayValue('Jane Doe')).toBeInTheDocument();
  });

  it('shows profile fields with no payroll sections', async () => {
    render(<SolePropSettingsView triggerToast={() => {}} />);
    expect(await screen.findByText(/Sole proprietor settings/i)).toBeInTheDocument();
    expect(screen.getByText('2026-08-15')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /2026 opening balances/i })).toBeInTheDocument();
    expect(screen.getByLabelText(/income already earned \(\$\)/i)).toBeInTheDocument();
    expect(screen.queryByText(/pensionable/i)).toBeNull();
    expect(screen.queryByText(/pay group/i)).toBeNull();
    expect(screen.queryByText(/WSIB/i)).toBeNull();
    expect(screen.queryByText(/Employer Health Tax/i)).toBeNull();
  });

  it('titles openings with the start-date year', async () => {
    vi.mocked(api.getSolePropOverview).mockResolvedValue({
      ...overview,
      profile: { ...overview.profile, start_date: '2025-03-01' },
    });
    render(<SolePropSettingsView triggerToast={() => {}} />);
    expect(await screen.findByRole('heading', { name: /2025 opening balances/i })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: /2026 opening balances/i })).toBeNull();
  });

  it('locks openings when the start-year annual is paid', async () => {
    vi.mocked(api.getSolePropOverview).mockResolvedValue({
      ...overview,
      profile: { ...overview.profile, openings_locked: true, openings_hidden: 0 },
      upcoming: [{ id: 1, tax_year: 2026, due_date: '2027-04-30', kind: 'annual', paid: 1, paid_date: '2027-04-15' }],
    });
    render(<SolePropSettingsView triggerToast={() => {}} />);
    expect(await screen.findByLabelText(/income already earned \(\$\)/i)).toBeDisabled();
    expect(screen.queryByRole('button', { name: /save openings/i })).toBeNull();
    expect(screen.getByText(/locked/i)).toBeInTheDocument();
  });

  it('hides locked openings until shown again', async () => {
    vi.mocked(api.updateSolePropProfile).mockResolvedValue({
      profile: { ...overview.profile, openings_hidden: 0, openings_locked: true },
    });
    vi.mocked(api.getSolePropOverview)
      .mockResolvedValueOnce({
        ...overview,
        profile: { ...overview.profile, openings_locked: true, openings_hidden: 1 },
      })
      .mockResolvedValue({
        ...overview,
        profile: { ...overview.profile, openings_locked: true, openings_hidden: 0 },
      });
    render(<SolePropSettingsView triggerToast={() => {}} />);
    expect(await screen.findByRole('button', { name: /show 2026 opening/i })).toBeInTheDocument();
    expect(screen.queryByLabelText(/income already earned/i)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /show 2026 opening/i }));
    await waitFor(() => expect(api.updateSolePropProfile).toHaveBeenCalledWith({ openings_hidden: 0 }));
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
    vi.mocked(api.saveWiseToken).mockResolvedValue({ connected: true, last4: 'c123', label: null, updated_at: '2026-09-08', autoSync: false, employer: null });
    render(<SolePropSettingsView triggerToast={() => {}} />);
    fireEvent.change(await screen.findByPlaceholderText(/paste token/i), { target: { value: 'live-test-token-abc123' } });
    fireEvent.click(screen.getByRole('button', { name: /save token/i }));
    await waitFor(() => expect(api.saveWiseToken).toHaveBeenCalledWith({ token: 'live-test-token-abc123' }));
    expect(await screen.findByText(/••••c123/)).toBeInTheDocument();
    expect(screen.queryByDisplayValue('live-test-token-abc123')).toBeNull();
  });

  it('shows test and remove actions when connected', async () => {
    vi.mocked(api.getWiseStatus).mockResolvedValue({ connected: true, last4: 'c123', label: 'Personal', updated_at: '2026-09-08', autoSync: false, employer: null });
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

  it('asks before recalculating and aborts on cancel', async () => {
    vi.mocked(api.getSolePropOverview).mockResolvedValue({
      ...overview,
      deposits: [{ id: 1, received_date: '2026-09-01', cad_amount: 6900, tax_owed: 0, cpp_owed: 404.6, cpp2_owed: 0 }],
      upcoming: [{ id: 1, due_date: '2027-04-30', paid: 1 }],
    });
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);
    render(<SolePropSettingsView triggerToast={() => {}} />);
    fireEvent.change(await screen.findByLabelText(/CPP paid \(\$\)/i), { target: { value: '100' } });
    fireEvent.click(screen.getByRole('button', { name: /save openings/i }));
    await waitFor(() => expect(confirmSpy).toHaveBeenCalled());
    expect(api.updateSolePropProfile).not.toHaveBeenCalled();
    confirmSpy.mockRestore();
  });

  it('proceeds on confirm when deposits exist', async () => {
    vi.mocked(api.getSolePropOverview).mockResolvedValue({
      ...overview,
      deposits: [{ id: 1, received_date: '2026-09-01', cad_amount: 6900, tax_owed: 0, cpp_owed: 404.6, cpp2_owed: 0 }],
      upcoming: [],
    });
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    vi.mocked(api.updateSolePropProfile).mockResolvedValue({ profile: overview.profile });
    render(<SolePropSettingsView triggerToast={() => {}} />);
    fireEvent.change(await screen.findByLabelText(/CPP paid \(\$\)/i), { target: { value: '100' } });
    fireEvent.click(screen.getByRole('button', { name: /save openings/i }));
    await waitFor(() => expect(api.updateSolePropProfile).toHaveBeenCalled());
    confirmSpy.mockRestore();
  });

});
