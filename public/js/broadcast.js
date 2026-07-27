// ══════════════════════════════════════════════════════════════════════════════
//  BROADCAST CLIENT — Chess Home
//  /public/js/broadcast.js
//  Подключить в index.html: <script src="/js/broadcast.js"></script>
// ══════════════════════════════════════════════════════════════════════════════

'use strict';

// ─── Шахматный движок (минимальный, только для отображения) ──────────────────
const BC_PIECES = {
  'K':'♔','Q':'♕','R':'♖','B':'♗','N':'♘','P':'♙',
  'k':'♚','q':'♛','r':'♜','b':'♝','n':'♞','p':'♟'
};

function bcFenToBoard(fen) {
  const b = Array(64).fill(null);
  const rows = fen.split(' ')[0].split('/');
  let i = 0;
  for (const row of rows) {
    for (const c of row) {
      if (c >= '1' && c <= '8') i += +c;
      else b[i++] = c;
    }
  }
  return b;
}
function bcFenTurn(fen) { return (fen.split(' ')[1] || 'w'); }
function bcFenCastle(fen) { return fen.split(' ')[2] || 'KQkq'; }
function bcFenEp(fen) {
  const e = fen.split(' ')[3] || '-';
  if (e === '-') return -1;
  return (8 - parseInt(e[1])) * 8 + 'abcdefgh'.indexOf(e[0]);
}
function bcSq(r, f) { return r * 8 + f; }
function bcRank(s) { return Math.floor(s / 8); }
function bcFile(s) { return s % 8; }
function bcIsWhite(p) { return p && p === p.toUpperCase(); }
function bcColor(p) { return !p ? null : bcIsWhite(p) ? 'w' : 'b'; }

function bcLegalMoves(board, turn, castling, ep) {
  const moves = [];
  const opp = turn === 'w' ? 'b' : 'w';
  for (let s = 0; s < 64; s++) {
    const p = board[s];
    if (!p || bcColor(p) !== turn) continue;
    const pt = p.toUpperCase();
    const r = bcRank(s), f = bcFile(s);

    if (pt === 'P') {
      const dir = turn === 'w' ? -1 : 1;
      const st = turn === 'w' ? 6 : 1;
      const nr = r + dir;
      if (nr >= 0 && nr < 8) {
        if (!board[bcSq(nr, f)]) {
          moves.push([s, bcSq(nr, f)]);
          if (r === st && !board[bcSq(r + 2 * dir, f)]) moves.push([s, bcSq(r + 2 * dir, f)]);
        }
        for (const df of [-1, 1]) {
          const nf = f + df;
          if (nf < 0 || nf > 7) continue;
          const t = bcSq(nr, nf);
          if ((board[t] && bcColor(board[t]) === opp) || t === ep) moves.push([s, t]);
        }
      }
    } else if (pt === 'N') {
      for (const [dr, df] of [[-2,-1],[-2,1],[-1,-2],[-1,2],[1,-2],[1,2],[2,-1],[2,1]]) {
        const nr = r + dr, nf = f + df;
        if (nr < 0 || nr > 7 || nf < 0 || nf > 7) continue;
        const t = bcSq(nr, nf);
        if (bcColor(board[t]) !== turn) moves.push([s, t]);
      }
    } else if (pt === 'K') {
      for (const [dr, df] of [[-1,-1],[-1,0],[-1,1],[0,-1],[0,1],[1,-1],[1,0],[1,1]]) {
        const nr = r + dr, nf = f + df;
        if (nr < 0 || nr > 7 || nf < 0 || nf > 7) continue;
        const t = bcSq(nr, nf);
        if (bcColor(board[t]) !== turn) moves.push([s, t]);
      }
      if (turn === 'w' && s === 60) {
        if (castling.includes('K') && !board[61] && !board[62]) moves.push([60, 62]);
        if (castling.includes('Q') && !board[59] && !board[58] && !board[57]) moves.push([60, 58]);
      }
      if (turn === 'b' && s === 4) {
        if (castling.includes('k') && !board[5] && !board[6]) moves.push([4, 6]);
        if (castling.includes('q') && !board[3] && !board[2] && !board[1]) moves.push([4, 2]);
      }
    } else {
      const dirs = [];
      if (pt === 'R' || pt === 'Q') dirs.push([-1,0],[1,0],[0,-1],[0,1]);
      if (pt === 'B' || pt === 'Q') dirs.push([-1,-1],[-1,1],[1,-1],[1,1]);
      for (const [dr, df] of dirs) {
        let nr = r + dr, nf = f + df;
        while (nr >= 0 && nr < 8 && nf >= 0 && nf < 8) {
          const t = bcSq(nr, nf);
          if (bcColor(board[t]) === turn) break;
          moves.push([s, t]);
          if (board[t]) break;
          nr += dr; nf += df;
        }
      }
    }
  }
  return moves;
}

