#!/usr/bin/env node
/**
 * ══════════════════════════════════════════════════════════════
 *  Chess Home — Импорт задач из Lichess Open Puzzle Database
 * ══════════════════════════════════════════════════════════════
 *
 * КАК ИСПОЛЬЗОВАТЬ:
 *
 *  1. Установи зависимости (в папке проекта):
 *       npm install csv-parse chess.js uuid pg dotenv
 *
 *  2. Установи zstd:
 *       Ubuntu/Debian:  sudo apt install zstd
 *       macOS:          brew install zstd
 *
 *  3. Скачай базу задач Lichess (~200MB → ~1.5GB распакованный):
 *       curl -L -o puzzles.csv.zst "https://database.lichess.org/lichess_db_puzzle.csv.zst"
 *       unzstd puzzles.csv.zst
 *
 *  4. Запусти импорт:
 *       node import-puzzles.js --file puzzles.csv --limit 100000
 *
 *  Или через pipe без сохранения файла:
 *       curl -L "https://database.lichess.org/lichess_db_puzzle.csv.zst" | unzstd | node import-puzzles.js --limit 100000
 *
 * ФЛАГИ:
 *   --file puzzles.csv   путь к CSV (если нет — читает stdin)
 *   --limit 100000       сколько задач импортировать (по умолч. 50000)
 *   --offset 100000      пропустить первые N задач (для дозагрузки)
 *   --batch 500          размер батча INSERT
 *   --dry-run            тест без записи в БД (покажет первые 5 задач с полным разбором)
 *
 * ─────────────────────────────────────────────────────────────
 * КАК РАБОТАЕТ ФОРМАТ
 * ─────────────────────────────────────────────────────────────
 *
 * Lichess CSV содержит:
 *   FEN   — позиция ДО первого хода (соперник ещё не сделал ход)
 *   Moves — UCI через пробел: "b5c6 d7c6 f5e7"
 *              moves[0]     = ход СОПЕРНИКА, с которого начинается задача
 *              moves[1,3,5] = ходы ИГРОКА   (нечётные позиции после 0)
 *              moves[2,4,6] = ответы СОПЕРНИКА после хода игрока
 *
 * Что делаем:
 *   1. Применяем moves[0] к FEN через chess.js → получаем стартовый FEN
 *   2. Записываем solution = moves[1] moves[2] moves[3] ...
 *
 * Наш parsePuzzleSolution (в index.js):
 *   playerMoves = solution.split(' ').filter((_, i) => i % 2 === 0)   → ходы игрока
 *   autoMoves   = solution.split(' ').filter((_, i) => i % 2 === 1)   → ответы соперника
 *
 * Пример (мат в 2):
 *   Lichess Moves: "b5c6 d7c6 f5e7"
 *     moves[0] = b5c6  — соперник берёт на c6 (применяем к FEN)
 *     moves[1] = d7c6  — игрок берёт на c6 (ответный взятие)
 *     СТОП — мат в 1 ход после этого (нет autoMove)
 *   solution = "d7c6 f5e7"
 *   playerMoves = ["d7c6"]  — игрок берёт
 *   autoMoves   = ["f5e7"]  — это НЕ ответ, это... подождите
 *
 *   УТОЧНЕНИЕ: Lichess иногда кодирует иначе. В реальности:
 *     Lichess solution moves[1..] чередуются: playerMove, autoMove, playerMove...
 *     Т.е. moves[1]=ход_игрока, moves[2]=ответ_соп, moves[3]=ход_игрока...
 *   Это совпадает с parsePuzzleSolution — всё корректно.
 */

'use strict';

require('dotenv').config();
const { Pool }  = require('pg');
const { Chess } = require('chess.js');
const fs        = require('fs');
const { parse } = require('csv-parse');
const { v4: uuidv4 } = require('uuid');

// ─── CLI ──────────────────────────────────────────────────────
const args = process.argv.slice(2);
function getArg(name, def) {
  const i = args.indexOf(name);
  return i !== -1 && args[i + 1] !== undefined ? args[i + 1] : def;
}
const FILE_PATH  = getArg('--file', null);
const LIMIT      = parseInt(getArg('--limit', '50000'));
const OFFSET     = parseInt(getArg('--offset', '0'));
const BATCH_SIZE = parseInt(getArg('--batch', '500'));
const DRY_RUN    = args.includes('--dry-run');

// ─── PostgreSQL ───────────────────────────────────────────────
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
async function db(sql, params = []) {
  const client = await pool.connect();
  try { return await client.query(sql, params); }
  finally { client.release(); }
}

