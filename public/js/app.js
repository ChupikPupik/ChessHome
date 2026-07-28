// ══════════════════════════════════════════════════════════════
//  Chess Home — Главный файл приложения
// ══════════════════════════════════════════════════════════════

const API = '/api';
let socket = null;
let currentUser = null;

// ─── reCAPTCHA ───────────────────────────────────────────────
// Виджеты рендерим сами (explicit) вместо авто-рендера по классу
// .g-recaptcha, потому что на странице их два (логин + регистрация)
// и без явного контроля легко перепутать/потерять widgetId.
//
// ВАЖНО: раньше оба виджета рендерились один раз на DOMContentLoaded,
// пока обе модалки ещё скрыты (display:none через .modal-overlay без
// класса .open). grecaptcha.render() в скрытый контейнер создаёт
// нерабочий/невидимый виджет (iframe с нулевыми размерами) НАВСЕГДА —
// даже когда модалка потом открывается, виджет не «чинится» сам.
// Из-за этого капча логина была невидимой, а после 3 неверных попыток
// пароля (лимит на бэкенде) вход блокировался навсегда с ошибкой
// «Пожалуйста, подтвердите, что вы не робот» без возможности её пройти.
//
// Теперь виджет рендерим только в момент, когда его контейнер
// реально видим на экране (модалка открыта), плюс капча логина
// по умолчанию скрыта и появляется только тогда, когда её
// действительно запросил сервер.
const RECAPTCHA_SITE_KEY = '6LdJZyUtAAAAABNEO9ah9rjVHMgjpBdSZijdPGdj';
let loginRecaptchaWidgetId = null;
let regRecaptchaWidgetId = null;
let needsLoginCaptcha = false; // сервер попросил капчу при входе

function ensureGrecaptchaReady(cb) {
  if (typeof grecaptcha !== 'undefined' && grecaptcha.render) { cb(); return; }
  // api.js ещё не догрузился (async defer) — пробуем ещё раз чуть позже
  setTimeout(() => ensureGrecaptchaReady(cb), 100);
}

// Форма регистрации пересоздаёт свою разметку (шаг ввода email-кода
// и возврат назад через cancelVerify), поэтому #reg-recaptcha может
// оказаться новым DOM-узлом без привязанного виджета — рендерим заново.
// Регистрация требует капчу всегда, поэтому рендерим её сразу же,
// как только модалка регистрации становится видимой.
function renderRegRecaptchaIfNeeded() {
  ensureGrecaptchaReady(() => {
    const regEl = document.getElementById('reg-recaptcha');
    if (regEl && !regEl.hasChildNodes()) {
      regRecaptchaWidgetId = grecaptcha.render(regEl, { sitekey: RECAPTCHA_SITE_KEY });
    }
  });
}

// Капча логина нужна только после нескольких неверных попыток —
// показываем и рендерим её только тогда, когда это реально требуется
// (см. captchaRequired в ответе сервера), а не на каждый вход.
function showLoginCaptcha() {
  needsLoginCaptcha = true;
  const wrap = document.getElementById('login-recaptcha-wrap');
  if (wrap && wrap.style.display === 'none') {
    wrap.style.display = '';
    wrap.classList.add('reveal');
  }
  ensureGrecaptchaReady(() => {
    const loginEl = document.getElementById('login-recaptcha');
    if (loginEl && loginRecaptchaWidgetId === null) {
      loginRecaptchaWidgetId = grecaptcha.render(loginEl, { sitekey: RECAPTCHA_SITE_KEY });
    }
  });
}

function getCaptchaToken(widgetId) {
  if (typeof grecaptcha === 'undefined' || widgetId === null) return '';
  return grecaptcha.getResponse(widgetId) || '';
}

function resetCaptcha(widgetId) {
  if (typeof grecaptcha !== 'undefined' && widgetId !== null) grecaptcha.reset(widgetId);
}

function toggleLoginPasswordVisibility(btn) {
  const input = document.getElementById('login-password');
  if (!input) return;
  const show = input.type === 'password';
  input.type = show ? 'text' : 'password';
  btn.textContent = show ? '🙈' : '👁';
  btn.setAttribute('aria-label', show ? 'Скрыть пароль' : 'Показать пароль');
}
// Токен авторизации и device id больше НЕ хранятся в localStorage —
// они живут только в HttpOnly-cookie на сервере (ch_token, ch_device_id),
// недоступной для чтения из JS. Это защищает от кражи токена через XSS
// и от простого сброса/подмены device id через консоль браузера.
// Браузер сам прикладывает эти cookie к каждому запросу на тот же origin.

const STREAMERS = ['VLAD', 'Solo', 'aaa', 'GGbers'];

// ─── ФИЛЬТР ЧАТА ───────────────────────────────────────────
const BAD_WORDS = [
  // мат / токсик (рус)
  'блять','блядь','бля','пиздец','пизда','пизду','пизды',
  'сука','сучка','хуй','хуе','хер',
  'ебать','ебал','ебан','ебаный','ебло','еблан','ебуч','заеб','выеб',
  'нахуй','нахер','похуй','похер',
  'гандон','долбоеб','долбоёб','далбаеб','далбоеб','далбоёб',
  'дебил','идиот','мразь','тварь','урод','мудак','чмо','чмошник',
  'шлюха','шлюх','шалава','проститутка',
  'соси','сосать','отсоси', 'сраный', 'обосранный', 'пздц', 'жиробас',
  'порн', 'влагалище', 'секс', 'сэкс', 'аутист', 'даун', 'дрочка', 'пидор',

  // мат / токсик (англ)
  'fuck','fucking','bitch','asshole','dick','shit',

  // казино / ставки / скам
  'казино','casino','ставки','ставка','bet','букмекер',
  '1xbet','melbet','parimatch','fonbet',
  'aviator','crash',
  'выигрыш','джекпот','бонус','бонусы','промокод','депозит',
  'фриспины','free spin',
  'прогноз','договорной матч',

  // спам / реклама / ссылки
  'http://','https://','www.',
  't.me','telegram','discord','discord.gg',
  'vk.com','instagram.com','tiktok.com',
  'легкие деньги', 'http','https','www','tme','discordgg'
];

function normalize(text) {
  return text
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[@]/g, 'a')
    .replace(/[0]/g, 'o')
    .replace(/[3]/g, 'e')
    .replace(/[1!]/g, 'i')
    .replace(/9/g, 'я')
    .replace(/6/g, 'б')
    .replace(/4/g, 'ч')
    .replace(/\s+/g, '') 
    .replace(/[^a-zа-я0-9]/gi, '');
}

function containsBadWords(text) {
  const normalized = normalize(text);
  return BAD_WORDS.some(word => normalized.includes(normalize(word)));
}

// ─── ROUTER ───────────────────────────────────────────────────
const pages = {};

function showPage(name) {
  // Если уходим со страницы game во время активной онлайн-игры — показываем реджойн-баннер
  const gamePageActive = document.getElementById('page-game')?.classList.contains('active');
  if (gamePageActive && name !== 'game' && typeof chessBoard !== 'undefined') {
    const gId = chessBoard.gameId;
    const gMode = chessBoard.playerColor; // будет truthy только если игра запущена
    if (gId) {
      // Собираем данные текущей игры чтобы передать в баннер
      const currentGameData = _currentGameData;
      if (currentGameData) {
        currentGameData._rejoinReceivedAt = Date.now();
        showRejoinBanner(currentGameData);
      }
    }
  }

  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-links a').forEach(a => {
    a.classList.toggle('active', a.dataset.page === name);
  });
  const el = document.getElementById('page-' + name);
  if (el) {
    el.classList.add('active');
    if (pages[name]) pages[name]();
    if ((name === 'game' || name === 'analysis') && typeof chessBoard !== 'undefined' && !_loadingGameIntoAnalysis) {
      setTimeout(() => { chessBoard.render(); chessBoard.initSizeSlider(); }, 0);
    }
  }
  history.pushState({}, '', '/' + (name === 'home' ? '' : name));
}

// ─── API ──────────────────────────────────────────────────────
// Сервер иногда может ответить не JSON'ом (HTML-страница от прокси/
// хостинга при 502/503, таймаут и т.п.) — раньше res.json() в таком
// случае падал с "Unexpected token '<', ... is not valid JSON" и
// пользователь видел эту техническую абракадабру вместо понятной ошибки.
async function parseApiResponse(res) {
  const text = await res.text();
  let data;
  try {
    data = text ? JSON.parse(text) : {};
  } catch (e) {
    throw new Error('Сервер временно недоступен. Попробуйте ещё раз через минуту.');
  }
  if (!res.ok) {
    const err = new Error(data.error || 'Ошибка');
    if (data.captchaRequired) err.captchaRequired = true;
    throw err;
  }
  return data;
}

async function apiPost(path, body) {
  const res = await fetch(API + path, {
    method: 'POST',
    credentials: 'same-origin', // отправляет HttpOnly cookie ch_token / ch_device_id
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  return parseApiResponse(res);
}

async function apiGet(path) {
  const res = await fetch(API + path, { credentials: 'same-origin' });
  return parseApiResponse(res);
}

// ─── TOAST ────────────────────────────────────────────────────
function toast(msg, type = 'info') {
  const container = document.getElementById('toast-container');
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.innerHTML = `<span>${{ success: '✓', error: '✗', info: 'ℹ' }[type] || 'ℹ'}</span><span>${msg}</span>`;
  container.appendChild(el);
  setTimeout(() => {
    el.style.opacity = '0'; el.style.transform = 'translateX(30px)'; el.style.transition = '0.3s';
    setTimeout(() => el.remove(), 300);
  }, 3000);
}

// ─── AUTH ──────────────────────────────────────────────────────
function updateAuthUI() {
  // Делегируем в универсальный хедер (header.js / window.CH)
  if (window.CH) {
    // Переопределяем openAuthModal чтобы открывал наши модалки
    CH.openAuthModal = (mode) => openModal('modal-' + mode);
    // Переопределяем logout чтобы использовал нашу функцию
    CH.logout = logout;
    CH.setCurrentUser(currentUser || null);
    return;
  }
  // Фолбек: если CH ещё не загружен — ждём и повторяем
  setTimeout(updateAuthUI, 50);
}

function toggleUserMenu()  { document.getElementById('ch-udrop')?.classList.toggle('open'); }
function closeUserMenu()   { document.getElementById('ch-udrop')?.classList.remove('open'); }

document.addEventListener('click', (e) => { if (!e.target.closest('#ch-user-wrap') && !e.target.closest('.user-menu')) closeUserMenu(); });

async function handleRegister(e) {
  e.preventDefault();
  const username = document.getElementById('reg-username').value.trim();
  const email    = document.getElementById('reg-email').value.trim();
  const password = document.getElementById('reg-password').value;
  const errEl    = document.getElementById('reg-error');
  errEl.textContent = '';

  // Honeypot: передаём скрытое поле (у людей оно всегда пустое)
  const _hp = (document.getElementById('reg-hp') || {}).value || '';

  const captchaToken = getCaptchaToken(regRecaptchaWidgetId);
  if (!captchaToken) {
    errEl.textContent = 'Пожалуйста, подтвердите, что вы не робот.';
    return;
  }

  try {
    await apiPost('/register', { username, email, password, _hp, 'g-recaptcha-response': captchaToken });
    // Регистрация принята — показываем форму ввода кода
    showEmailVerifyStep(username, email);
  } catch (err) {
    errEl.textContent = err.message;
    // Токен reCAPTCHA одноразовый — после любой неудачи просим пройти заново,
    // иначе повторный клик отправит уже использованный токен и снова упадёт.
    resetCaptcha(regRecaptchaWidgetId);
  }
}

function showEmailVerifyStep(username, email) {
  // Прячем основную форму регистрации, показываем форму кода
  const modal = document.getElementById('modal-register');
  const body = modal.querySelector('.modal-body') || modal.querySelector('form') || modal;

  // Сохраняем оригинальный HTML для возврата
  modal._origHTML = modal.innerHTML;

  modal.innerHTML = `
    <div class="modal-header" style="padding:24px 24px 0">
      <h2 style="margin:0;font-size:20px">📧 Подтвердите email</h2>
    </div>
    <div style="padding:24px">
      <p style="color:var(--text-muted);margin:0 0 20px">Мы отправили 6-значный код на <b>${escapeHtml(email)}</b>.<br>Введите его ниже — код действует 15 минут.<br><span style="font-size:12px;color:var(--text-muted)">Не видите письмо? Проверьте папку <b>Спам / Нежелательные</b>.</span></p>
      <input id="verify-code" type="text" inputmode="numeric" maxlength="6" placeholder="_ _ _ _ _ _"
        style="width:100%;font-size:28px;letter-spacing:12px;text-align:center;padding:14px;border:2px solid var(--border);border-radius:8px;background:var(--bg-secondary);color:var(--text);box-sizing:border-box">
      <div id="verify-error" style="color:#e74c3c;margin-top:10px;min-height:20px;font-size:13px"></div>
      <button onclick="handleVerifyEmail()" class="btn btn-primary" style="width:100%;margin-top:16px;padding:12px">Подтвердить</button>
      <button onclick="cancelVerify()" class="btn btn-ghost" style="width:100%;margin-top:8px;font-size:13px">← Назад</button>
    </div>
  `;

  // Авто-фокус и авто-сабмит при 6 цифрах
  setTimeout(() => {
    const inp = document.getElementById('verify-code');
    if (inp) {
      inp.focus();
      inp.addEventListener('input', () => {
        if (inp.value.replace(/\D/g,'').length === 6) handleVerifyEmail();
      });
    }
  }, 100);
}

async function handleVerifyEmail() {
  const codeEl = document.getElementById('verify-code');
  const errEl  = document.getElementById('verify-error');
  if (!codeEl || !errEl) return;
  const code = codeEl.value.replace(/\D/g,'');
  if (code.length !== 6) { errEl.textContent = 'Введите 6-значный код'; return; }
  errEl.textContent = '';

  try {
    const data = await apiPost('/verify-email', { code });
    currentUser = data.user; // сервер уже установил HttpOnly cookie ch_token
    // Восстанавливаем модал и закрываем
    const modal = document.getElementById('modal-register');
    if (modal._origHTML) modal.innerHTML = modal._origHTML;
    closeModal('modal-register');
    updateAuthUI(); connectSocket();
    toast('Добро пожаловать, ' + currentUser.username + '! 👋', 'success');
    showPage('lobby');
  } catch (err) {
    if (errEl) errEl.textContent = err.message;
  }
}

function cancelVerify() {
  const modal = document.getElementById('modal-register');
  if (modal._origHTML) {
    modal.innerHTML = modal._origHTML;
    // Переподключаем обработчики после восстановления HTML
    const form = modal.querySelector('form');
    if (form) form.addEventListener('submit', handleRegister);
    // #reg-recaptcha — новый DOM-узел, старый widgetId к нему не привязан
    regRecaptchaWidgetId = null;
    renderRegRecaptchaIfNeeded();
  }
}


function setLoginSubmitLoading(loading) {
  const btn = document.getElementById('login-submit-btn');
  if (!btn) return;
  btn.disabled = loading;
  btn.classList.toggle('loading', loading);
}

async function handleLogin(e) {
  e.preventDefault();
  const username = document.getElementById('login-username').value.trim();
  const password = document.getElementById('login-password').value;
  const errEl    = document.getElementById('login-error');
  errEl.textContent = '';

  // Капча на бэке требуется только после нескольких неудачных попыток
  // подряд для этого аккаунта. Пока needsLoginCaptcha не выставлен —
  // отправляем без токена, сервер сам решит, нужен ли он. Если он уже
  // один раз потребовал капчу в этой сессии, проверяем токен ДО запроса,
  // чтобы не гонять пустые попытки на сервер.
  if (needsLoginCaptcha && !getCaptchaToken(loginRecaptchaWidgetId)) {
    errEl.textContent = 'Пожалуйста, подтвердите, что вы не робот.';
    return;
  }

  const captchaToken = getCaptchaToken(loginRecaptchaWidgetId);
  setLoginSubmitLoading(true);

  try {
    const data = await apiPost('/login', { username, password, 'g-recaptcha-response': captchaToken });
    currentUser = data.user; // сервер уже установил HttpOnly cookie ch_token
    needsLoginCaptcha = false;
    closeModal('modal-login');
    updateAuthUI(); connectSocket();
    toast('С возвращением, ' + username + '! ♟️', 'success');
    showPage('lobby');
  } catch (err) {
    errEl.textContent = err.message;
    // Сервер явно сообщил, что капча теперь обязательна — показываем
    // виджет (рендерим, если ещё не отрендерен) вместо того, чтобы
    // молча повторять попытки с пустым токеном.
    if (err.captchaRequired) showLoginCaptcha();
    // Токен одноразовый — сбрасываем виджет, чтобы следующая попытка
    // не отправила уже "протухший" токен и не зациклилась на той же ошибке.
    resetCaptcha(loginRecaptchaWidgetId);
  } finally {
    setLoginSubmitLoading(false);
  }
}

async function logout() {
  try { await apiPost('/logout', {}); } catch {}
  currentUser = null;
  if (socket) socket.disconnect();
  updateAuthUI(); showPage('home');
  toast('До свидания! 👋');
}

async function tryAutoLogin() {
  // Токен хранится только в HttpOnly cookie — JS не может её прочитать,
  // поэтому просто спрашиваем сервер, есть ли валидная сессия.
  try {
    currentUser = await apiGet('/me');
    updateAuthUI();
    connectSocket();
  } catch (e) {
    // Нет валидной cookie-сессии — пользователь просто не залогинен
  }
}

async function refreshCurrentUser() {
  if (!currentUser) return;
  try {
    const updated = await apiGet('/users/' + currentUser.username);
    currentUser = { ...currentUser, ...updated };
    updateAuthUI();
  } catch {}
}

// ─── SOCKET ───────────────────────────────────────────────────
function connectSocket() {
  if (!currentUser) return;
  socket = io();
  socket.on('connect', () => socket.emit('auth')); // токен сервер берёт из HttpOnly cookie в handshake
  socket.on('auth_ok', () => {});
  socket.on('online_count', count => {
  const el = document.getElementById('online-count');
  if (el) el.textContent = count;
});
  socket.on('challenges_update', challenges => renderChallengeList(challenges));
  socket.on('game_start', data => {
    if (data.moves && data.moves.length > 0) {
      // Реджойн после перезагрузки — предлагаем вернуться
      showRejoinBanner(data);
    } else if (data.tournamentId) {
      // Турнирная партия — сразу запускаем игру
      document.getElementById('pending-t-banner')?.remove();
      _pendingTournamentGame = null;
      toast(`⚔️ Турнирная партия! Вы ${data.color === 'white' ? 'белые ♙' : 'чёрные ♟'}`, 'success');
      startGameUI(data);
      // После старта — показываем кнопку возврата в турнир
      setTimeout(() => showTournamentReturnBanner(data.tournamentId, data.tournamentName), 300);
    } else {
      // Обычная игра — сразу
      toast(`Игра! Вы ${data.color === 'white' ? 'белые ♙' : 'чёрные ♟'}`, 'success');
      startGameUI(data);
    }
  });
  socket.on('opponent_move', (data) => chessBoard.applyOpponentMove(data.move, data.whiteTime, data.blackTime));
  socket.on('move_confirmed', (data) => chessBoard.syncClockFromServer(data.whiteTime, data.blackTime));
  socket.on('incoming_challenge', ({ from, socketId }) => showIncomingChallenge(from, socketId));
  socket.on('challenge_declined', by => toast(by + ' отклонил вызов', 'info'));
  socket.on('game_ended', data => {
    const wasInTournament = _currentGameData && _currentGameData.tournamentId;
    const tId = wasInTournament ? _currentGameData.tournamentId : null;
    const tName = wasInTournament ? _currentGameData.tournamentName : null;
    _currentGameData = null;
    _pendingTournamentGame = null;
    document.getElementById('pending-t-banner')?.remove();
    chessBoard.onGameEnded(data);
    // После турнирной партии — показываем кнопку возврата
    if (tId) {
      setTimeout(() => showTournamentReturnBanner(tId, tName), 800);
    }
  });
  socket.on('draw_offered', ({ from }) => {
    if (confirm(from + ' предлагает ничью. Принять?')) socket.emit('accept_draw', { gameId: chessBoard.gameId });
  });
  socket.on('game_chat', ({ from, message }) => appendChatMsg(from, message, false));

  // ── Реджойн: восстанавливаем чат после перезагрузки страницы ──
  socket.on('rejoin_ack', (data) => {
    if (data.chatMessages && data.chatMessages.length > 0) {
      // Восстанавливаем чат — board.js уже умеет это делать
      const el = document.getElementById('chat-messages');
      if (el) {
        el.innerHTML = '';
        el._restoringChat = true;
        data.chatMessages.forEach(m => {
          const isMine = m.from === currentUser?.username;
          appendChatMsg(m.from, m.message, isMine);
        });
        el._restoringChat = false;
      }
    }
  });

  socket.on('global_chat', msg => appendGlobalChatMsg(msg));
  socket.on('chat_msg_deleted', (msgId) => {
    const el = document.getElementById('chatmsg-' + msgId);
    if (el) el.remove();
  });
  socket.on('new_report', ({ report, total }) => {
    // Показываем уведомление только если текущий пользователь — admin
    if (currentUser?.role === 'admin') {
      const reasons = { cheat:'читы', abuse:'оскорбления', disconnect:'дисконнекты', multiaccounting:'мульти-аккаунты', spam:'спам', other:'другое' };
      toast('🚩 Новая жалоба на ' + report.targetUsername + ' (' + (reasons[report.reason]||report.reason) + '). Всего новых: ' + total, 'info');
    }
  });
  socket.on('error', msg => toast(msg, 'error'));
  socket.on('tournament_created', (t) => {
    toast('🎯 Новый турнир: ' + t.name + ' (' + t.timeControl + ')', 'info');
  });
  socket.on('tournament_finished_notify', (t) => {
    toast('🏆 Турнир завершён: ' + t.name + '. Победитель: ' + t.winner, 'success');
  });

  socket.on('anticheat_compensation', (data) => {
    toast(data.message, 'success');
  });

  socket.on('tournament_banned', (data) => {
    toast(data.message, 'error');
    // Если игрок сейчас на странице турнира — перезагружаем её
    if (window.location.pathname.startsWith('/tournament')) {
      setTimeout(() => window.location.reload(), 2000);
    }
  });

  socket.on('anticheat_ban', (data) => {
    // Показываем только если это не про нас (нам уже показали tournament_banned)
    if (data.username !== currentUser?.username) {
      toast(data.message, 'error');
    }
  });

  // ─── ЛС: уведомление на любой странице кроме /inbox ─────────
  socket.on('dm_message', (msg) => {
    if (msg.to !== currentUser?.username) return;
    if (window.location.pathname.startsWith('/inbox')) return;
    showDmNotification(msg.from, msg.text);
  });
}

// ─── МОБИЛЬНОЕ МЕНЮ (делегируем в CH из header.js) ──────────────────────────
function toggleMobileNav() {
  if (window.CH) CH.openMobileNav();
}
function closeMobileNav() {
  if (window.CH) CH.closeMobileNav();
}

function updateMobileNav() {
  const userEl = document.getElementById('mobile-nav-user');
  if (!userEl) return;
  if (currentUser) {
    userEl.innerHTML = `
      <div class="player-avatar" style="width:44px;height:44px;font-size:18px">${currentUser.username[0].toUpperCase()}</div>
      <div>
        <div style="font-weight:700;font-size:16px">${escapeHtml(currentUser.username)}</div>
        <div style="font-size:13px;color:var(--accent)">★ ${currentUser.rating}</div>
      </div>`;
    document.getElementById('mobile-profile-link').style.display = '';
    document.getElementById('mobile-settings-link').style.display = '';
    document.getElementById('mobile-logout-btn').style.display = '';
    document.getElementById('mobile-login-btn').style.display = 'none';
    document.getElementById('mobile-register-btn').style.display = 'none';
    if (currentUser.role === 'admin') {
      document.getElementById('mobile-admin-link').style.display = '';
    }
  } else {
    userEl.innerHTML = '<div style="color:var(--text-muted);font-size:14px">Вы не авторизованы</div>';
    document.getElementById('mobile-profile-link').style.display = 'none';
    document.getElementById('mobile-settings-link').style.display = 'none';
    document.getElementById('mobile-logout-btn').style.display = 'none';
    document.getElementById('mobile-login-btn').style.display = '';
    document.getElementById('mobile-register-btn').style.display = '';
  }
}

function mobileLogout() {
  closeMobileNav();
  apiPost('/logout', {}).catch(() => {}).finally(() => window.location.reload());
}

// Закрывать мобильное меню по Escape и свайпу назад
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeMobileNav(); });

