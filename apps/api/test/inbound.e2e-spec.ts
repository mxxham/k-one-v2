import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import { getTestApp, closeTestApp, login, api, createProduct, q, resetDb } from './helpers';

describe('Inbound lifecycle', () => {
  let token: string;
  let productId: number;

  beforeAll(async () => {
    await getTestApp();
    await resetDb();
    token = await login();
    productId = await createProduct({ uom_type: 'Drum' });
  });
  afterAll(async () => {
    await closeTestApp();
  });

  it('creates an inbound order', async () => {
    const res = await api('inbound', 'create', token, {
      po_number: 'PO' + Math.floor(Math.random() * 100000),
      order_date: '2026-08-15',
    });
    expect(res.body.success).toBe(true);
    expect(Number(res.body.id)).toBeGreaterThan(0);
    const rows = await q('SELECT status FROM inbound_orders WHERE id = $1', [Number(res.body.id)]);
    expect(rows[0].status).toBe('Draft');
  });

  it('adds an item, advances to Goods Received, marks ATP, completes and creates stock', async () => {
    const created = await api('inbound', 'create', token, {
      po_number: 'PO-ATP' + Math.floor(Math.random() * 100000),
      order_date: '2026-08-15',
    });
    const orderId = Number(created.body.id);

    const add = await api('inbound', 'add_item', token, {
      inbound_id: orderId,
      item: {
        product_id: productId,
        quantity: 12,
        uom: 'Drum',
        batch_number: 'INB-BATCH',
        expiry_date: '2028-06-30',
        in_process_status: 'Dues In',
        pallet_no: 'P1',
      },
    });
    expect(add.body.success).toBe(true);
    const itemId = Number(add.body.item_id);

    const adv = await api('inbound', 'advance_status', token, {
      id: orderId,
      status: 'Receiving',
      received_by_id: 1,
      received_date: '2026-08-15',
    });
    expect(adv.body.success).toBe(true);

    const gr = await api('inbound', 'update_item_status', token, {
      item_id: itemId,
      status: 'Goods Received',
    });
    expect(gr.body.success).toBe(true);

    const atp = await api('inbound', 'update_item_status', token, {
      item_id: itemId,
      status: 'ATP',
      location: 'CA01A01',
    });
    expect(atp.body.success).toBe(true);

    const locs = await api('inbound', 'save_pallet_locations', token, {
      inbound_id: orderId,
      item_id: itemId,
      pallet_locations: [{ location_code: 'CA01A01', pallet_seq: 1, quantity: 12, is_full: 1, batch_number: 'INB-BATCH' }],
    });
    expect(locs.body.success).toBe(true);

    const comp = await api('inbound', 'complete', token, { id: orderId });
    expect(comp.body.success).toBe(true);

    const stock = await q('SELECT quantity, location FROM stock WHERE product_id = $1 AND batch_number = $2', [productId, 'INB-BATCH']);
    expect(stock.length).toBeGreaterThan(0);
    expect(Number(stock[0].quantity)).toBe(12);
    expect(stock[0].location).toBe('CA01A01');

    const orders = await q('SELECT status FROM inbound_orders WHERE id = $1', [orderId]);
    expect(orders[0].status).toBe('Completed');
  });

  it('rejects completing while items are still Dues In', async () => {
    const created = await api('inbound', 'create', token, {
      po_number: 'PO-NOCOMPLETE' + Math.floor(Math.random() * 100000),
      order_date: '2026-08-15',
    });
    const orderId = Number(created.body.id);
    await api('inbound', 'add_item', token, {
      inbound_id: orderId,
      item: { product_id: productId, quantity: 4, uom: 'Drum', in_process_status: 'Dues In' },
    });
    const comp = await api('inbound', 'complete', token, { id: orderId });
    expect(comp.body.success).toBe(false);
    expect(comp.status).toBe(409);
  });
});