'use strict';
// Marigold Valley: serves the pixel UI, keeps each agent's nickname, look and XP, and
// forwards a small set of API calls to Hermes WebUI.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const PORT = Number(process.env.PORT || 8080);
const UPSTREAM = new URL(process.env.HERMES_UPSTREAM || 'http://hermes-webui:8787');
const PUBLIC_DIR = path.join(__dirname, 'public');
const DATA_DIR = process.env.DATA_DIR || '/data';
const STORE_FILE = path.join(DATA_DIR, 'valley.json');

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

// Answers 403 and returns true when a request must not go any further.
function rejectCrossOrigin(req, res) {
  const crossSite = String(req.headers['sec-fetch-site'] || '').toLowerCase() === 'cross-site';
  const unsafe = req.method !== 'GET' && req.method !== 'HEAD';
  if (crossSite || (unsafe && (!isSameOrigin(req) || req.headers['x-valley'] !== '1'))) {
    sendJson(res, 403, { error: 'Cross-origin request rejected' });
    return true;
  }
  return false;
}

function hardenCookie(cookie, secure) {
  const parts = cookie.split(';').map((p) => p.trim()).filter((p) => !/^(samesite|secure)(=|$)/i.test(p));
  parts.push('SameSite=Strict');
  if (secure) parts.push('Secure');
  return parts.join('; ');
}

function proxy(req, res, url) {
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

/* ---------- valley state: nicknames, looks and XP ---------- */

// Stardew's skill curve: total XP needed to reach levels 1..10.
const LEVELS = [0, 100, 380, 770, 1300, 2150, 3300, 4800, 6900, 10000, 15000];
const XP_SKILL = 50; // a skill the agent uses was created or improved
const XP_RUN_OK = 5; // a scheduled run finished
const XP_RUN_ERROR = 1;
const STYLES = new Set(['short', 'long', 'bob', 'spiky', 'bun', 'straw', 'cap', 'wizard', 'crown', 'helm', 'bald']);
const LOOK_CHOICES = {
  style: STYLES,
  body: new Set(['masc', 'fem']),
  top: new Set(['tee', 'stripes', 'hoodie', 'vest', 'tie', 'overalls']),
  bottom: new Set(['pants', 'shorts', 'skirt']),
};
const DECOR = {
  wall: new Set(['cream', 'mint', 'rose', 'sky', 'brick', 'cabin', 'night']),
  floor: new Set(['oak', 'walnut', 'birch', 'tiles']),
  wood: new Set(['oak', 'walnut', 'birch', 'white', 'mint']),
  couch: new Set(['red', 'green', 'blue', 'purple', 'mustard']),
  rug: new Set(['red', 'blue', 'green', 'purple']),
};
const AGENT_ID = /^(hermes|dog|job:[A-Za-z0-9_][A-Za-z0-9_.-]{0,63})$/;
const FAILED = new Set(['error', 'failed', 'failure']);

function levelOf(xp) {
  let level = 0;
  while (level < LEVELS.length - 1 && xp >= LEVELS[level + 1]) level++;
  return level;
}

function loadStore() {
  const empty = { version: 1, initialized: false, agents: {}, skills: {}, decor: {} };
  try {
    const saved = JSON.parse(fs.readFileSync(STORE_FILE, 'utf8'));
    if (saved && typeof saved === 'object') return { ...empty, ...saved };
  } catch (err) {
    if (err.code !== 'ENOENT') console.error(`could not read ${STORE_FILE}: ${err.message}`);
  }
  return empty;
}

let store = loadStore();

function saveStore() {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    const tmp = STORE_FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(store, null, 1));
    fs.renameSync(tmp, STORE_FILE);
  } catch (err) {
    console.error(`could not save ${STORE_FILE}: ${err.message}`);
  }
}

const recOf = (id) => store.agents[id] || (store.agents[id] = { xp: 0 });

