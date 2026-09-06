// ═══════════════════════════════════════════════════════════════
//  sockets.js — вся логика Socket.IO (реалтайм: игра, чат, турниры)
// ═══════════════════════════════════════════════════════════════
// Один большой io.on('connection', socket => { ... }) — как и раньше,
// просто вынесен из index.js. Всё общее состояние и хелперы берём
// из core.js (та же самая память, не копии).
// ═══════════════════════════════════════════════════════════════

const {
  express,
  http,
  Server,
  compression,
  bcrypt,
  jwt,
  uuidv4,
  path,
  fs,
  cors,
  Pool,
  multer,
  pool,
  db,
  withTransaction,
  Resend,
  pendingPasswordChanges,
  pendingDeletions,
  pendingLogins,
  TWO_FA_RESEND_COOLDOWN_MS,
  twoFactorLastSent,
  sendPasswordChangeEmail,
  sendTwoFactorLoginEmail,
  sendDeleteAccountEmail,
  BAD_NICK_WORDS,
  normNick,
  nickHasBadWord,
  normForSimilarity,
  app,
  parseCookieHeader,
  isProd,
  AUTH_COOKIE_OPTS,
  DEVICE_COOKIE_OPTS,
  getAuthToken,
  RateLimiter,
  limiterGeneral,
  limiterAuth,
  limiterStrict,
  socketLimiter,
  limiterRegStrict,
  STORM_DURATION_MS,
  STORM_MAX_TIME_MS,
  STORM_MIN_MS_PER_PUZZLE,
  stormRuns,
  bannedIPs,
  bannedDevices,
  loadBansFromDB,
  saveBanToDB,
  removeBanFromDB,
  usersCache,
  cacheUser,
  rowToUser,
  isVip,
  isVipGranter,
  getUser,
  saveUser,
  globalChat,
  loadChat,
  saveChatMsg,
  deleteChatMsg,
  tournaments,
  loadTournaments,
  saveTournament,
  deleteTournamentFromDB,
  clubs,
  loadClubs,
  saveClub,
  deleteClubFromDB,
  CLUB_CHAT_MAX,
  clubChats,
  clubChatBans,
  getClubChat,
  getClubChatBans,
  initClubChatTable,
  loadClubChats,
  saveClubChatMsg,
  deleteClubChatMsgsByUser,
  isSiteAdmin,
  isClubModerator,
  canManageTournament,
  MAX_INTERCLUB_TEAMS,
  extractClubIdFromLink,
  resolveInterclubTeams,
  requireTournamentManager,
  canWriteInClubChat,
  TOURNAMENT_CHAT_MAX,
  TOURNAMENT_CHAT_READONLY_AFTER_MS,
  tournamentChats,
  tournamentChatMutes,
  getTournamentChat,
  getTournamentChatMutes,
  isTournamentChatOpen,
  canModerateTournamentChat,
  initTournamentChatTable,
  loadTournamentChats,
  saveTournamentChatMsg,
  wipeTournamentChatMsgsByUser,
  forumThreads,
  forumReplies,
  loadForum,
  saveForumThread,
  deleteForumThread,
  saveForumReply,
  deleteForumReply,
  blogPosts,
  loadBlog,
  saveBlogPost,
  deleteBlogPost,
  newsPosts,
  loadNews,
  saveNewsPost,
  deleteNewsPost,
  newsAuthors,
  loadNewsAuthors,
  server,
  io,
  PORT,
  JWT_SECRET,
  RESERVED,
  SYSTEM_SENDER,
  isSystemSender,
  sessions,
  usernameToSocketId,
  onlineUsers,
  pendingChallenges,
  activeGames,
  tournamentGames,
  workers,
  analyzeJobs,
  pickIdleWorker,
  ipBanMiddleware,
  getIP,
  isLocalIP,
  vpnCheckCache,
  VPN_CACHE_TTL,
  isVpnOrProxy,
  rateLimit,
  BUILD_VERSION,
  JS_SRC_RE,
  sendVersionedHtml,
  LICHESS_TOKEN,
  YUKASSA_SHOP_ID,
  YUKASSA_SECRET_KEY,
  SITE_URL,
  initDonateTable,
  loginFailStreaks,
  getLoginFailStreak,
  bumpLoginFailStreak,
  clearLoginFailStreak,
  limiterQuests,
  handleDeleteChatMsg,
  removeUserChatMessages,
  handleUpdateReportStatus,
  APPEAL_REASONS,
  handleUpdateAppealStatus,
  handleEditTournament,
  handleDeleteTournament,
  handleUnblacklistTournament,
  dmRoomKey,
  logDmAudit,
  logAdminAction,
  countTodayByUser,
  makeSlug,
  forumViewSessions,
  handleUnfollow,
  blogAuthMiddleware,
  blogAdminMiddleware,
  isBlogAdmin,
  decodeBlogField,
  blogSanitize,
  handleDeleteBlogPost,
  isBlogCommentAdmin,
  getCommentBan,
  handleDeleteBlogComment,
  newsAuthMiddleware,
  NEWS_OWNER_USERNAME,
  isNewsOwner,
  isNewsAuthorUser,
  newsSanitize,
  handleDeleteNewsPost,
  getNewsCommentMute,
  handleDeleteNewsComment,
  UPLOADS_DIR,
  uploadStorage,
  uploadImage,
  handleEditClub,
  handleDeleteClub,
  initPuzzleTables,
  initDurkaTables,
  durkaKeyMiddleware,
  parsePuzzleSolution,
  handleDeletePuzzle,
  SPA_ROUTES,
  handleDeleteDevDiaryEntry,
  handleDeleteDevDiaryComment,
  authMiddleware,
  requireAdmin,
  requireVipGranter,
  sanitizeUser,
  adminSanitizeUser,
  getInterclubTeamsInfo,
  computeTeamStandings,
  sanitizeTournament,
  getTournamentStatus,
  verifyToken,
  liveClock,
  hasFullMove,
  endGameAuthoritative,
  findSocketByUsername,
  emitToAdmins,
  recordGame,
  updateStats,
  REMATCH_GRACE_PERIOD,
  tryPairTournamentPlayers,
  FIRST_MOVE_TIMEOUT,
  startTournamentGame,
  finishTournamentGame,
  ANTICHEAT_THRESHOLD,
  ANTICHEAT_STREAK_BAN,
  checkAnticheat,
  anticheatBan,
  startGame,
  serverChess,
  limiterSocketConnect,
  main,
} = require('./core');



