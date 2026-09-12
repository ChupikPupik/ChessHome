// ═══════════════════════════════════════════════════════════════
//  routes.js — все HTTP-роуты (Express)
// ═══════════════════════════════════════════════════════════════
// Здесь только регистрация путей: app.get/post/put/delete/all(...).
// Вся логика, состояние и хелперы — в core.js, сюда просто
// подключаем то же самое общее окружение и используем как раньше.
//
// Файл выполняется один раз при старте (require из index.js) и
// навешивает все обработчики на общий app.
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
  PROFILE_EMOJIS,
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



// Корень "/" отдаём тем же путём (версия + no-store), а не через
// автоматический index.html из express.static — поэтому ниже у
// express.static выставлен index:false.
app.get('/', (req, res) => sendVersionedHtml(res, path.join(__dirname, '../public/index.html')));
 // положите токен в .env

app.get('/api/opening-explorer', async (req, res) => {
  try {
    const fen = req.query.fen;
    if (!fen) return res.status(400).json({ error: 'fen обязателен' });

    const r = await fetch(`https://explorer.lichess.ovh/masters?fen=${encodeURIComponent(fen)}`, {
      headers: LICHESS_TOKEN ? { Authorization: `Bearer ${LICHESS_TOKEN}` } : {}
    });
    if (!r.ok) return res.status(r.status).json({ error: `Lichess API ${r.status}` });

    res.json(await r.json());
  } catch (e) {
    res.status(500).json({ error: 'Ошибка проксирования запроса к Lichess' });
  }
});


app.get('/engine-play', (req, res) => res.sendFile(path.join(__dirname, '../public/engine-play.html')));

app.get('/opening-database', (req, res) => res.sendFile(path.join(__dirname, '../public/opening-database.html')));


app.get('/blog',    (req, res) => res.sendFile(path.join(__dirname, '../public/blog.html')));

app.get('/blog/:id',(req, res) => {
  const post = blogPosts.find(p => p.id === req.params.id);
  // Удалённой статьи не существует, а прикрытую никто не должен увидеть по прямой ссылке.
  if (!post || post.status === 'hidden') return res.redirect('/404.html');
  res.sendFile(path.join(__dirname, '../public/blog.html'));
});


app.get('/news',    (req, res) => res.sendFile(path.join(__dirname, '../public/news.html')));

app.get('/news/:id',(req, res) => {
  const post = newsPosts.find(p => p.id === req.params.id);
  // Удалённой новости не существует, а прикрытую никто не должен увидеть по прямой ссылке.
  if (!post || post.status === 'hidden') return res.redirect('/404.html');
  res.sendFile(path.join(__dirname, '../public/news.html'));
});

app.get('/news/:id/comments', (req, res) => {
  const post = newsPosts.find(p => p.id === req.params.id);
  if (!post || post.status === 'hidden') return res.redirect('/404.html');
  res.sendFile(path.join(__dirname, '../public/news.html'));
});


app.get('/followers/:username', (req, res) => res.sendFile(path.join(__dirname, '../public/followers.html')));

app.get('/following/:username', (req, res) => res.sendFile(path.join(__dirname, '../public/following.html')));


app.get('/dev-diary', (req, res) => res.sendFile(path.join(__dirname, '../public/dev-diary.html')));

app.get('/donate',   (req, res) => res.sendFile(path.join(__dirname, '../public/donate.html')));

app.get('/durka',    (req, res) => res.sendFile(path.join(__dirname, '../public/durka.html')));

app.get('/ai', (req, res) => res.sendFile(path.join(__dirname, '../public/ai.html')));


// Создать платёж через ЮKassa
app.post('/api/donate/create', rateLimit(limiterStrict), async (req, res) => {
  try {
    const { amount, message, username } = req.body;
    const amountNum = parseFloat(amount);
    if (!amountNum || amountNum < 10 || amountNum > 100000)
      return res.status(400).json({ error: 'Сумма должна быть от 10 до 100 000 ₽' });

    const donateId = uuidv4();
    const idempotenceKey = uuidv4();

    const payload = {
      amount:       { value: amountNum.toFixed(2), currency: 'RUB' },
      confirmation: { type: 'redirect', return_url: `${SITE_URL}/donate?success=1&id=${donateId}` },
      capture:      true,
      description:  message ? `Донат Chess Home: ${message.slice(0, 100)}` : 'Донат Chess Home',
      metadata:     { donate_id: donateId, username: username || 'anonymous' },
    };

    const auth = Buffer.from(`${YUKASSA_SHOP_ID}:${YUKASSA_SECRET_KEY}`).toString('base64');
    const ykRes = await fetch('https://api.yookassa.ru/v3/payments', {
      method: 'POST',
      headers: {
        'Authorization':  `Basic ${auth}`,
        'Content-Type':   'application/json',
        'Idempotence-Key': idempotenceKey,
      },
      body: JSON.stringify(payload),
    });
    const ykData = await ykRes.json();
    if (!ykRes.ok) {
      console.error('[Donate] ЮKassa error:', ykData);
      return res.status(502).json({ error: 'Ошибка платёжного сервиса. Попробуйте позже.' });
    }

    // Сохраняем в БД
    await db(
      'INSERT INTO donations (id, username, amount, currency, message, status, payment_id, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',
      [donateId, username || null, amountNum, 'RUB', message || null, 'pending', ykData.id, Date.now()]
    );

    res.json({ confirmation_url: ykData.confirmation.confirmation_url, donate_id: donateId });
  } catch (e) {
    console.error('[Donate] create error:', e.message);
    res.status(500).json({ error: 'Внутренняя ошибка сервера' });
  }
});


// Webhook от ЮKassa — подтверждение оплаты
app.post('/api/donate/webhook', express.json({ type: '*/*' }), async (req, res) => {
  try {
    const { event, object } = req.body;
    if (event === 'payment.succeeded' && object?.metadata?.donate_id) {
      await db(
        'UPDATE donations SET status=$1 WHERE id=$2',
        ['succeeded', object.metadata.donate_id]
      );
      console.log(`[Donate] ✅ Платёж успешен: ${object.metadata.donate_id} (${object.amount?.value} ₽)`);
    }
    res.sendStatus(200);
  } catch (e) {
    console.error('[Donate] webhook error:', e.message);
    res.sendStatus(500);
  }
});


// Топ донатёров (публичный)
app.get('/api/donate/top', async (req, res) => {
  try {
    const r = await db(`
      SELECT username, SUM(amount) AS total
      FROM donations
      WHERE status = 'succeeded' AND username IS NOT NULL
      GROUP BY username
      ORDER BY total DESC
      LIMIT 10
    `);
    res.json(r.rows);
  } catch (e) {
    res.json([]);
  }
});


// Проверка статуса конкретного доната (для страницы успеха)
app.get('/api/donate/status/:id', async (req, res) => {
  try {
    const r = await db('SELECT status, amount, username, message FROM donations WHERE id=$1', [req.params.id]);
    if (!r.rows[0]) return res.status(404).json({ error: 'Не найдено' });
    res.json(r.rows[0]);
  } catch (e) {
    res.status(500).json({ error: 'Ошибка' });
  }
});

// ══════════════════════════════════════════════════════════════
//  AUTH & USER API
// ══════════════════════════════════════════════════════════════

app.post('/api/register', 
  rateLimit(limiterRegStrict, 'Слишком много регистраций с вашего IP. Попробуйте позже.'), // 1. Проверяем лимиты по IP
  ipBanMiddleware,                                                                       // 2. Проверяем черный список IP
  async (req, res) => {                                                                  
    const ip = getIP(req);
    const { username, password, _hp } = req.body;
    const deviceId = req.deviceId; // из HttpOnly-cookie, а не от клиента — нельзя подделать/сменить через JS

    if (_hp && String(_hp).trim() !== '') {
      return res.json({ ok: true, message: 'Аккаунт создан.' });
    }
    if (deviceId && bannedDevices.has(deviceId))
      return res.status(403).json({ error: 'Ваше устройство заблокировано.' });

    if (!isLocalIP(ip)) {
      const vpn = await isVpnOrProxy(ip);
      if (vpn) {
        return res.status(403).json({ error: 'Регистрация через VPN, прокси или Tor запрещена. Отключите VPN и попробуйте снова.' });
      }
    }

    if (!username || !password)           return res.status(400).json({ error: 'Заполните все поля' });
    if (username.length < 3)              return res.status(400).json({ error: 'Ник минимум 3 символа' });
    if (username.length > 20)             return res.status(400).json({ error: 'Ник максимум 20 символов' });
    if (password.length < 6)             return res.status(400).json({ error: 'Пароль минимум 6 символов' });
    if (!/^[a-zA-Z0-9_-]+$/.test(username)) return res.status(400).json({ error: 'Только буквы, цифры, _ и -' });
    if (RESERVED.includes(username.toLowerCase())) return res.status(400).json({ error: 'Ник зарезервирован' });
    if (nickHasBadWord(username)) return res.status(400).json({ error: 'Ник содержит запрещённые слова' });

    try {
      const existCheck = await db('SELECT id FROM users WHERE username_low = $1', [username.toLowerCase()]);
      if (existCheck.rows.length > 0) return res.status(400).json({ error: 'Пользователь уже существует' });

      const deletedCheck = await db('SELECT username_low FROM deleted_usernames WHERE username_low = $1', [username.toLowerCase()]);
      if (deletedCheck.rows.length > 0) return res.status(400).json({ error: 'Этот ник недоступен для регистрации' });

      const allUsers = await db('SELECT username FROM users');
      const normNew = normForSimilarity(username);
      for (const row of allUsers.rows) {
        if (normForSimilarity(row.username) === normNew)
          return res.status(400).json({ error: 'Ник слишком похож на уже существующий' });
      }

      if (!isLocalIP(ip)) {
        const ipCount = await db('SELECT COUNT(*) FROM users WHERE created_from_ip = $1', [ip]);
        if (Number(ipCount.rows[0].count) >= 2)
          return res.status(429).json({ error: 'С вашего IP уже зарегистрированы аккаунты. Если вы считаете, что произошла ошибка — обратитесь в поддержку.' });
      }

      if (deviceId && !bannedDevices.has(deviceId)) {
        const devCount = await db('SELECT COUNT(*) FROM users WHERE created_device_id = $1', [deviceId]);
        if (Number(devCount.rows[0].count) >= 4)
          return res.status(429).json({ error: 'С этого устройства уже зарегистрирован аккаунт. Создание нескольких аккаунтов с одного устройства запрещено.' });
      }

      const hash = await bcrypt.hash(password, 10);
      const userData = {
        id: uuidv4(), username, email: null, passwordHash: hash,
        createdAt: Date.now(), createdFromIP: ip, createdDeviceId: deviceId || null,
        rating: 1200, gamesPlayed: 0, wins: 0, losses: 0, draws: 0,
        avatar: null, role: 'user', banned: false,
      };

      // Аккаунт создаётся сразу, без email-подтверждения. Защиту от
      // мультиаккаунтинга обеспечивают проверки выше: бан IP/устройства,
      // VPN/прокси-фильтр, лимит аккаунтов на IP и на устройство,
      // а также проверка на похожие ники.
      await saveUser(userData);

      const token = jwt.sign({ userId: userData.id, username: userData.username }, JWT_SECRET, { expiresIn: '7d' });
      // Токен больше не возвращается в теле ответа — только в HttpOnly cookie,
      // недоступной для чтения из JS (защита от кражи токена через XSS).
      res.cookie('ch_token', token, AUTH_COOKIE_OPTS);
      res.json({ user: sanitizeUser(userData, true) });
    } catch (err) {
      console.error('[Register]', err.message);
      return res.status(500).json({ error: 'Не удалось создать аккаунт: ' + err.message });
    }
  }
);


app.post('/api/login', 
  rateLimit(limiterAuth, 'Слишком много попыток входа с вашего IP. Подождите минуту.'),
  ipBanMiddleware,
  async (req, res, next) => {
    // Капча отключена по запросу (была нестабильна).
    next();
  },
  async (req, res) => {
  try {
    const { username, password } = req.body;
    const usernameLow = (username || '').toLowerCase();
    const user = await getUser(usernameLow);
    if (!user) { bumpLoginFailStreak(usernameLow); return res.status(401).json({ error: 'Неверное имя или пароль' }); }
    if (user.banned) return res.status(403).json({ error: `Заблокирован: ${user.banReason || ''}` });
    if (!await bcrypt.compare(password, user.passwordHash)) {
      bumpLoginFailStreak(usernameLow);
      return res.status(401).json({ error: 'Неверное имя или пароль' });
    }
    clearLoginFailStreak(usernameLow);

    const token = jwt.sign({ userId: user.id, username: user.username }, JWT_SECRET, { expiresIn: '7d' });
    res.cookie('ch_token', token, AUTH_COOKIE_OPTS);
    res.json({ user: sanitizeUser(user, true) });
  } catch (err) {
    console.error('[Login]', err.message);
    res.status(500).json({ error: 'Внутренняя ошибка сервера при входе. Попробуйте ещё раз.' });
  }
});


app.post('/api/login/verify-2fa',
  rateLimit(limiterAuth, 'Слишком много попыток. Подождите минуту.'),
  ipBanMiddleware,
  async (req, res) => {
    const { code } = req.body;
    if (!code) return res.status(400).json({ error: 'Введите код' });

    const pending = pendingLogins.get(String(code));
    if (!pending) return res.status(400).json({ error: 'Неверный или истёкший код' });
    if (Date.now() > pending.expiresAt) {
      pendingLogins.delete(String(code));
      return res.status(400).json({ error: 'Код истёк. Войдите заново.' });
    }

    const user = await getUser(pending.username.toLowerCase());
    pendingLogins.delete(String(code));
    if (!user) return res.status(404).json({ error: 'Пользователь не найден' });
    if (user.banned) return res.status(403).json({ error: `Заблокирован: ${user.banReason || ''}` });

    const token = jwt.sign({ userId: user.id, username: user.username }, JWT_SECRET, { expiresIn: '7d' });
    res.cookie('ch_token', token, AUTH_COOKIE_OPTS);
    res.json({ user: sanitizeUser(user, true) });
  }
);


app.post('/api/logout', (req, res) => {
  res.clearCookie('ch_token', { ...AUTH_COOKIE_OPTS, maxAge: undefined });
  res.json({ ok: true });
});


app.get('/api/users/search', async (req, res) => {
  const q = (req.query.q || '').toLowerCase().trim();
  if (q.length < 1) return res.json([]);
  const r = await db('SELECT * FROM users WHERE username_low LIKE $1 LIMIT 10', [q + '%']);
  res.json(r.rows.map(row => ({ ...sanitizeUser(rowToUser(row)), online: onlineUsers.has(rowToUser(row).username) })));
});


app.get('/api/me', authMiddleware, async (req, res) => {
  const me = await getUser(req.user.username.toLowerCase());
  if (!me) return res.status(401).json({ error: 'Не найден' });
  // twoFactorEnabled — это настройка безопасности самого пользователя,
  // не публичный профиль, поэтому её нет в sanitizeUser (используется и для чужих профилей).
  res.json({ ...sanitizeUser(me, true), twoFactorEnabled: !!me.twoFactorEnabled });
});


app.post('/api/account/2fa/toggle', authMiddleware, rateLimit(limiterStrict, 'Слишком много запросов. Попробуйте позже.'), async (req, res) => {
  const { enabled } = req.body;
  const user = await getUser(req.user.username.toLowerCase());
  if (!user) return res.status(404).json({ error: 'Пользователь не найден' });
  if (enabled && !user.email) return res.status(400).json({ error: 'Для 2FA нужен привязанный email' });

  user.twoFactorEnabled = !!enabled;
  await db('UPDATE users SET two_factor_enabled=$1 WHERE id=$2', [user.twoFactorEnabled, user.id]);
  cacheUser(user);
  res.json({ ok: true, twoFactorEnabled: user.twoFactorEnabled });
});


app.post('/api/account/request-password-change', authMiddleware, rateLimit(limiterStrict, 'Слишком много запросов. Попробуйте позже.'), async (req, res) => {
  const { newPassword } = req.body;
  if (!newPassword || newPassword.length < 6)
    return res.status(400).json({ error: 'Новый пароль минимум 6 символов' });

  const user = await getUser(req.user.username.toLowerCase());
  if (!user) return res.status(404).json({ error: 'Пользователь не найден' });
  if (!user.email) return res.status(400).json({ error: 'Email не привязан к аккаунту' });

  const code = String(Math.floor(100000 + Math.random() * 900000));
  const newHash = await bcrypt.hash(newPassword, 10);

  for (const [k, v] of pendingPasswordChanges.entries()) {
    if (v.username === user.username) pendingPasswordChanges.delete(k);
  }

  pendingPasswordChanges.set(code, {
    username: user.username,
    newHash,
    expiresAt: Date.now() + 15 * 60 * 1000,
  });

  try {
    await Promise.race([
      sendPasswordChangeEmail(user.email, code),
      new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), 15000))
    ]);
    res.json({ ok: true, message: 'Код подтверждения отправлен на ' + user.email });
  } catch (err) {
    console.error('[PasswordChange]', err.message);
    pendingPasswordChanges.delete(code);
    res.status(500).json({ error: 'Не удалось отправить письмо: ' + err.message });
  }
});


app.post('/api/account/confirm-password-change', authMiddleware, rateLimit(limiterAuth, 'Слишком много попыток.'), async (req, res) => {
  const { code } = req.body;
  if (!code) return res.status(400).json({ error: 'Введите код' });

  const pending = pendingPasswordChanges.get(String(code));
  if (!pending) return res.status(400).json({ error: 'Неверный или истёкший код' });
  if (Date.now() > pending.expiresAt) {
    pendingPasswordChanges.delete(String(code));
    return res.status(400).json({ error: 'Код истёк. Запросите новый.' });
  }
  if (pending.username !== req.user.username)
    return res.status(403).json({ error: 'Код не принадлежит этому аккаунту' });

  const user = await getUser(req.user.username.toLowerCase());
  if (!user) return res.status(404).json({ error: 'Пользователь не найден' });

  user.passwordHash = pending.newHash;
  await db('UPDATE users SET password_hash=$1 WHERE id=$2', [user.passwordHash, user.id]);
  cacheUser(user);
  pendingPasswordChanges.delete(String(code));

  const sock = findSocketByUsername(user.username);
  if (sock) { sock.emit('session_expired', 'Пароль изменён'); sock.disconnect(); }

  res.json({ ok: true, message: 'Пароль успешно изменён' });
});


app.post('/api/account/request-delete', authMiddleware, rateLimit(limiterStrict, 'Слишком много запросов.'), async (req, res) => {
  const user = await getUser(req.user.username.toLowerCase());
  if (!user) return res.status(404).json({ error: 'Пользователь не найден' });
  if (user.role === 'admin') return res.status(403).json({ error: 'Нельзя удалить аккаунт администратора' });
  if (!user.email) return res.status(400).json({ error: 'Email не привязан к аккаунту' });

  const code = String(Math.floor(100000 + Math.random() * 900000));

  for (const [k, v] of pendingDeletions.entries()) {
    if (v.username === user.username) pendingDeletions.delete(k);
  }

  pendingDeletions.set(code, {
    username: user.username,
    expiresAt: Date.now() + 15 * 60 * 1000,
  });

  try {
    await Promise.race([
      sendDeleteAccountEmail(user.email, user.username, code),
      new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), 15000))
    ]);
    res.json({ ok: true, message: 'Код подтверждения отправлен на ' + user.email });
  } catch (err) {
    console.error('[DeleteAccount]', err.message);
    pendingDeletions.delete(code);
    res.status(500).json({ error: 'Не удалось отправить письмо: ' + err.message });
  }
});


app.post('/api/account/confirm-delete', authMiddleware, rateLimit(limiterAuth, 'Слишком много попыток.'), async (req, res) => {
  const { code } = req.body;
  if (!code) return res.status(400).json({ error: 'Введите код' });

  const pending = pendingDeletions.get(String(code));
  if (!pending) return res.status(400).json({ error: 'Неверный или истёкший код' });
  if (Date.now() > pending.expiresAt) {
    pendingDeletions.delete(String(code));
    return res.status(400).json({ error: 'Код истёк. Запросите новый.' });
  }
  if (pending.username !== req.user.username)
    return res.status(403).json({ error: 'Код не принадлежит этому аккаунту' });

  const user = await getUser(req.user.username.toLowerCase());
  if (!user) return res.status(404).json({ error: 'Пользователь не найден' });
  if (user.role === 'admin') return res.status(403).json({ error: 'Нельзя удалить аккаунт администратора' });

  pendingDeletions.delete(String(code));

  try {
    await db(`
      CREATE TABLE IF NOT EXISTS deleted_usernames (
        username_low TEXT PRIMARY KEY,
        deleted_at   BIGINT NOT NULL
      )
    `);
    await db('INSERT INTO deleted_usernames (username_low, deleted_at) VALUES ($1, $2) ON CONFLICT DO NOTHING', [user.username.toLowerCase(), Date.now()]);

    await db('DELETE FROM users WHERE id = $1', [user.id]);
    usersCache.delete(user.username.toLowerCase());

    const sock = findSocketByUsername(user.username);
    if (sock) { sock.emit('account_deleted'); sock.disconnect(); }

    console.log(`[DeleteAccount] Аккаунт удалён: ${user.username}`);
    res.json({ ok: true, message: 'Аккаунт удалён' });
  } catch (err) {
    console.error('[DeleteAccount confirm]', err.message);
    res.status(500).json({ error: 'Ошибка при удалении: ' + err.message });
  }
});


app.get('/api/users/:username', async (req, res) => {
  const user = await getUser(req.params.username.toLowerCase());
  if (!user) return res.status(404).json({ error: 'Не найден' });
  const payload = verifyToken(getAuthToken(req));
  const isSelf = payload && payload.username && payload.username.toLowerCase() === user.username.toLowerCase();
  const data = isSelf ? { ...sanitizeUser(user, true), email: user.email || null } : sanitizeUser(user, false);
  res.json({ ...data, online: onlineUsers.has(user.username) });
});


app.get('/api/users/:username/games', async (req, res) => {
  const u = req.params.username;
  const limit = parseInt(req.query.limit) || 20;
  const r = await db('SELECT * FROM games WHERE white = $1 OR black = $1 ORDER BY ended_at DESC LIMIT $2', [u, limit]);
  res.json(r.rows.map(row => ({
    id: row.id, white: row.white, black: row.black,
    result: row.result, reason: row.reason,
    moves: row.moves, timeControl: row.time_control,
    endedAt: row.ended_at ? Number(row.ended_at) : null,
    berserk: row.berserk, accuracy: row.accuracy,
    tournamentId: row.tournament_id,
    rated: row.rated !== false,
  })));
});


app.get('/api/games/:gameId', async (req, res) => {
  const active = activeGames.get(req.params.gameId);
  if (active) return res.json(active);
  const r = await db('SELECT * FROM games WHERE id = $1', [req.params.gameId]);
  if (!r.rows[0]) {
    // Фоллбэк: старые турнирные партии, сохранённые до записи в таблицу games
    for (const t of tournaments) {
      const tg = (t.games || []).find(g => g.id === req.params.gameId);
      if (tg) {
        return res.json({
          id: tg.id, white: tg.white, black: tg.black,
          result: tg.result, reason: tg.reason, moves: tg.moves,
          timeControl: tg.timeControl, endedAt: tg.endedAt || null,
          berserk: tg.berserk, accuracy: tg.accuracy, tournamentId: t.id,
        });
      }
    }
    return res.status(404).json({ error: 'Не найдена' });
  }
  const row = r.rows[0];
  res.json({
    id: row.id, white: row.white, black: row.black,
    result: row.result, reason: row.reason, moves: row.moves,
    timeControl: row.time_control, endedAt: row.ended_at ? Number(row.ended_at) : null,
    rated: row.rated !== false,
  });
});


app.get('/api/leaderboard', async (req, res) => {
  const r = await db('SELECT * FROM users ORDER BY rating DESC LIMIT 50');
  res.json(r.rows.map(row => ({ ...sanitizeUser(rowToUser(row)), online: onlineUsers.has(row.username) })));
});


// Раньше здесь было Math.max(onlineUsers.size, io.engine?.clientsCount || 0).
// onlineUsers — Set из юзернеймов (уже без дублей), а io.engine.clientsCount —
// это СЫРОЕ число открытых транспортных соединений на движке socket.io,
// включая кратковременно "зависшие" старые соединения при быстрых
// перезагрузках страницы (новый сокет уже подключился, а событие
// disconnect старого ещё не долетело). Из-за Math.max счётчик онлайна
// на секунды раздувался при частом F5, хотя реальных уникальных
// пользователей больше не становилось. onlineUsers.size — точное число.
app.get('/api/online',       (req, res) => res.json({ count: onlineUsers.size }));

app.all('/api/ping',         (req, res) => res.status(200).end());

app.get('/api/online/users', (req, res) => {
  const list = [...onlineUsers].map(username => {
    const u = usersCache.get(username.toLowerCase());
    return u ? { username: u.username, rating: u.rating, role: u.role || 'user', vip: isVip(u) } : { username, rating: null, role: 'user', vip: false };
  }).sort((a, b) => {
    if (a.role === 'admin' && b.role !== 'admin') return -1;
    if (b.role === 'admin' && a.role !== 'admin') return 1;
    return a.username.localeCompare(b.username);
  });
  res.json(list);
});


// ──────────────────────────────────────────────────────────────
//  QUESTS API (Сезон 2)
// ──────────────────────────────────────────────────────────────

