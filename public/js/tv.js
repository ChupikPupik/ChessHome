// ══════════════════════════════════════════════════════════════
//  Chess Home TV — Список всех активных партий на сайте
//  Подключи в HTML: <script src="/js/tv.js"></script>
//  Требует: socket.io, pieces.js, chess-engine.js
// ══════════════════════════════════════════════════════════════

const ChessTV = (() => {

  // ─── СОСТОЯНИЕ ────────────────────────────────────────────────
  let games        = [];       // массив активных партий с сервера
  let boardStates  = {};       // { gameId: ChessState }
  let updateTimer  = null;
  let socket       = null;
  let autoRefresh  = true;
  const REFRESH_MS = 5000;     // обновлять список каждые 5 сек

  // ─── ИНИЦИАЛИЗАЦИЯ ───────────────────────────────────────────
  function init(socketInstance) {
    socket = socketInstance || null;

    renderSkeleton();
    fetchGames();
    startAutoRefresh();

    // Если есть socket — слушаем события в реальном времени
    if (socket) {
      socket.on('tv_update', (data) => {
        games = data;
        renderGameList();
      });
      socket.on('opponent_move', ({ gameId, move }) => {
        // Обновляем доску превью конкретной партии
        if (boardStates[gameId]) {
          try {
            const result = ChessEngine.applyMove(boardStates[gameId], move);
            if (result) { boardStates[gameId] = result.state; renderMiniBoard(gameId); }
          } catch(e) {}
        }
      });
    }
  }

  // ─── ЗАГРУЗКА ДАННЫХ ─────────────────────────────────────────
  async function fetchGames() {
    try {
      const res  = await fetch('/api/tv');
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const data = await res.json();
      games = data;
      renderGameList();
    } catch(e) {
      showError('Не удалось загрузить список партий.');
      console.error('[ChessTV] fetchGames error:', e);
    }
  }

  function startAutoRefresh() {
    stopAutoRefresh();
    if (!autoRefresh) return;
    updateTimer = setInterval(() => { if (autoRefresh) fetchGames(); }, REFRESH_MS);
  }

  function stopAutoRefresh() {
    if (updateTimer) { clearInterval(updateTimer); updateTimer = null; }
  }

  // ─── РЕНДЕР СПИСКА ───────────────────────────────────────────
  function getContainer() {
    return document.getElementById('tv-game-list');
  }

  function renderSkeleton() {
    const c = getContainer();
    if (!c) return;
    c.innerHTML = '';
    for (let i = 0; i < 4; i++) {
      const sk = document.createElement('div');
      sk.className = 'tv-card tv-skeleton';
      sk.innerHTML = `
        <div class="tv-sk-board"></div>
        <div class="tv-sk-info">
          <div class="tv-sk-line" style="width:70%"></div>
          <div class="tv-sk-line" style="width:45%"></div>
          <div class="tv-sk-line" style="width:55%"></div>
        </div>`;
      c.appendChild(sk);
    }
  }

  function renderGameList() {
    const c = getContainer();
    if (!c) return;
    updateCounter();

    if (!games.length) {
      c.innerHTML = `
        <div class="tv-empty">
          <div class="tv-empty-icon">📺</div>
          <div class="tv-empty-title">Нет активных партий</div>
          <div class="tv-empty-sub">Как только кто-то начнёт играть — партия появится здесь.</div>
        </div>`;
      return;
    }

    // Сохраняем уже существующие карточки, чтобы не мигать
    const existing = new Set(Array.from(c.querySelectorAll('[data-game-id]')).map(el => el.dataset.gameId));
    const incoming = new Set(games.map(g => g.id));

    // Удалить завершённые
    existing.forEach(id => {
      if (!incoming.has(id)) {
        const el = c.querySelector('[data-game-id="' + id + '"]');
        if (el) { el.style.opacity = '0'; el.style.transform = 'scale(0.95)'; setTimeout(() => el.remove(), 250); }
      }
    });

    // Добавить/обновить
    games.forEach((game, idx) => {
      let card = c.querySelector('[data-game-id="' + game.id + '"]');
      if (!card) {
        card = createGameCard(game);
        card.style.animationDelay = (idx * 60) + 'ms';
        c.appendChild(card);
      } else {
        updateGameCard(card, game);
      }
    });
  }

  function updateCounter() {
    const el = document.getElementById('tv-active-count');
    if (el) el.textContent = games.length;
  }

  // ─── СОЗДАНИЕ КАРТОЧКИ ────────────────────────────────────────
  function createGameCard(game) {
    const card = document.createElement('div');
    card.className = 'tv-card';
    card.dataset.gameId = game.id;

    // Инициализируем состояние доски
    boardStates[game.id] = ChessEngine.parseFEN(ChessEngine.START_FEN);
    // Применяем сохранённые ходы если есть
    if (game.moves && game.moves.length) {
      try {
        let st = ChessEngine.parseFEN(ChessEngine.START_FEN);
        for (const m of game.moves) {
          const r = ChessEngine.applyMove(st, m);
          if (r) st = r.state; else break;
        }
        boardStates[game.id] = st;
      } catch(e) {}
    }

    // Мини-доска
    const boardWrap = document.createElement('div');
    boardWrap.className = 'tv-board-wrap';
    const boardEl = document.createElement('div');
    boardEl.className = 'tv-mini-board';
    boardEl.id = 'tv-board-' + game.id;
    boardWrap.appendChild(boardEl);

    // Бейдж турнира
    if (game.tournamentId) {
      const badge = document.createElement('div');
      badge.className = 'tv-tournament-badge';
      badge.textContent = '🏆 Турнир';
      boardWrap.appendChild(badge);
    }

    card.appendChild(boardWrap);

    // Инфо-блок
    const info = document.createElement('div');
    info.className = 'tv-card-info';

    // Игроки
    const players = document.createElement('div');
    players.className = 'tv-players';
    players.innerHTML = renderPlayerLine(game.white, game.whiteRating, 'white', game.id) +
      '<div class="tv-vs">vs</div>' +
      renderPlayerLine(game.black, game.blackRating, 'black', game.id);
    info.appendChild(players);

    // Мета
    const meta = document.createElement('div');
    meta.className = 'tv-meta';
    meta.innerHTML =
      '<span class="tv-tc">⏱ ' + escapeHtml(game.timeControl) + '</span>' +
      '<span class="tv-moves" id="tv-moves-' + game.id + '">' + game.moveCount + ' ходов</span>';
    info.appendChild(meta);

    // Кнопка
    const watchBtn = document.createElement('button');
    watchBtn.className = 'btn btn-secondary btn-sm tv-watch-btn';
    watchBtn.addEventListener('click', () => openGame(game.id));
    info.appendChild(watchBtn);

    card.appendChild(info);

    // Рендерим мини-доску после вставки
    requestAnimationFrame(() => renderMiniBoard(game.id));

    return card;
  }

  function updateGameCard(card, game) {
    // Обновляем только счётчик ходов
    const movesEl = document.getElementById('tv-moves-' + game.id);
    if (movesEl) movesEl.textContent = game.moveCount + ' ходов';
  }

  function renderPlayerLine(username, rating, color, gameId) {
    const colorIcon = color === 'white' ? '⬜' : '⬛';
    return '<div class="tv-player">' +
      '<span class="tv-player-color">' + colorIcon + '</span>' +
      '<span class="tv-player-name" onclick="ChessTV.watchGame(\'' + escapeHtml(gameId) + '\')" title="Открыть партию">' +
        escapeHtml(username) +
      '</span>' +
      '<span class="tv-player-rating">' + rating + '</span>' +
    '</div>';
  }

  // ─── МИНИ-ДОСКА ───────────────────────────────────────────────
  function renderMiniBoard(gameId) {
    const el = document.getElementById('tv-board-' + gameId);
    if (!el) return;
    const st = boardStates[gameId];
    if (!st) return;

    const size = el.offsetWidth || 140;
    const sqSize = size / 8;

    let html = '';
    for (let r = 7; r >= 0; r--) {
      for (let f = 0; f < 8; f++) {
        const sq    = r * 8 + f;
        const light = (r + f) % 2 !== 0;
        const piece = st.board[sq];
        const bg    = light ? '#f0d9b5' : '#b58863';
        html += '<div style="background:' + bg + ';width:' + sqSize + 'px;height:' + sqSize + 'px;display:flex;align-items:center;justify-content:center;">';
        if (piece && typeof PIECE_IMGS !== 'undefined') {
          const key = piece.color + piece.type;
          html += '<img src="' + (PIECE_IMGS[key] || '') + '" style="width:' + (sqSize * 0.85) + 'px;height:' + (sqSize * 0.85) + 'px;" draggable="false">';
        }
        html += '</div>';
      }
    }
    el.innerHTML = html;
  }

  function rerenderAllBoards() {
    games.forEach(g => renderMiniBoard(g.id));
  }

  // ─── ОТКРЫТЬ ПАРТИЮ ───────────────────────────────────────────
  function openGame(gameId) {
    window.location.href = '/game/' + gameId;
  }

  // ─── ОШИБКА ───────────────────────────────────────────────────
  function showError(msg) {
    const c = getContainer();
    if (!c) return;
    c.innerHTML = '<div class="tv-empty"><div class="tv-empty-icon">⚠️</div><div class="tv-empty-title">' + escapeHtml(msg) + '</div></div>';
  }

  // ─── УТИЛИТЫ ──────────────────────────────────────────────────
  function escapeHtml(s) {
    return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  // ─── PUBLIC API ───────────────────────────────────────────────
  return {
    init,
    refresh: fetchGames,
    watchGame: openGame,
    pause:  () => { autoRefresh = false; stopAutoRefresh(); },
    resume: () => { autoRefresh = true;  startAutoRefresh(); fetchGames(); },
  };

})();

// ═══════════════════════════════════════════════════════════════
//  CSS — встроенные стили для TV (добавь <link> или оставь здесь)
// ═══════════════════════════════════════════════════════════════
(function injectTVStyles() {
  if (document.getElementById('chess-tv-styles')) return;
  const style = document.createElement('style');
  style.id = 'chess-tv-styles';
  style.textContent = `

/* ── Обёртка секции TV ── */
.tv-section {
  width: 100%;
  max-width: 1200px;
  margin: 0 auto;
  padding: 0 24px 60px;
}

.tv-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 20px;
  flex-wrap: wrap;
  gap: 12px;
}

.tv-title {
  font-family: var(--font-display, 'Cinzel', serif);
  font-size: 26px;
  display: flex;
  align-items: center;
  gap: 10px;
}

.tv-title span { color: var(--accent, #c9a84c); }

.tv-live-badge {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  background: rgba(201,168,76,0.12);
  border: 1px solid var(--accent, #c9a84c);
  border-radius: 20px;
  padding: 3px 10px;
  font-size: 12px;
  font-weight: 700;
  color: var(--accent, #c9a84c);
}

.tv-live-dot {
  width: 6px; height: 6px;
  border-radius: 50%;
  background: var(--accent, #c9a84c);
  animation: tvPulse 1.5s infinite;
}

@keyframes tvPulse {
  0%,100% { opacity:1; transform:scale(1); }
  50%      { opacity:0.4; transform:scale(1.3); }
}

.tv-controls {
  display: flex;
  gap: 8px;
  align-items: center;
}

/* ── Сетка карточек ── */
#tv-game-list {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
  gap: 18px;
}

/* ── Карточка ── */
.tv-card {
  background: var(--bg-card, #1a1a2e);
  border: 1px solid var(--border, #2a2a3e);
  border-radius: 14px;
  overflow: hidden;
  transition: transform 0.2s, box-shadow 0.2s, opacity 0.25s;
  cursor: pointer;
  animation: tvCardIn 0.35s ease both;
}

@keyframes tvCardIn {
  from { opacity:0; transform:translateY(14px); }
  to   { opacity:1; transform:translateY(0); }
}

.tv-card:hover {
  transform: translateY(-3px);
  box-shadow: 0 10px 30px rgba(0,0,0,0.4), 0 0 0 1px var(--accent, #c9a84c);
}

/* ── Мини-доска ── */
.tv-board-wrap {
  position: relative;
  background: #1a1a1a;
  aspect-ratio: 1;
  width: 100%;
}

.tv-mini-board {
  width: 100%;
  height: 100%;
  display: grid;
  grid-template-columns: repeat(8, 1fr);
  grid-template-rows: repeat(8, 1fr);
}

.tv-tournament-badge {
  position: absolute;
  top: 8px; left: 8px;
  background: rgba(0,0,0,0.7);
  color: var(--accent, #c9a84c);
  font-size: 11px;
  font-weight: 700;
  padding: 2px 8px;
  border-radius: 6px;
  border: 1px solid var(--accent, #c9a84c);
}

/* ── Инфо ── */
.tv-card-info {
  padding: 12px 14px;
}

.tv-players {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin-bottom: 8px;
}

.tv-player {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
}

.tv-player-color { font-size: 13px; flex-shrink: 0; }

.tv-player-name {
  flex: 1;
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--text-primary, #fff);
  transition: color 0.15s;
}
.tv-player-name:hover { color: var(--accent, #c9a84c); }

.tv-player-rating {
  color: var(--accent, #c9a84c);
  font-family: var(--font-mono, monospace);
  font-size: 12px;
}

.tv-vs {
  font-size: 11px;
  color: var(--text-muted, #666);
  text-align: center;
  margin: -1px 0;
}

.tv-meta {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 12px;
  color: var(--text-muted, #888);
  margin-bottom: 10px;
}

.tv-tc, .tv-moves { white-space: nowrap; }

.tv-watch-btn {
  width: 100%;
}

/* ── Пусто ── */
.tv-empty {
  grid-column: 1 / -1;
  text-align: center;
  padding: 60px 20px;
  color: var(--text-muted, #666);
}
.tv-empty-icon   { font-size: 48px; margin-bottom: 12px; }
.tv-empty-title  { font-size: 18px; font-weight: 700; margin-bottom: 6px; color: var(--text-secondary, #aaa); }
.tv-empty-sub    { font-size: 14px; }

/* ── Скелетон ── */
.tv-skeleton { pointer-events: none; }
.tv-sk-board {
  aspect-ratio: 1;
  width: 100%;
  background: linear-gradient(90deg, var(--bg-hover,#252540) 25%, var(--border,#2a2a3e) 50%, var(--bg-hover,#252540) 75%);
  background-size: 200% 100%;
  animation: tvShimmer 1.4s infinite;
}
.tv-sk-info  { padding: 12px 14px; display: flex; flex-direction: column; gap: 8px; }
.tv-sk-line  {
  height: 12px;
  border-radius: 6px;
  background: linear-gradient(90deg, var(--bg-hover,#252540) 25%, var(--border,#2a2a3e) 50%, var(--bg-hover,#252540) 75%);
  background-size: 200% 100%;
  animation: tvShimmer 1.4s infinite;
}
@keyframes tvShimmer {
  0%   { background-position: 200% 0; }
  100% { background-position: -200% 0; }
}

/* ── Адаптив ── */
@media (max-width: 600px) {
  #tv-game-list { grid-template-columns: repeat(2, 1fr); gap: 10px; }
  .tv-title { font-size: 20px; }
}
@media (max-width: 360px) {
  #tv-game-list { grid-template-columns: 1fr; }
}

  `;
  document.head.appendChild(style);
})();