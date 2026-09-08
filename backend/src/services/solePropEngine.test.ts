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
