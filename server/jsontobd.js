#!/usr/bin/env node
/**
 * ╔══════════════════════════════════════════════════════════════╗
 * ║         Chess Home — Миграция JSON → PostgreSQL             ║
 * ║  Запуск: node migrate-to-postgres.js                        ║
 * ╚══════════════════════════════════════════════════════════════╝
 *
 * Что делает:
 *  1. Создаёт все таблицы (если не существуют)
 *  2. Читает существующие JSON-файлы из data/
 *  3. Вставляет данные в PostgreSQL (с пропуском дублей)
 *
 * Требуется: DATABASE_URL в .env или переменная окружения
 */

require('dotenv').config();
const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, 'data');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

function loadJSON(file, def) {
  try {
    if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) { console.error('Load error', file, e.message); }
  return def;
}

async function createTables(client) {
  console.log('📋 Создание таблиц...');
  await client.query(`
    CREATE TABLE IF NOT EXISTS users (
      id           TEXT PRIMARY KEY,
      username     TEXT NOT NULL UNIQUE,
      username_low TEXT NOT NULL UNIQUE,
      email        TEXT,
      password_hash TEXT NOT NULL,
      rating       INTEGER NOT NULL DEFAULT 1200,
      games_played INTEGER NOT NULL DEFAULT 0,
      wins         INTEGER NOT NULL DEFAULT 0,
      losses       INTEGER NOT NULL DEFAULT 0,
      draws        INTEGER NOT NULL DEFAULT 0,
      avatar       TEXT,
      role         TEXT NOT NULL DEFAULT 'user',
      banned       BOOLEAN NOT NULL DEFAULT FALSE,
      ban_reason   TEXT,
      created_at   BIGINT NOT NULL,
      created_from_ip   TEXT,
      created_device_id TEXT
    );

    CREATE TABLE IF NOT EXISTS ip_bans (
      ip TEXT PRIMARY KEY,
      banned_at BIGINT NOT NULL DEFAULT EXTRACT(EPOCH FROM NOW()) * 1000
    );

    CREATE TABLE IF NOT EXISTS device_bans (
      device_id TEXT PRIMARY KEY,
      banned_at BIGINT NOT NULL DEFAULT EXTRACT(EPOCH FROM NOW()) * 1000
    );

    CREATE TABLE IF NOT EXISTS games (
      id           TEXT PRIMARY KEY,
      white        TEXT NOT NULL,
      black        TEXT NOT NULL,
      result       TEXT,
      reason       TEXT,
      moves        JSONB NOT NULL DEFAULT '[]',
      time_control TEXT,
      ended_at     BIGINT,
      berserk      JSONB,
      accuracy     JSONB,
      tournament_id TEXT
    );

    CREATE TABLE IF NOT EXISTS chat_messages (
      id        TEXT PRIMARY KEY,
      username  TEXT NOT NULL,
      message   TEXT NOT NULL,
      role      TEXT NOT NULL DEFAULT 'user',
      timestamp BIGINT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS reports (
      id              TEXT PRIMARY KEY,
      reporter        TEXT NOT NULL,
      target_username TEXT NOT NULL,
      reason          TEXT NOT NULL,
      details         TEXT,
      status          TEXT NOT NULL DEFAULT 'new',
      created_at      BIGINT NOT NULL,
      reviewed_by     TEXT,
      reviewed_at     BIGINT
    );

    CREATE TABLE IF NOT EXISTS tournaments (
      id                TEXT PRIMARY KEY,
      name              TEXT NOT NULL,
      description       TEXT,
      time_control      TEXT NOT NULL,
      duration_minutes  INTEGER NOT NULL,
      starts_at         BIGINT NOT NULL,
      ends_at           BIGINT NOT NULL,
      max_participants  INTEGER NOT NULL DEFAULT 0,
      min_rating        INTEGER NOT NULL DEFAULT 0,
      max_rating        INTEGER NOT NULL DEFAULT 9999,
      blacklist         JSONB NOT NULL DEFAULT '[]',
      created_by        TEXT NOT NULL,
      created_at        BIGINT NOT NULL,
      participants      JSONB NOT NULL DEFAULT '[]',
      games             JSONB NOT NULL DEFAULT '[]',
      winner            TEXT
    );

    CREATE TABLE IF NOT EXISTS dm_messages (
      id       TEXT PRIMARY KEY,
      from_user TEXT NOT NULL,
      to_user   TEXT NOT NULL,
      text      TEXT NOT NULL,
      ts        TEXT NOT NULL,
      read      BOOLEAN NOT NULL DEFAULT FALSE
    );

    CREATE INDEX IF NOT EXISTS dm_messages_pair ON dm_messages (from_user, to_user);

    CREATE TABLE IF NOT EXISTS dm_blocks (
      blocker TEXT NOT NULL,
      blocked TEXT NOT NULL,
      ts      TEXT NOT NULL,
      PRIMARY KEY (blocker, blocked)
    );

    CREATE TABLE IF NOT EXISTS blog_posts (
      id         TEXT PRIMARY KEY,
      title      TEXT NOT NULL,
      body       TEXT NOT NULL,
      author     TEXT NOT NULL,
      status     TEXT NOT NULL DEFAULT 'draft',
      views      INTEGER NOT NULL DEFAULT 0,
      likes      INTEGER NOT NULL DEFAULT 0,
      liked_by   JSONB NOT NULL DEFAULT '[]',
      created_at BIGINT NOT NULL,
      updated_at BIGINT
    );

    CREATE TABLE IF NOT EXISTS forum_threads (
      id               TEXT PRIMARY KEY,
      slug             TEXT NOT NULL UNIQUE,
      author           TEXT NOT NULL,
      author_id        TEXT,
      title            TEXT NOT NULL,
      body             TEXT NOT NULL,
      created_at       BIGINT NOT NULL,
      last_activity_at BIGINT NOT NULL,
      reply_count      INTEGER NOT NULL DEFAULT 0,
      views            INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS forum_replies (
      id         TEXT PRIMARY KEY,
      thread_id  TEXT NOT NULL REFERENCES forum_threads(id) ON DELETE CASCADE,
      author     TEXT NOT NULL,
      author_id  TEXT,
      body       TEXT NOT NULL,
      created_at BIGINT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS forum_replies_thread ON forum_replies (thread_id);

    CREATE TABLE IF NOT EXISTS clubs (
      id           TEXT PRIMARY KEY,
      name         TEXT NOT NULL UNIQUE,
      description  TEXT,
      created_at   TEXT NOT NULL,
      created_by   TEXT NOT NULL,
      admins       JSONB NOT NULL DEFAULT '[]',
      members      JSONB NOT NULL DEFAULT '[]',
      member_count INTEGER NOT NULL DEFAULT 0,
      official     BOOLEAN NOT NULL DEFAULT FALSE
    );
  `);
  console.log('✅ Таблицы созданы');
}

