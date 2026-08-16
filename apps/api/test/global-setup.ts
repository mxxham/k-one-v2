import { Pool } from 'pg';
import * as fs from 'fs';
import * as path from 'path';

const TEST_DB = process.env.TEST_DB_NAME || 'k_one_test';
const ADMIN_DB = process.env.DB_NAME || 'k_one';

/**
 * Jest global setup: create a throwaway test database and apply every SQL
 * migration in order (mirrors src/database/migrate.ts, but against k_one_test).
 */
export default async function globalSetup(): Promise<void> {
  const admin = new Pool({
    host: process.env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT || 5544),
    database: ADMIN_DB,
    user: process.env.DB_USER || 'kone',
    password: process.env.DB_PASS || 'kone',
  });

  const exists = await admin.query(`SELECT 1 FROM pg_database WHERE datname = $1`, [TEST_DB]);
  if (exists.rows.length === 0) {
    await admin.query(`CREATE DATABASE ${TEST_DB}`);
    console.log(`[test] created database ${TEST_DB}`);
  }
  await admin.end();

  const test = new Pool({
    host: process.env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT || 5544),
    database: TEST_DB,
    user: process.env.DB_USER || 'kone',
    password: process.env.DB_PASS || 'kone',
  });

  const dir = path.join(__dirname, '../src/database/migrations');
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();

  await test.query(`CREATE TABLE IF NOT EXISTS schema_migrations (filename TEXT PRIMARY KEY, applied_at TIMESTAMP NOT NULL DEFAULT NOW())`);
  for (const file of files) {
    const done = await test.query('SELECT 1 FROM schema_migrations WHERE filename = $1', [file]);
    if (done.rows.length > 0) continue;
    const sql = fs.readFileSync(path.join(dir, file), 'utf8');
    await test.query(sql);
    await test.query('INSERT INTO schema_migrations (filename) VALUES ($1)', [file]);
  }
  console.log(`[test] migrations applied to ${TEST_DB}`);

  // Seed a known login for the e2e tests (bcrypt hash of "admin123").
  const { hashSync } = await import('bcryptjs');
  const pw = hashSync('admin123', 10);
  await test.query(
    `INSERT INTO users (username, password, full_name, email, role, department, is_active)
     VALUES ('testadmin', $1, 'Test Admin', 'test@local', 'admin', 'all', 1)
     ON CONFLICT (username) DO UPDATE SET password = EXCLUDED.password, role = 'admin', is_active = 1`,
    [pw],
  );

  // Seed a small controlled rack map (CA/CB, bays 1-3, levels A-E, 2 pos).
  // Equipment-accessible only at Level A so DRUM/heavy-UOM rules are testable.
  const bins: string[] = [];
  for (const aisle of ['CA', 'CB']) {
    for (let bay = 1; bay <= 3; bay++) {
      for (const level of ['A', 'B', 'C', 'D', 'E']) {
        for (const pos of [1, 2]) {
          const code = `${aisle}${String(bay).padStart(2, '0')}${level}${String(pos).padStart(2, '0')}`;
          bins.push(`INSERT INTO location_master (location_code, aisle, rack, row_name, position, is_pick_face, equipment_accessible, is_active)
            VALUES ('${code}','${aisle}','${String(bay).padStart(2, '0')}','${level}','${String(pos).padStart(2, '0')}', ${level === 'A' ? 1 : 0}, ${level === 'A' ? 1 : 0}, 1)
            ON CONFLICT (location_code) DO NOTHING;`);
        }
      }
    }
  }
  await test.query(bins.join('\n'));
  console.log(`[test] seeded ${bins.length} rack bins`);

  await test.query(`TRUNCATE stock, stock_locations, stock_ledger, inbound_orders, inbound_items, outbound_orders, outbound_items, outbound_item_locations, picklists, picklist_items, bin_transfers, stock_take, stock_take_items, putaway_tasks, putaway_task_items RESTART IDENTITY CASCADE`);
  await test.end();
}