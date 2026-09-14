'use strict';
// Fake Hermes WebUI API for local development. Password: valley
//   node dev/mock-upstream.js
//   HERMES_UPSTREAM=http://127.0.0.1:8799 DATA_DIR=dev/data node server.js
const http = require('node:http');
const crypto = require('node:crypto');

const PORT = Number(process.env.MOCK_PORT || 8799);
const PASSWORD = 'valley';
const TOKEN = 'hermes_session=mock-ok';
const iso = (msAgo = 0) => new Date(Date.now() - msAgo).toISOString();

const jobs = [
  { id: 'a1b2c3', name: 'Morning Digest', prompt: 'Summarize overnight email and news into a short briefing.', skills: ['web-research', 'email-triage'], schedule_display: 'every day at 08:00', enabled: true, state: 'scheduled', last_run_at: iso(3.6e6), last_status: 'ok', next_run_at: iso(-7.2e6), created_at: iso(9e8), repeat: { times: null, completed: 12 } },
  { id: 'd4e5f6', name: 'Server Watch', prompt: 'Check the VPS disk, memory and container health.', skills: ['docker-health'], schedule_display: 'every 30m', enabled: true, state: 'scheduled', last_run_at: iso(6e5), last_status: 'ok', next_run_at: iso(-1.2e6), created_at: iso(8e8), repeat: { times: null, completed: 40 } },
  { id: 'g7h8i9', name: 'Repo Janitor', prompt: 'Look for stale branches and open a cleanup issue.', skills: [], schedule_display: 'every Monday', enabled: false, state: 'paused', last_run_at: iso(5e8), last_status: 'ok', next_run_at: null, created_at: iso(7e8), repeat: { times: null, completed: 3 } },
  { id: 'j1k2l3', name: 'Price Tracker', prompt: 'Check prices on the watchlist.', skills: ['web-research'], schedule_display: 'every 6h', enabled: true, state: 'scheduled', last_run_at: iso(2e6), last_status: 'error', last_error: 'Timeout fetching https://example.com/prices', failure_streak: 1, next_run_at: iso(-4e6), created_at: iso(6e8), repeat: { times: null, completed: 8 } },
  { id: 'm4n5o6', name: 'Weekly Recap', prompt: 'Write the weekly recap.', skills: ['writing'], schedule_display: 'every Friday 17:00', enabled: true, state: 'scheduled', last_run_at: iso(4e8), last_status: 'ok', next_run_at: iso(-3e8), created_at: iso(5e8), repeat: { times: null, completed: 2 } },
];
const running = {};
const skillUsage = {
  'web-research': { use_count: 30, view_count: 4, patch_count: 2, last_patched_at: iso(9e7) },
  'email-triage': { use_count: 12, view_count: 1, patch_count: 0 },
  'docker-health': { use_count: 40, view_count: 2, patch_count: 1 },
  writing: { use_count: 2, view_count: 0, patch_count: 0 },
};

function finishRun(j) {
  j.last_run_at = iso();
  j.last_status = 'ok';
  j.failure_streak = 0;
  j.repeat.completed += 1;
}

// Flip Server Watch between working and idle so walking and sitting can be watched.
setInterval(() => {
  const j = jobs[1];
  if (j.fire_claim) { j.fire_claim = null; finishRun(j); }
  else j.fire_claim = { at: iso(), by: 'mock' };
}, 20000);

// Hermes improves a skill now and then, which should hand out XP.
let tick = 0;
setInterval(() => {
  tick += 1;
  const names = ['web-research', 'docker-health', 'writing', 'email-triage'];
  const name = names[tick % names.length];
  skillUsage[name].patch_count += 1;
  skillUsage[name].last_patched_at = iso();
  if (tick === 3) skillUsage['calendar-planning'] = { use_count: 0, view_count: 0, patch_count: 0, created_at: iso() };
}, 25000);

const sessions = new Map();
const streams = new Map();
const approvals = new Map();

function newSession() {
  const s = { session_id: crypto.randomBytes(6).toString('hex'), title: 'New chat', messages: [], created_at: Date.now() / 1000, updated_at: Date.now() / 1000 };
  sessions.set(s.session_id, s);
  return s;
}
const seed = newSession();
seed.title = 'Disk space check';
seed.messages.push({ role: 'user', content: 'How much disk is left on the VPS?' }, { role: 'assistant', content: 'About **62 GB free** of 100 GB. Docker images take most of the rest.' });

function json(res, status, obj, extra = {}) {
  const body = JSON.stringify(obj);
  res.writeHead(status, { 'Content-Type': 'application/json', ...extra });
  res.end(body);
}
function readBody(req) {
  return new Promise((resolve) => {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => { try { resolve(JSON.parse(raw || '{}')); } catch { resolve({}); } });
  });
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const REPLY = `Here's what I found:

- **Disk**: 62 GB free
- **Memory**: 3.1 / 8 GB used
- Containers: \`hermes-agent\`, \`hermes-webui\` both healthy

\`\`\`bash
docker system df
\`\`\`

| Container | Status |
|---|---|
| hermes-agent | healthy |
| hermes-webui | healthy |

Anything else you'd like me to check?`;

