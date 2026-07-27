#!/usr/bin/env node

const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const fs = require('fs');
const path = require('path');
const readline = require('readline');

const DATA_FILE = path.join(__dirname, 'server', 'data.json');

function loadData() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      const raw = fs.readFileSync(DATA_FILE, 'utf8');
      const d = JSON.parse(raw);
      const usersMap = new Map();
      for (const [k, v] of (d.users || [])) usersMap.set(k, v);
      return { ...d, users: usersMap };
    }
  } catch (e) { console.error('Ошибка:', e.message); }
  return { users: new Map(), gameHistory: [], globalChat: [] };
}

function saveData(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify({
    ...data, users: Array.from(data.users.entries()), savedAt: new Date().toISOString()
  }, null, 2), 'utf8');
}

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const ask = (q) => new Promise(r => rl.question(q, r));

async function main() {
  console.log('\n♟️  Chess Home — Управление аккаунтами\n');
  const data = loadData();
  const users = data.users;
  console.log(`Пользователей в базе: ${users.size}`);
  console.log('\n1. Создать/обновить chesshome (admin)\n2. Назначить admin\n3. Список пользователей\n4. Сменить пароль\n5. Выход\n');
  const c = await ask('Выбери (1-5): ');

  if (c === '1') {
    const pw = await ask('Пароль для chesshome: ');
    if (pw.length < 6) { console.log('❌ Минимум 6 символов'); rl.close(); return; }
    const hash = await bcrypt.hash(pw, 10);
    const ex = users.get('chesshome');
    if (ex) { ex.passwordHash = hash; ex.role = 'admin'; ex.banned = false; users.set('chesshome', ex); }
    else users.set('chesshome', { id: uuidv4(), username: 'chesshome', email: '', passwordHash: hash, createdAt: Date.now(), rating: 1200, gamesPlayed: 0, wins: 0, losses: 0, draws: 0, avatar: null, role: 'admin', banned: false });
    saveData({ ...data, users });
    console.log('✅ chesshome готов! Войди через /login на сайте.\n');

  } else if (c === '2') {
    const u = await ask('Ник: ');
    const user = users.get(u.toLowerCase());
    if (!user) { console.log('❌ Не найден'); rl.close(); return; }
    user.role = 'admin'; users.set(u.toLowerCase(), user);
    saveData({ ...data, users });
    console.log(`✅ ${user.username} теперь admin`);

  } else if (c === '3') {
    console.log('\n── Пользователи ──');
    for (const [, u] of users.entries())
      console.log(`  ${u.username}${u.role==='admin'?' [ADMIN]':''}${u.banned?' [БАН]':''} — ★${u.rating} · ${u.gamesPlayed} партий`);
    console.log('──────────────────\n');

  } else if (c === '4') {
    const u = await ask('Ник: ');
    const user = users.get(u.toLowerCase());
    if (!user) { console.log('❌ Не найден'); rl.close(); return; }
    const pw = await ask('Новый пароль: ');
    if (pw.length < 6) { console.log('❌ Минимум 6 символов'); rl.close(); return; }
    user.passwordHash = await bcrypt.hash(pw, 10);
    users.set(u.toLowerCase(), user); saveData({ ...data, users });
    console.log(`✅ Пароль ${user.username} изменён`);
  }
  rl.close();
}

main().catch(e => { console.error(e); rl.close(); });