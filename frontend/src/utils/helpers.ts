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

export function formatSIN(val: string): string {
  const digits = val.replace(/\D/g, '').slice(0, 9);
  if (digits.length <= 3) return digits;
  if (digits.length <= 6) return `${digits.slice(0, 3)}-${digits.slice(3)}`;
  return `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}`;
}

export function formatBusinessNumber(val: string): string {
  const raw = val.replace(/[^a-zA-Z0-9]/g, '');
  
  let p1 = '';
  let p2 = '';
  let p3 = '';
  
  let i = 0;
  
  // Extract up to 9 digits for part 1
  for (; i < raw.length && p1.length < 9; i++) {
    if (/[0-9]/.test(raw[i])) {
      p1 += raw[i];
    }
  }
  
  // Extract up to 2 letters for part 2 (program code)
  for (; i < raw.length && p2.length < 2; i++) {
    if (/[a-zA-Z]/.test(raw[i])) {
      p2 += raw[i].toUpperCase();
    }
  }
  
  // Extract up to 4 digits for part 3
  for (; i < raw.length && p3.length < 4; i++) {
    if (/[0-9]/.test(raw[i])) {
      p3 += raw[i];
    }
  }
  
  if (p1.length < 9) {
    return p1;
  }
  if (p2.length === 0) {
    return p1;
  }
  if (p3.length === 0) {
    return `${p1} ${p2}`;
  }
  return `${p1} ${p2} ${p3}`;
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