// ─── MODALS ───────────────────────────────────────────────────
function openModal(id)  {
  document.getElementById(id)?.classList.add('open');
  // Рендерим капчу только когда контейнер реально виден — см. пояснение
  // у объявления RECAPTCHA_SITE_KEY выше.
  if (id === 'modal-register') renderRegRecaptchaIfNeeded();
  if (id === 'modal-login' && needsLoginCaptcha) showLoginCaptcha();
}
function closeModal(id) {
  document.getElementById(id)?.classList.remove('open');
  document.querySelectorAll('.form-error').forEach(e => e.textContent = '');
}
document.addEventListener('click', (e) => {
  if (e.target.classList.contains('modal-overlay')) e.target.classList.remove('open');
});

// ─── ONLINE COUNT ─────────────────────────────────────────────
async function fetchOnline() {
  try {
    const d = await apiGet('/online');
    document.getElementById('online-count').textContent = d.count;
    // Если модал открыт — обновляем список
    const modal = document.getElementById('modal-online-users');
    if (modal && modal.style.display !== 'none') {
      renderOnlineUsersList();
    }
  } catch {}
}

// ─── LOBBY ────────────────────────────────────────────────────
let selectedTC = '10+0';
let selectedColor = 'random';
let myCurrentChallengeId = null; // ID своего вызова в зале

pages['lobby'] = async () => {
  if (!currentUser) { toast('Войдите, чтобы зайти в игровой зал', 'info'); showPage('home'); return; }
  await fetchChallenges();
};

async function fetchChallenges() {
  try { renderChallengeList(await apiGet('/challenges')); } catch {}
}

function renderChallengeList(challenges) {
  const list = document.getElementById('challenge-list');
  if (!list) return;
  const countEl = document.getElementById('challenges-count');

  const myChallenge = challenges.find(c => c.from === currentUser?.username);
  myCurrentChallengeId = myChallenge?.id || null;

  if (!challenges.length) {
    if (countEl) countEl.textContent = '';
    list.innerHTML = '<div class="empty-state"><div class="empty-state-icon">🏰</div><p>Нет открытых вызовов.<br>Создайте первый!</p></div>';
    return;
  }

  if (countEl) countEl.textContent = '(' + challenges.length + ')';
  list.innerHTML = '';

  challenges.forEach(c => {
    const isMe = c.from === currentUser?.username;
    const tcColor = c.color === 'random' ? '🎲 случайный' : c.color === 'white' ? '⬜ белые' : '⬛ чёрные';

    const item = document.createElement('div');
    item.className = 'challenge-item' + (isMe ? ' my-challenge' : '');
    if (isMe) item.style.borderColor = 'var(--accent)';

    // Аватар
    const av = document.createElement('div');
    av.className = 'player-avatar';
    av.style.cursor = 'pointer';
    av.textContent = c.from[0].toUpperCase();
    av.addEventListener('click', () => openUserProfile(c.from));
    item.appendChild(av);

    // Инфо
    const info = document.createElement('div');
    info.className = 'challenge-info';
    const nameEl = document.createElement('div');
    nameEl.className = 'challenge-name';
    nameEl.style.cursor = 'pointer';
    nameEl.textContent = c.from;
    if (isMe) {
      const badge = document.createElement('span');
      badge.style.cssText = 'color:var(--accent);font-size:11px;margin-left:6px';
      badge.textContent = '(вы)';
      nameEl.appendChild(badge);
    }
    nameEl.addEventListener('click', () => openUserProfile(c.from));
    const meta = document.createElement('div');
    meta.className = 'challenge-meta';
    meta.textContent = '⏱ ' + c.timeControl + ' · ' + tcColor;
    info.appendChild(nameEl);
    info.appendChild(meta);
    item.appendChild(info);

    // Кнопка
    if (isMe) {
      const btn = document.createElement('button');
      btn.className = 'btn btn-danger btn-sm';
      btn.textContent = '✕ Отменить';
      btn.addEventListener('click', cancelChallenge);
      item.appendChild(btn);
    } else {
      const btn = document.createElement('button');
      btn.className = 'btn btn-primary btn-sm';
      btn.textContent = 'Играть';
      btn.addEventListener('click', () => {
        if (!socket?.connected) { toast('Нет соединения', 'error'); return; }
        socket.emit('accept_challenge', c.id);
      });
      item.appendChild(btn);
    }

    list.appendChild(item);
  });
}

function selectTC(tc) {
  selectedTC = tc;
  document.querySelectorAll('.tc-btn[data-tc]').forEach(b => b.classList.toggle('selected', b.dataset.tc === tc));
}

function selectColor(color) {
  selectedColor = color;
  document.querySelectorAll('.color-btn').forEach(b => b.classList.toggle('selected', b.dataset.color === color));
}

function postChallenge() {
  if (!currentUser) { openModal('modal-login'); return; }
  if (!socket) { toast('Нет соединения. Войдите заново.', 'error'); return; }
  if (!socket.connected) { toast('Нет соединения с сервером', 'error'); return; }
  socket.emit('post_challenge', { timeControl: selectedTC, color: selectedColor });
  toast('Вызов выставлен в зал!', 'success');
}

function cancelChallenge() {
  if (!socket?.connected) return;
  socket.emit('cancel_challenge');
  toast('Вызов отменён', 'info');
}

function acceptChallenge(id) {
  if (!currentUser) { openModal('modal-login'); return; }
  socket.emit('accept_challenge', id);
}

function showIncomingChallenge(from, socketId) {
  const accept = confirm(`${from} вызывает вас! Принять?`);
  if (accept) socket.emit('accept_direct_challenge', socketId);
  else socket.emit('decline_challenge', socketId);
}

// ─── ПОИСК И ПРОФИЛИ ИГРОКОВ ──────────────────────────────────
let searchTimeout = null;

async function searchUsers(q) {
  const resultsEl = document.getElementById('search-results');
  if (!resultsEl) return;
  if (!q || q.length < 1) { resultsEl.style.display = 'none'; return; }
  clearTimeout(searchTimeout);
  searchTimeout = setTimeout(async () => {
    try {
      const results = await apiGet('/users/search?q=' + encodeURIComponent(q));
      if (!results.length) { resultsEl.style.display = 'none'; return; }
      resultsEl.style.display = 'block';
      resultsEl.innerHTML = results.map(u => `
        <div class="search-result-item" onclick="openUserProfile('${u.username}')">
          <div class="result-avatar">${u.username[0].toUpperCase()}</div>
          <div>
            <div class="result-name">${escapeHtml(u.username)} ${u.online ? '<span class="result-online">● онлайн</span>' : ''}</div>
            <div class="result-rating">Рейтинг: ${u.rating}</div>
          </div>
        </div>`).join('');
    } catch {}
  }, 250);
}

// Открыть страницу профиля любого игрока
function openUserProfile(username) {
  // Закрываем поиск
  const resultsEl = document.getElementById('search-results');
  if (resultsEl) resultsEl.style.display = 'none';
  const searchEl = document.getElementById('player-search');
  if (searchEl) searchEl.value = '';

  // Закрываем любые открытые модалы
  document.getElementById('modal-user-profile')?.classList.remove('open');

  // Открываем профиль как страницу (SPA-навигация)
  window._profileTarget = username;
  window.location.href = '/profile/' + encodeURIComponent(username);
}

function showUserProfileModal(user) {
  const isMe     = user.username === currentUser?.username;
  const isOnline = user.online;
  const isAdmin  = currentUser?.role === 'admin';
  const winPct   = user.gamesPlayed > 0 ? Math.round(user.wins / user.gamesPlayed * 100) : 0;

  let modal = document.getElementById('modal-user-profile');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'modal-user-profile';
    modal.className = 'modal-overlay';
    document.body.appendChild(modal);
    modal.addEventListener('click', e => { if (e.target === modal) modal.classList.remove('open'); });
  }

  // Строим через DOM — никаких вложенных шаблонных строк
  modal.innerHTML = '';
  const box = document.createElement('div');
  box.className = 'modal';
  box.style.cssText = 'position:relative;max-width:420px;text-align:center';

  // Закрытие
  const closeBtn = document.createElement('button');
  closeBtn.className = 'modal-close';
  closeBtn.textContent = '✕';
  closeBtn.onclick = () => modal.classList.remove('open');
  box.appendChild(closeBtn);

  // Аватар
  const av = document.createElement('div');
  av.className = 'player-avatar';
  av.style.cssText = 'width:64px;height:64px;font-size:28px;margin:0 auto 12px';
  av.textContent = user.username[0].toUpperCase();
  box.appendChild(av);

  // Имя
  const h2 = document.createElement('h2');
  h2.style.cssText = 'font-family:var(--font-display);font-size:22px;margin-bottom:4px';
  h2.textContent = user.username;
  if (user.role === 'admin') {
    const badge = document.createElement('span');
    badge.style.cssText = 'color:var(--accent);font-size:13px;margin-left:8px';
    badge.textContent = 'ADMIN';
    h2.appendChild(badge);
  }
  box.appendChild(h2);

  // Онлайн + дата
  const meta = document.createElement('div');
  meta.style.cssText = 'color:var(--text-muted);font-size:12px;margin-bottom:12px';
  const onlineSpan = document.createElement('span');
  onlineSpan.style.color = isOnline ? 'var(--green)' : 'var(--text-muted)';
  onlineSpan.textContent = isOnline ? '● онлайн' : '● оффлайн';
  meta.appendChild(onlineSpan);
  meta.appendChild(document.createTextNode(' · На сайте с ' + new Date(user.createdAt).toLocaleDateString('ru')));
  box.appendChild(meta);

  // Рейтинг
  const rating = document.createElement('div');
  rating.style.cssText = 'font-size:28px;color:var(--accent);font-family:var(--font-mono);margin-bottom:16px';
  rating.textContent = '★ ' + user.rating;
  box.appendChild(rating);

  // Статы
  const grid = document.createElement('div');
  grid.style.cssText = 'display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:20px';
  [
    [user.gamesPlayed, 'Партий', ''],
    [user.wins,        'Побед',  'var(--green)'],
    [user.losses,      'Пор.',   'var(--red)'],
    [winPct + '%',     'Винрейт',''],
  ].forEach(([val, label, color]) => {
    const cell = document.createElement('div');
    const num = document.createElement('div');
    num.style.cssText = 'font-size:20px;font-weight:700' + (color ? ';color:' + color : '');
    num.textContent = val;
    const lbl = document.createElement('div');
    lbl.style.cssText = 'color:var(--text-muted);font-size:11px';
    lbl.textContent = label;
    cell.appendChild(num); cell.appendChild(lbl);
    grid.appendChild(cell);
  });
  box.appendChild(grid);

  // Кнопки действий
  if (!isMe) {
    const actions = document.createElement('div');
    actions.style.cssText = 'display:flex;gap:8px;justify-content:center;flex-wrap:wrap';

    // Вызвать на игру
    if (isOnline && currentUser) {
      const challengeBtn = document.createElement('button');
      challengeBtn.className = 'btn btn-primary btn-sm';
      challengeBtn.textContent = '⚔️ Вызвать';
      challengeBtn.addEventListener('click', () => challengeUserFromProfile(user.username));
      actions.appendChild(challengeBtn);
    }

    // Написать личное сообщение
    if (currentUser) {
      const dmBtn = document.createElement('button');
      dmBtn.className = 'btn btn-secondary btn-sm';
      dmBtn.textContent = '✉️ Написать';
      dmBtn.addEventListener('click', () => {
        modal.classList.remove('open');
        window.location = '/inbox/' + encodeURIComponent(user.username);
      });
      actions.appendChild(dmBtn);
    }

    // Пожаловаться (не для admin)
    if (currentUser && !isAdmin) {
      const reportBtn = document.createElement('button');
      reportBtn.className = 'btn btn-ghost btn-sm';
      reportBtn.textContent = '🚩 Репорт';
      reportBtn.addEventListener('click', () => {
        modal.classList.remove('open');
        showReportModal(user.username);
      });
      actions.appendChild(reportBtn);
    }

    // Бан/разбан (только admin)
    if (isAdmin) {
      if (user.banned) {
        const unbanBtn = document.createElement('button');
        unbanBtn.className = 'btn btn-secondary btn-sm';
        unbanBtn.textContent = '✅ Разбан';
        unbanBtn.addEventListener('click', async () => {
          await adminUnban(user.username);
          modal.classList.remove('open');
        });
        actions.appendChild(unbanBtn);
      } else {
        const banBtn = document.createElement('button');
        banBtn.className = 'btn btn-danger btn-sm';
        banBtn.textContent = '🚫 Бан';
        banBtn.addEventListener('click', async () => {
          await adminBan(user.username);
          modal.classList.remove('open');
        });
        actions.appendChild(banBtn);
      }
    }

    box.appendChild(actions);
  } else {
    const self = document.createElement('div');
    self.style.cssText = 'color:var(--text-muted);font-size:13px';
    self.textContent = 'Это вы';
    box.appendChild(self);
  }

  modal.appendChild(box);
  modal.classList.add('open');
}


function challengeUserFromProfile(username) {
  document.getElementById('modal-user-profile')?.classList.remove('open');
  if (!currentUser) { openModal('modal-login'); return; }
  if (!socket?.connected) { toast('Нет соединения', 'error'); return; }
  socket.emit('challenge_user', username);
  toast(`Вызов отправлен ${username}!`, 'success');
}

async function adminBan(username) {
  const reason = prompt(`Причина бана ${username}:`, 'Нарушение правил');
  if (reason === null) return;
  try {
    await apiPost('/admin/ban', { username, reason });
    toast(`${username} заблокирован`, 'success');
    document.getElementById('modal-user-profile')?.classList.remove('open');
  } catch (e) { toast(e.message, 'error'); }
}

async function adminUnban(username) {
  try {
    await apiPost('/admin/unban', { username });
    toast(`${username} разблокирован`, 'success');
    document.getElementById('modal-user-profile')?.classList.remove('open');
  } catch (e) { toast(e.message, 'error'); }
}

// Старая функция challengeUser (для совместимости с лобби)
function challengeUser(username) {
  challengeUserFromProfile(username);
}


if (!sessionStorage.getItem('pageHardReloaded')) {
    sessionStorage.setItem('pageHardReloaded', 'true');

    setTimeout(() => {
        // Создаем уникальный маркер времени (timestamp)
        const cacheBuster = 'nocache=' + new Date().getTime();
        const currentUrl = window.location.href;
        
        // Проверяем, есть ли уже параметры в ссылке, и добавляем маркер
        const newUrl = currentUrl.indexOf('?') !== -1 
            ? currentUrl + '&' + cacheBuster 
            : currentUrl + '?' + cacheBuster;

        // Перенаправляем на "новую" ссылку, очищая кэш
        window.location.replace(newUrl);
    }, 1);
}

// ─── GAME UI ──────────────────────────────────────────────────
let _currentGameData = null; // текущие данные активной онлайн-игры для реджойна

// ── PENDING TOURNAMENT GAME ──────────────────────────────────
let _pendingTournamentGame = null;

function showPendingTournamentBanner(data) {
  document.getElementById('pending-t-banner')?.remove();

  const b = document.createElement('div');
  b.id = 'pending-t-banner';
  Object.assign(b.style, {
    position:'fixed', bottom:'28px', left:'50%', transform:'translateX(-50%)',
    background:'var(--bg-card)', border:'2px solid var(--accent)',
    borderRadius:'16px', padding:'16px 22px',
    display:'flex', alignItems:'center', gap:'16px',
    boxShadow:'0 8px 48px rgba(0,0,0,0.7)', zIndex:'99999',
    minWidth:'320px', maxWidth:'92vw', fontFamily:'var(--font-body)',
    animation:'ptbUp 0.4s cubic-bezier(0.34,1.56,0.64,1)'
  });

  const colorRu = data.color === 'white' ? '♙ Белые' : '♟ Чёрные';
  b.innerHTML = `
    <div style="font-size:28px">⚔️</div>
    <div style="flex:1;min-width:0">
      <div style="font-weight:700;font-size:14px;color:var(--text-primary)">Вас ждёт турнирная партия!</div>
      <div style="font-size:12px;color:var(--text-secondary);margin-top:3px">
        ${colorRu} · vs <b>${escapeHtml(data.opponent||'?')}</b> · ${escapeHtml(data.timeControl||'')}
      </div>
    </div>
    <button onclick="goToTournamentGame()"
      style="background:linear-gradient(135deg,var(--accent),var(--accent-dark));
      color:#000;border:none;border-radius:10px;padding:10px 18px;
      font-weight:700;font-size:13px;cursor:pointer;white-space:nowrap;flex-shrink:0">
      ⚔️ Перейти
    </button>
    <button onclick="document.getElementById('pending-t-banner')?.remove()"
      style="background:transparent;border:none;color:var(--text-muted);
      font-size:20px;cursor:pointer;padding:0 4px;flex-shrink:0;line-height:1">✕</button>`;

  document.body.appendChild(b);

  if (!document.getElementById('ptb-style')) {
    const s = document.createElement('style');
    s.id = 'ptb-style';
    s.textContent = '@keyframes ptbUp{from{opacity:0;transform:translateX(-50%) translateY(24px)}to{opacity:1;transform:translateX(-50%) translateY(0)}}';
    document.head.appendChild(s);
  }
}

