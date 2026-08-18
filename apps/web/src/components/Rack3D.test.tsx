import { describe, it, expect } from 'vitest';
import { bayNumber, computeLayout, zoneColor, functionColor, type Bin3D } from './Rack3D';

function bin(partial: Partial<Bin3D>): Bin3D {
  return {
    location_code: 'CA01A01',
    aisle: 'CA',
    rack: 'CA01',
    level: 'A',
    position: '01',
    zone_code: null,
    is_pick_face: 0,
    equipment_accessible: 0,
    occupied: 0,
    quantity: 0,
    pallet_function: null,
    product_code: null,
    product_name: null,
    batch_number: null,
    blocked: 0,
    block_reason: null,
    ...partial,
  };
}

describe('bayNumber', () => {
  it('extracts the trailing numeric bay from a rack code', () => {
    expect(bayNumber('CA01')).toBe(1);
    expect(bayNumber('CG40')).toBe(40);
    expect(bayNumber('CE19')).toBe(19);
  });

  it('defaults to 1 when no digits present', () => {
    expect(bayNumber('')).toBe(1);
    expect(bayNumber('QUA')).toBe(1);
  });
});

describe('computeLayout', () => {
  it('places bins at distinct positions for position 01 vs 02', () => {
    const a = bin({ location_code: 'CA01A01', rack: 'CA01', position: '01' });
    const b = bin({ location_code: 'CA01A02', rack: 'CA01', position: '02' });
    const { byCode } = computeLayout([a, b]);
    expect(byCode['CA01A01'][0]).not.toBe(byCode['CA01A02'][0]);
    expect(byCode['CA01A01'][1]).toBe(byCode['CA01A02'][1]);
    expect(byCode['CA01A01'][2]).toBe(byCode['CA01A02'][2]);
  });

  it('stacks levels A-E on increasing y', () => {
    const bins = ['A', 'B', 'C', 'D', 'E'].map((lv) => bin({ location_code: `CA01${lv}01`, rack: 'CA01', level: lv }));
    const { byCode } = computeLayout(bins);
    const ys = ['A', 'B', 'C', 'D', 'E'].map((lv) => byCode[`CA01${lv}01`][1]);
    for (let i = 1; i < ys.length; i++) expect(ys[i]).toBeGreaterThan(ys[i - 1]);
  });

  it('spreads bays along z centered per aisle', () => {
    const bins = [
      bin({ location_code: 'CA01A01', rack: 'CA01' }),
      bin({ location_code: 'CA40A01', rack: 'CA40' }),
      bin({ location_code: 'CB01A01', aisle: 'CB', rack: 'CB01' }),
      bin({ location_code: 'CB40A01', aisle: 'CB', rack: 'CB40' }),
    ];
    const { byCode } = computeLayout(bins);
    expect(byCode['CA01A01'][2]).not.toBe(byCode['CA40A01'][2]);
    expect(byCode['CB01A01'][2]).not.toBe(byCode['CB40A01'][2]);
    // Same bay number with the same bay range shares the same z (per-aisle centering)
    expect(byCode['CA01A01'][2]).toBe(byCode['CB01A01'][2]);
    expect(byCode['CA40A01'][2]).toBe(byCode['CB40A01'][2]);
  });

  it('places different aisles on different x', () => {
    const bins = [
      bin({ location_code: 'CA01A01', rack: 'CA01', aisle: 'CA' }),
      bin({ location_code: 'CG01A01', rack: 'CG01', aisle: 'CG' }),
    ];
    const { byCode } = computeLayout(bins);
    expect(byCode['CA01A01'][0]).not.toBe(byCode['CG01A01'][0]);
  });
});

describe('zoneColor', () => {
  it('maps known zones and treats empty bins as neutral', () => {
    expect(zoneColor('PICK_FAST')).toBe('#10b981');
    expect(zoneColor('RESERVE')).toBe('#f59e0b');
    expect(zoneColor('BULK')).toBe('#3b82f6');
    expect(zoneColor('UNKNOWN')).toBe('#94a3b8');
    expect(zoneColor(null, false)).toBe('#475569');
  });
});

describe('functionColor', () => {
  it('maps pallet functions to the tag colors shown in the 3D view', () => {
    expect(functionColor('PICK_FACE')).toBe('#10b981');
    expect(functionColor('RESERVE')).toBe('#3b82f6');
    expect(functionColor('MIXED')).toBe('#7c3aed');
    expect(functionColor('reserve')).toBe('#3b82f6');
    expect(functionColor(null)).toBe('');
    expect(functionColor('')).toBe('');
  });
});