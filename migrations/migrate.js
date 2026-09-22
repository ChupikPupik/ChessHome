// ═══════════════════════════════════════════════════════════════
//  migrations/migrate.js — раннер миграций
// ═══════════════════════════════════════════════════════════════
// Применяет все .sql файлы из этой папки по порядку (сортировка по
// имени файла, поэтому — 001_, 002_, 003_...). Уже применённые
// пропускает: список применённых хранится в таблице
// _schema_migrations, которую скрипт создаёт сам при первом запуске.
//
// Использование:
//   node migrations/migrate.js
//
// Переменные окружения — те же, что и у сервера (DATABASE_URL).
// Можно просто взять из .env — dotenv подключается ниже так же,
// как в core.js.
//
// Чтобы добавить новую миграцию в будущем — просто положите рядом
// файл 006_что-то.sql, ничего в этом скрипте менять не нужно.
// ═══════════════════════════════════════════════════════════════

require('dotenv').config();
const fs   = require('fs');
const path = require('path');
const { Pool } = require('pg');

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function ensureMigrationsTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS _schema_migrations (
      filename    TEXT PRIMARY KEY,
      applied_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
}

async function getAppliedMigrations() {
  const r = await pool.query('SELECT filename FROM _schema_migrations');
  return new Set(r.rows.map(row => row.filename));
}

async function applyMigration(client, filename, sql) {
  await client.query('BEGIN');
  try {
    await client.query(sql);
    await client.query('INSERT INTO _schema_migrations (filename) VALUES ($1)', [filename]);
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  }
}

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error('❌ DATABASE_URL не задан (проверь .env или переменные окружения)');
    process.exit(1);
  }

  console.log('🐘 Подключение к PostgreSQL...');
  await pool.query('SELECT 1');
  console.log('✅ PostgreSQL подключён');

  await ensureMigrationsTable();
  const applied = await getAppliedMigrations();

  const files = fs.readdirSync(__dirname)
    .filter(f => f.endsWith('.sql'))
    .sort();

  if (files.length === 0) {
    console.log('Нет .sql файлов миграций в этой папке.');
    return;
  }

  let appliedCount = 0;
  for (const filename of files) {
    if (applied.has(filename)) {
      console.log(`⏭️  ${filename} — уже применена, пропускаю`);
      continue;
    }
    const sql = fs.readFileSync(path.join(__dirname, filename), 'utf8');
    const client = await pool.connect();
    try {
      console.log(`▶️  Применяю ${filename}...`);
      await applyMigration(client, filename, sql);
      console.log(`✅ ${filename} применена`);
      appliedCount++;
    } catch (e) {
      console.error(`❌ Ошибка в ${filename}:`, e.message);
      process.exit(1);
    } finally {
      client.release();
    }
  }

  if (appliedCount === 0) {
    console.log('Всё уже было применено, новых миграций нет.');
  } else {
    console.log(`Готово: применено ${appliedCount} новых миграций.`);
  }
}

main()
  .catch(e => { console.error('❌ Миграция упала:', e); process.exit(1); })
  .finally(() => pool.end());
