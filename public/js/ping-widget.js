/**
 * ping-widget.js — Chess Home
 * Измеряет пинг до сервера и показывает его в дропдауне пользователя.
 * Работает на всех страницах: и в SPA (app.js), и в отдельных HTML.
 */

(function () {
  'use strict';

  // ─── Конфиг ───────────────────────────────────────────────────────────────
  const PING_INTERVAL_MS = 5000;   // как часто обновлять пинг
  const PING_URL         = '/api/ping'; // эндпоинт (см. ниже — fallback на '/')
  const GOOD_MS          = 100;    // ≤ 100 мс — зелёный
  const WARN_MS          = 250;    // ≤ 250 мс — жёлтый; > 250 — красный
  const PING_ITEM_ID     = 'ch-ping-item';

  // ─── Измерение пинга ──────────────────────────────────────────────────────
  async function measurePing() {
    const t0 = performance.now();
    try {
      // HEAD-запрос — минимальный трафик, кэш отключён
      await fetch(PING_URL, {
        method: 'HEAD',
        cache: 'no-store',
        // если /api/ping нет — любой 404 тоже вернёт ответ и мы измерим RTT
      });
    } catch (_) {
      // сеть недоступна
      return null;
    }
    return Math.round(performance.now() - t0);
  }

  // ─── Цвет по значению ─────────────────────────────────────────────────────
  function pingColor(ms) {
    if (ms === null) return '#ef4444';          // красный — нет связи
    if (ms <= GOOD_MS) return '#22c55e';        // зелёный
    if (ms <= WARN_MS) return '#eab308';        // жёлтый
    return '#ef4444';                           // красный
  }

  function pingLabel(ms) {
    if (ms === null) return 'нет связи';
    return ms + ' мс';
  }

  function pingQuality(ms) {
    if (ms === null) return 'Нет соединения';
    if (ms <= GOOD_MS) return 'Отличное';
    if (ms <= WARN_MS) return 'Нормальное';
    return 'Плохое';
  }

  // ─── Рендер элемента ──────────────────────────────────────────────────────
  function buildPingEl(ms) {
    const color = pingColor(ms);
    const label = pingLabel(ms);
    const quality = pingQuality(ms);

    const el = document.createElement('div');
    el.id = PING_ITEM_ID;
    el.style.cssText = [
      'display:flex',
      'align-items:center',
      'justify-content:space-between',
      'padding:8px 16px',
      'font-size:13px',
      'color:var(--text-secondary)',
      'cursor:default',
      'user-select:none',
      'gap:8px',
    ].join(';');

    el.innerHTML = `
      <span style="display:flex;align-items:center;gap:6px">
        <span style="
          display:inline-block;
          width:8px;height:8px;
          border-radius:50%;
          background:${color};
          box-shadow:0 0 6px ${color};
          flex-shrink:0;
          transition:background .4s,box-shadow .4s
        " id="ch-ping-dot"></span>
        <span style="color:var(--text-secondary)">Пинг</span>
      </span>
      <span style="
        font-family:var(--font-mono,monospace);
        font-weight:700;
        color:${color};
        transition:color .4s;
        font-size:12px;
        letter-spacing:.5px
      " id="ch-ping-val">${label}</span>
    `;

    // title-подсказка
    el.title = quality + ' соединение';

    return el;
  }

  function updatePingEl(ms) {
    const dot = document.getElementById('ch-ping-dot');
    const val = document.getElementById('ch-ping-val');
    if (!dot || !val) return;

    const color = pingColor(ms);
    const label = pingLabel(ms);

    dot.style.background   = color;
    dot.style.boxShadow    = `0 0 6px ${color}`;
    val.style.color        = color;
    val.textContent        = label;

    const el = document.getElementById(PING_ITEM_ID);
    if (el) el.title = pingQuality(ms) + ' соединение';
  }

  // ─── Вставка в dropdown ───────────────────────────────────────────────────
  /**
   * Ищет дропдаун пользователя (id="user-dropdown" или id="hdr-drop"),
   * находит последний <hr> (перед «Выйти») и вставляет пинг перед ним.
   * Если уже вставлен — обновляет.
   */
  function injectOrUpdate(ms) {
    // если элемент уже существует — просто обновляем
    if (document.getElementById(PING_ITEM_ID)) {
      updatePingEl(ms);
      return;
    }

    // ищем дропдаун
    const drop =
      document.getElementById('user-dropdown') ||
      document.getElementById('hdr-drop');
    if (!drop) return;

    // ищем последний <hr> в дропдауне — он перед «Выйти»
    const hrs = drop.querySelectorAll('hr');
    if (hrs.length === 0) return;
    const lastHr = hrs[hrs.length - 1];

    const pingEl = buildPingEl(ms);
    drop.insertBefore(pingEl, lastHr);
  }

  // ─── Цикл обновления ──────────────────────────────────────────────────────
  let lastMs = null;

  async function tick() {
    const ms = await measurePing();
    lastMs = ms;
    injectOrUpdate(ms);
  }

  // Следим за появлением дропдауна в DOM (для SPA и для статических страниц)
  let observer = null;

  function startObserver() {
    if (observer) return;
    observer = new MutationObserver(() => {
      const drop =
        document.getElementById('user-dropdown') ||
        document.getElementById('hdr-drop');
      if (drop && !document.getElementById(PING_ITEM_ID)) {
        // дропдаун появился — вставляем с последним известным значением
        injectOrUpdate(lastMs);
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }

  function start() {
    startObserver();
    // первый замер — сразу
    tick();
    // затем каждые N секунд
    setInterval(tick, PING_INTERVAL_MS);
  }

  // Запускаем как только DOM готов
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }

})();