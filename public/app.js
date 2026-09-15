/* Marigold Valley app: login, chat with Hermes, and the live office of scheduled agents. */
(function () {
  'use strict';

  const $ = (s) => document.querySelector(s);
  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  const SESSION_KEY = 'hv-session';
  const CHAT_MIN_KEY = 'hv-chat-min';
  const CLAIM_MAX_MS = 20 * 60 * 1000;

  const state = {
    sessionId: null,
    messages: [],
    streaming: null,
    jobs: [],
    running: {},
    valley: {},
    lastRuns: new Map(),
    firstPoll: true,
    pollTimer: 0,
    appStarted: false,
    stopTitle: null,
    cardId: null,
    cardMode: 'info',
    draft: null,
    chatMin: false,
    unread: 0,
    decor: {},
    decorDraft: null,
  };

  /* ---------- API ---------- */

  class HttpError extends Error {
    constructor(status, message) { super(message); this.status = status; }
  }

  async function api(path, { method = 'GET', body } = {}) {
    const opts = { method, credentials: 'same-origin', headers: { Accept: 'application/json' } };
    if (method !== 'GET') {
      opts.headers['Content-Type'] = 'application/json';
      opts.headers['X-Valley'] = '1';
      opts.body = JSON.stringify(body || {});
    }
    let res;
    try {
      res = await fetch(path, opts);
    } catch {
      throw new HttpError(0, 'No connection to the valley');
    }
    let data = null;
    try { data = await res.json(); } catch { data = null; }
    if (res.status === 401 && !path.startsWith('/api/auth/')) showLogin();
    if (!res.ok) throw new HttpError(res.status, (data && (data.error || data.message)) || `HTTP ${res.status}`);
    return data || {};
  }

  /* ---------- boot & login ---------- */

  async function boot() {
    fitViewport();
    let status = null;
    try { status = await api('/api/auth/status'); } catch { status = null; }
    $('#boot').hidden = true;
    if (status && status.auth_enabled && !status.logged_in) showLogin();
    else showApp();
  }

  function showLogin() {
    if (!$('#login').hidden) return;
    $('#app').hidden = true;
    $('#login').hidden = false;
    closeOverlays();
    clearTimeout(state.pollTimer);
    if (state.streaming && state.streaming.es) state.streaming.es.close();
    if (!state.stopTitle) state.stopTitle = Office.title($('#title-canvas'));
    setTimeout(() => $('#password').focus(), 50);
  }

  $('#login-form').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const btn = $('#login-btn');
    const err = $('#login-error');
    btn.disabled = true;
    err.textContent = '';
    try {
      await api('/api/auth/login', { method: 'POST', body: { password: $('#password').value } });
      $('#password').value = '';
      showApp();
    } catch (e) {
      err.textContent = e.status === 401 ? "That password didn't open the gate." : e.message;
      const box = $('.login-box');
      box.classList.remove('shake');
      void box.offsetWidth;
      box.classList.add('shake');
    } finally {
      btn.disabled = false;
    }
  });

  function showApp() {
    $('#login').hidden = true;
    if (state.stopTitle) { state.stopTitle(); state.stopTitle = null; }
    $('#app').hidden = false;
    if (!state.appStarted) {
      state.appStarted = true;
      Office.init({ canvas: $('#office'), stage: $('#office-stage'), wrap: $('#office-wrap'), tags: $('#office-tags'), onTap: openCard });
      tickClock();
      setInterval(tickClock, 15000);
      let min = false;
      try { min = localStorage.getItem(CHAT_MIN_KEY) === '1'; } catch { min = false; }
      setChatMin(min);
    }
    state.firstPoll = true;
    syncAgents();
    pollAgents();
    loadSession();
  }

  /* ---------- agents ---------- */

  function liveClaim(c) {
    if (!c || typeof c !== 'object') return false;
    const at = Date.parse(c.at || c.claimed_at || '');
    return !Number.isNaN(at) && Date.now() - at < CLAIM_MAX_MS;
  }
  const isWorking = (j) => j.id in state.running || liveClaim(j.fire_claim) || liveClaim(j.run_claim) || j.state === 'running';
  const isPaused = (j) => j.enabled === false || j.state === 'paused';
  const hasError = (j) => ['error', 'failed', 'failure'].includes(String(j.last_status || '').toLowerCase()) || (j.failure_streak || 0) > 0;
  const jobFor = (id) => state.jobs.find((j) => 'job:' + j.id === id);

  function defaultName(id) {
    if (id === 'hermes') return 'Hermes';
    if (id === 'dog') return 'Pepper';
    if (id === 'ferret') return 'Noodle';
    const j = jobFor(id);
    return (j && j.name) || 'Task';
  }
  function displayName(id) {
    const v = state.valley[id];
    return (v && v.nickname) || defaultName(id);
  }
  const lookOf = (id) => (state.valley[id] && state.valley[id].look) || null;
  const levelOf = (id) => (state.valley[id] && state.valley[id].level) || 0;
  const isPet = (id) => id === 'dog' || id === 'ferret';

  // One poll loop only: callers (visibility, actions) may ask for an early poll while one is in flight.
  let polling = false;
  async function pollAgents() {
    if (polling) return;
    polling = true;
    clearTimeout(state.pollTimer);
    let loggedOut = false;
    try {
      const data = await api('/api/valley/state');
      state.jobs = Array.isArray(data.jobs) ? data.jobs : [];
      state.running = data.running || {};
      state.valley = data.agents || {};
      const decor = data.decor || {};
      if (!state.decorDraft && JSON.stringify(decor) !== JSON.stringify(state.decor)) {
        state.decor = decor;
        Office.setDecor(decor);
      }
      syncAgents();
      showProgress(data.events || []);
      setOffline(false);
    } catch (e) {
      if (e.status === 401) loggedOut = true;
      else setOffline(true, e.message);
    } finally {
      polling = false;
    }
    if (loggedOut) return;
    const busy = state.streaming || Object.keys(state.running).length || state.jobs.some(isWorking);
    clearTimeout(state.pollTimer);
    state.pollTimer = setTimeout(pollAgents, document.hidden ? 30000 : busy ? 4000 : 10000);
  }

  function syncAgents() {
    const jobs = [...state.jobs].sort((a, b) => String(a.created_at || '').localeCompare(String(b.created_at || '')));
    const list = [{
      id: 'hermes', name: displayName('hermes'), look: lookOf('hermes'), level: levelOf('hermes'),
      working: !!state.streaming, status: state.streaming ? state.streaming.status : '',
    }];
    for (const j of jobs) {
      const id = 'job:' + j.id;
      list.push({ id, name: displayName(id), look: lookOf(id), level: levelOf(id), working: isWorking(j), paused: isPaused(j), error: hasError(j) });
      const prev = state.lastRuns.get(j.id);
      if (!state.firstPoll && j.last_run_at && prev !== undefined && prev !== j.last_run_at) {
        Office.pulse(id, 'done');
        toast(`${displayName(id)} ${hasError(j) ? 'ran into trouble' : 'finished its work'}`, hasError(j) ? 'bad' : 'good');
      }
      state.lastRuns.set(j.id, j.last_run_at || null);
    }
    if (state.jobs.length || !state.firstPoll) state.firstPoll = false;
    Office.setAgents(list);
    const busy = list.filter((a) => a.working).length;
    $('#clock-gold').textContent = `${busy} busy · ${list.length} crew`;
    $('#chat-name').textContent = displayName('hermes');
    Office.drawPortrait($('#chat-portrait'), 'hermes', lookOf('hermes'));
    Office.drawPortrait($('#fab-portrait'), 'hermes', lookOf('hermes'));
    if (state.cardId) renderCard(false);
  }

  // XP handed out by the server since the last poll: float "+XP" and celebrate level-ups.
  function showProgress(events) {
    const byId = new Map();
    for (const e of events) {
      const cur = byId.get(e.id) || { amount: 0, reasons: [], level: 0, levelUp: false };
      cur.amount += e.amount;
      cur.reasons.push(e.reason);
      cur.level = e.level;
      cur.levelUp = cur.levelUp || e.levelUp;
      byId.set(e.id, cur);
    }
    for (const [id, e] of byId) {
      Office.floatText(id, `+${e.amount} XP`);
      if (e.levelUp) {
        Office.levelUp(id);
        toast(`${displayName(id)} reached level ${e.level}!`, 'level');
      } else if (e.reasons.some((r) => /learned|improved|better/.test(r))) {
        toast(`${displayName(id)}: ${e.reasons[0]} (+${e.amount} XP)`, 'good');
      }
    }
  }

  let offlineShown = false;
  function setOffline(off, msg) {
    if (off && !offlineShown) toast(`Hermes isn't answering (${msg || 'offline'})`, 'bad');
    offlineShown = off;
  }

  /* ---------- clock ---------- */

  // California time, to match the wall clock in the office.
  function tickClock() {
    const pt = Office.pacificTime();
    const season = ['❄️', '❄️', '🌸', '🌸', '🌸', '🌻', '🌻', '🌻', '🍂', '🍂', '🍂', '❄️'][pt.month];
    let h = pt.hours;
    const ap = h < 12 ? 'am' : 'pm';
    h = h % 12 || 12;
    const m = String(Math.floor(pt.minutes / 10) * 10).padStart(2, '0');
    $('#clock-date').textContent = `${pt.weekday}. ${pt.day}`;
    $('#clock-icon').textContent = season;
    $('#clock-time').textContent = `${h}:${m} ${ap}`;
  }

  /* ---------- markdown (escape first, then a small safe subset) ---------- */

  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  function inline(raw) {
    const codes = [];
    let s = esc(raw).replace(/`([^`]+)`/g, (_, c) => { codes.push(c); return ` ${codes.length - 1} `; });
    s = s
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/(^|[^*\w])\*([^*\n]+)\*(?!\w)/g, '$1<em>$2</em>')
      .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>')
      .replace(/(^|[\s(])(https?:\/\/[^\s<)]+)/g, '$1<a href="$2" target="_blank" rel="noopener noreferrer">$2</a>');
    return s.replace(/ (\d+) /g, (_, i) => `<code>${codes[Number(i)]}</code>`);
  }

  function table(lines) {
    const cells = (l) => l.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
    const rows = lines.filter((l) => !/^\s*\|?\s*:?-{2,}/.test(l));
    if (!rows.length) return '';
    const [head, ...body] = rows;
    return '<div class="table-wrap"><table><thead><tr>' + cells(head).map((c) => `<th>${inline(c)}</th>`).join('') +
      '</tr></thead><tbody>' + body.map((r) => '<tr>' + cells(r).map((c) => `<td>${inline(c)}</td>`).join('') + '</tr>').join('') +
      '</tbody></table></div>';
  }

  function blocks(text) {
    let out = '';
    let list = null;
    let para = [];
    let tbl = [];
    const flush = () => {
      if (para.length) { out += `<p>${para.map(inline).join('<br>')}</p>`; para = []; }
      if (tbl.length) { out += table(tbl); tbl = []; }
    };
    const closeList = () => { if (list) { out += `</${list}>`; list = null; } };
    for (const lineText of text.split('\n')) {
      let m;
      if (!lineText.trim()) { flush(); closeList(); continue; }
      if (/^\s*\|/.test(lineText)) { if (para.length) { const p = para; para = []; out += `<p>${p.map(inline).join('<br>')}</p>`; } closeList(); tbl.push(lineText); continue; }
      if (tbl.length) flush();
      if ((m = lineText.match(/^(#{1,6})\s+(.*)$/))) { flush(); closeList(); out += `<h4>${inline(m[2])}</h4>`; continue; }
      if ((m = lineText.match(/^\s*[-*•]\s+(.*)$/))) { flush(); if (list !== 'ul') { closeList(); out += '<ul>'; list = 'ul'; } out += `<li>${inline(m[1])}</li>`; continue; }
      if ((m = lineText.match(/^\s*\d+[.)]\s+(.*)$/))) { flush(); if (list !== 'ol') { closeList(); out += '<ol>'; list = 'ol'; } out += `<li>${inline(m[1])}</li>`; continue; }
      if ((m = lineText.match(/^>\s?(.*)$/))) { flush(); closeList(); out += `<blockquote>${inline(m[1])}</blockquote>`; continue; }
      closeList();
      para.push(lineText);
    }
    flush();
    closeList();
    return out;
  }

  function renderMarkdown(src) {
    return String(src || '').split('```').map((part, i) => {
      if (i % 2 === 0) return blocks(part);
      const nl = part.indexOf('\n');
      const code = nl >= 0 && /^[\w+#.-]*$/.test(part.slice(0, nl).trim()) ? part.slice(nl + 1) : part;
      return `<pre><code>${esc(code.replace(/\n$/, ''))}</code></pre>`;
    }).join('');
  }

  /* ---------- chat ---------- */

  function textOf(content) {
    if (typeof content === 'string') return content;
    if (Array.isArray(content)) {
      return content.map((p) => (typeof p === 'string' ? p : (p && p.type !== 'image_url' && (p.text || p.content)) || '')).filter(Boolean).join('\n');
    }
    return '';
  }

  function normalize(messages) {
    const out = [];
    for (const m of messages || []) {
      if (!m || (m.role !== 'user' && m.role !== 'assistant')) continue;
      const text = textOf(m.content).trim();
      const tools = (m.tool_calls || []).map((tc) => (tc.function && tc.function.name) || tc.name).filter(Boolean)
        .map((name) => ({ name, preview: '', done: true }));
      if (!text && !tools.length) continue;
      out.push({ role: m.role, text, tools });
    }
    return out;
  }

  function setSession(id) {
    state.sessionId = id || null;
    try {
      if (id) localStorage.setItem(SESSION_KEY, id);
      else localStorage.removeItem(SESSION_KEY);
    } catch { /* storage unavailable */ }
  }

  async function loadSession() {
    if (!state.sessionId) {
      try { state.sessionId = localStorage.getItem(SESSION_KEY); } catch { state.sessionId = null; }
    }
    if (!state.sessionId) { state.messages = []; renderMessages(); return; }
    try {
      const data = await api(`/api/session?session_id=${encodeURIComponent(state.sessionId)}`);
      const s = data.session || data;
      state.messages = normalize(s.messages);
      renderMessages();
      if (s.active_stream_id && !state.streaming) resumeStream(s.active_stream_id);
    } catch (e) {
      if (e.status === 404 || e.status === 403) { setSession(null); state.messages = []; renderMessages(); }
      else if (e.status !== 401) toast(`Couldn't load the chat: ${e.message}`, 'bad');
    }
  }

  async function newSession() {
    const data = await api('/api/session/new', { method: 'POST', body: {} });
    const s = data.session || data;
    if (!s.session_id) throw new Error('Hermes did not open a new chat');
    setSession(s.session_id);
    state.messages = [];
  }

  function emptyLetter() {
    const letter = el('div', 'letter');
    letter.append(el('p', 'letter-hi', 'Dear friend,'));
    letter.append(el('p', null, "Welcome to Marigold Valley! I'm at my desk and ready to help. Ask me anything below."));
    letter.append(el('p', null, 'Tap anyone in the office to see what they are working on, or to give them a new look and a nickname.'));
    letter.append(el('p', 'letter-sign', `— ${displayName('hermes')}`));
    return letter;
  }

  function toolChip(t) {
    const chip = el('span', 'chip' + (t.done ? ' done' : ''));
    chip.append(el('span', 'chip-icon', t.done ? '✔' : '⚒'));
    chip.append(el('span', 'chip-name', t.name));
    if (t.preview) chip.append(el('span', 'chip-preview', String(t.preview).slice(0, 80)));
    t.chip = chip;
    return chip;
  }

  function messageEl(m) {
    const row = el('div', 'msg ' + (m.role === 'user' ? 'msg-user' : 'msg-bot'));
    if (m.role !== 'user') {
      const frame = el('span', 'portrait-frame-xs');
      const c = el('canvas', 'pix');
      Office.drawPortrait(c, 'hermes', lookOf('hermes'));
      frame.append(c);
      row.append(frame);
    }
    const bubble = el('div', 'bubble');
    m.toolsEl = el('div', 'tools');
    for (const t of m.tools || []) m.toolsEl.append(toolChip(t));
    if (!(m.tools || []).length) m.toolsEl.hidden = true;
    m.bodyEl = el('div', 'md');
    bubble.append(m.toolsEl, m.bodyEl);
    row.append(bubble);
    m.el = row;
    paintBody(m);
    return row;
  }

  function paintBody(m) {
    if (m.role === 'user') { m.bodyEl.textContent = m.text; return; }
    if (m.live && !m.text) { m.bodyEl.innerHTML = '<span class="typing"><i></i><i></i><i></i></span>'; return; }
    m.bodyEl.innerHTML = renderMarkdown(m.text) + (m.live ? '<span class="cursor"></span>' : '');
    if (m.error) m.bodyEl.append(el('p', 'msg-error', m.error));
  }

  function renderMessages() {
    const box = $('#messages');
    box.textContent = '';
    if (!state.messages.length) box.append(emptyLetter());
    for (const m of state.messages) box.append(messageEl(m));
    scrollDown(true);
  }

  function appendMessage(m) {
    const box = $('#messages');
    const letter = box.querySelector('.letter');
    if (letter) letter.remove();
    box.append(messageEl(m));
    scrollDown(true);
  }

  function scrollDown(force) {
    const box = $('#messages');
    const near = box.scrollHeight - box.scrollTop - box.clientHeight < 140;
    if (force || near) box.scrollTop = box.scrollHeight;
  }

  let paintQueued = false;
  function queuePaint(m) {
    if (paintQueued) return;
    paintQueued = true;
    requestAnimationFrame(() => { paintQueued = false; paintBody(m); scrollDown(false); });
  }

  function setStatus(text) {
    if (state.streaming) state.streaming.status = text;
    $('#chat-status').textContent = text || 'at the desk';
    syncAgents();
    updateFab();
  }

  function setComposerBusy(busy) {
    const btn = $('#send');
    btn.classList.toggle('btn-go', !busy);
    btn.classList.toggle('btn-stop', busy);
    btn.textContent = busy ? '■' : '➤';
    btn.setAttribute('aria-label', busy ? 'Stop' : 'Send');
  }

  async function send(text) {
    text = text.trim();
    if (!text || state.streaming) return;
    const bot = { role: 'assistant', text: '', tools: [], live: true };
    state.streaming = { status: 'reading…', bot, done: false };
    setComposerBusy(true);
    try {
      if (!state.sessionId) await newSession();
      const user = { role: 'user', text, tools: [] };
      state.messages.push(user, bot);
      appendMessage(user);
      appendMessage(bot);
      setStatus('reading…');
      const res = await api('/api/chat/start', { method: 'POST', body: { session_id: state.sessionId, message: text } });
      if (res.status === 'suppressed') { finishStream(); return; }
      if (!res.stream_id) throw new Error('Hermes did not start a reply');
      if (res.session_id && res.session_id !== state.sessionId) setSession(res.session_id);
      attachStream(res.stream_id);
    } catch (e) {
      const msg = e.status === 403 ? 'This chat is read-only here. Start a new one with 🌱.' : e.message;
      failStream(msg);
    }
  }

  function resumeStream(streamId) {
    const bot = { role: 'assistant', text: '', tools: [], live: true };
    state.messages.push(bot);
    appendMessage(bot);
    state.streaming = { status: 'working…', bot, done: false };
    setComposerBusy(true);
    setStatus('working…');
    attachStream(streamId);
  }

  function attachStream(streamId) {
    const s = state.streaming;
    if (!s) return;
    const bot = s.bot;
    const es = new EventSource('/api/chat/stream?stream_id=' + encodeURIComponent(streamId));
    s.es = es;
    s.streamId = streamId;
    s.errors = 0;
    const data = (e) => { try { return JSON.parse(e.data); } catch { return {}; } };

    es.addEventListener('token', (e) => {
      bot.text += data(e).text || '';
      s.errors = 0;
      if (s.status !== 'typing…') setStatus('typing…');
      queuePaint(bot);
    });
    es.addEventListener('reasoning', () => { if (s.status !== 'thinking…') setStatus('thinking…'); });
    es.addEventListener('tool', (e) => {
      const d = data(e);
      if (!d.name || d.name === 'clarify') return;
      const t = { name: d.name, preview: d.preview || '', done: false };
      bot.tools.push(t);
      bot.toolsEl.hidden = false;
      bot.toolsEl.append(toolChip(t));
      setStatus(`using ${d.name}`);
      Office.emote('hermes', 'gear');
      scrollDown(false);
    });
    es.addEventListener('tool_complete', (e) => {
      const d = data(e);
      const t = [...bot.tools].reverse().find((x) => !x.done && (!d.name || x.name === d.name));
      if (t) {
        t.done = true;
        t.chip.classList.add('done');
        t.chip.querySelector('.chip-icon').textContent = '✔';
      }
    });
    es.addEventListener('approval', (e) => showApproval(data(e)));
    es.addEventListener('done', (e) => {
      const d = data(e);
      if (!bot.text && d.answer) { bot.text = d.answer; queuePaint(bot); }
      s.done = true;
    });
    es.addEventListener('stream_end', () => { s.done = true; finishStream(); });
    es.addEventListener('cancel', () => finishStream());
    es.addEventListener('apperror', (e) => {
      const d = data(e);
      failStream(d.message || d.error || 'Hermes hit a snag');
    });
    es.onerror = () => {
      if (s.done) { finishStream(); return; }
      if (++s.errors > 4) failStream('Lost the connection to Hermes');
    };
  }

  function endStream() {
    const s = state.streaming;
    if (!s) return null;
    if (s.es) s.es.close();
    state.streaming = null;
    s.bot.live = false;
    setComposerBusy(false);
    hide($('#approval'));
    $('#chat-status').textContent = 'at the desk';
    syncAgents();
    updateFab();
    return s;
  }

  function finishStream() {
    const s = endStream();
    if (!s) return;
    paintBody(s.bot);
    Office.pulse('hermes', 'done');
    if (state.chatMin) {
      state.unread += 1;
      updateFab();
      const preview = s.bot.text.replace(/\s+/g, ' ').trim().slice(0, 70);
      toast(`${displayName('hermes')} replied${preview ? `: ${preview}${s.bot.text.length > 70 ? '…' : ''}` : ''}`, 'good');
    }
    // Re-read the saved conversation so the view matches what Hermes stored.
    setTimeout(() => { if (!state.streaming) loadSession(); }, 400);
  }

  function failStream(message) {
    const s = endStream();
    if (!s) return;
    s.bot.error = message;
    paintBody(s.bot);
    Office.emote('hermes', 'bang');
    if (state.chatMin) { state.unread += 1; updateFab(); toast(message, 'bad'); }
  }

  async function cancelStream() {
    const s = state.streaming;
    if (!s) return;
    if (s.streamId) {
      try { await api(`/api/chat/cancel?stream_id=${encodeURIComponent(s.streamId)}`); } catch { /* finish locally anyway */ }
    }
    s.bot.text += s.bot.text ? '\n\n*(stopped)*' : '*(stopped)*';
    finishStream();
  }

  /* ---------- composer ---------- */

  const input = $('#input');
  function autosize() {
    input.style.height = 'auto';
    input.style.height = Math.min(input.scrollHeight, 132) + 'px';
  }
  let lastListen = 0;
  input.addEventListener('input', () => {
    autosize();
    if (input.value.trim() && !state.streaming && Date.now() - lastListen > 3000) {
      lastListen = Date.now();
      Office.emote('hermes', 'dots');
    }
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      $('#composer').requestSubmit();
    }
  });
  $('#composer').addEventListener('submit', (e) => {
    e.preventDefault();
    if (state.streaming) { cancelStream(); return; }
    const text = input.value;
    if (!text.trim()) return;
    input.value = '';
    autosize();
    send(text);
  });

  $('#btn-new').addEventListener('click', async () => {
    if (state.streaming) { toast('Hermes is still replying. Stop it first.', 'bad'); return; }
    setSession(null);
    state.messages = [];
    renderMessages();
    input.focus();
  });

  /* ---------- minimizing the chat ---------- */

  function setChatMin(min) {
    state.chatMin = min;
    $('#app').classList.toggle('chat-min', min);
    $('#chat-fab').hidden = !min;
    try { localStorage.setItem(CHAT_MIN_KEY, min ? '1' : ''); } catch { /* storage unavailable */ }
    if (!min) { state.unread = 0; scrollDown(true); }
    updateFab();
  }
  function updateFab() {
    const badge = $('#fab-badge');
    badge.hidden = !state.unread;
    badge.textContent = state.unread > 9 ? '9+' : String(state.unread);
    $('#chat-fab').classList.toggle('busy', !!state.streaming);
  }
  $('#btn-min').addEventListener('click', () => setChatMin(true));
  $('#chat-fab').addEventListener('click', () => setChatMin(false));

  /* ---------- journal (past chats) ---------- */

  function toMs(v) {
    if (v == null || v === '') return NaN;
    if (typeof v === 'number') return v < 1e12 ? v * 1000 : v;
    const n = Number(v);
    return Number.isNaN(n) ? Date.parse(v) : toMs(n);
  }
  function ago(v) {
    const ms = toMs(v);
    if (Number.isNaN(ms)) return '';
    const s = (Date.now() - ms) / 1000, f = Math.abs(s);
    const [n, u] = f < 60 ? [Math.round(f), 's'] : f < 3600 ? [Math.round(f / 60), 'm'] : f < 86400 ? [Math.round(f / 3600), 'h'] : [Math.round(f / 86400), 'd'];
    return s >= 0 ? `${n}${u} ago` : `in ${n}${u}`;
  }

  $('#btn-journal').addEventListener('click', async () => {
    const list = $('#journal-list');
    list.textContent = '';
    list.append(el('p', 'muted', 'Opening the journal…'));
    show($('#journal'));
    try {
      const data = await api('/api/sessions');
      const sessions = (data.sessions || []).slice(0, 40);
      list.textContent = '';
      if (!sessions.length) list.append(el('p', 'muted', 'No chats yet.'));
      for (const s of sessions) {
        const item = el('button', 'journal-item' + (s.session_id === state.sessionId ? ' current' : ''));
        item.type = 'button';
        item.append(el('span', 'journal-title', s.title || 'Untitled chat'));
        item.append(el('span', 'journal-meta', [ago(s.updated_at || s.last_message_at || s.created_at), s.message_count != null ? `${s.message_count} msgs` : ''].filter(Boolean).join(' · ')));
        item.addEventListener('click', () => {
          if (state.streaming) { toast('Hermes is still replying. Stop it first.', 'bad'); return; }
          setSession(s.session_id);
          hide($('#journal'));
          loadSession();
        });
        list.append(item);
      }
    } catch (e) {
      list.textContent = '';
      list.append(el('p', 'msg-error', e.message));
    }
  });

  $('#btn-logout').addEventListener('click', async () => {
    try { await api('/api/auth/logout', { method: 'POST' }); } catch { /* logging out anyway */ }
    hide($('#journal'));
    showLogin();
  });

  /* ---------- agent card ---------- */

  function typewriter(node, text) {
    clearInterval(node._tw);
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) { node.textContent = text; return; }
    node.textContent = '';
    let i = 0;
    node._tw = setInterval(() => {
      i += 2;
      node.textContent = text.slice(0, i);
      if (i >= text.length) clearInterval(node._tw);
    }, 22);
  }

  function greeting(j) {
    if (isWorking(j)) {
      const secs = state.running[j.id];
      return secs != null ? `Busy busy! I've been at it for ${Math.round(secs)}s.` : "Busy busy! I'm working on it right now.";
    }
    if (isPaused(j)) return "Zzz… I'm on a break. Wake me up whenever you need me.";
    if (hasError(j)) return 'Oof. My last run went sideways. Want me to try again?';
    const next = ago(j.next_run_at);
    return next ? `Howdy! I'm off the clock. My next shift starts ${next}.` : "Howdy! I'm off the clock right now.";
  }

  function fact(dl, k, v) {
    if (!v) return;
    dl.append(el('dt', null, k), el('dd', null, v));
  }

  function button(label, cls, fn) {
    const b = el('button', 'btn ' + (cls || ''), label);
    b.type = 'button';
    b.addEventListener('click', async () => {
      b.disabled = true;
      try { await fn(); } catch (e) { toast(e.message, 'bad'); }
      b.disabled = false;
    });
    return b;
  }

  function renderLevel(id) {
    const box = $('#card-level');
    box.textContent = '';
    box.hidden = isPet(id);
    if (isPet(id)) return;
    const v = state.valley[id] || { xp: 0, level: 0, floor: 0, next: 100 };
    const pct = v.next ? ((v.xp - v.floor) / (v.next - v.floor)) * 100 : 100;
    box.append(el('span', 'level-badge', `Lv ${v.level || 0}`));
    const bar = el('div', 'xpbar');
    const fill = el('i');
    fill.style.width = `${clamp(pct, 0, 100).toFixed(1)}%`;
    bar.append(fill);
    box.append(bar, el('span', 'xp-text', v.next ? `${v.xp} / ${v.next} XP` : `${v.xp} XP · max level`));
  }

  function openCard(id) {
    state.cardId = id;
    state.cardMode = 'info';
    $('#card-report').hidden = true;
    $('#card-editor').hidden = true;
    $('#card-info').hidden = false;
    $('#card-frame').classList.remove('full');
    renderCard(true);
    show($('#agent-card'));
  }

  function renderCard(fresh) {
    const id = state.cardId;
    if (!id || state.cardMode === 'edit') return;
    const greet = $('#card-greet');
    const facts = $('#card-facts');
    const actions = $('#card-actions');
    const promptEl = $('#card-prompt');
    Office.drawPortrait($('#card-portrait'), id, lookOf(id));
    $('#card-name').textContent = displayName(id);
    $('#card-realname').textContent = displayName(id) !== defaultName(id) ? defaultName(id) : '';
    renderLevel(id);
    facts.textContent = '';
    promptEl.textContent = '';
    actions.textContent = '';

    if (id === 'dog') {
      if (fresh) typewriter(greet, `Woof! ${displayName('dog')} wags happily. Best dog in the valley.`);
      fact(facts, 'Breed', 'Spotted office dog');
      fact(facts, 'Likes', 'Pets, following people around, chasing the mice, naps on the rug');
      actions.append(button('Pet', 'btn-go', async () => Office.petDog()), button('Rename', '', async () => openEditor()));
      return;
    }

    if (id === 'ferret') {
      if (fresh) typewriter(greet, `Dook dook! ${displayName('ferret')} does a happy little war dance around your feet.`);
      const socks = Office.critterInfo().socks;
      fact(facts, 'Breed', 'Sable ferret');
      fact(facts, 'Likes', 'Stealing socks, war dances, cuddles, hiding in the shipping bin');
      fact(facts, 'Sock stash', socks ? `${socks} ${socks === 1 ? 'sock' : 'socks'} (don't tell anyone)` : 'empty… for now');
      actions.append(button('Pet', 'btn-go', async () => Office.petFerret()), button('Rename', '', async () => openEditor()));
      return;
    }

    if (id === 'hermes') {
      if (fresh) typewriter(greet, state.streaming ? `Hold on, I'm ${state.streaming.status || 'working'}!` : `Hi! I'm ${displayName('hermes')}. Talk to me in the chat. I'll hop on my computer whenever you ask for something.`);
      fact(facts, 'Status', state.streaming ? state.streaming.status : 'Waiting for you');
      fact(facts, 'Crew', `${state.jobs.length} scheduled ${state.jobs.length === 1 ? 'agent' : 'agents'}`);
      fact(facts, 'XP from', 'every skill Hermes learns or improves');
      actions.append(
        button('Talk', 'btn-go', async () => { closeOverlays(); if (state.chatMin) setChatMin(false); input.focus(); }),
        button('Customize', '', async () => openEditor()),
      );
      return;
    }

    const j = jobFor(id);
    if (!j) { closeOverlays(); return; }
    if (fresh) typewriter(greet, greeting(j));
    fact(facts, 'Schedule', j.schedule_display || (j.schedule && (j.schedule.display || j.schedule.expr)) || '');
    fact(facts, 'Status', isWorking(j) ? 'Working' : isPaused(j) ? 'Paused' : hasError(j) ? 'Needs a look' : 'Idle');
    fact(facts, 'Last run', j.last_run_at ? `${ago(j.last_run_at)}${j.last_status ? ` (${j.last_status})` : ''}` : 'never');
    if (!isPaused(j)) fact(facts, 'Next run', ago(j.next_run_at));
    fact(facts, 'Skills', Array.isArray(j.skills) && j.skills.length ? j.skills.join(', ') : 'none yet');
    if (j.last_error) fact(facts, 'Error', String(j.last_error).slice(0, 200));
    promptEl.textContent = j.prompt ? String(j.prompt).slice(0, 240) + (String(j.prompt).length > 240 ? '…' : '') : '';

    const run = button('Run now', 'btn-go', async () => {
      const r = await api('/api/crons/run', { method: 'POST', body: { job_id: j.id } });
      toast(r.status === 'already_running' ? `${displayName(id)} is already working` : `${displayName(id)} is heading to the desk`, 'good');
      setTimeout(pollAgents, 400);
    });
    run.disabled = isWorking(j);
    actions.append(run);
    if (isPaused(j)) {
      actions.append(button('Wake up', '', async () => { await api('/api/crons/resume', { method: 'POST', body: { job_id: j.id } }); toast(`${displayName(id)} is back on the schedule`, 'good'); pollAgents(); }));
    } else {
      actions.append(button('Pause', '', async () => { await api('/api/crons/pause', { method: 'POST', body: { job_id: j.id } }); toast(`${displayName(id)} is taking a break`); pollAgents(); }));
    }
    actions.append(button('Last report', 'btn-quiet', async () => {
      const box = $('#card-report');
      const r = await api(`/api/crons/output?job_id=${encodeURIComponent(j.id)}&limit=1`);
      const out = (r.outputs || [])[0];
      box.innerHTML = out ? renderMarkdown(out.content) : '<p class="muted">No report yet.</p>';
      box.hidden = false;
      box.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }));
    actions.append(button('Customize', '', async () => openEditor()));
  }

  /* ---------- customizing an agent: nickname and sprite ---------- */

  // Presets change clothes and hair but leave the body shape and skin alone.
  const PRESETS = [
    ['Farmer', { style: 'straw', top: 'overalls', bottom: 'pants', shirt: '#e8e4d8', pants: '#2b4a6b', hair: '#6b3d1f', glasses: false }],
    ['Wizard', { style: 'wizard', top: 'tee', bottom: 'skirt', shirt: '#8a5bbf', pants: '#6a4a8a', hair: '#ece6d6', glasses: false }],
    ['Royal', { style: 'crown', top: 'vest', bottom: 'pants', shirt: '#c0433f', pants: '#3a3a5e', hair: '#e0b04a', glasses: false }],
    ['Messenger', { style: 'helm', top: 'tee', bottom: 'shorts', shirt: '#3a6fd8', pants: '#2b3a6b', hair: '#e0b04a', glasses: false }],
    ['Scholar', { style: 'bob', top: 'tie', bottom: 'pants', shirt: '#e8e4d8', pants: '#55463a', hair: '#3b2314', glasses: true }],
    ['Rocker', { style: 'spiky', top: 'hoodie', bottom: 'pants', shirt: '#2b2b3a', pants: '#3a3a5e', hair: '#c8452f', glasses: false }],
  ];
  const LOOK_KEYS = ['skin', 'hair', 'shirt', 'pants', 'style', 'glasses', 'body', 'top', 'bottom'];

  function randomLook() {
    const P = Office.palette;
    const any = (arr) => arr[Math.floor(Math.random() * arr.length)];
    return {
      skin: any(P.skin), hair: any(P.hair), shirt: any(P.shirt), pants: any(P.pants), style: any(P.styles)[0],
      top: any(P.tops)[0], bottom: any(P.bottoms)[0], glasses: Math.random() < 0.25,
    };
  }

  function field(label, control) {
    const row = el('div', 'field');
    row.append(el('span', 'field-label', label), control);
    return row;
  }

  function openEditor() {
    const id = state.cardId;
    const isDog = isPet(id); // pets only get a nickname
    const v = state.valley[id] || {};
    const base = Office.defaultLook(id);
    const draft = { nickname: v.nickname || '', look: {} };
    for (const k of LOOK_KEYS) draft.look[k] = (v.look && k in v.look) ? v.look[k] : base[k];
    state.draft = draft;
    state.cardMode = 'edit';
    $('#card-info').hidden = true;
    $('#card-frame').classList.toggle('full', !isDog);
    const ed = $('#card-editor');
    ed.textContent = '';
    ed.hidden = false;

    const refreshers = [];
    const repaint = () => {
      Office.drawPortrait($('#card-portrait'), id, isDog ? null : draft.look, !isDog);
      for (const fn of refreshers) fn();
    };

    const nick = el('input', 'nick-input');
    nick.type = 'text';
    nick.maxLength = 24;
    nick.value = draft.nickname;
    nick.placeholder = defaultName(id);
    nick.setAttribute('aria-label', 'Nickname');
    nick.addEventListener('input', () => {
      draft.nickname = nick.value;
      $('#card-name').textContent = nick.value.trim() || defaultName(id);
    });
    ed.append(field('Nickname', nick));

    const chipRow = (key, options) => {
      const row = el('div', 'chips');
      for (const [value, label] of options) {
        const b = el('button', 'chip-btn', label);
        b.type = 'button';
        b.addEventListener('click', () => { draft.look[key] = value; repaint(); });
        refreshers.push(() => b.classList.toggle('on', draft.look[key] === value));
        row.append(b);
      }
      return row;
    };

    if (!isDog) {
      const P = Office.palette;
      ed.append(field('Body', chipRow('body', P.bodies)));
      const presets = el('div', 'chips');
      for (const [label, look] of PRESETS) {
        const b = el('button', 'chip-btn', label);
        b.type = 'button';
        b.addEventListener('click', () => { Object.assign(draft.look, look); repaint(); });
        presets.append(b);
      }
      const dice = el('button', 'chip-btn', '🎲 Surprise me');
      dice.type = 'button';
      dice.addEventListener('click', () => { Object.assign(draft.look, randomLook()); repaint(); });
      presets.append(dice);
      ed.append(field('Quick picks', presets));

      ed.append(field('Hair or hat', chipRow('style', P.styles)));
      ed.append(field('Shirt', chipRow('top', P.tops)));
      ed.append(field('Bottoms', chipRow('bottom', P.bottoms)));

      for (const [key, label] of [['skin', 'Skin'], ['hair', 'Hair'], ['shirt', 'Shirt'], ['pants', 'Pants']]) {
        const row = el('div', 'swatches');
        for (const color of P[key]) {
          const b = el('button', 'swatch');
          b.type = 'button';
          b.style.background = color;
          b.setAttribute('aria-label', `${label} ${color}`);
          b.addEventListener('click', () => { draft.look[key] = color; repaint(); });
          refreshers.push(() => b.classList.toggle('on', draft.look[key] === color));
          row.append(b);
        }
        ed.append(field(label, row));
      }

      const toggle = el('label', 'toggle');
      const cb = el('input');
      cb.type = 'checkbox';
      cb.addEventListener('change', () => { draft.look.glasses = cb.checked; repaint(); });
      refreshers.push(() => { cb.checked = !!draft.look.glasses; });
      toggle.append(cb, el('span', null, 'Glasses'));
      ed.append(toggle);
    }

    const actions = el('div', 'card-actions');
    actions.append(button('Save', 'btn-go', async () => {
      const body = { id, nickname: draft.nickname.trim() };
      if (!isDog) body.look = draft.look;
      await saveAgent(body);
      toast(`${displayName(id)} ${isDog ? 'loves the new name' : 'looks great'}!`, 'good');
      closeEditor();
    }));
    if (!isDog) {
      actions.append(button('Original look', '', async () => {
        for (const k of LOOK_KEYS) draft.look[k] = base[k];
        repaint();
      }));
    }
    actions.append(button('Cancel', 'btn-quiet', async () => closeEditor()));
    ed.append(actions);
    repaint();
  }

  async function saveAgent(body) {
    const res = await api('/api/valley/agent', { method: 'POST', body });
    state.valley = res.agents || state.valley;
    syncAgents();
  }

  function closeEditor() {
    state.cardMode = 'info';
    state.draft = null;
    $('#card-editor').hidden = true;
    $('#card-info').hidden = false;
    $('#card-frame').classList.remove('full');
    renderCard(false);
  }

  /* ---------- decorating the office ---------- */

  const DECOR_PARTS = [['wall', 'Wallpaper'], ['floor', 'Floor'], ['wood', 'Desks & shelves'], ['couch', 'Couch'], ['rug', 'Rug']];

  function openDecor() {
    const draft = Object.assign(Office.defaultDecor(), state.decor);
    state.decorDraft = draft;
    const body = $('#decor-body');
    body.textContent = '';
    const previews = [];
    const refreshers = [];
    // Every pick repaints the room right away so you can see it behind the panel.
    const apply = () => {
      Office.setDecor(draft);
      for (const [c, kind, key] of previews) Office.previewDecor(c, kind, key);
      for (const fn of refreshers) fn();
    };
    for (const [kind, label] of DECOR_PARTS) {
      const row = el('div', 'decor-row');
      for (const [key, name] of Office.decorOptions[kind]) {
        const b = el('button', 'decor-opt');
        b.type = 'button';
        b.setAttribute('aria-label', `${label}: ${name}`);
        const c = el('canvas');
        b.append(c, el('span', null, name));
        b.addEventListener('click', () => { draft[kind] = key; apply(); });
        refreshers.push(() => b.classList.toggle('on', draft[kind] === key));
        previews.push([c, kind, key]);
        row.append(b);
      }
      body.append(field(label, row));
    }
    const actions = $('#decor-actions');
    actions.textContent = '';
    actions.append(
      button('Save', 'btn-go', async () => {
        const res = await api('/api/valley/decor', { method: 'POST', body: draft });
        state.decor = res.decor || { ...draft };
        state.decorDraft = null;
        hide($('#decor'));
        Office.setDecor(state.decor);
        toast('The office got a makeover!', 'good');
      }),
      button('Original look', '', async () => { Object.assign(draft, Office.defaultDecor()); apply(); }),
      button('Cancel', 'btn-quiet', async () => hide($('#decor'))),
    );
    apply();
    show($('#decor'));
    $('#backdrop').classList.add('clear');
    $('#app').classList.add('decorating');
  }
  $('#btn-decor').addEventListener('click', openDecor);

  /* ---------- approval ---------- */

  function showApproval(d) {
    const box = $('#approval');
    $('#approval-cmd').textContent = d.command || d.description || JSON.stringify(d, null, 2);
    box.dataset.approvalId = d.approval_id || d.id || '';
    show(box, true);
    Office.emote('hermes', 'q');
    if (state.chatMin) toast('Hermes needs your OK', 'bad');
  }

  $('#approval').addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-choice]');
    if (!btn) return;
    const box = $('#approval');
    box.querySelectorAll('button').forEach((b) => { b.disabled = true; });
    try {
      await api('/api/approval/respond', { method: 'POST', body: { session_id: state.sessionId, choice: btn.dataset.choice, approval_id: box.dataset.approvalId } });
      hide(box);
    } catch (err) {
      toast(`Couldn't answer: ${err.message}`, 'bad');
    } finally {
      box.querySelectorAll('button').forEach((b) => { b.disabled = false; });
    }
  });

  /* ---------- overlays, toasts, layout ---------- */

  function show(node, modal) {
    closeOverlays(node);
    node.hidden = false;
    $('#backdrop').hidden = false;
    $('#backdrop').classList.remove('clear');
    $('#backdrop').dataset.modal = modal ? '1' : '';
  }
  function hide(node) {
    node.hidden = true;
    if (node.id === 'agent-card') { state.cardId = null; state.cardMode = 'info'; state.draft = null; }
    // Closing the Decorate panel without saving puts the old decor back.
    if (node.id === 'decor') {
      $('#app').classList.remove('decorating');
      if (state.decorDraft) { state.decorDraft = null; Office.setDecor(state.decor); }
    }
    if (![...document.querySelectorAll('.dialog, .drawer')].some((n) => !n.hidden)) {
      $('#backdrop').hidden = true;
      $('#backdrop').classList.remove('clear');
    }
  }
  function closeOverlays(except) {
    document.querySelectorAll('.dialog, .drawer').forEach((n) => { if (n !== except && n.id !== 'approval') hide(n); });
    if (!except) $('#backdrop').hidden = $('#approval').hidden;
  }
  $('#backdrop').addEventListener('click', () => { if (!$('#backdrop').dataset.modal) closeOverlays(); });
  document.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', () => hide(b.closest('.dialog, .drawer'))));
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeOverlays(); });

  function toast(text, kind) {
    const t = el('div', 'toast frame-mini' + (kind ? ' toast-' + kind : ''));
    const icon = { bad: '❗', good: '⭐', level: '🌼' }[kind] || '🍃';
    t.append(el('span', 'toast-icon', icon), el('span', null, text));
    $('#toasts').append(t);
    setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 400); }, kind === 'level' ? 5000 : 3600);
  }

  const SIZES = ['office-normal', 'office-big', 'office-small'];
  $('#office-toggle').addEventListener('click', () => {
    const app = $('#app');
    const cur = SIZES.findIndex((c) => app.classList.contains(c));
    app.classList.remove(SIZES[cur]);
    app.classList.add(SIZES[(cur + 1) % SIZES.length]);
  });

  function fitViewport() {
    const vv = window.visualViewport;
    const h = vv ? vv.height : window.innerHeight;
    document.documentElement.style.setProperty('--app-h', `${Math.round(h)}px`);
    $('#app').classList.toggle('kb', !!vv && vv.height < window.innerHeight * 0.75 && document.activeElement === input);
    if (vv && window.scrollY) window.scrollTo(0, 0);
  }
  if (window.visualViewport) window.visualViewport.addEventListener('resize', fitViewport);
  window.addEventListener('resize', fitViewport);
  input.addEventListener('focus', () => setTimeout(fitViewport, 300));
  input.addEventListener('blur', () => setTimeout(fitViewport, 100));

  document.addEventListener('visibilitychange', () => { if (!document.hidden && state.appStarted && !$('#app').hidden) pollAgents(); });

  boot();
})();
