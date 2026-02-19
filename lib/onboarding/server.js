// DhandhaPhone Onboarding Web Server
// Minimal HTTP server using Node.js built-in http module. Zero dependencies.
// Usage: require('./server').start() or node lib/onboarding/server.js

const http = require('http');
const fs = require('fs');
const path = require('path');
const config = require('../config');
const env = require('../env');

const HTML_PATH = path.join(__dirname, 'index.html');

function parseBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString()));
      } catch {
        resolve({});
      }
    });
    req.on('error', reject);
  });
}

function json(res, data, status = 200) {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
  res.end(JSON.stringify(data));
}

function cors(res) {
  res.writeHead(204, {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  });
  res.end();
}

async function handleRequest(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const route = url.pathname;

  // CORS preflight
  if (req.method === 'OPTIONS') return cors(res);

  // GET / — serve HTML
  if (req.method === 'GET' && route === '/') {
    try {
      const html = fs.readFileSync(HTML_PATH, 'utf8');
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(html);
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'text/plain' });
      res.end('index.html not found');
    }
    return;
  }

  // GET /api/config — all config + onboarding status
  if (req.method === 'GET' && route === '/api/config') {
    return json(res, {
      config: config.getAll(),
      onboarded: config.isOnboarded(),
      onboarding_progress: config.getOnboardingProgress(),
    });
  }

  // POST /api/config — bulk save
  if (req.method === 'POST' && route === '/api/config') {
    const body = await parseBody(req);
    if (!body || typeof body !== 'object') {
      return json(res, { error: 'Invalid body' }, 400);
    }
    config.setMany(body);
    return json(res, { ok: true, saved: Object.keys(body).length });
  }

  // GET /api/keys-status — API key validation
  if (req.method === 'GET' && route === '/api/keys-status') {
    return json(res, env.checkKeys());
  }

  // POST /api/onboarding/complete — mark onboarding done
  if (req.method === 'POST' && route === '/api/onboarding/complete') {
    config.set('onboarding_complete', true);
    config.set('onboarding_completed_at', new Date().toISOString());
    return json(res, { ok: true, onboarded: true });
  }

  // GET /health — health check
  if (req.method === 'GET' && route === '/health') {
    return json(res, { status: 'ok', onboarded: config.isOnboarded() });
  }

  // 404
  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('Not found');
}

function start(port) {
  port = port || config.get('onboarding_port') || 3456;
  const server = http.createServer(handleRequest);
  server.listen(port, '0.0.0.0', () => {
    console.log(`DhandhaPhone Setup: http://localhost:${port}`);
  });
  return server;
}

module.exports = { start };

// Run directly: node lib/onboarding/server.js
if (require.main === module) {
  start();
}
