-- ═══════════════════════════════════════════════════════════════
-- 005_quests.sql — система квестов (routes.js: /api/quests/*)
-- ═══════════════════════════════════════════════════════════════
-- ВАЖНО: сам код нигде не вставляет строки в quests — их нужно
-- либо накатить отдельным сидом (SQL/CSV), либо добавлять через
-- будущую админку. Без данных в quests фича просто отдаёт пустой
-- список — сервер от этого не падает.

CREATE TABLE IF NOT EXISTS quests (
  id                TEXT PRIMARY KEY,
  day               INT NOT NULL,
  title             TEXT NOT NULL,
  reward_crystals   INT NOT NULL DEFAULT 0,
  is_mega           BOOLEAN NOT NULL DEFAULT FALSE,
  type              TEXT NOT NULL DEFAULT 'manual'
);

CREATE INDEX IF NOT EXISTS idx_quests_day ON quests(day);


CREATE TABLE IF NOT EXISTS user_quests (
  user_id       TEXT NOT NULL,
  quest_id      TEXT NOT NULL,
  completed_at  BIGINT,
  progress      INT NOT NULL DEFAULT 0,
  target        INT NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, quest_id)
);

CREATE INDEX IF NOT EXISTS idx_user_quests_user_id ON user_quests(user_id);