function goToTournamentGame() {
  const data = _pendingTournamentGame;
  if (!data || !data.tournamentId) return;
  document.getElementById('pending-t-banner')?.remove();
  // Переходим на страницу турнира — там socket получит game_start и запустит отсчёт
  window.location.href = '/tournament/' + data.tournamentId;
}

// ── БАННЕР ВОЗВРАТА В ТУРНИР ─────────────────────────────────
function showTournamentReturnBanner(tournamentId, tournamentName) {
  document.getElementById('t-ret-banner')?.remove();
  const b = document.createElement('div');
  b.id = 't-ret-banner';
  Object.assign(b.style, {
    position:'fixed', top:'72px', right:'18px',
    background:'var(--bg-card)', border:'2px solid var(--accent)',
    borderRadius:'14px', padding:'14px 18px',
    display:'flex', alignItems:'center', gap:'14px',
    boxShadow:'0 8px 40px rgba(201,168,76,0.35)', zIndex:'9999',
    minWidth:'260px', maxWidth:'90vw', fontFamily:'var(--font-body)',
    animation:'ptbUp 0.4s cubic-bezier(0.34,1.56,0.64,1)'
  });
  const label = tournamentName ? escapeHtml(tournamentName) : 'турнир';
  b.innerHTML = `
    <div style="font-size:24px">🏆</div>
    <div style="flex:1">
      <div style="font-weight:700;font-size:14px;color:var(--accent)">Вы в турнире</div>
      <div style="font-size:12px;color:var(--text-secondary);margin-top:2px">${label}</div>
    </div>
    <button onclick="window.location.href='/tournament/${tournamentId}'"
      style="background:linear-gradient(135deg,var(--accent),var(--accent-dark));
      color:#000;border:none;border-radius:8px;padding:8px 14px;
      font-weight:700;font-size:13px;cursor:pointer;white-space:nowrap">← В турнир</button>
    <button onclick="document.getElementById('t-ret-banner')?.remove()"
      style="background:transparent;border:none;color:var(--text-muted);
      font-size:18px;cursor:pointer;padding:2px 4px;flex-shrink:0">✕</button>`;
  document.body.appendChild(b);
  if (!document.getElementById('ptb-style')) {
    const s = document.createElement('style');
    s.id = 'ptb-style';
    s.textContent = '@keyframes ptbUp{from{opacity:0;transform:translateY(-16px)}to{opacity:1;transform:translateY(0)}}';
    document.head.appendChild(s);
  }
}

function startGameUI(data) {
  _currentGameData = data; // сохраняем для реджойн-баннера при уходе со страницы
  // Небольшая задержка — даём challenges_update отработать первым
  // чтобы DOM лобби не перезаписал наш переход на game
  setTimeout(() => {
    // Переключаем страницу напрямую (без pages['game'] чтобы не сбросить онлайн-игру)
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    document.querySelectorAll('.nav-links a').forEach(a => a.classList.remove('active'));
    const gameEl = document.getElementById('page-game');
    if (gameEl) gameEl.classList.add('active');
    history.pushState({}, '', '/game/' + (data.gameId || ''));

    // Запускаем игру
    chessBoard.startGame(data);

    // Рейтинги
    const myRating  = currentUser ? currentUser.rating : '?';
    const oppRating = data.opponentRating || '?';
    const topEl    = document.getElementById('rating-top');
    const bottomEl = document.getElementById('rating-bottom');
    if (topEl)    topEl.textContent    = 'Рейтинг: ' + oppRating;
    if (bottomEl) bottomEl.textContent = 'Рейтинг: ' + myRating;

    // Второй рендер — гарантирует правильный контейнер
    setTimeout(() => chessBoard.render(), 50);
  }, 100);
}

// ─── GAME CHAT ────────────────────────────────────────────────
function appendChatMsg(name, message, isMine = false) {
  const chat = document.getElementById('chat-messages');
  if (!chat) return;
  const div = document.createElement('div');
  div.className = 'chat-msg';
  div.style.cssText = isMine ? 'text-align:right;margin-bottom:6px' : 'text-align:left;margin-bottom:6px';
  div.innerHTML = `<span class="chat-msg-name" style="color:${isMine ? 'var(--blue)' : 'var(--accent)'}">${escapeHtml(name)}:</span> <span class="chat-msg-text">${escapeHtml(message)}</span>`;
  chat.appendChild(div);
  requestAnimationFrame(() => { chat.scrollTop = chat.scrollHeight; });
  // Сохраняем в sessionStorage для восстановления после реджойна
  // (_restoringChat флаг ставится в board.js чтобы не дублировать при восстановлении)
  if (!chat._restoringChat && typeof chessBoard !== 'undefined' && chessBoard.gameId) {
    try {
      const key = 'ch_game_chat_' + chessBoard.gameId;
      const msgs = JSON.parse(sessionStorage.getItem(key) || '[]');
      msgs.push({ from: name, message, isMine });
      if (msgs.length > 100) msgs.shift();
      sessionStorage.setItem(key, JSON.stringify(msgs));
    } catch {}
  }
}

function sendChatMsg() {
  const input = document.getElementById('chat-input');
  let msg = input?.value.trim();

  if (!msg || !chessBoard.gameId || !socket?.connected) return;

  if (containsBadWords(msg)) {
    toast('Сообщение содержит запрещённые слова', 'error');
    return;
  }

  socket.emit('game_chat', { gameId: chessBoard.gameId, message: msg });
  appendChatMsg(currentUser.username, msg, true);

  input.value = '';
  input.focus();
}



// ─── ГЛОБАЛЬНЫЙ ЧАТ ──────────────────────────────────────────
async function initGlobalChat() {
  const el = document.getElementById('global-chat-messages');
  if (!el) return;

  // Показываем/скрываем инпут в зависимости от авторизации
  const inputEl   = document.getElementById('global-chat-input');
  const sendBtn   = document.getElementById('chat-send-btn');
  const notLogged = document.getElementById('chat-not-logged');
  if (currentUser) {
    if (inputEl)   inputEl.style.display   = '';
    if (sendBtn)   sendBtn.style.display   = '';
    if (notLogged) notLogged.style.display = 'none';
  } else {
    if (inputEl)   inputEl.style.display   = 'none';
    if (sendBtn)   sendBtn.style.display   = 'none';
    if (notLogged) notLogged.style.display = '';
  }

  // Подписываемся на удаление сообщений
  if (socket) {
    socket.off('chat_msg_deleted');
    socket.on('chat_msg_deleted', (msgId) => {
      const msgEl = document.getElementById('chatmsg-' + msgId);
      if (msgEl) msgEl.remove();
    });

    socket.off('chat_msgs_user_deleted');
    socket.on('chat_msgs_user_deleted', (username) => {
      document.querySelectorAll('#global-chat-messages [data-username]').forEach(el => {
        if (el.dataset.username === username) el.remove();
      });
    });

    socket.off('chat_system_msg');
    socket.on('chat_system_msg', (msg) => {
      appendGlobalChatMsg({ system: true, message: msg, timestamp: Date.now() }, true);
    });

    socket.off('global_chat');
    socket.on('global_chat', (msg) => {
      appendGlobalChatMsg(msg, true);
    });
  }

  // Инициализируем автодополнение @упоминаний
  setTimeout(initMentionAutocomplete, 100);

  try {
    const msgs = await apiGet('/chat');
    el.innerHTML = '';
    msgs.forEach(m => appendGlobalChatMsg(m, false));
    el.scrollTop = el.scrollHeight;
  } catch {}
}
function appendGlobalChatMsg(msg, scroll = true) {
  const el = document.getElementById('global-chat-messages');
  if (!el) return;

  // Системное сообщение (бан, анонс)
  if (msg.system) {
    const sys = document.createElement('div');
    sys.style.cssText = 'text-align:center;padding:6px 12px;margin:4px 0;font-size:12px;color:#e67e22;background:rgba(230,126,34,0.1);border-radius:8px;border:1px solid rgba(230,126,34,0.25);font-weight:600';
    sys.textContent = '⚠️ ' + msg.message;
    el.appendChild(sys);
    if (scroll) requestAnimationFrame(() => { el.scrollTop = el.scrollHeight; });
    return;
  }

  const isAdmin    = msg.role === 'admin';
  const isMe       = msg.username === currentUser?.username;
  const isStreamer = STREAMERS.includes(msg.username);
  const canDelete  = currentUser?.role === 'admin';

  // Проверяем упоминание текущего пользователя
  const isMentioned = currentUser && msg.message && msg.message.toLowerCase().includes('@' + currentUser.username.toLowerCase());

  const time = new Date(msg.timestamp).toLocaleTimeString('ru', {
    hour: '2-digit',
    minute: '2-digit'
  });

  const row = document.createElement('div');
  row.id = 'chatmsg-' + msg.id;
  row.dataset.username = msg.username; // для бана
  let rowBg = isMentioned ? 'rgba(46,204,113,0.12)' : '';
  row.style.cssText = 'display:flex;align-items:flex-start;gap:8px;padding:5px 8px;border-radius:8px;transition:background 0.15s' + (isMentioned ? ';background:' + rowBg + ';border-left:3px solid #2ecc71' : '');
  row.onmouseenter = () => { row.style.background = isMentioned ? 'rgba(46,204,113,0.2)' : 'var(--bg-hover)'; };
  row.onmouseleave = () => { row.style.background = isMentioned ? rowBg : ''; };

  // Аватар
  const av = document.createElement('div');
  av.style.cssText = 'width:28px;height:28px;border-radius:50%;background:linear-gradient(135deg,var(--accent),var(--accent-dark));display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:700;color:#000;flex-shrink:0;cursor:pointer;margin-top:2px';
  av.textContent = msg.username[0].toUpperCase();
  av.onclick = () => openUserProfile(msg.username);
  row.appendChild(av);

  // Контент
  const body = document.createElement('div');
  body.style.flex = '1';

  const header = document.createElement('div');
  header.style.cssText = 'display:flex;align-items:center;gap:6px;margin-bottom:2px';

  // ИМЯ
  const nameEl = document.createElement('span');
  nameEl.style.cssText = 'font-weight:700;font-size:13px;cursor:pointer;color:' + (
    isAdmin ? 'var(--accent)' :
    isStreamer ? '#2ecc71' :
    isMe ? 'var(--blue)' :
    'var(--text-primary)'
  );
  nameEl.textContent = (isAdmin ? '👑 ' : '') + msg.username;
  nameEl.onclick = () => openUserProfile(msg.username);
  header.appendChild(nameEl);

  // ─── ЭМОДЗИ после ника (только если есть) ──────────────────
  const emoji = msg.emoji || '';
  if (emoji) {
    const emojiSpan = document.createElement('span');
    emojiSpan.textContent = emoji;
    emojiSpan.style.cssText = 'font-size:16px; cursor:pointer; line-height:1';
    emojiSpan.title = 'Нажмите, чтобы выбрать свой эмодзи';
    emojiSpan.onclick = (e) => {
      e.stopPropagation();
      window.location = '/settings';
    };
    header.appendChild(emojiSpan);
  }

  // Кнопка @ обращения (только если не свои сообщения)
  if (currentUser && !isMe) {
    const mentionBtn = document.createElement('button');
    mentionBtn.title = 'Обратиться к ' + msg.username;
    mentionBtn.style.cssText = 'background:none;border:none;color:var(--text-muted);cursor:pointer;font-size:11px;padding:1px 4px;opacity:0.5;transition:opacity 0.15s;border-radius:4px;font-weight:700';
    mentionBtn.textContent = '@';
    mentionBtn.onmouseenter = () => { mentionBtn.style.opacity = '1'; mentionBtn.style.color = '#2ecc71'; mentionBtn.style.background = 'rgba(46,204,113,0.12)'; };
    mentionBtn.onmouseleave = () => { mentionBtn.style.opacity = '0.5'; mentionBtn.style.color = 'var(--text-muted)'; mentionBtn.style.background = 'none'; };
    mentionBtn.onclick = (e) => {
      e.stopPropagation();
      insertMention(msg.username);
    };
    header.appendChild(mentionBtn);
  }

  // ADMIN бейдж
  if (isAdmin) {
    const badge = document.createElement('span');
    badge.style.cssText = 'background:rgba(201,168,76,0.15);color:var(--accent);font-size:10px;font-weight:700;padding:1px 5px;border-radius:3px';
    badge.textContent = 'ADMIN';
    header.appendChild(badge);
  }

  // STREAMER бейдж 🔥
  if (isStreamer) {
    const badge = document.createElement('span');
    badge.style.cssText = 'background:rgba(46,204,113,0.15);color:#2ecc71;font-size:10px;font-weight:700;padding:1px 5px;border-radius:3px';
    badge.textContent = 'STREAMER';
    header.appendChild(badge);
  }

  // Время
  const timeEl = document.createElement('span');
  timeEl.style.cssText = 'font-size:11px;color:var(--text-muted);margin-left:auto';
  timeEl.textContent = time;
  header.appendChild(timeEl);

  // Кнопка удаления (только для админа)
  if (canDelete) {
    const delBtn = document.createElement('button');
    delBtn.style.cssText = 'background:none;border:none;color:var(--text-muted);cursor:pointer;font-size:12px;padding:0 2px;opacity:0.6;transition:opacity 0.15s';
    delBtn.textContent = '🗑';
    delBtn.title = 'Удалить сообщение и забанить';
    delBtn.onmouseenter = () => { delBtn.style.opacity = '1'; delBtn.style.color = 'var(--red)'; };
    delBtn.onmouseleave = () => { delBtn.style.opacity = '0.6'; delBtn.style.color = 'var(--text-muted)'; };
    delBtn.onclick = () => deleteChatMsg(msg.id, row);
    header.appendChild(delBtn);
  }

  body.appendChild(header);

  // Текст сообщения — подсвечиваем @mentions
  const text = document.createElement('div');
  text.style.cssText = 'font-size:14px;color:var(--text-secondary);line-height:1.4;word-break:break-word';
  text.innerHTML = formatChatMessage(msg.message);
  body.appendChild(text);

  row.appendChild(body);
  el.appendChild(row);

  if (scroll) {
    requestAnimationFrame(() => {
      el.scrollTop = el.scrollHeight;
    });
  }
}

async function deleteChatMsg(msgId, rowEl) {
  // Определяем username из строки сообщения
  const username = rowEl.dataset.username;

  // Показываем попап выбора бана
  showChatBanModal(msgId, rowEl, username);
}

function showChatBanModal(msgId, rowEl, username) {
  // Удаляем старый модал если есть
  document.getElementById('modal-chat-ban')?.remove();

  const overlay = document.createElement('div');
  overlay.id = 'modal-chat-ban';
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.6);z-index:99999;display:flex;align-items:center;justify-content:center;backdrop-filter:blur(4px)';

  const box = document.createElement('div');
  box.style.cssText = 'background:var(--bg-card);border:1px solid var(--border);border-radius:16px;padding:28px;max-width:380px;width:90%;box-shadow:0 20px 60px rgba(0,0,0,0.5)';

  box.innerHTML = `
    <h3 style="margin:0 0 6px;font-size:18px;font-family:var(--font-display)">🚫 Удалить сообщение</h3>
    <p style="color:var(--text-muted);font-size:13px;margin:0 0 20px">Пользователь: <b style="color:var(--text-primary)">${escapeHtml(username || '?')}</b></p>
    <div style="margin-bottom:16px">
      <div style="font-size:13px;font-weight:600;color:var(--text-secondary);margin-bottom:10px">Забанить пользователя в чате?</div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px" id="chat-ban-options">
        <button class="chat-ban-opt" data-dur="0"   style="padding:10px;border-radius:10px;border:2px solid var(--border);background:var(--bg-secondary);cursor:pointer;font-size:13px;transition:all 0.15s">
          🗑 Только удалить<br><span style="font-size:11px;color:var(--text-muted)">без бана</span>
        </button>
        <button class="chat-ban-opt" data-dur="5"   style="padding:10px;border-radius:10px;border:2px solid var(--border);background:var(--bg-secondary);cursor:pointer;font-size:13px;transition:all 0.15s">
          ⏱ 5 минут<br><span style="font-size:11px;color:var(--text-muted)">мини-бан</span>
        </button>
        <button class="chat-ban-opt" data-dur="15"  style="padding:10px;border-radius:10px;border:2px solid var(--border);background:var(--bg-secondary);cursor:pointer;font-size:13px;transition:all 0.15s">
          🔇 15 минут<br><span style="font-size:11px;color:var(--text-muted)">стандарт</span>
        </button>
        <button class="chat-ban-opt" data-dur="30"  style="padding:10px;border-radius:10px;border:2px solid var(--border);background:var(--bg-secondary);cursor:pointer;font-size:13px;transition:all 0.15s">
          ⛔ 30 минут<br><span style="font-size:11px;color:var(--text-muted)">серьёзно</span>
        </button>
        <button class="chat-ban-opt" data-dur="60"  style="padding:10px;border-radius:10px;border:2px solid var(--border);background:var(--bg-secondary);cursor:pointer;font-size:13px;transition:all 0.15s">
          🚫 1 час<br><span style="font-size:11px;color:var(--text-muted)">жёстко</span>
        </button>
        <button class="chat-ban-opt" data-dur="1440" style="padding:10px;border-radius:10px;border:2px solid var(--border);background:var(--bg-secondary);cursor:pointer;font-size:13px;transition:all 0.15s">
          💀 24 часа<br><span style="font-size:11px;color:var(--text-muted)">максимум</span>
        </button>
      </div>
    </div>
    <button id="chat-ban-cancel" style="width:100%;padding:10px;border-radius:8px;border:1px solid var(--border);background:none;color:var(--text-muted);cursor:pointer;font-size:13px">Отмена</button>
  `;

  overlay.appendChild(box);
  document.body.appendChild(overlay);

  // Hover эффекты
  box.querySelectorAll('.chat-ban-opt').forEach(btn => {
    btn.onmouseenter = () => { btn.style.borderColor = 'var(--accent)'; btn.style.background = 'rgba(201,168,76,0.1)'; };
    btn.onmouseleave = () => { btn.style.borderColor = 'var(--border)'; btn.style.background = 'var(--bg-secondary)'; };
    btn.onclick = () => {
      const dur = parseInt(btn.dataset.dur);
      overlay.remove();
      executeChatBan(msgId, rowEl, username, dur);
    };
  });

  box.querySelector('#chat-ban-cancel').onclick = () => overlay.remove();
  overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };
}

async function executeChatBan(msgId, rowEl, username, durationMinutes) {
  try {
    // 1. Удаляем конкретное сообщение (и все сообщения юзера на сервере)
    await fetch('/api/admin/chat/user/' + encodeURIComponent(username), {
      method: 'DELETE',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' }
    });

    // 2. Если выбран бан — отправляем запрос бана
    if (durationMinutes > 0) {
      await fetch('/api/admin/chat-ban', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, durationMinutes })
      });
      toast(`${username} забанен в чате на ${durationMinutes} мин.`, 'success');
    } else {
      toast(`Сообщения ${username} удалены`, 'success');
    }
  } catch(e) { toast('Ошибка: ' + e.message, 'error'); }
}

function sendGlobalChatMsg() {
  const input = document.getElementById('global-chat-input');
  let msg = input?.value.trim().slice(0, 50);

  if (!msg) return;
  if (!currentUser) { toast('Войдите чтобы писать в чат', 'info'); return; }
  if (!socket?.connected) { toast('Нет соединения', 'error'); return; }

  if (containsBadWords(msg)) {
    toast('Сообщение содержит запрещённые слова', 'error');
    return;
  }

  socket.emit('global_chat', { message: msg });
  input.value = '';
  input.focus();
  // Закрываем автодополнение
  closeMentionSuggestions();
}

