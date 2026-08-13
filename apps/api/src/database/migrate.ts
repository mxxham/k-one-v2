/**
 * Minimal SQL migration runner.
 * Usage: npm run migrate  (reads src/database/migrations/*.sql in order)
 */
import * as fs from 'fs';
import * as path from 'path';
import { Pool } from 'pg';

const pool = new Pool({
  host: process.env.DB_HOST ?? 'localhost',
  port: Number(process.env.DB_PORT ?? 5432),
  database: process.env.DB_NAME ?? 'k_one',
  user: process.env.DB_USER ?? 'kone',
  password: process.env.DB_PASS ?? 'kone',
});

async function main(): Promise<void> {
  const dir = path.join(__dirname, 'migrations');
  if (!fs.existsSync(dir)) {
    process.stdout.write('No migrations dir\n');
    return;
  }
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();

  await pool.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
    filename TEXT PRIMARY KEY,
    applied_at TIMESTAMP NOT NULL DEFAULT NOW()
  )`);

  for (const file of files) {
    const done = await pool.query('SELECT 1 FROM schema_migrations WHERE filename = $1', [file]);
    if (done.rows.length > 0) {
      process.stdout.write(`skip ${file}\n`);
      continue;
    }
    const sql = fs.readFileSync(path.join(dir, file), 'utf8');
    process.stdout.write(`applying ${file}... `);
    await pool.query(sql);
    await pool.query('INSERT INTO schema_migrations (filename) VALUES ($1)', [file]);
    process.stdout.write('ok\n');
  }
  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});