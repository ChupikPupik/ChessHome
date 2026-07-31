#!/usr/bin/env node
// Скрипт для скачивания Stockfish.js в папку public/js
// Запусти один раз: node download-stockfish.js

const https = require('https');
const fs = require('fs');
const path = require('path');

const URL = 'https://cdn.jsdelivr.net/npm/stockfish.js@10.0.2/stockfish.js';
const OUT = path.join(__dirname, 'public', 'js', 'stockfish.js');

if (fs.existsSync(OUT)) {
  console.log('✅ stockfish.js уже существует:', OUT);
  process.exit(0);
}

console.log('📥 Скачиваю Stockfish.js...');
const file = fs.createWriteStream(OUT);
https.get(URL, (res) => {
  res.pipe(file);
  file.on('finish', () => {
    file.close();
    console.log('✅ Stockfish.js скачан в', OUT);
    console.log('🚀 Теперь запусти: npm start');
  });
}).on('error', (err) => {
  fs.unlink(OUT, () => {});
  console.error('❌ Ошибка скачивания:', err.message);
  console.log('Попробуй вручную скачать:\n' + URL + '\nи сохрани как public/js/stockfish.js');
});