function bcIsAttacked(board, sq, byColor) {
  return bcLegalMoves(board, byColor, '-', -1).some(([, t]) => t === sq);
}

function bcFindKing(board, turn) {
  const k = turn === 'w' ? 'K' : 'k';
  for (let i = 0; i < 64; i++) if (board[i] === k) return i;
  return -1;
}

function bcFilterLegal(board, turn, castling, ep) {
  return bcLegalMoves(board, turn, castling, ep).filter(([from, to]) => {
    const nb = [...board];
    nb[to] = nb[from]; nb[from] = null;
    const opp = turn === 'w' ? 'b' : 'w';
    const k = bcFindKing(nb, turn);
    return k < 0 || !bcIsAttacked(nb, k, opp);
  });
}

function bcApplyMove(board, from, to, turn) {
  const nb = [...board];
  const p = nb[from];
  nb[to] = p; nb[from] = null;
  const pt = p?.toUpperCase();
  if (pt === 'K') {
    if (to - from === 2) { nb[to - 1] = nb[to + 1]; nb[to + 1] = null; }
    if (from - to === 2) { nb[to + 1] = nb[to - 2]; nb[to - 2] = null; }
  }
  if (pt === 'P') {
    if (turn === 'w' && bcRank(to) === 0) nb[to] = 'Q';
    if (turn === 'b' && bcRank(to) === 7) nb[to] = 'q';
    if (bcFile(from) !== bcFile(to) && !board[to]) {
      nb[bcSq(turn === 'w' ? bcRank(to) + 1 : bcRank(to) - 1, bcFile(to))] = null;
    }
  }
  return nb;
}

// Строим массив board-состояний из массива SAN-ходов
function bcBuildBoardStates(sanMoves, startFen) {
  const states = [];
  let board = bcFenToBoard(startFen);
  let turn = bcFenTurn(startFen);
  let castling = bcFenCastle(startFen);
  let ep = bcFenEp(startFen);
  states.push({ board: [...board], turn, castling, ep });

  for (const san of sanMoves) {
    const legal = bcFilterLegal(board, turn, castling, ep);
    const mv = bcFindMoveFromSan(board, legal, san, turn);
    if (!mv) break;
    const [from, to] = mv;
    board = bcApplyMove(board, from, to, turn);
    // Обновляем рокировку
    castling = updateCastling(castling, from, to, board);
    ep = updateEp(from, to, board[to], turn);
    turn = turn === 'w' ? 'b' : 'w';
    states.push({ board: [...board], turn, castling, ep });
  }
  return states;
}

function updateCastling(castling, from, to, board) {
  let c = castling;
  if (from === 60 || to === 60) c = c.replace(/[KQ]/g, '');
  if (from === 4 || to === 4) c = c.replace(/[kq]/g, '');
  if (from === 63 || to === 63) c = c.replace('K', '');
  if (from === 56 || to === 56) c = c.replace('Q', '');
  if (from === 7 || to === 7) c = c.replace('k', '');
  if (from === 0 || to === 0) c = c.replace('q', '');
  return c || '-';
}

function updateEp(from, to, piece, turn) {
  if (!piece) return -1;
  const pt = piece.toUpperCase();
  if (pt !== 'P') return -1;
  if (Math.abs(to - from) === 16) {
    return turn === 'w' ? to + 8 : to - 8;
  }
  return -1;
}

