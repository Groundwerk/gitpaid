import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import LoginView from './LoginView';

describe('LoginView server connectivity', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
    vi.stubEnv('VITE_ALLOW_BYPASS', 'true');
  });

  it('shows a retry option when the backend is unreachable', async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error('connection refused'));
    render(<LoginView onLoginSuccess={() => {}} triggerToast={() => {}} />);
    expect(await screen.findByText(/cannot reach the server/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /retry/i })).toBeInTheDocument();
    expect(screen.queryByText(/bypass auth for live testing/i)).toBeNull();
  });

  it('retries the config load and shows bypass once reachable', async () => {
    let calls = 0;
    global.fetch = vi.fn().mockImplementation(() => {
      calls += 1;
      if (calls === 1) return Promise.reject(new Error('connection refused'));
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ clientId: 'mock-client-id', allowMockLogin: true }),
      } as Response);
    });
    render(<LoginView onLoginSuccess={() => {}} triggerToast={() => {}} />);
    fireEvent.click(await screen.findByRole('button', { name: /retry/i }));
    await waitFor(() => {
      expect(screen.getByText(/bypass auth for live testing/i)).toBeInTheDocument();
    });
    expect(calls).toBe(2);
  });
});
