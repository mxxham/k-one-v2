import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fmtNum, fmtDate, fmtDateTime, todayISO, expiryInfo, roleLabel, money } from './format';

describe('fmtNum', () => {
  it('formats numbers with thousands separators', () => {
    expect(fmtNum(1234.5)).toBe('1,234.5');
  });

  it('handles strings, undefined, null, and NaN', () => {
    expect(fmtNum('999')).toBe('999');
    expect(fmtNum(undefined)).toBe('0');
    expect(fmtNum(null)).toBe('0');
    expect(fmtNum('abc')).toBe('0');
  });

  it('respects digit limits', () => {
    expect(fmtNum(1.23456, 2)).toBe('1.23');
    expect(fmtNum(1.5, 0)).toBe('2');
  });
});

describe('fmtDate', () => {
  it('renders a dash for empty values', () => {
    expect(fmtDate(null)).toBe('—');
    expect(fmtDate(undefined)).toBe('—');
    expect(fmtDate('')).toBe('—');
  });

  it('formats a date in day-month-year order', () => {
    expect(fmtDate('2026-08-17')).toMatch(/^17 \w+ 2026$/);
  });

  it('returns the raw value when the date cannot be parsed', () => {
    expect(fmtDate('not-a-date')).toBe('not-a-date');
  });
});

describe('fmtDateTime', () => {
  it('renders a dash for empty values', () => {
    expect(fmtDateTime(null)).toBe('—');
  });

  it('includes date and time', () => {
    const out = fmtDateTime('2026-08-17T09:05:00');
    expect(out).toContain('2026');
    expect(out).toMatch(/09:05/);
  });

  it('returns the raw value for unparseable input', () => {
    expect(fmtDateTime('garbage')).toBe('garbage');
  });
});

describe('todayISO', () => {
  it('returns the current date in ISO format', () => {
    expect(todayISO()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(todayISO()).toBe(new Date().toISOString().slice(0, 10));
  });
});

describe('expiryInfo', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-17T00:00:00Z'));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('reports none for a missing expiry', () => {
    expect(expiryInfo(null)).toEqual({ text: 'No expiry', level: 'none' });
    expect(expiryInfo('')).toEqual({ text: 'No expiry', level: 'none' });
  });

  it('flags expired products', () => {
    expect(expiryInfo('2026-08-10')).toEqual({ text: 'Expired 7d ago', level: 'expired' });
  });

  it('flags critical under 120 days', () => {
    const info = expiryInfo('2026-10-01');
    expect(info.level).toBe('critical');
    expect(info.text).toBe('45d left');
  });

  it('flags warning under 180 days', () => {
    const info = expiryInfo('2027-01-01');
    expect(info.level).toBe('warning');
    expect(info.text).toBe('137d left');
  });

  it('reports ok beyond 180 days in months', () => {
    const info = expiryInfo('2027-08-17');
    expect(info.level).toBe('ok');
    expect(info.text).toBe('12m left');
  });
});

describe('roleLabel', () => {
  it('capitalizes the role', () => {
    expect(roleLabel('admin')).toBe('Admin');
    expect(roleLabel('warehouse')).toBe('Warehouse');
  });

  it('falls back to viewer for empty input', () => {
    expect(roleLabel('')).toBe('Viewer');
    expect(roleLabel(undefined as any)).toBe('Viewer');
  });
});

describe('money', () => {
  it('formats as an integer', () => {
    expect(money(12345.67)).toBe('12,346');
    expect(money(0)).toBe('0');
    expect(money(undefined)).toBe('0');
  });
});
