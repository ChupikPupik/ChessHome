-- ═══════════════════════════════════════════════════════════════
-- 003_messaging_forum.sql — личные сообщения и форум
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS dm_messages (
  id             TEXT PRIMARY KEY,
  from_user      TEXT NOT NULL,
  to_user        TEXT NOT NULL,
  text           TEXT NOT NULL,
  ts             BIGINT NOT NULL,
  read           BOOLEAN NOT NULL DEFAULT FALSE,
  shadow_hidden  BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE INDEX IF NOT EXISTS idx_dm_messages_from_to ON dm_messages(from_user, to_user);
CREATE INDEX IF NOT EXISTS idx_dm_messages_to_from ON dm_messages(to_user, from_user);


CREATE TABLE IF NOT EXISTS dm_blocks (
  blocker  TEXT NOT NULL,
  blocked  TEXT NOT NULL,
  ts       TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (blocker, blocked)
);


CREATE TABLE IF NOT EXISTS forum_threads (
  id                TEXT PRIMARY KEY,
  slug              TEXT UNIQUE,
  author            TEXT NOT NULL,
  author_id         TEXT,
  title             TEXT NOT NULL,
  body              TEXT NOT NULL,
  created_at        BIGINT NOT NULL,
  last_activity_at  BIGINT NOT NULL,
  reply_count       INT NOT NULL DEFAULT 0,
  views             INT NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_forum_threads_last_activity ON forum_threads(last_activity_at DESC);


CREATE TABLE IF NOT EXISTS forum_replies (
  id          TEXT PRIMARY KEY,
  thread_id   TEXT NOT NULL,
  author      TEXT NOT NULL,
  author_id   TEXT,
  body        TEXT NOT NULL,
  created_at  BIGINT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_forum_replies_thread_id ON forum_replies(thread_id);
