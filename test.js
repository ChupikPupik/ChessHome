const http = require('http');

const server = http.createServer((req, res) => {
  res.end('ok');
});

server.listen(3456, '127.0.0.1', () => {
  console.log('Test server running on http://127.0.0.1:3456');
});