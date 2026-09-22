-- ═══════════════════════════════════════════════════════════════
-- 003_messaging_forum.sql — личные сообщения и форум
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS dm_messages (
  id TEXT PRIMARY KEY
);

ALTER TABLE dm_messages ADD COLUMN IF NOT EXISTS from_user      TEXT;
ALTER TABLE dm_messages ADD COLUMN IF NOT EXISTS to_user        TEXT;
ALTER TABLE dm_messages ADD COLUMN IF NOT EXISTS text           TEXT;
ALTER TABLE dm_messages ADD COLUMN IF NOT EXISTS ts             BIGINT;
ALTER TABLE dm_messages ADD COLUMN IF NOT EXISTS read           BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE dm_messages ADD COLUMN IF NOT EXISTS shadow_hidden  BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS idx_dm_messages_from_to ON dm_messages(from_user, to_user);
CREATE INDEX IF NOT EXISTS idx_dm_messages_to_from ON dm_messages(to_user, from_user);


CREATE TABLE IF NOT EXISTS dm_blocks (
  blocker  TEXT NOT NULL,
  blocked  TEXT NOT NULL,
  ts       TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (blocker, blocked)
);


CREATE TABLE IF NOT EXISTS forum_threads (
  id TEXT PRIMARY KEY
);

ALTER TABLE forum_threads ADD COLUMN IF NOT EXISTS slug              TEXT;
ALTER TABLE forum_threads ADD COLUMN IF NOT EXISTS author            TEXT;
ALTER TABLE forum_threads ADD COLUMN IF NOT EXISTS author_id         TEXT;
ALTER TABLE forum_threads ADD COLUMN IF NOT EXISTS title             TEXT;
ALTER TABLE forum_threads ADD COLUMN IF NOT EXISTS body              TEXT;
ALTER TABLE forum_threads ADD COLUMN IF NOT EXISTS created_at        BIGINT;
ALTER TABLE forum_threads ADD COLUMN IF NOT EXISTS last_activity_at  BIGINT;
ALTER TABLE forum_threads ADD COLUMN IF NOT EXISTS reply_count       INT NOT NULL DEFAULT 0;
ALTER TABLE forum_threads ADD COLUMN IF NOT EXISTS views             INT NOT NULL DEFAULT 0;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'forum_threads_slug_key'
  ) THEN
    ALTER TABLE forum_threads ADD CONSTRAINT forum_threads_slug_key UNIQUE (slug);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_forum_threads_last_activity ON forum_threads(last_activity_at DESC);


CREATE TABLE IF NOT EXISTS forum_replies (
  id TEXT PRIMARY KEY
);

ALTER TABLE forum_replies ADD COLUMN IF NOT EXISTS thread_id   TEXT;
ALTER TABLE forum_replies ADD COLUMN IF NOT EXISTS author      TEXT;
ALTER TABLE forum_replies ADD COLUMN IF NOT EXISTS author_id   TEXT;
ALTER TABLE forum_replies ADD COLUMN IF NOT EXISTS body        TEXT;
ALTER TABLE forum_replies ADD COLUMN IF NOT EXISTS created_at  BIGINT;

CREATE INDEX IF NOT EXISTS idx_forum_replies_thread_id ON forum_replies(thread_id);
