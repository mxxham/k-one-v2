import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import { getTestApp, closeTestApp, login, api, createProduct, putStock, q, resetDb } from './helpers';

describe('Stocktake', () => {
  let token: string;
  let productId: number;

  beforeAll(async () => {
    await getTestApp();
    await resetDb();
    token = await login();
    productId = await createProduct({ uom_type: 'Drum' });
    await putStock(productId, 'CA01B01', 10, 'STK-BATCH', '2030-01-01');
  });
  afterAll(async () => {
    await closeTestApp();
  });

  it('creates a stock take with auto-loaded scope locations', async () => {
    const res = await api('stocktake', 'create', token, {
      take_name: 'STK-' + Math.floor(Math.random() * 100000),
      take_date: '2026-08-15',
      scope_locations: ['CA01B01'],
    });
    expect(res.body.success).toBe(true);
    const id = Number(res.body.id);
    expect(id).toBeGreaterThan(0);

    const items = await q('SELECT stock_take_id, location FROM stock_take_items WHERE stock_take_id = $1', [id]);
    expect(items.some((r: any) => r.location === 'CA01B01')).toBe(true);
  });

  it('counts a difference, reviews it and applies an adjustment', async () => {
    const created = await api('stocktake', 'create', token, {
      take_name: 'STK-ADJ-' + Math.floor(Math.random() * 100000),
      take_date: '2026-08-15',
      scope_locations: ['CA01B01'],
    });
    const id = Number(created.body.id);
    const items = await q<{ id: number; product_id: number }>(
      'SELECT id, product_id FROM stock_take_items WHERE stock_take_id = $1 AND location = $2',
      [id, 'CA01B01'],
    );
    expect(items.length).toBe(1);
    expect(Number(items[0].product_id)).toBe(Number(productId));
    const itemId = Number(items[0].id);

    const start = await api('stocktake', 'start_counting', token, { id });
    expect(start.body.success).toBe(true);

    const counters = await api('stocktake', 'save_counters', token, {
      id,
      counters: { [itemId]: { c1: 7, c2: 7, c3: null } },
    });
    expect(counters.body.success).toBe(true);

    const c2 = await api('stocktake', 'advance_to_c2', token, { id, counters: {} });
    expect(c2.body.success).toBe(true);

    const finish = await api('stocktake', 'finish_counting', token, { id, counters: {} });
    expect(finish.body.success).toBe(true);

    const review = await api('stocktake', 'save_review', token, {
      id,
      physicals: { [itemId]: 7 },
    });
    expect(review.body.success).toBe(true);

    const apply = await api('stocktake', 'apply_adjustment', token, { id });
    expect(apply.body.success).toBe(true);

    const stock = await q('SELECT quantity FROM stock WHERE product_id = $1 AND location = $2', [productId, 'CA01B01']);
    expect(Number(stock[0].quantity)).toBe(7);
  });
});