app.get('/api/quests/list', authMiddleware, async (req, res) => {
    try {
        const userId = req.user.userId;
        const page = parseInt(req.query.page) || 1;
        const limit = Math.min(20, parseInt(req.query.limit) || 20);
        const offset = (page - 1) * limit;
        const currentDay = getCurrentSeasonDay();

        const questsQuery = await db(`
            SELECT q.id, q.day, q.title, q.reward_crystals, q.is_mega, q.type,
                   CASE WHEN uq.quest_id IS NOT NULL THEN true ELSE false END as completed,
                   CASE WHEN q.day <= $1 THEN true ELSE false END as unlocked_by_date
            FROM quests q
            LEFT JOIN user_quests uq ON q.id = uq.quest_id AND uq.user_id = $2
            ORDER BY q.day
            LIMIT $3 OFFSET $4
        `, [currentDay, userId, limit, offset]);

        const totalCount = await db('SELECT COUNT(*) as total FROM quests');
        const total = parseInt(totalCount.rows[0].total);

        const userStats = await db('SELECT total_crystals, total_crystals_updated_at FROM users WHERE id = $1', [userId]);
        const totalCrystals = userStats.rows[0]?.total_crystals || 0;
        const lastUpdated = userStats.rows[0]?.total_crystals_updated_at || 0;
        const todayStart = new Date().setHours(0, 0, 0, 0);
        const canDoToday = lastUpdated < todayStart;

        const firstIncomplete = await db(`
            SELECT q.id, q.day
            FROM quests q
            WHERE q.day <= $1
              AND NOT EXISTS (SELECT 1 FROM user_quests uq WHERE uq.quest_id = q.id AND uq.user_id = $2)
            ORDER BY q.day
            LIMIT 1
        `, [currentDay, userId]);
        const availableQuestId = firstIncomplete.rows[0]?.id || null;

        res.json({
            quests: questsQuery.rows,
            pagination: { page, limit, total },
            currentDay,
            canDoToday,
            availableQuestId,
            totalCrystals
        });
    } catch (err) {
        console.error('[Quests list]', err);
        res.status(500).json({ error: 'Ошибка загрузки квестов' });
    }
});


app.post('/api/quests/complete', authMiddleware, async (req, res) => {
    const userId = req.user.userId;
    const limCheck = limiterQuests.check(userId);
    if (!limCheck.allowed) {
        return res.status(429).json({ error: 'Слишком много попыток. Подождите немного.' });
    }

    try {
        const { confirmed } = req.body;
        const currentDay = getCurrentSeasonDay();
        const now = Date.now();
        const todayStart = new Date().setHours(0, 0, 0, 0);

        const result = await withTransaction(async (client) => {
            // FOR UPDATE — блокирует строку пользователя до конца транзакции,
            // так что два конкурентных запроса от одного юзера не смогут оба
            // пройти проверку "квест ещё не выполнен сегодня" одновременно.
            const user = await client.query(
                'SELECT total_crystals_updated_at FROM users WHERE id = $1 FOR UPDATE',
                [userId]
            );
            const lastUpdated = user.rows[0]?.total_crystals_updated_at || 0;
            if (lastUpdated >= todayStart) {
                return { error: 'Сегодня вы уже выполнили квест', status: 400 };
            }

            const firstQuest = await client.query(`
                SELECT q.id, q.day, q.type, q.reward_crystals
                FROM quests q
                LEFT JOIN user_quests uq ON q.id = uq.quest_id AND uq.user_id = $1
                WHERE q.day <= $2
                  AND uq.quest_id IS NULL
                  AND q.type IN ('manual', 'confirm')
                ORDER BY q.day
                LIMIT 1
            `, [userId, currentDay]);

            if (firstQuest.rows.length === 0) {
                return { error: 'Нет доступных квестов', status: 400 };
            }

            const quest = firstQuest.rows[0];
            if (quest.type === 'confirm' && !confirmed) {
                return { error: 'Нужно подтверждение', status: 400 };
            }

            // ON CONFLICT — вторая защита от гонки на случай, если тот же квест
            // уже был вставлен параллельным запросом до FOR UPDATE.
            const inserted = await client.query(
                `INSERT INTO user_quests (user_id, quest_id, completed_at, progress, target)
                 VALUES ($1, $2, $3, 0, 0)
                 ON CONFLICT (user_id, quest_id) DO NOTHING
                 RETURNING quest_id`,
                [userId, quest.id, now]
            );
            if (inserted.rows.length === 0) {
                return { error: 'Квест уже выполнен', status: 400 };
            }

            const updated = await client.query(
                `UPDATE users SET total_crystals = total_crystals + $1, total_crystals_updated_at = $2
                 WHERE id = $3 RETURNING total_crystals`,
                [quest.reward_crystals, now, userId]
            );

            return {
                success: true,
                added: quest.reward_crystals,
                totalCrystals: updated.rows[0].total_crystals,
                canDoToday: false,
                completedQuestId: quest.id
            };
        });

        if (result.error) return res.status(result.status).json({ error: result.error });
        res.json(result);
    } catch (err) {
        console.error('[Quests complete]', err);
        res.status(500).json({ error: 'Ошибка при выполнении квеста' });
    }
});

app.get('/api/quests/leaderboard', async (req, res) => {
    try {
        const limit = Math.min(50, parseInt(req.query.limit) || 10);
        const rows = await db(`
            SELECT username, total_crystals, total_crystals_updated_at
            FROM users
            WHERE total_crystals > 0
            ORDER BY total_crystals DESC, total_crystals_updated_at ASC
            LIMIT $1
        `, [limit]);
        res.json(rows.rows);
    } catch (err) {
        console.error('[Quests leaderboard]', err);
        res.status(500).json({ error: 'Ошибка загрузки лидерборда' });
    }
});

app.get('/api/challenges', (req, res) => res.json(pendingChallenges.filter(c => Date.now() - c.createdAt < 60000)));

app.get('/api/chat', async (req, res) => {
  const limit = parseInt(req.query.limit) || 50;
  const auth = getAuthToken(req);
  let callerUsername = null;
  if (auth) { try { callerUsername = jwt.verify(auth, JWT_SECRET).username.toLowerCase(); } catch {} }
  let isAdmin = false;
  if (callerUsername) {
    const caller = await getUser(callerUsername);
    isAdmin = caller?.role === 'admin';
  }
  // Сообщения теневого бана видит только сам автор и админы — для всех
  // остальных они как будто никогда не отправлялись (см. socket-хендлер
  // global_chat в sockets.js).
  const visible = globalChat.filter(m => {
    if (!m.shadowHidden) return true;
    return isAdmin || (callerUsername && callerUsername === m.username.toLowerCase());
  });
  res.json(visible.slice(-limit));
});


// ── Admin API ─────────────────────────────────────────────────
app.get('/api/admin/users', authMiddleware, async (req, res) => {
  await requireAdmin(req, res, async () => {
    const r = await db('SELECT * FROM users ORDER BY rating DESC');
    res.json(r.rows.map(row => adminSanitizeUser(rowToUser(row))));
  });
});


app.post('/api/admin/ban', authMiddleware, async (req, res) => {
  await requireAdmin(req, res, async () => {
    try {
      const target = await getUser((req.body.username || '').toLowerCase());
      if (!target) return res.status(404).json({ error: 'Не найден' });
      if (target.role === 'admin') return res.status(403).json({ error: 'Нельзя забанить администратора' });

      const reason = req.body.reason || 'Нарушение правил';
      const targetDevice = target.createdDeviceId;
      if (targetDevice) { bannedDevices.add(targetDevice); await saveBanToDB(null, targetDevice); }

      const r = await db('SELECT * FROM users WHERE created_device_id = $1 AND role != $2', [targetDevice || '__none__', 'admin']);
      let count = 0;
      for (const row of r.rows) {
        const u = rowToUser(row);
        if (!u.banned) {
          const isTarget = u.username === target.username;
          u.banned = true; u.banReason = reason + (!isTarget ? ' (мультиаккаунт)' : '');
          await saveUser(u);
          await removeUserChatMessages(u.username).catch(e => console.error('[Ban] chat cleanup:', e.message));
          const sock = findSocketByUsername(u.username);
          if (sock) { sock.emit('error', 'Аккаунт заблокирован'); sock.disconnect(); }
          count++;
        }
      }
      if (!target.banned) {
        target.banned = true; target.banReason = reason;
        await saveUser(target);
        await removeUserChatMessages(target.username).catch(e => console.error('[Ban] chat cleanup:', e.message));
        const sock = findSocketByUsername(target.username);
        if (sock) { sock.emit('error', 'Аккаунт заблокирован'); sock.disconnect(); }
        count++;
      }
      await logAdminAction(req.user.username, 'ban', target.username, { reason, accountsBanned: count, viaDeviceId: targetDevice || null });
      res.json({ ok: true, accountsBanned: count });
    } catch (e) {
      console.error('[Ban]', e);
      res.status(500).json({ error: 'Ошибка бана: ' + e.message });
    }
  });
});


app.post('/api/admin/unban', authMiddleware, async (req, res) => {
  await requireAdmin(req, res, async () => {
    try {
      const target = await getUser((req.body.username || '').toLowerCase());
      if (!target) return res.status(404).json({ error: 'Не найден' });
      target.banned = false; target.banReason = null;
      if (target.createdDeviceId) { bannedDevices.delete(target.createdDeviceId); await removeBanFromDB(null, target.createdDeviceId); }
      if (req.body.unbanIP && target.createdFromIP) { bannedIPs.delete(target.createdFromIP); await removeBanFromDB(target.createdFromIP, null); }
      await saveUser(target);
      await logAdminAction(req.user.username, 'unban', target.username, { unbanIP: !!req.body.unbanIP });
      res.json({ ok: true });
    } catch (e) {
      console.error('[Unban]', e);
      res.status(500).json({ error: 'Ошибка разбана: ' + e.message });
    }
  });
});


// ── Теневой бан ─────────────────────────────────────────────────
// В отличие от /admin/ban: ничего не блокирует и не рвёт соединение —
// цель продолжает пользоваться сайтом как обычно и не должна ничего
// заподозрить. Единственный эффект — его сообщения (публичный чат и
// ЛС, см. sockets.js и /api/dm/send) реально доходят только до него
// самого и до админов. Независимо от обычного banned — можно включить
// одно, оба или ни одного.
app.post('/api/admin/shadowban', authMiddleware, async (req, res) => {
  await requireAdmin(req, res, async () => {
    try {
      const target = await getUser((req.body.username || '').toLowerCase());
      if (!target) return res.status(404).json({ error: 'Не найден' });
      if (target.role === 'admin') return res.status(403).json({ error: 'Нельзя применить к администратору' });
      target.shadowBanned = true;
      target.shadowBanReason = req.body.reason || 'Нарушение правил';
      await saveUser(target);
      await logAdminAction(req.user.username, 'shadowban', target.username, { reason: target.shadowBanReason });
      res.json({ ok: true });
    } catch (e) {
      console.error('[ShadowBan]', e);
      res.status(500).json({ error: 'Ошибка теневого бана: ' + e.message });
    }
  });
});


app.post('/api/admin/unshadowban', authMiddleware, async (req, res) => {
  await requireAdmin(req, res, async () => {
    try {
      const target = await getUser((req.body.username || '').toLowerCase());
      if (!target) return res.status(404).json({ error: 'Не найден' });
      target.shadowBanned = false; target.shadowBanReason = null;
      await saveUser(target);
      await logAdminAction(req.user.username, 'unshadowban', target.username, {});
      res.json({ ok: true });
    } catch (e) {
      console.error('[UnShadowBan]', e);
      res.status(500).json({ error: 'Ошибка снятия теневого бана: ' + e.message });
    }
  });
});


// ── VIP-значок ──────────────────────────────────────────────────
// Выдают/снимают только chesshome и Marina64 (requireVipGranter),
// а не любой admin — так попросил владелец.
app.post('/api/admin/vip/grant', authMiddleware, async (req, res) => {
  await requireVipGranter(req, res, async () => {
    try {
      const target = await getUser((req.body.username || '').toLowerCase());
      if (!target) return res.status(404).json({ error: 'Пользователь не найден' });
      const days = Math.min(365, Math.max(1, parseInt(req.body.days) || 30));
      // Если значок уже активен — продлеваем от текущей даты окончания, а не от "сейчас".
      const base = isVip(target) ? target.vipUntil : Date.now();
      target.vipUntil = base + days * 24 * 60 * 60 * 1000;
      await saveUser(target);
      await logAdminAction(req.user.username, 'vip_grant', target.username, { days, vipUntil: target.vipUntil });
      const sock = findSocketByUsername(target.username);
      if (sock) sock.emit('vip_updated', { vip: true, vipUntil: target.vipUntil });
      res.json({ ok: true, username: target.username, vipUntil: target.vipUntil });
    } catch (e) {
      console.error('[VIP grant]', e);
      res.status(500).json({ error: 'Ошибка выдачи значка: ' + e.message });
    }
  });
});


app.post('/api/admin/vip/revoke', authMiddleware, async (req, res) => {
  await requireVipGranter(req, res, async () => {
    try {
      const target = await getUser((req.body.username || '').toLowerCase());
      if (!target) return res.status(404).json({ error: 'Пользователь не найден' });
      target.vipUntil = null;
      await saveUser(target);
      await logAdminAction(req.user.username, 'vip_revoke', target.username, {});
      const sock = findSocketByUsername(target.username);
      if (sock) sock.emit('vip_updated', { vip: false, vipUntil: null });
      res.json({ ok: true });
    } catch (e) {
      console.error('[VIP revoke]', e);
      res.status(500).json({ error: 'Ошибка снятия значка: ' + e.message });
    }
  });
});


app.get('/api/admin/vip/list', authMiddleware, async (req, res) => {
  await requireVipGranter(req, res, async () => {
    const r = await db('SELECT username, vip_until FROM users WHERE vip_until IS NOT NULL AND vip_until > $1 ORDER BY vip_until ASC', [Date.now()]);
    res.json(r.rows.map(row => ({ username: row.username, vipUntil: Number(row.vip_until) })));
  });
});


app.get('/api/admin/ipbans', authMiddleware, async (req, res) => {
  await requireAdmin(req, res, async () => {
    res.json({ ips: [...bannedIPs], devices: [...bannedDevices], total: bannedIPs.size });
  });
});


app.post('/api/admin/ipban', authMiddleware, async (req, res) => {
  await requireAdmin(req, res, async () => {
    const target = await getUser((req.body.username || '').toLowerCase());
    if (!target) return res.status(404).json({ error: 'Не найден' });
    if (target.role === 'admin') return res.status(403).json({ error: 'Нельзя' });
    const ip = target.createdFromIP;
    if (!ip) return res.status(400).json({ error: 'IP не сохранён' });
    if (isLocalIP(ip)) return res.status(400).json({ error: 'Нельзя забанить локальный IP' });
    bannedIPs.add(ip); await saveBanToDB(ip, target.createdDeviceId || null);
    if (target.createdDeviceId) bannedDevices.add(target.createdDeviceId);

    const r = await db('SELECT * FROM users WHERE created_device_id = $1 AND role != $2', [target.createdDeviceId || '__none__', 'admin']);
    let count = 0;
    for (const row of r.rows) {
      const u = rowToUser(row);
      if (!u.banned) {
        u.banned = true; u.banReason = 'IP-бан администратором';
        await saveUser(u);
        const sock = findSocketByUsername(u.username);
        if (sock) { sock.emit('error', 'Аккаунт заблокирован'); sock.disconnect(); }
        count++;
      }
    }
    await logAdminAction(req.user.username, 'ip_ban', ip, { viaUser: target.username, accountsBanned: count });
    res.json({ ok: true, ip, accountsBanned: count });
  });
});


app.post('/api/admin/ipunban', authMiddleware, async (req, res) => {
  await requireAdmin(req, res, async () => {
    const ip = req.body.ip;
    if (!ip) return res.status(400).json({ error: 'Укажите IP' });
    bannedIPs.delete(ip); await removeBanFromDB(ip, null);
    await logAdminAction(req.user.username, 'ip_unban', ip, {});
    res.json({ ok: true });
  });
});


app.post('/api/admin/unban-device', authMiddleware, async (req, res) => {
  await requireAdmin(req, res, async () => {
    const deviceId = req.body.deviceId;
    if (!deviceId) return res.status(400).json({ error: 'Укажите deviceId' });
    bannedDevices.delete(deviceId); await removeBanFromDB(null, deviceId);
    await logAdminAction(req.user.username, 'device_unban', deviceId, {});
    res.json({ ok: true });
  });
});


app.post('/api/admin/unban-full', authMiddleware, async (req, res) => {
  await requireAdmin(req, res, async () => {
    const target = await getUser((req.body.username || '').toLowerCase());
    if (!target) return res.status(404).json({ error: 'Не найден' });
    target.banned = false; target.banReason = null;
    if (target.createdDeviceId) { bannedDevices.delete(target.createdDeviceId); await removeBanFromDB(null, target.createdDeviceId); }
    if (target.createdFromIP)   { bannedIPs.delete(target.createdFromIP); await removeBanFromDB(target.createdFromIP, null); }
    await saveUser(target);
    await logAdminAction(req.user.username, 'unban_full', target.username, {});
    res.json({ ok: true });
  });
});

app.delete('/api/admin/chat/:msgId', authMiddleware, handleDeleteChatMsg);

app.post('/api/admin/chat/:msgId/delete', authMiddleware, handleDeleteChatMsg);


app.delete('/api/admin/chat/user/:username', authMiddleware, async (req, res) => {
  await requireAdmin(req, res, async () => {
    const removed = await removeUserChatMessages(req.params.username);
    await logAdminAction(req.user.username, 'chat_clear_user', req.params.username, { removed });
    res.json({ ok: true, removed });
  });
});


app.post('/api/admin/chat-ban', authMiddleware, async (req, res) => {
  await requireAdmin(req, res, async () => {
    try {
      const { username, durationMinutes } = req.body;
      if (!username || !durationMinutes) return res.status(400).json({ error: 'Нет параметров' });
      const dur = Math.max(1, Math.min(1440, parseInt(durationMinutes) || 15));
      const unbanAt = Date.now() + dur * 60 * 1000;

      if (!global.chatBans) global.chatBans = new Map();
      global.chatBans.set(username.toLowerCase(), unbanAt);

      // Чистим уже отправленные сообщения — мут не должен оставлять
      // спам/реклама/XSS-попытки висеть в чате до истечения таймера.
      await removeUserChatMessages(username).catch(e => console.error('[ChatBan] chat cleanup:', e.message));

      let durText;
      if (dur < 60) durText = dur + ' минут';
      else if (dur === 60) durText = '1 час';
      else if (dur < 1440) durText = Math.round(dur / 60) + ' часа';
      else durText = '24 часа';

      const sysMsg = `${username} заблокирован в чате на ${durText}. Соблюдайте правила платформы.`;

      const sysChatMsg = { id: require('crypto').randomUUID(), username: 'system', message: sysMsg, role: 'system', timestamp: Date.now(), system: true };
      globalChat.push(sysChatMsg);
      if (globalChat.length > 500) globalChat.shift();

      io.emit('chat_system_msg', sysMsg);

      await logAdminAction(req.user.username, 'chat_ban', username, { durationMinutes: dur, unbanAt });
      res.json({ ok: true, unbanAt });
    } catch (e) {
      console.error('[ChatBan]', e);
      res.status(500).json({ error: 'Ошибка чат-бана: ' + e.message });
    }
  });
});

app.post('/api/report', authMiddleware, rateLimit(limiterStrict), async (req, res) => {
  const { targetUsername, reason, details } = req.body;
  if (!targetUsername || !reason) return res.status(400).json({ error: 'Укажите причину' });
  
  const target = await getUser((targetUsername || '').toLowerCase());
  if (!target) return res.status(404).json({ error: 'Не найден' });
  if (targetUsername === req.user.username) return res.status(400).json({ error: 'Нельзя жаловаться на себя' });

  // Проверка лимита: 1 жалоба на одного и того же человека в неделю
  const ONE_WEEK_MS = 7 * 24 * 60 * 60 * 1000;
  const recentReport = await db(
    'SELECT created_at FROM reports WHERE reporter = $1 AND target_username = $2 ORDER BY created_at DESC LIMIT 1',
    [req.user.username, target.username]
  );

  if (recentReport.rows.length > 0) {
    const lastReportTime = Number(recentReport.rows[0].created_at);
    if (Date.now() - lastReportTime < ONE_WEEK_MS) {
      return res.status(429).json({ 
        error: 'Вы уже отправляли жалобу на этого игрока. Повторную жалобу можно отправить через неделю.' 
      });
    }
  }

  const report = {
    id: uuidv4(), reporter: req.user.username, targetUsername: target.username,
    reason, details: (details || '').slice(0, 500), status: 'new', createdAt: Date.now()
  };
  
  await db('INSERT INTO reports (id, reporter, target_username, reason, details, status, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7)',
    [report.id, report.reporter, report.targetUsername, report.reason, report.details, report.status, report.createdAt]);
    
  const total = (await db("SELECT COUNT(*) FROM reports WHERE status='new'")).rows[0].count;
  await emitToAdmins('new_report', { report, total: Number(total) });
  res.json({ ok: true });
});


app.get('/api/admin/reports', authMiddleware, async (req, res) => {
  await requireAdmin(req, res, async () => {
    const status = req.query.status;
    const r = status
      ? await db('SELECT * FROM reports WHERE status = $1 ORDER BY created_at DESC LIMIT 100', [status])
      : await db('SELECT * FROM reports ORDER BY created_at DESC LIMIT 100');
    res.json(r.rows.map(row => ({
      id: row.id, reporter: row.reporter, targetUsername: row.target_username,
      reason: row.reason, details: row.details, status: row.status,
      createdAt: Number(row.created_at), reviewedBy: row.reviewed_by, reviewedAt: row.reviewed_at,
    })));
  });
});

// PATCH — основной вариант. Некоторые хостинги/прокси режут методы PATCH/DELETE,
// поэтому дублируем ту же логику через POST — фронтенд теперь ходит именно сюда.
app.patch('/api/admin/reports/:reportId', authMiddleware, handleUpdateReportStatus);

app.post('/api/admin/reports/:reportId/status', authMiddleware, handleUpdateReportStatus);


app.post('/api/appeals', authMiddleware, rateLimit(limiterStrict), async (req, res) => {
  const { reason, message } = req.body;
  if (!reason || !APPEAL_REASONS.includes(reason)) return res.status(400).json({ error: 'Укажите тему обращения' });
  const text = (message || '').trim();
  if (!text) return res.status(400).json({ error: 'Напишите сообщение' });
  if (text.length > 1000) return res.status(400).json({ error: 'Слишком длинное сообщение (макс. 1000 символов)' });

  const openExisting = await db(
    `SELECT id FROM appeals WHERE username = $1 AND status = 'open' LIMIT 1`,
    [req.user.username]
  );
  if (openExisting.rows.length > 0) {
    return res.status(409).json({
      error: 'У вас уже есть открытое обращение. Дождитесь ответа администратора.',
      appealId: openExisting.rows[0].id
    });
  }

  const id = uuidv4();
  const now = Date.now();
  await db(
    `INSERT INTO appeals (id, username, reason, status, awaiting, created_at, updated_at) VALUES ($1,$2,$3,'open','admin',$4,$4)`,
    [id, req.user.username, reason, now]
  );
  await db(
    `INSERT INTO appeal_messages (id, appeal_id, author, is_admin, message, created_at) VALUES ($1,$2,$3,FALSE,$4,$5)`,
    [uuidv4(), id, req.user.username, text, now]
  );

  const total = (await db(`SELECT COUNT(*) FROM appeals WHERE status='open' AND awaiting='admin'`)).rows[0].count;
  await emitToAdmins('new_appeal', { appealId: id, username: req.user.username, reason, total: Number(total) });
  res.json({ ok: true, appealId: id });
});


app.get('/api/appeals/mine', authMiddleware, async (req, res) => {
  const list = await db(`SELECT * FROM appeals WHERE username = $1 ORDER BY created_at DESC LIMIT 20`, [req.user.username]);
  const appeals = [];
  for (const row of list.rows) {
    const msgs = await db(`SELECT * FROM appeal_messages WHERE appeal_id = $1 ORDER BY created_at ASC`, [row.id]);
    appeals.push({
      id: row.id, reason: row.reason, status: row.status, awaiting: row.awaiting,
      createdAt: Number(row.created_at), updatedAt: Number(row.updated_at),
      messages: msgs.rows.map(m => ({ id: m.id, author: m.author, isAdmin: m.is_admin, message: m.message, createdAt: Number(m.created_at) }))
    });
  }
  res.json(appeals);
});


app.post('/api/appeals/:id/reply', authMiddleware, rateLimit(limiterStrict), async (req, res) => {
  const text = (req.body.message || '').trim();
  if (!text) return res.status(400).json({ error: 'Напишите сообщение' });
  if (text.length > 1000) return res.status(400).json({ error: 'Слишком длинное сообщение (макс. 1000 символов)' });

  const r = await db(`SELECT * FROM appeals WHERE id = $1`, [req.params.id]);
  const appeal = r.rows[0];
  if (!appeal) return res.status(404).json({ error: 'Обращение не найдено' });
  if (appeal.username !== req.user.username) return res.status(403).json({ error: 'Это не ваше обращение' });
  if (appeal.status === 'closed') return res.status(400).json({ error: 'Обращение закрыто администратором' });
  if (appeal.awaiting !== 'user') return res.status(400).json({ error: 'Дождитесь ответа администратора, прежде чем писать снова' });

  const now = Date.now();
  await db(
    `INSERT INTO appeal_messages (id, appeal_id, author, is_admin, message, created_at) VALUES ($1,$2,$3,FALSE,$4,$5)`,
    [uuidv4(), appeal.id, req.user.username, text, now]
  );
  await db(`UPDATE appeals SET awaiting='admin', updated_at=$1 WHERE id=$2`, [now, appeal.id]);

  const total = (await db(`SELECT COUNT(*) FROM appeals WHERE status='open' AND awaiting='admin'`)).rows[0].count;
  await emitToAdmins('new_appeal', { appealId: appeal.id, username: req.user.username, reason: appeal.reason, total: Number(total) });
  res.json({ ok: true });
});


app.get('/api/admin/appeals', authMiddleware, async (req, res) => {
  await requireAdmin(req, res, async () => {
    const status = req.query.status;
    const r = status
      ? await db(`SELECT * FROM appeals WHERE status = $1 ORDER BY updated_at DESC LIMIT 200`, [status])
      : await db(`SELECT * FROM appeals ORDER BY updated_at DESC LIMIT 200`);
    res.json(r.rows.map(row => ({
      id: row.id, username: row.username, reason: row.reason, status: row.status,
      awaiting: row.awaiting, createdAt: Number(row.created_at), updatedAt: Number(row.updated_at),
    })));
  });
});


