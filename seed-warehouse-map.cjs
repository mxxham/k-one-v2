/**
 * One-time seed: import the full warehouse map (2560 bins across aisles CA-CG)
 * from the "WMS" sheet of the master Excel workbook, then backfill
 * stock_locations from the existing stock table so occupancy is consistent.
 *
 *   node seed-warehouse-map.cjs [path-to-xlsx]
 *
 * Idempotent: re-running is safe.
 */
const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');

const XLSX_PATH = process.argv[2] || 'C:/Users/asust/Downloads/Warehouse Management System_13 Agustus 2026_.xlsx';

const envFile = path.join(__dirname, '.env');
const env = fs.existsSync(envFile) ? fs.readFileSync(envFile, 'utf8') : '';
const g = (k) => {
  const m = env.match(new RegExp('^' + k + '=(.*)$', 'm'));
  return m ? m[1].trim() : null;
};
const { Pool } = require('pg');
const pool = new Pool({
  host: g('DB_HOST') || 'localhost',
  port: +(g('DB_PORT') || 5544),
  user: g('DB_USER') || 'postgres',
  password: g('DB_PASS') || '',
  database: g('DB_NAME') || 'kone_v2',
});

async function main() {
  if (!fs.existsSync(XLSX_PATH)) throw new Error(`xlsx not found: ${XLSX_PATH}`);
  const wb = XLSX.readFile(XLSX_PATH);
  const ws = wb.Sheets['WMS'];
  if (!ws) throw new Error('WMS sheet not found');
  const range = XLSX.utils.decode_range(ws['!ref']);

  // --- 1. Collect the full bin structure (H=Lokasi) ---
  const bins = new Map(); // location_code -> {aisle, rack, row_name, position}
  for (let r = 4; r <= range.e.r; r++) {
    const h = ws[XLSX.utils.encode_cell({ r, c: 7 })];
    if (!h || h.v === undefined || h.v === null) continue;
    const loc = String(h.v).trim().toUpperCase();
    const m = /^(C[A-Z])(\d{2})([A-E])(\d{2})$/.exec(loc);
    if (!m) continue;
    bins.set(loc, {
      aisle: m[1],
      rack: m[1] + m[2],
      row_name: m[3],
      position: m[4],
    });
  }
  console.log(`bins from sheet: ${bins.size}`);

  // --- 2. Upsert structure into location_master (preserve zone/equipment flags) ---
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const upsertSql = `INSERT INTO location_master (location_code, aisle, rack, row_name, position, is_active)
       VALUES ($1,$2,$3,$4,$5,1)
       ON CONFLICT (location_code) DO UPDATE
         SET aisle = EXCLUDED.aisle, rack = EXCLUDED.rack, row_name = EXCLUDED.row_name,
             position = EXCLUDED.position, is_active = 1`;
    let n = 0;
    for (const [loc, b] of bins) {
      await client.query(upsertSql, [loc, b.aisle, b.rack, b.row_name, b.position]);
      n++;
    }
    console.log(`location_master upserted: ${n}`);

    // --- 3. Backfill stock_locations from live stock (Available, qty>0) ---
    const stock = await client.query(
      `SELECT id, product_id, batch_number, location, quantity, uom, expiry_date
         FROM stock
        WHERE stock_status = 'Available' AND quantity > 0 AND location IS NOT NULL`,
    );
    const insSl = `INSERT INTO stock_locations
       (stock_id, location_code, pallet_seq, quantity, original_quantity, uom,
        is_full_pallet, batch_number, inbound_item_id, status, pallet_function)
       VALUES ($1,$2,1,$3,$3,$4,1,$5,NULL,'Available','RESERVE')`;
    let created = 0;
    for (const s of stock.rows) {
      const exists = await client.query(
        `SELECT id FROM stock_locations WHERE stock_id = $1 AND status = 'Available' LIMIT 1`,
        [s.id],
      );
      if (exists.rows.length > 0) continue;
      await client.query(insSl, [s.id, s.location, s.quantity, s.uom, s.batch_number]);
      created++;
    }
    console.log(`stock_locations backfilled: ${created} (of ${stock.rows.length} stock rows)`);
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }

  // --- 4. Report ---
  const rep = await pool.query(
    `SELECT lm.aisle, COUNT(*)::int AS bins,
            COUNT(sl.id)::int AS occupied
       FROM location_master lm
       LEFT JOIN stock_locations sl ON sl.location_code = lm.location_code AND sl.status IN ('Available','Reserved')
      WHERE lm.aisle IS NOT NULL AND lm.aisle IN ('CA','CB','CC','CD','CE','CF','CG')
      GROUP BY lm.aisle ORDER BY lm.aisle`,
  );
  console.table(rep.rows);
  const tot = await pool.query(
    `SELECT COUNT(*)::int AS bins FROM location_master
      WHERE aisle IN ('CA','CB','CC','CD','CE','CF','CG')`,
  );
  console.log(`total rack bins: ${tot.rows[0].bins}`);
  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});