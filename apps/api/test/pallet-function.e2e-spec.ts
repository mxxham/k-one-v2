import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import { getTestApp, closeTestApp, login, api, createProduct, q, resetDb } from './helpers';

/**
 * pallet_function must be derived on every stock_locations write (PICK_FACE at
 * Level A, RESERVE for bulk/B-E) so the 3D rack map can render the BULK /
 * PICK FACE badge. Covers the putaway-task completion path (auto-suggest is
 * deferred into putaway_task_items at Goods Received since S42 — the task
 * completion is what writes stock_locations) and the manual-save path
 * (savePalletLocations).
 */
describe('Pallet function (BULK / PICK FACE)', () => {
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

  const createOrderWithItem = async (quantity: number): Promise<number> => {
    const created = await api('inbound', 'create', token, {
      po_number: 'PO-PF' + Math.floor(Math.random() * 100000),
      order_date: '2026-08-16',
    });
    const orderId = Number(created.body.id);
    const add = await api('inbound', 'add_item', token, {
      inbound_id: orderId,
      item: {
        product_id: productId,
        quantity,
        uom: 'Drum',
        batch_number: 'PF-BATCH',
        expiry_date: '2028-06-30',
        in_process_status: 'Dues In',
      },
    });
    expect(add.body.success).toBe(true);
    return Number(add.body.item_id);
  };

  /** Drive a putaway task to completion (marks pallets done, writes stock). */
  const finishTask = async (itemId: number): Promise<void> => {
    const item = (await q<any>(`SELECT inbound_order_id FROM inbound_items WHERE id = $1`, [itemId]))[0];
    const list = await api('putaway', 'task_list', token);
    const task = (list.body.rows || []).find((t: any) => Number(t.inbound_order_id) === Number(item.inbound_order_id));
    expect(task).toBeTruthy();
    const detail = await api('putaway', 'task_detail', token, {}, { id: task.id });
    for (const row of detail.body.rows) {
      if (row.status === 'Pending') {
        const done = await api('putaway', 'task_complete_pallet', token, { id: row.id });
        expect(done.body.success).toBe(true);
      }
    }
    const comp = await api('putaway', 'task_complete', token, { id: task.id });
    expect(comp.body.success).toBe(true);
  };

  it('auto-suggest (deferred via putaway task) derives PICK_FACE at Level A and RESERVE at B-E', async () => {
    const orderIdRes = await api('inbound', 'create', token, {
      po_number: 'PO-PFAUTO' + Math.floor(Math.random() * 100000),
      order_date: '2026-08-16',
    });
    const orderId = Number(orderIdRes.body.id);
    const add = await api('inbound', 'add_item', token, {
      inbound_id: orderId,
      item: { product_id: productId, quantity: 5, uom: 'Drum', batch_number: 'PF-AUTO', in_process_status: 'Dues In' },
    });
    const itemId = Number(add.body.item_id);

    await api('inbound', 'advance_status', token, { id: orderId, status: 'Receiving', received_by_id: 1, received_date: '2026-08-16' });
    const gr = await api('inbound', 'update_item_status', token, { item_id: itemId, status: 'Goods Received' });
    expect(gr.body.success).toBe(true);

    // Goods Received enqueues into the putaway task — stock_locations are NOT
    // written yet, but the suggested bins carry the correct pallet_function.
    const taskRows = await q<{ suggested_location: string; pallet_function: string; status: string }>(
      `SELECT suggested_location, pallet_function, status FROM putaway_task_items WHERE inbound_item_id = $1 ORDER BY suggested_location`,
      [itemId],
    );
    expect(taskRows.length).toBeGreaterThanOrEqual(2);
    for (const r of taskRows) {
      const level = r.suggested_location[4];
      expect(r.pallet_function).toBe(level === 'A' ? 'PICK_FACE' : 'RESERVE');
      expect(r.status).toBe('Pending');
    }
    const preWrite = await q(`SELECT COUNT(*)::int AS c FROM stock_locations WHERE inbound_item_id = $1`, [itemId]);
    expect(Number(preWrite[0].c)).toBe(0);

    // Completing the task materialises stock_locations with the same derivation.
    await finishTask(itemId);
    const rows = await q<{ location_code: string; pallet_function: string }>(
      `SELECT location_code, pallet_function FROM stock_locations WHERE inbound_item_id = $1 ORDER BY location_code`,
      [itemId],
    );
    expect(rows.length).toBeGreaterThanOrEqual(2);
    const byCode = Object.fromEntries(rows.map((r) => [r.location_code, r.pallet_function]));
    for (const [code, fn] of Object.entries(byCode)) {
      const level = code[4];
      expect(fn).toBe(level === 'A' ? 'PICK_FACE' : 'RESERVE');
    }
    expect(Object.values(byCode)).toContain('PICK_FACE');
    expect(Object.values(byCode)).toContain('RESERVE');

    // The 3D rack endpoint must expose the derived pallet_function.
    const bins = await api('putaway', 'bins', token);
    const pickBin = (bins.body.rows || []).find((b: any) => b.pallet_function === 'PICK_FACE');
    expect(pickBin).toBeTruthy();
    expect(String(pickBin.location_code)[4]).toBe('A');
  });

  it('manual save (savePalletLocations) derives pallet_function from the chosen bins', async () => {
    const orderIdRes = await api('inbound', 'create', token, {
      po_number: 'PO-PFMAN' + Math.floor(Math.random() * 100000),
      order_date: '2026-08-16',
    });
    const orderId = Number(orderIdRes.body.id);
    const add = await api('inbound', 'add_item', token, {
      inbound_id: orderId,
      item: { product_id: productId, quantity: 6, uom: 'Drum', batch_number: 'PF-MAN', in_process_status: 'Dues In' },
    });
    const itemId = Number(add.body.item_id);

    const locs = await api('inbound', 'save_pallet_locations', token, {
      inbound_id: orderId,
      item_id: itemId,
      pallet_locations: [
        { location_code: 'ca01a01', pallet_seq: 1, quantity: 2, is_full: 0, batch_number: 'PF-MAN' },
        { location_code: 'CB01B01', pallet_seq: 2, quantity: 4, is_full: 1, batch_number: 'PF-MAN' },
      ],
    });
    expect(locs.body.success).toBe(true);

    const rows = await q<{ location_code: string; pallet_function: string }>(
      `SELECT location_code, pallet_function FROM stock_locations WHERE inbound_item_id = $1 ORDER BY location_code`,
      [itemId],
    );
    const byCode = Object.fromEntries(rows.map((r) => [r.location_code, r.pallet_function]));
    expect(byCode['CA01A01']).toBe('PICK_FACE'); // uppercased
    expect(byCode['CB01B01']).toBe('RESERVE');
  });
});