app.get('/api/admin/appeals/:id', authMiddleware, async (req, res) => {
  await requireAdmin(req, res, async () => {
    const r = await db(`SELECT * FROM appeals WHERE id = $1`, [req.params.id]);
    const appeal = r.rows[0];
    if (!appeal) return res.status(404).json({ error: 'Не найдено' });
    const msgs = await db(`SELECT * FROM appeal_messages WHERE appeal_id = $1 ORDER BY created_at ASC`, [appeal.id]);
    res.json({
      id: appeal.id, username: appeal.username, reason: appeal.reason, status: appeal.status,
      awaiting: appeal.awaiting, createdAt: Number(appeal.created_at), updatedAt: Number(appeal.updated_at),
      messages: msgs.rows.map(m => ({ id: m.id, author: m.author, isAdmin: m.is_admin, message: m.message, createdAt: Number(m.created_at) }))
    });
  });
});


app.post('/api/admin/appeals/:id/reply', authMiddleware, rateLimit(limiterStrict), async (req, res) => {
  await requireAdmin(req, res, async () => {
    const text = (req.body.message || '').trim();
    if (!text) return res.status(400).json({ error: 'Напишите сообщение' });
    if (text.length > 2000) return res.status(400).json({ error: 'Слишком длинное сообщение' });

    const r = await db(`SELECT * FROM appeals WHERE id = $1`, [req.params.id]);
    const appeal = r.rows[0];
    if (!appeal) return res.status(404).json({ error: 'Не найдено' });
    if (appeal.status === 'closed') return res.status(400).json({ error: 'Обращение закрыто — сначала откройте его заново' });

    const now = Date.now();
    await db(
      `INSERT INTO appeal_messages (id, appeal_id, author, is_admin, message, created_at) VALUES ($1,$2,$3,TRUE,$4,$5)`,
      [uuidv4(), appeal.id, req.user.username, text, now]
    );
    await db(`UPDATE appeals SET awaiting='user', updated_at=$1 WHERE id=$2`, [now, appeal.id]);

    const sock = findSocketByUsername(appeal.username);
    if (sock) sock.emit('appeal_reply', { appealId: appeal.id });
    await logAdminAction(req.user.username, 'appeal_reply', appeal.username, { appealId: appeal.id, text: text.slice(0, 200) });
    res.json({ ok: true });
  });
});

app.patch('/api/admin/appeals/:id', authMiddleware, handleUpdateAppealStatus);

app.post('/api/admin/appeals/:id/status', authMiddleware, handleUpdateAppealStatus);

// ── Tournaments API ───────────────────────────────────────────
app.get('/api/tournaments', async (req, res) => {
  const now = Date.now();
  const oneYearAgo = now - 365 * 24 * 60 * 60 * 1000;
  let list = tournaments
    .filter(t => {
      if (getTournamentStatus(t, now) === 'finished' && t.endsAt < oneYearAgo) return false;
      return true;
    })
    .map(t => ({
      ...t, participantsCount: (t.participants || []).filter(p => !p.anticheatBanned).length,
      status: getTournamentStatus(t, now), participants: undefined, games: undefined, blacklist: undefined,
      createdByIsAdmin: usersCache.get((t.createdBy || '').toLowerCase())?.role === 'admin',
      teams: getInterclubTeamsInfo(t),
    }));
  if (req.query.status) list = list.filter(t => t.status === req.query.status);
  if (req.query.clubId) list = list.filter(t => t.clubId === req.query.clubId);
  // ?isInterclub=true — только межклубные турниры (для отдельной страницы),
  // ?isInterclub=false — только обычные (скрыть межклубные из общего списка турниров).
  if (req.query.isInterclub === 'true') list = list.filter(t => t.isInterclub);
  if (req.query.isInterclub === 'false') list = list.filter(t => !t.isInterclub);
  list.sort((a, b) => a.startsAt - b.startsAt);
  res.json(list);
});


app.get('/api/tournaments/:id', (req, res) => {
  const t = tournaments.find(t => t.id === req.params.id);
  if (!t) return res.status(404).json({ error: 'Не найден' });
  const now = Date.now();
  const sorted = [...(t.participants || [])].filter(p => !p.anticheatBanned).sort((a, b) => b.score - a.score || b.wins - a.wins);
  let isAdmin = false;
  const authToken_ = getAuthToken(req);
  if (authToken_) {
    try { const d = jwt.verify(authToken_, JWT_SECRET); const u = usersCache.get(d.username.toLowerCase()); isAdmin = u?.role === 'admin'; } catch {}
  }
  res.json({ ...t, participants: sorted, status: getTournamentStatus(t, now), isArchive: t.endsAt < now - 365*24*60*60*1000, blacklist: isAdmin ? (t.blacklist || []) : undefined, createdByIsAdmin: usersCache.get((t.createdBy || '').toLowerCase())?.role === 'admin', teams: getInterclubTeamsInfo(t), teamStandings: computeTeamStandings(t) });
});


app.post('/api/tournaments', authMiddleware, async (req, res) => {
  if (!req.user) return res.status(401).json({ error: 'Нет доступа' });
  const user = await getUser(req.user.username.toLowerCase());
  if (!user) return res.status(401).json({ error: 'Нет доступа' });

  const isAdmin = user.role === 'admin';
  const { name, description, timeControl, durationMinutes, startsAt, maxParticipants, minRating, maxRating, blacklist, clubId, clubOnly } = req.body;
  if (!name || !timeControl || !durationMinutes || !startsAt) return res.status(400).json({ error: 'Заполните обязательные поля' });

  // Клубный турнир — привязка турнира к клубу разрешена только его администраторам
  // (защита от спама: обычный участник клуба не может создать «клубный» турнир от его имени).
  let finalClubId = null, finalClubOnly = false;
  if (clubId) {
    const club = clubs.find(c => c.id === clubId);
    if (!club) return res.status(404).json({ error: 'Клуб не найден' });
    if (!isClubModerator(club, user.username)) return res.status(403).json({ error: 'Только администраторы клуба могут создавать клубные турниры' });
    finalClubId = club.id;
    finalClubOnly = !!clubOnly;
  }

  const startTime = new Date(startsAt).getTime();
  if (isNaN(startTime)) return res.status(400).json({ error: 'Неверная дата' });

  const now = Date.now();

  // Нельзя создать турнир в прошлом
  if (startTime < now - 60000) return res.status(400).json({ error: 'Нельзя создать турнир в прошлом' });

  // Максимум — через год
  const oneYearFromNow = now + 365 * 24 * 60 * 60 * 1000;
  if (startTime > oneYearFromNow) return res.status(400).json({ error: 'Максимальная дата — через 1 год от сегодня' });

  // Обычным юзерам — не более 3 турниров в день
  if (!isAdmin) {
    const startOfDay = new Date(); startOfDay.setHours(0, 0, 0, 0);
    const todayTs = startOfDay.getTime();
    const createdToday = tournaments.filter(t => t.createdBy === user.username && t.createdAt >= todayTs).length;
    if (createdToday >= 3) return res.status(429).json({ error: 'Вы уже создали 3 турнира сегодня. Лимит: 3 в день' });
  }

  const bl = Array.isArray(blacklist) ? blacklist.map(s => String(s).toLowerCase().trim()).filter(Boolean).slice(0, 100) : [];
  const tournament = {
    id: uuidv4(), name: name.trim().slice(0, 60), description: (description || '').trim().slice(0, 1000),
    timeControl, durationMinutes: parseInt(durationMinutes),
    startsAt: startTime, endsAt: startTime + parseInt(durationMinutes) * 60000,
    maxParticipants: parseInt(maxParticipants) || 0, minRating: parseInt(minRating) || 0, maxRating: parseInt(maxRating) || 9999,
    blacklist: bl, createdBy: user.username, createdAt: now,
    participants: [], games: [], winner: null,
    clubId: finalClubId, clubOnly: finalClubOnly,
    isInterclub: false, teamIds: [],
  };
  tournaments.push(tournament);
  await saveTournament(tournament);
  io.emit('tournament_created', { id: tournament.id, name: tournament.name, timeControl: tournament.timeControl, startsAt: tournament.startsAt, durationMinutes: tournament.durationMinutes, clubId: tournament.clubId });
  res.json(tournament);
});


// ── Создание межклубного турнира — теперь доступно любому пользователю ──
// (раньше было только сайт-админу). В теле запроса вместо clubId/clubOnly
// передаётся teamLinks — массив ссылок (или голых id) на клубы-команды,
// которые будут сражаться в этом турнире. Управление уже созданным турниром
// (редактирование, удаление) по-прежнему доступно только сайт-админу —
// см. canManageTournament — это защита от того, что случайный участник
// сможет менять состав команд или снести чужой турнир.
app.post('/api/tournaments/interclub', authMiddleware, async (req, res) => {
  if (!req.user) return res.status(401).json({ error: 'Нет доступа' });
  const user = await getUser(req.user.username.toLowerCase());
  if (!user) return res.status(401).json({ error: 'Нет доступа' });

  const isAdmin = user.role === 'admin';
  const { name, description, timeControl, durationMinutes, startsAt, minRating, maxRating, blacklist, teamLinks } = req.body;
  if (!name || !timeControl || !durationMinutes || !startsAt) return res.status(400).json({ error: 'Заполните обязательные поля' });

  const { teamIds, notFound } = resolveInterclubTeams(teamLinks);
  if (teamIds.length < 2) return res.status(400).json({ error: 'Нужно указать ссылки минимум на 2 клуба-команды' });
  if (teamIds.length > MAX_INTERCLUB_TEAMS) return res.status(400).json({ error: `Максимум ${MAX_INTERCLUB_TEAMS} команд в межклубном турнире` });
  if (notFound.length) return res.status(400).json({ error: `Не найдены клубы по ссылкам: ${notFound.slice(0, 10).join(', ')}` });

  const startTime = new Date(startsAt).getTime();
  if (isNaN(startTime)) return res.status(400).json({ error: 'Неверная дата' });
  const now = Date.now();
  if (startTime < now - 60000) return res.status(400).json({ error: 'Нельзя создать турнир в прошлом' });
  const oneYearFromNow = now + 365 * 24 * 60 * 60 * 1000;
  if (startTime > oneYearFromNow) return res.status(400).json({ error: 'Максимальная дата — через 1 год от сегодня' });

  // Обычным юзерам — не более 3 турниров в день (общий лимит с обычными
  // турнирами — см. POST /api/tournaments — чтобы нельзя было обойти его,
  // просто создавая межклубники вместо обычных турниров).
  if (!isAdmin) {
    const startOfDay = new Date(); startOfDay.setHours(0, 0, 0, 0);
    const todayTs = startOfDay.getTime();
    const createdToday = tournaments.filter(t => t.createdBy === user.username && t.createdAt >= todayTs).length;
    if (createdToday >= 3) return res.status(429).json({ error: 'Вы уже создали 3 турнира сегодня. Лимит: 3 в день' });
  }

  const bl = Array.isArray(blacklist) ? blacklist.map(s => String(s).toLowerCase().trim()).filter(Boolean).slice(0, 100) : [];
  const tournament = {
    id: uuidv4(), name: name.trim().slice(0, 60), description: (description || '').trim().slice(0, 1000),
    timeControl, durationMinutes: parseInt(durationMinutes),
    startsAt: startTime, endsAt: startTime + parseInt(durationMinutes) * 60000,
    // У межклубных турниров нет общего лимита участников — он естественно
    // ограничен суммарным числом членов заявленных команд.
    maxParticipants: 0, minRating: parseInt(minRating) || 0, maxRating: parseInt(maxRating) || 9999,
    blacklist: bl, createdBy: user.username, createdAt: now,
    participants: [], games: [], winner: null,
    clubId: null, clubOnly: false,
    isInterclub: true, teamIds,
  };
  tournaments.push(tournament);
  await saveTournament(tournament);
  io.emit('tournament_created', { id: tournament.id, name: tournament.name, timeControl: tournament.timeControl, startsAt: tournament.startsAt, durationMinutes: tournament.durationMinutes, isInterclub: true });
  res.json(tournament);
});

app.patch('/api/tournaments/:id', authMiddleware, handleEditTournament);

// Некоторые хостинги/прокси режут методы PATCH/DELETE (запрос не долетает до
// Express и в ответ прилетает HTML-страница ошибки вместо JSON — отсюда и
// "JSON.parse: unexpected character at line 1 column 1"). Даём POST-дублёры,
// как уже сделано для /api/blog, /api/admin/chat и /api/admin/puzzles.
app.post('/api/tournaments/:id/edit', authMiddleware, handleEditTournament);

app.delete('/api/tournaments/:id', authMiddleware, handleDeleteTournament);

app.post('/api/tournaments/:id/delete', authMiddleware, handleDeleteTournament);


app.post('/api/tournaments/:id/join', authMiddleware, rateLimit(limiterStrict), async (req, res) => {
  const user = await getUser(req.user.username.toLowerCase());
  if (!user || user.banned) return res.status(403).json({ error: 'Нет доступа' });
  const t = tournaments.find(t => t.id === req.params.id);
  if (!t) return res.status(404).json({ error: 'Не найден' });
  const now = Date.now();
  if (getTournamentStatus(t, now) === 'finished') return res.status(400).json({ error: 'Турнир завершён' });
  if (t.endsAt && t.endsAt < now - 365*24*60*60*1000) return res.status(400).json({ error: 'Этому турниру больше года — запись недоступна' });
  if ((t.blacklist || []).includes(user.username.toLowerCase())) return res.status(403).json({ error: 'Вам закрыт доступ в этот турнир' });
  if (t.clubOnly && t.clubId) {
    const club = clubs.find(c => c.id === t.clubId);
    const inClub = club && (club.members || []).map(m => m.toLowerCase()).includes(user.username.toLowerCase());
    if (!inClub) return res.status(403).json({ error: `Турнир доступен только участникам клуба «${club ? club.name : ''}»` });
  }
  if (t.minRating && user.rating < t.minRating) return res.status(400).json({ error: `Минимальный рейтинг: ${t.minRating}` });
  if (t.maxRating && t.maxRating < 9999 && user.rating > t.maxRating) return res.status(400).json({ error: `Максимальный рейтинг: ${t.maxRating}` });
  if (t.maxParticipants && t.participants.length >= t.maxParticipants) return res.status(400).json({ error: 'Турнир заполнен' });
  const existing = t.participants.find(p => p.username === user.username);
  const isActive = getTournamentStatus(t, now) === 'active';

  // ── Межклубный турнир: обязательный выбор команды ─────────────
  // Играть можно только за клуб, который заявлен в этом турнире И
  // в котором пользователь реально состоит на момент вступления.
  let teamId = null;
  if (t.isInterclub) {
    const requestedTeamId = req.body && req.body.teamId;
    if (!requestedTeamId) return res.status(400).json({ error: 'Выберите команду, за которую хотите играть', needTeamSelection: true, teams: (t.teamIds || []).map(id => clubs.find(c => c.id === id)).filter(Boolean).filter(c => (c.members || []).map(m => m.toLowerCase()).includes(user.username.toLowerCase())).map(c => ({ id: c.id, name: c.name })) });
    if (!(t.teamIds || []).includes(requestedTeamId)) return res.status(400).json({ error: 'Эта команда не участвует в турнире' });
    const team = clubs.find(c => c.id === requestedTeamId);
    if (!team) return res.status(404).json({ error: 'Команда (клуб) не найдена' });
    const inTeam = (team.members || []).map(m => m.toLowerCase()).includes(user.username.toLowerCase());
    if (!inTeam) return res.status(403).json({ error: `Вы не состоите в клубе «${team.name}»` });
    // Если игрок уже сыграл партии за одну команду — не даём переметнуться к другой
    // (иначе можно было бы "сдать" очки не той команде, за которую реально играл).
    if (existing && existing.teamId && existing.gamesPlayed > 0 && existing.teamId !== requestedTeamId) {
      return res.status(400).json({ error: 'Вы уже играли в этом турнире за другую команду и не можете сменить её' });
    }
    teamId = requestedTeamId;
  }

if (existing) {
  if (existing.anticheatBanned) return res.status(403).json({ error: 'Вы заблокированы в этом турнире' });
  if (!existing.left) return res.status(400).json({ error: 'Уже участвуете' });
  existing.left = false;
  existing.paused = false;
  existing.currentGameId = null;
  existing.rating = user.rating;
  existing.waiting = isActive;   // Автоматически встаём в очередь, если турнир уже идёт
  if (t.isInterclub) existing.teamId = teamId;
} else {
  t.participants.push({
    username: user.username, rating: user.rating, score: 0, streak: 0, flame: false,
    berserkCount: 0, gamesPlayed: 0, wins: 0, losses: 0, draws: 0,
    joinedAt: now, lastGameAt: 0, waiting: isActive, currentGameId: null,
    left: false, anticheatBanned: false, _acHighAccGames: 0,
    teamId: teamId,
  });
}

await saveTournament(t);
io.to(`tournament_${t.id}`).emit('tournament_update', sanitizeTournament(t));

// Если турнир активен — сразу пытаемся спарить
if (isActive) {
  tryPairTournamentPlayers(t);
}
  await saveTournament(t);
  io.to(`tournament_${t.id}`).emit('tournament_update', sanitizeTournament(t));
  res.json({ ok: true });
});


app.post('/api/tournaments/:id/leave', authMiddleware, async (req, res) => {
  const t = tournaments.find(t => t.id === req.params.id);
  if (!t) return res.status(404).json({ error: 'Не найден' });
  const p = t.participants.find(p => p.username === req.user.username);
  if (!p) return res.status(400).json({ error: 'Не участвуете' });
  p.waiting = false; p.left = true;
  await saveTournament(t);
  io.to(`tournament_${t.id}`).emit('tournament_update', sanitizeTournament(t));
  res.json({ ok: true });
});


// ── Партии конкретного турнира (для просмотра/проверки) ───────
app.get('/api/tournaments/:id/games', async (req, res) => {
  const t = tournaments.find(t => t.id === req.params.id);
  if (!t) return res.status(404).json({ error: 'Не найден' });
  const games = (t.games || []).map(g => ({
    id: g.id, white: g.white, black: g.black, result: g.result,
    reason: g.reason, timeControl: g.timeControl, endedAt: g.endedAt,
    anticheatBanned: !!g.anticheatBanned,
  }));
  res.json(games);
});


// ── Ручной античит-бан от администратора ─────────────────────
app.post('/api/tournaments/:id/anticheat-ban', authMiddleware, async (req, res) => {
  await requireTournamentManager(req, res, async (t) => {
    const { username } = req.body;
    if (!username) return res.status(400).json({ error: 'Укажите username' });
    const p = t.participants.find(p => p.username.toLowerCase() === username.toLowerCase());
    if (!p) return res.status(404).json({ error: 'Участник не найден' });
    if (p.anticheatBanned) return res.status(400).json({ error: 'Уже забанен' });

    // Принудительно завершаем текущую игру если есть
    if (p.currentGameId) {
      const game = tournamentGames.get(p.currentGameId) || activeGames.get(p.currentGameId);
      if (game) {
        const oppColor = game.white === p.username ? 'black' : 'white';
        const oppName = oppColor === 'white' ? game.white : game.black;
        const payload = { gameId: p.currentGameId, result: oppColor, reason: 'anticheat_admin' };
        const ws = findSocketByUsername(game.white);
        const bs = findSocketByUsername(game.black);
        if (ws) ws.emit('game_ended', payload);
        if (bs) bs.emit('game_ended', payload);
        await finishTournamentGame(t, game, oppColor, 'anticheat_admin');
        tournamentGames.delete(p.currentGameId);
        activeGames.delete(p.currentGameId);
      }
    }

    anticheatBan(t, p.username);
    await saveTournament(t);
    io.to(`tournament_${t.id}`).emit('tournament_update', sanitizeTournament(t));
    io.to(`tournament_${t.id}`).emit('anticheat_ban', {
      username: p.username, tournamentId: t.id, tournamentName: t.name,
      message: `⚠️ ${p.username} забанен администратором за использование читов.`,
    });
    res.json({ ok: true, username: p.username });
  });
});


app.post('/api/tournaments/:id/blacklist', authMiddleware, async (req, res) => {
  await requireTournamentManager(req, res, async (t) => {
    const { username } = req.body;
    if (!username) return res.status(400).json({ error: 'Укажите username' });
    if (!t.blacklist) t.blacklist = [];
    const uLow = username.toLowerCase();
    if (!t.blacklist.includes(uLow)) t.blacklist.push(uLow);
    const p = t.participants.find(p => p.username.toLowerCase() === uLow);
    if (p) { p.left = true; p.waiting = false; }
    await saveTournament(t);
    io.to(`tournament_${t.id}`).emit('tournament_update', sanitizeTournament(t));
    res.json({ ok: true, blacklist: t.blacklist });
  });
});

app.delete('/api/tournaments/:id/blacklist/:username', authMiddleware, handleUnblacklistTournament);

app.post('/api/tournaments/:id/blacklist/:username/delete', authMiddleware, handleUnblacklistTournament);


// ── Tournament Chat API ────────────────────────────────────────
app.get('/api/tournaments/:id/chat', authMiddleware, async (req, res) => {
  const t = tournaments.find(t => t.id === req.params.id);
  if (!t) return res.status(404).json({ error: 'Турнир не найден' });
  const me = await getUser(req.user.username.toLowerCase());
  if (!me) return res.status(401).json({ error: 'Нет доступа' });

  const now = Date.now();
  const msgs = getTournamentChat(t.id);
  const mutes = getTournamentChatMutes(t.id);
  const myMuteRaw = mutes.get(me.username.toLowerCase());
  const myMute = (myMuteRaw && myMuteRaw.until > now) ? myMuteRaw : null;

  res.json({
    messages: msgs.slice(-TOURNAMENT_CHAT_MAX),
    open: isTournamentChatOpen(t, now),
    myMute,
    canModerate: canModerateTournamentChat(me, t),
  });
});


app.post('/api/tournaments/:id/chat', authMiddleware, rateLimit(limiterStrict), async (req, res) => {
  const t = tournaments.find(t => t.id === req.params.id);
  if (!t) return res.status(404).json({ error: 'Турнир не найден' });
  const me = await getUser(req.user.username.toLowerCase());
  if (!me) return res.status(401).json({ error: 'Нет доступа' });
  if (me.banned) return res.status(403).json({ error: 'Ваш аккаунт заблокирован' });

  const now = Date.now();
  if (!isTournamentChatOpen(t, now)) {
    return res.status(403).json({ error: 'Чат турнира закрыт для сообщений — доступно только чтение' });
  }

  const mutes = getTournamentChatMutes(t.id);
  const myMute = mutes.get(me.username.toLowerCase());
  if (myMute) {
    if (myMute.until > now) return res.status(403).json({ error: 'Вы замучены в чате этого турнира', until: myMute.until });
    mutes.delete(me.username.toLowerCase());
  }

  const text = (req.body.message || '').toString().trim().slice(0, 300);
  if (!text) return res.status(400).json({ error: 'Пустое сообщение' });

  const msg = { id: uuidv4(), username: me.username, role: me.role || 'user', message: text, timestamp: now };
  const chat = getTournamentChat(t.id);
  chat.push(msg);
  if (chat.length > TOURNAMENT_CHAT_MAX) chat.shift();
  saveTournamentChatMsg(t.id, msg);
  io.to(`tournament_${t.id}`).emit('tournament_chat_msg', { tournamentId: t.id, msg });
  res.json({ ok: true, msg });
});


app.post('/api/tournaments/:id/chat-mute', authMiddleware, async (req, res) => {
  const t = tournaments.find(t => t.id === req.params.id);
  if (!t) return res.status(404).json({ error: 'Турнир не найден' });
  const me = await getUser(req.user.username.toLowerCase());
  if (!me) return res.status(401).json({ error: 'Нет доступа' });
  if (!canModerateTournamentChat(me, t)) return res.status(403).json({ error: 'Нет прав' });

  const { username, minutes } = req.body;
  if (!username) return res.status(400).json({ error: 'Укажите username' });
  const target = username.toLowerCase();

  if (isSiteAdmin(target) && me.role !== 'admin') return res.status(403).json({ error: 'Нельзя замутить администратора' });
  if (t.createdBy && target === t.createdBy.toLowerCase() && me.role !== 'admin' && me.username.toLowerCase() !== target) {
    return res.status(403).json({ error: 'Нельзя замутить создателя турнира' });
  }

  const dur = Math.min(Math.max(parseInt(minutes) || 15, 1), 24 * 60); // от 1 минуты до 24 часов
  const until = Date.now() + dur * 60 * 1000;
  getTournamentChatMutes(t.id).set(target, { until });

  const mutedIds = await wipeTournamentChatMsgsByUser(t.id, target);

  const sysMsg = { id: uuidv4(), username: 'system', role: 'system', message: `🔇 ${username} замучен в чате турнира на ${dur} мин.`, timestamp: Date.now(), system: true };
  const chat = getTournamentChat(t.id);
  chat.push(sysMsg);
  if (chat.length > TOURNAMENT_CHAT_MAX) chat.shift();
  saveTournamentChatMsg(t.id, sysMsg);

  io.to(`tournament_${t.id}`).emit('tournament_chat_user_muted', { tournamentId: t.id, username, until, mutedIds, sysMsg });
  res.json({ ok: true, until });
});


app.post('/api/tournaments/:id/chat-unmute', authMiddleware, async (req, res) => {
  const t = tournaments.find(t => t.id === req.params.id);
  if (!t) return res.status(404).json({ error: 'Турнир не найден' });
  const me = await getUser(req.user.username.toLowerCase());
  if (!me) return res.status(401).json({ error: 'Нет доступа' });
  if (!canModerateTournamentChat(me, t)) return res.status(403).json({ error: 'Нет прав' });

  const { username } = req.body;
  if (!username) return res.status(400).json({ error: 'Укажите username' });
  getTournamentChatMutes(t.id).delete(username.toLowerCase());
  io.to(`tournament_${t.id}`).emit('tournament_chat_user_unmuted', { tournamentId: t.id, username });
  res.json({ ok: true });
});