async function runStream(res, stream) {
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' });
  const put = (event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  await sleep(600);
  put('reasoning', { text: 'thinking' });
  await sleep(900);
  if (/\brm\b/.test(stream.message)) {
    const id = crypto.randomBytes(4).toString('hex');
    put('approval', { approval_id: id, command: 'rm -rf /tmp/demo-cache', description: 'recursive delete' });
    await new Promise((resolve) => approvals.set(id, resolve));
  }
  put('tool', { event_type: 'tool.started', name: 'terminal', preview: 'df -h && free -m', args: {} });
  await sleep(1800);
  put('tool_complete', { name: 'terminal' });
  for (const word of REPLY.split(/(?<=\s)/)) {
    if (res.destroyed) return;
    put('token', { text: word });
    await sleep(45);
  }
  const s = sessions.get(stream.session_id);
  s.messages.push({ role: 'assistant', content: REPLY, tool_calls: [{ function: { name: 'terminal' } }] });
  s.updated_at = Date.now() / 1000;
  put('done', { session: { session_id: s.session_id } });
  put('stream_end', { session_id: s.session_id });
  res.end();
}

http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const p = url.pathname;
  const authed = String(req.headers.cookie || '').includes(TOKEN);

  if (p === '/health') return json(res, 200, { status: 'ok' });
  if (p === '/api/auth/status') return json(res, 200, { auth_enabled: true, logged_in: authed });
  if (p === '/api/auth/login') {
    const body = await readBody(req);
    if (body.password !== PASSWORD) return json(res, 401, { error: 'Invalid password' });
    return json(res, 200, { ok: true }, { 'Set-Cookie': `${TOKEN}; HttpOnly; Path=/; SameSite=Lax` });
  }
  if (!authed) return json(res, 401, { error: 'Authentication required' });
  if (p === '/api/auth/logout') return json(res, 200, { ok: true }, { 'Set-Cookie': 'hermes_session=; Max-Age=0; Path=/' });

  if (p === '/api/skills/usage') return json(res, 200, { usage: skillUsage, skill_names: Object.keys(skillUsage) });
  if (p === '/api/crons') return json(res, 200, { jobs, active_profile: 'default' });
  if (p === '/api/crons/status') {
    const out = {};
    for (const [id, t] of Object.entries(running)) out[id] = (Date.now() - t) / 1000;
    return json(res, 200, { running: out });
  }
  if (p === '/api/crons/output') {
    const job = jobs.find((j) => j.id === url.searchParams.get('job_id'));
    return json(res, 200, { job_id: job && job.id, outputs: job ? [{ filename: 'latest.md', content: `# ${job.name}\n\nAll good today. Nothing needs your attention.\n\n- checked 3 sources\n- no changes` }] : [] });
  }
  if (p === '/api/crons/run' || p === '/api/crons/pause' || p === '/api/crons/resume') {
    const body = await readBody(req);
    const job = jobs.find((j) => j.id === body.job_id);
    if (!job) return json(res, 404, { error: 'Job not found' });
    if (p.endsWith('/run')) {
      running[job.id] = Date.now();
      setTimeout(() => { delete running[job.id]; finishRun(job); }, 12000);
      return json(res, 200, { ok: true, job_id: job.id, status: 'running' });
    }
    job.enabled = p.endsWith('/resume');
    job.state = job.enabled ? 'scheduled' : 'paused';
    return json(res, 200, { ok: true, job });
  }

  if (p === '/api/sessions') {
    const list = [...sessions.values()].sort((a, b) => b.updated_at - a.updated_at).map(({ messages, ...rest }) => ({ ...rest, message_count: messages.length }));
    return json(res, 200, { sessions: list });
  }
  if (p === '/api/session/new') return json(res, 200, { session: newSession() });
  if (p === '/api/session') {
    const s = sessions.get(url.searchParams.get('session_id'));
    return s ? json(res, 200, { session: s }) : json(res, 404, { error: 'Session not found' });
  }
  if (p === '/api/chat/start') {
    const body = await readBody(req);
    const s = sessions.get(body.session_id);
    if (!s) return json(res, 404, { error: 'Session not found' });
    s.messages.push({ role: 'user', content: body.message });
    if (s.title === 'New chat') s.title = String(body.message).slice(0, 40);
    const streamId = crypto.randomBytes(6).toString('hex');
    streams.set(streamId, { session_id: s.session_id, message: String(body.message) });
    return json(res, 200, { stream_id: streamId, session_id: s.session_id });
  }
  if (p === '/api/chat/stream') {
    const stream = streams.get(url.searchParams.get('stream_id'));
    if (!stream) return json(res, 404, { error: 'stream not found' });
    streams.delete(url.searchParams.get('stream_id'));
    return runStream(res, stream);
  }
  if (p === '/api/chat/cancel') return json(res, 200, { ok: true, cancelled: true });
  if (p === '/api/approval/respond') {
    const body = await readBody(req);
    const resolve = approvals.get(body.approval_id);
    if (resolve) { approvals.delete(body.approval_id); resolve(); }
    return json(res, 200, { ok: true });
  }
  json(res, 404, { error: 'not found' });
}).listen(PORT, () => console.log(`mock Hermes WebUI on :${PORT} (password: ${PASSWORD})`));
