import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { api, restoreApiSession } from './api';

describe('api unauthorized events', () => {
  beforeEach(() => {
    restoreApiSession();
    localStorage.setItem('token', 'expired-token');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => ({ error: 'Unauthorized' }),
    }));
  });

  afterEach(() => {
    window.removeEventListener('auth-unauthorized', clearTokenOnUnauthorized);
    localStorage.clear();
    vi.unstubAllGlobals();
  });

  const clearTokenOnUnauthorized = () => {
    localStorage.removeItem('token');
  };

  it('dispatches auth-unauthorized only once for concurrent 401s', async () => {
    window.addEventListener('auth-unauthorized', clearTokenOnUnauthorized);
    const handler = vi.fn();
    window.addEventListener('auth-unauthorized', handler);

    await Promise.allSettled([
      api.getSettings(),
      api.getEmployees(),
      api.getPayrollRuns(),
      api.getYtdReports(),
    ]);

    expect(handler).toHaveBeenCalledTimes(1);
    window.removeEventListener('auth-unauthorized', handler);
  });

  it('does not send further requests after a 401', async () => {
    window.addEventListener('auth-unauthorized', clearTokenOnUnauthorized);

    await api.getSettings().catch(() => {});
    expect(fetch).toHaveBeenCalledTimes(1);

    await api.getEmployees().catch(() => {});
    await api.getPayrollRuns().catch(() => {});
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('aborts in-flight requests after the first 401', async () => {
    window.addEventListener('auth-unauthorized', clearTokenOnUnauthorized);
    const signals: AbortSignal[] = [];
    vi.stubGlobal('fetch', vi.fn().mockImplementation((_url: string, init?: RequestInit) => {
      if (init?.signal) signals.push(init.signal);
      if (signals.length === 1) {
        return Promise.resolve({
          ok: false,
          status: 401,
          json: async () => ({ error: 'Unauthorized' }),
        });
      }
      return new Promise((_resolve, reject) => {
        const abort = () => {
          const err = new Error('The operation was aborted.');
          err.name = 'AbortError';
          reject(err);
        };
        if (init?.signal?.aborted) {
          abort();
          return;
        }
        init?.signal?.addEventListener('abort', abort);
      });
    }));

    await Promise.allSettled([
      api.getSettings(),
      api.getEmployees(),
      api.getPayrollRuns(),
    ]);

    expect(signals).toHaveLength(3);
    expect(signals[1]?.aborted).toBe(true);
    expect(signals[2]?.aborted).toBe(true);
  });

  it('sends requests again after the session is restored', async () => {
    window.addEventListener('auth-unauthorized', clearTokenOnUnauthorized);
    await api.getSettings().catch(() => {});
    expect(fetch).toHaveBeenCalledTimes(1);

    restoreApiSession();
    localStorage.setItem('token', 'fresh-token');
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ id: 1 }),
    } as Response);

    await expect(api.getSettings()).resolves.toEqual({ id: 1 });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('treats 401-tagged errors as unauthorized', async () => {
    const { isUnauthorizedError } = await import('./api');
    expect(isUnauthorizedError(Object.assign(new Error('Unauthorized'), { status: 401 }))).toBe(true);
    expect(isUnauthorizedError(Object.assign(new Error('Not found'), { status: 404 }))).toBe(false);
    expect(isUnauthorizedError(new Error('no status'))).toBe(false);
    expect(isUnauthorizedError(null)).toBe(false);
  });
});
