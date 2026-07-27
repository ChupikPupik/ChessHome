// ══════════════════════════════════════════════════════════════
//  js/storm.js — Puzzle Storm (подключается после app.js)
//  Зависимости из app.js: fetchJSON, currentUser, showPage,
//    pages, pzFenToBoard, pzBoardTurn, pzComputeLegalDests,
//    pzUCIToSq, pzSqToUCI, PUZZLE_PIECE_IMG, pz, toast
// ══════════════════════════════════════════════════════════════

(function () {
'use strict';

// ── Константы ─────────────────────────────────────────────────
const STORM_DURATION  = 180;  // секунд
const STORM_STREAK5   = 3;    // +3 сек за серию 5
const STORM_STREAK10  = 6;    // +6 сек за серию 10
const STORM_WRONG_PEN = 2;    // −2 сек за ошибку

// ── Состояние ─────────────────────────────────────────────────
const storm = {
  puzzles:      [],
  idx:          0,
  score:        0,
  correct:      0,
  wrong:        0,
  streak:       0,
  timeBonus:    0,
  timeLeft:     STORM_DURATION,
  running:      false,
  _timer:       null,
  currentPuzzle:null,
  board:        null,
  flipped:      false,
  legalDests:   {},
  selected:     null,
  playerMoves:  [],
  autoMoves:    [],
  moveStep:     0,
  autoPlaying:  false,
};

// ══════════════════════════════════════════════════════════════
//  НАВИГАЦИЯ
// ══════════════════════════════════════════════════════════════

async function loadStormPage() {
  storm.running = false;
  clearInterval(storm._timer);

  _show('storm-landing');
  _hide('storm-game');
  _hide('storm-result');

  if (typeof currentUser !== 'undefined' && currentUser) {
    try {
      const r = await fetchJSON(`/api/storm/player/${encodeURIComponent(currentUser.username)}`);
      const pb    = document.getElementById('storm-personal-best');
      const pbVal = document.getElementById('storm-pb-val');
      if (pb && pbVal) {
        pb.style.display = 'block';
        pbVal.textContent = r && r.runs > 0 ? r.best : '—';
      }
    } catch (e) { /* нет сети или нет игр */ }
  }
}

async function loadStormLeaderboard() {
  const list = document.getElementById('storm-leaderboard-list');
  if (!list) return;
  list.innerHTML = '<div style="padding:20px;text-align:center;color:var(--text-muted)">Загрузка...</div>';
  try {
    const data = await fetchJSON('/api/storm/leaderboard');
    if (!data || !data.length) {
      list.innerHTML = '<div style="padding:20px;text-align:center;color:var(--text-muted)">Ещё никто не играл</div>';
      return;
    }
    const medals = ['🥇','🥈','🥉'];
    list.innerHTML = data.map((u, i) => `
      <div style="display:flex;align-items:center;gap:12px;padding:13px 20px;
        border-bottom:1px solid var(--border);
        ${i===0 ? 'background:linear-gradient(90deg,rgba(255,160,0,0.08),transparent)' : ''}">
        <div style="width:32px;text-align:center;font-size:${i<3?20:14}px;font-weight:900;
          color:${i===0?'#ffa500':i===1?'#aaa':i===2?'#cd7f32':'var(--text-muted)'}">
          ${i < 3 ? medals[i] : i+1}
        </div>
        <div style="flex:1">
          <div style="font-weight:700;font-size:14px">${_esc(u.username)}</div>
          <div style="font-size:11px;color:var(--text-muted)">${u.runs} ${u.runs===1?'игра':'игр'}</div>
        </div>
        <div style="text-align:right">
          <div style="font-size:22px;font-weight:900;color:var(--accent)">${u.best}</div>
          <div style="font-size:10px;color:var(--text-muted);text-transform:uppercase;letter-spacing:.05em">рекорд</div>
        </div>
      </div>`).join('');
  } catch (e) {
    list.innerHTML = '<div style="padding:20px;text-align:center;color:var(--text-muted)">Ошибка загрузки</div>';
  }
}

// ══════════════════════════════════════════════════════════════
//  СТАРТ / КОНЕЦ
// ══════════════════════════════════════════════════════════════

async function stormStart() {
  if (typeof currentUser === 'undefined' || !currentUser) {
    if (typeof toast === 'function') toast('Войдите для участия в Шторме', 'info');
    showPage('home');
    return;
  }

  _hide('storm-landing');
  _hide('storm-result');
  _show('storm-game');

  Object.assign(storm, {
    puzzles:[], idx:0, score:0, correct:0, wrong:0, streak:0,
    timeBonus:0, timeLeft:STORM_DURATION, running:false,
    selected:null, moveStep:0, autoPlaying:false,
  });
  clearInterval(storm._timer);

  _stormUpdateHUD();
  document.getElementById('storm-board').innerHTML =
    '<div style="text-align:center;padding:40px;color:var(--text-muted)">Загрузка задач...</div>';

  try {
    const data = await fetchJSON('/api/storm/puzzles?topics=mate1,mate2');
    if (!data || !data.length) {
      if (typeof toast === 'function') toast('Не удалось загрузить задачи', 'error');
      return;
    }
    storm.puzzles = data;
  } catch (e) {
    if (typeof toast === 'function') toast('Ошибка загрузки задач', 'error');
    return;
  }

  _stormLoadPuzzle();
  storm.running = true;
  storm._timer  = setInterval(_stormTick, 250);
}

async function stormFinish() {
  storm.running = false;
  clearInterval(storm._timer);

  _hide('storm-game');
  const resEl = document.getElementById('storm-result');
  resEl.style.display = 'flex';
  resEl.style.flexDirection = 'column';

  _setText('res-score',   storm.score);
  _setText('res-correct', storm.correct);
  _setText('res-wrong',   storm.wrong);

  const icon  = document.getElementById('storm-result-icon');
  if (icon) icon.textContent = storm.score >= 20 ? '🏆' : storm.score >= 10 ? '⚡' : '🎯';

  try {
    const r = await fetchJSON('/api/storm/finish', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        score:         storm.score,
        totalAttempted:storm.correct + storm.wrong,
        correct:       storm.correct,
        wrong:         storm.wrong,
        timeBonus:     storm.timeBonus,
      }),
    });
    if (r && r.isBest) {
      const badge = document.getElementById('storm-new-record-badge');
      if (badge) badge.style.display = 'inline-block';
    }
  } catch (e) { console.error('[Storm finish]', e); }
}

