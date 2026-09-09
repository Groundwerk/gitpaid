import { describe, expect, it } from 'vitest';
import { calculateSolePropObligations } from './solePropEngine';

describe('calculateSolePropObligations', () => {
  it('computes tax + CPP on a mid-range cumulative total (2026)', () => {
    const out = calculateSolePropObligations({
      cumulativeCad: 50000,
      priorTax: 0, priorCpp: 0, priorCpp2: 0,
      ytdPensionableOpening: 0, ytdCppOpening: 0, ytdCpp2Opening: 0,
      taxYear: 2026,
    });
    // Federal: (50000-16452)=33548 @14% = 4696.72
    // Ontario: (50000-12989)=37011 @5.05% = 1869.06
    expect(out.incomeTax).toBe(6565.78);
    // CPP: (50000-3500)=46500 x11.9% = 5533.50
    expect(out.cpp).toBe(5533.5);
    expect(out.cpp2).toBe(0);
    expect(out.total).toBe(12099.28);
  });

  it('owes no further CPP when openings already exceed maximums (2026)', () => {
    const out = calculateSolePropObligations({
      cumulativeCad: 200000,
      priorTax: 40000, priorCpp: 8460.9, priorCpp2: 832,
      ytdPensionableOpening: 190000, ytdCppOpening: 8460.9, ytdCpp2Opening: 832,
      taxYear: 2026,
    });
    expect(out.cpp).toBe(0);
    expect(out.cpp2).toBe(0);
    // Cumulative tax on 200000: federal 37544.25 + Ontario 16864.53 = 54408.78;
    // per-deposit tax = 54408.78 - 40000 prior = 14408.78
    expect(out.incomeTax).toBe(14408.78);
  });

  it('applies CPP2 inside the YMPE-YAMPE band (2026)', () => {
    const out = calculateSolePropObligations({
      cumulativeCad: 80000,
      priorTax: 0, priorCpp: 0, priorCpp2: 0,
      ytdPensionableOpening: 0, ytdCppOpening: 0, ytdCpp2Opening: 0,
      taxYear: 2026,
    });
    expect(out.cpp).toBe(8460.9);
    // (80000-74600)=5400 x8% = 432.00
    expect(out.cpp2).toBe(432);
  });

  it('uses 2025 tables for 2025 deposits', () => {
    const out = calculateSolePropObligations({
      cumulativeCad: 50000,
      priorTax: 0, priorCpp: 0, priorCpp2: 0,
      ytdPensionableOpening: 0, ytdCppOpening: 0, ytdCpp2Opening: 0,
      taxYear: 2025,
    });
    // Federal: (50000-16129)=33871 @14.5% = 4911.295; Ontario: (50000-12747)=37253 @5.05% = 1881.2765
    // Engine rounds the summed tax once: 6792.5715 -> 6792.57
    expect(out.incomeTax).toBe(6792.57);
    // CPP: 46500 x11.9% = 5533.50 (same rate, under 2025 max 8068.20)
    expect(out.cpp).toBe(5533.5);
    expect(out.cpp2).toBe(0);
  });

  it('floors per-deposit amounts at zero and rounds to cents', () => {
    const out = calculateSolePropObligations({
      cumulativeCad: 1000,
      priorTax: 99999, priorCpp: 99999, priorCpp2: 99999,
      ytdPensionableOpening: 0, ytdCppOpening: 0, ytdCpp2Opening: 0,
      taxYear: 2026,
    });
    expect(out.incomeTax).toBe(0);
    expect(out.cpp).toBe(0);
    expect(out.cpp2).toBe(0);
    expect(out.total).toBe(0);
  });
});
import { buildInstalmentSchedule, allocateToInstalments, gstStatus, nextQuarterlyAfter, ledgerBreakdown, validateOpenings } from './solePropEngine';

describe('buildInstalmentSchedule', () => {
  it('gives an August 2026 start an annual row then CRA quarterly rows', () => {
    const rows = buildInstalmentSchedule('2026-08-15', 2027);
    expect(rows).toEqual([
      { tax_year: 2026, due_date: '2027-04-30', kind: 'annual' },
      { tax_year: 2027, due_date: '2027-03-15', kind: 'quarterly' },
      { tax_year: 2027, due_date: '2027-06-15', kind: 'quarterly' },
      { tax_year: 2027, due_date: '2027-09-15', kind: 'quarterly' },
      { tax_year: 2027, due_date: '2027-12-15', kind: 'quarterly' },
    ]);
  });

  it('gives a January start the same first-year annual treatment', () => {
    const rows = buildInstalmentSchedule('2026-01-10', 2026);
    expect(rows).toEqual([{ tax_year: 2026, due_date: '2027-04-30', kind: 'annual' }]);
  });
});

