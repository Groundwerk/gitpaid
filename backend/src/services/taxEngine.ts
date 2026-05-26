export interface TaxInputs {
  gross: number;
  ytdGross: number;
  ytdCpp: number;
  ytdEi: number;
  ytdTax: number;
  cppExempt: boolean;
  eiExempt: boolean;
  taxExempt: boolean;
  payPeriod: string;
  wsibRate: number; // e.g. 2.5 (for 2.5%)
  ehtExempt: boolean;
  ehtRate: number; // e.g. 1.95 (for 1.95%)
  vacationRate: number; // e.g. 4.0 (for 4%)
  companyYtdGross: number; // to evaluate EHT threshold
  fitExempt?: boolean;
  fitWithholdingAmount?: number;
  overrideFedTaxCredit?: boolean;
  fedTaxCreditAmount?: number;
  overrideProvTaxCredit?: boolean;
  provTaxCreditAmount?: number;
  wcbExempt?: boolean;
  wcbRate?: number;
  overrideEiEmployerRate?: number;
}

export interface TaxOutputs {
  cppEmployee: number;
  cppEmployer: number;
  eiEmployee: number;
  eiEmployer: number;
  incomeTax: number;
  wsibPremium: number;
  ehtPremium: number;
  vacationAccrued: number;
  netPay: number;
}

export function getPeriodsPerYear(payPeriod: string): number {
  switch (payPeriod.toLowerCase()) {
    case 'weekly': return 52;
    case 'bi-weekly': return 26;
    case 'semi-monthly': return 24;
    case 'monthly': return 12;
    default: return 26;
  }
}

export function calculateProgressiveTax(income: number, brackets: { threshold: number; rate: number }[]): number {
  let tax = 0;
  let remainingIncome = income;
  let previousThreshold = 0;

  for (let i = 0; i < brackets.length; i++) {
    const { threshold, rate } = brackets[i];
    const bracketSize = threshold - previousThreshold;
    const taxableInBracket = Math.min(remainingIncome, bracketSize);
    
    tax += taxableInBracket * rate;
    remainingIncome -= taxableInBracket;
    previousThreshold = threshold;

    if (remainingIncome <= 0) break;
  }

  if (remainingIncome > 0 && brackets.length > 0) {
    // Add tax for the top bracket (infinity)
    const lastBracket = brackets[brackets.length - 1];
    tax += remainingIncome * lastBracket.rate;
  }

  return tax;
}

// 2024 Federal Brackets
export const federalBrackets = [
  { threshold: 55867, rate: 0.15 },
  { threshold: 111733, rate: 0.205 },
  { threshold: 173244, rate: 0.26 },
  { threshold: 246719, rate: 0.29 },
  { threshold: Infinity, rate: 0.33 }
];

// 2024 Ontario Brackets
export const ontarioBrackets = [
  { threshold: 51446, rate: 0.0505 },
  { threshold: 102894, rate: 0.0915 },
  { threshold: 150000, rate: 0.1116 },
  { threshold: 220000, rate: 0.1216 },
  { threshold: Infinity, rate: 0.1316 }
];

