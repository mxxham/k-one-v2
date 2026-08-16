import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { addYears, daysUntil, parseDateLiteral } from './date-util';

describe('addYears', () => {
  it('adds years keeping the day', () => {
    expect(addYears('2026-08-13', 4)).toBe('2030-08-13');
  });

  it('clamps Feb 29 to Feb 28 on non-leap years', () => {
    expect(addYears('2028-02-29', 1)).toBe('2029-02-28');
  });

  it('defaults to 4 years', () => {
    expect(addYears('2026-06-22')).toBe('2030-06-22');
  });

  it('returns null for malformed input', () => {
    expect(addYears('')).toBeNull();
    expect(addYears('not-a-date')).toBeNull();
    expect(addYears('2026-8-13')).toBeNull();
  });

  it('clamps days but keeps out-of-range months as-is (format-only validation)', () => {
    expect(addYears('2026-13-99', 4)).toBe('2030-13-31');
  });
});

describe('parseDateLiteral', () => {
  it('normalizes yyyy/mm/dd and yyyy-mm-dd', () => {
    expect(parseDateLiteral('2026/08/13')).toBe('2026-08-13');
    expect(parseDateLiteral('2026-08-13')).toBe('2026-08-13');
  });

  it('returns null for empty / zero / garbage', () => {
    expect(parseDateLiteral(null)).toBeNull();
    expect(parseDateLiteral('')).toBeNull();
    expect(parseDateLiteral('0')).toBeNull();
    expect(parseDateLiteral('abc')).toBeNull();
  });
});

describe('daysUntil', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-13T00:00:00Z'));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('computes positive days to expiry', () => {
    expect(daysUntil('2026-08-20')).toBe(7);
  });

  it('computes negative days for expired', () => {
    expect(daysUntil('2026-08-10')).toBe(-3);
  });

  it('handles same-day and nulls', () => {
    expect(daysUntil('2026-08-13')).toBe(0);
    expect(daysUntil(null)).toBeNull();
    expect(daysUntil('bad')).toBeNull();
  });
});