app.get('/api/dm/conversations', authMiddleware, async (req, res) => {
  const me = req.user.username.toLowerCase();

  const msgs = await db('SELECT id, from_user, to_user, text, ts, shadow_hidden FROM dm_messages WHERE from_user ILIKE $1 OR to_user ILIKE $1 ORDER BY ts DESC LIMIT 500', [me]);
  const convMap = new Map();
  for (const m of msgs.rows) {
    // Сообщение теневого бана от partner'а мне — как будто его никогда не
    // было: не создаёт (и не поднимает) беседу в списке. Свои же собственные
    // "невидимые" исходящие сообщения я по-прежнему вижу как обычно.
    if (m.shadow_hidden && m.from_user.toLowerCase() !== me) continue;
    const partner = m.from_user.toLowerCase() === me ? m.to_user : m.from_user;
    const key = dmRoomKey(me, partner.toLowerCase());
    if (!convMap.has(key)) convMap.set(key, { partner, lastMsg: m.text, lastTs: m.ts });
  }

  const unreadRows = await db("SELECT from_user, COUNT(*) as cnt FROM dm_messages WHERE to_user ILIKE $1 AND read = false AND shadow_hidden = false GROUP BY from_user", [me]);
  const unreadMap = new Map(unreadRows.rows.map(r => [r.from_user.toLowerCase(), Number(r.cnt)]));

  const blockedRows = await db('SELECT blocked FROM dm_blocks WHERE blocker ILIKE $1', [me]);
  const blockedSet = new Set(blockedRows.rows.map(r => r.blocked.toLowerCase()));

  const convsBase = Array.from(convMap.values())
    .map(c => ({ ...c, unread: unreadMap.get(c.partner.toLowerCase()) || 0, blocked: blockedSet.has(c.partner.toLowerCase()) }));
  // getUser() бьёт в кэш, если собеседник уже когда-то загружался — реального похода в БД
  // почти никогда не будет; нужен только чтобы узнать текущий (живой) статус VIP.
  const convs = (await Promise.all(convsBase.map(async c => ({ ...c, vip: isVip(await getUser(c.partner.toLowerCase())) }))))
    .sort((a, b) => new Date(b.lastTs) - new Date(a.lastTs));

  res.json(convs);
});


app.get('/api/dm/messages/:partner', authMiddleware, async (req, res) => {
  const me = req.user.username.toLowerCase();
  const partner = req.params.partner.toLowerCase();
  if (me === partner) return res.status(400).json({ error: 'Нельзя переписываться с собой' });
  const since = req.query.since ? new Date(req.query.since) : null;
  const r = since
    ? await db("SELECT * FROM dm_messages WHERE ((from_user ILIKE $1 AND to_user ILIKE $2) OR (from_user ILIKE $2 AND to_user ILIKE $1)) AND ts > $3 ORDER BY ts ASC LIMIT 100", [me, partner, since.toISOString()])
    : await db("SELECT * FROM (SELECT * FROM dm_messages WHERE ((from_user ILIKE $1 AND to_user ILIKE $2) OR (from_user ILIKE $2 AND to_user ILIKE $1)) ORDER BY ts DESC LIMIT 100) sub ORDER BY ts ASC", [me, partner]);
  // Сообщения, отправленные теневым баном, видит только сам отправитель —
  // если это писал partner, а не я, они для меня как будто не существуют.
  const rows = r.rows.filter(m => !m.shadow_hidden || m.from_user.toLowerCase() === me);
  const msgs = rows.map(m => ({ id: m.id, from: m.from_user, to: m.to_user, text: m.text, ts: m.ts, read: m.read }));
  const blockedByMe      = await db('SELECT 1 FROM dm_blocks WHERE blocker ILIKE $1 AND blocked ILIKE $2', [me, partner]);
  const blockedByPartner = await db('SELECT 1 FROM dm_blocks WHERE blocker ILIKE $1 AND blocked ILIKE $2', [partner, me]);
  const partnerVip = isVip(await getUser(partner));
  res.json({ messages: msgs, blocked: blockedByMe.rows.length > 0, blockedByPartner: blockedByPartner.rows.length > 0, partnerVip });
});


app.post('/api/dm/send', authMiddleware, rateLimit(limiterStrict), async (req, res) => {
  const me = req.user.username;
  const meUser = await getUser(me.toLowerCase());
  if (!meUser || meUser.banned) return res.status(403).json({ error: 'Ваш аккаунт заблокирован' });
  const { to, text } = req.body;
  if (!to || !text || !text.trim()) return res.status(400).json({ error: 'Укажите получателя и текст' });
  if (to.toLowerCase() === me.toLowerCase()) return res.status(400).json({ error: 'Нельзя писать самому себе' });
  if (isSystemSender(to)) return res.status(403).json({ error: 'Этому аккаунту нельзя написать' });
  if (text.length > 500) return res.status(400).json({ error: 'Максимум 500 символов' });
  const toUser = await getUser(to.toLowerCase());
  if (!toUser) return res.status(404).json({ error: 'Пользователь не найден' });
  const blocked = await db('SELECT 1 FROM dm_blocks WHERE (blocker ILIKE $1 AND blocked ILIKE $2) OR (blocker ILIKE $2 AND blocked ILIKE $1)', [me, to]);
  if (blocked.rows.length > 0) return res.status(403).json({ error: 'Переписка заблокирована' });
  const shadowHidden = !!meUser.shadowBanned;
  const msg = { id: uuidv4(), from: me, to, text: text.trim(), ts: new Date().toISOString(), read: false };
  await db('INSERT INTO dm_messages (id, from_user, to_user, text, ts, read, shadow_hidden) VALUES ($1,$2,$3,$4,$5,$6,$7)', [msg.id, msg.from, msg.to, msg.text, msg.ts, msg.read, shadowHidden]);
  // Теневой бан: получателю сообщение НЕ шлём вообще (для него это как будто
  // никогда не отправлялось) — только отправителю, чтобы у него всё выглядело
  // как обычная успешная отправка.
  if (!shadowHidden) {
    const recipientSocket = findSocketByUsername(to);
    if (recipientSocket) recipientSocket.emit('dm_message', msg);
  } else {
    emitToAdmins('dm_message', msg).catch(() => {});
  }
  const senderSocket = findSocketByUsername(me);
  if (senderSocket) senderSocket.emit('dm_message', msg);
  res.json(msg);
});


app.post('/api/dm/read', authMiddleware, async (req, res) => {
  const me = req.user.username.toLowerCase();
  const partner = (req.body.partner || '').toLowerCase();
  if (!partner) return res.status(400).json({ error: 'Укажите partner' });
  await db("UPDATE dm_messages SET read = true WHERE to_user ILIKE $1 AND from_user ILIKE $2 AND read = false", [me, partner]);
  const partnerSocket = findSocketByUsername(req.body.partner);
  if (partnerSocket) partnerSocket.emit('dm_read', { by: req.user.username });
  res.json({ ok: true });
});


app.post('/api/dm/block', authMiddleware, async (req, res) => {
  const me = req.user.username;
  const { username } = req.body;
  if (!username || username.toLowerCase() === me.toLowerCase()) return res.status(400).json({ error: 'Неверный запрос' });
  await db('INSERT INTO dm_blocks (blocker, blocked, ts) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING', [me, username, new Date().toISOString()]);
  res.json({ ok: true });
});


app.post('/api/dm/unblock', authMiddleware, async (req, res) => {
  const me = req.user.username;
  const { username } = req.body;
  if (!username) return res.status(400).json({ error: 'Укажите username' });
  await db('DELETE FROM dm_blocks WHERE blocker ILIKE $1 AND blocked ILIKE $2', [me, username]);
  res.json({ ok: true });
});


// ── Системные сообщения: админ → одному пользователю или всем ──
// Приходят как обычные ЛС от имени SYSTEM_SENDER, но получатель не
// может на них ответить (фронтенд прячет поле ввода для этого
// отправителя, а /api/dm/send выше отдельно блокирует запись ЕМУ).
app.post('/api/admin/system-message', authMiddleware, rateLimit(limiterStrict), async (req, res) => {
  await requireAdmin(req, res, async () => {
    const text = (req.body.text || '').trim();
    const to   = (req.body.to || '').trim();
    if (!text) return res.status(400).json({ error: 'Введите текст сообщения' });
    if (text.length > 2000) return res.status(400).json({ error: 'Максимум 2000 символов' });
    if (!to) return res.status(400).json({ error: 'Укажите получателя' });

    const client = await pool.connect();
    try {
      let recipients;
      if (to.toLowerCase() === 'all') {
        const r = await client.query('SELECT username FROM users');
        recipients = r.rows.map(row => row.username).filter(u => !isSystemSender(u));
      } else {
        const targetUser = await getUser(to.toLowerCase());
        if (!targetUser) return res.status(404).json({ error: 'Пользователь не найден' });
        if (isSystemSender(targetUser.username)) return res.status(400).json({ error: 'Неверный получатель' });
        recipients = [targetUser.username];
      }
      if (!recipients.length) return res.status(400).json({ error: 'Нет получателей' });

      const now = new Date().toISOString();
      await client.query('BEGIN');
      for (const username of recipients) {
        const msg = { id: uuidv4(), from: SYSTEM_SENDER, to: username, text, ts: now, read: false };
        await client.query('INSERT INTO dm_messages (id, from_user, to_user, text, ts, read) VALUES ($1,$2,$3,$4,$5,$6)', [msg.id, msg.from, msg.to, msg.text, msg.ts, msg.read]);
        const sock = findSocketByUsername(username);
        if (sock) sock.emit('dm_message', msg);
      }
      await client.query('COMMIT');
      await logAdminAction(req.user.username, 'system_message', to.toLowerCase() === 'all' ? 'all' : recipients[0], { to: to.toLowerCase() === 'all' ? 'all' : recipients[0], count: recipients.length, text: text.slice(0, 200) });
      res.json({ ok: true, count: recipients.length });
    } catch (e) {
      await client.query('ROLLBACK').catch(() => {});
      console.error('[SystemMessage]', e);
      if (!res.headersSent) res.status(500).json({ error: 'Ошибка отправки: ' + e.message });
    } finally {
      client.release();
    }
  });
});


app.get('/api/admin/dm/conversations/:username', authMiddleware, async (req, res) => {
  await requireAdmin(req, res, async () => {
    const target = req.params.username.toLowerCase();
    const targetUser = await getUser(target);
    if (!targetUser) return res.status(404).json({ error: 'Пользователь не найден' });

    const msgs = await db('SELECT from_user, to_user, text, ts FROM dm_messages WHERE from_user ILIKE $1 OR to_user ILIKE $1 ORDER BY ts DESC LIMIT 1000', [target]);
    const convMap = new Map();
    for (const m of msgs.rows) {
      const partner = m.from_user.toLowerCase() === target ? m.to_user : m.from_user;
      const key = partner.toLowerCase();
      if (!convMap.has(key)) convMap.set(key, { partner, lastMsg: m.text, lastTs: m.ts });
    }
    const convs = Array.from(convMap.values()).sort((a, b) => new Date(b.lastTs) - new Date(a.lastTs));

    await logDmAudit(req.user.username, targetUser.username, null, 'list_conversations');
    res.json({ user: sanitizeUser(targetUser), conversations: convs });
  });
});


app.get('/api/admin/dm/messages/:username/:partner', authMiddleware, async (req, res) => {
  await requireAdmin(req, res, async () => {
    const target  = req.params.username.toLowerCase();
    const partner = req.params.partner.toLowerCase();
    const targetUser  = await getUser(target);
    const partnerUser = await getUser(partner);
    if (!targetUser || !partnerUser) return res.status(404).json({ error: 'Пользователь не найден' });

    const r = await db(
      "SELECT * FROM (SELECT * FROM dm_messages WHERE (from_user ILIKE $1 AND to_user ILIKE $2) OR (from_user ILIKE $2 AND to_user ILIKE $1) ORDER BY ts DESC LIMIT 1000) sub ORDER BY ts ASC",
      [target, partner]
    );
    const messages = r.rows.map(m => ({ id: m.id, from: m.from_user, to: m.to_user, text: m.text, ts: m.ts, read: m.read }));

    await logDmAudit(req.user.username, targetUser.username, partnerUser.username, 'view_thread');
    res.json({ messages });
  });
});


// Аудит-лог просмотров переписок — кто из админов и когда смотрел
// чьи ЛС. Помогает расследовать злоупотребление доступом.
app.get('/api/admin/dm/audit', authMiddleware, async (req, res) => {
  await requireAdmin(req, res, async () => {
    const target = (req.query.target || '').toLowerCase();
    const r = target
      ? await db('SELECT * FROM admin_dm_audit WHERE target ILIKE $1 ORDER BY created_at DESC LIMIT 200', [target])
      : await db('SELECT * FROM admin_dm_audit ORDER BY created_at DESC LIMIT 200');
    res.json(r.rows.map(a => ({ admin: a.admin, target: a.target, partner: a.partner, action: a.action, createdAt: Number(a.created_at) })));
  });
});


// ── Общий лог действий админов ──────────────────────────────────
// Читает admin_action_log, заполняемый logAdminAction() из всех
// модерационных эндпоинтов (бан/разбан, IP-баны, VIP, чат, задачи,
// жалобы, обращения, системные сообщения). Только для чтения.
app.get('/api/admin/logs', authMiddleware, async (req, res) => {
  await requireAdmin(req, res, async () => {
    const { admin, action, target } = req.query;
    const conds = [];
    const params = [];
    if (admin)  { params.push(admin.toLowerCase());  conds.push(`LOWER(admin) = $${params.length}`); }
    if (action) { params.push(action);                conds.push(`action = $${params.length}`); }
    if (target) { params.push('%' + target.toLowerCase() + '%'); conds.push(`LOWER(target) LIKE $${params.length}`); }
    const where = conds.length ? 'WHERE ' + conds.join(' AND ') : '';
    const r = await db(`SELECT * FROM admin_action_log ${where} ORDER BY created_at DESC LIMIT 300`, params);
    res.json(r.rows.map(row => ({
      admin: row.admin, action: row.action, target: row.target,
      details: row.details ? JSON.parse(row.details) : null,
      createdAt: Number(row.created_at),
    })));
  });
});


// ── Подозрения на мультиаккаунты ────────────────────────────────
// Только показывает: группирует существующих пользователей по
// created_from_ip и created_device_id и возвращает группы из 2+
// аккаунтов как "подозрительные". НИКОГО НЕ БАНИТ — исключительно
// информация для ручного решения администратора (см. requireAdmin).
app.get('/api/admin/multiaccounts', authMiddleware, async (req, res) => {
  await requireAdmin(req, res, async () => {
    const r = await db('SELECT username, role, banned, ban_reason, created_from_ip, created_device_id, created_at, rating FROM users ORDER BY created_at ASC');

    const byIP = new Map();
    const byDevice = new Map();
    for (const row of r.rows) {
      const u = {
        username: row.username, role: row.role, banned: row.banned,
        banReason: row.ban_reason, createdAt: Number(row.created_at), rating: row.rating,
      };
      const ip = row.created_from_ip;
      if (ip && !isLocalIP(ip)) {
        if (!byIP.has(ip)) byIP.set(ip, []);
        byIP.get(ip).push(u);
      }
      const dev = row.created_device_id;
      if (dev) {
        if (!byDevice.has(dev)) byDevice.set(dev, []);
        byDevice.get(dev).push(u);
      }
    }

    const ipGroups = [...byIP.entries()]
      .filter(([, users]) => users.length > 1)
      .map(([ip, users]) => ({ ip, users }))
      .sort((a, b) => b.users.length - a.users.length);

    const deviceGroups = [...byDevice.entries()]
      .filter(([, users]) => users.length > 1)
      .map(([deviceId, users]) => ({ deviceId, users }))
      .sort((a, b) => b.users.length - a.users.length);

    res.json({ ipGroups, deviceGroups });
  });
});


// ── Дашборд администратора ──────────────────────────────────────
// Сводка для главного экрана админки: онлайн, регистрации/партии по
// дням, баны, открытые жалобы/обращения. Отдельно от публичного
// /api/stats, т.к. включает чувствительные для админов цифры (баны,
// открытые обращения) и более короткое окно (14 дней) для графиков.
app.get('/api/admin/dashboard', authMiddleware, async (req, res) => {
  await requireAdmin(req, res, async () => {
    try {
      const [
        totalUsers, bannedUsersCnt, newUsersToday, totalGames, gamesToday,
        openReports, openAppeals, regByDay, gamesByDay,
      ] = await Promise.all([
        db('SELECT COUNT(*) FROM users'),
        db('SELECT COUNT(*) FROM users WHERE banned = true'),
        db(`SELECT COUNT(*) FROM users WHERE created_at >= extract(epoch from date_trunc('day', now()))*1000`),
        db('SELECT COUNT(*) FROM games'),
        db(`SELECT COUNT(*) FROM games WHERE ended_at >= extract(epoch from date_trunc('day', now()))*1000`),
        db(`SELECT COUNT(*) FROM reports WHERE status = 'new'`),
        db(`SELECT COUNT(*) FROM appeals WHERE status = 'open'`),
        db(`SELECT DATE(to_timestamp(created_at/1000)) as day, COUNT(*) as cnt FROM users WHERE created_at > extract(epoch from now()-interval '14 days')*1000 GROUP BY day ORDER BY day ASC`),
        db(`SELECT DATE(to_timestamp(ended_at/1000)) as day, COUNT(*) as cnt FROM games WHERE ended_at > extract(epoch from now()-interval '14 days')*1000 GROUP BY day ORDER BY day ASC`),
      ]);

      res.json({
        online: onlineUsers.size,
        workers: [...workers.values()].map(w => ({
          threads: w.threads, busy: w.busy, lastSeen: w.lastSeen,
        })),
        totals: {
          users: parseInt(totalUsers.rows[0].count),
          bannedUsers: parseInt(bannedUsersCnt.rows[0].count),
          newUsersToday: parseInt(newUsersToday.rows[0].count),
          games: parseInt(totalGames.rows[0].count),
          gamesToday: parseInt(gamesToday.rows[0].count),
          bannedIPs: bannedIPs.size,
          bannedDevices: bannedDevices.size,
          openReports: parseInt(openReports.rows[0].count),
          openAppeals: parseInt(openAppeals.rows[0].count),
        },
        charts: { regByDay: regByDay.rows, gamesByDay: gamesByDay.rows },
      });
    } catch (e) {
      console.error('[AdminDashboard]', e.message);
      res.status(500).json({ error: 'Ошибка загрузки дашборда' });
    }
  });
});


app.get('/api/forum/threads', (req, res) => {
  const page  = Math.max(0, parseInt(req.query.page) || 0);
  const limit = Math.min(50, parseInt(req.query.limit) || 20);
  const sorted = [...forumThreads].sort((a, b) => b.lastActivityAt - a.lastActivityAt);
  res.json({ threads: sorted.slice(page * limit, page * limit + limit), total: sorted.length, page, limit });
});

app.get('/api/forum/threads/:slug', (req, res) => {
  const thread = forumThreads.find(t => t.slug === req.params.slug || t.id === req.params.slug);
  if (!thread) return res.status(404).json({ error: 'Тема не найдена' });

  const replyPage = Math.max(1, parseInt(req.query.replyPage) || 1);
  const replyLimit = Math.min(100, parseInt(req.query.replyLimit) || 50);
  const start = (replyPage - 1) * replyLimit;
  const end = start + replyLimit;

  let allReplies = forumReplies.filter(r => r.threadId === thread.id).sort((a, b) => a.createdAt - b.createdAt);
  const totalReplies = allReplies.length;
  const replies = allReplies.slice(start, end);

  let viewerKey;
  const authTok945 = getAuthToken(req);
  if (authTok945) {
    try { const p = jwt.verify(authTok945, JWT_SECRET); viewerKey = 'u:' + p.username.toLowerCase(); }
    catch { viewerKey = 'ip:' + getIP(req); }
  } else { viewerKey = 'ip:' + getIP(req); }
  if (!forumViewSessions.has(thread.id)) forumViewSessions.set(thread.id, new Set());
  const viewers = forumViewSessions.get(thread.id);
  if (!viewers.has(viewerKey)) { viewers.add(viewerKey); thread.views++; saveForumThread(thread).catch(() => {}); }

  res.json({
    thread,
    replies,
    replyMeta: {
      page: replyPage,
      limit: replyLimit,
      total: totalReplies,
      totalPages: Math.ceil(totalReplies / replyLimit)
    }
  });
});


