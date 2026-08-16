import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import { getTestApp, closeTestApp, login, api, createProduct, putStock, q, resetDb } from './helpers';

describe('Outbound FEFO picking', () => {
  let token: string;
  let customerId: number;
  let productId: number;

  beforeAll(async () => {
    await getTestApp();
    await resetDb();
    token = await login();
    const cust = await q<{ id: number }>(
      `INSERT INTO customers (customer_name, customer_code, address, city) VALUES ($1, $2, 'Jln Test', 'Jakarta') RETURNING id`,
      ['Test Customer', 'CUST' + Math.floor(Math.random() * 100000)],
    );
    customerId = Number(cust[0].id);
    productId = await createProduct({ uom_type: 'Drum' });
  });
  afterAll(async () => {
    await closeTestApp();
  });

  it('creates an outbound order', async () => {
    const res = await api('outbound', 'create', token, {
      customer_id: customerId,
      order_date: '2026-08-15',
      expected_date: '2026-08-16',
      shipment_number: 'SHIP' + Math.floor(Math.random() * 100000),
    });
    expect(res.body.success).toBe(true);
    expect(Number(res.body.id)).toBeGreaterThan(0);
  });

  it('picks stock FEFO (oldest batch first)', async () => {
    const older = await q<{ id: number }>(
      `INSERT INTO stock (product_id, batch_number, location, quantity, uom, pallet, expiry_date, stock_status)
       VALUES ($1, 'BATCH-OLD', 'CA01A01', 10, 'Drum', 3, '2026-12-01', 'Available') RETURNING id`,
      [productId],
    );
    const newer = await q<{ id: number }>(
      `INSERT INTO stock (product_id, batch_number, location, quantity, uom, pallet, expiry_date, stock_status)
       VALUES ($1, 'BATCH-NEW', 'CB01A01', 10, 'Drum', 3, '2027-12-01', 'Available') RETURNING id`,
      [productId],
    );
    const olderId = Number(older[0].id);
    const newerId = Number(newer[0].id);

    const created = await api('outbound', 'create', token, {
      customer_id: customerId,
      order_date: '2026-08-15',
      expected_date: '2026-08-16',
    });
    expect(created.body.success).toBe(true);
    const orderId = Number(created.body.id);

    const add = await api('outbound', 'add_item', token, {
      outbound_id: orderId,
      item: { product_id: productId, quantity: 8, uom: 'Drum', batch_no: '', location: '' },
    });
    expect(add.body.success).toBe(true);

    const pick = await api('outbound', 'pick_items', token, {}, { id: orderId });
    expect(pick.body.success).toBe(true);

    const oldRow = await q('SELECT quantity FROM stock WHERE id = $1', [olderId]);
    const newRow = await q('SELECT quantity FROM stock WHERE id = $1', [newerId]);
    expect(Number(oldRow[0].quantity)).toBe(2);
    expect(Number(newRow[0].quantity)).toBe(10);
  });

  it('ships a fully-picked order', async () => {
    const shipProductId = await createProduct({ uom_type: 'Drum' });
    await putStock(shipProductId, 'CA01A01', 10, 'BATCH-OLD', '2026-12-01');
    const created = await api('outbound', 'create', token, {
      customer_id: customerId,
      order_date: '2026-08-15',
      expected_date: '2026-08-16',
    });
    const orderId = Number(created.body.id);
    await api('outbound', 'add_item', token, {
      outbound_id: orderId,
      item: { product_id: shipProductId, quantity: 4, uom: 'Drum', batch_no: 'BATCH-OLD', location: 'CA01A01' },
    });

    const pick = await api('outbound', 'pick_items', token, {}, { id: orderId });
    expect(pick.body.success).toBe(true);

    const ship = await api('outbound', 'ship', token, { shipped_date: '2026-08-16' }, { id: orderId });
    expect(ship.body.success).toBe(true);
    const rows = await q('SELECT status FROM outbound_orders WHERE id = $1', [orderId]);
    expect(rows[0].status).toBe('Shipped');
  });

  it('creates an order with inline items (regression: FK on same transaction)', async () => {
    const inlineProductId = await createProduct({ uom_type: 'Drum' });
    await putStock(inlineProductId, 'CA01A01', 20, 'BATCH-INLINE', '2026-12-01');
    const res = await api('outbound', 'create', token, {
      customer_id: customerId,
      order_date: '2026-08-15',
      expected_date: '2026-08-16',
      items: [
        { product_id: inlineProductId, quantity: 6, uom: 'Drum' },
        { product_id: inlineProductId, quantity: 4, uom: 'Drum' },
      ],
    });
    expect(res.body.success).toBe(true);
    const orderId = Number(res.body.id);
    const itemRows = await q<{ product_id: number; quantity: number }>(
      'SELECT product_id, quantity FROM outbound_items WHERE outbound_order_id = $1 ORDER BY id',
      [orderId],
    );
    expect(itemRows).toHaveLength(2);
    expect(itemRows.every((r) => Number(r.product_id) === Number(inlineProductId))).toBe(true);
    expect(itemRows.reduce((a, r) => a + Number(r.quantity), 0)).toBe(10);
  });
});