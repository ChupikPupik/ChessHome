const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

(async () => {
  const client = await pool.connect();
  try {
    const query = `
      UPDATE tournaments
      SET
        starts_at = EXTRACT(EPOCH FROM TIMESTAMP '2026-06-20 20:00:00' AT TIME ZONE 'Europe/Moscow') * 1000,
        ends_at   = EXTRACT(EPOCH FROM TIMESTAMP '2026-06-20 21:00:00' AT TIME ZONE 'Europe/Moscow') * 1000
      WHERE id = '0b906b83-a5ce-41b8-82a6-b22214843700';
    `;
    const res = await client.query(query);
    console.log('✅ Время обновлено, затронуто строк:', res.rowCount);
  } catch (err) {
    console.error('❌ Ошибка:', err.message);
  } finally {
    client.release();
    pool.end();
  }
})();