app.delete('/api/forum/threads/:id', authMiddleware, async (req, res) => {
  const user = await getUser(req.user.username.toLowerCase());
  if (!user) return res.status(401).json({ error: 'Не авторизован' });
  const idx = forumThreads.findIndex(t => t.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Не найдено' });
  const thread = forumThreads[idx];
  if (user.role !== 'admin' && thread.author !== user.username) return res.status(403).json({ error: 'Нет прав' });
  forumThreads.splice(idx, 1);
  forumReplies.splice(0, forumReplies.length, ...forumReplies.filter(r => r.threadId !== thread.id));
  await deleteForumThread(thread.id);
  res.json({ ok: true });
});


app.get('/api/forum/threads/:slug/search', (req, res) => {
  const thread = forumThreads.find(t => t.slug === req.params.slug || t.id === req.params.slug);
  if (!thread) return res.status(404).json({ error: 'Тема не найдена' });
  const q = (req.query.q || '').trim().toLowerCase();
  if (!q) return res.json({ results: [] });
  const allReplies = forumReplies.filter(r => r.threadId === thread.id).sort((a, b) => a.createdAt - b.createdAt);
  const repliesPerPage = 50;
  const results = [];
  allReplies.forEach((reply, idx) => {
    if (reply.body.toLowerCase().includes(q)) {
      const page = Math.floor(idx / repliesPerPage) + 1;
      results.push({ reply, page });
    }
  });
  res.json({ results: results.map(r => ({
    id: r.reply.id,
    author: r.reply.author,
    body: r.reply.body.slice(0, 200) + (r.reply.body.length > 200 ? '…' : ''),
    createdAt: r.reply.createdAt,
    page: r.page
  })) });
});


app.post('/api/forum/threads/:id/replies', authMiddleware, rateLimit(limiterStrict), async (req, res) => {
  const user = await getUser(req.user.username.toLowerCase());
  if (!user || user.banned) return res.status(403).json({ error: 'Аккаунт заблокирован' });
  const thread = forumThreads.find(t => t.id === req.params.id);
  if (!thread) return res.status(404).json({ error: 'Тема не найдена' });
  const { body } = req.body;
  if (!body || body.trim().length < 2)  return res.status(400).json({ error: 'Ответ слишком короткий' });
  if (body.trim().length > 5000)        return res.status(400).json({ error: 'Ответ слишком длинный (макс. 5 000 символов)' });
  if (countTodayByUser(forumReplies, user.username) >= 10)
    return res.status(429).json({ error: 'Вы уже написали 10 ответов сегодня. Лимит сбросится в полночь.' });
  const now = Date.now();
  const reply = { id: uuidv4(), threadId: thread.id, author: user.username, authorId: user.id, body: body.trim(), createdAt: now };
  forumReplies.push(reply);
  thread.replyCount = (thread.replyCount || 0) + 1;
  thread.lastActivityAt = now;
  await saveForumThread(thread);
  await saveForumReply(reply);
  res.json({ ok: true, reply });
});


app.delete('/api/forum/replies/:id', authMiddleware, async (req, res) => {
  const user = await getUser(req.user.username.toLowerCase());
  if (!user) return res.status(401).json({ error: 'Не авторизован' });
  const idx = forumReplies.findIndex(r => r.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Не найдено' });
  const reply = forumReplies[idx];
  if (user.role !== 'admin' && reply.author !== user.username) return res.status(403).json({ error: 'Нет прав' });
  const thread = forumThreads.find(t => t.id === reply.threadId);
  if (thread) { thread.replyCount = Math.max(0, (thread.replyCount || 1) - 1); await saveForumThread(thread); }
  forumReplies.splice(idx, 1);
  await deleteForumReply(reply.id);
  res.json({ ok: true });
});


app.post('/api/forum/threads', authMiddleware, rateLimit(limiterStrict), async (req, res) => {
  const user = await getUser(req.user.username.toLowerCase());
  if (!user || user.banned) return res.status(403).json({ error: 'Аккаунт заблокирован' });

  const { title, body } = req.body;
  if (!title || !title.trim()) return res.status(400).json({ error: 'Укажите заголовок' });
  if (!body || !body.trim()) return res.status(400).json({ error: 'Укажите текст' });
  if (title.length > 120) return res.status(400).json({ error: 'Заголовок слишком длинный (макс 120)' });
  if (body.length > 10000) return res.status(400).json({ error: 'Текст слишком длинный (макс 10 000)' });

  // Ограничение: не более 3 тем в сутки
  const dayStart = new Date();
  dayStart.setHours(0, 0, 0, 0);
  const todayCount = forumThreads.filter(t =>
    t.author.toLowerCase() === user.username.toLowerCase() &&
    t.createdAt >= dayStart.getTime()
  ).length;
  if (todayCount >= 3) {
    return res.status(429).json({ error: 'Вы уже создали 3 темы сегодня. Лимит сбросится в полночь.' });
  }

  const id = uuidv4();
  const slug = makeSlug(title, id);
  const now = Date.now();
  const thread = {
    id,
    slug,
    author: user.username,
    authorId: user.id,
    title: title.trim(),
    body: body.trim(),
    createdAt: now,
    lastActivityAt: now,
    replyCount: 0,
    views: 0
  };

  forumThreads.unshift(thread);
  await saveForumThread(thread);
  res.json({ ok: true, thread: { id: thread.id, slug: thread.slug, title: thread.title } });
});


// ── FOLLOWS (подписки) API ───────────────────────────────────
app.post('/api/follow/:username', authMiddleware, async (req, res) => {
  try {
    const target = await getUser(req.params.username.toLowerCase());
    if (!target) return res.status(404).json({ error: 'Пользователь не найден' });
    const follower = req.user.username;
    const following = target.username; // канонический регистр ника из БД
    if (follower.toLowerCase() === following.toLowerCase()) return res.status(400).json({ error: 'Нельзя подписаться на себя' });
    await db(`INSERT INTO follows (follower, following, created_at) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`, [follower, following, Date.now()]);
    res.json({ ok: true });
  } catch (e) {
    console.error('[Follow]', e);
    res.status(500).json({ error: 'Ошибка подписки' });
  }
});

// DELETE — основной вариант, POST — резервный (на случай, если хостинг/прокси
// блокирует метод DELETE — именно это похоже на причину "кнопка не работает").
app.delete('/api/follow/:username', authMiddleware, handleUnfollow);

app.post('/api/follow/:username/unfollow', authMiddleware, handleUnfollow);


app.get('/api/follow/check/:username', authMiddleware, async (req, res) => {
  try {
    const target = await getUser(req.params.username.toLowerCase());
    const follower = req.user.username;
    const following = target ? target.username : req.params.username;
    const r = await db(`SELECT 1 FROM follows WHERE follower = $1 AND following = $2`, [follower, following]);
    res.json({ following: r.rows.length > 0 });
  } catch (e) {
    console.error('[FollowCheck]', e);
    res.status(500).json({ error: 'Ошибка проверки подписки' });
  }
});


app.get('/api/follow/counts/:username', async (req, res) => {
  const username = req.params.username;
  const followers = await db(`SELECT COUNT(*) FROM follows WHERE following = $1`, [username]);
  const following = await db(`SELECT COUNT(*) FROM follows WHERE follower = $1`, [username]);
  res.json({ followers: parseInt(followers.rows[0].count), following: parseInt(following.rows[0].count) });
});


app.get('/api/follow/followers/:username', async (req, res) => {
  const username = req.params.username;
  const r = await db(`SELECT follower FROM follows WHERE following = $1 ORDER BY created_at DESC`, [username]);
  const users = [];
  for (const row of r.rows) {
    const u = await getUser(row.follower.toLowerCase());
    if (u) users.push({ username: u.username, online: onlineUsers.has(u.username), rating: u.rating });
  }
  res.json(users);
});


app.get('/api/follow/following/:username', async (req, res) => {
  const username = req.params.username;
  const r = await db(`SELECT following FROM follows WHERE follower = $1 ORDER BY created_at DESC`, [username]);
  const users = [];
  for (const row of r.rows) {
    const u = await getUser(row.following.toLowerCase());
    if (u) users.push({ username: u.username, online: onlineUsers.has(u.username), rating: u.rating });
  }
  res.json(users);
});


app.get('/api/follow/online-friends', authMiddleware, async (req, res) => {
  const me = req.user.username;
  const r = await db(`SELECT following FROM follows WHERE follower = $1`, [me]);
  const online = [];
  for (const row of r.rows) {
    const u = await getUser(row.following.toLowerCase());
    if (u && onlineUsers.has(u.username)) {
      online.push({ username: u.username, rating: u.rating });
    }
  }
  res.json(online);
});


app.get('/api/blog', (req, res) => {
  const { section, status, page: pQ, limit: lQ } = req.query;
  const page  = Math.max(0, parseInt(pQ) || 0);
  const limit = Math.min(50, parseInt(lQ) || 20);

  let callerUsername = null;
  const auth = getAuthToken(req);
  if (auth) { try { callerUsername = jwt.verify(auth, JWT_SECRET).username.toLowerCase(); } catch {} }

  let list = blogPosts.filter(p => {
    if (p.status === 'hidden') {
      // Список скрытых статей виден только администратору и только
      // когда его явно запросили (вкладка "Скрытые").
      return status === 'hidden' && isBlogAdmin(callerUsername);
    }
    if (status === 'hidden') return false;
    if (p.status !== 'published') {
      if (!callerUsername) return false;
      if (!isBlogAdmin(callerUsername) && p.author.toLowerCase() !== callerUsername) return false;
      return status === 'drafts';
    }
    return status !== 'drafts';
  });

  // Список скрытых статей — это единая модераторская вкладка для админа,
  // не привязанная к разделу (иначе статьи, скрытые из другого раздела,
  // "пропадали бы" из виду). То же самое для черновиков АДМИНА: у него
  // могут быть черновики и в official, и в community (например, только
  // что восстановленная статья), и раздел не должен их прятать.
  // Обычным пользователям раздел для черновиков не мешает — у них черновики
  // всегда только в community.
  const bypassSection = status === 'hidden' || (status === 'drafts' && isBlogAdmin(callerUsername));
  if (!bypassSection) {
    if (section === 'official')  list = list.filter(p => !p.community);
    if (section === 'community') list = list.filter(p => !!p.community);
  }

  if (status === 'drafts' || status === 'hidden') list.sort((a,b) => (b.updatedAt||b.createdAt) - (a.updatedAt||a.createdAt));
  else list.sort((a,b) => ((b.views||0)+(b.likes||0)*3) - ((a.views||0)+(a.likes||0)*3));

  res.json({ posts: list.slice(page*limit, page*limit+limit).map(p => blogSanitize(p,false)), total: list.length });
});


app.get('/api/blog/:id', async (req, res) => {
  const post = blogPosts.find(p => p.id === req.params.id);
  if (!post) return res.status(404).json({ error: 'Статья не найдена' });

  // Прикрытая статья не видна вообще никому (даже автору и админу) —
  // управление такими статьями идёт только через список "Скрытые".
  if (post.status === 'hidden') return res.status(404).json({ error: 'Статья не найдена' });

  if (post.status !== 'published') {
    let callerUsername = null;
    const auth = getAuthToken(req);
    if (auth) { try { callerUsername = jwt.verify(auth, JWT_SECRET).username.toLowerCase(); } catch {} }
    const canSee = callerUsername && (isBlogAdmin(callerUsername) || post.author.toLowerCase() === callerUsername);
    if (!canSee) return res.status(403).json({ error: 'Черновик' });
  }

  const noview = req.query.noview === '1';
  if (!noview && post.status === 'published') {
    let viewerKey = null;
    const authTok = getAuthToken(req);
    if (authTok) { try { viewerKey = 'u:' + jwt.verify(authTok, JWT_SECRET).username.toLowerCase(); } catch {} }
    if (!viewerKey) { const did = req.deviceId; if (did) viewerKey = 'd:' + did; }
    if (viewerKey) {
      try {
        const ins = await db(`INSERT INTO blog_views (viewer_key,post_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [viewerKey, post.id]);
        if (ins.rowCount === 1) {
          post.views = (post.views || 0) + 1;
          if (!post._viewTimer) post._viewTimer = setTimeout(() => { saveBlogPost(post).catch(()=>{}); post._viewTimer=null; }, 5000);
        }
      } catch(e) { console.error('[Blog] view:', e.message); }
    }
  }

  let liked = false;
  const auth = getAuthToken(req);
  if (auth) {
    try {
      const dec = jwt.verify(auth, JWT_SECRET);
      const u = await getUser(dec.username.toLowerCase());
      if (u) { const lr = await db('SELECT 1 FROM blog_likes WHERE user_id=$1 AND post_id=$2',[u.id,post.id]); liked = lr.rows.length>0; }
    } catch {}
  }

  res.json({ ...blogSanitize(post,true), liked });
});


app.post('/api/blog', blogAuthMiddleware, rateLimit(limiterStrict), async (req, res) => {
  let { title, body, status, encoding } = req.body;
  title = decodeBlogField(title, encoding);
  body  = decodeBlogField(body, encoding);
  if (!title || !title.trim()) return res.status(400).json({ error: 'Укажите заголовок' });
  if (!body  || !body.trim())  return res.status(400).json({ error: 'Укажите текст' });
  if (title.length > 200)      return res.status(400).json({ error: 'Заголовок слишком длинный (макс 200)' });
  if (body.length > 100000)    return res.status(400).json({ error: 'Текст слишком длинный (макс 100 000 символов)' });

  const user = await getUser(req.blogUser.username.toLowerCase());
  if (!user) return res.status(404).json({ error: 'Пользователь не найден' });
  if (user.banned) return res.status(403).json({ error: 'Заблокированные пользователи не могут создавать статьи' });

  const isAdmin = isBlogAdmin(user.username);

  if (!isAdmin) {
    const dayStart = new Date(); dayStart.setHours(0,0,0,0);
    const todayCount = blogPosts.filter(p => p.author.toLowerCase() === user.username.toLowerCase() && p.createdAt >= dayStart.getTime()).length;
    if (todayCount >= 1) return res.status(429).json({ error: 'Можно публиковать не более 1 статьи в день. Попробуйте завтра!' });
  }

  const community = !isAdmin;
  const postStatus = ['published','draft'].includes(status) ? status : 'draft';
  const post = { id: uuidv4(), title: title.trim(), body: body.trim(), author: user.username,
    status: postStatus, views: 0, likes: 0, likedBy: [], community, createdAt: Date.now(), updatedAt: null };
  blogPosts.unshift(post);
  await saveBlogPost(post);
  res.json(blogSanitize(post, true));
});


app.patch('/api/blog/:id', blogAuthMiddleware, rateLimit(limiterStrict), async (req, res) => {
  const post = blogPosts.find(p => p.id === req.params.id);
  if (!post) return res.status(404).json({ error: 'Статья не найдена' });
  const caller = req.blogUser.username;
  if (!isBlogAdmin(caller) && post.author.toLowerCase() !== caller.toLowerCase())
    return res.status(403).json({ error: 'Нет доступа' });
  let { title, body, status, encoding } = req.body;
  title = decodeBlogField(title, encoding);
  body  = decodeBlogField(body, encoding);
  if (title !== undefined) { if (!title.trim()) return res.status(400).json({ error: 'Заголовок не может быть пустым' }); post.title = title.trim().slice(0,200); }
  if (body  !== undefined) { if (!body.trim())  return res.status(400).json({ error: 'Текст не может быть пустым' }); post.body = body.trim().slice(0,100000); }
  if (status !== undefined && ['published','draft','hidden'].includes(status)) {
    // Прикрывать статью и возвращать её обратно может только администратор.
    if ((status === 'hidden' || post.status === 'hidden') && !isBlogAdmin(caller))
      return res.status(403).json({ error: 'Скрывать и восстанавливать статьи может только администратор' });
    post.status = status;
  }
  post.updatedAt = Date.now();
  await saveBlogPost(post);
  res.json(blogSanitize(post, true));
});

// Некоторые хостинги/прокси режут метод DELETE (запрос не долетает до Express
// и в ответ прилетает HTML-страница ошибки вместо JSON — отсюда и
// "JSON.parse: unexpected character..."). Даём POST-дублёр на всякий случай,
// как уже сделано для /api/admin/chat и /api/admin/puzzles.
app.delete('/api/blog/:id', blogAuthMiddleware, handleDeleteBlogPost);

app.post('/api/blog/:id/delete', blogAuthMiddleware, handleDeleteBlogPost);


app.post('/api/blog/:id/like', blogAuthMiddleware, rateLimit(limiterStrict), async (req, res) => {
  const post = blogPosts.find(p => p.id === req.params.id);
  if (!post) return res.status(404).json({ error: 'Статья не найдена' });
  if (post.status !== 'published') return res.status(400).json({ error: 'Нельзя лайкнуть черновик' });
  const user = await getUser(req.blogUser.username.toLowerCase());
  if (!user) return res.status(404).json({ error: 'Пользователь не найден' });
  if (user.banned) return res.status(403).json({ error: 'Заблокированные не могут ставить лайки' });
  const { unlike } = req.body;
  const existing = await db('SELECT 1 FROM blog_likes WHERE user_id=$1 AND post_id=$2',[user.id,post.id]);
  if (unlike) {
    if (existing.rows.length > 0) {
      await db('DELETE FROM blog_likes WHERE user_id=$1 AND post_id=$2',[user.id,post.id]);
      post.likes = Math.max(0,(post.likes||1)-1);
    }
  } else {
    if (existing.rows.length === 0) {
      await db('INSERT INTO blog_likes (user_id,post_id) VALUES ($1,$2)',[user.id,post.id]);
      post.likes = (post.likes||0)+1;
    }
  }
  if (!post._lstTimer) post._lstTimer = setTimeout(()=>{ saveBlogPost(post).catch(()=>{}); post._lstTimer=null; },5000);
  res.json({ likes: post.likes, liked: !unlike });
});


app.get('/blog/:id/comments', (req, res) => {
  const post = blogPosts.find(p => p.id === req.params.id);
  if (!post || post.status === 'hidden') return res.redirect('/404.html');
  res.sendFile(path.join(__dirname, '../public/blog.html'));
});


app.get('/api/blog/:id/comments', async (req, res) => {
  const post = blogPosts.find(p => p.id === req.params.id);
  if (!post || post.status !== 'published') return res.status(404).json({ error: 'Статья не найдена' });

  let callerUsername = null;
  const auth = getAuthToken(req);
  if (auth) { try { callerUsername = jwt.verify(auth,JWT_SECRET).username.toLowerCase(); } catch {} }

  const r = await db('SELECT * FROM blog_comments WHERE post_id=$1 ORDER BY created_at ASC',[req.params.id]);
  const commentIds = r.rows.map(c => c.id);
  let reactions = [];
  if (commentIds.length > 0) {
    const phs = commentIds.map((_,i)=>`$${i+1}`).join(',');
    const rr = await db(`SELECT * FROM blog_comment_reactions WHERE comment_id IN (${phs})`,commentIds);
    reactions = rr.rows;
  }

  const comments = r.rows.map(c => {
    const myReaction = callerUsername ? reactions.find(rr => rr.comment_id===c.id && rr.user_id===callerUsername) : null;
    const reactionMap = {};
    for (const rr of reactions.filter(rr=>rr.comment_id===c.id)) {
      reactionMap[rr.emoji] = (reactionMap[rr.emoji]||0)+1;
    }
    return {
      id: c.id, postId: c.post_id, author: c.author,
      body: c.deleted ? null : c.body,
      deleted: c.deleted, deletedBy: c.deleted_by || null,
      createdAt: Number(c.created_at),
      editCount: Number(c.edit_count || 0),
      editedAt: c.edited_at ? Number(c.edited_at) : null,
      reactions: reactionMap,
      myReaction: myReaction?.emoji || null,
    };
  });

  let myBan = null;
  if (callerUsername) myBan = await getCommentBan(req.params.id, callerUsername);

  res.json({ comments, count: comments.length, myBan: myBan ? { type: myBan.type, until: myBan.until ? Number(myBan.until) : null } : null });
});


app.post('/api/blog/:id/comments', blogAuthMiddleware, rateLimit(limiterStrict), async (req, res) => {
  const post = blogPosts.find(p => p.id === req.params.id);
  if (!post || post.status !== 'published') return res.status(404).json({ error: 'Статья не найдена' });

  const user = await getUser(req.blogUser.username.toLowerCase());
  if (!user) return res.status(404).json({ error: 'Пользователь не найден' });
  if (user.banned) return res.status(403).json({ error: 'Вы заблокированы' });

  const ban = await getCommentBan(req.params.id, user.username);
  if (ban) {
    if (ban.type === 'ban') return res.status(403).json({ error: 'Вы заблокированы в комментариях этого блога' });
    const until = Number(ban.until);
    if (until > Date.now()) {
      const mins = Math.ceil((until - Date.now())/60000);
      return res.status(403).json({ error: `Вы замьючены. Осталось ${mins} мин.`, until });
    }
  }

  const body = (req.body.body || '').toString().trim();
  if (!body) return res.status(400).json({ error: 'Пустой комментарий' });
  if (body.length > 4000) return res.status(400).json({ error: 'Максимум 4000 символов' });

  if (!isBlogCommentAdmin(user.username)) {
    const dayStart = new Date(); dayStart.setHours(0,0,0,0);
    const todayCount = await db(`SELECT COUNT(*) AS cnt FROM blog_comments WHERE LOWER(author)=$1 AND created_at>=$2 AND deleted=FALSE`, [user.username.toLowerCase(), dayStart.getTime()]);
    if (Number(todayCount.rows[0]?.cnt || 0) >= 3)
      return res.status(429).json({ error: 'Можно оставить не более 3 комментариев в день. Возвращайтесь завтра!' });
  }

  const ratKey = 'blogcmt_' + user.username.toLowerCase();
  if (!global._blogCmtRate) global._blogCmtRate = new Map();
  const last = global._blogCmtRate.get(ratKey) || 0;
  if (Date.now() - last < 20000) return res.status(429).json({ error: 'Не так быстро! Подождите 20 секунд' });
  global._blogCmtRate.set(ratKey, Date.now());

  const id = uuidv4();
  const createdAt = Date.now();
  await db('INSERT INTO blog_comments (id,post_id,author,body,created_at,deleted,edit_count) VALUES ($1,$2,$3,$4,$5,FALSE,0)', [id, req.params.id, user.username, body, createdAt]);

  res.json({ ok: true, comment: {
    id, postId: req.params.id, author: user.username,
    body, deleted: false, deletedBy: null, createdAt,
    editCount: 0, editedAt: null, reactions: {}, myReaction: null,
  }});
});

app.delete('/api/blog/:id/comments/:cid', blogAuthMiddleware, handleDeleteBlogComment);

app.post('/api/blog/:id/comments/:cid/delete', blogAuthMiddleware, handleDeleteBlogComment);


app.patch('/api/blog/:id/comments/:cid', blogAuthMiddleware, rateLimit(limiterStrict), async (req, res) => {
  const user = await getUser(req.blogUser.username.toLowerCase());
  if (!user) return res.status(404).json({ error: 'Пользователь не найден' });
  if (user.banned) return res.status(403).json({ error: 'Вы заблокированы' });

  const r = await db('SELECT * FROM blog_comments WHERE id=$1 AND post_id=$2',[req.params.cid,req.params.id]);
  const comment = r.rows[0];
  if (!comment) return res.status(404).json({ error: 'Комментарий не найден' });
  if (comment.deleted) return res.status(400).json({ error: 'Нельзя редактировать удалённый комментарий' });

  const isAuthor = comment.author.toLowerCase() === user.username.toLowerCase();
  const isAdmin  = isBlogCommentAdmin(user.username);
  if (!isAuthor && !isAdmin) return res.status(403).json({ error: 'Нет прав' });

  const editCount = Number(comment.edit_count || 0);
  if (!isAdmin && editCount >= 2)
    return res.status(403).json({ error: 'Комментарий можно редактировать не более 2 раз' });

  const body = (req.body.body || '').toString().trim();
  if (!body) return res.status(400).json({ error: 'Текст не может быть пустым' });
  if (body.length > 4000) return res.status(400).json({ error: 'Максимум 4000 символов' });

  const newEditCount = editCount + 1;
  const editedAt = Date.now();
  await db('UPDATE blog_comments SET body=$1, edit_count=$2, edited_at=$3 WHERE id=$4', [body, newEditCount, editedAt, req.params.cid]);

  res.json({ ok: true, body, editCount: newEditCount, editedAt });
});


app.post('/api/blog/:id/comments/:cid/react', blogAuthMiddleware, rateLimit(limiterStrict), async (req, res) => {
  const user = await getUser(req.blogUser.username.toLowerCase());
  if (!user || user.banned) return res.status(403).json({ error: 'Нет доступа' });

  const r = await db('SELECT id,deleted FROM blog_comments WHERE id=$1 AND post_id=$2',[req.params.cid,req.params.id]);
  if (!r.rows[0] || r.rows[0].deleted) return res.status(404).json({ error: 'Комментарий не найден' });

  const ALLOWED_EMOJIS = ['👍','❤️','😂','😮','😢','😡','♟️'];
  const { emoji } = req.body;
  if (!emoji) {
    await db('DELETE FROM blog_comment_reactions WHERE comment_id=$1 AND user_id=$2',[req.params.cid,user.username.toLowerCase()]);
    return res.json({ ok: true, removed: true });
  }
  if (!ALLOWED_EMOJIS.includes(emoji)) return res.status(400).json({ error: 'Неверный эмоджи' });

  await db(`INSERT INTO blog_comment_reactions (comment_id,user_id,emoji) VALUES ($1,$2,$3) ON CONFLICT (comment_id,user_id) DO UPDATE SET emoji=$3`, [req.params.cid, user.username.toLowerCase(), emoji]);

  const rr = await db('SELECT emoji, COUNT(*) as cnt FROM blog_comment_reactions WHERE comment_id=$1 GROUP BY emoji',[req.params.cid]);
  const reactions = {};
  for (const row of rr.rows) reactions[row.emoji] = Number(row.cnt);
  res.json({ ok: true, reactions, myReaction: emoji });
});


app.post('/api/blog/:id/comments/mod', blogAuthMiddleware, async (req, res) => {
  const user = await getUser(req.blogUser.username.toLowerCase());
  if (!user || !isBlogCommentAdmin(user.username)) return res.status(403).json({ error: 'Нет прав' });

  const { action, username, global: isGlobal } = req.body;
  if (!action || !username) return res.status(400).json({ error: 'Укажите action и username' });
  const target = username.toLowerCase();
  if (isBlogCommentAdmin(target)) return res.status(403).json({ error: 'Нельзя банить администратора' });

  if (action === 'unban') {
    if (isGlobal) await db('DELETE FROM blog_global_comment_bans WHERE username=$1',[target]);
    else await db('DELETE FROM blog_comment_bans WHERE post_id=$1 AND username=$2',[req.params.id,target]);
    return res.json({ ok: true });
  }

  const type = action === 'ban' ? 'ban' : 'mute';
  const until = type === 'mute' ? Date.now() + 60*60*1000 : null;
  const createdAt = Date.now();

  if (isGlobal) {
    await db(`INSERT INTO blog_global_comment_bans (username,type,until,created_at) VALUES ($1,$2,$3,$4) ON CONFLICT (username) DO UPDATE SET type=$2,until=$3,created_at=$4`, [target,type,until,createdAt]);
  } else {
    await db(`INSERT INTO blog_comment_bans (post_id,username,type,until,created_at) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (post_id,username) DO UPDATE SET type=$3,until=$4,created_at=$5`, [req.params.id,target,type,until,createdAt]);
  }
  res.json({ ok: true, type, until, global: !!isGlobal });
});


// ── Список новостей / статья ─────────────────────────────────
app.get('/api/news', (req, res) => {
  const { status, page: pQ, limit: lQ } = req.query;
  const page  = Math.max(0, parseInt(pQ) || 0);
  const limit = Math.min(50, parseInt(lQ) || 20);

  let callerUsername = null;
  const auth = getAuthToken(req);
  if (auth) { try { callerUsername = jwt.verify(auth, JWT_SECRET).username.toLowerCase(); } catch {} }

  let list = newsPosts.filter(p => {
    if (p.status === 'hidden') {
      // Список прикрытых новостей виден только владельцу и только когда
      // он явно его запросил (вкладка "Скрытые").
      return status === 'hidden' && isNewsOwner(callerUsername);
    }
    if (status === 'hidden') return false;
    if (p.status !== 'published') {
      if (!callerUsername) return false;
      if (!isNewsOwner(callerUsername) && p.author.toLowerCase() !== callerUsername) return false;
      return status === 'drafts';
    }
    return status !== 'drafts';
  });

  if (status === 'drafts' || status === 'hidden') list.sort((a,b) => (b.updatedAt||b.createdAt) - (a.updatedAt||a.createdAt));
  else list.sort((a,b) => b.createdAt - a.createdAt);

  res.json({ posts: list.slice(page*limit, page*limit+limit).map(p => newsSanitize(p,false)), total: list.length });
});


app.get('/api/news/:id', async (req, res) => {
  const post = newsPosts.find(p => p.id === req.params.id);
  if (!post) return res.status(404).json({ error: 'Новость не найдена' });

  // Прикрытая новость не видна вообще никому (даже автору и владельцу) —
  // управление такими новостями идёт только через список "Скрытые".
  if (post.status === 'hidden') return res.status(404).json({ error: 'Новость не найдена' });

  let callerUsername = null;
  const auth = getAuthToken(req);
  if (auth) { try { callerUsername = jwt.verify(auth, JWT_SECRET).username.toLowerCase(); } catch {} }

  if (post.status !== 'published') {
    const canSee = callerUsername && (isNewsOwner(callerUsername) || post.author.toLowerCase() === callerUsername);
    if (!canSee) return res.status(403).json({ error: 'Черновик' });
  }

  const noview = req.query.noview === '1';
  if (!noview && post.status === 'published') {
    let viewerKey = callerUsername ? 'u:' + callerUsername : null;
    if (!viewerKey) { const did = req.deviceId; if (did) viewerKey = 'd:' + did; }
    if (viewerKey) {
      try {
        const ins = await db(`INSERT INTO news_views (viewer_key,post_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [viewerKey, post.id]);
        if (ins.rowCount === 1) {
          post.views = (post.views || 0) + 1;
          if (!post._viewTimer) post._viewTimer = setTimeout(() => { saveNewsPost(post).catch(()=>{}); post._viewTimer=null; }, 5000);
        }
      } catch(e) { console.error('[News] view:', e.message); }
    }
  }

  let liked = false, disliked = false;
  if (callerUsername) {
    const u = await getUser(callerUsername);
    if (u) {
      const [lr, dr] = await Promise.all([
        db('SELECT 1 FROM news_likes WHERE user_id=$1 AND post_id=$2',[u.id,post.id]),
        db('SELECT 1 FROM news_dislikes WHERE user_id=$1 AND post_id=$2',[u.id,post.id]),
      ]);
      liked = lr.rows.length>0; disliked = dr.rows.length>0;
    }
  }

  res.json({ ...newsSanitize(post,true), liked, disliked });
});


app.post('/api/news', newsAuthMiddleware, rateLimit(limiterStrict), async (req, res) => {
  if (!isNewsAuthorUser(req.newsUser.username)) return res.status(403).json({ error: 'Только авторы новостей могут писать статьи' });

  let { title, body, cover, status, encoding } = req.body;
  title = decodeBlogField(title, encoding);
  body  = decodeBlogField(body, encoding);
  if (!title || !title.trim()) return res.status(400).json({ error: 'Укажите заголовок' });
  if (!body  || !body.trim())  return res.status(400).json({ error: 'Укажите текст' });
  if (title.length > 200)      return res.status(400).json({ error: 'Заголовок слишком длинный (макс 200)' });
  if (body.length > 100000)    return res.status(400).json({ error: 'Текст слишком длинный (макс 100 000 символов)' });
  if (cover !== undefined && cover !== null && (typeof cover !== 'string' || cover.length > 500))
    return res.status(400).json({ error: 'Некорректная обложка' });

  const user = await getUser(req.newsUser.username.toLowerCase());
  if (!user) return res.status(404).json({ error: 'Пользователь не найден' });
  if (user.banned) return res.status(403).json({ error: 'Заблокированные пользователи не могут создавать новости' });

  const postStatus = ['published','draft'].includes(status) ? status : 'draft';
  const post = { id: uuidv4(), title: title.trim(), body: body.trim(), author: user.username,
    status: postStatus, views: 0, likes: 0, dislikes: 0, cover: cover || '', createdAt: Date.now(), updatedAt: null };
  newsPosts.unshift(post);
  await saveNewsPost(post);
  res.json(newsSanitize(post, true));
});


app.patch('/api/news/:id', newsAuthMiddleware, rateLimit(limiterStrict), async (req, res) => {
  const post = newsPosts.find(p => p.id === req.params.id);
  if (!post) return res.status(404).json({ error: 'Новость не найдена' });
  const caller = req.newsUser.username;
  if (!isNewsOwner(caller) && post.author.toLowerCase() !== caller.toLowerCase())
    return res.status(403).json({ error: 'Нет доступа' });

  let { title, body, cover, status, encoding } = req.body;
  title = decodeBlogField(title, encoding);
  body  = decodeBlogField(body, encoding);
  if (title !== undefined) { if (!title.trim()) return res.status(400).json({ error: 'Заголовок не может быть пустым' }); post.title = title.trim().slice(0,200); }
  if (body  !== undefined) { if (!body.trim())  return res.status(400).json({ error: 'Текст не может быть пустым' }); post.body = body.trim().slice(0,100000); }
  if (cover !== undefined) { post.cover = (typeof cover === 'string' ? cover.slice(0,500) : ''); }
  if (status !== undefined && ['published','draft','hidden'].includes(status)) {
    // Прикрывать новость и возвращать её обратно может только владелец.
    if ((status === 'hidden' || post.status === 'hidden') && !isNewsOwner(caller))
      return res.status(403).json({ error: 'Скрывать и восстанавливать новости может только владелец' });
    post.status = status;
  }
  post.updatedAt = Date.now();
  await saveNewsPost(post);
  res.json(newsSanitize(post, true));
});

app.delete('/api/news/:id', newsAuthMiddleware, handleDeleteNewsPost);

app.post('/api/news/:id/delete', newsAuthMiddleware, handleDeleteNewsPost);


// ── Лайк / дизлайк (взаимоисключающие) ───────────────────────
app.post('/api/news/:id/like', newsAuthMiddleware, rateLimit(limiterStrict), async (req, res) => {
  const post = newsPosts.find(p => p.id === req.params.id);
  if (!post) return res.status(404).json({ error: 'Новость не найдена' });
  if (post.status !== 'published') return res.status(400).json({ error: 'Нельзя оценить черновик' });
  const user = await getUser(req.newsUser.username.toLowerCase());
  if (!user) return res.status(404).json({ error: 'Пользователь не найден' });
  if (user.banned) return res.status(403).json({ error: 'Заблокированные не могут ставить оценки' });

  const { unlike } = req.body;
  const existingLike = await db('SELECT 1 FROM news_likes WHERE user_id=$1 AND post_id=$2',[user.id,post.id]);
  if (unlike) {
    if (existingLike.rows.length > 0) {
      await db('DELETE FROM news_likes WHERE user_id=$1 AND post_id=$2',[user.id,post.id]);
      post.likes = Math.max(0,(post.likes||1)-1);
    }
  } else if (existingLike.rows.length === 0) {
    await db('INSERT INTO news_likes (user_id,post_id) VALUES ($1,$2)',[user.id,post.id]);
    post.likes = (post.likes||0)+1;
    const existingDislike = await db('SELECT 1 FROM news_dislikes WHERE user_id=$1 AND post_id=$2',[user.id,post.id]);
    if (existingDislike.rows.length > 0) {
      await db('DELETE FROM news_dislikes WHERE user_id=$1 AND post_id=$2',[user.id,post.id]);
      post.dislikes = Math.max(0,(post.dislikes||1)-1);
    }
  }
  if (!post._lstTimer) post._lstTimer = setTimeout(()=>{ saveNewsPost(post).catch(()=>{}); post._lstTimer=null; },5000);
  res.json({ likes: post.likes, dislikes: post.dislikes, liked: !unlike, disliked: false });
});


app.post('/api/news/:id/dislike', newsAuthMiddleware, rateLimit(limiterStrict), async (req, res) => {
  const post = newsPosts.find(p => p.id === req.params.id);
  if (!post) return res.status(404).json({ error: 'Новость не найдена' });
  if (post.status !== 'published') return res.status(400).json({ error: 'Нельзя оценить черновик' });
  const user = await getUser(req.newsUser.username.toLowerCase());
  if (!user) return res.status(404).json({ error: 'Пользователь не найден' });
  if (user.banned) return res.status(403).json({ error: 'Заблокированные не могут ставить оценки' });

  const { undislike } = req.body;
  const existingDislike = await db('SELECT 1 FROM news_dislikes WHERE user_id=$1 AND post_id=$2',[user.id,post.id]);
  if (undislike) {
    if (existingDislike.rows.length > 0) {
      await db('DELETE FROM news_dislikes WHERE user_id=$1 AND post_id=$2',[user.id,post.id]);
      post.dislikes = Math.max(0,(post.dislikes||1)-1);
    }
  } else if (existingDislike.rows.length === 0) {
    await db('INSERT INTO news_dislikes (user_id,post_id) VALUES ($1,$2)',[user.id,post.id]);
    post.dislikes = (post.dislikes||0)+1;
    const existingLike = await db('SELECT 1 FROM news_likes WHERE user_id=$1 AND post_id=$2',[user.id,post.id]);
    if (existingLike.rows.length > 0) {
      await db('DELETE FROM news_likes WHERE user_id=$1 AND post_id=$2',[user.id,post.id]);
      post.likes = Math.max(0,(post.likes||1)-1);
    }
  }
  if (!post._lstTimer) post._lstTimer = setTimeout(()=>{ saveNewsPost(post).catch(()=>{}); post._lstTimer=null; },5000);
  res.json({ likes: post.likes, dislikes: post.dislikes, liked: false, disliked: !undislike });
});


// ── Авторы новостей (владелец) ───────────────────────────────
app.get('/api/news/authors', (req, res) => {
  res.json({ owner: NEWS_OWNER_USERNAME, authors: newsAuthors });
});


app.post('/api/news/authors', newsAuthMiddleware, async (req, res) => {
  if (!isNewsOwner(req.newsUser.username)) return res.status(403).json({ error: 'Только владелец может назначать авторов' });
  const { username } = req.body;
  if (!username || !username.trim()) return res.status(400).json({ error: 'Укажите никнейм' });
  const target = await getUser(username.trim().toLowerCase());
  if (!target) return res.status(404).json({ error: 'Пользователь не найден' });
  if (isNewsOwner(target.username)) return res.status(400).json({ error: 'Владелец и так может публиковать новости' });
  if (newsAuthors.some(a => a.toLowerCase() === target.username.toLowerCase()))
    return res.status(400).json({ error: 'Этот пользователь уже автор новостей' });

  await db(`INSERT INTO news_authors (username,username_low,created_at) VALUES ($1,$2,$3) ON CONFLICT (username_low) DO NOTHING`, [target.username, target.username.toLowerCase(), Date.now()]);
  newsAuthors.push(target.username);
  res.json({ ok: true, authors: newsAuthors });
});


app.post('/api/news/authors/remove', newsAuthMiddleware, async (req, res) => {
  if (!isNewsOwner(req.newsUser.username)) return res.status(403).json({ error: 'Только владелец может снимать авторов' });
  const { username } = req.body;
  if (!username || !username.trim()) return res.status(400).json({ error: 'Укажите никнейм' });
  const low = username.trim().toLowerCase();
  await db('DELETE FROM news_authors WHERE username_low=$1',[low]);
  for (let i = newsAuthors.length - 1; i >= 0; i--) {
    if (newsAuthors[i].toLowerCase() === low) newsAuthors.splice(i, 1);
  }
  res.json({ ok: true, authors: newsAuthors });
});


app.get('/api/news/:id/comments', async (req, res) => {
  const post = newsPosts.find(p => p.id === req.params.id);
  if (!post || post.status !== 'published') return res.status(404).json({ error: 'Новость не найдена' });

  let callerUsername = null;
  const auth = getAuthToken(req);
  if (auth) { try { callerUsername = jwt.verify(auth,JWT_SECRET).username.toLowerCase(); } catch {} }

  const r = await db('SELECT * FROM news_comments WHERE post_id=$1 ORDER BY created_at ASC',[req.params.id]);
  const comments = r.rows.map(c => ({
    id: c.id, postId: c.post_id, author: c.author,
    body: c.deleted ? null : c.body,
    deleted: c.deleted, deletedBy: c.deleted_by || null,
    createdAt: Number(c.created_at),
  }));

  let myBan = null;
  if (callerUsername) {
    const mute = await getNewsCommentMute(req.params.id, callerUsername);
    if (mute) myBan = { type: 'mute', until: Number(mute.until) };
  }

  res.json({ comments, count: comments.length, myBan });
});


app.post('/api/news/:id/comments', newsAuthMiddleware, rateLimit(limiterStrict), async (req, res) => {
  const post = newsPosts.find(p => p.id === req.params.id);
  if (!post || post.status !== 'published') return res.status(404).json({ error: 'Новость не найдена' });

  const user = await getUser(req.newsUser.username.toLowerCase());
  if (!user) return res.status(404).json({ error: 'Пользователь не найден' });
  if (user.banned) return res.status(403).json({ error: 'Вы заблокированы' });

  const mute = await getNewsCommentMute(req.params.id, user.username);
  if (mute) {
    const mins = Math.ceil((Number(mute.until) - Date.now())/60000);
    return res.status(403).json({ error: `Вы замьючены. Осталось ${mins} мин.`, until: Number(mute.until) });
  }

  const body = (req.body.body || '').toString().trim();
  if (!body) return res.status(400).json({ error: 'Пустой комментарий' });
  if (body.length > 4000) return res.status(400).json({ error: 'Максимум 4000 символов' });

  if (!isNewsOwner(user.username)) {
    const dayStart = new Date(); dayStart.setHours(0,0,0,0);
    const todayCount = await db(`SELECT COUNT(*) AS cnt FROM news_comments WHERE LOWER(author)=$1 AND created_at>=$2 AND deleted=FALSE`, [user.username.toLowerCase(), dayStart.getTime()]);
    if (Number(todayCount.rows[0]?.cnt || 0) >= 10)
      return res.status(429).json({ error: 'Можно оставить не более 10 комментариев в день. Возвращайтесь завтра!' });
  }

  const ratKey = 'newscmt_' + user.username.toLowerCase();
  if (!global._newsCmtRate) global._newsCmtRate = new Map();
  const last = global._newsCmtRate.get(ratKey) || 0;
  if (Date.now() - last < 20000) return res.status(429).json({ error: 'Не так быстро! Подождите 20 секунд' });
  global._newsCmtRate.set(ratKey, Date.now());

  const id = uuidv4();
  const createdAt = Date.now();
  await db('INSERT INTO news_comments (id,post_id,author,body,created_at,deleted) VALUES ($1,$2,$3,$4,$5,FALSE)', [id, req.params.id, user.username, body, createdAt]);

  res.json({ ok: true, comment: {
    id, postId: req.params.id, author: user.username,
    body, deleted: false, deletedBy: null, createdAt,
  }});
});

app.delete('/api/news/:id/comments/:cid', newsAuthMiddleware, handleDeleteNewsComment);

app.post('/api/news/:id/comments/:cid/delete', newsAuthMiddleware, handleDeleteNewsComment);


app.post('/api/news/:id/comments/mod', newsAuthMiddleware, async (req, res) => {
  const user = await getUser(req.newsUser.username.toLowerCase());
  if (!user || !isNewsOwner(user.username)) return res.status(403).json({ error: 'Нет прав' });

  const { action, username } = req.body;
  if (!action || !username) return res.status(400).json({ error: 'Укажите action и username' });
  const target = username.toLowerCase();
  if (isNewsOwner(target)) return res.status(403).json({ error: 'Нельзя замьютить владельца' });

  if (action === 'unmute') {
    await db('DELETE FROM news_comment_mutes WHERE post_id=$1 AND username=$2',[req.params.id,target]);
    return res.json({ ok: true });
  }
  if (action !== 'mute') return res.status(400).json({ error: 'Неверное действие' });

  const until = Date.now() + 60*60*1000;
  const createdAt = Date.now();
  await db(`INSERT INTO news_comment_mutes (post_id,username,until,created_at) VALUES ($1,$2,$3,$4) ON CONFLICT (post_id,username) DO UPDATE SET until=$3,created_at=$4`, [req.params.id,target,until,createdAt]);
  res.json({ ok: true, type: 'mute', until });
});


app.post('/api/upload', newsAuthMiddleware, rateLimit(limiterStrict), (req, res) => {
  if (!isNewsAuthorUser(req.newsUser.username)) return res.status(403).json({ error: 'Только авторы новостей могут загружать изображения' });
  uploadImage.single('file')(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.message || 'Не удалось загрузить файл' });
    if (!req.file) return res.status(400).json({ error: 'Файл не передан' });
    res.json({ url: '/uploads/' + req.file.filename });
  });
});


