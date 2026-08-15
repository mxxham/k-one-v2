import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import { getTestApp, closeTestApp, login, api, createProduct, q, resetDb, putStock } from './helpers';
import { hashSync } from 'bcryptjs';

describe('Cycle Count Scheduling', () => {
  let adminToken: string;
  let operatorToken: string;

  beforeAll(async () => {
    await getTestApp();
    await resetDb();
    adminToken = await login();
    const pw = hashSync('admin123', 10);
    await q(
      `INSERT INTO users (username, password, full_name, email, role, department, is_active)
       VALUES ('cc_operator', $1, 'CC Operator', 'ccop@local', 'operator', 'inventory', 1)
       ON CONFLICT (username) DO UPDATE SET password = EXCLUDED.password, role = 'operator', department = 'inventory', is_active = 1`,
      [pw],
    );
    operatorToken = await login('cc_operator', 'admin123');
  });
  afterAll(async () => {
    await closeTestApp();
  });

  const makeSchedule = (over: Record<string, any> = {}) =>
    api('cyclecount', 'create', adminToken, {
      schedule_name: 'Monthly Full Count',
      frequency: 'monthly',
      scope_type: 'full',
      next_run_date: '2026-01-01',
      ...over,
    });

  it('rejects a non-admin run_due', async () => {
    const res = await api('cyclecount', 'run_due', operatorToken, {});
    expect(res.body.success).toBe(false);
    expect(res.status).toBe(403);
  });

  it('rejects a non-admin run_now', async () => {
    const res = await api('cyclecount', 'run_now', operatorToken, { id: 1 });
    expect(res.body.success).toBe(false);
    expect(res.status).toBe(403);
  });

  it('creates and lists schedules', async () => {
    await resetDb();
    const res = await makeSchedule();
    expect(res.body.success).toBe(true);
    const id = Number(res.body.id);
    expect(id).toBeGreaterThan(0);

    const list = await api('cyclecount', 'list', adminToken, {});
    expect(list.body.success).toBe(true);
    const row = list.body.rows.find((r: any) => Number(r.id) === id);
    expect(row.schedule_name).toBe('Monthly Full Count');
    expect(row.frequency).toBe('monthly');
    expect(row.scope_type).toBe('full');
    expect(row.is_due).toBe(true); // next_run_date 2026-01-01 <= today
    expect(row.created_by_name).toBe('Test Admin');
  });

  it('validates create inputs', async () => {
    await resetDb();
    const noName = await makeSchedule({ schedule_name: '' });
    expect(noName.status).toBe(400);

    const badFreq = await makeSchedule({ frequency: 'daily' });
    expect(badFreq.status).toBe(400);

    const locationNoLocs = await makeSchedule({ scope_type: 'location' });
    expect(locationNoLocs.status).toBe(400);

    const velocityNoClass = await makeSchedule({ scope_type: 'velocity' });
    expect(velocityNoClass.status).toBe(400);
  });

  it('run_due generates a stock_take via StockTakeService.create and advances next_run_date', async () => {
    await resetDb();
    const p = Number(await createProduct({}));
    await putStock(p, 'CA01A01', 10, 'BATCH-CC', '2030-12-31');

    // Due yesterday, weekly frequency → after run it advances past today.
    const today = new Date(Date.now() + 7 * 60 * 60 * 1000);
    const yesterday = new Date(today.getTime() - 86400000);
    const yStr = yesterday.toISOString().slice(0, 10);
    const nxt = new Date(today.getTime() + 6 * 86400000).toISOString().slice(0, 10); // yesterday + 7 days

    await makeSchedule({ schedule_name: 'Due Weekly', frequency: 'weekly', next_run_date: yStr });
    const res = await api('cyclecount', 'run_due', adminToken, {});
    expect(res.body.success).toBe(true);
    expect(res.body.count).toBe(1);
    const gen = res.body.generated[0];
    expect(gen.schedule_name).toBe('Due Weekly');
    expect(gen.take_number).toMatch(/^ST-/);

    // Stock take exists, has the item, is linked to the schedule, and is Draft.
    const takes = await q<any>('SELECT id, take_number, scope_type, schedule_id, notes FROM stock_take WHERE schedule_id = $1', [gen.schedule_id]);
    expect(takes.length).toBe(1);
    expect(takes[0].take_number).toBe(gen.take_number);
    expect(takes[0].schedule_id).toBe(gen.schedule_id);
    expect(takes[0].notes).toContain('Due Weekly');
    const items = await q<any>('SELECT * FROM stock_take_items WHERE stock_take_id = $1', [takes[0].id]);
    expect(items.length).toBe(1);
    expect(Number(items[0].product_id)).toBe(p);
    expect(Number(items[0].qty_system)).toBe(10);

    // next_run_date advanced +7 days from the original date.
    const sched = await q<any>('SELECT next_run_date FROM cycle_count_schedules WHERE id = $1', [gen.schedule_id]);
    expect(sched[0].next_run_date).toBe(nxt);

    // Running again now produces nothing (already advanced past today).
    const again = await api('cyclecount', 'run_due', adminToken, {});
    expect(again.body.count).toBe(0);
  });

  it('run_due with a not-yet-due schedule generates nothing', async () => {
    await resetDb();
    await makeSchedule({ schedule_name: 'Future', next_run_date: '2099-01-01' });
    const res = await api('cyclecount', 'run_due', adminToken, {});
    expect(res.body.success).toBe(true);
    expect(res.body.count).toBe(0);
  });

  it('run_now runs a single schedule regardless of due date', async () => {
    await resetDb();
    const res = await makeSchedule({ schedule_name: 'Future But Run Now', next_run_date: '2099-01-01' });
    const id = Number(res.body.id);
    const run = await api('cyclecount', 'run_now', adminToken, { id });
    expect(run.body.success).toBe(true);
    expect(run.body.count).toBe(1);
    expect(run.body.generated[0].take_number).toMatch(/^ST-/);

    // Next run advanced 1 month from today (2099 -> run now, then +1 month from today).
    const sched = await q<any>('SELECT next_run_date FROM cycle_count_schedules WHERE id = $1', [id]);
    const nextDate = sched[0].next_run_date;
    expect(nextDate).not.toBe('2099-01-01');
  });

  it('run_now on a missing schedule returns 404', async () => {
    const res = await api('cyclecount', 'run_now', adminToken, { id: 999999 });
    expect(res.status).toBe(404);
  });

  it('velocity-scope schedule only counts products with that velocity_class', async () => {
    await resetDb();
    const fast = Number(await createProduct({}));
    const slow = Number(await createProduct({}));
    await putStock(fast, 'CA01A01', 10, 'BATCH-A', '2030-12-31');
    await putStock(slow, 'CA01B01', 20, 'BATCH-C', '2030-12-31');
    await q('UPDATE products SET velocity_class = $1 WHERE id = $2', ['A', fast]);
    await q('UPDATE products SET velocity_class = $1 WHERE id = $2', ['C', slow]);

    await makeSchedule({ schedule_name: 'A-Class Weekly', frequency: 'weekly', scope_type: 'velocity', velocity_class: 'A', next_run_date: '2026-01-01' });
    const res = await api('cyclecount', 'run_due', adminToken, {});
    expect(res.body.count).toBe(1);
    expect(res.body.generated[0].velocity_class).toBe('A');

    const takes = await q<any>('SELECT id FROM stock_take WHERE schedule_id = $1', [res.body.generated[0].schedule_id]);
    const items = await q<any>('SELECT product_id FROM stock_take_items WHERE stock_take_id = $1', [takes[0].id]);
    expect(items.length).toBe(1);
    expect(Number(items[0].product_id)).toBe(fast);

    // Weekly advance = +7 days.
    const sched = await q<any>('SELECT next_run_date FROM cycle_count_schedules WHERE id = $1', [res.body.generated[0].schedule_id]);
    expect(sched[0].next_run_date).toBe('2026-01-08');
  });

  it('update and delete schedules', async () => {
    await resetDb();
    const res = await makeSchedule();
    const id = Number(res.body.id);

    const upd = await api('cyclecount', 'update', adminToken, {
      id,
      schedule_name: 'Renamed',
      frequency: 'weekly',
      scope_type: 'full',
      next_run_date: '2026-03-01',
    });
    expect(upd.body.success).toBe(true);
    const row = await q<any>('SELECT schedule_name, frequency, next_run_date FROM cycle_count_schedules WHERE id = $1', [id]);
    expect(row[0].schedule_name).toBe('Renamed');
    expect(row[0].frequency).toBe('weekly');
    expect(row[0].next_run_date).toBe('2026-03-01');

    const del = await api('cyclecount', 'delete', adminToken, { id });
    expect(del.body.success).toBe(true);
    const after = await q<any>('SELECT COUNT(*)::int AS c FROM cycle_count_schedules WHERE id = $1', [id]);
    expect(after[0].c).toBe(0);
  });
});