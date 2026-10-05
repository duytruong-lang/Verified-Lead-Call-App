import { describe, expect, it } from 'vitest';
import { parseSheetDate } from './core';

describe('Sheet locale date parsing', () => {
  it('parses Vietnamese day-first local date/time with spreadsheet timezone', () => {
    expect(parseSheetDate('06/10/2026 15:05:00', 'vi_VN', 'Asia/Ho_Chi_Minh')).toBe('2026-10-06T15:05:00+07:00');
  });
  it('keeps ISO timestamps explicit and missing dates empty', () => {
    expect(parseSheetDate('2026-10-06T08:05:00Z')).toBe('2026-10-06T08:05:00.000Z');
    expect(parseSheetDate('  ')).toBeNull();
  });
  it('rejects malformed or locale-ambiguous input instead of swapping fields', () => {
    expect(() => parseSheetDate('31/02/2026')).toThrow('Malformed Sheet date');
    expect(() => parseSheetDate('not a date')).toThrow('Malformed Sheet date');
    expect(parseSheetDate('03/04/2026', 'en-US', 'America/Los_Angeles')).toBe('2026-03-04T00:00:00-08:00');
  });
});