// ─── @MENTION HELPERS ─────────────────────────────────────────
function formatChatMessage(text) {
  if (!text) return '';
  // Экранируем HTML сначала
  let safe = String(text).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  // Подсвечиваем @упоминания (ники с дефисом тоже поддерживаем)
  safe = safe.replace(/@([\w\u0400-\u04FF][\w\u0400-\u04FF\-]*)/g, (match, name) => {
    const nameLow = name.toLowerCase();
    if (nameLow === 'everyone') {
      return `<span class="chat-mention" style="color:#e74c3c;font-weight:700;background:rgba(231,76,60,0.15);border-radius:3px;padding:0 4px">@everyone</span>`;
    }
    const isMe = currentUser && nameLow === currentUser.username.toLowerCase();
    const style = isMe
      ? 'color:#2ecc71;font-weight:700;background:rgba(46,204,113,0.15);border-radius:3px;padding:0 2px;cursor:pointer'
      : 'color:#5dade2;font-weight:700;cursor:pointer';
    return `<span class="chat-mention" style="${style}" data-user="${name}">@${name}</span>`;
  });
  return safe;
}

function insertMention(username) {
  const input = document.getElementById('global-chat-input');
  if (!input) return;
  const val = input.value;
  const cur = input.selectionStart;
  // Вставляем @username в позицию курсора
  const before = val.slice(0, cur);
  const after = val.slice(cur);
  const sep = before.length > 0 && !before.endsWith(' ') ? ' ' : '';
  input.value = before + sep + '@' + username + ' ' + after;
  input.focus();
  const newPos = (before + sep + '@' + username + ' ').length;
  input.setSelectionRange(newPos, newPos);
  closeMentionSuggestions();
}

// Автодополнение @ при наборе
function initMentionAutocomplete() {
  const input = document.getElementById('global-chat-input');
  if (!input || input._mentionInitialized) return;
  input._mentionInitialized = true;

  input.addEventListener('input', () => {
    const val = input.value;
    const cur = input.selectionStart;
    // Ищем @ перед курсором
    const textBefore = val.slice(0, cur);
    const atMatch = textBefore.match(/@([\w\u0400-\u04FF]*)$/);
    if (!atMatch) { closeMentionSuggestions(); return; }
    const query = atMatch[1].toLowerCase();
    showMentionSuggestions(query, atMatch[0].length);
  });

  input.addEventListener('keydown', (e) => {
    const sugg = document.getElementById('mention-suggestions');
    if (!sugg || sugg.style.display === 'none') return;
    const items = sugg.querySelectorAll('.mention-item');
    const active = sugg.querySelector('.mention-item.active');
    let idx = Array.from(items).indexOf(active);
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      idx = (idx + 1) % items.length;
      items.forEach((it, i) => it.classList.toggle('active', i === idx));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      idx = (idx - 1 + items.length) % items.length;
      items.forEach((it, i) => it.classList.toggle('active', i === idx));
    } else if (e.key === 'Enter' || e.key === 'Tab') {
      const act = sugg.querySelector('.mention-item.active');
      if (act) { e.preventDefault(); act.click(); }
    } else if (e.key === 'Escape') {
      closeMentionSuggestions();
    }
  });

  input.addEventListener('blur', () => setTimeout(closeMentionSuggestions, 150));
}

function showMentionSuggestions(query, atLen) {
  // Собираем уникальные имена из видимых сообщений
  const names = new Set();
  document.querySelectorAll('#global-chat-messages [data-username]').forEach(el => {
    const u = el.dataset.username;
    if (u && u !== currentUser?.username) names.add(u);
  });

  const filtered = [...names].filter(n => n.toLowerCase().startsWith(query)).slice(0, 5);

  let sugg = document.getElementById('mention-suggestions');
  if (!sugg) {
    sugg = document.createElement('div');
    sugg.id = 'mention-suggestions';
    sugg.style.cssText = 'position:absolute;bottom:calc(100% + 4px);left:0;right:0;background:var(--bg-card);border:1px solid var(--border);border-radius:10px;overflow:hidden;z-index:999;box-shadow:0 8px 24px rgba(0,0,0,0.4)';
    const inputWrap = document.getElementById('global-chat-input')?.parentElement;
    if (inputWrap) { inputWrap.style.position = 'relative'; inputWrap.appendChild(sugg); }
    else { document.body.appendChild(sugg); }
  }

  if (!filtered.length) { sugg.style.display = 'none'; return; }
  sugg.style.display = 'block';
  sugg.innerHTML = '';

  filtered.forEach((name, i) => {
    const item = document.createElement('div');
    item.className = 'mention-item' + (i === 0 ? ' active' : '');
    item.style.cssText = 'display:flex;align-items:center;gap:10px;padding:8px 12px;cursor:pointer;transition:background 0.12s';
    item.onmouseenter = () => { sugg.querySelectorAll('.mention-item').forEach(x => x.classList.remove('active')); item.classList.add('active'); };
    item.style.background = i === 0 ? 'var(--bg-hover)' : '';
    const av = document.createElement('div');
    av.style.cssText = 'width:24px;height:24px;border-radius:50%;background:linear-gradient(135deg,var(--accent),var(--accent-dark));display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;color:#000;flex-shrink:0';
    av.textContent = name[0].toUpperCase();
    const nm = document.createElement('span');
    nm.style.cssText = 'font-size:13px;font-weight:600';
    nm.textContent = '@' + name;
    item.appendChild(av); item.appendChild(nm);
    item.onclick = () => {
      // Заменяем @query на @name в инпуте
      const input = document.getElementById('global-chat-input');
      const val = input.value;
      const cur = input.selectionStart;
      const before = val.slice(0, cur - atLen);
      const after = val.slice(cur);
      input.value = before + '@' + name + ' ' + after;
      input.focus();
      closeMentionSuggestions();
    };
    sugg.appendChild(item);
  });
}

function closeMentionSuggestions() {
  const sugg = document.getElementById('mention-suggestions');
  if (sugg) sugg.style.display = 'none';
}

// Делегирование кликов по @упоминаниям в чате
document.addEventListener('click', (e) => {
  const mention = e.target.closest('.chat-mention');
  if (mention) {
    const user = mention.dataset.user;
    if (user) insertMention(user);
  }
});

// ─── НАСТРОЙКИ ────────────────────────────────────────────────
pages['settings'] = () => {
  const s = getSettings();
  const sounds = document.getElementById('set-sounds');
  const hints  = document.getElementById('set-hints');
  const coords = document.getElementById('set-coords');
  const anim   = document.getElementById('set-animation');
  if (sounds) sounds.checked = s.sounds;
  if (hints)  hints.checked  = s.hints;
  if (coords) coords.checked = s.coords;
  if (anim)   anim.checked   = s.animation;

  const infoEl = document.getElementById('account-info-text');
  if (infoEl) {
    if (currentUser) {
      infoEl.innerHTML = `
        <div style="font-weight:600">${escapeHtml(currentUser.username)}</div>
        <div style="color:var(--text-muted);font-size:12px">Рейтинг: ${currentUser.rating} · Партий: ${currentUser.gamesPlayed}</div>
        ${currentUser.email ? `<div style="color:var(--text-muted);font-size:12px">${escapeHtml(currentUser.email)}</div>` : ''}`;
    } else {
      infoEl.textContent = 'Войдите в аккаунт для управления профилем';
    }
  }
};

function getSettings() {
  const defaults = { sounds: true, hints: true, coords: true, animation: true, boardLight: '#f0d9b5', boardDark: '#b58863' };
  try { return { ...defaults, ...JSON.parse(localStorage.getItem('ch_settings') || '{}') }; } catch { return defaults; }
}

function saveSetting(key, value) {
  const s = getSettings(); s[key] = value;
  localStorage.setItem('ch_settings', JSON.stringify(s));
  applySettings();
  // Перерисовываем доску если изменились визуальные настройки
  if (['coords','hints','animation'].includes(key)) {
    if (typeof chessBoard !== 'undefined') chessBoard.render();
  }
}

function applySettings() {
  const s = getSettings();
  document.documentElement.style.setProperty('--board-light', s.boardLight || '#f0d9b5');
  document.documentElement.style.setProperty('--board-dark',  s.boardDark  || '#b58863');
}

// ─── ПРОФИЛЬ ──────────────────────────────────────────────────

function _profileShow(id) {
  ['profile-loading','profile-data','profile-auth-required','profile-notfound'].forEach(s => {
    const el = document.getElementById(s);
    if (el) el.style.display = s === id ? '' : 'none';
  });
}

// Переключение вкладок профиля
function _initProfileTabs() {
  document.querySelectorAll('.profile-tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.profile-tab-btn').forEach(b => {
        b.style.color = 'var(--text-muted)';
        b.style.borderBottomColor = 'transparent';
        b.classList.remove('active');
      });
      btn.style.color = 'var(--accent)';
      btn.style.borderBottomColor = 'var(--accent)';
      btn.classList.add('active');
      ['overview','games','activity'].forEach(t => {
        const el = document.getElementById('ptab-' + t);
        if (el) el.style.display = btn.dataset.ptab === t ? '' : 'none';
      });
    });
  });
}

// SVG спарклайн рейтинга
function _drawProfileRatingChart(ratings) {
  const svg = document.getElementById('profile-rating-svg');
  if (!svg) return;
  const emptyEl = document.getElementById('profile-svg-empty');
  if (!ratings || ratings.length < 2) {
    if (emptyEl) emptyEl.style.display = '';
    return;
  }
  if (emptyEl) emptyEl.style.display = 'none';

  const W = 500, H = 100, PAD = 12;
  const mn = Math.min(...ratings) - 15;
  const mx = Math.max(...ratings) + 15;
  const range = mx - mn || 1;

  const pts = ratings.map((r, i) => {
    const x = PAD + (i / (ratings.length - 1)) * (W - PAD * 2);
    const y = PAD + (1 - (r - mn) / range) * (H - PAD * 2 - 16);
    return [x, y];
  });

  const lineD = pts.map((p, i) => (i === 0 ? `M${p[0].toFixed(1)},${p[1].toFixed(1)}` : `L${p[0].toFixed(1)},${p[1].toFixed(1)}`)).join(' ');
  const areaD = lineD + ` L${pts[pts.length-1][0].toFixed(1)},${H} L${pts[0][0].toFixed(1)},${H} Z`;

  svg.innerHTML = `<defs>
    <linearGradient id="prg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="var(--accent)" stop-opacity=".3"/>
      <stop offset="100%" stop-color="var(--accent)" stop-opacity="0"/>
    </linearGradient>
  </defs>
  <path d="${areaD}" fill="url(#prg)"/>
  <path d="${lineD}" fill="none" stroke="var(--accent)" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>
  ${pts.map(p => `<circle cx="${p[0].toFixed(1)}" cy="${p[1].toFixed(1)}" r="2.5" fill="var(--accent)"/>`).join('')}
  <text x="${pts[pts.length-1][0].toFixed(1)}" y="${(pts[pts.length-1][1]-7).toFixed(1)}" text-anchor="middle" fill="var(--accent)" font-size="11" font-weight="700">${ratings[ratings.length-1]}</text>`;
}

// Таблица колебаний рейтинга
function _buildRatingTable(games, username, currentRating) {
  const tbody = document.getElementById('profile-rating-tbody');
  if (!tbody) return;
  if (!games || !games.length) {
    tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;color:var(--text-muted);padding:20px">Партий пока нет</td></tr>';
    return;
  }

  const K = 32;
  let rNow = currentRating;
  const rows = [];
  const sorted = [...games].sort((a, b) => (b.endedAt || 0) - (a.endedAt || 0));

  sorted.slice(0, 20).forEach((g, i) => {
    const isWhite = g.white === username;
    const opponent = isWhite ? g.black : g.white;
    let resText, resColor, score;
    if (g.result === 'draw')                           { resText = 'Ничья';      resColor = 'var(--text-secondary)'; score = 0.5; }
    else if (g.result === (isWhite ? 'white':'black')) { resText = 'Победа';     resColor = 'var(--green)';          score = 1; }
    else                                               { resText = 'Поражение';  resColor = 'var(--red)';            score = 0; }

    const oppEst = rNow + (score === 1 ? -20 : score === 0 ? 20 : 0);
    const exp = 1 / (1 + Math.pow(10, (oppEst - rNow) / 400));
    const delta = Math.round(K * (score - exp));
    const date = g.endedAt ? new Date(g.endedAt).toLocaleDateString('ru', {day:'2-digit',month:'2-digit'}) : '—';

    rows.push({ g, opponent, resText, resColor, delta, rNow, date });
    rNow = Math.max(100, rNow - delta);
  });

  tbody.innerHTML = rows.map((r, i) => {
    const dc = r.delta > 0 ? 'color:var(--green);font-weight:700' : r.delta < 0 ? 'color:var(--red);font-weight:700' : 'color:var(--text-muted)';
    const ds = r.delta > 0 ? '+' + r.delta : String(r.delta);
    const gJson = JSON.stringify(r.g).replace(/\\/g,'\\\\').replace(/'/g,"\\'").replace(/"/g,'&quot;');
    return `<tr style="cursor:pointer;transition:background .1s" onmouseenter="this.style.background='var(--bg-hover)'" onmouseleave="this.style.background=''" onclick="_openGameFromProfile('${gJson}')">
      <td style="padding:8px 10px;border-bottom:1px solid var(--border);color:var(--text-muted)">${i+1}</td>
      <td style="padding:8px 10px;border-bottom:1px solid var(--border)"><a href="/profile/${encodeURIComponent(r.opponent)}" style="color:var(--accent);text-decoration:none" onclick="event.stopPropagation()">${escapeHtml(r.opponent)}</a></td>
      <td style="padding:8px 10px;border-bottom:1px solid var(--border);color:var(--text-muted)">${escapeHtml(r.g.timeControl||'?')}</td>
      <td style="padding:8px 10px;border-bottom:1px solid var(--border);color:${r.resColor};font-weight:600">${r.resText}</td>
      <td style="padding:8px 10px;border-bottom:1px solid var(--border);${dc}">${ds}</td>
      <td style="padding:8px 10px;border-bottom:1px solid var(--border);font-family:var(--font-mono);font-size:12px">${r.rNow}</td>
      <td style="padding:8px 10px;border-bottom:1px solid var(--border);color:var(--text-muted)">${r.date}</td>
    </tr>`;
  }).join('');
}

function _openGameFromProfile(g) {
  if (typeof g === 'string') { try { g = JSON.parse(g); } catch(e) { return; } }
  window.location.href = '/game/' + g.id;
}

// ──────────────────────────────────────────────────────────────
//  Emoji picker (настройки)
// ──────────────────────────────────────────────────────────────

const EMOJIS = [
  '😀', '😃', '😄', '😁', '😆', '😅', '😂', '🤣', '😊', '😇', '🙂', '🙃', '😉', '😌', '😍', '🥰',
  '😘', '😗', '😙', '😚', '😋', '😛', '😝', '😜', '🤪', '🤨', '🧐', '🤓', '😎', '🤩', '🥳', '😏',
  '😒', '😞', '😔', '😟', '😕', '🙁', '☹️', '😣', '😖', '😫', '😩', '🥺', '😢', '😭', '😤', '😠',
  '😡', '🤬', '🤯', '😳', '🥵', '🥶', '😱', '😨', '😰', '😥', '😓', '🤗', '🤔', '🤭', '🤫', '🤥',
  '😶', '😐', '😑', '😬', '🙄', '😯', '😦', '😧', '😮', '😲', '🥱', '😴', '🤤', '😪', '😵', '🤐',
  '🥴', '🤢', '🤮', '🤧', '😷', '🤒', '🤕', '🤑', '🤠', '😈', '👿', '👹', '👺', '💩', '👻', '💀',
  '☠️', '👽', '🤖', '🎃', '😺', '😸', '😹', '😻', '😼', '😽', '🙀', '😿', '😾', '🙈', '🙉', '🙊',
  '🐶', '🐱', '🐭', '🐹', '🐰', '🦊', '🐻', '🐼', '🐨', '🐯', '🦁', '🐮', '🐷', '🐸', '🐒', '🐔',
  '🐧', '🐦', '🐤', '🐣', '🐥', '🐺', '🐗', '🐴', '🦄', '🐝', '🐛', '🦋', '🐌', '🐞', '🐜', '🦟',
  '🦗', '🕷️', '🦂', '🐢', '🐍', '🦎', '🐙', '🦑', '🦐', '🦞', '🐠', '🐟', '🐡', '🐬', '🐳', '🐋',
  '🦈', '🐊', '🐅', '🐆', '🦓', '🦍', '🦧', '🦣', '🐘', '🦛', '🦏', '🐪', '🐫', '🦒', '🦘', '🐃',
  '🐂', '🐄', '🐎', '🐖', '🐏', '🐑', '🦙', '🐐', '🦌', '🐕', '🐩', '🐈', '🐓', '🦃', '🐇', '🐁',
  '🐀', '🐿️', '🦔', '🐾', '🐉', '🐲', '🌵', '🎄', '🌲', '🌳', '🌴', '🌿', '🍀', '🍁', '🍂', '🍃',
  '🍇', '🍈', '🍉', '🍊', '🍋', '🍌', '🍍', '🥭', '🍎', '🍏', '🍐', '🍑', '🍒', '🍓', '🥝', '🍅',
  '🥥', '🥑', '🍆', '🥔', '🥕', '🌽', '🌶️', '🥒', '🥬', '🥦', '🧄', '🧅', '🍄', '🥜', '🌰', '🍞',
  '🥐', '🥖', '🥨', '🥯', '🥞', '🧇', '🧀', '🍖', '🍗', '🥩', '🥓', '🍔', '🍟', '🍕', '🌭', '🥪',
  '🌮', '🌯', '🥙', '🧆', '🥚', '🍳', '🥘', '🍲', '🥣', '🥗', '🍿', '🧈', '🧂', '🥫', '🍱', '🍘',
  '🍙', '🍚', '🍛', '🍜', '🍝', '🍠', '🍢', '🍣', '🍤', '🍥', '🥮', '🍡', '🥟', '🥠', '🥡', '🦀',
  '🦞', '🦐', '🦑', '🐙', '🍦', '🍧', '🍨', '🍩', '🍪', '🎂', '🍰', '🧁', '🥧', '🍫', '🍬', '🍭',
  '🍮', '🍯', '🥛', '🍼', '🥤', '🧃', '🧉', '🧊', '🍺', '🍻', '🥂', '🥃', '🥄', '🍴', '🍽️', '🥢'
];

function openEmojiPicker() {
  const grid = document.getElementById('emoji-grid');
  if (!grid) return;
  grid.innerHTML = '';
  for (const em of EMOJIS) {
    const div = document.createElement('div');
    div.textContent = em;
    div.style.cssText = 'cursor:pointer; font-size:28px; padding:4px; transition:transform 0.1s';
    div.onmouseenter = () => div.style.transform = 'scale(1.1)';
    div.onmouseleave = () => div.style.transform = 'scale(1)';
    div.onclick = () => selectEmoji(em);
    grid.appendChild(div);
  }
  openModal('modal-emoji');
}

async function selectEmoji(emoji) {
  if (!currentUser) {
    toast('Войдите, чтобы сменить эмодзи', 'info');
    return;
  }
  try {
    const res = await fetch('/api/user/emoji', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ emoji })
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || 'Ошибка');
    }
    const data = await res.json();
    // Обновляем текущего пользователя
    if (currentUser) currentUser.emoji = emoji;
    // Обновляем шапку (если есть CH)
    if (window.CH) CH.setCurrentUser(currentUser);
    // Обновляем отображение в настройках
    const preview = document.getElementById('current-emoji-preview');
    if (preview) preview.textContent = emoji || '';
    // Перезагружаем чаты (чтобы обновились эмодзи)
    if (typeof reloadGlobalChat === 'function') reloadGlobalChat();
    else if (typeof initGlobalChat === 'function') initGlobalChat();
    closeModal('modal-emoji');
    toast('Эмодзи сохранён!', 'success');
  } catch (err) {
    toast(err.message, 'error');
  }
}

