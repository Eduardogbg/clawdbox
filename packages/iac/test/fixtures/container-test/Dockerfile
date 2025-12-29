# Simple test container that echoes HTTP requests
FROM node:20-alpine

WORKDIR /app

# Create a simple HTTP server
RUN cat > server.js << 'EOF'
const http = require('http');

const server = http.createServer((req, res) => {
  console.log(`${req.method} ${req.url}`);

  if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', container: true }));
    return;
  }

  if (req.url === '/echo') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        method: req.method,
        url: req.url,
        headers: req.headers,
        body: body
      }));
    });
    return;
  }

  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('Hello from test container!');
});

server.listen(8080, () => {
  console.log('Test container listening on port 8080');
});
EOF

EXPOSE 8080

CMD ["node", "server.js"]
