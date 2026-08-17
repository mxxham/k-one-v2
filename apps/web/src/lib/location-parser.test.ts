import { describe, it, expect } from 'vitest';
import {
  parseLocation,
  getLevelName,
  getLevelColor,
  formatLocationDisplay,
  sortLocations,
  groupLocationsByRack,
  getAccessibilityScore,
  suggestBestLocation,
} from './location-parser';

describe('parseLocation', () => {
  it('parses a valid CD01A02 code into structured parts', () => {
    const p = parseLocation('CD01A02');
    expect(p.isValid).toBe(true);
    expect(p.rack).toBe('CD');
    expect(p.rackNumber).toBe('01');
    expect(p.level).toBe('A');
    expect(p.position).toBe('02');
    expect(p.fullRack).toBe('CD01');
    expect(p.displayShort).toBe('CD-A');
    expect(p.displayFull).toBe('CD01-A-02');
    expect(p.levelHeight).toBe(1);
    expect(p.original).toBe('CD01A02');
  });

  it('uppercases and trims input', () => {
    expect(parseLocation('  cd01e03 ').level).toBe('E');
    expect(parseLocation('  cd01e03 ').original).toBe('CD01E03');
  });

  it('maps levels A-E to heights 1-5', () => {
    expect(parseLocation('CA01A01').levelHeight).toBe(1);
    expect(parseLocation('CA01B01').levelHeight).toBe(2);
    expect(parseLocation('CA01C01').levelHeight).toBe(3);
    expect(parseLocation('CA01D01').levelHeight).toBe(4);
    expect(parseLocation('CA01E01').levelHeight).toBe(5);
  });

  it('returns invalid for malformed codes', () => {
    for (const bad of ['', 'CD01A0', 'CD1A02', 'XCD01A02', 'CD01X02', 'CD0102', 'cd01a01x']) {
      const p = parseLocation(bad);
      expect(p.isValid).toBe(false);
      expect(p.levelHeight).toBe(0);
    }
  });

  it('keeps the original text in the invalid response', () => {
    const p = parseLocation('ZZTOP');
    expect(p.isValid).toBe(false);
    expect(p.displayShort).toBe('ZZTOP');
  });
});

describe('getLevelName', () => {
  it('returns human readable names', () => {
    expect(getLevelName('A')).toBe('Bottom');
    expect(getLevelName('B')).toBe('Lower');
    expect(getLevelName('C')).toBe('Middle');
    expect(getLevelName('D')).toBe('Upper');
    expect(getLevelName('E')).toBe('Top');
  });

  it('is case-insensitive and falls back to the raw value', () => {
    expect(getLevelName('a')).toBe('Bottom');
    expect(getLevelName('Z')).toBe('Z');
  });
});

describe('getLevelColor', () => {
  it('returns a Tailwind class per level', () => {
    expect(getLevelColor('A')).toContain('emerald');
    expect(getLevelColor('C')).toContain('yellow');
    expect(getLevelColor('E')).toContain('red');
  });

  it('returns a neutral fallback for unknown levels', () => {
    expect(getLevelColor('Z')).toContain('gray');
  });
});

describe('formatLocationDisplay', () => {
  it('formats short / full / detailed', () => {
    expect(formatLocationDisplay('CD01A02', 'short')).toBe('CD-A');
    expect(formatLocationDisplay('CD01A02', 'full')).toBe('CD01-A-02');
    expect(formatLocationDisplay('CD01A02', 'detailed')).toBe('CD01 • Level A (Bottom) • Pos 02');
  });

  it('defaults to short and returns raw text for invalid codes', () => {
    expect(formatLocationDisplay('CD01A02')).toBe('CD-A');
    expect(formatLocationDisplay('garbage')).toBe('garbage');
  });
});

describe('sortLocations', () => {
  it('sorts by rack, rack number, level (bottom-up), then position', () => {
    const input = ['CD02A01', 'CA01E01', 'CD01A02', 'CD01A01', 'CD01B01'];
    const sorted = sortLocations([...input]);
    expect(sorted).toEqual(['CA01E01', 'CD01A01', 'CD01A02', 'CD01B01', 'CD02A01']);
  });

  it('pushes invalid locations to the end', () => {
    const sorted = sortLocations(['ZZZ', 'CA01A01', 'BAD']);
    expect(sorted).toEqual(['CA01A01', 'ZZZ', 'BAD']);
  });

  it('does not throw on an empty array', () => {
    expect(sortLocations([])).toEqual([]);
  });
});

describe('groupLocationsByRack', () => {
  it('groups by full rack and ignores invalid codes', () => {
    const groups = groupLocationsByRack(['CD01A01', 'CD01B01', 'CA02A01', 'BOGUS']);
    expect(Object.keys(groups).sort()).toEqual(['CA02', 'CD01']);
    expect(groups['CD01']).toEqual(['CD01A01', 'CD01B01']);
  });

  it('returns an empty object for no valid locations', () => {
    expect(groupLocationsByRack([])).toEqual({});
    expect(groupLocationsByRack(['NOPE'])).toEqual({});
  });
});

describe('getAccessibilityScore', () => {
  it('scores lower levels higher', () => {
    expect(getAccessibilityScore('CA01A01')).toBe(5);
    expect(getAccessibilityScore('CA01B01')).toBe(4);
    expect(getAccessibilityScore('CA01C01')).toBe(3);
    expect(getAccessibilityScore('CA01D01')).toBe(2);
    expect(getAccessibilityScore('CA01E01')).toBe(1);
  });

  it('returns 0 for invalid locations', () => {
    expect(getAccessibilityScore('NOPE')).toBe(0);
  });
});

describe('suggestBestLocation', () => {
  it('picks the most accessible (lowest level) location', () => {
    expect(suggestBestLocation(['CA01E01', 'CA01B01', 'CA01A01'])).toBe('CA01A01');
  });

  it('returns null for an empty list', () => {
    expect(suggestBestLocation([])).toBeNull();
  });
});