// Активность за 7 дней
async function _loadProfileActivity(username, games) {
  const feedEl    = document.getElementById('profile-activity-feed');
  const blocksEl  = document.getElementById('profile-activity-blocks');
  if (!feedEl || !blocksEl) return;

  const since = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const recentGames = games.filter(g => (g.endedAt || 0) > since);
  const wins = recentGames.filter(g => {
    const isWhite = g.white === username;
    return g.result === (isWhite ? 'white' : 'black');
  }).length;

  let blogPosts = 0, forumPosts = 0, chatMsgs = 0;
  try {
    const b = await fetch('/api/blog?limit=50').then(r=>r.json());
    if (b.posts) blogPosts = b.posts.filter(p => p.author === username && p.createdAt > since).length;
  } catch(e){}
  try {
    const ft = await fetch('/api/forum/threads?limit=50').then(r=>r.json());
    if (ft.threads) forumPosts = ft.threads.filter(t => t.author === username && t.createdAt > since).length;
  } catch(e){}
  try {
    const ch = await fetch('/api/chat?limit=500').then(r=>r.json());
    if (Array.isArray(ch)) chatMsgs = ch.filter(m => m.username === username && m.timestamp > since).length;
  } catch(e){}

  const blocks = [
    { icon:'♟', label:'Партий',     val: recentGames.length, color:'var(--accent)' },
    { icon:'🏆', label:'Побед',      val: wins,               color:'var(--green)' },
    { icon:'💬', label:'В чате',     val: chatMsgs,           color:'#7c9cbf' },
    { icon:'📰', label:'Блог',       val: blogPosts,          color:'#c9a84c' },
    { icon:'💡', label:'Форум',      val: forumPosts,         color:'#8bc4a0' },
    { icon:'🧩', label:'Задач',      val: '—',               color:'var(--text-muted)' },
  ];

  blocksEl.innerHTML = blocks.map(b => `
    <div class="settings-section" style="text-align:center;padding:10px 6px;margin:0">
      <div style="font-size:18px">${b.icon}</div>
      <div style="font-size:20px;font-weight:700;color:${b.color};font-family:var(--font-mono)">${b.val}</div>
      <div style="font-size:11px;color:var(--text-muted);margin-top:2px">${b.label}</div>
    </div>`).join('');

  const events = recentGames.map(g => {
    const isWhite = g.white === username;
    const opp = isWhite ? g.black : g.white;
    let res;
    if (g.result === 'draw') res = 'Ничья';
    else if (g.result === (isWhite?'white':'black')) res = 'Победа';
    else res = 'Поражение';
    const resColor = res==='Победа'?'var(--green)':res==='Поражение'?'var(--red)':'var(--text-secondary)';
    const moves = g.moves ? Math.floor(g.moves.length/2) : 0;
    const dateStr = g.endedAt ? new Date(g.endedAt).toLocaleString('ru',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'}) : '';
    return { ts: g.endedAt||0, html: `
      <div style="display:flex;align-items:center;gap:12px;padding:10px 0;border-bottom:1px solid var(--border);cursor:pointer" onclick="_openGameFromProfile(${JSON.stringify(JSON.stringify(g))})">
        <div style="width:34px;height:34px;border-radius:50%;background:var(--bg-secondary);display:flex;align-items:center;justify-content:center;font-size:15px;flex-shrink:0">♟</div>
        <div style="flex:1">
          <div style="font-size:13px">Партия vs <b>${escapeHtml(opp)}</b> — <b style="color:${resColor}">${res}</b></div>
          <div style="font-size:11px;color:var(--text-muted);margin-top:2px">${escapeHtml(g.timeControl||'?')} · ${moves} ходов${dateStr?' · '+dateStr:''}</div>
        </div>
      </div>` };
  }).sort((a,b)=>b.ts-a.ts);

  feedEl.innerHTML = events.length
    ? events.slice(0,30).map(e=>e.html).join('')
    : '<div style="text-align:center;color:var(--text-muted);padding:20px">Нет активности за 7 дней</div>';
}

async function renderProfileUI(username) {
  _profileShow('profile-loading');
  // Сброс вкладок
  _initProfileTabs();
  ['ptab-overview','ptab-games','ptab-activity'].forEach((id,i) => {
    const el = document.getElementById(id);
    if (el) el.style.display = i===0?'':'none';
  });
  document.querySelectorAll('.profile-tab-btn').forEach((b,i) => {
    if (i===0) { b.style.color='var(--accent)'; b.style.borderBottomColor='var(--accent)'; }
    else       { b.style.color='var(--text-muted)'; b.style.borderBottomColor='transparent'; }
  });

  try {
    const u = await apiGet('/users/' + encodeURIComponent(username));
    _profileShow('profile-data');

    const isMe = currentUser && currentUser.username === u.username;
    history.replaceState({}, '', isMe ? '/profile' : '/profile/' + encodeURIComponent(u.username));

    const set = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
    set('profile-avatar', u.username[0].toUpperCase());
    set('profile-name',   u.username);
    set('profile-rating', '★ ' + u.rating);
    set('profile-joined', 'На сайте с ' + new Date(u.createdAt).toLocaleDateString('ru'));

    const onlineEl = document.getElementById('profile-online-status');
    if (onlineEl) onlineEl.innerHTML = u.online
      ? '<span style="color:var(--green)">● онлайн</span>'
      : '<span style="color:var(--text-muted)">● оффлайн</span>';

    // Бейдж
    const badgeEl = document.getElementById('profile-badge');
    if (badgeEl) {
      badgeEl.innerHTML = '';
      if (u.banned) badgeEl.innerHTML += '<span style="background:var(--red);color:#fff;padding:3px 10px;border-radius:20px;font-size:11px;font-weight:700;margin-right:4px">🚫 Заблокирован</span>';
      if (u.role==='admin') badgeEl.innerHTML += '<span style="background:var(--accent);color:#fff;padding:3px 10px;border-radius:20px;font-size:11px;font-weight:700">⚙️ Администратор</span>';
    }

    set('stat-games',  u.gamesPlayed || 0);
    set('stat-wins',   u.wins        || 0);
    set('stat-losses', u.losses      || 0);
    set('stat-draws',  u.draws       || 0);

    const winPct = u.gamesPlayed > 0 ? Math.round(u.wins / u.gamesPlayed * 100) : 0;
    const bar = document.getElementById('profile-winrate-bar');
    const txt = document.getElementById('profile-winrate-text');
    if (bar) bar.style.width = winPct + '%';
    if (txt) txt.textContent = `Винрейт: ${winPct}% (${u.wins||0}П / ${u.losses||0}П / ${u.draws||0}Н)`;

    // Задачи
    set('profile-puzzle-rating', u.puzzle_rating || 1200);
    set('profile-puzzle-solved', u.puzzle_solved || 0);
    const acc = (u.puzzle_attempted||0) > 0 ? Math.round((u.puzzle_solved||0)/u.puzzle_attempted*100) : 0;
    set('profile-puzzle-acc', acc + '%');
    // Storm
    set('profile-storm-best', (u.storm_runs||0) > 0 ? (u.storm_best || 0) : '—');
    set('profile-storm-runs', u.storm_runs || 0);

    // Кнопки действий
    const actionsEl = document.getElementById('profile-actions');
    if (actionsEl) {
      actionsEl.style.display = (!isMe && currentUser) ? 'flex' : 'none';
    }
    const btnM = document.getElementById('profile-btn-message');
    const btnC = document.getElementById('profile-btn-challenge');
    const btnB = document.getElementById('profile-btn-ban');
    const btnU = document.getElementById('profile-btn-unban');

    if (btnM) { btnM.style.display = currentUser ? '' : 'none'; btnM.onclick = () => { window.location = '/inbox/' + encodeURIComponent(u.username); }; }
    if (btnC) { btnC.style.display = (u.online && currentUser) ? '' : 'none'; btnC.onclick = () => { localStorage.setItem('ch_pending_challenge', u.username); showPage('lobby'); }; }
    const isAdmin = currentUser?.role === 'admin';
    if (btnB) { btnB.style.display = (isAdmin && !u.banned) ? '' : 'none'; btnB.onclick = async () => { const r = prompt('Причина бана:','Нарушение правил'); if (!r) return; await apiPost('/admin/ban',{username:u.username,reason:r}); toast('Заблокирован','success'); renderProfileUI(u.username); }; }
    if (btnU) { btnU.style.display = (isAdmin && u.banned)  ? '' : 'none'; btnU.onclick = async () => { await apiPost('/admin/unban',{username:u.username}); toast('Разблокирован','success'); renderProfileUI(u.username); }; }

    // Загружаем игры
    const games = await loadProfileGames(u.username);

    // Спарклайн
    if (games && games.length > 1) {
      const K = 32;
      let r = u.rating;
      const rHist = [r];
      const sorted = [...games].sort((a,b)=>(b.endedAt||0)-(a.endedAt||0));
      sorted.slice(0,19).forEach(g => {
        const isW = g.white === u.username;
        const sc = g.result==='draw'?0.5:g.result===(isW?'white':'black')?1:0;
        const oppR = r + (sc===1?-20:sc===0?20:0);
        const exp = 1/(1+Math.pow(10,(oppR-r)/400));
        const delta = Math.round(K*(sc-exp));
        r = Math.max(100, r-delta);
        rHist.unshift(r);
      });
      _drawProfileRatingChart(rHist);
    }

    // Таблица колебаний
    _buildRatingTable(games, u.username, u.rating);

    // Активность
    _loadProfileActivity(u.username, games);

    // Перепроверяем онлайн
    const recheckOnline = async (n) => {
      try {
        const u2 = await apiGet('/users/' + encodeURIComponent(username));
        const el = document.getElementById('profile-online-status');
        if (el) el.innerHTML = u2.online
          ? '<span style="color:var(--green)">● онлайн</span>'
          : '<span style="color:var(--text-muted)">● оффлайн</span>';
        if (u2.online || n>=3) return;
      } catch {}
      setTimeout(()=>recheckOnline(n+1), 2000);
    };
    setTimeout(()=>recheckOnline(1), 800);

  } catch(e) {
    _profileShow('profile-notfound');
  }
}

async function loadProfileGames(username, limit=50, append=false) {
  const listEl = document.getElementById('profile-games-list');
  if (!append && listEl) listEl.innerHTML = '<div style="text-align:center;color:var(--text-muted);padding:20px 0"><div class="spinner" style="margin:0 auto 10px;width:20px;height:20px"></div></div>';

  try {
    const games = await apiGet('/users/' + encodeURIComponent(username) + '/games?limit=' + limit);

    if (!games || !games.length) {
      if (listEl && !append) listEl.innerHTML = '<div style="text-align:center;color:var(--text-muted);padding:24px 0;font-size:14px">Партий пока нет</div>';
      return games || [];
    }

    if (listEl) {
      if (!append) listEl.innerHTML = '';
      games.forEach(g => {
        const isWhite  = g.white === username;
        const myColor  = isWhite ? 'white' : 'black';
        const opponent = isWhite ? g.black : g.white;
        let icon, color, label;
        if (g.result === 'draw')       { icon='½'; color='var(--text-secondary)'; label='Ничья'; }
        else if (g.result === myColor) { icon='✓'; color='var(--green)';          label='Победа'; }
        else                           { icon='✗'; color='var(--red)';             label='Поражение'; }

        const halfMoves = g.moves ? g.moves.length : 0;
        const moveCnt   = Math.floor(halfMoves / 2);
        const date = (g.endedAt||g.createdAt) ? new Date(g.endedAt||g.createdAt).toLocaleDateString('ru',{day:'2-digit',month:'2-digit',year:'2-digit'}) : '—';

        const row = document.createElement('div');
        row.style.cssText = 'display:flex;align-items:center;gap:12px;padding:10px 8px;border-radius:8px;cursor:pointer;border-bottom:1px solid var(--border);transition:background 0.15s';
        row.onmouseenter = () => row.style.background = 'var(--bg-hover)';
        row.onmouseleave = () => row.style.background = '';
        row.innerHTML = `
          <div style="width:28px;height:28px;border-radius:50%;background:${color}22;display:flex;align-items:center;justify-content:center;font-size:15px;font-weight:700;color:${color};flex-shrink:0">${icon}</div>
          <div style="flex:1;min-width:0">
            <div style="font-weight:600;font-size:14px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">
              ${escapeHtml(isWhite?'♙ ':'♟ ')}${escapeHtml(username)} <span style="color:var(--text-muted);font-weight:400">vs</span>
              <a href="/profile/${encodeURIComponent(opponent)}" style="color:var(--accent);text-decoration:none" onclick="event.stopPropagation()">${escapeHtml(opponent||'?')}</a>
            </div>
            <div style="font-size:12px;color:var(--text-muted);margin-top:2px">${escapeHtml(g.timeControl||'?')} · ${moveCnt} ход${moveCnt===1?'':moveCnt<5?'а':'ов'} · ${date}</div>
          </div>
          <div style="font-size:12px;font-weight:600;color:${color};flex-shrink:0">${label}</div>
          <div style="color:var(--text-muted);font-size:16px;flex-shrink:0">›</div>`;
        row.addEventListener('click', () => _openGameFromProfile(g));
        listEl.appendChild(row);
      });

      // Load more button
      const moreEl = document.getElementById('profile-games-more');
      const moreBtn = document.getElementById('profile-btn-more-games');
      if (moreEl) moreEl.style.display = games.length >= limit ? '' : 'none';
      if (moreBtn && !moreBtn._bound) {
        moreBtn._bound = true;
        moreBtn.addEventListener('click', async () => {
          moreBtn.textContent = 'Загрузка...'; moreBtn.disabled = true;
          await loadProfileGames(username, 20, true);
          moreBtn.textContent = 'Загрузить ещё'; moreBtn.disabled = false;
        });
      }
    }

    return games;
  } catch(e) {
    if (listEl && !append) listEl.innerHTML = '<div style="text-align:center;color:var(--text-muted);padding:24px 0;font-size:14px">Не удалось загрузить историю</div>';
    return [];
  }
}

pages['profile'] = () => {
  if (currentUser && currentUser.username) {
    window.location.href = '/profile/' + encodeURIComponent(currentUser.username);
  } else {
    window.location.href = '/profile';
  }
};

// ─── ИГРОВАЯ СТРАНИЦА ─────────────────────────────────────────
pages['game'] = () => {
  if (!chessBoard.gameId) chessBoard.newLocalGame();
};

// ─── ГЛАВНАЯ ──────────────────────────────────────────────────
pages['home'] = () => {
  initGlobalChat();
};

// ─── АНАЛИЗ ───────────────────────────────────────────────────
let _loadingGameIntoAnalysis = false;

pages['analysis'] = () => {
  if (!StockfishAnalyzer.isReady()) StockfishAnalyzer.init();

  const savedGame = localStorage.getItem('ch_analysis_game');
  if (savedGame) {
    localStorage.removeItem('ch_analysis_game');
    try {
      const game = JSON.parse(savedGame);
      _loadingGameIntoAnalysis = true;
      setTimeout(() => {
        _loadingGameIntoAnalysis = false;
        loadGameIntoAnalysis(game);
      }, 80);
      return;
    } catch(e) {}
  }
  chessBoard.loadAnalysis();
};

function loadGameIntoAnalysis(game) {
  if (!game.moves || !game.moves.length) {
    chessBoard.loadAnalysis();
    return;
  }
  chessBoard.loadGameMoves(game.moves);
  toast(`Партия: ${game.white || '?'} vs ${game.black || '?'} · ${Math.floor(game.moves.length / 2)} ходов`, 'success');
}

// ─── ПРОЧЕЕ ───────────────────────────────────────────────────
function escapeHtml(s) {
  if (!s) return '';
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

function setBoardTheme(light, dark) {
  document.documentElement.style.setProperty('--board-light', light);
  document.documentElement.style.setProperty('--board-dark',  dark);
  saveSetting('boardLight', light);
  saveSetting('boardDark',  dark);
  chessBoard.render();
  toast('Тема доски изменена', 'success');
}

function loadAnalysisFEN() {
  const fen = document.getElementById('analysis-fen-input')?.value?.trim();
  if (!fen) return;
  chessBoard.loadFEN(fen);
  if (document.getElementById('analysis-current-fen'))
    document.getElementById('analysis-current-fen').textContent = fen;
  setTimeout(() => StockfishAnalyzer.analyze(fen, 20), 100);
  toast('Позиция загружена', 'success');
}

setInterval(() => {
  const el = document.getElementById('analysis-current-fen');
  if (el && document.getElementById('page-analysis')?.classList.contains('active')) {
    el.textContent = chessBoard.getFEN();
  }
}, 2000);

function loadPGN() {
  const pgn = document.getElementById('pgn-input')?.value?.trim();
  if (!pgn) return;
  try {
    let state = ChessEngine.parseFEN(ChessEngine.START_FEN);
    const movesText = pgn.replace(/\[.*?\]\s*/g,'').trim();
    const cleaned   = movesText.replace(/\{[^}]*\}/g,'').replace(/\([^)]*\)/g,'');
    const tokens    = cleaned.split(/\s+/).filter(t => t && !t.match(/^\d+\./) && !['*','1-0','0-1','1/2-1/2'].includes(t));
    const histStates = [ChessEngine.deepClone(state)];
    for (const token of tokens) {
      const moves = ChessEngine.allLegalMoves(state);
      const found = moves.find(m => ChessEngine.toSAN(state, m) === token);
      if (!found) { toast('Не удалось распознать ход: ' + token, 'error'); break; }
      const san = ChessEngine.toSAN(state, found);
      state = ChessEngine.applyMove(state, found);
      state.history = [...histStates[histStates.length-1].history, { ...found, san }];
      histStates.push(ChessEngine.deepClone(state));
    }
    chessBoard.loadFEN(ChessEngine.toFEN(histStates[0]));
    toast(`PGN загружен: ${tokens.length} ходов`, 'success');
  } catch(e) { toast('Ошибка загрузки PGN', 'error'); console.error(e); }
}



// ─── РЕПОРТЫ ──────────────────────────────────────────────────
function showReportModal(targetUsername) {
  let modal = document.getElementById('modal-report');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'modal-report';
    modal.className = 'modal-overlay';
    document.body.appendChild(modal);
    modal.addEventListener('click', e => { if (e.target === modal) modal.classList.remove('open'); });
  }

  modal.innerHTML = '';
  const box = document.createElement('div');
  box.className = 'modal';
  box.style.cssText = 'position:relative;max-width:420px';

  const closeBtn = document.createElement('button');
  closeBtn.className = 'modal-close';
  closeBtn.textContent = '✕';
  closeBtn.onclick = () => modal.classList.remove('open');
  box.appendChild(closeBtn);

  const title = document.createElement('h2');
  title.style.cssText = 'font-family:var(--font-display);font-size:20px;margin-bottom:8px';
  title.textContent = '🚩 Жалоба на ' + targetUsername;
  box.appendChild(title);

  const sub = document.createElement('p');
  sub.style.cssText = 'color:var(--text-secondary);font-size:13px;margin-bottom:20px';
  sub.textContent = 'Администратор рассмотрит вашу жалобу';
  box.appendChild(sub);

  // Причина
  const reasonLabel = document.createElement('div');
  reasonLabel.className = 'form-label';
  reasonLabel.textContent = 'Причина жалобы';
  box.appendChild(reasonLabel);

  const reasonSel = document.createElement('select');
  reasonSel.className = 'form-input';
  reasonSel.style.marginBottom = '14px';
  [
    ['cheat',     '🤖 Использование читов/движка'],
    ['abuse',     '🤬 Оскорбления в чате'],
    ['disconnect','🔌 Намеренные дисконнекты'],
    ['multiaccounting', '👥 Мульти-аккаунтинг'],
    ['spam',      '📢 Спам'],
    ['other',     '❓ Другое'],
  ].forEach(([val, label]) => {
    const opt = document.createElement('option');
    opt.value = val; opt.textContent = label;
    reasonSel.appendChild(opt);
  });
  box.appendChild(reasonSel);

  // Детали
  const detailsLabel = document.createElement('div');
  detailsLabel.className = 'form-label';
  detailsLabel.textContent = 'Подробности (необязательно)';
  box.appendChild(detailsLabel);

  const detailsArea = document.createElement('textarea');
  detailsArea.className = 'form-input';
  detailsArea.rows = 3;
  detailsArea.placeholder = 'Опишите ситуацию...';
  detailsArea.maxLength = 500;
  detailsArea.style.cssText = 'resize:vertical;margin-bottom:20px';
  box.appendChild(detailsArea);

  // Кнопки
  const btns = document.createElement('div');
  btns.style.cssText = 'display:flex;gap:10px;justify-content:flex-end';

  const cancelBtn = document.createElement('button');
  cancelBtn.className = 'btn btn-ghost';
  cancelBtn.textContent = 'Отмена';
  cancelBtn.onclick = () => modal.classList.remove('open');

  const submitBtn = document.createElement('button');
  submitBtn.className = 'btn btn-primary';
  submitBtn.textContent = 'Отправить жалобу';
  submitBtn.addEventListener('click', async () => {
    submitBtn.disabled = true;
    submitBtn.textContent = 'Отправка...';
    try {
      await apiPost('/report', {
        targetUsername,
        reason: reasonSel.value,
        details: detailsArea.value.trim()
      });
      modal.classList.remove('open');
      toast('Жалоба отправлена. Спасибо!', 'success');
    } catch(e) {
      toast(e.message || 'Ошибка', 'error');
      submitBtn.disabled = false;
      submitBtn.textContent = 'Отправить жалобу';
    }
  });

  btns.appendChild(cancelBtn);
  btns.appendChild(submitBtn);
  box.appendChild(btns);

  modal.appendChild(box);
  modal.classList.add('open');
}