// ══════════════════════════════════════════════════════════════
//  ИГРОВОЙ ЦИКЛ
// ══════════════════════════════════════════════════════════════

function _stormTick() {
  if (!storm.running) return;
  storm.timeLeft = Math.max(0, storm.timeLeft - 0.25);
  _stormUpdateTimer();
  if (storm.timeLeft <= 0) stormFinish();
}

function _stormLoadPuzzle() {
  if (storm.idx >= storm.puzzles.length) {
    storm.idx = 0;
    storm.puzzles = [...storm.puzzles].sort(() => Math.random() - .5);
  }
  const puz = storm.puzzles[storm.idx++];
  if (!puz) return;

  storm.currentPuzzle = puz;
  storm.board         = pzFenToBoard(puz.fen);
  const fenSide       = pzBoardTurn(puz.fen);
  storm.flipped       = fenSide === 'b';

  const allMoves = (puz.solution || '').trim().split(/\s+/).filter(Boolean);
  storm.playerMoves = allMoves.filter((_, i) => i % 2 === 0);
  storm.autoMoves   = allMoves.filter((_, i) => i % 2 === 1);
  storm.moveStep    = 0;
  storm.selected    = null;
  storm.autoPlaying = false;

  _stormComputeLegal();
  _stormRender();

  const prog = document.getElementById('storm-progress-bar');
  if (prog) prog.style.width = Math.min(100, (storm.idx / storm.puzzles.length) * 100) + '%';
}

function _stormApplyMove(uci) {
  if (!uci) return;
  const from  = pzUCIToSq(uci.slice(0, 2));
  const to    = pzUCIToSq(uci.slice(2, 4));
  const promo = uci.length === 5 ? uci[4] : null;
  const nb    = [...storm.board];
  nb[to]   = promo ? { color: nb[from] ? nb[from].color : 'w', type: promo } : nb[from];
  nb[from] = null;
  // Рокировка
  if (nb[to] && nb[to].type === 'k') {
    if (uci === 'e1g1') { nb[5] = nb[7]; nb[7] = null; }
    if (uci === 'e1c1') { nb[3] = nb[0]; nb[0] = null; }
    if (uci === 'e8g8') { nb[61] = nb[63]; nb[63] = null; }
    if (uci === 'e8c8') { nb[59] = nb[56]; nb[56] = null; }
  }
  storm.board = nb;
}