// ─── Маппинг тем Lichess → наши топики ───────────────────────
// Порядок важен: первое совпадение побеждает
const PRIORITY_THEMES = [
  ['mateIn1',          'mate1'],
  ['mateIn2',          'mate2'],
  ['mateIn3',          'mate2'],
  ['mateIn4',          'mate2'],
  ['mateIn5',          'mate2'],
  ['mate',             'mate2'],
  ['fork',             'fork'],
  ['pin',              'pin'],
  ['skewer',           'skewer'],
  ['discoveredAttack', 'discovery'],
  ['endgame',          'endgame'],
  ['rookEndgame',      'endgame'],
  ['bishopEndgame',    'endgame'],
  ['queenEndgame',     'endgame'],
  ['pawnEndgame',      'endgame'],
  ['knightEndgame',    'endgame'],
  ['queenRookEndgame', 'endgame'],
];
const FALLBACK_TOPIC = 'tactics';

function detectTopic(themesStr) {
  const themes = new Set((themesStr || '').toLowerCase().split(/\s+/).filter(Boolean));
  for (const [tag, topic] of PRIORITY_THEMES) {
    if (themes.has(tag.toLowerCase())) return topic;
  }
  return FALLBACK_TOPIC;
}

// ─── Сложность по рейтингу ────────────────────────────────────
function detectDifficulty(rating) {
  const r = parseInt(rating) || 1500;
  if (r < 1300) return 'easy';
  if (r < 1800) return 'medium';
  return 'hard';
}

// ─── Заголовки ────────────────────────────────────────────────
const TOPIC_NAMES = {
  mate1: 'Мат в 1 ход', mate2: 'Мат в 2+ хода', fork: 'Вилка',
  pin: 'Связка', skewer: 'Рентген', discovery: 'Открытый удар',
  endgame: 'Эндшпиль', tactics: 'Тактика',
};
const DIFF_NAMES = { easy: 'лёгкая', medium: 'средняя', hard: 'сложная' };
const counters = {};
function makeTitle(topic, difficulty) {
  const key = `${topic}_${difficulty}`;
  counters[key] = (counters[key] || 0) + 1;
  return `${TOPIC_NAMES[topic] || topic} #${counters[key]} (${DIFF_NAMES[difficulty] || difficulty})`;
}

// ─── Применяем первый ход соперника к FEN ────────────────────
// Lichess FEN — позиция ДО первого хода.
// Нам нужна позиция ПОСЛЕ него — это стартовая позиция задачи для игрока.
function applyFirstMove(fen, uciMove) {
  try {
    const chess = new Chess(fen);
    const from  = uciMove.slice(0, 2);
    const to    = uciMove.slice(2, 4);
    // Превращение пешки: если 5-й символ есть (напр. "e7e8q")
    const promotion = uciMove.length === 5 ? uciMove[4].toLowerCase() : undefined;

    const result = chess.move({ from, to, promotion });
    if (!result) return null; // ход невалиден — пропускаем задачу

    return chess.fen();
  } catch {
    return null;
  }
}

// ─── Строим solution для нашей БД ────────────────────────────
// Берём всё КРОМЕ moves[0] (он уже применён к FEN)
// Результат: "ход_игрока ответ_соперника ход_игрока ответ_соперника ..."
// parsePuzzleSolution(solution):
//   playerMoves = i % 2 === 0  → ходы игрока
//   autoMoves   = i % 2 === 1  → ответы соперника
function buildSolution(moves) {
  const rest = moves.slice(1); // убираем первый ход соперника
  if (rest.length === 0) return null;
  return rest.join(' ');
}

// ─── Вставка батча в БД ───────────────────────────────────────
async function insertBatch(batch) {
  if (batch.length === 0) return 0;
  const vals   = [];
  const params = [];
  let p = 1;
  for (const r of batch) {
    vals.push(`($${p},$${p+1},$${p+2},$${p+3},$${p+4},$${p+5},$${p+6},$${p+7})`);
    params.push(
      r.id, r.title, r.description, r.fen,
      r.solution, r.topic, r.difficulty, 'lichess'
    );
    p += 8;
  }
  const sql = `
    INSERT INTO puzzles (id, title, description, fen, solution, topic, difficulty, created_by)
    VALUES ${vals.join(',')}
    ON CONFLICT (id) DO NOTHING
  `;
  const result = await db(sql, params);
  return result.rowCount || 0;
}

// ─── Прогресс-бар ─────────────────────────────────────────────
function printProgress(done, total, startTime, inserted) {
  const pct    = Math.min(100, Math.round(done / total * 100));
  const elapsed = (Date.now() - startTime) / 1000;
  const rate   = elapsed > 0 ? Math.round(done / elapsed) : 0;
  const eta    = rate > 0 ? Math.round((total - done) / rate) : '∞';
  const filled = Math.floor(pct / 4);
  const bar    = '█'.repeat(filled) + '░'.repeat(25 - filled);
  process.stdout.write(
    `\r  [${bar}] ${String(pct).padStart(3)}% | ${done.toLocaleString()}/${total.toLocaleString()} | вставлено: ${inserted.toLocaleString()} | ${rate}/с | ETA: ${eta}с   `
  );
}

