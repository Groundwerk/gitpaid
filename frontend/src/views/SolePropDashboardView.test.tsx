import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import SolePropDashboardView from './SolePropDashboardView';
import { api } from '../utils/api';

vi.mock('../utils/api', () => ({ api: {
  getSolePropOverview: vi.fn(),
  previewFx: vi.fn(),
  createSolePropDeposit: vi.fn(),
  voidSolePropDeposit: vi.fn(),
  paySolePropInstalment: vi.fn(),
  updateSolePropProfile: vi.fn(),
  getWiseStatus: vi.fn(),
  getWisePreview: vi.fn(),
  importWiseTransfers: vi.fn(),
  setWiseAutoSync: vi.fn(),
  runWiseSyncNow: vi.fn(),
} }));

const overview: any = {
  profile: { business_number: null, start_date: '2026-08-15' },
  totals: { cad: 33000, tax: 5000, cpp: 3000, cpp2: 0 },
  deposits: [],
  upcoming: [{ id: 1, tax_year: 2026, due_date: '2027-04-30', kind: 'annual',
    tax_amount: 5000, cpp_amount: 3000, cpp2_amount: 0, total_amount: 8000, paid: 0, paid_date: null }],
  gst: { rollingTotal: 33000, crossed: true, crossingDate: '2027-02-10', deadline: '2027-03-11', hasBN: false },
};

describe('SolePropDashboardView', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.getSolePropOverview).mockResolvedValue(overview);
    vi.mocked(api.getWiseStatus).mockResolvedValue({ connected: false, last4: null, label: null, updated_at: null });
  });

  it('shows the blocking GST banner until a BN is saved', async () => {
    render(<SolePropDashboardView triggerToast={() => {}} />);
    expect(await screen.findByText(/GST\/HST registration required/i)).toBeInTheDocument();
    expect(screen.getByText(/2027-03-11/)).toBeInTheDocument();
  });

  it('mark-paid calls the API and refetches', async () => {
    vi.mocked(api.paySolePropInstalment).mockResolvedValue({ instalment: { ...overview.upcoming[0], paid: 1 } });
    render(<SolePropDashboardView triggerToast={() => {}} />);
    fireEvent.click(await screen.findByRole('button', { name: /mark paid/i }));
    await waitFor(() => expect(api.paySolePropInstalment).toHaveBeenCalledWith(1, undefined));
    expect(api.getSolePropOverview).toHaveBeenCalledTimes(2);
  });
  it('collapses later instalments behind a summary', async () => {
    vi.mocked(api.getSolePropOverview).mockResolvedValue({
      ...overview,
      upcoming: [
        { ...overview.upcoming[0], id: 1, due_date: '2027-03-15', kind: 'quarterly' },
        { ...overview.upcoming[0], id: 2, due_date: '2027-04-30', kind: 'annual' },
        { ...overview.upcoming[0], id: 3, due_date: '2027-06-15', kind: 'quarterly' },
      ],
    });
    render(<SolePropDashboardView triggerToast={() => {}} />);
    const summary = await screen.findByText(/Later instalments \(2\)/);
    const details = summary.closest('details');
    expect(details).not.toBeNull();
    expect(details?.textContent).toContain('2027-04-30');
    expect(details?.textContent).toContain('2027-06-15');
    expect(details?.textContent).not.toContain('2027-03-15');
  });

  it('prompts to connect Wise when no token is saved', async () => {
    render(<SolePropDashboardView triggerToast={() => {}} />);
    expect(await screen.findByText(/Connect Wise in Settings/i)).toBeInTheDocument();
  });

  it('lists preview candidates and imports the selection with an employer', async () => {
    vi.mocked(api.getWiseStatus).mockResolvedValue({ connected: true, last4: 'c123', label: null, updated_at: 'x' });
    const preview = {
      employer: null,
      autoSync: false,
      candidates: [
        { key: 'wise:PAY-1', date: '2026-09-05', amount: 1000, currency: 'USD', sender: 'Deel Inc', senderKey: 'deel inc', reference: 'PAY-1', alreadyImported: false },
        { key: 'wise:PAY-2', date: '2026-09-06', amount: 50, currency: 'USD', sender: 'Coffee refund', senderKey: 'coffee refund', reference: 'PAY-2', alreadyImported: true },
      ],
    };
    vi.mocked(api.getWisePreview).mockResolvedValue(preview);
    vi.mocked(api.importWiseTransfers).mockResolvedValue({ imported: 1, overview });
    render(<SolePropDashboardView triggerToast={() => {}} />);
    fireEvent.click(await screen.findByRole('button', { name: /sync from wise/i }));
    await waitFor(() => expect(api.getWisePreview).toHaveBeenCalled());
    expect(await screen.findByText('Deel Inc')).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText(/Import Deel Inc 2026-09-05/));
    fireEvent.click(screen.getByLabelText(/Mark Deel Inc as employer/));
    fireEvent.click(screen.getByRole('button', { name: /import selected/i }));
    await waitFor(() => expect(api.importWiseTransfers).toHaveBeenCalledWith({
      keys: ['wise:PAY-1'], employerKey: 'deel inc', employerLabel: 'Deel Inc',
    }));
  });

  it('toggles daily auto-sync once an employer exists', async () => {
    vi.mocked(api.getWiseStatus).mockResolvedValue({ connected: true, last4: 'c123', label: null, updated_at: 'x' });
    vi.mocked(api.getWisePreview).mockResolvedValue({
      employer: { key: 'deel inc', label: 'Deel Inc' }, autoSync: false, candidates: [],
    });
    render(<SolePropDashboardView triggerToast={() => {}} />);
    fireEvent.click(await screen.findByRole('button', { name: /sync from wise/i }));
    fireEvent.click(await screen.findByLabelText(/auto-sync daily/i));
    await waitFor(() => expect(api.setWiseAutoSync).toHaveBeenCalledWith(true));
  });

});