function _stormComputeLegal() {
  storm.legalDests = {};
  if (!storm.currentPuzzle || !storm.board) return;
  const fenSide = pzBoardTurn(storm.currentPuzzle.fen);
  const turn    = (storm.moveStep % 2 === 0) ? fenSide : (fenSide === 'w' ? 'b' : 'w');
  // Собственный генератор — игрок может сделать ЛЮБОЙ ход,
  // правильность проверяется в _stormCheckMove
  storm.legalDests = _stormAllMoves(storm.board, turn);
}

function _stormAllMoves(board, turn) {
  const dests = {};
  const opp   = turn === 'w' ? 'b' : 'w';
  const rank  = sq => Math.floor(sq / 8);
  const file  = sq => sq % 8;

  function slide(from, dr, df) {
    const targets = [];
    let r = rank(from) + dr, f = file(from) + df;
    while (r >= 0 && r < 8 && f >= 0 && f < 8) {
      const sq = r * 8 + f;
      if (board[sq]) { if (board[sq].color === opp) targets.push(sq); break; }
      targets.push(sq);
      r += dr; f += df;
    }
    return targets;
  }

  function jump(from, moves) {
    return moves
      .map(([dr, df]) => [rank(from) + dr, file(from) + df])
      .filter(([r, f]) => r >= 0 && r < 8 && f >= 0 && f < 8)
      .map(([r, f]) => r * 8 + f)
      .filter(sq => !board[sq] || board[sq].color === opp);
  }

  for (let from = 0; from < 64; from++) {
    const p = board[from];
    if (!p || p.color !== turn) continue;
    let targets = [];
    if (p.type === 'p') {
      const dir = turn === 'w' ? 1 : -1;
      const startRank = turn === 'w' ? 1 : 6;
      const r = rank(from), f = file(from);
      const fwd1 = (r + dir) * 8 + f;
      if (r + dir >= 0 && r + dir < 8 && !board[fwd1]) {
        targets.push(fwd1);
        if (r === startRank && !board[(r + dir * 2) * 8 + f]) targets.push((r + dir * 2) * 8 + f);
      }
      [-1, 1].forEach(df => {
        const nr = r + dir, nf = f + df;
        if (nr >= 0 && nr < 8 && nf >= 0 && nf < 8) {
          const sq = nr * 8 + nf;
          if (board[sq] && board[sq].color === opp) targets.push(sq);
        }
      });
    } else if (p.type === 'n') {
      targets = jump(from, [[-2,-1],[-2,1],[-1,-2],[-1,2],[1,-2],[1,2],[2,-1],[2,1]]);
    } else if (p.type === 'b') {
      targets = [[-1,-1],[-1,1],[1,-1],[1,1]].flatMap(([dr,df]) => slide(from,dr,df));
    } else if (p.type === 'r') {
      targets = [[-1,0],[1,0],[0,-1],[0,1]].flatMap(([dr,df]) => slide(from,dr,df));
    } else if (p.type === 'q') {
      targets = [[-1,-1],[-1,1],[1,-1],[1,1],[-1,0],[1,0],[0,-1],[0,1]].flatMap(([dr,df]) => slide(from,dr,df));
    } else if (p.type === 'k') {
      targets = jump(from, [[-1,-1],[-1,0],[-1,1],[0,-1],[0,1],[1,-1],[1,0],[1,1]]);
    }
    if (targets.length) dests[from] = targets;
  }
  return dests;
}

// ══════════════════════════════════════════════════════════════
//  РЕНДЕР ДОСКИ
// ══════════════════════════════════════════════════════════════

