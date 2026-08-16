import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import { getTestApp, closeTestApp, login, api, createProduct, putStock, q, resetDb } from './helpers';

describe('Replenishment (demand-driven)', () => {
  let token: string;
  let productId: number;

  beforeAll(async () => {
    await getTestApp();
    await resetDb();
    token = await login();
    productId = await createProduct({ uom_type: 'Drum' });
    // reserve stock in CA (reserve zone, upper levels)
    await putStock(productId, 'CA02E01', 20, 'RES-BATCH', '2031-01-01');
  });
  afterAll(async () => {
    await closeTestApp();
  });

  it('reports a shortage when demand exceeds pick-face stock', async () => {
    const res = await api('replenishment', 'for_demand', token, {
      product_id: productId,
      quantity: 25,
      create_transfer: false,
    });
    expect(res.body.success).toBe(true);
    expect(res.body.shortage).toBeGreaterThan(0);
  });

  it('reports enough reserve stock when demand fits', async () => {
    const res = await api('replenishment', 'for_demand', token, {
      product_id: productId,
      quantity: 5,
      create_transfer: false,
    });
    expect(res.body.success).toBe(true);
    expect(res.body.shortage).toBe(5); // pick_available is 0, so the full demand is a shortage
    expect(res.body.pick_available).toBe(0);
    expect(res.body.can_fulfill).toBe(true);
    expect(res.body.available).toBeGreaterThanOrEqual(5);
  });

  it('creates a pick-face target and lists it', async () => {
    const loc = await q<{ id: number }>('SELECT id FROM location_master WHERE location_code = $1', ['CA02E01']);
    expect(loc.length).toBeGreaterThan(0);
    const save = await api('replenishment', 'save_target', token, {
      location_id: Number(loc[0].id),
      product_id: productId,
      min_qty: 4,
      max_qty: 8,
    });
    expect(save.body.success).toBe(true);
    const tid = Number(save.body.id);

    const list = await api('replenishment', 'targets', token);
    expect((list.body.targets || []).some((t: any) => Number(t.id) === tid)).toBe(true);

    const del = await api('replenishment', 'delete_target', token, { id: tid });
    expect(del.body.success).toBe(true);
  });
});