// ── Clubs API ─────────────────────────────────────────────────
app.get('/clubs',      (req, res) => res.sendFile(path.join(__dirname, '../public/clubs.html')));

app.get('/clubs/:id',  (req, res) => res.sendFile(path.join(__dirname, '../public/clubs.html')));


app.get('/api/clubs', (req, res) => {
  res.json([...clubs].sort((a, b) => (b.memberCount || 0) - (a.memberCount || 0)).map(c => ({
    id: c.id, name: c.name, description: c.description, memberCount: c.memberCount || 0,
    admins: c.admins || [], members: c.members || [], createdBy: c.createdBy, createdAt: c.createdAt, official: !!c.official,
  })));
});


app.get('/api/clubs/:id', (req, res) => {
  const club = clubs.find(c => c.id === req.params.id);
  if (!club) return res.status(404).json({ error: 'Клуб не найден' });
  res.json(club);
});


app.post('/api/clubs', authMiddleware, rateLimit(limiterStrict), async (req, res) => {
  const me = await getUser(req.user.username.toLowerCase());
  if (!me) return res.status(404).json({ error: 'Пользователь не найден' });
  if (me.banned) return res.status(403).json({ error: 'Вы заблокированы' });
  const { name, description } = req.body;
  if (!name || typeof name !== 'string') return res.status(400).json({ error: 'Укажите название' });
  const trimmedName = name.trim();
  if (trimmedName.length < 2 || trimmedName.length > 40) return res.status(400).json({ error: 'Название: 2–40 символов' });
  const normName = trimmedName.toLowerCase().replace(/[^a-zа-яё0-9]/gi, '');
  if (normName.includes('chesshome')) return res.status(400).json({ error: 'Название клуба не может содержать "ChessHome"' });
  const createdByMe = clubs.filter(c => c.createdBy.toLowerCase() === me.username.toLowerCase()).length;
  if (createdByMe >= 5) return res.status(400).json({ error: 'Нельзя создавать более 5 клубов' });
  const memberOf = clubs.filter(c => (c.members || []).map(m => m.toLowerCase()).includes(me.username.toLowerCase())).length;
  if (memberOf >= 10) return res.status(400).json({ error: 'Вы уже состоите в 10 клубах (максимум)' });
  if (clubs.find(c => c.name.toLowerCase() === trimmedName.toLowerCase())) return res.status(400).json({ error: 'Клуб с таким названием уже существует' });
  const id = uuidv4();
  const club = { id, name: trimmedName, description: (description || '').toString().trim().slice(0, 500), createdAt: new Date().toISOString(), createdBy: me.username, admins: [me.username], members: [me.username], memberCount: 1, official: false };
  clubs.push(club);
  await saveClub(club);
  res.json(club);
});


app.post('/api/clubs/:id/join', authMiddleware, rateLimit(limiterStrict), async (req, res) => {
  const me = await getUser(req.user.username.toLowerCase());
  if (!me || me.banned) return res.status(403).json({ error: 'Нет доступа' });
  const club = clubs.find(c => c.id === req.params.id);
  if (!club) return res.status(404).json({ error: 'Клуб не найден' });
  const lname = me.username.toLowerCase();
  if ((club.members || []).map(m => m.toLowerCase()).includes(lname)) return res.status(400).json({ error: 'Вы уже в этом клубе' });
  const memberOf = clubs.filter(c => (c.members || []).map(m => m.toLowerCase()).includes(lname)).length;
  if (memberOf >= 10) return res.status(400).json({ error: 'Вы уже в 10 клубах (максимум)' });
  club.members = club.members || []; club.members.push(me.username); club.memberCount = club.members.length;
  // Если вступает создатель клуба, а он ранее выпал из admins (например, после
  // выхода/повторного входа) — возвращаем ему права администратора клуба.
  if ((club.createdBy || '').toLowerCase() === lname) {
    club.admins = club.admins || [];
    if (!club.admins.map(a => a.toLowerCase()).includes(lname)) club.admins.push(me.username);
  }
  await saveClub(club);
  res.json({ ok: true, memberCount: club.memberCount });
});


// ──────────────────────────────────────────────────────────────
//  User Emoji
// ──────────────────────────────────────────────────────────────

app.post('/api/user/emoji', authMiddleware, async (req, res) => {
  try {
    const { emoji } = req.body;
    if (typeof emoji !== 'string') return res.status(400).json({ error: 'Неверный эмодзи' });
    // Белый список: разрешён ТОЛЬКО пустая строка (снять эмодзи) или
    // один из эмодзи, показанных в пикере на /settings. Раньше здесь
    // был чёрный список "запрещённых" эмодзи — он не мешал прислать
    // произвольный текст напрямую через API, минуя интерфейс.
    if (emoji !== '' && !PROFILE_EMOJIS.has(emoji)) {
      return res.status(400).json({ error: 'Этот эмодзи запрещён' });
    }
    const userId = req.user.userId;
    await db('UPDATE users SET emoji = $1 WHERE id = $2', [emoji, userId]);
    const user = await getUser(req.user.username.toLowerCase());
    if (user) user.emoji = emoji;
    res.json({ ok: true, emoji });
  } catch (err) {
    console.error('[Emoji update]', err);
    res.status(500).json({ error: 'Ошибка при сохранении эмодзи' });
  }
});


// ──────────────────────────────────────────────────────────────
//  User Profile (описание + внешние рейтинги ФШР/FIDE)
// ──────────────────────────────────────────────────────────────

app.post('/api/user/profile', authMiddleware, async (req, res) => {
  try {
    let { bio, fshrRating, fideRating } = req.body;

    if (bio != null && typeof bio !== 'string') return res.status(400).json({ error: 'Неверное описание' });
    bio = (bio || '').slice(0, 400);

    for (const [label, val] of [['ФШР', fshrRating], ['FIDE', fideRating]]) {
      if (val !== null && val !== undefined && (!Number.isFinite(val) || val < 0 || val > 4000)) {
        return res.status(400).json({ error: `Рейтинг ${label} должен быть числом от 0 до 4000` });
      }
    }
    fshrRating = (fshrRating === '' || fshrRating === undefined) ? null : fshrRating;
    fideRating = (fideRating === '' || fideRating === undefined) ? null : fideRating;

    const user = await getUser(req.user.username.toLowerCase());
    if (!user) return res.status(404).json({ error: 'Пользователь не найден' });

    user.bio = bio;
    user.fshrRating = fshrRating === null ? null : Number(fshrRating);
    user.fideRating = fideRating === null ? null : Number(fideRating);
    await saveUser(user);

    res.json({ bio: user.bio, fshrRating: user.fshrRating, fideRating: user.fideRating });
  } catch (err) {
    console.error('[Profile update]', err);
    res.status(500).json({ error: 'Ошибка при сохранении профиля' });
  }
});


app.post('/api/clubs/:id/leave', authMiddleware, async (req, res) => {
  const me = await getUser(req.user.username.toLowerCase());
  const club = clubs.find(c => c.id === req.params.id);
  if (!club) return res.status(404).json({ error: 'Клуб не найден' });
  const lname = me.username.toLowerCase();
  const idx = (club.members || []).findIndex(m => m.toLowerCase() === lname);
  if (idx === -1) return res.status(400).json({ error: 'Вы не в этом клубе' });
  if (club.official && club.createdBy.toLowerCase() === lname) return res.status(403).json({ error: 'Создатель официального клуба не может выйти' });
  club.members.splice(idx, 1);
  const aidx = (club.admins || []).findIndex(a => a.toLowerCase() === lname);
  if (aidx !== -1) club.admins.splice(aidx, 1);
  club.memberCount = club.members.length;
  if (club.memberCount === 0 && !club.official && (club.createdBy || '').toLowerCase() !== 'tester') {
    const ci = clubs.findIndex(c => c.id === club.id);
    if (ci !== -1) { clubs.splice(ci, 1); await deleteClubFromDB(club.id); return res.json({ ok: true }); }
  }
  await saveClub(club);
  res.json({ ok: true });
});

app.patch('/api/clubs/:id', authMiddleware, handleEditClub);

// POST-дублёр на случай хостингов/прокси, которые режут метод PATCH
// (см. аналогичный комментарий у /api/tournaments/:id/edit выше).
app.post('/api/clubs/:id/edit', authMiddleware, handleEditClub);


app.post('/api/clubs/:id/kick', authMiddleware, async (req, res) => {
  const me = await getUser(req.user.username.toLowerCase());
  if (!me) return res.status(404).json({ error: 'Не найден' });
  const club = clubs.find(c => c.id === req.params.id);
  if (!club) return res.status(404).json({ error: 'Клуб не найден' });
  const isClubAdmin = (club.admins || []).map(a => a.toLowerCase()).includes(me.username.toLowerCase());
  const isSuperAdmin = me.username.toLowerCase() === 'chesshome' || me.role === 'admin';
  if (!isClubAdmin && !isSuperAdmin) return res.status(403).json({ error: 'Нет прав' });
  const { username } = req.body;
  if (!username) return res.status(400).json({ error: 'Укажите username' });
  const target = username.toLowerCase();
  if (club.official && club.createdBy.toLowerCase() === target) return res.status(403).json({ error: 'Нельзя кикнуть создателя официального клуба' });
  const idx = (club.members || []).findIndex(m => m.toLowerCase() === target);
  if (idx === -1) return res.status(400).json({ error: 'Пользователь не в клубе' });
  const targetIsAdmin = (club.admins || []).map(a => a.toLowerCase()).includes(target);
  if (targetIsAdmin && !isSuperAdmin) return res.status(403).json({ error: 'Нельзя кикнуть администратора клуба' });
  club.members.splice(idx, 1);
  const aidx = (club.admins || []).findIndex(a => a.toLowerCase() === target);
  if (aidx !== -1) club.admins.splice(aidx, 1);
  club.memberCount = club.members.length;
  if (club.memberCount === 0 && !club.official && (club.createdBy || '').toLowerCase() !== 'tester') {
    clubs.splice(clubs.findIndex(c => c.id === club.id), 1); await deleteClubFromDB(club.id); return res.json({ ok: true });
  }
  await saveClub(club);
  res.json({ ok: true });
});


app.post('/api/clubs/:id/promote', authMiddleware, async (req, res) => {
  const me = await getUser(req.user.username.toLowerCase());
  if (!me) return res.status(404).json({ error: 'Не найден' });
  const club = clubs.find(c => c.id === req.params.id);
  if (!club) return res.status(404).json({ error: 'Клуб не найден' });
  const isCreator = club.createdBy.toLowerCase() === me.username.toLowerCase();
  const isSuperAdmin = me.username.toLowerCase() === 'chesshome' || me.role === 'admin';
  if (!isCreator && !isSuperAdmin) return res.status(403).json({ error: 'Только создатель может назначать администраторов' });
  const { username } = req.body;
  if (!username) return res.status(400).json({ error: 'Укажите username' });
  const targetUser = await getUser(username.toLowerCase());
  if (!targetUser) return res.status(404).json({ error: 'Пользователь не найден' });
  if (targetUser.banned) return res.status(403).json({ error: 'Нельзя назначить забаненного администратором' });
  if (!(club.members || []).map(m => m.toLowerCase()).includes(username.toLowerCase())) return res.status(400).json({ error: 'Пользователь не в клубе' });
  if ((club.admins || []).map(a => a.toLowerCase()).includes(username.toLowerCase())) return res.status(400).json({ error: 'Уже является администратором' });
  if ((club.admins || []).length >= 3) return res.status(400).json({ error: 'Максимум 3 администратора на клуб' });
  club.admins = club.admins || []; club.admins.push(targetUser.username);
  await saveClub(club); res.json({ ok: true });
});


app.post('/api/clubs/:id/demote', authMiddleware, async (req, res) => {
  const me = await getUser(req.user.username.toLowerCase());
  if (!me) return res.status(404).json({ error: 'Не найден' });
  const club = clubs.find(c => c.id === req.params.id);
  if (!club) return res.status(404).json({ error: 'Клуб не найден' });
  const isCreator = club.createdBy.toLowerCase() === me.username.toLowerCase();
  const isSuperAdmin = me.username.toLowerCase() === 'chesshome' || me.role === 'admin';
  if (!isCreator && !isSuperAdmin) return res.status(403).json({ error: 'Нет прав' });
  const target = (req.body.username || '').toLowerCase();
  if (club.createdBy.toLowerCase() === target) return res.status(403).json({ error: 'Нельзя снять создателя' });
  const aidx = (club.admins || []).findIndex(a => a.toLowerCase() === target);
  if (aidx === -1) return res.status(400).json({ error: 'Пользователь не является администратором' });
  club.admins.splice(aidx, 1); await saveClub(club); res.json({ ok: true });
});

app.delete('/api/clubs/:id', authMiddleware, handleDeleteClub);

app.post('/api/clubs/:id/delete', authMiddleware, handleDeleteClub);


// ── Club Chat API ──────────────────────────────────────────────
app.get('/api/clubs/:id/chat', authMiddleware, (req, res) => {
  const club = clubs.find(c => c.id === req.params.id);
  if (!club) return res.status(404).json({ error: 'Клуб не найден' });
  const me = req.user;
  if (!canWriteInClubChat(club, me.username) && !isClubModerator(club, me.username)) {
    return res.status(403).json({ error: 'Только участники клуба могут читать чат' });
  }
  const msgs = getClubChat(club.id);
  const bans = getClubChatBans(club.id);
  const myBan = bans.get(me.username.toLowerCase());
  res.json({ messages: msgs.slice(-CLUB_CHAT_MAX), myBan: myBan || null });
});


