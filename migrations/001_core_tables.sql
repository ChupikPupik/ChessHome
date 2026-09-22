-- ═══════════════════════════════════════════════════════════════
-- 001_core_tables.sql — пользователи и баны
-- ═══════════════════════════════════════════════════════════════
-- Эти таблицы нигде в коде не создавались (только ALTER TABLE ...
-- ADD COLUMN IF NOT EXISTS в core.js, который предполагает, что
-- таблица уже есть). На твоей машине они когда-то были созданы
-- вручную (через psql/pgAdmin), поэтому всё работало. На чистой БД
-- сервер падал на первой же отсутствующей таблице.
--
-- CREATE TABLE IF NOT EXISTS создаёт таблицу "с нуля", если её ещё
-- нет. Если она уже как-то существует (например, кто-то раньше
-- руками накидал часть колонок) — CREATE TABLE ничего не сделает,
-- поэтому ниже идут ALTER TABLE ... ADD COLUMN IF NOT EXISTS на
-- каждую колонку: они дописывают недостающее в уже существующую
-- таблицу и ничего не делают, если колонка уже есть. Так миграция
-- безопасна в обоих случаях — и на пустой БД, и на "недособранной".
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY
);

ALTER TABLE users ADD COLUMN IF NOT EXISTS username                  TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS username_low              TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS email                     TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS password_hash             TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS rating                    INT NOT NULL DEFAULT 1200;
ALTER TABLE users ADD COLUMN IF NOT EXISTS games_played              INT NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS wins                      INT NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS losses                    INT NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS draws                     INT NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar                    TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS role                      TEXT NOT NULL DEFAULT 'user';
ALTER TABLE users ADD COLUMN IF NOT EXISTS banned                    BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS ban_reason                TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS created_at                BIGINT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS created_from_ip           TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS created_device_id         TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS emoji                     TEXT DEFAULT '';
ALTER TABLE users ADD COLUMN IF NOT EXISTS bio                       TEXT DEFAULT '';
ALTER TABLE users ADD COLUMN IF NOT EXISTS fshr_rating               INT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS fide_rating               INT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS two_factor_enabled        BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS vip_until                 BIGINT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS shadow_banned             BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS shadow_ban_reason         TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS badges                    JSONB NOT NULL DEFAULT '[]';
ALTER TABLE users ADD COLUMN IF NOT EXISTS puzzle_rating             INT NOT NULL DEFAULT 1200;
ALTER TABLE users ADD COLUMN IF NOT EXISTS puzzle_solved             INT NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS puzzle_attempted          INT NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS storm_best                INT NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS storm_runs                INT NOT NULL DEFAULT 0;
-- квесты/кристаллы (routes.js: /api/quests/*) — тоже нигде не создавались
ALTER TABLE users ADD COLUMN IF NOT EXISTS total_crystals            INT NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS total_crystals_updated_at BIGINT NOT NULL DEFAULT 0;

-- username_low обязателен для входа/поиска — если в старой таблице
-- он был пуст, заполняем из username, чтобы UNIQUE ниже не упал.
UPDATE users SET username_low = LOWER(username) WHERE username_low IS NULL AND username IS NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'users_username_low_key'
  ) THEN
    ALTER TABLE users ADD CONSTRAINT users_username_low_key UNIQUE (username_low);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_users_created_from_ip   ON users(created_from_ip);
CREATE INDEX IF NOT EXISTS idx_users_created_device_id ON users(created_device_id);
CREATE INDEX IF NOT EXISTS idx_users_total_crystals     ON users(total_crystals DESC);


CREATE TABLE IF NOT EXISTS ip_bans (
  ip TEXT PRIMARY KEY
);

CREATE TABLE IF NOT EXISTS device_bans (
  device_id TEXT PRIMARY KEY
);
