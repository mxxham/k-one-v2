import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import { hashSync } from 'bcryptjs';
import { getTestApp, closeTestApp, login, api, createProduct, q, resetDb } from './helpers';

/**
 * S43 — New "ops" (Operations) department — handheld menu set for putaway +
 * outbound operators, NO dashboards. ops users gain the whole putaway module,
 * outbound + picklist modules; they are denied inbound, stock and the
 * dashboard. task_list also gains mine=1 (own queue: claimed via assigned_to or
 * on the 2-person team).
 */
describe('ops (Operations) department', () => {
  let token: string;
  let opsToken: string;
  let invToken: string;
  let opsUserId: number;
  let partnerId: number;
  let productId: number;

  beforeAll(async () => {
    await getTestApp();
    await resetDb();
    token = await login();

    const mk = async (username: string, role: string, department: string): Promise<number> => {
      await q(
        `INSERT INTO users (username, password, full_name, email, role, department, is_active)
         VALUES ($1, $2, $3, $4, $5, $6, 1)
         ON CONFLICT (username) DO UPDATE SET
           password = EXCLUDED.password, role = EXCLUDED.role,
           department = EXCLUDED.department, is_active = 1
         RETURNING id`,
        [username, hashSync('admin123', 10), username.toUpperCase(), username + '@local', role, department],
      );
      const row = await q<{ id: number }>(`SELECT id FROM users WHERE username = $1`, [username]);
      return Number(row[0].id);
    };

    opsUserId = await mk('ops_operator', 'operator', 'ops');
    partnerId = await mk('ops_partner', 'operator', 'inbound');

    opsToken = await login('ops_operator', 'admin123');
    await mk('ops_inventory', 'operator', 'inventory');
    invToken = await login('ops_inventory', 'admin123');
    productId = Number(await createProduct({ uom_type: 'Drum' }));
  });

  afterAll(async () => {
    await closeTestApp();
  });

  const createInbound = async (): Promise<{ orderId: number; itemId: number }> => {
    const created = await api('inbound', 'create', token, {
      po_number: 'PO-OPS' + Math.floor(Math.random() * 100000),
      order_date: '2026-08-17',
    });
    const orderId = Number(created.body.id);
    const add = await api('inbound', 'add_item', token, {
      inbound_id: orderId,
      item: { product_id: productId, quantity: 5, uom: 'Drum', batch_number: 'OPS-BATCH', exp_date: '2028-06-30', in_process_status: 'Dues In' },
    });
    return { orderId, itemId: Number(add.body.item_id) };
  };

  const goodsReceived = async (orderId: number, itemId: number): Promise<void> => {
    const adv = await api('inbound', 'advance_status', token, { id: orderId, status: 'Receiving', received_by_id: 1, received_date: '2026-08-17' });
    expect(adv.body.success).toBe(true);
    const gr = await api('inbound', 'update_item_status', token, { item_id: itemId, status: 'Goods Received' });
    expect(gr.body.success).toBe(true);
  };

  const taskForInbound = async (orderId: number): Promise<any> => {
    const list = await api('putaway', 'task_list', token);
    return (list.body.rows || []).find((t: any) => Number(t.inbound_order_id) === orderId) ?? null;
  };

  it('ops operator is granted putaway / outbound / picklist modules', async () => {
    const taskList = await api('putaway', 'task_list', opsToken);
    expect(taskList.body.success).toBe(true);
    const outbound = await api('outbound', 'list', opsToken);
    expect(outbound.body.success).toBe(true);
    const picklist = await api('picklist', 'list', opsToken);
    expect(picklist.body.success).toBe(true);
  });

  it('ops operator is denied inbound / stock / dashboard modules', async () => {
    const inbound = await api('inbound', 'list', opsToken);
    expect(inbound.body.success).toBe(false);
    expect(inbound.status).toBe(403);
    const stock = await api('stock', 'list', opsToken);
    expect(stock.body.success).toBe(false);
    expect(stock.status).toBe(403);
    const dash = await api('dashboard', 'stats', opsToken);
    expect(dash.body.success).toBe(false);
    expect(dash.status).toBe(403);
  });

  it('master::users offers the ops department and userCreate accepts it', async () => {
    const users = await api('users', 'list', token);
    const depts = users.body.departments as Array<{ key: string }>;
    expect(depts.map((d) => d.key)).toContain('ops');

    const uname = 'ops_created_' + Date.now();
    const created = await api('users', 'create', token, {
      username: uname,
      password: 'admin123',
      full_name: 'Ops Created',
      email: uname + '@local',
      role: 'operator',
      department: 'ops',
      is_active: 1,
    });
    expect(created.body.success).toBe(true);
  });

  it('locations::print_labels (rack-walk bin labels, S44) is inventory-only', async () => {
    const labels = await api('locations', 'print_labels', invToken);
    expect(labels.body.success).toBe(true);
    expect(Array.isArray(labels.body.rows)).toBe(true);
    if (labels.body.rows.length > 0) {
      expect(labels.body.rows[0]).toHaveProperty('location_code');
      expect(labels.body.rows[0]).toHaveProperty('aisle');
    }

    const zoneFiltered = await api('locations', 'print_labels', invToken, {}, { zone: 'Bulk' });
    expect(zoneFiltered.body.success).toBe(true);
    for (const r of zoneFiltered.body.rows) {
      expect(r.zone).toBe('Bulk');
    }

    const denied = await api('locations', 'print_labels', opsToken);
    expect(denied.body.success).toBe(false);
    expect(denied.status).toBe(403);
  });

  it('task_list mine=1 returns only tasks owned by the current user', async () => {
    const { orderId: mineOrder, itemId: mineItem } = await createInbound();
    await goodsReceived(mineOrder, mineItem);
    const mineTask = await taskForInbound(mineOrder);
    await api('putaway', 'assign_task', token, { id: mineTask.id, forklift_operator_id: opsUserId, checklist_partner_id: partnerId });

    const { orderId: otherOrder, itemId: otherItem } = await createInbound();
    await goodsReceived(otherOrder, otherItem);
    const otherTask = await taskForInbound(otherOrder);

    // All tasks visible without the filter.
    const all = await api('putaway', 'task_list', opsToken);
    const allNumbers = (all.body.rows as any[]).map((t) => t.task_number);
    expect(allNumbers).toContain(mineTask.task_number);
    expect(allNumbers).toContain(otherTask.task_number);

    // mine=1 shows only the ops operator's own tasks.
    const mine = await api('putaway', 'task_list', opsToken, {}, { mine: 1 });
    const mineNumbers = (mine.body.rows as any[]).map((t) => t.task_number);
    expect(mineNumbers).toContain(mineTask.task_number);
    expect(mineNumbers).not.toContain(otherTask.task_number);
  });
});