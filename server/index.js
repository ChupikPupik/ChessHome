const express = require('express');
const http    = require('http');
const { Server } = require('socket.io');
// npm install compression — жмёт HTTP-ответы (JSON/HTML/JS/CSS) gzip'ом.
// На 1 ядре это дешёвая по CPU операция (сжатие лёгкое, express.json уже
// режет тела до 50kb), а трафика и времени ответа на медленных сетях
// экономит заметно, особенно под 100 одновременных клиентов.
const compression = require('compression');
const bcrypt  = require('bcryptjs');
const jwt     = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const path    = require('path');
const fs      = require('fs');
const cors    = require('cors');
const { Pool } = require('pg');
// npm install multer — обработка multipart/form-data для загрузки обложек новостей.
const multer  = require('multer');
require('dotenv').config();

// ── PostgreSQL ────────────────────────────────────────────────
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function db(sql, params = []) {
  const client = await pool.connect();
  try {
    return await client.query(sql, params);
  } finally {
    client.release();
  }
}

// ── Атомарные транзакции ──────────────────────────────────────
// В отличие от db(), который берёт НОВОЕ соединение на каждый вызов
// (а значит BEGIN/INSERT/UPDATE/COMMIT через db() выполняются на разных
// соединениях и НЕ являются одной транзакцией), withTransaction держит
// ОДНО соединение на весь колбэк: BEGIN, все запросы и COMMIT/ROLLBACK
// идут через один и тот же client.
//
// Использование:
//   await withTransaction(async (client) => {
//     await client.query('INSERT INTO ...', [...]);
//     await client.query('UPDATE ...', [...]);
//   });
// При исключении внутри колбэка — автоматический ROLLBACK, ошибка
// пробрасывается наверх. client.release() вызывается всегда.
async function withTransaction(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (e) {
    try { await client.query('ROLLBACK'); } catch (_) {}
    throw e;
  } finally {
    client.release();
  }
}

// ── Email верификация ─────────────────────────────────────────
const { Resend } = require('resend');

const pendingPasswordChanges = new Map();
const pendingDeletions = new Map();
// 2FA: код входа, отправленный на почту, ждёт подтверждения перед выдачей jwt.
const pendingLogins = new Map();
// Не даём спамить письма при повторных заходах/выходах — пока предыдущий
// код ещё "свежий", новый не шлём, просто говорим, что он уже отправлен.
const TWO_FA_RESEND_COOLDOWN_MS = 30 * 1000;
const twoFactorLastSent = new Map(); // username_low -> timestamp

setInterval(() => {
  const now = Date.now();
  for (const [code, d] of pendingPasswordChanges.entries()) {
    if (now > d.expiresAt) pendingPasswordChanges.delete(code);
  }
  for (const [code, d] of pendingDeletions.entries()) {
    if (now > d.expiresAt) pendingDeletions.delete(code);
  }
  for (const [code, d] of pendingLogins.entries()) {
    if (now > d.expiresAt) pendingLogins.delete(code);
  }
}, 10 * 60 * 1000);

async function sendPasswordChangeEmail(email, code) {
  const resend = new Resend(process.env.RESEND_API_KEY);
  const { error } = await resend.emails.send({
    from: 'Chess Home <noreply@chesshome.pro>',
    to: email,
    subject: 'Смена пароля — Chess Home',
    html: `
      <div style="font-family:sans-serif;max-width:400px;margin:0 auto;padding:32px;background:#1a1a2e;color:#e0e0e0;border-radius:12px">
        <h2 style="color:#7c9cbf;margin-top:0">♟️ Chess Home</h2>
        <p>Вы запросили смену пароля. Ваш код подтверждения:</p>
        <div style="font-size:36px;font-weight:900;letter-spacing:10px;color:#fff;background:#0f0f1e;padding:20px;border-radius:8px;text-align:center">${code}</div>
        <p style="color:#888;font-size:13px;margin-top:24px">Код действует 15 минут. Если вы не запрашивали смену пароля — немедленно смените пароль или обратитесь в поддержку.</p>
      </div>
    `
  });
  if (error) throw new Error(error.message);
}

async function sendTwoFactorLoginEmail(email, code) {
  const resend = new Resend(process.env.RESEND_API_KEY);
  const { error } = await resend.emails.send({
    from: 'Chess Home <noreply@chesshome.pro>',
    to: email,
    subject: 'Код входа — Chess Home',
    html: `
      <div style="font-family:sans-serif;max-width:400px;margin:0 auto;padding:32px;background:#1a1a2e;color:#e0e0e0;border-radius:12px">
        <h2 style="color:#7c9cbf;margin-top:0">♟️ Chess Home</h2>
        <p>Кто-то (надеемся, что вы) пытается войти в ваш аккаунт. Код подтверждения входа:</p>
        <div style="font-size:36px;font-weight:900;letter-spacing:10px;color:#fff;background:#0f0f1e;padding:20px;border-radius:8px;text-align:center">${code}</div>
        <p style="color:#888;font-size:13px;margin-top:24px">Код действует 10 минут. Если это были не вы — просто проигнорируйте письмо, пароль остаётся прежним.</p>
      </div>
    `
  });
  if (error) throw new Error(error.message);
}

async function sendDeleteAccountEmail(email, username, code) {
  const resend = new Resend(process.env.RESEND_API_KEY);
  const { error } = await resend.emails.send({
    from: 'Chess Home <noreply@chesshome.pro>',
    to: email,
    subject: 'Удаление аккаунта — Chess Home',
    html: `
      <div style="font-family:sans-serif;max-width:400px;margin:0 auto;padding:32px;background:#1a1a2e;color:#e0e0e0;border-radius:12px">
        <h2 style="color:#c0392b;margin-top:0">⚠️ Chess Home — Удаление аккаунта</h2>
        <p>Поступил запрос на <strong>безвозвратное удаление</strong> аккаунта <strong>${username}</strong>.</p>
        <p>Код подтверждения:</p>
        <div style="font-size:36px;font-weight:900;letter-spacing:10px;color:#fff;background:#0f0f1e;padding:20px;border-radius:8px;text-align:center">${code}</div>
        <p style="color:#e74c3c;font-size:13px;margin-top:16px">⚠️ После удаления аккаунт восстановить невозможно. Ник будет навсегда заблокирован для регистрации.</p>
        <p style="color:#888;font-size:13px">Если вы не запрашивали удаление — проигнорируйте это письмо. Код действует 15 минут.</p>
      </div>
    `
  });
  if (error) throw new Error(error.message);
}

// ── Фильтр матерных ников ─────────────────────────────────────
const BAD_NICK_WORDS = [
  'хуй','хуе','хер','пизд','бляд','блять','ебал','ебан','еблан',
  'fuck','bitch','dick','shit','ass','cunt','nigger','nigga',
  'сука','мразь','шлюх','гандон','мудак','урод','дебил',
];
function normNick(s) {
  return s.toLowerCase()
    .replace(/[0]/g,'o').replace(/[1!]/g,'i').replace(/[3]/g,'e')
    .replace(/[4]/g,'a').replace(/[@]/g,'a').replace(/[5]/g,'s')
    .replace(/[_\-\.]/g,'');
}
function nickHasBadWord(username) {
  const n = normNick(username);
  return BAD_NICK_WORDS.some(w => n.includes(normNick(w)));
}

// ── Защита от похожих ников ───────────────────────────────────
function normForSimilarity(name) {
  return name.toLowerCase()
    .replace(/[іі]/g,'i').replace(/[аА]/g,'a').replace(/[еЕ]/g,'e')
    .replace(/[оО]/g,'o').replace(/[рР]/g,'p').replace(/[сС]/g,'c')
    .replace(/[хХ]/g,'x').replace(/[вВ]/g,'b').replace(/[_\-\.]/g,'')
    .replace(/0/g,'o').replace(/1/g,'i').replace(/3/g,'e');
}

const app = express();

// ── Cookie-парсер (без внешней зависимости) ───────────────────
// Разбирает заголовок Cookie в req.cookies, используется вместо
// хранения JWT/device-id в localStorage (защита от чтения через XSS).
function parseCookieHeader(header) {
  const out = {};
  if (!header) return out;
  header.split(';').forEach(pair => {
    const idx = pair.indexOf('=');
    if (idx < 0) return;
    const k = pair.slice(0, idx).trim();
    const v = pair.slice(idx + 1).trim();
    if (!k) return;
    try { out[k] = decodeURIComponent(v); } catch { out[k] = v; }
  });
  return out;
}
app.use((req, res, next) => { req.cookies = parseCookieHeader(req.headers.cookie); next(); });

const isProd = process.env.NODE_ENV === 'production';
const AUTH_COOKIE_OPTS = { httpOnly: true, secure: isProd, sameSite: 'lax', maxAge: 7 * 24 * 60 * 60 * 1000, path: '/' };
const DEVICE_COOKIE_OPTS = { httpOnly: true, secure: isProd, sameSite: 'lax', maxAge: 5 * 365 * 24 * 60 * 60 * 1000, path: '/' };

// ── Device ID выдаётся и хранится ТОЛЬКО сервером (HttpOnly) ──
// Раньше клиент сам генерировал и хранил ch_device_id в localStorage,
// откуда его можно было прочитать (XSS) или просто удалить/подделать
// перед регистрацией нового аккаунта. Теперь id выпускает сервер
// и кладёт в HttpOnly-cookie — JS на странице не может ни прочитать,
// ни стереть его вручную.
app.use((req, res, next) => {
  let deviceId = req.cookies.ch_device_id;
  if (!deviceId) {
    deviceId = 'dev_' + uuidv4();
    res.cookie('ch_device_id', deviceId, DEVICE_COOKIE_OPTS);
  }
  req.deviceId = deviceId;
  next();
});

// ── Получение JWT: приоритет — HttpOnly cookie, затем заголовок ──
// (заголовок оставлен как резерв для не-браузерных клиентов;
// само веб-приложение больше не хранит и не отправляет токен через JS)
function getAuthToken(req) {
  if (req.cookies && req.cookies.ch_token) return req.cookies.ch_token;
  const h = req.headers.authorization;
  if (h && h.startsWith('Bearer ')) return h.slice(7);
  return null;
}

// ── Доверие к прокси (Nginx + Cloudflare) ────────────────────
// ВАЖНО: должно быть ДО любых middleware и роутов.
// Значение 2 означает: доверяем двум уровням прокси —
//   1-й hop: Cloudflare → ваш сервер
//   2-й hop: Nginx → Node.js
// После этого req.ip будет автоматически содержать реальный IP клиента.
app.set('trust proxy', 2);

// ── DDoS / Rate limiting ──────────────────────────────────────
class RateLimiter {
  constructor(windowMs, max) {
    this.windowMs = windowMs; this.max = max; this.store = new Map();
    setInterval(() => {
      const now = Date.now();
      for (const [ip, data] of this.store.entries()) {
        if (now > data.resetAt) this.store.delete(ip);
      }
    }, 60000);
  }
  check(ip) {
    const now = Date.now();
    let data = this.store.get(ip);
    if (!data || now > data.resetAt) { data = { count: 0, resetAt: now + this.windowMs }; this.store.set(ip, data); }
    data.count++;
    return { allowed: data.count <= this.max, count: data.count, max: this.max };
  }
}

const limiterGeneral   = new RateLimiter(60_000,  10000);
const limiterAuth      = new RateLimiter(60_000,    1000);
const limiterStrict    = new RateLimiter(60_000,    900);
const socketLimiter    = new RateLimiter(10_000,   1000);
const limiterRegStrict = new RateLimiter(3_600_000, 1000);

// ── PUZZLE STORM: серверный трекинг забегов ─────────────────────
// Score раньше принимался от клиента как есть — можно было прислать
// в консоли браузера {score: 20000} и получить любой рекорд. Теперь
// сервер сам засекает старт забега (runId) и на финише проверяет,
// что результат физически достижим за прошедшее время.
const STORM_DURATION_MS   = 180_000;        // должно совпадать со STORM_DURATION в storm.html
const STORM_MAX_TIME_MS   = STORM_DURATION_MS * 1.5 + 20_000; // +50% от бонусов стрика, +20с запас на сеть/рендер
const STORM_MIN_MS_PER_PUZZLE = 350;        // быстрее физически не решить и не увидеть следующую задачу
const stormRuns = new Map(); // runId -> { userId, startedAt }
setInterval(() => {
  const cutoff = Date.now() - STORM_MAX_TIME_MS - 60_000;
  for (const [id, run] of stormRuns) if (run.startedAt < cutoff) stormRuns.delete(id);
}, 5 * 60_000);

// ── IP-БАН ────────────────────────────────────────────────────
const bannedIPs     = new Set();
const bannedDevices = new Set();

async function loadBansFromDB() {
  try {
    const ips  = await db('SELECT ip FROM ip_bans');
    const devs = await db('SELECT device_id FROM device_bans');
    for (const r of ips.rows)  if (!isLocalIP(r.ip)) bannedIPs.add(r.ip);
    for (const r of devs.rows) bannedDevices.add(r.device_id);
    console.log(`[Bans] Загружено: ${bannedIPs.size} IP, ${bannedDevices.size} устройств`);
  } catch (e) { console.error('[Bans] load error:', e.message); }
}

async function saveBanToDB(ip, deviceId) {
  try {
    if (ip && !isLocalIP(ip))  await db('INSERT INTO ip_bans (ip) VALUES ($1) ON CONFLICT DO NOTHING', [ip]);
    if (deviceId)              await db('INSERT INTO device_bans (device_id) VALUES ($1) ON CONFLICT DO NOTHING', [deviceId]);
  } catch (e) {}
}
async function removeBanFromDB(ip, deviceId) {
  try {
    if (ip)       await db('DELETE FROM ip_bans WHERE ip = $1', [ip]);
    if (deviceId) await db('DELETE FROM device_bans WHERE device_id = $1', [deviceId]);
  } catch (e) {}
}

// ── Кэш пользователей ─────────────────────────────────────────
const usersCache = new Map();

function cacheUser(u) {
  if (!u) return;
  usersCache.set(u.username_low || u.username.toLowerCase(), u);
}

function rowToUser(row) {
  if (!row) return null;
  return {
    id:               row.id,
    username:         row.username,
    email:            row.email,
    passwordHash:     row.password_hash,
    rating:           row.rating,
    gamesPlayed:      row.games_played,
    wins:             row.wins,
    losses:           row.losses,
    draws:            row.draws,
    avatar:           row.avatar,
    role:             row.role,
    banned:           row.banned,
    banReason:        row.ban_reason,
    createdAt:        Number(row.created_at),
    createdFromIP:    row.created_from_ip,
    createdDeviceId:  row.created_device_id,
    puzzle_rating:    row.puzzle_rating,
    puzzle_solved:    row.puzzle_solved,
    puzzle_attempted: row.puzzle_attempted,
    storm_best:       row.storm_best   || 0,
    storm_runs:       row.storm_runs   || 0,
    emoji:            row.emoji        || '',
    bio:              row.bio         || '',
    fshrRating:       row.fshr_rating != null ? row.fshr_rating : null,
    fideRating:       row.fide_rating != null ? row.fide_rating : null,
    twoFactorEnabled: row.two_factor_enabled || false,
    vipUntil:         row.vip_until != null ? Number(row.vip_until) : null,
  };
}

// ── VIP-значок ───────────────────────────────────────────────
// Значок временный: активен, пока vipUntil в будущем. Никакой
// отдельной чистки не требуется — как только время истекло,
// isVip() везде начинает возвращать false сам по себе.
function isVip(u) { return !!(u && u.vipUntil && u.vipUntil > Date.now()); }
// Выдавать/снимать значок могут только эти два аккаунта (см. запрос владельца).
function isVipGranter(username) { return ['chesshome', 'marina64'].includes((username || '').toLowerCase()); }

async function getUser(usernameLow) {
  if (usersCache.has(usernameLow)) return usersCache.get(usernameLow);
  const r = await db('SELECT * FROM users WHERE username_low = $1', [usernameLow]);
  const u = rowToUser(r.rows[0]);
  if (u) cacheUser(u);
  return u;
}

async function saveUser(u) {
  cacheUser(u);
  await db(`
    INSERT INTO users (id, username, username_low, email, password_hash, rating,
      games_played, wins, losses, draws, avatar, role, banned, ban_reason,
      created_at, created_from_ip, created_device_id, emoji, bio, fshr_rating, fide_rating,
      two_factor_enabled, vip_until)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23)
    ON CONFLICT (id) DO UPDATE SET
      rating=$6, games_played=$7, wins=$8, losses=$9, draws=$10,
      avatar=$11, role=$12, banned=$13, ban_reason=$14, emoji=$18,
      bio=$19, fshr_rating=$20, fide_rating=$21, two_factor_enabled=$22, vip_until=$23
  `, [u.id, u.username, u.username.toLowerCase(), u.email || null,
      u.passwordHash, u.rating, u.gamesPlayed, u.wins, u.losses, u.draws,
      u.avatar || null, u.role || 'user', u.banned || false, u.banReason || null,
      u.createdAt, u.createdFromIP || null, u.createdDeviceId || null, u.emoji || '',
      u.bio || '', u.fshrRating ?? null, u.fideRating ?? null, u.twoFactorEnabled || false,
      u.vipUntil ?? null]);
}

// ── Кэш глобального чата ──────────────────────────────────────
const globalChat = [];
async function loadChat() {
  const r = await db(`
    SELECT * FROM (SELECT * FROM chat_messages ORDER BY timestamp DESC LIMIT 500) sub ORDER BY timestamp ASC
  `);
  for (const row of r.rows) {
    globalChat.push({ id: row.id, username: row.username, message: row.message, role: row.role, timestamp: Number(row.timestamp) });
  }
}
async function saveChatMsg(msg) {
  await db('INSERT INTO chat_messages (id, username, message, role, timestamp) VALUES ($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING',
    [msg.id, msg.username, msg.message, msg.role || 'user', msg.timestamp]);
}
async function deleteChatMsg(msgId) {
  await db('DELETE FROM chat_messages WHERE id = $1', [msgId]);
}

// ── Турниры ───────────────────────────────────────────────────
const tournaments = [];
async function loadTournaments() {
  const r = await db('SELECT * FROM tournaments ORDER BY starts_at ASC');
  for (const row of r.rows) {
    tournaments.push({
      id: row.id, name: row.name, description: row.description,
      timeControl: row.time_control,
      durationMinutes: row.duration_minutes,
      startsAt: Number(row.starts_at), endsAt: Number(row.ends_at),
      maxParticipants: row.max_participants, minRating: row.min_rating, maxRating: row.max_rating,
      blacklist: row.blacklist, createdBy: row.created_by, createdAt: Number(row.created_at),
      participants: row.participants, games: row.games, winner: row.winner,
      // Клубные турниры: привязка к клубу и ограничение только для его участников
      clubId: row.club_id || null, clubOnly: !!row.club_only,
      // Межклубные турниры: список команд (id клубов), участвующих в турнире.
      // Создавать такие турниры может только сайт-админ (см. requireAdmin ниже).
      isInterclub: !!row.is_interclub, teamIds: row.team_ids || [],
    });
  }
}
async function saveTournament(t) {
  await db(`
    INSERT INTO tournaments (id, name, description, time_control, duration_minutes,
      starts_at, ends_at, max_participants, min_rating, max_rating,
      blacklist, created_by, created_at, participants, games, winner, club_id, club_only,
      is_interclub, team_ids)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)
    ON CONFLICT (id) DO UPDATE SET
      name=$2, description=$3, time_control=$4, duration_minutes=$5,
      starts_at=$6, ends_at=$7, max_participants=$8, min_rating=$9, max_rating=$10,
      blacklist=$11, participants=$14, games=$15, winner=$16, club_id=$17, club_only=$18,
      is_interclub=$19, team_ids=$20
  `, [t.id, t.name, t.description || null, t.timeControl, t.durationMinutes,
      t.startsAt, t.endsAt, t.maxParticipants, t.minRating, t.maxRating,
      JSON.stringify(t.blacklist || []), t.createdBy, t.createdAt,
      JSON.stringify(t.participants || []), JSON.stringify(t.games || []), t.winner || null,
      t.clubId || null, !!t.clubOnly,
      !!t.isInterclub, JSON.stringify(t.teamIds || [])]);
}
async function deleteTournamentFromDB(id) {
  await db('DELETE FROM tournaments WHERE id = $1', [id]);
}

// ── Клубы ─────────────────────────────────────────────────────
const clubs = [];
async function loadClubs() {
  const r = await db('SELECT * FROM clubs ORDER BY member_count DESC');
  for (const row of r.rows) {
    clubs.push({
      id: row.id, name: row.name, description: row.description,
      createdAt: row.created_at, createdBy: row.created_by,
      admins: row.admins, members: row.members,
      memberCount: row.member_count, official: row.official,
    });
  }
}
async function saveClub(c) {
  await db(`
    INSERT INTO clubs (id, name, description, created_at, created_by, admins, members, member_count, official)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
    ON CONFLICT (id) DO UPDATE SET
      name=$2, description=$3, admins=$6, members=$7, member_count=$8
  `, [c.id, c.name, c.description || null, c.createdAt, c.createdBy,
      JSON.stringify(c.admins || []), JSON.stringify(c.members || []),
      c.memberCount || 0, c.official || false]);
}
async function deleteClubFromDB(id) {
  await db('DELETE FROM clubs WHERE id = $1', [id]);
}

// ── Чаты клубов ───────────────────────────────────────────────
const CLUB_CHAT_MAX = 30;
const clubChats = new Map();
const clubChatBans = new Map();

function getClubChat(clubId) {
  if (!clubChats.has(clubId)) clubChats.set(clubId, []);
  return clubChats.get(clubId);
}
function getClubChatBans(clubId) {
  if (!clubChatBans.has(clubId)) clubChatBans.set(clubId, new Map());
  return clubChatBans.get(clubId);
}

async function initClubChatTable() {
  await db(`
    CREATE TABLE IF NOT EXISTS club_chat_messages (
      id          TEXT PRIMARY KEY,
      club_id     TEXT NOT NULL,
      username    TEXT NOT NULL,
      role        TEXT NOT NULL DEFAULT 'user',
      message     TEXT NOT NULL,
      timestamp   BIGINT NOT NULL,
      is_system   BOOLEAN NOT NULL DEFAULT FALSE
    )
  `);
  await db(`CREATE INDEX IF NOT EXISTS idx_club_chat_club_id ON club_chat_messages(club_id, timestamp DESC)`);
}

async function loadClubChats() {
  const r = await db(`
    SELECT * FROM (SELECT *, ROW_NUMBER() OVER (PARTITION BY club_id ORDER BY timestamp DESC) AS rn
      FROM club_chat_messages) t WHERE rn <= ${CLUB_CHAT_MAX} ORDER BY timestamp ASC
  `);
  for (const row of r.rows) {
    const chat = getClubChat(row.club_id);
    chat.push({
      id: row.id, username: row.username, role: row.role,
      message: row.message, timestamp: Number(row.timestamp),
      system: row.is_system || false,
    });
  }
}

async function saveClubChatMsg(clubId, msg) {
  try {
    await db(`
      INSERT INTO club_chat_messages (id, club_id, username, role, message, timestamp, is_system)
      VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (id) DO NOTHING
    `, [msg.id, clubId, msg.username, msg.role || 'user', msg.message,
        msg.timestamp, msg.system || false]);
    await db(`
      DELETE FROM club_chat_messages
      WHERE club_id = $1 AND id NOT IN (
        SELECT id FROM club_chat_messages
        WHERE club_id = $1 ORDER BY timestamp DESC LIMIT ${CLUB_CHAT_MAX}
      )
    `, [clubId]);
  } catch (e) { console.error('[saveClubChatMsg] error:', e.message); }
}

async function deleteClubChatMsgsByUser(clubId, usernameLow) {
  try {
    await db(`DELETE FROM club_chat_messages WHERE club_id=$1 AND LOWER(username)=$2`, [clubId, usernameLow]);
  } catch (e) { console.error('[deleteClubChatMsgsByUser] error:', e.message); }
}
function isSiteAdmin(username) {
  return username && ['chesshome','marina64'].includes(username.toLowerCase());
}
function isClubModerator(club, username) {
  if (!username) return false;
  if (isSiteAdmin(username)) return true;
  const lname = username.toLowerCase();
  // Создатель клуба всегда сохраняет права модератора, даже если технически
  // выпал из club.admins (например, вышел из клуба и зашёл снова).
  if ((club.createdBy || '').toLowerCase() === lname) return true;
  return (club.admins || []).map(a => a.toLowerCase()).includes(lname);
}
// Может ли пользователь управлять турниром: сайт-админ ИЛИ администратор клуба,
// к которому привязан этот турнир (создатель клуба всегда входит в club.admins).
function canManageTournament(user, t) {
  if (!user) return false;
  if (user.role === 'admin') return true;
  // Межклубные турниры (t.isInterclub) не привязаны к одному клубу (t.clubId === null),
  // поэтому этот блок для них не срабатывает — управлять ими может ТОЛЬКО сайт-админ.
  if (t.clubId) {
    const club = clubs.find(c => c.id === t.clubId);
    if (club && isClubModerator(club, user.username)) return true;
  }
  return false;
}

// ── Межклубные турниры ──────────────────────────────────────────
// Отдельная разновидность турнира: несколько клубов ("команд") заявлены
// заранее (по ссылкам на их страницы), создать такой турнир может только
// сайт-админ, участвовать можно только за клуб, в котором реально состоишь,
// а игроки одной команды никогда не спариваются друг с другом.
const MAX_INTERCLUB_TEAMS = 175;

// Достаём id клуба из ссылки вида ".../clubs/<id>" или принимаем "голый" id как есть.
function extractClubIdFromLink(raw) {
  if (raw === null || raw === undefined) return null;
  const s = String(raw).trim();
  if (!s) return null;
  const m = s.match(/\/clubs\/([^\/?#]+)/i);
  if (m) { try { return decodeURIComponent(m[1]).trim(); } catch { return m[1].trim(); } }
  return s;
}

// Разбирает присланный список ссылок/id команд, убирает дубли и невалидные значения.
// Возвращает { teamIds, notFound } — notFound содержит то, что не удалось сопоставить с клубом.
function resolveInterclubTeams(rawLinks) {
  const arr = Array.isArray(rawLinks) ? rawLinks : [];
  const teamIds = [];
  const notFound = [];
  const seen = new Set();
  for (const raw of arr) {
    const id = extractClubIdFromLink(raw);
    if (!id) continue;
    if (seen.has(id)) continue;
    seen.add(id);
    const club = clubs.find(c => c.id === id);
    if (!club) { notFound.push(String(raw)); continue; }
    teamIds.push(club.id);
  }
  return { teamIds, notFound };
}
// Аналог requireAdmin, но также пускает администраторов клуба для турниров их клуба.
async function requireTournamentManager(req, res, cb) {
  try {
    const me = await getUser(req.user.username.toLowerCase());
    if (!me) return res.status(403).json({ error: 'Нет прав' });
    const t = tournaments.find(t => t.id === req.params.id);
    if (!t) return res.status(404).json({ error: 'Не найден' });
    if (!canManageTournament(me, t)) return res.status(403).json({ error: 'Нет прав' });
    await cb(t, me);
  } catch (e) {
    console.error('[requireTournamentManager]', e);
    if (!res.headersSent) res.status(500).json({ error: 'Внутренняя ошибка сервера' });
  }
}
function canWriteInClubChat(club, username) {
  if (!username) return false;
  if (isSiteAdmin(username)) return true;
  return (club.members || []).map(m => m.toLowerCase()).includes(username.toLowerCase());
}

// ── Чат турниров ──────────────────────────────────────────────
// Открыт для сообщений до турнира, во время и ещё 3 часа после его
// окончания — дальше доступно только чтение (история из последних
// TOURNAMENT_CHAT_MAX сообщений).
const TOURNAMENT_CHAT_MAX = 50;
const TOURNAMENT_CHAT_READONLY_AFTER_MS = 3 * 60 * 60 * 1000;
const tournamentChats = new Map();      // tId -> [{id, username, role, message, timestamp, system, muted}]
const tournamentChatMutes = new Map();  // tId -> Map(usernameLow -> { until })

function getTournamentChat(tId) {
  if (!tournamentChats.has(tId)) tournamentChats.set(tId, []);
  return tournamentChats.get(tId);
}
function getTournamentChatMutes(tId) {
  if (!tournamentChatMutes.has(tId)) tournamentChatMutes.set(tId, new Map());
  return tournamentChatMutes.get(tId);
}
function isTournamentChatOpen(t, now) {
  return now < (t.endsAt + TOURNAMENT_CHAT_READONLY_AFTER_MS);
}
// Модератор чата турнира: сайт-админ, админ клуба (если турнир клубный)
// ИЛИ создатель конкретно этого турнира.
function canModerateTournamentChat(user, t) {
  if (!user) return false;
  if (canManageTournament(user, t)) return true;
  return !!(t.createdBy && user.username.toLowerCase() === t.createdBy.toLowerCase());
}

async function initTournamentChatTable() {
  await db(`
    CREATE TABLE IF NOT EXISTS tournament_chat_messages (
      id            TEXT PRIMARY KEY,
      tournament_id TEXT NOT NULL,
      username      TEXT NOT NULL,
      role          TEXT NOT NULL DEFAULT 'user',
      message       TEXT NOT NULL,
      timestamp     BIGINT NOT NULL,
      is_system     BOOLEAN NOT NULL DEFAULT FALSE,
      is_muted      BOOLEAN NOT NULL DEFAULT FALSE
    )
  `);
  await db(`CREATE INDEX IF NOT EXISTS idx_tournament_chat_tid ON tournament_chat_messages(tournament_id, timestamp DESC)`);
}

async function loadTournamentChats() {
  const r = await db(`
    SELECT * FROM (SELECT *, ROW_NUMBER() OVER (PARTITION BY tournament_id ORDER BY timestamp DESC) AS rn
      FROM tournament_chat_messages) t WHERE rn <= ${TOURNAMENT_CHAT_MAX} ORDER BY timestamp ASC
  `);
  for (const row of r.rows) {
    const chat = getTournamentChat(row.tournament_id);
    chat.push({
      id: row.id, username: row.username, role: row.role,
      message: row.message, timestamp: Number(row.timestamp),
      system: row.is_system || false, muted: row.is_muted || false,
    });
  }
}

async function saveTournamentChatMsg(tId, msg) {
  try {
    await db(`
      INSERT INTO tournament_chat_messages (id, tournament_id, username, role, message, timestamp, is_system, is_muted)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT (id) DO NOTHING
    `, [msg.id, tId, msg.username, msg.role || 'user', msg.message,
        msg.timestamp, msg.system || false, msg.muted || false]);
    await db(`
      DELETE FROM tournament_chat_messages
      WHERE tournament_id = $1 AND id NOT IN (
        SELECT id FROM tournament_chat_messages
        WHERE tournament_id = $1 ORDER BY timestamp DESC LIMIT ${TOURNAMENT_CHAT_MAX}
      )
    `, [tId]);
  } catch (e) { console.error('[saveTournamentChatMsg] error:', e.message); }
}

// Мут: не удаляет сообщения пользователя, а стирает их текст, заменяя на
// «[Замучен]» — история чата (кто когда писал) остаётся видна, но содержимое скрыто.
async function wipeTournamentChatMsgsByUser(tId, usernameLow) {
  const chat = getTournamentChat(tId);
  const affectedIds = [];
  for (const m of chat) {
    if ((m.username || '').toLowerCase() === usernameLow && !m.system) {
      m.message = '[Замучен]';
      m.muted = true;
      affectedIds.push(m.id);
    }
  }
  try {
    await db(`UPDATE tournament_chat_messages SET message = '[Замучен]', is_muted = TRUE WHERE tournament_id=$1 AND LOWER(username)=$2`, [tId, usernameLow]);
  } catch (e) { console.error('[wipeTournamentChatMsgsByUser] error:', e.message); }
  return affectedIds;
}

// ── Форум ─────────────────────────────────────────────────────
const forumThreads = [];
const forumReplies = [];
async function loadForum() {
  const thr = await db('SELECT * FROM forum_threads ORDER BY last_activity_at DESC');
  for (const row of thr.rows) {
    forumThreads.push({
      id: row.id, slug: row.slug, author: row.author, authorId: row.author_id,
      title: row.title, body: row.body,
      createdAt: Number(row.created_at), lastActivityAt: Number(row.last_activity_at),
      replyCount: row.reply_count, views: row.views,
    });
  }
  const rep = await db('SELECT * FROM forum_replies ORDER BY created_at ASC');
  for (const row of rep.rows) {
    forumReplies.push({
      id: row.id, threadId: row.thread_id, author: row.author, authorId: row.author_id,
      body: row.body, createdAt: Number(row.created_at),
    });
  }
}
async function saveForumThread(t) {
  await db(`
    INSERT INTO forum_threads (id, slug, author, author_id, title, body, created_at, last_activity_at, reply_count, views)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
    ON CONFLICT (id) DO UPDATE SET
      last_activity_at=$8, reply_count=$9, views=$10
  `, [t.id, t.slug, t.author, t.authorId || null, t.title, t.body,
      t.createdAt, t.lastActivityAt, t.replyCount, t.views]);
}
async function deleteForumThread(id) {
  await db('DELETE FROM forum_threads WHERE id = $1', [id]);
}
async function saveForumReply(r) {
  await db(`
    INSERT INTO forum_replies (id, thread_id, author, author_id, body, created_at)
    VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (id) DO NOTHING
  `, [r.id, r.threadId, r.author, r.authorId || null, r.body, r.createdAt]);
}
async function deleteForumReply(id) {
  await db('DELETE FROM forum_replies WHERE id = $1', [id]);
}

// ── Блог ──────────────────────────────────────────────────────
const blogPosts = [];
async function loadBlog() {
  const r = await db('SELECT * FROM blog_posts ORDER BY created_at DESC');
  for (const row of r.rows) {
    blogPosts.push({
      id: row.id, title: row.title, body: row.body, author: row.author,
      status: row.status, views: row.views, likes: row.likes,
      likedBy: row.liked_by || [],
      community: row.community || false,
      createdAt: Number(row.created_at), updatedAt: row.updated_at ? Number(row.updated_at) : null,
    });
  }
}
async function saveBlogPost(p) {
  // Просмотры/лайки сохраняются с задержкой (см. _viewTimer/_lstTimer ниже) —
  // если статью удалили, пока такой отложенный таймер ещё не сработал, он
  // всё равно вызовет saveBlogPost() через 5 секунд ПОСЛЕ удаления. Из-за
  // ON CONFLICT DO UPDATE это превращается в обычный INSERT (строки-то уже
  // нет), и удалённая статья "воскресает" в БД — а после рестарта сервера
  // снова появляется на сайте через loadBlog(). Флаг _deleted это глушит.
  if (p._deleted) return;
  await db(`
    INSERT INTO blog_posts (id, title, body, author, status, views, likes, liked_by, created_at, updated_at, community)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
    ON CONFLICT (id) DO UPDATE SET
      title=$2, body=$3, status=$5, views=$6, likes=$7, liked_by=$8, updated_at=$10, community=$11
  `, [p.id, p.title, p.body, p.author, p.status,
      p.views || 0, p.likes || 0, JSON.stringify(p.likedBy || []),
      p.createdAt, p.updatedAt || null, p.community || false]);
}
async function deleteBlogPost(id) {
  await db('DELETE FROM blog_posts WHERE id = $1', [id]);
}

// ── Новости (News) ───────────────────────────────────────────
// В отличие от блога (открыт любому зарегистрированному юзеру, макс
// 1 статья/день), новости пишут только авторы, назначенные владельцем
// (username 'chesshome'). См. также newsAuthors ниже и API-контракт в
// комментарии наверху public/news.html.
const newsPosts = [];
async function loadNews() {
  const r = await db('SELECT * FROM news_posts ORDER BY created_at DESC');
  for (const row of r.rows) {
    newsPosts.push({
      id: row.id, title: row.title, body: row.body, author: row.author,
      status: row.status, views: row.views, likes: row.likes, dislikes: row.dislikes,
      cover: row.cover || '',
      createdAt: Number(row.created_at), updatedAt: row.updated_at ? Number(row.updated_at) : null,
    });
  }
}
async function saveNewsPost(p) {
  // См. аналогичный комментарий в saveBlogPost — тот же паттерн отложенного
  // сохранения просмотров/лайков и защиты от "воскрешения" удалённой статьи.
  if (p._deleted) return;
  await db(`
    INSERT INTO news_posts (id, title, body, author, status, views, likes, dislikes, cover, created_at, updated_at)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
    ON CONFLICT (id) DO UPDATE SET
      title=$2, body=$3, status=$5, views=$6, likes=$7, dislikes=$8, cover=$9, updated_at=$11
  `, [p.id, p.title, p.body, p.author, p.status,
      p.views || 0, p.likes || 0, p.dislikes || 0, p.cover || '',
      p.createdAt, p.updatedAt || null]);
}
async function deleteNewsPost(id) {
  await db('DELETE FROM news_posts WHERE id = $1', [id]);
}

// Список авторов новостей: username в исходном регистре, назначаются/снимаются
// владельцем (chesshome). Держим в памяти, синхронизируем с news_authors.
let newsAuthors = [];
async function loadNewsAuthors() {
  const r = await db('SELECT username FROM news_authors ORDER BY created_at ASC');
  newsAuthors = r.rows.map(row => row.username);
}

const server = http.createServer(app);
const io     = new Server(server, {
  cors: { origin: '*', methods: ['GET','POST','DELETE','PATCH'] },
  // perMessageDeflate жмёт каждый пакет на CPU отправителя и получателя.
  // На 1 ядре с частыми событиями (тиканье часов раз в секунду и т.п.)
  // это ощутимая CPU-нагрузка ради экономии небольшого трафика — отключаем.
  perMessageDeflate: false,
});

const PORT       = process.env.PORT || 10000;
const JWT_SECRET = process.env.JWT_SECRET;
const RESERVED   = ['chesshome', 'admin', 'moderator', 'system', 'система'];

// ── Системные сообщения ─────────────────────────────────────────
// Отправитель для широковещательных/точечных сообщений от админа.
// Это не настоящий аккаунт (ник зарезервирован в RESERVED выше) —
// "системность" сообщения определяется только по полю from_user.
const SYSTEM_SENDER = 'Система';
function isSystemSender(name) { return !!name && name.toLowerCase() === SYSTEM_SENDER.toLowerCase(); }

const sessions          = new Map();
// username(lowercase) -> socket.id — быстрый O(1) поиск сокета по нику.
// Раньше findSocketByUsername() и поиск "старой" сессии при auth
// линейно перебирали ВСЮ карту sessions на каждый вызов (это происходит
// каждую секунду для каждой активной партии — тик часов, плюс при каждом
// tournament-тике раз в 3с на каждого участника, плюс emitToAdmins и т.д.)
// При росте числа онлайн-пользователей и партий это O(n) в горячем пути.
const usernameToSocketId = new Map();
const onlineUsers       = new Set();
const pendingChallenges = [];
const activeGames       = new Map();
const tournamentGames   = new Map();

// ── ПУЛ ДОМАШНИХ WORKER'ОВ (ваши ПК) ────────────────────────────
// Каждый воркер — обычное исходящее socket.io-подключение с вашего ПК
// (не нужно открывать порты/иметь белый IP), аутентифицируется секретом
// из .env. Поддерживается СРАЗУ НЕСКОЛЬКО воркеров одновременно —
// у каждого подключения свой socket.id, так что просто запускайте
// скрипт на нескольких машинах с одним и тем же WORKER_SECRET.
// Каждый воркер сообщает, сколько потоков он готов использовать
// (настраивается в .env самого воркера, см. worker-client/.env.example).
// Работоспособность сайта никогда не зависит от воркеров: если все
// выключены, анализ просто идёт локально в браузере посетителя, как
// было раньше (см. analyze_request ниже и фолбэк в stockfish-ui.js).
const workers = new Map();      // socket.id -> { socket, threads, busy, lastSeen }
const analyzeJobs = new Map();  // jobId -> { requesterSocketId, workerSocketId }

function pickIdleWorker() {
  for (const w of workers.values()) { if (!w.busy) return w; }
  return null;
}

// ── IP-БАН middleware ─────────────────────────────────────────
function ipBanMiddleware(req, res, next) {
  const ip = getIP(req);
  const deviceId = req.deviceId; // сервер сам выдаёт и хранит device id в HttpOnly-cookie
  const p = req.path;

  if (p.includes('/register') || p.includes('/verify-email')) {
    if (bannedIPs.has(ip))
      return res.status(403).json({ error: 'Регистрация с вашего IP временно ограничена.' });
    if (deviceId && bannedDevices.has(deviceId))
      return res.status(403).json({ error: 'Это устройство заблокировано. Создание новых аккаунтов запрещено.' });
  }

  const token = getAuthToken(req);
  if (token) {
    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      getUser(decoded.username.toLowerCase()).then(user => {
        if (user && user.banned) { }
      }).catch(() => {});
    } catch (e) {}
  }
  next();
}
app.use('/api/register', ipBanMiddleware);
app.use('/api/login',    ipBanMiddleware);

// ── Получение реального IP клиента ───────────────────────────
// Порядок приоритетов:
//   1. req.ip  — Express разбирает x-forwarded-for сам после app.set('trust proxy', 2)
//                и возвращает уже проверенный реальный IP (безопасно, спуфинг невозможен)
//   2. x-forwarded-for — берём первый IP из списка (крайний левый = клиент)
//   3. x-real-ip       — Nginx часто выставляет это поле напрямую
//   4. socket.remoteAddress — прямое соединение (без прокси / локальный запуск)
function getIP(req) {
  return req.ip
    || req.headers['x-forwarded-for']?.split(',')[0]?.trim()
    || req.headers['x-real-ip']
    || req.socket?.remoteAddress
    || 'unknown';
}
function isLocalIP(ip) {
  if (!ip || ip === 'unknown') return true;
  if (ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1') return true;
  if (ip.startsWith('::ffff:127.')) return true;
  return false;
}

// ── VPN / Proxy / Tor детект ──────────────────────────────────
const vpnCheckCache = new Map();
const VPN_CACHE_TTL = 60 * 60 * 1000;

async function isVpnOrProxy(ip) {
  if (isLocalIP(ip)) return false;
  const cached = vpnCheckCache.get(ip);
  if (cached && Date.now() - cached.cachedAt < VPN_CACHE_TTL) {
    return cached.result;
  }
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 4000);
    const resp = await fetch(
      `http://ip-api.com/json/${encodeURIComponent(ip)}?fields=proxy,hosting,tor`,
      { signal: controller.signal }
    );
    clearTimeout(timeout);
    const data = await resp.json();
    const isVpn = !!(data.proxy || data.hosting || data.tor);
    vpnCheckCache.set(ip, { result: isVpn, cachedAt: Date.now() });
    if (isVpn) console.log(`[VPN block] ${ip} — proxy:${data.proxy} hosting:${data.hosting} tor:${data.tor}`);
    return isVpn;
  } catch (e) {
    console.warn('[VPN check] Ошибка проверки IP:', ip, e.message);
    return false;
  }
}
function rateLimit(limiter, message = 'Слишком много запросов. Подождите немного.') {
  return (req, res, next) => {
    const ip = getIP(req);
    const result = limiter.check(ip);
    res.set('X-RateLimit-Limit', result.max);
    res.set('X-RateLimit-Remaining', Math.max(0, result.max - result.count));
    if (!result.allowed) {
      console.warn(`[RateLimit] ${ip} blocked (${result.count}/${result.max})`);
      return res.status(429).json({ error: message });
    }
    next();
  };
}

// ── Безопасность заголовков ───────────────────────────────────
app.use((req, res, next) => {
  res.set('X-Frame-Options', 'SAMEORIGIN');
  res.set('X-Content-Type-Options', 'nosniff');
  res.set('X-XSS-Protection', '1; mode=block');
  res.set('Referrer-Policy', 'same-origin');
  next();
});
app.use(cors());
app.use(compression());
// Лимит поднят с 50kb: статьи блога разрешены до 100 000 символов
// (см. проверку body.length в POST /api/blog), а это уже само по себе
// 100-400кб в зависимости от алфавита. При старом лимите body-parser
// рубил запрос ДО того, как код успевал вернуть свою красивую ошибку
// "Текст слишком длинный", и в некоторых окружениях (за прокси без
// финального error-хендлера) это отдавало клиенту HTML вместо JSON —
// отсюда "JSON.parse: unexpected character at line 1 column 1".
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: false, limit: '2mb' }));
app.use((req, res, next) => {
    if (req.path.match(/\.(css|js|svg|png|ico|woff|woff2|map)$/)) return next();
    if (!limiterGeneral.check(getIP(req)).allowed)
      return res.status(429).json({ error: 'Слишком много запросов. Подождите немного.' });
  next();
});

app.use((req, res, next) => {
  if (req.path.endsWith('.html') || req.path === '/' || !req.path.includes('.')) {
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate');
    res.set('Pragma', 'no-cache');
    res.set('Expires', '0');
  }
  next();
});

// ── Cache-busting для /js/*.js внутри HTML ─────────────────────
// Проблема, которую это решает: браузер кэширует /js/app.js на 1 час
// (см. maxAge статики ниже). HTML при этом всегда отдаётся свежим
// (no-store), но <script src="/js/app.js"> — это один и тот же URL,
// поэтому после деплоя пользователи до часа могли получать старый
// app.js, хотя страница уже новая (отсюда "ReferenceError: X is not
// defined" после обновления кода).
//
// BUILD_VERSION генерируется один раз при старте процесса. Деплой =
// перезапуск сервера => новая версия => во всех отдающихся HTML
// автоматически подставляется новый ?v=..., браузер воспринимает это
// как новый URL и гарантированно скачивает свежий файл, игнорируя
// старый закэшированный. Уже открытые у пользователей вкладки этим не
// затронуты (их не заставить перезагрузиться), но любая новая загрузка/
// обновление страницы получает актуальный код.
const BUILD_VERSION = Date.now();
const JS_SRC_RE = /(<script\b[^>]*\bsrc=["'])(\/js\/[^"']+\.js)(["'])/g;

function sendVersionedHtml(res, filePath) {
  fs.readFile(filePath, 'utf8', (err, html) => {
    if (err) return res.status(404).end();
    const versioned = html.replace(JS_SRC_RE, `$1$2?v=${BUILD_VERSION}$3`);
    res.set('Content-Type', 'text/html; charset=utf-8');
    res.send(versioned);
  });
}

// Подменяем res.sendFile для .html-ответов на версию с подстановкой ?v=,
// чтобы не переписывать вручную каждый из ~40 app.get(...).sendFile(...)
// ниже по файлу — они продолжают работать как есть.
app.use((req, res, next) => {
  const originalSendFile = res.sendFile.bind(res);
  res.sendFile = function (filePath, ...args) {
    if (typeof filePath === 'string' && filePath.endsWith('.html')) {
      return sendVersionedHtml(res, filePath);
    }
    return originalSendFile(filePath, ...args);
  };
  next();
});

// Корень "/" отдаём тем же путём (версия + no-store), а не через
// автоматический index.html из express.static — поэтому ниже у
// express.static выставлен index:false.
app.get('/', (req, res) => sendVersionedHtml(res, path.join(__dirname, '../public/index.html')));

app.use(express.static(path.join(__dirname, '../public'), {
  // Раньше статика (js/css/картинки/шрифты) отдавалась без Cache-Control —
  // каждый клиент дергал сервер за одними и теми же файлами на каждой
  // загрузке страницы. maxAge даёт браузеру право не перезапрашивать файл
  // повторно в течение часа, что на 1 ядре и 100 юзерах заметно снижает
  // число обслуживаемых HTTP-запросов. HTML по-прежнему no-store (см. выше).
  // index:false — index.html отдаём вручную (см. app.get('/') выше), чтобы
  // он тоже проходил через версионирование /js/*.js.
  maxAge: '1h',
  etag: true,
  index: false,
}));

const LICHESS_TOKEN = process.env.LICHESS_API_TOKEN; // положите токен в .env

app.get('/api/opening-explorer', async (req, res) => {
  try {
    const fen = req.query.fen;
    if (!fen) return res.status(400).json({ error: 'fen обязателен' });

    const r = await fetch(`https://explorer.lichess.ovh/masters?fen=${encodeURIComponent(fen)}`, {
      headers: LICHESS_TOKEN ? { Authorization: `Bearer ${LICHESS_TOKEN}` } : {}
    });
    if (!r.ok) return res.status(r.status).json({ error: `Lichess API ${r.status}` });

    res.json(await r.json());
  } catch (e) {
    res.status(500).json({ error: 'Ошибка проксирования запроса к Lichess' });
  }
});

app.get('/engine-play', (req, res) => res.sendFile(path.join(__dirname, '../public/engine-play.html')));
app.get('/opening-database', (req, res) => res.sendFile(path.join(__dirname, '../public/opening-database.html')));

app.get('/blog',    (req, res) => res.sendFile(path.join(__dirname, '../public/blog.html')));
app.get('/blog/:id',(req, res) => {
  const post = blogPosts.find(p => p.id === req.params.id);
  // Удалённой статьи не существует, а прикрытую никто не должен увидеть по прямой ссылке.
  if (!post || post.status === 'hidden') return res.redirect('/404.html');
  res.sendFile(path.join(__dirname, '../public/blog.html'));
});

app.get('/news',    (req, res) => res.sendFile(path.join(__dirname, '../public/news.html')));
app.get('/news/:id',(req, res) => {
  const post = newsPosts.find(p => p.id === req.params.id);
  // Удалённой новости не существует, а прикрытую никто не должен увидеть по прямой ссылке.
  if (!post || post.status === 'hidden') return res.redirect('/404.html');
  res.sendFile(path.join(__dirname, '../public/news.html'));
});
app.get('/news/:id/comments', (req, res) => {
  const post = newsPosts.find(p => p.id === req.params.id);
  if (!post || post.status === 'hidden') return res.redirect('/404.html');
  res.sendFile(path.join(__dirname, '../public/news.html'));
});

app.get('/followers/:username', (req, res) => res.sendFile(path.join(__dirname, '../public/followers.html')));
app.get('/following/:username', (req, res) => res.sendFile(path.join(__dirname, '../public/following.html')));

app.get('/dev-diary', (req, res) => res.sendFile(path.join(__dirname, '../public/dev-diary.html')));
app.get('/donate',   (req, res) => res.sendFile(path.join(__dirname, '../public/donate.html')));
app.get('/durka',    (req, res) => res.sendFile(path.join(__dirname, '../public/durka.html')));
app.get('/ai', (req, res) => res.sendFile(path.join(__dirname, '../public/ai.html')));


// ── ЮKassa Донаты ─────────────────────────────────────────────
const YUKASSA_SHOP_ID      = process.env.YUKASSA_SHOP_ID;
const YUKASSA_SECRET_KEY   = process.env.YUKASSA_SECRET_KEY;
const SITE_URL             = process.env.SITE_URL || 'https://chesshome.pro';

// Таблица платежей (создаётся в main)
async function initDonateTable() {
  await db(`
    CREATE TABLE IF NOT EXISTS donations (
      id            TEXT PRIMARY KEY,
      username      TEXT,
      amount        NUMERIC(10,2) NOT NULL,
      currency      TEXT NOT NULL DEFAULT 'RUB',
      message       TEXT,
      status        TEXT NOT NULL DEFAULT 'pending',
      payment_id    TEXT,
      created_at    BIGINT NOT NULL
    )
  `);
}

// Создать платёж через ЮKassa
app.post('/api/donate/create', rateLimit(limiterStrict), async (req, res) => {
  try {
    const { amount, message, username } = req.body;
    const amountNum = parseFloat(amount);
    if (!amountNum || amountNum < 10 || amountNum > 100000)
      return res.status(400).json({ error: 'Сумма должна быть от 10 до 100 000 ₽' });

    const donateId = uuidv4();
    const idempotenceKey = uuidv4();

    const payload = {
      amount:       { value: amountNum.toFixed(2), currency: 'RUB' },
      confirmation: { type: 'redirect', return_url: `${SITE_URL}/donate?success=1&id=${donateId}` },
      capture:      true,
      description:  message ? `Донат Chess Home: ${message.slice(0, 100)}` : 'Донат Chess Home',
      metadata:     { donate_id: donateId, username: username || 'anonymous' },
    };

    const auth = Buffer.from(`${YUKASSA_SHOP_ID}:${YUKASSA_SECRET_KEY}`).toString('base64');
    const ykRes = await fetch('https://api.yookassa.ru/v3/payments', {
      method: 'POST',
      headers: {
        'Authorization':  `Basic ${auth}`,
        'Content-Type':   'application/json',
        'Idempotence-Key': idempotenceKey,
      },
      body: JSON.stringify(payload),
    });
    const ykData = await ykRes.json();
    if (!ykRes.ok) {
      console.error('[Donate] ЮKassa error:', ykData);
      return res.status(502).json({ error: 'Ошибка платёжного сервиса. Попробуйте позже.' });
    }

    // Сохраняем в БД
    await db(
      'INSERT INTO donations (id, username, amount, currency, message, status, payment_id, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',
      [donateId, username || null, amountNum, 'RUB', message || null, 'pending', ykData.id, Date.now()]
    );

    res.json({ confirmation_url: ykData.confirmation.confirmation_url, donate_id: donateId });
  } catch (e) {
    console.error('[Donate] create error:', e.message);
    res.status(500).json({ error: 'Внутренняя ошибка сервера' });
  }
});

// Webhook от ЮKassa — подтверждение оплаты
app.post('/api/donate/webhook', express.json({ type: '*/*' }), async (req, res) => {
  try {
    const { event, object } = req.body;
    if (event === 'payment.succeeded' && object?.metadata?.donate_id) {
      await db(
        'UPDATE donations SET status=$1 WHERE id=$2',
        ['succeeded', object.metadata.donate_id]
      );
      console.log(`[Donate] ✅ Платёж успешен: ${object.metadata.donate_id} (${object.amount?.value} ₽)`);
    }
    res.sendStatus(200);
  } catch (e) {
    console.error('[Donate] webhook error:', e.message);
    res.sendStatus(500);
  }
});

// Топ донатёров (публичный)
app.get('/api/donate/top', async (req, res) => {
  try {
    const r = await db(`
      SELECT username, SUM(amount) AS total
      FROM donations
      WHERE status = 'succeeded' AND username IS NOT NULL
      GROUP BY username
      ORDER BY total DESC
      LIMIT 10
    `);
    res.json(r.rows);
  } catch (e) {
    res.json([]);
  }
});

// Проверка статуса конкретного доната (для страницы успеха)
app.get('/api/donate/status/:id', async (req, res) => {
  try {
    const r = await db('SELECT status, amount, username, message FROM donations WHERE id=$1', [req.params.id]);
    if (!r.rows[0]) return res.status(404).json({ error: 'Не найдено' });
    res.json(r.rows[0]);
  } catch (e) {
    res.status(500).json({ error: 'Ошибка' });
  }
});
// ══════════════════════════════════════════════════════════════
//  AUTH & USER API
// ══════════════════════════════════════════════════════════════

app.post('/api/register', 
  rateLimit(limiterRegStrict, 'Слишком много регистраций с вашего IP. Попробуйте позже.'), // 1. Проверяем лимиты по IP
  ipBanMiddleware,                                                                       // 2. Проверяем черный список IP
  async (req, res) => {                                                                  
    const ip = getIP(req);
    const { username, password, _hp } = req.body;
    const deviceId = req.deviceId; // из HttpOnly-cookie, а не от клиента — нельзя подделать/сменить через JS

    if (_hp && String(_hp).trim() !== '') {
      return res.json({ ok: true, message: 'Аккаунт создан.' });
    }
    if (deviceId && bannedDevices.has(deviceId))
      return res.status(403).json({ error: 'Ваше устройство заблокировано.' });

    if (!isLocalIP(ip)) {
      const vpn = await isVpnOrProxy(ip);
      if (vpn) {
        return res.status(403).json({ error: 'Регистрация через VPN, прокси или Tor запрещена. Отключите VPN и попробуйте снова.' });
      }
    }

    if (!username || !password)           return res.status(400).json({ error: 'Заполните все поля' });
    if (username.length < 3)              return res.status(400).json({ error: 'Ник минимум 3 символа' });
    if (username.length > 20)             return res.status(400).json({ error: 'Ник максимум 20 символов' });
    if (password.length < 6)             return res.status(400).json({ error: 'Пароль минимум 6 символов' });
    if (!/^[a-zA-Z0-9_-]+$/.test(username)) return res.status(400).json({ error: 'Только буквы, цифры, _ и -' });
    if (RESERVED.includes(username.toLowerCase())) return res.status(400).json({ error: 'Ник зарезервирован' });
    if (nickHasBadWord(username)) return res.status(400).json({ error: 'Ник содержит запрещённые слова' });

    try {
      const existCheck = await db('SELECT id FROM users WHERE username_low = $1', [username.toLowerCase()]);
      if (existCheck.rows.length > 0) return res.status(400).json({ error: 'Пользователь уже существует' });

      const deletedCheck = await db('SELECT username_low FROM deleted_usernames WHERE username_low = $1', [username.toLowerCase()]);
      if (deletedCheck.rows.length > 0) return res.status(400).json({ error: 'Этот ник недоступен для регистрации' });

      const allUsers = await db('SELECT username FROM users');
      const normNew = normForSimilarity(username);
      for (const row of allUsers.rows) {
        if (normForSimilarity(row.username) === normNew)
          return res.status(400).json({ error: 'Ник слишком похож на уже существующий' });
      }

      if (!isLocalIP(ip)) {
        const ipCount = await db('SELECT COUNT(*) FROM users WHERE created_from_ip = $1', [ip]);
        if (Number(ipCount.rows[0].count) >= 2)
          return res.status(429).json({ error: 'С вашего IP уже зарегистрированы аккаунты. Если вы считаете, что произошла ошибка — обратитесь в поддержку.' });
      }

      if (deviceId && !bannedDevices.has(deviceId)) {
        const devCount = await db('SELECT COUNT(*) FROM users WHERE created_device_id = $1', [deviceId]);
        if (Number(devCount.rows[0].count) >= 4)
          return res.status(429).json({ error: 'С этого устройства уже зарегистрирован аккаунт. Создание нескольких аккаунтов с одного устройства запрещено.' });
      }

      const hash = await bcrypt.hash(password, 10);
      const userData = {
        id: uuidv4(), username, email: null, passwordHash: hash,
        createdAt: Date.now(), createdFromIP: ip, createdDeviceId: deviceId || null,
        rating: 1200, gamesPlayed: 0, wins: 0, losses: 0, draws: 0,
        avatar: null, role: 'user', banned: false,
      };

      // Аккаунт создаётся сразу, без email-подтверждения. Защиту от
      // мультиаккаунтинга обеспечивают проверки выше: бан IP/устройства,
      // VPN/прокси-фильтр, лимит аккаунтов на IP и на устройство,
      // а также проверка на похожие ники.
      await saveUser(userData);

      const token = jwt.sign({ userId: userData.id, username: userData.username }, JWT_SECRET, { expiresIn: '7d' });
      // Токен больше не возвращается в теле ответа — только в HttpOnly cookie,
      // недоступной для чтения из JS (защита от кражи токена через XSS).
      res.cookie('ch_token', token, AUTH_COOKIE_OPTS);
      res.json({ user: sanitizeUser(userData) });
    } catch (err) {
      console.error('[Register]', err.message);
      return res.status(500).json({ error: 'Не удалось создать аккаунт: ' + err.message });
    }
  }
);

// Раньше не было выделенного лимита на /login — только общий limiterGeneral
// (10000 запросов/мин на IP), что позволяло ~166 попыток пароля/сек с одного IP.
const loginFailStreaks = new Map(); // username_low -> { count, resetAt }
function getLoginFailStreak(usernameLow) {
  const now = Date.now();
  const entry = loginFailStreaks.get(usernameLow);
  if (!entry || now > entry.resetAt) return 0;
  return entry.count;
}
function bumpLoginFailStreak(usernameLow) {
  const now = Date.now();
  const entry = loginFailStreaks.get(usernameLow);
  if (!entry || now > entry.resetAt) {
    loginFailStreaks.set(usernameLow, { count: 1, resetAt: now + 15 * 60 * 1000 });
  } else {
    entry.count++;
  }
}
function clearLoginFailStreak(usernameLow) {
  loginFailStreaks.delete(usernameLow);
}
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of loginFailStreaks.entries()) if (now > v.resetAt) loginFailStreaks.delete(k);
}, 10 * 60 * 1000);

app.post('/api/login', 
  rateLimit(limiterAuth, 'Слишком много попыток входа с вашего IP. Подождите минуту.'),
  ipBanMiddleware,
  async (req, res, next) => {
    // Капча отключена по запросу (была нестабильна).
    next();
  },
  async (req, res) => {
  try {
    const { username, password } = req.body;
    const usernameLow = (username || '').toLowerCase();
    const user = await getUser(usernameLow);
    if (!user) { bumpLoginFailStreak(usernameLow); return res.status(401).json({ error: 'Неверное имя или пароль' }); }
    if (user.banned) return res.status(403).json({ error: `Заблокирован: ${user.banReason || ''}` });
    if (!await bcrypt.compare(password, user.passwordHash)) {
      bumpLoginFailStreak(usernameLow);
      return res.status(401).json({ error: 'Неверное имя или пароль' });
    }
    clearLoginFailStreak(usernameLow);

    // Пароль верный. Если у аккаунта включена 2FA — токен пока не выдаём,
    // отправляем код на почту и ждём отдельного подтверждения.
    if (user.twoFactorEnabled) {
      if (!user.email) {
        // Не должно происходить (включить 2FA можно только с привязанной почтой),
        // но на всякий случай не блокируем вход, если так вышло.
        console.warn('[2FA] У пользователя включена 2FA, но нет email:', user.username);
      } else {
        const usernameLowKey = user.username.toLowerCase();
        const lastSent = twoFactorLastSent.get(usernameLowKey) || 0;
        if (Date.now() - lastSent < TWO_FA_RESEND_COOLDOWN_MS) {
          // Уже отправляли код совсем недавно (например, юзер вышел и сразу
          // зашёл заново) — не долбим почтовый API повторно, просто просим
          // ввести уже присланный код или немного подождать.
          return res.json({ twoFactorRequired: true, message: 'Код уже отправлен на ' + user.email + '. Проверьте почту (или подождите немного перед новой попыткой).' });
        }

        const code = String(Math.floor(100000 + Math.random() * 900000));
        for (const [k, v] of pendingLogins.entries()) {
          if (v.username === user.username) pendingLogins.delete(k);
        }
        pendingLogins.set(code, { username: user.username, expiresAt: Date.now() + 10 * 60 * 1000 });
        try {
          await Promise.race([
            sendTwoFactorLoginEmail(user.email, code),
            new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), 15000))
          ]);
          twoFactorLastSent.set(usernameLowKey, Date.now());
        } catch (err) {
          pendingLogins.delete(code);
          console.error('[2FA send]', err.message);
          return res.status(500).json({ error: 'Не удалось отправить код подтверждения: ' + err.message });
        }
        return res.json({ twoFactorRequired: true, message: 'Код подтверждения отправлен на ' + user.email });
      }
    }

    const token = jwt.sign({ userId: user.id, username: user.username }, JWT_SECRET, { expiresIn: '7d' });
    res.cookie('ch_token', token, AUTH_COOKIE_OPTS);
    res.json({ user: sanitizeUser(user) });
  } catch (err) {
    console.error('[Login]', err.message);
    res.status(500).json({ error: 'Внутренняя ошибка сервера при входе. Попробуйте ещё раз.' });
  }
});

app.post('/api/login/verify-2fa',
  rateLimit(limiterAuth, 'Слишком много попыток. Подождите минуту.'),
  ipBanMiddleware,
  async (req, res) => {
    const { code } = req.body;
    if (!code) return res.status(400).json({ error: 'Введите код' });

    const pending = pendingLogins.get(String(code));
    if (!pending) return res.status(400).json({ error: 'Неверный или истёкший код' });
    if (Date.now() > pending.expiresAt) {
      pendingLogins.delete(String(code));
      return res.status(400).json({ error: 'Код истёк. Войдите заново.' });
    }

    const user = await getUser(pending.username.toLowerCase());
    pendingLogins.delete(String(code));
    if (!user) return res.status(404).json({ error: 'Пользователь не найден' });
    if (user.banned) return res.status(403).json({ error: `Заблокирован: ${user.banReason || ''}` });

    const token = jwt.sign({ userId: user.id, username: user.username }, JWT_SECRET, { expiresIn: '7d' });
    res.cookie('ch_token', token, AUTH_COOKIE_OPTS);
    res.json({ user: sanitizeUser(user) });
  }
);

app.post('/api/logout', (req, res) => {
  res.clearCookie('ch_token', { ...AUTH_COOKIE_OPTS, maxAge: undefined });
  res.json({ ok: true });
});

app.get('/api/users/search', async (req, res) => {
  const q = (req.query.q || '').toLowerCase().trim();
  if (q.length < 1) return res.json([]);
  const r = await db('SELECT * FROM users WHERE username_low LIKE $1 LIMIT 10', [q + '%']);
  res.json(r.rows.map(row => ({ ...sanitizeUser(rowToUser(row)), online: onlineUsers.has(rowToUser(row).username) })));
});

app.get('/api/me', authMiddleware, async (req, res) => {
  const me = await getUser(req.user.username.toLowerCase());
  if (!me) return res.status(401).json({ error: 'Не найден' });
  // twoFactorEnabled — это настройка безопасности самого пользователя,
  // не публичный профиль, поэтому её нет в sanitizeUser (используется и для чужих профилей).
  res.json({ ...sanitizeUser(me), twoFactorEnabled: !!me.twoFactorEnabled });
});

app.post('/api/account/2fa/toggle', authMiddleware, rateLimit(limiterStrict, 'Слишком много запросов. Попробуйте позже.'), async (req, res) => {
  const { enabled } = req.body;
  const user = await getUser(req.user.username.toLowerCase());
  if (!user) return res.status(404).json({ error: 'Пользователь не найден' });
  if (enabled && !user.email) return res.status(400).json({ error: 'Для 2FA нужен привязанный email' });

  user.twoFactorEnabled = !!enabled;
  await db('UPDATE users SET two_factor_enabled=$1 WHERE id=$2', [user.twoFactorEnabled, user.id]);
  cacheUser(user);
  res.json({ ok: true, twoFactorEnabled: user.twoFactorEnabled });
});

app.post('/api/account/request-password-change', authMiddleware, rateLimit(limiterStrict, 'Слишком много запросов. Попробуйте позже.'), async (req, res) => {
  const { newPassword } = req.body;
  if (!newPassword || newPassword.length < 6)
    return res.status(400).json({ error: 'Новый пароль минимум 6 символов' });

  const user = await getUser(req.user.username.toLowerCase());
  if (!user) return res.status(404).json({ error: 'Пользователь не найден' });
  if (!user.email) return res.status(400).json({ error: 'Email не привязан к аккаунту' });

  const code = String(Math.floor(100000 + Math.random() * 900000));
  const newHash = await bcrypt.hash(newPassword, 10);

  for (const [k, v] of pendingPasswordChanges.entries()) {
    if (v.username === user.username) pendingPasswordChanges.delete(k);
  }

  pendingPasswordChanges.set(code, {
    username: user.username,
    newHash,
    expiresAt: Date.now() + 15 * 60 * 1000,
  });

  try {
    await Promise.race([
      sendPasswordChangeEmail(user.email, code),
      new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), 15000))
    ]);
    res.json({ ok: true, message: 'Код подтверждения отправлен на ' + user.email });
  } catch (err) {
    console.error('[PasswordChange]', err.message);
    pendingPasswordChanges.delete(code);
    res.status(500).json({ error: 'Не удалось отправить письмо: ' + err.message });
  }
});

app.post('/api/account/confirm-password-change', authMiddleware, rateLimit(limiterAuth, 'Слишком много попыток.'), async (req, res) => {
  const { code } = req.body;
  if (!code) return res.status(400).json({ error: 'Введите код' });

  const pending = pendingPasswordChanges.get(String(code));
  if (!pending) return res.status(400).json({ error: 'Неверный или истёкший код' });
  if (Date.now() > pending.expiresAt) {
    pendingPasswordChanges.delete(String(code));
    return res.status(400).json({ error: 'Код истёк. Запросите новый.' });
  }
  if (pending.username !== req.user.username)
    return res.status(403).json({ error: 'Код не принадлежит этому аккаунту' });

  const user = await getUser(req.user.username.toLowerCase());
  if (!user) return res.status(404).json({ error: 'Пользователь не найден' });

  user.passwordHash = pending.newHash;
  await db('UPDATE users SET password_hash=$1 WHERE id=$2', [user.passwordHash, user.id]);
  cacheUser(user);
  pendingPasswordChanges.delete(String(code));

  const sock = findSocketByUsername(user.username);
  if (sock) { sock.emit('session_expired', 'Пароль изменён'); sock.disconnect(); }

  res.json({ ok: true, message: 'Пароль успешно изменён' });
});

app.post('/api/account/request-delete', authMiddleware, rateLimit(limiterStrict, 'Слишком много запросов.'), async (req, res) => {
  const user = await getUser(req.user.username.toLowerCase());
  if (!user) return res.status(404).json({ error: 'Пользователь не найден' });
  if (user.role === 'admin') return res.status(403).json({ error: 'Нельзя удалить аккаунт администратора' });
  if (!user.email) return res.status(400).json({ error: 'Email не привязан к аккаунту' });

  const code = String(Math.floor(100000 + Math.random() * 900000));

  for (const [k, v] of pendingDeletions.entries()) {
    if (v.username === user.username) pendingDeletions.delete(k);
  }

  pendingDeletions.set(code, {
    username: user.username,
    expiresAt: Date.now() + 15 * 60 * 1000,
  });

  try {
    await Promise.race([
      sendDeleteAccountEmail(user.email, user.username, code),
      new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), 15000))
    ]);
    res.json({ ok: true, message: 'Код подтверждения отправлен на ' + user.email });
  } catch (err) {
    console.error('[DeleteAccount]', err.message);
    pendingDeletions.delete(code);
    res.status(500).json({ error: 'Не удалось отправить письмо: ' + err.message });
  }
});

app.post('/api/account/confirm-delete', authMiddleware, rateLimit(limiterAuth, 'Слишком много попыток.'), async (req, res) => {
  const { code } = req.body;
  if (!code) return res.status(400).json({ error: 'Введите код' });

  const pending = pendingDeletions.get(String(code));
  if (!pending) return res.status(400).json({ error: 'Неверный или истёкший код' });
  if (Date.now() > pending.expiresAt) {
    pendingDeletions.delete(String(code));
    return res.status(400).json({ error: 'Код истёк. Запросите новый.' });
  }
  if (pending.username !== req.user.username)
    return res.status(403).json({ error: 'Код не принадлежит этому аккаунту' });

  const user = await getUser(req.user.username.toLowerCase());
  if (!user) return res.status(404).json({ error: 'Пользователь не найден' });
  if (user.role === 'admin') return res.status(403).json({ error: 'Нельзя удалить аккаунт администратора' });

  pendingDeletions.delete(String(code));

  try {
    await db(`
      CREATE TABLE IF NOT EXISTS deleted_usernames (
        username_low TEXT PRIMARY KEY,
        deleted_at   BIGINT NOT NULL
      )
    `);
    await db('INSERT INTO deleted_usernames (username_low, deleted_at) VALUES ($1, $2) ON CONFLICT DO NOTHING', [user.username.toLowerCase(), Date.now()]);

    await db('DELETE FROM users WHERE id = $1', [user.id]);
    usersCache.delete(user.username.toLowerCase());

    const sock = findSocketByUsername(user.username);
    if (sock) { sock.emit('account_deleted'); sock.disconnect(); }

    console.log(`[DeleteAccount] Аккаунт удалён: ${user.username}`);
    res.json({ ok: true, message: 'Аккаунт удалён' });
  } catch (err) {
    console.error('[DeleteAccount confirm]', err.message);
    res.status(500).json({ error: 'Ошибка при удалении: ' + err.message });
  }
});

app.get('/api/users/:username', async (req, res) => {
  const user = await getUser(req.params.username.toLowerCase());
  if (!user) return res.status(404).json({ error: 'Не найден' });
  const payload = verifyToken(getAuthToken(req));
  const isSelf = payload && payload.username && payload.username.toLowerCase() === user.username.toLowerCase();
  const data = isSelf ? { ...sanitizeUser(user), email: user.email || null } : sanitizeUser(user);
  res.json({ ...data, online: onlineUsers.has(user.username) });
});

app.get('/api/users/:username/games', async (req, res) => {
  const u = req.params.username;
  const limit = parseInt(req.query.limit) || 20;
  const r = await db('SELECT * FROM games WHERE white = $1 OR black = $1 ORDER BY ended_at DESC LIMIT $2', [u, limit]);
  res.json(r.rows.map(row => ({
    id: row.id, white: row.white, black: row.black,
    result: row.result, reason: row.reason,
    moves: row.moves, timeControl: row.time_control,
    endedAt: row.ended_at ? Number(row.ended_at) : null,
    berserk: row.berserk, accuracy: row.accuracy,
    tournamentId: row.tournament_id,
    rated: row.rated !== false,
  })));
});

app.get('/api/games/:gameId', async (req, res) => {
  const active = activeGames.get(req.params.gameId);
  if (active) return res.json(active);
  const r = await db('SELECT * FROM games WHERE id = $1', [req.params.gameId]);
  if (!r.rows[0]) {
    // Фоллбэк: старые турнирные партии, сохранённые до записи в таблицу games
    for (const t of tournaments) {
      const tg = (t.games || []).find(g => g.id === req.params.gameId);
      if (tg) {
        return res.json({
          id: tg.id, white: tg.white, black: tg.black,
          result: tg.result, reason: tg.reason, moves: tg.moves,
          timeControl: tg.timeControl, endedAt: tg.endedAt || null,
          berserk: tg.berserk, accuracy: tg.accuracy, tournamentId: t.id,
        });
      }
    }
    return res.status(404).json({ error: 'Не найдена' });
  }
  const row = r.rows[0];
  res.json({
    id: row.id, white: row.white, black: row.black,
    result: row.result, reason: row.reason, moves: row.moves,
    timeControl: row.time_control, endedAt: row.ended_at ? Number(row.ended_at) : null,
    rated: row.rated !== false,
  });
});

app.get('/api/leaderboard', async (req, res) => {
  const r = await db('SELECT * FROM users ORDER BY rating DESC LIMIT 50');
  res.json(r.rows.map(row => ({ ...sanitizeUser(rowToUser(row)), online: onlineUsers.has(row.username) })));
});

// Раньше здесь было Math.max(onlineUsers.size, io.engine?.clientsCount || 0).
// onlineUsers — Set из юзернеймов (уже без дублей), а io.engine.clientsCount —
// это СЫРОЕ число открытых транспортных соединений на движке socket.io,
// включая кратковременно "зависшие" старые соединения при быстрых
// перезагрузках страницы (новый сокет уже подключился, а событие
// disconnect старого ещё не долетело). Из-за Math.max счётчик онлайна
// на секунды раздувался при частом F5, хотя реальных уникальных
// пользователей больше не становилось. onlineUsers.size — точное число.
app.get('/api/online',       (req, res) => res.json({ count: onlineUsers.size }));
app.all('/api/ping',         (req, res) => res.status(200).end());
app.get('/api/online/users', (req, res) => {
  const list = [...onlineUsers].map(username => {
    const u = usersCache.get(username.toLowerCase());
    return u ? { username: u.username, rating: u.rating, role: u.role || 'user', vip: isVip(u) } : { username, rating: null, role: 'user', vip: false };
  }).sort((a, b) => {
    if (a.role === 'admin' && b.role !== 'admin') return -1;
    if (b.role === 'admin' && a.role !== 'admin') return 1;
    return a.username.localeCompare(b.username);
  });
  res.json(list);
});

// ──────────────────────────────────────────────────────────────
//  QUESTS API (Сезон 2)
// ──────────────────────────────────────────────────────────────

app.get('/api/quests/list', authMiddleware, async (req, res) => {
    try {
        const userId = req.user.userId;
        const page = parseInt(req.query.page) || 1;
        const limit = Math.min(20, parseInt(req.query.limit) || 20);
        const offset = (page - 1) * limit;
        const currentDay = getCurrentSeasonDay();

        const questsQuery = await db(`
            SELECT q.id, q.day, q.title, q.reward_crystals, q.is_mega, q.type,
                   CASE WHEN uq.quest_id IS NOT NULL THEN true ELSE false END as completed,
                   CASE WHEN q.day <= $1 THEN true ELSE false END as unlocked_by_date
            FROM quests q
            LEFT JOIN user_quests uq ON q.id = uq.quest_id AND uq.user_id = $2
            ORDER BY q.day
            LIMIT $3 OFFSET $4
        `, [currentDay, userId, limit, offset]);

        const totalCount = await db('SELECT COUNT(*) as total FROM quests');
        const total = parseInt(totalCount.rows[0].total);

        const userStats = await db('SELECT total_crystals, total_crystals_updated_at FROM users WHERE id = $1', [userId]);
        const totalCrystals = userStats.rows[0]?.total_crystals || 0;
        const lastUpdated = userStats.rows[0]?.total_crystals_updated_at || 0;
        const todayStart = new Date().setHours(0, 0, 0, 0);
        const canDoToday = lastUpdated < todayStart;

        const firstIncomplete = await db(`
            SELECT q.id, q.day
            FROM quests q
            WHERE q.day <= $1
              AND NOT EXISTS (SELECT 1 FROM user_quests uq WHERE uq.quest_id = q.id AND uq.user_id = $2)
            ORDER BY q.day
            LIMIT 1
        `, [currentDay, userId]);
        const availableQuestId = firstIncomplete.rows[0]?.id || null;

        res.json({
            quests: questsQuery.rows,
            pagination: { page, limit, total },
            currentDay,
            canDoToday,
            availableQuestId,
            totalCrystals
        });
    } catch (err) {
        console.error('[Quests list]', err);
        res.status(500).json({ error: 'Ошибка загрузки квестов' });
    }
});
// per-user (не per-IP) лимит: не больше 5 попыток в минуту на аккаунт —
// внутри транзакции всё равно защищено FOR UPDATE + total_crystals_updated_at,
// но это не даёт одному аккаунту засыпать пул запросами.
const limiterQuests = new RateLimiter(60_000, 5);

app.post('/api/quests/complete', authMiddleware, async (req, res) => {
    const userId = req.user.userId;
    const limCheck = limiterQuests.check(userId);
    if (!limCheck.allowed) {
        return res.status(429).json({ error: 'Слишком много попыток. Подождите немного.' });
    }

    try {
        const { confirmed } = req.body;
        const currentDay = getCurrentSeasonDay();
        const now = Date.now();
        const todayStart = new Date().setHours(0, 0, 0, 0);

        const result = await withTransaction(async (client) => {
            // FOR UPDATE — блокирует строку пользователя до конца транзакции,
            // так что два конкурентных запроса от одного юзера не смогут оба
            // пройти проверку "квест ещё не выполнен сегодня" одновременно.
            const user = await client.query(
                'SELECT total_crystals_updated_at FROM users WHERE id = $1 FOR UPDATE',
                [userId]
            );
            const lastUpdated = user.rows[0]?.total_crystals_updated_at || 0;
            if (lastUpdated >= todayStart) {
                return { error: 'Сегодня вы уже выполнили квест', status: 400 };
            }

            const firstQuest = await client.query(`
                SELECT q.id, q.day, q.type, q.reward_crystals
                FROM quests q
                LEFT JOIN user_quests uq ON q.id = uq.quest_id AND uq.user_id = $1
                WHERE q.day <= $2
                  AND uq.quest_id IS NULL
                  AND q.type IN ('manual', 'confirm')
                ORDER BY q.day
                LIMIT 1
            `, [userId, currentDay]);

            if (firstQuest.rows.length === 0) {
                return { error: 'Нет доступных квестов', status: 400 };
            }

            const quest = firstQuest.rows[0];
            if (quest.type === 'confirm' && !confirmed) {
                return { error: 'Нужно подтверждение', status: 400 };
            }

            // ON CONFLICT — вторая защита от гонки на случай, если тот же квест
            // уже был вставлен параллельным запросом до FOR UPDATE.
            const inserted = await client.query(
                `INSERT INTO user_quests (user_id, quest_id, completed_at, progress, target)
                 VALUES ($1, $2, $3, 0, 0)
                 ON CONFLICT (user_id, quest_id) DO NOTHING
                 RETURNING quest_id`,
                [userId, quest.id, now]
            );
            if (inserted.rows.length === 0) {
                return { error: 'Квест уже выполнен', status: 400 };
            }

            const updated = await client.query(
                `UPDATE users SET total_crystals = total_crystals + $1, total_crystals_updated_at = $2
                 WHERE id = $3 RETURNING total_crystals`,
                [quest.reward_crystals, now, userId]
            );

            return {
                success: true,
                added: quest.reward_crystals,
                totalCrystals: updated.rows[0].total_crystals,
                canDoToday: false,
                completedQuestId: quest.id
            };
        });

        if (result.error) return res.status(result.status).json({ error: result.error });
        res.json(result);
    } catch (err) {
        console.error('[Quests complete]', err);
        res.status(500).json({ error: 'Ошибка при выполнении квеста' });
    }
});
app.get('/api/quests/leaderboard', async (req, res) => {
    try {
        const limit = Math.min(50, parseInt(req.query.limit) || 10);
        const rows = await db(`
            SELECT username, total_crystals, total_crystals_updated_at
            FROM users
            WHERE total_crystals > 0
            ORDER BY total_crystals DESC, total_crystals_updated_at ASC
            LIMIT $1
        `, [limit]);
        res.json(rows.rows);
    } catch (err) {
        console.error('[Quests leaderboard]', err);
        res.status(500).json({ error: 'Ошибка загрузки лидерборда' });
    }
});
app.get('/api/challenges', (req, res) => res.json(pendingChallenges.filter(c => Date.now() - c.createdAt < 60000)));
app.get('/api/chat',       (req, res) => res.json(globalChat.slice(-(parseInt(req.query.limit) || 50))));

// ── Admin API ─────────────────────────────────────────────────
app.get('/api/admin/users', authMiddleware, async (req, res) => {
  await requireAdmin(req, res, async () => {
    const r = await db('SELECT * FROM users ORDER BY rating DESC');
    res.json(r.rows.map(row => adminSanitizeUser(rowToUser(row))));
  });
});

app.post('/api/admin/ban', authMiddleware, async (req, res) => {
  await requireAdmin(req, res, async () => {
    try {
      const target = await getUser((req.body.username || '').toLowerCase());
      if (!target) return res.status(404).json({ error: 'Не найден' });
      if (target.role === 'admin') return res.status(403).json({ error: 'Нельзя забанить администратора' });

      const reason = req.body.reason || 'Нарушение правил';
      const targetDevice = target.createdDeviceId;
      if (targetDevice) { bannedDevices.add(targetDevice); await saveBanToDB(null, targetDevice); }

      const r = await db('SELECT * FROM users WHERE created_device_id = $1 AND role != $2', [targetDevice || '__none__', 'admin']);
      let count = 0;
      for (const row of r.rows) {
        const u = rowToUser(row);
        if (!u.banned) {
          const isTarget = u.username === target.username;
          u.banned = true; u.banReason = reason + (!isTarget ? ' (мультиаккаунт)' : '');
          await saveUser(u);
          await removeUserChatMessages(u.username).catch(e => console.error('[Ban] chat cleanup:', e.message));
          const sock = findSocketByUsername(u.username);
          if (sock) { sock.emit('error', 'Аккаунт заблокирован'); sock.disconnect(); }
          count++;
        }
      }
      if (!target.banned) {
        target.banned = true; target.banReason = reason;
        await saveUser(target);
        await removeUserChatMessages(target.username).catch(e => console.error('[Ban] chat cleanup:', e.message));
        const sock = findSocketByUsername(target.username);
        if (sock) { sock.emit('error', 'Аккаунт заблокирован'); sock.disconnect(); }
        count++;
      }
      await logAdminAction(req.user.username, 'ban', target.username, { reason, accountsBanned: count, viaDeviceId: targetDevice || null });
      res.json({ ok: true, accountsBanned: count });
    } catch (e) {
      console.error('[Ban]', e);
      res.status(500).json({ error: 'Ошибка бана: ' + e.message });
    }
  });
});

app.post('/api/admin/unban', authMiddleware, async (req, res) => {
  await requireAdmin(req, res, async () => {
    try {
      const target = await getUser((req.body.username || '').toLowerCase());
      if (!target) return res.status(404).json({ error: 'Не найден' });
      target.banned = false; target.banReason = null;
      if (target.createdDeviceId) { bannedDevices.delete(target.createdDeviceId); await removeBanFromDB(null, target.createdDeviceId); }
      if (req.body.unbanIP && target.createdFromIP) { bannedIPs.delete(target.createdFromIP); await removeBanFromDB(target.createdFromIP, null); }
      await saveUser(target);
      await logAdminAction(req.user.username, 'unban', target.username, { unbanIP: !!req.body.unbanIP });
      res.json({ ok: true });
    } catch (e) {
      console.error('[Unban]', e);
      res.status(500).json({ error: 'Ошибка разбана: ' + e.message });
    }
  });
});

// ── VIP-значок ──────────────────────────────────────────────────
// Выдают/снимают только chesshome и Marina64 (requireVipGranter),
// а не любой admin — так попросил владелец.
app.post('/api/admin/vip/grant', authMiddleware, async (req, res) => {
  await requireVipGranter(req, res, async () => {
    try {
      const target = await getUser((req.body.username || '').toLowerCase());
      if (!target) return res.status(404).json({ error: 'Пользователь не найден' });
      const days = Math.min(365, Math.max(1, parseInt(req.body.days) || 30));
      // Если значок уже активен — продлеваем от текущей даты окончания, а не от "сейчас".
      const base = isVip(target) ? target.vipUntil : Date.now();
      target.vipUntil = base + days * 24 * 60 * 60 * 1000;
      await saveUser(target);
      await logAdminAction(req.user.username, 'vip_grant', target.username, { days, vipUntil: target.vipUntil });
      const sock = findSocketByUsername(target.username);
      if (sock) sock.emit('vip_updated', { vip: true, vipUntil: target.vipUntil });
      res.json({ ok: true, username: target.username, vipUntil: target.vipUntil });
    } catch (e) {
      console.error('[VIP grant]', e);
      res.status(500).json({ error: 'Ошибка выдачи значка: ' + e.message });
    }
  });
});

app.post('/api/admin/vip/revoke', authMiddleware, async (req, res) => {
  await requireVipGranter(req, res, async () => {
    try {
      const target = await getUser((req.body.username || '').toLowerCase());
      if (!target) return res.status(404).json({ error: 'Пользователь не найден' });
      target.vipUntil = null;
      await saveUser(target);
      await logAdminAction(req.user.username, 'vip_revoke', target.username, {});
      const sock = findSocketByUsername(target.username);
      if (sock) sock.emit('vip_updated', { vip: false, vipUntil: null });
      res.json({ ok: true });
    } catch (e) {
      console.error('[VIP revoke]', e);
      res.status(500).json({ error: 'Ошибка снятия значка: ' + e.message });
    }
  });
});

app.get('/api/admin/vip/list', authMiddleware, async (req, res) => {
  await requireVipGranter(req, res, async () => {
    const r = await db('SELECT username, vip_until FROM users WHERE vip_until IS NOT NULL AND vip_until > $1 ORDER BY vip_until ASC', [Date.now()]);
    res.json(r.rows.map(row => ({ username: row.username, vipUntil: Number(row.vip_until) })));
  });
});

app.get('/api/admin/ipbans', authMiddleware, async (req, res) => {
  await requireAdmin(req, res, async () => {
    res.json({ ips: [...bannedIPs], devices: [...bannedDevices], total: bannedIPs.size });
  });
});

app.post('/api/admin/ipban', authMiddleware, async (req, res) => {
  await requireAdmin(req, res, async () => {
    const target = await getUser((req.body.username || '').toLowerCase());
    if (!target) return res.status(404).json({ error: 'Не найден' });
    if (target.role === 'admin') return res.status(403).json({ error: 'Нельзя' });
    const ip = target.createdFromIP;
    if (!ip) return res.status(400).json({ error: 'IP не сохранён' });
    if (isLocalIP(ip)) return res.status(400).json({ error: 'Нельзя забанить локальный IP' });
    bannedIPs.add(ip); await saveBanToDB(ip, target.createdDeviceId || null);
    if (target.createdDeviceId) bannedDevices.add(target.createdDeviceId);

    const r = await db('SELECT * FROM users WHERE created_device_id = $1 AND role != $2', [target.createdDeviceId || '__none__', 'admin']);
    let count = 0;
    for (const row of r.rows) {
      const u = rowToUser(row);
      if (!u.banned) {
        u.banned = true; u.banReason = 'IP-бан администратором';
        await saveUser(u);
        const sock = findSocketByUsername(u.username);
        if (sock) { sock.emit('error', 'Аккаунт заблокирован'); sock.disconnect(); }
        count++;
      }
    }
    await logAdminAction(req.user.username, 'ip_ban', ip, { viaUser: target.username, accountsBanned: count });
    res.json({ ok: true, ip, accountsBanned: count });
  });
});

app.post('/api/admin/ipunban', authMiddleware, async (req, res) => {
  await requireAdmin(req, res, async () => {
    const ip = req.body.ip;
    if (!ip) return res.status(400).json({ error: 'Укажите IP' });
    bannedIPs.delete(ip); await removeBanFromDB(ip, null);
    await logAdminAction(req.user.username, 'ip_unban', ip, {});
    res.json({ ok: true });
  });
});

app.post('/api/admin/unban-device', authMiddleware, async (req, res) => {
  await requireAdmin(req, res, async () => {
    const deviceId = req.body.deviceId;
    if (!deviceId) return res.status(400).json({ error: 'Укажите deviceId' });
    bannedDevices.delete(deviceId); await removeBanFromDB(null, deviceId);
    await logAdminAction(req.user.username, 'device_unban', deviceId, {});
    res.json({ ok: true });
  });
});

app.post('/api/admin/unban-full', authMiddleware, async (req, res) => {
  await requireAdmin(req, res, async () => {
    const target = await getUser((req.body.username || '').toLowerCase());
    if (!target) return res.status(404).json({ error: 'Не найден' });
    target.banned = false; target.banReason = null;
    if (target.createdDeviceId) { bannedDevices.delete(target.createdDeviceId); await removeBanFromDB(null, target.createdDeviceId); }
    if (target.createdFromIP)   { bannedIPs.delete(target.createdFromIP); await removeBanFromDB(target.createdFromIP, null); }
    await saveUser(target);
    await logAdminAction(req.user.username, 'unban_full', target.username, {});
    res.json({ ok: true });
  });
});

async function handleDeleteChatMsg(req, res) {
  await requireAdmin(req, res, async () => {
    const idx = globalChat.findIndex(m => m.id === req.params.msgId);
    if (idx === -1) return res.status(404).json({ error: 'Не найдено' });
    const removed = globalChat[idx];
    globalChat.splice(idx, 1);
    await deleteChatMsg(req.params.msgId);
    await logAdminAction(req.user.username, 'chat_delete', removed?.username || null, { msgId: req.params.msgId, text: (removed?.message || '').slice(0, 200) });
    io.emit('chat_msg_deleted', req.params.msgId);
    res.json({ ok: true });
  });
}
app.delete('/api/admin/chat/:msgId', authMiddleware, handleDeleteChatMsg);
app.post('/api/admin/chat/:msgId/delete', authMiddleware, handleDeleteChatMsg);

// Вынесено в отдельную функцию, чтобы вызывать и из ручного удаления,
// и автоматически при бане пользователя (см. /api/admin/ban).
async function removeUserChatMessages(username) {
  const toRemove = globalChat.filter(m => m.username === username).map(m => m.id);
  for (let i = globalChat.length - 1; i >= 0; i--) {
    if (globalChat[i].username === username) globalChat.splice(i, 1);
  }
  for (const id of toRemove) {
    await deleteChatMsg(id).catch(() => {});
  }
  if (toRemove.length) io.emit('chat_msgs_user_deleted', username);
  return toRemove.length;
}

app.delete('/api/admin/chat/user/:username', authMiddleware, async (req, res) => {
  await requireAdmin(req, res, async () => {
    const removed = await removeUserChatMessages(req.params.username);
    await logAdminAction(req.user.username, 'chat_clear_user', req.params.username, { removed });
    res.json({ ok: true, removed });
  });
});

app.post('/api/admin/chat-ban', authMiddleware, async (req, res) => {
  await requireAdmin(req, res, async () => {
    try {
      const { username, durationMinutes } = req.body;
      if (!username || !durationMinutes) return res.status(400).json({ error: 'Нет параметров' });
      const dur = Math.max(1, Math.min(1440, parseInt(durationMinutes) || 15));
      const unbanAt = Date.now() + dur * 60 * 1000;

      if (!global.chatBans) global.chatBans = new Map();
      global.chatBans.set(username.toLowerCase(), unbanAt);

      // Чистим уже отправленные сообщения — мут не должен оставлять
      // спам/реклама/XSS-попытки висеть в чате до истечения таймера.
      await removeUserChatMessages(username).catch(e => console.error('[ChatBan] chat cleanup:', e.message));

      let durText;
      if (dur < 60) durText = dur + ' минут';
      else if (dur === 60) durText = '1 час';
      else if (dur < 1440) durText = Math.round(dur / 60) + ' часа';
      else durText = '24 часа';

      const sysMsg = `${username} заблокирован в чате на ${durText}. Соблюдайте правила платформы.`;

      const sysChatMsg = { id: require('crypto').randomUUID(), username: 'system', message: sysMsg, role: 'system', timestamp: Date.now(), system: true };
      globalChat.push(sysChatMsg);
      if (globalChat.length > 500) globalChat.shift();

      io.emit('chat_system_msg', sysMsg);

      await logAdminAction(req.user.username, 'chat_ban', username, { durationMinutes: dur, unbanAt });
      res.json({ ok: true, unbanAt });
    } catch (e) {
      console.error('[ChatBan]', e);
      res.status(500).json({ error: 'Ошибка чат-бана: ' + e.message });
    }
  });
});
app.post('/api/report', authMiddleware, rateLimit(limiterStrict), async (req, res) => {
  const { targetUsername, reason, details } = req.body;
  if (!targetUsername || !reason) return res.status(400).json({ error: 'Укажите причину' });
  
  const target = await getUser((targetUsername || '').toLowerCase());
  if (!target) return res.status(404).json({ error: 'Не найден' });
  if (targetUsername === req.user.username) return res.status(400).json({ error: 'Нельзя жаловаться на себя' });

  // Проверка лимита: 1 жалоба на одного и того же человека в неделю
  const ONE_WEEK_MS = 7 * 24 * 60 * 60 * 1000;
  const recentReport = await db(
    'SELECT created_at FROM reports WHERE reporter = $1 AND target_username = $2 ORDER BY created_at DESC LIMIT 1',
    [req.user.username, target.username]
  );

  if (recentReport.rows.length > 0) {
    const lastReportTime = Number(recentReport.rows[0].created_at);
    if (Date.now() - lastReportTime < ONE_WEEK_MS) {
      return res.status(429).json({ 
        error: 'Вы уже отправляли жалобу на этого игрока. Повторную жалобу можно отправить через неделю.' 
      });
    }
  }

  const report = {
    id: uuidv4(), reporter: req.user.username, targetUsername: target.username,
    reason, details: (details || '').slice(0, 500), status: 'new', createdAt: Date.now()
  };
  
  await db('INSERT INTO reports (id, reporter, target_username, reason, details, status, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7)',
    [report.id, report.reporter, report.targetUsername, report.reason, report.details, report.status, report.createdAt]);
    
  const total = (await db("SELECT COUNT(*) FROM reports WHERE status='new'")).rows[0].count;
  await emitToAdmins('new_report', { report, total: Number(total) });
  res.json({ ok: true });
});

app.get('/api/admin/reports', authMiddleware, async (req, res) => {
  await requireAdmin(req, res, async () => {
    const status = req.query.status;
    const r = status
      ? await db('SELECT * FROM reports WHERE status = $1 ORDER BY created_at DESC LIMIT 100', [status])
      : await db('SELECT * FROM reports ORDER BY created_at DESC LIMIT 100');
    res.json(r.rows.map(row => ({
      id: row.id, reporter: row.reporter, targetUsername: row.target_username,
      reason: row.reason, details: row.details, status: row.status,
      createdAt: Number(row.created_at), reviewedBy: row.reviewed_by, reviewedAt: row.reviewed_at,
    })));
  });
});

async function handleUpdateReportStatus(req, res) {
  await requireAdmin(req, res, async () => {
    try {
      const status = req.body.status || 'reviewed';
      const r = await db('UPDATE reports SET status=$1, reviewed_by=$2, reviewed_at=$3 WHERE id=$4',
        [status, req.user.username, Date.now(), req.params.reportId]);
      if (r.rowCount === 0) {
        return res.status(404).json({ error: 'Жалоба не найдена (возможно, неверный id)' });
      }
      await logAdminAction(req.user.username, 'report_status', req.params.reportId, { status });
      res.json({ ok: true });
    } catch (e) {
      console.error('[Reports PATCH]', e.message);
      res.status(500).json({ error: 'Ошибка обновления статуса: ' + e.message });
    }
  });
}
// PATCH — основной вариант. Некоторые хостинги/прокси режут методы PATCH/DELETE,
// поэтому дублируем ту же логику через POST — фронтенд теперь ходит именно сюда.
app.patch('/api/admin/reports/:reportId', authMiddleware, handleUpdateReportStatus);
app.post('/api/admin/reports/:reportId/status', authMiddleware, handleUpdateReportStatus);
// ── Апелляции / обращения (тикеты) ─────────────────────────────
// Правило: пока не ответит вторая сторона, писать снова нельзя —
// поле `awaiting` хранит, чья очередь отвечать ('admin' | 'user').
// Закрытые тикеты блокируют переписку до тех пор, пока админ не
// откроет их заново через PATCH.
const APPEAL_REASONS = ['ban', 'cheater', 'rating', 'other'];

app.post('/api/appeals', authMiddleware, rateLimit(limiterStrict), async (req, res) => {
  const { reason, message } = req.body;
  if (!reason || !APPEAL_REASONS.includes(reason)) return res.status(400).json({ error: 'Укажите тему обращения' });
  const text = (message || '').trim();
  if (!text) return res.status(400).json({ error: 'Напишите сообщение' });
  if (text.length > 1000) return res.status(400).json({ error: 'Слишком длинное сообщение (макс. 1000 символов)' });

  const openExisting = await db(
    `SELECT id FROM appeals WHERE username = $1 AND status = 'open' LIMIT 1`,
    [req.user.username]
  );
  if (openExisting.rows.length > 0) {
    return res.status(409).json({
      error: 'У вас уже есть открытое обращение. Дождитесь ответа администратора.',
      appealId: openExisting.rows[0].id
    });
  }

  const id = uuidv4();
  const now = Date.now();
  await db(
    `INSERT INTO appeals (id, username, reason, status, awaiting, created_at, updated_at) VALUES ($1,$2,$3,'open','admin',$4,$4)`,
    [id, req.user.username, reason, now]
  );
  await db(
    `INSERT INTO appeal_messages (id, appeal_id, author, is_admin, message, created_at) VALUES ($1,$2,$3,FALSE,$4,$5)`,
    [uuidv4(), id, req.user.username, text, now]
  );

  const total = (await db(`SELECT COUNT(*) FROM appeals WHERE status='open' AND awaiting='admin'`)).rows[0].count;
  await emitToAdmins('new_appeal', { appealId: id, username: req.user.username, reason, total: Number(total) });
  res.json({ ok: true, appealId: id });
});

app.get('/api/appeals/mine', authMiddleware, async (req, res) => {
  const list = await db(`SELECT * FROM appeals WHERE username = $1 ORDER BY created_at DESC LIMIT 20`, [req.user.username]);
  const appeals = [];
  for (const row of list.rows) {
    const msgs = await db(`SELECT * FROM appeal_messages WHERE appeal_id = $1 ORDER BY created_at ASC`, [row.id]);
    appeals.push({
      id: row.id, reason: row.reason, status: row.status, awaiting: row.awaiting,
      createdAt: Number(row.created_at), updatedAt: Number(row.updated_at),
      messages: msgs.rows.map(m => ({ id: m.id, author: m.author, isAdmin: m.is_admin, message: m.message, createdAt: Number(m.created_at) }))
    });
  }
  res.json(appeals);
});

app.post('/api/appeals/:id/reply', authMiddleware, rateLimit(limiterStrict), async (req, res) => {
  const text = (req.body.message || '').trim();
  if (!text) return res.status(400).json({ error: 'Напишите сообщение' });
  if (text.length > 1000) return res.status(400).json({ error: 'Слишком длинное сообщение (макс. 1000 символов)' });

  const r = await db(`SELECT * FROM appeals WHERE id = $1`, [req.params.id]);
  const appeal = r.rows[0];
  if (!appeal) return res.status(404).json({ error: 'Обращение не найдено' });
  if (appeal.username !== req.user.username) return res.status(403).json({ error: 'Это не ваше обращение' });
  if (appeal.status === 'closed') return res.status(400).json({ error: 'Обращение закрыто администратором' });
  if (appeal.awaiting !== 'user') return res.status(400).json({ error: 'Дождитесь ответа администратора, прежде чем писать снова' });

  const now = Date.now();
  await db(
    `INSERT INTO appeal_messages (id, appeal_id, author, is_admin, message, created_at) VALUES ($1,$2,$3,FALSE,$4,$5)`,
    [uuidv4(), appeal.id, req.user.username, text, now]
  );
  await db(`UPDATE appeals SET awaiting='admin', updated_at=$1 WHERE id=$2`, [now, appeal.id]);

  const total = (await db(`SELECT COUNT(*) FROM appeals WHERE status='open' AND awaiting='admin'`)).rows[0].count;
  await emitToAdmins('new_appeal', { appealId: appeal.id, username: req.user.username, reason: appeal.reason, total: Number(total) });
  res.json({ ok: true });
});

app.get('/api/admin/appeals', authMiddleware, async (req, res) => {
  await requireAdmin(req, res, async () => {
    const status = req.query.status;
    const r = status
      ? await db(`SELECT * FROM appeals WHERE status = $1 ORDER BY updated_at DESC LIMIT 200`, [status])
      : await db(`SELECT * FROM appeals ORDER BY updated_at DESC LIMIT 200`);
    res.json(r.rows.map(row => ({
      id: row.id, username: row.username, reason: row.reason, status: row.status,
      awaiting: row.awaiting, createdAt: Number(row.created_at), updatedAt: Number(row.updated_at),
    })));
  });
});

app.get('/api/admin/appeals/:id', authMiddleware, async (req, res) => {
  await requireAdmin(req, res, async () => {
    const r = await db(`SELECT * FROM appeals WHERE id = $1`, [req.params.id]);
    const appeal = r.rows[0];
    if (!appeal) return res.status(404).json({ error: 'Не найдено' });
    const msgs = await db(`SELECT * FROM appeal_messages WHERE appeal_id = $1 ORDER BY created_at ASC`, [appeal.id]);
    res.json({
      id: appeal.id, username: appeal.username, reason: appeal.reason, status: appeal.status,
      awaiting: appeal.awaiting, createdAt: Number(appeal.created_at), updatedAt: Number(appeal.updated_at),
      messages: msgs.rows.map(m => ({ id: m.id, author: m.author, isAdmin: m.is_admin, message: m.message, createdAt: Number(m.created_at) }))
    });
  });
});

app.post('/api/admin/appeals/:id/reply', authMiddleware, rateLimit(limiterStrict), async (req, res) => {
  await requireAdmin(req, res, async () => {
    const text = (req.body.message || '').trim();
    if (!text) return res.status(400).json({ error: 'Напишите сообщение' });
    if (text.length > 2000) return res.status(400).json({ error: 'Слишком длинное сообщение' });

    const r = await db(`SELECT * FROM appeals WHERE id = $1`, [req.params.id]);
    const appeal = r.rows[0];
    if (!appeal) return res.status(404).json({ error: 'Не найдено' });
    if (appeal.status === 'closed') return res.status(400).json({ error: 'Обращение закрыто — сначала откройте его заново' });

    const now = Date.now();
    await db(
      `INSERT INTO appeal_messages (id, appeal_id, author, is_admin, message, created_at) VALUES ($1,$2,$3,TRUE,$4,$5)`,
      [uuidv4(), appeal.id, req.user.username, text, now]
    );
    await db(`UPDATE appeals SET awaiting='user', updated_at=$1 WHERE id=$2`, [now, appeal.id]);

    const sock = findSocketByUsername(appeal.username);
    if (sock) sock.emit('appeal_reply', { appealId: appeal.id });
    await logAdminAction(req.user.username, 'appeal_reply', appeal.username, { appealId: appeal.id, text: text.slice(0, 200) });
    res.json({ ok: true });
  });
});

async function handleUpdateAppealStatus(req, res) {
  await requireAdmin(req, res, async () => {
    try {
      const status = req.body.status;
      if (!['open', 'closed'].includes(status)) return res.status(400).json({ error: 'Некорректный статус' });
      const r = await db(`SELECT id FROM appeals WHERE id = $1`, [req.params.id]);
      if (!r.rows.length) return res.status(404).json({ error: 'Не найдено' });

      const now = Date.now();
      if (status === 'open') {
        // Реоткрытие — очередь снова переходит к пользователю
        await db(`UPDATE appeals SET status='open', awaiting='user', updated_at=$1 WHERE id=$2`, [now, req.params.id]);
      } else {
        await db(`UPDATE appeals SET status='closed', updated_at=$1 WHERE id=$2`, [now, req.params.id]);
      }
      await logAdminAction(req.user.username, 'appeal_status', req.params.id, { status });
      res.json({ ok: true });
    } catch (e) {
      console.error('[Appeals PATCH]', e);
      res.status(500).json({ error: 'Ошибка обновления статуса обращения' });
    }
  });
}
app.patch('/api/admin/appeals/:id', authMiddleware, handleUpdateAppealStatus);
app.post('/api/admin/appeals/:id/status', authMiddleware, handleUpdateAppealStatus);
// ── Tournaments API ───────────────────────────────────────────
app.get('/api/tournaments', async (req, res) => {
  const now = Date.now();
  const oneYearAgo = now - 365 * 24 * 60 * 60 * 1000;
  let list = tournaments
    .filter(t => {
      if (getTournamentStatus(t, now) === 'finished' && t.endsAt < oneYearAgo) return false;
      return true;
    })
    .map(t => ({
      ...t, participantsCount: (t.participants || []).filter(p => !p.anticheatBanned).length,
      status: getTournamentStatus(t, now), participants: undefined, games: undefined, blacklist: undefined,
      createdByIsAdmin: usersCache.get((t.createdBy || '').toLowerCase())?.role === 'admin',
      teams: getInterclubTeamsInfo(t),
    }));
  if (req.query.status) list = list.filter(t => t.status === req.query.status);
  if (req.query.clubId) list = list.filter(t => t.clubId === req.query.clubId);
  // ?isInterclub=true — только межклубные турниры (для отдельной страницы),
  // ?isInterclub=false — только обычные (скрыть межклубные из общего списка турниров).
  if (req.query.isInterclub === 'true') list = list.filter(t => t.isInterclub);
  if (req.query.isInterclub === 'false') list = list.filter(t => !t.isInterclub);
  list.sort((a, b) => a.startsAt - b.startsAt);
  res.json(list);
});

app.get('/api/tournaments/:id', (req, res) => {
  const t = tournaments.find(t => t.id === req.params.id);
  if (!t) return res.status(404).json({ error: 'Не найден' });
  const now = Date.now();
  const sorted = [...(t.participants || [])].filter(p => !p.anticheatBanned).sort((a, b) => b.score - a.score || b.wins - a.wins);
  let isAdmin = false;
  const authToken_ = getAuthToken(req);
  if (authToken_) {
    try { const d = jwt.verify(authToken_, JWT_SECRET); const u = usersCache.get(d.username.toLowerCase()); isAdmin = u?.role === 'admin'; } catch {}
  }
  res.json({ ...t, participants: sorted, status: getTournamentStatus(t, now), isArchive: t.endsAt < now - 365*24*60*60*1000, blacklist: isAdmin ? (t.blacklist || []) : undefined, createdByIsAdmin: usersCache.get((t.createdBy || '').toLowerCase())?.role === 'admin', teams: getInterclubTeamsInfo(t), teamStandings: computeTeamStandings(t) });
});

app.post('/api/tournaments', authMiddleware, async (req, res) => {
  if (!req.user) return res.status(401).json({ error: 'Нет доступа' });
  const user = await getUser(req.user.username.toLowerCase());
  if (!user) return res.status(401).json({ error: 'Нет доступа' });

  const isAdmin = user.role === 'admin';
  const { name, description, timeControl, durationMinutes, startsAt, maxParticipants, minRating, maxRating, blacklist, clubId, clubOnly } = req.body;
  if (!name || !timeControl || !durationMinutes || !startsAt) return res.status(400).json({ error: 'Заполните обязательные поля' });

  // Клубный турнир — привязка турнира к клубу разрешена только его администраторам
  // (защита от спама: обычный участник клуба не может создать «клубный» турнир от его имени).
  let finalClubId = null, finalClubOnly = false;
  if (clubId) {
    const club = clubs.find(c => c.id === clubId);
    if (!club) return res.status(404).json({ error: 'Клуб не найден' });
    if (!isClubModerator(club, user.username)) return res.status(403).json({ error: 'Только администраторы клуба могут создавать клубные турниры' });
    finalClubId = club.id;
    finalClubOnly = !!clubOnly;
  }

  const startTime = new Date(startsAt).getTime();
  if (isNaN(startTime)) return res.status(400).json({ error: 'Неверная дата' });

  const now = Date.now();

  // Нельзя создать турнир в прошлом
  if (startTime < now - 60000) return res.status(400).json({ error: 'Нельзя создать турнир в прошлом' });

  // Максимум — через год
  const oneYearFromNow = now + 365 * 24 * 60 * 60 * 1000;
  if (startTime > oneYearFromNow) return res.status(400).json({ error: 'Максимальная дата — через 1 год от сегодня' });

  // Обычным юзерам — не более 3 турниров в день
  if (!isAdmin) {
    const startOfDay = new Date(); startOfDay.setHours(0, 0, 0, 0);
    const todayTs = startOfDay.getTime();
    const createdToday = tournaments.filter(t => t.createdBy === user.username && t.createdAt >= todayTs).length;
    if (createdToday >= 3) return res.status(429).json({ error: 'Вы уже создали 3 турнира сегодня. Лимит: 3 в день' });
  }

  const bl = Array.isArray(blacklist) ? blacklist.map(s => String(s).toLowerCase().trim()).filter(Boolean).slice(0, 100) : [];
  const tournament = {
    id: uuidv4(), name: name.trim().slice(0, 60), description: (description || '').trim().slice(0, 1000),
    timeControl, durationMinutes: parseInt(durationMinutes),
    startsAt: startTime, endsAt: startTime + parseInt(durationMinutes) * 60000,
    maxParticipants: parseInt(maxParticipants) || 0, minRating: parseInt(minRating) || 0, maxRating: parseInt(maxRating) || 9999,
    blacklist: bl, createdBy: user.username, createdAt: now,
    participants: [], games: [], winner: null,
    clubId: finalClubId, clubOnly: finalClubOnly,
    isInterclub: false, teamIds: [],
  };
  tournaments.push(tournament);
  await saveTournament(tournament);
  io.emit('tournament_created', { id: tournament.id, name: tournament.name, timeControl: tournament.timeControl, startsAt: tournament.startsAt, durationMinutes: tournament.durationMinutes, clubId: tournament.clubId });
  res.json(tournament);
});

// ── Создание межклубного турнира — теперь доступно любому пользователю ──
// (раньше было только сайт-админу). В теле запроса вместо clubId/clubOnly
// передаётся teamLinks — массив ссылок (или голых id) на клубы-команды,
// которые будут сражаться в этом турнире. Управление уже созданным турниром
// (редактирование, удаление) по-прежнему доступно только сайт-админу —
// см. canManageTournament — это защита от того, что случайный участник
// сможет менять состав команд или снести чужой турнир.
app.post('/api/tournaments/interclub', authMiddleware, async (req, res) => {
  if (!req.user) return res.status(401).json({ error: 'Нет доступа' });
  const user = await getUser(req.user.username.toLowerCase());
  if (!user) return res.status(401).json({ error: 'Нет доступа' });

  const isAdmin = user.role === 'admin';
  const { name, description, timeControl, durationMinutes, startsAt, minRating, maxRating, blacklist, teamLinks } = req.body;
  if (!name || !timeControl || !durationMinutes || !startsAt) return res.status(400).json({ error: 'Заполните обязательные поля' });

  const { teamIds, notFound } = resolveInterclubTeams(teamLinks);
  if (teamIds.length < 2) return res.status(400).json({ error: 'Нужно указать ссылки минимум на 2 клуба-команды' });
  if (teamIds.length > MAX_INTERCLUB_TEAMS) return res.status(400).json({ error: `Максимум ${MAX_INTERCLUB_TEAMS} команд в межклубном турнире` });
  if (notFound.length) return res.status(400).json({ error: `Не найдены клубы по ссылкам: ${notFound.slice(0, 10).join(', ')}` });

  const startTime = new Date(startsAt).getTime();
  if (isNaN(startTime)) return res.status(400).json({ error: 'Неверная дата' });
  const now = Date.now();
  if (startTime < now - 60000) return res.status(400).json({ error: 'Нельзя создать турнир в прошлом' });
  const oneYearFromNow = now + 365 * 24 * 60 * 60 * 1000;
  if (startTime > oneYearFromNow) return res.status(400).json({ error: 'Максимальная дата — через 1 год от сегодня' });

  // Обычным юзерам — не более 3 турниров в день (общий лимит с обычными
  // турнирами — см. POST /api/tournaments — чтобы нельзя было обойти его,
  // просто создавая межклубники вместо обычных турниров).
  if (!isAdmin) {
    const startOfDay = new Date(); startOfDay.setHours(0, 0, 0, 0);
    const todayTs = startOfDay.getTime();
    const createdToday = tournaments.filter(t => t.createdBy === user.username && t.createdAt >= todayTs).length;
    if (createdToday >= 3) return res.status(429).json({ error: 'Вы уже создали 3 турнира сегодня. Лимит: 3 в день' });
  }

  const bl = Array.isArray(blacklist) ? blacklist.map(s => String(s).toLowerCase().trim()).filter(Boolean).slice(0, 100) : [];
  const tournament = {
    id: uuidv4(), name: name.trim().slice(0, 60), description: (description || '').trim().slice(0, 1000),
    timeControl, durationMinutes: parseInt(durationMinutes),
    startsAt: startTime, endsAt: startTime + parseInt(durationMinutes) * 60000,
    // У межклубных турниров нет общего лимита участников — он естественно
    // ограничен суммарным числом членов заявленных команд.
    maxParticipants: 0, minRating: parseInt(minRating) || 0, maxRating: parseInt(maxRating) || 9999,
    blacklist: bl, createdBy: user.username, createdAt: now,
    participants: [], games: [], winner: null,
    clubId: null, clubOnly: false,
    isInterclub: true, teamIds,
  };
  tournaments.push(tournament);
  await saveTournament(tournament);
  io.emit('tournament_created', { id: tournament.id, name: tournament.name, timeControl: tournament.timeControl, startsAt: tournament.startsAt, durationMinutes: tournament.durationMinutes, isInterclub: true });
  res.json(tournament);
});

async function handleEditTournament(req, res) {
  await requireTournamentManager(req, res, async (t) => {
    if (getTournamentStatus(t, Date.now()) === 'finished') return res.status(400).json({ error: 'Турнир завершён' });
    ['name','description','timeControl','durationMinutes','maxParticipants','minRating','maxRating'].forEach(k => { if (req.body[k] !== undefined) t[k] = req.body[k]; });
    if (req.body.startsAt) { t.startsAt = new Date(req.body.startsAt).getTime(); t.endsAt = t.startsAt + t.durationMinutes * 60000; }
    if (Array.isArray(req.body.blacklist)) t.blacklist = req.body.blacklist.map(s => String(s).toLowerCase().trim()).filter(Boolean).slice(0, 100);
    // Редактирование списка команд межклубного турнира (только для isInterclub турниров,
    // requireTournamentManager уже гарантирует, что сюда попадёт только сайт-админ).
    if (t.isInterclub && Array.isArray(req.body.teamLinks)) {
      const { teamIds, notFound } = resolveInterclubTeams(req.body.teamLinks);
      if (teamIds.length < 2) return res.status(400).json({ error: 'Нужно указать ссылки минимум на 2 клуба-команды' });
      if (teamIds.length > MAX_INTERCLUB_TEAMS) return res.status(400).json({ error: `Максимум ${MAX_INTERCLUB_TEAMS} команд в межклубном турнире` });
      if (notFound.length) return res.status(400).json({ error: `Не найдены клубы по ссылкам: ${notFound.slice(0, 10).join(', ')}` });
      // Нельзя убрать команду, за которую уже кто-то реально играет в этом турнире.
      const usedTeamIds = new Set((t.participants || []).filter(p => !p.left && p.teamId).map(p => p.teamId));
      for (const used of usedTeamIds) {
        if (!teamIds.includes(used)) {
          const club = clubs.find(c => c.id === used);
          return res.status(400).json({ error: `Нельзя убрать команду «${club ? club.name : used}» — за неё уже играют участники` });
        }
      }
      t.teamIds = teamIds;
    }
    await saveTournament(t);
    io.emit('tournament_updated', { id: t.id, name: t.name, startsAt: t.startsAt });
    res.json(t);
  });
}
app.patch('/api/tournaments/:id', authMiddleware, handleEditTournament);
// Некоторые хостинги/прокси режут методы PATCH/DELETE (запрос не долетает до
// Express и в ответ прилетает HTML-страница ошибки вместо JSON — отсюда и
// "JSON.parse: unexpected character at line 1 column 1"). Даём POST-дублёры,
// как уже сделано для /api/blog, /api/admin/chat и /api/admin/puzzles.
app.post('/api/tournaments/:id/edit', authMiddleware, handleEditTournament);

async function handleDeleteTournament(req, res) {
  await requireTournamentManager(req, res, async (t) => {
    const idx = tournaments.findIndex(x => x.id === t.id);
    if (idx === -1) return res.status(404).json({ error: 'Не найден' });
    tournaments.splice(idx, 1);
    await deleteTournamentFromDB(t.id);
    io.emit('tournament_deleted', t.id);
    res.json({ ok: true });
  });
}
app.delete('/api/tournaments/:id', authMiddleware, handleDeleteTournament);
app.post('/api/tournaments/:id/delete', authMiddleware, handleDeleteTournament);

app.post('/api/tournaments/:id/join', authMiddleware, rateLimit(limiterStrict), async (req, res) => {
  const user = await getUser(req.user.username.toLowerCase());
  if (!user || user.banned) return res.status(403).json({ error: 'Нет доступа' });
  const t = tournaments.find(t => t.id === req.params.id);
  if (!t) return res.status(404).json({ error: 'Не найден' });
  const now = Date.now();
  if (getTournamentStatus(t, now) === 'finished') return res.status(400).json({ error: 'Турнир завершён' });
  if (t.endsAt && t.endsAt < now - 365*24*60*60*1000) return res.status(400).json({ error: 'Этому турниру больше года — запись недоступна' });
  if ((t.blacklist || []).includes(user.username.toLowerCase())) return res.status(403).json({ error: 'Вам закрыт доступ в этот турнир' });
  if (t.clubOnly && t.clubId) {
    const club = clubs.find(c => c.id === t.clubId);
    const inClub = club && (club.members || []).map(m => m.toLowerCase()).includes(user.username.toLowerCase());
    if (!inClub) return res.status(403).json({ error: `Турнир доступен только участникам клуба «${club ? club.name : ''}»` });
  }
  if (t.minRating && user.rating < t.minRating) return res.status(400).json({ error: `Минимальный рейтинг: ${t.minRating}` });
  if (t.maxRating && t.maxRating < 9999 && user.rating > t.maxRating) return res.status(400).json({ error: `Максимальный рейтинг: ${t.maxRating}` });
  if (t.maxParticipants && t.participants.length >= t.maxParticipants) return res.status(400).json({ error: 'Турнир заполнен' });
  const existing = t.participants.find(p => p.username === user.username);
  const isActive = getTournamentStatus(t, now) === 'active';

  // ── Межклубный турнир: обязательный выбор команды ─────────────
  // Играть можно только за клуб, который заявлен в этом турнире И
  // в котором пользователь реально состоит на момент вступления.
  let teamId = null;
  if (t.isInterclub) {
    const requestedTeamId = req.body && req.body.teamId;
    if (!requestedTeamId) return res.status(400).json({ error: 'Выберите команду, за которую хотите играть', needTeamSelection: true, teams: (t.teamIds || []).map(id => clubs.find(c => c.id === id)).filter(Boolean).filter(c => (c.members || []).map(m => m.toLowerCase()).includes(user.username.toLowerCase())).map(c => ({ id: c.id, name: c.name })) });
    if (!(t.teamIds || []).includes(requestedTeamId)) return res.status(400).json({ error: 'Эта команда не участвует в турнире' });
    const team = clubs.find(c => c.id === requestedTeamId);
    if (!team) return res.status(404).json({ error: 'Команда (клуб) не найдена' });
    const inTeam = (team.members || []).map(m => m.toLowerCase()).includes(user.username.toLowerCase());
    if (!inTeam) return res.status(403).json({ error: `Вы не состоите в клубе «${team.name}»` });
    // Если игрок уже сыграл партии за одну команду — не даём переметнуться к другой
    // (иначе можно было бы "сдать" очки не той команде, за которую реально играл).
    if (existing && existing.teamId && existing.gamesPlayed > 0 && existing.teamId !== requestedTeamId) {
      return res.status(400).json({ error: 'Вы уже играли в этом турнире за другую команду и не можете сменить её' });
    }
    teamId = requestedTeamId;
  }

if (existing) {
  if (existing.anticheatBanned) return res.status(403).json({ error: 'Вы заблокированы в этом турнире' });
  if (!existing.left) return res.status(400).json({ error: 'Уже участвуете' });
  existing.left = false;
  existing.paused = false;
  existing.currentGameId = null;
  existing.rating = user.rating;
  existing.waiting = isActive;   // Автоматически встаём в очередь, если турнир уже идёт
  if (t.isInterclub) existing.teamId = teamId;
} else {
  t.participants.push({
    username: user.username, rating: user.rating, score: 0, streak: 0, flame: false,
    berserkCount: 0, gamesPlayed: 0, wins: 0, losses: 0, draws: 0,
    joinedAt: now, lastGameAt: 0, waiting: isActive, currentGameId: null,
    left: false, anticheatBanned: false, _acHighAccGames: 0,
    teamId: teamId,
  });
}

await saveTournament(t);
io.to(`tournament_${t.id}`).emit('tournament_update', sanitizeTournament(t));

// Если турнир активен — сразу пытаемся спарить
if (isActive) {
  tryPairTournamentPlayers(t);
}
  await saveTournament(t);
  io.to(`tournament_${t.id}`).emit('tournament_update', sanitizeTournament(t));
  res.json({ ok: true });
});

app.post('/api/tournaments/:id/leave', authMiddleware, async (req, res) => {
  const t = tournaments.find(t => t.id === req.params.id);
  if (!t) return res.status(404).json({ error: 'Не найден' });
  const p = t.participants.find(p => p.username === req.user.username);
  if (!p) return res.status(400).json({ error: 'Не участвуете' });
  p.waiting = false; p.left = true;
  await saveTournament(t);
  io.to(`tournament_${t.id}`).emit('tournament_update', sanitizeTournament(t));
  res.json({ ok: true });
});

// ── Партии конкретного турнира (для просмотра/проверки) ───────
app.get('/api/tournaments/:id/games', async (req, res) => {
  const t = tournaments.find(t => t.id === req.params.id);
  if (!t) return res.status(404).json({ error: 'Не найден' });
  const games = (t.games || []).map(g => ({
    id: g.id, white: g.white, black: g.black, result: g.result,
    reason: g.reason, timeControl: g.timeControl, endedAt: g.endedAt,
    anticheatBanned: !!g.anticheatBanned,
  }));
  res.json(games);
});

// ── Ручной античит-бан от администратора ─────────────────────
app.post('/api/tournaments/:id/anticheat-ban', authMiddleware, async (req, res) => {
  await requireTournamentManager(req, res, async (t) => {
    const { username } = req.body;
    if (!username) return res.status(400).json({ error: 'Укажите username' });
    const p = t.participants.find(p => p.username.toLowerCase() === username.toLowerCase());
    if (!p) return res.status(404).json({ error: 'Участник не найден' });
    if (p.anticheatBanned) return res.status(400).json({ error: 'Уже забанен' });

    // Принудительно завершаем текущую игру если есть
    if (p.currentGameId) {
      const game = tournamentGames.get(p.currentGameId) || activeGames.get(p.currentGameId);
      if (game) {
        const oppColor = game.white === p.username ? 'black' : 'white';
        const oppName = oppColor === 'white' ? game.white : game.black;
        const payload = { gameId: p.currentGameId, result: oppColor, reason: 'anticheat_admin' };
        const ws = findSocketByUsername(game.white);
        const bs = findSocketByUsername(game.black);
        if (ws) ws.emit('game_ended', payload);
        if (bs) bs.emit('game_ended', payload);
        await finishTournamentGame(t, game, oppColor, 'anticheat_admin');
        tournamentGames.delete(p.currentGameId);
        activeGames.delete(p.currentGameId);
      }
    }

    anticheatBan(t, p.username);
    await saveTournament(t);
    io.to(`tournament_${t.id}`).emit('tournament_update', sanitizeTournament(t));
    io.to(`tournament_${t.id}`).emit('anticheat_ban', {
      username: p.username, tournamentId: t.id, tournamentName: t.name,
      message: `⚠️ ${p.username} забанен администратором за использование читов.`,
    });
    res.json({ ok: true, username: p.username });
  });
});

app.post('/api/tournaments/:id/blacklist', authMiddleware, async (req, res) => {
  await requireTournamentManager(req, res, async (t) => {
    const { username } = req.body;
    if (!username) return res.status(400).json({ error: 'Укажите username' });
    if (!t.blacklist) t.blacklist = [];
    const uLow = username.toLowerCase();
    if (!t.blacklist.includes(uLow)) t.blacklist.push(uLow);
    const p = t.participants.find(p => p.username.toLowerCase() === uLow);
    if (p) { p.left = true; p.waiting = false; }
    await saveTournament(t);
    io.to(`tournament_${t.id}`).emit('tournament_update', sanitizeTournament(t));
    res.json({ ok: true, blacklist: t.blacklist });
  });
});

async function handleUnblacklistTournament(req, res) {
  await requireTournamentManager(req, res, async (t) => {
    t.blacklist = (t.blacklist || []).filter(u => u !== req.params.username.toLowerCase());
    await saveTournament(t);
    res.json({ ok: true, blacklist: t.blacklist });
  });
}
app.delete('/api/tournaments/:id/blacklist/:username', authMiddleware, handleUnblacklistTournament);
app.post('/api/tournaments/:id/blacklist/:username/delete', authMiddleware, handleUnblacklistTournament);

// ── Tournament Chat API ────────────────────────────────────────
app.get('/api/tournaments/:id/chat', authMiddleware, async (req, res) => {
  const t = tournaments.find(t => t.id === req.params.id);
  if (!t) return res.status(404).json({ error: 'Турнир не найден' });
  const me = await getUser(req.user.username.toLowerCase());
  if (!me) return res.status(401).json({ error: 'Нет доступа' });

  const now = Date.now();
  const msgs = getTournamentChat(t.id);
  const mutes = getTournamentChatMutes(t.id);
  const myMuteRaw = mutes.get(me.username.toLowerCase());
  const myMute = (myMuteRaw && myMuteRaw.until > now) ? myMuteRaw : null;

  res.json({
    messages: msgs.slice(-TOURNAMENT_CHAT_MAX),
    open: isTournamentChatOpen(t, now),
    myMute,
    canModerate: canModerateTournamentChat(me, t),
  });
});

app.post('/api/tournaments/:id/chat', authMiddleware, rateLimit(limiterStrict), async (req, res) => {
  const t = tournaments.find(t => t.id === req.params.id);
  if (!t) return res.status(404).json({ error: 'Турнир не найден' });
  const me = await getUser(req.user.username.toLowerCase());
  if (!me) return res.status(401).json({ error: 'Нет доступа' });
  if (me.banned) return res.status(403).json({ error: 'Ваш аккаунт заблокирован' });

  const now = Date.now();
  if (!isTournamentChatOpen(t, now)) {
    return res.status(403).json({ error: 'Чат турнира закрыт для сообщений — доступно только чтение' });
  }

  const mutes = getTournamentChatMutes(t.id);
  const myMute = mutes.get(me.username.toLowerCase());
  if (myMute) {
    if (myMute.until > now) return res.status(403).json({ error: 'Вы замучены в чате этого турнира', until: myMute.until });
    mutes.delete(me.username.toLowerCase());
  }

  const text = (req.body.message || '').toString().trim().slice(0, 300);
  if (!text) return res.status(400).json({ error: 'Пустое сообщение' });

  const msg = { id: uuidv4(), username: me.username, role: me.role || 'user', message: text, timestamp: now };
  const chat = getTournamentChat(t.id);
  chat.push(msg);
  if (chat.length > TOURNAMENT_CHAT_MAX) chat.shift();
  saveTournamentChatMsg(t.id, msg);
  io.to(`tournament_${t.id}`).emit('tournament_chat_msg', { tournamentId: t.id, msg });
  res.json({ ok: true, msg });
});

app.post('/api/tournaments/:id/chat-mute', authMiddleware, async (req, res) => {
  const t = tournaments.find(t => t.id === req.params.id);
  if (!t) return res.status(404).json({ error: 'Турнир не найден' });
  const me = await getUser(req.user.username.toLowerCase());
  if (!me) return res.status(401).json({ error: 'Нет доступа' });
  if (!canModerateTournamentChat(me, t)) return res.status(403).json({ error: 'Нет прав' });

  const { username, minutes } = req.body;
  if (!username) return res.status(400).json({ error: 'Укажите username' });
  const target = username.toLowerCase();

  if (isSiteAdmin(target) && me.role !== 'admin') return res.status(403).json({ error: 'Нельзя замутить администратора' });
  if (t.createdBy && target === t.createdBy.toLowerCase() && me.role !== 'admin' && me.username.toLowerCase() !== target) {
    return res.status(403).json({ error: 'Нельзя замутить создателя турнира' });
  }

  const dur = Math.min(Math.max(parseInt(minutes) || 15, 1), 24 * 60); // от 1 минуты до 24 часов
  const until = Date.now() + dur * 60 * 1000;
  getTournamentChatMutes(t.id).set(target, { until });

  const mutedIds = await wipeTournamentChatMsgsByUser(t.id, target);

  const sysMsg = { id: uuidv4(), username: 'system', role: 'system', message: `🔇 ${username} замучен в чате турнира на ${dur} мин.`, timestamp: Date.now(), system: true };
  const chat = getTournamentChat(t.id);
  chat.push(sysMsg);
  if (chat.length > TOURNAMENT_CHAT_MAX) chat.shift();
  saveTournamentChatMsg(t.id, sysMsg);

  io.to(`tournament_${t.id}`).emit('tournament_chat_user_muted', { tournamentId: t.id, username, until, mutedIds, sysMsg });
  res.json({ ok: true, until });
});

app.post('/api/tournaments/:id/chat-unmute', authMiddleware, async (req, res) => {
  const t = tournaments.find(t => t.id === req.params.id);
  if (!t) return res.status(404).json({ error: 'Турнир не найден' });
  const me = await getUser(req.user.username.toLowerCase());
  if (!me) return res.status(401).json({ error: 'Нет доступа' });
  if (!canModerateTournamentChat(me, t)) return res.status(403).json({ error: 'Нет прав' });

  const { username } = req.body;
  if (!username) return res.status(400).json({ error: 'Укажите username' });
  getTournamentChatMutes(t.id).delete(username.toLowerCase());
  io.to(`tournament_${t.id}`).emit('tournament_chat_user_unmuted', { tournamentId: t.id, username });
  res.json({ ok: true });
});

// ── DM: Личные Сообщения ──────────────────────────────────────
function dmRoomKey(a, b) { return [a.toLowerCase(), b.toLowerCase()].sort().join('::'); }

app.get('/api/dm/conversations', authMiddleware, async (req, res) => {
  const me = req.user.username.toLowerCase();

  const msgs = await db('SELECT id, from_user, to_user, text, ts FROM dm_messages WHERE from_user ILIKE $1 OR to_user ILIKE $1 ORDER BY ts DESC LIMIT 500', [me]);
  const convMap = new Map();
  for (const m of msgs.rows) {
    const partner = m.from_user.toLowerCase() === me ? m.to_user : m.from_user;
    const key = dmRoomKey(me, partner.toLowerCase());
    if (!convMap.has(key)) convMap.set(key, { partner, lastMsg: m.text, lastTs: m.ts });
  }

  const unreadRows = await db("SELECT from_user, COUNT(*) as cnt FROM dm_messages WHERE to_user ILIKE $1 AND read = false GROUP BY from_user", [me]);
  const unreadMap = new Map(unreadRows.rows.map(r => [r.from_user.toLowerCase(), Number(r.cnt)]));

  const blockedRows = await db('SELECT blocked FROM dm_blocks WHERE blocker ILIKE $1', [me]);
  const blockedSet = new Set(blockedRows.rows.map(r => r.blocked.toLowerCase()));

  const convsBase = Array.from(convMap.values())
    .map(c => ({ ...c, unread: unreadMap.get(c.partner.toLowerCase()) || 0, blocked: blockedSet.has(c.partner.toLowerCase()) }));
  // getUser() бьёт в кэш, если собеседник уже когда-то загружался — реального похода в БД
  // почти никогда не будет; нужен только чтобы узнать текущий (живой) статус VIP.
  const convs = (await Promise.all(convsBase.map(async c => ({ ...c, vip: isVip(await getUser(c.partner.toLowerCase())) }))))
    .sort((a, b) => new Date(b.lastTs) - new Date(a.lastTs));

  res.json(convs);
});

app.get('/api/dm/messages/:partner', authMiddleware, async (req, res) => {
  const me = req.user.username.toLowerCase();
  const partner = req.params.partner.toLowerCase();
  if (me === partner) return res.status(400).json({ error: 'Нельзя переписываться с собой' });
  const since = req.query.since ? new Date(req.query.since) : null;
  const r = since
    ? await db("SELECT * FROM dm_messages WHERE ((from_user ILIKE $1 AND to_user ILIKE $2) OR (from_user ILIKE $2 AND to_user ILIKE $1)) AND ts > $3 ORDER BY ts ASC LIMIT 100", [me, partner, since.toISOString()])
    : await db("SELECT * FROM (SELECT * FROM dm_messages WHERE ((from_user ILIKE $1 AND to_user ILIKE $2) OR (from_user ILIKE $2 AND to_user ILIKE $1)) ORDER BY ts DESC LIMIT 100) sub ORDER BY ts ASC", [me, partner]);
  const msgs = r.rows.map(m => ({ id: m.id, from: m.from_user, to: m.to_user, text: m.text, ts: m.ts, read: m.read }));
  const blockedByMe      = await db('SELECT 1 FROM dm_blocks WHERE blocker ILIKE $1 AND blocked ILIKE $2', [me, partner]);
  const blockedByPartner = await db('SELECT 1 FROM dm_blocks WHERE blocker ILIKE $1 AND blocked ILIKE $2', [partner, me]);
  const partnerVip = isVip(await getUser(partner));
  res.json({ messages: msgs, blocked: blockedByMe.rows.length > 0, blockedByPartner: blockedByPartner.rows.length > 0, partnerVip });
});

app.post('/api/dm/send', authMiddleware, rateLimit(limiterStrict), async (req, res) => {
  const me = req.user.username;
  const meUser = await getUser(me.toLowerCase());
  if (!meUser || meUser.banned) return res.status(403).json({ error: 'Ваш аккаунт заблокирован' });
  const { to, text } = req.body;
  if (!to || !text || !text.trim()) return res.status(400).json({ error: 'Укажите получателя и текст' });
  if (to.toLowerCase() === me.toLowerCase()) return res.status(400).json({ error: 'Нельзя писать самому себе' });
  if (isSystemSender(to)) return res.status(403).json({ error: 'Этому аккаунту нельзя написать' });
  if (text.length > 500) return res.status(400).json({ error: 'Максимум 500 символов' });
  const toUser = await getUser(to.toLowerCase());
  if (!toUser) return res.status(404).json({ error: 'Пользователь не найден' });
  const blocked = await db('SELECT 1 FROM dm_blocks WHERE (blocker ILIKE $1 AND blocked ILIKE $2) OR (blocker ILIKE $2 AND blocked ILIKE $1)', [me, to]);
  if (blocked.rows.length > 0) return res.status(403).json({ error: 'Переписка заблокирована' });
  const msg = { id: uuidv4(), from: me, to, text: text.trim(), ts: new Date().toISOString(), read: false };
  await db('INSERT INTO dm_messages (id, from_user, to_user, text, ts, read) VALUES ($1,$2,$3,$4,$5,$6)', [msg.id, msg.from, msg.to, msg.text, msg.ts, msg.read]);
  const recipientSocket = findSocketByUsername(to);
  if (recipientSocket) recipientSocket.emit('dm_message', msg);
  const senderSocket = findSocketByUsername(me);
  if (senderSocket) senderSocket.emit('dm_message', msg);
  res.json(msg);
});

app.post('/api/dm/read', authMiddleware, async (req, res) => {
  const me = req.user.username.toLowerCase();
  const partner = (req.body.partner || '').toLowerCase();
  if (!partner) return res.status(400).json({ error: 'Укажите partner' });
  await db("UPDATE dm_messages SET read = true WHERE to_user ILIKE $1 AND from_user ILIKE $2 AND read = false", [me, partner]);
  const partnerSocket = findSocketByUsername(req.body.partner);
  if (partnerSocket) partnerSocket.emit('dm_read', { by: req.user.username });
  res.json({ ok: true });
});

app.post('/api/dm/block', authMiddleware, async (req, res) => {
  const me = req.user.username;
  const { username } = req.body;
  if (!username || username.toLowerCase() === me.toLowerCase()) return res.status(400).json({ error: 'Неверный запрос' });
  await db('INSERT INTO dm_blocks (blocker, blocked, ts) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING', [me, username, new Date().toISOString()]);
  res.json({ ok: true });
});

app.post('/api/dm/unblock', authMiddleware, async (req, res) => {
  const me = req.user.username;
  const { username } = req.body;
  if (!username) return res.status(400).json({ error: 'Укажите username' });
  await db('DELETE FROM dm_blocks WHERE blocker ILIKE $1 AND blocked ILIKE $2', [me, username]);
  res.json({ ok: true });
});

// ── Системные сообщения: админ → одному пользователю или всем ──
// Приходят как обычные ЛС от имени SYSTEM_SENDER, но получатель не
// может на них ответить (фронтенд прячет поле ввода для этого
// отправителя, а /api/dm/send выше отдельно блокирует запись ЕМУ).
app.post('/api/admin/system-message', authMiddleware, rateLimit(limiterStrict), async (req, res) => {
  await requireAdmin(req, res, async () => {
    const text = (req.body.text || '').trim();
    const to   = (req.body.to || '').trim();
    if (!text) return res.status(400).json({ error: 'Введите текст сообщения' });
    if (text.length > 2000) return res.status(400).json({ error: 'Максимум 2000 символов' });
    if (!to) return res.status(400).json({ error: 'Укажите получателя' });

    const client = await pool.connect();
    try {
      let recipients;
      if (to.toLowerCase() === 'all') {
        const r = await client.query('SELECT username FROM users');
        recipients = r.rows.map(row => row.username).filter(u => !isSystemSender(u));
      } else {
        const targetUser = await getUser(to.toLowerCase());
        if (!targetUser) return res.status(404).json({ error: 'Пользователь не найден' });
        if (isSystemSender(targetUser.username)) return res.status(400).json({ error: 'Неверный получатель' });
        recipients = [targetUser.username];
      }
      if (!recipients.length) return res.status(400).json({ error: 'Нет получателей' });

      const now = new Date().toISOString();
      await client.query('BEGIN');
      for (const username of recipients) {
        const msg = { id: uuidv4(), from: SYSTEM_SENDER, to: username, text, ts: now, read: false };
        await client.query('INSERT INTO dm_messages (id, from_user, to_user, text, ts, read) VALUES ($1,$2,$3,$4,$5,$6)', [msg.id, msg.from, msg.to, msg.text, msg.ts, msg.read]);
        const sock = findSocketByUsername(username);
        if (sock) sock.emit('dm_message', msg);
      }
      await client.query('COMMIT');
      await logAdminAction(req.user.username, 'system_message', to.toLowerCase() === 'all' ? 'all' : recipients[0], { to: to.toLowerCase() === 'all' ? 'all' : recipients[0], count: recipients.length, text: text.slice(0, 200) });
      res.json({ ok: true, count: recipients.length });
    } catch (e) {
      await client.query('ROLLBACK').catch(() => {});
      console.error('[SystemMessage]', e);
      if (!res.headersSent) res.status(500).json({ error: 'Ошибка отправки: ' + e.message });
    } finally {
      client.release();
    }
  });
});

// ── Админ: просмотр переписок пользователя ──────────────────────
// Доступ только через requireAdmin (роль admin). Каждый просмотр
// пишется в admin_dm_audit (кто из админов, чью переписку и когда
// смотрел) — это не ограничивает доступ, но даёт возможность потом
// расследовать злоупотребления и отвечает перед пользователями за
// то, что доступ к их ЛС отслеживается.
async function logDmAudit(admin, target, partner, action) {
  try {
    await db('INSERT INTO admin_dm_audit (id, admin, target, partner, action, created_at) VALUES ($1,$2,$3,$4,$5,$6)',
      [uuidv4(), admin, target, partner, action, Date.now()]);
  } catch (e) { console.error('[DM Audit]', e.message); }
}

// Общий лог действий админов — вызывается из всех модерационных
// эндпоинтов ниже (бан, IP-бан, VIP, задачи, чат, жалобы, обращения,
// системные сообщения и т.п.). details — произвольный объект,
// сохраняется как JSON-строка.
async function logAdminAction(admin, action, target, details) {
  try {
    await db('INSERT INTO admin_action_log (id, admin, action, target, details, created_at) VALUES ($1,$2,$3,$4,$5,$6)',
      [uuidv4(), admin, action, target || null, details ? JSON.stringify(details) : null, Date.now()]);
  } catch (e) { console.error('[AdminLog]', e.message); }
}

app.get('/api/admin/dm/conversations/:username', authMiddleware, async (req, res) => {
  await requireAdmin(req, res, async () => {
    const target = req.params.username.toLowerCase();
    const targetUser = await getUser(target);
    if (!targetUser) return res.status(404).json({ error: 'Пользователь не найден' });

    const msgs = await db('SELECT from_user, to_user, text, ts FROM dm_messages WHERE from_user ILIKE $1 OR to_user ILIKE $1 ORDER BY ts DESC LIMIT 1000', [target]);
    const convMap = new Map();
    for (const m of msgs.rows) {
      const partner = m.from_user.toLowerCase() === target ? m.to_user : m.from_user;
      const key = partner.toLowerCase();
      if (!convMap.has(key)) convMap.set(key, { partner, lastMsg: m.text, lastTs: m.ts });
    }
    const convs = Array.from(convMap.values()).sort((a, b) => new Date(b.lastTs) - new Date(a.lastTs));

    await logDmAudit(req.user.username, targetUser.username, null, 'list_conversations');
    res.json({ user: sanitizeUser(targetUser), conversations: convs });
  });
});

app.get('/api/admin/dm/messages/:username/:partner', authMiddleware, async (req, res) => {
  await requireAdmin(req, res, async () => {
    const target  = req.params.username.toLowerCase();
    const partner = req.params.partner.toLowerCase();
    const targetUser  = await getUser(target);
    const partnerUser = await getUser(partner);
    if (!targetUser || !partnerUser) return res.status(404).json({ error: 'Пользователь не найден' });

    const r = await db(
      "SELECT * FROM (SELECT * FROM dm_messages WHERE (from_user ILIKE $1 AND to_user ILIKE $2) OR (from_user ILIKE $2 AND to_user ILIKE $1) ORDER BY ts DESC LIMIT 1000) sub ORDER BY ts ASC",
      [target, partner]
    );
    const messages = r.rows.map(m => ({ id: m.id, from: m.from_user, to: m.to_user, text: m.text, ts: m.ts, read: m.read }));

    await logDmAudit(req.user.username, targetUser.username, partnerUser.username, 'view_thread');
    res.json({ messages });
  });
});

// Аудит-лог просмотров переписок — кто из админов и когда смотрел
// чьи ЛС. Помогает расследовать злоупотребление доступом.
app.get('/api/admin/dm/audit', authMiddleware, async (req, res) => {
  await requireAdmin(req, res, async () => {
    const target = (req.query.target || '').toLowerCase();
    const r = target
      ? await db('SELECT * FROM admin_dm_audit WHERE target ILIKE $1 ORDER BY created_at DESC LIMIT 200', [target])
      : await db('SELECT * FROM admin_dm_audit ORDER BY created_at DESC LIMIT 200');
    res.json(r.rows.map(a => ({ admin: a.admin, target: a.target, partner: a.partner, action: a.action, createdAt: Number(a.created_at) })));
  });
});

// ── Общий лог действий админов ──────────────────────────────────
// Читает admin_action_log, заполняемый logAdminAction() из всех
// модерационных эндпоинтов (бан/разбан, IP-баны, VIP, чат, задачи,
// жалобы, обращения, системные сообщения). Только для чтения.
app.get('/api/admin/logs', authMiddleware, async (req, res) => {
  await requireAdmin(req, res, async () => {
    const { admin, action, target } = req.query;
    const conds = [];
    const params = [];
    if (admin)  { params.push(admin.toLowerCase());  conds.push(`LOWER(admin) = $${params.length}`); }
    if (action) { params.push(action);                conds.push(`action = $${params.length}`); }
    if (target) { params.push('%' + target.toLowerCase() + '%'); conds.push(`LOWER(target) LIKE $${params.length}`); }
    const where = conds.length ? 'WHERE ' + conds.join(' AND ') : '';
    const r = await db(`SELECT * FROM admin_action_log ${where} ORDER BY created_at DESC LIMIT 300`, params);
    res.json(r.rows.map(row => ({
      admin: row.admin, action: row.action, target: row.target,
      details: row.details ? JSON.parse(row.details) : null,
      createdAt: Number(row.created_at),
    })));
  });
});

// ── Подозрения на мультиаккаунты ────────────────────────────────
// Только показывает: группирует существующих пользователей по
// created_from_ip и created_device_id и возвращает группы из 2+
// аккаунтов как "подозрительные". НИКОГО НЕ БАНИТ — исключительно
// информация для ручного решения администратора (см. requireAdmin).
app.get('/api/admin/multiaccounts', authMiddleware, async (req, res) => {
  await requireAdmin(req, res, async () => {
    const r = await db('SELECT username, role, banned, ban_reason, created_from_ip, created_device_id, created_at, rating FROM users ORDER BY created_at ASC');

    const byIP = new Map();
    const byDevice = new Map();
    for (const row of r.rows) {
      const u = {
        username: row.username, role: row.role, banned: row.banned,
        banReason: row.ban_reason, createdAt: Number(row.created_at), rating: row.rating,
      };
      const ip = row.created_from_ip;
      if (ip && !isLocalIP(ip)) {
        if (!byIP.has(ip)) byIP.set(ip, []);
        byIP.get(ip).push(u);
      }
      const dev = row.created_device_id;
      if (dev) {
        if (!byDevice.has(dev)) byDevice.set(dev, []);
        byDevice.get(dev).push(u);
      }
    }

    const ipGroups = [...byIP.entries()]
      .filter(([, users]) => users.length > 1)
      .map(([ip, users]) => ({ ip, users }))
      .sort((a, b) => b.users.length - a.users.length);

    const deviceGroups = [...byDevice.entries()]
      .filter(([, users]) => users.length > 1)
      .map(([deviceId, users]) => ({ deviceId, users }))
      .sort((a, b) => b.users.length - a.users.length);

    res.json({ ipGroups, deviceGroups });
  });
});

// ── Дашборд администратора ──────────────────────────────────────
// Сводка для главного экрана админки: онлайн, регистрации/партии по
// дням, баны, открытые жалобы/обращения. Отдельно от публичного
// /api/stats, т.к. включает чувствительные для админов цифры (баны,
// открытые обращения) и более короткое окно (14 дней) для графиков.
app.get('/api/admin/dashboard', authMiddleware, async (req, res) => {
  await requireAdmin(req, res, async () => {
    try {
      const [
        totalUsers, bannedUsersCnt, newUsersToday, totalGames, gamesToday,
        openReports, openAppeals, regByDay, gamesByDay,
      ] = await Promise.all([
        db('SELECT COUNT(*) FROM users'),
        db('SELECT COUNT(*) FROM users WHERE banned = true'),
        db(`SELECT COUNT(*) FROM users WHERE created_at >= extract(epoch from date_trunc('day', now()))*1000`),
        db('SELECT COUNT(*) FROM games'),
        db(`SELECT COUNT(*) FROM games WHERE ended_at >= extract(epoch from date_trunc('day', now()))*1000`),
        db(`SELECT COUNT(*) FROM reports WHERE status = 'new'`),
        db(`SELECT COUNT(*) FROM appeals WHERE status = 'open'`),
        db(`SELECT DATE(to_timestamp(created_at/1000)) as day, COUNT(*) as cnt FROM users WHERE created_at > extract(epoch from now()-interval '14 days')*1000 GROUP BY day ORDER BY day ASC`),
        db(`SELECT DATE(to_timestamp(ended_at/1000)) as day, COUNT(*) as cnt FROM games WHERE ended_at > extract(epoch from now()-interval '14 days')*1000 GROUP BY day ORDER BY day ASC`),
      ]);

      res.json({
        online: onlineUsers.size,
        workers: [...workers.values()].map(w => ({
          threads: w.threads, busy: w.busy, lastSeen: w.lastSeen,
        })),
        totals: {
          users: parseInt(totalUsers.rows[0].count),
          bannedUsers: parseInt(bannedUsersCnt.rows[0].count),
          newUsersToday: parseInt(newUsersToday.rows[0].count),
          games: parseInt(totalGames.rows[0].count),
          gamesToday: parseInt(gamesToday.rows[0].count),
          bannedIPs: bannedIPs.size,
          bannedDevices: bannedDevices.size,
          openReports: parseInt(openReports.rows[0].count),
          openAppeals: parseInt(openAppeals.rows[0].count),
        },
        charts: { regByDay: regByDay.rows, gamesByDay: gamesByDay.rows },
      });
    } catch (e) {
      console.error('[AdminDashboard]', e.message);
      res.status(500).json({ error: 'Ошибка загрузки дашборда' });
    }
  });
});

// ── Forum API ─────────────────────────────────────────────────
function countTodayByUser(arr, username) {
  const midnight = new Date(); midnight.setHours(0,0,0,0);
  return arr.filter(x => x.author === username && x.createdAt >= midnight.getTime()).length;
}
function makeSlug(title, id) {
  const s = title.toLowerCase()
    .replace(/[а-яё]/g, c => ({а:'a',б:'b',в:'v',г:'g',д:'d',е:'e',ё:'yo',ж:'zh',з:'z',и:'i',й:'j',к:'k',л:'l',м:'m',н:'n',о:'o',п:'p',р:'r',с:'s',т:'t',у:'u',ф:'f',х:'kh',ц:'ts',ч:'ch',ш:'sh',щ:'shch',ъ:'',ы:'y',ь:'',э:'e',ю:'yu',я:'ya'}[c]||''))
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'topic';
  return s + '-' + id.slice(0, 6);
}

const forumViewSessions = new Map();

app.get('/api/forum/threads', (req, res) => {
  const page  = Math.max(0, parseInt(req.query.page) || 0);
  const limit = Math.min(50, parseInt(req.query.limit) || 20);
  const sorted = [...forumThreads].sort((a, b) => b.lastActivityAt - a.lastActivityAt);
  res.json({ threads: sorted.slice(page * limit, page * limit + limit), total: sorted.length, page, limit });
});
app.get('/api/forum/threads/:slug', (req, res) => {
  const thread = forumThreads.find(t => t.slug === req.params.slug || t.id === req.params.slug);
  if (!thread) return res.status(404).json({ error: 'Тема не найдена' });

  const replyPage = Math.max(1, parseInt(req.query.replyPage) || 1);
  const replyLimit = Math.min(100, parseInt(req.query.replyLimit) || 50);
  const start = (replyPage - 1) * replyLimit;
  const end = start + replyLimit;

  let allReplies = forumReplies.filter(r => r.threadId === thread.id).sort((a, b) => a.createdAt - b.createdAt);
  const totalReplies = allReplies.length;
  const replies = allReplies.slice(start, end);

  let viewerKey;
  const authTok945 = getAuthToken(req);
  if (authTok945) {
    try { const p = jwt.verify(authTok945, JWT_SECRET); viewerKey = 'u:' + p.username.toLowerCase(); }
    catch { viewerKey = 'ip:' + getIP(req); }
  } else { viewerKey = 'ip:' + getIP(req); }
  if (!forumViewSessions.has(thread.id)) forumViewSessions.set(thread.id, new Set());
  const viewers = forumViewSessions.get(thread.id);
  if (!viewers.has(viewerKey)) { viewers.add(viewerKey); thread.views++; saveForumThread(thread).catch(() => {}); }

  res.json({
    thread,
    replies,
    replyMeta: {
      page: replyPage,
      limit: replyLimit,
      total: totalReplies,
      totalPages: Math.ceil(totalReplies / replyLimit)
    }
  });
});

app.delete('/api/forum/threads/:id', authMiddleware, async (req, res) => {
  const user = await getUser(req.user.username.toLowerCase());
  if (!user) return res.status(401).json({ error: 'Не авторизован' });
  const idx = forumThreads.findIndex(t => t.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Не найдено' });
  const thread = forumThreads[idx];
  if (user.role !== 'admin' && thread.author !== user.username) return res.status(403).json({ error: 'Нет прав' });
  forumThreads.splice(idx, 1);
  forumReplies.splice(0, forumReplies.length, ...forumReplies.filter(r => r.threadId !== thread.id));
  await deleteForumThread(thread.id);
  res.json({ ok: true });
});

app.get('/api/forum/threads/:slug/search', (req, res) => {
  const thread = forumThreads.find(t => t.slug === req.params.slug || t.id === req.params.slug);
  if (!thread) return res.status(404).json({ error: 'Тема не найдена' });
  const q = (req.query.q || '').trim().toLowerCase();
  if (!q) return res.json({ results: [] });
  const allReplies = forumReplies.filter(r => r.threadId === thread.id).sort((a, b) => a.createdAt - b.createdAt);
  const repliesPerPage = 50;
  const results = [];
  allReplies.forEach((reply, idx) => {
    if (reply.body.toLowerCase().includes(q)) {
      const page = Math.floor(idx / repliesPerPage) + 1;
      results.push({ reply, page });
    }
  });
  res.json({ results: results.map(r => ({
    id: r.reply.id,
    author: r.reply.author,
    body: r.reply.body.slice(0, 200) + (r.reply.body.length > 200 ? '…' : ''),
    createdAt: r.reply.createdAt,
    page: r.page
  })) });
});

app.post('/api/forum/threads/:id/replies', authMiddleware, rateLimit(limiterStrict), async (req, res) => {
  const user = await getUser(req.user.username.toLowerCase());
  if (!user || user.banned) return res.status(403).json({ error: 'Аккаунт заблокирован' });
  const thread = forumThreads.find(t => t.id === req.params.id);
  if (!thread) return res.status(404).json({ error: 'Тема не найдена' });
  const { body } = req.body;
  if (!body || body.trim().length < 2)  return res.status(400).json({ error: 'Ответ слишком короткий' });
  if (body.trim().length > 5000)        return res.status(400).json({ error: 'Ответ слишком длинный (макс. 5 000 символов)' });
  if (countTodayByUser(forumReplies, user.username) >= 10)
    return res.status(429).json({ error: 'Вы уже написали 10 ответов сегодня. Лимит сбросится в полночь.' });
  const now = Date.now();
  const reply = { id: uuidv4(), threadId: thread.id, author: user.username, authorId: user.id, body: body.trim(), createdAt: now };
  forumReplies.push(reply);
  thread.replyCount = (thread.replyCount || 0) + 1;
  thread.lastActivityAt = now;
  await saveForumThread(thread);
  await saveForumReply(reply);
  res.json({ ok: true, reply });
});

app.delete('/api/forum/replies/:id', authMiddleware, async (req, res) => {
  const user = await getUser(req.user.username.toLowerCase());
  if (!user) return res.status(401).json({ error: 'Не авторизован' });
  const idx = forumReplies.findIndex(r => r.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Не найдено' });
  const reply = forumReplies[idx];
  if (user.role !== 'admin' && reply.author !== user.username) return res.status(403).json({ error: 'Нет прав' });
  const thread = forumThreads.find(t => t.id === reply.threadId);
  if (thread) { thread.replyCount = Math.max(0, (thread.replyCount || 1) - 1); await saveForumThread(thread); }
  forumReplies.splice(idx, 1);
  await deleteForumReply(reply.id);
  res.json({ ok: true });
});

app.post('/api/forum/threads', authMiddleware, rateLimit(limiterStrict), async (req, res) => {
  const user = await getUser(req.user.username.toLowerCase());
  if (!user || user.banned) return res.status(403).json({ error: 'Аккаунт заблокирован' });

  const { title, body } = req.body;
  if (!title || !title.trim()) return res.status(400).json({ error: 'Укажите заголовок' });
  if (!body || !body.trim()) return res.status(400).json({ error: 'Укажите текст' });
  if (title.length > 120) return res.status(400).json({ error: 'Заголовок слишком длинный (макс 120)' });
  if (body.length > 10000) return res.status(400).json({ error: 'Текст слишком длинный (макс 10 000)' });

  // Ограничение: не более 3 тем в сутки
  const dayStart = new Date();
  dayStart.setHours(0, 0, 0, 0);
  const todayCount = forumThreads.filter(t =>
    t.author.toLowerCase() === user.username.toLowerCase() &&
    t.createdAt >= dayStart.getTime()
  ).length;
  if (todayCount >= 3) {
    return res.status(429).json({ error: 'Вы уже создали 3 темы сегодня. Лимит сбросится в полночь.' });
  }

  const id = uuidv4();
  const slug = makeSlug(title, id);
  const now = Date.now();
  const thread = {
    id,
    slug,
    author: user.username,
    authorId: user.id,
    title: title.trim(),
    body: body.trim(),
    createdAt: now,
    lastActivityAt: now,
    replyCount: 0,
    views: 0
  };

  forumThreads.unshift(thread);
  await saveForumThread(thread);
  res.json({ ok: true, thread: { id: thread.id, slug: thread.slug, title: thread.title } });
});

// ── FOLLOWS (подписки) API ───────────────────────────────────
app.post('/api/follow/:username', authMiddleware, async (req, res) => {
  try {
    const target = await getUser(req.params.username.toLowerCase());
    if (!target) return res.status(404).json({ error: 'Пользователь не найден' });
    const follower = req.user.username;
    const following = target.username; // канонический регистр ника из БД
    if (follower.toLowerCase() === following.toLowerCase()) return res.status(400).json({ error: 'Нельзя подписаться на себя' });
    await db(`INSERT INTO follows (follower, following, created_at) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`, [follower, following, Date.now()]);
    res.json({ ok: true });
  } catch (e) {
    console.error('[Follow]', e);
    res.status(500).json({ error: 'Ошибка подписки' });
  }
});

async function handleUnfollow(req, res) {
  try {
    const target = await getUser(req.params.username.toLowerCase());
    const follower = req.user.username;
    // Используем канонический регистр ника, если он найден в БД — раньше отписка
    // сравнивала строки с учётом регистра, из-за чего при малейшем несовпадении
    // регистра (например, ссылка вела на "Ivan", а подписка была на "ivan")
    // DELETE не находил нужную строку и кнопка "молча" не работала.
    const following = target ? target.username : req.params.username;
    await db(`DELETE FROM follows WHERE follower = $1 AND following = $2`, [follower, following]);
    res.json({ ok: true });
  } catch (e) {
    console.error('[Unfollow]', e);
    res.status(500).json({ error: 'Ошибка отписки' });
  }
}
// DELETE — основной вариант, POST — резервный (на случай, если хостинг/прокси
// блокирует метод DELETE — именно это похоже на причину "кнопка не работает").
app.delete('/api/follow/:username', authMiddleware, handleUnfollow);
app.post('/api/follow/:username/unfollow', authMiddleware, handleUnfollow);

app.get('/api/follow/check/:username', authMiddleware, async (req, res) => {
  try {
    const target = await getUser(req.params.username.toLowerCase());
    const follower = req.user.username;
    const following = target ? target.username : req.params.username;
    const r = await db(`SELECT 1 FROM follows WHERE follower = $1 AND following = $2`, [follower, following]);
    res.json({ following: r.rows.length > 0 });
  } catch (e) {
    console.error('[FollowCheck]', e);
    res.status(500).json({ error: 'Ошибка проверки подписки' });
  }
});

app.get('/api/follow/counts/:username', async (req, res) => {
  const username = req.params.username;
  const followers = await db(`SELECT COUNT(*) FROM follows WHERE following = $1`, [username]);
  const following = await db(`SELECT COUNT(*) FROM follows WHERE follower = $1`, [username]);
  res.json({ followers: parseInt(followers.rows[0].count), following: parseInt(following.rows[0].count) });
});

app.get('/api/follow/followers/:username', async (req, res) => {
  const username = req.params.username;
  const r = await db(`SELECT follower FROM follows WHERE following = $1 ORDER BY created_at DESC`, [username]);
  const users = [];
  for (const row of r.rows) {
    const u = await getUser(row.follower.toLowerCase());
    if (u) users.push({ username: u.username, online: onlineUsers.has(u.username), rating: u.rating });
  }
  res.json(users);
});

app.get('/api/follow/following/:username', async (req, res) => {
  const username = req.params.username;
  const r = await db(`SELECT following FROM follows WHERE follower = $1 ORDER BY created_at DESC`, [username]);
  const users = [];
  for (const row of r.rows) {
    const u = await getUser(row.following.toLowerCase());
    if (u) users.push({ username: u.username, online: onlineUsers.has(u.username), rating: u.rating });
  }
  res.json(users);
});

app.get('/api/follow/online-friends', authMiddleware, async (req, res) => {
  const me = req.user.username;
  const r = await db(`SELECT following FROM follows WHERE follower = $1`, [me]);
  const online = [];
  for (const row of r.rows) {
    const u = await getUser(row.following.toLowerCase());
    if (u && onlineUsers.has(u.username)) {
      online.push({ username: u.username, rating: u.rating });
    }
  }
  res.json(online);
});

// ── Blog API ──────────────────────────────────────────────────
function blogAuthMiddleware(req, res, next) {
  const auth = getAuthToken(req);
  if (!auth) return res.status(401).json({ error: 'Войдите, чтобы выполнить это действие' });
  try { req.blogUser = jwt.verify(auth, JWT_SECRET); next(); }
  catch { return res.status(401).json({ error: 'Неверный токен' }); }
}
function blogAdminMiddleware(req, res, next) {
  const auth = getAuthToken(req);
  if (!auth) return res.status(401).json({ error: 'Не авторизован' });
  try { req.blogUser = jwt.verify(auth, JWT_SECRET); }
  catch { return res.status(401).json({ error: 'Неверный токен' }); }
  if (!isBlogAdmin(req.blogUser.username)) return res.status(403).json({ error: 'Только администратор' });
  next();
}

function isBlogAdmin(username) { return username && ['chesshome','marina64'].includes(username.toLowerCase()); }

// Заголовок и текст статьи блога иногда приезжают в base64 (поле encoding:'b64') —
// так фронтенд обходит ложные срабатывания WAF/ModSecurity на длинном сыром
// markdown-тексте (WAF видит бессмысленный base64 вместо спецсимволов и не блокирует
// запрос). Раскодируем здесь один раз, дальше код работает с обычным текстом как раньше.
function decodeBlogField(value, encoding) {
  if (typeof value !== 'string' || encoding !== 'b64') return value;
  try { return Buffer.from(value, 'base64').toString('utf8'); }
  catch { return value; }
}

function blogSanitize(post, withBody) {
  const o = { id: post.id, title: post.title, author: post.author, status: post.status,
    views: post.views || 0, likes: post.likes || 0,
    community: !!post.community,
    createdAt: post.createdAt, updatedAt: post.updatedAt || null };
  if (withBody) o.body = post.body;
  return o;
}

db(`CREATE TABLE IF NOT EXISTS blog_views (viewer_key TEXT NOT NULL, post_id TEXT NOT NULL, PRIMARY KEY (viewer_key, post_id))`).catch(e => console.error('[Blog] blog_views init:', e.message));
db(`CREATE TABLE IF NOT EXISTS blog_likes (user_id TEXT NOT NULL, post_id TEXT NOT NULL, PRIMARY KEY (user_id, post_id))`).catch(e => console.error('[Blog] blog_likes init:', e.message));
db(`ALTER TABLE blog_posts ADD COLUMN IF NOT EXISTS community BOOLEAN DEFAULT FALSE`).catch(() => {});
db(`CREATE TABLE IF NOT EXISTS blog_comments (id TEXT PRIMARY KEY, post_id TEXT NOT NULL, author TEXT NOT NULL, body TEXT NOT NULL, created_at BIGINT NOT NULL, deleted BOOLEAN NOT NULL DEFAULT FALSE, deleted_by TEXT, edit_count INT NOT NULL DEFAULT 0, edited_at BIGINT)`).catch(e => console.error('[Blog] blog_comments init:', e.message));
db(`ALTER TABLE blog_comments ADD COLUMN IF NOT EXISTS edit_count INT NOT NULL DEFAULT 0`).catch(()=>{});
db(`ALTER TABLE blog_comments ADD COLUMN IF NOT EXISTS edited_at BIGINT`).catch(()=>{});
db(`CREATE INDEX IF NOT EXISTS idx_blog_comments_post ON blog_comments(post_id, created_at ASC)`).catch(() => {});
db(`CREATE TABLE IF NOT EXISTS blog_comment_reactions (comment_id TEXT NOT NULL, user_id TEXT NOT NULL, emoji TEXT NOT NULL, PRIMARY KEY (comment_id, user_id))`).catch(e => console.error('[Blog] blog_comment_reactions init:', e.message));
db(`CREATE TABLE IF NOT EXISTS blog_comment_bans (post_id TEXT NOT NULL, username TEXT NOT NULL, type TEXT NOT NULL DEFAULT 'mute', until BIGINT, created_at BIGINT NOT NULL, PRIMARY KEY (post_id, username))`).catch(e => console.error('[Blog] blog_comment_bans init:', e.message));
db(`CREATE TABLE IF NOT EXISTS blog_global_comment_bans (username TEXT PRIMARY KEY, type TEXT NOT NULL DEFAULT 'mute', until BIGINT, created_at BIGINT NOT NULL)`).catch(e => console.error('[Blog] blog_global_comment_bans init:', e.message));

app.get('/api/blog', (req, res) => {
  const { section, status, page: pQ, limit: lQ } = req.query;
  const page  = Math.max(0, parseInt(pQ) || 0);
  const limit = Math.min(50, parseInt(lQ) || 20);

  let callerUsername = null;
  const auth = getAuthToken(req);
  if (auth) { try { callerUsername = jwt.verify(auth, JWT_SECRET).username.toLowerCase(); } catch {} }

  let list = blogPosts.filter(p => {
    if (p.status === 'hidden') {
      // Список скрытых статей виден только администратору и только
      // когда его явно запросили (вкладка "Скрытые").
      return status === 'hidden' && isBlogAdmin(callerUsername);
    }
    if (status === 'hidden') return false;
    if (p.status !== 'published') {
      if (!callerUsername) return false;
      if (!isBlogAdmin(callerUsername) && p.author.toLowerCase() !== callerUsername) return false;
      return status === 'drafts';
    }
    return status !== 'drafts';
  });

  // Список скрытых статей — это единая модераторская вкладка для админа,
  // не привязанная к разделу (иначе статьи, скрытые из другого раздела,
  // "пропадали бы" из виду). То же самое для черновиков АДМИНА: у него
  // могут быть черновики и в official, и в community (например, только
  // что восстановленная статья), и раздел не должен их прятать.
  // Обычным пользователям раздел для черновиков не мешает — у них черновики
  // всегда только в community.
  const bypassSection = status === 'hidden' || (status === 'drafts' && isBlogAdmin(callerUsername));
  if (!bypassSection) {
    if (section === 'official')  list = list.filter(p => !p.community);
    if (section === 'community') list = list.filter(p => !!p.community);
  }

  if (status === 'drafts' || status === 'hidden') list.sort((a,b) => (b.updatedAt||b.createdAt) - (a.updatedAt||a.createdAt));
  else list.sort((a,b) => ((b.views||0)+(b.likes||0)*3) - ((a.views||0)+(a.likes||0)*3));

  res.json({ posts: list.slice(page*limit, page*limit+limit).map(p => blogSanitize(p,false)), total: list.length });
});

app.get('/api/blog/:id', async (req, res) => {
  const post = blogPosts.find(p => p.id === req.params.id);
  if (!post) return res.status(404).json({ error: 'Статья не найдена' });

  // Прикрытая статья не видна вообще никому (даже автору и админу) —
  // управление такими статьями идёт только через список "Скрытые".
  if (post.status === 'hidden') return res.status(404).json({ error: 'Статья не найдена' });

  if (post.status !== 'published') {
    let callerUsername = null;
    const auth = getAuthToken(req);
    if (auth) { try { callerUsername = jwt.verify(auth, JWT_SECRET).username.toLowerCase(); } catch {} }
    const canSee = callerUsername && (isBlogAdmin(callerUsername) || post.author.toLowerCase() === callerUsername);
    if (!canSee) return res.status(403).json({ error: 'Черновик' });
  }

  const noview = req.query.noview === '1';
  if (!noview && post.status === 'published') {
    let viewerKey = null;
    const authTok = getAuthToken(req);
    if (authTok) { try { viewerKey = 'u:' + jwt.verify(authTok, JWT_SECRET).username.toLowerCase(); } catch {} }
    if (!viewerKey) { const did = req.deviceId; if (did) viewerKey = 'd:' + did; }
    if (viewerKey) {
      try {
        const ins = await db(`INSERT INTO blog_views (viewer_key,post_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [viewerKey, post.id]);
        if (ins.rowCount === 1) {
          post.views = (post.views || 0) + 1;
          if (!post._viewTimer) post._viewTimer = setTimeout(() => { saveBlogPost(post).catch(()=>{}); post._viewTimer=null; }, 5000);
        }
      } catch(e) { console.error('[Blog] view:', e.message); }
    }
  }

  let liked = false;
  const auth = getAuthToken(req);
  if (auth) {
    try {
      const dec = jwt.verify(auth, JWT_SECRET);
      const u = await getUser(dec.username.toLowerCase());
      if (u) { const lr = await db('SELECT 1 FROM blog_likes WHERE user_id=$1 AND post_id=$2',[u.id,post.id]); liked = lr.rows.length>0; }
    } catch {}
  }

  res.json({ ...blogSanitize(post,true), liked });
});

app.post('/api/blog', blogAuthMiddleware, rateLimit(limiterStrict), async (req, res) => {
  let { title, body, status, encoding } = req.body;
  title = decodeBlogField(title, encoding);
  body  = decodeBlogField(body, encoding);
  if (!title || !title.trim()) return res.status(400).json({ error: 'Укажите заголовок' });
  if (!body  || !body.trim())  return res.status(400).json({ error: 'Укажите текст' });
  if (title.length > 200)      return res.status(400).json({ error: 'Заголовок слишком длинный (макс 200)' });
  if (body.length > 100000)    return res.status(400).json({ error: 'Текст слишком длинный (макс 100 000 символов)' });

  const user = await getUser(req.blogUser.username.toLowerCase());
  if (!user) return res.status(404).json({ error: 'Пользователь не найден' });
  if (user.banned) return res.status(403).json({ error: 'Заблокированные пользователи не могут создавать статьи' });

  const isAdmin = isBlogAdmin(user.username);

  if (!isAdmin) {
    const dayStart = new Date(); dayStart.setHours(0,0,0,0);
    const todayCount = blogPosts.filter(p => p.author.toLowerCase() === user.username.toLowerCase() && p.createdAt >= dayStart.getTime()).length;
    if (todayCount >= 1) return res.status(429).json({ error: 'Можно публиковать не более 1 статьи в день. Попробуйте завтра!' });
  }

  const community = !isAdmin;
  const postStatus = ['published','draft'].includes(status) ? status : 'draft';
  const post = { id: uuidv4(), title: title.trim(), body: body.trim(), author: user.username,
    status: postStatus, views: 0, likes: 0, likedBy: [], community, createdAt: Date.now(), updatedAt: null };
  blogPosts.unshift(post);
  await saveBlogPost(post);
  res.json(blogSanitize(post, true));
});

app.patch('/api/blog/:id', blogAuthMiddleware, rateLimit(limiterStrict), async (req, res) => {
  const post = blogPosts.find(p => p.id === req.params.id);
  if (!post) return res.status(404).json({ error: 'Статья не найдена' });
  const caller = req.blogUser.username;
  if (!isBlogAdmin(caller) && post.author.toLowerCase() !== caller.toLowerCase())
    return res.status(403).json({ error: 'Нет доступа' });
  let { title, body, status, encoding } = req.body;
  title = decodeBlogField(title, encoding);
  body  = decodeBlogField(body, encoding);
  if (title !== undefined) { if (!title.trim()) return res.status(400).json({ error: 'Заголовок не может быть пустым' }); post.title = title.trim().slice(0,200); }
  if (body  !== undefined) { if (!body.trim())  return res.status(400).json({ error: 'Текст не может быть пустым' }); post.body = body.trim().slice(0,100000); }
  if (status !== undefined && ['published','draft','hidden'].includes(status)) {
    // Прикрывать статью и возвращать её обратно может только администратор.
    if ((status === 'hidden' || post.status === 'hidden') && !isBlogAdmin(caller))
      return res.status(403).json({ error: 'Скрывать и восстанавливать статьи может только администратор' });
    post.status = status;
  }
  post.updatedAt = Date.now();
  await saveBlogPost(post);
  res.json(blogSanitize(post, true));
});

async function handleDeleteBlogPost(req, res) {
  const idx = blogPosts.findIndex(p => p.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Статья не найдена' });
  const post = blogPosts[idx];
  const caller = req.blogUser.username;
  if (!isBlogAdmin(caller) && post.author.toLowerCase() !== caller.toLowerCase())
    return res.status(403).json({ error: 'Нет доступа' });
  // Отменяем отложенные таймеры сохранения просмотров/лайков (см. комментарий
  // в saveBlogPost) — иначе они всплывут через 5 секунд ПОСЛЕ удаления и
  // заново вставят уже удалённую статью в БД.
  if (post._viewTimer) { clearTimeout(post._viewTimer); post._viewTimer = null; }
  if (post._lstTimer)  { clearTimeout(post._lstTimer);  post._lstTimer  = null; }
  post._deleted = true;
  blogPosts.splice(idx, 1);
  await deleteBlogPost(post.id);
  await db('DELETE FROM blog_likes WHERE post_id=$1',[post.id]).catch(()=>{});
  await db('DELETE FROM blog_views WHERE post_id=$1',[post.id]).catch(()=>{});
  res.json({ ok: true });
}
// Некоторые хостинги/прокси режут метод DELETE (запрос не долетает до Express
// и в ответ прилетает HTML-страница ошибки вместо JSON — отсюда и
// "JSON.parse: unexpected character..."). Даём POST-дублёр на всякий случай,
// как уже сделано для /api/admin/chat и /api/admin/puzzles.
app.delete('/api/blog/:id', blogAuthMiddleware, handleDeleteBlogPost);
app.post('/api/blog/:id/delete', blogAuthMiddleware, handleDeleteBlogPost);

app.post('/api/blog/:id/like', blogAuthMiddleware, rateLimit(limiterStrict), async (req, res) => {
  const post = blogPosts.find(p => p.id === req.params.id);
  if (!post) return res.status(404).json({ error: 'Статья не найдена' });
  if (post.status !== 'published') return res.status(400).json({ error: 'Нельзя лайкнуть черновик' });
  const user = await getUser(req.blogUser.username.toLowerCase());
  if (!user) return res.status(404).json({ error: 'Пользователь не найден' });
  if (user.banned) return res.status(403).json({ error: 'Заблокированные не могут ставить лайки' });
  const { unlike } = req.body;
  const existing = await db('SELECT 1 FROM blog_likes WHERE user_id=$1 AND post_id=$2',[user.id,post.id]);
  if (unlike) {
    if (existing.rows.length > 0) {
      await db('DELETE FROM blog_likes WHERE user_id=$1 AND post_id=$2',[user.id,post.id]);
      post.likes = Math.max(0,(post.likes||1)-1);
    }
  } else {
    if (existing.rows.length === 0) {
      await db('INSERT INTO blog_likes (user_id,post_id) VALUES ($1,$2)',[user.id,post.id]);
      post.likes = (post.likes||0)+1;
    }
  }
  if (!post._lstTimer) post._lstTimer = setTimeout(()=>{ saveBlogPost(post).catch(()=>{}); post._lstTimer=null; },5000);
  res.json({ likes: post.likes, liked: !unlike });
});

// ══════════════════════════════════════════════════════════════
//  BLOG COMMENTS API
// ══════════════════════════════════════════════════════════════

function isBlogCommentAdmin(username) {
  return username && ['chesshome','marina64'].includes(username.toLowerCase());
}

async function getCommentBan(postId, username) {
  const uname = username.toLowerCase();
  const glob = await db('SELECT * FROM blog_global_comment_bans WHERE username=$1',[uname]);
  if (glob.rows[0]) {
    const r = glob.rows[0];
    if (r.type === 'ban' || (r.until && Number(r.until) > Date.now())) return r;
    await db('DELETE FROM blog_global_comment_bans WHERE username=$1',[uname]).catch(()=>{});
  }
  const local = await db('SELECT * FROM blog_comment_bans WHERE post_id=$1 AND username=$2',[postId,uname]);
  if (local.rows[0]) {
    const r = local.rows[0];
    if (r.type === 'ban' || (r.until && Number(r.until) > Date.now())) return r;
    await db('DELETE FROM blog_comment_bans WHERE post_id=$1 AND username=$2',[postId,uname]).catch(()=>{});
  }
  return null;
}

app.get('/blog/:id/comments', (req, res) => {
  const post = blogPosts.find(p => p.id === req.params.id);
  if (!post || post.status === 'hidden') return res.redirect('/404.html');
  res.sendFile(path.join(__dirname, '../public/blog.html'));
});

app.get('/api/blog/:id/comments', async (req, res) => {
  const post = blogPosts.find(p => p.id === req.params.id);
  if (!post || post.status !== 'published') return res.status(404).json({ error: 'Статья не найдена' });

  let callerUsername = null;
  const auth = getAuthToken(req);
  if (auth) { try { callerUsername = jwt.verify(auth,JWT_SECRET).username.toLowerCase(); } catch {} }

  const r = await db('SELECT * FROM blog_comments WHERE post_id=$1 ORDER BY created_at ASC',[req.params.id]);
  const commentIds = r.rows.map(c => c.id);
  let reactions = [];
  if (commentIds.length > 0) {
    const phs = commentIds.map((_,i)=>`$${i+1}`).join(',');
    const rr = await db(`SELECT * FROM blog_comment_reactions WHERE comment_id IN (${phs})`,commentIds);
    reactions = rr.rows;
  }

  const comments = r.rows.map(c => {
    const myReaction = callerUsername ? reactions.find(rr => rr.comment_id===c.id && rr.user_id===callerUsername) : null;
    const reactionMap = {};
    for (const rr of reactions.filter(rr=>rr.comment_id===c.id)) {
      reactionMap[rr.emoji] = (reactionMap[rr.emoji]||0)+1;
    }
    return {
      id: c.id, postId: c.post_id, author: c.author,
      body: c.deleted ? null : c.body,
      deleted: c.deleted, deletedBy: c.deleted_by || null,
      createdAt: Number(c.created_at),
      editCount: Number(c.edit_count || 0),
      editedAt: c.edited_at ? Number(c.edited_at) : null,
      reactions: reactionMap,
      myReaction: myReaction?.emoji || null,
    };
  });

  let myBan = null;
  if (callerUsername) myBan = await getCommentBan(req.params.id, callerUsername);

  res.json({ comments, count: comments.length, myBan: myBan ? { type: myBan.type, until: myBan.until ? Number(myBan.until) : null } : null });
});

app.post('/api/blog/:id/comments', blogAuthMiddleware, rateLimit(limiterStrict), async (req, res) => {
  const post = blogPosts.find(p => p.id === req.params.id);
  if (!post || post.status !== 'published') return res.status(404).json({ error: 'Статья не найдена' });

  const user = await getUser(req.blogUser.username.toLowerCase());
  if (!user) return res.status(404).json({ error: 'Пользователь не найден' });
  if (user.banned) return res.status(403).json({ error: 'Вы заблокированы' });

  const ban = await getCommentBan(req.params.id, user.username);
  if (ban) {
    if (ban.type === 'ban') return res.status(403).json({ error: 'Вы заблокированы в комментариях этого блога' });
    const until = Number(ban.until);
    if (until > Date.now()) {
      const mins = Math.ceil((until - Date.now())/60000);
      return res.status(403).json({ error: `Вы замьючены. Осталось ${mins} мин.`, until });
    }
  }

  const body = (req.body.body || '').toString().trim();
  if (!body) return res.status(400).json({ error: 'Пустой комментарий' });
  if (body.length > 4000) return res.status(400).json({ error: 'Максимум 4000 символов' });

  if (!isBlogCommentAdmin(user.username)) {
    const dayStart = new Date(); dayStart.setHours(0,0,0,0);
    const todayCount = await db(`SELECT COUNT(*) AS cnt FROM blog_comments WHERE LOWER(author)=$1 AND created_at>=$2 AND deleted=FALSE`, [user.username.toLowerCase(), dayStart.getTime()]);
    if (Number(todayCount.rows[0]?.cnt || 0) >= 3)
      return res.status(429).json({ error: 'Можно оставить не более 3 комментариев в день. Возвращайтесь завтра!' });
  }

  const ratKey = 'blogcmt_' + user.username.toLowerCase();
  if (!global._blogCmtRate) global._blogCmtRate = new Map();
  const last = global._blogCmtRate.get(ratKey) || 0;
  if (Date.now() - last < 20000) return res.status(429).json({ error: 'Не так быстро! Подождите 20 секунд' });
  global._blogCmtRate.set(ratKey, Date.now());

  const id = uuidv4();
  const createdAt = Date.now();
  await db('INSERT INTO blog_comments (id,post_id,author,body,created_at,deleted,edit_count) VALUES ($1,$2,$3,$4,$5,FALSE,0)', [id, req.params.id, user.username, body, createdAt]);

  res.json({ ok: true, comment: {
    id, postId: req.params.id, author: user.username,
    body, deleted: false, deletedBy: null, createdAt,
    editCount: 0, editedAt: null, reactions: {}, myReaction: null,
  }});
});

async function handleDeleteBlogComment(req, res) {
  const user = await getUser(req.blogUser.username.toLowerCase());
  if (!user) return res.status(404).json({ error: 'Пользователь не найден' });

  const r = await db('SELECT * FROM blog_comments WHERE id=$1 AND post_id=$2',[req.params.cid,req.params.id]);
  const comment = r.rows[0];
  if (!comment) return res.status(404).json({ error: 'Комментарий не найден' });

  const isAdmin = isBlogCommentAdmin(user.username);
  const isAuthor = comment.author.toLowerCase() === user.username.toLowerCase();
  if (!isAdmin && !isAuthor) return res.status(403).json({ error: 'Нет прав' });

  const deletedBy = isAdmin && !isAuthor ? user.username : null;
  await db('UPDATE blog_comments SET deleted=TRUE, deleted_by=$1 WHERE id=$2',[deletedBy, req.params.cid]);
  res.json({ ok: true, deletedBy });
}
app.delete('/api/blog/:id/comments/:cid', blogAuthMiddleware, handleDeleteBlogComment);
app.post('/api/blog/:id/comments/:cid/delete', blogAuthMiddleware, handleDeleteBlogComment);

app.patch('/api/blog/:id/comments/:cid', blogAuthMiddleware, rateLimit(limiterStrict), async (req, res) => {
  const user = await getUser(req.blogUser.username.toLowerCase());
  if (!user) return res.status(404).json({ error: 'Пользователь не найден' });
  if (user.banned) return res.status(403).json({ error: 'Вы заблокированы' });

  const r = await db('SELECT * FROM blog_comments WHERE id=$1 AND post_id=$2',[req.params.cid,req.params.id]);
  const comment = r.rows[0];
  if (!comment) return res.status(404).json({ error: 'Комментарий не найден' });
  if (comment.deleted) return res.status(400).json({ error: 'Нельзя редактировать удалённый комментарий' });

  const isAuthor = comment.author.toLowerCase() === user.username.toLowerCase();
  const isAdmin  = isBlogCommentAdmin(user.username);
  if (!isAuthor && !isAdmin) return res.status(403).json({ error: 'Нет прав' });

  const editCount = Number(comment.edit_count || 0);
  if (!isAdmin && editCount >= 2)
    return res.status(403).json({ error: 'Комментарий можно редактировать не более 2 раз' });

  const body = (req.body.body || '').toString().trim();
  if (!body) return res.status(400).json({ error: 'Текст не может быть пустым' });
  if (body.length > 4000) return res.status(400).json({ error: 'Максимум 4000 символов' });

  const newEditCount = editCount + 1;
  const editedAt = Date.now();
  await db('UPDATE blog_comments SET body=$1, edit_count=$2, edited_at=$3 WHERE id=$4', [body, newEditCount, editedAt, req.params.cid]);

  res.json({ ok: true, body, editCount: newEditCount, editedAt });
});

app.post('/api/blog/:id/comments/:cid/react', blogAuthMiddleware, rateLimit(limiterStrict), async (req, res) => {
  const user = await getUser(req.blogUser.username.toLowerCase());
  if (!user || user.banned) return res.status(403).json({ error: 'Нет доступа' });

  const r = await db('SELECT id,deleted FROM blog_comments WHERE id=$1 AND post_id=$2',[req.params.cid,req.params.id]);
  if (!r.rows[0] || r.rows[0].deleted) return res.status(404).json({ error: 'Комментарий не найден' });

  const ALLOWED_EMOJIS = ['👍','❤️','😂','😮','😢','😡','♟️'];
  const { emoji } = req.body;
  if (!emoji) {
    await db('DELETE FROM blog_comment_reactions WHERE comment_id=$1 AND user_id=$2',[req.params.cid,user.username.toLowerCase()]);
    return res.json({ ok: true, removed: true });
  }
  if (!ALLOWED_EMOJIS.includes(emoji)) return res.status(400).json({ error: 'Неверный эмоджи' });

  await db(`INSERT INTO blog_comment_reactions (comment_id,user_id,emoji) VALUES ($1,$2,$3) ON CONFLICT (comment_id,user_id) DO UPDATE SET emoji=$3`, [req.params.cid, user.username.toLowerCase(), emoji]);

  const rr = await db('SELECT emoji, COUNT(*) as cnt FROM blog_comment_reactions WHERE comment_id=$1 GROUP BY emoji',[req.params.cid]);
  const reactions = {};
  for (const row of rr.rows) reactions[row.emoji] = Number(row.cnt);
  res.json({ ok: true, reactions, myReaction: emoji });
});

app.post('/api/blog/:id/comments/mod', blogAuthMiddleware, async (req, res) => {
  const user = await getUser(req.blogUser.username.toLowerCase());
  if (!user || !isBlogCommentAdmin(user.username)) return res.status(403).json({ error: 'Нет прав' });

  const { action, username, global: isGlobal } = req.body;
  if (!action || !username) return res.status(400).json({ error: 'Укажите action и username' });
  const target = username.toLowerCase();
  if (isBlogCommentAdmin(target)) return res.status(403).json({ error: 'Нельзя банить администратора' });

  if (action === 'unban') {
    if (isGlobal) await db('DELETE FROM blog_global_comment_bans WHERE username=$1',[target]);
    else await db('DELETE FROM blog_comment_bans WHERE post_id=$1 AND username=$2',[req.params.id,target]);
    return res.json({ ok: true });
  }

  const type = action === 'ban' ? 'ban' : 'mute';
  const until = type === 'mute' ? Date.now() + 60*60*1000 : null;
  const createdAt = Date.now();

  if (isGlobal) {
    await db(`INSERT INTO blog_global_comment_bans (username,type,until,created_at) VALUES ($1,$2,$3,$4) ON CONFLICT (username) DO UPDATE SET type=$2,until=$3,created_at=$4`, [target,type,until,createdAt]);
  } else {
    await db(`INSERT INTO blog_comment_bans (post_id,username,type,until,created_at) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (post_id,username) DO UPDATE SET type=$3,until=$4,created_at=$5`, [req.params.id,target,type,until,createdAt]);
  }
  res.json({ ok: true, type, until, global: !!isGlobal });
});

// ══════════════════════════════════════════════════════════════
//  NEWS API
//  Контракт см. в комментарии наверху public/news.html.
//  В отличие от блога, публиковать новости может не любой юзер, а
//  только авторы, назначенные владельцем (username 'chesshome').
// ══════════════════════════════════════════════════════════════
function newsAuthMiddleware(req, res, next) {
  const auth = getAuthToken(req);
  if (!auth) return res.status(401).json({ error: 'Войдите, чтобы выполнить это действие' });
  try { req.newsUser = jwt.verify(auth, JWT_SECRET); next(); }
  catch { return res.status(401).json({ error: 'Неверный токен' }); }
}

const NEWS_OWNER_USERNAME = 'chesshome';
function isNewsOwner(username) { return !!username && username.toLowerCase() === NEWS_OWNER_USERNAME; }
function isNewsAuthorUser(username) {
  if (!username) return false;
  if (isNewsOwner(username)) return true;
  const low = username.toLowerCase();
  return newsAuthors.some(a => a.toLowerCase() === low);
}

function newsSanitize(post, withBody) {
  const o = { id: post.id, title: post.title, author: post.author, status: post.status,
    cover: post.cover || '', views: post.views || 0, likes: post.likes || 0, dislikes: post.dislikes || 0,
    createdAt: post.createdAt, updatedAt: post.updatedAt || null };
  if (withBody) o.body = post.body;
  return o;
}

db(`CREATE TABLE IF NOT EXISTS news_posts (
  id TEXT PRIMARY KEY, title TEXT NOT NULL, body TEXT NOT NULL, author TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft', views INT NOT NULL DEFAULT 0,
  likes INT NOT NULL DEFAULT 0, dislikes INT NOT NULL DEFAULT 0, cover TEXT DEFAULT '',
  created_at BIGINT NOT NULL, updated_at BIGINT
)`).catch(e => console.error('[News] news_posts init:', e.message));
db(`CREATE TABLE IF NOT EXISTS news_authors (username TEXT NOT NULL, username_low TEXT PRIMARY KEY, created_at BIGINT NOT NULL)`).catch(e => console.error('[News] news_authors init:', e.message));
db(`CREATE TABLE IF NOT EXISTS news_views (viewer_key TEXT NOT NULL, post_id TEXT NOT NULL, PRIMARY KEY (viewer_key, post_id))`).catch(e => console.error('[News] news_views init:', e.message));
db(`CREATE TABLE IF NOT EXISTS news_likes (user_id TEXT NOT NULL, post_id TEXT NOT NULL, PRIMARY KEY (user_id, post_id))`).catch(e => console.error('[News] news_likes init:', e.message));
db(`CREATE TABLE IF NOT EXISTS news_dislikes (user_id TEXT NOT NULL, post_id TEXT NOT NULL, PRIMARY KEY (user_id, post_id))`).catch(e => console.error('[News] news_dislikes init:', e.message));
db(`CREATE TABLE IF NOT EXISTS news_comments (id TEXT PRIMARY KEY, post_id TEXT NOT NULL, author TEXT NOT NULL, body TEXT NOT NULL, created_at BIGINT NOT NULL, deleted BOOLEAN NOT NULL DEFAULT FALSE, deleted_by TEXT)`).catch(e => console.error('[News] news_comments init:', e.message));
db(`CREATE INDEX IF NOT EXISTS idx_news_comments_post ON news_comments(post_id, created_at ASC)`).catch(() => {});
db(`CREATE TABLE IF NOT EXISTS news_comment_mutes (post_id TEXT NOT NULL, username TEXT NOT NULL, until BIGINT NOT NULL, created_at BIGINT NOT NULL, PRIMARY KEY (post_id, username))`).catch(e => console.error('[News] news_comment_mutes init:', e.message));

// ── Список новостей / статья ─────────────────────────────────
app.get('/api/news', (req, res) => {
  const { status, page: pQ, limit: lQ } = req.query;
  const page  = Math.max(0, parseInt(pQ) || 0);
  const limit = Math.min(50, parseInt(lQ) || 20);

  let callerUsername = null;
  const auth = getAuthToken(req);
  if (auth) { try { callerUsername = jwt.verify(auth, JWT_SECRET).username.toLowerCase(); } catch {} }

  let list = newsPosts.filter(p => {
    if (p.status === 'hidden') {
      // Список прикрытых новостей виден только владельцу и только когда
      // он явно его запросил (вкладка "Скрытые").
      return status === 'hidden' && isNewsOwner(callerUsername);
    }
    if (status === 'hidden') return false;
    if (p.status !== 'published') {
      if (!callerUsername) return false;
      if (!isNewsOwner(callerUsername) && p.author.toLowerCase() !== callerUsername) return false;
      return status === 'drafts';
    }
    return status !== 'drafts';
  });

  if (status === 'drafts' || status === 'hidden') list.sort((a,b) => (b.updatedAt||b.createdAt) - (a.updatedAt||a.createdAt));
  else list.sort((a,b) => b.createdAt - a.createdAt);

  res.json({ posts: list.slice(page*limit, page*limit+limit).map(p => newsSanitize(p,false)), total: list.length });
});

app.get('/api/news/:id', async (req, res) => {
  const post = newsPosts.find(p => p.id === req.params.id);
  if (!post) return res.status(404).json({ error: 'Новость не найдена' });

  // Прикрытая новость не видна вообще никому (даже автору и владельцу) —
  // управление такими новостями идёт только через список "Скрытые".
  if (post.status === 'hidden') return res.status(404).json({ error: 'Новость не найдена' });

  let callerUsername = null;
  const auth = getAuthToken(req);
  if (auth) { try { callerUsername = jwt.verify(auth, JWT_SECRET).username.toLowerCase(); } catch {} }

  if (post.status !== 'published') {
    const canSee = callerUsername && (isNewsOwner(callerUsername) || post.author.toLowerCase() === callerUsername);
    if (!canSee) return res.status(403).json({ error: 'Черновик' });
  }

  const noview = req.query.noview === '1';
  if (!noview && post.status === 'published') {
    let viewerKey = callerUsername ? 'u:' + callerUsername : null;
    if (!viewerKey) { const did = req.deviceId; if (did) viewerKey = 'd:' + did; }
    if (viewerKey) {
      try {
        const ins = await db(`INSERT INTO news_views (viewer_key,post_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [viewerKey, post.id]);
        if (ins.rowCount === 1) {
          post.views = (post.views || 0) + 1;
          if (!post._viewTimer) post._viewTimer = setTimeout(() => { saveNewsPost(post).catch(()=>{}); post._viewTimer=null; }, 5000);
        }
      } catch(e) { console.error('[News] view:', e.message); }
    }
  }

  let liked = false, disliked = false;
  if (callerUsername) {
    const u = await getUser(callerUsername);
    if (u) {
      const [lr, dr] = await Promise.all([
        db('SELECT 1 FROM news_likes WHERE user_id=$1 AND post_id=$2',[u.id,post.id]),
        db('SELECT 1 FROM news_dislikes WHERE user_id=$1 AND post_id=$2',[u.id,post.id]),
      ]);
      liked = lr.rows.length>0; disliked = dr.rows.length>0;
    }
  }

  res.json({ ...newsSanitize(post,true), liked, disliked });
});

app.post('/api/news', newsAuthMiddleware, rateLimit(limiterStrict), async (req, res) => {
  if (!isNewsAuthorUser(req.newsUser.username)) return res.status(403).json({ error: 'Только авторы новостей могут писать статьи' });

  let { title, body, cover, status, encoding } = req.body;
  title = decodeBlogField(title, encoding);
  body  = decodeBlogField(body, encoding);
  if (!title || !title.trim()) return res.status(400).json({ error: 'Укажите заголовок' });
  if (!body  || !body.trim())  return res.status(400).json({ error: 'Укажите текст' });
  if (title.length > 200)      return res.status(400).json({ error: 'Заголовок слишком длинный (макс 200)' });
  if (body.length > 100000)    return res.status(400).json({ error: 'Текст слишком длинный (макс 100 000 символов)' });
  if (cover !== undefined && cover !== null && (typeof cover !== 'string' || cover.length > 500))
    return res.status(400).json({ error: 'Некорректная обложка' });

  const user = await getUser(req.newsUser.username.toLowerCase());
  if (!user) return res.status(404).json({ error: 'Пользователь не найден' });
  if (user.banned) return res.status(403).json({ error: 'Заблокированные пользователи не могут создавать новости' });

  const postStatus = ['published','draft'].includes(status) ? status : 'draft';
  const post = { id: uuidv4(), title: title.trim(), body: body.trim(), author: user.username,
    status: postStatus, views: 0, likes: 0, dislikes: 0, cover: cover || '', createdAt: Date.now(), updatedAt: null };
  newsPosts.unshift(post);
  await saveNewsPost(post);
  res.json(newsSanitize(post, true));
});

app.patch('/api/news/:id', newsAuthMiddleware, rateLimit(limiterStrict), async (req, res) => {
  const post = newsPosts.find(p => p.id === req.params.id);
  if (!post) return res.status(404).json({ error: 'Новость не найдена' });
  const caller = req.newsUser.username;
  if (!isNewsOwner(caller) && post.author.toLowerCase() !== caller.toLowerCase())
    return res.status(403).json({ error: 'Нет доступа' });

  let { title, body, cover, status, encoding } = req.body;
  title = decodeBlogField(title, encoding);
  body  = decodeBlogField(body, encoding);
  if (title !== undefined) { if (!title.trim()) return res.status(400).json({ error: 'Заголовок не может быть пустым' }); post.title = title.trim().slice(0,200); }
  if (body  !== undefined) { if (!body.trim())  return res.status(400).json({ error: 'Текст не может быть пустым' }); post.body = body.trim().slice(0,100000); }
  if (cover !== undefined) { post.cover = (typeof cover === 'string' ? cover.slice(0,500) : ''); }
  if (status !== undefined && ['published','draft','hidden'].includes(status)) {
    // Прикрывать новость и возвращать её обратно может только владелец.
    if ((status === 'hidden' || post.status === 'hidden') && !isNewsOwner(caller))
      return res.status(403).json({ error: 'Скрывать и восстанавливать новости может только владелец' });
    post.status = status;
  }
  post.updatedAt = Date.now();
  await saveNewsPost(post);
  res.json(newsSanitize(post, true));
});

async function handleDeleteNewsPost(req, res) {
  const idx = newsPosts.findIndex(p => p.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Новость не найдена' });
  const post = newsPosts[idx];
  const caller = req.newsUser.username;
  if (!isNewsOwner(caller) && post.author.toLowerCase() !== caller.toLowerCase())
    return res.status(403).json({ error: 'Нет доступа' });
  // См. аналогичный комментарий в handleDeleteBlogPost про отложенные таймеры.
  if (post._viewTimer) { clearTimeout(post._viewTimer); post._viewTimer = null; }
  if (post._lstTimer)  { clearTimeout(post._lstTimer);  post._lstTimer  = null; }
  post._deleted = true;
  newsPosts.splice(idx, 1);
  await deleteNewsPost(post.id);
  await db('DELETE FROM news_likes WHERE post_id=$1',[post.id]).catch(()=>{});
  await db('DELETE FROM news_dislikes WHERE post_id=$1',[post.id]).catch(()=>{});
  await db('DELETE FROM news_views WHERE post_id=$1',[post.id]).catch(()=>{});
  await db('DELETE FROM news_comments WHERE post_id=$1',[post.id]).catch(()=>{});
  await db('DELETE FROM news_comment_mutes WHERE post_id=$1',[post.id]).catch(()=>{});
  res.json({ ok: true });
}
app.delete('/api/news/:id', newsAuthMiddleware, handleDeleteNewsPost);
app.post('/api/news/:id/delete', newsAuthMiddleware, handleDeleteNewsPost);

// ── Лайк / дизлайк (взаимоисключающие) ───────────────────────
app.post('/api/news/:id/like', newsAuthMiddleware, rateLimit(limiterStrict), async (req, res) => {
  const post = newsPosts.find(p => p.id === req.params.id);
  if (!post) return res.status(404).json({ error: 'Новость не найдена' });
  if (post.status !== 'published') return res.status(400).json({ error: 'Нельзя оценить черновик' });
  const user = await getUser(req.newsUser.username.toLowerCase());
  if (!user) return res.status(404).json({ error: 'Пользователь не найден' });
  if (user.banned) return res.status(403).json({ error: 'Заблокированные не могут ставить оценки' });

  const { unlike } = req.body;
  const existingLike = await db('SELECT 1 FROM news_likes WHERE user_id=$1 AND post_id=$2',[user.id,post.id]);
  if (unlike) {
    if (existingLike.rows.length > 0) {
      await db('DELETE FROM news_likes WHERE user_id=$1 AND post_id=$2',[user.id,post.id]);
      post.likes = Math.max(0,(post.likes||1)-1);
    }
  } else if (existingLike.rows.length === 0) {
    await db('INSERT INTO news_likes (user_id,post_id) VALUES ($1,$2)',[user.id,post.id]);
    post.likes = (post.likes||0)+1;
    const existingDislike = await db('SELECT 1 FROM news_dislikes WHERE user_id=$1 AND post_id=$2',[user.id,post.id]);
    if (existingDislike.rows.length > 0) {
      await db('DELETE FROM news_dislikes WHERE user_id=$1 AND post_id=$2',[user.id,post.id]);
      post.dislikes = Math.max(0,(post.dislikes||1)-1);
    }
  }
  if (!post._lstTimer) post._lstTimer = setTimeout(()=>{ saveNewsPost(post).catch(()=>{}); post._lstTimer=null; },5000);
  res.json({ likes: post.likes, dislikes: post.dislikes, liked: !unlike, disliked: false });
});

app.post('/api/news/:id/dislike', newsAuthMiddleware, rateLimit(limiterStrict), async (req, res) => {
  const post = newsPosts.find(p => p.id === req.params.id);
  if (!post) return res.status(404).json({ error: 'Новость не найдена' });
  if (post.status !== 'published') return res.status(400).json({ error: 'Нельзя оценить черновик' });
  const user = await getUser(req.newsUser.username.toLowerCase());
  if (!user) return res.status(404).json({ error: 'Пользователь не найден' });
  if (user.banned) return res.status(403).json({ error: 'Заблокированные не могут ставить оценки' });

  const { undislike } = req.body;
  const existingDislike = await db('SELECT 1 FROM news_dislikes WHERE user_id=$1 AND post_id=$2',[user.id,post.id]);
  if (undislike) {
    if (existingDislike.rows.length > 0) {
      await db('DELETE FROM news_dislikes WHERE user_id=$1 AND post_id=$2',[user.id,post.id]);
      post.dislikes = Math.max(0,(post.dislikes||1)-1);
    }
  } else if (existingDislike.rows.length === 0) {
    await db('INSERT INTO news_dislikes (user_id,post_id) VALUES ($1,$2)',[user.id,post.id]);
    post.dislikes = (post.dislikes||0)+1;
    const existingLike = await db('SELECT 1 FROM news_likes WHERE user_id=$1 AND post_id=$2',[user.id,post.id]);
    if (existingLike.rows.length > 0) {
      await db('DELETE FROM news_likes WHERE user_id=$1 AND post_id=$2',[user.id,post.id]);
      post.likes = Math.max(0,(post.likes||1)-1);
    }
  }
  if (!post._lstTimer) post._lstTimer = setTimeout(()=>{ saveNewsPost(post).catch(()=>{}); post._lstTimer=null; },5000);
  res.json({ likes: post.likes, dislikes: post.dislikes, liked: false, disliked: !undislike });
});

// ── Авторы новостей (владелец) ───────────────────────────────
app.get('/api/news/authors', (req, res) => {
  res.json({ owner: NEWS_OWNER_USERNAME, authors: newsAuthors });
});

app.post('/api/news/authors', newsAuthMiddleware, async (req, res) => {
  if (!isNewsOwner(req.newsUser.username)) return res.status(403).json({ error: 'Только владелец может назначать авторов' });
  const { username } = req.body;
  if (!username || !username.trim()) return res.status(400).json({ error: 'Укажите никнейм' });
  const target = await getUser(username.trim().toLowerCase());
  if (!target) return res.status(404).json({ error: 'Пользователь не найден' });
  if (isNewsOwner(target.username)) return res.status(400).json({ error: 'Владелец и так может публиковать новости' });
  if (newsAuthors.some(a => a.toLowerCase() === target.username.toLowerCase()))
    return res.status(400).json({ error: 'Этот пользователь уже автор новостей' });

  await db(`INSERT INTO news_authors (username,username_low,created_at) VALUES ($1,$2,$3) ON CONFLICT (username_low) DO NOTHING`, [target.username, target.username.toLowerCase(), Date.now()]);
  newsAuthors.push(target.username);
  res.json({ ok: true, authors: newsAuthors });
});

app.post('/api/news/authors/remove', newsAuthMiddleware, async (req, res) => {
  if (!isNewsOwner(req.newsUser.username)) return res.status(403).json({ error: 'Только владелец может снимать авторов' });
  const { username } = req.body;
  if (!username || !username.trim()) return res.status(400).json({ error: 'Укажите никнейм' });
  const low = username.trim().toLowerCase();
  await db('DELETE FROM news_authors WHERE username_low=$1',[low]);
  newsAuthors = newsAuthors.filter(a => a.toLowerCase() !== low);
  res.json({ ok: true, authors: newsAuthors });
});

// ══════════════════════════════════════════════════════════════
//  NEWS COMMENTS API
// ══════════════════════════════════════════════════════════════
async function getNewsCommentMute(postId, username) {
  const uname = username.toLowerCase();
  const r = await db('SELECT * FROM news_comment_mutes WHERE post_id=$1 AND username=$2',[postId,uname]);
  const row = r.rows[0];
  if (!row) return null;
  if (Number(row.until) > Date.now()) return row;
  await db('DELETE FROM news_comment_mutes WHERE post_id=$1 AND username=$2',[postId,uname]).catch(()=>{});
  return null;
}

app.get('/api/news/:id/comments', async (req, res) => {
  const post = newsPosts.find(p => p.id === req.params.id);
  if (!post || post.status !== 'published') return res.status(404).json({ error: 'Новость не найдена' });

  let callerUsername = null;
  const auth = getAuthToken(req);
  if (auth) { try { callerUsername = jwt.verify(auth,JWT_SECRET).username.toLowerCase(); } catch {} }

  const r = await db('SELECT * FROM news_comments WHERE post_id=$1 ORDER BY created_at ASC',[req.params.id]);
  const comments = r.rows.map(c => ({
    id: c.id, postId: c.post_id, author: c.author,
    body: c.deleted ? null : c.body,
    deleted: c.deleted, deletedBy: c.deleted_by || null,
    createdAt: Number(c.created_at),
  }));

  let myBan = null;
  if (callerUsername) {
    const mute = await getNewsCommentMute(req.params.id, callerUsername);
    if (mute) myBan = { type: 'mute', until: Number(mute.until) };
  }

  res.json({ comments, count: comments.length, myBan });
});

app.post('/api/news/:id/comments', newsAuthMiddleware, rateLimit(limiterStrict), async (req, res) => {
  const post = newsPosts.find(p => p.id === req.params.id);
  if (!post || post.status !== 'published') return res.status(404).json({ error: 'Новость не найдена' });

  const user = await getUser(req.newsUser.username.toLowerCase());
  if (!user) return res.status(404).json({ error: 'Пользователь не найден' });
  if (user.banned) return res.status(403).json({ error: 'Вы заблокированы' });

  const mute = await getNewsCommentMute(req.params.id, user.username);
  if (mute) {
    const mins = Math.ceil((Number(mute.until) - Date.now())/60000);
    return res.status(403).json({ error: `Вы замьючены. Осталось ${mins} мин.`, until: Number(mute.until) });
  }

  const body = (req.body.body || '').toString().trim();
  if (!body) return res.status(400).json({ error: 'Пустой комментарий' });
  if (body.length > 4000) return res.status(400).json({ error: 'Максимум 4000 символов' });

  if (!isNewsOwner(user.username)) {
    const dayStart = new Date(); dayStart.setHours(0,0,0,0);
    const todayCount = await db(`SELECT COUNT(*) AS cnt FROM news_comments WHERE LOWER(author)=$1 AND created_at>=$2 AND deleted=FALSE`, [user.username.toLowerCase(), dayStart.getTime()]);
    if (Number(todayCount.rows[0]?.cnt || 0) >= 10)
      return res.status(429).json({ error: 'Можно оставить не более 10 комментариев в день. Возвращайтесь завтра!' });
  }

  const ratKey = 'newscmt_' + user.username.toLowerCase();
  if (!global._newsCmtRate) global._newsCmtRate = new Map();
  const last = global._newsCmtRate.get(ratKey) || 0;
  if (Date.now() - last < 20000) return res.status(429).json({ error: 'Не так быстро! Подождите 20 секунд' });
  global._newsCmtRate.set(ratKey, Date.now());

  const id = uuidv4();
  const createdAt = Date.now();
  await db('INSERT INTO news_comments (id,post_id,author,body,created_at,deleted) VALUES ($1,$2,$3,$4,$5,FALSE)', [id, req.params.id, user.username, body, createdAt]);

  res.json({ ok: true, comment: {
    id, postId: req.params.id, author: user.username,
    body, deleted: false, deletedBy: null, createdAt,
  }});
});

async function handleDeleteNewsComment(req, res) {
  const user = await getUser(req.newsUser.username.toLowerCase());
  if (!user) return res.status(404).json({ error: 'Пользователь не найден' });

  const r = await db('SELECT * FROM news_comments WHERE id=$1 AND post_id=$2',[req.params.cid,req.params.id]);
  const comment = r.rows[0];
  if (!comment) return res.status(404).json({ error: 'Комментарий не найден' });

  const isOwnerCaller = isNewsOwner(user.username);
  const isAuthor = comment.author.toLowerCase() === user.username.toLowerCase();
  if (!isOwnerCaller && !isAuthor) return res.status(403).json({ error: 'Нет прав' });

  const deletedBy = isOwnerCaller && !isAuthor ? user.username : null;
  await db('UPDATE news_comments SET deleted=TRUE, deleted_by=$1 WHERE id=$2',[deletedBy, req.params.cid]);
  res.json({ ok: true, deletedBy });
}
app.delete('/api/news/:id/comments/:cid', newsAuthMiddleware, handleDeleteNewsComment);
app.post('/api/news/:id/comments/:cid/delete', newsAuthMiddleware, handleDeleteNewsComment);

app.post('/api/news/:id/comments/mod', newsAuthMiddleware, async (req, res) => {
  const user = await getUser(req.newsUser.username.toLowerCase());
  if (!user || !isNewsOwner(user.username)) return res.status(403).json({ error: 'Нет прав' });

  const { action, username } = req.body;
  if (!action || !username) return res.status(400).json({ error: 'Укажите action и username' });
  const target = username.toLowerCase();
  if (isNewsOwner(target)) return res.status(403).json({ error: 'Нельзя замьютить владельца' });

  if (action === 'unmute') {
    await db('DELETE FROM news_comment_mutes WHERE post_id=$1 AND username=$2',[req.params.id,target]);
    return res.json({ ok: true });
  }
  if (action !== 'mute') return res.status(400).json({ error: 'Неверное действие' });

  const until = Date.now() + 60*60*1000;
  const createdAt = Date.now();
  await db(`INSERT INTO news_comment_mutes (post_id,username,until,created_at) VALUES ($1,$2,$3,$4) ON CONFLICT (post_id,username) DO UPDATE SET until=$3,created_at=$4`, [req.params.id,target,until,createdAt]);
  res.json({ ok: true, type: 'mute', until });
});

// ── Загрузка изображений (обложки новостей) ──────────────────
const UPLOADS_DIR = path.join(__dirname, '../public/uploads');
try { fs.mkdirSync(UPLOADS_DIR, { recursive: true }); } catch (e) { console.error('[Upload] Не удалось создать папку uploads:', e.message); }

const uploadStorage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOADS_DIR),
  filename: (req, file, cb) => {
    const ext = (path.extname(file.originalname) || '').toLowerCase().replace(/[^a-z0-9.]/g,'').slice(0,10);
    cb(null, `${Date.now()}_${uuidv4()}${ext}`);
  },
});
const uploadImage = multer({
  storage: uploadStorage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (!/^image\/(jpeg|png|gif|webp)$/.test(file.mimetype)) return cb(new Error('Разрешены только изображения (jpeg, png, gif, webp)'));
    cb(null, true);
  },
});

app.post('/api/upload', newsAuthMiddleware, rateLimit(limiterStrict), (req, res) => {
  if (!isNewsAuthorUser(req.newsUser.username)) return res.status(403).json({ error: 'Только авторы новостей могут загружать изображения' });
  uploadImage.single('file')(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.message || 'Не удалось загрузить файл' });
    if (!req.file) return res.status(400).json({ error: 'Файл не передан' });
    res.json({ url: '/uploads/' + req.file.filename });
  });
});

// ── Clubs API ─────────────────────────────────────────────────
app.get('/clubs',      (req, res) => res.sendFile(path.join(__dirname, '../public/clubs.html')));
app.get('/clubs/:id',  (req, res) => res.sendFile(path.join(__dirname, '../public/clubs.html')));

app.get('/api/clubs', (req, res) => {
  res.json([...clubs].sort((a, b) => (b.memberCount || 0) - (a.memberCount || 0)).map(c => ({
    id: c.id, name: c.name, description: c.description, memberCount: c.memberCount || 0,
    admins: c.admins || [], members: c.members || [], createdBy: c.createdBy, createdAt: c.createdAt, official: !!c.official,
  })));
});

app.get('/api/clubs/:id', (req, res) => {
  const club = clubs.find(c => c.id === req.params.id);
  if (!club) return res.status(404).json({ error: 'Клуб не найден' });
  res.json(club);
});

app.post('/api/clubs', authMiddleware, rateLimit(limiterStrict), async (req, res) => {
  const me = await getUser(req.user.username.toLowerCase());
  if (!me) return res.status(404).json({ error: 'Пользователь не найден' });
  if (me.banned) return res.status(403).json({ error: 'Вы заблокированы' });
  const { name, description } = req.body;
  if (!name || typeof name !== 'string') return res.status(400).json({ error: 'Укажите название' });
  const trimmedName = name.trim();
  if (trimmedName.length < 2 || trimmedName.length > 40) return res.status(400).json({ error: 'Название: 2–40 символов' });
  const normName = trimmedName.toLowerCase().replace(/[^a-zа-яё0-9]/gi, '');
  if (normName.includes('chesshome')) return res.status(400).json({ error: 'Название клуба не может содержать "ChessHome"' });
  const createdByMe = clubs.filter(c => c.createdBy.toLowerCase() === me.username.toLowerCase()).length;
  if (createdByMe >= 5) return res.status(400).json({ error: 'Нельзя создавать более 5 клубов' });
  const memberOf = clubs.filter(c => (c.members || []).map(m => m.toLowerCase()).includes(me.username.toLowerCase())).length;
  if (memberOf >= 10) return res.status(400).json({ error: 'Вы уже состоите в 10 клубах (максимум)' });
  if (clubs.find(c => c.name.toLowerCase() === trimmedName.toLowerCase())) return res.status(400).json({ error: 'Клуб с таким названием уже существует' });
  const id = uuidv4();
  const club = { id, name: trimmedName, description: (description || '').toString().trim().slice(0, 500), createdAt: new Date().toISOString(), createdBy: me.username, admins: [me.username], members: [me.username], memberCount: 1, official: false };
  clubs.push(club);
  await saveClub(club);
  res.json(club);
});

app.post('/api/clubs/:id/join', authMiddleware, rateLimit(limiterStrict), async (req, res) => {
  const me = await getUser(req.user.username.toLowerCase());
  if (!me || me.banned) return res.status(403).json({ error: 'Нет доступа' });
  const club = clubs.find(c => c.id === req.params.id);
  if (!club) return res.status(404).json({ error: 'Клуб не найден' });
  const lname = me.username.toLowerCase();
  if ((club.members || []).map(m => m.toLowerCase()).includes(lname)) return res.status(400).json({ error: 'Вы уже в этом клубе' });
  const memberOf = clubs.filter(c => (c.members || []).map(m => m.toLowerCase()).includes(lname)).length;
  if (memberOf >= 10) return res.status(400).json({ error: 'Вы уже в 10 клубах (максимум)' });
  club.members = club.members || []; club.members.push(me.username); club.memberCount = club.members.length;
  // Если вступает создатель клуба, а он ранее выпал из admins (например, после
  // выхода/повторного входа) — возвращаем ему права администратора клуба.
  if ((club.createdBy || '').toLowerCase() === lname) {
    club.admins = club.admins || [];
    if (!club.admins.map(a => a.toLowerCase()).includes(lname)) club.admins.push(me.username);
  }
  await saveClub(club);
  res.json({ ok: true, memberCount: club.memberCount });
});

// ──────────────────────────────────────────────────────────────
//  User Emoji
// ──────────────────────────────────────────────────────────────

app.post('/api/user/emoji', authMiddleware, async (req, res) => {
  try {
    const { emoji } = req.body;
    if (typeof emoji !== 'string' || emoji.length > 10) return res.status(400).json({ error: 'Неверный эмодзи' });
    const forbidden = ['🏳️‍🌈', '🏳️‍⚧️', '🌈', '⚧️', '🏳️‍🌈', '🏳️‍⚧️'];
    if (forbidden.includes(emoji) || emoji.includes('🌈') || emoji.includes('⚧') || emoji.includes('🏳️')) {
      return res.status(400).json({ error: 'Этот эмодзи запрещён' });
    }
    const userId = req.user.userId;
    await db('UPDATE users SET emoji = $1 WHERE id = $2', [emoji, userId]);
    const user = await getUser(req.user.username.toLowerCase());
    if (user) user.emoji = emoji;
    res.json({ ok: true, emoji });
  } catch (err) {
    console.error('[Emoji update]', err);
    res.status(500).json({ error: 'Ошибка при сохранении эмодзи' });
  }
});

// ──────────────────────────────────────────────────────────────
//  User Profile (описание + внешние рейтинги ФШР/FIDE)
// ──────────────────────────────────────────────────────────────

app.post('/api/user/profile', authMiddleware, async (req, res) => {
  try {
    let { bio, fshrRating, fideRating } = req.body;

    if (bio != null && typeof bio !== 'string') return res.status(400).json({ error: 'Неверное описание' });
    bio = (bio || '').slice(0, 400);

    for (const [label, val] of [['ФШР', fshrRating], ['FIDE', fideRating]]) {
      if (val !== null && val !== undefined && (!Number.isFinite(val) || val < 0 || val > 4000)) {
        return res.status(400).json({ error: `Рейтинг ${label} должен быть числом от 0 до 4000` });
      }
    }
    fshrRating = (fshrRating === '' || fshrRating === undefined) ? null : fshrRating;
    fideRating = (fideRating === '' || fideRating === undefined) ? null : fideRating;

    const user = await getUser(req.user.username.toLowerCase());
    if (!user) return res.status(404).json({ error: 'Пользователь не найден' });

    user.bio = bio;
    user.fshrRating = fshrRating === null ? null : Number(fshrRating);
    user.fideRating = fideRating === null ? null : Number(fideRating);
    await saveUser(user);

    res.json({ bio: user.bio, fshrRating: user.fshrRating, fideRating: user.fideRating });
  } catch (err) {
    console.error('[Profile update]', err);
    res.status(500).json({ error: 'Ошибка при сохранении профиля' });
  }
});

app.post('/api/clubs/:id/leave', authMiddleware, async (req, res) => {
  const me = await getUser(req.user.username.toLowerCase());
  const club = clubs.find(c => c.id === req.params.id);
  if (!club) return res.status(404).json({ error: 'Клуб не найден' });
  const lname = me.username.toLowerCase();
  const idx = (club.members || []).findIndex(m => m.toLowerCase() === lname);
  if (idx === -1) return res.status(400).json({ error: 'Вы не в этом клубе' });
  if (club.official && club.createdBy.toLowerCase() === lname) return res.status(403).json({ error: 'Создатель официального клуба не может выйти' });
  club.members.splice(idx, 1);
  const aidx = (club.admins || []).findIndex(a => a.toLowerCase() === lname);
  if (aidx !== -1) club.admins.splice(aidx, 1);
  club.memberCount = club.members.length;
  if (club.memberCount === 0 && !club.official && (club.createdBy || '').toLowerCase() !== 'tester') {
    const ci = clubs.findIndex(c => c.id === club.id);
    if (ci !== -1) { clubs.splice(ci, 1); await deleteClubFromDB(club.id); return res.json({ ok: true }); }
  }
  await saveClub(club);
  res.json({ ok: true });
});

async function handleEditClub(req, res) {
  const me = await getUser(req.user.username.toLowerCase());
  if (!me) return res.status(404).json({ error: 'Не найден' });
  const club = clubs.find(c => c.id === req.params.id);
  if (!club) return res.status(404).json({ error: 'Клуб не найден' });
  const isClubAdmin = (club.admins || []).map(a => a.toLowerCase()).includes(me.username.toLowerCase());
  const isSuperAdmin = me.username.toLowerCase() === 'chesshome' || me.role === 'admin';
  if (!isClubAdmin && !isSuperAdmin) return res.status(403).json({ error: 'Нет прав' });
  if (req.body.description !== undefined) club.description = req.body.description.toString().trim().slice(0, 500);
  await saveClub(club);
  res.json({ ok: true, club });
}
app.patch('/api/clubs/:id', authMiddleware, handleEditClub);
// POST-дублёр на случай хостингов/прокси, которые режут метод PATCH
// (см. аналогичный комментарий у /api/tournaments/:id/edit выше).
app.post('/api/clubs/:id/edit', authMiddleware, handleEditClub);

app.post('/api/clubs/:id/kick', authMiddleware, async (req, res) => {
  const me = await getUser(req.user.username.toLowerCase());
  if (!me) return res.status(404).json({ error: 'Не найден' });
  const club = clubs.find(c => c.id === req.params.id);
  if (!club) return res.status(404).json({ error: 'Клуб не найден' });
  const isClubAdmin = (club.admins || []).map(a => a.toLowerCase()).includes(me.username.toLowerCase());
  const isSuperAdmin = me.username.toLowerCase() === 'chesshome' || me.role === 'admin';
  if (!isClubAdmin && !isSuperAdmin) return res.status(403).json({ error: 'Нет прав' });
  const { username } = req.body;
  if (!username) return res.status(400).json({ error: 'Укажите username' });
  const target = username.toLowerCase();
  if (club.official && club.createdBy.toLowerCase() === target) return res.status(403).json({ error: 'Нельзя кикнуть создателя официального клуба' });
  const idx = (club.members || []).findIndex(m => m.toLowerCase() === target);
  if (idx === -1) return res.status(400).json({ error: 'Пользователь не в клубе' });
  const targetIsAdmin = (club.admins || []).map(a => a.toLowerCase()).includes(target);
  if (targetIsAdmin && !isSuperAdmin) return res.status(403).json({ error: 'Нельзя кикнуть администратора клуба' });
  club.members.splice(idx, 1);
  const aidx = (club.admins || []).findIndex(a => a.toLowerCase() === target);
  if (aidx !== -1) club.admins.splice(aidx, 1);
  club.memberCount = club.members.length;
  if (club.memberCount === 0 && !club.official && (club.createdBy || '').toLowerCase() !== 'tester') {
    clubs.splice(clubs.findIndex(c => c.id === club.id), 1); await deleteClubFromDB(club.id); return res.json({ ok: true });
  }
  await saveClub(club);
  res.json({ ok: true });
});

app.post('/api/clubs/:id/promote', authMiddleware, async (req, res) => {
  const me = await getUser(req.user.username.toLowerCase());
  if (!me) return res.status(404).json({ error: 'Не найден' });
  const club = clubs.find(c => c.id === req.params.id);
  if (!club) return res.status(404).json({ error: 'Клуб не найден' });
  const isCreator = club.createdBy.toLowerCase() === me.username.toLowerCase();
  const isSuperAdmin = me.username.toLowerCase() === 'chesshome' || me.role === 'admin';
  if (!isCreator && !isSuperAdmin) return res.status(403).json({ error: 'Только создатель может назначать администраторов' });
  const { username } = req.body;
  if (!username) return res.status(400).json({ error: 'Укажите username' });
  const targetUser = await getUser(username.toLowerCase());
  if (!targetUser) return res.status(404).json({ error: 'Пользователь не найден' });
  if (targetUser.banned) return res.status(403).json({ error: 'Нельзя назначить забаненного администратором' });
  if (!(club.members || []).map(m => m.toLowerCase()).includes(username.toLowerCase())) return res.status(400).json({ error: 'Пользователь не в клубе' });
  if ((club.admins || []).map(a => a.toLowerCase()).includes(username.toLowerCase())) return res.status(400).json({ error: 'Уже является администратором' });
  if ((club.admins || []).length >= 3) return res.status(400).json({ error: 'Максимум 3 администратора на клуб' });
  club.admins = club.admins || []; club.admins.push(targetUser.username);
  await saveClub(club); res.json({ ok: true });
});

app.post('/api/clubs/:id/demote', authMiddleware, async (req, res) => {
  const me = await getUser(req.user.username.toLowerCase());
  if (!me) return res.status(404).json({ error: 'Не найден' });
  const club = clubs.find(c => c.id === req.params.id);
  if (!club) return res.status(404).json({ error: 'Клуб не найден' });
  const isCreator = club.createdBy.toLowerCase() === me.username.toLowerCase();
  const isSuperAdmin = me.username.toLowerCase() === 'chesshome' || me.role === 'admin';
  if (!isCreator && !isSuperAdmin) return res.status(403).json({ error: 'Нет прав' });
  const target = (req.body.username || '').toLowerCase();
  if (club.createdBy.toLowerCase() === target) return res.status(403).json({ error: 'Нельзя снять создателя' });
  const aidx = (club.admins || []).findIndex(a => a.toLowerCase() === target);
  if (aidx === -1) return res.status(400).json({ error: 'Пользователь не является администратором' });
  club.admins.splice(aidx, 1); await saveClub(club); res.json({ ok: true });
});

async function handleDeleteClub(req, res) {
  const me = await getUser(req.user.username.toLowerCase());
  if (!me) return res.status(404).json({ error: 'Не найден' });
  const idx = clubs.findIndex(c => c.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Клуб не найден' });
  const club = clubs[idx];
  const isCreator = club.createdBy.toLowerCase() === me.username.toLowerCase();
  const isSuperAdmin = me.username.toLowerCase() === 'chesshome' || me.role === 'admin';
  if (!isCreator && !isSuperAdmin) return res.status(403).json({ error: 'Нет прав' });
  if (club.official && !isSuperAdmin) return res.status(403).json({ error: 'Нельзя удалить официальный клуб' });
  clubs.splice(idx, 1); await deleteClubFromDB(club.id); res.json({ ok: true });
}
app.delete('/api/clubs/:id', authMiddleware, handleDeleteClub);
app.post('/api/clubs/:id/delete', authMiddleware, handleDeleteClub);

// ── Club Chat API ──────────────────────────────────────────────
app.get('/api/clubs/:id/chat', authMiddleware, (req, res) => {
  const club = clubs.find(c => c.id === req.params.id);
  if (!club) return res.status(404).json({ error: 'Клуб не найден' });
  const me = req.user;
  if (!canWriteInClubChat(club, me.username) && !isClubModerator(club, me.username)) {
    return res.status(403).json({ error: 'Только участники клуба могут читать чат' });
  }
  const msgs = getClubChat(club.id);
  const bans = getClubChatBans(club.id);
  const myBan = bans.get(me.username.toLowerCase());
  res.json({ messages: msgs.slice(-CLUB_CHAT_MAX), myBan: myBan || null });
});

app.post('/api/clubs/:id/chat', authMiddleware, rateLimit(limiterStrict), (req, res) => {
  const club = clubs.find(c => c.id === req.params.id);
  if (!club) return res.status(404).json({ error: 'Клуб не найден' });
  const me = req.user;
  if (!canWriteInClubChat(club, me.username)) return res.status(403).json({ error: 'Только участники клуба могут писать в чат' });
  const bans = getClubChatBans(club.id);
  const myBan = bans.get(me.username.toLowerCase());
  if (myBan) {
    if (myBan.permanent) return res.status(403).json({ error: 'Вы заблокированы в чате этого клуба' });
    if (myBan.until > Date.now()) return res.status(403).json({ error: 'Вы временно заблокированы', until: myBan.until });
    bans.delete(me.username.toLowerCase());
  }
  const text = (req.body.message || '').toString().trim().slice(0, 300);
  if (!text) return res.status(400).json({ error: 'Пустое сообщение' });
  const msg = { id: require('crypto').randomUUID(), username: me.username, role: me.role || 'user', message: text, timestamp: Date.now() };
  const chat = getClubChat(club.id);
  chat.push(msg);
  if (chat.length > CLUB_CHAT_MAX) chat.shift();
  saveClubChatMsg(club.id, msg);
  io.to('club_' + club.id).emit('club_chat_msg', { clubId: club.id, msg });
  res.json({ ok: true, msg });
});

app.post('/api/clubs/:id/chat-ban', authMiddleware, async (req, res) => {
  const club = clubs.find(c => c.id === req.params.id);
  if (!club) return res.status(404).json({ error: 'Клуб не найден' });
  const me = req.user;
  if (!isClubModerator(club, me.username)) return res.status(403).json({ error: 'Нет прав' });
  const { username, type } = req.body;
  if (!username) return res.status(400).json({ error: 'Нет имени пользователя' });
  const target = username.toLowerCase();
  if (isSiteAdmin(target)) return res.status(403).json({ error: 'Нельзя заблокировать администратора' });
  const targetIsClubAdmin = (club.admins || []).map(a => a.toLowerCase()).includes(target);
  if (targetIsClubAdmin && !isSiteAdmin(me.username)) return res.status(403).json({ error: 'Нельзя заблокировать администратора клуба' });

  const bans = getClubChatBans(club.id);
  const chat = getClubChat(club.id);

  if (type === 'mute') {
    bans.set(target, { until: Date.now() + 15 * 60 * 1000, permanent: false });
    for (let i = chat.length - 1; i >= 0; i--) {
      if ((chat[i].username || '').toLowerCase() === target) chat.splice(i, 1);
    }
    deleteClubChatMsgsByUser(club.id, target);
    const sysMsg = { id: require('crypto').randomUUID(), username: 'system', role: 'system', message: `Администратор заглушил ${username} на 15 минут. Смотрите правила клуба.`, timestamp: Date.now(), system: true };
    chat.push(sysMsg); if (chat.length > CLUB_CHAT_MAX) chat.shift();
    saveClubChatMsg(club.id, sysMsg);
    io.to('club_' + club.id).emit('club_chat_user_banned', { clubId: club.id, username, sysMsg });
    return res.json({ ok: true });
  }

  bans.set(target, { until: Infinity, permanent: true });
  for (let i = chat.length - 1; i >= 0; i--) {
    if ((chat[i].username || '').toLowerCase() === target) chat.splice(i, 1);
  }
  deleteClubChatMsgsByUser(club.id, target);
  const sysMsg = { id: require('crypto').randomUUID(), username: 'system', role: 'system', message: `Администратор заблокировал ${username}. Смотрите правила клуба.`, timestamp: Date.now(), system: true };
  chat.push(sysMsg); if (chat.length > CLUB_CHAT_MAX) chat.shift();
  saveClubChatMsg(club.id, sysMsg);
  io.to('club_' + club.id).emit('club_chat_user_banned', { clubId: club.id, username, sysMsg });
  res.json({ ok: true });
});

app.post('/api/clubs/:id/chat-unban', authMiddleware, (req, res) => {
  const club = clubs.find(c => c.id === req.params.id);
  if (!club) return res.status(404).json({ error: 'Клуб не найден' });
  const me = req.user;
  if (!isClubModerator(club, me.username)) return res.status(403).json({ error: 'Нет прав' });
  const { username } = req.body;
  if (!username) return res.status(400).json({ error: 'Нет имени' });
  getClubChatBans(club.id).delete(username.toLowerCase());
  res.json({ ok: true });
});

app.post('/api/clubs/:id/chat-report', authMiddleware, (req, res) => {
  const club = clubs.find(c => c.id === req.params.id);
  if (!club) return res.status(404).json({ error: 'Клуб не найден' });
  const me = req.user;
  const { msgId, reason } = req.body;
  for (const [, sess] of sessions) {
    const u = usersCache.get(sess.username.toLowerCase());
    if (u?.role === 'admin' || isClubModerator(club, sess.username)) {
      const s = findSocketByUsername(sess.username);
      if (s) s.emit('club_chat_report', { clubId: club.id, clubName: club.name, msgId, from: me.username, reason: reason || '' });
    }
  }
  res.json({ ok: true });
});

app.get('/api/users/:username/clubs', (req, res) => {
  const uname = req.params.username.toLowerCase();
  const userClubs = clubs.filter(c => (c.members || []).map(m => m.toLowerCase()).includes(uname));
  res.json(userClubs.map(c => ({ id: c.id, name: c.name, description: c.description, memberCount: c.memberCount || 0, admins: c.admins || [], members: c.members || [], createdBy: c.createdBy, official: !!c.official })));
});

// ══════════════════════════════════════════════════════════════
//  PUZZLE API
// ══════════════════════════════════════════════════════════════

async function initPuzzleTables() {
  try {
    await db(`CREATE TABLE IF NOT EXISTS puzzles (
      id TEXT PRIMARY KEY, title TEXT NOT NULL, description TEXT,
      fen TEXT NOT NULL, solution TEXT NOT NULL, topic TEXT NOT NULL,
      difficulty TEXT DEFAULT 'medium', created_by TEXT DEFAULT 'system',
      created_at BIGINT DEFAULT (EXTRACT(EPOCH FROM NOW())*1000)::BIGINT,
      play_count INT DEFAULT 0, correct_count INT DEFAULT 0
    )`);
    await db(`CREATE TABLE IF NOT EXISTS puzzle_topics (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, icon TEXT NOT NULL,
      description TEXT, sort_order INT DEFAULT 0
    )`);
    await db(`CREATE TABLE IF NOT EXISTS puzzle_attempts (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL, puzzle_id TEXT NOT NULL,
      correct BOOLEAN NOT NULL,
      created_at BIGINT DEFAULT (EXTRACT(EPOCH FROM NOW())*1000)::BIGINT,
      UNIQUE(user_id, puzzle_id)
    )`);
    await db(`ALTER TABLE users ADD COLUMN IF NOT EXISTS puzzle_rating INT DEFAULT 1200`);
    await db(`ALTER TABLE users ADD COLUMN IF NOT EXISTS puzzle_solved INT DEFAULT 0`);
    await db(`ALTER TABLE users ADD COLUMN IF NOT EXISTS puzzle_attempted INT DEFAULT 0`);
    await db(`CREATE INDEX IF NOT EXISTS idx_puzzles_topic ON puzzles(topic)`);
    await db(`CREATE INDEX IF NOT EXISTS idx_puzzle_attempts_user ON puzzle_attempts(user_id)`);
    const topics = [
      ['mate1','Мат в 1 ход','♟','Найди единственный ход, ставящий мат',1],
      ['mate2','Мат в 2 хода','♞','Комбинация из двух ходов с матом',2],
      ['fork','Вилка','⚔️','Атакуй две фигуры одновременно',3],
      ['pin','Связка','📌','Обездвижь фигуру соперника',4],
      ['skewer','Рентген','🎯','Атакуй сильную фигуру через слабую',5],
      ['discovery','Открытый удар','💥','Открой атаку своей фигурой',6],
      ['endgame','Эндшпиль','👑','Техническое завершение партии',7],
      ['tactics','Тактика','⚡','Разные тактические мотивы',8],
    ];
    for (const [id,name,icon,desc,order] of topics) {
      await db(`INSERT INTO puzzle_topics (id,name,icon,description,sort_order) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (id) DO NOTHING`,[id,name,icon,desc,order]);
    }
    await db(`CREATE TABLE IF NOT EXISTS puzzle_storm_runs (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      username TEXT NOT NULL,
      score INT NOT NULL DEFAULT 0,
      total_attempted INT NOT NULL DEFAULT 0,
      correct INT NOT NULL DEFAULT 0,
      wrong INT NOT NULL DEFAULT 0,
      time_bonus INT NOT NULL DEFAULT 0,
      created_at BIGINT DEFAULT (EXTRACT(EPOCH FROM NOW())*1000)::BIGINT
    )`);
    await db(`CREATE INDEX IF NOT EXISTS idx_storm_user ON puzzle_storm_runs(user_id)`);
    await db(`CREATE INDEX IF NOT EXISTS idx_storm_score ON puzzle_storm_runs(score DESC)`);
    await db(`ALTER TABLE users ADD COLUMN IF NOT EXISTS storm_best INT DEFAULT 0`);
    await db(`ALTER TABLE users ADD COLUMN IF NOT EXISTS storm_runs INT DEFAULT 0`);
    await db(`ALTER TABLE users ADD COLUMN IF NOT EXISTS emoji TEXT DEFAULT ''`);
    console.log('[Puzzles] Таблицы инициализированы');
  } catch(e) { console.error('[Puzzles] init error:', e.message); }
}

app.get('/api/puzzles/leaderboard', async (req, res) => {
  try {
    const r = await db(`SELECT username,puzzle_rating,puzzle_solved,puzzle_attempted,role FROM users WHERE puzzle_attempted > 0 ORDER BY puzzle_rating DESC LIMIT 50`);
    res.json(r.rows.map((row,i) => ({
      rank: i+1, username: row.username,
      puzzleRating: row.puzzle_rating||1200,
      puzzleSolved: row.puzzle_solved||0,
      puzzleAttempted: row.puzzle_attempted||0,
      accuracy: (row.puzzle_attempted||0)>0 ? Math.round((row.puzzle_solved||0)/row.puzzle_attempted*100) : 0,
      role: row.role,
    })));
  } catch(e) { res.status(500).json({ error: 'Ошибка' }); }
});

app.get('/api/puzzles/topics', async (req, res) => {
  try {
    const r = await db(`SELECT pt.*, COUNT(p.id) as puzzle_count FROM puzzle_topics pt LEFT JOIN puzzles p ON p.topic=pt.id GROUP BY pt.id ORDER BY pt.sort_order ASC`);
    res.json(r.rows.map(row => ({
      id: row.id, name: row.name, icon: row.icon,
      description: row.description, puzzleCount: Number(row.puzzle_count||0)
    })));
  } catch(e) { res.status(500).json({ error: 'Ошибка' }); }
});

// ══════════════════════════════════════════════════════════════
//  DURKA — сводный лидерборд по результатам lichess-турниров
// ══════════════════════════════════════════════════════════════
//  Как это работает:
//  1) durka_tournaments      — какие турниры уже засчитаны (защита от повторного начисления).
//  2) durka_tournament_results — очки каждого игрока в каждом отдельном турнире (для истории/аудита).
//  3) durka_players          — сумма очков по всем засчитанным турнирам (то, что видно на /durka).
//
//  Очки закидывает скрипт hi.py, который дергает Lichess API и шлёт
//  результат сюда через POST /api/durka/add-tournament с секретным
//  ключом в заголовке x-durka-key (см. DURKA_ADMIN_KEY в .env).
//  Обычная сессия/логин тут не нужен — скрипт работает с сервера напрямую.

async function initDurkaTables() {
  try {
    await db(`CREATE TABLE IF NOT EXISTS durka_players (
      username_low TEXT PRIMARY KEY,
      username     TEXT NOT NULL,
      points       INT NOT NULL DEFAULT 0,
      tournaments  INT NOT NULL DEFAULT 0,
      updated_at   BIGINT NOT NULL
    )`);
    await db(`CREATE INDEX IF NOT EXISTS idx_durka_players_points ON durka_players(points DESC)`);

    await db(`CREATE TABLE IF NOT EXISTS durka_tournaments (
      id           TEXT PRIMARY KEY,
      name         TEXT,
      url          TEXT,
      players      INT NOT NULL DEFAULT 0,
      added_by     TEXT,
      created_at   BIGINT NOT NULL
    )`);

    await db(`CREATE TABLE IF NOT EXISTS durka_tournament_results (
      tournament_id TEXT NOT NULL,
      username_low  TEXT NOT NULL,
      username      TEXT NOT NULL,
      points        INT NOT NULL DEFAULT 0,
      rank          INT,
      PRIMARY KEY (tournament_id, username_low)
    )`);
    await db(`CREATE INDEX IF NOT EXISTS idx_durka_results_tournament ON durka_tournament_results(tournament_id)`);

    console.log('[Durka] Таблицы инициализированы');
  } catch(e) { console.error('[Durka] init error:', e.message); }
}

// Публичный лидерборд — сумма очков по всем засчитанным турнирам.
app.get('/api/durka/leaderboard', async (req, res) => {
  try {
    const r = await db(`SELECT username, points, tournaments FROM durka_players WHERE points > 0 ORDER BY points DESC, tournaments DESC LIMIT 200`);
    res.json(r.rows.map((row, i) => ({
      rank: i + 1,
      username: row.username,
      points: Number(row.points) || 0,
      tournaments: Number(row.tournaments) || 0,
    })));
  } catch(e) { res.status(500).json({ error: 'Ошибка' }); }
});

// Список уже засчитанных турниров — чтобы видеть историю на странице.
app.get('/api/durka/tournaments', async (req, res) => {
  try {
    const r = await db(`SELECT id, name, url, players, created_at FROM durka_tournaments ORDER BY created_at DESC LIMIT 100`);
    res.json(r.rows.map(row => ({
      id: row.id, name: row.name, url: row.url,
      players: Number(row.players) || 0,
      createdAt: Number(row.created_at),
    })));
  } catch(e) { res.status(500).json({ error: 'Ошибка' }); }
});

// Проверка секретного ключа скрипта (НЕ обычная сессия пользователя).
function durkaKeyMiddleware(req, res, next) {
  const key = process.env.DURKA_ADMIN_KEY;
  if (!key) return res.status(500).json({ error: 'DURKA_ADMIN_KEY не настроен на сервере' });
  if (req.headers['x-durka-key'] !== key) return res.status(403).json({ error: 'Неверный ключ' });
  next();
}

// Приём результатов одного турнира от hi.py.
// body: { tournamentId, name, url, results: [{ username, points, rank }] }
app.post('/api/durka/add-tournament', durkaKeyMiddleware, async (req, res) => {
  try {
    const { tournamentId, name, url, results } = req.body || {};
    if (!tournamentId || !Array.isArray(results) || !results.length) {
      return res.status(400).json({ error: 'tournamentId и results обязательны' });
    }

    const already = await db(`SELECT id FROM durka_tournaments WHERE id = $1`, [tournamentId]);
    if (already.rows.length && req.query.force !== '1') {
      return res.status(409).json({ error: 'Этот турнир уже засчитан в лидерборд', tournamentId });
    }

    const cleaned = results
      .map(r => ({
        username: String(r.username || '').trim(),
        points: Number(r.points) || 0,
        rank: r.rank != null ? Number(r.rank) : null,
      }))
      .filter(r => r.username);

    if (!cleaned.length) return res.status(400).json({ error: 'Пустой список результатов' });

    await withTransaction(async (client) => {
      // Если пересчитываем турнир (force=1) — сначала вычитаем его старый вклад.
      if (already.rows.length) {
        const old = await client.query(`SELECT username_low, points FROM durka_tournament_results WHERE tournament_id = $1`, [tournamentId]);
        for (const row of old.rows) {
          await client.query(
            `UPDATE durka_players SET points = GREATEST(points - $1, 0), tournaments = GREATEST(tournaments - 1, 0) WHERE username_low = $2`,
            [row.points, row.username_low]
          );
        }
        await client.query(`DELETE FROM durka_tournament_results WHERE tournament_id = $1`, [tournamentId]);
      }

      for (const r of cleaned) {
        const usernameLow = r.username.toLowerCase();
        await client.query(
          `INSERT INTO durka_tournament_results (tournament_id, username_low, username, points, rank)
           VALUES ($1, $2, $3, $4, $5)`,
          [tournamentId, usernameLow, r.username, r.points, r.rank]
        );
        await client.query(
          `INSERT INTO durka_players (username_low, username, points, tournaments, updated_at)
           VALUES ($1, $2, $3, 1, $4)
           ON CONFLICT (username_low) DO UPDATE SET
             username = EXCLUDED.username,
             points = durka_players.points + EXCLUDED.points,
             tournaments = durka_players.tournaments + 1,
             updated_at = EXCLUDED.updated_at`,
          [usernameLow, r.username, r.points, Date.now()]
        );
      }

      await client.query(
        `INSERT INTO durka_tournaments (id, name, url, players, added_by, created_at)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, url = EXCLUDED.url, players = EXCLUDED.players, created_at = durka_tournaments.created_at`,
        [tournamentId, name || tournamentId, url || null, cleaned.length, 'hi.py', Date.now()]
      );
    });

    console.log(`[Durka] Турнир ${tournamentId} засчитан: ${cleaned.length} игроков`);
    res.json({ ok: true, tournamentId, playersAdded: cleaned.length });
  } catch(e) {
    console.error('[Durka] add-tournament error:', e.message);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

app.get('/api/puzzles/daily', async (req, res) => {
  try {
    const r = await db('SELECT * FROM puzzles ORDER BY created_at ASC');
    if (!r.rows.length) return res.json(null);
    const puzzle = r.rows[Math.floor(Date.now()/(24*60*60*1000)) % r.rows.length];
    res.json({ id:puzzle.id, title:puzzle.title, description:puzzle.description, fen:puzzle.fen, topic:puzzle.topic, difficulty:puzzle.difficulty });
  } catch(e) { res.status(500).json({ error: 'Ошибка' }); }
});

app.get('/api/puzzles', async (req, res) => {
  try {
    const { topic, difficulty, limit=20, offset=0 } = req.query;
    const lim = Math.min(50, parseInt(limit)||20);
    const off = parseInt(offset)||0;

    let userId = null;
    const ah = getAuthToken(req);
    if (ah) {
      try {
        const dec = jwt.verify(ah, JWT_SECRET);
        const u = await getUser(dec.username.toLowerCase());
        if (u) userId = u.id;
      } catch {}
    }

    let sql, params, solvedSet = new Set(), attemptedSet = new Set();

    if (userId) {
      const conditions = ['1=1'];
      params = [userId];
      let i = 2;
      if (topic)      { conditions.push(`p.topic=$${i++}`);      params.push(topic); }
      if (difficulty) { conditions.push(`p.difficulty=$${i++}`); params.push(difficulty); }
      params.push(lim, off);

      sql = `
        SELECT p.*,
          pa.correct  AS _correct,
          pa.failed   AS _failed,
          CASE
            WHEN pa.id IS NULL        THEN 0
            WHEN pa.correct = false   THEN 1
            WHEN pa.correct = true    THEN 2
            ELSE 0
          END AS _sort_priority
        FROM puzzles p
        LEFT JOIN puzzle_attempts pa ON pa.puzzle_id = p.id AND pa.user_id = $1
        WHERE ${conditions.join(' AND ')}
        ORDER BY _sort_priority ASC, p.created_at ASC
        LIMIT $${i++} OFFSET $${i++}
      `;

      const r = await db(sql, params);

      const att = await db('SELECT puzzle_id, correct FROM puzzle_attempts WHERE user_id=$1', [userId]);
      for (const a of att.rows) {
        if (a.correct) solvedSet.add(a.puzzle_id);
        else attemptedSet.add(a.puzzle_id);
      }

      return res.json(r.rows.map(row => ({
        id: row.id, title: row.title, description: row.description,
        fen: row.fen, topic: row.topic, difficulty: row.difficulty,
        playCount: row.play_count, correctCount: row.correct_count,
        userStatus: solvedSet.has(row.id) ? 'solved' : attemptedSet.has(row.id) ? 'attempted' : 'new',
      })));
    }

    const conditions = ['1=1'];
    params = []; let i = 1;
    if (topic)      { conditions.push(`topic=$${i++}`);      params.push(topic); }
    if (difficulty) { conditions.push(`difficulty=$${i++}`); params.push(difficulty); }
    params.push(lim, off);
    sql = `SELECT * FROM puzzles WHERE ${conditions.join(' AND ')} ORDER BY created_at ASC LIMIT $${i++} OFFSET $${i++}`;
    const r = await db(sql, params);
    return res.json(r.rows.map(row => ({
      id: row.id, title: row.title, description: row.description,
      fen: row.fen, topic: row.topic, difficulty: row.difficulty,
      playCount: row.play_count, correctCount: row.correct_count,
      userStatus: 'new',
    })));

  } catch(e) { console.error('[Puzzles]', e.message); res.status(500).json({ error: 'Ошибка' }); }
});

app.get('/api/puzzles/:id', async (req, res) => {
  try {
    const r = await db('SELECT * FROM puzzles WHERE id=$1',[req.params.id]);
    if (!r.rows[0]) return res.status(404).json({ error: 'Не найдена' });
    const p = r.rows[0];
    res.json({ id:p.id, title:p.title, description:p.description, fen:p.fen, topic:p.topic, difficulty:p.difficulty, playCount:p.play_count, correctCount:p.correct_count });
  } catch(e) { res.status(500).json({ error: 'Ошибка' }); }
});

function parsePuzzleSolution(solution) {
  const all = (solution || '').trim().toLowerCase().split(/\s+/).filter(Boolean);
  const playerMoves = all.filter((_, i) => i % 2 === 0);
  const autoMoves   = all.filter((_, i) => i % 2 === 1);
  return { all, playerMoves, autoMoves };
}

app.post('/api/puzzles/:id/move', authMiddleware, rateLimit(limiterStrict), async (req, res) => {
  try {
    const { moveIndex, move } = req.body;
    if (move === undefined || moveIndex === undefined) return res.status(400).json({ error: 'Укажите move и moveIndex' });
    const r = await db('SELECT * FROM puzzles WHERE id=$1', [req.params.id]);
    if (!r.rows[0]) return res.status(404).json({ error: 'Задача не найдена' });
    const puzzle = r.rows[0];
    const { playerMoves, autoMoves } = parsePuzzleSolution(puzzle.solution);

    const expectedRaw = playerMoves[moveIndex];
    if (!expectedRaw) return res.status(400).json({ error: 'Некорректный moveIndex' });
    const playerMove    = (move || '').toLowerCase().trim();
    const acceptedMoves = expectedRaw.split('|').map(m => m.trim());
    let correct = acceptedMoves.includes(playerMove)
      || acceptedMoves.some(m => m.length===4 && playerMove.startsWith(m))
      || acceptedMoves.some(m => m.length===5 && m.endsWith('q') && playerMove===m.slice(0,4));
    if (!correct) return res.json({ correct: false, solution: puzzle.solution });
    const autoMove = autoMoves[moveIndex] || null;
    const finished = moveIndex >= playerMoves.length - 1;
    res.json({ correct: true, autoMove, finished, solution: finished ? puzzle.solution : null });
  } catch(e) { console.error('[Puzzle move]', e.message); res.status(500).json({ error: 'Ошибка' }); }
});

app.post('/api/puzzles/:id/attempt', authMiddleware, rateLimit(limiterStrict), async (req, res) => {
  try {
    const { correct: clientCorrect, moves } = req.body;

    const r = await db('SELECT * FROM puzzles WHERE id=$1', [req.params.id]);
    if (!r.rows[0]) return res.status(404).json({ error: 'Задача не найдена' });
    const puzzle = r.rows[0];

    let correct;
    if (typeof clientCorrect === 'boolean') {
      correct = clientCorrect;
    } else if (Array.isArray(moves)) {
      const { playerMoves } = parsePuzzleSolution(puzzle.solution);
      const userPlayerMoves = moves.filter((_, i) => i % 2 === 0);
      correct = playerMoves.length > 0 &&
        userPlayerMoves.length === playerMoves.length &&
        playerMoves.every((m, i) => {
          const variants = m.split('|').map(v => v.trim());
          const played   = (userPlayerMoves[i] || '').toLowerCase().trim();
          return variants.includes(played)
            || variants.some(v => v.length===4 && played.startsWith(v))
            || variants.some(v => v.length===5 && v.endsWith('q') && played===v.slice(0,4));
        });
    } else {
      return res.status(400).json({ error: 'Укажите correct или moves' });
    }

    const user = await getUser(req.user.username.toLowerCase());
    if (!user) return res.status(404).json({ error: 'Пользователь не найден' });

    const existing = await db('SELECT correct FROM puzzle_attempts WHERE user_id=$1 AND puzzle_id=$2', [user.id, puzzle.id]);
    const alreadySolved = existing.rows[0]?.correct;

    if (!alreadySolved) {
      await db(`INSERT INTO puzzle_attempts (id,user_id,puzzle_id,correct,created_at) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (user_id,puzzle_id) DO UPDATE SET correct=$4,created_at=$5`, [uuidv4(), user.id, puzzle.id, correct, Date.now()]);
      await db('UPDATE puzzles SET play_count=play_count+1 WHERE id=$1', [puzzle.id]);
      if (correct) await db('UPDATE puzzles SET correct_count=correct_count+1 WHERE id=$1', [puzzle.id]);
      const ratingDelta = correct ? 15 : -10;
      const newRating    = Math.max(100, (user.puzzle_rating || 1200) + ratingDelta);
      const newSolved    = (user.puzzle_solved || 0) + (correct ? 1 : 0);
      const newAttempted = (user.puzzle_attempted || 0) + 1;
      await db('UPDATE users SET puzzle_rating=$1,puzzle_solved=$2,puzzle_attempted=$3 WHERE id=$4', [newRating, newSolved, newAttempted, user.id]);
      user.puzzle_rating = newRating; user.puzzle_solved = newSolved; user.puzzle_attempted = newAttempted;
      cacheUser(user);
      return res.json({ correct, solution: puzzle.solution, ratingDelta, newPuzzleRating: newRating, alreadySolved: false });
    }
    res.json({ correct: true, solution: puzzle.solution, ratingDelta: 0, newPuzzleRating: user.puzzle_rating || 1200, alreadySolved: true });
  } catch(e) { console.error('[Puzzle attempt]', e.message); res.status(500).json({ error: 'Ошибка' }); }
});

// ══════════════════════════════════════════════════════════════
//  PUZZLE STORM API
// ══════════════════════════════════════════════════════════════
app.get('/api/storm/puzzles', async (req, res) => {
  try {
    const topicsParam = req.query.topics || 'mate1,mate2';
    const topics = topicsParam.split(',').map(t => t.trim()).filter(Boolean);
    const placeholders = topics.map((_, i) => `$${i + 1}`).join(',');
    const r = await db(`SELECT id,fen,solution,topic,difficulty FROM puzzles WHERE topic IN (${placeholders}) ORDER BY RANDOM() LIMIT 80`, topics);
    res.json(r.rows);
  } catch(e) { res.status(500).json({ error: 'Ошибка' }); }
});
app.post('/api/storm/start', authMiddleware, rateLimit(limiterStrict), async (req, res) => {
  const runId = uuidv4();
  stormRuns.set(runId, { userId: req.user.userId, startedAt: Date.now() });
  res.json({ runId });
});
app.post('/api/storm/finish', authMiddleware, rateLimit(limiterStrict), async (req, res) => {
  try {
    const { score, totalAttempted, correct, wrong, timeBonus, runId } = req.body;
    if (typeof score !== 'number' || score < 0) return res.status(400).json({ error: 'Неверный score' });
    if (typeof correct !== 'number' || typeof wrong !== 'number' || correct < 0 || wrong < 0) {
      return res.status(400).json({ error: 'Неверные данные' });
    }

    // ── Проверка на подделку результата ──
    // 1) Забег должен быть начат через /api/storm/start этим же пользователем.
    const run = typeof runId === 'string' ? stormRuns.get(runId) : null;
    if (!run || run.userId !== req.user.userId) {
      return res.status(400).json({ error: 'Забег не найден. Начните игру заново.' });
    }
    stormRuns.delete(runId); // одноразовый — повторно этот runId использовать нельзя

    const elapsedMs = Date.now() - run.startedAt;
    // 2) Результат не может превышать лимит времени игры (+ разумный запас на сеть).
    if (elapsedMs > STORM_MAX_TIME_MS) {
      return res.status(400).json({ error: 'Забег просрочен' });
    }
    // 3) score всегда равен correct (1 очко за решённую задачу) — так считает клиент.
    if (score !== correct) {
      return res.status(400).json({ error: 'Результат не прошёл проверку' });
    }
    // 4) Нельзя решить больше задач, чем физически влезает во время игры.
    const maxPossible = Math.floor(elapsedMs / STORM_MIN_MS_PER_PUZZLE);
    if (correct + wrong > maxPossible) {
      return res.status(400).json({ error: 'Результат не прошёл проверку' });
    }

    const user = await getUser(req.user.username.toLowerCase());
    if (!user) return res.status(404).json({ error: 'Не найден' });
    await db(`INSERT INTO puzzle_storm_runs (id,user_id,username,score,total_attempted,correct,wrong,time_bonus,created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`, [uuidv4(), user.id, user.username, score, totalAttempted||0, correct||0, wrong||0, timeBonus||0, Date.now()]);
    const isBest  = score > (user.storm_best || 0);
    const newBest = isBest ? score : (user.storm_best || 0);
    const newRuns = (user.storm_runs || 0) + 1;
    await db('UPDATE users SET storm_best=$1,storm_runs=$2 WHERE id=$3', [newBest, newRuns, user.id]);
    user.storm_best = newBest; user.storm_runs = newRuns; cacheUser(user);
    res.json({ ok:true, isBest, newBest, totalRuns:newRuns });
  } catch(e) { console.error('[Storm finish]',e.message); res.status(500).json({ error: 'Ошибка' }); }
});
app.get('/api/storm/leaderboard', async (req, res) => {
  try {
    const r = await db(`SELECT username,storm_best,storm_runs FROM users WHERE storm_runs>0 ORDER BY storm_best DESC LIMIT 50`);
    res.json(r.rows.map((u,i) => ({ rank:i+1, username:u.username, best:u.storm_best||0, runs:u.storm_runs||0 })));
  } catch(e) { res.status(500).json({ error: 'Ошибка' }); }
});
app.get('/api/storm/player/:username', async (req, res) => {
  try {
    const user = await getUser(req.params.username.toLowerCase());
    if (!user) return res.status(404).json({ error: 'Не найден' });
    const runs = await db(`SELECT score,correct,wrong,created_at FROM puzzle_storm_runs WHERE user_id=$1 ORDER BY created_at DESC LIMIT 10`, [user.id]);
    res.json({ username:user.username, best:user.storm_best||0, runs:user.storm_runs||0, history: runs.rows.map(r => ({ score:r.score, correct:r.correct, wrong:r.wrong, at:Number(r.created_at) })) });
  } catch(e) { res.status(500).json({ error: 'Ошибка' }); }
});

app.post('/api/admin/puzzles', authMiddleware, async (req, res) => {
  await requireAdmin(req, res, async () => {
    const { title,description,fen,solution,topic,difficulty } = req.body;
    if (!title||!fen||!solution||!topic) return res.status(400).json({ error: 'title,fen,solution,topic обязательны' });
    const id = uuidv4();
    await db(`INSERT INTO puzzles (id,title,description,fen,solution,topic,difficulty,created_by,created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`, [id,title.trim().slice(0,100),(description||'').trim().slice(0,300), fen.trim(),solution.trim(),topic,difficulty||'medium',req.user.username,Date.now()]);
    await logAdminAction(req.user.username, 'puzzle_create', id, { title: title.trim().slice(0,100), topic, difficulty: difficulty||'medium' });
    res.json({ ok:true, id });
  });
});

async function handleDeletePuzzle(req, res) {
  await requireAdmin(req, res, async () => {
    await db('DELETE FROM puzzles WHERE id=$1',[req.params.id]);
    await logAdminAction(req.user.username, 'puzzle_delete', req.params.id, {});
    res.json({ ok:true });
  });
}
app.delete('/api/admin/puzzles/:id', authMiddleware, handleDeletePuzzle);
app.post('/api/admin/puzzles/:id/delete', authMiddleware, handleDeletePuzzle);

// ── Статичные HTML страницы ───────────────────────────────────
app.get('/profile', (req, res) => res.sendFile(path.join(__dirname, '../public/index.html')));
app.get('/settings', (req, res) => res.sendFile(path.join(__dirname, '../public/settings.html')));
['privacy','terms','about','admin','tournaments','tournament','admin-tournament','clubs', 'report'].forEach(p => { app.get('/' + p, (req, res) => res.sendFile(path.join(__dirname, '../public/' + p + '.html'))); });
// /tournaments/active, /tournaments/upcoming, /tournaments/finished — прямые ссылки на вкладки,
// отдаём ту же страницу, фильтрацию по вкладке делает клиентский JS (см. tournaments.html)
app.get('/tournaments/*', (req, res) => res.sendFile(path.join(__dirname, '../public/tournaments.html')));
app.get('/profile/:username', (req, res) => res.sendFile(path.join(__dirname, '../public/profile.html')));
app.get('/user/:username',    (req, res) => res.sendFile(path.join(__dirname, '../public/profile.html')));
app.get('/tournament/:id',    (req, res) => res.sendFile(path.join(__dirname, '../public/tournament.html')));
// Межклубные турниры — отдельная страница карточки турнира (со своей вёрсткой:
// командный зачёт, состав команд и т.п.), НЕ путать с /tournament/:id выше —
// та отдаёт общий шаблон одиночного турнира без командной статистики.
// Регистрируем ПОСЛЕ /tournament/:id намеренно — не важно, т.к. паттерны разной
// длины ("/tournament/interclub/xxx" — 2 сегмента, не матчится /tournament/:id).
app.get('/tournament/interclub/:id', (req, res) => res.sendFile(path.join(__dirname, '../public/interclub-tournament.html')));
// Чистый URL без .html для списка межклубных турниров (сам список — public/interclub-tournaments.html).
app.get('/interclub-tournaments', (req, res) => res.sendFile(path.join(__dirname, '../public/interclub-tournaments.html')));
app.get('/inbox',             (req, res) => res.sendFile(path.join(__dirname, '../public/inbox.html')));
app.get('/inbox/:partner',    (req, res) => res.sendFile(path.join(__dirname, '../public/inbox.html')));
app.get('/forum',             (req, res) => res.sendFile(path.join(__dirname, '../public/forum.html')));
app.get('/forum/*',           (req, res) => res.sendFile(path.join(__dirname, '../public/forum.html')));
app.get('/puzzles',           (req, res) => res.sendFile(path.join(__dirname, '../public/index.html')));
app.get('/puzzles/*',         (req, res) => res.sendFile(path.join(__dirname, '../public/index.html')));
app.get('/stats',             (req, res) => res.sendFile(path.join(__dirname, '../public/stats.html')));
app.get('/storm',             (req, res) => res.sendFile(path.join(__dirname, '../public/storm.html')));
app.get('/storm/*',           (req, res) => res.sendFile(path.join(__dirname, '../public/storm.html')));
app.get('/age', (req, res) => { res.sendFile(path.join(__dirname, '../public', 'age.html')); });
const SPA_ROUTES = ['/lobby', '/analysis', '/editor', '/leaderboard'];
SPA_ROUTES.forEach(r => { app.get(r, (req, res) => res.sendFile(path.join(__dirname, '../public/index.html'))); });
app.get('/online', (req, res) => res.sendFile(path.join(__dirname, '../public/online.html')));

app.get('/api/stats', async (req, res) => {
  try {
    const FOUNDED = new Date('2026-03-30T00:00:00Z');
    const daysAlive = Math.floor((Date.now() - FOUNDED.getTime()) / 86400000);

    const [ users, games, dm, chat, clubChat, blogPosts, blogComments, blogLikes, blogViews, forums, forumReplies, tournaments, clubs, puzzleAttempts, puzzleSolved, topRating, topPuzzle, topGames, gamesByTC, gamesByResult, registrationsByDay, gamesByDay, biggestWinStreak, avgGameMoves ] = await Promise.all([
      db('SELECT COUNT(*) FROM users'),
      db('SELECT COUNT(*) FROM games'),
      db('SELECT COUNT(*) FROM dm_messages'),
      db('SELECT COUNT(*) FROM chat_messages'),
      db('SELECT COUNT(*) FROM club_chat_messages'),
      db('SELECT COUNT(*) FROM blog_posts'),
      db('SELECT COUNT(*) FROM blog_comments'),
      db('SELECT COUNT(*) FROM blog_likes'),
      db('SELECT COUNT(*) FROM blog_views'),
      db('SELECT COUNT(*) FROM forum_threads'),
      db('SELECT COUNT(*) FROM forum_replies'),
      db('SELECT COUNT(*) FROM tournaments'),
      db('SELECT COUNT(*) FROM clubs'),
      db('SELECT COUNT(*) FROM puzzle_attempts'),
      db("SELECT COUNT(*) FROM puzzle_attempts WHERE correct=true"),
      db('SELECT username, rating FROM users ORDER BY rating DESC LIMIT 5'),
      db('SELECT username, puzzle_rating FROM users WHERE puzzle_attempted > 0 ORDER BY puzzle_rating DESC LIMIT 5'),
      db('SELECT username, games_played FROM users ORDER BY games_played DESC LIMIT 5'),
      db("SELECT time_control, COUNT(*) as cnt FROM games WHERE time_control IS NOT NULL GROUP BY time_control ORDER BY cnt DESC LIMIT 8"),
      db("SELECT result, COUNT(*) as cnt FROM games GROUP BY result"),
      db(`SELECT DATE(to_timestamp(created_at/1000)) as day, COUNT(*) as cnt FROM users WHERE created_at > extract(epoch from now()-interval '30 days')*1000 GROUP BY day ORDER BY day ASC`),
      db(`SELECT DATE(to_timestamp(ended_at/1000)) as day, COUNT(*) as cnt FROM games WHERE ended_at > extract(epoch from now()-interval '30 days')*1000 GROUP BY day ORDER BY day ASC`),
      db('SELECT username, wins FROM users ORDER BY wins DESC LIMIT 1'),
      db('SELECT AVG(jsonb_array_length(moves::jsonb)) as avg FROM games WHERE moves IS NOT NULL AND moves != \'[]\' AND moves != \'null\''),
    ]);

    const totalMessages = parseInt(dm.rows[0].count) + parseInt(chat.rows[0].count) + parseInt(clubChat.rows[0].count);

    res.json({
      meta: { daysAlive, founded: '30.03.2026' },
      totals: {
        users: parseInt(users.rows[0].count), games: parseInt(games.rows[0].count), messages: totalMessages,
        dmMessages: parseInt(dm.rows[0].count), chatMessages: parseInt(chat.rows[0].count), clubMessages: parseInt(clubChat.rows[0].count),
        blogPosts: parseInt(blogPosts.rows[0].count), blogComments: parseInt(blogComments.rows[0].count),
        blogLikes: parseInt(blogLikes.rows[0].count), blogViews: parseInt(blogViews.rows[0].count),
        forums: parseInt(forums.rows[0].count), forumReplies: parseInt(forumReplies.rows[0].count),
        tournaments: parseInt(tournaments.rows[0].count), clubs: parseInt(clubs.rows[0].count),
        puzzleAttempts: parseInt(puzzleAttempts.rows[0].count), puzzleSolved: parseInt(puzzleSolved.rows[0].count),
      },
      leaders: { rating: topRating.rows, puzzle: topPuzzle.rows, games: topGames.rows, mostWins: biggestWinStreak.rows[0] || null },
      charts: { gamesByTC: gamesByTC.rows, gamesByResult: gamesByResult.rows, regByDay: registrationsByDay.rows, gamesByDay: gamesByDay.rows },
      misc: { avgGameMoves: Math.round(parseFloat(avgGameMoves.rows[0]?.avg) || 0), puzzleSuccessRate: puzzleAttempts.rows[0].count > 0 ? Math.round(parseInt(puzzleSolved.rows[0].count) / parseInt(puzzleAttempts.rows[0].count) * 100) : 0 }
    });
  } catch(e) { console.error('[Stats]', e.message); res.status(500).json({ error: 'Ошибка' }); }
});


// ── Dev Diary API ───────────────────────────────────────────
app.get('/api/dev-diary', async (req, res) => {
  const page = Math.max(1, parseInt(req.query.page) || 1);
  const limit = Math.min(20, parseInt(req.query.limit) || 20);
  const offset = (page - 1) * limit;
  const sort = req.query.sort === 'asc' ? 'ASC' : 'DESC';

  const totalRes = await db('SELECT COUNT(*) AS total FROM dev_diary');
  const total = parseInt(totalRes.rows[0].total);

  const rows = await db(`
    SELECT id, author, title, content, created_at
    FROM dev_diary
    ORDER BY created_at ${sort}
    LIMIT $1 OFFSET $2
  `, [limit, offset]);

  res.json({
    entries: rows.rows.map(r => ({
      id: r.id, author: r.author, title: r.title, content: r.content, createdAt: Number(r.created_at)
    })),
    total, page, totalPages: Math.ceil(total / limit)
  });
});

app.post('/api/dev-diary', authMiddleware, async (req, res) => {
  const user = await getUser(req.user.username.toLowerCase());
  if (!user || user.role !== 'admin') return res.status(403).json({ error: 'Только администраторы могут добавлять записи' });

  const { title, content } = req.body;
  if (!title || !content) return res.status(400).json({ error: 'Заполните заголовок и текст' });
  if (title.length > 100) return res.status(400).json({ error: 'Заголовок не длиннее 100 символов' });
  if (content.length > 2000) return res.status(400).json({ error: 'Текст не длиннее 2000 символов' });

  const id = require('crypto').randomUUID();
  await db('INSERT INTO dev_diary (id, author, title, content, created_at) VALUES ($1,$2,$3,$4,$5)', [id, user.username, title.trim(), content.trim(), Date.now()]);
  res.json({ ok: true, id });
});

async function handleDeleteDevDiaryEntry(req, res) {
  try {
    const user = await getUser(req.user.username.toLowerCase());
    if (!user || user.role !== 'admin') return res.status(403).json({ error: 'Доступ запрещён' });
    await db('DELETE FROM dev_diary WHERE id = $1', [req.params.id]);
    res.json({ ok: true });
  } catch (e) {
    console.error('[DevDiary DELETE]', e);
    res.status(500).json({ error: 'Ошибка удаления записи: ' + e.message });
  }
}
// DELETE — основной вариант, POST — резервный на случай, если хостинг режет DELETE.
app.delete('/api/dev-diary/:id', authMiddleware, handleDeleteDevDiaryEntry);
app.post('/api/dev-diary/:id/delete', authMiddleware, handleDeleteDevDiaryEntry);

// ── Dev Diary: реакции ────────────────────────────────────────
// Таблицы создаются в main()

app.get('/api/dev-diary/:entryId/reactions', async (req, res) => {
  try {
    const rows = await db(
      `SELECT emoji, COUNT(*) AS cnt FROM dev_diary_reactions WHERE entry_id=$1 GROUP BY emoji`,
      [req.params.entryId]
    );
    // Своя реакция текущего пользователя (опционально по токену)
    let myEmoji = null;
    const auth = getAuthToken(req);
    if (auth) {
      try {
        const payload = jwt.verify(auth, JWT_SECRET);
        const r2 = await db(
          `SELECT emoji FROM dev_diary_reactions WHERE entry_id=$1 AND username_low=$2`,
          [req.params.entryId, payload.username.toLowerCase()]
        );
        if (r2.rows[0]) myEmoji = r2.rows[0].emoji;
      } catch {}
    }
    const counts = {};
    for (const r of rows.rows) counts[r.emoji] = parseInt(r.cnt);
    res.json({ counts, myEmoji });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/dev-diary/:entryId/reactions', authMiddleware, async (req, res) => {
  const ALLOWED_EMOJIS = ['👍','❤️','🔥','😂','🤯'];
  const { emoji } = req.body;
  if (!ALLOWED_EMOJIS.includes(emoji)) return res.status(400).json({ error: 'Недопустимый эмодзи' });
  const usernameLow = req.user.username.toLowerCase();
  // Проверяем, есть ли уже реакция
  const existing = await db(
    `SELECT emoji FROM dev_diary_reactions WHERE entry_id=$1 AND username_low=$2`,
    [req.params.entryId, usernameLow]
  );
  if (existing.rows[0]) {
    if (existing.rows[0].emoji === emoji) {
      // Снять реакцию
      await db(`DELETE FROM dev_diary_reactions WHERE entry_id=$1 AND username_low=$2`,
        [req.params.entryId, usernameLow]);
      return res.json({ ok: true, removed: true });
    } else {
      // Заменить
      await db(`UPDATE dev_diary_reactions SET emoji=$1 WHERE entry_id=$2 AND username_low=$3`,
        [emoji, req.params.entryId, usernameLow]);
      return res.json({ ok: true, replaced: true });
    }
  }
  await db(`INSERT INTO dev_diary_reactions (entry_id, username_low, emoji, created_at) VALUES ($1,$2,$3,$4)`,
    [req.params.entryId, usernameLow, emoji, Date.now()]);
  res.json({ ok: true });
});

// ── Dev Diary: комментарии ────────────────────────────────────

app.get('/api/dev-diary/:entryId/comments', async (req, res) => {
  try {
    const page  = Math.max(1, parseInt(req.query.page) || 1);
    const limit = 20;
    const offset = (page - 1) * limit;
    const totalR = await db(`SELECT COUNT(*) AS total FROM dev_diary_comments WHERE entry_id=$1`, [req.params.entryId]);
    const total = parseInt(totalR.rows[0].total);
    const rows = await db(
      `SELECT id, entry_id, username, content, created_at
       FROM dev_diary_comments WHERE entry_id=$1
       ORDER BY created_at ASC LIMIT $2 OFFSET $3`,
      [req.params.entryId, limit, offset]
    );
    res.json({
      comments: rows.rows.map(r => ({ id: r.id, username: r.username, content: r.content, createdAt: Number(r.created_at) })),
      total, page, totalPages: Math.ceil(total / limit)
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/dev-diary/:entryId/comments', authMiddleware, async (req, res) => {
  try {
    const user = await getUser(req.user.username.toLowerCase());
    if (!user) return res.status(401).json({ error: 'Не авторизован' });
    if (user.banned) return res.status(403).json({ error: 'Вы заблокированы' });

    // Проверяем бан на комментарии в дневнике
    const banR = await db(`SELECT 1 FROM dev_diary_comment_bans WHERE username_low=$1`, [user.username.toLowerCase()]);
    if (banR.rows.length) return res.status(403).json({ error: 'Вам запрещено оставлять комментарии в дневнике' });

    // Лимит 5 в день
    const dayStart = Date.now() - 24 * 60 * 60 * 1000;
    const countR = await db(
      `SELECT COUNT(*) AS cnt FROM dev_diary_comments WHERE username_low=$1 AND created_at > $2`,
      [user.username.toLowerCase(), dayStart]
    );
    if (parseInt(countR.rows[0].cnt) >= 5) return res.status(429).json({ error: 'Лимит 5 комментариев в сутки исчерпан' });

    const { content } = req.body;
    if (!content || !content.trim()) return res.status(400).json({ error: 'Пустой комментарий' });
    if (content.length > 500) return res.status(400).json({ error: 'Комментарий не длиннее 500 символов' });

    const id = require('crypto').randomUUID();
    await db(`INSERT INTO dev_diary_comments (id, entry_id, username, username_low, content, created_at) VALUES ($1,$2,$3,$4,$5,$6)`,
      [id, req.params.entryId, user.username, user.username.toLowerCase(), content.trim(), Date.now()]);
    res.json({ ok: true, id, username: user.username, content: content.trim(), createdAt: Date.now() });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

async function handleDeleteDevDiaryComment(req, res) {
  try {
    const user = await getUser(req.user.username.toLowerCase());
    if (!user || user.role !== 'admin') return res.status(403).json({ error: 'Нет прав' });
    await db(`DELETE FROM dev_diary_comments WHERE id=$1`, [req.params.commentId]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
}
app.delete('/api/dev-diary/comments/:commentId', authMiddleware, handleDeleteDevDiaryComment);
app.post('/api/dev-diary/comments/:commentId/delete', authMiddleware, handleDeleteDevDiaryComment);

// Бан/разбан юзера в комментариях дневника
app.post('/api/admin/dev-diary-comment-ban', authMiddleware, async (req, res) => {
  try {
    await requireAdmin(req, res, async () => {
      const { username, action } = req.body; // action: 'ban' | 'unban'
      if (!username) return res.status(400).json({ error: 'username обязателен' });
      const ulow = username.toLowerCase();
      if (action === 'ban') {
        await db(`INSERT INTO dev_diary_comment_bans (username_low, created_at) VALUES ($1,$2) ON CONFLICT DO NOTHING`,
          [ulow, Date.now()]);
      } else {
        await db(`DELETE FROM dev_diary_comment_bans WHERE username_low=$1`, [ulow]);
      }
      await logAdminAction(req.user.username, 'dev_diary_comment_' + (action === 'ban' ? 'ban' : 'unban'), username, {});
      res.json({ ok: true });
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/game/:gameId', async (req, res) => {
  const gameId = req.params.gameId;
  // Получаем данные игры через API (переиспользуем логику)
  let game = activeGames.get(gameId);
  if (!game) {
    const dbGame = await db('SELECT * FROM games WHERE id = $1', [gameId]);
    if (dbGame.rows.length === 0) {
      // Фоллбэк: старые турнирные партии, сохранённые до записи в таблицу games
      let tournamentGame = null, tournamentMeta = null;
      for (const t of tournaments) {
        const tg = (t.games || []).find(g => g.id === gameId);
        if (tg) { tournamentGame = tg; tournamentMeta = t; break; }
      }
      if (!tournamentGame) {
        return res.status(404).send('Игра не найдена');
      }
      game = {
        id: tournamentGame.id, white: tournamentGame.white, black: tournamentGame.black,
        result: tournamentGame.result, reason: tournamentGame.reason, moves: tournamentGame.moves,
        timeControl: tournamentGame.timeControl, endedAt: tournamentGame.endedAt || null,
        tournamentId: tournamentMeta.id, tournamentName: tournamentMeta.name,
      };
    } else {
      const row = dbGame.rows[0];
      game = {
        id: row.id, white: row.white, black: row.black,
        result: row.result, reason: row.reason, moves: row.moves,
        timeControl: row.time_control, endedAt: row.ended_at ? Number(row.ended_at) : null
      };
    }
  }

  // Простая страница просмотра партии
  const movesJson = JSON.stringify(game.moves || []);
  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Партия · ${game.white} vs ${game.black}</title>
      <link href="https://cdn.jsdelivr.net/npm/@chrisoakman/chessboard2@0.5.0/dist/chessboard2.min.css" rel="stylesheet">
      <style>
        body { font-family: system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif; background: #1a1a2e; color: #e0e0e0; display: flex; justify-content: center; align-items: center; min-height: 100vh; margin: 0; padding: 20px; }
        .container { max-width: 700px; width: 100%; background: #0f0f1e; border-radius: 20px; padding: 24px; box-shadow: 0 10px 30px rgba(0,0,0,0.5); }
        h1 { font-size: 1.5rem; margin: 0 0 4px; }
        .players { display: flex; justify-content: space-between; margin-bottom: 20px; font-weight: bold; background: #1e1e2a; padding: 12px 16px; border-radius: 12px; }
        .player { font-size: 1.2rem; }
        .result { font-size: 1.1rem; color: #c9a84c; }
        #board { width: 100%; max-width: 500px; margin: 0 auto 20px; }
        .controls { display: flex; gap: 12px; justify-content: center; margin-top: 20px; }
        button { background: #2a2a3a; border: none; padding: 8px 16px; border-radius: 8px; color: #fff; cursor: pointer; font-weight: 600; transition: 0.1s; }
        button:hover { background: #c9a84c; color: #000; }
        .move-list { background: #0a0a14; border-radius: 12px; padding: 12px; margin-top: 20px; max-height: 200px; overflow-y: auto; font-family: monospace; font-size: 13px; }
        .move { display: inline-block; margin-right: 12px; }
        .current-move { font-weight: bold; color: #c9a84c; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="players">
          <span class="player">♔ ${escapeHtml(game.white)}</span>
          <span class="player">♚ ${escapeHtml(game.black)}</span>
        </div>
        <div style="text-align:center; margin-bottom:12px">
          <span class="result">${formatGameResult(game.result, game.white, game.black)}</span>
          ${game.reason ? `<span style="margin-left:12px;color:#aaa">(${game.reason})</span>` : ''}
        </div>
        <div id="board"></div>
        <div class="controls">
          <button id="prevBtn">◀ Пред.</button>
          <button id="nextBtn">След. ▶</button>
          <button id="pgnBtn">⬇ Скачать PGN</button>
        </div>
        <div class="move-list" id="moveList"></div>
      </div>

      <script src="https://cdnjs.cloudflare.com/ajax/libs/chess.js/0.10.3/chess.min.js"></script>
      <script src="https://cdn.jsdelivr.net/npm/@chrisoakman/chessboard2@0.5.0/dist/chessboard2.min.js"></script>
      <script>
        const moves = ${movesJson};
        const gameId = "${gameId}";
        const gameWhite = ${JSON.stringify(game.white)};
        const gameBlack = ${JSON.stringify(game.black)};
        const gameResult = ${JSON.stringify(game.result || null)};
        const gameEndedAt = ${JSON.stringify(game.endedAt || null)};
        const gameTournamentName = ${JSON.stringify(game.tournamentName || null)};
        const boardEl = document.getElementById('board');
        let currentIndex = 0;
        let gameState = new Chess();

        function applyMovesUpTo(index) {
          gameState = new Chess();
          for (let i = 0; i < index && i < moves.length; i++) {
            const mv = moves[i];
            const from = numberToAlgebraic(mv.from);
            const to = numberToAlgebraic(mv.to);
            const promotion = mv.promotion ? mv.promotion.toLowerCase() : undefined;
            gameState.move({ from, to, promotion });
          }
          if (board) { try { board.position(gameState.fen()); } catch(e) {} }
        }

        function numberToAlgebraic(sq) {
          const files = 'abcdefgh';
          const rank = Math.floor(sq / 8);
          const file = sq % 8;
          return files[file] + (rank + 1);
        }

        function updateUI() {
          applyMovesUpTo(currentIndex);
          const moveItems = document.querySelectorAll('.move');
          moveItems.forEach((el, idx) => {
            if (idx === currentIndex) el.classList.add('current-move');
            else el.classList.remove('current-move');
          });
          const listDiv = document.getElementById('moveList');
          if (listDiv && currentIndex >= 0) {
            const activeMoveSpan = listDiv.querySelector('.move.current-move');
            if (activeMoveSpan) activeMoveSpan.scrollIntoView({ behavior: 'smooth', block: 'center' });
          }
        }

        function renderMoveList() {
          const container = document.getElementById('moveList');
          container.innerHTML = '';
          for (let i = 0; i < moves.length; i++) {
            const mv = moves[i];
            const moveText = \`\${numberToAlgebraic(mv.from)}→\${numberToAlgebraic(mv.to)}\${mv.promotion ? '='+mv.promotion.toUpperCase() : ''}\`;
            const moveSpan = document.createElement('span');
            moveSpan.className = 'move';
            moveSpan.textContent = moveText;
            moveSpan.style.cursor = 'pointer';
            moveSpan.onclick = () => { currentIndex = i; updateUI(); };
            container.appendChild(moveSpan);
            if ((i+1) % 8 === 0) container.appendChild(document.createElement('br'));
          }
          if (moves.length === 0) container.textContent = 'Нет ходов';
        }

        function buildPgn() {
          const pgnGame = new Chess();
          const headers = {
            Event: gameTournamentName ? gameTournamentName : 'Casual Game',
            Site: 'ChessHome',
            Date: gameEndedAt ? new Date(gameEndedAt).toISOString().slice(0,10).replace(/-/g, '.') : '????.??.??',
            White: gameWhite,
            Black: gameBlack,
            Result: gameResult === 'white' ? '1-0' : gameResult === 'black' ? '0-1' : gameResult === 'draw' ? '1/2-1/2' : '*'
          };
          for (const mv of moves) {
            const from = numberToAlgebraic(mv.from);
            const to = numberToAlgebraic(mv.to);
            const promotion = mv.promotion ? mv.promotion.toLowerCase() : undefined;
            pgnGame.move({ from, to, promotion });
          }
          let pgn = '';
          for (const [key, value] of Object.entries(headers)) {
            pgn += '[' + key + ' "' + String(value).replace(/"/g, '') + '"]\\n';
          }
          pgn += '\\n';
          pgn += pgnGame.pgn();
          if (headers.Result !== '*') pgn += ' ' + headers.Result;
          return pgn;
        }

        function downloadPgn() {
          const pgn = buildPgn();
          const blob = new Blob([pgn], { type: 'application/x-chess-pgn' });
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = 'game_' + gameId + '.pgn';
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          URL.revokeObjectURL(url);
        }

        let board;
        window.addEventListener('DOMContentLoaded', () => {
          try {
            if (typeof Chessboard2 !== 'undefined') {
              board = Chessboard2('board', { position: 'start', draggable: false });
            } else {
              document.getElementById('board').innerHTML = '<div style="text-align:center;color:#aaa;padding:20px">Доска недоступна (ошибка загрузки библиотеки), но ходы и PGN доступны</div>';
            }
          } catch (e) {
            document.getElementById('board').innerHTML = '<div style="text-align:center;color:#aaa;padding:20px">Доска недоступна (ошибка загрузки библиотеки), но ходы и PGN доступны</div>';
          }
          renderMoveList();
          updateUI();
          document.getElementById('prevBtn').onclick = () => { if (currentIndex > 0) { currentIndex--; updateUI(); } };
          document.getElementById('nextBtn').onclick = () => { if (currentIndex < moves.length) { currentIndex++; updateUI(); } };
          document.getElementById('pgnBtn').onclick = downloadPgn;
        });
      </script>
    </body>
    </html>
  `);

  function escapeHtml(str) { return String(str || '').replace(/[&<>]/g, function(m) { if (m === '&') return '&amp;'; if (m === '<') return '&lt;'; if (m === '>') return '&gt;'; return m; }); }
  function formatGameResult(result, white, black) {
    if (result === 'white') return `🏆 ${white} победил`;
    if (result === 'black') return `🏆 ${black} победил`;
    if (result === 'draw') return `🤝 Ничья`;
    return `Партия завершена`;
  }
});


app.get('*', (req, res) => {
  if (req.path.startsWith('/api/')) return res.status(404).json({ error: 'Не найдено' });
  if (/\.[a-z0-9]+$/i.test(req.path)) { return res.status(404).sendFile(path.join(__dirname, '../public/404.html')); }
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

// Любой /api/* запрос с методом, для которого нет отдельного маршрута выше
// (POST/PATCH/PUT/DELETE на несуществующий или опечатанный путь), должен
// получить JSON, а не дефолтную HTML-страницу Express вида
// "Cannot DELETE /api/...". Именно из-за такой HTML-страницы фронтенд падал
// с "JSON.parse: unexpected character at line 1 column 1" — он пытался
// распарсить HTML как JSON.
app.all('/api/*', (req, res) => {
  res.status(404).json({ error: 'Эндпоинт не найден' });
});

// Финальный обработчик ошибок — гарантирует, что клиент ВСЕГДА получит JSON,
// а не HTML-страницу с трейсом, даже если где-то в коде забыли try/catch.
app.use((err, req, res, next) => {
  if (res.headersSent) return next(err);
  if (err && err.type === 'entity.too.large') {
    return res.status(413).json({ error: 'Слишком большой запрос' });
  }
  if (err && err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'Некорректный JSON в запросе' });
  }
  console.error('[Unhandled error]', err);
  res.status(500).json({ error: 'Внутренняя ошибка сервера' });
});



// ══════════════════════════════════════════════════════════════
//  HELPERS
// ══════════════════════════════════════════════════════════════

function authMiddleware(req, res, next) {
  const auth = getAuthToken(req);
  if (!auth) return res.status(401).json({ error: 'Не авторизован' });
  try { req.user = jwt.verify(auth, JWT_SECRET); next(); }
  catch { res.status(401).json({ error: 'Неверный токен' }); }
}

async function requireAdmin(req, res, cb) {
  try {
    const me = await getUser(req.user.username.toLowerCase());
    if (!me || me.role !== 'admin') return res.status(403).json({ error: 'Нет прав' });
    await cb();
  } catch (e) {
    console.error('[requireAdmin]', e);
    if (!res.headersSent) res.status(500).json({ error: 'Внутренняя ошибка сервера' });
  }
}

// Отдельная проверка для VIP-значка: не завязана на общую роль admin,
// пускает только chesshome и Marina64 (см. isVipGranter выше).
async function requireVipGranter(req, res, cb) {
  try {
    const me = await getUser(req.user.username.toLowerCase());
    if (!me || !isVipGranter(me.username)) return res.status(403).json({ error: 'Нет прав на выдачу VIP-значка' });
    await cb(me);
  } catch (e) {
    console.error('[requireVipGranter]', e);
    if (!res.headersSent) res.status(500).json({ error: 'Внутренняя ошибка сервера' });
  }
}

function sanitizeUser(u) {
  return {
    id: u.id, username: u.username, rating: u.rating,
    gamesPlayed: u.gamesPlayed, wins: u.wins, losses: u.losses, draws: u.draws,
    createdAt: u.createdAt, avatar: u.avatar, role: u.role || 'user',
    banned: u.banned || false, banReason: u.banReason || null,
    puzzle_rating: u.puzzle_rating ?? 1200, puzzle_solved: u.puzzle_solved ?? 0,
    puzzle_attempted: u.puzzle_attempted ?? 0, emoji: u.emoji || '',
    bio: u.bio || '', fshrRating: u.fshrRating ?? null, fideRating: u.fideRating ?? null,
    vip: isVip(u), vipUntil: isVip(u) ? u.vipUntil : null,
  };
}

function adminSanitizeUser(u) {
  return { ...sanitizeUser(u), email: u.email || null, createdFromIP: u.createdFromIP || null, createdDeviceId: u.createdDeviceId || null, vipUntil: u.vipUntil ?? null };
}

// Инфо о командах межклубного турнира (id/название/число участников клуба) —
// нужно фронту для выбора команды и отображения турнирной сетки/составов.
function getInterclubTeamsInfo(t) {
  if (!t.isInterclub) return undefined;
  return (t.teamIds || [])
    .map(id => clubs.find(c => c.id === id))
    .filter(Boolean)
    .map(c => ({ id: c.id, name: c.name, memberCount: c.memberCount || (c.members || []).length }));
}

// Командный зачёт межклубного турнира: суммируем очки/результаты всех игроков
// каждой команды среди участников турнира (бан по читерству — не учитываем).
function computeTeamStandings(t) {
  if (!t.isInterclub) return undefined;
  const byTeam = new Map();
  for (const id of (t.teamIds || [])) {
    const club = clubs.find(c => c.id === id);
    byTeam.set(id, { teamId: id, teamName: club ? club.name : id, score: 0, wins: 0, losses: 0, draws: 0, gamesPlayed: 0, players: 0 });
  }
  for (const p of (t.participants || [])) {
    if (p.anticheatBanned || !p.teamId || !byTeam.has(p.teamId)) continue;
    const s = byTeam.get(p.teamId);
    s.score += p.score || 0;
    s.wins += p.wins || 0;
    s.losses += p.losses || 0;
    s.draws += p.draws || 0;
    s.gamesPlayed += p.gamesPlayed || 0;
    s.players += 1;
  }
  return [...byTeam.values()].sort((a, b) => b.score - a.score || b.wins - a.wins);
}

function sanitizeTournament(t) {
  const sorted = [...(t.participants || [])].filter(p => !p.anticheatBanned).sort((a, b) => b.score - a.score || b.wins - a.wins);
  return { ...t, participants: sorted, blacklist: undefined, status: getTournamentStatus(t, Date.now()), createdByIsAdmin: usersCache.get((t.createdBy || '').toLowerCase())?.role === 'admin', teams: getInterclubTeamsInfo(t), teamStandings: computeTeamStandings(t) };
}

function getTournamentStatus(t, now) {
  if (now < t.startsAt) return 'upcoming';
  if (now < t.endsAt)   return 'active';
  return 'finished';
}

function verifyToken(t) { try { return jwt.verify(t, JWT_SECRET); } catch { return null; } }

// ── Часы партии — источник истины ТОЛЬКО сервер ────────────────
// Раньше флаг (истечение времени) определял клиентский JS-таймер,
// который просто присылал game_over с готовым результатом — это
// легко подделать. Теперь сервер сам считает оставшееся время по
// game.lastMoveAt и не доверяет клиентским заявлениям о таймауте.
function liveClock(game, now) {
  let { whiteTime, blackTime } = game;
  if (game.lastMoveAt != null && whiteTime !== undefined) {
    const elapsed = (now - game.lastMoveAt) / 1000;
    if (game.turn === 'white') whiteTime = Math.max(0, whiteTime - elapsed);
    else                       blackTime = Math.max(0, blackTime - elapsed);
  }
  return { whiteTime, blackTime };
}

// Партия считается "реально сыгранной" для статистики (/api/stats) и
// профиля (gamesPlayed/wins/losses/draws/рейтинг) только если сделан
// хотя бы 1 полный ход — то есть сходили и белые, и чёрные (минимум
// 2 полухода в game.moves). Иначе, например, когда игрок вышел до
// ответного хода соперника, партия не должна засорять статистику.
function hasFullMove(game) {
  return Array.isArray(game.moves) && game.moves.length >= 2;
}

async function endGameAuthoritative(gameId, game, result, reason) {
  if (!activeGames.has(gameId) && !tournamentGames.has(gameId)) return; // уже завершена
  activeGames.delete(gameId);
  tournamentGames.delete(gameId);
  const isTournament = !!game.tournamentId;
  if (isTournament) {
    const t = tournaments.find(t => t.id === game.tournamentId);
    if (t) await finishTournamentGame(t, game, result, reason);
  } else if (hasFullMove(game)) {
    await recordGame(game, result, reason);
    await updateStats(game.white, game.black, result, game.rated !== false);
  }
  const payload = { gameId, result, reason, white: game.white, black: game.black };
  [findSocketByUsername(game.white), findSocketByUsername(game.black)].forEach(s => s?.emit('game_ended', payload));
}

// Каждую секунду проверяем все активные партии на падение флага —
// независимо от того, что показывает (или не показывает) клиент.
setInterval(() => {
  const now = Date.now();
  for (const [gameId, game] of activeGames.entries()) {
    if (game.whiteTime === undefined || game.blackTime === undefined) continue;
    const { whiteTime, blackTime } = liveClock(game, now);
    if (whiteTime <= 0) endGameAuthoritative(gameId, game, 'black', 'timeout').catch(e => console.error('[Clock]', e.message));
    else if (blackTime <= 0) endGameAuthoritative(gameId, game, 'white', 'timeout').catch(e => console.error('[Clock]', e.message));
  }
}, 1000);

function findSocketByUsername(username) {
  // Было: линейный перебор всей карты sessions на каждый вызов (O(n)).
  // Стало: прямой доступ по индексу usernameToSocketId (O(1)).
  const id = usernameToSocketId.get(username.toLowerCase());
  if (!id) return null;
  const sock = io.sockets.sockets.get(id);
  if (!sock) { usernameToSocketId.delete(username.toLowerCase()); return null; }
  return sock;
}

// ── Приватные события только для админов ──────────────────────
// Раньше данные жалоб/античита рассылались через ad-hoc циклы —
// вынесено в одну функцию, чтобы гарантировать: эти сокет-события
// НИКОГДА не попадают обычным пользователям (утечка в Network).
async function emitToAdmins(event, payload) {
  for (const [, sess] of sessions.entries()) {
    const u = usersCache.get(sess.username.toLowerCase());
    if (u?.role !== 'admin') continue;
    const sock = findSocketByUsername(sess.username);
    if (sock) sock.emit(event, payload);
  }
}

async function recordGame(game, result, reason) {
  // Товарищеские (нерейтинговые) партии тоже сохраняются в историю — просто
  // без пересчёта рейтинга (см. updateStats и её вызовы ниже). Турнирные
  // партии всегда рейтинговые.
  const rated = game.tournamentId ? true : (game.rated !== false);
  await db(`
    INSERT INTO games (id, white, black, result, reason, moves, time_control, ended_at, berserk, accuracy, tournament_id, rated)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
    ON CONFLICT (id) DO NOTHING
  `, [game.id, game.white, game.black, result, reason,
      JSON.stringify(game.moves || []), game.timeControl || null,
      Date.now(), JSON.stringify(game.berserk || null),
      JSON.stringify(game.accuracy || null), game.tournamentId || null, rated]);
}

async function updateStats(white, black, result, rated = true) {
  const w = await getUser(white.toLowerCase());
  const b = await getUser(black.toLowerCase());
  if (!w || !b) return;
  w.gamesPlayed++; b.gamesPlayed++;
  if (result === 'white')      { w.wins++; b.losses++; }
  else if (result === 'black') { b.wins++; w.losses++; }
  else                         { w.draws++; b.draws++; }
  // Товарищеская партия: счётчики побед/поражений/партий обновляются как
  // обычно, но сам рейтинг (Elo) не пересчитывается.
  if (rated) {
    const K = 32, expW = 1 / (1 + Math.pow(10, (b.rating - w.rating) / 400)), expB = 1 - expW;
    let sW, sB;
    if (result === 'white')      { sW = 1; sB = 0; }
    else if (result === 'black') { sW = 0; sB = 1; }
    else                         { sW = 0.5; sB = 0.5; }
    w.rating = Math.max(100, Math.round(w.rating + K * (sW - expW)));
    b.rating = Math.max(100, Math.round(b.rating + K * (sB - expB)));
  }
  await saveUser(w); await saveUser(b);
}

// Грейс-период после завершения партии: даже если пара уже готова,
// игрока не спариваем ещё REMATCH_GRACE_PERIOD мс — чтобы он успел
// вернуться на страницу турнира и, если хочет, нажать "Пауза" ДО того,
// как придёт game_start и клиент редиректнет его в новую партию.
// Отменяется мгновенно, если игрок сам нажал "Играть" (см. tournament_seek/tournament_waiting).
const REMATCH_GRACE_PERIOD = 8000;

function tryPairTournamentPlayers(tournament) {
  const now = Date.now();
  if (getTournamentStatus(tournament, now) !== 'active') return;
  const waiting = tournament.participants.filter(p =>
    p.waiting && !p.left && !p.currentGameId && !p.anticheatBanned &&
    (!p.nextEligibleAt || now >= p.nextEligibleAt)
  );
  if (waiting.length < 2) return;

  const games = tournament.games;

  // Считаем сколько раз каждая пара уже играла друг с другом
  function gamesPlayed(a, b) {
    return games.filter(g =>
      (g.white === a && g.black === b) || (g.white === b && g.black === a)
    ).length;
  }

  // Межклубный турнир: игроки одной команды (клуба) друг с другом не спариваются.
  function sameTeam(pa, pb) {
    return tournament.isInterclub && pa.teamId && pb.teamId && pa.teamId === pb.teamId;
  }

  // Кто был последним соперником игрока
  function lastOpponent(username) {
    for (let k = games.length - 1; k >= 0; k--) {
      const g = games[k];
      if (g.white === username) return g.black;
      if (g.black === username) return g.white;
    }
    return null;
  }

  // Сортируем: кто дольше ждёт — тот первым получает партию
  waiting.sort((a, b) => (a.lastGameAt || 0) - (b.lastGameAt || 0));

  const paired = new Set();

  for (let i = 0; i < waiting.length; i++) {
    if (paired.has(waiting[i].username)) continue;
    const pi = waiting[i];
    const piLastOpp = lastOpponent(pi.username);

    // Выбираем лучшего соперника:
    // 1. Меньше всего сыграно партий вместе (равенство)
    // 2. Не был последним соперником (чередование)
    // 3. Кто дольше ждёт (справедливость)
    let bestJ = -1;
    let bestScore = Infinity;

    for (let j = i + 1; j < waiting.length; j++) {
      if (paired.has(waiting[j].username)) continue;
      const pj = waiting[j];
      if (sameTeam(pi, pj)) continue; // одноклубники не играют друг с другом
      const played = gamesPlayed(pi.username, pj.username);
      const isLastOpp = pj.username === piLastOpp ? 1 : 0;
      // Меньше score — лучше пара
      const score = played * 10 + isLastOpp * 1000;
      if (score < bestScore) {
        bestScore = score;
        bestJ = j;
      }
    }

    if (bestJ === -1) continue; // bye — сыграет следующим

    paired.add(pi.username);
    paired.add(waiting[bestJ].username);
    pi.waiting = false;
    waiting[bestJ].waiting = false;
    startTournamentGame(tournament, pi, waiting[bestJ]);
  }
  // При нечётном числе один игрок остаётся в waiting (bye) и получит партию следующим
}

const FIRST_MOVE_TIMEOUT = 20 * 1000; // время на первый ход — общее для белых и чёрных

function startTournamentGame(tournament, p1, p2) {
  const gameId = uuidv4();
  const p1Last = [...tournament.games].reverse().find(g => g.white === p1.username || g.black === p1.username);
  let white, black;
  if (!p1Last || p1Last.black === p1.username) { white = p1.username; black = p2.username; }
  else { white = p2.username; black = p1.username; }
  const wR = usersCache.get(white.toLowerCase())?.rating ?? '?';
  const bR = usersCache.get(black.toLowerCase())?.rating ?? '?';
  const [tcBaseT, tcIncTStr] = tournament.timeControl.split('+');
  const tcIncT = Number(tcIncTStr);
  const tcSecT = tcBaseT && tcBaseT.endsWith('s') ? (Number(tcBaseT.slice(0, -1)) || 15) : (Number(tcBaseT) || 10) * 60;
  const now = Date.now();
  const game = {
    id: gameId, tournamentId: tournament.id, white, black,
    turn: 'white', moves: [], createdAt: now, lastActivity: now,
    timeControl: tournament.timeControl, whiteTime: tcSecT, blackTime: tcSecT,
    tcIncrement: tcIncT || 0, lastMoveAt: now,
    berserk: { white: false, black: false }, moveCounts: { white: 0, black: 0 },
    _board: serverChess.startBoard(),
    firstMoveDeadline: now + FIRST_MOVE_TIMEOUT,
    isInterclub: !!tournament.isInterclub,
  };
  activeGames.set(gameId, game);
  tournamentGames.set(gameId, game);
  p1.currentGameId = gameId; p2.currentGameId = gameId;
  const payload = (color, opp, oppRating) => ({
    gameId, color, opponent: opp, opponentRating: oppRating,
    timeControl: tournament.timeControl,
    tournamentId: tournament.id, tournamentName: tournament.name,
    isInterclub: !!tournament.isInterclub,
    firstMoveDeadline: game.firstMoveDeadline,
  });
  const ws = findSocketByUsername(white);
  const bs = findSocketByUsername(black);
  if (ws) ws.emit('game_start', payload('white', black, bR));
  if (bs) bs.emit('game_start', payload('black', white, wR));
  saveTournament(tournament).catch(() => {});
  io.to(`tournament_${tournament.id}`).emit('tournament_update', sanitizeTournament(tournament));
}

async function finishTournamentGame(tournament, game, result, reason) {
  const now = Date.now();
  const wp = tournament.participants.find(p => p.username === game.white);
  const bp = tournament.participants.find(p => p.username === game.black);
  if (wp) { wp.currentGameId = null; wp.lastGameAt = now; wp.gamesPlayed++; }
  if (bp) { bp.currentGameId = null; bp.lastGameAt = now; bp.gamesPlayed++; }
  const isInTime = now < tournament.endsAt;
  const berserkCondition = game.moveCounts?.white >= 7 && game.moveCounts?.black >= 7;
  if (isInTime && wp && bp) {
    if (result === 'white') {
      wp.wins++; bp.losses++; bp.streak = 0; bp.flame = false;
      const bonus = game.berserk?.white && berserkCondition ? 1 : 0;
      wp.score += (wp.flame ? 4 : 2) + bonus; wp.streak++; wp.flame = wp.streak >= 2;
    } else if (result === 'black') {
      bp.wins++; wp.losses++; wp.streak = 0; wp.flame = false;
      const bonus = game.berserk?.black && berserkCondition ? 1 : 0;
      bp.score += (bp.flame ? 4 : 2) + bonus; bp.streak++; bp.flame = bp.streak >= 2;
    } else {
      wp.score += wp.flame ? 2 : 1; bp.score += bp.flame ? 2 : 1;
      wp.draws++; bp.draws++; wp.streak = 0; bp.streak = 0; wp.flame = false; bp.flame = false;
    }
  }
  tournament.games.push({ id: game.id, white: game.white, black: game.black, result, reason, moves: game.moves, timeControl: game.timeControl, endedAt: now, berserk: game.berserk, accuracy: game.accuracy || null });
  checkAnticheat(tournament, game, wp, bp, result);
  // В общую таблицу games и в личную статистику/профиль игрока (updateStats)
  // партия попадает, только если сделан хотя бы 1 полный ход — сама турнирная
  // логика (пары, счёт турнира, история встреч выше) при этом не меняется.
  if (hasFullMove(game)) {
    await recordGame(game, result, reason);
    await updateStats(game.white, game.black, result);
  }
  // Если партия завершилась из-за неявки на первый ход — сторону, не сделавшую
  // ход (при timeout_firstmove это всегда белые, т.к. первый ход за ними),
  // не возвращаем в очередь автоматически: ставим на паузу, новую пару даём
  // только после того, как игрок сам нажмёт "Играть".
  // Просрочивший первый ход — проигравшая сторона в этой партии (result — цвет победителя)
  const afkColor = reason === 'timeout_firstmove' ? (result === 'white' ? 'black' : 'white') : null;
  // nextEligibleAt — до этого момента игрок формально "в поиске" (waiting=true,
  // баннер и кнопка "Пауза" на странице турнира уже показываются), но
  // tryPairTournamentPlayers его пока пропускает — см. REMATCH_GRACE_PERIOD выше.
  const nextEligibleAt = now + REMATCH_GRACE_PERIOD;
  if (wp && !wp.left && !wp.anticheatBanned && now < tournament.endsAt) {
    if (afkColor === 'white') { wp.waiting = false; wp.paused = true; wp.nextEligibleAt = 0; }
    else { wp.waiting = true; wp.paused = false; wp.nextEligibleAt = nextEligibleAt; }
  }
  if (bp && !bp.left && !bp.anticheatBanned && now < tournament.endsAt) {
    if (afkColor === 'black') { bp.waiting = false; bp.paused = true; bp.nextEligibleAt = 0; }
    else { bp.waiting = true; bp.paused = false; bp.nextEligibleAt = nextEligibleAt; }
  }
  await saveTournament(tournament);
  io.to(`tournament_${tournament.id}`).emit('tournament_update', sanitizeTournament(tournament));
  // Первая попытка — заспарит других игроков, у которых грейс-период уже истёк
  // или которых не касался (например "bye"-игрок, ждавший своей очереди).
  setTimeout(() => tryPairTournamentPlayers(tournament), 500);
  // Вторая попытка — уже после того, как грейс-период для только что
  // освободившихся игроков истечёт (если они сами не поставили паузу).
  setTimeout(() => tryPairTournamentPlayers(tournament), REMATCH_GRACE_PERIOD + 500);
}

const ANTICHEAT_THRESHOLD = 95, ANTICHEAT_STREAK_BAN = 3;
function checkAnticheat(tournament, game, wp, bp) {
  const acc = game.accuracy; if (!acc) return;
  if (wp && !wp.anticheatBanned) {
    const highAcc = (acc.white || 0) >= ANTICHEAT_THRESHOLD;
    wp._acHighAccGames = highAcc ? (wp._acHighAccGames || 0) + 1 : 0;
    if (wp._acHighAccGames >= ANTICHEAT_STREAK_BAN) anticheatBan(tournament, wp.username);
  }
  if (bp && !bp.anticheatBanned) {
    const highAcc = (acc.black || 0) >= ANTICHEAT_THRESHOLD;
    bp._acHighAccGames = highAcc ? (bp._acHighAccGames || 0) + 1 : 0;
    if (bp._acHighAccGames >= ANTICHEAT_STREAK_BAN) anticheatBan(tournament, bp.username);
  }
}
function anticheatBan(tournament, username) {
  const p = tournament.participants.find(p => p.username === username);
  if (!p || p.anticheatBanned) return;
  p.anticheatBanned = true; p.waiting = false; p.left = true; p.currentGameId = null;
  let compensated = 0;
  for (const g of tournament.games) {
    const oppName = g.white === username ? g.black : g.black === username ? g.white : null;
    if (!oppName) continue;
    // Помечаем партию как аннулированную
    g.anticheatBanned = true;
    const opp = tournament.participants.find(p => p.username === oppName && !p.anticheatBanned);
    if (!opp) continue;
    const bannedWon = (g.white === username && g.result === 'white') || (g.black === username && g.result === 'black');
    const bannedDraw = g.result === 'draw';
    if (bannedWon) {
      opp.score += 2; opp.wins++; opp.losses = Math.max(0, opp.losses - 1);
      compensated++;
      const s = findSocketByUsername(oppName);
      if (s) s.emit('anticheat_compensation', { message: `${username} забанен за читы. Ваше поражение аннулировано (+2 очка)!`, tournamentId: tournament.id });
    } else if (bannedDraw) {
      // За ничью сопернику дают +1 очко компенсации
      opp.score = Math.max(0, opp.score - 1); // убираем очко ничьей
      opp.draws = Math.max(0, opp.draws - 1);
      opp.wins++; opp.score += 2; // засчитываем победу
      compensated++;
      const s = findSocketByUsername(oppName);
      if (s) s.emit('anticheat_compensation', { message: `${username} забанен за читы. Ваша ничья переведена в победу (+1 очко)!`, tournamentId: tournament.id });
    }
  }
  io.to(`tournament_${tournament.id}`).emit('anticheat_ban', { username, tournamentId: tournament.id, tournamentName: tournament.name, message: `⚠️ ${username} забанен за использование компьютерной помощи.` });
  const sock = findSocketByUsername(username);
  if (sock) sock.emit('tournament_banned', { message: 'Вы заблокированы в этом турнире за использование компьютерной помощи.' });
  saveTournament(tournament).catch(() => {});
}

function startGame(acceptorSocket, challenge) {
  const gameId = uuidv4();
  let white, black;
  if (challenge.color === 'white')      { white = challenge.from; black = acceptorSocket.username; }
  else if (challenge.color === 'black') { white = acceptorSocket.username; black = challenge.from; }
  else { if (Math.random() > 0.5) { white = challenge.from; black = acceptorSocket.username; } else { white = acceptorSocket.username; black = challenge.from; } }
  const [tcBase, tcIncStr] = challenge.timeControl.split('+');
  const tcInc = Number(tcIncStr);
  const tcSec = tcBase && tcBase.endsWith('s') ? (Number(tcBase.slice(0, -1)) || 15) : (Number(tcBase) || 10) * 60;
  const gameNow = Date.now();
  // Товарищеская партия: challenge.rated === false явно выставляется при
  // создании вызова (post_challenge / challenge_user). По умолчанию — рейтинговая.
  const rated = challenge.rated !== false;
  const game = { id: gameId, white, black, turn: 'white', moves: [], createdAt: gameNow, lastActivity: gameNow, timeControl: challenge.timeControl, whiteTime: tcSec, blackTime: tcSec, tcIncrement: tcInc || 0, lastMoveAt: gameNow, _board: serverChess.startBoard(), rated };
  activeGames.set(gameId, game);
  const wR = usersCache.get(white.toLowerCase())?.rating ?? '?';
  const bR = usersCache.get(black.toLowerCase())?.rating ?? '?';
  const ws = findSocketByUsername(white); const bs = findSocketByUsername(black);
  if (ws) ws.emit('game_start', { gameId, color: 'white', opponent: black, opponentRating: bR, timeControl: game.timeControl, rated });
  if (bs) bs.emit('game_start', { gameId, color: 'black', opponent: white, opponentRating: wR, timeControl: game.timeControl, rated });
}

setInterval(async () => {
  const now = Date.now();
  for (const t of tournaments) {
    const status = getTournamentStatus(t, now);
    if (status === 'active') {
      // При первом тике активного турнира — ставим всех незанятых участников в waiting
      if (!t._startNotified) {
        t._startNotified = true;
        let anyChanged = false;
        for (const p of t.participants) {
          if (!p.left && !p.anticheatBanned && !p.currentGameId && !p.waiting && !p.paused) {
            p.waiting = true;
            anyChanged = true;
          }
        }
        if (anyChanged) {
          await saveTournament(t);
          io.to(`tournament_${t.id}`).emit('tournament_update', sanitizeTournament(t));
          // Уведомляем участников о старте
          for (const p of t.participants) {
            if (!p.left && !p.anticheatBanned) {
              const s = findSocketByUsername(p.username);
              if (s) s.emit('tournament_started', { tournamentId: t.id, name: t.name });
            }
          }
        }
      }

      for (const [gameId, game] of tournamentGames.entries()) {
        if (game.tournamentId !== t.id) continue;
        if (game.firstMoveDeadline && now > game.firstMoveDeadline) {
          if (game.moves.length === 0) {
            // Белые не сделали первый ход — поражение белых
            console.log(`[Tournament] Первый ход просрочен: ${game.white} (белые) в игре ${gameId}`);
            const ws = findSocketByUsername(game.white);
            const bs = findSocketByUsername(game.black);
            const payload = { gameId, result: 'black', reason: 'timeout_firstmove' };
            if (ws) ws.emit('game_ended', payload);
            if (bs) bs.emit('game_ended', payload);
            await finishTournamentGame(t, game, 'black', 'timeout_firstmove');
            tournamentGames.delete(gameId);
            activeGames.delete(gameId);
          } else if (game.moves.length === 1) {
            // Белые сходили, чёрные не сделали свой первый ход — поражение чёрных
            console.log(`[Tournament] Первый ход просрочен: ${game.black} (чёрные) в игре ${gameId}`);
            const ws = findSocketByUsername(game.white);
            const bs = findSocketByUsername(game.black);
            const payload = { gameId, result: 'white', reason: 'timeout_firstmove' };
            if (ws) ws.emit('game_ended', payload);
            if (bs) bs.emit('game_ended', payload);
            await finishTournamentGame(t, game, 'white', 'timeout_firstmove');
            tournamentGames.delete(gameId);
            activeGames.delete(gameId);
          }
        }
      }
      tryPairTournamentPlayers(t);
    }
    if (status === 'finished' && !t.winner && t.participants.length > 0) {
      const sorted = [...t.participants].filter(p => !p.anticheatBanned).sort((a, b) => b.score - a.score || b.wins - a.wins);
      t.winner = sorted[0]?.username || null;
      await saveTournament(t);
      io.to(`tournament_${t.id}`).emit('tournament_finished', { winner: t.winner, tournament: t });
      io.emit('tournament_finished_notify', { id: t.id, name: t.name, winner: t.winner });
    }
  }
}, 3000);

setInterval(async () => {
  const twoYearsAgo = Date.now() - 2 * 365 * 24 * 60 * 60 * 1000;
  for (let i = tournaments.length - 1; i >= 0; i--) {
    const t = tournaments[i];
    if (t.endsAt && t.endsAt < twoYearsAgo) { tournaments.splice(i, 1); await deleteTournamentFromDB(t.id); }
  }
}, 24 * 60 * 60 * 1000);

const serverChess = (() => {
  const EMPTY = null;
  const START_POS = [
    ['R','w'],['N','w'],['B','w'],['Q','w'],['K','w'],['B','w'],['N','w'],['R','w'],
    ['P','w'],['P','w'],['P','w'],['P','w'],['P','w'],['P','w'],['P','w'],['P','w'],
    ...Array(32).fill(EMPTY),
    ['P','b'],['P','b'],['P','b'],['P','b'],['P','b'],['P','b'],['P','b'],['P','b'],
    ['R','b'],['N','b'],['B','b'],['Q','b'],['K','b'],['B','b'],['N','b'],['R','b'],
  ];
  function startBoard() { return { squares: [...START_POS], turn: 'w', castling: { wK: true, wQ: true, bK: true, bQ: true }, epSquare: -1 }; }
  function cloneBoard(b) { return { squares: [...b.squares], turn: b.turn, castling: { ...b.castling }, epSquare: b.epSquare }; }
  function file(sq) { return sq % 8; } function rank(sq) { return Math.floor(sq / 8); } function sq_(r, f) { return r * 8 + f; }
  function isEnemy(piece, color) { return piece && piece[1] !== color; }
  function isEmpty(squares, s) { return squares[s] === EMPTY; }
  function addIfValid(moves, squares, color, from, to) { if (to < 0 || to > 63) return; if (squares[to] && squares[to][1] === color) return; moves.push({ from, to }); }
  function slideMoves(moves, squares, color, from, dirs) { for (const [dr, df] of dirs) { let r = rank(from) + dr, f = file(from) + df; while (r >= 0 && r < 8 && f >= 0 && f < 8) { const to = sq_(r, f); if (squares[to]) { if (squares[to][1] !== color) moves.push({ from, to }); break; } moves.push({ from, to }); r += dr; f += df; } } }
  function pseudoLegalMoves(board, fromSq) {
    const { squares, turn, epSquare } = board;
    const piece = squares[fromSq]; if (!piece || piece[1] !== turn) return [];
    const [type, color] = piece; const moves = [];
    if (type === 'P') {
      const dir = color === 'w' ? 1 : -1, startRank = color === 'w' ? 1 : 6;
      const r = rank(fromSq), f = file(fromSq);
      const fwd = sq_(r + dir, f);
      if (fwd >= 0 && fwd < 64 && isEmpty(squares, fwd)) { moves.push({ from: fromSq, to: fwd }); if (r === startRank) { const fwd2 = sq_(r + 2 * dir, f); if (isEmpty(squares, fwd2)) moves.push({ from: fromSq, to: fwd2 }); } }
      for (const df of [-1, 1]) { const nf = f + df; if (nf < 0 || nf > 7) continue; const cap = sq_(r + dir, nf); if (cap >= 0 && cap < 64) { if (isEnemy(squares[cap], color)) moves.push({ from: fromSq, to: cap }); if (cap === epSquare) moves.push({ from: fromSq, to: cap, ep: true }); } }
    } else if (type === 'N') { for (const [dr, df] of [[-2,-1],[-2,1],[-1,-2],[-1,2],[1,-2],[1,2],[2,-1],[2,1]]) { const nr = rank(fromSq) + dr, nf = file(fromSq) + df; if (nr >= 0 && nr < 8 && nf >= 0 && nf < 8) addIfValid(moves, squares, color, fromSq, sq_(nr, nf)); }
    } else if (type === 'B') { slideMoves(moves, squares, color, fromSq, [[-1,-1],[-1,1],[1,-1],[1,1]]);
    } else if (type === 'R') { slideMoves(moves, squares, color, fromSq, [[-1,0],[1,0],[0,-1],[0,1]]);
    } else if (type === 'Q') { slideMoves(moves, squares, color, fromSq, [[-1,-1],[-1,1],[1,-1],[1,1],[-1,0],[1,0],[0,-1],[0,1]]);
    } else if (type === 'K') {
      for (const [dr, df] of [[-1,-1],[-1,0],[-1,1],[0,-1],[0,1],[1,-1],[1,0],[1,1]]) { const nr = rank(fromSq) + dr, nf = file(fromSq) + df; if (nr >= 0 && nr < 8 && nf >= 0 && nf < 8) addIfValid(moves, squares, color, fromSq, sq_(nr, nf)); }
      if (color === 'w' && fromSq === 4) { if (board.castling.wK && isEmpty(squares,5) && isEmpty(squares,6) && squares[7]?.[0]==='R') moves.push({ from: fromSq, to: 6, castle: 'K' }); if (board.castling.wQ && isEmpty(squares,1) && isEmpty(squares,2) && isEmpty(squares,3) && squares[0]?.[0]==='R') moves.push({ from: fromSq, to: 2, castle: 'Q' }); }
      if (color === 'b' && fromSq === 60) { if (board.castling.bK && isEmpty(squares,61) && isEmpty(squares,62) && squares[63]?.[0]==='R') moves.push({ from: fromSq, to: 62, castle: 'K' }); if (board.castling.bQ && isEmpty(squares,57) && isEmpty(squares,58) && isEmpty(squares,59) && squares[56]?.[0]==='R') moves.push({ from: fromSq, to: 58, castle: 'Q' }); }
    }
    return moves;
  }
  function isSquareAttacked(squares, sq, byColor) {
    const opp = byColor;
    for (const df of [-1, 1]) { const pr = rank(sq) + (opp === 'w' ? -1 : 1), pf = file(sq) + df; if (pr >= 0 && pr < 8 && pf >= 0 && pf < 8) { const p = squares[sq_(pr, pf)]; if (p && p[0] === 'P' && p[1] === opp) return true; } }
    for (const [dr, df] of [[-2,-1],[-2,1],[-1,-2],[-1,2],[1,-2],[1,2],[2,-1],[2,1]]) { const r = rank(sq) + dr, f = file(sq) + df; if (r >= 0 && r < 8 && f >= 0 && f < 8) { const p = squares[sq_(r, f)]; if (p && p[0] === 'N' && p[1] === opp) return true; } }
    for (const [dr, df] of [[-1,0],[1,0],[0,-1],[0,1]]) { let r = rank(sq) + dr, f = file(sq) + df; while (r >= 0 && r < 8 && f >= 0 && f < 8) { const p = squares[sq_(r, f)]; if (p) { if (p[1] === opp && (p[0] === 'R' || p[0] === 'Q')) return true; break; } r += dr; f += df; } }
    for (const [dr, df] of [[-1,-1],[-1,1],[1,-1],[1,1]]) { let r = rank(sq) + dr, f = file(sq) + df; while (r >= 0 && r < 8 && f >= 0 && f < 8) { const p = squares[sq_(r, f)]; if (p) { if (p[1] === opp && (p[0] === 'B' || p[0] === 'Q')) return true; break; } r += dr; f += df; } }
    for (const [dr, df] of [[-1,-1],[-1,0],[-1,1],[0,-1],[0,1],[1,-1],[1,0],[1,1]]) { const r = rank(sq) + dr, f = file(sq) + df; if (r >= 0 && r < 8 && f >= 0 && f < 8) { const p = squares[sq_(r, f)]; if (p && p[0] === 'K' && p[1] === opp) return true; } }
    return false;
  }
  function findKing(squares, color) { for (let i = 0; i < 64; i++) { if (squares[i] && squares[i][0] === 'K' && squares[i][1] === color) return i; } return -1; }
  function isInCheck(squares, color) { const kp = findKing(squares, color); if (kp < 0) return true; return isSquareAttacked(squares, kp, color === 'w' ? 'b' : 'w'); }
  function applyMove(board, move) {
    const b = cloneBoard(board); const piece = b.squares[move.from]; const [type, color] = piece; const opp = color === 'w' ? 'b' : 'w';
    b.squares[move.to] = piece; b.squares[move.from] = EMPTY; b.epSquare = -1;
    if (type === 'P' && move.ep) { b.squares[move.to + (color === 'w' ? -8 : 8)] = EMPTY; }
    if (type === 'P' && Math.abs(move.to - move.from) === 16) { b.epSquare = (move.from + move.to) >> 1; }
    if (type === 'P') { const promRank = color === 'w' ? 7 : 0; if (rank(move.to) === promRank) b.squares[move.to] = [move.promotion || 'Q', color]; }
    if (type === 'K') { if (color === 'w') { b.castling.wK = false; b.castling.wQ = false; } else { b.castling.bK = false; b.castling.bQ = false; } if (move.castle === 'K') { b.squares[color==='w'?5:61] = b.squares[color==='w'?7:63]; b.squares[color==='w'?7:63] = EMPTY; } else if (move.castle === 'Q') { b.squares[color==='w'?3:59] = b.squares[color==='w'?0:56]; b.squares[color==='w'?0:56] = EMPTY; } }
    if (type === 'R') { if (move.from===0) b.castling.wQ=false; if (move.from===7) b.castling.wK=false; if (move.from===56) b.castling.bQ=false; if (move.from===63) b.castling.bK=false; }
    b.turn = opp; return b;
  }
  function isLegalMove(board, move) {
    const piece = board.squares[move.from]; if (!piece || piece[1] !== board.turn) return false;
    const pseudo = pseudoLegalMoves(board, move.from); const found = pseudo.find(m => m.to === move.to); if (!found) return false;
    if (found.castle) { const color = piece[1], opp = color === 'w' ? 'b' : 'w', kingFrom = color === 'w' ? 4 : 60, throughSq = found.castle === 'K' ? kingFrom + 1 : kingFrom - 1; if (isInCheck(board.squares, color)) return false; if (isSquareAttacked(board.squares, throughSq, opp)) return false; if (isSquareAttacked(board.squares, move.to, opp)) return false; }
    const after = applyMove(board, found); return !isInCheck(after.squares, piece[1]);
  }
  function rebuildBoard(moves) {
    let board = startBoard();
    for (const move of (moves || [])) {
      try {
        const pseudo = pseudoLegalMoves(board, move.from);
        const found = pseudo.find(m => m.to === move.to);
        if (!found) { console.warn('[serverChess] rebuildBoard: нет хода from', move.from, 'to', move.to); break; }
        if (found.promotion !== undefined || move.promotion) found.promotion = move.promotion || 'Q';
        board = applyMove(board, found);
      } catch(e) { console.warn('[serverChess] rebuildBoard error:', e.message); break; }
    }
    return board;
  }
  function findMove(board, move) {
    const pseudo = pseudoLegalMoves(board, move.from);
    const found = pseudo.find(m => m.to === move.to);
    if (!found) return move;
    if (move.promotion) found.promotion = move.promotion;
    return found;
  }
  function hasAnyLegalMove(board, color) {
    for (let sq = 0; sq < 64; sq++) {
      const piece = board.squares[sq];
      if (!piece || piece[1] !== color) continue;
      const pseudo = pseudoLegalMoves({ ...board, turn: color }, sq);
      for (const m of pseudo) {
        if (isLegalMove({ ...board, turn: color }, m)) return true;
      }
    }
    return false;
  }
  function isCheckmate(board) { return isInCheck(board.squares, board.turn) && !hasAnyLegalMove(board, board.turn); }
  function isStalemate(board) { return !isInCheck(board.squares, board.turn) && !hasAnyLegalMove(board, board.turn); }

  // ── Ничьи по правилам (50 ходов / недостаток материала / троекратное
  // повторение) — раньше сервер их вообще не проверял, потому что клиент
  // никогда и не заявлял о них (см. баги 2/3 в board.js). Теперь сервер
  // умеет перепроверить любую такую заявку по реальной истории ходов,
  // так же как уже делает для мата/пата — иначе клиент мог бы просто
  // соврать "ничья по повторению" в любой момент партии.
  function isInsufficientMaterial(squares) {
    const pieces = squares.filter(Boolean);
    if (pieces.length === 2) return true; // K-K
    if (pieces.length === 3) {
      const minor = pieces.find(p => p[0] === 'B' || p[0] === 'N');
      if (minor) return true; // K+B-K or K+N-K
    }
    return false;
  }
  // Отпечаток позиции для правила повторения: расстановка + очередь хода +
  // права рокировки + клетка взятия на проходе (без счётчиков ходов).
  function positionKey(board) {
    return board.squares.map(p => p ? p[0] + p[1] : '-').join('') + '|' + board.turn + '|'
      + (board.castling.wK?'1':'0') + (board.castling.wQ?'1':'0') + (board.castling.bK?'1':'0') + (board.castling.bQ?'1':'0')
      + '|' + board.epSquare;
  }
  // Реплеим партию с начала, считая: (а) сколько раз встречалась текущая
  // позиция — для троекратного повторения, (б) полуходов с последнего
  // взятия/хода пешки — для правила 50 ходов.
  function replayForDrawRules(moves) {
    let board = startBoard();
    const counts = new Map();
    counts.set(positionKey(board), 1);
    let halfmove = 0;
    for (const move of (moves || [])) {
      const pseudo = pseudoLegalMoves(board, move.from);
      const found = pseudo.find(m => m.to === move.to);
      if (!found) break;
      const piece = board.squares[move.from];
      const isCapture = !!board.squares[move.to] || found.ep;
      const isPawn = piece && piece[0] === 'P';
      if (found.promotion !== undefined || move.promotion) found.promotion = move.promotion || 'Q';
      board = applyMove(board, found);
      halfmove = (isCapture || isPawn) ? 0 : halfmove + 1;
      const key = positionKey(board);
      counts.set(key, (counts.get(key) || 0) + 1);
    }
    return { board, repetitions: counts.get(positionKey(board)) || 1, halfmove };
  }
  function isThreefoldRepetition(moves) { return replayForDrawRules(moves).repetitions >= 3; }
  function isFiftyMoveRule(moves) { return replayForDrawRules(moves).halfmove >= 100; }

  return { startBoard, isLegalMove, applyMove, cloneBoard, rebuildBoard, findMove, isCheckmate, isStalemate, hasAnyLegalMove, isInsufficientMaterial, isThreefoldRepetition, isFiftyMoveRule };
})();

const limiterSocketConnect = new RateLimiter(60_000, 200);

io.on('connection', (socket) => {
  // Socket.io не использует req.ip — читаем заголовок напрямую из handshake.
  // x-forwarded-for может содержать несколько IP через запятую: "реальный, cloudflare, nginx..."
  // Берём крайний левый — это и есть реальный IP клиента.
  const socketIP = (
    socket.handshake.headers['x-forwarded-for']?.split(',')[0]?.trim()
    || socket.handshake.headers['x-real-ip']
    || socket.handshake.address
    || 'unknown'
  );

  if (bannedIPs.has(socketIP)) {
    const banCheckTimer = setTimeout(() => { if (!socket.username) socket.disconnect(true); }, 3000);
    socket.once('auth', () => clearTimeout(banCheckTimer));
  }

  if (!limiterSocketConnect.check(socketIP).allowed) { socket.disconnect(true); return; }

  // ── ДОМАШНИЙ WORKER: аутентификация по секретному токену ──────
  // Если задан WORKER_SECRET в .env — принимаем воркер-подключения.
  // Если не задан вообще — фича просто выключена, ничего не ломается.
  socket.on('worker_auth', (payload) => {
    const secret = typeof payload === 'string' ? payload : payload?.secret;
    if (!process.env.WORKER_SECRET || secret !== process.env.WORKER_SECRET) {
      socket.emit('worker_auth_error', 'Неверный секрет');
      socket.disconnect(true);
      return;
    }
    const threads = (typeof payload === 'object' && Number.isInteger(payload?.threads))
      ? Math.max(1, Math.min(payload.threads, 64)) : 1;
    workers.set(socket.id, { socket, threads, busy: false, lastSeen: Date.now() });
    socket.isWorker = true;
    socket.emit('worker_auth_ok');
    console.log(`[Worker] Подключился (${threads} поток(а/ов)). Всего воркеров онлайн: ${workers.size}`);
  });
  socket.on('worker_heartbeat', () => {
    const w = workers.get(socket.id);
    if (w) w.lastSeen = Date.now();
  });
  // Воркер прислал промежуточную строку анализа ("info depth ...") —
  // пересылаем её как есть тому браузеру, который заказал анализ.
  // Формат строки — родной UCI-вывод Stockfish, парсер на клиенте
  // (stockfish-ui.js) уже умеет такие строки читать — не важно,
  // пришли они от локального движка в браузере или от воркера.
  socket.on('worker_job_progress', ({ jobId, line }) => {
    const job = analyzeJobs.get(jobId);
    if (!job) return;
    const requester = io.sockets.sockets.get(job.requesterSocketId);
    if (requester) requester.emit('analyze_line', line);
  });
  socket.on('worker_job_done', ({ jobId, line }) => {
    const job = analyzeJobs.get(jobId);
    if (!job) return;
    const requester = io.sockets.sockets.get(job.requesterSocketId);
    if (requester) requester.emit('analyze_line', line);
    const w = workers.get(job.workerSocketId);
    if (w) w.busy = false;
    analyzeJobs.delete(jobId);
  });

  // ── Запрос анализа от обычного посетителя (страница «Анализ») ──
  socket.on('analyze_request', ({ fen, depth }) => {
    if (typeof fen !== 'string' || fen.length > 100) return;
    const safeDepth = Number.isInteger(depth) ? Math.max(1, Math.min(depth, 30)) : 18;
    const w = pickIdleWorker();
    if (!w) { socket.emit('analyze_unavailable'); return; } // клиент сам уйдёт на локальный анализ в браузере
    const jobId = uuidv4();
    w.busy = true;
    analyzeJobs.set(jobId, { requesterSocketId: socket.id, workerSocketId: w.socket.id });
    w.socket.emit('worker_job', { jobId, fen, depth: safeDepth });
  });
  socket.on('analyze_cancel', () => {
    for (const [jobId, job] of analyzeJobs.entries()) {
      if (job.requesterSocketId === socket.id) {
        const w = workers.get(job.workerSocketId);
        if (w) { w.socket.emit('worker_job_cancel', { jobId }); w.busy = false; }
        analyzeJobs.delete(jobId);
      }
    }
  });
  socket.on('disconnect', () => {
    if (socket.isWorker && workers.has(socket.id)) {
      workers.delete(socket.id);
      // Если у этого воркера была незавершённая задача — сообщаем
      // заказчику, чтобы он не завис в ожидании, а ушёл на локальный
      // анализ в браузере.
      for (const [jobId, job] of analyzeJobs.entries()) {
        if (job.workerSocketId === socket.id) {
          const requester = io.sockets.sockets.get(job.requesterSocketId);
          if (requester) requester.emit('analyze_unavailable');
          analyzeJobs.delete(jobId);
        }
      }
      console.log(`[Worker] Отключился. Воркеров онлайн: ${workers.size}`);
    }
  });

  const origOn = socket.on.bind(socket);
  socket.on = function(event, handler) {
    if (event === 'connect' || event === 'disconnect' || event === 'error') return origOn(event, handler);
    return origOn(event, (...args) => {
      if (!socketLimiter.check(socket.id + '_' + event).allowed) { socket.emit('error', 'Слишком много запросов. Притормози!'); return; }
      handler(...args);
    });
  };

  socket.on('auth', async (_clientSuppliedToken) => {
    // Токен читаем ТОЛЬКО из HttpOnly-cookie в заголовках handshake —
    // аргумент, присланный клиентом, больше не используется, т.к. JS
    // на странице не может (и не должен) знать значение httpOnly-токена.
    const handshakeCookies = parseCookieHeader(socket.handshake.headers.cookie);
    const token = handshakeCookies.ch_token;
    const p = token ? verifyToken(token) : null;
    if (!p) return socket.emit('auth_error', 'Неверный токен');
    if (bannedIPs.has(socketIP)) { socket.emit('auth_error', 'Ваш IP заблокирован'); socket.disconnect(); return; }

    // БАГ (исправлено): раньше между verifyToken() и этим блоком стоял
    // "await getUser(...)" — а он обращается к кэшу/БД, то есть реально
    // отдаёт управление event loop'у. Если у юзера открыто несколько
    // вкладок (у каждой — свой socket от app.js И свой отдельный socket
    // от header.js для DM) и он быстро перезагружает страницу, несколько
    // auth-событий одного и того же юзера начинают выполняться
    // параллельно, и их await'ы могли завершиться в ЛЮБОМ порядке. Из-за
    // этого сокет, который должен был быть найден как "старый" и вытолкнут
    // (oldSocket.disconnect), иногда проскакивал мимо этой проверки —
    // потому что на момент его собственного запроса prevOldId ещё
    // указывал на кого-то другого, кто сам уже был снят с учёта. Такой
    // "потерянный" сокет оставался реально подключённым (просто не как
    // текущая сессия юзера) до тех пор, пока не отваливался сам по
    // ping-таймауту socket.io (~20-30 сек) — отсюда и временный, сам
    // проходящий разнобой в счётчике онлайна.
    // Фикс: всю регистрацию сессии (поиск+вытеснение старого сокета,
    // запись в sessions/usernameToSocketId/onlineUsers) делаем СРАЗУ,
    // одним синхронным куском без await между чтением токена и записью —
    // гонки конкурирующих auth-вызовов для одного юзера больше нет.
    // Проверку бана делаем уже ПОСЛЕ регистрации: если юзер забанен —
    // просто отключаем этот (уже корректно зарегистрированный) сокет,
    // и штатный disconnect-обработчик сам всё почистит.
    const prevOldId = usernameToSocketId.get(p.username.toLowerCase());
    if (prevOldId && prevOldId !== socket.id) {
      const oldSocket = io.sockets.sockets.get(prevOldId);
      if (oldSocket) oldSocket.disconnect(true);
      sessions.delete(prevOldId);
    }
    sessions.set(socket.id, { username: p.username });
    usernameToSocketId.set(p.username.toLowerCase(), socket.id);
    onlineUsers.add(p.username);
    socket.username = p.username;

    const user = await getUser(p.username.toLowerCase());
    if (user?.banned) { socket.emit('auth_error', 'Аккаунт заблокирован: ' + (user.banReason || 'нарушение правил')); socket.disconnect(); return; }

    socket.emit('auth_ok', { username: p.username });
    io.emit('online_count', onlineUsers.size);
    // Автоматически возвращаем игрока в очередь поиска соперника после
    // короткого обрыва связи (см. пометку "_resumeOnReconnect" в disconnect-хендлере),
    // если он именно искал партию, а не поставил паузу сам руками.
    for (const t of tournaments) {
      const tp = t.participants.find(tp => tp.username === p.username);
      if (!tp) continue;
      if (tp._resumeOnReconnect) {
        tp._resumeOnReconnect = false;
        if (!tp.left && !tp.anticheatBanned && !tp.currentGameId && getTournamentStatus(t, Date.now()) === 'active') {
          tp.waiting = true;
          io.to(`tournament_${t.id}`).emit('tournament_update', sanitizeTournament(t));
          saveTournament(t).catch(() => {});
          tryPairTournamentPlayers(t);
        }
      }
    }
    for (const [gId, game] of activeGames.entries()) {
      if (game.white === p.username || game.black === p.username) {
        const color = game.white === p.username ? 'white' : 'black';
        const opponent = color === 'white' ? game.black : game.white;
        const oppRating = usersCache.get(opponent.toLowerCase())?.rating ?? '?';
        let rejoinWhiteTime = game.whiteTime, rejoinBlackTime = game.blackTime;
        if (game.lastMoveAt !== null && rejoinWhiteTime !== undefined) {
          const elapsedSince = (Date.now() - game.lastMoveAt) / 1000;
          if (game.turn === 'white') rejoinWhiteTime = Math.max(0, rejoinWhiteTime - elapsedSince);
          else                       rejoinBlackTime = Math.max(0, rejoinBlackTime - elapsedSince);
        }
        socket.emit('game_start', { gameId: gId, color, opponent, opponentRating: oppRating, timeControl: game.timeControl, moves: game.moves, whiteTime: rejoinWhiteTime, blackTime: rejoinBlackTime, lastMoveAt: game.lastMoveAt, chatMessages: game.chatMessages || [], ...(game.tournamentId ? { tournamentId: game.tournamentId, tournamentName: game.tournamentName, isInterclub: !!game.isInterclub, firstMoveDeadline: game.firstMoveDeadline } : {}) });
        if (!game._board) { game._board = serverChess.rebuildBoard(game.moves); }
        break;
      }
    }
  });

  socket.on('join_tournament_room',  (tid) => { socket.join(`tournament_${tid}`); const t = tournaments.find(t => t.id === tid); if (t) socket.emit('tournament_update', sanitizeTournament(t)); });
  socket.on('leave_tournament_room', (tid) => socket.leave(`tournament_${tid}`));

  socket.on('tournament_seek', (tournamentId) => {
    if (!socket.username) return;
    const t = tournaments.find(t => t.id === tournamentId);
    if (!t || getTournamentStatus(t, Date.now()) !== 'active') return socket.emit('error', 'Турнир не активен');
    const p = t.participants.find(p => p.username === socket.username);
    if (!p) return socket.emit('error', 'Вы не участвуете');
    if (p.currentGameId) return;
    p.waiting = true;
    p.paused = false;
    p.nextEligibleAt = 0; // явный клик "Играть" — грейс-период не нужен
    saveTournament(t).catch(() => {});
    io.to(`tournament_${t.id}`).emit('tournament_update', sanitizeTournament(t));
    tryPairTournamentPlayers(t);
  });

  socket.on('tournament_unseek', (tournamentId) => {
    if (!socket.username) return;
    const t = tournaments.find(t => t.id === tournamentId);
    if (!t) return;
    const p = t.participants.find(p => p.username === socket.username);
    if (p) { p.waiting = false; p.paused = true; saveTournament(t).catch(() => {}); io.to(`tournament_${t.id}`).emit('tournament_update', sanitizeTournament(t)); }
  });

  socket.on('tournament_rejoin', ({ tournamentId, gameId }) => {
    if (!socket.username) return;
    const t = tournaments.find(t => t.id === tournamentId);
    if (!t) return;
    const p = t.participants.find(p => p.username === socket.username);
    if (!p || p.currentGameId !== gameId) return;
    const game = activeGames.get(gameId);
    if (!game) return;
    const color = game.white === socket.username ? 'white' : 'black';
    const opponent = color === 'white' ? game.black : game.white;
    const oppRating = usersCache.get(opponent.toLowerCase())?.rating ?? '?';
    let rejoinWhiteTime = game.whiteTime, rejoinBlackTime = game.blackTime;
    if (game.lastMoveAt !== null && rejoinWhiteTime !== undefined) {
      const elapsedSince = (Date.now() - game.lastMoveAt) / 1000;
      if (game.turn === 'white') rejoinWhiteTime = Math.max(0, rejoinWhiteTime - elapsedSince);
      else                       rejoinBlackTime = Math.max(0, rejoinBlackTime - elapsedSince);
    }
    socket.emit('game_start', { gameId, color, opponent, opponentRating: oppRating, timeControl: game.timeControl, moves: game.moves, whiteTime: rejoinWhiteTime, blackTime: rejoinBlackTime, lastMoveAt: game.lastMoveAt, chatMessages: game.chatMessages || [], ...(game.tournamentId ? { tournamentId: game.tournamentId, tournamentName: game.tournamentName, isInterclub: !!game.isInterclub, firstMoveDeadline: game.firstMoveDeadline } : {}) });
  });

  socket.on('tournament_waiting', ({ tournamentId }) => {
    const t = tournaments.find(t => t.id === tournamentId);
    if (!t || !socket.username) return;
    const p = t.participants.find(p => p.username === socket.username);
    if (!p || p.left || p.anticheatBanned || p.currentGameId) return;
    if (getTournamentStatus(t, Date.now()) !== 'active') return;
    p.waiting = true;
    p.paused = false;
    p.nextEligibleAt = 0; // явный клик "Играть" — грейс-период не нужен
    saveTournament(t).catch(() => {});
    io.to(`tournament_${t.id}`).emit('tournament_update', sanitizeTournament(t));
    tryPairTournamentPlayers(t);
    // Повторная попытка спаривания через 1.5 сек — на случай если второй игрок ещё не вошёл в очередь
    setTimeout(() => tryPairTournamentPlayers(t), 1500);
  });

  socket.on('tournament_berserk', ({ gameId }) => {
    if (!socket.username) return;
    const game = tournamentGames.get(gameId); if (!game) return;
    const color = game.white === socket.username ? 'white' : 'black';
    if (game.berserk[color] || game.moveCounts[color] > 0) return;
    game.berserk[color] = true;
    const payload = { gameId, color, berserk: game.berserk };
    [findSocketByUsername(game.white), findSocketByUsername(game.black)].forEach(s => s?.emit('berserk_activated', payload));
  });

  socket.on('post_challenge', (data) => {
    if (!socket.username) return;
    const challenge = { id: uuidv4(), from: socket.username, timeControl: data.timeControl || '10+0', color: data.color || 'random', rated: data.rated !== false, createdAt: Date.now(), socketId: socket.id };
    const idx = pendingChallenges.findIndex(c => c.from === socket.username);
    if (idx !== -1) pendingChallenges.splice(idx, 1);
    pendingChallenges.push(challenge);
    io.emit('challenges_update', pendingChallenges.filter(c => Date.now() - c.createdAt < 60000));
  });

  socket.on('cancel_challenge', () => {
    if (!socket.username) return;
    const idx = pendingChallenges.findIndex(c => c.from === socket.username);
    if (idx !== -1) pendingChallenges.splice(idx, 1);
    io.emit('challenges_update', pendingChallenges.filter(c => Date.now() - c.createdAt < 60000));
  });

  socket.on('accept_challenge', (challengeId) => {
    if (!socket.username) return;
    const idx = pendingChallenges.findIndex(c => c.id === challengeId);
    if (idx === -1) return socket.emit('error', 'Вызов не найден');
    const challenge = pendingChallenges[idx];
    if (challenge.from === socket.username) return socket.emit('error', 'Нельзя принять свой вызов');
    pendingChallenges.splice(idx, 1);
    io.emit('challenges_update', pendingChallenges.filter(c => Date.now() - c.createdAt < 60000));
    setTimeout(() => startGame(socket, challenge), 50);
  });

  socket.on('challenge_user', (data) => {
    if (!socket.username) return;
    // Поддерживаем и старый формат вызова (просто ник строкой), и новый
    // объект { username, rated } — чтобы можно было выбрать товарищескую партию.
    const targetUsername = typeof data === 'string' ? data : data?.username;
    const rated = typeof data === 'string' ? true : data?.rated !== false;
    if (!targetUsername) return;
    const t = findSocketByUsername(targetUsername);
    if (!t) return socket.emit('error', 'Не в сети');
    t.emit('incoming_challenge', { from: socket.username, socketId: socket.id, rated });
  });

  socket.on('accept_direct_challenge', (data) => {
    if (!socket.username) return;
    const fromSocketId = typeof data === 'string' ? data : data?.fromSocketId;
    const rated = typeof data === 'string' ? true : data?.rated !== false;
    const fromSocket = io.sockets.sockets.get(fromSocketId);
    if (!fromSocket) return socket.emit('error', 'Игрок отключился');
    startGame(socket, { from: fromSocket.username, timeControl: '10+0', color: 'random', rated, socketId: fromSocketId });
  });

  socket.on('decline_challenge', (fromSocketId) => {
    const fs = io.sockets.sockets.get(fromSocketId);
    if (fs) fs.emit('challenge_declined', socket.username);
  });

  socket.on('rejoin_game', ({ gameId }) => {
    if (!socket.username) return;
    const game = activeGames.get(gameId);
    if (!game || (game.white !== socket.username && game.black !== socket.username)) return;
    game._board = serverChess.rebuildBoard(game.moves);
    socket.emit('rejoin_ack', { gameId, moves: game.moves, turn: game.turn, whiteTime: game.whiteTime, blackTime: game.blackTime, chatMessages: game.chatMessages || [] });
  });

  socket.on('make_move', ({ gameId, move }) => {
    const game = activeGames.get(gameId);
    if (!game) { socket.emit('error', 'Партия не найдена (возможно, уже завершилась)'); return; }
    if (typeof move !== 'object' || typeof move.from !== 'number' || typeof move.to !== 'number') return;
    if (move.from < 0 || move.from > 63 || move.to < 0 || move.to > 63) return;
    if (game.white !== socket.username && game.black !== socket.username) return;
    const pc = game.white === socket.username ? 'white' : 'black';
    // БАГ (исправлено): раньше здесь был просто "return" без единого
    // уведомления клиенту. Но клиент к этому моменту уже применил ход
    // ЛОКАЛЬНО, оптимистично, ещё до ответа сервера (см. board.js:
    // executeMove) — значит игрок видел, что сходил, а сервер это молча
    // отбрасывал. Причина рассинхронизации turn — обычно короткий обрыв
    // связи, из-за которого предыдущий ход/подтверждение потерялись.
    // Теперь в такой ситуации шлём 'move_rejected' с полной актуальной
    // историей ходов и временем — клиент по этому событию откатывает
    // локальную доску и пересобирает её по реальному состоянию партии
    // (см. app.js: socket.on('move_rejected', ...) и board.js:resyncFromServer).
    if (game.turn !== pc) {
      socket.emit('move_rejected', {
        gameId, reason: 'not-your-turn',
        moves: game.moves, whiteTime: game.whiteTime, blackTime: game.blackTime, lastMoveAt: game.lastMoveAt,
      });
      return;
    }
    if (game._board) {
      const moveObj = { from: move.from, to: move.to, promotion: move.promotion || null };
      if (!serverChess.isLegalMove(game._board, moveObj)) {
        const rebuilt = serverChess.rebuildBoard(game.moves);
        if (!serverChess.isLegalMove(rebuilt, moveObj)) {
          socket.emit('move_rejected', {
            gameId, reason: 'illegal-move',
            moves: game.moves, whiteTime: game.whiteTime, blackTime: game.blackTime, lastMoveAt: game.lastMoveAt,
          });
          return;
        }
        game._board = rebuilt;
        console.warn(`[make_move] Ресинхронизация доски для игры ${gameId} (игрок: ${socket.username})`);
      }
      try { const found = serverChess.findMove(game._board, moveObj); game._board = serverChess.applyMove(game._board, found); } catch (e) { console.warn('[make_move] applyMove error:', e); }
    }
    const now = Date.now();
    if (game.lastMoveAt !== null && game.whiteTime !== undefined) {
      const elapsed = (now - game.lastMoveAt) / 1000;
      if (pc === 'white') game.whiteTime = Math.max(0, game.whiteTime - elapsed + (game.tcIncrement || 0));
      else                game.blackTime = Math.max(0, game.blackTime - elapsed + (game.tcIncrement || 0));
    }
    if (!game._acMoveTimes)  game._acMoveTimes = { white: [], black: [] };
    if (!game._acSuspect)    game._acSuspect   = { white: 0, black: 0 };
    if (game._acLastMoveAt && game.moves.length > 4) {
      const moveMs = now - game._acLastMoveAt;
      const times = game._acMoveTimes[pc]; times.push(moveMs); if (times.length > 20) times.shift();
      if (times.length >= 10) {
        const avg = times.reduce((a, b) => a + b, 0) / times.length;
        if (avg < 900 && times.every(t => t < 1200)) {
          game._acSuspect[pc]++;
          if (game._acSuspect[pc] >= 3) {
            emitToAdmins('anticheat_alert', { username: socket.username, gameId, avgMs: Math.round(avg), suspectLevel: game._acSuspect[pc], message: `🚨 Возможный движок: ${socket.username} (avg ${Math.round(avg)}ms/ход)` }).catch(() => {});
          }
        } else if (avg > 3000) { game._acSuspect[pc] = Math.max(0, game._acSuspect[pc] - 1); }
      }
    }
    game._acLastMoveAt = now;
    game.lastMoveAt = now;
    game.moves.push(move); game.turn = game.turn === 'white' ? 'black' : 'white'; game.lastActivity = now;
    if (game.moveCounts) game.moveCounts[pc] = (game.moveCounts[pc] || 0) + 1;
    if (game.firstMoveDeadline) {
      if (game.moves.length === 1) {
        // Белые сделали первый ход — даём чёрным отдельные 20 сек на их первый ход
        game.firstMoveDeadline = now + FIRST_MOVE_TIMEOUT;
      } else if (game.moves.length === 2) {
        // Чёрные тоже сходили первый раз — таймер первого хода больше не нужен
        game.firstMoveDeadline = null;
      }
    }
    const other = findSocketByUsername(pc === 'white' ? game.black : game.white);
    const timePayload = { move, gameId, whiteTime: game.whiteTime, blackTime: game.blackTime, serverAt: now, firstMoveDeadline: game.firstMoveDeadline };
    socket.emit('move_confirmed', timePayload);
    if (other) other.emit('opponent_move', timePayload);
  });

  socket.on('game_over', async ({ gameId, result, reason, accuracy }) => {
    const game = activeGames.get(gameId); if (!game) return;
    // Игрок должен быть участником этой партии, чтобы вообще заявлять об её завершении
    if (socket.username !== game.white && socket.username !== game.black) return;

    const norm = result === 'w' ? 'white' : result === 'b' ? 'black' : result;
    if (norm !== 'white' && norm !== 'black' && norm !== 'draw') return;

    // ── Таймаут больше не принимается от клиента — это решает только
    // серверный интервал (endGameAuthoritative выше), который знает
    // реальное оставшееся время по game.lastMoveAt. Клиентские часы
    // (clockInterval и т.п.) не могут завершить партию по флагу.
    if (reason === 'timeout' || reason === 'flag') {
      socket.emit('error', 'Таймаут определяется сервером');
      return;
    }

    // ── Мат/пат — проверяем по реальной позиции на сервере, а не
    // просто принимаем то, что прислал клиент.
    if (reason === 'checkmate' || reason === 'stalemate') {
      const board = game._board || serverChess.rebuildBoard(game.moves);
      const boardTurnColor = board.turn === 'w' ? 'white' : 'black';
      if (reason === 'checkmate') {
        if (!serverChess.isCheckmate(board)) { socket.emit('error', 'Мат не подтверждён сервером'); return; }
        const expectedWinner = boardTurnColor === 'white' ? 'black' : 'white';
        if (norm !== expectedWinner) { socket.emit('error', 'Некорректный результат мата'); return; }
      } else {
        if (!serverChess.isStalemate(board)) { socket.emit('error', 'Пат не подтверждён сервером'); return; }
        if (norm !== 'draw') { socket.emit('error', 'Некорректный результат пата'); return; }
      }
    }

    // ── Ничьи по правилам (50 ходов / недостаток материала / троекратное
    // повторение позиции) — тоже перепроверяем по истории ходов, а не
    // просто верим клиенту. Раньше клиент такие заявки вообще не слал
    // (см. исправление в board.js), из-за чего партия никогда не
    // завершалась сама — время шло, а ходить было некуда.
    if (reason === 'threefold-repetition' || reason === 'fifty-move' || reason === 'insufficient-material') {
      if (norm !== 'draw') { socket.emit('error', 'Некорректный результат ничьей'); return; }
      if (reason === 'threefold-repetition' && !serverChess.isThreefoldRepetition(game.moves)) {
        socket.emit('error', 'Повторение позиции не подтверждено сервером'); return;
      }
      if (reason === 'fifty-move' && !serverChess.isFiftyMoveRule(game.moves)) {
        socket.emit('error', 'Правило 50 ходов не подтверждено сервером'); return;
      }
      if (reason === 'insufficient-material') {
        const board = game._board || serverChess.rebuildBoard(game.moves);
        if (!serverChess.isInsufficientMaterial(board.squares)) {
          socket.emit('error', 'Недостаток материала не подтверждён сервером'); return;
        }
      }
    }

    // Удаляем сразу — чтобы второй клиент не мог вызвать game_over дважды на ту же игру
    if (accuracy) game.accuracy = accuracy;
    await endGameAuthoritative(gameId, game, norm, reason);
  });

  socket.on('resign', async ({ gameId }) => {
    const game = activeGames.get(gameId); if (!game) return;
    activeGames.delete(gameId);
    tournamentGames.delete(gameId);
    const rc = game.white === socket.username ? 'white' : 'black';
    const wc = rc === 'white' ? 'black' : 'white';
    const winSock = findSocketByUsername(wc === 'white' ? game.white : game.black);
    socket.emit('game_ended', { gameId, result: wc, reason: 'resign' });
    if (winSock) winSock.emit('game_ended', { gameId, result: wc, reason: 'opponent_resign' });
    const isTournament = !!game.tournamentId;
    if (isTournament) { const t = tournaments.find(t => t.id === game.tournamentId); if (t) await finishTournamentGame(t, game, wc, 'resign'); }
    else if (hasFullMove(game)) { await recordGame(game, wc, 'resign'); await updateStats(game.white, game.black, wc, game.rated !== false); }
  });

  socket.on('offer_draw', ({ gameId }) => {
    const game = activeGames.get(gameId); if (!game) return;
    const opp = game.white === socket.username ? game.black : game.white;
    const os = findSocketByUsername(opp); if (os) os.emit('draw_offered', { gameId, from: socket.username });
  });

  socket.on('accept_draw', async ({ gameId }) => {
    const game = activeGames.get(gameId); if (!game) return;
    activeGames.delete(gameId);
    tournamentGames.delete(gameId);
    const payload = { gameId, result: 'draw', reason: 'agreement' };
    [findSocketByUsername(game.white), findSocketByUsername(game.black)].forEach(s => s?.emit('game_ended', payload));
    const isTournament = !!game.tournamentId;
    if (isTournament) { const t = tournaments.find(t => t.id === game.tournamentId); if (t) await finishTournamentGame(t, game, 'draw', 'agreement'); }
    else if (hasFullMove(game)) { await recordGame(game, 'draw', 'agreement'); await updateStats(game.white, game.black, 'draw', game.rated !== false); }
  });

  socket.on('game_chat', ({ gameId, message }) => {
    const game = activeGames.get(gameId); if (!game) return;
    const text = (message || '').trim().slice(0, 300); if (!text) return;
    const opp = game.white === socket.username ? game.black : game.white;
    const msg = { from: socket.username, message: text, gameId, ts: Date.now() };
    if (!game.chatMessages) game.chatMessages = [];
    game.chatMessages.push(msg);
    if (game.chatMessages.length > 100) game.chatMessages.shift();
    socket.emit('game_chat', msg);
    const os = findSocketByUsername(opp); if (os) os.emit('game_chat', msg);
  });

  socket.on('join_club_room', (clubId) => {
    if (!socket.username) return;
    const club = clubs.find(c => c.id === clubId);
    if (!club) return;
    if (!canWriteInClubChat(club, socket.username) && !isClubModerator(club, socket.username)) return;
    socket.join('club_' + clubId);
  });

  socket.on('leave_club_room', (clubId) => { socket.leave('club_' + clubId); });

// ── Фильтр глобального чата ─────────────────────────────────────
// Та же логика, что уже используется на клиенте (app.js:containsBadWords).
// БАГ (исправлено): раньше здесь был отдельный, свой, куда более грубый
// фильтр — плоский .includes() без учёта границ слова. Из-за этого
// "рубля" (и любое другое слово, просто ЗАКАНЧИВАющееся на "бля") ловилось
// как мат — а последствие было не просто "сообщение не отправлено", а
// chatHardBan(): ПОЖИЗНЕННЫЙ бан аккаунта и устройства с удалением
// истории сообщений. Заодно убрал токсичные-но-не-матерные слова
// ("дебил","идиот","мразь","тварь","урод","чмошник") — это не мат, их
// уже убрали из клиентского списка по этой же причине (см. app.js).
const MAT_WORDS_CHAT = [
  'блять','блядь','бля','пиздец','пизда','пизду','пизды',
  'сука','сучка','хуй','хуе','хер',
  'ебать','ебал','ебан','ебаный','ебло','еблан','ебуч','заеб','выеб',
  'нахуй','нахер','похуй','похер',
  'гандон','долбоеб','долбоёб','далбаеб','далбоеб','далбоёб','мудак',
  'шлюха','шлюх','шалава','проститутка',
  'соси','сосать','отсоси','сраный','обосранный','пздц',
  'fuck','fucking','bitch','asshole','dick','shit',
];
// Спам/казино/ссылки — тут по-прежнему ищем максимально агрессивно (в
// одну сплошную строку без пробелов). Заодно почистил два "мёртвых"
// слова из старого списка — "договорноймatch" и "легкиеdeньги" — там
// была опечатка вперемешку кириллицы с латиницей, из-за которой они
// физически не могли ни с чем совпасть.
const SPAM_WORDS_CHAT = [
  'казино','casino','ставки','ставка','bet','букмекер',
  '1xbet','melbet','parimatch','fonbet','aviator',
  'выигрыш','джекпот','бонус','промокод','депозит','фриспины','free spin',
  'прогноз','договорной матч','легкие деньги',
];
function normalizeChatWord(text) {
  return text.toLowerCase().replace(/ё/g, 'е').replace(/[@]/g, 'a').replace(/[0]/g, 'o')
    .replace(/[3]/g, 'e').replace(/[1!]/g, 'i').replace(/9/g, 'я').replace(/6/g, 'б').replace(/4/g, 'ч');
}
function normalizeChatCollapsed(text) {
  return normalizeChatWord(text).replace(/\s+/g, '').replace(/[^a-zа-я0-9]/gi, '');
}
function chatMessageHasBadWords(text) {
  const collapsed = normalizeChatCollapsed(text);
  if (SPAM_WORDS_CHAT.some(w => collapsed.includes(normalizeChatCollapsed(w)))) return true;
  // Короткие корни (3 буквы и меньше, типа "бля","хер") ловим ТОЛЬКО как
  // начало слова — иначе поймаем "рубля","сабля","херсон" и подобные ни
  // при чём не виноватые слова. Более длинные однозначные корни ищем
  // где угодно внутри слова — это по-прежнему ловит приставочные формы.
  const tokens = normalizeChatWord(text).replace(/[^a-zа-я0-9\s]/gi, '').split(/\s+/).filter(Boolean);
  return MAT_WORDS_CHAT.some(rawWord => {
    const word = normalizeChatWord(rawWord).replace(/[^a-zа-я0-9]/gi, '');
    if (!word) return false;
    // "хер" отдельно — только точное совпадение слова целиком, иначе
    // ловит "Херсон", "херувим" и подобные ни при чём не виноватые слова.
    if (word === 'хер') return tokens.includes(word);
    if (word.length <= 3) return tokens.some(t => t.startsWith(word));
    return tokens.some(t => t.includes(word));
  });
}

  socket.on('global_chat', async ({ message }) => {
    if (!socket.username) return;
    const text = (message || '').trim().slice(0, 300); if (!text) return;
    const now = Date.now();
    const user = await getUser(socket.username.toLowerCase());
    if (!user || user.banned) { socket.disconnect(); return; }

    if (global.chatBans) {
      const unbanAt = global.chatBans.get(socket.username.toLowerCase());
      if (unbanAt && unbanAt > now) {
        const minsLeft = Math.ceil((unbanAt - now) / 60000);
        socket.emit('error', `Вы забанены в чате ещё ${minsLeft} мин. Читайте правила платформы.`);
        return;
      } else if (unbanAt) { global.chatBans.delete(socket.username.toLowerCase()); }
    }

    const chatHardBan = async (reason) => {
      console.warn(`[ChatHardBan] ${socket.username} — ${reason}`);
      if (user.createdDeviceId) { bannedDevices.add(user.createdDeviceId); await saveBanToDB(null, user.createdDeviceId); }
      user.banned = true; user.banReason = reason; await saveUser(user);
      await removeUserChatMessages(socket.username);
      socket.emit('error', 'Заблокирован навсегда: ' + reason); socket.disconnect();
    };

    if (!socket._chatMsgs) socket._chatMsgs = [];
    socket._chatMsgs = socket._chatMsgs.filter(t => now - t < 10000); socket._chatMsgs.push(now);
    if (socket._chatMsgs.length > 10) { socket.emit('error', 'Вы временно отключены за спам в чате'); socket.disconnect(); return; }
    if (socket._chatMsgs.length > 5) { socket.emit('error', 'Слишком много сообщений. Притормози!'); return; }
    if (socket._lastChatAt && now - socket._lastChatAt < 1500) { socket.emit('error', 'Не так быстро!'); return; }
    socket._lastChatAt = now;

    const textLow = text.toLowerCase().replace(/[:/.\-\s]/g, '');
    const LINK_TRIGGERS = ['http','https','www','tme','discordgg','vkcom','instagramcom','tiktokcom'];
    if (LINK_TRIGGERS.some(t => textLow.includes(t))) { await chatHardBan('Реклама/ссылки в чате'); return; }

    if (chatMessageHasBadWords(text)) { await chatHardBan('Нарушение правил чата (запрещённые слова)'); return; }

    if (socket._lastChatMsg === text) {
      socket._dupCount = (socket._dupCount || 0) + 1;
      if (socket._dupCount >= 3) { await chatHardBan('Автобан: флуд (дублирование)'); return; }
      socket.emit('error', 'Не повторяйся'); return;
    }
    socket._lastChatMsg = text; socket._dupCount = 0;

    const msg = { id: uuidv4(), username: socket.username, message: text, role: user?.role === 'admin' ? 'admin' : 'user', timestamp: now, emoji: user.emoji || '', vip: isVip(user) };
    globalChat.push(msg); if (globalChat.length > 500) globalChat.shift();
    io.emit('global_chat', msg);
    saveChatMsg(msg).catch(e => console.error('[Chat save]', e.message));
  });

  socket.on('disconnect', () => {
    const sess = sessions.get(socket.id);
    if (sess) {
      onlineUsers.delete(sess.username); sessions.delete(socket.id);
      // Чистим индекс, только если он всё ещё указывает на этот сокет
      // (иначе можно случайно удалить более свежую запись при реконнекте).
      if (usernameToSocketId.get(sess.username.toLowerCase()) === socket.id) {
        usernameToSocketId.delete(sess.username.toLowerCase());
      }
      io.emit('online_count', onlineUsers.size);
      for (const t of tournaments) {
        const p = t.participants.find(p => p.username === sess.username);
        // БАГ: тут игрока молча вынимало из очереди поиска (waiting=false) при
        // любом обрыве соединения (сеть моргнула, телефон заблокировался,
        // сворачивание вкладки) — без paused=true и без broadcast. При
        // реконнекте auth-хендлер проверял "myPart.waiting && !myPart.paused",
        // но waiting уже был false, поэтому поиск соперника сам НЕ возобновлялся,
        // и игрок застревал на экране "пауза", хотя сам её не ставил.
        // Запоминаем, что человека нужно вернуть в очередь при следующем auth,
        // если он именно ждал соперника, а не поставил паузу сам.
        if (p && p.waiting && !p.left && !p.anticheatBanned && !p.currentGameId) {
          p._resumeOnReconnect = true;
        }
        if (p) p.waiting = false;
      }
    }
  });
});

async function main() {
  console.log('🐘 Подключение к PostgreSQL...');
  await pool.query('SELECT 1');
  console.log('✅ PostgreSQL подключён');

  await loadBansFromDB();
  await initPuzzleTables();
  await initDurkaTables();
  await initClubChatTable();
  await initDonateTable();
  await initTournamentChatTable();
  // Клубные турниры: привязка турнира к клубу + флаг «только для участников клуба»
  await db(`ALTER TABLE tournaments ADD COLUMN IF NOT EXISTS club_id TEXT`);
  await db(`ALTER TABLE tournaments ADD COLUMN IF NOT EXISTS club_only BOOLEAN DEFAULT FALSE`);
  await db(`CREATE INDEX IF NOT EXISTS idx_tournaments_club_id ON tournaments(club_id)`);
  // Межклубные турниры: is_interclub — флаг, team_ids — JSON-массив id клубов-команд (макс. 175).
  await db(`ALTER TABLE tournaments ADD COLUMN IF NOT EXISTS is_interclub BOOLEAN DEFAULT FALSE`);
  await db(`ALTER TABLE tournaments ADD COLUMN IF NOT EXISTS team_ids JSONB DEFAULT '[]'`);
  await db(`CREATE INDEX IF NOT EXISTS idx_tournaments_is_interclub ON tournaments(is_interclub)`);
  await db(`
    CREATE TABLE IF NOT EXISTS deleted_usernames (
      username_low TEXT PRIMARY KEY,
      deleted_at   BIGINT NOT NULL
    )
  `);
  // Описание профиля и внешние рейтинги (ФШР/FIDE)
  await db(`ALTER TABLE users ADD COLUMN IF NOT EXISTS bio TEXT DEFAULT ''`);
  await db(`ALTER TABLE users ADD COLUMN IF NOT EXISTS fshr_rating INT`);
  await db(`ALTER TABLE users ADD COLUMN IF NOT EXISTS fide_rating INT`);
  // 2FA по email при входе
  await db(`ALTER TABLE users ADD COLUMN IF NOT EXISTS two_factor_enabled BOOLEAN DEFAULT FALSE`);
  // VIP-значок: временный статус (метка времени окончания в мс), выдаётся вручную
  // из админ-панели только chesshome и Marina64 (см. isVipGranter/requireVipGranter).
  await db(`ALTER TABLE users ADD COLUMN IF NOT EXISTS vip_until BIGINT`);
  // Товарищеские (нерейтинговые) партии: старые записи считаются рейтинговыми
  await db(`ALTER TABLE games ADD COLUMN IF NOT EXISTS rated BOOLEAN DEFAULT TRUE`);
  // Создание таблицы для дневника разработки (перенесено сюда из глобальной области)
  await db(`
    CREATE TABLE IF NOT EXISTS dev_diary (
      id         TEXT PRIMARY KEY,
      author     TEXT NOT NULL,
      title      TEXT NOT NULL,
      content    TEXT NOT NULL,
      created_at BIGINT NOT NULL
    )
  `);

  await db(`
    CREATE TABLE IF NOT EXISTS dev_diary_reactions (
      entry_id     TEXT NOT NULL,
      username_low TEXT NOT NULL,
      emoji        TEXT NOT NULL,
      created_at   BIGINT NOT NULL,
      PRIMARY KEY (entry_id, username_low)
    )
  `);
  await db(`CREATE INDEX IF NOT EXISTS idx_ddr_entry ON dev_diary_reactions(entry_id)`);

  await db(`
    CREATE TABLE IF NOT EXISTS dev_diary_comments (
      id           TEXT PRIMARY KEY,
      entry_id     TEXT NOT NULL,
      username     TEXT NOT NULL,
      username_low TEXT NOT NULL,
      content      TEXT NOT NULL,
      created_at   BIGINT NOT NULL
    )
  `);
  await db(`CREATE INDEX IF NOT EXISTS idx_ddc_entry ON dev_diary_comments(entry_id, created_at ASC)`);
  await db(`CREATE INDEX IF NOT EXISTS idx_ddc_user  ON dev_diary_comments(username_low, created_at DESC)`);

  await db(`
    CREATE TABLE IF NOT EXISTS dev_diary_comment_bans (
      username_low TEXT PRIMARY KEY,
      created_at   BIGINT NOT NULL
    )
  `);

  // Аудит-лог просмотров переписок админами (см. /api/admin/dm/*).
  await db(`
    CREATE TABLE IF NOT EXISTS admin_dm_audit (
      id         TEXT PRIMARY KEY,
      admin      TEXT NOT NULL,
      target     TEXT NOT NULL,
      partner    TEXT,
      action     TEXT NOT NULL,
      created_at BIGINT NOT NULL
    )
  `);
  await db(`CREATE INDEX IF NOT EXISTS idx_admin_dm_audit_target ON admin_dm_audit(target, created_at DESC)`);
  await db(`CREATE INDEX IF NOT EXISTS idx_admin_dm_audit_admin  ON admin_dm_audit(admin, created_at DESC)`);

  // Общий лог всех значимых действий админов (бан/разбан, IP-баны, VIP,
  // задачи, системные сообщения, жалобы, обращения и т.п.) — максимальный
  // уровень контроля: видно, кто из админов что сделал и когда.
  await db(`
    CREATE TABLE IF NOT EXISTS admin_action_log (
      id         TEXT PRIMARY KEY,
      admin      TEXT NOT NULL,
      action     TEXT NOT NULL,
      target     TEXT,
      details    TEXT,
      created_at BIGINT NOT NULL
    )
  `);
  await db(`CREATE INDEX IF NOT EXISTS idx_admin_action_log_admin  ON admin_action_log(admin, created_at DESC)`);
  await db(`CREATE INDEX IF NOT EXISTS idx_admin_action_log_target ON admin_action_log(target, created_at DESC)`);
  await db(`CREATE INDEX IF NOT EXISTS idx_admin_action_log_action ON admin_action_log(action, created_at DESC)`);

  await loadChat();
  await loadTournaments();
  await loadTournamentChats();
  await loadClubs();
  await loadClubChats();
  await loadForum();
  await loadBlog();
  // БАГ: эти два вызова отсутствовали, из-за чего newsPosts/newsAuthors
  // оставались пустыми в памяти после каждого рестарта (pm2 restart и т.п.),
  // хотя в таблицах news_posts/news_authors в Postgres данные не терялись —
  // просто не подгружались обратно при старте процесса.
  await loadNewsAuthors();
  await loadNews();

  await db(`
    CREATE TABLE IF NOT EXISTS follows (
      follower    TEXT NOT NULL,
      following   TEXT NOT NULL,
      created_at  BIGINT NOT NULL,
      PRIMARY KEY (follower, following)
    )
  `);
  await db(`CREATE INDEX IF NOT EXISTS idx_follows_follower ON follows(follower)`);
  await db(`CREATE INDEX IF NOT EXISTS idx_follows_following ON follows(following)`);

  // Апелляции / обращения (тикеты) в поддержку
  await db(`
    CREATE TABLE IF NOT EXISTS appeals (
      id           TEXT PRIMARY KEY,
      username     TEXT NOT NULL,
      reason       TEXT NOT NULL,
      status       TEXT NOT NULL DEFAULT 'open',
      awaiting     TEXT NOT NULL DEFAULT 'admin',
      created_at   BIGINT NOT NULL,
      updated_at   BIGINT NOT NULL
    )
  `);
  await db(`CREATE INDEX IF NOT EXISTS idx_appeals_user ON appeals(username, created_at DESC)`);
  await db(`CREATE INDEX IF NOT EXISTS idx_appeals_status ON appeals(status, updated_at DESC)`);

  await db(`
    CREATE TABLE IF NOT EXISTS appeal_messages (
      id           TEXT PRIMARY KEY,
      appeal_id    TEXT NOT NULL,
      author       TEXT NOT NULL,
      is_admin     BOOLEAN NOT NULL DEFAULT FALSE,
      message      TEXT NOT NULL,
      created_at   BIGINT NOT NULL
    )
  `);
  await db(`CREATE INDEX IF NOT EXISTS idx_appeal_msgs ON appeal_messages(appeal_id, created_at ASC)`);

  if (!clubs.find(c => c.id === 'chesshome-official')) {
    const offClub = { id: 'chesshome-official', name: 'ChessHome', description: 'Официальный клуб шахматной платформы Chess Home.', createdAt: new Date().toISOString(), createdBy: 'ChessHome', admins: ['ChessHome'], members: ['ChessHome'], memberCount: 1, official: true };
    clubs.push(offClub); await saveClub(offClub);
  }

  for (const adminName of ['chesshome', 'marina64']) {
    const u = await getUser(adminName);
    if (u && u.role !== 'admin') { u.role = 'admin'; await saveUser(u); console.log(`[Admin] Подтверждён администратор: ${u.username}`); }
  }

  server.listen(PORT, () => {
    console.log(`♟️  Chess Home: http://localhost:${PORT}`);

    process.on('SIGINT',  () => { pool.end(); console.log('\nЗавершение работы...'); process.exit(0); });
    process.on('SIGTERM', () => { pool.end(); process.exit(0); });
  });
}

main().catch(e => { console.error('❌ Ошибка запуска:', e); process.exit(1); });