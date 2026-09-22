-- ═══════════════════════════════════════════════════════════════
-- 004_games_reports.sql — история партий и жалобы на игроков
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS games (
  id TEXT PRIMARY KEY
);

ALTER TABLE games ADD COLUMN IF NOT EXISTS white          TEXT;
ALTER TABLE games ADD COLUMN IF NOT EXISTS black          TEXT;
ALTER TABLE games ADD COLUMN IF NOT EXISTS result         TEXT;
ALTER TABLE games ADD COLUMN IF NOT EXISTS reason         TEXT;
ALTER TABLE games ADD COLUMN IF NOT EXISTS moves          JSONB NOT NULL DEFAULT '[]';
ALTER TABLE games ADD COLUMN IF NOT EXISTS time_control   TEXT;
ALTER TABLE games ADD COLUMN IF NOT EXISTS ended_at       BIGINT;
ALTER TABLE games ADD COLUMN IF NOT EXISTS berserk        JSONB;
ALTER TABLE games ADD COLUMN IF NOT EXISTS accuracy       JSONB;
ALTER TABLE games ADD COLUMN IF NOT EXISTS tournament_id  TEXT;
ALTER TABLE games ADD COLUMN IF NOT EXISTS rated          BOOLEAN NOT NULL DEFAULT TRUE;

CREATE INDEX IF NOT EXISTS idx_games_white    ON games(white);
CREATE INDEX IF NOT EXISTS idx_games_black    ON games(black);
CREATE INDEX IF NOT EXISTS idx_games_ended_at ON games(ended_at);


CREATE TABLE IF NOT EXISTS reports (
  id TEXT PRIMARY KEY
);

ALTER TABLE reports ADD COLUMN IF NOT EXISTS reporter         TEXT;
ALTER TABLE reports ADD COLUMN IF NOT EXISTS target_username  TEXT;
ALTER TABLE reports ADD COLUMN IF NOT EXISTS reason           TEXT;
ALTER TABLE reports ADD COLUMN IF NOT EXISTS details          TEXT;
ALTER TABLE reports ADD COLUMN IF NOT EXISTS status           TEXT NOT NULL DEFAULT 'new';
ALTER TABLE reports ADD COLUMN IF NOT EXISTS created_at       BIGINT;
ALTER TABLE reports ADD COLUMN IF NOT EXISTS reviewed_by      TEXT;
ALTER TABLE reports ADD COLUMN IF NOT EXISTS reviewed_at      BIGINT;

CREATE INDEX IF NOT EXISTS idx_reports_status          ON reports(status);
CREATE INDEX IF NOT EXISTS idx_reports_reporter_target  ON reports(reporter, target_username);
