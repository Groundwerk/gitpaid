export interface Bracket { threshold: number; rate: number; }
export interface SolePropTaxTables {
  federalBrackets: Bracket[];
  ontarioBrackets: Bracket[];
  fedBPA: number;
  provCredit: number;
  ybe: number;
  ympe: number;
  yampe: number;
  cppSelfRate: number;
  cppSelfMax: number;
  cpp2SelfRate: number;
  cpp2SelfMax: number;
}

const TABLES_2026: SolePropTaxTables = {
  federalBrackets: [
    { threshold: 58523, rate: 0.14 },
    { threshold: 117045, rate: 0.205 },
    { threshold: 181440, rate: 0.26 },
    { threshold: 258482, rate: 0.29 },
    { threshold: Infinity, rate: 0.33 },
  ],
  ontarioBrackets: [
    { threshold: 53891, rate: 0.0505 },
    { threshold: 107785, rate: 0.0915 },
    { threshold: 150000, rate: 0.1116 },
    { threshold: 220000, rate: 0.1216 },
    { threshold: Infinity, rate: 0.1316 },
  ],
  fedBPA: 16452,
  provCredit: 12989,
  ybe: 3500,
  ympe: 74600,
  yampe: 85000,
  cppSelfRate: 0.119,
  cppSelfMax: 8460.9,
  cpp2SelfRate: 0.08,
  cpp2SelfMax: 832,
};

const TABLES_2025: SolePropTaxTables = {
  federalBrackets: [
    { threshold: 57375, rate: 0.145 },
    { threshold: 114750, rate: 0.205 },
    { threshold: 177882, rate: 0.26 },
    { threshold: 253414, rate: 0.29 },
    { threshold: Infinity, rate: 0.33 },
  ],
  ontarioBrackets: [
    { threshold: 52886, rate: 0.0505 },
    { threshold: 105775, rate: 0.0915 },
    { threshold: 150000, rate: 0.1116 },
    { threshold: 220000, rate: 0.1216 },
    { threshold: Infinity, rate: 0.1316 },
  ],
  fedBPA: 16129,
  provCredit: 12747,
  ybe: 3500,
  ympe: 71300,
  yampe: 81200,
  cppSelfRate: 0.119,
  cppSelfMax: 8068.2,
  cpp2SelfRate: 0.08,
  cpp2SelfMax: 792,
};

export function tablesForYear(year: number): SolePropTaxTables {
  if (year === 2025) return TABLES_2025;
  return TABLES_2026;
}