export function calculatePayrollDeductions(inputs: TaxInputs): TaxOutputs {
  const {
    gross,
    ytdGross,
    ytdCpp,
    ytdEi,
    cppExempt,
    eiExempt,
    taxExempt,
    payPeriod,
    wsibRate,
    ehtExempt,
    ehtRate,
    vacationRate,
    companyYtdGross,
    fitExempt = false,
    fitWithholdingAmount = 0,
    overrideFedTaxCredit = false,
    fedTaxCreditAmount = 15705,
    overrideProvTaxCredit = false,
    provTaxCreditAmount = 12399,
    wcbExempt = false,
    wcbRate = 0,
    overrideEiEmployerRate = 1.4
  } = inputs;

  const periodsPerYear = getPeriodsPerYear(payPeriod);

  // 1. CPP Calculation
  let cppEmployee = 0;
  let cppEmployer = 0;
  if (!cppExempt) {
    const annualMaxCPP = 3867.50; // 2024 employee max
    const annualExemption = 3500;
    const periodExemption = annualExemption / periodsPerYear;
    const contributoryEarnings = Math.max(0, gross - periodExemption);
    
    const remainingContribution = Math.max(0, annualMaxCPP - ytdCpp);
    const calculatedCPP = contributoryEarnings * 0.0595;
    cppEmployee = Math.min(calculatedCPP, remainingContribution);
    cppEmployer = cppEmployee; // 1:1 match
  }

  // 2. EI Calculation
  let eiEmployee = 0;
  let eiEmployer = 0;
  if (!eiExempt) {
    const annualMaxEI = 1049.12; // 2024 employee max
    const remainingContribution = Math.max(0, annualMaxEI - ytdEi);
    const calculatedEI = gross * 0.0166;
    eiEmployee = Math.min(calculatedEI, remainingContribution);
    eiEmployer = eiEmployee * overrideEiEmployerRate;
  }

  // 3. Vacation Pay Accrual
  const vacationAccrued = gross * (vacationRate / 100);

  // 4. Income Tax (Federal + Provincial)
  let incomeTax = 0;
  if (!taxExempt) {
    if (!fitExempt) {
      const annualizedGross = gross * periodsPerYear;
      
      const fedCredit = overrideFedTaxCredit ? fedTaxCreditAmount : 15705;
      const provCredit = overrideProvTaxCredit ? provTaxCreditAmount : 12399;

      const fedTaxable = Math.max(0, annualizedGross - fedCredit);
      const provTaxable = Math.max(0, annualizedGross - provCredit);

      const federalTaxAnnual = calculateProgressiveTax(fedTaxable, federalBrackets);
      const ontarioTaxAnnual = calculateProgressiveTax(provTaxable, ontarioBrackets);

      const totalTaxAnnual = federalTaxAnnual + ontarioTaxAnnual;
      incomeTax = totalTaxAnnual / periodsPerYear;
    }
    incomeTax += fitWithholdingAmount;
  }

  // 5. WSIB (Employer Paid)
  let wsibPremium = 0;
  const wsibCeiling = 112500;
  if (!wcbExempt && ytdGross < wsibCeiling) {
    const insurableEarnings = Math.min(gross, wsibCeiling - ytdGross);
    const effectiveWsibRate = (wcbRate > 0) ? wcbRate : wsibRate;
    wsibPremium = insurableEarnings * (effectiveWsibRate / 100);
  }

  // 6. EHT (Employer Paid)
  let ehtPremium = 0;
  if (ehtExempt) {
    const exemptionThreshold = 1000000;
    if (companyYtdGross + gross > exemptionThreshold) {
      const taxablePortion = Math.max(0, (companyYtdGross + gross) - Math.max(companyYtdGross, exemptionThreshold));
      ehtPremium = taxablePortion * (ehtRate / 100);
    }
  } else {
    ehtPremium = gross * (ehtRate / 100);
  }

  // Round all values to 2 decimal places
  cppEmployee = Math.round(cppEmployee * 100) / 100;
  cppEmployer = Math.round(cppEmployer * 100) / 100;
  eiEmployee = Math.round(eiEmployee * 100) / 100;
  eiEmployer = Math.round(eiEmployer * 100) / 100;
  incomeTax = Math.round(incomeTax * 100) / 100;
  wsibPremium = Math.round(wsibPremium * 100) / 100;
  ehtPremium = Math.round(ehtPremium * 100) / 100;
  const vacationRounded = Math.round(vacationAccrued * 100) / 100;

  // Net Pay calculation
  const netPay = Math.round((gross - cppEmployee - eiEmployee - incomeTax) * 100) / 100;

  return {
    cppEmployee,
    cppEmployer,
    eiEmployee,
    eiEmployer,
    incomeTax,
    wsibPremium,
    ehtPremium,
    vacationAccrued: vacationRounded,
    netPay
  };
}
