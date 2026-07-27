/**
 * opening-worker.js
 * ────────────────────────────────────────────────────────────────
 * Второй поток (Web Worker) для "Дебютной базы данных".
 *
 * ВАЖНО (изменение от Lichess, весна 2026):
 * Lichess закрыл анонимный доступ к Opening Explorer API — теперь
 * explorer.lichess.ovh отвечает 401 без авторизации:
 *   https://lichess.org/@/thibault/blog/the-opening-explorer-now-requires-authentication
 * Поэтому дёргать lichess.ovh напрямую из браузера пользователя
 * больше нельзя (нужен приватный токен, а его нельзя палить в клиентском JS).
 *
 * Решение: воркер стучится в СВОЙ ЖЕ сервер по адресу /api/opening-explorer,
 * а уже сервер (см. server/index.js) прикладывает Bearer-токен и
 * проксирует запрос в Lichess. Это по-прежнему очень лёгкий эндпоинт —
 * просто passthrough без БД и тяжёлой логики.
 *
 * Всё, что делает этот файл:
 *  1. Получает от главного потока сообщение { fen: "..." }
 *  2. Делает fetch к /api/opening-explorer?fen=...
 *  3. Разбирает JSON-ответ и оставляет только то, что нужно для таблицы
 *  4. Отправляет готовый результат обратно в главный поток
 */

'use strict';

const EXPLORER_PROXY_URL = '/api/opening-explorer';

self.addEventListener('message', async (event) => {
  const { requestId, fen } = event.data || {};

  if (!fen) {
    self.postMessage({ requestId, ok: false, error: 'Пустая FEN-строка' });
    return;
  }

  try {
    const result = await fetchOpeningMoves(fen);
    self.postMessage({ requestId, ok: true, ...result });
  } catch (err) {
    self.postMessage({
      requestId,
      ok: false,
      error: err.message || 'Не удалось получить данные с Lichess'
    });
  }
});

/**
 * Запрашивает статистику ходов для заданной позиции и возвращает
 * уже "причёсанный" объект, готовый для отрисовки в таблице.
 */
async function fetchOpeningMoves(fen) {
  const url = `${EXPLORER_PROXY_URL}?fen=${encodeURIComponent(fen)}`;

  const response = await fetch(url, {
    method: 'GET',
    headers: { Accept: 'application/json' }
  });

  if (!response.ok) {
    if (response.status === 429) {
      throw new Error('Lichess временно ограничил запросы (429). Попробуйте чуть позже.');
    }
    if (response.status === 401) {
      throw new Error('Lichess требует авторизацию (401) — проверьте LICHESS_API_TOKEN на сервере.');
    }
    throw new Error(`Сервер вернул ошибку ${response.status}`);
  }

  const data = await response.json();
  const rawMoves = Array.isArray(data.moves) ? data.moves : [];

  const total = (data.white || 0) + (data.draws || 0) + (data.black || 0);

  const moves = rawMoves.map((m) => {
    const white = m.white || 0;
    const draws = m.draws || 0;
    const black = m.black || 0;
    const moveTotal = white + draws + black;

    return {
      san: m.san,
      uci: m.uci,
      total: moveTotal,
      whitePct: moveTotal ? (white / moveTotal) * 100 : 0,
      drawPct: moveTotal ? (draws / moveTotal) * 100 : 0,
      blackPct: moveTotal ? (black / moveTotal) * 100 : 0
    };
  });

  return {
    moves,
    position: {
      total,
      whitePct: total ? ((data.white || 0) / total) * 100 : 0,
      drawPct: total ? ((data.draws || 0) / total) * 100 : 0,
      blackPct: total ? ((data.black || 0) / total) * 100 : 0,
      opening: data.opening ? data.opening.name : null
    }
  };
}