function _stormRender() {
  const el = document.getElementById('storm-board');
  if (!el) return;

  const size = Math.min(el.offsetWidth || 360, window.innerWidth - 32);
  const sq   = Math.floor(size / 8);
  el.style.cssText = `width:${sq*8}px;height:${sq*8}px;display:grid;grid-template-columns:repeat(8,${sq}px);border-radius:6px;overflow:hidden;cursor:default;`;
  el.innerHTML = '';

  for (let visual = 0; visual < 64; visual++) {
    const visualRank = Math.floor(visual / 8); // 0 (верх экрана) .. 7 (низ экрана)
    const visualFile = visual % 8;             // 0 (лево экрана) .. 7 (право экрана)

    let logical;
    if (storm.flipped) {
      // Для черных внизу: левый верхний угол экрана это h1 (индекс 7 в формате 0=a1)
      logical = visualRank * 8 + (7 - visualFile);
    } else {
      // Для белых внизу: левый верхний угол экрана это a8 (индекс 56 в формате 0=a1)
      logical = (7 - visualRank) * 8 + visualFile;
    }

    const rank    = Math.floor(logical / 8);
    const file    = logical % 8;
    const isLight = (rank + file) % 2 !== 0;

    const cell = document.createElement('div');
    cell.style.cssText = `
      width:${sq}px;height:${sq}px;display:flex;align-items:center;justify-content:center;
      position:relative;cursor:pointer;user-select:none;
      background:${
        storm.selected === logical
          ? (isLight ? '#f6f669' : '#baca2b')
          : (isLight ? 'var(--board-light,#f0d9b5)' : 'var(--board-dark,#b58863)')
      };`;

    // Кружки допустимых ходов
    if (storm.selected !== null && storm.legalDests[storm.selected] && storm.legalDests[storm.selected].includes(logical)) {
      const dot = document.createElement('div');
      const hasPiece = storm.board[logical];
      dot.style.cssText = hasPiece
        ? 'position:absolute;inset:0;border-radius:50%;box-shadow:inset 0 0 0 4px rgba(0,0,0,.35);pointer-events:none;'
        : `width:${Math.floor(sq*.3)}px;height:${Math.floor(sq*.3)}px;border-radius:50%;background:rgba(0,0,0,.22);pointer-events:none;`;
      cell.appendChild(dot);
    }

    const piece = storm.board[logical];
    if (piece) {
      const imgName = (typeof PUZZLE_PIECE_IMG !== 'undefined')
        ? PUZZLE_PIECE_IMG[piece.color + piece.type]
        : piece.color + piece.type.toUpperCase();
      const img = document.createElement('img');
      img.src = '/img/pieces/' + imgName + '.svg';
      img.style.cssText = `width:${Math.floor(sq*.82)}px;height:${Math.floor(sq*.82)}px;position:relative;z-index:1;display:block;pointer-events:none;`;
      img.draggable = false;
      cell.appendChild(img);
    }

    // Замыкаем индекс logical, чтобы клики срабатывали по правильным клеткам
    ((logSq) => {
      cell.addEventListener('click', () => _stormSquareClick(logSq));
    })(logical);

    el.appendChild(cell);
  }
}

// ══════════════════════════════════════════════════════════════
//  ОБРАБОТКА ХОДОВ
// ══════════════════════════════════════════════════════════════

function _stormSquareClick(sq) {
  if (!storm.running || storm.autoPlaying) return;
  if (storm.selected === null) {
    if (storm.legalDests[sq] && storm.legalDests[sq].length) storm.selected = sq;
  } else {
    if (sq === storm.selected) { storm.selected = null; _stormRender(); return; }
    if (storm.legalDests[storm.selected] && storm.legalDests[storm.selected].includes(sq)) {
      _stormMakeMove(storm.selected, sq); return;
    }
    storm.selected = (storm.legalDests[sq] && storm.legalDests[sq].length) ? sq : null;
  }
  _stormRender();
}

function _stormMakeMove(from, to) {
  if (!storm.running) return;
  const movingPiece = storm.board[from];
  const toRank = Math.floor(to / 8);
  const isPromo = movingPiece && movingPiece.type === 'p' &&
    ((movingPiece.color === 'w' && toRank === 7) ||
     (movingPiece.color === 'b' && toRank === 0));

  if (isPromo) { _stormShowPromoDialog(from, to); return; }
  _stormCheckMove(from, to, pzSqToUCI(from) + pzSqToUCI(to));
}

function _stormShowPromoDialog(from, to) {
  const old = document.getElementById('st-promo');
  if (old) old.remove();
  const color  = storm.board[from] ? storm.board[from].color : 'w';
  const typeMap = { q:'Q', r:'R', b:'B', n:'N' };

  const overlay = document.createElement('div');
  overlay.id = 'st-promo';
  overlay.style.cssText = 'position:fixed;inset:0;z-index:9999;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.6)';

  const box = document.createElement('div');
  box.style.cssText = 'background:var(--bg-card,#1e1e2e);border:2px solid #ffa500;border-radius:14px;padding:20px 28px;text-align:center';
  box.innerHTML = '<div style="font-weight:800;margin-bottom:14px;font-size:15px">Превращение пешки</div>';

  const row = document.createElement('div');
  row.style.cssText = 'display:flex;gap:10px';
  ['q','r','b','n'].forEach(p => {
    const btn = document.createElement('button');
    btn.className = 'btn btn-secondary';
    btn.style.cssText = 'width:52px;height:52px;padding:6px;display:flex;align-items:center;justify-content:center;cursor:pointer;background:var(--bg-secondary,#1e1e2e);border:1px solid var(--border,rgba(255,255,255,.1));border-radius:10px;';
    const pi = document.createElement('img');
    pi.src = '/img/pieces/' + color + typeMap[p] + '.svg';
    pi.style.cssText = 'width:36px;height:36px;display:block;pointer-events:none;';
    pi.draggable = false;
    btn.appendChild(pi);
    btn.onclick = () => { overlay.remove(); _stormCheckMove(from, to, pzSqToUCI(from)+pzSqToUCI(to)+p); };
    row.appendChild(btn);
  });
  box.appendChild(row);
  overlay.appendChild(box);
  overlay.onclick = e => { if (e.target === overlay) { overlay.remove(); storm.selected = null; _stormRender(); } };
  document.body.appendChild(overlay);
}

