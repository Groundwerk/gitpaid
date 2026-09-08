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
  beforeEach(() => { vi.clearAllMocks(); vi.mocked(api.getSolePropOverview).mockResolvedValue(overview); });

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
});
