import { describe, expect, it } from 'vitest';
import { normalizeSender, extractCredits } from './wiseSync';

const STATEMENT = {
  transactions: [
    {
      type: 'CREDIT',
      date: '2026-09-05T14:22:10.000Z',
      amount: { value: 31000, currency: 'USD' },
      totalFees: { value: 4.4, currency: 'USD' },
      details: { description: 'DEEL INC payroll Aug', senderName: 'Deel Inc' },
      referenceNumber: 'REF-001',
      runningBalance: { value: 50000, currency: 'USD' },
    },
    {
      type: 'DEBIT',
      date: '2026-09-06T09:00:00.000Z',
      amount: { value: 500, currency: 'USD' },
      details: { description: 'Transfer to savings' },
      referenceNumber: 'REF-002',
    },
    {
      type: 'CREDIT',
      date: '2026-09-07T11:00:00.000Z',
      amount: { value: 200, currency: 'USD' },
      details: {},
      referenceNumber: 'REF-003',
    },
  ],
};

describe('normalizeSender', () => {
  it('lowercases and trims for stable matching', () => {
    expect(normalizeSender('  Deel Inc ')).toBe('deel inc');
  });
});

describe('extractCredits', () => {
  it('keeps only credits with sender labels and stable keys', () => {
    const credits = extractCredits(STATEMENT, 'USD');
    expect(credits).toHaveLength(2);
    expect(credits[0]).toMatchObject({
      key: 'wise:REF-001',
      date: '2026-09-05',
      amount: 31000,
      currency: 'USD',
      sender: 'Deel Inc',
      senderKey: 'deel inc',
    });
    // Falls back to description, then reference, when senderName is absent
    expect(credits[1].sender).toBe('REF-003');
    expect(credits[1].senderKey).toBe('ref-003');
  });

  it('returns empty for malformed statements', () => {
    expect(extractCredits(null, 'USD')).toEqual([]);
    expect(extractCredits({}, 'USD')).toEqual([]);
    expect(extractCredits({ transactions: 'nope' }, 'USD')).toEqual([]);
  });
});
