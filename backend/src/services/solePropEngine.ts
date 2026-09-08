import { tablesForYear, type Bracket } from './solePropTaxTables';

export interface SolePropInputs {
  cumulativeCad: number;
  priorTax: number;
  priorCpp: number;
  priorCpp2: number;
  ytdPensionableOpening: number;
  ytdCppOpening: number;
  ytdCpp2Opening: number;
  taxYear: number;
}

export interface SolePropOutputs {
  incomeTax: number;
  cpp: number;
  cpp2: number;
  total: number;
}

const round2 = (x: number) => Math.round(x * 100) / 100;

function progressiveTax(income: number, brackets: Bracket[]): number {
  let tax = 0;
  let remaining = income;
  let prev = 0;
  for (const { threshold, rate } of brackets) {
    const taxable = Math.min(remaining, threshold - prev);
    tax += taxable * rate;
    remaining -= taxable;
    prev = threshold;
    if (remaining <= 0) break;
  }
  if (remaining > 0) tax += remaining * brackets[brackets.length - 1].rate;
  return tax;
}

export function calculateSolePropObligations(i: SolePropInputs): SolePropOutputs {
  const t = tablesForYear(i.taxYear);
  const fedTaxable = Math.max(0, i.cumulativeCad - t.fedBPA);
  const provTaxable = Math.max(0, i.cumulativeCad - t.provCredit);
  const cumTax = round2(
    progressiveTax(fedTaxable, t.federalBrackets) +
    progressiveTax(provTaxable, t.ontarioBrackets)
  );
  const totalPensionable = i.ytdPensionableOpening + i.cumulativeCad;
  const contributory = Math.max(0, Math.min(totalPensionable, t.ympe) - t.ybe);
  const cumCpp = Math.min(round2(contributory * t.cppSelfRate), t.cppSelfMax);
  const band = Math.max(0, Math.min(totalPensionable, t.yampe) - t.ympe);
  const cumCpp2 = Math.min(round2(band * t.cpp2SelfRate), t.cpp2SelfMax);
  const incomeTax = Math.max(0, round2(cumTax - i.priorTax));
  const cpp = Math.max(0, round2(cumCpp - i.ytdCppOpening - i.priorCpp));
  const cpp2 = Math.max(0, round2(cumCpp2 - i.ytdCpp2Opening - i.priorCpp2));
  return { incomeTax, cpp, cpp2, total: round2(incomeTax + cpp + cpp2) };
}
