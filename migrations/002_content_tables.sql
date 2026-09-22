-- ═══════════════════════════════════════════════════════════════
-- 002_content_tables.sql — турниры, клубы, глобальный чат, блог
-- ═══════════════════════════════════════════════════════════════
-- Та же логика, что в 001: CREATE TABLE IF NOT EXISTS создаёт
-- таблицу "с нуля", а ALTER TABLE ... ADD COLUMN IF NOT EXISTS
-- следом добивает недостающие колонки, если таблица уже как-то
-- существовала (частично или в другой версии).
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS tournaments (
  id TEXT PRIMARY KEY
);

ALTER TABLE tournaments ADD COLUMN IF NOT EXISTS name               TEXT;
ALTER TABLE tournaments ADD COLUMN IF NOT EXISTS description        TEXT;
ALTER TABLE tournaments ADD COLUMN IF NOT EXISTS time_control       TEXT;
ALTER TABLE tournaments ADD COLUMN IF NOT EXISTS duration_minutes   INT;
ALTER TABLE tournaments ADD COLUMN IF NOT EXISTS starts_at          BIGINT;
ALTER TABLE tournaments ADD COLUMN IF NOT EXISTS ends_at            BIGINT;
ALTER TABLE tournaments ADD COLUMN IF NOT EXISTS max_participants   INT;
ALTER TABLE tournaments ADD COLUMN IF NOT EXISTS min_rating         INT;
ALTER TABLE tournaments ADD COLUMN IF NOT EXISTS max_rating         INT;
ALTER TABLE tournaments ADD COLUMN IF NOT EXISTS blacklist          JSONB NOT NULL DEFAULT '[]';
ALTER TABLE tournaments ADD COLUMN IF NOT EXISTS created_by         TEXT;
ALTER TABLE tournaments ADD COLUMN IF NOT EXISTS created_at         BIGINT;
ALTER TABLE tournaments ADD COLUMN IF NOT EXISTS participants       JSONB NOT NULL DEFAULT '[]';
ALTER TABLE tournaments ADD COLUMN IF NOT EXISTS games              JSONB NOT NULL DEFAULT '[]';
ALTER TABLE tournaments ADD COLUMN IF NOT EXISTS winner             TEXT;
ALTER TABLE tournaments ADD COLUMN IF NOT EXISTS club_id            TEXT;
ALTER TABLE tournaments ADD COLUMN IF NOT EXISTS club_only          BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE tournaments ADD COLUMN IF NOT EXISTS is_interclub       BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE tournaments ADD COLUMN IF NOT EXISTS team_ids           JSONB NOT NULL DEFAULT '[]';

CREATE INDEX IF NOT EXISTS idx_tournaments_starts_at    ON tournaments(starts_at);
CREATE INDEX IF NOT EXISTS idx_tournaments_club_id       ON tournaments(club_id);
CREATE INDEX IF NOT EXISTS idx_tournaments_is_interclub  ON tournaments(is_interclub);


CREATE TABLE IF NOT EXISTS clubs (
  id TEXT PRIMARY KEY
);

ALTER TABLE clubs ADD COLUMN IF NOT EXISTS name          TEXT;
ALTER TABLE clubs ADD COLUMN IF NOT EXISTS description   TEXT;
ALTER TABLE clubs ADD COLUMN IF NOT EXISTS created_at    BIGINT;
ALTER TABLE clubs ADD COLUMN IF NOT EXISTS created_by    TEXT;
ALTER TABLE clubs ADD COLUMN IF NOT EXISTS admins        JSONB NOT NULL DEFAULT '[]';
ALTER TABLE clubs ADD COLUMN IF NOT EXISTS members       JSONB NOT NULL DEFAULT '[]';
ALTER TABLE clubs ADD COLUMN IF NOT EXISTS member_count  INT NOT NULL DEFAULT 0;
ALTER TABLE clubs ADD COLUMN IF NOT EXISTS official      BOOLEAN NOT NULL DEFAULT FALSE;


CREATE TABLE IF NOT EXISTS chat_messages (
  id TEXT PRIMARY KEY
);

ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS username       TEXT;
ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS message        TEXT;
ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS role           TEXT NOT NULL DEFAULT 'user';
ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS timestamp      BIGINT;
ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS shadow_hidden  BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS emoji          TEXT DEFAULT '';
ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS vip            BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS idx_chat_messages_timestamp ON chat_messages(timestamp);


-- Подтаблицы блога (blog_views/likes/comments/...) уже создаёт сам
-- core.js при старте — не хватало только основной таблицы постов.
CREATE TABLE IF NOT EXISTS blog_posts (
  id TEXT PRIMARY KEY
);

ALTER TABLE blog_posts ADD COLUMN IF NOT EXISTS title       TEXT;
ALTER TABLE blog_posts ADD COLUMN IF NOT EXISTS body        TEXT;
ALTER TABLE blog_posts ADD COLUMN IF NOT EXISTS author      TEXT;
ALTER TABLE blog_posts ADD COLUMN IF NOT EXISTS status      TEXT NOT NULL DEFAULT 'draft';
ALTER TABLE blog_posts ADD COLUMN IF NOT EXISTS views       INT NOT NULL DEFAULT 0;
ALTER TABLE blog_posts ADD COLUMN IF NOT EXISTS likes       INT NOT NULL DEFAULT 0;
ALTER TABLE blog_posts ADD COLUMN IF NOT EXISTS liked_by    JSONB NOT NULL DEFAULT '[]';
ALTER TABLE blog_posts ADD COLUMN IF NOT EXISTS created_at  BIGINT;
ALTER TABLE blog_posts ADD COLUMN IF NOT EXISTS updated_at  BIGINT;
ALTER TABLE blog_posts ADD COLUMN IF NOT EXISTS community   BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS idx_blog_posts_created_at ON blog_posts(created_at DESC);
