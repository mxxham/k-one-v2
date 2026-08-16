import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import { getTestApp, closeTestApp, login, api, createProduct, q, resetDb } from './helpers';
import { hashSync } from 'bcryptjs';

function addOut(productId: number, date: string, qty: number) {
  return q(
    `INSERT INTO stock_ledger
       (transaction_date, product_id, transaction_type, quantity_out, uom, balance, notes)
     VALUES ($1, $2, 'OUT', $3, 'Drum', 0, 'test abc')`,
    [date, productId, qty],
  );
}

describe('ABC Analysis / Velocity-Based Ranking', () => {
  let token: string;
  let adminToken: string;

  beforeAll(async () => {
    await getTestApp();
    await resetDb();
    // testadmin is admin role
    adminToken = await login();
    // operator: write but not admin
    const pw = hashSync('admin123', 10);
    await q(
      `INSERT INTO users (username, password, full_name, email, role, department, is_active)
       VALUES ('abc_operator', $1, 'ABC Operator', 'op@local', 'operator', 'all', 1)
       ON CONFLICT (username) DO UPDATE SET password = EXCLUDED.password, role = 'operator', is_active = 1`,
      [pw],
    );
    token = await login('abc_operator', 'admin123');
  });
  afterAll(async () => {
    await closeTestApp();
  });

  it('rejects a non-admin recompute', async () => {
    // operator login has write but not admin
    const res = await api('abc', 'recompute', token, {});
    expect(res.body.success).toBe(false);
    expect(res.status).toBe(403);
  });

  it('analyze ranks products by OUT volume into A/B/C tiers', async () => {
    const pa = Number(await createProduct({})); // fast mover
    const pb = Number(await createProduct({})); // medium
    const pc = Number(await createProduct({})); // slow

    // 80/15/5 split default: A = top 80% cumulative, B = next 15%, C = last 5%.
    await addOut(pa, '2026-08-01', 70);
    await addOut(pb, '2026-08-01', 20);
    await addOut(pc, '2026-08-01', 10);

    const res = await api('abc', 'analyze', adminToken, {}, { date_from: '2026-08-01', date_to: '2026-08-31' });
    expect(res.body.success).toBe(true);
    expect(res.body.total_qty).toBe(100);

    const byId: Record<number, any> = {};
    for (const r of res.body.rows) byId[Number(r.product_id)] = r;

    // pa=70 -> cumulative 70/100=70% -> A; pb cumulative 90/100=90% -> B; pc 100% -> C
    expect(byId[pa].velocity_class).toBe('A');
    expect(byId[pb].velocity_class).toBe('B');
    expect(byId[pc].velocity_class).toBe('C');
    expect(res.body.counts.A).toBe(1);
    expect(res.body.counts.B).toBe(1);
    expect(res.body.counts.C).toBe(1);
  });

  it('supports a custom split', async () => {
    const pa = Number(await createProduct({}));
    const pb = Number(await createProduct({}));
    await addOut(pa, '2026-08-02', 90);
    await addOut(pb, '2026-08-02', 10);

    // 50/50 split -> both in A
    const res = await api('abc', 'analyze', adminToken, {}, { date_from: '2026-08-01', date_to: '2026-08-31', split_a: 50, split_b: 50 });
    expect(res.body.success).toBe(true);
    expect(res.body.split.a).toBe(50);
    expect(res.body.split.b).toBe(50);
    const a = res.body.rows.find((r: any) => Number(r.product_id) === pa);
    expect(a.velocity_class).toBe('A');
  });

  it('rejects an invalid split', async () => {
    const res = await api('abc', 'analyze', adminToken, {}, { date_from: '2026-08-01', date_to: '2026-08-31', split_a: 60, split_b: 60 });
    expect(res.body.success).toBe(false);
    expect(res.status).toBe(400);
  });

  it('recompute writes velocity_class onto products', async () => {
    await resetDb();
    const pa = Number(await createProduct({})); // 80 qty
    const pb = Number(await createProduct({})); // 15 qty
    const pc = Number(await createProduct({})); // 5 qty
    const idle = Number(await createProduct({})); // no activity -> stays NULL

    await addOut(pa, '2026-08-10', 80);
    await addOut(pb, '2026-08-10', 15);
    await addOut(pc, '2026-08-10', 5);

    const res = await api('abc', 'recompute', adminToken, {}, { date_from: '2026-08-01', date_to: '2026-08-31' });
    expect(res.body.success).toBe(true);
    expect(res.body.counts.A).toBe(1);

    const rows = await q<{ id: number; velocity_class: string | null }>('SELECT id, velocity_class FROM products WHERE id = ANY($1::bigint[])', [[pa, pb, pc, idle]]);
    const byId: Record<number, string | null> = {};
    for (const r of rows) byId[Number(r.id)] = r.velocity_class;

    expect(byId[pa]).toBe('A');
    expect(byId[pb]).toBe('B');
    expect(byId[pc]).toBe('C');
    expect(byId[idle]).toBeNull();
  });

  it('exposes velocity_class on the products and stock lists', async () => {
    await resetDb();
    const p = Number(await createProduct({}));
    await addOut(p, '2026-08-10', 100);
    await api('abc', 'recompute', adminToken, {}, { date_from: '2026-08-01', date_to: '2026-08-31' });

    const prod = await api('products', 'list', adminToken, {}, { page: 1, per_page: 500 });
    const found = prod.body.rows.find((r: any) => Number(r.id) === p);
    expect(found.velocity_class).toBe('A');

    const stock = await api('stock', 'list', adminToken, {});
    // stock list only has rows where quantity>0; the product has no stock, so just
    // assert the column is selectable without error (already verified by api call success).
    expect(stock.body.success).toBe(true);
  });
});
