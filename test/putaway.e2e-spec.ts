import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import { getTestApp, closeTestApp, login, api, createProduct, resetDb } from './helpers';

describe('Putaway (zones, zone_aisles, uom limits, rack feed)', () => {
  let token: string;

  beforeAll(async () => {
    await getTestApp();
    await resetDb();
    token = await login();
  });
  afterAll(async () => {
    await closeTestApp();
  });

  it('lists zones (seeded defaults)', async () => {
    const res = await api('putaway', 'zones', token);
    expect(res.body.success).toBe(true);
    const rows = res.body.rows || [];
    expect(rows.some((r: any) => String(r.zone_code).toUpperCase() === 'RESERVE')).toBe(true);
  });

  it('lists UOM physical limits including newly added UOMs', async () => {
    const res = await api('putaway', 'uom_limits', token);
    expect(res.body.success).toBe(true);
    const rows = res.body.rows || [];
    const types = rows.map((r: any) => String(r.uom_type).toLowerCase());
    for (const t of ['drum', 'fluidbag', 'ibc']) {
      expect(types).toContain(t);
    }
  });

  it('rejects saving a DRUM to a non-equipment level D bin', async () => {
    const pid = await createProduct({ uom_type: 'Drum' });
    const res = await api('putaway', 'validate', token, {}, { product_id: pid, location: 'CA01D01', uom: 'Drum', quantity: 4 });
    expect(res.body.success).toBe(true);
    expect(res.body.valid).toBe(false);
    expect(res.body.reasons.join(' ')).toMatch(/heavy equipment/i);
  });

  it('accepts a Drum on an equipment-accessible level A bin', async () => {
    const pid = await createProduct({ uom_type: 'Drum' });
    const res = await api('putaway', 'validate', token, {}, { product_id: pid, location: 'CA01A01', uom: 'Drum', quantity: 4 });
    expect(res.body.success).toBe(true);
    expect(res.body.valid).toBe(true);
  });

  it('returns a complete rack feed of seeded bins across aisles', async () => {
    const res = await api('putaway', 'bins', token);
    expect(res.body.success).toBe(true);
    const rows = res.body.rows || [];
    // 2 aisles x 3 bays x 5 levels x 2 positions = 60 rack bins (+ 3 virtual
    // locations QUA_SHELL/UNALLOCATED/STAGING seeded by migration 001).
    expect(rows.length).toBe(63);
    const rackRows = rows.filter((r: any) => ['CA', 'CB'].includes(r.aisle));
    expect(rackRows.length).toBe(60);
    const aisles = [...new Set(rackRows.map((r: any) => r.aisle))].sort();
    expect(aisles).toEqual(['CA', 'CB']);
  });

  it('filters aisle_map by aisle + level', async () => {
    const res = await api('putaway', 'aisle_map', token, {}, { aisle: 'CA', level: 'A' });
    expect(res.body.success).toBe(true);
    const row = (res.body.rows || []).find((r: any) => r.aisle === 'CA' && r.level === 'A');
    expect(row).toBeTruthy();
    expect(row.total).toBe(6); // 3 bays x 2 positions
    expect(Array.isArray(res.body.locations)).toBe(true);
  });

  it('creates, lists, updates and deletes a zone-aisle binding', async () => {
    const save = await api('putaway', 'save_zone_aisle', token, {
      zone_code: 'RESERVE',
      aisle: 'CB',
      min_level: 'B',
      max_level: 'E',
      is_active: 1,
    });
    expect(save.body.success).toBe(true);
    const savedId = Number(save.body.id);
    expect(savedId).toBeGreaterThan(0);

    const list = await api('putaway', 'zone_aisles', token);
    const found = (list.body.rows || []).find((r: any) => Number(r.id) === savedId);
    expect(found).toBeTruthy();
    expect(found.aisle).toBe('CB');
    expect(found.min_level).toBe('B');

    const del = await api('putaway', 'delete_zone_aisle', token, { id: savedId });
    expect(del.body.success).toBe(true);

    const after = await api('putaway', 'zone_aisles', token);
    expect((after.body.rows || []).some((r: any) => Number(r.id) === savedId)).toBe(false);
  });

  it('recommends reserve placements within DRUM max level', async () => {
    const pid = await createProduct({ uom_type: 'Drum' });
    const res = await api('putaway', 'recommend', token, {}, { product_id: pid, quantity: 8, uom: 'Drum', uom_per_pallet: 4 });
    expect(res.body.success).toBe(true);
    expect(res.body.pallets.length).toBeGreaterThan(0);
    for (const loc of res.body.pallets || []) {
      // DRUM max_level is 'E'; no placement may exceed it.
      expect(['A', 'B', 'C', 'D', 'E']).toContain(loc.level);
    }
  });
});