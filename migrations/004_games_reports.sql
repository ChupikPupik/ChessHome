-- ═══════════════════════════════════════════════════════════════
-- 004_games_reports.sql — история партий и жалобы на игроков
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS games (
  id             TEXT PRIMARY KEY,
  white          TEXT NOT NULL,
  black          TEXT NOT NULL,
  result         TEXT NOT NULL,
  reason         TEXT,
  moves          JSONB NOT NULL DEFAULT '[]',
  time_control   TEXT,
  ended_at       BIGINT NOT NULL,
  berserk        JSONB,
  accuracy       JSONB,
  tournament_id  TEXT,
  rated          BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE INDEX IF NOT EXISTS idx_games_white    ON games(white);
CREATE INDEX IF NOT EXISTS idx_games_black    ON games(black);
CREATE INDEX IF NOT EXISTS idx_games_ended_at ON games(ended_at);


CREATE TABLE IF NOT EXISTS reports (
  id               TEXT PRIMARY KEY,
  reporter         TEXT NOT NULL,
  target_username  TEXT NOT NULL,
  reason           TEXT NOT NULL,
  details          TEXT,
  status           TEXT NOT NULL DEFAULT 'new',
  created_at       BIGINT NOT NULL,
  reviewed_by      TEXT,
  reviewed_at      BIGINT
);

CREATE INDEX IF NOT EXISTS idx_reports_status           ON reports(status);
CREATE INDEX IF NOT EXISTS idx_reports_reporter_target   ON reports(reporter, target_username);