async function migrateUsers(client) {
  const raw = loadJSON(path.join(DATA_DIR, 'users.json'), { users: [] });
  const users = raw.users || [];
  console.log(`👤 Мигрируем ${users.length} пользователей...`);
  let ok = 0;
  for (const u of users) {
    try {
      await client.query(`
        INSERT INTO users (id, username, username_low, email, password_hash, rating,
          games_played, wins, losses, draws, avatar, role, banned, ban_reason,
          created_at, created_from_ip, created_device_id)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
        ON CONFLICT (id) DO NOTHING
      `, [u.id, u.username, u.username.toLowerCase(), u.email || null,
          u.passwordHash, u.rating ?? 1200, u.gamesPlayed ?? 0,
          u.wins ?? 0, u.losses ?? 0, u.draws ?? 0,
          u.avatar || null, u.role || 'user',
          u.banned ?? false, u.banReason || null,
          u.createdAt || Date.now(),
          u.createdFromIP || null, u.createdDeviceId || null]);
      ok++;
    } catch (e) { console.warn('  skip user', u.username, e.message); }
  }
  console.log(`  ✅ ${ok}/${users.length} пользователей`);
}

async function migrateIPBans(client) {
  const ips  = loadJSON(path.join(DATA_DIR, 'ipbans.json'),     { ips: [] });
  const devs = loadJSON(path.join(DATA_DIR, 'devicebans.json'), { devices: [] });
  for (const ip of (ips.ips || [])) {
    await client.query(`INSERT INTO ip_bans (ip) VALUES ($1) ON CONFLICT DO NOTHING`, [ip]);
  }
  for (const d of (devs.devices || [])) {
    await client.query(`INSERT INTO device_bans (device_id) VALUES ($1) ON CONFLICT DO NOTHING`, [d]);
  }
  console.log(`  ✅ IP-баны: ${(ips.ips||[]).length} IP, ${(devs.devices||[]).length} устройств`);
}

