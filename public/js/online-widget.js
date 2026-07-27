/**
 * online-widget.js
 * Shared online presence widget for all Chess Home pages.
 *
 * What it does:
 *  1. Connects to socket.io with auth token → registers current user as online
 *  2. Listens for `online_count` events and updates #online-count
 *  3. Makes the .online-badge clickable → shows a popup with the online user list
 *
 * Include AFTER socket.io.js:
 *   <script src="/socket.io/socket.io.js"></script>
 *   <script src="/js/online-widget.js"></script>
 *
 * The badge element must exist in the page, e.g.:
 *   <div class="online-badge" id="online-badge-btn" ...>
 *     <div class="online-dot"></div>
 *     <span id="online-count">0</span> онлайн
 *   </div>
 */
(function () {
  'use strict';

  var API = '/api';
  var socket = null;
  var popupEl = null;
  var popupOpen = false;

  // ── helpers ────────────────────────────────────────────────────

  function getToken() {
    return localStorage.getItem('ch_token');
  }

  function escHtml(s) {
    if (!s) return '';
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  function setCount(n) {
    // header.js использует id="ch-online-count" и "ch-drawer-online-count"
    // Поддерживаем оба варианта для совместимости
    ['online-count', 'ch-online-count', 'ch-drawer-online-count'].forEach(function(id) {
      var el = document.getElementById(id);
      if (el) el.textContent = n;
    });
    // Также обновляем через CH API если доступен
    if (window.CH && typeof CH.setOnlineCount === 'function') CH.setOnlineCount(n);
  }

  // ── socket connection ──────────────────────────────────────────

  


  // clicking any online-count element → go to /online page
  function bindCountClicks() {
    ['online-count', 'ch-online-count', 'ch-drawer-online-count'].forEach(function(id) {
      var el = document.getElementById(id);
      if (el && !el._onlinePageBound) {
        el._onlinePageBound = true;
        el.style.cursor = 'pointer';
        el.addEventListener('click', function(e) {
          e.stopPropagation();
          window.location.href = '/online';
        });
      }
    });
  }


  function connectSocket() {
    var token = getToken();
    // io() is provided by socket.io.js; bail if not loaded yet
    if (typeof io !== 'function') return;
    if (socket) return;

    socket = io({ transports: ['websocket', 'polling'] });

    socket.on('connect', function () {
      // Берём токен свежим — он мог появиться после создания сокета (логин)
      var freshToken = getToken();
      if (freshToken) socket.emit('auth', freshToken);
    });

    socket.on('online_count', function (count) {
      setCount(count);
    });

    // НЕ обнуляем socket — socket.io сам переподключится и повторно emit('auth')
  }

  // ── popup UI ───────────────────────────────────────────────────

  function createPopup() {
    var el = document.createElement('div');
    el.id = 'ow-popup';
    el.style.cssText = [
      'position:fixed',
      'z-index:99999',
      'background:var(--bg-secondary,#1e1e2e)',
      'border:1px solid var(--border,rgba(255,255,255,.12))',
      'border-radius:12px',
      'box-shadow:0 8px 32px rgba(0,0,0,.5)',
      'min-width:220px',
      'max-width:280px',
      'max-height:360px',
      'display:flex',
      'flex-direction:column',
      'overflow:hidden',
    ].join(';');
    document.body.appendChild(el);
    return el;
  }

  function positionPopup(badge) {
    if (!popupEl) return;
    var r = badge.getBoundingClientRect();
    var top = r.bottom + 8;
    var left = r.right - 220;
    if (left < 8) left = 8;
    // keep inside viewport vertically
    if (top + 360 > window.innerHeight - 8) top = r.top - 368;
    popupEl.style.top = top + 'px';
    popupEl.style.left = left + 'px';
  }

  function renderPopupLoading() {
    popupEl.innerHTML =
      '<div style="padding:14px 16px;font-size:13px;font-weight:700;color:var(--text-primary,#e8e8f0)">' +
        '🟢 Сейчас онлайн' +
      '</div>' +
      '<div id="ow-list" style="padding:8px 16px 14px;overflow-y:auto;flex:1;font-size:13px;color:var(--text-muted,#888)">' +
        'Загрузка...' +
      '</div>';
  }

  async function loadUserList() {
    var listEl = document.getElementById('ow-list');
    if (!listEl) return;
    try {
      var headers = {};
      var token = getToken();
      if (token) headers['Authorization'] = 'Bearer ' + token;
      var res = await fetch(API + '/online/users', { headers: headers });
      if (!res.ok) throw new Error('err');
      var users = await res.json(); // array of { username, rating, ... }

      if (!Array.isArray(users) || users.length === 0) {
        listEl.innerHTML = '<div style="color:var(--text-muted,#888);padding:4px 0">Никого нет онлайн</div>';
        return;
      }

      // also update counter
      setCount(users.length);

      var html = '';
      users.forEach(function (u) {
        html +=
          '<div style="display:flex;align-items:center;gap:8px;padding:5px 0;cursor:pointer" onclick="window.location=\'/profile/' + escHtml(u.username) + '\'">' +
            '<div style="width:28px;height:28px;border-radius:50%;background:var(--accent,#c9a84c);display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:700;color:#000;flex-shrink:0">' +
              escHtml(u.username[0].toUpperCase()) +
            '</div>' +
            '<div style="flex:1;min-width:0">' +
              '<div style="font-weight:600;color:var(--text-primary,#e8e8f0);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + escHtml(u.username) + '</div>' +
              (u.rating != null ? '<div style="font-size:11px;color:var(--text-muted,#888)">★ ' + u.rating + '</div>' : '') +
            '</div>' +
            '<div style="width:7px;height:7px;border-radius:50%;background:#3ecf8e;flex-shrink:0"></div>' +
          '</div>';
      });
      listEl.innerHTML = html;
    } catch (e) {
      if (listEl) listEl.innerHTML = '<div style="color:var(--text-muted,#888)">Ошибка загрузки</div>';
    }
  }

  function openPopup(badge) {
    if (!popupEl) popupEl = createPopup();
    renderPopupLoading();
    positionPopup(badge);
    popupEl.style.display = 'flex';
    popupOpen = true;
    loadUserList();
  }

  function closePopup() {
    if (popupEl) popupEl.style.display = 'none';
    popupOpen = false;
  }

  // ── badge click handler ────────────────────────────────────────

  function initBadge() {
    // header.js создаёт бейдж с id="ch-online-badge"
    var badge = document.getElementById('ch-online-badge') ||
                document.getElementById('online-badge-btn') ||
                document.querySelector('.online-badge');
    if (!badge) return;
    if (badge._onlinePageBound) return;
    badge._onlinePageBound = true;

    // Убираем старый onclick
    badge.onclick = null;
    badge.style.cursor = 'pointer';
    badge.title = 'Посмотреть кто онлайн';

    badge.addEventListener('click', function (e) {
      e.stopPropagation();
      window.location.href = '/online';
    });

    // Also bind count elements that may now exist
    bindCountClicks();
  }

  // Close popup when clicking outside
  document.addEventListener('click', function (e) {
    if (popupOpen && popupEl && !popupEl.contains(e.target)) {
      closePopup();
    }
  });

  // Close on resize (reposition would be complex)
  window.addEventListener('resize', function () {
    if (popupOpen) closePopup();
  });

  // ── init ───────────────────────────────────────────────────────

  function init() {
    // Connect socket to mark ourselves online
    if (typeof io === 'function') {
      connectSocket();
    } else {
      // socket.io.js not yet loaded — wait
      var attempts = 0;
      var iv = setInterval(function () {
        if (typeof io === 'function') {
          clearInterval(iv);
          connectSocket();
        }
        if (++attempts > 40) clearInterval(iv);
      }, 150);
    }

    // Bind click → /online on any already-existing elements
    bindCountClicks();

    // Бейдж инжектируется header.js позже — ждём появления в DOM
    initBadge();
    if (!document.getElementById('online-badge-btn') && !document.querySelector('.online-badge')) {
      var badgeObserver = new MutationObserver(function () {
        var badge = document.getElementById('ch-online-badge') || document.getElementById('online-badge-btn') || document.querySelector('.online-badge');
        if (badge) {
          badgeObserver.disconnect();
          initBadge();
        }
        // Also re-bind counts whenever DOM changes (header may inject count els)
        bindCountClicks();
      });
      badgeObserver.observe(document.body, { childList: true, subtree: true });
    }

    // Fallback: if socket never fires online_count, poll once via REST
    setTimeout(async function () {
      var anyEl = ['online-count','ch-online-count','ch-drawer-online-count']
        .map(function(id){ return document.getElementById(id); })
        .find(Boolean);
      if (anyEl && anyEl.textContent === '0') {
        try {
          var headers = {};
          var token = getToken();
          if (token) headers['Authorization'] = 'Bearer ' + token;
          var res = await fetch(API + '/online/users', { headers: headers });
          var d = await res.json();
          if (Array.isArray(d)) setCount(d.length);
          else if (d.count != null) setCount(d.count);
        } catch {}
      }
    }, 2000);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();