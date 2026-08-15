import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import { getTestApp, closeTestApp, login, api, q, seedFullMap, resetDb } from './helpers';

describe('Full warehouse map (2560 bins)', () => {
  let token: string;

  beforeAll(async () => {
    await getTestApp();
    token = await login();
    await resetDb();
  });
  afterAll(async () => {
    await closeTestApp();
  });

  it('seeds the full production map (CA–CG)', async () => {
    const inserted = await seedFullMap();
    expect(inserted).toBe(2560);
    const rows = await q<{ total: number }>(
      `SELECT COUNT(*)::int AS total FROM location_master
       WHERE aisle IN ('CA','CB','CC','CD','CE','CF','CG')`,
    );
    expect(Number(rows[0].total)).toBe(2560);
  });

  it('marks Level A as pick-face and equipment-accessible only', async () => {
    const res = await api('putaway', 'bins', token);
    expect(res.body.success).toBe(true);
    const rows = res.body.rows ?? [];
    expect(rows.length).toBeGreaterThan(2000);

    const pickFace = await q<{ total: number }>(
      `SELECT COUNT(*)::int AS total FROM location_master
       WHERE aisle IN ('CA','CB','CC','CD','CE','CF','CG') AND is_pick_face = 1`,
    );
    const nonLevelAPick = await q<{ total: number }>(
      `SELECT COUNT(*)::int AS total FROM location_master
       WHERE aisle IN ('CA','CB','CC','CD','CE','CF','CG') AND is_pick_face = 1 AND row_name <> 'A'`,
    );
    const equipMismatch = await q<{ total: number }>(
      `SELECT COUNT(*)::int AS total FROM location_master
       WHERE aisle IN ('CA','CB','CC','CD','CE','CF','CG')
         AND is_pick_face <> equipment_accessible`,
    );
    expect(Number(pickFace[0].total)).toBeGreaterThan(0);
    expect(Number(nonLevelAPick[0].total)).toBe(0); // pick-face only at Level A
    expect(Number(equipMismatch[0].total)).toBe(0); // equipment-accessible matches pick-face
  });

  it('exposes rack metadata per aisle for the 3D viewer', async () => {
    const res = await api('putaway', 'bins', token);
    expect(res.body.success).toBe(true);
    const rows = res.body.rows ?? [];
    const sample = rows.find((p: any) => String(p.location_code ?? p.bin ?? '').startsWith('CG20'));
    expect(sample).toBeDefined();
    const code = String(sample.location_code ?? sample.bin);
    expect(code).toMatch(/^CG20[A-E]\d{2}$/);
  });
});