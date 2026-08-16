import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import { hashSync } from 'bcryptjs';
import { getTestApp, closeTestApp, login, api, createProduct, q, resetDb } from './helpers';

/**
 * S49 — LPN-based putaway + two-person task assignment (extends S42).
 * Goods Received now also generates a unique per-pallet LPN (LPN-YYYYMMDD-#####)
 * which the browser prints as a CODE128 label. The inbound operator assigns a
 * 2-person team (forklift operator + checklist partner, any active department);
 * the partner confirms each pallet on the mobile screen by dual-scanning LPN +
 * bin and reusing the S42 task_complete_pallet action.
 */
describe('Putaway LPN + Team Assignment', () => {
  let token: string;
  let partnerToken: string;
  let inboundToken: string;
  let productId: number;
  let forkliftId: number;
  let partnerId: number;

  beforeAll(async () => {
    await getTestApp();
    await resetDb();
    token = await login();

    const mk = async (username: string, role: string, department: string, isActive = 1): Promise<number> => {
      await q(
        `INSERT INTO users (username, password, full_name, email, role, department, is_active)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (username) DO UPDATE SET
           password = EXCLUDED.password, role = EXCLUDED.role,
           department = EXCLUDED.department, is_active = EXCLUDED.is_active
         RETURNING id`,
        [username, hashSync('admin123', 10), username.toUpperCase(), username + '@local', role, department, isActive],
      );
      const row = await q<{ id: number }>(`SELECT id FROM users WHERE username = $1`, [username]);
      return Number(row[0].id);
    };

    forkliftId = await mk('lpn_forklift', 'operator', 'inbound');
    partnerId = await mk('lpn_partner', 'operator', 'outbound'); // any-dept partner
    await mk('lpn_inactive', 'operator', 'inbound', 0);

    partnerToken = await login('lpn_partner', 'admin123');
    inboundToken = await login('lpn_forklift', 'admin123');
    productId = Number(await createProduct({ uom_type: 'Drum' }));
  });

  afterAll(async () => {
    await closeTestApp();
  });

  const createInbound = async (quantity: number, batch = 'LPN-BATCH'): Promise<{ orderId: number; itemId: number }> => {
    const created = await api('inbound', 'create', token, {
      po_number: 'PO-LPN' + Math.floor(Math.random() * 100000),
      order_date: '2026-08-16',
    });
    const orderId = Number(created.body.id);
    const add = await api('inbound', 'add_item', token, {
      inbound_id: orderId,
      item: { product_id: productId, quantity, uom: 'Drum', batch_number: batch, exp_date: '2028-06-30', in_process_status: 'Dues In' },
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

  it('generates a unique LPN per pallet at Goods Received (LPN-YYYYMMDD-#####)', async () => {
    const { orderId, itemId } = await createInbound(5);
    await goodsReceived(orderId, itemId);
    const task = await taskForInbound(orderId);
    expect(task).toBeTruthy();
    expect(task.pallet_count).toBeGreaterThanOrEqual(2);

    const rows = await q<{ lpn_code: string | null }>(
      `SELECT lpn_code FROM putaway_task_items WHERE task_id = $1 ORDER BY pallet_seq`,
      [task.id],
    );
    expect(rows.length).toBeGreaterThanOrEqual(2);
    for (const r of rows) {
      expect(r.lpn_code).toBeTruthy();
      expect(String(r.lpn_code)).toMatch(/^LPN-\d{8}-\d{5}$/);
    }
    const codes = rows.map((r) => r.lpn_code);
    expect(new Set(codes).size).toBe(codes.length);
    expect(await q(`SELECT COUNT(*)::int AS c FROM putaway_task_items WHERE lpn_code IS NULL`, [])).toEqual([{ c: 0 }]);
  });

  it('get_lpn_label_data returns structured label JSON (product, batch, qty, expiry, bin)', async () => {
    const { orderId, itemId } = await createInbound(5, 'LPN-BATCH-X');
    await goodsReceived(orderId, itemId);
    const task = await taskForInbound(orderId);
    const detail = await api('putaway', 'task_detail', token, {}, { id: task.id });
    const row = detail.body.rows[0];

    const res = await api('putaway', 'get_lpn_label_data', token, {}, { id: row.id });
    expect(res.body.success).toBe(true);
    const label = res.body.label;
    expect(label.lpn_code).toBe(row.lpn_code);
    expect(label.product_name).toBeTruthy();
    expect(label.product_code).toBeTruthy();
    expect(label.batch_number).toBe('LPN-BATCH-X');
    expect(Number(label.quantity)).toBe(Number(row.quantity));
    expect(label.suggested_location).toBe(row.suggested_location);
    expect(label.expiry_date).toBe('2028-06-30');
    expect(label.task_number).toBe(task.task_number);
    expect(label.order_number).toBeTruthy();
  });

  it('print_lpn_label confirms the LPN and logs PRINT_LPN_LABEL', async () => {
    const { orderId, itemId } = await createInbound(5);
    await goodsReceived(orderId, itemId);
    const task = await taskForInbound(orderId);
    const detail = await api('putaway', 'task_detail', token, {}, { id: task.id });
    const row = detail.body.rows[0];

    const res = await api('putaway', 'print_lpn_label', token, { id: row.id });
    expect(res.body.success).toBe(true);
    expect(res.body.label.lpn_code).toBe(row.lpn_code);

    const acts = await q<{ action: string; reference_no: string }>(
      `SELECT action, reference_no FROM activity_log WHERE reference_type = 'PutawayTaskItem' AND reference_id = $1 ORDER BY id DESC LIMIT 1`,
      [row.id],
    );
    expect(acts[0].action).toBe('PRINT_LPN_LABEL');
    expect(acts[0].reference_no).toBe(row.lpn_code);
  });

  it('assignable_users returns only active users', async () => {
    const res = await api('putaway', 'assignable_users', token);
    expect(res.body.success).toBe(true);
    const ids = (res.body.rows as Array<{ id: number; username: string }>).map((u) => u.id);
    expect(ids).toContain(forkliftId);
    expect(ids).toContain(partnerId);
    const names = (res.body.rows as Array<{ username: string }>).map((u) => u.username);
    expect(names).not.toContain('lpn_inactive');
  });

  it('assign_task sets the 2-person team and moves the task to In Progress', async () => {
    const { orderId, itemId } = await createInbound(5);
    await goodsReceived(orderId, itemId);
    const task = await taskForInbound(orderId);

    const assign = await api('putaway', 'assign_task', token, {
      id: task.id,
      forklift_operator_id: forkliftId,
      checklist_partner_id: partnerId,
    });
    expect(assign.body.success).toBe(true);

    const row = (await q(`SELECT status, forklift_operator_id, checklist_partner_id, started_at FROM putaway_tasks WHERE id = $1`, [task.id]))[0];
    expect(row.status).toBe('In Progress');
    expect(Number(row.forklift_operator_id)).toBe(forkliftId);
    expect(Number(row.checklist_partner_id)).toBe(partnerId);
    expect(row.started_at).toBeTruthy();

    // task_detail exposes the joined team names.
    const detail = await api('putaway', 'task_detail', token, {}, { id: task.id });
    expect(detail.body.task.forklift_operator_name).toBeTruthy();
    expect(detail.body.task.checklist_partner_name).toBeTruthy();
    expect(detail.body.rows[0].lpn_code).toBeTruthy();
  });

  it('assign_task rejects an inactive user or the same user for both roles', async () => {
    const { orderId, itemId } = await createInbound(5);
    await goodsReceived(orderId, itemId);
    const task = await taskForInbound(orderId);

    const inact = await q<{ id: number }>(`SELECT id FROM users WHERE username = 'lpn_inactive'`);
    const inactiveId = Number(inact[0].id);
    const bad = await api('putaway', 'assign_task', token, {
      id: task.id,
      forklift_operator_id: inactiveId,
      checklist_partner_id: partnerId,
    });
    expect(bad.body.success).toBe(false);
    expect(bad.status).toBe(400);

    const same = await api('putaway', 'assign_task', token, {
      id: task.id,
      forklift_operator_id: forkliftId,
      checklist_partner_id: forkliftId,
    });
    expect(same.body.success).toBe(false);
    expect(same.status).toBe(400);
  });

  it('unassign_task clears both team columns', async () => {
    const { orderId, itemId } = await createInbound(5);
    await goodsReceived(orderId, itemId);
    const task = await taskForInbound(orderId);

    await api('putaway', 'assign_task', token, { id: task.id, forklift_operator_id: forkliftId, checklist_partner_id: partnerId });
    const un = await api('putaway', 'unassign_task', token, { id: task.id });
    expect(un.body.success).toBe(true);

    const row = (await q(`SELECT forklift_operator_id, checklist_partner_id FROM putaway_tasks WHERE id = $1`, [task.id]))[0];
    expect(row.forklift_operator_id).toBeNull();
    expect(row.checklist_partner_id).toBeNull();
  });

  it('my_tasks returns only the checklist partner own tasks with rows + forklift name', async () => {
    const { orderId, itemId } = await createInbound(5);
    await goodsReceived(orderId, itemId);
    const task = await taskForInbound(orderId);
    await api('putaway', 'assign_task', token, { id: task.id, forklift_operator_id: forkliftId, checklist_partner_id: partnerId });

    const mine = await api('putaway', 'my_tasks', partnerToken);
    expect(mine.body.success).toBe(true);
    const list = mine.body.rows as any[];
    expect(list.length).toBeGreaterThan(0);
    const mineTask = list.find((t) => t.task_number === task.task_number);
    expect(mineTask).toBeTruthy();
    expect(mineTask.forklift_operator_name).toBeTruthy();
    expect(mineTask.rows.length).toBeGreaterThanOrEqual(2);
    for (const r of mineTask.rows) {
      expect(r.lpn_code).toBeTruthy();
      expect(r.suggested_location).toBeTruthy();
    }
  });

  it('strict role split: partner confirms pallets via scan; only the inbound operator completes', async () => {
    const { orderId, itemId } = await createInbound(5);
    await goodsReceived(orderId, itemId);
    const task = await taskForInbound(orderId);
    await api('putaway', 'assign_task', token, { id: task.id, forklift_operator_id: forkliftId, checklist_partner_id: partnerId });

    // Outbound partner still 403 on the module-restricted list…
    const denied = await api('putaway', 'task_list', partnerToken);
    expect(denied.body.success).toBe(false);
    expect(denied.status).toBe(403);

    // …but can see their own tasks and confirm every pallet on mobile (the
    // dual-scan path reuses task_complete_pallet).
    const mine = await api('putaway', 'my_tasks', partnerToken);
    const mineTask = mine.body.rows.find((t: any) => t.task_number === task.task_number);
    for (const row of mineTask.rows) {
      const done = await api('putaway', 'task_complete_pallet', partnerToken, { id: row.id });
      expect(done.body.success).toBe(true);
    }

    // The partner CANNOT finish the task — task_complete is restricted to the
    // putaway module (inbound/inventory/ops), only the inbound operator.
    const deniedComp = await api('putaway', 'task_complete', partnerToken, { id: task.id });
    expect(deniedComp.body.success).toBe(false);
    expect(deniedComp.status).toBe(403);

    const comp = await api('putaway', 'task_complete', inboundToken, { id: task.id });
    expect(comp.body.success).toBe(true);

    const taskRow = (await q(`SELECT status FROM putaway_tasks WHERE id = $1`, [task.id]))[0];
    expect(taskRow.status).toBe('Completed');
    const written = await q(`SELECT COUNT(*)::int AS c FROM stock_locations WHERE inbound_item_id = $1`, [itemId]);
    expect(Number(written[0].c)).toBe(mineTask.rows.length);
  });

  it('scan_override requires a reason and logs SCAN_OVERRIDE under putaway', async () => {
    const noReason = await api('putaway', 'scan_override', partnerToken, { code: 'LPN-20260816-99999' });
    expect(noReason.body.success).toBe(false);
    expect(noReason.status).toBe(400);

    const ok = await api('putaway', 'scan_override', partnerToken, {
      code: 'LPN-20260816-99999',
      reason: 'LPN label rusak',
      context: 'putaway:PKA-123',
    });
    expect(ok.body.success).toBe(true);

    const acts = await q<{ action: string; module: string }>(
      `SELECT action, module FROM activity_log WHERE action = 'SCAN_OVERRIDE' ORDER BY id DESC LIMIT 1`,
    );
    expect(acts[0].action).toBe('SCAN_OVERRIDE');
    expect(acts[0].module).toBe('putaway');
  });

  it('permissions: team + print + label are module-scoped; inbound users can run them', async () => {
    const { orderId, itemId } = await createInbound(5);
    await goodsReceived(orderId, itemId);
    const task = await taskForInbound(orderId);
    const detail = await api('putaway', 'task_detail', token, {}, { id: task.id });
    const row = detail.body.rows[0];

    // Outbound partner (write role, but outside the inbound/inventory module)
    // is denied every module-scoped action — team mutations, label print AND
    // label read.
    const assign = await api('putaway', 'assign_task', partnerToken, { id: task.id, forklift_operator_id: forkliftId, checklist_partner_id: partnerId });
    expect(assign.body.success).toBe(false);
    expect(assign.status).toBe(403);
    const unassign = await api('putaway', 'unassign_task', partnerToken, { id: task.id });
    expect(unassign.status).toBe(403);
    const print = await api('putaway', 'print_lpn_label', partnerToken, { id: row.id });
    expect(print.status).toBe(403);
    const read = await api('putaway', 'get_lpn_label_data', partnerToken, {}, { id: row.id });
    expect(read.status).toBe(403);

    // An inbound-dept user (write role) can both read the label and run the
    // write actions.
    const readOk = await api('putaway', 'get_lpn_label_data', inboundToken, {}, { id: row.id });
    expect(readOk.body.success).toBe(true);
    expect(readOk.body.label.lpn_code).toBe(row.lpn_code);
    const assignOk = await api('putaway', 'assign_task', inboundToken, { id: task.id, forklift_operator_id: forkliftId, checklist_partner_id: partnerId });
    expect(assignOk.body.success).toBe(true);
    const printOk = await api('putaway', 'print_lpn_label', inboundToken, { id: row.id });
    expect(printOk.body.success).toBe(true);
  });

  it('inbound::detail exposes the open putaway task with LPNs and the assigned team', async () => {
    const { orderId, itemId } = await createInbound(5);
    await goodsReceived(orderId, itemId);

    const detail = await api('inbound', 'detail', token, {}, { id: orderId });
    expect(detail.body.success).toBe(true);
    const pt = detail.body.putaway_task;
    expect(pt).toBeTruthy();
    expect(pt.task.status).toBe('Pending');
    expect(pt.rows.length).toBeGreaterThanOrEqual(2);
    expect(pt.rows.every((r: any) => r.lpn_code && /^LPN-\d{8}-\d{5}$/.test(r.lpn_code))).toBe(true);
    expect(pt.rows.every((r: any) => r.suggested_location)).toBe(true);

    // Assign the team via the putaway action — the inbound detail reflects it.
    const assign = await api('putaway', 'assign_task', token, {
      id: pt.task.id,
      forklift_operator_id: forkliftId,
      checklist_partner_id: partnerId,
    });
    expect(assign.body.success).toBe(true);

    const detail2 = await api('inbound', 'detail', token, {}, { id: orderId });
    expect(detail2.body.putaway_task.task.forklift_operator_id).toBe(forkliftId);
    expect(detail2.body.putaway_task.task.checklist_partner_id).toBe(partnerId);
    expect(detail2.body.putaway_task.task.forklift_operator_name).toBeTruthy();
    expect(detail2.body.putaway_task.task.checklist_partner_name).toBeTruthy();
    expect(detail2.body.putaway_task.task.status).toBe('In Progress');
  });
});