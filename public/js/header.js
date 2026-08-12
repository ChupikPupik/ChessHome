/**
 * Chess Home — Universal Header
 * <script src="/js/header.js"></script>  ← один раз в каждый HTML
 *
 * window.CH API (совместим с app.js):
 *   CH.initHeader()  CH.setCurrentUser(user)  CH.setActivePage(id)
 *   CH.setOnlineCount(n)  CH.setUnreadCount(n)
 *   CH.openMobileNav()  CH.closeMobileNav()
 *   CH.openAuthModal(mode)  CH.logout()
 *   CH.fetchOnlineCount()  CH.fetchUnreadCount()
 */
(function () {
  'use strict';

  const ADMINS = ['chesshome', 'marina64'];

  // ─── МЕНЮ ─────────────────────────────────────────────────────────────────
  const NAV = [
    {
      label: 'Игра',
      items: [
        { id: 'lobby',       label: 'Играть',   icon: '⚔️',  href: '/lobby' },
        { id: 'tournaments', label: 'Турниры',  icon: '🏆',  href: '/tournaments', spa: false },
      ]
    },
    {
      label: 'Задачи',
      items: [
        { id: 'puzzles', label: 'Задачи',        icon: '🧩', href: '/puzzles' },
        { id: 'storm',   label: 'Puzzle Storm',  icon: '⚡', href: '/storm', spa: false },
      ]
    },
    {
      label: 'Сообщество',
      items: [
        { id: 'clubs', label: 'Клубы',   icon: '🛡️', href: '/clubs', spa: false },
        { id: 'blog',  label: 'Блоги',   icon: '📰', href: '/blog', spa: false },
        { id: 'news',  label: 'Новости', icon: '📢', href: '/news', spa: false },
        { id: 'forum', label: 'Форумы',  icon: '💬', href: '/forum', spa: false },
      ]
    },
    {
      label: 'Инструменты',
      items: [
        { id: 'analysis', label: 'Анализ',   icon: '🔍', href: '/analysis' },
        { id: 'editor',   label: 'Редактор', icon: '✏️', href: '/editor' },
      ]
    },
    {
      label: 'Другое',
      items: [
        { id: 'stats',     label: 'Статистика сайта', icon: '📊', href: '/stats', spa: false },
        { id: 'age',       label: 'Возраст сайта',    icon: '🎂', href: '/age', spa: false },
        { id: 'dev-diary', label: 'Дневник разработки', icon: '📔', href: '/dev-diary', spa: false },
        { id: 'report',    label: 'Репорт',             icon: '🚩', href: '/report', spa: false}
      ]
    },
  ];

  // Отдельная ссылка "Поддержать проект" — идёт ПОСЛЕ разделов меню,
  // не является дропдауном (как DONATE у lichess.org)
  const SUPPORT_LINK = {
    label: 'Поддержать проект',
    icon: '❤',
    href: 'https://pay.cloudtips.ru/p/b0c3a0aa',
  };

  const BOTTOM_NAV = [
    { id: 'home',     label: 'Главная', icon: '♚', href: '/' },
    { id: 'lobby',    label: 'Играть',  icon: '⚔️', href: '/lobby' },
    { id: 'puzzles',  label: 'Задачи',  icon: '🧩', href: '/puzzles' },
    { id: 'stats',    label: 'Анализ',    icon: '🔍', href: '/analysis', spa: false },
    { id: 'more',     label: 'Ещё',     icon: '☰',  href: null, action: 'drawer' },
  ];

  // ─── STATE ────────────────────────────────────────────────────────────────
  const _s = {
    currentUser: null,
    activePage: null,
    onlineCount: 0,
    unreadCount: 0,
    unreadPollTimer: null,
    dmSocket: null,
    seenMsgIds: new Set(),
    activeDmPartner: null, // если на /inbox открыт диалог с этим юзером — не считаем непрочитанным
  };

  // ─── ЗВУК НОВОГО СООБЩЕНИЯ ──────────────────────────────────────────────
  // Свой собственный весёлый звук (не "как у Telegram/Facebook") —
  // короткое восходящее трезвучие через Web Audio API, без внешних файлов.
  let _audioCtx = null;
  function _getAudioCtx() {
    if (!_audioCtx) {
      try { _audioCtx = new (window.AudioContext || window.webkitAudioContext)(); }
      catch (e) { _audioCtx = null; }
    }
    return _audioCtx;
  }
  // Разблокируем аудио по первому клику пользователя (обход автоплей-политик браузера)
  function _unlockAudio() {
    const ctx = _getAudioCtx();
    if (ctx && ctx.state === 'suspended') ctx.resume().catch(() => {});
  }
  document.addEventListener('click', _unlockAudio, { once: true });
  document.addEventListener('keydown', _unlockAudio, { once: true });

  function _playNotifSound() {
    const ctx = _getAudioCtx();
    if (!ctx) return;
    if (ctx.state === 'suspended') { ctx.resume().catch(() => {}); }
    const now = ctx.currentTime;
    // Тихий короткий "поп" — как у обычной лички (одна нота, мягкая атака и спад)
    const osc  = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(880, now);
    osc.frequency.exponentialRampToValueAtTime(620, now + 0.09);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.13, now + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.14);
    osc.connect(gain).connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.16);
  }

  // ─── МГНОВЕННОЕ УВЕДОМЛЕНИЕ О НОВОМ СООБЩЕНИИ (через сокет, без ожидания опроса) ─
  // Работает на любой странице сайта, где подключён socket.io-client (window.io).
  // Если io недоступен на странице — тихо откатываемся на опрос fetchUnreadCount().
  function _connectDmSocket() {
    if (_s.dmSocket || !_s.currentUser) return;
    if (typeof window.io !== 'function') return; // на этой странице нет socket.io-client
    try {
      const sock = window.io();
      _s.dmSocket = sock;
      // Токен теперь в HttpOnly-cookie: сервер сам читает JWT из cookie в
      // заголовках handshake и игнорирует то, что мы шлём аргументом — раньше
      // emit вообще не срабатывал, потому что гейтился по localStorage-токену,
      // которого больше нет. Функция уже гарантирует наличие _s.currentUser выше.
      sock.on('connect', () => sock.emit('auth'));
      sock.on('dm_message', msg => {
        if (!msg || !_s.currentUser) return;
        if (msg.to !== _s.currentUser.username) return;   // не входящее мне
        if (msg.from === _s.currentUser.username) return; // моё же сообщение
        if (_s.seenMsgIds.has(msg.id)) return;             // уже обработали (например, на /inbox)
        _s.seenMsgIds.add(msg.id);
        if (_s.activeDmPartner === msg.from) return;        // диалог с ним уже открыт — не считаем непрочитанным
        CH.setUnreadCount(_s.unreadCount + 1);
      });
    } catch (e) {}
  }

  // ─── ХЕЛПЕРЫ ──────────────────────────────────────────────────────────────
  function esc(s) {
    return String(s || '').replace(/[&<>"']/g, c =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  function isAdmin(u) { return u && ADMINS.includes(u.username); }
  function avatarHTML(u) {
    if (u.avatar) return `<img src="${esc(u.avatar)}" alt="">`;
    return esc((u.username || '?')[0].toUpperCase());
  }
  function goPage(id, href) {
    if (window.showPage) window.showPage(id);
    else window.location.href = href;
  }

  // ─── СТИЛИ ────────────────────────────────────────────────────────────────
  function _injectStyles() {
    if (document.getElementById('ch-styles')) return;
    const s = document.createElement('style');
    s.id = 'ch-styles';
    s.textContent = CSS;
    document.head.appendChild(s);
  }

  // ─── СБОРКА NAV ───────────────────────────────────────────────────────────
  function _buildDesktopNav() {
    const sections = NAV.map(sec => {
      const links = sec.items.map(item => {
        const active = _s.activePage === item.id ? ' active' : '';
        return `<a href="${esc(item.href)}" class="${active}"
          onclick="event.preventDefault();(window.showPage&&${item.spa!==false}?showPage('${item.id}'):location.href='${esc(item.href)}')">
          <span class="ch-drop-icon">${item.icon}</span>${esc(item.label)}
        </a>`;
      }).join('');
      return `<li class="ch-sec">
        <span class="ch-sec-btn">${esc(sec.label)}<span class="ch-arr">▾</span></span>
        <div class="ch-drop">${links}</div>
      </li>`;
    }).join('');
    const supportLink = `<li class="ch-sec ch-sec-plain">
      <a href="${esc(SUPPORT_LINK.href)}" class="ch-support-link" target="_blank" rel="noopener">
        <span class="ch-support-icon">${SUPPORT_LINK.icon}</span>${esc(SUPPORT_LINK.label)}
      </a>
    </li>`;
    return sections + supportLink;
  }
  function _buildDrawerLinks() {
    let h = '';
    NAV.forEach((sec, i) => {
      h += `<div class="ch-dr-section">${esc(sec.label)}</div>`;
      sec.items.forEach(item => {
        const active = _s.activePage === item.id ? ' active' : '';
        h += `<a href="${esc(item.href)}" class="ch-dl-item${active}"
          onclick="event.preventDefault();(window.showPage&&${item.spa!==false}?showPage('${item.id}'):location.href='${esc(item.href)}');CH.closeMobileNav()">
          <span class="ch-dl-icon">${item.icon}</span>${esc(item.label)}
        </a>`;
      });
      if (i < NAV.length - 1) h += `<div class="ch-dr-sep"></div>`;
    });
    h += `<div class="ch-dr-sep"></div>
      <a href="${esc(SUPPORT_LINK.href)}" class="ch-dl-item ch-support-link" target="_blank" rel="noopener">
        <span class="ch-dl-icon">${SUPPORT_LINK.icon}</span>${esc(SUPPORT_LINK.label)}
      </a>`;
    h += `<div class="ch-dr-sep"></div>
      <a href="/settings" class="ch-dl-item"
        onclick="event.preventDefault();(window.showPage?showPage('settings'):location.href='/settings');CH.closeMobileNav()">
        <span class="ch-dl-icon">⚙️</span>Настройки
      </a>`;
    return h;
  }

  // ─── CSS ──────────────────────────────────────────────────────────────────
  const CSS = `
    #ch-root *, #ch-root *::before, #ch-root *::after { box-sizing: border-box; }
    #ch-root { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif; }

    /* HEADER */
    #ch-header {
      position: fixed;
      top: 0; left: 0; right: 0;
      z-index: 1000;
      height: 56px;
      display: flex;
      align-items: center;
      padding: 0 0px;
      background: #0e0f13;
      border-bottom: 1px solid rgba(255,255,255,0.07);
    }

    /* LOGO */
    .ch-logo { display: flex; align-items: center; gap: 0px; text-decoration: none; color: #505050; font-size: 16px; font-weight: 800; font-family: Georgia, serif; white-space: nowrap; flex-shrink: 0; margin-right: 24px; transition: opacity 0.13s; } .ch-logo:hover { opacity: 0.75; }.ch-logo-icon {
  width: 96px;
  height: 96px;
  object-fit: contain;
  display: block;
  flex-shrink: 0;
} .ch-logo-text { line-height: 1;   margin-left: -23px;}
    .ch-logo:hover { opacity: 0.75; }

    /* НОВАЯ ССЫЛКА S2 (КВЕСТЫ) */
    .ch-quests-link {
      display: flex;
      align-items: center;
      justify-content: center;
      height: 34px;
      padding: 0 14px;
      margin-right: 20px;
      border-radius: 40px;
      background: rgba(201,168,76,0.12);
      border: 1px solid rgba(201,168,76,0.35);
      color: #ffd966;
      font-weight: 800;
      font-size: 15px;
      letter-spacing: 0.5px;
      text-decoration: none;
      transition: all 0.13s ease;
      white-space: nowrap;
      flex-shrink: 0;
    }
    .ch-quests-link:hover {
      background: rgba(201,168,76,0.22);
      border-color: #c9a84c;
      color: #fff1b5;
      transform: scale(1.02);
    }

    /* DESKTOP NAV */
    #ch-nav {
      display: flex;
      align-items: stretch;
      height: 56px;
      list-style: none;
      margin: 0; padding: 0;
      flex: 1;
      gap: 2px;
    }

    /* NAV SECTION */
    .ch-sec {
      position: relative;
      display: flex;
      align-items: center;
    }
    .ch-sec-btn {
      display: flex;
      align-items: center;
      gap: 5px;
      padding: 0 15px;
      height: 56px;
      color: rgba(210,208,202,0.5);
      font-size: 15px;
      font-weight: 600;
      font-family: inherit;
      white-space: nowrap;
      cursor: default;
      border: none;
      background: none;
      transition: color 0.13s;
      user-select: none;
      letter-spacing: 0.01em;
    }
    .ch-arr {
      font-size: 7px;
      opacity: 0.4;
      transition: transform 0.15s;
    }
    .ch-sec:hover > .ch-sec-btn {
      color: #e8e6e0;
    }
    .ch-sec:hover > .ch-sec-btn .ch-arr {
      transform: rotate(180deg);
    }

    /* ПОДДЕРЖАТЬ ПРОЕКТ — отдельный пункт после разделов меню (как DONATE у lichess) */
    .ch-sec-plain { padding: 0 15px; }
    .ch-support-link {
      display: flex;
      align-items: center;
      gap: 6px;
      height: 56px;
      color: #ff9500;
      font-size: 15px;
      font-weight: 700;
      font-family: inherit;
      text-decoration: none;
      white-space: nowrap;
      letter-spacing: 0.01em;
      transition: color 0.13s, opacity 0.13s;
    }
    .ch-support-link:hover { color: #ffb144; opacity: 0.9; }
    .ch-support-icon { font-size: 15px; }

    /* DROPDOWN */
    .ch-drop {
      position: absolute;
      top: 100%;
      left: 0;
      min-width: 172px;
      padding: 6px;
      background: #141420;
      border: 1px solid rgba(255,255,255,0.08);
      border-radius: 8px;
      opacity: 0;
      visibility: hidden;
      pointer-events: none;
      transform: translateY(6px);
      transition: opacity 0.15s, transform 0.15s, visibility 0s linear 0.15s;
      z-index: 1001;
    }
    /* Мостик — dropdown не закрывается при движении мыши вниз */
    .ch-drop::before {
      content: '';
      position: absolute;
      top: -8px; left: 0; right: 0;
      height: 8px;
    }
    .ch-sec:hover > .ch-drop {
      opacity: 1;
      visibility: visible;
      pointer-events: auto;
      transform: translateY(0);
      transition: opacity 0.15s, transform 0.15s;
    }
    .ch-drop a {
      display: flex;
      align-items: center;
      gap: 9px;
      padding: 9px 12px;
      border-radius: 6px;
      text-decoration: none;
      color: rgba(210,208,202,0.6);
      font-size: 13.5px;
      font-weight: 500;
      white-space: nowrap;
      transition: background 0.11s, color 0.11s;
    }
    .ch-drop a:hover {
      background: rgba(255,255,255,0.05);
      color: #e8e6e0;
    }
    .ch-drop a.active { color: #c9a84c; }
    .ch-drop-icon {
      font-size: 14px;
      width: 18px;
      text-align: center;
      flex-shrink: 0;
    }

    /* HEADER RIGHT */
    #ch-header-right {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-left: auto;
      flex-shrink: 0;
    }

    /* ONLINE */
    #ch-online-badge {
      display: flex;
      align-items: center;
      gap: 5px;
      font-size: 12px;
      color: rgba(210,208,202,0.32);
      cursor: pointer;
      padding: 4px 8px;
      border-radius: 6px;
      transition: color 0.13s;
      white-space: nowrap;
      margin-left: 12px;
    }
    #ch-online-badge:hover { color: rgba(210,208,202,0.6); }
    .ch-dot {
      width: 6px; height: 6px;
      border-radius: 50%;
      background: #3cb371;
      flex-shrink: 0;
    }

    /* AUTH */
    .ch-auth-buttons { display: flex; gap: 7px; align-items: center; }
    .ch-btn-ghost {
      background: none;
      border: 1px solid rgba(255,255,255,0.11);
      border-radius: 7px;
      color: rgba(210,208,202,0.65);
      font-size: 14px; font-weight: 600;
      font-family: inherit;
      padding: 7px 15px;
      cursor: pointer;
      transition: border-color 0.13s, color 0.13s;
    }
    .ch-btn-ghost:hover { border-color: rgba(255,255,255,0.22); color: #e8e6e0; }
    .ch-btn-primary {
      background: #c9a84c;
      border: none; border-radius: 7px;
      color: #0e0f13;
      font-size: 14px; font-weight: 700;
      font-family: inherit;
      padding: 7px 16px;
      cursor: pointer;
      transition: opacity 0.13s;
    }
    .ch-btn-primary:hover { opacity: 0.85; }

    /* USER MENU */
    #ch-user-wrap { position: relative; }
    .ch-user-btn {
      display: flex; align-items: center; gap: 7px;
      background: none;
      border: 1px solid rgba(255,255,255,0.08);
      border-radius: 8px;
      color: #e8e6e0;
      font-size: 14px; font-weight: 600;
      font-family: inherit;
      padding: 6px 12px;
      cursor: pointer;
      transition: border-color 0.13s;
    }
    .ch-user-btn:hover { border-color: rgba(255,255,255,0.18); }
    .ch-ava {
      width: 26px; height: 26px; border-radius: 50%;
      background: #c9a84c;
      display: flex; align-items: center; justify-content: center;
      font-size: 11px; font-weight: 800; color: #0e0f13;
      overflow: hidden; flex-shrink: 0;
    }
    .ch-ava img { width: 100%; height: 100%; object-fit: cover; }
    .ch-rating { font-size: 11px; color: rgba(210,208,202,0.38); font-family: monospace; }
    .ch-admin-badge {
      font-size: 9px; background: rgba(201,168,76,0.12);
      color: #c9a84c; border: 1px solid rgba(201,168,76,0.22);
      border-radius: 3px; padding: 1px 4px;
    }
    .ch-notif-dot { width: 7px; height: 7px; border-radius: 50%; background: #e74c3c; }
    .ch-caret { font-size: 8px; opacity: 0.38; }

    /* НЕПРОЧИТАННЫЕ СООБЩЕНИЯ — золотой счётчик рядом с ником */
    .ch-msg-count {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      min-width: 17px;
      height: 17px;
      margin-left: 6px;
      padding: 0 5px;
      border-radius: 999px;
      background: linear-gradient(135deg, #ffe27a, #c9a84c);
      color: #2a1e00;
      font-size: 10.5px;
      font-weight: 800;
      line-height: 1;
      box-shadow: 0 0 6px rgba(201,168,76,0.65);
      vertical-align: middle;
      animation: chMsgCountPop 0.35s ease;
    }
    @keyframes chMsgCountPop {
      0%   { transform: scale(0.3); opacity: 0; }
      65%  { transform: scale(1.2); opacity: 1; }
      100% { transform: scale(1); }
    }

    /* USER DROPDOWN */
    .ch-udrop {
      position: absolute;
      top: calc(100% + 6px); right: 0;
      min-width: 200px;
      background: #141420;
      border: 1px solid rgba(255,255,255,0.08);
      border-radius: 8px;
      padding: 5px;
      opacity: 0; visibility: hidden;
      transform: translateY(5px);
      transition: opacity 0.14s, transform 0.14s, visibility 0s linear 0.14s;
      pointer-events: none; z-index: 1002;
    }
    .ch-udrop.open {
      opacity: 1; visibility: visible;
      transform: translateY(0); pointer-events: auto;
      transition: opacity 0.14s, transform 0.14s;
    }
    .ch-udrop-head {
      padding: 10px 12px 9px;
      border-bottom: 1px solid rgba(255,255,255,0.06);
      margin-bottom: 4px;
    }
    .ch-udrop-name { font-weight: 700; font-size: 13.5px; margin-bottom: 6px; }
    .ch-udrop-stats { display: flex; gap: 14px; }
    .ch-udrop-stat { font-size: 11px; color: rgba(210,208,202,0.38); text-align: center; }
    .ch-udrop-stat strong { display: block; font-size: 14px; color: #c9a84c; }
    .ch-udrop a, .ch-udrop-logout {
      display: flex; align-items: center; gap: 8px;
      padding: 8px 11px; border-radius: 6px;
      text-decoration: none;
      color: rgba(210,208,202,0.62);
      font-size: 13px; font-weight: 500;
      cursor: pointer;
      transition: background 0.11s, color 0.11s;
      background: none; border: none; width: 100%; text-align: left;
    }
    .ch-udrop a:hover { background: rgba(255,255,255,0.05); color: #e8e6e0; }
    .ch-udrop-logout:hover { background: rgba(231,76,60,0.07); color: #e74c3c; }
    .ch-udrop-sep { height: 1px; background: rgba(255,255,255,0.06); margin: 4px 6px; }
    .ch-di-icon { width: 17px; text-align: center; flex-shrink: 0; font-size: 14px; }
    .ch-di-badge {
      margin-left: auto; background: #e74c3c; color: #fff;
      font-size: 10px; font-weight: 700; border-radius: 10px; padding: 1px 5px;
    }

    /* HAMBURGER */
    #ch-hamburger {
      display: none;
      flex-direction: column; justify-content: center; gap: 5px;
      width: 36px; height: 36px;
      background: none; border: none; cursor: pointer;
      padding: 5px; border-radius: 7px;
      transition: background 0.13s; flex-shrink: 0; margin-left: 6px;
    }
    #ch-hamburger:hover { background: rgba(255,255,255,0.06); }
    #ch-hamburger span {
      display: block; width: 18px; height: 2px;
      background: rgba(210,208,202,0.6); border-radius: 2px;
      transition: transform 0.22s, opacity 0.18s;
    }
    #ch-hamburger.open span:nth-child(1) { transform: translateY(7px) rotate(45deg); }
    #ch-hamburger.open span:nth-child(2) { opacity: 0; }
    #ch-hamburger.open span:nth-child(3) { transform: translateY(-7px) rotate(-45deg); }

    /* OVERLAY */
    #ch-drawer-overlay {
      display: none; position: fixed; inset: 0;
      background: rgba(0,0,0,0.45);
      z-index: 1010; opacity: 0;
      transition: opacity 0.22s;
    }
    #ch-drawer-overlay.visible { opacity: 1; }

    /* DRAWER */
    #ch-drawer {
      position: fixed; top: 0; right: 0;
      width: min(285px, 83vw); height: 100dvh;
      background: #0e0f13;
      border-left: 1px solid rgba(255,255,255,0.07);
      z-index: 1020;
      display: flex; flex-direction: column;
      transform: translateX(110%);
      transition: transform 0.26s cubic-bezier(0.32,0,0.15,1);
    }
    #ch-drawer.open { transform: translateX(0); }
    .ch-dr-head {
      display: flex; align-items: center; justify-content: space-between;
      padding: 16px 16px 13px;
      border-bottom: 1px solid rgba(255,255,255,0.07);
      flex-shrink: 0;
    }
    .ch-dr-logo { display: flex; align-items: center; gap: 8px; font-size: 15px; font-weight: 800; color: #c9a84c; font-family: Georgia, serif; } .ch-dr-logo img { width: 22px; height: 22px; object-fit: contain; display: block; }
    .ch-dr-close {
      background: none; border: none; color: rgba(210,208,202,0.32);
      font-size: 16px; cursor: pointer; padding: 3px 7px; border-radius: 5px;
      transition: color 0.12s, background 0.12s;
    }
    .ch-dr-close:hover { color: #e8e6e0; background: rgba(255,255,255,0.06); }
    .ch-dr-links { flex: 1; overflow-y: auto; padding: 8px 8px; }
    .ch-dr-section {
      font-size: 9.5px; font-weight: 700; text-transform: uppercase;
      letter-spacing: 0.09em; color: rgba(201,168,76,0.48);
      padding: 10px 8px 4px;
    }
    .ch-dl-item {
      display: flex; align-items: center; gap: 10px;
      padding: 10px 10px; border-radius: 7px;
      text-decoration: none;
      color: rgba(210,208,202,0.62);
      font-size: 14px; font-weight: 500;
      transition: background 0.11s, color 0.11s;
      cursor: pointer; background: none; border: none;
      width: 100%; text-align: left;
    }
    .ch-dl-item:hover { background: rgba(255,255,255,0.05); color: #e8e6e0; }
    .ch-dl-item.active { color: #c9a84c; }
    .ch-dl-item.ch-support-link { color: #ff9500; font-weight: 700; }
    .ch-dl-item.ch-support-link:hover { background: rgba(255,149,0,0.12); color: #ffb144; }
    .ch-dl-icon { font-size: 15px; width: 20px; text-align: center; flex-shrink: 0; }
    .ch-dr-sep { height: 1px; background: rgba(255,255,255,0.06); margin: 5px 8px; }
    .ch-dr-foot {
      border-top: 1px solid rgba(255,255,255,0.07);
      padding: 13px 16px; flex-shrink: 0;
    }
    .ch-dr-online {
      display: flex; align-items: center; gap: 6px;
      font-size: 12px; color: rgba(210,208,202,0.32);
    }

    /* BOTTOM NAV */
    #ch-bottom-nav {
      display: none;
      position: fixed; bottom: 0; left: 0; right: 0;
      height: 54px;
      background: #0e0f13;
      border-top: 1px solid rgba(255,255,255,0.07);
      z-index: 100;
      align-items: stretch; justify-content: space-around;
      padding-bottom: env(safe-area-inset-bottom, 0);
    }
    .ch-bn-item {
      display: flex; flex-direction: column;
      align-items: center; justify-content: center; gap: 2px;
      flex: 1; background: none; border: none; cursor: pointer;
      color: rgba(210,208,202,0.32);
      font-size: 9.5px; font-weight: 600;
      padding: 5px 2px; text-decoration: none;
      transition: color 0.12s;
      text-transform: uppercase; letter-spacing: 0.03em;
    }
    .ch-bn-icon { font-size: 18px; line-height: 1; }
    .ch-bn-item.active { color: #c9a84c; }

    /* FLOATING FRIENDS BUTTON (левый нижний угол) */
    #ch-friends-float {
      position: fixed;
      bottom: 20px;
      left: 20px;
      z-index: 1000;
      background: #1e2028;
      border: 1px solid #2e3040;
      border-radius: 40px;
      padding: 8px 16px;
      font-size: 13px;
      font-weight: 600;
      color: #e8e9f0;
      cursor: pointer;
      display: flex;
      align-items: center;
      gap: 6px;
      backdrop-filter: blur(8px);
      box-shadow: 0 2px 12px rgba(0,0,0,0.3);
      transition: background 0.15s, transform 0.1s;
    }
    #ch-friends-float:hover {
      background: #2a2e3a;
    }

    /* АДАПТИВ */
    @media (max-width: 820px) {
      #ch-nav { display: none !important; }
      #ch-hamburger { display: flex !important; }
      #ch-bottom-nav { display: flex !important; }
      body { padding-bottom: 54px; }
      .ch-user-name, .ch-rating, .ch-admin-badge, .ch-caret { display: none !important; }
      .ch-user-btn { padding: 4px 6px; gap: 0; border-color: transparent; }
      #ch-online-badge { font-size: 12px; padding: 3px 6px; margin-left: 4px; }
      #ch-friends-float { display: none; }
      .ch-quests-link { margin-right: 12px; padding: 0 10px; font-size: 13px; }
    }
    @media (max-width: 400px) {
      .ch-logo-text { display: none; }
      #ch-header { padding: 0 10px; }
    }
  `;

  function _buildBottomNav() {
    return BOTTOM_NAV.map(item => {
      const active = _s.activePage === item.id ? ' active' : '';
      if (item.action === 'drawer') {
        return `<button class="ch-bn-item${active}" id="ch-bn-more" onclick="CH.openMobileNav()">
          <span class="ch-bn-icon">${item.icon}</span><span>${esc(item.label)}</span>
        </button>`;
      }
      return `<a href="${esc(item.href)}" class="ch-bn-item${active}" id="ch-bn-${item.id}"
        onclick="event.preventDefault();(window.showPage&&${item.spa!==false}?showPage('${item.id}'):location.href='${esc(item.href)}')">
        <span class="ch-bn-icon">${item.icon}</span><span>${esc(item.label)}</span>
      </a>`;
    }).join('');
  }

  // ─── ФУНКЦИЯ ПОКАЗА ДРУЗЕЙ ОНЛАЙН ─────────────────────────────────────────
  async function showOnlineFriends() {
    if (!_s.currentUser) {
      if (typeof toast === 'function') toast('Войдите, чтобы видеть друзей', 'info');
      else console.log('Необходимо войти');
      return;
    }
    try {
      const res = await fetch('/api/follow/online-friends', {
        credentials: 'same-origin'
      });
      const data = await res.json();
      if (!data.length) {
        if (typeof toast === 'function') toast('Нет друзей онлайн', 'info');
        else console.log('Нет друзей онлайн');
        return;
      }
      let modal = document.getElementById('modal-online-friends');
      if (!modal) {
        modal = document.createElement('div');
        modal.id = 'modal-online-friends';
        modal.className = 'modal-overlay';
        document.body.appendChild(modal);
        modal.addEventListener('click', e => { if (e.target === modal) modal.classList.remove('open'); });
      }
      modal.innerHTML = `
        <div class="modal" style="max-width:320px;text-align:center">
          <button class="modal-close" onclick="document.getElementById('modal-online-friends').classList.remove('open')">✕</button>
          <h2>👥 Друзья онлайн</h2>
          <div id="friends-list" style="max-height:300px;overflow-y:auto"></div>
        </div>`;
      const listDiv = modal.querySelector('#friends-list');
      listDiv.innerHTML = data.map(f => `
        <div style="display:flex;align-items:center;gap:10px;padding:8px;border-bottom:1px solid var(--border);cursor:pointer" onclick="window.location='/profile/${f.username}'">
          <div style="width:32px;height:32px;border-radius:50%;background:var(--accent);display:flex;align-items:center;justify-content:center">${f.username[0].toUpperCase()}</div>
          <div style="flex:1;text-align:left"><b>${f.username}</b><br><span style="font-size:11px">★ ${f.rating}</span></div>
          <div style="width:8px;height:8px;border-radius:50%;background:#2ecc71"></div>
        </div>
      `).join('');
      document.body.appendChild(modal);
      modal.classList.add('open');
    } catch(e) {
      if (typeof toast === 'function') toast('Ошибка загрузки друзей', 'error');
      console.error(e);
    }
  }

  // ─── МОНТИРОВАНИЕ ─────────────────────────────────────────────────────────
  function _mount() {
    _injectStyles();
    document.getElementById('ch-root')?.remove();
    document.getElementById('ch-header-root')?.remove();

    const root = document.createElement('div');
    root.id = 'ch-root';

    // Header
    const header = document.createElement('header');
    header.id = 'ch-header';
    header.innerHTML = `
      <a href="/" class="ch-logo"
        onclick="event.preventDefault();(window.showPage?showPage('home'):location.href='/')">
        <img src="../img/logo/logo.png" alt="" class="ch-logo-icon">
        <span class="ch-logo-text">Chess Home</span>
      </a>
      <ul id="ch-nav">${_buildDesktopNav()}</ul>
      <div id="ch-header-right"></div>
      <button id="ch-hamburger" aria-label="Меню">
        <span></span><span></span><span></span>
      </button>
      <div id="ch-online-badge">
        <div class="ch-dot online-dot"></div>
        <span id="ch-online-count">${_s.onlineCount}</span>&nbsp;онлайн
      </div>
    `;

    // Overlay
    const overlay = document.createElement('div');
    overlay.id = 'ch-drawer-overlay';
    overlay.addEventListener('click', () => CH.closeMobileNav());

    // Drawer
    const drawer = document.createElement('div');
    drawer.id = 'ch-drawer';
    drawer.setAttribute('role', 'dialog');
    drawer.setAttribute('aria-modal', 'true');
    drawer.innerHTML = `
      <div class="ch-dr-head">
        <div class="ch-dr-logo"> <img src="../img/logo/logo.png" alt="ChessHome"> ChessHome </div>
        <button class="ch-dr-close" onclick="CH.closeMobileNav()">✕</button>
      </div>
      <div class="ch-dr-links" id="ch-drawer-links">${_buildDrawerLinks()}</div>
      <div class="ch-dr-foot">
        <div class="ch-dr-online">
          <div class="ch-dot"></div>
          <span id="ch-drawer-online-count">${_s.onlineCount}</span>&nbsp;игроков онлайн
        </div>
        <div id="ch-drawer-user-area" style="margin-top:9px"></div>
      </div>
    `;

    // Свайп-закрытие
    let _sx = 0;
    drawer.addEventListener('touchstart', e => { _sx = e.touches[0].clientX; }, { passive: true });
    drawer.addEventListener('touchend', e => {
      if (e.changedTouches[0].clientX - _sx > 50) CH.closeMobileNav();
    }, { passive: true });

    // Bottom nav
    const bottomNav = document.createElement('nav');
    bottomNav.id = 'ch-bottom-nav';
    bottomNav.innerHTML = _buildBottomNav();

    root.appendChild(header);
    root.appendChild(overlay);
    root.appendChild(drawer);
    root.appendChild(bottomNav);

    // Плавающая кнопка "Друзья онлайн"
    const friendsFloat = document.createElement('div');
    friendsFloat.id = 'ch-friends-float';
    friendsFloat.innerHTML = '👥 Друзья онлайн';
    friendsFloat.addEventListener('click', showOnlineFriends);
    root.appendChild(friendsFloat);

    document.body.insertBefore(root, document.body.firstChild);
    document.body.style.paddingTop = '56px';

    // Events
    document.getElementById('ch-hamburger')
      .addEventListener('click', () => CH.openMobileNav());

    document.addEventListener('click', e => {
      if (!e.target.closest('#ch-user-wrap')) {
        document.getElementById('ch-udrop')?.classList.remove('open');
      }
    });
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape') {
        CH.closeMobileNav();
        document.getElementById('ch-udrop')?.classList.remove('open');
      }
    });
  }

  // ─── HEADER RIGHT ─────────────────────────────────────────────────────────
  function _renderHeaderRight() {
    const el = document.getElementById('ch-header-right');
    if (!el) return;
    const u = _s.currentUser;

    if (!u) {
      el.innerHTML = `<div class="ch-auth-buttons">
        <button class="ch-btn-ghost" onclick="CH.openAuthModal('login')">Войти</button>
        <button class="ch-btn-primary" onclick="CH.openAuthModal('register')">Регистрация</button>
      </div>`;
      const da = document.getElementById('ch-drawer-user-area');
      if (da) da.innerHTML = `<button class="ch-btn-primary" style="width:100%"
        onclick="CH.openAuthModal('login');CH.closeMobileNav()">Войти</button>`;
      return;
    }

    const admin = isAdmin(u);
    el.innerHTML = `
      <div id="ch-user-wrap">
        <button class="ch-user-btn" id="ch-user-btn" aria-haspopup="true" aria-expanded="false">
          <div class="ch-ava">${avatarHTML(u)}</div>
          <span class="ch-user-name">${esc(u.username)}${_s.unreadCount > 0 ? `<span class="ch-msg-count" id="ch-msg-count">${_s.unreadCount > 99 ? '99+' : _s.unreadCount}</span>` : ''}</span>
          <span class="ch-rating">${u.rating || 1200}</span>
          ${admin ? `<span class="ch-admin-badge">ADMIN</span>` : ''}
          <span class="ch-caret">▾</span>
        </button>
        <div class="ch-udrop" id="ch-udrop">
          <div class="ch-udrop-head">
            <div class="ch-udrop-name">${esc(u.username)}</div>
            <div class="ch-udrop-stats">
              <div class="ch-udrop-stat"><strong>${u.rating || 1200}</strong>рейтинг</div>
              <div class="ch-udrop-stat"><strong>${u.wins || 0}</strong>побед</div>
              <div class="ch-udrop-stat"><strong>${u.gamesPlayed || 0}</strong>игр</div>
            </div>
          </div>
          <a href="/profile" onclick="event.preventDefault();window._profileTarget=null;(window.showPage?showPage('profile'):location.href='/profile')">
            <span class="ch-di-icon">👤</span>Мой профиль
          </a>
          <a href="/inbox" onclick="event.preventDefault();location.href='/inbox'">
            <span class="ch-di-icon">✉️</span>Сообщения
            ${_s.unreadCount > 0 ? `<span class="ch-di-badge" id="ch-unread-badge">${_s.unreadCount}</span>` : ''}
          </a>
          <a href="/settings" onclick="event.preventDefault();(window.showPage?showPage('settings'):location.href='/settings')">
            <span class="ch-di-icon">⚙️</span>Настройки
          </a>
          ${admin ? `<a href="/admin" onclick="event.preventDefault();(window.showPage?showPage('admin'):location.href='/admin')">
            <span class="ch-di-icon">🛡️</span>Панель Admin
          </a>` : ''}
          <div class="ch-udrop-sep"></div>
          <button class="ch-udrop-logout" id="ch-logout-btn">
            <span class="ch-di-icon">🚪</span>Выйти
          </button>
        </div>
      </div>`;

    document.getElementById('ch-user-btn').addEventListener('click', e => {
      e.stopPropagation();
      const drop = document.getElementById('ch-udrop');
      const btn  = document.getElementById('ch-user-btn');
      const open = drop.classList.toggle('open');
      btn.setAttribute('aria-expanded', String(open));
    });
    document.getElementById('ch-logout-btn').addEventListener('click', CH.logout);

    const da = document.getElementById('ch-drawer-user-area');
    if (da) da.innerHTML = `<div style="font-size:12.5px;font-weight:600;color:rgba(210,208,202,0.4)">
      ${esc(u.username)} · ${u.rating || 1200}
    </div>`;
  }

  // ─── PUBLIC API ────────────────────────────────────────────────────────────
  const CH = {

    initHeader(options = {}) {
      if (options?.activePage) _s.activePage = options.activePage;
      _mount();
      _renderHeaderRight();
      CH.fetchOnlineCount();

      // Токен теперь в HttpOnly-cookie — восстанавливать юзера через
      // localStorage.getItem('ch_token') больше не работает (там всегда
      // пусто), из-за чего хедер везде показывал "Вход/Регистрация", даже
      // если сессия была валидна. Теперь просто спрашиваем сервер напрямую:
      // /api/me сам прочитает cookie. Если страница уже вызвала
      // CH.setCurrentUser() раньше нас — не дёргаем /api/me лишний раз.
      if (!_s.currentUser) {
        fetch('/api/me', { credentials: 'same-origin' })
          .then(res => res.ok ? res.json() : null)
          .then(user => { if (user) CH.setCurrentUser(user); })
          .catch(() => {});
      } else {
        CH.fetchUnreadCount();
        _connectDmSocket();
        if (!_s.unreadPollTimer) {
          _s.unreadPollTimer = setInterval(CH.fetchUnreadCount, 7000);
        }
      }
      return CH;
    },

    setCurrentUser(user) {
      _s.currentUser = user;
      // ch_user — просто кэш для мгновенной перерисовки хедера между
      // страницами, не источник авторизации (та живёт в HttpOnly-cookie).
      if (user) localStorage.setItem('ch_user', JSON.stringify(user));
      else localStorage.removeItem('ch_user');
      _renderHeaderRight();
      const dl = document.getElementById('ch-drawer-links');
      if (dl) dl.innerHTML = _buildDrawerLinks();
      if (user) {
        CH.fetchUnreadCount();
        _connectDmSocket();
        if (!_s.unreadPollTimer) {
          _s.unreadPollTimer = setInterval(CH.fetchUnreadCount, 7000);
        }
      } else if (_s.unreadPollTimer) {
        clearInterval(_s.unreadPollTimer);
        _s.unreadPollTimer = null;
      }
    },

    // Вызывается со страницы /inbox: сообщает хедеру, какой диалог сейчас открыт,
    // чтобы не пиликать и не накручивать счётчик по уже открытому собеседнику
    setActiveDmPartner(partner) {
      _s.activeDmPartner = partner || null;
    },

    setActivePage(pageId) {
      _s.activePage = pageId;
      document.querySelectorAll('#ch-nav .ch-drop a').forEach(a => {
        const href = a.getAttribute('href');
        a.classList.toggle('active', href === '/' + pageId);
      });
      document.querySelectorAll('#ch-drawer-links .ch-dl-item').forEach(a => {
        const href = a.getAttribute('href');
        a.classList.toggle('active', href === '/' + pageId);
      });
      document.querySelectorAll('#ch-bottom-nav .ch-bn-item').forEach(btn => {
        btn.classList.toggle('active', btn.id === 'ch-bn-' + pageId);
      });
    },

    setOnlineCount(n) {
      _s.onlineCount = n;
      const a = document.getElementById('ch-online-count');
      const b = document.getElementById('ch-drawer-online-count');
      if (a) a.textContent = n;
      if (b) b.textContent = n;
      const leg = document.getElementById('online-count');
      if (leg && !leg.closest('#ch-root')) leg.textContent = n;
    },

    setUnreadCount(n) {
      const prev = _s.unreadCount;
      _s.unreadCount = n;

      // Золотой счётчик рядом с ником
      const nameEl = document.querySelector('#ch-user-btn .ch-user-name');
      if (nameEl) {
        let countEl = document.getElementById('ch-msg-count');
        if (n > 0) {
          if (!countEl) {
            countEl = document.createElement('span');
            countEl.id = 'ch-msg-count';
            countEl.className = 'ch-msg-count';
            nameEl.appendChild(countEl);
          }
          countEl.textContent = n > 99 ? '99+' : n;
        } else if (countEl) {
          countEl.remove();
        }
      }

      // Счётчик в выпадающем меню рядом с "Сообщения"
      const link = document.querySelector('#ch-udrop a[href="/inbox"]');
      if (link) {
        let badge = document.getElementById('ch-unread-badge');
        if (n > 0) {
          if (!badge) {
            badge = document.createElement('span');
            badge.id = 'ch-unread-badge';
            badge.className = 'ch-di-badge';
            link.appendChild(badge);
          }
          badge.textContent = n > 99 ? '99+' : n;
        } else if (badge) {
          badge.remove();
        }
      }

      // Если непрочитанных стало больше — проигрываем звук нового сообщения
      if (n > prev) _playNotifSound();
    },

    playNotifSound() { _playNotifSound(); },

    async fetchOnlineCount() {
      try {
        const r = await fetch('/api/online');
        if (r.ok) { const d = await r.json(); CH.setOnlineCount(d.count ?? d.online ?? 0); }
      } catch (e) {}
    },

    async fetchUnreadCount() {
      if (!_s.currentUser) return;
      try {
        // Считаем сумму непрочитанных по всем диалогам через уже существующий эндпоинт
        const r = await fetch('/api/dm/conversations', {
          credentials: 'same-origin'
        });
        if (r.ok) {
          const d = await r.json();
          const total = Array.isArray(d) ? d.reduce((sum, c) => sum + (c.unread || 0), 0) : 0;
          CH.setUnreadCount(total);
        }
      } catch (e) {}
    },

    openMobileNav() {
      const drawer  = document.getElementById('ch-drawer');
      const overlay = document.getElementById('ch-drawer-overlay');
      const burger  = document.getElementById('ch-hamburger');
      if (!drawer || !overlay) return;
      overlay.style.display = 'block';
      requestAnimationFrame(() => {
        overlay.classList.add('visible');
        drawer.classList.add('open');
        if (burger) burger.classList.add('open');
      });
      document.body.style.overflow = 'hidden';
    },

    closeMobileNav() {
      const drawer  = document.getElementById('ch-drawer');
      const overlay = document.getElementById('ch-drawer-overlay');
      const burger  = document.getElementById('ch-hamburger');
      if (!drawer || !overlay) return;
      drawer.classList.remove('open');
      overlay.classList.remove('visible');
      if (burger) burger.classList.remove('open');
      document.body.style.overflow = '';
      setTimeout(() => {
        if (!overlay.classList.contains('visible')) overlay.style.display = 'none';
      }, 280);
    },

    openAuthModal(mode = 'login') {
      if (typeof window.openModal === 'function') openModal('modal-' + mode);
      else if (typeof window.showPage === 'function') showPage('home');
      else window.location = '/#' + mode;
    },

    async logout() {
      // Раньше здесь только чистили localStorage — но токен в HttpOnly-cookie,
      // так что сессия на сервере оставалась активной, и пользователь по факту
      // не выходил из аккаунта. Теперь явно просим сервер очистить cookie.
      try { await fetch('/api/logout', { method: 'POST', credentials: 'same-origin' }); } catch (e) {}
      localStorage.removeItem('ch_user');
      _s.currentUser = null;
      if (_s.unreadPollTimer) { clearInterval(_s.unreadPollTimer); _s.unreadPollTimer = null; }
      _s.unreadCount = 0;
      if (typeof window.onCHLogout === 'function') window.onCHLogout();
      else if (typeof window.logout === 'function' && window.logout !== CH.logout) window.logout();
      else window.location = '/';
    },
  };

  // Алиасы — app.js вызывает эти глобально
  window.toggleMobileNav = () => CH.openMobileNav();
  window.openMobileNav   = () => CH.openMobileNav();
  window.closeMobileNav  = () => CH.closeMobileNav();
  window.CH = CH;

  // Авто-запуск
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => CH.initHeader());
  } else {
    CH.initHeader();
  }

})();