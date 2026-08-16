import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { config as loadEnv } from 'dotenv';
import { resolve } from 'path';
import { AppModule } from '../src/app.module';
import { ApiExceptionFilter } from '../src/common/exception-filter';
import request from 'supertest';
import { Pool } from 'pg';

let cachedApp: INestApplication | null = null;

export async function getTestApp(): Promise<INestApplication> {
  if (cachedApp) return cachedApp;
  // Mirror main.ts: load .env so ConfigService sees the real DB host/port,
  // then point only the database name at the throwaway test DB.
  loadEnv({ path: resolve(__dirname, '../.env') });
  process.env.DB_NAME = process.env.TEST_DB_NAME || 'k_one_test';
  process.env.API_ENV = 'test';

  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication();
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  app.useGlobalFilters(new ApiExceptionFilter());
  await app.init();
  cachedApp = app;
  return app;
}

export async function closeTestApp(): Promise<void> {
  if (cachedApp) {
    await cachedApp.close();
    cachedApp = null;
  }
}

export function appRequest() {
  const app = cachedApp;
  if (!app) throw new Error('app not initialised — call getTestApp() first');
  return request(app.getHttpServer());
}

export function api(
  module: string,
  action: string,
  token: string,
  body: Record<string, any> = {},
  query: Record<string, any> = {},
) {
  let r = appRequest().post('/index.php').query({ module, action, ...query });
  if (token) r = r.set('Authorization', `Bearer ${token}`);
  return r.send(body);
}

export async function login(
  username = 'testadmin',
  password = 'admin123',
): Promise<string> {
  const res = await appRequest().post('/index.php').query({ module: 'auth', action: 'login' }).send({ username, password });
  if (!res.body?.token) throw new Error(`login failed: ${JSON.stringify(res.body)}`);
  return res.body.token;
}

export function testPool(): Pool {
  return new Pool({
    host: process.env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT || 5544),
    database: process.env.TEST_DB_NAME || 'k_one_test',
    user: process.env.DB_USER || 'kone',
    password: process.env.DB_PASS || 'kone',
  });
}

const TRANSACTIONAL_TABLES = [
  'stock',
  'stock_locations',
  'stock_ledger',
  'inbound_orders',
  'inbound_items',
  'outbound_orders',
  'outbound_items',
  'outbound_item_locations',
  'picklists',
  'picklist_items',
  'bin_transfers',
  'stock_take',
  'stock_take_items',
  'asn',
  'asn_items',
  'cycle_count_schedules',
];

/** The default test rack map: CA/CB, bays 1-3, levels A-E, 2 pos (60 bins). */
export function controlledBins(): string[] {
  const bins: string[] = [];
  for (const aisle of ['CA', 'CB']) {
    for (let bay = 1; bay <= 3; bay++) {
      for (const level of ['A', 'B', 'C', 'D', 'E']) {
        for (const pos of [1, 2]) {
          const code = `${aisle}${String(bay).padStart(2, '0')}${level}${String(pos).padStart(2, '0')}`;
          bins.push(
            `INSERT INTO location_master (location_code, aisle, rack, row_name, position, is_pick_face, equipment_accessible, is_active)
             VALUES ('${code}','${aisle}','${String(bay).padStart(2, '0')}','${level}','${String(pos).padStart(2, '0')}', ${level === 'A' ? 1 : 0}, ${level === 'A' ? 1 : 0}, 1)
             ON CONFLICT (location_code) DO NOTHING;`,
          );
        }
      }
    }
  }
  return bins;
}

/** Wipe transactional state so each suite starts from a clean DB. */
export async function resetDb(): Promise<void> {
  const pool = testPool();
  try {
    await pool.query(`TRUNCATE ${TRANSACTIONAL_TABLES.join(', ')} RESTART IDENTITY CASCADE`);
    await pool.query(`DELETE FROM location_master WHERE aisle IN ('CA','CB','CC','CD','CE','CF','CG')`);
    await pool.query(controlledBins().join('\n'));
  } finally {
    await pool.end();
  }
}

/**
 * Seed the full production warehouse map (2560 bins across aisles CA-CG).
 * Matches the Excel import counts: CA=190, CB=400, CC=380, CD=400, CE=390,
 * CF=400, CG=400. Level A is pick-face + equipment-accessible; B–E are reserve.
 */
export async function seedFullMap(): Promise<number> {
  const counts: Record<string, number> = { CA: 190, CB: 400, CC: 380, CD: 400, CE: 390, CF: 400, CG: 400 };
  const rows: string[] = [];
  let total = 0;
  for (const aisle of Object.keys(counts)) {
    let n = 0;
    for (let bay = 1; bay <= 20 && n < counts[aisle]; bay++) {
      for (const level of ['A', 'B', 'C', 'D', 'E']) {
        for (let pos = 1; pos <= 4 && n < counts[aisle]; pos++) {
          const code = `${aisle}${String(bay).padStart(2, '0')}${level}${String(pos).padStart(2, '0')}`;
          rows.push(
            `INSERT INTO location_master (location_code, aisle, rack, row_name, position, is_pick_face, equipment_accessible, is_active)
             VALUES ('${code}','${aisle}','${String(bay).padStart(2, '0')}','${level}','${String(pos).padStart(2, '0')}', ${level === 'A' ? 1 : 0}, ${level === 'A' ? 1 : 0}, 1)
             ON CONFLICT (location_code) DO NOTHING;`,
          );
          n++;
          total++;
        }
      }
    }
  }
  const pool = testPool();
  try {
    await pool.query(rows.join('\n'));
  } finally {
    await pool.end();
  }
  return total;
}

/** Quick DB helpers for assertions. */
export async function q<T = any>(text: string, params: unknown[] = []): Promise<T[]> {
  const pool = testPool();
  try {
    const r = await pool.query(text, params);
    return r.rows as T[];
  } finally {
    await pool.end();
  }
}

/** Create a minimal product row and return its id. */
export async function createProduct(overrides: Record<string, any> = {}): Promise<number> {
  const code = 'TST' + String(Math.floor(Math.random() * 1_000_000));
  const rows = await q<{ id: number }>(
    `INSERT INTO products (product_code, product_name, uom_type, uom_per_pallet, liters_per_unit, is_active)
     VALUES ($1, $2, $3, $4, 209.00, 1) RETURNING id`,
    [
      overrides.product_code ?? code,
      overrides.product_name ?? 'Test Product ' + code,
      overrides.uom_type ?? 'Drum',
      overrides.uom_per_pallet ?? 4,
    ],
  );
  return rows[0].id;
}

/** Insert stock directly into a rack bin and mark the stock_locations row Available. */
export async function putStock(productId: number, location: string, quantity: number, batch = 'BATCH1', expiry = '2030-12-31'): Promise<void> {
  const s = await q<{ id: number }>(
    `INSERT INTO stock (product_id, batch_number, location, quantity, uom, pallet, expiry_date, stock_status)
     VALUES ($1, $2, $3, $4, 'Drum', $5, $6, 'Available') RETURNING id`,
    [productId, batch, location, quantity, Math.ceil(quantity / 4), expiry],
  );
  await q(
    `INSERT INTO stock_locations (stock_id, location_code, pallet_seq, quantity, original_quantity, uom, is_full_pallet, batch_number, status)
     VALUES ($1, $2, 1, $3, $3, 'Drum', 1, $4, 'Available')`,
    [s[0].id, location, quantity, batch],
  );
}