function award(events, id, amount, reason) {
  if (amount <= 0) return;
  const r = recOf(id);
  const before = levelOf(r.xp || 0);
  r.xp = (r.xp || 0) + amount;
  const after = levelOf(r.xp);
  events.push({ id, amount, reason, level: after, levelUp: after > before });
}

// Compares what Hermes reports now with what we saw last time and hands out XP for
// the difference. The first sync only records a baseline, so old history earns nothing.
function applyProgress(jobs, usage) {
  const events = [];
  const first = !store.initialized;
  let dirty = first;

  const improved = [];
  if (usage) {
    for (const [name, u] of Object.entries(usage)) {
      const count = Number(u && u.patch_count) || 0;
      const seen = store.skills[name];
      if (seen === undefined) {
        if (!first) improved.push({ name, times: 1, verb: 'learned' });
      } else if (count > seen) {
        improved.push({ name, times: count - seen, verb: 'improved' });
      }
      if (seen !== count) { store.skills[name] = count; dirty = true; }
    }
  }
  for (const s of improved) {
    award(events, 'hermes', XP_SKILL * s.times, `${s.verb} ${s.name}`);
    for (const j of jobs) {
      if (Array.isArray(j.skills) && j.skills.includes(s.name)) {
        award(events, 'job:' + j.id, XP_SKILL * s.times, `${s.name} got better`);
      }
    }
  }

  for (const j of jobs) {
    if (!j || !j.id) continue;
    const r = recOf('job:' + j.id);
    const completed = j.repeat && Number.isFinite(Number(j.repeat.completed)) ? Number(j.repeat.completed) : null;
    const lastRun = j.last_run_at || null;
    let runs = 0;
    if (r.seen) {
      if (completed != null && r.completed != null) runs = Math.max(0, completed - r.completed);
      else if (lastRun && lastRun !== r.lastRunAt) runs = 1;
    }
    if (!r.seen || r.completed !== completed || r.lastRunAt !== lastRun) {
      r.seen = true;
      r.completed = completed;
      r.lastRunAt = lastRun;
      dirty = true;
    }
    if (runs) {
      const failed = FAILED.has(String(j.last_status || '').toLowerCase());
      award(events, 'job:' + j.id, runs * (failed ? XP_RUN_ERROR : XP_RUN_OK), failed ? 'had a rough run' : 'finished a run');
    }
  }

  store.initialized = true;
  if (dirty || events.length) saveStore();
  return events;
}

function publicAgents() {
  const out = {};
  for (const [id, r] of Object.entries(store.agents)) {
    const xp = r.xp || 0;
    const level = levelOf(xp);
    out[id] = { nickname: r.nickname || null, look: r.look || null, xp, level, floor: LEVELS[level], next: LEVELS[level + 1] ?? null };
  }
  return out;
}

function cleanLook(look) {
  if (!look || typeof look !== 'object') return null;
  const out = {};
  for (const k of ['skin', 'hair', 'shirt', 'pants']) {
    if (/^#[0-9a-fA-F]{6}$/.test(look[k] || '')) out[k] = look[k].toLowerCase();
  }
  for (const [k, allowed] of Object.entries(LOOK_CHOICES)) {
    if (allowed.has(look[k])) out[k] = look[k];
  }
  if (typeof look.glasses === 'boolean') out.glasses = look.glasses;
  return Object.keys(out).length ? out : null;
}

async function upstreamJson(pathname, cookie) {
  const res = await fetch(new URL(pathname, UPSTREAM), {
    headers: { cookie: cookie || '', accept: 'application/json' },
    signal: AbortSignal.timeout(10000),
  });
  let data = null;
  try { data = await res.json(); } catch { data = null; }
  return { status: res.status, data };
}

function readJson(req, limit = 16384) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let tooBig = false;
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) tooBig = true; // keep draining so the 413 can still be sent
      else chunks.push(c);
    });
    req.on('end', () => {
      if (tooBig) return reject(Object.assign(new Error('body too large'), { status: 413 }));
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')); } catch { resolve(null); }
    });
    req.on('error', reject);
  });
}