function bcFindMoveFromSan(board, moves, san, turn) {
  const clean = san.replace(/[+#!?]/g, '');
  // Рокировка
  if (clean === 'O-O' || clean === '0-0') return moves.find(([f, t]) => board[f]?.toUpperCase() === 'K' && t - f === 2);
  if (clean === 'O-O-O' || clean === '0-0-0') return moves.find(([f, t]) => board[f]?.toUpperCase() === 'K' && f - t === 2);

  const FILES = 'abcdefgh';
  const toFile = FILES.indexOf(clean.slice(-2, -1));
  const toRank = 8 - parseInt(clean.slice(-1));
  if (toFile < 0 || isNaN(toRank)) return null;
  const toSq = bcSq(toRank, toFile);

  let pt = 'P';
  if (clean[0] >= 'A' && clean[0] <= 'Z') pt = clean[0];

  // Фильтруем по типу фигуры и цели
  let candidates = moves.filter(([f, t]) => t === toSq && board[f]?.toUpperCase() === pt);

  // Disambiguate
  if (candidates.length > 1) {
    // Ищем уточняющий символ
    const disambig = clean.replace(/x/g, '').slice(pt === 'P' ? 0 : 1, -2);
    if (disambig) {
      const df = FILES.indexOf(disambig[0]);
      const dr = parseInt(disambig[0]);
      if (df >= 0) candidates = candidates.filter(([f]) => bcFile(f) === df);
      else if (!isNaN(dr)) candidates = candidates.filter(([f]) => bcRank(f) === 8 - dr);
    }
  }

  return candidates[0] || null;
}

// ─── СОСТОЯНИЕ ТРАНСЛЯЦИЙ ─────────────────────────────────────────────────────
const BC = {
  currentBroadcastId: null,
  currentGameId: null,
  broadcastList: [],
  games: new Map(),       // gameId → gameData
  boardStates: [],        // массив позиций текущей партии
  viewIdx: -1,            // -1 = последняя позиция (live)
  inVariation: false,
  varStates: [],          // состояния вариации
  varIdx: -1,
  selected: null,
  legalDests: [],
  flipped: false,
  engineOn: false,
  engineWorker: null,
  rounds: [],
  isConnectedSocket: false,
};

// ─── ИНИЦИАЛИЗАЦИЯ СТРАНИЦЫ ───────────────────────────────────────────────────
pages['broadcast'] = function () {
  initBroadcastPage();
};

function initBroadcastPage() {
  if (!BC.isConnectedSocket && typeof socket !== 'undefined' && socket) {
    setupBroadcastSocket();
  }
  loadBroadcastList();
}

function setupBroadcastSocket() {
  BC.isConnectedSocket = true;

  // Состояние трансляции (при подключении)
  socket.on('broadcast_state', (data) => {
    applyBroadcastData(data);
  });

  // Обновление в реальном времени
  socket.on('broadcast_update', (data) => {
    if (data.broadcastId !== BC.currentBroadcastId) return;
    const prevGameMoveCounts = new Map([...BC.games.values()].map(g => [g.id, g.moves?.length || 0]));
    applyBroadcastData(data);

    // Показываем уведомление об обновлении
    for (const g of data.games) {
      const prev = prevGameMoveCounts.get(g.id) || 0;
      const now = g.moves?.length || 0;
      if (now > prev && BC.currentGameId !== g.id) {
        updatePairItemBadge(g.id);
      }
    }

    // Если смотрим активную партию и находимся на «live» позиции → обновляем доску
    if (BC.viewIdx === -1 && !BC.inVariation && BC.currentGameId) {
      const g = BC.games.get(BC.currentGameId);
      if (g && g.ongoing) {
        rebuildCurrentGame(g);
        renderBCBoard();
        updateBCPlayerStrips();
        updateBCMoveList();
      }
    }
  });
}

function applyBroadcastData(data) {
  if (data.rounds) BC.rounds = data.rounds;
  for (const g of (data.games || [])) {
    BC.games.set(g.id, g);
  }
  renderPairsList();
}

// ─── СПИСОК ТРАНСЛЯЦИЙ ────────────────────────────────────────────────────────
async function loadBroadcastList() {
  const listEl = document.getElementById('bc-list');
  if (!listEl) return;
  listEl.innerHTML = '<div class="bc-loading">Загрузка трансляций...</div>';
  try {
    const list = await apiGet('/broadcasts');
    BC.broadcastList = list;
    renderBroadcastList(list);
  } catch (e) {
    listEl.innerHTML = '<div class="bc-error">Ошибка загрузки: ' + escapeHtml(e.message) + '</div>';
  }
}

function renderBroadcastList(list) {
  const listEl = document.getElementById('bc-list');
  if (!listEl) return;
  if (!list.length) {
    listEl.innerHTML = '<div class="bc-empty">Нет активных трансляций</div>';
    return;
  }
  listEl.innerHTML = '';
  list.forEach(bc => {
    const hasLive = bc.hasOngoing;
    const item = document.createElement('div');
    item.className = 'bc-tournament-item' + (BC.currentBroadcastId === bc.id ? ' active' : '');
    item.innerHTML = `
      <div class="bc-t-header">
        ${hasLive ? '<span class="bc-live-dot"></span>' : ''}
        <span class="bc-t-name">${escapeHtml(bc.name)}</span>
      </div>
      <div class="bc-t-meta">
        ${hasLive ? '<span class="bc-live-badge">LIVE</span>' : '<span class="bc-finished-badge">Завершено</span>'}
        <span>${bc.gamesCount} партий</span>
        ${bc.viewers ? `<span>👁 ${bc.viewers}</span>` : ''}
      </div>
    `;
    item.addEventListener('click', () => selectBroadcast(bc.id));
    listEl.appendChild(item);
  });
}

async function selectBroadcast(broadcastId) {
  // Отписываемся от предыдущей
  if (BC.currentBroadcastId && typeof socket !== 'undefined' && socket) {
    socket.emit('broadcast_leave', BC.currentBroadcastId);
  }

  BC.currentBroadcastId = broadcastId;
  BC.currentGameId = null;
  BC.games.clear();
  BC.boardStates = [];
  BC.viewIdx = -1;
  BC.inVariation = false;

  // Обновляем UI списка
  document.querySelectorAll('.bc-tournament-item').forEach(el => el.classList.remove('active'));

  // Показываем лоадер партий
  const pairsEl = document.getElementById('bc-pairs-list');
  if (pairsEl) pairsEl.innerHTML = '<div class="bc-loading">Загрузка партий...</div>';

  try {
    // Загружаем данные трансляции
    const data = await apiGet('/broadcasts/' + broadcastId);
    BC.rounds = data.rounds || [];
    for (const g of (data.games || [])) BC.games.set(g.id, g);
    document.getElementById('bc-toolbar-title').textContent = data.name;
    renderPairsList();

    // Подписываемся через сокет
    if (typeof socket !== 'undefined' && socket) {
      if (!BC.isConnectedSocket) setupBroadcastSocket();
      socket.emit('broadcast_join', broadcastId);
    }

    // Выбираем первую активную партию
    const firstOngoing = [...BC.games.values()].find(g => g.ongoing);
    const firstGame = firstOngoing || [...BC.games.values()][0];
    if (firstGame) selectGame(firstGame.id);

  } catch (e) {
    toast('Ошибка загрузки трансляции: ' + e.message, 'error');
  }
}

// ─── СПИСОК ПАРТИЙ (ПАРЫ) ────────────────────────────────────────────────────
function renderPairsList() {
  const el = document.getElementById('bc-pairs-list');
  if (!el) return;

  // Группируем по раунду
  const byRound = new Map();
  for (const g of BC.games.values()) {
    const rId = g.roundId || 'default';
    const rName = g.roundName || 'Партии';
    if (!byRound.has(rId)) byRound.set(rId, { name: rName, games: [] });
    byRound.get(rId).games.push(g);
  }

  el.innerHTML = '';

  for (const [rId, round] of byRound) {
    if (byRound.size > 1) {
      const header = document.createElement('div');
      header.className = 'bc-round-header';
      header.textContent = round.name;
      el.appendChild(header);
    }

    for (const g of round.games) {
      const item = document.createElement('div');
      item.className = 'bc-pair-item' + (BC.currentGameId === g.id ? ' active' : '');
      item.id = 'bc-pair-' + g.id;

      const result = g.result === '*' ? '' : g.result;
      const resultHtml = result
        ? `<span class="bc-pair-result ${result === '1-0' ? 'white-win' : result === '0-1' ? 'black-win' : 'draw'}">${result}</span>`
        : '<span class="bc-pair-live-dot"></span>';

      const wRating = g.whiteRating ? `<span class="bc-pair-rating">${g.whiteRating}</span>` : '';
      const bRating = g.blackRating ? `<span class="bc-pair-rating">${g.blackRating}</span>` : '';
      const moveNum = g.moves ? Math.ceil(g.moves.length / 2) : 0;

      item.innerHTML = `
        <div class="bc-pair-players">
          <div class="bc-pair-row">
            <span class="bc-piece-color white"></span>
            <span class="bc-pair-name">${escapeHtml(g.whiteName || '?')}</span>
            ${wRating}
          </div>
          <div class="bc-pair-row">
            <span class="bc-piece-color black"></span>
            <span class="bc-pair-name">${escapeHtml(g.blackName || '?')}</span>
            ${bRating}
          </div>
        </div>
        <div class="bc-pair-right">
          ${resultHtml}
          ${moveNum ? `<div class="bc-pair-move-num">${moveNum} хд</div>` : ''}
        </div>
      `;
      item.addEventListener('click', () => { selectGame(g.id); closeBcSidebars(); });
      el.appendChild(item);
    }
  }
}

function updatePairItemBadge(gameId) {
  const item = document.getElementById('bc-pair-' + gameId);
  if (!item) return;
  item.classList.add('bc-pair-updated');
  setTimeout(() => item.classList.remove('bc-pair-updated'), 3000);
}

// ─── ВЫБОР ПАРТИИ ─────────────────────────────────────────────────────────────
function selectGame(gameId) {
  BC.currentGameId = gameId;
  BC.viewIdx = -1;
  BC.inVariation = false;
  BC.varStates = [];
  BC.varIdx = -1;
  BC.selected = null;
  BC.legalDests = [];

  // Снимаем подсветку «вариации»
  document.getElementById('bc-var-ind')?.classList.remove('show');
  document.getElementById('bc-btn-live').style.display = 'none';

  // Обновляем список пар
  document.querySelectorAll('.bc-pair-item').forEach(el => el.classList.remove('active'));
  const pairEl = document.getElementById('bc-pair-' + gameId);
  if (pairEl) { pairEl.classList.add('active'); pairEl.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }

  const g = BC.games.get(gameId);
  if (!g) return;

  rebuildCurrentGame(g);
  renderBCBoard();
  updateBCPlayerStrips();
  updateBCMoveList();
  if (BC.engineOn) runBCEngine();
}

function rebuildCurrentGame(g) {
  const startFen = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
  BC.boardStates = bcBuildBoardStates(g.moves || [], startFen);
}

function getCurrentBCState() {
  if (BC.inVariation && BC.varStates.length) {
    return BC.varStates[BC.varIdx] || BC.varStates[BC.varStates.length - 1];
  }
  if (!BC.boardStates.length) return { board: Array(64).fill(null), turn: 'w', castling: 'KQkq', ep: -1 };
  const idx = BC.viewIdx < 0 ? BC.boardStates.length - 1 : Math.min(BC.viewIdx, BC.boardStates.length - 1);
  return BC.boardStates[idx];
}

// ─── РЕНДЕР ДОСКИ ────────────────────────────────────────────────────────────
function renderBCBoard() {
  const el = document.getElementById('bc-board');
  if (!el) return;
  el.innerHTML = '';

  const state = getCurrentBCState();
  const { board, turn, castling, ep } = state;

  const lastMoveFrom = getLastMoveSquares().from;
  const lastMoveTo = getLastMoveSquares().to;

  for (let r = 0; r < 8; r++) {
    for (let f = 0; f < 8; f++) {
      const sq = BC.flipped ? (7 - r) * 8 + (7 - f) : r * 8 + f;
      const div = document.createElement('div');
      const isLight = (r + f) % 2 === 0;
      div.className = 'bc-sq ' + (isLight ? 'light' : 'dark');
      div.dataset.sq = sq;

      // Координаты
      if (BC.flipped ? r === 0 : r === 7) {
        const c = document.createElement('span');
        c.className = 'bc-coord-file';
        c.textContent = 'abcdefgh'[BC.flipped ? 7 - f : f];
        div.appendChild(c);
      }
      if (BC.flipped ? f === 7 : f === 0) {
        const c = document.createElement('span');
        c.className = 'bc-coord-rank';
        c.textContent = BC.flipped ? r + 1 : 8 - r;
        div.appendChild(c);
      }

      // Подсветки
      if (sq === BC.selected) div.classList.add('bc-selected');
      if (sq === lastMoveFrom || sq === lastMoveTo) div.classList.add('bc-last-move');
      if (BC.legalDests.some(([, t]) => t === sq)) div.classList.add(board[sq] ? 'bc-legal-cap' : 'bc-legal');

      // Шах королю
      if (board[sq] === (turn === 'w' ? 'K' : 'k')) {
        if (bcIsAttacked(board, sq, turn === 'w' ? 'b' : 'w')) div.classList.add('bc-in-check');
      }

      // Фигура
      if (board[sq]) {
        const piece = document.createElement('span');
        piece.className = 'bc-piece';
        piece.textContent = BC_PIECES[board[sq]] || board[sq];
        div.appendChild(piece);
      }

      div.addEventListener('click', () => handleBCSqClick(sq));
      el.appendChild(div);
    }
  }
}

function getLastMoveSquares() {
  if (BC.inVariation && BC.varStates.length && BC.varIdx > 0) {
    return { from: BC.varStates[BC.varIdx].lastFrom, to: BC.varStates[BC.varIdx].lastTo };
  }
  const idx = BC.viewIdx < 0 ? BC.boardStates.length - 1 : BC.viewIdx;
  if (idx > 0 && BC.boardStates[idx]) {
    return { from: BC.boardStates[idx].lastFrom, to: BC.boardStates[idx].lastTo };
  }
  return { from: -1, to: -1 };
}

// Перестраиваем boardStates с сохранением lastFrom/lastTo
function bcBuildBoardStatesWithHistory(sanMoves, startFen) {
  const states = [];
  let board = bcFenToBoard(startFen);
  let turn = bcFenTurn(startFen);
  let castling = bcFenCastle(startFen);
  let ep = bcFenEp(startFen);
  states.push({ board: [...board], turn, castling, ep, lastFrom: -1, lastTo: -1 });

  for (const san of sanMoves) {
    const legal = bcFilterLegal(board, turn, castling, ep);
    const mv = bcFindMoveFromSan(board, legal, san, turn);
    if (!mv) break;
    const [from, to] = mv;
    board = bcApplyMove(board, from, to, turn);
    castling = updateCastling(castling, from, to, board);
    ep = updateEp(from, to, board[to], turn);
    turn = turn === 'w' ? 'b' : 'w';
    states.push({ board: [...board], turn, castling, ep, lastFrom: from, lastTo: to });
  }
  return states;
}

// Переопределяем rebuildCurrentGame чтобы сохранять историю ходов
function rebuildCurrentGame(g) {
  const startFen = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
  BC.boardStates = bcBuildBoardStatesWithHistory(g.moves || [], startFen);
}

// ─── КЛИК ПО КЛЕТКЕ ──────────────────────────────────────────────────────────
function handleBCSqClick(sq) {
  const state = getCurrentBCState();
  const { board, turn, castling, ep } = state;
  const p = board[sq];

  if (BC.selected === null) {
    if (!p) return;
    // Можно трогать любую фигуру (режим изучения)
    BC.selected = sq;
    BC.legalDests = bcFilterLegal(board, bcColor(p), castling, ep).filter(([f]) => f === sq);
    renderBCBoard();
    return;
  }

  if (BC.selected === sq) {
    BC.selected = null; BC.legalDests = [];
    renderBCBoard();
    return;
  }

  const mv = BC.legalDests.find(([, t]) => t === sq);
  if (mv) {
    // Входим в вариацию
    enterVariation(mv[0], mv[1], state);
    return;
  }

  // Смена выбранной фигуры
  if (p) {
    BC.selected = sq;
    BC.legalDests = bcFilterLegal(board, bcColor(p), castling, ep).filter(([f]) => f === sq);
  } else {
    BC.selected = null; BC.legalDests = [];
  }
  renderBCBoard();
}

function enterVariation(from, to, baseState) {
  const newBoard = bcApplyMove(baseState.board, from, to, baseState.turn);
  const newCastling = updateCastling(baseState.castling, from, to, newBoard);
  const newEp = updateEp(from, to, newBoard[to], baseState.turn);
  const newTurn = baseState.turn === 'w' ? 'b' : 'w';

  const firstState = {
    board: newBoard, turn: newTurn, castling: newCastling, ep: newEp,
    lastFrom: from, lastTo: to,
  };

  if (!BC.inVariation) {
    // Старт вариации — копируем путь до текущей позиции
    const baseIdx = BC.viewIdx < 0 ? BC.boardStates.length - 1 : BC.viewIdx;
    BC.varStates = [
      ...BC.boardStates.slice(0, baseIdx + 1),
      firstState,
    ];
    BC.varIdx = BC.varStates.length - 1;
    BC.inVariation = true;
  } else {
    BC.varStates = BC.varStates.slice(0, BC.varIdx + 1);
    BC.varStates.push(firstState);
    BC.varIdx = BC.varStates.length - 1;
  }

  BC.selected = null; BC.legalDests = [];
  document.getElementById('bc-var-ind')?.classList.add('show');
  document.getElementById('bc-btn-live').style.display = 'flex';
  renderBCBoard();
  updateBCMoveList();
  if (BC.engineOn) runBCEngine();
}

function returnToLive() {
  BC.inVariation = false;
  BC.varStates = [];
  BC.varIdx = -1;
  BC.viewIdx = -1;
  BC.selected = null;
  BC.legalDests = [];
  document.getElementById('bc-var-ind')?.classList.remove('show');
  document.getElementById('bc-btn-live').style.display = 'none';
  renderBCBoard();
  updateBCMoveList();
  if (BC.engineOn) runBCEngine();
}

// ─── НАВИГАЦИЯ ПО ХОДАМ ──────────────────────────────────────────────────────
function bcStepMove(dir) {
  if (BC.inVariation) {
    const newIdx = BC.varIdx + dir;
    if (newIdx < 0) { returnToLive(); return; }
    if (newIdx >= BC.varStates.length) return;
    BC.varIdx = newIdx;
    BC.selected = null; BC.legalDests = [];
    renderBCBoard();
    updateBCMoveList();
    return;
  }
  const max = BC.boardStates.length - 1;
  const cur = BC.viewIdx < 0 ? max : BC.viewIdx;
  const next = Math.max(0, Math.min(max, cur + dir));
  BC.viewIdx = next >= max ? -1 : next;
  BC.selected = null; BC.legalDests = [];
  renderBCBoard();
  updateBCMoveList();
  if (BC.engineOn) runBCEngine();
}

function bcGoToMove(idx) {
  if (BC.inVariation) return;
  const max = BC.boardStates.length - 1;
  if (idx >= max || idx === 9999) {
    BC.viewIdx = -1;
  } else {
    BC.viewIdx = Math.max(0, Math.min(max, idx));
  }
  BC.selected = null; BC.legalDests = [];
  renderBCBoard();
  updateBCMoveList();
  if (BC.engineOn) runBCEngine();
}

function bcJumpToMove(idx) {
  if (BC.inVariation) returnToLive();
  bcGoToMove(idx);
}

// ─── СПИСОК ХОДОВ ─────────────────────────────────────────────────────────────
function updateBCMoveList() {
  const panel = document.getElementById('bc-moves-panel');
  if (!panel) return;

  const g = BC.games.get(BC.currentGameId);
  const moves = g?.moves || [];
  if (!moves.length) {
    panel.innerHTML = '<div class="bc-moves-empty">Ходов пока нет</div>';
    return;
  }

  const curIdx = BC.viewIdx < 0 ? BC.boardStates.length - 2 : BC.viewIdx - 1;

  let html = '<div class="bc-moves-grid">';
  for (let i = 0; i < moves.length; i += 2) {
    const mn = Math.floor(i / 2) + 1;
    html += `<span class="bc-move-num">${mn}.</span>`;
    html += `<span class="bc-move-cell${i === curIdx ? ' current' : ''}" data-idx="${i + 1}">${escapeHtml(moves[i] || '...')}</span>`;
    html += `<span class="bc-move-cell${i + 1 === curIdx ? ' current' : ''}" data-idx="${i + 2}">${escapeHtml(moves[i + 1] || '')}</span>`;
  }

  // Результат
  if (g?.result && g.result !== '*') {
    html += `<span></span><span></span><span class="bc-move-result">${g.result}</span>`;
  }
  html += '</div>';
  panel.innerHTML = html;

  // Навешиваем клики
  panel.querySelectorAll('.bc-move-cell[data-idx]').forEach(el => {
    el.addEventListener('click', () => bcJumpToMove(parseInt(el.dataset.idx)));
  });

  // Скроллим к текущему
  panel.querySelector('.current')?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}

// ─── ПЛАШКИ ИГРОКОВ ──────────────────────────────────────────────────────────
function updateBCPlayerStrips() {
  const g = BC.games.get(BC.currentGameId);
  if (!g) return;

  const topIsBlack = !BC.flipped;
  const top = topIsBlack ? { name: g.blackName, rating: g.blackRating } : { name: g.whiteName, rating: g.whiteRating };
  const bot = topIsBlack ? { name: g.whiteName, rating: g.whiteRating } : { name: g.blackName, rating: g.blackRating };

  document.getElementById('bc-top-name').textContent = top.name || '?';
  document.getElementById('bc-top-rating').textContent = top.rating ? `(${top.rating})` : '';
  document.getElementById('bc-top-avatar').textContent = (top.name || '?')[0].toUpperCase();

  document.getElementById('bc-bot-name').textContent = bot.name || '?';
  document.getElementById('bc-bot-rating').textContent = bot.rating ? `(${bot.rating})` : '';
  document.getElementById('bc-bot-avatar').textContent = (bot.name || '?')[0].toUpperCase();

  // Часы
  const cw = g.clockWhite != null ? formatClock(g.clockWhite) : '—';
  const cb = g.clockBlack != null ? formatClock(g.clockBlack) : '—';
  document.getElementById('bc-clock-top').textContent = topIsBlack ? cb : cw;
  document.getElementById('bc-clock-bot').textContent = topIsBlack ? cw : cb;

  // Активные часы
  const state = getCurrentBCState();
  const topTicking = g.ongoing && (topIsBlack ? state.turn === 'b' : state.turn === 'w') && BC.viewIdx === -1;
  document.getElementById('bc-clock-top').classList.toggle('ticking', topTicking);
  document.getElementById('bc-clock-bot').classList.toggle('ticking', g.ongoing && !topTicking && BC.viewIdx === -1);

  // Статус
  const statusEl = document.getElementById('bc-game-status');
  if (statusEl) {
    if (!g.ongoing && g.result !== '*') {
      statusEl.className = 'bc-game-status ended';
      statusEl.textContent = 'Завершено: ' + g.result;
    } else {
      statusEl.className = 'bc-game-status live';
      statusEl.innerHTML = '<span class="bc-live-dot-sm"></span> LIVE';
    }
  }

  // Заголовок
  document.getElementById('bc-toolbar-title').textContent =
    escapeHtml((g.whiteName || '?') + ' vs ' + (g.blackName || '?'));
}

function formatClock(secs) {
  if (secs == null) return '—';
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = secs % 60;
  if (h > 0) return `${h}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
  return `${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
}

// ─── ДВЖИОК (имитация) ────────────────────────────────────────────────────────
let _bcEngineTimer = null;

function toggleBCEngine(on) {
  BC.engineOn = on;
  const evalWrap = document.getElementById('bc-eval-wrap');
  if (evalWrap) evalWrap.style.display = on ? 'flex' : 'none';
  if (on) runBCEngine();
  else clearTimeout(_bcEngineTimer);
}

function runBCEngine() {
  if (!BC.engineOn) return;
  clearTimeout(_bcEngineTimer);
  const lineEl = document.getElementById('bc-engine-line');
  if (lineEl) lineEl.textContent = 'Анализ...';
  _bcEngineTimer = setTimeout(() => {
    const state = getCurrentBCState();
    const score = mockBCEval(state.board, state.turn);
    updateBCEvalBar(score, state);
  }, 300 + Math.random() * 400);
}

function mockBCEval(board, turn) {
  const vals = { P: 1, N: 3, B: 3.2, R: 5, Q: 9 };
  let score = 0;
  for (let i = 0; i < 64; i++) {
    const p = board[i]; if (!p) continue;
    const v = vals[p.toUpperCase()] || 0;
    score += bcIsWhite(p) ? v : -v;
  }
  score += (Math.random() - 0.5) * 0.6;
  return Math.round(score * 10) / 10;
}

function updateBCEvalBar(score, state) {
  const fillEl = document.getElementById('bc-eval-fill');
  const textEl = document.getElementById('bc-eval-score');
  const lineEl = document.getElementById('bc-engine-line');

  const pct = 50 + Math.min(50, Math.max(-50, score * 5));
  if (fillEl) fillEl.style.width = pct + '%';

  const scoreStr = score > 0 ? '+' + score.toFixed(1) : score.toFixed(1);
  if (textEl) textEl.textContent = scoreStr;

  // Лучший ход
  const legal = bcFilterLegal(state.board, state.turn, state.castling, state.ep);
  if (legal.length && lineEl) {
    const mv = legal[Math.floor(Math.random() * Math.min(3, legal.length))];
    const files = 'abcdefgh';
    const bestStr = files[bcFile(mv[0])] + (8 - bcRank(mv[0])) + files[bcFile(mv[1])] + (8 - bcRank(mv[1]));
    lineEl.textContent = `Глубина 22 • Оценка ${scoreStr} • ${bestStr}`;
  } else if (lineEl) {
    lineEl.textContent = 'Нет доступных ходов';
  }
}

// ─── ПЕРЕВОРОТ ДОСКИ ──────────────────────────────────────────────────────────
function flipBCBoard() {
  BC.flipped = !BC.flipped;
  renderBCBoard();
  updateBCPlayerStrips();
}

// ─── МОБИЛЬНЫЕ САЙДБАРЫ ───────────────────────────────────────────────────────
function openBcSidebar(side) {
  document.getElementById('bc-sidebar-' + side).classList.add('bc-mobile-open');
  document.getElementById('bc-overlay').classList.add('show');
}
function closeBcSidebar(side) {
  document.getElementById('bc-sidebar-' + side)?.classList.remove('bc-mobile-open');
  document.getElementById('bc-overlay')?.classList.remove('show');
}
function closeBcSidebars() {
  closeBcSidebar('left'); closeBcSidebar('right');
}

// ─── КЛАВИШИ ─────────────────────────────────────────────────────────────────
function initBCKeys() {
  document.addEventListener('keydown', (e) => {
    const page = document.getElementById('page-broadcast');
    if (!page?.classList.contains('active')) return;
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
    if (e.key === 'ArrowLeft') bcStepMove(-1);
    if (e.key === 'ArrowRight') bcStepMove(1);
    if (e.key === 'ArrowUp') { e.preventDefault(); bcGoToMove(0); }
    if (e.key === 'ArrowDown') { e.preventDefault(); bcGoToMove(9999); }
    if (e.key === 'f' || e.key === 'F') flipBCBoard();
    if (e.key === 'Escape' && BC.inVariation) returnToLive();
  });
}
initBCKeys();

// ─── АВТООБНОВЛЕНИЕ СПИСКА ТРАНСЛЯЦИЙ ────────────────────────────────────────
setInterval(() => {
  const page = document.getElementById('page-broadcast');
  if (!page?.classList.contains('active')) return;
  loadBroadcastList();
}, 60000); // каждую минуту обновляем список

// ─── УПРАВЛЕНИЕ ЧЕРЕЗ СТРАНИЦУ (helpers для onclick в HTML) ──────────────────
window.bcSelectBroadcast = selectBroadcast;
window.bcReturnToLive = returnToLive;
window.bcFlipBoard = flipBCBoard;
window.bcStepMove = bcStepMove;
window.bcGoToMove = bcGoToMove;
window.bcToggleEngine = toggleBCEngine;
window.bcOpenSidebar = openBcSidebar;
window.bcCloseSidebar = closeBcSidebar;
window.bcCloseSidebars = closeBcSidebars;