async function migrateGames(client) {
  const raw = loadJSON(path.join(DATA_DIR, 'games.json'), { games: [] });
  const games = raw.games || [];
  console.log(`♟️  Мигрируем ${games.length} партий...`);
  let ok = 0;
  for (const g of games) {
    try {
      await client.query(`
        INSERT INTO games (id, white, black, result, reason, moves, time_control, ended_at, berserk, accuracy, tournament_id)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
        ON CONFLICT (id) DO NOTHING
      `, [g.id, g.white, g.black, g.result || null, g.reason || null,
          JSON.stringify(g.moves || []), g.timeControl || null,
          g.endedAt || null, JSON.stringify(g.berserk || null),
          JSON.stringify(g.accuracy || null), g.tournamentId || null]);
      ok++;
    } catch (e) { console.warn('  skip game', g.id, e.message); }
  }
  console.log(`  ✅ ${ok}/${games.length} партий`);
}

async function migrateChat(client) {
  const raw = loadJSON(path.join(DATA_DIR, 'chat.json'), { messages: [] });
  const msgs = raw.messages || [];
  console.log(`💬 Мигрируем ${msgs.length} сообщений чата...`);
  let ok = 0;
  for (const m of msgs) {
    try {
      await client.query(`
        INSERT INTO chat_messages (id, username, message, role, timestamp)
        VALUES ($1,$2,$3,$4,$5)
        ON CONFLICT (id) DO NOTHING
      `, [m.id, m.username, m.message, m.role || 'user', m.timestamp || Date.now()]);
      ok++;
    } catch (e) {}
  }
  console.log(`  ✅ ${ok}/${msgs.length} сообщений`);
}

async function migrateReports(client) {
  const raw = loadJSON(path.join(DATA_DIR, 'reports.json'), { reports: [] });
  const reps = raw.reports || [];
  console.log(`🚩 Мигрируем ${reps.length} жалоб...`);
  for (const r of reps) {
    try {
      await client.query(`
        INSERT INTO reports (id, reporter, target_username, reason, details, status, created_at, reviewed_by, reviewed_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
        ON CONFLICT (id) DO NOTHING
      `, [r.id, r.reporter, r.targetUsername, r.reason, r.details || null,
          r.status || 'new', r.createdAt || Date.now(),
          r.reviewedBy || null, r.reviewedAt || null]);
    } catch (e) {}
  }
  console.log(`  ✅ ${reps.length} жалоб`);
}

async function migrateTournaments(client) {
  const raw = loadJSON(path.join(DATA_DIR, 'tournaments.json'), { tournaments: [] });
  const ts = raw.tournaments || [];
  console.log(`🏆 Мигрируем ${ts.length} турниров...`);
  for (const t of ts) {
    try {
      await client.query(`
        INSERT INTO tournaments (id, name, description, time_control, duration_minutes,
          starts_at, ends_at, max_participants, min_rating, max_rating,
          blacklist, created_by, created_at, participants, games, winner)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
        ON CONFLICT (id) DO NOTHING
      `, [t.id, t.name, t.description || null, t.timeControl,
          t.durationMinutes, t.startsAt, t.endsAt,
          t.maxParticipants || 0, t.minRating || 0, t.maxRating || 9999,
          JSON.stringify(t.blacklist || []), t.createdBy, t.createdAt || Date.now(),
          JSON.stringify(t.participants || []), JSON.stringify(t.games || []),
          t.winner || null]);
    } catch (e) { console.warn('  skip tournament', t.id, e.message); }
  }
  console.log(`  ✅ ${ts.length} турниров`);
}