async function valleyState(req, res) {
  const cookie = req.headers.cookie;
  const [crons, status, usage] = await Promise.all([
    upstreamJson('/api/crons', cookie),
    upstreamJson('/api/crons/status', cookie).catch(() => null),
    upstreamJson('/api/skills/usage', cookie).catch(() => null),
  ]);
  if (crons.status === 401) return sendJson(res, 401, { error: 'Authentication required' });
  if (crons.status !== 200) return sendJson(res, 502, { error: (crons.data && crons.data.error) || `Hermes returned ${crons.status}` });
  const jobs = Array.isArray(crons.data && crons.data.jobs) ? crons.data.jobs : [];
  const usageMap = usage && usage.status === 200 && usage.data && typeof usage.data.usage === 'object' ? usage.data.usage : null;
  const events = applyProgress(jobs, usageMap);
  sendJson(res, 200, {
    jobs,
    running: (status && status.status === 200 && status.data && status.data.running) || {},
    agents: publicAgents(),
    decor: store.decor || {},
    events,
  });
}

// Answers the request and returns false unless the caller is logged in to Hermes.
async function requireLogin(req, res) {
  const auth = await upstreamJson('/api/auth/status', req.headers.cookie);
  if (auth.status !== 200 || !auth.data) { sendJson(res, 502, { error: 'Hermes is not answering right now' }); return false; }
  if (auth.data.auth_enabled && !auth.data.logged_in) { sendJson(res, 401, { error: 'Authentication required' }); return false; }
  return true;
}

async function valleySaveDecor(req, res) {
  if (!(await requireLogin(req, res))) return;
  const body = await readJson(req);
  if (!body || typeof body !== 'object') return sendJson(res, 400, { error: 'bad decor' });
  const decor = {};
  for (const [k, allowed] of Object.entries(DECOR)) {
    if (allowed.has(body[k])) decor[k] = body[k];
  }
  store.decor = decor;
  saveStore();
  sendJson(res, 200, { ok: true, decor });
}

async function valleySaveAgent(req, res) {
  if (!(await requireLogin(req, res))) return;
  const body = await readJson(req);
  if (!body || typeof body.id !== 'string' || !AGENT_ID.test(body.id)) return sendJson(res, 400, { error: 'unknown agent' });
  const r = recOf(body.id);
  if ('nickname' in body) {
    const nick = String(body.nickname || '').replace(/[ -]/g, '').trim().slice(0, 24);
    if (nick) r.nickname = nick;
    else delete r.nickname;
  }
  if ('look' in body) {
    const look = cleanLook(body.look);
    if (look) r.look = look;
    else delete r.look;
  }
  saveStore();
  sendJson(res, 200, { ok: true, agents: publicAgents() });
}

function run(handler, req, res) {
  handler(req, res).catch((err) => {
    console.error(`${req.method} ${req.url}: ${err.message}`);
    if (!res.headersSent) sendJson(res, err.status || 502, { error: err.status ? err.message : 'Hermes is not answering right now' });
  });
}

/* ---------- static files ---------- */

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
    if (rejectCrossOrigin(req, res)) return;
    if (url.pathname === '/api/valley/state' && req.method === 'GET') return run(valleyState, req, res);
    if (url.pathname === '/api/valley/agent' && req.method === 'POST') return run(valleySaveAgent, req, res);
    if (url.pathname === '/api/valley/decor' && req.method === 'POST') return run(valleySaveDecor, req, res);
    if (!API_ALLOW.has(url.pathname)) return sendJson(res, 404, { error: 'not found' });
    return proxy(req, res, url);
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') return sendJson(res, 405, { error: 'method not allowed' });
  serveStatic(req, res, url);
});

server.listen(PORT, () => console.log(`marigold-valley listening on :${PORT}, upstream ${UPSTREAM.origin}, data ${STORE_FILE}`));

for (const sig of ['SIGTERM', 'SIGINT']) {
  process.on(sig, () => {
    server.close();
    setTimeout(() => process.exit(0), 1500).unref();
  });
}