// ─── АДМИН ПАНЕЛЬ ─────────────────────────────────────────────
pages['admin'] = async () => {
  // Проверка на клиенте — быстрый фильтр UI
  if (!currentUser || currentUser.role !== 'admin') {
    showPage('home'); return;
  }
  // Дополнительная серверная проверка: убеждаемся что роль не подделана локально
  try {
    const me = await apiGet('/me');
    if (!me || me.role !== 'admin') { currentUser = null; updateAuthUI(); showPage('home'); return; }
  } catch { showPage('home'); return; }
  await adminLoadUsers();
};

async function adminLoadUsers() {
  const listEl = document.getElementById('admin-users-list');
  const countEl = document.getElementById('admin-users-count');
  if (!listEl) return;
  try {
    const users = await apiGet('/admin/users');
    if (countEl) countEl.textContent = '(' + users.length + ')';
    renderAdminUserList(users, listEl);
  } catch {
    // НЕ используем leaderboard как fallback — это утечка данных
    listEl.innerHTML = '<div class="empty-state"><p>Нет доступа или ошибка загрузки</p></div>';
  }
}

function renderAdminUserList(users, container) {
  if (!users.length) {
    container.innerHTML = '<div class="empty-state"><p>Нет пользователей</p></div>';
    return;
  }
  // Строим через DOM — никаких вложенных template literals
  container.innerHTML = '';
  users.forEach(u => {
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;align-items:center;gap:12px;padding:10px 0;border-bottom:1px solid var(--border)';

    // Аватар
    const avatar = document.createElement('div');
    avatar.className = 'player-avatar';
    avatar.style.cssText = 'width:36px;height:36px;font-size:15px;cursor:pointer;flex-shrink:0';
    avatar.textContent = u.username[0].toUpperCase();
    avatar.addEventListener('click', () => openUserProfile(u.username));
    row.appendChild(avatar);

    // Инфо
    const info = document.createElement('div');
    info.style.flex = '1';
    const nameEl = document.createElement('div');
    nameEl.style.cssText = 'font-weight:600;font-size:14px';
    nameEl.textContent = u.username;
    if (u.role === 'admin') {
      const badge = document.createElement('span');
      badge.style.cssText = 'color:var(--accent);font-size:11px;margin-left:6px';
      badge.textContent = 'ADMIN';
      nameEl.appendChild(badge);
    }
    if (u.banned) {
      const ban = document.createElement('span');
      ban.style.cssText = 'color:var(--red);font-size:11px;margin-left:6px';
      ban.textContent = 'БАН';
      nameEl.appendChild(ban);
    }
    const statsEl = document.createElement('div');
    statsEl.style.cssText = 'font-size:12px;color:var(--text-muted)';
    statsEl.textContent = '★' + u.rating + ' · ' + u.gamesPlayed + ' партий · ' + u.wins + 'W/' + u.losses + 'L';
    info.appendChild(nameEl);
    info.appendChild(statsEl);
    row.appendChild(info);

    // Кнопки
    const btns = document.createElement('div');
    btns.style.cssText = 'display:flex;gap:6px';
    if (u.username === currentUser.username) {
      const self = document.createElement('span');
      self.style.cssText = 'color:var(--text-muted);font-size:12px';
      self.textContent = 'это вы';
      btns.appendChild(self);
    } else if (u.banned) {
      const unbanBtn = document.createElement('button');
      unbanBtn.className = 'btn btn-secondary btn-sm';
      unbanBtn.textContent = '✅ Разбан';
      unbanBtn.addEventListener('click', async () => { await adminUnban(u.username); adminLoadUsers(); });
      btns.appendChild(unbanBtn);
    } else {
      const banBtn = document.createElement('button');
      banBtn.className = 'btn btn-danger btn-sm';
      banBtn.textContent = '🚫 Бан';
      banBtn.addEventListener('click', () => adminBanInline(u.username));
      btns.appendChild(banBtn);
    }
    row.appendChild(btns);
    container.appendChild(row);
  });
}

async function adminBanInline(username) {
  const reason = prompt('Причина бана ' + username + ':', 'Нарушение правил');
  if (reason === null) return;
  try {
    await apiPost('/admin/ban', { username, reason });
    toast(username + ' заблокирован', 'success');
    await adminLoadUsers();
  } catch (e) { toast(e.message, 'error'); }
}

let adminSearchTimer = null;
async function adminSearchUsers(q) {
  clearTimeout(adminSearchTimer);
  const resultsEl = document.getElementById('admin-search-results');
  if (!resultsEl) return;
  if (!q || q.length < 1) { resultsEl.innerHTML = ''; return; }
  adminSearchTimer = setTimeout(async () => {
    try {
      const users = await apiGet('/users/search?q=' + encodeURIComponent(q));
      renderAdminUserList(users, resultsEl);
    } catch {}
  }, 250);
}


// ─── РЕДЖОЙН БАННЕР ───────────────────────────────────────────
let _rejoinData = null;

function showRejoinBanner(data) {
  data._rejoinReceivedAt = Date.now(); // фиксируем момент получения данных
  _rejoinData = data;
  const banner = document.getElementById('rejoin-banner');
  const info   = document.getElementById('rejoin-info');
  if (!banner) return;
  const moves = data.moves ? data.moves.length : 0;
  const colorRu = data.color === 'white' ? 'Белые ♙' : 'Чёрные ♟';
  if (info) info.textContent = `Соперник: ${data.opponent} · ${colorRu} · ${moves} ход${moves === 1 ? '' : moves < 5 ? 'а' : 'ов'} сыграно`;
  banner.style.display = 'flex';
  // Автоскрыть через 30 секунд
  clearTimeout(banner._timer);
  banner._timer = setTimeout(hideRejoinBanner, 30000);
}

function hideRejoinBanner() {
  const banner = document.getElementById('rejoin-banner');
  if (banner) banner.style.display = 'none';
  clearTimeout(banner?._timer);
}

function doRejoin() {
  if (!_rejoinData) return;
  const data = _rejoinData;
  _rejoinData = null;
  _currentGameData = data; // сохраняем для повторного реджойна при уходе со страницы
  hideRejoinBanner();

  // Корректируем оставшееся время: пока юзер смотрел на баннер — время шло
  if (data._rejoinReceivedAt && data.whiteTime !== undefined) {
    const elapsed = (Date.now() - data._rejoinReceivedAt) / 1000;
    // turn: белые ходят на нечётных полуходах (1,3,5...), чёрные на чётных
    const isWhiteTurn = (data.moves?.length ?? 0) % 2 === 0;
    if (isWhiteTurn) data.whiteTime = Math.max(0, data.whiteTime - elapsed);
    else             data.blackTime = Math.max(0, data.blackTime - elapsed);
  }

  toast(`Игра восстановлена! Вы ${data.color === 'white' ? 'белые ♙' : 'чёрные ♟'}`, 'success');

  // 1. Переключаем страницу синхронно
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-links a').forEach(a => a.classList.remove('active'));
  const gameEl = document.getElementById('page-game');
  if (gameEl) gameEl.classList.add('active');
  history.pushState({}, '', '/game/' + (data.gameId || ''));

  // Рейтинги
  const myRating  = currentUser ? currentUser.rating : '?';
  const oppRating = data.opponentRating || '?';
  const topEl    = document.getElementById('rating-top');
  const bottomEl = document.getElementById('rating-bottom');
  if (topEl)    topEl.textContent    = 'Рейтинг: ' + oppRating;
  if (bottomEl) bottomEl.textContent = 'Рейтинг: ' + myRating;

  // 2. Ждём 50ms — за это время браузер гарантированно применит display к странице
  setTimeout(() => {
    // Убеждаемся что #chess-board в правильном контейнере
    const container = document.getElementById('game-board-container');
    const boardEl   = document.getElementById('chess-board');
    if (boardEl && container && boardEl.parentElement !== container) {
      container.appendChild(boardEl);
    }

    // 3. Запускаем игру (применяет ходы, таймер, рендер)
    chessBoard.startGame(data);

    // 4. Сообщаем серверу что мы снова в игре (обновляет socket в сессии)
    if (socket?.connected && data.gameId) {
      socket.emit('rejoin_game', { gameId: data.gameId });
    }

    // 5. Дополнительные рендеры с нарастающими задержками — страховка
    setTimeout(() => chessBoard.render(), 50);
    setTimeout(() => chessBoard.render(), 200);
  }, 50);
}

// ─── СПИСОК ОНЛАЙН ────────────────────────────────────────────
async function openOnlineUsersPage() {
  window.location.href = '/online';
}

async function renderOnlineUsersList() {
  const listEl    = document.getElementById('online-users-list');
  const subtitleEl = document.getElementById('online-modal-subtitle');
  if (!listEl) return;
  try {
    const users = await apiGet('/online/users');
    if (subtitleEl) subtitleEl.textContent = users.length + ' ' + (users.length === 1 ? 'игрок' : users.length < 5 ? 'игрока' : 'игроков');
    if (!users.length) {
      listEl.innerHTML = '<div style="text-align:center;color:var(--text-muted);padding:32px 0;font-size:14px">Никого нет онлайн</div>';
      return;
    }
    listEl.innerHTML = '';
    users.forEach(u => {
      const row = document.createElement('div');
      row.style.cssText = 'display:flex;align-items:center;gap:12px;padding:10px 8px;border-radius:8px;cursor:pointer;transition:background 0.15s';
      row.onmouseenter = () => { row.style.background = 'var(--bg-hover)'; };
      row.onmouseleave = () => { row.style.background = ''; };
      row.addEventListener('click', () => {
        document.getElementById('modal-online-users').style.display = 'none';
        openUserProfile(u.username);
      });

      // Аватар
      const av = document.createElement('div');
      av.className = 'player-avatar';
      av.style.cssText = 'width:38px;height:38px;font-size:16px;flex-shrink:0';
      av.textContent = u.username[0].toUpperCase();
      row.appendChild(av);

      // Имя + рейтинг
      const info = document.createElement('div');
      info.style.flex = '1';
      const nameEl = document.createElement('div');
      nameEl.style.cssText = 'font-weight:600;font-size:14px;display:flex;align-items:center;gap:6px';
      nameEl.textContent = u.username;
      if (u.role === 'admin') {
        const badge = document.createElement('span');
        badge.style.cssText = 'background:rgba(201,168,76,0.15);color:var(--accent);font-size:10px;font-weight:700;padding:1px 5px;border-radius:3px';
        badge.textContent = 'ADMIN';
        nameEl.appendChild(badge);
      }
      const ratingEl = document.createElement('div');
      ratingEl.style.cssText = 'font-size:12px;color:var(--text-muted);margin-top:2px';
      ratingEl.textContent = '★ ' + (u.rating || '—');
      info.appendChild(nameEl);
      info.appendChild(ratingEl);
      row.appendChild(info);

      // Онлайн-индикатор
      const dot = document.createElement('div');
      dot.style.cssText = 'width:8px;height:8px;border-radius:50%;background:#2ecc71;box-shadow:0 0 6px #2ecc71';
      row.appendChild(dot);

      listEl.appendChild(row);
    });
  } catch {
    if (listEl) listEl.innerHTML = '<div style="text-align:center;color:var(--text-muted);padding:32px 0">Не удалось загрузить список</div>';
  }
}

// ──────────────────────────────────────────────────────────────
//  QUESTS (Сезон 2)
// ──────────────────────────────────────────────────────────────
let currentQuestsPage = 1;
let questsTotalPages = 1;
let userCrystals = 0;
let availableQuestId = null;
let canDoToday = false;



// Привязка событий (после загрузки DOM)
document.addEventListener('DOMContentLoaded', () => {
    const prevBtn = document.getElementById('quests-prev-page');
    const nextBtn = document.getElementById('quests-next-page');
    const claimBtn = document.getElementById('quests-claim-btn');
    if (prevBtn) prevBtn.addEventListener('click', () => {
        if (currentQuestsPage > 1) loadQuests(currentQuestsPage - 1);
    });
    if (nextBtn) nextBtn.addEventListener('click', () => {
        if (currentQuestsPage < questsTotalPages) loadQuests(currentQuestsPage + 1);
    });
    if (claimBtn) claimBtn.addEventListener('click', claimQuest);
});

// ─── INIT ──────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {

  // Клик по бейджу онлайн → страница /online
  document.body.addEventListener('click', (e) => {
    const badge = e.target.closest('#ch-online-badge, #online-badge-btn, .online-badge');
    if (badge) {
      e.stopPropagation();
      e.preventDefault();
      window.location.href = '/online';
    }
  });
  applySettings();

  // Регистрируем puzzle страницы ДО showPage
  pages['puzzles'] = () => {
  loadPuzzlesPage();
  // Ждём полной отрисовки и сносим отступ у #app с !important
  setTimeout(() => {
    const app = document.getElementById('app');
    if (app) {
      app.style.setProperty('padding-top', '0', 'important');
      app.style.setProperty('margin-top', '0', 'important');
    }
    // Дополнительно убираем отступы у самой страницы задач
    const puzzlesPage = document.getElementById('page-puzzles');
    if (puzzlesPage) {
      puzzlesPage.style.setProperty('margin-top', '0', 'important');
      puzzlesPage.style.setProperty('padding-top', '0', 'important');
    }
    // Если есть пустой .page-header – скрываем его
    const header = document.querySelector('#page-puzzles .page-header');
    if (header && header.innerText.trim() === '') {
      header.style.display = 'none';
    }
  }, 150);
};
  pages['puzzle-topic']       = () => {};
  pages['puzzle-solve']       = () => {};
  pages['puzzle-leaderboard'] = loadPuzzleLeaderboardFull;
  pages['storm']             = () => { location.href = '/storm.html'; };
  pages['storm-leaderboard'] = () => { location.href = '/storm.html?tab=leaderboard'; };
  pages['appeal']            = () => { if (typeof loadMyAppeals === 'function') loadMyAppeals(); };

  // fetchOnline не должна блокировать если сервер медленно отвечает
  fetchOnline().catch(() => {});

  await tryAutoLogin();
  updateAuthUI();

  const rawPath = location.pathname.replace(/^\//, '') || 'home';
  const validPages = ['home','game','analysis','editor','lobby','settings','privacy','terms','about','faq','profile','admin','appeal','puzzles','puzzle-topic','puzzle-solve','puzzle-leaderboard'];

  // Поддержка /profile/Username
  let targetPage;
  if (rawPath === 'profile' || rawPath.startsWith('profile/')) {
    targetPage = 'profile';
    // Извлекаем username из пути если есть
    const parts = rawPath.split('/');
    if (parts[1]) window._profileTarget = decodeURIComponent(parts[1]);
    else window._profileTarget = null;
  } else if (rawPath === 'puzzles' || rawPath.startsWith('puzzles/')) {
    targetPage = 'puzzles';
  } else if (rawPath === 'forum' || rawPath.startsWith('forum/')) {
    // Форум — отдельная страница, ничего не делаем
    targetPage = null;
  } else if (rawPath.startsWith('game/')) {
    // /game/UUID — показываем страницу игры, реджойн придёт через сокет
    targetPage = 'game';
    window._pendingGameId = rawPath.split('/')[1] || null;
  } else {
    targetPage = validPages.includes(rawPath) ? rawPath : 'home';
  }

  if (targetPage) {
    showPage(targetPage);
  }



  document.querySelectorAll('[data-page]').forEach(el => {
    el.addEventListener('click', e => { e.preventDefault(); showPage(el.dataset.page); });
  });

  // Запуск турнирной игры из sessionStorage (после отсчёта на странице турнира)
  try {
    const raw = sessionStorage.getItem('ch_launch_game');
    if (raw) {
      sessionStorage.removeItem('ch_launch_game');
      const gameData = JSON.parse(raw);
      if (gameData && gameData.gameId) {
        // Показываем страницу игры
        document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
        const gameEl = document.getElementById('page-game');
        if (gameEl) gameEl.classList.add('active');
        history.replaceState({}, '', '/game/' + gameData.gameId);
        // Запускаем игру после того как сокет подключится
        const launchWhenReady = () => {
          if (socket && socket.connected && typeof chessBoard !== 'undefined') {
            if (gameData.moves && gameData.moves.length > 0) {
              // Реджойн
              chessBoard.startGame(gameData);
              socket.emit('rejoin_game', { gameId: gameData.gameId });
            } else {
              startGameUI(gameData);
              if (gameData.tournamentId) {
                setTimeout(() => showTournamentReturnBanner(gameData.tournamentId, gameData.tournamentName), 300);
              }
            }
          } else {
            setTimeout(launchWhenReady, 100);
          }
        };
        setTimeout(launchWhenReady, 200);
      }
    }
  } catch(e) { console.warn('ch_launch_game parse error', e); }

  setInterval(fetchOnline, 10000);
});
// ══════════════════════════════════════════════════════════════
//  PUZZLE MODULE
// ══════════════════════════════════════════════════════════════

const PUZZLE_PIECE_IMG = {
  wk:'wK',wq:'wQ',wr:'wR',wb:'wB',wn:'wN',wp:'wP',
  bk:'bK',bq:'bQ',br:'bR',bb:'bB',bn:'bN',bp:'bP',
};

const pz = {
  puzzle:null, topic:null, topicList:[], idx:0,
  board:[], flipped:false, solved:false, selected:null,
  lastMove:null, playerTurn:null, difficulty:'', offset:0,
  _dailyPuzzle:null,
  // История позиций для навигации стрелками
  _history:[],       // [{board, lastMove, label}]
  _historyIdx:-1,    // -1 = текущая позиция
  _legalDests:{},    // {fromSq: [toSq,...]} — легальные ходы текущей позиции
  _failed:false,     // была ли ошибка в текущей задаче
};

function pzFenToBoard(fen) {
  const board = Array(64).fill(null);
  const rows = fen.split(' ')[0].split('/');
  for (let r = 0; r < 8; r++) {
    let f = 0;
    for (const ch of rows[r]) {
      if (ch >= '1' && ch <= '8') { f += +ch; }
      else { board[(7-r)*8+f] = { color: ch===ch.toUpperCase()?'w':'b', type: ch.toLowerCase() }; f++; }
    }
  }
  return board;
}
function pzBoardTurn(fen) { return (fen.split(' ')[1]||'w'); }
function pzSqToUCI(sq) { return 'abcdefgh'[sq%8]+(Math.floor(sq/8)+1); }

