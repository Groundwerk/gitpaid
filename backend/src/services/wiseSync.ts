// Wise balance-statement sync: pure normalization plus thin API client.
// Statements (not /v1/transfers) carry incoming pay as CREDIT entries.

export interface WiseCredit {
  key: string;
  date: string;
  amount: number;
  currency: string;
  sender: string;
  senderKey: string;
  reference: string;
}

export function normalizeSender(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, ' ');
}

function asNumber(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

export function extractCredits(statementJson: unknown, currency: string): WiseCredit[] {
  if (!statementJson || typeof statementJson !== 'object') return [];
  const txs = (statementJson as { transactions?: unknown }).transactions;
  if (!Array.isArray(txs)) return [];
  const out: WiseCredit[] = [];
  for (const t of txs) {
    if (!t || typeof t !== 'object') continue;
    const tx = t as Record<string, any>;
    if (tx.type !== 'CREDIT') continue;
    const rawAmount = tx.amount;
    const amount = typeof rawAmount === 'object' && rawAmount !== null
      ? asNumber(rawAmount.value)
      : asNumber(rawAmount);
    if (amount === null || amount <= 0) continue;
    const cur = (typeof rawAmount === 'object' && rawAmount !== null && typeof rawAmount.currency === 'string')
      ? rawAmount.currency.toUpperCase()
      : currency.toUpperCase();
    const date = typeof tx.date === 'string' ? tx.date.slice(0, 10) : null;
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    const details = (tx.details && typeof tx.details === 'object' ? tx.details : {}) as Record<string, any>;
    const ref = typeof tx.referenceNumber === 'string' && tx.referenceNumber ? tx.referenceNumber : '';
    const sender = (typeof details.senderName === 'string' && details.senderName.trim())
      || (typeof details.description === 'string' && details.description.trim())
      || ref
      || 'unknown sender';
    const key = ref ? `wise:${ref}` : `wise:${date}:${amount}:${normalizeSender(sender)}`;
    out.push({
      key,
      date,
      amount,
      currency: cur,
      sender,
      senderKey: normalizeSender(sender),
      reference: ref,
    });
  }
  out.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.key < b.key ? -1 : 1));
  return out;
}

export class WiseApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

type FetchImpl = (url: string, init?: any) => Promise<any>;

export async function wiseGet(token: string, path: string, fetchImpl: FetchImpl = fetch): Promise<any> {
  const res = await fetchImpl(`https://api.wise.com${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    throw new WiseApiError(res.status ?? 500, `Wise API rejected the request (HTTP ${res.status ?? 'unknown'}).`);
  }
  return res.json();
}

export interface WiseBalanceRef {
  profileId: number;
  balanceId: number;
}

export async function discoverBalance(
  token: string,
  currency: string,
  fetchImpl: FetchImpl = fetch
): Promise<WiseBalanceRef> {
  const profiles = await wiseGet(token, '/v1/profiles', fetchImpl);
  if (!Array.isArray(profiles) || profiles.length === 0) {
    throw new WiseApiError(404, 'No Wise profiles found on this token.');
  }
  const personal = profiles.find((p) => p?.type === 'personal') ?? profiles[0];
  const accounts = await wiseGet(token, `/v1/borderless-accounts?profileId=${personal.id}`, fetchImpl);
  if (!Array.isArray(accounts) || accounts.length === 0) {
    throw new WiseApiError(404, 'No Wise balances found on this profile.');
  }
  const match = accounts.find((a) => String(a?.currency ?? '').toUpperCase() === currency.toUpperCase())
    ?? accounts[0];
  return { profileId: personal.id, balanceId: match.id };
}

export async function fetchCredits(
  token: string,
  opts: { currency?: string; days?: number; since?: string },
  fetchImpl: FetchImpl = fetch
): Promise<WiseCredit[]> {
  const currency = (opts.currency ?? 'USD').toUpperCase();
  const now = new Date();
  const end = now.toISOString();
  const startMs = opts.since
    ? Date.parse(`${opts.since}T00:00:00.000Z`)
    : now.getTime() - (opts.days ?? 90) * 24 * 60 * 60 * 1000;
  const start = new Date(startMs).toISOString();
  const { balanceId } = await discoverBalance(token, currency, fetchImpl);
  const qs = new URLSearchParams({
    currency,
    intervalStart: start,
    intervalEnd: end,
    type: 'COMPACT',
  });
  const statement = await wiseGet(
    token,
    `/v1/borderless-accounts/${balanceId}/statement.json?${qs.toString()}`,
    fetchImpl
  );
  return extractCredits(statement, currency);
}