describe('allocateToInstalments', () => {
  it('routes start-year deposits to the annual row and later deposits to the next due date', () => {
    const schedule = buildInstalmentSchedule('2026-08-15', 2027);
    const alloc = allocateToInstalments(
      [
        { received_date: '2026-09-01', tax_owed: 100, cpp_owed: 50, cpp2_owed: 0, voided: 0 },
        { received_date: '2027-02-01', tax_owed: 200, cpp_owed: 100, cpp2_owed: 10, voided: 0 },
        { received_date: '2027-04-01', tax_owed: 300, cpp_owed: 0, cpp2_owed: 0, voided: 0 },
        { received_date: '2026-10-01', tax_owed: 999, cpp_owed: 0, cpp2_owed: 0, voided: 1 },
      ],
      schedule
    );
    expect(alloc['2027-04-30']).toEqual({ tax: 100, cpp: 50, cpp2: 0, total: 150 });
    expect(alloc['2027-03-15']).toEqual({ tax: 200, cpp: 100, cpp2: 10, total: 310 });
    expect(alloc['2027-06-15']).toEqual({ tax: 300, cpp: 0, cpp2: 0, total: 300 });
    expect(alloc['2027-09-15']).toEqual({ tax: 0, cpp: 0, cpp2: 0, total: 0 });
  });
});

describe('gstStatus', () => {
  it('detects crossing with a 29-day deadline', () => {
    const status = gstStatus(
      [
        { received_date: '2026-09-15', cad_amount: 12000, voided: 0 },
        { received_date: '2026-12-01', cad_amount: 12000, voided: 0 },
        { received_date: '2027-02-10', cad_amount: 9000, voided: 0 },
      ],
      '2027-02-10'
    );
    expect(status.rollingTotal).toBe(33000);
    expect(status.crossed).toBe(true);
    expect(status.crossingDate).toBe('2027-02-10');
    expect(status.deadline).toBe('2027-03-11');
  });

  it('drops old quarters and ignores voided deposits', () => {
    const status = gstStatus(
      [
        { received_date: '2026-01-15', cad_amount: 29000, voided: 0 },
        { received_date: '2026-06-01', cad_amount: 5000, voided: 1 },
        { received_date: '2027-05-01', cad_amount: 1000, voided: 0 },
      ],
      '2027-05-01'
    );
    expect(status.rollingTotal).toBe(1000);
    expect(status.crossed).toBe(false);
    expect(status.crossingDate).toBeNull();
    expect(status.deadline).toBeNull();
  });
});

describe('nextQuarterlyAfter', () => {
  it('returns the next CRA date strictly after the given date', () => {
    expect(nextQuarterlyAfter('2027-04-30')).toBe('2027-06-15');
    expect(nextQuarterlyAfter('2027-03-15')).toBe('2027-06-15');
    expect(nextQuarterlyAfter('2027-12-15')).toBe('2028-03-15');
    expect(nextQuarterlyAfter('2027-12-20')).toBe('2028-03-15');
  });
});

describe('allocateToInstalments fallback', () => {
  it('lands deposits past the last row on the latest quarterly', () => {
    const alloc = allocateToInstalments(
      [{ received_date: '2027-12-20', tax_owed: 50, cpp_owed: 0, cpp2_owed: 0, voided: 0 }],
      [
        { tax_year: 2027, due_date: '2027-09-15', kind: 'quarterly' },
        { tax_year: 2027, due_date: '2027-12-15', kind: 'quarterly' },
      ]
    );
    expect(alloc['2027-12-15']).toEqual({ tax: 50, cpp: 0, cpp2: 0, total: 50 });
  });
});

describe('ledgerBreakdown', () => {
  it('splits each row into marginal fed/prov shares over its cumulative window', () => {
    const rows = ledgerBreakdown(
      [{ cad: 28183.61, date: '2026-09-01' }, { cad: 18803.96, date: '2026-10-01' }],
      { ytdPensionableOpening: 0, ytdCppOpening: 0 }
    );
    expect(rows).toHaveLength(2);
    // Ontario raw is 767.33, but prov is tied so fed+prov equals the stored
    // share exactly (2409.75): 2409.75 - 1642.43 = 767.32
    expect(rows[0]).toMatchObject({
      cumulativeBefore: 0, cumulativeAfter: 28183.61, fedTax: 1642.43, provTax: 767.32,
    });
    // Second dollars fully exposed: 18803.96 x14% = 2632.55 fed;
    // 18803.96 x5.05% = 949.60 prov; fed+prov ties to the stored share
    expect(rows[1]).toMatchObject({
      cumulativeBefore: 28183.61, cumulativeAfter: 46987.57, fedTax: 2632.55, provTax: 949.61,
    });
    expect(rows[0].fedTax + rows[0].provTax).toBeCloseTo(2409.75, 2);
    expect(rows[1].fedTax + rows[1].provTax).toBeCloseTo(3582.16, 2);
    // CPP room drains as pensionable accumulates
    expect(rows[0].cppRoomAfter).toBeLessThan(8460.9);
    expect(rows[1].cppRoomAfter).toBeLessThan(rows[0].cppRoomAfter);
  });
});

describe('validateOpenings', () => {
  it('accepts possible figures and rejects impossible ones', () => {
    expect(validateOpenings(0, 0, 0)).toBeNull();
    expect(validateOpenings(180000, 8460.9, 832)).toBeNull();
    expect(validateOpenings(0, 8876.9, 0)).toContain('8,460.9');
    expect(validateOpenings(0, 0, 833)).toContain('832');
  });
});
