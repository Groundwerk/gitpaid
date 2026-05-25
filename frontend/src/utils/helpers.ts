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
