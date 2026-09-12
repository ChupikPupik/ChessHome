// ═══════════════════════════════════════════════════════════════
//  i18n.js — лёгкий движок интернационализации Chess Home
// ═══════════════════════════════════════════════════════════════
//  Логика выбора языка:
//   1. Если пользователь уже выбирал язык вручную — берём его
//      (хранится в localStorage под ключом ch_lang).
//   2. Иначе смотрим язык системы/браузера (navigator.languages).
//      Если там встречается "ru" — показываем русский.
//      Во всех остальных случаях — английский по умолчанию.
//
//  Использование в HTML:
//    <span data-i18n="settings.title">⚙️ Настройки</span>
//    <input data-i18n-placeholder="common.search">
//    <button data-i18n-title="common.close">✕</button>
//
//  Использование в JS:
//    CH_I18N.t('settings.saved')                  -> "Сохранено"
//    CH_I18N.t('common.hello', { name: 'Игорь' })  -> подстановка {name}
//    CH_I18N.setLang('en')                         -> переключить и сохранить
//    document.addEventListener('ch-lang-changed', e => { ... })
// ═══════════════════════════════════════════════════════════════

(function () {
  const SUPPORTED = ['ru', 'en'];
  const STORAGE_KEY = 'ch_lang';
  const FALLBACK_LANG = 'en';

  function detectLang() {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved && SUPPORTED.includes(saved)) return saved;
    } catch (e) { /* localStorage недоступен (приватный режим и т.п.) */ }

    const navLangs = (navigator.languages && navigator.languages.length)
      ? navigator.languages
      : [navigator.language || navigator.userLanguage || ''];

    for (const l of navLangs) {
      if (l && l.toLowerCase().startsWith('ru')) return 'ru';
    }
    return FALLBACK_LANG;
  }

  let currentLang = detectLang();
  let dict = {};
  let ready = false;
  const readyCallbacks = [];

  function getNested(obj, path) {
    return path.split('.').reduce((o, k) => (o && o[k] !== undefined ? o[k] : undefined), obj);
  }

  function interpolate(str, vars) {
    if (vars) {
      Object.keys(vars).forEach(k => {
        str = str.replace(new RegExp('\\{' + k + '\\}', 'g'), vars[k]);
      });
    }
    return str;
  }

  function t(key, vars) {
    let str = getNested(dict, key);
    if (str === undefined) {
      console.warn('[i18n] нет перевода для ключа:', key, '(' + currentLang + ')');
      return key;
    }
    return interpolate(str, vars);
  }

  // ── ПЛЮРАЛИЗАЦИЯ ──────────────────────────────────────────────
  //  tn('blog.comment_count', 5, {n: 5}) ищет ключ вида
  //  blog.comment_count.<category> в текущем словаре.
  //  Категории:
  //   ru:  one / few / many   (1, 21, 31... | 2-4, 22-24... | 0,5-20,25-30...)
  //   en:  one / other        (1 | всё остальное)
  //  vars.n подставляется автоматически, если не передан явно в vars.
  function pluralCategory(n) {
    n = Math.abs(n);
    if (currentLang === 'ru') {
      const mod10 = n % 10, mod100 = n % 100;
      if (mod10 === 1 && mod100 !== 11) return 'one';
      if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return 'few';
      return 'many';
    }
    return n === 1 ? 'one' : 'other';
  }

  function tn(key, n, vars) {
    const category = pluralCategory(n);
    let str = getNested(dict, key + '.' + category);
    if (str === undefined) {
      // запасной вариант, если для языка не хватает нужной категории
      str = getNested(dict, key + '.other') || getNested(dict, key + '.many') || getNested(dict, key + '.one');
    }
    if (str === undefined) {
      console.warn('[i18n] нет перевода для ключа:', key, '(' + currentLang + ')');
      return key;
    }
    return interpolate(str, Object.assign({ n }, vars || {}));
  }

  function applyTranslations(root) {
    root = root || document;

    root.querySelectorAll('[data-i18n]').forEach(el => {
      const key = el.getAttribute('data-i18n');
      const val = t(key);
      if (el.hasAttribute('data-i18n-html')) el.innerHTML = val;
      else el.textContent = val;
    });

    root.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
      el.setAttribute('placeholder', t(el.getAttribute('data-i18n-placeholder')));
    });

    root.querySelectorAll('[data-i18n-title]').forEach(el => {
      el.setAttribute('title', t(el.getAttribute('data-i18n-title')));
    });

    root.querySelectorAll('[data-i18n-aria-label]').forEach(el => {
      el.setAttribute('aria-label', t(el.getAttribute('data-i18n-aria-label')));
    });

    if (root === document) {
      document.documentElement.setAttribute('lang', currentLang);
    }
  }

  async function loadDict(lang) {
    const res = await fetch('/locales/' + lang + '.json', { cache: 'no-cache' });
    if (!res.ok) throw new Error('i18n: не удалось загрузить /locales/' + lang + '.json');
    return res.json();
  }

  async function setLang(lang) {
    if (!SUPPORTED.includes(lang) || lang === currentLang && ready) {
      if (lang === currentLang) return; // уже на этом языке
    }
    if (!SUPPORTED.includes(lang)) return;
    dict = await loadDict(lang);
    currentLang = lang;
    try { localStorage.setItem(STORAGE_KEY, lang); } catch (e) {}
    applyTranslations();
    document.dispatchEvent(new CustomEvent('ch-lang-changed', { detail: { lang: currentLang } }));
  }

  function getLang() {
    return currentLang;
  }

  function onReady(cb) {
    if (ready) cb(currentLang);
    else readyCallbacks.push(cb);
  }

  async function init() {
    try {
      dict = await loadDict(currentLang);
    } catch (e) {
      console.error(e);
      if (currentLang !== FALLBACK_LANG) {
        currentLang = FALLBACK_LANG;
        dict = await loadDict(currentLang);
      }
    }
    applyTranslations();
    ready = true;
    readyCallbacks.forEach(cb => cb(currentLang));
    readyCallbacks.length = 0;
    document.dispatchEvent(new CustomEvent('ch-lang-ready', { detail: { lang: currentLang } }));
  }

  window.CH_I18N = { t, tn, setLang, getLang, applyTranslations, onReady, SUPPORTED };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();