async function migrateDM(client) {
  const msgs = loadJSON(path.join(DATA_DIR, 'dm_messages.json'), { messages: [] }).messages || [];
  const blocks = loadJSON(path.join(DATA_DIR, 'dm_blocks.json'), { blocks: [] }).blocks || [];
  console.log(`✉️  Мигрируем ${msgs.length} DM-сообщений, ${blocks.length} блокировок...`);
  for (const m of msgs) {
    try {
      await client.query(`
        INSERT INTO dm_messages (id, from_user, to_user, text, ts, read)
        VALUES ($1,$2,$3,$4,$5,$6)
        ON CONFLICT (id) DO NOTHING
      `, [m.id, m.from, m.to, m.text, m.ts || new Date().toISOString(), m.read || false]);
    } catch (e) {}
  }
  for (const b of blocks) {
    try {
      await client.query(`
        INSERT INTO dm_blocks (blocker, blocked, ts)
        VALUES ($1,$2,$3)
        ON CONFLICT DO NOTHING
      `, [b.blocker, b.blocked, b.ts || new Date().toISOString()]);
    } catch (e) {}
  }
  console.log(`  ✅ DM готово`);
}

async function migrateBlog(client) {
  const raw = loadJSON(path.join(DATA_DIR, 'blog.json'), { posts: [] });
  const posts = raw.posts || [];
  console.log(`📰 Мигрируем ${posts.length} статей блога...`);
  for (const p of posts) {
    try {
      await client.query(`
        INSERT INTO blog_posts (id, title, body, author, status, views, likes, liked_by, created_at, updated_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
        ON CONFLICT (id) DO NOTHING
      `, [p.id, p.title, p.body, p.author, p.status || 'draft',
          p.views || 0, p.likes || 0, JSON.stringify(p.likedBy || []),
          p.createdAt || Date.now(), p.updatedAt || null]);
    } catch (e) { console.warn('  skip post', p.id, e.message); }
  }
  console.log(`  ✅ ${posts.length} статей`);
}

async function migrateForumAndClubs(client) {
  const threads = loadJSON(path.join(DATA_DIR, 'forum_threads.json'), { threads: [] }).threads || [];
  const replies = loadJSON(path.join(DATA_DIR, 'forum_replies.json'), { replies: [] }).replies || [];
  const clubs   = loadJSON(path.join(DATA_DIR, 'clubs.json'), { clubs: [] }).clubs || [];

  console.log(`💬 Мигрируем ${threads.length} тем форума, ${replies.length} ответов...`);
  for (const t of threads) {
    try {
      await client.query(`
        INSERT INTO forum_threads (id, slug, author, author_id, title, body, created_at, last_activity_at, reply_count, views)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
        ON CONFLICT (id) DO NOTHING
      `, [t.id, t.slug, t.author, t.authorId || null, t.title, t.body,
          t.createdAt, t.lastActivityAt, t.replyCount || 0, t.views || 0]);
    } catch (e) { console.warn('  skip thread', t.id, e.message); }
  }
  for (const r of replies) {
    try {
      await client.query(`
        INSERT INTO forum_replies (id, thread_id, author, author_id, body, created_at)
        VALUES ($1,$2,$3,$4,$5,$6)
        ON CONFLICT (id) DO NOTHING
      `, [r.id, r.threadId, r.author, r.authorId || null, r.body, r.createdAt]);
    } catch (e) {}
  }

  console.log(`🛡️  Мигрируем ${clubs.length} клубов...`);
  for (const c of clubs) {
    try {
      await client.query(`
        INSERT INTO clubs (id, name, description, created_at, created_by, admins, members, member_count, official)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
        ON CONFLICT (id) DO NOTHING
      `, [c.id, c.name, c.description || null, c.createdAt || new Date().toISOString(),
          c.createdBy, JSON.stringify(c.admins || []), JSON.stringify(c.members || []),
          c.memberCount || 0, c.official || false]);
    } catch (e) { console.warn('  skip club', c.id, e.message); }
  }
  console.log('  ✅ Форум и клубы');
}

async function main() {
  console.log('\n🐘 Chess Home — Миграция в PostgreSQL\n');
  if (!process.env.DATABASE_URL) {
    console.error('❌ DATABASE_URL не задан в .env!');
    process.exit(1);
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await createTables(client);
    if (fs.existsSync(DATA_DIR)) {
      await migrateUsers(client);
      await migrateIPBans(client);
      await migrateGames(client);
      await migrateChat(client);
      await migrateReports(client);
      await migrateTournaments(client);
      await migrateDM(client);
      await migrateBlog(client);
      await migrateForumAndClubs(client);
    } else {
      console.log('📁 Папка data/ не найдена — создаём только таблицы');
    }
    await client.query('COMMIT');
    console.log('\n🎉 Миграция завершена успешно!\n');
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('❌ Ошибка миграции:', e);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

main();