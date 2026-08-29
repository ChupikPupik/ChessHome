// ══════════════════════════════════════════════════════════════
//  Chess Home — Компонент шахматной доски
// ══════════════════════════════════════════════════════════════

const chessBoard = (() => {
  // ─── СОСТОЯНИЕ ──────────────────────────────────────────────
  let state = ChessEngine.parseFEN(ChessEngine.START_FEN);
  let playerColor = 'w';
  let selectedSq = null;
  let legalMovesCache = [];
  let lastMove = null;
  let gameId = null;
  let historyStates = [ChessEngine.deepClone(state)];
  let viewingMove = -1; // -1 = latest

  // Clocks
  let whiteTime = 600, blackTime = 600;
  let clockInterval = null;
  let clockRunning = false;
  // activeColor теперь хранит чьё время ТИКАЕТ (кто ходит прямо сейчас)
  let activeColor = 'w';

  // Game info
  let gameOpponent = '';
  let _tournamentId = null;
  let _tournamentName = null;
  let gameMode = 'local'; // 'local' | 'online' | 'analysis'
  let isFlipped = false;

  // Premove (преймув) — ход запланированный на чужой ход
  let premove = null; // { from, to, promotion? }
  let premoveSquares = []; // [from, to] для подсветки

  // ─── ПКМ-АННОТАЦИИ (кружки и стрелки, как на lichess) ────
  let annotations = []; // { type: 'circle'|'arrow', sq?, from?, to? }
  let rmbStartSq = null; // квадрат с которого началось нажатие ПКМ

  // PIECE_IMGS comes from pieces.js (inline SVG, no external requests)

  // ─── РЕНДЕР ДОСКИ ─────────────────────────────────────────
  // ─── РАЗМЕР ДОСКИ ──────────────────────────────────────────
  let _boardPx = (() => {
    const v = parseInt(localStorage.getItem('ch_board_size') || '0');
    return v >= 280 && v <= 800 ? v : 0;
  })();

  function initSizeSlider() {
    const slider = document.getElementById('board-size-slider');
    const label  = document.getElementById('board-size-label');
    if (!slider || slider._chInited) return;
    slider._chInited = true;
    slider.min = 280; slider.max = 800; slider.step = 10;
    slider.value = _boardPx >= 280 ? _boardPx : 500;
    if (label) label.textContent = _boardPx >= 280 ? _boardPx + 'px' : 'Авто';

    // Обновляем fill-градиент трека
    function updateSliderFill() {
      const min = parseInt(slider.min), max = parseInt(slider.max);
      const pct = ((parseInt(slider.value) - min) / (max - min) * 100).toFixed(1);
      slider.style.setProperty('--pct', pct + '%');
    }
    updateSliderFill();

    // input — обновляем лейбл и fill, доска НЕ двигается
    slider.addEventListener('input', () => {
      if (label) label.textContent = slider.value + 'px';
      updateSliderFill();
    });
    // change — применяем когда отпустили ползунок
    slider.addEventListener('change', () => {
      _boardPx = parseInt(slider.value);
      localStorage.setItem('ch_board_size', _boardPx);
      render();
      updateSliderFill();
    });

    // ── Ручка-растяжка в углу доски (как на lichess) ──────────
    initResizeHandle();
  }

  function initResizeHandle() {
    const handle = document.getElementById('board-resize-handle');
    if (!handle || handle._chInited) return;
    handle._chInited = true;

    let startX, startY, startSize;

    handle.addEventListener('mousedown', (e) => {
      e.preventDefault();
      const board = getBoardEl();
      startX = e.clientX;
      startY = e.clientY;
      startSize = board.offsetWidth;

      function onMove(e) {
        const dx = e.clientX - startX;
        const dy = e.clientY - startY;
        const delta = Math.round((dx + dy) / 2 / 10) * 10;
        const newSize = Math.max(280, Math.min(800, startSize + delta));
        _boardPx = newSize;

        // Синхронизируем ползунок
        const slider = document.getElementById('board-size-slider');
        const label  = document.getElementById('board-size-label');
        if (slider) {
          slider.value = newSize;
          const min = parseInt(slider.min), max = parseInt(slider.max);
          const pct = ((newSize - min) / (max - min) * 100).toFixed(1);
          slider.style.setProperty('--pct', pct + '%');
        }
        if (label) label.textContent = newSize + 'px';

        // Живой ресайз без полного re-render для скорости
        const boardEl = getBoardEl();
        boardEl.style.width = newSize + 'px';
        boardEl.style.height = newSize + 'px';
      }

      function onUp() {
        localStorage.setItem('ch_board_size', _boardPx);
        render();
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
      }

      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });
  }

  function getBoardEl() {
    let board = document.getElementById('chess-board');
    if (!board) {
      board = document.createElement('div');
      board.id = 'chess-board';
    }

    const analysisActive = document.getElementById('page-analysis')?.classList.contains('active');
    // При реджойне page-analysis точно не active — но страхуемся явной проверкой
    const gameActive = document.getElementById('page-game')?.classList.contains('active');
    const containerId = (analysisActive && !gameActive) ? 'analysis-board-container' : 'game-board-container';
    const container = document.getElementById(containerId);

    if (container && board.parentElement !== container) {
      container.appendChild(board);
    }
    if (!board.isConnected && container) {
      container.appendChild(board);
    }

    const isDesktop = window.innerWidth > 768;
    const boardSize = _boardPx >= 280
      ? _boardPx + 'px'
      : (isDesktop ? 'min(680px, calc(100vw - 400px))' : 'min(480px, calc(100vw - 24px))');

    board.style.cssText = `
      width: ${boardSize};
      height: ${boardSize};
      display: grid;
      grid-template-columns: repeat(8, 1fr);
      grid-template-rows: repeat(8, 1fr);
      border: 3px solid var(--accent-dark);
      border-radius: 4px;
      overflow: hidden;
      box-shadow: var(--shadow), 0 0 40px rgba(0,0,0,0.5);
    `;

    return board;
  }

  function render() {
    const board = getBoardEl();
    if (!board) return;

    const displayState = viewingMove >= 0 && viewingMove < historyStates.length
      ? historyStates[viewingMove] : state;

    const inCheckSq = findCheckSquare(displayState);
    const squares = [];
    const rowOrder  = isFlipped ? [0,1,2,3,4,5,6,7] : [7,6,5,4,3,2,1,0];
    const fileOrder = isFlipped ? [7,6,5,4,3,2,1,0] : [0,1,2,3,4,5,6,7];

    for (const r of rowOrder) {
      for (const f of fileOrder) {
        const sq    = r * 8 + f;
        const light = (r + f) % 2 !== 0;
        const piece = displayState.board[sq];

        let classes = `square ${light ? 'light' : 'dark'}`;
        if (sq === selectedSq) classes += ' selected';
        if (lastMove && (sq === lastMove.from || sq === lastMove.to)) classes += ' last-move';
        if (inCheckSq === sq) classes += ' in-check';
        if (premoveSquares.includes(sq)) classes += ' premove';
        const isLegal   = legalMovesCache.some(m => m.to === sq);
        const isCapture = isLegal && (piece || displayState.enPassant === sq);
        if (isLegal) classes += isCapture ? ' legal-capture' : ' legal-move';

        const isFirstFile = isFlipped ? f === 7 : f === 0;
        const isLastRank  = isFlipped ? r === 7 : r === 0;
        const coordColor  = light ? 'var(--board-dark)' : 'var(--board-light)';
        const showCoords  = typeof getSettings === 'function' ? getSettings().coords !== false : true;
        const showHints   = typeof getSettings === 'function' ? getSettings().hints  !== false : true;

        if (!showHints) {
          classes = classes.replace(' legal-move', '').replace(' legal-capture', '');
        }

        squares.push(`<div class="${classes}" data-sq="${sq}"
          onclick="chessBoard.handleClick(${sq})"
          ondragover="event.preventDefault()"
          ondrop="chessBoard.handleDrop(event,${sq})">
          ${showCoords && isFirstFile ? `<span style="position:absolute;left:2px;top:2px;font-size:10px;font-weight:700;font-family:var(--font-mono);color:${coordColor};line-height:1;pointer-events:none">${r+1}</span>` : ''}
          ${showCoords && isLastRank  ? `<span style="position:absolute;right:2px;bottom:1px;font-size:10px;font-weight:700;font-family:var(--font-mono);color:${coordColor};line-height:1;pointer-events:none">${String.fromCharCode(97+f)}</span>` : ''}
          ${piece ? `<div class="piece" draggable="true"
            ondragstart="chessBoard.handleDragStart(event,${sq})"
            ondragend="chessBoard.handleDragEnd(event)">
            <img src="${PIECE_IMGS[piece.color+piece.type]}" alt="${piece.color}${piece.type}" draggable="false">
          </div>` : ''}
        </div>`);
      }
    }
    board.innerHTML = squares.join('');

    // ─── SVG-оверлей для аннотаций (кружки/стрелки) ────────
    renderAnnotationsSVG(board);

    // ─── ПКМ: обработчики мыши на доске ────────────────────
    board.oncontextmenu = (e) => e.preventDefault();
    board.onmousedown = (e) => {
      if (e.button !== 2) return;
      e.preventDefault();
      const sqEl = e.target.closest('[data-sq]');
      rmbStartSq = sqEl ? parseInt(sqEl.dataset.sq) : null;
    };
    board.onmouseup = (e) => {
      if (e.button !== 2) return;
      e.preventDefault();
      const sqEl = e.target.closest('[data-sq]');
      const endSq = sqEl ? parseInt(sqEl.dataset.sq) : null;

      if (rmbStartSq === null) {
        // ПКМ не на клетке — очищаем всё
        if (premove) { clearPremove(); render(); }
        else { annotations = []; renderAnnotationsSVG(getBoardEl()); }
        return;
      }

      if (endSq === null || endSq === rmbStartSq) {
        // Клик на клетке — кружок или отмена преймува
        if (premove) {
          clearPremove();
          selectedSq = null;
          legalMovesCache = [];
          render();
        } else {
          toggleCircle(rmbStartSq);
          renderAnnotationsSVG(getBoardEl());
        }
      } else {
        // Провели с клетки на клетку — стрелка
        if (premove) {
          clearPremove();
          selectedSq = null;
          legalMovesCache = [];
          render();
        }
        toggleArrow(rmbStartSq, endSq);
        renderAnnotationsSVG(getBoardEl());
      }
      rmbStartSq = null;
    };

    const showAnim = typeof getSettings === 'function' ? getSettings().animation !== false : true;
    board.querySelectorAll('.piece img').forEach(img => {
      img.style.transition = showAnim ? 'transform 0.1s' : 'none';
    });

    renderMoveList();
    updateCapturedPieces(displayState);

    // Показываем/скрываем индикатор преймува
    const pmIndicator = document.getElementById('premove-indicator');
    if (pmIndicator) {
      pmIndicator.classList.toggle('visible', premove !== null);
    }
  }

  // ─── АННОТАЦИИ: кружки и стрелки ─────────────────────────
  function toggleCircle(sq) {
    const idx = annotations.findIndex(a => a.type === 'circle' && a.sq === sq);
    if (idx >= 0) annotations.splice(idx, 1);
    else annotations.push({ type: 'circle', sq });
  }

  function toggleArrow(from, to) {
    const idx = annotations.findIndex(a => a.type === 'arrow' && a.from === from && a.to === to);
    if (idx >= 0) annotations.splice(idx, 1);
    else annotations.push({ type: 'arrow', from, to });
  }

  function clearAnnotations() {
    annotations = [];
  }

  function sqToColRow(sq) {
    // Возвращает { col, row } в координатах доски (0-based, с учётом флипа)
    const file = sq % 8;
    const rank = Math.floor(sq / 8);
    const col  = isFlipped ? 7 - file : file;
    const row  = isFlipped ? rank     : 7 - rank;
    return { col, row };
  }

  function renderAnnotationsSVG(board) {
    if (!board) return;
    let svg = board.querySelector('.board-annotations-svg');
    if (!svg) {
      svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.setAttribute('class', 'board-annotations-svg');
      svg.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:10;overflow:visible';
      board.style.position = 'relative';
      board.appendChild(svg);
    }

    if (!annotations.length) { svg.innerHTML = ''; return; }

    const N = 8;
    const cell = 100 / N; // % единицы

    // Arrowhead marker
    let defs = `<defs>
      <marker id="arrowhead" markerWidth="4" markerHeight="4" refX="2.5" refY="2" orient="auto">
        <polygon points="0 0, 4 2, 0 4" fill="rgba(15,188,0,0.85)"/>
      </marker>
    </defs>`;

    let shapes = '';
    for (const ann of annotations) {
      if (ann.type === 'circle') {
        const { col, row } = sqToColRow(ann.sq);
        const cx = (col + 0.5) * cell;
        const cy = (row + 0.5) * cell;
        const r  = cell * 0.44;
        shapes += `<circle cx="${cx}%" cy="${cy}%" r="${r}%" fill="none" stroke="rgba(15,188,0,0.85)" stroke-width="${cell * 0.09}%" />`;
      } else if (ann.type === 'arrow') {
        const f = sqToColRow(ann.from);
        const t = sqToColRow(ann.to);
        const x1 = (f.col + 0.5) * cell;
        const y1 = (f.row + 0.5) * cell;
        const x2 = (t.col + 0.5) * cell;
        const y2 = (t.row + 0.5) * cell;

        // Укорачиваем линию чуть-чуть у конца чтобы стрелочка выглядела красиво
        const dx = x2 - x1, dy = y2 - y1;
        const len = Math.sqrt(dx*dx + dy*dy);
        const shorten = cell * 0.35;
        const ex = x2 - (dx / len) * shorten;
        const ey = y2 - (dy / len) * shorten;

        shapes += `<line x1="${x1}%" y1="${y1}%" x2="${ex}%" y2="${ey}%"
          stroke="rgba(15,188,0,0.85)" stroke-width="${cell * 0.18}%"
          stroke-linecap="round"
          marker-end="url(#arrowhead)" />`;
      }
    }
    svg.innerHTML = defs + shapes;
  }

  function findCheckSquare(st) {
    const kingSq = ChessEngine.findKing(st, st.turn);
    if (kingSq === -1) return null;
    return ChessEngine.isAttacked(st, kingSq, ChessEngine.opposite(st.turn)) ? kingSq : null;
  }

  // ─── КЛИК ПО КЛЕТКЕ ────────────────────────────────────────
  function handleClick(sq) {
    if (viewingMove !== -1) return;
    clearAnnotations(); // ЛКМ сбрасывает все аннотации

    const piece = state.board[sq];
    const isMyTurn = gameMode !== 'online' || state.turn === playerColor;

    // ── ОНЛАЙН: не наш ход → устанавливаем преймув ──────────
    if (gameMode === 'online' && !isMyTurn) {
      if (selectedSq === null) {
        // Выбираем свою фигуру для преймува
        if (!piece || piece.color !== playerColor) return;
        selectedSq = sq;
        legalMovesCache = []; // Не показываем легальные ходы (мы не знаем, что будет)
        render();
        return;
      }
      if (sq === selectedSq) {
        selectedSq = null; clearPremove(); render(); return;
      }
      // Выбираем другую свою фигуру
      if (piece && piece.color === playerColor) {
        selectedSq = sq; legalMovesCache = []; render(); return;
      }
      // Устанавливаем преймув на клетку назначения
      if (selectedSq !== null) {
        setPremove(selectedSq, sq);
        selectedSq = null; legalMovesCache = [];
        render();
      }
      return;
    }

    if (selectedSq === null) {
      if (!piece) return;
      if (gameMode === 'online' && piece.color !== playerColor) return;
      if (piece.color !== state.turn) return;
      clearPremove();
      selectedSq = sq;
      legalMovesCache = ChessEngine.legalMoves(state, sq);
      render();
      return;
    }

    if (sq === selectedSq) {
      selectedSq = null; legalMovesCache = [];
      render(); return;
    }

    if (piece && piece.color === state.turn && (gameMode !== 'online' || piece.color === playerColor)) {
      selectedSq = sq;
      legalMovesCache = ChessEngine.legalMoves(state, sq);
      render(); return;
    }

    const move = legalMovesCache.find(m => m.to === sq);
    if (!move) { selectedSq = null; legalMovesCache = []; render(); return; }

    if (move.promotion) {
      const promotions = legalMovesCache.filter(m => m.to === sq && m.promotion);
      if (promotions.length > 1) {
        showPromotionDialog(state.turn, (promo) => {
          const pm = promotions.find(m => m.promotion === promo) || promotions[0];
          executeMove(pm);
        });
        return;
      }
    }

    executeMove(move);
  }

  function setPremove(from, to, promotion) {
    premove = { from, to, promotion: promotion || null };
    premoveSquares = [from, to];
  }

  function clearPremove() {
    premove = null;
    premoveSquares = [];
  }

  function executeMove(move) {
    const san = ChessEngine.toSAN(state, move);
    const prevState = ChessEngine.deepClone(state);
    state = ChessEngine.applyMove(state, move);
    state.history = [...prevState.history, { ...move, san, fen: ChessEngine.toFEN(state) }];
    state.capturedWhite = [...prevState.capturedWhite, ...(state.capturedWhite.slice(prevState.capturedWhite.length))];
    state.capturedBlack = [...prevState.capturedBlack, ...(state.capturedBlack.slice(prevState.capturedBlack.length))];

    historyStates.push(ChessEngine.deepClone(state));
    viewingMove = -1;
    lastMove = move;
    selectedSq = null;
    legalMovesCache = [];

    playSound(move);

    if (gameMode === 'online' && socket) {
      socket.emit('make_move', { gameId, move });
    }

    checkGameStatus();
    tickClock();
    render();

    if (gameMode === 'analysis') {
      if (typeof requestAnalysis === 'function') requestAnalysis();
    }
  }

  function applyOpponentMove(move, serverWhiteTime, serverBlackTime) {
    // Синхронизируем время с сервером (авторитетный источник)
    if (serverWhiteTime !== undefined && serverBlackTime !== undefined) {
      whiteTime = serverWhiteTime;
      blackTime = serverBlackTime;
      clockTickAt = Date.now();
    }
    const san = ChessEngine.toSAN(state, move);
    const prevState = ChessEngine.deepClone(state);
    state = ChessEngine.applyMove(state, move);
    state.history = [...prevState.history, { ...move, san, fen: ChessEngine.toFEN(state) }];
    historyStates.push(ChessEngine.deepClone(state));
    viewingMove = -1;
    lastMove = move;
    playSound(move);
    checkGameStatus();
    tickClock();

    // Выполняем преймув если был запланирован
    if (premove && gameMode === 'online') {
      const pm = premove;
      clearPremove();
      // Проверяем легальность преймува в новой позиции
      const legalPremoves = ChessEngine.legalMoves(state, pm.from);
      const legalPm = legalPremoves.find(m => m.to === pm.to && (!pm.promotion || m.promotion === pm.promotion));
      if (legalPm && state.board[pm.from]?.color === playerColor) {
        setTimeout(() => executeMove(legalPm), 50);
      }
    }

    render();
  }

  // Русские подписи причин ничьей — используются и в мгновенном локальном
  // окне результата (checkGameStatus), и в подтверждённом сервером
  // результате (onGameEnded), чтобы текст совпадал в обоих случаях.
  const DRAW_REASON_RU = {
    'stalemate':             'Пат',
    'fifty-move':            'Правило 50 ходов',
    'insufficient-material': 'Недостаточно материала для мата',
    'threefold-repetition':  'Троекратное повторение позиции',
  };

  function checkGameStatus() {
    const status = ChessEngine.getStatus(state);
    if (status.status === 'checkmate') {
      setTimeout(() => {
        const winner = status.winner === 'w' ? 'Белые' : 'Чёрные';
        showGameResult(`${winner} победили!`, 'Мат');
        if (gameMode === 'online' && socket) {
          socket.emit('game_over', { gameId, result: status.winner, reason: 'checkmate' });
        }
        stopClock();
      }, 100);
    } else if (status.status === 'stalemate') {
      setTimeout(() => {
        showGameResult('Ничья', DRAW_REASON_RU.stalemate);
        // БАГ (исправлено): раньше здесь только показывали окно и глушили
        // свои часы, но не сообщали серверу — партия оставалась «живой»
        // в activeGames, серверные часы продолжали тикать, а ходить было
        // невозможно (позиция патовая). Теперь, как и при мате, шлём
        // game_over — сервер сам перепроверяет пат и завершает партию.
        if (gameMode === 'online' && socket) {
          socket.emit('game_over', { gameId, result: 'draw', reason: 'stalemate' });
        }
        stopClock();
      }, 100);
    } else if (status.status === 'draw') {
      setTimeout(() => {
        showGameResult('Ничья', DRAW_REASON_RU[status.reason] || status.reason);
        // То же самое для 50 ходов / недостатка материала / троекратного
        // повторения позиций — раньше ни один из этих исходов не сообщался
        // серверу, партия никогда официально не завершалась.
        if (gameMode === 'online' && socket) {
          socket.emit('game_over', { gameId, result: 'draw', reason: status.reason });
        }
        stopClock();
      }, 100);
    }
  }

  // ─── DRAG & DROP ───────────────────────────────────────────
  let dragFromSq = null;

  function handleDragStart(e, sq) {
    const piece = state.board[sq];
    if (!piece) { e.preventDefault(); return; }
    if (gameMode === 'online' && piece.color !== playerColor) { e.preventDefault(); return; }
    if (viewingMove !== -1) { e.preventDefault(); return; }
    // Разрешаем drag во время чужого хода для преймува
    if (piece.color !== state.turn && !(gameMode === 'online' && piece.color === playerColor)) {
      e.preventDefault(); return;
    }
    dragFromSq = sq;
    selectedSq = sq;
    clearAnnotations();
    if (gameMode === 'online' && state.turn !== playerColor) {
      legalMovesCache = []; // Преймув — легальность проверим потом
    } else {
      legalMovesCache = ChessEngine.legalMoves(state, sq);
    }
    e.dataTransfer.setData('text/plain', sq);
    e.dataTransfer.effectAllowed = 'move';
    setTimeout(() => render(), 0);
  }

  function handleDragEnd(e) {
    // Сбрасываем dragFromSq только если drop не был обработан
    // (dragFromSq уже null если handleDrop отработал)
    dragFromSq = null;
  }

  function handleDrop(e, sq) {
    e.preventDefault();
    // dragFromSq мог быть уже сброшен handleDragEnd в некоторых браузерах —
    // читаем из dataTransfer как запасной вариант
    const from = dragFromSq !== null ? dragFromSq : parseInt(e.dataTransfer.getData('text/plain'));
    dragFromSq = null;
    if (isNaN(from) || from === sq) { selectedSq = null; legalMovesCache = []; render(); return; }

    // Преймув: наш drag во время чужого хода
    if (gameMode === 'online' && state.turn !== playerColor) {
      const piece = state.board[from];
      if (piece && piece.color === playerColor) {
        setPremove(from, sq);
        selectedSq = null; legalMovesCache = [];
        render();
      }
      return;
    }

    // Пересчитываем легальные ходы прямо здесь — не доверяем кэшу
    // (кэш мог устареть если между dragStart и drop что-то его перезаписало)
    const freshMoves = ChessEngine.legalMoves(state, from);
    const move = freshMoves.find(m => m.to === sq);
    if (!move) { selectedSq = null; legalMovesCache = []; render(); return; }

    legalMovesCache = freshMoves; // синхронизируем кэш
    if (move.promotion) {
      const promotions = freshMoves.filter(m => m.to === sq && m.promotion);
      if (promotions.length > 1) {
        showPromotionDialog(state.turn, (promo) => {
          const pm = promotions.find(m => m.promotion === promo) || promotions[0];
          executeMove(pm);
        });
        return;
      }
    }
    executeMove(move);
  }

  // ─── ПРЕВРАЩЕНИЕ ──────────────────────────────────────────
  function showPromotionDialog(color, callback) {
    const overlay = document.getElementById('modal-promotion');
    const pieces = overlay.querySelectorAll('.promo-piece-btn');
    pieces.forEach(btn => {
      const type = btn.dataset.piece;
      btn.querySelector('img').src = PIECE_IMGS[color + type];
      btn.onclick = () => {
        overlay.classList.remove('open');
        callback(type);
      };
    });
    overlay.classList.add('open');
  }

  // ─── СПИСОК ХОДОВ ─────────────────────────────────────────
  function renderMoveList() {
    const table = document.getElementById('moves-table-body');
    if (!table) return;
    const moves = state.history;
    let html = '';
    for (let i = 0; i < moves.length; i += 2) {
      const wMove = moves[i];
      const bMove = moves[i+1];
      const wIdx = i;
      const bIdx = i+1;
      const wCurrent = viewingMove === wIdx || (viewingMove === -1 && wIdx === moves.length - 1 && !bMove);
      const bCurrent = viewingMove === bIdx || (viewingMove === -1 && bIdx === moves.length - 1);
      html += `<tr>
        <td>${Math.floor(i/2)+1}.</td>
        <td class="move-cell ${wCurrent ? 'current' : ''}" onclick="chessBoard.gotoMove(${wIdx+1})">${wMove.san}</td>
        <td class="move-cell ${bCurrent ? 'current' : ''}" onclick="chessBoard.gotoMove(${bIdx+1})">${bMove ? bMove.san : ''}</td>
      </tr>`;
    }
    table.innerHTML = html;
    const movesDiv = table.closest('.moves-list');
    if (movesDiv) movesDiv.scrollTop = movesDiv.scrollHeight;
  }

  function gotoMove(idx) {
    if (idx >= historyStates.length) { viewingMove = -1; }
    else { viewingMove = idx; }
    render();
  }

  function gotoFirst() { viewingMove = 0; render(); }
  function gotoPrev() {
    const cur = viewingMove === -1 ? historyStates.length - 1 : viewingMove;
    viewingMove = Math.max(0, cur - 1);
    render();
  }
  function gotoNext() {
    const cur = viewingMove === -1 ? historyStates.length - 1 : viewingMove;
    const next = cur + 1;
    if (next >= historyStates.length) { viewingMove = -1; }
    else { viewingMove = next; }
    render();
  }
  function gotoLast() { viewingMove = -1; render(); }

  // ─── CLOCK ────────────────────────────────────────────────
  let tcIncrement = 0;
  // Храним точку отсчёта Date.now() чтобы не зависеть от дрейфа setInterval.
  // whiteTime/blackTime — «зафиксированное» время на момент clockTickAt.
  // Реальное отображаемое время = сохранённое - (now - clockTickAt) для activeColor.
  let clockTickAt = null; // Date.now() в момент последнего tickClock() / syncClock

  function startClock(wTime, bTime, tc) {
    const parsed = parseTC(tc || '10+0');
    whiteTime = wTime !== undefined ? wTime : parsed[0] * 60;
    blackTime = bTime !== undefined ? bTime : parsed[0] * 60;
    tcIncrement = parsed[1] || 0;
    activeColor = 'w';
    clockRunning = false;
    clockTickAt = null;
    clearInterval(clockInterval);
    updateClockDisplay();

    // Даём белым 10 сек на первый ход, потом запускаем таймер
    // (только для новых игр — при реджойне ходы уже есть)
    if (gameMode === 'online' && playerColor === 'w') {
      setTimeout(() => {
        // Запускаем только если белые ещё не сделали ход (history пустая)
        if (!clockRunning && (state.history ? state.history.length : 0) === 0) {
          clockRunning = true;
          clockTickAt = Date.now();
          clockInterval = setInterval(clockTick_interval, 100);
        }
      }, 10000);
    }
  }

  function tickClock() {
    const now = Date.now();
    // Кто только что сделал ход (противоположный state.turn, т.к. ход уже применён)
    const justMoved = state.turn === 'w' ? 'b' : 'w';

    if (clockRunning && clockTickAt !== null) {
      // Фиксируем точное время, которое потратил тот кто ходил
      const elapsed = (now - clockTickAt) / 1000;
      if (justMoved === 'w') whiteTime = Math.max(0, whiteTime - elapsed);
      else                    blackTime = Math.max(0, blackTime - elapsed);
    }

    // Инкремент — добавляем тому, кто только что сходил
    if (clockRunning && tcIncrement > 0) {
      if (justMoved === 'w') whiteTime = Math.min(whiteTime + tcIncrement, whiteTime + tcIncrement);
      else blackTime += tcIncrement;
    }

    activeColor = state.turn;
    clockTickAt = now; // сброс точки отсчёта для нового хода

    if (!clockRunning) {
      // Таймер стартует только начиная со 2-го полухода (после первого хода белых)
      // В шахматах белые делают первый ход без затраты времени (по правилам lichess/chess.com)
      const totalMoves = state.history ? state.history.length : 0;
      if (totalMoves >= 1) {
        clockRunning = true;
        clockInterval = setInterval(clockTick_interval, 100);
      }
    }

    updateClockDisplay();
  }

  // Вызывается каждые 100мс — только для обновления дисплея и проверки флага
  function clockTick_interval() {
    if (!clockRunning || clockTickAt === null) return;

    const now     = Date.now();
    const elapsed = (now - clockTickAt) / 1000;

    // Отображаемое время: зафиксированное - прошедшее с последнего хода
    const displayWhite = activeColor === 'w' ? Math.max(0, whiteTime - elapsed) : whiteTime;
    const displayBlack = activeColor === 'b' ? Math.max(0, blackTime - elapsed) : blackTime;

    updateClockDisplayValues(displayWhite, displayBlack);

    if ((activeColor === 'w' && displayWhite <= 0) || (activeColor === 'b' && displayBlack <= 0)) {
      const loser = activeColor;
      if (loser === 'w') whiteTime = 0; else blackTime = 0;
      stopClock();
      const winner = loser === 'w' ? 'Чёрные' : 'Белые';
      showGameResult(`${winner} победили!`, 'Время вышло');
      if (gameMode === 'online' && socket && gameId) {
        const result = loser === 'w' ? 'black' : 'white';
        socket.emit('game_over', { gameId, result, reason: 'timeout' });
      }
    }
  }

  function stopClock() {
    // Фиксируем точное оставшееся время перед остановкой
    if (clockRunning && clockTickAt !== null) {
      const elapsed = (Date.now() - clockTickAt) / 1000;
      if (activeColor === 'w') whiteTime = Math.max(0, whiteTime - elapsed);
      else                      blackTime = Math.max(0, blackTime - elapsed);
    }
    clockRunning = false;
    clockTickAt = null;
    clearInterval(clockInterval);
    updateClockDisplay();
  }

  // Синхронизация с сервером — вызывается после move_confirmed (наш ход принят)
  function syncClockFromServer(serverWhite, serverBlack) {
    if (serverWhite === undefined || serverBlack === undefined) return;
    whiteTime = serverWhite;
    blackTime = serverBlack;
    clockTickAt = Date.now();
    updateClockDisplay();
  }

  function parseTC(tc) {
    const parts = (tc || '10+0').split('+').map(Number);
    return [parts[0] || 10, parts[1] || 0];
  }

  function updateClockDisplay() {
    const elapsed = (clockRunning && clockTickAt !== null) ? (Date.now() - clockTickAt) / 1000 : 0;
    const displayWhite = activeColor === 'w' ? Math.max(0, whiteTime - elapsed) : whiteTime;
    const displayBlack = activeColor === 'b' ? Math.max(0, blackTime - elapsed) : blackTime;
    updateClockDisplayValues(displayWhite, displayBlack);
  }

  function updateClockDisplayValues(wTime, bTime) {
    // bottomEl — ВСЕГДА наш игрок (playerColor)
    // topEl    — ВСЕГДА соперник
    const bottomEl = document.getElementById('clock-white');
    const topEl    = document.getElementById('clock-black');

    // Используем переданные значения (уже с учётом прошедшего времени)
    const myTime    = playerColor === 'w' ? wTime : bTime;
    const theirTime = playerColor === 'w' ? bTime : wTime;

    // Наш ход = activeColor совпадает с нашим цветом
    const myTurn = activeColor === playerColor;

    if (bottomEl) {
      bottomEl.textContent = formatTime(myTime);
      bottomEl.className = 'player-clock' + (myTurn && clockRunning ? ' active' : '') + (myTime < 30 ? ' low' : '');
    }
    if (topEl) {
      topEl.textContent = formatTime(theirTime);
      topEl.className = 'player-clock' + (!myTurn && clockRunning ? ' active' : '') + (theirTime < 30 ? ' low' : '');
    }
  }

  function formatTime(sec) {
    // Округляем вниз — время дробное (float) после точного отсчёта
    const totalSec = Math.max(0, Math.floor(sec));
    const m = Math.floor(totalSec / 60);
    const s = totalSec % 60;
    return `${m}:${s.toString().padStart(2, '0')}`;
  }

  // ─── ЗВУКИ ────────────────────────────────────────────────
  function playSound(move) {
    const settings = typeof getSettings === 'function' ? getSettings() : { sounds: true };
    if (!settings.sounds) return;
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain); gain.connect(ctx.destination);
    gain.gain.setValueAtTime(0.1, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.15);
    if (move.enPassant || state.board[move.to] !== null) {
      osc.frequency.value = 300;
    } else if (move.castle) {
      osc.frequency.value = 500;
    } else {
      osc.frequency.value = 440;
    }
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + 0.15);
  }

  // ─── GAME RESULT ──────────────────────────────────────────
  function showGameResult(title, subtitle, tId) {
    const overlay = document.getElementById('modal-game-result');
    if (!overlay) return;
    overlay.querySelector('#result-title').textContent = title;
    overlay.querySelector('#result-subtitle').textContent = subtitle;
    const tBtn = document.getElementById('result-tournament-btn');
    if (tBtn) { tBtn.style.display = tId ? '' : 'none'; if (tId) tBtn.dataset.tid = tId; }
    overlay.classList.add('open');
  }

  function onGameEnded(data) {
    stopClock();
    clearPremove();
    const myColorFull = playerColor === 'w' ? 'white' : 'black';
    const win  = data.result === myColorFull;
    const draw = data.result === 'draw';
    let reasonText = '';
    if (data.reason === 'resign') {
      reasonText = win ? 'Соперник сдался' : 'Вы сдались';
    } else if (data.reason === 'opponent_resign') {
      reasonText = 'Соперник сдался';
    } else {
      const reasons = {
        checkmate: 'Мат',
        timeout:   'Время вышло',
        agreement: 'По соглашению',
        ...DRAW_REASON_RU,
      };
      reasonText = reasons[data.reason] || data.reason || '';
    }
    const emoji = draw ? '🤝' : win ? '🏆' : '😔';
    const _tId   = _tournamentId;
    const _tName = _tournamentName;
    _tournamentId = null; _tournamentName = null;
    showGameResult(
      emoji + ' ' + (draw ? 'Ничья' : win ? 'Победа!' : 'Поражение'),
      reasonText,
      _tId
    );
    if (_tId && typeof showTournamentReturnBanner === 'function') {
      showTournamentReturnBanner(_tId, _tName);
    }
    refreshCurrentUser();
  }

  // ─── INIT GAME ─────────────────────────────────────────────
  function resyncFromServer(data) {
    // БАГ (исправлено, см. index.js:make_move): сервер раньше мог тихо
    // отбросить ход (например, если по факту сейчас не ваш ход — из-за
    // потерянного из-за короткого обрыва связи предыдущего сообщения),
    // а клиент к этому моменту уже ПРИМЕНИЛ ход локально оптимистично
    // (см. executeMove выше) — доска показывала ход, которого на сервере
    // никогда не было, партия "зависала". Теперь сервер в таких случаях
    // шлёт 'move_rejected' с полной актуальной историей ходов и временем,
    // и мы полностью пересобираем локальную позицию с нуля по этим
    // данным — откатывая всё, чего сервер не подтвердил.
    if (gameMode !== 'online') return;
    const wasViewingLive = viewingMove === -1;
    state = ChessEngine.parseFEN(ChessEngine.START_FEN);
    historyStates = [ChessEngine.deepClone(state)];
    lastMove = null;
    selectedSq = null;
    legalMovesCache = [];
    clearPremove();

    for (const move of (data.moves || [])) {
      try {
        const newState = ChessEngine.applyMove(state, move);
        if (newState) {
          state = newState;
          historyStates.push(ChessEngine.deepClone(state));
          lastMove = move;
        }
      } catch (e) { console.warn('resync applyMove error', e); break; }
    }
    if (wasViewingLive) viewingMove = -1;

    if (data.whiteTime !== undefined && data.blackTime !== undefined) {
      whiteTime = data.whiteTime;
      blackTime = data.blackTime;
    }
    activeColor = state.turn;
    clockTickAt = Date.now();
    updateClockDisplay();

    render();
    checkGameStatus();
  }

  function startGame(data) {
    state = ChessEngine.parseFEN(ChessEngine.START_FEN);
    historyStates = [ChessEngine.deepClone(state)];
    viewingMove = -1;
    lastMove = null;
    selectedSq = null;
    legalMovesCache = [];
    clearPremove();
    gameMode = 'online';
    gameId = data.gameId;
    playerColor = data.color === 'white' ? 'w' : 'b';
    gameOpponent = data.opponent;
    isFlipped = playerColor === 'b';
    _tournamentId   = data.tournamentId   || null;
    _tournamentName = data.tournamentName || null;

    document.getElementById('player-bottom-name').textContent =
      currentUser.username + (playerColor === 'w' ? ' ♙' : ' ♟');
    document.getElementById('player-top-name').textContent =
      gameOpponent + (playerColor === 'w' ? ' ♟' : ' ♙');

    clearChatMessages();

    // Восстановление уже сыгранных ходов (при реджойне после перезагрузки)
    if (data.moves && data.moves.length > 0) {
      for (const move of data.moves) {
        try {
          const newState = ChessEngine.applyMove(state, move);
          if (newState) {
            state = newState;
            historyStates.push(ChessEngine.deepClone(state));
            lastMove = move;
          }
        } catch(e) { console.warn('rejoin applyMove error', e); break; }
      }
      viewingMove = -1;

      // Восстанавливаем время — берём с сервера если есть, иначе пересчитываем по ходам
      const [min, inc] = parseTC(data.timeControl || '10+0');
      const totalSec = min * 60;
      if (data.whiteTime !== undefined && data.blackTime !== undefined) {
        // Сервер передал реальное оставшееся время
        whiteTime = data.whiteTime;
        blackTime = data.blackTime;
        tcIncrement = inc || 0;
      } else {
        // Fallback: приблизительно вычитаем по 5 сек за ход (грубо)
        const movesW = Math.ceil(data.moves.length / 2);
        const movesB = Math.floor(data.moves.length / 2);
        whiteTime = Math.max(10, totalSec - movesW * 5);
        blackTime = Math.max(10, totalSec - movesB * 5);
        tcIncrement = inc || 0;
      }
      activeColor = state.turn;
      clockTickAt = Date.now();
      clockRunning = false; // сначала false, запустим через startClock-like ниже
      clearInterval(clockInterval);
      updateClockDisplay();
      // Запускаем тикер
      clockRunning = true;
      clockInterval = setInterval(clockTick_interval, 100);
    } else {
      // Новая игра — стандартный старт
      const [min] = parseTC(data.timeControl || '10+0');
      startClock(min * 60, min * 60, data.timeControl);
    }

    render();
    // Восстанавливаем чат после реджойна (только если есть ходы = это реджойн)
    if (data.moves && data.moves.length > 0) {
      setTimeout(restoreChatFromSession, 150);
    }
    // Инициализируем слайдер размера (нужно при старте онлайн-игры — showPage('game') не вызывается)
    setTimeout(() => initSizeSlider(), 50);
  }

  function newLocalGame() {
    state = ChessEngine.parseFEN(ChessEngine.START_FEN);
    historyStates = [ChessEngine.deepClone(state)];
    viewingMove = -1; lastMove = null;
    selectedSq = null; legalMovesCache = [];
    gameMode = 'local'; gameId = null; playerColor = 'w';
    isFlipped = false;
    document.getElementById('player-bottom-name').textContent = 'Белые ♙';
    document.getElementById('player-top-name').textContent = 'Чёрные ♟';
    startClock(600, 600, '10+0');
    render();
  }

  function flipBoard() { isFlipped = !isFlipped; render(); }

  function resign() {
    if (!gameId || gameMode !== 'online') return;
    if (!confirm('Сдаться?')) return;
    socket.emit('resign', { gameId });
    stopClock();
  }

  function offerDraw() {
    if (!gameId || gameMode !== 'online') return;
    socket.emit('offer_draw', { gameId });
    toast('Предложение ничьей отправлено', 'info');
  }

  function clearChatMessages() {
    const el = document.getElementById('chat-messages');
    if (el) el.innerHTML = '';
    // Чистим сохранённый чат для этой игры
    try { if (gameId) sessionStorage.removeItem('ch_game_chat_' + gameId); } catch {}
  }

  function saveChatToSession(from, message, isMine) {
    if (!gameId) return;
    try {
      const key = 'ch_game_chat_' + gameId;
      const msgs = JSON.parse(sessionStorage.getItem(key) || '[]');
      msgs.push({ from, message, isMine });
      if (msgs.length > 100) msgs.shift();
      sessionStorage.setItem(key, JSON.stringify(msgs));
    } catch {}
  }

  function restoreChatFromSession() {
    if (!gameId) return;
    try {
      const key = 'ch_game_chat_' + gameId;
      const msgs = JSON.parse(sessionStorage.getItem(key) || '[]');
      if (!msgs.length) return;
      const el = document.getElementById('chat-messages');
      if (!el) return;
      if (typeof appendChatMsg === 'function') {
        el._restoringChat = true;
        msgs.forEach(m => appendChatMsg(m.from, m.message, m.isMine));
        el._restoringChat = false;
      }
    } catch {}
  }

  function updateCapturedPieces(st) {
    const ORDER = ['Q','R','B','N','P'];
    const renderCap = (pieces) => pieces
      .sort((a,b) => ORDER.indexOf(a.type) - ORDER.indexOf(b.type))
      .map(p => `<img src="${PIECE_IMGS[p.color+p.type]}" style="width:20px;height:20px">`)
      .join('');
    const topEl = document.getElementById('captured-top');
    const botEl = document.getElementById('captured-bottom');
    if (topEl) topEl.innerHTML = renderCap(playerColor === 'w' ? st.capturedBlack : st.capturedWhite);
    if (botEl) botEl.innerHTML = renderCap(playerColor === 'w' ? st.capturedWhite : st.capturedBlack);
  }

  // ─── ANALYSIS MODE ─────────────────────────────────────────
  function loadAnalysis() {
    state = ChessEngine.parseFEN(ChessEngine.START_FEN);
    historyStates = [ChessEngine.deepClone(state)];
    viewingMove = -1; lastMove = null;
    selectedSq = null; legalMovesCache = [];
    gameMode = 'analysis'; gameId = null; playerColor = 'w';
    isFlipped = false;
    stopClock();
    render();
    if (typeof requestAnalysis === 'function') requestAnalysis();
  }

  function loadFEN(fen) {
    try {
      state = ChessEngine.parseFEN(fen);
      historyStates = [ChessEngine.deepClone(state)];
      viewingMove = -1; lastMove = null;
      selectedSq = null; legalMovesCache = [];
      render();
      if (gameMode === 'analysis' && typeof requestAnalysis === 'function') requestAnalysis();
    } catch (e) { toast('Неверный FEN', 'error'); }
  }

  // Загружает партию по массиву ходов (для анализа из профиля)
  function loadGameMoves(moves) {
    state = ChessEngine.parseFEN(ChessEngine.START_FEN);
    historyStates = [ChessEngine.deepClone(state)];
    viewingMove = -1; lastMove = null;
    selectedSq = null; legalMovesCache = [];
    gameMode = 'analysis';
    isFlipped = false;
    stopClock();

    for (const move of moves) {
      try {
        const san = ChessEngine.toSAN(state, move);
        const newState = ChessEngine.applyMove(state, move);
        if (!newState) break;
        state = newState;
        state.history = [...(state.history || []), { ...move, san, fen: ChessEngine.toFEN(state) }];
        historyStates.push(ChessEngine.deepClone(state));
        lastMove = move;
      } catch(e) { console.warn('loadGameMoves error', e); break; }
    }

    // Встаём на начало для просмотра
    viewingMove = 0;
    render();
    // Анализируем — безопасно, requestAnalysis может быть не определена
    if (typeof requestAnalysis === 'function') requestAnalysis();
  }

  function getFEN() { return ChessEngine.toFEN(state); }

  // ─── KEYBOARD NAVIGATION ──────────────────────────────────
  document.addEventListener('keydown', (e) => {
    const isGamePage = document.getElementById('page-game')?.classList.contains('active')
      || document.getElementById('page-analysis')?.classList.contains('active');
    if (!isGamePage) return;
    if (e.key === 'ArrowLeft') { gotoPrev(); e.preventDefault(); }
    else if (e.key === 'ArrowRight') { gotoNext(); e.preventDefault(); }
    else if (e.key === 'ArrowUp') { gotoFirst(); e.preventDefault(); }
    else if (e.key === 'ArrowDown') { gotoLast(); e.preventDefault(); }
  });

  // ─── PUBLIC API ────────────────────────────────────────────
  return {
    render,
    handleClick,
    handleDragStart,
    handleDragEnd,
    handleDrop,
    gotoMove,
    gotoFirst, gotoPrev, gotoNext, gotoLast,
    startGame,
    newLocalGame,
    loadAnalysis,
    loadFEN,
    loadGameMoves,
    getFEN,
    flipBoard,
    resign,
    offerDraw,
    applyOpponentMove,
    resyncFromServer,
    syncClockFromServer,
    clearPremove,
    clearAnnotations,
    onGameEnded,
    initSizeSlider,
    initResizeHandle,
    get gameId()       { return gameId; },
    get tournamentId() { return _tournamentId; },
    get state()        { return state; },
    get playerColor()  { return playerColor; }
  };
})();