function _stormCheckMove(from, to, uci) {
  const expected = storm.playerMoves[storm.moveStep];
  if (!expected) return;

  const variants   = expected.split('|').map(v => v.trim());
  const isCorrect  = variants.includes(uci) ||
    variants.some(v => v.length === 4 && uci.startsWith(v)) ||
    variants.some(v => v.length === 5 && v.endsWith('q') && uci === v.slice(0,4));

  if (isCorrect) {
    const canonUCI = variants.find(v =>
      v === uci || (v.length===4 && uci.startsWith(v)) || (v.length===5 && v.endsWith('q') && uci===v.slice(0,4))
    ) || uci;

    _stormApplyMove(canonUCI);
    storm.selected = null;
    storm.moveStep++;

    const nextAuto = storm.autoMoves[storm.moveStep - 1];

    if (storm.moveStep >= storm.playerMoves.length) {
      _stormFlash(true);
      storm.score++;
      storm.correct++;
      storm.streak++;
      _stormApplyStreak();
      _stormUpdateHUD();
      _stormComputeLegal();
      _stormRender();
      setTimeout(_stormLoadPuzzle, 400);
    } else if (nextAuto) {
      storm.autoPlaying = true;
      _stormComputeLegal();
      _stormRender();
      setTimeout(() => {
        _stormApplyMove(nextAuto);
        storm.autoPlaying = false;
        _stormComputeLegal();
        _stormRender();
      }, 350);
    }
  } else {
    // ✗ Ошибка: ход легальный, но неверный
    _stormApplyMove(uci);
    _stormFlash(false);
    storm.wrong++;
    storm.streak  = 0;
    storm.timeLeft= Math.max(0, storm.timeLeft - STORM_WRONG_PEN);
    storm.selected= null;
    storm.autoPlaying = true; // Блокируем новые клики
    
    _stormUpdateHUD();
    _stormRender();
    setTimeout(_stormLoadPuzzle, 900);
  }
}

// ══════════════════════════════════════════════════════════════
//  БОНУСЫ / HUD
// ══════════════════════════════════════════════════════════════

function _stormApplyStreak() {
  let bonus = 0, label = '';
  if (storm.streak > 0 && storm.streak % 10 === 0) {
    bonus = STORM_STREAK10; label = `🔥×${storm.streak}  +${bonus}с`;
  } else if (storm.streak > 0 && storm.streak % 5 === 0) {
    bonus = STORM_STREAK5;  label = `🔥×${storm.streak}  +${bonus}с`;
  }
  if (bonus > 0) {
    storm.timeLeft  = Math.min(STORM_DURATION * 1.5, storm.timeLeft + bonus);
    storm.timeBonus += bonus;
    _stormBonusLabel(label);
  }
}

function _stormBonusLabel(text) {
  const el = document.getElementById('storm-timer-bonus');
  if (!el) return;
  el.textContent = text;
  el.style.color = '#ffe066';
  el.style.animation = 'none';
  void el.offsetHeight;
  el.style.animation = 'stormBonusPop .9s ease-out forwards';
  el.addEventListener('animationend', () => { el.style.animation = ''; }, { once: true });
}

function _stormUpdateHUD() {
  _setText('storm-streak-val', storm.streak);
  const sc = document.getElementById('storm-score');
  if (sc) {
    sc.textContent = storm.score;
    sc.style.animation = 'none';
    void sc.offsetHeight;
    sc.style.animation = 'stormScorePop .35s ease-out';
  }
  _stormUpdateTimer();
}