io.on('connection', (socket) => {
  // Socket.io не использует req.ip — читаем заголовок напрямую из handshake.
  // x-forwarded-for может содержать несколько IP через запятую: "реальный, cloudflare, nginx..."
  // Берём крайний левый — это и есть реальный IP клиента.
  const socketIP = (
    socket.handshake.headers['x-forwarded-for']?.split(',')[0]?.trim()
    || socket.handshake.headers['x-real-ip']
    || socket.handshake.address
    || 'unknown'
  );

  if (bannedIPs.has(socketIP)) {
    const banCheckTimer = setTimeout(() => { if (!socket.username) socket.disconnect(true); }, 3000);
    socket.once('auth', () => clearTimeout(banCheckTimer));
  }

  if (!limiterSocketConnect.check(socketIP).allowed) { socket.disconnect(true); return; }

  // ── ДОМАШНИЙ WORKER: аутентификация по секретному токену ──────
  // Если задан WORKER_SECRET в .env — принимаем воркер-подключения.
  // Если не задан вообще — фича просто выключена, ничего не ломается.
  socket.on('worker_auth', (payload) => {
    const secret = typeof payload === 'string' ? payload : payload?.secret;
    if (!process.env.WORKER_SECRET || secret !== process.env.WORKER_SECRET) {
      socket.emit('worker_auth_error', 'Неверный секрет');
      socket.disconnect(true);
      return;
    }
    const threads = (typeof payload === 'object' && Number.isInteger(payload?.threads))
      ? Math.max(1, Math.min(payload.threads, 64)) : 1;
    workers.set(socket.id, { socket, threads, busy: false, lastSeen: Date.now() });
    socket.isWorker = true;
    socket.emit('worker_auth_ok');
    console.log(`[Worker] Подключился (${threads} поток(а/ов)). Всего воркеров онлайн: ${workers.size}`);
  });
  socket.on('worker_heartbeat', () => {
    const w = workers.get(socket.id);
    if (w) w.lastSeen = Date.now();
  });
  // Воркер прислал промежуточную строку анализа ("info depth ...") —
  // пересылаем её как есть тому браузеру, который заказал анализ.
  // Формат строки — родной UCI-вывод Stockfish, парсер на клиенте
  // (stockfish-ui.js) уже умеет такие строки читать — не важно,
  // пришли они от локального движка в браузере или от воркера.
  socket.on('worker_job_progress', ({ jobId, line }) => {
    const job = analyzeJobs.get(jobId);
    if (!job) return;
    const requester = io.sockets.sockets.get(job.requesterSocketId);
    if (requester) requester.emit('analyze_line', line);
  });
  socket.on('worker_job_done', ({ jobId, line }) => {
    const job = analyzeJobs.get(jobId);
    if (!job) return;
    const requester = io.sockets.sockets.get(job.requesterSocketId);
    if (requester) requester.emit('analyze_line', line);
    const w = workers.get(job.workerSocketId);
    if (w) w.busy = false;
    analyzeJobs.delete(jobId);
  });

  // ── Запрос анализа от обычного посетителя (страница «Анализ») ──
  socket.on('analyze_request', ({ fen, depth }) => {
    if (typeof fen !== 'string' || fen.length > 100) return;
    const safeDepth = Number.isInteger(depth) ? Math.max(1, Math.min(depth, 30)) : 18;
    const w = pickIdleWorker();
    if (!w) { socket.emit('analyze_unavailable'); return; } // клиент сам уйдёт на локальный анализ в браузере
    const jobId = uuidv4();
    w.busy = true;
    analyzeJobs.set(jobId, { requesterSocketId: socket.id, workerSocketId: w.socket.id });
    w.socket.emit('worker_job', { jobId, fen, depth: safeDepth });
  });
  socket.on('analyze_cancel', () => {
    for (const [jobId, job] of analyzeJobs.entries()) {
      if (job.requesterSocketId === socket.id) {
        const w = workers.get(job.workerSocketId);
        if (w) { w.socket.emit('worker_job_cancel', { jobId }); w.busy = false; }
        analyzeJobs.delete(jobId);
      }
    }
  });
  socket.on('disconnect', () => {
    if (socket.isWorker && workers.has(socket.id)) {
      workers.delete(socket.id);
      // Если у этого воркера была незавершённая задача — сообщаем
      // заказчику, чтобы он не завис в ожидании, а ушёл на локальный
      // анализ в браузере.
      for (const [jobId, job] of analyzeJobs.entries()) {
        if (job.workerSocketId === socket.id) {
          const requester = io.sockets.sockets.get(job.requesterSocketId);
          if (requester) requester.emit('analyze_unavailable');
          analyzeJobs.delete(jobId);
        }
      }
      console.log(`[Worker] Отключился. Воркеров онлайн: ${workers.size}`);
    }
  });

  const origOn = socket.on.bind(socket);
  socket.on = function(event, handler) {
    if (event === 'connect' || event === 'disconnect' || event === 'error') return origOn(event, handler);
    return origOn(event, (...args) => {
      if (!socketLimiter.check(socket.id + '_' + event).allowed) { socket.emit('error', 'Слишком много запросов. Притормози!'); return; }
      handler(...args);
    });
  };

  socket.on('auth', async (_clientSuppliedToken) => {
    // Токен читаем ТОЛЬКО из HttpOnly-cookie в заголовках handshake —
    // аргумент, присланный клиентом, больше не используется, т.к. JS
    // на странице не может (и не должен) знать значение httpOnly-токена.
    const handshakeCookies = parseCookieHeader(socket.handshake.headers.cookie);
    const token = handshakeCookies.ch_token;
    const p = token ? verifyToken(token) : null;
    if (!p) return socket.emit('auth_error', 'Неверный токен');
    if (bannedIPs.has(socketIP)) { socket.emit('auth_error', 'Ваш IP заблокирован'); socket.disconnect(); return; }

    // БАГ (исправлено): раньше между verifyToken() и этим блоком стоял
    // "await getUser(...)" — а он обращается к кэшу/БД, то есть реально
    // отдаёт управление event loop'у. Если у юзера открыто несколько
    // вкладок (у каждой — свой socket от app.js И свой отдельный socket
    // от header.js для DM) и он быстро перезагружает страницу, несколько
    // auth-событий одного и того же юзера начинают выполняться
    // параллельно, и их await'ы могли завершиться в ЛЮБОМ порядке. Из-за
    // этого сокет, который должен был быть найден как "старый" и вытолкнут
    // (oldSocket.disconnect), иногда проскакивал мимо этой проверки —
    // потому что на момент его собственного запроса prevOldId ещё
    // указывал на кого-то другого, кто сам уже был снят с учёта. Такой
    // "потерянный" сокет оставался реально подключённым (просто не как
    // текущая сессия юзера) до тех пор, пока не отваливался сам по
    // ping-таймауту socket.io (~20-30 сек) — отсюда и временный, сам
    // проходящий разнобой в счётчике онлайна.
    // Фикс: всю регистрацию сессии (поиск+вытеснение старого сокета,
    // запись в sessions/usernameToSocketId/onlineUsers) делаем СРАЗУ,
    // одним синхронным куском без await между чтением токена и записью —
    // гонки конкурирующих auth-вызовов для одного юзера больше нет.
    // Проверку бана делаем уже ПОСЛЕ регистрации: если юзер забанен —
    // просто отключаем этот (уже корректно зарегистрированный) сокет,
    // и штатный disconnect-обработчик сам всё почистит.
    const prevOldId = usernameToSocketId.get(p.username.toLowerCase());
    if (prevOldId && prevOldId !== socket.id) {
      const oldSocket = io.sockets.sockets.get(prevOldId);
      if (oldSocket) oldSocket.disconnect(true);
      sessions.delete(prevOldId);
    }
    sessions.set(socket.id, { username: p.username });
    usernameToSocketId.set(p.username.toLowerCase(), socket.id);
    onlineUsers.add(p.username);
    socket.username = p.username;

    const user = await getUser(p.username.toLowerCase());
    if (user?.banned) { socket.emit('auth_error', 'Аккаунт заблокирован: ' + (user.banReason || 'нарушение правил')); socket.disconnect(); return; }

    socket.emit('auth_ok', { username: p.username });
    io.emit('online_count', onlineUsers.size);
    // Автоматически возвращаем игрока в очередь поиска соперника после
    // короткого обрыва связи (см. пометку "_resumeOnReconnect" в disconnect-хендлере),
    // если он именно искал партию, а не поставил паузу сам руками.
    for (const t of tournaments) {
      const tp = t.participants.find(tp => tp.username === p.username);
      if (!tp) continue;
      if (tp._resumeOnReconnect) {
        tp._resumeOnReconnect = false;
        if (!tp.left && !tp.anticheatBanned && !tp.currentGameId && getTournamentStatus(t, Date.now()) === 'active') {
          tp.waiting = true;
          io.to(`tournament_${t.id}`).emit('tournament_update', sanitizeTournament(t));
          saveTournament(t).catch(() => {});
          tryPairTournamentPlayers(t);
        }
      }
    }
    for (const [gId, game] of activeGames.entries()) {
      if (game.white === p.username || game.black === p.username) {
        const color = game.white === p.username ? 'white' : 'black';
        const opponent = color === 'white' ? game.black : game.white;
        const oppRating = usersCache.get(opponent.toLowerCase())?.rating ?? '?';
        let rejoinWhiteTime = game.whiteTime, rejoinBlackTime = game.blackTime;
        if (game.lastMoveAt !== null && rejoinWhiteTime !== undefined) {
          const elapsedSince = (Date.now() - game.lastMoveAt) / 1000;
          if (game.turn === 'white') rejoinWhiteTime = Math.max(0, rejoinWhiteTime - elapsedSince);
          else                       rejoinBlackTime = Math.max(0, rejoinBlackTime - elapsedSince);
        }
        socket.emit('game_start', { gameId: gId, color, opponent, opponentRating: oppRating, timeControl: game.timeControl, moves: game.moves, whiteTime: rejoinWhiteTime, blackTime: rejoinBlackTime, lastMoveAt: game.lastMoveAt, chatMessages: game.chatMessages || [], ...(game.tournamentId ? { tournamentId: game.tournamentId, tournamentName: game.tournamentName, isInterclub: !!game.isInterclub, firstMoveDeadline: game.firstMoveDeadline } : {}) });
        if (!game._board) { game._board = serverChess.rebuildBoard(game.moves); }
        break;
      }
    }
  });

  socket.on('join_tournament_room',  (tid) => { socket.join(`tournament_${tid}`); const t = tournaments.find(t => t.id === tid); if (t) socket.emit('tournament_update', sanitizeTournament(t)); });
  socket.on('leave_tournament_room', (tid) => socket.leave(`tournament_${tid}`));

  socket.on('tournament_seek', (tournamentId) => {
    if (!socket.username) return;
    const t = tournaments.find(t => t.id === tournamentId);
    if (!t || getTournamentStatus(t, Date.now()) !== 'active') return socket.emit('error', 'Турнир не активен');
    const p = t.participants.find(p => p.username === socket.username);
    if (!p) return socket.emit('error', 'Вы не участвуете');
    if (p.currentGameId) return;
    p.waiting = true;
    p.paused = false;
    p.nextEligibleAt = 0; // явный клик "Играть" — грейс-период не нужен
    saveTournament(t).catch(() => {});
    io.to(`tournament_${t.id}`).emit('tournament_update', sanitizeTournament(t));
    tryPairTournamentPlayers(t);
  });

  socket.on('tournament_unseek', (tournamentId) => {
    if (!socket.username) return;
    const t = tournaments.find(t => t.id === tournamentId);
    if (!t) return;
    const p = t.participants.find(p => p.username === socket.username);
    if (p) { p.waiting = false; p.paused = true; saveTournament(t).catch(() => {}); io.to(`tournament_${t.id}`).emit('tournament_update', sanitizeTournament(t)); }
  });

  socket.on('tournament_rejoin', ({ tournamentId, gameId }) => {
    if (!socket.username) return;
    const t = tournaments.find(t => t.id === tournamentId);
    if (!t) return;
    const p = t.participants.find(p => p.username === socket.username);
    if (!p || p.currentGameId !== gameId) return;
    const game = activeGames.get(gameId);
    if (!game) return;
    const color = game.white === socket.username ? 'white' : 'black';
    const opponent = color === 'white' ? game.black : game.white;
    const oppRating = usersCache.get(opponent.toLowerCase())?.rating ?? '?';
    let rejoinWhiteTime = game.whiteTime, rejoinBlackTime = game.blackTime;
    if (game.lastMoveAt !== null && rejoinWhiteTime !== undefined) {
      const elapsedSince = (Date.now() - game.lastMoveAt) / 1000;
      if (game.turn === 'white') rejoinWhiteTime = Math.max(0, rejoinWhiteTime - elapsedSince);
      else                       rejoinBlackTime = Math.max(0, rejoinBlackTime - elapsedSince);
    }
    socket.emit('game_start', { gameId, color, opponent, opponentRating: oppRating, timeControl: game.timeControl, moves: game.moves, whiteTime: rejoinWhiteTime, blackTime: rejoinBlackTime, lastMoveAt: game.lastMoveAt, chatMessages: game.chatMessages || [], ...(game.tournamentId ? { tournamentId: game.tournamentId, tournamentName: game.tournamentName, isInterclub: !!game.isInterclub, firstMoveDeadline: game.firstMoveDeadline } : {}) });
  });

  socket.on('tournament_waiting', ({ tournamentId }) => {
    const t = tournaments.find(t => t.id === tournamentId);
    if (!t || !socket.username) return;
    const p = t.participants.find(p => p.username === socket.username);
    if (!p || p.left || p.anticheatBanned || p.currentGameId) return;
    if (getTournamentStatus(t, Date.now()) !== 'active') return;
    p.waiting = true;
    p.paused = false;
    p.nextEligibleAt = 0; // явный клик "Играть" — грейс-период не нужен
    saveTournament(t).catch(() => {});
    io.to(`tournament_${t.id}`).emit('tournament_update', sanitizeTournament(t));
    tryPairTournamentPlayers(t);
    // Повторная попытка спаривания через 1.5 сек — на случай если второй игрок ещё не вошёл в очередь
    setTimeout(() => tryPairTournamentPlayers(t), 1500);
  });

  socket.on('tournament_berserk', ({ gameId }) => {
    if (!socket.username) return;
    const game = tournamentGames.get(gameId); if (!game) return;
    const color = game.white === socket.username ? 'white' : 'black';
    if (game.berserk[color] || game.moveCounts[color] > 0) return;
    game.berserk[color] = true;
    const payload = { gameId, color, berserk: game.berserk };
    [findSocketByUsername(game.white), findSocketByUsername(game.black)].forEach(s => s?.emit('berserk_activated', payload));
  });

  socket.on('post_challenge', (data) => {
    if (!socket.username) return;
    const challenge = { id: uuidv4(), from: socket.username, timeControl: data.timeControl || '10+0', color: data.color || 'random', rated: data.rated !== false, createdAt: Date.now(), socketId: socket.id };
    const idx = pendingChallenges.findIndex(c => c.from === socket.username);
    if (idx !== -1) pendingChallenges.splice(idx, 1);
    pendingChallenges.push(challenge);
    io.emit('challenges_update', pendingChallenges.filter(c => Date.now() - c.createdAt < 60000));
  });

  socket.on('cancel_challenge', () => {
    if (!socket.username) return;
    const idx = pendingChallenges.findIndex(c => c.from === socket.username);
    if (idx !== -1) pendingChallenges.splice(idx, 1);
    io.emit('challenges_update', pendingChallenges.filter(c => Date.now() - c.createdAt < 60000));
  });

  socket.on('accept_challenge', (challengeId) => {
    if (!socket.username) return;
    const idx = pendingChallenges.findIndex(c => c.id === challengeId);
    if (idx === -1) return socket.emit('error', 'Вызов не найден');
    const challenge = pendingChallenges[idx];
    if (challenge.from === socket.username) return socket.emit('error', 'Нельзя принять свой вызов');
    pendingChallenges.splice(idx, 1);
    io.emit('challenges_update', pendingChallenges.filter(c => Date.now() - c.createdAt < 60000));
    setTimeout(() => startGame(socket, challenge), 50);
  });

  socket.on('challenge_user', (data) => {
    if (!socket.username) return;
    // Поддерживаем и старый формат вызова (просто ник строкой), и новый
    // объект { username, rated } — чтобы можно было выбрать товарищескую партию.
    const targetUsername = typeof data === 'string' ? data : data?.username;
    const rated = typeof data === 'string' ? true : data?.rated !== false;
    if (!targetUsername) return;
    const t = findSocketByUsername(targetUsername);
    if (!t) return socket.emit('error', 'Не в сети');
    t.emit('incoming_challenge', { from: socket.username, socketId: socket.id, rated });
  });

  socket.on('accept_direct_challenge', (data) => {
    if (!socket.username) return;
    const fromSocketId = typeof data === 'string' ? data : data?.fromSocketId;
    const rated = typeof data === 'string' ? true : data?.rated !== false;
    const fromSocket = io.sockets.sockets.get(fromSocketId);
    if (!fromSocket) return socket.emit('error', 'Игрок отключился');
    startGame(socket, { from: fromSocket.username, timeControl: '10+0', color: 'random', rated, socketId: fromSocketId });
  });

  socket.on('decline_challenge', (fromSocketId) => {
    const fs = io.sockets.sockets.get(fromSocketId);
    if (fs) fs.emit('challenge_declined', socket.username);
  });

  socket.on('rejoin_game', ({ gameId }) => {
    if (!socket.username) return;
    const game = activeGames.get(gameId);
    if (!game || (game.white !== socket.username && game.black !== socket.username)) return;
    game._board = serverChess.rebuildBoard(game.moves);
    socket.emit('rejoin_ack', { gameId, moves: game.moves, turn: game.turn, whiteTime: game.whiteTime, blackTime: game.blackTime, chatMessages: game.chatMessages || [] });
  });

  socket.on('make_move', ({ gameId, move }) => {
    const game = activeGames.get(gameId);
    if (!game) { socket.emit('error', 'Партия не найдена (возможно, уже завершилась)'); return; }
    if (typeof move !== 'object' || typeof move.from !== 'number' || typeof move.to !== 'number') return;
    if (move.from < 0 || move.from > 63 || move.to < 0 || move.to > 63) return;
    if (game.white !== socket.username && game.black !== socket.username) return;
    const pc = game.white === socket.username ? 'white' : 'black';
    // БАГ (исправлено): раньше здесь был просто "return" без единого
    // уведомления клиенту. Но клиент к этому моменту уже применил ход
    // ЛОКАЛЬНО, оптимистично, ещё до ответа сервера (см. board.js:
    // executeMove) — значит игрок видел, что сходил, а сервер это молча
    // отбрасывал. Причина рассинхронизации turn — обычно короткий обрыв
    // связи, из-за которого предыдущий ход/подтверждение потерялись.
    // Теперь в такой ситуации шлём 'move_rejected' с полной актуальной
    // историей ходов и временем — клиент по этому событию откатывает
    // локальную доску и пересобирает её по реальному состоянию партии
    // (см. app.js: socket.on('move_rejected', ...) и board.js:resyncFromServer).
    if (game.turn !== pc) {
      socket.emit('move_rejected', {
        gameId, reason: 'not-your-turn',
        moves: game.moves, whiteTime: game.whiteTime, blackTime: game.blackTime, lastMoveAt: game.lastMoveAt,
      });
      return;
    }
    if (game._board) {
      const moveObj = { from: move.from, to: move.to, promotion: move.promotion || null };
      if (!serverChess.isLegalMove(game._board, moveObj)) {
        const rebuilt = serverChess.rebuildBoard(game.moves);
        if (!serverChess.isLegalMove(rebuilt, moveObj)) {
          socket.emit('move_rejected', {
            gameId, reason: 'illegal-move',
            moves: game.moves, whiteTime: game.whiteTime, blackTime: game.blackTime, lastMoveAt: game.lastMoveAt,
          });
          return;
        }
        game._board = rebuilt;
        console.warn(`[make_move] Ресинхронизация доски для игры ${gameId} (игрок: ${socket.username})`);
      }
      try { const found = serverChess.findMove(game._board, moveObj); game._board = serverChess.applyMove(game._board, found); } catch (e) { console.warn('[make_move] applyMove error:', e); }
    }
    const now = Date.now();
    if (game.lastMoveAt !== null && game.whiteTime !== undefined) {
      const elapsed = (now - game.lastMoveAt) / 1000;
      if (pc === 'white') game.whiteTime = Math.max(0, game.whiteTime - elapsed + (game.tcIncrement || 0));
      else                game.blackTime = Math.max(0, game.blackTime - elapsed + (game.tcIncrement || 0));
    }
    if (!game._acMoveTimes)  game._acMoveTimes = { white: [], black: [] };
    if (!game._acSuspect)    game._acSuspect   = { white: 0, black: 0 };
    if (game._acLastMoveAt && game.moves.length > 4) {
      const moveMs = now - game._acLastMoveAt;
      const times = game._acMoveTimes[pc]; times.push(moveMs); if (times.length > 20) times.shift();
      if (times.length >= 10) {
        const avg = times.reduce((a, b) => a + b, 0) / times.length;
        if (avg < 900 && times.every(t => t < 1200)) {
          game._acSuspect[pc]++;
          if (game._acSuspect[pc] >= 3) {
            emitToAdmins('anticheat_alert', { username: socket.username, gameId, avgMs: Math.round(avg), suspectLevel: game._acSuspect[pc], message: `🚨 Возможный движок: ${socket.username} (avg ${Math.round(avg)}ms/ход)` }).catch(() => {});
          }
        } else if (avg > 3000) { game._acSuspect[pc] = Math.max(0, game._acSuspect[pc] - 1); }
      }
    }
    game._acLastMoveAt = now;
    game.lastMoveAt = now;
    game.moves.push(move); game.turn = game.turn === 'white' ? 'black' : 'white'; game.lastActivity = now;
    if (game.moveCounts) game.moveCounts[pc] = (game.moveCounts[pc] || 0) + 1;
    if (game.firstMoveDeadline) {
      if (game.moves.length === 1) {
        // Белые сделали первый ход — даём чёрным отдельные 20 сек на их первый ход
        game.firstMoveDeadline = now + FIRST_MOVE_TIMEOUT;
      } else if (game.moves.length === 2) {
        // Чёрные тоже сходили первый раз — таймер первого хода больше не нужен
        game.firstMoveDeadline = null;
      }
    }
    const other = findSocketByUsername(pc === 'white' ? game.black : game.white);
    const timePayload = { move, gameId, whiteTime: game.whiteTime, blackTime: game.blackTime, serverAt: now, firstMoveDeadline: game.firstMoveDeadline };
    socket.emit('move_confirmed', timePayload);
    if (other) other.emit('opponent_move', timePayload);
  });

  socket.on('game_over', async ({ gameId, result, reason, accuracy }) => {
    const game = activeGames.get(gameId); if (!game) return;
    // Игрок должен быть участником этой партии, чтобы вообще заявлять об её завершении
    if (socket.username !== game.white && socket.username !== game.black) return;

    const norm = result === 'w' ? 'white' : result === 'b' ? 'black' : result;
    if (norm !== 'white' && norm !== 'black' && norm !== 'draw') return;

    // ── Таймаут больше не принимается от клиента — это решает только
    // серверный интервал (endGameAuthoritative выше), который знает
    // реальное оставшееся время по game.lastMoveAt. Клиентские часы
    // (clockInterval и т.п.) не могут завершить партию по флагу.
    if (reason === 'timeout' || reason === 'flag') {
      socket.emit('error', 'Таймаут определяется сервером');
      return;
    }

    // ── Мат/пат — проверяем по реальной позиции на сервере, а не
    // просто принимаем то, что прислал клиент.
    if (reason === 'checkmate' || reason === 'stalemate') {
      const board = game._board || serverChess.rebuildBoard(game.moves);
      const boardTurnColor = board.turn === 'w' ? 'white' : 'black';
      if (reason === 'checkmate') {
        if (!serverChess.isCheckmate(board)) { socket.emit('error', 'Мат не подтверждён сервером'); return; }
        const expectedWinner = boardTurnColor === 'white' ? 'black' : 'white';
        if (norm !== expectedWinner) { socket.emit('error', 'Некорректный результат мата'); return; }
      } else {
        if (!serverChess.isStalemate(board)) { socket.emit('error', 'Пат не подтверждён сервером'); return; }
        if (norm !== 'draw') { socket.emit('error', 'Некорректный результат пата'); return; }
      }
    }

    // ── Ничьи по правилам (50 ходов / недостаток материала / троекратное
    // повторение позиции) — тоже перепроверяем по истории ходов, а не
    // просто верим клиенту. Раньше клиент такие заявки вообще не слал
    // (см. исправление в board.js), из-за чего партия никогда не
    // завершалась сама — время шло, а ходить было некуда.
    if (reason === 'threefold-repetition' || reason === 'fifty-move' || reason === 'insufficient-material') {
      if (norm !== 'draw') { socket.emit('error', 'Некорректный результат ничьей'); return; }
      if (reason === 'threefold-repetition' && !serverChess.isThreefoldRepetition(game.moves)) {
        socket.emit('error', 'Повторение позиции не подтверждено сервером'); return;
      }
      if (reason === 'fifty-move' && !serverChess.isFiftyMoveRule(game.moves)) {
        socket.emit('error', 'Правило 50 ходов не подтверждено сервером'); return;
      }
      if (reason === 'insufficient-material') {
        const board = game._board || serverChess.rebuildBoard(game.moves);
        if (!serverChess.isInsufficientMaterial(board.squares)) {
          socket.emit('error', 'Недостаток материала не подтверждён сервером'); return;
        }
      }
    }

    // Удаляем сразу — чтобы второй клиент не мог вызвать game_over дважды на ту же игру
    if (accuracy) game.accuracy = accuracy;
    await endGameAuthoritative(gameId, game, norm, reason);
  });

  socket.on('resign', async ({ gameId }) => {
    const game = activeGames.get(gameId); if (!game) return;
    activeGames.delete(gameId);
    tournamentGames.delete(gameId);
    const rc = game.white === socket.username ? 'white' : 'black';
    const wc = rc === 'white' ? 'black' : 'white';
    const winSock = findSocketByUsername(wc === 'white' ? game.white : game.black);
    socket.emit('game_ended', { gameId, result: wc, reason: 'resign' });
    if (winSock) winSock.emit('game_ended', { gameId, result: wc, reason: 'opponent_resign' });
    const isTournament = !!game.tournamentId;
    if (isTournament) { const t = tournaments.find(t => t.id === game.tournamentId); if (t) await finishTournamentGame(t, game, wc, 'resign'); }
    else if (hasFullMove(game)) { await recordGame(game, wc, 'resign'); await updateStats(game.white, game.black, wc, game.rated !== false); }
  });

  socket.on('offer_draw', ({ gameId }) => {
    const game = activeGames.get(gameId); if (!game) return;
    const opp = game.white === socket.username ? game.black : game.white;
    const os = findSocketByUsername(opp); if (os) os.emit('draw_offered', { gameId, from: socket.username });
  });

  socket.on('accept_draw', async ({ gameId }) => {
    const game = activeGames.get(gameId); if (!game) return;
    activeGames.delete(gameId);
    tournamentGames.delete(gameId);
    const payload = { gameId, result: 'draw', reason: 'agreement' };
    [findSocketByUsername(game.white), findSocketByUsername(game.black)].forEach(s => s?.emit('game_ended', payload));
    const isTournament = !!game.tournamentId;
    if (isTournament) { const t = tournaments.find(t => t.id === game.tournamentId); if (t) await finishTournamentGame(t, game, 'draw', 'agreement'); }
    else if (hasFullMove(game)) { await recordGame(game, 'draw', 'agreement'); await updateStats(game.white, game.black, 'draw', game.rated !== false); }
  });

  socket.on('game_chat', ({ gameId, message }) => {
    const game = activeGames.get(gameId); if (!game) return;
    const text = (message || '').trim().slice(0, 300); if (!text) return;
    const opp = game.white === socket.username ? game.black : game.white;
    const msg = { from: socket.username, message: text, gameId, ts: Date.now() };
    if (!game.chatMessages) game.chatMessages = [];
    game.chatMessages.push(msg);
    if (game.chatMessages.length > 100) game.chatMessages.shift();
    socket.emit('game_chat', msg);
    const os = findSocketByUsername(opp); if (os) os.emit('game_chat', msg);
  });

  socket.on('join_club_room', (clubId) => {
    if (!socket.username) return;
    const club = clubs.find(c => c.id === clubId);
    if (!club) return;
    if (!canWriteInClubChat(club, socket.username) && !isClubModerator(club, socket.username)) return;
    socket.join('club_' + clubId);
  });

  socket.on('leave_club_room', (clubId) => { socket.leave('club_' + clubId); });

// ── Фильтр глобального чата ─────────────────────────────────────
// Та же логика, что уже используется на клиенте (app.js:containsBadWords).
// БАГ (исправлено): раньше здесь был отдельный, свой, куда более грубый
// фильтр — плоский .includes() без учёта границ слова. Из-за этого
// "рубля" (и любое другое слово, просто ЗАКАНЧИВАющееся на "бля") ловилось
// как мат — а последствие было не просто "сообщение не отправлено", а
// chatHardBan(): ПОЖИЗНЕННЫЙ бан аккаунта и устройства с удалением
// истории сообщений. Заодно убрал токсичные-но-не-матерные слова
// ("дебил","идиот","мразь","тварь","урод","чмошник") — это не мат, их
// уже убрали из клиентского списка по этой же причине (см. app.js).
const MAT_WORDS_CHAT = [
  'блять','блядь','бля','пиздец','пизда','пизду','пизды',
  'сука','сучка','хуй','хуе','хер',
  'ебать','ебал','ебан','ебаный','ебло','еблан','ебуч','заеб','выеб',
  'нахуй','нахер','похуй','похер',
  'гандон','долбоеб','долбоёб','далбаеб','далбоеб','далбоёб','мудак',
  'шлюха','шлюх','шалава','проститутка',
  'соси','сосать','отсоси','сраный','обосранный','пздц',
  'fuck','fucking','bitch','asshole','dick','shit',
];
// Спам/казино/ссылки — тут по-прежнему ищем максимально агрессивно (в
// одну сплошную строку без пробелов). Заодно почистил два "мёртвых"
// слова из старого списка — "договорноймatch" и "легкиеdeньги" — там
// была опечатка вперемешку кириллицы с латиницей, из-за которой они
// физически не могли ни с чем совпасть.
const SPAM_WORDS_CHAT = [
  'казино','casino','ставки','ставка','bet','букмекер',
  '1xbet','melbet','parimatch','fonbet','aviator',
  'выигрыш','джекпот','бонус','промокод','депозит','фриспины','free spin',
  'прогноз','договорной матч','легкие деньги',
];
function normalizeChatWord(text) {
  return text.toLowerCase().replace(/ё/g, 'е').replace(/[@]/g, 'a').replace(/[0]/g, 'o')
    .replace(/[3]/g, 'e').replace(/[1!]/g, 'i').replace(/9/g, 'я').replace(/6/g, 'б').replace(/4/g, 'ч');
}
function normalizeChatCollapsed(text) {
  return normalizeChatWord(text).replace(/\s+/g, '').replace(/[^a-zа-я0-9]/gi, '');
}
function chatMessageHasBadWords(text) {
  const collapsed = normalizeChatCollapsed(text);
  if (SPAM_WORDS_CHAT.some(w => collapsed.includes(normalizeChatCollapsed(w)))) return true;
  // Короткие корни (3 буквы и меньше, типа "бля","хер") ловим ТОЛЬКО как
  // начало слова — иначе поймаем "рубля","сабля","херсон" и подобные ни
  // при чём не виноватые слова. Более длинные однозначные корни ищем
  // где угодно внутри слова — это по-прежнему ловит приставочные формы.
  const tokens = normalizeChatWord(text).replace(/[^a-zа-я0-9\s]/gi, '').split(/\s+/).filter(Boolean);
  return MAT_WORDS_CHAT.some(rawWord => {
    const word = normalizeChatWord(rawWord).replace(/[^a-zа-я0-9]/gi, '');
    if (!word) return false;
    // "хер" отдельно — только точное совпадение слова целиком, иначе
    // ловит "Херсон", "херувим" и подобные ни при чём не виноватые слова.
    if (word === 'хер') return tokens.includes(word);
    if (word.length <= 3) return tokens.some(t => t.startsWith(word));
    return tokens.some(t => t.includes(word));
  });
}

  socket.on('global_chat', async ({ message }) => {
    if (!socket.username) return;
    const text = (message || '').trim().slice(0, 300); if (!text) return;
    const now = Date.now();
    const user = await getUser(socket.username.toLowerCase());
    if (!user || user.banned) { socket.disconnect(); return; }

    if (global.chatBans) {
      const unbanAt = global.chatBans.get(socket.username.toLowerCase());
      if (unbanAt && unbanAt > now) {
        const minsLeft = Math.ceil((unbanAt - now) / 60000);
        socket.emit('error', `Вы забанены в чате ещё ${minsLeft} мин. Читайте правила платформы.`);
        return;
      } else if (unbanAt) { global.chatBans.delete(socket.username.toLowerCase()); }
    }

    const chatHardBan = async (reason) => {
      console.warn(`[ChatHardBan] ${socket.username} — ${reason}`);
      if (user.createdDeviceId) { bannedDevices.add(user.createdDeviceId); await saveBanToDB(null, user.createdDeviceId); }
      user.banned = true; user.banReason = reason; await saveUser(user);
      await removeUserChatMessages(socket.username);
      socket.emit('error', 'Заблокирован навсегда: ' + reason); socket.disconnect();
    };

    if (!socket._chatMsgs) socket._chatMsgs = [];
    socket._chatMsgs = socket._chatMsgs.filter(t => now - t < 10000); socket._chatMsgs.push(now);
    if (socket._chatMsgs.length > 10) { socket.emit('error', 'Вы временно отключены за спам в чате'); socket.disconnect(); return; }
    if (socket._chatMsgs.length > 5) { socket.emit('error', 'Слишком много сообщений. Притормози!'); return; }
    if (socket._lastChatAt && now - socket._lastChatAt < 1500) { socket.emit('error', 'Не так быстро!'); return; }
    socket._lastChatAt = now;

    const textLow = text.toLowerCase().replace(/[:/.\-\s]/g, '');
    const LINK_TRIGGERS = ['http','https','www','tme','discordgg','vkcom','instagramcom','tiktokcom'];
    if (LINK_TRIGGERS.some(t => textLow.includes(t))) { await chatHardBan('Реклама/ссылки в чате'); return; }

    if (chatMessageHasBadWords(text)) { await chatHardBan('Нарушение правил чата (запрещённые слова)'); return; }

    if (socket._lastChatMsg === text) {
      socket._dupCount = (socket._dupCount || 0) + 1;
      if (socket._dupCount >= 3) { await chatHardBan('Автобан: флуд (дублирование)'); return; }
      socket.emit('error', 'Не повторяйся'); return;
    }
    socket._lastChatMsg = text; socket._dupCount = 0;

    const msg = { id: uuidv4(), username: socket.username, message: text, role: user?.role === 'admin' ? 'admin' : 'user', timestamp: now, emoji: user.emoji || '', vip: isVip(user) };
    globalChat.push(msg); if (globalChat.length > 500) globalChat.shift();
    io.emit('global_chat', msg);
    saveChatMsg(msg).catch(e => console.error('[Chat save]', e.message));
  });

  socket.on('disconnect', () => {
    const sess = sessions.get(socket.id);
    if (sess) {
      onlineUsers.delete(sess.username); sessions.delete(socket.id);
      // Чистим индекс, только если он всё ещё указывает на этот сокет
      // (иначе можно случайно удалить более свежую запись при реконнекте).
      if (usernameToSocketId.get(sess.username.toLowerCase()) === socket.id) {
        usernameToSocketId.delete(sess.username.toLowerCase());
      }
      io.emit('online_count', onlineUsers.size);
      for (const t of tournaments) {
        const p = t.participants.find(p => p.username === sess.username);
        // БАГ: тут игрока молча вынимало из очереди поиска (waiting=false) при
        // любом обрыве соединения (сеть моргнула, телефон заблокировался,
        // сворачивание вкладки) — без paused=true и без broadcast. При
        // реконнекте auth-хендлер проверял "myPart.waiting && !myPart.paused",
        // но waiting уже был false, поэтому поиск соперника сам НЕ возобновлялся,
        // и игрок застревал на экране "пауза", хотя сам её не ставил.
        // Запоминаем, что человека нужно вернуть в очередь при следующем auth,
        // если он именно ждал соперника, а не поставил паузу сам.
        if (p && p.waiting && !p.left && !p.anticheatBanned && !p.currentGameId) {
          p._resumeOnReconnect = true;
        }
        if (p) p.waiting = false;
      }
    }
  });
});