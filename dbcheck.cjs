const { Pool } = require('pg');
const p = new Pool({ host: 'localhost', port: 5544, user: 'kone', password: 'kone', database: 'k_one' });
(async () => {
  const r = await p.query('SELECT current_user, (SELECT rolcreatedb FROM pg_roles WHERE rolname=current_user) AS can_createdb');
  console.table(r.rows);
  const db = await p.query(`SELECT 1 FROM pg_database WHERE datname='k_one_test'`);
  console.log('k_one_test exists:', db.rows.length > 0);
  await p.end();
})().catch((e) => { console.error(e.message); process.exit(1); });