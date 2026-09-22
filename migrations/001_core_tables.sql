-- ═══════════════════════════════════════════════════════════════
-- 001_core_tables.sql — пользователи и баны
-- ═══════════════════════════════════════════════════════════════
-- Эти таблицы нигде в коде не создавались (только ALTER TABLE ...
-- ADD COLUMN IF NOT EXISTS в core.js, который предполагает, что
-- таблица уже есть). На новой БД это и роняло сервер.
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS users (
  id                          TEXT PRIMARY KEY,
  username                    TEXT NOT NULL,
  username_low                TEXT UNIQUE NOT NULL,
  email                       TEXT,
  password_hash               TEXT NOT NULL,
  rating                      INT NOT NULL DEFAULT 1200,
  games_played                INT NOT NULL DEFAULT 0,
  wins                        INT NOT NULL DEFAULT 0,
  losses                      INT NOT NULL DEFAULT 0,
  draws                       INT NOT NULL DEFAULT 0,
  avatar                      TEXT,
  role                        TEXT NOT NULL DEFAULT 'user',
  banned                      BOOLEAN NOT NULL DEFAULT FALSE,
  ban_reason                  TEXT,
  created_at                  BIGINT NOT NULL,
  created_from_ip             TEXT,
  created_device_id           TEXT,
  emoji                       TEXT DEFAULT '',
  bio                         TEXT DEFAULT '',
  fshr_rating                 INT,
  fide_rating                 INT,
  two_factor_enabled          BOOLEAN NOT NULL DEFAULT FALSE,
  vip_until                   BIGINT,
  shadow_banned                BOOLEAN NOT NULL DEFAULT FALSE,
  shadow_ban_reason           TEXT,
  badges                      JSONB NOT NULL DEFAULT '[]',
  puzzle_rating               INT NOT NULL DEFAULT 1200,
  puzzle_solved               INT NOT NULL DEFAULT 0,
  puzzle_attempted            INT NOT NULL DEFAULT 0,
  storm_best                  INT NOT NULL DEFAULT 0,
  storm_runs                  INT NOT NULL DEFAULT 0,
  -- квесты/кристаллы (routes.js: /api/quests/*) — тоже нигде не создавались
  total_crystals              INT NOT NULL DEFAULT 0,
  total_crystals_updated_at   BIGINT NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_users_created_from_ip   ON users(created_from_ip);
CREATE INDEX IF NOT EXISTS idx_users_created_device_id ON users(created_device_id);
CREATE INDEX IF NOT EXISTS idx_users_total_crystals     ON users(total_crystals DESC);


CREATE TABLE IF NOT EXISTS ip_bans (
  ip TEXT PRIMARY KEY
);

CREATE TABLE IF NOT EXISTS device_bans (
  device_id TEXT PRIMARY KEY
);
