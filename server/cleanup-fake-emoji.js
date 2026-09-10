// ═══════════════════════════════════════════════════════════════
//  cleanup-fake-emoji.js — разовый скрипт очистки
// ═══════════════════════════════════════════════════════════════
// Находит всех пользователей, у которых в поле emoji лежит что-то,
// не входящее в белый список PROFILE_EMOJIS (т.е. воспользовались
// старой дырой и поставили себе произвольный текст вместо эмодзи),
// печатает список и сбрасывает им emoji на пустую строку.
//
// Запуск:  node cleanup-fake-emoji.js
//   (без флагов — сначала просто ПОКАЖЕТ, кого затронет)
// Запуск:  node cleanup-fake-emoji.js --apply
//   (реально применит UPDATE)
// ═══════════════════════════════════════════════════════════════

const { pool, PROFILE_EMOJIS } = require('./core');

const APPLY = process.argv.includes('--apply');

async function main() {
  const client = await pool.connect();
  try {
    const res = await client.query(
      `SELECT id, username, emoji FROM users WHERE emoji IS NOT NULL AND emoji <> ''`
    );

    const offenders = res.rows.filter(row => !PROFILE_EMOJIS.has(row.emoji));

    if (offenders.length === 0) {
      console.log('Никого не найдено — у всех либо пусто, либо валидный эмодзи из списка.');
      return;
    }

    console.log(`Найдено ${offenders.length} пользователь(ей) с поддельным "эмодзи":\n`);
    for (const row of offenders) {
      console.log(`  id=${row.id}  username=${row.username}  emoji=${JSON.stringify(row.emoji)}`);
    }

    if (!APPLY) {
      console.log('\nЭто был просмотр (dry-run). Чтобы реально сбросить emoji этим пользователям, запусти:');
      console.log('  node cleanup-fake-emoji.js --apply');
      return;
    }

    const ids = offenders.map(r => r.id);
    await client.query(`UPDATE users SET emoji = '' WHERE id = ANY($1::text[])`, [ids]);
    console.log(`\nГотово. Сброшен emoji у ${ids.length} пользователь(ей).`);
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch(err => {
  console.error('Ошибка:', err);
  process.exit(1);
});