function _stormUpdateTimer() {
  const val = document.getElementById('storm-timer-val');
  const arc = document.getElementById('storm-timer-arc');
  if (!val || !arc) return;

  const t    = Math.max(0, storm.timeLeft);
  const mins = Math.floor(t / 60);
  const secs = Math.floor(t % 60);
  val.textContent = `${mins}:${secs.toString().padStart(2,'0')}`;

  const circ   = 2 * Math.PI * 48;
  const frac   = t / STORM_DURATION;
  arc.style.strokeDashoffset = circ * (1 - Math.min(frac, 1));
  arc.style.stroke = t < 30 ? '#e74c3c' : t < 60 ? '#ff9500' : '#ffa500';
  val.className    = t < 30 ? 'low' : '';
}

function _stormFlash(correct) {
  const el = document.getElementById('storm-feedback-flash');
  if (!el) return;
  el.style.animation = 'none';
  void el.offsetHeight;
  el.style.animation = correct
    ? 'stormFlashGreen .5s ease-out forwards'
    : 'stormFlashRed .6s ease-out forwards';
}

// ══════════════════════════════════════════════════════════════
//  ПОИСК ИГРОКА
// ══════════════════════════════════════════════════════════════

let _searchTimer = null;
function stormSearchPlayer(val) {
  clearTimeout(_searchTimer);
  const res = document.getElementById('storm-search-result');
  if (!val.trim()) { if (res) res.style.display = 'none'; return; }
  _searchTimer = setTimeout(async () => {
    if (!res) return;
    try {
      const d = await fetchJSON(`/api/storm/player/${encodeURIComponent(val.trim())}`);
      res.style.display = 'block';
      if (!d || d.error) {
        res.innerHTML = `<div style="color:var(--text-muted);font-size:14px">Игрок <b>${_esc(val.trim())}</b> не найден или ни разу не играл в Шторм</div>`;
        return;
      }
      res.innerHTML = `
        <div style="display:flex;align-items:center;gap:16px;flex-wrap:wrap">
          <div>
            <div style="font-weight:800;font-size:16px">${_esc(d.username)}</div>
            <div style="font-size:12px;color:var(--text-muted);margin-top:2px">${d.runs > 0 ? `Сыграл ${d.runs} раз` : 'Ещё не играл в Шторм'}</div>
          </div>
          ${d.runs > 0 ? `
            <div style="margin-left:auto;text-align:right">
              <div style="font-size:32px;font-weight:900;color:var(--accent)">${d.best}</div>
              <div style="font-size:10px;color:var(--text-muted);text-transform:uppercase;letter-spacing:.06em">Рекорд</div>
            </div>
            <div style="width:100%;margin-top:8px;display:flex;gap:6px;flex-wrap:wrap">
              ${d.history.slice(0,5).map(h => `
                <div style="background:var(--bg-secondary);border:1px solid var(--border);
                  border-radius:8px;padding:6px 12px;font-size:13px;font-weight:700">
                  ${h.score}
                  <span style="font-size:10px;color:var(--text-muted);font-weight:400">
                    ✓${h.correct} ✗${h.wrong}
                  </span>
                </div>`).join('')}
            </div>` : ''}
        </div>`;
    } catch (e) {
      res.style.display = 'block';
      res.innerHTML = '<div style="color:var(--text-muted)">Игрок не найден</div>';
    }
  }, 400);
}

// ══════════════════════════════════════════════════════════════
//  УТИЛИТЫ
// ══════════════════════════════════════════════════════════════

function _show(id) {
  const el = document.getElementById(id);
  if (el) { el.style.display = ''; el.style.flexDirection = 'column'; }
}
function _hide(id) {
  const el = document.getElementById(id);
  if (el) el.style.display = 'none';
}
function _setText(id, val) {
  const el = document.getElementById(id);
  if (el) el.textContent = val;
}
function _esc(s) {
  return (s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ══════════════════════════════════════════════════════════════
//  РЕГИСТРАЦИЯ СТРАНИЦ (вызывается после инициализации app.js)
// ══════════════════════════════════════════════════════════════

function stormRegisterPages() {
  if (typeof pages !== 'undefined') {
    pages['storm']             = loadStormPage;
    pages['storm-leaderboard'] = loadStormLeaderboard;
  }
}

// Экспортируем публичные функции в window
window.stormStart        = stormStart;
window.stormFinish       = stormFinish;
window.stormSearchPlayer = stormSearchPlayer;
window.stormRegisterPages= stormRegisterPages;

// Авто-регистрация если pages уже существует
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', stormRegisterPages);
} else {
  stormRegisterPages();
}

})();