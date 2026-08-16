import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import { hashSync } from 'bcryptjs';
import { getTestApp, closeTestApp, login, api, createProduct, q, resetDb } from './helpers';

/**
 * S42 — Putaway task queue.
 * Goods Received enqueues the engine's pallet suggestions into a per-inbound
 * putaway task (PKA-...). Operators claim it, confirm/override bins, complete
 * pallets, then completing the task writes stock_locations. Inbound completion
 * is gated while an open task has Pending pallets; the manual Manage Pallet
 * Locations path reconciles (marks Done) so it never strands the block.
 */
describe('Putaway Task Queue', () => {
  let token: string;
  let operatorToken: string;
  let outboundToken: string;
  let productId: number;

  beforeAll(async () => {
    await getTestApp();
    await resetDb();
    token = await login();

    await q(
      `INSERT INTO users (username, password, full_name, email, role, department, is_active)
       VALUES ('ptk_operator', $1, 'PTK Operator', 'ptkop@local', 'operator', 'all', 1)
       ON CONFLICT (username) DO UPDATE SET password = EXCLUDED.password, role = 'operator', is_active = 1`,
      [hashSync('admin123', 10)],
    );
    await q(
      `INSERT INTO users (username, password, full_name, email, role, department, is_active)
       VALUES ('ptk_outbound', $1, 'PTK Outbound', 'ptkob@local', 'operator', 'outbound', 1)
       ON CONFLICT (username) DO UPDATE SET password = EXCLUDED.password, role = 'operator', department = 'outbound', is_active = 1`,
      [hashSync('admin123', 10)],
    );

    operatorToken = await login('ptk_operator', 'admin123');
    outboundToken = await login('ptk_outbound', 'admin123');
    productId = Number(await createProduct({ uom_type: 'Drum' }));
  });

  afterAll(async () => {
    await closeTestApp();
  });

  const createInbound = async (quantity: number, batch = 'PTK-BATCH'): Promise<{ orderId: number; itemId: number }> => {
    const created = await api('inbound', 'create', token, {
      po_number: 'PO-PTK' + Math.floor(Math.random() * 100000),
      order_date: '2026-08-16',
    });
    const orderId = Number(created.body.id);
    const add = await api('inbound', 'add_item', token, {
      inbound_id: orderId,
      item: { product_id: productId, quantity, uom: 'Drum', batch_number: batch, expiry_date: '2028-06-30', in_process_status: 'Dues In' },
    });
    return { orderId, itemId: Number(add.body.item_id) };
  };

  const goodsReceived = async (orderId: number, itemId: number): Promise<void> => {
    const adv = await api('inbound', 'advance_status', token, { id: orderId, status: 'Receiving', received_by_id: 1, received_date: '2026-08-16' });
    expect(adv.body.success).toBe(true);
    const gr = await api('inbound', 'update_item_status', token, { item_id: itemId, status: 'Goods Received' });
    expect(gr.body.success).toBe(true);
  };

  const taskForInbound = async (orderId: number): Promise<any> => {
    const list = await api('putaway', 'task_list', token);
    return (list.body.rows || []).find((t: any) => Number(t.inbound_order_id) === orderId) ?? null;
  };

  const finishTask = async (task: any): Promise<void> => {
    const detail = await api('putaway', 'task_detail', token, {}, { id: task.id });
    for (const row of detail.body.rows) {
      if (row.status === 'Pending') {
        const done = await api('putaway', 'task_complete_pallet', operatorToken, { id: row.id });
        expect(done.body.success).toBe(true);
      }
    }
    const comp = await api('putaway', 'task_complete', operatorToken, { id: task.id });
    expect(comp.body.success).toBe(true);
  };

  it('auto-creates a Pending task (PKA number) with suggested pallet rows on Goods Received', async () => {
    const { orderId, itemId } = await createInbound(5);
    await goodsReceived(orderId, itemId);

    const task = await taskForInbound(orderId);
    expect(task).toBeTruthy();
    expect(task.status).toBe('Pending');
    expect(String(task.task_number)).toMatch(/^PKA-\d{8}-\d{4}$/);
    expect(task.pallet_count).toBeGreaterThanOrEqual(2);
    expect(task.done_count).toBe(0);

    const rows = await q<{ status: string; suggested_location: string; quantity: string; pallet_function: string }>(
      `SELECT status, suggested_location, quantity, pallet_function FROM putaway_task_items WHERE task_id = $1 ORDER BY pallet_seq`,
      [task.id],
    );
    expect(rows.length).toBeGreaterThanOrEqual(2);
    for (const r of rows) {
      expect(r.status).toBe('Pending');
      expect(r.suggested_location).toBeTruthy();
      expect(['PICK_FACE', 'RESERVE']).toContain(r.pallet_function);
    }
    const total = rows.reduce((a, r) => a + Number(r.quantity), 0);
    expect(total).toBe(5);

    // stock_locations NOT written yet — only written on task completion.
    const preWrite = await q(`SELECT COUNT(*)::int AS c FROM stock_locations WHERE inbound_item_id = $1`, [itemId]);
    expect(Number(preWrite[0].c)).toBe(0);
  });

  it('batches all items of an inbound into one task', async () => {
    const { orderId, itemId: item1 } = await createInbound(4, 'PTK-A');
    const add = await api('inbound', 'add_item', token, {
      inbound_id: orderId,
      item: { product_id: productId, quantity: 8, uom: 'Drum', batch_number: 'PTK-B', in_process_status: 'Dues In' },
    });
    const item2 = Number(add.body.item_id);
    await goodsReceived(orderId, item1);
    await goodsReceived(orderId, item2);

    const tasks = (await api('putaway', 'task_list', token)).body.rows.filter((t: any) => Number(t.inbound_order_id) === orderId);
    expect(tasks.length).toBe(1);
    expect(tasks[0].pallet_count).toBeGreaterThanOrEqual(3);
  });

  it('task_list filters by status and search (task number / inbound)', async () => {
    const { orderId, itemId } = await createInbound(5);
    await goodsReceived(orderId, itemId);
    const task = await taskForInbound(orderId);

    const byStatus = await api('putaway', 'task_list', token, {}, { status: 'Pending' });
    expect(byStatus.body.rows.some((t: any) => t.task_number === task.task_number)).toBe(true);

    const byNumber = await api('putaway', 'task_list', token, {}, { search: task.task_number });
    expect(byNumber.body.rows.map((t: any) => t.task_number)).toContain(task.task_number);

    const byInbound = await api('putaway', 'task_list', token, {}, { search: String(task.order_number) });
    expect(byInbound.body.rows.map((t: any) => t.task_number)).toContain(task.task_number);

    const none = await api('putaway', 'task_list', token, {}, { search: 'ZZZ-NOT-A-THING' });
    expect(none.body.rows.length).toBe(0);
  });

  it('task_detail returns header with product info and pallet rows', async () => {
    const { orderId, itemId } = await createInbound(5);
    await goodsReceived(orderId, itemId);
    const task = await taskForInbound(orderId);

    const detail = await api('putaway', 'task_detail', token, {}, { id: task.id });
    expect(detail.body.task.task_number).toBe(task.task_number);
    expect(detail.body.task.order_number).toBeTruthy();
    expect(detail.body.rows.length).toBeGreaterThanOrEqual(2);
    for (const r of detail.body.rows) {
      expect(r.product_code).toBeTruthy();
      expect(r.suggested_location).toBeTruthy();
    }
  });

  it('task_assign claims the task (operator) and moves it to In Progress', async () => {
    const { orderId, itemId } = await createInbound(5);
    await goodsReceived(orderId, itemId);
    const task = await taskForInbound(orderId);

    const assign = await api('putaway', 'task_assign', operatorToken, { id: task.id });
    expect(assign.body.success).toBe(true);

    const row = (await q(`SELECT status, assigned_to, started_at FROM putaway_tasks WHERE id = $1`, [task.id]))[0];
    expect(row.status).toBe('In Progress');
    expect(row.assigned_to).toBeTruthy();
    expect(row.started_at).toBeTruthy();
  });

  it('task_update_pallet rejects blocked bins and accepts valid bins', async () => {
    await api('putaway', 'create_block', token, { scope_type: 'aisle', aisle_prefix: 'CA', reason: 'Level A CA tutup utk test' });
    const { orderId, itemId } = await createInbound(5);
    await goodsReceived(orderId, itemId);
    const task = await taskForInbound(orderId);
    const detail = await api('putaway', 'task_detail', token, {}, { id: task.id });
    const rowId = detail.body.rows[0].id;

    const blocked = await api('putaway', 'task_update_pallet', operatorToken, { id: rowId, location: 'CA01A01' });
    expect(blocked.body.success).toBe(false);
    expect(blocked.status).toBe(400);
    expect(String(blocked.body.message)).toContain('diblokir');

    const ok = await api('putaway', 'task_update_pallet', operatorToken, { id: rowId, location: 'CB01B01' });
    expect(ok.body.success).toBe(true);

    const updated = (await q(`SELECT actual_location FROM putaway_task_items WHERE id = $1`, [rowId]))[0];
    expect(updated.actual_location).toBe('CB01B01');
  });

  it('completing pallets then the task writes stock_locations with correct pallet_function', async () => {
    const { orderId, itemId } = await createInbound(5);
    await goodsReceived(orderId, itemId);
    const task = await taskForInbound(orderId);

    const detail = await api('putaway', 'task_detail', token, {}, { id: task.id });
    for (const row of detail.body.rows) {
      const done = await api('putaway', 'task_complete_pallet', operatorToken, { id: row.id });
      expect(done.body.success).toBe(true);
    }

    const comp = await api('putaway', 'task_complete', operatorToken, { id: task.id });
    expect(comp.body.success).toBe(true);
    expect(comp.body.task_number).toBe(task.task_number);
    expect(comp.body.pallets).toBe(detail.body.rows.length);

    const taskRow = (await q(`SELECT status, completed_at FROM putaway_tasks WHERE id = $1`, [task.id]))[0];
    expect(taskRow.status).toBe('Completed');
    expect(taskRow.completed_at).toBeTruthy();

    const rows = await q<{ location_code: string; pallet_function: string }>(
      `SELECT location_code, pallet_function FROM stock_locations WHERE inbound_item_id = $1 ORDER BY location_code`,
      [itemId],
    );
    expect(rows.length).toBe(detail.body.rows.length);
    for (const r of rows) {
      const level = r.location_code[4];
      expect(r.pallet_function).toBe(level === 'A' ? 'PICK_FACE' : 'RESERVE');
    }
  });

  it('blocks inbound completion while an open task has Pending pallets, then allows after completion', async () => {
    const { orderId, itemId } = await createInbound(5);
    await goodsReceived(orderId, itemId);

    // Item must be ATP before the completion action passes its own gate; the
    // putaway-task gate then fires because the task still has Pending pallets.
    const atp = await api('inbound', 'update_item_status', token, { item_id: itemId, status: 'ATP' });
    expect(atp.body.success).toBe(true);

    const blocked = await api('inbound', 'complete', token, { id: orderId });
    expect(blocked.body.success).toBe(false);
    expect(blocked.status).toBe(409);
    expect(String(blocked.body.message)).toMatch(/PKA-\d{8}-\d{4}/);

    const task = await taskForInbound(orderId);
    await finishTask(task);

    const ok = await api('inbound', 'complete', token, { id: orderId });
    expect(ok.body.success).toBe(true);
    const order = (await q(`SELECT status FROM inbound_orders WHERE id = $1`, [orderId]))[0];
    expect(order.status).toBe('Completed');
  });

  it('manual save_pallet_locations reconciles the task so inbound completion is not blocked', async () => {
    const { orderId, itemId } = await createInbound(6);
    await goodsReceived(orderId, itemId);
    const task = await taskForInbound(orderId);
    expect(task.pallet_count).toBeGreaterThan(0);

    // CA aisle is blocked by an earlier test — use CB bins (CB01A01 = pick face).
    const locs = await api('inbound', 'save_pallet_locations', token, {
      inbound_id: orderId,
      item_id: itemId,
      pallet_locations: [
        { location_code: 'cb01a01', pallet_seq: 1, quantity: 2, is_full: 0, batch_number: 'PTK-BATCH' },
        { location_code: 'CB01B01', pallet_seq: 2, quantity: 4, is_full: 1, batch_number: 'PTK-BATCH' },
      ],
    });
    expect(locs.body.success).toBe(true);

    // The item's open task rows are marked Done (reconciled)…
    const doneRows = await q(`SELECT status FROM putaway_task_items WHERE task_id = $1 AND inbound_item_id = $2`, [task.id, itemId]);
    expect(doneRows.length).toBeGreaterThan(0);
    expect(doneRows.every((r) => r.status === 'Done')).toBe(true);

    // …so once the item is ATP, inbound completion is no longer blocked and
    // no stock is double-written.
    const atp = await api('inbound', 'update_item_status', token, { item_id: itemId, status: 'ATP' });
    expect(atp.body.success).toBe(true);
    const comp = await api('inbound', 'complete', token, { id: orderId });
    expect(comp.body.success).toBe(true);
    const locCount = await q(`SELECT COUNT(*)::int AS c FROM stock_locations WHERE inbound_item_id = $1`, [itemId]);
    expect(Number(locCount[0].c)).toBe(2);
  });

  it('task_cancel cancels the task and its open pallet rows, unblocking inbound completion', async () => {
    const { orderId, itemId } = await createInbound(5);
    await goodsReceived(orderId, itemId);
    const task = await taskForInbound(orderId);

    const cancel = await api('putaway', 'task_cancel', operatorToken, { id: task.id });
    expect(cancel.body.success).toBe(true);

    const taskRow = (await q(`SELECT status, cancelled_by FROM putaway_tasks WHERE id = $1`, [task.id]))[0];
    expect(taskRow.status).toBe('Cancelled');
    expect(taskRow.cancelled_by).toBeTruthy();

    const rows = await q(`SELECT status FROM putaway_task_items WHERE task_id = $1`, [task.id]);
    expect(rows.every((r) => r.status === 'Cancelled')).toBe(true);

    const atp = await api('inbound', 'update_item_status', token, { item_id: itemId, status: 'ATP' });
    expect(atp.body.success).toBe(true);
    const comp = await api('inbound', 'complete', token, { id: orderId });
    expect(comp.body.success).toBe(true);
  });

  it('enforces permissions: write actions accept operators, module restricted to inbound/inventory', async () => {
    const { orderId, itemId } = await createInbound(5);
    await goodsReceived(orderId, itemId);
    const task = await taskForInbound(orderId);

    // Operator (write role) can list/detail and claim the task.
    const list = await api('putaway', 'task_list', operatorToken);
    expect(list.body.success).toBe(true);
    const detail = await api('putaway', 'task_detail', operatorToken, {}, { id: task.id });
    expect(detail.body.success).toBe(true);
    const claim = await api('putaway', 'task_assign', operatorToken, { id: task.id });
    expect(claim.body.success).toBe(true);

    // Outbound-department operator is denied — putaway module is inbound/inventory.
    const denied = await api('putaway', 'task_list', outboundToken);
    expect(denied.body.success).toBe(false);
    expect(denied.status).toBe(403);

    // Strict role split: task_complete is also module-scoped — only the
    // inbound operator (desktop) finishes the task, never the outbound partner.
    const deniedComp = await api('putaway', 'task_complete', outboundToken, { id: task.id });
    expect(deniedComp.body.success).toBe(false);
    expect(deniedComp.status).toBe(403);
  });
});