function pzRender() {
  const el = document.getElementById('puzzle-board');
  if (!el) return;
  const sqSize = Math.floor((el.offsetWidth||360)/8);

  // Если просматриваем историю — берём ту позицию
  const viewingHistory = pz._historyIdx >= 0 && pz._historyIdx < pz._history.length;
  const displayBoard   = viewingHistory ? pz._history[pz._historyIdx].board   : pz.board;
  const displayLast    = viewingHistory ? pz._history[pz._historyIdx].lastMove : pz.lastMove;

  el.innerHTML = '';
  for (let i = 0; i < 64; i++) {
    const sq = pz.flipped
      ? (7 - i%8) + Math.floor(i/8)*8
      : (56 - Math.floor(i/8)*8 + i%8);
    const r = Math.floor(sq/8), f = sq%8;
    const light = (r+f)%2!==0;
    const isSelected  = !viewingHistory && pz.selected===sq;
    const isLastMove  = displayLast && (displayLast.from===sq || displayLast.to===sq);
    const legalDests  = !viewingHistory ? (pz._legalDests[sq] || []) : [];
    const isLegalDest = !viewingHistory && pz.selected !== null && (pz._legalDests[pz.selected]||[]).includes(sq);
    const piece       = displayBoard[sq];
    const isCapture   = isLegalDest && !!piece;

    let bg = light ? 'var(--board-light,#f0d9b5)' : 'var(--board-dark,#b58863)';
    if (isSelected)       bg = 'rgba(100,200,100,0.7)';
    else if (isLastMove)  bg = light ? 'rgba(205,210,106,0.85)' : 'rgba(170,162,58,0.85)';

    const div = document.createElement('div');
    div.style.cssText = `position:relative;display:flex;align-items:center;justify-content:center;cursor:pointer;background:${bg};`;

    // Подсветка легальных ходов (кружок или рамка при взятии)
    if (isLegalDest) {
      const hint = document.createElement('div');
      if (isCapture) {
        hint.style.cssText = `position:absolute;inset:0;border-radius:50%;box-shadow:inset 0 0 0 4px rgba(0,0,0,0.35);pointer-events:none;z-index:1;`;
      } else {
        const r = Math.floor(sqSize*0.27);
        hint.style.cssText = `position:absolute;width:${r*2}px;height:${r*2}px;border-radius:50%;background:rgba(0,0,0,0.22);pointer-events:none;z-index:1;`;
      }
      div.appendChild(hint);
    }

    if (piece) {
      const imgName = PUZZLE_PIECE_IMG[piece.color+piece.type];
      if (imgName) {
        const img = document.createElement('img');
        img.src = '/img/pieces/' + imgName + '.svg';
        img.style.cssText = 'position:relative;z-index:2;width:'+Math.floor(sqSize*0.85)+'px;height:'+Math.floor(sqSize*0.85)+'px;pointer-events:none;user-select:none;display:block;';
        img.draggable = false;
        div.appendChild(img);
      }
    }

    // Координаты (буква внизу по краю, цифра слева по краю)
    const isFirstFile = pz.flipped ? f === 7 : f === 0;
    const isLastRank  = pz.flipped ? r === 7 : r === 0;
    const coordColor  = light ? 'var(--board-dark,#b58863)' : 'var(--board-light,#f0d9b5)';
    if (isFirstFile) {
      const label = document.createElement('span');
      label.style.cssText = `position:absolute;top:2px;left:3px;font-size:${Math.max(9,sqSize*0.18)}px;font-weight:700;color:${coordColor};line-height:1;z-index:3;pointer-events:none;`;
      label.textContent = Math.floor(sq/8)+1;
      div.appendChild(label);
    }
    if (isLastRank) {
      const label = document.createElement('span');
      label.style.cssText = `position:absolute;bottom:2px;right:3px;font-size:${Math.max(9,sqSize*0.18)}px;font-weight:700;color:${coordColor};line-height:1;z-index:3;pointer-events:none;`;
      label.textContent = 'abcdefgh'[sq%8];
      div.appendChild(label);
    }

    if (!viewingHistory) {
      div.addEventListener('click', () => pzClickSquare(sq));
    }
    el.appendChild(div);
  }

  // Обновляем кнопки навигации (стрелки)
  pzUpdateNavArrows();
}

// Вычисляем реальные легальные ходы через ChessEngine
function pzComputeLegalDests() {
  pz._legalDests = {};
  if (!pz.puzzle || !pz.playerTurn) return;

  try {
    // Строим состояние: парсим FEN задачи и применяем все ходы из истории
    let state = ChessEngine.parseFEN(pz.puzzle.fen);
    for (const h of pz._history) {
      const moves = ChessEngine.legalMoves(state, h.lastMove.from);
      const m = moves.find(mv => mv.to === h.lastMove.to);
      if (m) state = ChessEngine.applyMove(state, m);
    }

    // Для каждой своей фигуры получаем легальные ходы
    for (let sq = 0; sq < 64; sq++) {
      const piece = state.board ? state.board[sq] : (pz.board[sq]);
      // Проверяем что это фигура игрока
      const p = pz.board[sq];
      if (!p || p.color !== pz.playerTurn) continue;

      const moves = ChessEngine.legalMoves(state, sq);
      if (moves && moves.length) {
        pz._legalDests[sq] = moves.map(m => m.to);
      }
    }
  } catch(e) {
    console.warn('[pzComputeLegalDests] fallback:', e.message);
    // Fallback — хотя бы запрещаем ход на свои фигуры
    for (let sq = 0; sq < 64; sq++) {
      const p = pz.board[sq];
      if (!p || p.color !== pz.playerTurn) continue;
      const dests = [];
      for (let to = 0; to < 64; to++) {
        if (to === sq) continue;
        const t = pz.board[to];
        if (t && t.color === pz.playerTurn) continue;
        dests.push(to);
      }
      pz._legalDests[sq] = dests;
    }
  }
}

function pzClickSquare(sq) {
  if (!pz.puzzle || pz.solved || pz._autoPlaying) return;
  if (pz._historyIdx >= 0) return; // в режиме просмотра истории — ходить нельзя

  const piece = pz.board[sq];

  if (pz.selected === null) {
    // Выбираем фигуру — только свою
    if (piece && piece.color === pz.playerTurn) {
      pz.selected = sq;
      pzRender();
    }
  } else {
    const from = pz.selected;

    // Клик на ту же фигуру — снимаем выделение
    if (from === sq) { pz.selected = null; pzRender(); return; }

    // Клик на другую свою фигуру — переключаемся на неё
    if (piece && piece.color === pz.playerTurn) {
      pz.selected = sq;
      pzRender();
      return;
    }

    // Проверяем что ход хотя бы формально возможен (не ходим на свою фигуру)
    const dests = pz._legalDests[from] || [];
    if (!dests.includes(sq)) {
      // Невозможный ход — просто снимаем выделение
      pz.selected = null;
      pzRender();
      return;
    }

    pz.selected = null;
    pzDoMove(from, sq);
  }
}

async function pzDoMove(from, to, promoChoice) {
  if (!pz.puzzle || pz.solved || pz._autoPlaying) return;

  // Определяем превращение пешки
  const movingPiece = pz.board[from];
  const toRank = Math.floor(to / 8);
  const isPromotion = movingPiece && movingPiece.type === 'p' &&
    ((movingPiece.color === 'w' && toRank === 7) ||
     (movingPiece.color === 'b' && toRank === 0));

  // Если превращение и выбор не указан — показываем диалог
  if (isPromotion && !promoChoice) {
    pzShowPromotionDialog(from, to);
    return;
  }

  const promo = isPromotion ? (promoChoice || 'q') : '';
  const move = pzSqToUCI(from) + pzSqToUCI(to) + promo;

  // Применяем ход на доске
  const nb = [...pz.board];
  nb[to] = isPromotion
    ? { color: movingPiece.color, type: promoChoice || 'q' }
    : nb[from];
  nb[from] = null;
  pz.board = nb; pz.lastMove = { from, to };
  // После хода игрока — теперь ходит соперник
  pz.playerTurn = pz.playerTurn === 'w' ? 'b' : 'w';

  // Пишем в историю
  pz._history.push({ board: [...pz.board], lastMove: { from, to }, label: move, byPlayer: true });
  pz._historyIdx = -1; // сбрасываем просмотр

  const ml = document.getElementById('puzzle-moves-list');
  if (ml) ml.textContent = (ml.textContent === '—' ? '' : ml.textContent + ' ') + move;
  pzRender();

  try {
    const res = await apiPost('/puzzles/' + pz.puzzle.id + '/move', { moveIndex: pz._moveIndex || 0, move });

    if (!res.correct) {
      // Неверный ход
      pz._failed = true;
      const fb = document.getElementById('puzzle-feedback');
      if (fb) { fb.style.display = 'block'; fb.className = 'puzzle-feedback wrong'; fb.textContent = '✗ Неверно — попробуй ещё раз'; }
      // Фиксируем поражение
      apiPost('/puzzles/' + pz.puzzle.id + '/attempt', { correct: false }).then(data => {
        // Показываем изменение рейтинга если есть
        if (data && data.ratingDelta && data.ratingDelta < 0) {
          const rc = document.getElementById('puzzle-rating-change');
          const rd = document.getElementById('puzzle-rating-delta');
          const rn = document.getElementById('puzzle-new-rating');
          if (rc) rc.style.display = 'block';
          if (rd) { rd.textContent = data.ratingDelta; rd.style.color = '#e74c3c'; }
          if (rn) rn.textContent = 'Рейтинг задач: ' + data.newPuzzleRating;
        }
      }).catch(() => {});
      setTimeout(() => {
        // Откатываем к позиции до неверного хода
        pz._history.pop();
        pz.board = pzFenToBoard(pz.puzzle.fen);
        // Восстанавливаем доску до текущего состояния (все правильные ходы до ошибки)
        for (const h of pz._history) {
          const nb2 = [...pz.board]; nb2[h.lastMove.to] = nb2[h.lastMove.from]; nb2[h.lastMove.from] = null;
          pz.board = nb2;
        }
        pz.lastMove = pz._history.length ? pz._history[pz._history.length-1].lastMove : null;
        pz.selected = null;
        pz._historyIdx = -1;
        // Восстанавливаем playerTurn: стартовый цвет + кол-во ходов игрока в истории
        const startTurn = pzBoardTurn(pz.puzzle.fen);
        const playerMovesCount = pz._history.filter(h => h.byPlayer).length;
        // Нечётное кол-во ходов игрока = сейчас ждём ответа соперника? Нет — в истории только законченные пары
        // Если последний ход в истории byPlayer=false (ответ соперника) — значит ходит игрок
        const lastH = pz._history[pz._history.length - 1];
        if (!lastH || !lastH.byPlayer) {
          // Ходит игрок (исходный цвет)
          pz.playerTurn = startTurn;
        } else {
          // Ходит соперник — но мы откатили ошибочный ход игрока, значит ходит игрок
          pz.playerTurn = startTurn;
        }
        // Проще: playerTurn всегда возвращается к исходному после отката
        // потому что история содержит только полные пары (ход игрока + ответ)
        pz.playerTurn = startTurn;
        // Поправка: если в истории нечётное число ходов (незавершённая пара) —
        // это ход соперника (byPlayer=false последний), значит снова ходит исходный цвет
        if (ml) ml.textContent = pz._history.filter(h=>h.byPlayer).map(h=>h.label).join(' ') || '—';
        if (fb) fb.style.display = 'none';
        pzComputeLegalDests();
        pzRender();
      }, 1200);
      return;
    }

    // Ход верный
    pz._moveIndex = (pz._moveIndex || 0) + 1;

    if (res.finished) {
      const data = await apiPost('/puzzles/' + pz.puzzle.id + '/attempt', { correct: true });
      pzShowSuccess(data);
      return;
    }

    // Ответный ход автомата
    if (res.autoMove) {
      pz._autoPlaying = true;
      const fb = document.getElementById('puzzle-feedback');
      if (fb) { fb.style.display = 'block'; fb.className = 'puzzle-feedback correct'; fb.textContent = '✓ Верно! Соперник отвечает...'; }
      setTimeout(() => {
        const autoFrom = pzUCIToSq(res.autoMove.slice(0, 2));
        const autoTo   = pzUCIToSq(res.autoMove.slice(2, 4));
        const autoPromo = res.autoMove.length === 5 ? res.autoMove[4] : null;
        const ab = [...pz.board];
        ab[autoTo] = autoPromo
          ? { color: ab[autoFrom] ? ab[autoFrom].color : 'w', type: autoPromo }
          : ab[autoFrom];
        ab[autoFrom] = null;
        pz.board = ab; pz.lastMove = { from: autoFrom, to: autoTo };
        // После хода соперника — снова ходит игрок
        pz.playerTurn = pz.playerTurn === 'w' ? 'b' : 'w';

        // Пишем ход соперника в историю
        pz._history.push({ board: [...pz.board], lastMove: { from: autoFrom, to: autoTo }, label: res.autoMove, byPlayer: false });

        if (ml) ml.textContent = (ml.textContent === '—' ? '' : ml.textContent + ' ') + res.autoMove;
        pz._autoPlaying = false;
        if (fb) fb.style.display = 'none';
        // После хода соперника — снова ход игрока, пересчитываем легальные
        pzComputeLegalDests();
        pzRender();
      }, 600);
    }
  } catch(e) {
    // Fallback: локальная проверка
    const sol = (pz.puzzle.solution || '').trim().split(/\s+/)[0].toLowerCase();
    if (move !== sol) {
      pz._failed = true;
      const fb = document.getElementById('puzzle-feedback');
      if (fb) { fb.style.display = 'block'; fb.className = 'puzzle-feedback wrong'; fb.textContent = '✗ Неверно — попробуй ещё раз'; }
      setTimeout(() => {
        pz._history.pop();
        pz.board = pzFenToBoard(pz.puzzle.fen); pz.lastMove = null; pz.selected = null;
        pz._historyIdx = -1;
        if (ml) ml.textContent = '—';
        if (fb) fb.style.display = 'none';
        pzComputeLegalDests();
        pzRender();
      }, 1200);
    } else {
      pzShowSuccess({ ratingDelta: 0 });
    }
  }
}

// Конвертация UCI-нотации (e2) в индекс клетки
// ── Диалог выбора фигуры при превращении пешки ───────────────
function pzShowPromotionDialog(from, to) {
  const old = document.getElementById('pz-promo-dialog');
  if (old) old.remove();

  const movingPiece = pz.board[from];
  const color = movingPiece ? movingPiece.color : 'w';
  const labelsW = { q:'♕ Ферзь', r:'♖ Ладья', b:'♗ Слон', n:'♘ Конь' };
  const labelsB = { q:'♛ Ферзь', r:'♜ Ладья', b:'♝ Слон', n:'♞ Конь' };
  const labels  = color === 'w' ? labelsW : labelsB;

  const overlay = document.createElement('div');
  overlay.id = 'pz-promo-dialog';
  overlay.style.cssText = 'position:fixed;inset:0;z-index:9999;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.6);';

  const box = document.createElement('div');
  box.style.cssText = 'background:var(--bg-card,#1e1e2e);border:2px solid var(--accent,#c9a84c);border-radius:16px;padding:24px 32px;text-align:center;box-shadow:0 8px 40px rgba(0,0,0,.7);';
  box.innerHTML = '<div style="font-size:16px;font-weight:700;margin-bottom:16px;color:var(--text-primary)">Превращение пешки</div>';

  const btns = document.createElement('div');
  btns.style.cssText = 'display:flex;gap:12px;justify-content:center;';
  ['q','r','b','n'].forEach(function(p) {
    const btn = document.createElement('button');
    btn.className = 'btn btn-secondary';
    btn.style.cssText = 'font-size:22px;min-width:64px;padding:10px 8px;cursor:pointer;';
    btn.textContent = labels[p];
    btn.addEventListener('click', function() { overlay.remove(); pzDoMove(from, to, p); });
    btns.appendChild(btn);
  });
  box.appendChild(btns);
  overlay.appendChild(box);
  overlay.addEventListener('click', function(e) {
    if (e.target === overlay) { overlay.remove(); pz.selected = null; pzRender(); }
  });
  document.body.appendChild(overlay);
}


function pzUCIToSq(uci) {
  const col = uci.charCodeAt(0) - 97; // a=0..h=7
  const row = parseInt(uci[1]) - 1;   // 1=0..8=7
  return row * 8 + col;
}

// ─── Навигация по истории ходов пазла (стрелки) ───────────────
function pzUpdateNavArrows() {
  const btnFirst = document.getElementById('pz-nav-first');
  const btnPrev  = document.getElementById('pz-nav-prev');
  const btnNext  = document.getElementById('pz-nav-next');
  const btnLast  = document.getElementById('pz-nav-last');
  const hasHistory = pz._history.length > 0;
  const atStart = pz._historyIdx === 0 || (!hasHistory);
  const atEnd   = pz._historyIdx === -1 || pz._historyIdx === pz._history.length - 1;
  if (btnFirst) btnFirst.disabled = atStart;
  if (btnPrev)  btnPrev.disabled  = atStart;
  if (btnNext)  btnNext.disabled  = atEnd;
  if (btnLast)  btnLast.disabled  = atEnd;
}

function pzNavFirst() {
  if (!pz._history.length) return;
  pz._historyIdx = 0;
  pzRender();
}
function pzNavPrev() {
  if (!pz._history.length) return;
  if (pz._historyIdx === -1) pz._historyIdx = pz._history.length - 1;
  if (pz._historyIdx > 0) pz._historyIdx--;
  pzRender();
}
function pzNavNext() {
  if (!pz._history.length || pz._historyIdx === -1) return;
  if (pz._historyIdx < pz._history.length - 1) {
    pz._historyIdx++;
  } else {
    pz._historyIdx = -1; // вернулись к текущей позиции
  }
  pzRender();
}
function pzNavLast() {
  if (!pz._history.length) return;
  pz._historyIdx = -1; // текущая позиция = последняя
  pzRender();
}

// Клавиши стрелок на странице пазла
document.addEventListener('keydown', (e) => {
  const isPuzzlePage = document.getElementById('page-puzzle-solve')?.classList.contains('active');
  if (!isPuzzlePage) return;
  if (e.key === 'ArrowLeft')  { pzNavPrev();  e.preventDefault(); }
  else if (e.key === 'ArrowRight') { pzNavNext();  e.preventDefault(); }
  else if (e.key === 'ArrowUp')    { pzNavFirst(); e.preventDefault(); }
  else if (e.key === 'ArrowDown')  { pzNavLast();  e.preventDefault(); }
});

function pzShowSuccess(data) {
  pz.solved = true;
  const fb = document.getElementById('puzzle-feedback');
  const alreadySolved = data && data.alreadySolved;
  const feedbackText = alreadySolved ? '✓ Правильно! (уже решено — рейтинг не меняется)' : '✓ Отлично! Задача решена!';
  if (fb) { fb.style.display = 'block'; fb.className = 'puzzle-feedback correct'; fb.textContent = feedbackText; }
  if (data && data.ratingDelta !== undefined && data.ratingDelta !== 0 && !alreadySolved) {
    const rc = document.getElementById('puzzle-rating-change');
    const rd = document.getElementById('puzzle-rating-delta');
    const rn = document.getElementById('puzzle-new-rating');
    if (rc) rc.style.display = 'block';
    if (rd) { rd.textContent = (data.ratingDelta > 0 ? '+' : '') + data.ratingDelta; rd.style.color = data.ratingDelta > 0 ? '#2ecc71' : '#e74c3c'; }
    if (rn) rn.textContent = 'Рейтинг задач: ' + data.newPuzzleRating;
  }
  const nb = document.getElementById('puzzle-nav-btns');
  if (nb) nb.style.display = 'flex';
  pz._moveIndex = 0;
}

function puzzleFlip()  { pz.flipped=!pz.flipped; pzRender(); }
function puzzleReset() {
  if (!pz.puzzle) return;
  pz.solved=false; pz.selected=null; pz.lastMove=null; pz._moveIndex=0; pz._autoPlaying=false;
  pz._history=[]; pz._historyIdx=-1; pz._failed=false;
  pz.board=pzFenToBoard(pz.puzzle.fen);
  pzComputeLegalDests();
  const ml=document.getElementById('puzzle-moves-list'); if(ml) ml.textContent='—';
  const fb=document.getElementById('puzzle-feedback'); if(fb) fb.style.display='none';
  const nb=document.getElementById('puzzle-nav-btns'); if(nb) nb.style.display='none';
  const rc=document.getElementById('puzzle-rating-change'); if(rc) rc.style.display='none';
  pzRender();
}

async function loadPuzzlesPage() {
  // Задача дня
  try {
    const p = await apiGet('/puzzles/daily');
    if (p) {
      pz._dailyPuzzle = p;
      const card=document.getElementById('puzzle-daily-card');
      const tEl=document.getElementById('daily-puzzle-title');
      const dEl=document.getElementById('daily-puzzle-desc');
      const diffEl=document.getElementById('daily-puzzle-diff');
      if(card) card.style.display='block';
      if(tEl) tEl.textContent=p.title;
      if(dEl) dEl.textContent=p.description||'';
      if(diffEl){ diffEl.textContent={easy:'🟢 Лёгкая',medium:'🟡 Средняя',hard:'🔴 Сложная'}[p.difficulty]||p.difficulty; diffEl.className='puzzle-diff-badge '+(p.difficulty||''); }
    }
  } catch(e) { console.warn('[Puzzles daily]',e.message); }

  // Темы
  const grid = document.getElementById('puzzle-topics-grid');
  if (grid) {
    try {
      const topics = await apiGet('/puzzles/topics');
      grid.innerHTML = '';
      if (!topics.length) {
        grid.innerHTML='<div style="color:var(--text-muted);font-size:14px;padding:16px;grid-column:1/-1">Тем пока нет — добавьте задачи через Admin API</div>';
      } else {
        for (const t of topics) {
          const card=document.createElement('div'); card.className='puzzle-topic-card';
          card.innerHTML=`<div class="puzzle-topic-icon">${t.icon}</div>
            <div class="puzzle-topic-name">${escapeHtml(t.name)}</div>
            <div class="puzzle-topic-desc">${escapeHtml(t.description||'')}</div>
            <span class="puzzle-topic-count">${t.puzzleCount} задач</span>`;
          card.addEventListener('click', ()=>openPuzzleTopic(t));
          grid.appendChild(card);
        }
      }
    } catch(e) {
      console.error('[Puzzles topics]', e.message);
      grid.innerHTML='<div style="color:var(--red);padding:16px;font-size:13px;grid-column:1/-1">Ошибка загрузки тем: '+escapeHtml(e.message)+'</div>';
    }
  }

  // Мини-лидерборд
  try {
    const lb = await apiGet('/puzzles/leaderboard');
    const el = document.getElementById('puzzle-leaderboard-mini');
    if (el) {
      if (!lb.length) { el.innerHTML='<div style="padding:16px;color:var(--text-muted);font-size:13px;text-align:center">Ещё никто не решал</div>'; }
      else {
        el.innerHTML='';
        lb.slice(0,10).forEach((u,i)=>{
          const row=document.createElement('div'); row.className='puzzle-lb-row';
          row.innerHTML=`<div class="puzzle-lb-rank">${i<3?['🥇','🥈','🥉'][i]:u.rank}</div>
            <div class="puzzle-lb-name">${escapeHtml(u.username)}</div>
            <div class="puzzle-lb-rating">${u.puzzleRating}</div>`;
          row.addEventListener('click',()=>openUserProfile(u.username));
          el.appendChild(row);
        });
      }
    }
  } catch(e) { console.warn('[Puzzles lb]',e.message); }
}

