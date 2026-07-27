/**
 * opening-board.js
 * ────────────────────────────────────────────────────────────────
 * Главный поток "Дебютной базы данных".
 *
 * ПОЧЕМУ ПЕРЕПИСАНО (было opening-main.js):
 * Старая версия тянула chess.js с cdnjs и рисовала фигуры юникодом.
 * Если внешний CDN не отвечал (сеть/расширение блокировщик/CSP) —
 * весь скрипт падал на `if (typeof Chess === 'undefined') return;`
 * молча, и пользователь просто видел пустой квадрат без единой
 * ошибки на экране (только в консоли). Это и был "пустой борд" с
 * скриншота.
 *
 * Теперь виджет использует ТЕ ЖЕ движок и фигуры, что и вся
 * остальная доска сайта:
 *   - ChessEngine  (правила ходов, легальные ходы, SAN/FEN) — chess-engine.js
 *   - PIECE_IMGS   (инлайновые SVG фигур, без сети)          — pieces.js
 * Оба уже загружаются на страницах игры/анализа, так что здесь
 * ничего лишнего не подгружается и рвать связь с интернетом
 * для отрисовки доски больше не может ничего.
 *
 * Если вдруг ChessEngine/PIECE_IMGS всё же не подключены (например,
 * забыли добавить <script> в HTML) — виджет теперь честно пишет
 * об этом в статус-строку, а не молчит.
 *
 * Никакого fetch и разбора JSON тут нет — это всё в opening-worker.js.
 */

