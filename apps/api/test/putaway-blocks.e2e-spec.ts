import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import { hashSync } from 'bcryptjs';
import { getTestApp, closeTestApp, login, api, createProduct, q, resetDb } from './helpers';

describe('Putaway Location Blocking', () => {
  let token: string;
  let operatorToken: string;
  let productId: number;

  beforeAll(async () => {
    await getTestApp();
    await resetDb();
    token = await login();
    // operator (write role, NOT admin) for the negative permission cases
    await q(
      `INSERT INTO users (username, password, full_name, email, role, department, is_active)
       VALUES ('pb_operator', $1, 'PB Operator', 'pbop@local', 'operator', 'all', 1)
       ON CONFLICT (username) DO UPDATE SET password = EXCLUDED.password, role = 'operator', is_active = 1`,
      [hashSync('admin123', 10)],
    );
    operatorToken = await login('pb_operator', 'admin123');
    productId = Number(await createProduct({ uom_type: 'Drum' }));
  });

  afterAll(async () => {
    await closeTestApp();
  });

  const listBlocks = async (): Promise<any[]> => {
    const res = await api('putaway', 'list_blocks', token);
    return res.body.rows || [];
  };

  it('creates an aisle block and lists it with the blocking user joined', async () => {
    const res = await api('putaway', 'create_block', token, {
      scope_type: 'aisle',
      aisle_prefix: 'CB',
      reason: 'Renovasi aisle CB',
    });
    expect(res.body.success).toBe(true);
    expect(Number(res.body.id)).toBeGreaterThan(0);

    const rows = await q(
      `SELECT scope_type, aisle_prefix, is_active, reason FROM putaway_location_blocks WHERE id = $1`,
      [Number(res.body.id)],
    );
    expect(rows[0].scope_type).toBe('aisle');
    expect(rows[0].aisle_prefix).toBe('CB');
    expect(rows[0].is_active).toBe(true);
    expect(rows[0].reason).toBe('Renovasi aisle CB');

    const list = await listBlocks();
    expect(list.length).toBe(1);
    expect(list[0].blocked_by_username).toBe('testadmin');
    expect(list[0].is_active).toBe(true);
  });

  it('creates a specific-location block', async () => {
    const res = await api('putaway', 'create_block', token, {
      scope_type: 'location',
      location_code: 'ca01b01',
      reason: 'Bin rusak',
    });
    expect(res.body.success).toBe(true);

    const rows = await q(
      `SELECT scope_type, location_code, aisle_prefix FROM putaway_location_blocks WHERE id = $1`,
      [Number(res.body.id)],
    );
    expect(rows[0].scope_type).toBe('location');
    expect(rows[0].location_code).toBe('CA01B01'); // uppercased
    expect(rows[0].aisle_prefix).toBeNull();

    const list = await listBlocks();
    expect(list.length).toBe(2);
  });

  it('rejects a duplicate ACTIVE block on the same target', async () => {
    const dupAisle = await api('putaway', 'create_block', token, {
      scope_type: 'aisle',
      aisle_prefix: 'CB',
      reason: 'duplicate',
    });
    expect(dupAisle.body.success).toBe(false);
    expect(dupAisle.status).toBe(409);
    expect(String(dupAisle.body.message)).toContain('sudah diblokir');

    const dupLoc = await api('putaway', 'create_block', token, {
      scope_type: 'location',
      location_code: 'CA01B01',
      reason: 'duplicate',
    });
    expect(dupLoc.body.success).toBe(false);
    expect(dupLoc.status).toBe(409);
  });

  it('validates create_block input (scope_type / reason / target / known location)', async () => {
    const badScope = await api('putaway', 'create_block', token, { scope_type: 'rack', aisle_prefix: 'CX', reason: 'x' });
    expect(badScope.body.success).toBe(false);
    expect(badScope.status).toBe(400);

    const noReason = await api('putaway', 'create_block', token, { scope_type: 'aisle', aisle_prefix: 'CX' });
    expect(noReason.body.success).toBe(false);
    expect(noReason.status).toBe(400);

    const noAisle = await api('putaway', 'create_block', token, { scope_type: 'aisle', reason: 'x' });
    expect(noAisle.body.success).toBe(false);
    expect(noAisle.status).toBe(400);

    const noLoc = await api('putaway', 'create_block', token, { scope_type: 'location', reason: 'x' });
    expect(noLoc.body.success).toBe(false);
    expect(noLoc.status).toBe(400);

    const unknownLoc = await api('putaway', 'create_block', token, { scope_type: 'location', location_code: 'ZZ99Z99', reason: 'x' });
    expect(unknownLoc.body.success).toBe(false);
    expect(unknownLoc.status).toBe(400);
    expect(String(unknownLoc.body.message)).toContain('tidak ditemukan');
  });

  it('blocks create_block / deactivate_block for non-admin users', async () => {
    const create = await api('putaway', 'create_block', operatorToken, { scope_type: 'aisle', aisle_prefix: 'CX', reason: 'x' });
    expect(create.body.success).toBe(false);
    expect(create.status).toBe(403);

    const rows = await q(`SELECT id FROM putaway_location_blocks LIMIT 1`);
    const deactivate = await api('putaway', 'deactivate_block', operatorToken, { id: Number(rows[0].id) });
    expect(deactivate.body.success).toBe(false);
    expect(deactivate.status).toBe(403);
  });

  it('validatePlacement rejects saves into blocked locations (bin + aisle prefix)', async () => {
    const blockedBin = await api('putaway', 'validate', token, {}, { product_id: productId, location: 'CA01B01', quantity: 4, uom: 'Drum' });
    expect(blockedBin.body.valid).toBe(false);
    expect(blockedBin.body.reasons.join(' ')).toContain('diblokir');

    const blockedPrefix = await api('putaway', 'validate', token, {}, { product_id: productId, location: 'CB01B01', quantity: 4, uom: 'Drum' });
    expect(blockedPrefix.body.valid).toBe(false);
    expect(blockedPrefix.body.reasons.join(' ')).toContain('diblokir');

    const free = await api('putaway', 'validate', token, {}, { product_id: productId, location: 'CA01A01', quantity: 4, uom: 'Drum' });
    expect(free.body.valid).toBe(true);
  });

  it('recommendLocations excludes blocked reserve bins', async () => {
    // CB aisle is blocked, CA01B01 (bin) is blocked -> reserve slots all come
    // from CA and never CA01B01.
    const rec = await api('putaway', 'recommend', token, {}, { product_id: productId, quantity: 8, uom: 'Drum' });
    expect(rec.body.success).toBe(true);
    const reservePallets = (rec.body.pallets || []).filter((p: any) => p.reason === 'RESERVE_FULL');
    expect(reservePallets.length).toBe(2);
    for (const p of reservePallets) {
      expect(String(p.location_code).startsWith('CA')).toBe(true);
      expect(p.location_code).not.toBe('CA01B01');
    }
  });

  it('recommendLocations falls back to STAGING when the pick-face level is fully blocked', async () => {
    await api('putaway', 'create_block', token, { scope_type: 'aisle', aisle_prefix: 'CA', reason: 'Level A CA ditutup' });

    const rec = await api('putaway', 'recommend', token, {}, { product_id: productId, quantity: 5, uom: 'Drum' });
    const staging = (rec.body.pallets || []).find((p: any) => p.reason === 'NO_SLOT_STAGING');
    expect(staging).toBeTruthy();
    expect(staging.location_code).toBe('STAGING');
  });

  it('deactivate_block soft-deletes and re-enables the target', async () => {
    const rows = await q(`SELECT id FROM putaway_location_blocks WHERE is_active = TRUE`);
    for (const r of rows) {
      const res = await api('putaway', 'deactivate_block', token, { id: Number(r.id) });
      expect(res.body.success).toBe(true);
    }

    const after = await q(`SELECT is_active FROM putaway_location_blocks`);
    expect(after.every((r) => r.is_active === false)).toBe(true);

    // CB is now open again -> validatePlacement accepts its bins once more.
    const reopened = await api('putaway', 'validate', token, {}, { product_id: productId, location: 'CB01B01', quantity: 4, uom: 'Drum' });
    expect(reopened.body.valid).toBe(true);

    const list = await listBlocks();
    expect(list.filter((b: any) => !b.is_active).length).toBeGreaterThan(0);
  });

  it('allows re-blocking a target after it was deactivated', async () => {
    const res = await api('putaway', 'create_block', token, { scope_type: 'aisle', aisle_prefix: 'CB', reason: 'Diblock ulang' });
    expect(res.body.success).toBe(true);

    const dup = await api('putaway', 'create_block', token, { scope_type: 'aisle', aisle_prefix: 'CB', reason: 'masih duplicate?' });
    expect(dup.body.success).toBe(false);
    expect(dup.status).toBe(409);
  });
});