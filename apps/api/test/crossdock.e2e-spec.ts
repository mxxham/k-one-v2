import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import { getTestApp, closeTestApp, login, api, createProduct, q, resetDb } from './helpers';

describe('Cross-Docking (S25)', () => {
  let token: string;
  let customerId: number;

  beforeAll(async () => {
    await getTestApp();
    await resetDb();
    token = await login();
    const cust = await q<{ id: number }>(
      `INSERT INTO customers (customer_name, customer_code, address, city) VALUES ($1, $2, 'Jln Test', 'Jakarta') RETURNING id`,
      ['Cross Dock Customer', 'CD' + Math.floor(Math.random() * 100000)],
    );
    customerId = Number(cust[0].id);
  });
  afterAll(async () => {
    await closeTestApp();
  });

  /** A pre-sold outbound order + line, created WITHOUT general stock. */
  const makePreSoldOrder = async (productId: number, quantity = 10): Promise<number> => {
    const ob = await q<{ id: number }>(
      `INSERT INTO outbound_orders (order_number, order_date, customer_id, expected_date, status, created_by)
       VALUES ('CD-OB' || $1::text, '2026-08-15', $2, '2026-08-20', 'Open', 1) RETURNING id`,
      [Math.floor(Math.random() * 1000000), customerId],
    );
    const obId = Number(ob[0].id);
    await q(
      `INSERT INTO outbound_items (outbound_order_id, product_id, quantity, uom, actual_qty, pallet)
       VALUES ($1, $2, $3, 'Drum', $3, $4)`,
      [obId, productId, quantity, Math.ceil(quantity / 4)],
    );
    return obId;
  };

  it('cross-docked inbound item at ATP stages at STAGING and attaches to the outbound picklist', async () => {
    await resetDb();
    const pid = Number(await createProduct({ uom_type: 'Drum' }));
    const obId = await makePreSoldOrder(pid, 10);

    const created = await api('inbound', 'create', token, {
      po_number: 'PO-CD' + Math.floor(Math.random() * 100000),
      order_date: '2026-08-15',
    });
    const orderId = Number(created.body.id);

    const add = await api('inbound', 'add_item', token, {
      inbound_id: orderId,
      item: {
        product_id: pid,
        quantity: 10,
        uom: 'Drum',
        batch_number: 'CD-BATCH',
        in_process_status: 'Dues In',
        cross_dock_outbound_order_id: obId,
      },
    });
    expect(add.body.success).toBe(true);
    const itemId = Number(add.body.item_id);

    await api('inbound', 'advance_status', token, {
      id: orderId,
      status: 'Receiving',
      received_by_id: 1,
      received_date: '2026-08-15',
    });

    await api('inbound', 'update_item_status', token, { item_id: itemId, status: 'Goods Received' });
    const atp = await api('inbound', 'update_item_status', token, { item_id: itemId, status: 'ATP' });
    expect(atp.body.success).toBe(true);

    // 1) Item is flagged cross-dock and staged at STAGING.
    const item = await q<any>('SELECT in_process_status, stock_status, location, cross_dock_outbound_order_id FROM inbound_items WHERE id = $1', [itemId]);
    expect(item[0].in_process_status).toBe('ATP');
    expect(item[0].stock_status).toBe('Accepted');
    expect(item[0].location).toBe('STAGING');
    expect(Number(item[0].cross_dock_outbound_order_id)).toBe(obId);

    // 2) NO general stock row is created (bypasses putaway); a STAGING stock_location exists.
    const stockRows = await q<any>(
      'SELECT location FROM stock WHERE product_id = $1 AND batch_number = $2',
      [pid, 'CD-BATCH'],
    );
    expect(stockRows.length).toBe(0);

    const stagingSl = await q<any>(
      `SELECT location_code, quantity FROM stock_locations WHERE inbound_item_id = $1`,
      [itemId],
    );
    expect(stagingSl.length).toBeGreaterThan(0);
    expect(stagingSl[0].location_code).toBe('STAGING');
    expect(Number(stagingSl[0].quantity)).toBe(10);

    // 3) The linked outbound has a Draft picklist with the cross-dock item at STAGING.
    const picklist = await q<any>(
      'SELECT id, status FROM picklists WHERE outbound_order_id = $1',
      [obId],
    );
    expect(picklist.length).toBe(1);
    expect(picklist[0].status).toBe('Draft');
    const pki = await q<any>(
      `SELECT location, quantity, product_id, status FROM picklist_items WHERE picklist_id = $1`,
      [picklist[0].id],
    );
    expect(pki.length).toBe(1);
    expect(pki[0].location).toBe('STAGING');
    expect(Number(pki[0].product_id)).toBe(pid);
    expect(pki[0].status).toBe('Pending');

    // 4) Inbound detail surfaces the cross-dock target + available orders.
    const detail = await api('inbound', 'detail', token, {}, { id: orderId });
    const detailItem = detail.body.items.find((i: any) => Number(i.id) === itemId);
    expect(Number(detailItem.cross_dock_outbound_order_id)).toBe(obId);
    expect(detailItem.cross_dock_order_number).toBeTruthy();
    expect(Array.isArray(detail.body.cross_dock_orders)).toBe(true);

    // 5) Outbound detail flags the arriving cross-dock line.
    const obDetail = await api('outbound', 'detail', token, {}, { id: obId });
    const obItem = obDetail.body.items.find((i: any) => Number(i.product_id) === pid);
    expect(Number(obItem.cross_dock_inbound_item_id)).toBe(itemId);
    expect(obItem.cross_dock_inbound_number).toBeTruthy();
  });

  it('complete() keeps the cross-dock line staged and pickable from STAGING', async () => {
    await resetDb();
    const pid = Number(await createProduct({ uom_type: 'Drum' }));
    const obId = await makePreSoldOrder(pid, 10);

    const created = await api('inbound', 'create', token, {
      po_number: 'PO-CD2' + Math.floor(Math.random() * 100000),
      order_date: '2026-08-15',
    });
    const orderId = Number(created.body.id);
    const add = await api('inbound', 'add_item', token, {
      inbound_id: orderId,
      item: {
        product_id: pid,
        quantity: 10,
        uom: 'Drum',
        batch_number: 'CD-BATCH2',
        in_process_status: 'Dues In',
        cross_dock_outbound_order_id: obId,
      },
    });
    const itemId = Number(add.body.item_id);
    await api('inbound', 'advance_status', token, { id: orderId, status: 'Receiving', received_by_id: 1, received_date: '2026-08-15' });
    await api('inbound', 'update_item_status', token, { item_id: itemId, status: 'Goods Received' });
    await api('inbound', 'update_item_status', token, { item_id: itemId, status: 'ATP' });
    await api('inbound', 'complete', token, { id: orderId });

    // After complete: stock is staged at STAGING (not a general bin).
    const stock = await q<any>(
      'SELECT location, quantity, stock_status FROM stock WHERE product_id = $1 AND batch_number = $2',
      [pid, 'CD-BATCH2'],
    );
    expect(stock.length).toBeGreaterThan(0);
    expect(stock.every((s: any) => s.location === 'STAGING')).toBe(true);
    expect(Number(stock.reduce((a: number, s: any) => a + Number(s.quantity), 0))).toBe(10);

    // The outbound line resolves to ATP now (STAGING stock counts for cross-dock).
    const obDetail = await api('outbound', 'detail', token, {}, { id: obId });
    const obItem = obDetail.body.items.find((i: any) => Number(i.product_id) === pid);
    expect(Number(obItem.cross_dock_inbound_item_id)).toBe(itemId);
    expect(obItem.in_process_status).toBe('ATP');
  });

  it('sets and clears cross_dock_outbound_order_id via update_item', async () => {
    await resetDb();
    const pid = Number(await createProduct({ uom_type: 'Drum' }));
    const obId = await makePreSoldOrder(pid, 5);

    const created = await api('inbound', 'create', token, { po_number: 'PO-CD3' + Math.floor(Math.random() * 100000), order_date: '2026-08-15' });
    const orderId = Number(created.body.id);
    const add = await api('inbound', 'add_item', token, {
      inbound_id: orderId,
      item: { product_id: pid, quantity: 5, uom: 'Drum', batch_number: 'CD-BATCH3', in_process_status: 'Dues In' },
    });
    const itemId = Number(add.body.item_id);

    const set = await api('inbound', 'update_item', token, {
      item_id: itemId,
      product_id: pid,
      quantity: 5,
      uom: 'Drum',
      in_process_status: 'Dues In',
      cross_dock_outbound_order_id: obId,
    });
    expect(set.body.success).toBe(true);
    const after = await q<any>('SELECT cross_dock_outbound_order_id FROM inbound_items WHERE id = $1', [itemId]);
    expect(Number(after[0].cross_dock_outbound_order_id)).toBe(obId);

    const clear = await api('inbound', 'update_item', token, {
      item_id: itemId,
      product_id: pid,
      quantity: 5,
      uom: 'Drum',
      in_process_status: 'Dues In',
      cross_dock_outbound_order_id: null,
    });
    expect(clear.body.success).toBe(true);
    const cleared = await q<any>('SELECT cross_dock_outbound_order_id FROM inbound_items WHERE id = $1', [itemId]);
    expect(cleared[0].cross_dock_outbound_order_id).toBeNull();
  });

  it('cross-dock to a non-Open outbound is still listed but excluded from the inbound selector options', async () => {
    await resetDb();
    const pid = Number(await createProduct({ uom_type: 'Drum' }));
    const obId = await makePreSoldOrder(pid, 5);
    await q("UPDATE outbound_orders SET status = 'Completed' WHERE id = $1", [obId]);

    const created = await api('inbound', 'create', token, { po_number: 'PO-CD4' + Math.floor(Math.random() * 100000), order_date: '2026-08-15' });
    const orderId = Number(created.body.id);
    const detail = await api('inbound', 'detail', token, {}, { id: orderId });
    const found = (detail.body.cross_dock_orders || []).find((o: any) => Number(o.id) === obId);
    expect(found).toBeUndefined();
  });
});