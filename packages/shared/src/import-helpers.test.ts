import { describe, it, expect } from 'vitest';
import {
  importParseDate,
  importNormalizeUom,
  importUomPerPallet,
  importHeaderIndex,
  importResolveCol,
  importDetectHeader,
  importIsMetaRow,
  inferUom,
} from './import-helpers';

describe('importParseDate', () => {
  it('returns null for empty/zero', () => {
    expect(importParseDate(null)).toBeNull();
    expect(importParseDate(undefined)).toBeNull();
    expect(importParseDate('')).toBeNull();
    expect(importParseDate('0')).toBeNull();
  });

  it('parses ISO yyyy-mm-dd', () => {
    expect(importParseDate('2026-08-13')).toBe('2026-08-13');
  });

  it('parses dd/mm/yyyy (day > 12)', () => {
    expect(importParseDate('13/08/2026')).toBe('2026-08-13');
  });

  it('parses mm/dd/yyyy (month > 12)', () => {
    expect(importParseDate('08/13/2026')).toBe('2026-08-13');
  });

  it('parses ambiguous dd/mm/yyyy as month-first', () => {
    expect(importParseDate('08/09/2026')).toBe('2026-09-08');
  });

  it('parses dd-mm-yyyy', () => {
    expect(importParseDate('13-08-2026')).toBe('2026-08-13');
  });

  it('parses Excel serial numbers (2026-08-13 => 46247)', () => {
    expect(importParseDate(46247)).toBe('2026-08-13');
  });

  it('rejects out-of-range Excel serials', () => {
    expect(importParseDate(100)).toBeNull();
  });
});

describe('importNormalizeUom', () => {
  it('maps aliases', () => {
    expect(importNormalizeUom('car')).toBe('Carton');
    expect(importNormalizeUom('drm')).toBe('Drum');
    expect(importNormalizeUom('pail')).toBe('Pail');
    expect(importNormalizeUom('pcs')).toBe('EA');
  });

  it('capitalizes unknown and falls back', () => {
    expect(importNormalizeUom('fluidbag')).toBe('Fluidbag');
    expect(importNormalizeUom(undefined, 'Drum')).toBe('Drum');
    expect(importNormalizeUom('', 'IBC')).toBe('IBC');
  });
});

describe('importUomPerPallet', () => {
  it('uses fixed pallet factors', () => {
    expect(importUomPerPallet('Drum')).toBe(4);
    expect(importUomPerPallet('Pail')).toBe(24);
    expect(importUomPerPallet('Bags')).toBe(1);
  });

  it('uses product factor for carton and defaults', () => {
    expect(importUomPerPallet('Carton', 44)).toBe(44);
    expect(importUomPerPallet('Carton', 0)).toBe(44);
    expect(importUomPerPallet('Fluidbag', 4)).toBe(4);
  });
});

describe('importHeaderIndex / importResolveCol', () => {
  it('indexes lowercase header names, strips leading *', () => {
    const map = importHeaderIndex(['* Product', 'Qty', '  Expired Date']);
    expect(map['product']).toBe(0);
    expect(map['qty']).toBe(1);
    expect(map['expired date']).toBe(2);
  });

  it('resolves columns by priority, preferring exact matches', () => {
    const headers = ['Item', 'Description', 'Item Code'];
    expect(importResolveCol(headers, ['item code', 'item'])).toBe(2);
    expect(importResolveCol(headers, ['item'])).toBe(0);
    expect(importResolveCol(headers, ['nonexistent'])).toBeNull();
  });
});

describe('importDetectHeader / importIsMetaRow', () => {
  it('detects the row with most header keywords', () => {
    const rows = [
      ['Kolom', 'Format', 'Nama'],
      ['Lokasi', 'Qty', 'Item', 'Batch No', 'Expired Date'],
      ['CA01A01', '4', '550058593', 'B1', '2030-06-22'],
    ];
    const { index } = importDetectHeader(rows);
    expect(index).toBe(1);
  });

  it('treats empty or instruction rows as meta', () => {
    expect(importIsMetaRow([])).toBe(true);
    expect(importIsMetaRow(['* nama', 'x'])).toBe(true);
    expect(importIsMetaRow(['Petunjuk pengisian'])).toBe(true);
    expect(importIsMetaRow(['CA01A01', '4'])).toBe(false);
  });
});

describe('inferUom', () => {
  it('infers by units per pallet', () => {
    expect(inferUom(1)).toBe('Bags');
    expect(inferUom(4)).toBe('Drum');
    expect(inferUom(24)).toBe('Pail');
    expect(inferUom(44)).toBe('Carton');
  });
});