function openDailyPuzzle() { if (pz._dailyPuzzle) openPuzzleSolve(pz._dailyPuzzle, null); }

async function openPuzzleTopic(topic) {
  pz.topic=topic; pz.difficulty=''; pz.offset=0; pz.topicList=[];
  const tEl=document.getElementById('puzzle-topic-title');
  const dEl=document.getElementById('puzzle-topic-desc');
  if(tEl) tEl.textContent=topic.icon+' '+topic.name;
  if(dEl) dEl.textContent=topic.description||'';
  showPage('puzzle-topic');
  await fetchTopicPuzzles(true);
}

async function fetchTopicPuzzles(reset) {
  if (!pz.topic) return;
  const listEl=document.getElementById('puzzle-list');
  const moreEl=document.getElementById('puzzle-load-more');
  if (!listEl) return;
  if (reset) { listEl.innerHTML='<div style="padding:16px;color:var(--text-muted);font-size:13px">Загрузка...</div>'; pz.topicList=[]; }
  try {
    let url=`/puzzles?topic=${pz.topic.id}&limit=15&offset=${pz.offset}`;
    if (pz.difficulty) url+='&difficulty='+pz.difficulty;
    const puzzles=await apiGet(url);
    if (reset) listEl.innerHTML='';
    if (!puzzles.length && reset) {
      listEl.innerHTML='<div style="padding:24px;text-align:center;color:var(--text-muted);font-size:14px">Задач пока нет</div>';
      if(moreEl) moreEl.style.display='none'; return;
    }
    const base=pz.offset;
    pz.topicList.push(...puzzles);
    puzzles.forEach((p,i)=>{
      const gi=base+i;
      const item=document.createElement('div');
      const st=p.userStatus;
      item.className='puzzle-list-item'+(st==='solved'?' solved':st==='attempted'?' attempted':'');
      item.innerHTML=`<div class="puzzle-list-num">${gi+1}</div>
        <div class="puzzle-list-info">
          <div class="puzzle-list-title">${escapeHtml(p.title)}</div>
          <div class="puzzle-list-meta">
            <span class="puzzle-diff-badge ${p.difficulty}">${{easy:'🟢 Лёгкая',medium:'🟡 Средняя',hard:'🔴 Сложная'}[p.difficulty]||p.difficulty}</span>
            ${p.playCount?`<span>Решено: ${p.correctCount}/${p.playCount}</span>`:''}
          </div>
        </div>
        <div style="font-size:18px">${st==='solved'?'✅':st==='attempted'?'❌':'⬜'}</div>`;
      item.addEventListener('click',()=>{ pz.idx=gi; openPuzzleSolve(p, pz.topic); });
      listEl.appendChild(item);
    });
    if(moreEl) moreEl.style.display=puzzles.length===15?'block':'none';
    pz.offset+=puzzles.length;
  } catch(e) {
    console.error('[fetchTopicPuzzles]',e);
    if(reset&&listEl) listEl.innerHTML='<div style="padding:16px;color:var(--red);font-size:13px">Ошибка: '+escapeHtml(e.message)+'</div>';
  }
}

function loadMorePuzzles() { fetchTopicPuzzles(false); }

function filterPuzzleDiff(diff) {
  pz.difficulty=diff; pz.offset=0; pz.topicList=[];
  document.querySelectorAll('#puzzle-diff-filter .tc-btn').forEach(b=>b.classList.toggle('selected',b.dataset.diff===diff));
  fetchTopicPuzzles(true);
}

function openPuzzleSolve(puzzle, topic) {
  pz.puzzle=puzzle; pz.solved=false; pz.selected=null; pz.lastMove=null; pz.flipped=false; pz._moveIndex=0; pz._autoPlaying=false;
  pz._history=[]; pz._historyIdx=-1; pz._failed=false;
  pz.board=pzFenToBoard(puzzle.fen);
  pz.playerTurn=pzBoardTurn(puzzle.fen);
  if (pz.playerTurn==='b') pz.flipped=true;
  pzComputeLegalDests();
  const topicEl=document.getElementById('puzzle-solve-topic');
  const titleEl=document.getElementById('puzzle-solve-title');
  const descEl=document.getElementById('puzzle-solve-desc');
  const diffEl=document.getElementById('puzzle-solve-diff');
  const turnEl=document.getElementById('puzzle-whose-turn');
  const mlEl=document.getElementById('puzzle-moves-list');
  if(topicEl) topicEl.textContent=topic?topic.icon+' '+topic.name:'';
  if(titleEl) titleEl.textContent=puzzle.title;
  if(descEl)  descEl.textContent=puzzle.description||'Найди лучший ход';
  if(diffEl)  { diffEl.textContent={easy:'🟢 Лёгкая',medium:'🟡 Средняя',hard:'🔴 Сложная'}[puzzle.difficulty]||''; diffEl.className='puzzle-diff-badge '+(puzzle.difficulty||''); }
  if(turnEl)  turnEl.textContent='Ход: '+(pz.playerTurn==='w'?'⬜ Белые':'⬛ Чёрные');
  if(mlEl)    mlEl.textContent='—';
  const fb=document.getElementById('puzzle-feedback'); if(fb) fb.style.display='none';
  const nb=document.getElementById('puzzle-nav-btns'); if(nb) nb.style.display='none';
  const rc=document.getElementById('puzzle-rating-change'); if(rc) rc.style.display='none';
  showPage('puzzle-solve');
  setTimeout(()=>pzRender(), 60);
}

function goBackFromPuzzle() { showPage(pz.topic ? 'puzzle-topic' : 'puzzles'); }

async function puzzleNext() {
  const next = pz.topicList[pz.idx + 1];
  if (next) {
    pz.idx++;
    openPuzzleSolve(next, pz.topic);
    return;
  }
  // Дошли до конца загруженного списка — грузим ещё автоматически
  try {
    const loadingFb = document.getElementById('puzzle-feedback');
    if (loadingFb) { loadingFb.style.display='block'; loadingFb.className='puzzle-feedback'; loadingFb.textContent='⏳ Загружаем следующие задачи...'; }

    let url = `/puzzles?topic=${pz.topic.id}&limit=15&offset=${pz.offset}`;
    if (pz.difficulty) url += '&difficulty=' + pz.difficulty;
    const newPuzzles = await apiGet(url);

    if (loadingFb) loadingFb.style.display = 'none';

    if (!newPuzzles || !newPuzzles.length) {
      toast('Задачи в этой теме закончились!', 'info');
      return;
    }

    // Добавляем в список и обновляем offset
    pz.topicList.push(...newPuzzles);
    pz.offset += newPuzzles.length;

    // Обновляем список задач на странице темы (если вернёмся туда)
    const listEl = document.getElementById('puzzle-list');
    if (listEl) {
      const base = pz.topicList.length - newPuzzles.length;
      newPuzzles.forEach((p, i) => {
        const gi = base + i;
        const item = document.createElement('div');
        const st = p.userStatus;
        item.className = 'puzzle-list-item' + (st==='solved'?' solved':st==='attempted'?' attempted':'');
        item.innerHTML = `<div class="puzzle-list-num">${gi+1}</div>
          <div class="puzzle-list-info">
            <div class="puzzle-list-title">${escapeHtml(p.title)}</div>
            <div class="puzzle-list-meta">
              <span class="puzzle-diff-badge ${p.difficulty}">${{easy:'🟢 Лёгкая',medium:'🟡 Средняя',hard:'🔴 Сложная'}[p.difficulty]||p.difficulty}</span>
              ${p.playCount?`<span>Решено: ${p.correctCount}/${p.playCount}</span>`:''}
            </div>
          </div>
          <div style="font-size:18px">${st==='solved'?'✅':st==='attempted'?'❌':'⬜'}</div>`;
        item.addEventListener('click', () => { pz.idx=gi; openPuzzleSolve(p, pz.topic); });
        listEl.appendChild(item);
      });
      // Прячем кнопку "загрузить ещё" если задач меньше 15 (значит это конец)
      const moreEl = document.getElementById('puzzle-load-more');
      if (moreEl) moreEl.style.display = newPuzzles.length === 15 ? 'block' : 'none';
    }

    // Открываем следующую задачу
    pz.idx++;
    openPuzzleSolve(pz.topicList[pz.idx], pz.topic);

  } catch(e) {
    console.error('[puzzleNext auto-load]', e);
    toast('Ошибка загрузки следующих задач', 'error');
  }
}

async function loadPuzzleLeaderboardFull() {
  const el=document.getElementById('puzzle-leaderboard-full');
  if (!el) return;
  try {
    const lb=await apiGet('/puzzles/leaderboard');
    if (!lb.length) { el.innerHTML='<div style="padding:20px;text-align:center;color:var(--text-muted)">Нет данных</div>'; return; }
    el.innerHTML='';
    const header=document.createElement('div');
    header.style.cssText='display:grid;grid-template-columns:44px 1fr 80px 80px 60px;padding:10px 16px;border-bottom:1px solid var(--border);font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:var(--text-muted);font-weight:700';
    header.innerHTML='<div>#</div><div>Игрок</div><div style="text-align:right">Рейтинг</div><div style="text-align:right">Решено</div><div style="text-align:right">%</div>';
    el.appendChild(header);
    lb.forEach((u,i)=>{
      const row=document.createElement('div');
      row.style.cssText='display:grid;grid-template-columns:44px 1fr 80px 80px 60px;padding:12px 16px;border-bottom:1px solid var(--border);cursor:pointer;transition:background .12s;align-items:center';
      row.onmouseenter=()=>{ row.style.background='rgba(255,255,255,0.04)'; };
      row.onmouseleave=()=>{ row.style.background=''; };
      row.innerHTML=`<div style="font-weight:800;font-size:13px">${i<3?['🥇','🥈','🥉'][i]:u.rank}</div>
        <div style="font-weight:600;font-size:14px">${escapeHtml(u.username)}</div>
        <div style="text-align:right;font-weight:700;color:var(--accent)">${u.puzzleRating}</div>
        <div style="text-align:right;font-size:13px;color:var(--text-secondary)">${u.puzzleSolved}</div>
        <div style="text-align:right;font-size:13px;color:var(--text-muted)">${u.accuracy}%</div>`;
      row.addEventListener('click',()=>openUserProfile(u.username));
      el.appendChild(row);
    });
  } catch(e) { el.innerHTML='<div style="padding:20px;text-align:center;color:var(--red)">Ошибка загрузки</div>'; }
}

// ─── DM УВЕДОМЛЕНИЕ НА САЙТЕ (показывается на всех страницах) ──
function showDmNotification(fromUsername, preview) {
  const id = 'dm-notif-' + fromUsername;
  const existing = document.getElementById(id);
  if (existing) existing.remove();

  if (!document.getElementById('dm-notif-style')) {
    const s = document.createElement('style');
    s.id = 'dm-notif-style';
    s.textContent = `
      @keyframes dmSlideIn {
        from { opacity:0; transform:translateX(30px) scale(0.95); }
        to   { opacity:1; transform:translateX(0) scale(1); }
      }
      .dm-site-notif {
        position:fixed; top:74px; right:20px; z-index:99999;
        background:var(--bg-card);
        border:1px solid var(--accent);
        border-radius:14px; padding:13px 16px;
        display:flex; align-items:center; gap:11px;
        box-shadow:0 8px 32px rgba(0,0,0,0.55), 0 0 0 1px rgba(201,168,76,0.1);
        max-width:300px; cursor:pointer;
        animation:dmSlideIn 0.35s cubic-bezier(0.34,1.56,0.64,1);
        transition:opacity 0.3s, transform 0.3s;
        font-family:var(--font-body);
      }
      .dm-site-notif:hover { border-color:var(--accent-light); }
      .dm-notif-av {
        width:36px; height:36px; border-radius:50%;
        background:linear-gradient(135deg,var(--accent),var(--accent-dark));
        display:flex; align-items:center; justify-content:center;
        font-size:15px; font-weight:700; color:#000; flex-shrink:0;
      }
      .dm-notif-body { flex:1; min-width:0; }
      .dm-notif-title { font-weight:700; font-size:13px; color:var(--text-primary); }
      .dm-notif-preview { font-size:11px; color:var(--text-muted); margin-top:2px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
      .dm-notif-x { color:var(--text-muted); font-size:15px; cursor:pointer; flex-shrink:0; padding:2px; line-height:1; }
      .dm-notif-x:hover { color:var(--text-primary); }
    `;
    document.head.appendChild(s);
  }

  const el = document.createElement('div');
  el.className = 'dm-site-notif';
  el.id = id;
  el.innerHTML = `
    <div class="dm-notif-av">${escapeHtml(fromUsername[0].toUpperCase())}</div>
    <div class="dm-notif-body">
      <div class="dm-notif-title">&#x1F4AC; Новое сообщение от ${escapeHtml(fromUsername)}</div>
      <div class="dm-notif-preview">${escapeHtml(preview)}</div>
    </div>
    <div class="dm-notif-x" id="dm-notif-x-${escapeHtml(fromUsername)}">&#x2715;</div>
  `;

  el.addEventListener('click', function(e) {
    if (e.target.id === 'dm-notif-x-' + fromUsername) { el.remove(); return; }
    el.remove();
    window.location = '/inbox/' + encodeURIComponent(fromUsername);
  });

  // ─── Emoji picker (глобальный) ───────────────────────────────
const EMOJIS = [
  '😀', '😃', '😄', '😁', '😆', '😅', '😂', '🤣', '😊', '😇', '🙂', '🙃', '😉', '😌', '😍', '🥰',
  '😘', '😗', '😙', '😚', '😋', '😛', '😝', '😜', '🤪', '🤨', '🧐', '🤓', '😎', '🤩', '🥳', '😏',
  '😒', '😞', '😔', '😟', '😕', '🙁', '☹️', '😣', '😖', '😫', '😩', '🥺', '😢', '😭', '😤', '😠',
  '😡', '🤬', '🤯', '😳', '🥵', '🥶', '😱', '😨', '😰', '😥', '😓', '🤗', '🤔', '🤭', '🤫', '🤥',
  '😶', '😐', '😑', '😬', '🙄', '😯', '😦', '😧', '😮', '😲', '🥱', '😴', '🤤', '😪', '😵', '🤐',
  '🥴', '🤢', '🤮', '🤧', '😷', '🤒', '🤕', '🤑', '🤠', '😈', '👿', '👹', '👺', '💩', '👻', '💀',
  '☠️', '👽', '🤖', '🎃', '😺', '😸', '😹', '😻', '😼', '😽', '🙀', '😿', '😾', '🙈', '🙉', '🙊',
  '🐶', '🐱', '🐭', '🐹', '🐰', '🦊', '🐻', '🐼', '🐨', '🐯', '🦁', '🐮', '🐷', '🐸', '🐒', '🐔',
  '🐧', '🐦', '🐤', '🐣', '🐥', '🐺', '🐗', '🐴', '🦄', '🐝', '🐛', '🦋', '🐌', '🐞', '🐜', '🦟',
  '🦗', '🕷️', '🦂', '🐢', '🐍', '🦎', '🐙', '🦑', '🦐', '🦞', '🐠', '🐟', '🐡', '🐬', '🐳', '🐋',
  '🦈', '🐊', '🐅', '🐆', '🦓', '🦍', '🦧', '🦣', '🐘', '🦛', '🦏', '🐪', '🐫', '🦒', '🦘', '🐃',
  '🐂', '🐄', '🐎', '🐖', '🐏', '🐑', '🦙', '🐐', '🦌', '🐕', '🐩', '🐈', '🐓', '🦃', '🐇', '🐁',
  '🐀', '🐿️', '🦔', '🐾', '🐉', '🐲', '🌵', '🎄', '🌲', '🌳', '🌴', '🌿', '🍀', '🍁', '🍂', '🍃',
  '🍇', '🍈', '🍉', '🍊', '🍋', '🍌', '🍍', '🥭', '🍎', '🍏', '🍐', '🍑', '🍒', '🍓', '🥝', '🍅',
  '🥥', '🥑', '🍆', '🥔', '🥕', '🌽', '🌶️', '🥒', '🥬', '🥦', '🧄', '🧅', '🍄', '🥜', '🌰', '🍞',
  '🥐', '🥖', '🥨', '🥯', '🥞', '🧇', '🧀', '🍖', '🍗', '🥩', '🥓', '🍔', '🍟', '🍕', '🌭', '🥪',
  '🌮', '🌯', '🥙', '🧆', '🥚', '🍳', '🥘', '🍲', '🥣', '🥗', '🍿', '🧈', '🧂', '🥫', '🍱', '🍘',
  '🍙', '🍚', '🍛', '🍜', '🍝', '🍠', '🍢', '🍣', '🍤', '🍥', '🥮', '🍡', '🥟', '🥠', '🥡', '🦀',
  '🦞', '🦐', '🦑', '🐙', '🍦', '🍧', '🍨', '🍩', '🍪', '🎂', '🍰', '🧁', '🥧', '🍫', '🍬', '🍭',
  '🍮', '🍯', '🥛', '🍼', '🥤', '🧃', '🧉', '🧊', '🍺', '🍻', '🥂', '🥃', '🥄', '🍴', '🍽️', '🥢'
];

window.openEmojiPicker = function() {
  const grid = document.getElementById('emoji-grid');
  if (!grid) {
    console.error('emoji-grid не найден');
    return;
  }
  grid.innerHTML = '';
  for (const em of EMOJIS) {
    const div = document.createElement('div');
    div.textContent = em;
    div.style.cssText = 'cursor:pointer; font-size:28px; padding:4px; transition:transform 0.1s';
    div.onmouseenter = () => div.style.transform = 'scale(1.1)';
    div.onmouseleave = () => div.style.transform = 'scale(1)';
    div.onclick = () => window.selectEmoji(em);
    grid.appendChild(div);
  }
  if (typeof openModal === 'function') openModal('modal-emoji');
  else console.error('openModal не определена');
};

window.selectEmoji = async function(emoji) {
  if (!currentUser) {
    toast('Войдите, чтобы сменить эмодзи', 'info');
    return;
  }
  try {
    const res = await fetch('/api/user/emoji', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ emoji })
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || 'Ошибка');
    }
    const data = await res.json();
    if (currentUser) currentUser.emoji = emoji;
    if (window.CH) CH.setCurrentUser(currentUser);
    // Обновить везде
    const preview = document.getElementById('current-emoji-preview');
    if (preview) preview.textContent = emoji || '';
    const profileEmoji = document.getElementById('profile-emoji');
    if (profileEmoji) profileEmoji.textContent = emoji || '';
    // Перезагрузить чат
    if (typeof initGlobalChat === 'function') initGlobalChat();
    if (typeof closeModal === 'function') closeModal('modal-emoji');
    toast('Эмодзи сохранён!', 'success');
  } catch (err) {
    toast(err.message, 'error');
  }
};

  document.body.appendChild(el);

  setTimeout(function() {
    if (el.isConnected) {
      el.style.opacity = '0';
      el.style.transform = 'translateX(30px)';
      setTimeout(function() { el.remove(); }, 300);
    }
  }, 6000);
}
