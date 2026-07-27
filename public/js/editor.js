// ══════════════════════════════════════════════════════════════
//  Chess Home — Редактор позиции
// ══════════════════════════════════════════════════════════════

const BoardEditor = (() => {
  let board = Array(64).fill(null);
  let selectedPiece = null; // {type, color} | 'eraser' | null
  let editorTurn = 'w';

  // ─── ИНИЦИАЛИЗАЦИЯ ────────────────────────────────────────
  function initFromStart() {
    const st = ChessEngine.parseFEN(ChessEngine.START_FEN);
    board = [...st.board];
    editorTurn = 'w';
    render();
  }

  function initEmpty() {
    board = Array(64).fill(null);
    board[4]  = { type: 'K', color: 'w' };
    board[60] = { type: 'K', color: 'b' };
    render();
  }

  // ─── РЕНДЕР ДОСКИ ─────────────────────────────────────────
  function render() {
    const el = document.getElementById('editor-board');
    if (!el) return;

    // Принудительно выставляем размеры (фикс сплющивания строк)
    el.style.cssText = `
      width: min(480px, calc(100vw - 220px));
      height: min(480px, calc(100vw - 220px));
      display: grid;
      grid-template-columns: repeat(8, 1fr);
      grid-template-rows: repeat(8, 1fr);
      border: 3px solid var(--accent-dark);
      border-radius: 4px;
      overflow: hidden;
    `;

    let html = '';
    for (let r = 7; r >= 0; r--) {
      for (let f = 0; f < 8; f++) {
        const sq = r * 8 + f;
        const light = (r + f) % 2 !== 0;
        const piece = board[sq];

        // Подсветка выбранной клетки (если фигура на ней совпадает с selectedSq)
        const isSelected = selectedSq === sq;

        html += `<div class="square ${light ? 'light' : 'dark'}${isSelected ? ' selected' : ''}"
          data-sq="${sq}"
          style="width:100%;height:100%;position:relative;"
          onclick="BoardEditor.handleEditorClick(${sq})"
          ondragover="event.preventDefault()"
          ondrop="BoardEditor.handleEditorDrop(event, ${sq})">
          ${piece ? `<div class="piece" draggable="true"
            ondragstart="BoardEditor.handleEditorDragStart(event, ${sq})">
            <img src="${PIECE_IMGS[piece.color + piece.type]}" alt="${piece.color}${piece.type}">
          </div>` : ''}
          ${r === 0 ? `<span style="position:absolute;right:2px;bottom:2px;font-size:10px;font-weight:600;font-family:var(--font-mono);color:${light ? 'var(--board-dark)' : 'var(--board-light)'};line-height:1;pointer-events:none">${String.fromCharCode(97 + f)}</span>` : ''}
          ${f === 0 ? `<span style="position:absolute;left:2px;top:2px;font-size:10px;font-weight:600;font-family:var(--font-mono);color:${light ? 'var(--board-dark)' : 'var(--board-light)'};line-height:1;pointer-events:none">${r + 1}</span>` : ''}
        </div>`;
      }
    }
    el.innerHTML = html;
    updateFENInput();
  }

  // ─── КЛИК ПО КЛЕТКЕ ────────────────────────────────────────
  // Логика:
  // 1. Ластик выбран → стираем фигуру
  // 2. Фигура из палитры выбрана → ставим её
  // 3. Ничего не выбрано, кликнули на фигуру → "берём" её (selectedSq)
  // 4. Уже держим фигуру с доски, кликнули на другую клетку → перемещаем
  // 5. Кликнули на ту же клетку → отменяем выбор

  let selectedSq = null; // индекс клетки с "взятой" фигурой с доски

  function handleEditorClick(sq) {
    // Ластик
    if (selectedPiece === 'eraser') {
      board[sq] = null;
      render();
      return;
    }

    // Фигура из палитры выбрана — ставим
    if (selectedPiece && typeof selectedPiece === 'object') {
      board[sq] = { ...selectedPiece };
      render();
      return;
    }

    // Ничего из палитры не выбрано — работаем с фигурами на доске
    if (selectedSq === null) {
      // Берём фигуру с доски
      if (board[sq]) {
        selectedSq = sq;
        render();
      }
      return;
    }

    // Уже держим фигуру
    if (selectedSq === sq) {
      // Клик на ту же клетку — отменяем
      selectedSq = null;
      render();
      return;
    }

    // Перемещаем фигуру
    board[sq] = board[selectedSq];
    board[selectedSq] = null;
    selectedSq = null;
    render();
  }

  // ─── DRAG & DROP ──────────────────────────────────────────
  let dragFrom = null;

  function handleEditorDragStart(e, sq) {
    dragFrom = sq;
    selectedSq = null;
    e.dataTransfer.setData('text/plain', sq);
  }

  function handleEditorDrop(e, sq) {
    e.preventDefault();
    if (dragFrom === null) return;
    if (dragFrom !== sq) {
      board[sq] = board[dragFrom];
      board[dragFrom] = null;
    }
    dragFrom = null;
    render();
  }

  // ─── ПАЛИТРА ──────────────────────────────────────────────
  function selectPalettePiece(type, color) {
    selectedPiece = { type, color };
    selectedSq = null; // снимаем выбор с доски
    document.querySelectorAll('.palette-piece, .eraser-btn').forEach(b => b.classList.remove('selected'));
    document.querySelector(`[data-piece-key="${color}${type}"]`)?.classList.add('selected');
  }

  function selectEraser() {
    selectedPiece = 'eraser';
    selectedSq = null;
    document.querySelectorAll('.palette-piece').forEach(b => b.classList.remove('selected'));
    document.querySelector('.eraser-btn')?.classList.add('selected');
  }

  function deselectAll() {
    selectedPiece = null;
    selectedSq = null;
    document.querySelectorAll('.palette-piece, .eraser-btn').forEach(b => b.classList.remove('selected'));
  }

  // ─── FEN ──────────────────────────────────────────────────
  function updateFENInput() {
    const state = boardToState();
    const fen = ChessEngine.toFEN(state);
    const input = document.getElementById('editor-fen');
    if (input) input.value = fen;
  }

  function boardToState() {
    return {
      board: [...board],
      turn: editorTurn,
      castling: { K: true, Q: true, k: true, q: true },
      enPassant: null,
      halfmove: 0,
      fullmove: 1,
      history: [],
      capturedWhite: [],
      capturedBlack: []
    };
  }

  function loadFromFEN() {
    const input = document.getElementById('editor-fen');
    if (!input) return;
    try {
      const state = ChessEngine.parseFEN(input.value.trim());
      board = [...state.board];
      editorTurn = state.turn;
      deselectAll();
      render();
      toast('Позиция загружена', 'success');
    } catch { toast('Неверный FEN', 'error'); }
  }

  // ─── АНАЛИЗ ───────────────────────────────────────────────
  // ФИКС: передаём FEN текущей позиции редактора, а не начальную
  function analyzePosition() {
    const state = boardToState();
    const fen = ChessEngine.toFEN(state);

    // Сначала загружаем FEN в chessBoard
    chessBoard.loadFEN(fen);

    // Переключаем страницу
    showPage('analysis');

    // Запускаем анализ движком с нужным FEN
    if (!StockfishAnalyzer.isReady()) StockfishAnalyzer.init();
    setTimeout(() => {
      StockfishAnalyzer.analyze(fen, 20);
    }, 300);

    toast('Анализ позиции запущен!', 'success');
  }

  // ─── ПРОЧЕЕ ───────────────────────────────────────────────
  function setTurn(color) {
    editorTurn = color;
    updateFENInput();
    document.querySelectorAll('.turn-btn').forEach(b =>
      b.classList.toggle('selected', b.dataset.turn === color)
    );
  }

  function clearBoard() {
    board = Array(64).fill(null);
    deselectAll();
    render();
  }

  // ─── PUBLIC API ────────────────────────────────────────────
  return {
    initFromStart,
    initEmpty,
    render,
    handleEditorClick,
    handleEditorDragStart,
    handleEditorDrop,
    selectPalettePiece,
    selectEraser,
    loadFromFEN,
    analyzePosition,
    setTurn,
    clearBoard
  };
})();

// ─── СТРАНИЦА РЕДАКТОРА ────────────────────────────────────────
pages['editor'] = () => {
  // Строим палитру здесь — к этому моменту PIECE_IMGS точно загружен
  const TYPES = ['K', 'Q', 'R', 'B', 'N', 'P'];
  ['w', 'b'].forEach(color => {
    const containerId = color === 'w' ? 'palette-white' : 'palette-black';
    const el = document.getElementById(containerId);
    if (!el) return;
    // Перестраиваем каждый раз чтобы src были актуальными
    el.innerHTML = TYPES.map(t => `
      <div class="palette-piece" data-piece-key="${color}${t}" title="${t}"
        onclick="BoardEditor.selectPalettePiece('${t}','${color}')">
        <img src="${PIECE_IMGS[color + t]}" alt="${t}">
      </div>
    `).join('');
  });

  BoardEditor.initFromStart();
};