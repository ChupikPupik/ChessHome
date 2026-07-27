// ══════════════════════════════════════════════════════════════
//  Chess Home — Чат клуба
//  Подключается на странице клуба. Требует: socket (глобальный),
//  currentUser (глобальный), clubId (глобальная переменная).
// ══════════════════════════════════════════════════════════════

const ClubChat = (() => {
  let _clubId = null;
  let _currentUser = null;
  let _isModerator = false;
  let _messages = []; // локальный кэш (до 40)

  // ─── ИНИЦИАЛИЗАЦИЯ ─────────────────────────────────────────
  async function init(clubId, user, isModerator) {
    _clubId = clubId;
    _currentUser = user;
    _isModerator = isModerator;

    renderContainer();
    await loadMessages();
    subscribeSocket();
  }

  // ─── РЕНДЕР КОНТЕЙНЕРА ─────────────────────────────────────
  function renderContainer() {
    const target = document.getElementById('club-chat-root');
    if (!target) return;

    target.innerHTML = `
      <div class="club-chat-wrap" id="club-chat-wrap">
        <div class="club-chat-header">
          <span class="club-chat-title">💬 Чат клуба</span>
          <button class="club-chat-info-btn" id="club-chat-info-btn" title="Информация о чате">ℹ️</button>
        </div>
        <div class="club-chat-info-banner" id="club-chat-info-banner" style="display:none">
          <span>⚠️ Мнения авторов сообщений могут не совпадать с позицией администрации клуба и сайта Chess Home. Уважайте друг друга и соблюдайте правила.</span>
          <button class="club-chat-info-close" id="club-chat-info-close">✕</button>
        </div>
        <div class="club-chat-messages" id="club-chat-messages"></div>
        <div class="club-chat-input-row" id="club-chat-input-row">
          <input class="club-chat-input" id="club-chat-input" type="text" maxlength="300"
            placeholder="Написать в чат клуба..." autocomplete="off">
          <button class="club-chat-send-btn" id="club-chat-send-btn">➤</button>
        </div>
        <div class="club-chat-banned-notice" id="club-chat-banned-notice" style="display:none">
          🚫 Вы заблокированы в чате этого клуба.
        </div>
      </div>
    `;

    document.getElementById('club-chat-info-btn').onclick = () => {
      const banner = document.getElementById('club-chat-info-banner');
      banner.style.display = banner.style.display === 'none' ? '' : 'none';
    };
    document.getElementById('club-chat-info-close').onclick = () => {
      document.getElementById('club-chat-info-banner').style.display = 'none';
    };

    const input = document.getElementById('club-chat-input');
    const sendBtn = document.getElementById('club-chat-send-btn');
    if (input) {
      input.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); } });
    }
    if (sendBtn) sendBtn.onclick = sendMessage;

    injectStyles();
  }

  // ─── ЗАГРУЗКА СООБЩЕНИЙ ────────────────────────────────────
  async function loadMessages() {
    try {
      const res = await fetch(`/api/clubs/${_clubId}/chat`, {
        headers: { 'Authorization': 'Bearer ' + getToken() }
      });
      if (res.status === 403) {
        // Участник забанен или не состоит в клубе
        const data = await res.json().catch(() => ({}));
        showBannedNotice(data.error);
        return;
      }
      const data = await res.json();
      _messages = data.messages || [];
      if (data.myBan && (data.myBan.permanent || data.myBan.until > Date.now())) {
        showBannedNotice(data.myBan.permanent ? null : data.myBan.until);
      }
      renderMessages();
    } catch(e) { console.warn('[ClubChat] loadMessages error', e); }
  }

  // ─── РЕНДЕР СООБЩЕНИЙ ──────────────────────────────────────
  function renderMessages() {
    const el = document.getElementById('club-chat-messages');
    if (!el) return;
    el.innerHTML = '';
    _messages.forEach(msg => appendMsgEl(msg));
    el.scrollTop = el.scrollHeight;
  }

  function appendMsgEl(msg) {
    const el = document.getElementById('club-chat-messages');
    if (!el) return;

    const div = document.createElement('div');

    if (msg.system) {
      div.className = 'club-chat-msg club-chat-msg--system';
      div.textContent = msg.message;
      el.appendChild(div);
      el.scrollTop = el.scrollHeight;
      return;
    }

    const isMine = _currentUser && msg.username === _currentUser.username;
    div.className = 'club-chat-msg' + (isMine ? ' club-chat-msg--mine' : '');
    div.dataset.msgId = msg.id;
    div.dataset.username = msg.username;

    const roleIcon = msg.role === 'admin' ? '👑 ' : '';
    const time = new Date(msg.timestamp).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });

    div.innerHTML = `
      <div class="club-chat-msg-meta">
        <span class="club-chat-msg-author">${roleIcon}<a href="/profile/${encodeURIComponent(msg.username)}" target="_blank">${escHtml(msg.username)}</a></span>
        <span class="club-chat-msg-time">${time}</span>
        ${(_isModerator && !isMine) ? `<button class="club-chat-mod-btn" data-username="${escHtml(msg.username)}" data-msgid="${msg.id}" title="Действия">⚙</button>` : ''}
      </div>
      <div class="club-chat-msg-text">${escHtml(msg.message)}</div>
    `;

    const modBtn = div.querySelector('.club-chat-mod-btn');
    if (modBtn) {
      modBtn.addEventListener('click', e => { e.stopPropagation(); showModMenu(msg.username, msg.id, modBtn); });
    }

    el.appendChild(div);
    el.scrollTop = el.scrollHeight;
  }

  // ─── ОТПРАВКА СООБЩЕНИЯ ────────────────────────────────────
  async function sendMessage() {
    const input = document.getElementById('club-chat-input');
    if (!input) return;
    const text = input.value.trim();
    if (!text) return;
    input.value = '';

    try {
      const res = await fetch(`/api/clubs/${_clubId}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + getToken() },
        body: JSON.stringify({ message: text })
      });
      const data = await res.json();
      if (!res.ok) {
        if (data.until) {
          showBannedNotice(data.until);
        } else {
          showToast(data.error || 'Ошибка', 'error');
        }
      }
      // Сообщение придёт через Socket.IO (эхо от сервера)
    } catch(e) { showToast('Ошибка отправки', 'error'); }
  }

  // ─── МОДЕРАТОРСКОЕ МЕНЮ ────────────────────────────────────
  function showModMenu(username, msgId, anchor) {
    document.getElementById('club-chat-mod-popup')?.remove();

    const popup = document.createElement('div');
    popup.id = 'club-chat-mod-popup';
    popup.className = 'club-chat-mod-popup';
    popup.innerHTML = `
      <div class="club-chat-mod-popup-title">@${escHtml(username)}</div>
      <button data-action="mute">🔇 Мут 15 минут</button>
      <button data-action="ban">🚫 Бан в чате клуба</button>
      <button data-action="report">🚨 Репорт</button>
    `;

    popup.querySelectorAll('button[data-action]').forEach(btn => {
      btn.addEventListener('click', async () => {
        popup.remove();
        const action = btn.dataset.action;
        if (action === 'mute') await moderateAction('mute', username);
        else if (action === 'ban') {
          if (confirm(`Заблокировать ${username} в чате клуба навсегда?`)) {
            await moderateAction('ban', username);
          }
        } else if (action === 'report') {
          const reason = prompt('Причина репорта (необязательно):') || '';
          await reportMessage(msgId, reason);
        }
      });
    });

    document.body.appendChild(popup);
    const rect = anchor.getBoundingClientRect();
    popup.style.top = (rect.bottom + window.scrollY + 4) + 'px';
    popup.style.left = Math.min(rect.left + window.scrollX, window.innerWidth - 180) + 'px';

    const closeOutside = (e) => {
      if (!popup.contains(e.target)) { popup.remove(); document.removeEventListener('click', closeOutside); }
    };
    setTimeout(() => document.addEventListener('click', closeOutside), 10);
  }

  async function moderateAction(type, username) {
    try {
      const res = await fetch(`/api/clubs/${_clubId}/chat-ban`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + getToken() },
        body: JSON.stringify({ username, type })
      });
      const data = await res.json();
      if (!res.ok) showToast(data.error || 'Ошибка', 'error');
      else showToast(type === 'mute' ? `${username} заглушен на 15 мин` : `${username} заблокирован`, 'success');
    } catch(e) { showToast('Ошибка', 'error'); }
  }

  async function reportMessage(msgId, reason) {
    try {
      await fetch(`/api/clubs/${_clubId}/chat-report`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + getToken() },
        body: JSON.stringify({ msgId, reason })
      });
      showToast('Репорт отправлен администраторам', 'info');
    } catch(e) {}
  }

  // ─── SOCKET.IO ПОДПИСКА ────────────────────────────────────
  function subscribeSocket() {
    if (typeof socket === 'undefined') return;

    socket.emit('join_club_room', _clubId);

    socket.on('club_chat_msg', ({ clubId, msg }) => {
      if (clubId !== _clubId) return;
      _messages.push(msg);
      if (_messages.length > 40) _messages.shift();
      appendMsgEl(msg);
    });

    socket.on('club_chat_user_banned', ({ clubId, username, sysMsg }) => {
      if (clubId !== _clubId) return;
      // Удаляем все сообщения этого пользователя из DOM
      const el = document.getElementById('club-chat-messages');
      if (el) {
        el.querySelectorAll(`.club-chat-msg[data-username="${CSS.escape(username)}"]`).forEach(n => n.remove());
      }
      // Удаляем из кэша
      _messages = _messages.filter(m => (m.username || '').toLowerCase() !== username.toLowerCase());
      // Показываем системное сообщение
      _messages.push(sysMsg);
      if (_messages.length > 40) _messages.shift();
      appendMsgEl(sysMsg);
      // Если забанили текущего пользователя — показываем уведомление
      if (_currentUser && username.toLowerCase() === _currentUser.username.toLowerCase()) {
        showBannedNotice(null);
      }
    });
  }

  // ─── УТИЛИТЫ ───────────────────────────────────────────────
  function showBannedNotice(until) {
    const notice = document.getElementById('club-chat-banned-notice');
    const inputRow = document.getElementById('club-chat-input-row');
    if (notice) {
      if (until && until !== Infinity) {
        const mins = Math.ceil((until - Date.now()) / 60000);
        notice.textContent = `🔇 Вы заглушены на ${mins} мин.`;
      } else {
        notice.textContent = '🚫 Вы заблокированы в чате этого клуба.';
      }
      notice.style.display = '';
    }
    if (inputRow) inputRow.style.display = 'none';
  }

  function escHtml(s) {
    return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  function getToken() {
    try { return localStorage.getItem('ch_token') || ''; } catch { return ''; }
  }

  function showToast(msg, type) {
    if (typeof toast === 'function') { toast(msg, type); return; }
    console.log('[ClubChat]', type, msg);
  }

  // ─── СТИЛИ ─────────────────────────────────────────────────
  function injectStyles() {
    if (document.getElementById('club-chat-styles')) return;
    const style = document.createElement('style');
    style.id = 'club-chat-styles';
    style.textContent = `
      .club-chat-wrap {
        display: flex; flex-direction: column;
        background: var(--bg-card, #1a1a2e);
        border: 1px solid var(--border, #2a2a4a);
        border-radius: 12px;
        overflow: hidden;
        height: 420px;
        font-size: 13px;
      }
      .club-chat-header {
        display: flex; align-items: center; justify-content: space-between;
        padding: 10px 14px;
        background: var(--bg-secondary, #12122a);
        border-bottom: 1px solid var(--border, #2a2a4a);
        font-weight: 700; font-size: 14px; color: var(--accent, #7c9cbf);
        flex-shrink: 0;
      }
      .club-chat-info-btn {
        background: none; border: none; cursor: pointer; font-size: 16px;
        opacity: 0.7; transition: opacity .15s;
        padding: 2px 6px; border-radius: 6px;
      }
      .club-chat-info-btn:hover { opacity: 1; background: rgba(255,255,255,.07); }
      .club-chat-info-banner {
        padding: 8px 14px; font-size: 12px; line-height: 1.5;
        color: var(--text-secondary, #aaa);
        background: rgba(124,156,191,.08);
        border-bottom: 1px solid var(--border, #2a2a4a);
        display: flex; align-items: flex-start; gap: 8px;
        flex-shrink: 0;
      }
      .club-chat-info-close {
        background: none; border: none; cursor: pointer; color: var(--text-secondary, #aaa);
        font-size: 14px; padding: 0 2px; flex-shrink: 0; margin-top: 1px;
      }
      .club-chat-messages {
        flex: 1; overflow-y: auto; padding: 10px 12px;
        display: flex; flex-direction: column; gap: 6px;
        scroll-behavior: smooth;
      }
      .club-chat-messages::-webkit-scrollbar { width: 4px; }
      .club-chat-messages::-webkit-scrollbar-thumb { background: var(--border, #3a3a5a); border-radius: 4px; }
      .club-chat-msg {
        display: flex; flex-direction: column; gap: 2px;
        max-width: 88%; align-self: flex-start;
      }
      .club-chat-msg--mine { align-self: flex-end; }
      .club-chat-msg--system {
        align-self: center; max-width: 100%;
        font-size: 11px; color: var(--text-secondary, #888);
        font-style: italic; background: rgba(255,200,0,.07);
        border-radius: 8px; padding: 4px 10px; text-align: center;
      }
      .club-chat-msg-meta {
        display: flex; align-items: center; gap: 6px; flex-wrap: wrap;
      }
      .club-chat-msg-author a {
        font-weight: 600; color: var(--accent, #7c9cbf);
        text-decoration: none; font-size: 11px;
      }
      .club-chat-msg-author a:hover { text-decoration: underline; }
      .club-chat-msg-time {
        font-size: 10px; color: var(--text-secondary, #666);
      }
      .club-chat-mod-btn {
        background: none; border: none; cursor: pointer; font-size: 12px;
        opacity: 0.5; padding: 0 3px; border-radius: 4px; line-height: 1;
        transition: opacity .15s;
      }
      .club-chat-mod-btn:hover { opacity: 1; background: rgba(255,255,255,.07); }
      .club-chat-msg-text {
        background: var(--bg-secondary, #12122a);
        border-radius: 0 8px 8px 8px;
        padding: 6px 10px;
        color: var(--text, #e0e0e0);
        word-break: break-word; line-height: 1.4;
      }
      .club-chat-msg--mine .club-chat-msg-text {
        background: var(--accent-dark, #2a4a6a);
        border-radius: 8px 0 8px 8px;
      }
      .club-chat-input-row {
        display: flex; gap: 6px; padding: 8px 10px;
        border-top: 1px solid var(--border, #2a2a4a);
        background: var(--bg-secondary, #12122a);
        flex-shrink: 0;
      }
      .club-chat-input {
        flex: 1; background: var(--bg-input, #0f0f1e);
        border: 1px solid var(--border, #3a3a5a);
        border-radius: 8px; padding: 7px 12px;
        color: var(--text, #e0e0e0); font-size: 13px; outline: none;
        transition: border-color .15s;
      }
      .club-chat-input:focus { border-color: var(--accent, #7c9cbf); }
      .club-chat-send-btn {
        background: var(--accent, #4a7a9b); border: none; border-radius: 8px;
        color: #fff; padding: 7px 13px; cursor: pointer; font-size: 15px;
        transition: background .15s;
      }
      .club-chat-send-btn:hover { background: var(--accent-dark, #2a5a7b); }
      .club-chat-banned-notice {
        padding: 10px 14px; color: #e07070; font-size: 13px;
        border-top: 1px solid var(--border, #2a2a4a);
        background: rgba(220,50,50,.07);
        flex-shrink: 0; text-align: center;
      }
      .club-chat-mod-popup {
        position: fixed; z-index: 9999;
        background: var(--bg-card, #1e1e3a);
        border: 1px solid var(--border, #3a3a5a);
        border-radius: 10px; padding: 8px 0;
        box-shadow: 0 8px 32px rgba(0,0,0,.5);
        min-width: 170px;
      }
      .club-chat-mod-popup-title {
        padding: 4px 14px 8px;
        font-size: 12px; color: var(--text-secondary, #888);
        border-bottom: 1px solid var(--border, #2a2a4a); margin-bottom: 4px;
        font-weight: 600;
      }
      .club-chat-mod-popup button {
        display: block; width: 100%;
        background: none; border: none; cursor: pointer;
        text-align: left; padding: 7px 14px;
        color: var(--text, #e0e0e0); font-size: 13px;
        transition: background .1s;
      }
      .club-chat-mod-popup button:hover { background: rgba(255,255,255,.07); }
      @media (max-width: 600px) {
        .club-chat-wrap { height: 320px; }
      }
    `;
    document.head.appendChild(style);
  }

  // ─── PUBLIC API ────────────────────────────────────────────
  return { init };
})();