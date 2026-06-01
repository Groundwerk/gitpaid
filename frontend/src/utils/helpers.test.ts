import { describe, it, expect } from 'vitest';
import {
  cleanSIN,
  formatSIN,
  cleanBusinessNumber,
  formatBusinessNumber,
  cleanPhone,
  formatPhone,
  cleanPostalCode,
  formatPostalCode
} from './helpers';

describe('Formatting and Cleaning Helpers', () => {
  describe('SIN', () => {
    it('cleans formatted SIN correctly', () => {
      expect(cleanSIN('123-456-789')).toBe('123456789');
      expect(cleanSIN('123 456 789')).toBe('123456789');
      expect(cleanSIN('')).toBe('');
    });

    it('formats raw SIN correctly', () => {
      expect(formatSIN('123456789')).toBe('123-456-789');
      expect(formatSIN('123')).toBe('123');
      expect(formatSIN('12345')).toBe('123-45');
    });
  });

  describe('Business Number (BN15)', () => {
    it('cleans formatted business number correctly', () => {
      expect(cleanBusinessNumber('123456789 RP 0001')).toBe('123456789RP0001');
      expect(cleanBusinessNumber('123456789-rp-0001')).toBe('123456789RP0001');
    });

    it('formats raw business number correctly', () => {
      expect(formatBusinessNumber('123456789RP0001')).toBe('123456789 RP 0001');
      expect(formatBusinessNumber('123456789')).toBe('123456789');
      expect(formatBusinessNumber('123456789R')).toBe('123456789 R');
      expect(formatBusinessNumber('123456789RP')).toBe('123456789 RP');
    });
  });

  describe('Phone Number (North American)', () => {
    it('cleans various formats to raw digits', () => {
      expect(cleanPhone('416-555-0199')).toBe('4165550199');
      expect(cleanPhone('14165550199')).toBe('14165550199');
      expect(cleanPhone('1 (416) 555-0199')).toBe('14165550199');
    });

    it('formats raw phone numbers correctly', () => {
      expect(formatPhone('14165550199')).toBe('1 (416) 555-0199');
      expect(formatPhone('1416')).toBe('1 (416');
      expect(formatPhone('1416555')).toBe('1 (416) 555');
      expect(formatPhone('141655501')).toBe('1 (416) 555-01');
      expect(formatPhone('4165550199')).toBe('(416) 555-0199');
      expect(formatPhone('416555')).toBe('(416) 555');
    });
  });

  describe('Postal Code', () => {
    it('cleans formatted postal codes correctly', () => {
      expect(cleanPostalCode('M5H 2Y2')).toBe('M5H2Y2');
      expect(cleanPostalCode('m5h-2y2')).toBe('M5H2Y2');
      expect(cleanPostalCode('M5H2Y2')).toBe('M5H2Y2');
    });

    it('formats raw postal codes correctly', () => {
      expect(formatPostalCode('M5H2Y2')).toBe('M5H 2Y2');
      expect(formatPostalCode('M5H')).toBe('M5H');
      expect(formatPostalCode('M5H2')).toBe('M5H 2');
    });
  });
});