(function () {
  'use strict';

  const els = {
    input: document.getElementById('od-fen-input'),
    button: document.getElementById('od-search-btn'),
    status: document.getElementById('od-status'),
    tableBody: document.getElementById('od-table-body'),
    tableWrap: document.getElementById('od-table-wrap'),
    totalRow: document.getElementById('od-total-row'),
    openingName: document.getElementById('od-opening-name'),
    board: document.getElementById('od-board'),
    boardWrap: document.getElementById('od-board-wrap'),
    flipBtn: document.getElementById('od-flip-btn'),
    resetBtn: document.getElementById('od-reset-btn'),
    undoBtn: document.getElementById('od-undo-btn'),
    breadcrumb: document.getElementById('od-breadcrumb')
  };

  if (!els.board || !els.input) return; // страница без виджета

  if (typeof ChessEngine === 'undefined' || typeof PIECE_IMGS === 'undefined') {
    console.error('[opening-board] ChessEngine или PIECE_IMGS не подключены — проверьте <script src="/js/chess-engine.js"> и <script src="/js/pieces.js"> в opening-database.html');
    if (els.status) {
      els.status.textContent = 'Не загрузился движок доски (chess-engine.js / pieces.js). Обновите страницу или сообщите администратору.';
      els.status.classList.add('od-status--error');
    }
    if (els.board) {
      els.board.innerHTML = '<div class="od-board-error">Доска недоступна</div>';
    }
    return;
  }

  const FILES = 'abcdefgh';
  const PROMOTION_PIECES = ['q', 'r', 'b', 'n'];
  const PROMOTION_LABEL = { q: 'Ферзь', r: 'Ладья', b: 'Слон', n: 'Конь' };

  // ── Состояние партии ─────────────────────────────────────────────────────
  // history[i] = { state, move, san }; history[0].move/san всегда null
  let history = [{ state: ChessEngine.deepClone(ChessEngine.parseFEN(ChessEngine.START_FEN)), move: null, san: null }];
  let current = ChessEngine.deepClone(history[0].state);

  let isFlipped = false;
  let selectedSq = null;
  let legalMovesCache = [];
  let lastMove = null;
  let pendingPromotion = null; // { from, to }

  // ── ПКМ-аннотации (кружки и стрелки, как на lichess / board.js) ─────────
  let annotations = []; // { type: 'circle'|'arrow', sq?, from?, to? }
  let rmbStartSq = null; // квадрат, с которого началось нажатие ПКМ

  // ── Web Worker ───────────────────────────────────────────────────────────
  const worker = new Worker('/js/opening-worker.js');
  let requestId = 0;
  let lastRequestId = -1;

  worker.addEventListener('message', (event) => {
    const { requestId: respId, ok, moves, position, error } = event.data || {};
    if (respId !== lastRequestId) return; // устаревший ответ — игнор

    setLoading(false);

    if (!ok) {
      showStatus(error || 'Произошла ошибка запроса', true);
      renderTable([], null);
      return;
    }

    if (!moves.length) {
      showStatus('Для этой позиции в базе гроссмейстеров ходов не найдено.');
    } else {
      showStatus(`Партий в этой позиции: ${formatNumber(position.total)}`);
    }
    renderTable(moves, position);
  });

  worker.addEventListener('error', (e) => {
    setLoading(false);
    showStatus('Внутренняя ошибка воркера: ' + e.message, true);
  });

  // ── UI: поле FEN и кнопка ────────────────────────────────────────────────
  els.button.addEventListener('click', () => loadFenFromInput());
  els.input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') loadFenFromInput();
  });

  els.flipBtn?.addEventListener('click', () => {
    isFlipped = !isFlipped;
    renderBoard();
  });
  els.resetBtn?.addEventListener('click', () => {
    history = [history[0]];
    current = ChessEngine.deepClone(history[0].state);
    lastMove = null;
    afterPositionChanged();
  });
  els.undoBtn?.addEventListener('click', () => {
    if (history.length <= 1) return;
    history.pop();
    current = ChessEngine.deepClone(history[history.length - 1].state);
    lastMove = history[history.length - 1].move;
    afterPositionChanged();
  });

  function loadFenFromInput() {
    const fen = els.input.value.trim();
    if (!fen) {
      showStatus('Введите FEN-строку позиции.', true);
      return;
    }
    let parsed;
    try {
      parsed = ChessEngine.parseFEN(fen);
    } catch (e) {
      parsed = null;
    }
    if (!parsed) {
      showStatus('Некорректная FEN-строка.', true);
      return;
    }
    current = parsed;
    history = [{ state: ChessEngine.deepClone(current), move: null, san: null }];
    lastMove = null;
    afterPositionChanged({ skipInputSync: true });
  }

  // ── Координаты клеток ────────────────────────────────────────────────────
  function squareName(sq) {
    const file = sq % 8;
    const rank = Math.floor(sq / 8);
    return FILES[file] + (rank + 1);
  }

  function squareIndex(name) {
    const file = FILES.indexOf(name[0]);
    const rank = parseInt(name[1], 10) - 1;
    return rank * 8 + file;
  }

  function findCheckSquare(state) {
    const kingSq = ChessEngine.findKing(state, state.turn);
    if (kingSq === -1 || kingSq === undefined) return null;
    return ChessEngine.isAttacked(state, kingSq, ChessEngine.opposite(state.turn)) ? kingSq : null;
  }

  // ── Отрисовка доски ──────────────────────────────────────────────────────
  function renderBoard() {
    const inCheckSq = findCheckSquare(current);

    // r=7 (rank 8) сверху при обычной ориентации, r=0 (rank 1) снизу
    const rowOrder = isFlipped ? [0, 1, 2, 3, 4, 5, 6, 7] : [7, 6, 5, 4, 3, 2, 1, 0];
    const fileOrder = isFlipped ? [7, 6, 5, 4, 3, 2, 1, 0] : [0, 1, 2, 3, 4, 5, 6, 7];

    const squares = [];
    for (const r of rowOrder) {
      for (const f of fileOrder) {
        const sq = r * 8 + f;
        const light = (r + f) % 2 !== 0;
        const piece = current.board[sq];
        const name = squareName(sq);

        let classes = 'od-square ' + (light ? 'od-square--light' : 'od-square--dark');
        if (selectedSq === sq) classes += ' od-square--selected';
        if (lastMove && (sq === lastMove.from || sq === lastMove.to)) classes += ' od-square--last-move';
        if (inCheckSq === sq) classes += ' od-square--in-check';

        const isLegal = legalMovesCache.some((m) => m.to === sq);
        const isCapture = isLegal && (piece || current.enPassant === sq);
        if (isLegal) classes += isCapture ? ' od-square--target-capture' : ' od-square--target';

        const isFirstFile = isFlipped ? f === 7 : f === 0;
        const isLastRank = isFlipped ? r === 7 : r === 0;

        const sqEl = document.createElement('div');
        sqEl.className = classes;
        sqEl.dataset.square = name;

        if (isFirstFile) {
          const rankLabel = document.createElement('span');
          rankLabel.className = 'od-coord od-coord--rank';
          rankLabel.textContent = String(r + 1);
          sqEl.appendChild(rankLabel);
        }
        if (isLastRank) {
          const fileLabel = document.createElement('span');
          fileLabel.className = 'od-coord od-coord--file';
          fileLabel.textContent = FILES[f];
          sqEl.appendChild(fileLabel);
        }

        if (piece) {
          const pieceEl = document.createElement('div');
          pieceEl.className = 'od-piece';
          pieceEl.draggable = true;
          const img = document.createElement('img');
          img.src = PIECE_IMGS[piece.color + piece.type];
          img.alt = piece.color + piece.type;
          img.draggable = false;
          pieceEl.appendChild(img);

          pieceEl.addEventListener('dragstart', (e) => {
            e.dataTransfer.setData('text/plain', name);
            e.dataTransfer.effectAllowed = 'move';
            clearAnnotations();
            // Не вызываем renderBoard() синхронно: полная перестройка DOM
            // прямо во время dragstart обрывает нативный drag (браузер
            // теряет исходный узел). Откладываем на следующий тик —
            // тот же приём, что в board.js (setTimeout(() => render(), 0)).
            const piece = current.board[sq];
            if (piece && piece.color === current.turn) {
              selectedSq = sq;
              legalMovesCache = ChessEngine.legalMoves(current, sq);
            }
            setTimeout(() => renderBoard(), 0);
          });
          sqEl.appendChild(pieceEl);
        }

        sqEl.addEventListener('dragover', (e) => e.preventDefault());
        sqEl.addEventListener('drop', (e) => {
          e.preventDefault();
          const fromName = e.dataTransfer.getData('text/plain');
          if (fromName) attemptMove(squareIndex(fromName), sq);
        });
        sqEl.addEventListener('click', () => onSquareClick(sq));

        squares.push(sqEl);
      }
    }

    els.board.innerHTML = '';
    squares.forEach((el) => els.board.appendChild(el));

    renderAnnotationsSVG();
    renderPromotionPickerIfNeeded();
  }

  // ── Аннотации: кружки и стрелки (ПКМ), тот же дизайн, что в board.js ────
  function sqToColRow(sq) {
    const file = sq % 8;
    const rank = Math.floor(sq / 8);
    const col = isFlipped ? 7 - file : file;
    const row = isFlipped ? rank : 7 - rank;
    return { col, row };
  }

  function toggleCircle(sq) {
    const idx = annotations.findIndex((a) => a.type === 'circle' && a.sq === sq);
    if (idx >= 0) annotations.splice(idx, 1);
    else annotations.push({ type: 'circle', sq });
  }

  function toggleArrow(from, to) {
    const idx = annotations.findIndex((a) => a.type === 'arrow' && a.from === from && a.to === to);
    if (idx >= 0) annotations.splice(idx, 1);
    else annotations.push({ type: 'arrow', from, to });
  }

  function clearAnnotations() {
    annotations = [];
  }

  function renderAnnotationsSVG() {
    let svg = els.board.querySelector('.od-annotations-svg');
    if (!svg) {
      svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.setAttribute('class', 'od-annotations-svg');
      svg.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:10;overflow:visible';
      els.board.style.position = 'relative';
      els.board.appendChild(svg);
    }

    if (!annotations.length) {
      svg.innerHTML = '';
      return;
    }

    const cell = 100 / 8;
    let defs = `<defs>
      <marker id="od-arrowhead" markerWidth="4" markerHeight="4" refX="2.5" refY="2" orient="auto">
        <polygon points="0 0, 4 2, 0 4" fill="rgba(15,188,0,0.85)"/>
      </marker>
    </defs>`;

    let shapes = '';
    for (const ann of annotations) {
      if (ann.type === 'circle') {
        const { col, row } = sqToColRow(ann.sq);
        const cx = (col + 0.5) * cell;
        const cy = (row + 0.5) * cell;
        const r = cell * 0.44;
        shapes += `<circle cx="${cx}%" cy="${cy}%" r="${r}%" fill="none" stroke="rgba(15,188,0,0.85)" stroke-width="${cell * 0.09}%" />`;
      } else if (ann.type === 'arrow') {
        const f = sqToColRow(ann.from);
        const t = sqToColRow(ann.to);
        const x1 = (f.col + 0.5) * cell;
        const y1 = (f.row + 0.5) * cell;
        const x2 = (t.col + 0.5) * cell;
        const y2 = (t.row + 0.5) * cell;

        const dx = x2 - x1, dy = y2 - y1;
        const len = Math.sqrt(dx * dx + dy * dy) || 1;
        const shorten = cell * 0.35;
        const ex = x2 - (dx / len) * shorten;
        const ey = y2 - (dy / len) * shorten;

        shapes += `<line x1="${x1}%" y1="${y1}%" x2="${ex}%" y2="${ey}%"
          stroke="rgba(15,188,0,0.85)" stroke-width="${cell * 0.18}%"
          stroke-linecap="round"
          marker-end="url(#od-arrowhead)" />`;
      }
    }
    svg.innerHTML = defs + shapes;
  }

  function initAnnotationHandlers() {
    els.board.addEventListener('contextmenu', (e) => e.preventDefault());

    els.board.addEventListener('mousedown', (e) => {
      if (e.button !== 2) return;
      e.preventDefault();
      const sqEl = e.target.closest('[data-square]');
      rmbStartSq = sqEl ? squareIndex(sqEl.dataset.square) : null;
    });

    els.board.addEventListener('mouseup', (e) => {
      if (e.button !== 2) return;
      e.preventDefault();
      const sqEl = e.target.closest('[data-square]');
      const endSq = sqEl ? squareIndex(sqEl.dataset.square) : null;

      if (rmbStartSq === null) {
        clearAnnotations();
        renderAnnotationsSVG();
        return;
      }

      if (endSq === null || endSq === rmbStartSq) {
        toggleCircle(rmbStartSq);
      } else {
        toggleArrow(rmbStartSq, endSq);
      }
      renderAnnotationsSVG();
      rmbStartSq = null;
    });
  }

  function onSquareClick(sq) {
    if (pendingPromotion) return; // ждём выбор фигуры
    clearAnnotations(); // ЛКМ сбрасывает кружки/стрелки, как на lichess

    if (selectedSq !== null && legalMovesCache.some((m) => m.to === sq)) {
      attemptMove(selectedSq, sq);
      return;
    }

    selectSquare(sq);
  }

  function selectSquare(sq) {
    const piece = current.board[sq];
    if (!piece || piece.color !== current.turn) {
      clearSelection();
      renderBoard();
      return;
    }
    selectedSq = sq;
    legalMovesCache = ChessEngine.legalMoves(current, sq);
    renderBoard();
  }

  function clearSelection() {
    selectedSq = null;
    legalMovesCache = [];
  }

  function attemptMove(from, to) {
    if (from === null || from === undefined || from === to) {
      clearSelection();
      renderBoard();
      return;
    }

    const candidates = ChessEngine.legalMoves(current, from);
    const matches = candidates.filter((m) => m.to === to);

    if (!matches.length) {
      clearSelection();
      renderBoard();
      return;
    }

    if (matches.length > 1 && matches.some((m) => m.promotion)) {
      // несколько кандидатов на одну клетку = превращение пешки
      pendingPromotion = { from, to };
      clearSelection();
      renderBoard();
      return;
    }

    executeMove(matches[0]);
  }

  function renderPromotionPickerIfNeeded() {
    if (!pendingPromotion) return;
    const { to } = pendingPromotion;
    const color = current.turn;

    const targetEl = els.board.querySelector(`[data-square="${squareName(to)}"]`);
    if (!targetEl) return;

    const picker = document.createElement('div');
    picker.className = 'od-promotion-picker';
    PROMOTION_PIECES.forEach((p) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'od-promotion-btn';
      btn.title = PROMOTION_LABEL[p];
      const img = document.createElement('img');
      img.src = PIECE_IMGS[color + p];
      img.alt = PROMOTION_LABEL[p];
      btn.appendChild(img);
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const { from, to } = pendingPromotion;
        pendingPromotion = null;
        const candidates = ChessEngine.legalMoves(current, from);
        const move = candidates.find((m) => m.to === to && m.promotion === p);
        if (move) executeMove(move);
        else renderBoard();
      });
      picker.appendChild(btn);
    });
    targetEl.appendChild(picker);
  }

  function executeMove(move) {
    const san = ChessEngine.toSAN(current, move);
    const newState = ChessEngine.applyMove(current, move);
    current = newState;
    history.push({ state: ChessEngine.deepClone(current), move, san });
    lastMove = move;
    clearSelection();
    afterPositionChanged();
  }

  // ── Что происходит после ЛЮБОГО изменения позиции ───────────────────────
  function afterPositionChanged(opts) {
    clearSelection();
    renderBoard();
    renderBreadcrumb();
    if (!opts || !opts.skipInputSync) {
      els.input.value = ChessEngine.toFEN(current);
    }
    runSearch(ChessEngine.toFEN(current));
  }

  function renderBreadcrumb() {
    if (!els.breadcrumb) return;
    const plies = history.slice(1);
    if (!plies.length) {
      els.breadcrumb.textContent = 'Начальная позиция';
      return;
    }
    let text = '';
    plies.forEach((entry, i) => {
      if (i % 2 === 0) text += `${i / 2 + 1}. ${entry.san} `;
      else text += `${entry.san} `;
    });
    els.breadcrumb.textContent = text.trim();
  }

  // ── Обмен с воркером ─────────────────────────────────────────────────────
  function runSearch(fen) {
    requestId += 1;
    lastRequestId = requestId;
    setLoading(true);
    showStatus('Запрашиваем статистику у Lichess…');
    worker.postMessage({ requestId, fen });
  }

  function setLoading(isLoading) {
    els.button.disabled = isLoading;
    els.button.textContent = isLoading ? 'Ищем…' : 'Искать';
  }

  function showStatus(text, isError) {
    if (!els.status) return;
    els.status.textContent = text;
    els.status.classList.toggle('od-status--error', !!isError);
  }

  // ── Таблица результатов ─────────────────────────────────────────────────
  function renderTable(moves, position) {
    if (!els.tableBody) return;
    els.tableBody.innerHTML = '';

    if (els.openingName) {
      els.openingName.textContent = position && position.opening ? position.opening : '';
      els.openingName.style.display = position && position.opening ? '' : 'none';
    }

    moves.forEach((m) => {
      const tr = document.createElement('tr');
      tr.classList.add('od-row-clickable');
      tr.title = 'Нажмите, чтобы сыграть этот ход на доске';

      tr.innerHTML = `
        <td class="od-cell-move">${escapeHtml(m.san)}</td>
        <td class="od-cell-total">${formatNumber(m.total)}</td>
        <td class="od-cell-bar">${renderBar(m)}</td>
        <td class="od-cell-pct od-pct-white">${m.whitePct.toFixed(1)}%</td>
        <td class="od-cell-pct od-pct-draw">${m.drawPct.toFixed(1)}%</td>
        <td class="od-cell-pct od-pct-black">${m.blackPct.toFixed(1)}%</td>
      `;

      tr.addEventListener('click', () => playMoveFromExplorer(m.uci));
      els.tableBody.appendChild(tr);
    });

    if (els.totalRow) {
      if (position && position.total) {
        els.totalRow.style.display = '';
        els.totalRow.querySelector('[data-role="total"]').textContent = formatNumber(position.total);
        els.totalRow.querySelector('[data-role="white"]').textContent = position.whitePct.toFixed(1) + '%';
        els.totalRow.querySelector('[data-role="draw"]').textContent = position.drawPct.toFixed(1) + '%';
        els.totalRow.querySelector('[data-role="black"]').textContent = position.blackPct.toFixed(1) + '%';
      } else {
        els.totalRow.style.display = 'none';
      }
    }

    if (els.tableWrap) {
      els.tableWrap.style.display = moves.length ? '' : 'none';
    }
  }

  // Клик по ходу из таблицы Lichess — проигрываем его на доске.
  // Lichess отдаёт "uci" (например "e2e4" или "e7e8q") — это надёжнее,
  // чем парсить SAN самому, и точно совместимо с ChessEngine.legalMoves.
  function playMoveFromExplorer(uci) {
    if (!uci || uci.length < 4) {
      showStatus('Не удалось сыграть этот ход на доске.', true);
      return;
    }
    const from = squareIndex(uci.slice(0, 2));
    const to = squareIndex(uci.slice(2, 4));
    const promotion = uci.length > 4 ? uci[4] : undefined;

    const candidates = ChessEngine.legalMoves(current, from);
    const move = candidates.find((m) => m.to === to && (!promotion || m.promotion === promotion));

    if (!move) {
      showStatus('Не удалось сыграть этот ход на доске.', true);
      return;
    }
    executeMove(move);
  }

  function renderBar(m) {
    return `
      <div class="od-bar">
        <span class="od-bar-white" style="width:${m.whitePct}%"></span>
        <span class="od-bar-draw" style="width:${m.drawPct}%"></span>
        <span class="od-bar-black" style="width:${m.blackPct}%"></span>
      </div>
    `;
  }

  function formatNumber(n) {
    return new Intl.NumberFormat('ru-RU').format(n);
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  // ── Старт ────────────────────────────────────────────────────────────────
  initAnnotationHandlers();
  els.input.value = ChessEngine.toFEN(current);
  renderBoard();
  renderBreadcrumb();
  runSearch(ChessEngine.toFEN(current));
})();