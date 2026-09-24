const fs = require('fs');
const path = require('path');
const { pool } = require('../src/common');

(async () => {
  await pool.query(fs.readFileSync(path.join(__dirname, '..', 'db', 'schema.sql'), 'utf8'));
  console.log('migrasi selesai');
  await pool.end();
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
