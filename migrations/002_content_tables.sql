-- ═══════════════════════════════════════════════════════════════
-- 002_content_tables.sql — турниры, клубы, глобальный чат, блог
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS tournaments (
  id                 TEXT PRIMARY KEY,
  name               TEXT NOT NULL,
  description        TEXT,
  time_control       TEXT,
  duration_minutes   INT,
  starts_at          BIGINT NOT NULL,
  ends_at            BIGINT,
  max_participants   INT,
  min_rating         INT,
  max_rating         INT,
  blacklist          JSONB NOT NULL DEFAULT '[]',
  created_by         TEXT,
  created_at         BIGINT NOT NULL,
  participants       JSONB NOT NULL DEFAULT '[]',
  games              JSONB NOT NULL DEFAULT '[]',
  winner             TEXT,
  club_id            TEXT,
  club_only          BOOLEAN NOT NULL DEFAULT FALSE,
  is_interclub       BOOLEAN NOT NULL DEFAULT FALSE,
  team_ids           JSONB NOT NULL DEFAULT '[]'
);

CREATE INDEX IF NOT EXISTS idx_tournaments_starts_at    ON tournaments(starts_at);
CREATE INDEX IF NOT EXISTS idx_tournaments_club_id       ON tournaments(club_id);
CREATE INDEX IF NOT EXISTS idx_tournaments_is_interclub  ON tournaments(is_interclub);


CREATE TABLE IF NOT EXISTS clubs (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  description   TEXT,
  created_at    BIGINT NOT NULL,
  created_by    TEXT,
  admins        JSONB NOT NULL DEFAULT '[]',
  members       JSONB NOT NULL DEFAULT '[]',
  member_count  INT NOT NULL DEFAULT 0,
  official      BOOLEAN NOT NULL DEFAULT FALSE
);


CREATE TABLE IF NOT EXISTS chat_messages (
  id             TEXT PRIMARY KEY,
  username       TEXT NOT NULL,
  message        TEXT NOT NULL,
  role           TEXT NOT NULL DEFAULT 'user',
  timestamp      BIGINT NOT NULL,
  shadow_hidden  BOOLEAN NOT NULL DEFAULT FALSE,
  emoji          TEXT DEFAULT '',
  vip            BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE INDEX IF NOT EXISTS idx_chat_messages_timestamp ON chat_messages(timestamp);


-- Подтаблицы блога (blog_views/likes/comments/...) уже создаёт сам
-- core.js при старте — не хватало только основной таблицы постов.
CREATE TABLE IF NOT EXISTS blog_posts (
  id          TEXT PRIMARY KEY,
  title       TEXT NOT NULL,
  body        TEXT NOT NULL,
  author      TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'draft',
  views       INT NOT NULL DEFAULT 0,
  likes       INT NOT NULL DEFAULT 0,
  liked_by    JSONB NOT NULL DEFAULT '[]',
  created_at  BIGINT NOT NULL,
  updated_at  BIGINT,
  community   BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE INDEX IF NOT EXISTS idx_blog_posts_created_at ON blog_posts(created_at DESC);