// ─── MAIN ─────────────────────────────────────────────────────
async function main() {
  console.log('╔═════════════════════════════════════════════════════════╗');
  console.log('║     Chess Home — Импорт задач из Lichess Open DB        ║');
  console.log('╚═════════════════════════════════════════════════════════╝');
  console.log(`  Режим:    ${DRY_RUN ? '🔍 DRY RUN' : '✏️  ЗАПИСЬ В БД'}`);
  console.log(`  Источник: ${FILE_PATH ? '📁 ' + FILE_PATH : '📡 stdin (pipe)'}`);
  console.log(`  Лимит:    ${LIMIT.toLocaleString()} | Офсет: ${OFFSET.toLocaleString()} | Батч: ${BATCH_SIZE}`);
  console.log('');

  if (!DRY_RUN) {
    try {
      await db('SELECT 1');
      console.log('  ✅ PostgreSQL: OK\n');
    } catch (e) {
      console.error('  ❌ PostgreSQL:', e.message);
      process.exit(1);
    }
  }

  // Источник данных
  let inputStream;
  if (FILE_PATH) {
    if (!fs.existsSync(FILE_PATH)) {
      console.error(`❌ Файл не найден: ${FILE_PATH}`);
      printHelp();
      process.exit(1);
    }
    inputStream = fs.createReadStream(FILE_PATH, { highWaterMark: 64 * 1024 });
  } else {
    if (process.stdin.isTTY) {
      console.error('❌ Нет --file и нет stdin. Используй pipe или --file.');
      printHelp();
      process.exit(1);
    }
    inputStream = process.stdin;
  }

  // Счётчики
  let csvRow   = 0;
  let skipped  = 0;
  let imported = 0;
  let inserted = 0;
  let badFen   = 0;
  let badMoves = 0;
  const topicStats = {};

  const batch     = [];
  const startTime = Date.now();

  const parser = inputStream.pipe(
    parse({
      columns: true,
      skip_empty_lines: true,
      relax_column_count: true,
      trim: true,
      bom: true,
    })
  );

  for await (const row of parser) {
    csvRow++;

    // Пропускаем офсет
    if (csvRow <= OFFSET) { skipped++; continue; }

    // Лимит
    if (imported >= LIMIT) break;

    // Читаем поля (Lichess может писать и с заглавной, и строчными)
    const lichessId = row.PuzzleId   || row.puzzleid   || '';
    const rawFen    = row.FEN        || row.fen         || '';
    const movesStr  = row.Moves      || row.moves       || '';
    const rating    = parseInt(row.Rating  || row.rating  || '1500') || 1500;
    const themes    = row.Themes     || row.themes      || '';

    if (!lichessId || !rawFen || !movesStr) { skipped++; continue; }

    const moves = movesStr.trim().split(/\s+/).filter(Boolean);

    // Нужно минимум 2 хода: ход_соперника + хотя_бы_1_ход_игрока
    if (moves.length < 2) { badMoves++; skipped++; continue; }

    // ── Применяем первый ход соперника к FEN ──
    // Это превращает "стартовый FEN до хода" → "позицию, которую видит игрок"
    const startFen = applyFirstMove(rawFen, moves[0]);
    if (!startFen) { badFen++; skipped++; continue; }

    // ── Строим solution ──
    // moves[0] уже применён к FEN, берём moves[1..]
    // parsePuzzleSolution разберёт по чётным/нечётным:
    //   i=0,2,4 → playerMoves (ходы игрока)
    //   i=1,3,5 → autoMoves   (ответы соперника)
    const solution = buildSolution(moves);
    if (!solution) { badMoves++; skipped++; continue; }

    const topic      = detectTopic(themes);
    const difficulty = detectDifficulty(rating);
    const id         = 'lc_' + lichessId;
    const title      = makeTitle(topic, difficulty);
    const description = `Lichess #${lichessId} · рейтинг ${rating}`;

    topicStats[topic] = (topicStats[topic] || 0) + 1;

    // ── Dry-run: детальный разбор первых 5 задач ──
    if (DRY_RUN) {
      if (imported < 5) {
        const parts       = solution.split(' ');
        const playerMoves = parts.filter((_, i) => i % 2 === 0);
        const autoMoves   = parts.filter((_, i) => i % 2 === 1);
        console.log(`\n─── Задача ${imported + 1} ────────────────────────────────────`);
        console.log(`  Lichess ID:     ${lichessId}`);
        console.log(`  Наш ID:         ${id}`);
        console.log(`  Тема:           ${topic} | Сложность: ${difficulty} | Рейтинг Lichess: ${rating}`);
        console.log(`  Lichess-темы:   ${themes}`);
        console.log(`  Исходный FEN:   ${rawFen}`);
        console.log(`  Ход соперника:  ${moves[0]}  →  применяется к FEN`);
        console.log(`  Стартовый FEN:  ${startFen}`);
        console.log(`  Solution:       "${solution}"`);
        console.log(`  Ходы игрока:    [${playerMoves.join(', ')}]  (${playerMoves.length} шт.)`);
        console.log(`  Ответы соперн:  [${autoMoves.join(', ')}]  (${autoMoves.length} шт.)`);
      }
      imported++;
      continue;
    }

    // ── Добавляем в батч ──
    batch.push({ id, title, description, fen: startFen, solution, topic, difficulty });

    if (batch.length >= BATCH_SIZE) {
      const n = await insertBatch(batch);
      imported += batch.length;
      inserted += n;
      batch.length = 0;
      printProgress(imported, LIMIT, startTime, inserted);
    }
  }

  // Последний батч
  if (!DRY_RUN && batch.length > 0) {
    const n = await insertBatch(batch);
    imported += batch.length;
    inserted += n;
    batch.length = 0;
  }

  // ── Итоги ──
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  const dupes   = imported - inserted;
  console.log('\n');
  console.log('╔═════════════════════════════════════════════════════════╗');
  console.log('║                       ГОТОВО!                           ║');
  console.log('╠═════════════════════════════════════════════════════════╣');
  console.log(`║  Прочитано из CSV:    ${String(csvRow.toLocaleString()).padEnd(34)}║`);
  console.log(`║  Отправлено в БД:     ${String(imported.toLocaleString()).padEnd(34)}║`);
  console.log(`║  Реально вставлено:   ${String(inserted.toLocaleString()).padEnd(34)}║`);
  console.log(`║  Дублей (пропущено):  ${String(dupes.toLocaleString()).padEnd(34)}║`);
  console.log(`║  Невалидных FEN/ход:  ${String(badFen.toLocaleString()).padEnd(34)}║`);
  console.log(`║  Мало ходов:          ${String(badMoves.toLocaleString()).padEnd(34)}║`);
  console.log(`║  Время:               ${String(elapsed + 'с').padEnd(34)}║`);
  console.log('╠═════════════════════════════════════════════════════════╣');
  console.log('║  Распределение по темам (этот запуск):                  ║');
  for (const [t, cnt] of Object.entries(topicStats).sort((a, b) => b[1] - a[1])) {
    const line = `  ${(TOPIC_NAMES[t] || t).padEnd(20)} ${cnt.toLocaleString()}`;
    console.log(`║${line.padEnd(57)}║`);
  }
  console.log('╚═════════════════════════════════════════════════════════╝');

  if (!DRY_RUN) {
    try {
      const { rows } = await db('SELECT COUNT(*) FROM puzzles');
      console.log(`\n  📊 Всего задач в БД: ${parseInt(rows[0].count).toLocaleString()}`);

      const { rows: st } = await db(`
        SELECT topic, difficulty, COUNT(*) as cnt
        FROM puzzles GROUP BY topic, difficulty ORDER BY topic, difficulty
      `);
      console.log('\n  📈 По темам в БД:');
      let lastT = '';
      for (const r of st) {
        if (r.topic !== lastT) { console.log(`\n    ${TOPIC_NAMES[r.topic] || r.topic}:`); lastT = r.topic; }
        console.log(`      ${(DIFF_NAMES[r.difficulty] || r.difficulty).padEnd(8)}: ${parseInt(r.cnt).toLocaleString()}`);
      }
    } catch (e) {
      console.log('  (статистика из БД недоступна:', e.message, ')');
    }
  }

  await pool.end();
}

function printHelp() {
  console.log(`
  УСТАНОВКА:
    npm install csv-parse chess.js uuid pg dotenv

  СКАЧАТЬ ДАННЫЕ (нужен zstd: apt install zstd / brew install zstd):
    curl -L -o puzzles.csv.zst "https://database.lichess.org/lichess_db_puzzle.csv.zst"
    unzstd puzzles.csv.zst

  ЗАПУСК:
    node import-puzzles.js --file puzzles.csv --limit 100000

  ДОЗАГРУЗКА следующих 100к:
    node import-puzzles.js --file puzzles.csv --limit 100000 --offset 100000

  PIPE (без хранения файла):
    curl -L "https://database.lichess.org/lichess_db_puzzle.csv.zst" | unzstd | node import-puzzles.js --limit 100000

  DRY RUN (проверить без записи):
    node import-puzzles.js --file puzzles.csv --limit 10 --dry-run
  `);
}

main().catch(e => {
  console.error('\n❌ Критическая ошибка:', e.message);
  console.error(e.stack);
  process.exit(1);
});