app.post('/api/clubs/:id/chat', authMiddleware, rateLimit(limiterStrict), (req, res) => {
  const club = clubs.find(c => c.id === req.params.id);
  if (!club) return res.status(404).json({ error: 'Клуб не найден' });
  const me = req.user;
  if (!canWriteInClubChat(club, me.username)) return res.status(403).json({ error: 'Только участники клуба могут писать в чат' });
  const bans = getClubChatBans(club.id);
  const myBan = bans.get(me.username.toLowerCase());
  if (myBan) {
    if (myBan.permanent) return res.status(403).json({ error: 'Вы заблокированы в чате этого клуба' });
    if (myBan.until > Date.now()) return res.status(403).json({ error: 'Вы временно заблокированы', until: myBan.until });
    bans.delete(me.username.toLowerCase());
  }
  const text = (req.body.message || '').toString().trim().slice(0, 300);
  if (!text) return res.status(400).json({ error: 'Пустое сообщение' });
  const msg = { id: require('crypto').randomUUID(), username: me.username, role: me.role || 'user', message: text, timestamp: Date.now() };
  const chat = getClubChat(club.id);
  chat.push(msg);
  if (chat.length > CLUB_CHAT_MAX) chat.shift();
  saveClubChatMsg(club.id, msg);
  io.to('club_' + club.id).emit('club_chat_msg', { clubId: club.id, msg });
  res.json({ ok: true, msg });
});


app.post('/api/clubs/:id/chat-ban', authMiddleware, async (req, res) => {
  const club = clubs.find(c => c.id === req.params.id);
  if (!club) return res.status(404).json({ error: 'Клуб не найден' });
  const me = req.user;
  if (!isClubModerator(club, me.username)) return res.status(403).json({ error: 'Нет прав' });
  const { username, type } = req.body;
  if (!username) return res.status(400).json({ error: 'Нет имени пользователя' });
  const target = username.toLowerCase();
  if (isSiteAdmin(target)) return res.status(403).json({ error: 'Нельзя заблокировать администратора' });
  const targetIsClubAdmin = (club.admins || []).map(a => a.toLowerCase()).includes(target);
  if (targetIsClubAdmin && !isSiteAdmin(me.username)) return res.status(403).json({ error: 'Нельзя заблокировать администратора клуба' });

  const bans = getClubChatBans(club.id);
  const chat = getClubChat(club.id);

  if (type === 'mute') {
    bans.set(target, { until: Date.now() + 15 * 60 * 1000, permanent: false });
    for (let i = chat.length - 1; i >= 0; i--) {
      if ((chat[i].username || '').toLowerCase() === target) chat.splice(i, 1);
    }
    deleteClubChatMsgsByUser(club.id, target);
    const sysMsg = { id: require('crypto').randomUUID(), username: 'system', role: 'system', message: `Администратор заглушил ${username} на 15 минут. Смотрите правила клуба.`, timestamp: Date.now(), system: true };
    chat.push(sysMsg); if (chat.length > CLUB_CHAT_MAX) chat.shift();
    saveClubChatMsg(club.id, sysMsg);
    io.to('club_' + club.id).emit('club_chat_user_banned', { clubId: club.id, username, sysMsg });
    return res.json({ ok: true });
  }

  bans.set(target, { until: Infinity, permanent: true });
  for (let i = chat.length - 1; i >= 0; i--) {
    if ((chat[i].username || '').toLowerCase() === target) chat.splice(i, 1);
  }
  deleteClubChatMsgsByUser(club.id, target);
  const sysMsg = { id: require('crypto').randomUUID(), username: 'system', role: 'system', message: `Администратор заблокировал ${username}. Смотрите правила клуба.`, timestamp: Date.now(), system: true };
  chat.push(sysMsg); if (chat.length > CLUB_CHAT_MAX) chat.shift();
  saveClubChatMsg(club.id, sysMsg);
  io.to('club_' + club.id).emit('club_chat_user_banned', { clubId: club.id, username, sysMsg });
  res.json({ ok: true });
});


app.post('/api/clubs/:id/chat-unban', authMiddleware, (req, res) => {
  const club = clubs.find(c => c.id === req.params.id);
  if (!club) return res.status(404).json({ error: 'Клуб не найден' });
  const me = req.user;
  if (!isClubModerator(club, me.username)) return res.status(403).json({ error: 'Нет прав' });
  const { username } = req.body;
  if (!username) return res.status(400).json({ error: 'Нет имени' });
  getClubChatBans(club.id).delete(username.toLowerCase());
  res.json({ ok: true });
});


app.post('/api/clubs/:id/chat-report', authMiddleware, (req, res) => {
  const club = clubs.find(c => c.id === req.params.id);
  if (!club) return res.status(404).json({ error: 'Клуб не найден' });
  const me = req.user;
  const { msgId, reason } = req.body;
  for (const [, sess] of sessions) {
    const u = usersCache.get(sess.username.toLowerCase());
    if (u?.role === 'admin' || isClubModerator(club, sess.username)) {
      const s = findSocketByUsername(sess.username);
      if (s) s.emit('club_chat_report', { clubId: club.id, clubName: club.name, msgId, from: me.username, reason: reason || '' });
    }
  }
  res.json({ ok: true });
});


app.get('/api/users/:username/clubs', (req, res) => {
  const uname = req.params.username.toLowerCase();
  const userClubs = clubs.filter(c => (c.members || []).map(m => m.toLowerCase()).includes(uname));
  res.json(userClubs.map(c => ({ id: c.id, name: c.name, description: c.description, memberCount: c.memberCount || 0, admins: c.admins || [], members: c.members || [], createdBy: c.createdBy, official: !!c.official })));
});


app.get('/api/puzzles/leaderboard', async (req, res) => {
  try {
    const r = await db(`SELECT username,puzzle_rating,puzzle_solved,puzzle_attempted,role FROM users WHERE puzzle_attempted > 0 ORDER BY puzzle_rating DESC LIMIT 50`);
    res.json(r.rows.map((row,i) => ({
      rank: i+1, username: row.username,
      puzzleRating: row.puzzle_rating||1200,
      puzzleSolved: row.puzzle_solved||0,
      puzzleAttempted: row.puzzle_attempted||0,
      accuracy: (row.puzzle_attempted||0)>0 ? Math.round((row.puzzle_solved||0)/row.puzzle_attempted*100) : 0,
      role: row.role,
    })));
  } catch(e) { res.status(500).json({ error: 'Ошибка' }); }
});


app.get('/api/puzzles/topics', async (req, res) => {
  try {
    const r = await db(`SELECT pt.*, COUNT(p.id) as puzzle_count FROM puzzle_topics pt LEFT JOIN puzzles p ON p.topic=pt.id GROUP BY pt.id ORDER BY pt.sort_order ASC`);
    res.json(r.rows.map(row => ({
      id: row.id, name: row.name, icon: row.icon,
      description: row.description, puzzleCount: Number(row.puzzle_count||0)
    })));
  } catch(e) { res.status(500).json({ error: 'Ошибка' }); }
});


// Публичный лидерборд — сумма очков по всем засчитанным турнирам.
app.get('/api/durka/leaderboard', async (req, res) => {
  try {
    const r = await db(`SELECT username, points, tournaments FROM durka_players WHERE points > 0 ORDER BY points DESC, tournaments DESC LIMIT 200`);
    res.json(r.rows.map((row, i) => ({
      rank: i + 1,
      username: row.username,
      points: Number(row.points) || 0,
      tournaments: Number(row.tournaments) || 0,
    })));
  } catch(e) { res.status(500).json({ error: 'Ошибка' }); }
});


// Список уже засчитанных турниров — чтобы видеть историю на странице.
app.get('/api/durka/tournaments', async (req, res) => {
  try {
    const r = await db(`SELECT id, name, url, players, created_at FROM durka_tournaments ORDER BY created_at DESC LIMIT 100`);
    res.json(r.rows.map(row => ({
      id: row.id, name: row.name, url: row.url,
      players: Number(row.players) || 0,
      createdAt: Number(row.created_at),
    })));
  } catch(e) { res.status(500).json({ error: 'Ошибка' }); }
});


