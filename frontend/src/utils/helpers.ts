export function sanitizeNumericInput(val: string): string {
  if (val === '') return '';
  
  // Remove any character that is not a digit, dot, or minus sign
  let sanitized = val.replace(/[^0-9.-]/g, '');
  
  // Prevent multiple dots
  const parts = sanitized.split('.');
  if (parts.length > 2) {
    sanitized = parts[0] + '.' + parts.slice(1).join('');
  }
  
  // Remove leading zeros, unless it is "0" or starts with "0."
  // e.g. "05" -> "5", "00" -> "0", "00.5" -> "0.5"
  if (sanitized.startsWith('0') && sanitized.length > 1 && sanitized[1] !== '.') {
    sanitized = sanitized.replace(/^0+/, '');
    if (sanitized === '' || sanitized.startsWith('.')) {
      sanitized = '0' + sanitized;
    }
  }
  
  return sanitized;
}

export function cleanSIN(val: string): string {
  return val.replace(/\D/g, '').slice(0, 9);
}

export function formatSIN(val: string): string {
  const digits = cleanSIN(val);
  if (digits.length <= 3) return digits;
  if (digits.length <= 6) return `${digits.slice(0, 3)}-${digits.slice(3)}`;
  return `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}`;
}

export function cleanBusinessNumber(val: string): string {
  return val.replace(/[^a-zA-Z0-9]/g, '').toUpperCase().slice(0, 15);
}

export function formatBusinessNumber(val: string): string {
  const clean = cleanBusinessNumber(val);
  if (clean.length <= 9) {
    return clean;
  }
  const p1 = clean.slice(0, 9);
  if (clean.length <= 11) {
    const p2 = clean.slice(9);
    return `${p1} ${p2}`;
  }
  const p2 = clean.slice(9, 11);
  const p3 = clean.slice(11);
  return `${p1} ${p2} ${p3}`;
}

export function cleanPhone(val: string): string {
  const cleaned = val.replace(/\D/g, '');
  if (!cleaned) return '';
  
  if (cleaned.startsWith('1')) {
    return cleaned.slice(0, 11);
  }
  return cleaned.slice(0, 10);
}

export function formatPhone(val: string): string {
  const cleaned = cleanPhone(val);
  if (!cleaned) return '';
  
  if (cleaned.startsWith('1')) {
    const rest = cleaned.slice(1);
    if (rest.length === 0) return '1';
    if (rest.length <= 3) return `1 (${rest}`;
    if (rest.length <= 6) return `1 (${rest.slice(0, 3)}) ${rest.slice(3)}`;
    return `1 (${rest.slice(0, 3)}) ${rest.slice(3, 6)}-${rest.slice(6, 10)}`;
  }
  
  if (cleaned.length <= 3) return cleaned;
  if (cleaned.length <= 6) return `(${cleaned.slice(0, 3)}) ${cleaned.slice(3)}`;
  return `(${cleaned.slice(0, 3)}) ${cleaned.slice(3, 6)}-${cleaned.slice(6, 10)}`;
}

export function cleanPostalCode(val: string): string {
  return val.replace(/[^a-zA-Z0-9]/g, '').toUpperCase().slice(0, 6);
}

export function formatPostalCode(val: string): string {
  const clean = cleanPostalCode(val);
  if (clean.length <= 3) return clean;
  return `${clean.slice(0, 3)} ${clean.slice(3)}`;
}

export const ON_HST_RATE = 0.13;

export function openingYear(startDate: string): number {
  const y = Number(String(startDate).slice(0, 4));
  return Number.isFinite(y) && y > 2000 ? y : new Date().getFullYear();
}

export function hstFromPortion(cadAmount: number, portionPercent: number): number {
  return Math.round(cadAmount * ON_HST_RATE * (portionPercent / 100) * 100) / 100;
}

export function formatCurrencyInput(val: string): string {
  const digits = val.replace(/\D/g, '');
  if (!digits) return '';
  const num = parseInt(digits, 10);
  return new Intl.NumberFormat('en-CA', {
    style: 'currency',
    currency: 'CAD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0
  }).format(num);
}

