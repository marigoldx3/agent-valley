'use strict';
// Hermes Valley: serves the pixel UI and forwards a small set of API calls to Hermes WebUI.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const PORT = Number(process.env.PORT || 8080);
const UPSTREAM = new URL(process.env.HERMES_UPSTREAM || 'http://hermes-webui:8787');
const PUBLIC_DIR = path.join(__dirname, 'public');

// Only these upstream endpoints are reachable through this domain; the rest of the
// WebUI API (files, terminal, settings, ...) stays unreachable from here.
const API_ALLOW = new Set([
  '/api/auth/status', '/api/auth/login', '/api/auth/logout',
  '/api/session', '/api/session/new', '/api/sessions',
  '/api/chat/start', '/api/chat/stream', '/api/chat/cancel',
  '/api/crons', '/api/crons/status', '/api/crons/output',
  '/api/crons/run', '/api/crons/pause', '/api/crons/resume',
  '/api/approval/respond', '/api/approval/pending',
]);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

const HOP_BY_HOP = new Set([
  'connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization',
  'te', 'trailer', 'transfer-encoding', 'upgrade',
]);

const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' https://fonts.googleapis.com",
  'font-src https://fonts.gstatic.com',
  "img-src 'self' data:",
  "connect-src 'self'",
  "manifest-src 'self'",
  "base-uri 'none'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ');

function sendJson(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

// The WebUI skips its own CSRF token check for requests that carry no Origin/Referer
// (it treats them as scripts). This proxy strips those headers, so it must enforce
// same-origin itself before forwarding anything that changes state.
function isSameOrigin(req) {
  const src = req.headers.origin || req.headers.referer;
  if (!src) return false;
  try {
    return new URL(src).host.toLowerCase() === String(req.headers.host || '').toLowerCase();
  } catch {
    return false;
  }
}

function hardenCookie(cookie, secure) {
  const parts = cookie.split(';').map((p) => p.trim()).filter((p) => !/^(samesite|secure)(=|$)/i.test(p));
  parts.push('SameSite=Strict');
  if (secure) parts.push('Secure');
  return parts.join('; ');
}

function proxy(req, res, url) {
  const crossSite = String(req.headers['sec-fetch-site'] || '').toLowerCase() === 'cross-site';
  const unsafe = req.method !== 'GET' && req.method !== 'HEAD';
  if (crossSite || (unsafe && (!isSameOrigin(req) || req.headers['x-valley'] !== '1'))) {
    return sendJson(res, 403, { error: 'Cross-origin request rejected' });
  }

  const headers = { host: UPSTREAM.host };
  for (const k of ['cookie', 'content-type', 'content-length', 'accept', 'last-event-id']) {
    if (req.headers[k]) headers[k] = req.headers[k];
  }
  const secure = req.headers['x-forwarded-proto'] === 'https';

  const upReq = http.request({
    hostname: UPSTREAM.hostname,
    port: UPSTREAM.port || 80,
    method: req.method,
    path: url.pathname + url.search,
    headers,
  }, (upRes) => {
    const out = {};
    for (const [k, v] of Object.entries(upRes.headers)) {
      if (HOP_BY_HOP.has(k)) continue;
      out[k] = k === 'set-cookie' ? v.map((c) => hardenCookie(c, secure)) : v;
    }
    if (String(upRes.headers['content-type'] || '').startsWith('text/event-stream')) {
      out['cache-control'] = 'no-cache';
      out['x-accel-buffering'] = 'no';
      req.socket.setNoDelay(true);
    }
    res.writeHead(upRes.statusCode || 502, out);
    upRes.pipe(res);
  });

  upReq.on('error', (err) => {
    console.error(`upstream ${req.method} ${url.pathname}: ${err.code || err.message}`);
    if (!res.headersSent) sendJson(res, 502, { error: 'Hermes is not answering right now' });
    else res.destroy();
  });
  // Closing the browser tab must also close a long-lived SSE request upstream.
  res.on('close', () => upReq.destroy());
  req.pipe(upReq);
}

function serveStatic(req, res, url) {
  let rel;
  try {
    rel = decodeURIComponent(url.pathname);
  } catch {
    return sendJson(res, 400, { error: 'bad path' });
  }
  if (rel.endsWith('/')) rel += 'index.html';
  const file = path.join(PUBLIC_DIR, path.normalize(rel));
  if (!file.startsWith(PUBLIC_DIR + path.sep)) return sendJson(res, 400, { error: 'bad path' });

  fs.stat(file, (err, stat) => {
    if (err || !stat.isFile()) {
      if (path.extname(rel)) return sendJson(res, 404, { error: 'not found' });
      return serveStatic(req, res, new URL('/', 'http://x'));
    }
    const mtime = stat.mtime.toUTCString();
    res.setHeader('Content-Security-Policy', CSP);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'same-origin');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    if (req.headers['if-modified-since'] === mtime) {
      res.writeHead(304);
      return res.end();
    }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(file)] || 'application/octet-stream',
      'Content-Length': stat.size,
      'Last-Modified': mtime,
      'Cache-Control': 'no-cache',
    });
    if (req.method === 'HEAD') return res.end();
    fs.createReadStream(file).pipe(res);
  });
}

const server = http.createServer((req, res) => {
  let url;
  try {
    url = new URL(req.url, 'http://x');
  } catch {
    return sendJson(res, 400, { error: 'bad url' });
  }
  if (url.pathname === '/healthz') return sendJson(res, 200, { ok: true });
  if (url.pathname.startsWith('/api/')) {
    if (!API_ALLOW.has(url.pathname)) return sendJson(res, 404, { error: 'not found' });
    return proxy(req, res, url);
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') return sendJson(res, 405, { error: 'method not allowed' });
  serveStatic(req, res, url);
});

server.listen(PORT, () => console.log(`hermes-valley listening on :${PORT}, upstream ${UPSTREAM.origin}`));

for (const sig of ['SIGTERM', 'SIGINT']) {
  process.on(sig, () => {
    server.close();
    setTimeout(() => process.exit(0), 1500).unref();
  });
}