// Приём результатов одного турнира от hi.py.
// body: { tournamentId, name, url, results: [{ username, points, rank }] }
app.post('/api/durka/add-tournament', durkaKeyMiddleware, async (req, res) => {
  try {
    const { tournamentId, name, url, results } = req.body || {};
    if (!tournamentId || !Array.isArray(results) || !results.length) {
      return res.status(400).json({ error: 'tournamentId и results обязательны' });
    }

    const already = await db(`SELECT id FROM durka_tournaments WHERE id = $1`, [tournamentId]);
    if (already.rows.length && req.query.force !== '1') {
      return res.status(409).json({ error: 'Этот турнир уже засчитан в лидерборд', tournamentId });
    }

    const cleaned = results
      .map(r => ({
        username: String(r.username || '').trim(),
        points: Number(r.points) || 0,
        rank: r.rank != null ? Number(r.rank) : null,
      }))
      .filter(r => r.username);

    if (!cleaned.length) return res.status(400).json({ error: 'Пустой список результатов' });

    await withTransaction(async (client) => {
      // Если пересчитываем турнир (force=1) — сначала вычитаем его старый вклад.
      if (already.rows.length) {
        const old = await client.query(`SELECT username_low, points FROM durka_tournament_results WHERE tournament_id = $1`, [tournamentId]);
        for (const row of old.rows) {
          await client.query(
            `UPDATE durka_players SET points = GREATEST(points - $1, 0), tournaments = GREATEST(tournaments - 1, 0) WHERE username_low = $2`,
            [row.points, row.username_low]
          );
        }
        await client.query(`DELETE FROM durka_tournament_results WHERE tournament_id = $1`, [tournamentId]);
      }

      for (const r of cleaned) {
        const usernameLow = r.username.toLowerCase();
        await client.query(
          `INSERT INTO durka_tournament_results (tournament_id, username_low, username, points, rank)
           VALUES ($1, $2, $3, $4, $5)`,
          [tournamentId, usernameLow, r.username, r.points, r.rank]
        );
        await client.query(
          `INSERT INTO durka_players (username_low, username, points, tournaments, updated_at)
           VALUES ($1, $2, $3, 1, $4)
           ON CONFLICT (username_low) DO UPDATE SET
             username = EXCLUDED.username,
             points = durka_players.points + EXCLUDED.points,
             tournaments = durka_players.tournaments + 1,
             updated_at = EXCLUDED.updated_at`,
          [usernameLow, r.username, r.points, Date.now()]
        );
      }

      await client.query(
        `INSERT INTO durka_tournaments (id, name, url, players, added_by, created_at)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, url = EXCLUDED.url, players = EXCLUDED.players, created_at = durka_tournaments.created_at`,
        [tournamentId, name || tournamentId, url || null, cleaned.length, 'hi.py', Date.now()]
      );
    });

    console.log(`[Durka] Турнир ${tournamentId} засчитан: ${cleaned.length} игроков`);
    res.json({ ok: true, tournamentId, playersAdded: cleaned.length });
  } catch(e) {
    console.error('[Durka] add-tournament error:', e.message);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});


app.get('/api/puzzles/daily', async (req, res) => {
  try {
    const r = await db('SELECT * FROM puzzles ORDER BY created_at ASC');
    if (!r.rows.length) return res.json(null);
    const puzzle = r.rows[Math.floor(Date.now()/(24*60*60*1000)) % r.rows.length];
    res.json({ id:puzzle.id, title:puzzle.title, description:puzzle.description, fen:puzzle.fen, topic:puzzle.topic, difficulty:puzzle.difficulty });
  } catch(e) { res.status(500).json({ error: 'Ошибка' }); }
});


app.get('/api/puzzles', async (req, res) => {
  try {
    const { topic, difficulty, limit=20, offset=0 } = req.query;
    const lim = Math.min(50, parseInt(limit)||20);
    const off = parseInt(offset)||0;

    let userId = null;
    const ah = getAuthToken(req);
    if (ah) {
      try {
        const dec = jwt.verify(ah, JWT_SECRET);
        const u = await getUser(dec.username.toLowerCase());
        if (u) userId = u.id;
      } catch {}
    }

    let sql, params, solvedSet = new Set(), attemptedSet = new Set();

    if (userId) {
      const conditions = ['1=1'];
      params = [userId];
      let i = 2;
      if (topic)      { conditions.push(`p.topic=$${i++}`);      params.push(topic); }
      if (difficulty) { conditions.push(`p.difficulty=$${i++}`); params.push(difficulty); }
      params.push(lim, off);

      sql = `
        SELECT p.*,
          pa.correct  AS _correct,
          pa.failed   AS _failed,
          CASE
            WHEN pa.id IS NULL        THEN 0
            WHEN pa.correct = false   THEN 1
            WHEN pa.correct = true    THEN 2
            ELSE 0
          END AS _sort_priority
        FROM puzzles p
        LEFT JOIN puzzle_attempts pa ON pa.puzzle_id = p.id AND pa.user_id = $1
        WHERE ${conditions.join(' AND ')}
        ORDER BY _sort_priority ASC, p.created_at ASC
        LIMIT $${i++} OFFSET $${i++}
      `;

      const r = await db(sql, params);

      const att = await db('SELECT puzzle_id, correct FROM puzzle_attempts WHERE user_id=$1', [userId]);
      for (const a of att.rows) {
        if (a.correct) solvedSet.add(a.puzzle_id);
        else attemptedSet.add(a.puzzle_id);
      }

      return res.json(r.rows.map(row => ({
        id: row.id, title: row.title, description: row.description,
        fen: row.fen, topic: row.topic, difficulty: row.difficulty,
        playCount: row.play_count, correctCount: row.correct_count,
        userStatus: solvedSet.has(row.id) ? 'solved' : attemptedSet.has(row.id) ? 'attempted' : 'new',
      })));
    }

    const conditions = ['1=1'];
    params = []; let i = 1;
    if (topic)      { conditions.push(`topic=$${i++}`);      params.push(topic); }
    if (difficulty) { conditions.push(`difficulty=$${i++}`); params.push(difficulty); }
    params.push(lim, off);
    sql = `SELECT * FROM puzzles WHERE ${conditions.join(' AND ')} ORDER BY created_at ASC LIMIT $${i++} OFFSET $${i++}`;
    const r = await db(sql, params);
    return res.json(r.rows.map(row => ({
      id: row.id, title: row.title, description: row.description,
      fen: row.fen, topic: row.topic, difficulty: row.difficulty,
      playCount: row.play_count, correctCount: row.correct_count,
      userStatus: 'new',
    })));

  } catch(e) { console.error('[Puzzles]', e.message); res.status(500).json({ error: 'Ошибка' }); }
});


app.get('/api/puzzles/:id', async (req, res) => {
  try {
    const r = await db('SELECT * FROM puzzles WHERE id=$1',[req.params.id]);
    if (!r.rows[0]) return res.status(404).json({ error: 'Не найдена' });
    const p = r.rows[0];
    res.json({ id:p.id, title:p.title, description:p.description, fen:p.fen, topic:p.topic, difficulty:p.difficulty, playCount:p.play_count, correctCount:p.correct_count });
  } catch(e) { res.status(500).json({ error: 'Ошибка' }); }
});


app.post('/api/puzzles/:id/move', authMiddleware, rateLimit(limiterStrict), async (req, res) => {
  try {
    const { moveIndex, move } = req.body;
    if (move === undefined || moveIndex === undefined) return res.status(400).json({ error: 'Укажите move и moveIndex' });
    const r = await db('SELECT * FROM puzzles WHERE id=$1', [req.params.id]);
    if (!r.rows[0]) return res.status(404).json({ error: 'Задача не найдена' });
    const puzzle = r.rows[0];
    const { playerMoves, autoMoves } = parsePuzzleSolution(puzzle.solution);

    const expectedRaw = playerMoves[moveIndex];
    if (!expectedRaw) return res.status(400).json({ error: 'Некорректный moveIndex' });
    const playerMove    = (move || '').toLowerCase().trim();
    const acceptedMoves = expectedRaw.split('|').map(m => m.trim());
    let correct = acceptedMoves.includes(playerMove)
      || acceptedMoves.some(m => m.length===4 && playerMove.startsWith(m))
      || acceptedMoves.some(m => m.length===5 && m.endsWith('q') && playerMove===m.slice(0,4));
    if (!correct) return res.json({ correct: false, solution: puzzle.solution });
    const autoMove = autoMoves[moveIndex] || null;
    const finished = moveIndex >= playerMoves.length - 1;
    res.json({ correct: true, autoMove, finished, solution: finished ? puzzle.solution : null });
  } catch(e) { console.error('[Puzzle move]', e.message); res.status(500).json({ error: 'Ошибка' }); }
});


app.post('/api/puzzles/:id/attempt', authMiddleware, rateLimit(limiterStrict), async (req, res) => {
  try {
    const { correct: clientCorrect, moves } = req.body;

    const r = await db('SELECT * FROM puzzles WHERE id=$1', [req.params.id]);
    if (!r.rows[0]) return res.status(404).json({ error: 'Задача не найдена' });
    const puzzle = r.rows[0];

    let correct;
    if (typeof clientCorrect === 'boolean') {
      correct = clientCorrect;
    } else if (Array.isArray(moves)) {
      const { playerMoves } = parsePuzzleSolution(puzzle.solution);
      const userPlayerMoves = moves.filter((_, i) => i % 2 === 0);
      correct = playerMoves.length > 0 &&
        userPlayerMoves.length === playerMoves.length &&
        playerMoves.every((m, i) => {
          const variants = m.split('|').map(v => v.trim());
          const played   = (userPlayerMoves[i] || '').toLowerCase().trim();
          return variants.includes(played)
            || variants.some(v => v.length===4 && played.startsWith(v))
            || variants.some(v => v.length===5 && v.endsWith('q') && played===v.slice(0,4));
        });
    } else {
      return res.status(400).json({ error: 'Укажите correct или moves' });
    }

    const user = await getUser(req.user.username.toLowerCase());
    if (!user) return res.status(404).json({ error: 'Пользователь не найден' });

    const existing = await db('SELECT correct FROM puzzle_attempts WHERE user_id=$1 AND puzzle_id=$2', [user.id, puzzle.id]);
    const alreadySolved = existing.rows[0]?.correct;

    if (!alreadySolved) {
      await db(`INSERT INTO puzzle_attempts (id,user_id,puzzle_id,correct,created_at) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (user_id,puzzle_id) DO UPDATE SET correct=$4,created_at=$5`, [uuidv4(), user.id, puzzle.id, correct, Date.now()]);
      await db('UPDATE puzzles SET play_count=play_count+1 WHERE id=$1', [puzzle.id]);
      if (correct) await db('UPDATE puzzles SET correct_count=correct_count+1 WHERE id=$1', [puzzle.id]);
      const ratingDelta = correct ? 15 : -10;
      const newRating    = Math.max(100, (user.puzzle_rating || 1200) + ratingDelta);
      const newSolved    = (user.puzzle_solved || 0) + (correct ? 1 : 0);
      const newAttempted = (user.puzzle_attempted || 0) + 1;
      await db('UPDATE users SET puzzle_rating=$1,puzzle_solved=$2,puzzle_attempted=$3 WHERE id=$4', [newRating, newSolved, newAttempted, user.id]);
      user.puzzle_rating = newRating; user.puzzle_solved = newSolved; user.puzzle_attempted = newAttempted;
      cacheUser(user);
      return res.json({ correct, solution: puzzle.solution, ratingDelta, newPuzzleRating: newRating, alreadySolved: false });
    }
    res.json({ correct: true, solution: puzzle.solution, ratingDelta: 0, newPuzzleRating: user.puzzle_rating || 1200, alreadySolved: true });
  } catch(e) { console.error('[Puzzle attempt]', e.message); res.status(500).json({ error: 'Ошибка' }); }
});


// ══════════════════════════════════════════════════════════════
//  PUZZLE STORM API
// ══════════════════════════════════════════════════════════════
app.get('/api/storm/puzzles', async (req, res) => {
  try {
    const topicsParam = req.query.topics || 'mate1,mate2';
    const topics = topicsParam.split(',').map(t => t.trim()).filter(Boolean);
    const placeholders = topics.map((_, i) => `$${i + 1}`).join(',');
    const r = await db(`SELECT id,fen,solution,topic,difficulty FROM puzzles WHERE topic IN (${placeholders}) ORDER BY RANDOM() LIMIT 80`, topics);
    res.json(r.rows);
  } catch(e) { res.status(500).json({ error: 'Ошибка' }); }
});

app.post('/api/storm/start', authMiddleware, rateLimit(limiterStrict), async (req, res) => {
  const runId = uuidv4();
  stormRuns.set(runId, { userId: req.user.userId, startedAt: Date.now() });
  res.json({ runId });
});

app.post('/api/storm/finish', authMiddleware, rateLimit(limiterStrict), async (req, res) => {
  try {
    const { score, totalAttempted, correct, wrong, timeBonus, runId } = req.body;
    if (typeof score !== 'number' || score < 0) return res.status(400).json({ error: 'Неверный score' });
    if (typeof correct !== 'number' || typeof wrong !== 'number' || correct < 0 || wrong < 0) {
      return res.status(400).json({ error: 'Неверные данные' });
    }

    // ── Проверка на подделку результата ──
    // 1) Забег должен быть начат через /api/storm/start этим же пользователем.
    const run = typeof runId === 'string' ? stormRuns.get(runId) : null;
    if (!run || run.userId !== req.user.userId) {
      return res.status(400).json({ error: 'Забег не найден. Начните игру заново.' });
    }
    stormRuns.delete(runId); // одноразовый — повторно этот runId использовать нельзя

    const elapsedMs = Date.now() - run.startedAt;
    // 2) Результат не может превышать лимит времени игры (+ разумный запас на сеть).
    if (elapsedMs > STORM_MAX_TIME_MS) {
      return res.status(400).json({ error: 'Забег просрочен' });
    }
    // 3) score всегда равен correct (1 очко за решённую задачу) — так считает клиент.
    if (score !== correct) {
      return res.status(400).json({ error: 'Результат не прошёл проверку' });
    }
    // 4) Нельзя решить больше задач, чем физически влезает во время игры.
    const maxPossible = Math.floor(elapsedMs / STORM_MIN_MS_PER_PUZZLE);
    if (correct + wrong > maxPossible) {
      return res.status(400).json({ error: 'Результат не прошёл проверку' });
    }

    const user = await getUser(req.user.username.toLowerCase());
    if (!user) return res.status(404).json({ error: 'Не найден' });
    await db(`INSERT INTO puzzle_storm_runs (id,user_id,username,score,total_attempted,correct,wrong,time_bonus,created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`, [uuidv4(), user.id, user.username, score, totalAttempted||0, correct||0, wrong||0, timeBonus||0, Date.now()]);
    const isBest  = score > (user.storm_best || 0);
    const newBest = isBest ? score : (user.storm_best || 0);
    const newRuns = (user.storm_runs || 0) + 1;
    await db('UPDATE users SET storm_best=$1,storm_runs=$2 WHERE id=$3', [newBest, newRuns, user.id]);
    user.storm_best = newBest; user.storm_runs = newRuns; cacheUser(user);
    res.json({ ok:true, isBest, newBest, totalRuns:newRuns });
  } catch(e) { console.error('[Storm finish]',e.message); res.status(500).json({ error: 'Ошибка' }); }
});

app.get('/api/storm/leaderboard', async (req, res) => {
  try {
    const r = await db(`SELECT username,storm_best,storm_runs FROM users WHERE storm_runs>0 ORDER BY storm_best DESC LIMIT 50`);
    res.json(r.rows.map((u,i) => ({ rank:i+1, username:u.username, best:u.storm_best||0, runs:u.storm_runs||0 })));
  } catch(e) { res.status(500).json({ error: 'Ошибка' }); }
});

app.get('/api/storm/player/:username', async (req, res) => {
  try {
    const user = await getUser(req.params.username.toLowerCase());
    if (!user) return res.status(404).json({ error: 'Не найден' });
    const runs = await db(`SELECT score,correct,wrong,created_at FROM puzzle_storm_runs WHERE user_id=$1 ORDER BY created_at DESC LIMIT 10`, [user.id]);
    res.json({ username:user.username, best:user.storm_best||0, runs:user.storm_runs||0, history: runs.rows.map(r => ({ score:r.score, correct:r.correct, wrong:r.wrong, at:Number(r.created_at) })) });
  } catch(e) { res.status(500).json({ error: 'Ошибка' }); }
});


app.post('/api/admin/puzzles', authMiddleware, async (req, res) => {
  await requireAdmin(req, res, async () => {
    const { title,description,fen,solution,topic,difficulty } = req.body;
    if (!title||!fen||!solution||!topic) return res.status(400).json({ error: 'title,fen,solution,topic обязательны' });
    const id = uuidv4();
    await db(`INSERT INTO puzzles (id,title,description,fen,solution,topic,difficulty,created_by,created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`, [id,title.trim().slice(0,100),(description||'').trim().slice(0,300), fen.trim(),solution.trim(),topic,difficulty||'medium',req.user.username,Date.now()]);
    await logAdminAction(req.user.username, 'puzzle_create', id, { title: title.trim().slice(0,100), topic, difficulty: difficulty||'medium' });
    res.json({ ok:true, id });
  });
});

app.delete('/api/admin/puzzles/:id', authMiddleware, handleDeletePuzzle);

app.post('/api/admin/puzzles/:id/delete', authMiddleware, handleDeletePuzzle);


// ── Статичные HTML страницы ───────────────────────────────────
app.get('/profile', (req, res) => res.sendFile(path.join(__dirname, '../public/index.html')));

app.get('/settings', (req, res) => res.sendFile(path.join(__dirname, '../public/settings.html')));

// /tournaments/active, /tournaments/upcoming, /tournaments/finished — прямые ссылки на вкладки,
// отдаём ту же страницу, фильтрацию по вкладке делает клиентский JS (см. tournaments.html)
app.get('/tournaments/*', (req, res) => res.sendFile(path.join(__dirname, '../public/tournaments.html')));

app.get('/profile/:username', (req, res) => res.sendFile(path.join(__dirname, '../public/profile.html')));

app.get('/user/:username',    (req, res) => res.sendFile(path.join(__dirname, '../public/profile.html')));

app.get('/tournament/:id',    (req, res) => res.sendFile(path.join(__dirname, '../public/tournament.html')));

// Межклубные турниры — отдельная страница карточки турнира (со своей вёрсткой:
// командный зачёт, состав команд и т.п.), НЕ путать с /tournament/:id выше —
// та отдаёт общий шаблон одиночного турнира без командной статистики.
// Регистрируем ПОСЛЕ /tournament/:id намеренно — не важно, т.к. паттерны разной
// длины ("/tournament/interclub/xxx" — 2 сегмента, не матчится /tournament/:id).
app.get('/tournament/interclub/:id', (req, res) => res.sendFile(path.join(__dirname, '../public/interclub-tournament.html')));

// Чистый URL без .html для списка межклубных турниров (сам список — public/interclub-tournaments.html).
app.get('/interclub-tournaments', (req, res) => res.sendFile(path.join(__dirname, '../public/interclub-tournaments.html')));

app.get('/inbox',             (req, res) => res.sendFile(path.join(__dirname, '../public/inbox.html')));

app.get('/inbox/:partner',    (req, res) => res.sendFile(path.join(__dirname, '../public/inbox.html')));

app.get('/forum',             (req, res) => res.sendFile(path.join(__dirname, '../public/forum.html')));

app.get('/forum/*',           (req, res) => res.sendFile(path.join(__dirname, '../public/forum.html')));

app.get('/puzzles',           (req, res) => res.sendFile(path.join(__dirname, '../public/index.html')));

app.get('/puzzles/*',         (req, res) => res.sendFile(path.join(__dirname, '../public/index.html')));

app.get('/stats',             (req, res) => res.sendFile(path.join(__dirname, '../public/stats.html')));

app.get('/storm',             (req, res) => res.sendFile(path.join(__dirname, '../public/storm.html')));

app.get('/storm/*',           (req, res) => res.sendFile(path.join(__dirname, '../public/storm.html')));

app.get('/age', (req, res) => { res.sendFile(path.join(__dirname, '../public', 'age.html')); });

app.get('/online', (req, res) => res.sendFile(path.join(__dirname, '../public/online.html')));


app.get('/api/stats', async (req, res) => {
  try {
    const FOUNDED = new Date('2026-03-30T00:00:00Z');
    const daysAlive = Math.floor((Date.now() - FOUNDED.getTime()) / 86400000);

    const [ users, games, dm, chat, clubChat, blogPosts, blogComments, blogLikes, blogViews, forums, forumReplies, tournaments, clubs, puzzleAttempts, puzzleSolved, topRating, topPuzzle, topGames, gamesByTC, gamesByResult, registrationsByDay, gamesByDay, biggestWinStreak, avgGameMoves ] = await Promise.all([
      db('SELECT COUNT(*) FROM users'),
      db('SELECT COUNT(*) FROM games'),
      db('SELECT COUNT(*) FROM dm_messages'),
      db('SELECT COUNT(*) FROM chat_messages'),
      db('SELECT COUNT(*) FROM club_chat_messages'),
      db('SELECT COUNT(*) FROM blog_posts'),
      db('SELECT COUNT(*) FROM blog_comments'),
      db('SELECT COUNT(*) FROM blog_likes'),
      db('SELECT COUNT(*) FROM blog_views'),
      db('SELECT COUNT(*) FROM forum_threads'),
      db('SELECT COUNT(*) FROM forum_replies'),
      db('SELECT COUNT(*) FROM tournaments'),
      db('SELECT COUNT(*) FROM clubs'),
      db('SELECT COUNT(*) FROM puzzle_attempts'),
      db("SELECT COUNT(*) FROM puzzle_attempts WHERE correct=true"),
      db('SELECT username, rating FROM users ORDER BY rating DESC LIMIT 5'),
      db('SELECT username, puzzle_rating FROM users WHERE puzzle_attempted > 0 ORDER BY puzzle_rating DESC LIMIT 5'),
      db('SELECT username, games_played FROM users ORDER BY games_played DESC LIMIT 5'),
      db("SELECT time_control, COUNT(*) as cnt FROM games WHERE time_control IS NOT NULL GROUP BY time_control ORDER BY cnt DESC LIMIT 8"),
      db("SELECT result, COUNT(*) as cnt FROM games GROUP BY result"),
      db(`SELECT DATE(to_timestamp(created_at/1000)) as day, COUNT(*) as cnt FROM users WHERE created_at > extract(epoch from now()-interval '30 days')*1000 GROUP BY day ORDER BY day ASC`),
      db(`SELECT DATE(to_timestamp(ended_at/1000)) as day, COUNT(*) as cnt FROM games WHERE ended_at > extract(epoch from now()-interval '30 days')*1000 GROUP BY day ORDER BY day ASC`),
      db('SELECT username, wins FROM users ORDER BY wins DESC LIMIT 1'),
      db('SELECT AVG(jsonb_array_length(moves::jsonb)) as avg FROM games WHERE moves IS NOT NULL AND moves != \'[]\' AND moves != \'null\''),
    ]);

    const totalMessages = parseInt(dm.rows[0].count) + parseInt(chat.rows[0].count) + parseInt(clubChat.rows[0].count);

    res.json({
      meta: { daysAlive, founded: '30.03.2026' },
      totals: {
        users: parseInt(users.rows[0].count), games: parseInt(games.rows[0].count), messages: totalMessages,
        dmMessages: parseInt(dm.rows[0].count), chatMessages: parseInt(chat.rows[0].count), clubMessages: parseInt(clubChat.rows[0].count),
        blogPosts: parseInt(blogPosts.rows[0].count), blogComments: parseInt(blogComments.rows[0].count),
        blogLikes: parseInt(blogLikes.rows[0].count), blogViews: parseInt(blogViews.rows[0].count),
        forums: parseInt(forums.rows[0].count), forumReplies: parseInt(forumReplies.rows[0].count),
        tournaments: parseInt(tournaments.rows[0].count), clubs: parseInt(clubs.rows[0].count),
        puzzleAttempts: parseInt(puzzleAttempts.rows[0].count), puzzleSolved: parseInt(puzzleSolved.rows[0].count),
      },
      leaders: { rating: topRating.rows, puzzle: topPuzzle.rows, games: topGames.rows, mostWins: biggestWinStreak.rows[0] || null },
      charts: { gamesByTC: gamesByTC.rows, gamesByResult: gamesByResult.rows, regByDay: registrationsByDay.rows, gamesByDay: gamesByDay.rows },
      misc: { avgGameMoves: Math.round(parseFloat(avgGameMoves.rows[0]?.avg) || 0), puzzleSuccessRate: puzzleAttempts.rows[0].count > 0 ? Math.round(parseInt(puzzleSolved.rows[0].count) / parseInt(puzzleAttempts.rows[0].count) * 100) : 0 }
    });
  } catch(e) { console.error('[Stats]', e.message); res.status(500).json({ error: 'Ошибка' }); }
});



// ── Dev Diary API ───────────────────────────────────────────
app.get('/api/dev-diary', async (req, res) => {
  const page = Math.max(1, parseInt(req.query.page) || 1);
  const limit = Math.min(20, parseInt(req.query.limit) || 20);
  const offset = (page - 1) * limit;
  const sort = req.query.sort === 'asc' ? 'ASC' : 'DESC';

  const totalRes = await db('SELECT COUNT(*) AS total FROM dev_diary');
  const total = parseInt(totalRes.rows[0].total);

  const rows = await db(`
    SELECT id, author, title, content, created_at
    FROM dev_diary
    ORDER BY created_at ${sort}
    LIMIT $1 OFFSET $2
  `, [limit, offset]);

  res.json({
    entries: rows.rows.map(r => ({
      id: r.id, author: r.author, title: r.title, content: r.content, createdAt: Number(r.created_at)
    })),
    total, page, totalPages: Math.ceil(total / limit)
  });
});


app.post('/api/dev-diary', authMiddleware, async (req, res) => {
  const user = await getUser(req.user.username.toLowerCase());
  if (!user || user.role !== 'admin') return res.status(403).json({ error: 'Только администраторы могут добавлять записи' });

  const { title, content } = req.body;
  if (!title || !content) return res.status(400).json({ error: 'Заполните заголовок и текст' });
  if (title.length > 100) return res.status(400).json({ error: 'Заголовок не длиннее 100 символов' });
  if (content.length > 2000) return res.status(400).json({ error: 'Текст не длиннее 2000 символов' });

  const id = require('crypto').randomUUID();
  await db('INSERT INTO dev_diary (id, author, title, content, created_at) VALUES ($1,$2,$3,$4,$5)', [id, user.username, title.trim(), content.trim(), Date.now()]);
  res.json({ ok: true, id });
});

// DELETE — основной вариант, POST — резервный на случай, если хостинг режет DELETE.
app.delete('/api/dev-diary/:id', authMiddleware, handleDeleteDevDiaryEntry);

app.post('/api/dev-diary/:id/delete', authMiddleware, handleDeleteDevDiaryEntry);


// ── Dev Diary: реакции ────────────────────────────────────────
// Таблицы создаются в main()

app.get('/api/dev-diary/:entryId/reactions', async (req, res) => {
  try {
    const rows = await db(
      `SELECT emoji, COUNT(*) AS cnt FROM dev_diary_reactions WHERE entry_id=$1 GROUP BY emoji`,
      [req.params.entryId]
    );
    // Своя реакция текущего пользователя (опционально по токену)
    let myEmoji = null;
    const auth = getAuthToken(req);
    if (auth) {
      try {
        const payload = jwt.verify(auth, JWT_SECRET);
        const r2 = await db(
          `SELECT emoji FROM dev_diary_reactions WHERE entry_id=$1 AND username_low=$2`,
          [req.params.entryId, payload.username.toLowerCase()]
        );
        if (r2.rows[0]) myEmoji = r2.rows[0].emoji;
      } catch {}
    }
    const counts = {};
    for (const r of rows.rows) counts[r.emoji] = parseInt(r.cnt);
    res.json({ counts, myEmoji });
  } catch (e) { res.status(500).json({ error: e.message }); }
});


app.post('/api/dev-diary/:entryId/reactions', authMiddleware, async (req, res) => {
  const ALLOWED_EMOJIS = ['👍','❤️','🔥','😂','🤯'];
  const { emoji } = req.body;
  if (!ALLOWED_EMOJIS.includes(emoji)) return res.status(400).json({ error: 'Недопустимый эмодзи' });
  const usernameLow = req.user.username.toLowerCase();
  // Проверяем, есть ли уже реакция
  const existing = await db(
    `SELECT emoji FROM dev_diary_reactions WHERE entry_id=$1 AND username_low=$2`,
    [req.params.entryId, usernameLow]
  );
  if (existing.rows[0]) {
    if (existing.rows[0].emoji === emoji) {
      // Снять реакцию
      await db(`DELETE FROM dev_diary_reactions WHERE entry_id=$1 AND username_low=$2`,
        [req.params.entryId, usernameLow]);
      return res.json({ ok: true, removed: true });
    } else {
      // Заменить
      await db(`UPDATE dev_diary_reactions SET emoji=$1 WHERE entry_id=$2 AND username_low=$3`,
        [emoji, req.params.entryId, usernameLow]);
      return res.json({ ok: true, replaced: true });
    }
  }
  await db(`INSERT INTO dev_diary_reactions (entry_id, username_low, emoji, created_at) VALUES ($1,$2,$3,$4)`,
    [req.params.entryId, usernameLow, emoji, Date.now()]);
  res.json({ ok: true });
});


// ── Dev Diary: комментарии ────────────────────────────────────

app.get('/api/dev-diary/:entryId/comments', async (req, res) => {
  try {
    const page  = Math.max(1, parseInt(req.query.page) || 1);
    const limit = 20;
    const offset = (page - 1) * limit;
    const totalR = await db(`SELECT COUNT(*) AS total FROM dev_diary_comments WHERE entry_id=$1`, [req.params.entryId]);
    const total = parseInt(totalR.rows[0].total);
    const rows = await db(
      `SELECT id, entry_id, username, content, created_at
       FROM dev_diary_comments WHERE entry_id=$1
       ORDER BY created_at ASC LIMIT $2 OFFSET $3`,
      [req.params.entryId, limit, offset]
    );
    res.json({
      comments: rows.rows.map(r => ({ id: r.id, username: r.username, content: r.content, createdAt: Number(r.created_at) })),
      total, page, totalPages: Math.ceil(total / limit)
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});


app.post('/api/dev-diary/:entryId/comments', authMiddleware, async (req, res) => {
  try {
    const user = await getUser(req.user.username.toLowerCase());
    if (!user) return res.status(401).json({ error: 'Не авторизован' });
    if (user.banned) return res.status(403).json({ error: 'Вы заблокированы' });

    // Проверяем бан на комментарии в дневнике
    const banR = await db(`SELECT 1 FROM dev_diary_comment_bans WHERE username_low=$1`, [user.username.toLowerCase()]);
    if (banR.rows.length) return res.status(403).json({ error: 'Вам запрещено оставлять комментарии в дневнике' });

    // Лимит 5 в день
    const dayStart = Date.now() - 24 * 60 * 60 * 1000;
    const countR = await db(
      `SELECT COUNT(*) AS cnt FROM dev_diary_comments WHERE username_low=$1 AND created_at > $2`,
      [user.username.toLowerCase(), dayStart]
    );
    if (parseInt(countR.rows[0].cnt) >= 5) return res.status(429).json({ error: 'Лимит 5 комментариев в сутки исчерпан' });

    const { content } = req.body;
    if (!content || !content.trim()) return res.status(400).json({ error: 'Пустой комментарий' });
    if (content.length > 500) return res.status(400).json({ error: 'Комментарий не длиннее 500 символов' });

    const id = require('crypto').randomUUID();
    await db(`INSERT INTO dev_diary_comments (id, entry_id, username, username_low, content, created_at) VALUES ($1,$2,$3,$4,$5,$6)`,
      [id, req.params.entryId, user.username, user.username.toLowerCase(), content.trim(), Date.now()]);
    res.json({ ok: true, id, username: user.username, content: content.trim(), createdAt: Date.now() });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/dev-diary/comments/:commentId', authMiddleware, handleDeleteDevDiaryComment);

app.post('/api/dev-diary/comments/:commentId/delete', authMiddleware, handleDeleteDevDiaryComment);


// Бан/разбан юзера в комментариях дневника
app.post('/api/admin/dev-diary-comment-ban', authMiddleware, async (req, res) => {
  try {
    await requireAdmin(req, res, async () => {
      const { username, action } = req.body; // action: 'ban' | 'unban'
      if (!username) return res.status(400).json({ error: 'username обязателен' });
      const ulow = username.toLowerCase();
      if (action === 'ban') {
        await db(`INSERT INTO dev_diary_comment_bans (username_low, created_at) VALUES ($1,$2) ON CONFLICT DO NOTHING`,
          [ulow, Date.now()]);
      } else {
        await db(`DELETE FROM dev_diary_comment_bans WHERE username_low=$1`, [ulow]);
      }
      await logAdminAction(req.user.username, 'dev_diary_comment_' + (action === 'ban' ? 'ban' : 'unban'), username, {});
      res.json({ ok: true });
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});


app.get('/game/:gameId', async (req, res) => {
  const gameId = req.params.gameId;
  // Получаем данные игры через API (переиспользуем логику)
  let game = activeGames.get(gameId);
  if (!game) {
    const dbGame = await db('SELECT * FROM games WHERE id = $1', [gameId]);
    if (dbGame.rows.length === 0) {
      // Фоллбэк: старые турнирные партии, сохранённые до записи в таблицу games
      let tournamentGame = null, tournamentMeta = null;
      for (const t of tournaments) {
        const tg = (t.games || []).find(g => g.id === gameId);
        if (tg) { tournamentGame = tg; tournamentMeta = t; break; }
      }
      if (!tournamentGame) {
        return res.status(404).send('Игра не найдена');
      }
      game = {
        id: tournamentGame.id, white: tournamentGame.white, black: tournamentGame.black,
        result: tournamentGame.result, reason: tournamentGame.reason, moves: tournamentGame.moves,
        timeControl: tournamentGame.timeControl, endedAt: tournamentGame.endedAt || null,
        tournamentId: tournamentMeta.id, tournamentName: tournamentMeta.name,
      };
    } else {
      const row = dbGame.rows[0];
      game = {
        id: row.id, white: row.white, black: row.black,
        result: row.result, reason: row.reason, moves: row.moves,
        timeControl: row.time_control, endedAt: row.ended_at ? Number(row.ended_at) : null
      };
    }
  }

  // Простая страница просмотра партии
  const movesJson = JSON.stringify(game.moves || []);
  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Партия · ${game.white} vs ${game.black}</title>
      <link href="https://cdn.jsdelivr.net/npm/@chrisoakman/chessboard2@0.5.0/dist/chessboard2.min.css" rel="stylesheet">
      <style>
        body { font-family: system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif; background: #1a1a2e; color: #e0e0e0; display: flex; justify-content: center; align-items: center; min-height: 100vh; margin: 0; padding: 20px; }
        .container { max-width: 700px; width: 100%; background: #0f0f1e; border-radius: 20px; padding: 24px; box-shadow: 0 10px 30px rgba(0,0,0,0.5); }
        h1 { font-size: 1.5rem; margin: 0 0 4px; }
        .players { display: flex; justify-content: space-between; margin-bottom: 20px; font-weight: bold; background: #1e1e2a; padding: 12px 16px; border-radius: 12px; }
        .player { font-size: 1.2rem; }
        .result { font-size: 1.1rem; color: #c9a84c; }
        #board { width: 100%; max-width: 500px; margin: 0 auto 20px; }
        .controls { display: flex; gap: 12px; justify-content: center; margin-top: 20px; }
        button { background: #2a2a3a; border: none; padding: 8px 16px; border-radius: 8px; color: #fff; cursor: pointer; font-weight: 600; transition: 0.1s; }
        button:hover { background: #c9a84c; color: #000; }
        .move-list { background: #0a0a14; border-radius: 12px; padding: 12px; margin-top: 20px; max-height: 200px; overflow-y: auto; font-family: monospace; font-size: 13px; }
        .move { display: inline-block; margin-right: 12px; }
        .current-move { font-weight: bold; color: #c9a84c; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="players">
          <span class="player">♔ ${escapeHtml(game.white)}</span>
          <span class="player">♚ ${escapeHtml(game.black)}</span>
        </div>
        <div style="text-align:center; margin-bottom:12px">
          <span class="result">${formatGameResult(game.result, game.white, game.black)}</span>
          ${game.reason ? `<span style="margin-left:12px;color:#aaa">(${game.reason})</span>` : ''}
        </div>
        <div id="board"></div>
        <div class="controls">
          <button id="prevBtn">◀ Пред.</button>
          <button id="nextBtn">След. ▶</button>
          <button id="pgnBtn">⬇ Скачать PGN</button>
        </div>
        <div class="move-list" id="moveList"></div>
      </div>

      <script src="https://cdnjs.cloudflare.com/ajax/libs/chess.js/0.10.3/chess.min.js"></script>
      <script src="https://cdn.jsdelivr.net/npm/@chrisoakman/chessboard2@0.5.0/dist/chessboard2.min.js"></script>
      <script>
        const moves = ${movesJson};
        const gameId = "${gameId}";
        const gameWhite = ${JSON.stringify(game.white)};
        const gameBlack = ${JSON.stringify(game.black)};
        const gameResult = ${JSON.stringify(game.result || null)};
        const gameEndedAt = ${JSON.stringify(game.endedAt || null)};
        const gameTournamentName = ${JSON.stringify(game.tournamentName || null)};
        const boardEl = document.getElementById('board');
        let currentIndex = 0;
        let gameState = new Chess();

        function applyMovesUpTo(index) {
          gameState = new Chess();
          for (let i = 0; i < index && i < moves.length; i++) {
            const mv = moves[i];
            const from = numberToAlgebraic(mv.from);
            const to = numberToAlgebraic(mv.to);
            const promotion = mv.promotion ? mv.promotion.toLowerCase() : undefined;
            gameState.move({ from, to, promotion });
          }
          if (board) { try { board.position(gameState.fen()); } catch(e) {} }
        }

        function numberToAlgebraic(sq) {
          const files = 'abcdefgh';
          const rank = Math.floor(sq / 8);
          const file = sq % 8;
          return files[file] + (rank + 1);
        }

        function updateUI() {
          applyMovesUpTo(currentIndex);
          const moveItems = document.querySelectorAll('.move');
          moveItems.forEach((el, idx) => {
            if (idx === currentIndex) el.classList.add('current-move');
            else el.classList.remove('current-move');
          });
          const listDiv = document.getElementById('moveList');
          if (listDiv && currentIndex >= 0) {
            const activeMoveSpan = listDiv.querySelector('.move.current-move');
            if (activeMoveSpan) activeMoveSpan.scrollIntoView({ behavior: 'smooth', block: 'center' });
          }
        }

        function renderMoveList() {
          const container = document.getElementById('moveList');
          container.innerHTML = '';
          for (let i = 0; i < moves.length; i++) {
            const mv = moves[i];
            const moveText = \`\${numberToAlgebraic(mv.from)}→\${numberToAlgebraic(mv.to)}\${mv.promotion ? '='+mv.promotion.toUpperCase() : ''}\`;
            const moveSpan = document.createElement('span');
            moveSpan.className = 'move';
            moveSpan.textContent = moveText;
            moveSpan.style.cursor = 'pointer';
            moveSpan.onclick = () => { currentIndex = i; updateUI(); };
            container.appendChild(moveSpan);
            if ((i+1) % 8 === 0) container.appendChild(document.createElement('br'));
          }
          if (moves.length === 0) container.textContent = 'Нет ходов';
        }

        function buildPgn() {
          const pgnGame = new Chess();
          const headers = {
            Event: gameTournamentName ? gameTournamentName : 'Casual Game',
            Site: 'ChessHome',
            Date: gameEndedAt ? new Date(gameEndedAt).toISOString().slice(0,10).replace(/-/g, '.') : '????.??.??',
            White: gameWhite,
            Black: gameBlack,
            Result: gameResult === 'white' ? '1-0' : gameResult === 'black' ? '0-1' : gameResult === 'draw' ? '1/2-1/2' : '*'
          };
          for (const mv of moves) {
            const from = numberToAlgebraic(mv.from);
            const to = numberToAlgebraic(mv.to);
            const promotion = mv.promotion ? mv.promotion.toLowerCase() : undefined;
            pgnGame.move({ from, to, promotion });
          }
          let pgn = '';
          for (const [key, value] of Object.entries(headers)) {
            pgn += '[' + key + ' "' + String(value).replace(/"/g, '') + '"]\\n';
          }
          pgn += '\\n';
          pgn += pgnGame.pgn();
          if (headers.Result !== '*') pgn += ' ' + headers.Result;
          return pgn;
        }

        function downloadPgn() {
          const pgn = buildPgn();
          const blob = new Blob([pgn], { type: 'application/x-chess-pgn' });
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = 'game_' + gameId + '.pgn';
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          URL.revokeObjectURL(url);
        }

        let board;
        window.addEventListener('DOMContentLoaded', () => {
          try {
            if (typeof Chessboard2 !== 'undefined') {
              board = Chessboard2('board', { position: 'start', draggable: false });
            } else {
              document.getElementById('board').innerHTML = '<div style="text-align:center;color:#aaa;padding:20px">Доска недоступна (ошибка загрузки библиотеки), но ходы и PGN доступны</div>';
            }
          } catch (e) {
            document.getElementById('board').innerHTML = '<div style="text-align:center;color:#aaa;padding:20px">Доска недоступна (ошибка загрузки библиотеки), но ходы и PGN доступны</div>';
          }
          renderMoveList();
          updateUI();
          document.getElementById('prevBtn').onclick = () => { if (currentIndex > 0) { currentIndex--; updateUI(); } };
          document.getElementById('nextBtn').onclick = () => { if (currentIndex < moves.length) { currentIndex++; updateUI(); } };
          document.getElementById('pgnBtn').onclick = downloadPgn;
        });
      </script>
    </body>
    </html>
  `);

  function escapeHtml(str) { return String(str || '').replace(/[&<>]/g, function(m) { if (m === '&') return '&amp;'; if (m === '<') return '&lt;'; if (m === '>') return '&gt;'; return m; }); }
  function formatGameResult(result, white, black) {
    if (result === 'white') return `🏆 ${white} победил`;
    if (result === 'black') return `🏆 ${black} победил`;
    if (result === 'draw') return `🤝 Ничья`;
    return `Партия завершена`;
  }
});



app.get('*', (req, res) => {
  if (req.path.startsWith('/api/')) return res.status(404).json({ error: 'Не найдено' });
  if (/\.[a-z0-9]+$/i.test(req.path)) { return res.status(404).sendFile(path.join(__dirname, '../public/404.html')); }
  res.sendFile(path.join(__dirname, '../public/index.html'));
});


// Любой /api/* запрос с методом, для которого нет отдельного маршрута выше
// (POST/PATCH/PUT/DELETE на несуществующий или опечатанный путь), должен
// получить JSON, а не дефолтную HTML-страницу Express вида
// "Cannot DELETE /api/...". Именно из-за такой HTML-страницы фронтенд падал
// с "JSON.parse: unexpected character at line 1 column 1" — он пытался
// распарсить HTML как JSON.
app.all('/api/*', (req, res) => {
  res.status(404).json({ error: 'Эндпоинт не найден' });
});

// ── Обработчик ошибок — ДОЛЖЕН быть зарегистрирован последним ──


// Финальный обработчик ошибок — гарантирует, что клиент ВСЕГДА получит JSON,
// а не HTML-страницу с трейсом, даже если где-то в коде забыли try/catch.
app.use((err, req, res, next) => {
  if (res.headersSent) return next(err);
  if (err && err.type === 'entity.too.large') {
    return res.status(413).json({ error: 'Слишком большой запрос' });
  }
  if (err && err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'Некорректный JSON в запросе' });
  }
  console.error('[Unhandled error]', err);
  res.status(500).json({ error: 'Внутренняя ошибка сервера' });
});