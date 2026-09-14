/* Marigold Valley office: a pixel-art room where each agent works at a desk or wanders when idle. */
(function () {
  'use strict';

  const W = 256;
  const WALL_H = 58;
  const COL_X = [52, 128, 204];
  const AISLES = [14, 90, 166, 242];
  const ROW_H = 46;
  const DESK_H = 16;
  const FIRST_DESK_Y = WALL_H + 22;
  const LOUNGE_H = 66;
  const OUT = '#3b1f0e';
  const SPEED = 26; // world px per second

  /* ---------- small helpers ---------- */

  function hash(s) {
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
  }
  function seeded(seed) {
    return () => {
      seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const pick = (arr, r = Math.random()) => arr[Math.floor(r * arr.length) % arr.length];
  const rnd = (a, b) => a + Math.random() * (b - a);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const mirror = (half) => half + half.split('').reverse().join('');
  function shade(hex, f) {
    const n = parseInt(hex.slice(1), 16);
    return '#' + [n >> 16, (n >> 8) & 255, n & 255]
      .map((v) => clamp(Math.round(f <= 1 ? v * f : v + (255 - v) * (f - 1)), 0, 255).toString(16).padStart(2, '0'))
      .join('');
  }
  function mix(a, b, t) {
    const pa = parseInt(a.slice(1), 16);
    const pb = parseInt(b.slice(1), 16);
    return '#' + [16, 8, 0]
      .map((s) => Math.round(((pa >> s) & 255) * (1 - t) + ((pb >> s) & 255) * t).toString(16).padStart(2, '0'))
      .join('');
  }

  let g = null; // current 2d context
  function R(x, y, w, h, c) { g.fillStyle = c; g.fillRect(x, y, w, h); }
  function box(x, y, w, h, fill, line = OUT) { R(x, y, w, h, line); R(x + 1, y + 1, w - 2, h - 2, fill); }
  function stamp(rows, x, y, colors) {
    for (let j = 0; j < rows.length; j++) {
      for (let i = 0; i < rows[j].length; i++) {
        const c = colors[rows[j][i]];
        if (c) R(x + i, y + j, 1, 1, c);
      }
    }
  }
  function line(x0, y0, x1, y1, c) {
    const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
    let err = dx + dy;
    for (;;) {
      R(x0, y0, 1, 1, c);
      if (x0 === x1 && y0 === y1) break;
      const e2 = 2 * err;
      if (e2 >= dy) { err += dy; x0 += sx; }
      if (e2 <= dx) { err += dx; y0 += sy; }
    }
  }

  /* ---------- characters ---------- */

  const SKIN = ['#f7d3ad', '#ecbc92', '#d49b6c', '#a86c46', '#7b4b2f'];
  const HAIR = ['#3b2314', '#6b3d1f', '#a0522d', '#e0b04a', '#1f1f2b', '#ece6d6', '#7a4fa0', '#2f6f58', '#c8452f', '#e86fa0'];
  const SHIRT = ['#3f78c0', '#3a6fd8', '#c0433f', '#4f9a45', '#d99a2b', '#8a5bbf', '#2f9e9e', '#d56d9a', '#e07b39', '#2b2b3a', '#e8e4d8'];
  const PANTS = ['#3a3a5e', '#2b3a6b', '#4a3322', '#2b4a6b', '#55463a', '#2f4f3a'];
  const CHAIRS = ['#a33b2e', '#3e6a9e', '#4f8a3a', '#7a4fa0', '#3b3b4a'];
  const RANDOM_STYLES = ['short', 'long', 'bob', 'spiky', 'bun', 'straw', 'cap'];
  const STYLE_OPTIONS = [
    ['short', 'Short'], ['long', 'Long'], ['bob', 'Bob'], ['spiky', 'Spiky'], ['bun', 'Bun'],
    ['straw', 'Straw hat'], ['cap', 'Cap'], ['wizard', 'Wizard hat'], ['crown', 'Crown'], ['helm', 'Winged helm'], ['bald', 'Bald'],
  ];

  // Sprites are 12x18 and left/right symmetric: each row lists the left half only.
  const BODY = ['......', '...ooo', '..osss', '.ossss', '.ossss', '.ossss', '.ossss', '..osss',
    '..otts', '.otttt', 'otTttt', 'otTttt', 'ostttt', '.okkkk'];
  const HAIRS = {
    short: ['...ooo', '..ohhh', '.ohhhh', '.ohhhh', '.ohhhh', '.oh...'],
    long: ['...ooo', '..ohhh', '.ohhhh', '.ohhhh', '.ohhhh', '.oh...', '.oh...', '.oh...', 'oh....'],
    bob: ['...ooo', '..ohhh', '.ohhhh', '.ohhhh', '.ohhhh', '.oh...', '.oh...', '.oh...'],
    spiky: ['..h.hh', '.hhhhh', '.ohhhh', '.ohhhh', '.ohhhh', '.oh...'],
    bun: ['....hh', '..ohhh', '.ohhhh', '.ohhhh', '.ohhhh', '.oh...'],
    straw: ['...yyy', '..yyyy', '..rrrr', 'yyyyyy', '.ohhhh', '.oh...'],
    cap: ['......', '..cccc', '.ccccc', '.ccccc', '.ohhhh', '.oh...'],
    wizard: ['.....c', '....cc', '...ccy', 'CCCCCC', '.ohhhh', '.oh...'],
    crown: ['.g.g.g', '.ggggr', '.ohhhh', '.ohhhh', '.ohhhh', '.oh...'],
    helm: ['w...gg', 'ww.ggg', 'wwgggg', '.wgggg', '.ohhhh', '.oh...'],
    bald: [],
  };

  function baseLook(id) {
    if (id === 'hermes') {
      return { skin: SKIN[0], hair: '#e0b04a', shirt: '#3a6fd8', pants: '#2b3a6b', belt: '#f2c14e', style: 'helm', blush: true, glasses: false, cap: shade('#3a6fd8', 0.8), chair: '#c9962b' };
    }
    const r = seeded(hash(id));
    const shirt = pick(SHIRT.slice(0, 9), r());
    return {
      skin: pick(SKIN, r()), hair: pick(HAIR.slice(0, 9), r()), shirt, pants: pick(PANTS, r()), belt: '#5a3a1a',
      style: pick(RANDOM_STYLES, r()), blush: r() < 0.5, glasses: false, cap: shade(shirt, 0.8), chair: pick(CHAIRS, r()),
    };
  }

  // A saved look only overrides the fields the person picked.
  function lookFor(id, override) {
    const base = baseLook(id);
    if (!override) return base;
    const L = Object.assign({}, base, override);
    L.cap = shade(L.shirt, 0.8);
    return L;
  }

  function colorMap(L) {
    return {
      o: OUT, s: L.skin, h: L.hair, t: L.shirt, T: shade(L.shirt, 0.78), k: L.belt, y: '#eac35c', r: '#c0392b',
      c: L.cap, C: shade(L.cap, 0.72), g: '#f2c14e', w: '#ffffff',
    };
  }

  function legs(L, lift) {
    for (const [x0, up] of [[1, lift < 0], [6, lift > 0]]) {
      const h = up ? 3 : 4;
      R(x0, 14, 5, h, OUT);
      R(x0 + 1, 14, 3, h - 2, L.pants);
      R(x0 + 1, 14 + h - 2, 3, 1, '#5a3218');
    }
  }

  function buildSprites(L) {
    const colors = colorMap(L);
    const make = (lift) => {
      const c = document.createElement('canvas');
      c.width = 12; c.height = 18;
      const prev = g;
      g = c.getContext('2d');
      stamp(BODY.map(mirror), 0, 0, colors);
      stamp((HAIRS[L.style] || HAIRS.short).map(mirror), 0, 0, colors);
      legs(L, lift);
      g = prev;
      return c;
    };
    return { stand: make(0), walkA: make(-1), walkB: make(1) };
  }

  function face(a, x, y, t) {
    const L = a.look;
    const closed = a.sleeping || (t + a.blinkOffset) % 4.2 < 0.13;
    if (closed) {
      const lid = shade(L.skin, 0.62);
      R(x + 3, y + 5, 2, 1, lid);
      R(x + 7, y + 5, 2, 1, lid);
    } else {
      R(x + 4, y + 5, 1, 1, '#2a1a10');
      R(x + 7, y + 5, 1, 1, '#2a1a10');
    }
    if (L.glasses) {
      R(x + 3, y + 5, 1, 1, '#2a2a3a'); R(x + 5, y + 5, 2, 1, '#2a2a3a'); R(x + 8, y + 5, 1, 1, '#2a2a3a');
    }
    if (L.blush) { R(x + 3, y + 6, 1, 1, '#f3907c'); R(x + 8, y + 6, 1, 1, '#f3907c'); }
  }

  function drawCharAt(a, x, y, frame, t) {
    g.drawImage(a.sprites[frame], x, y);
    face(a, x, y, t);
  }

  /* ---------- emotes & particles ---------- */

  const ICONS = {
    dots: { c: '#5b4a3a', rows: ['.......', '.......', '.......', '.#.#.#.', '.......', '.......', '.......'] },
    bang: { c: '#d33a2c', rows: ['...#...', '...#...', '...#...', '...#...', '.......', '...#...', '.......'] },
    q: { c: '#3a6fd8', rows: ['..###..', '.#...#.', '....#..', '...#...', '.......', '...#...', '.......'] },
    heart: { c: '#e0415a', rows: ['.......', '.##.##.', '#######', '#######', '.#####.', '..###..', '...#...'] },
    note: { c: '#7a4fd0', rows: ['..#####', '..#...#', '..#...#', '..#...#', '###.###', '###.###', '.......'] },
    check: { c: '#2f9e44', rows: ['.......', '......#', '.....##', '#...##.', '##.##..', '.###...', '..#....'] },
    coffee: { c: '#6b3d1f', c2: '#b8b8b8', rows: ['.+..+..', '..+..+.', '.......', '######.', '#####.#', '#####.#', '.####..'] },
    drop: { c: '#3a8fe0', c2: '#bfe3ff', rows: ['...#...', '..###..', '.##+##.', '.#####.', '#######', '.#####.', '..###..'] },
    book: { c: '#7a4424', c2: '#f3e6c8', rows: ['.......', '.##.##.', '#++#++#', '#++#++#', '#++#++#', '.##.##.', '.......'] },
    gear: { c: '#6b6b6b', c2: '#a8a8a8', rows: ['..#.#..', '.#####.', '##+++##', '.#+.+#.', '##+++##', '.#####.', '..#.#..'] },
    star: { c: '#e5a81f', rows: ['...#...', '...#...', '#######', '.#####.', '..###..', '.##.##.', '.#...#.'] },
    flower: { c: '#f5a01f', c2: '#b8451a', rows: ['.#...#.', '###.###', '.#+#+#.', '..#+#..', '.#+#+#.', '###.###', '.#...#.'] },
  };

  function bubble(cx, top, icon) {
    const def = ICONS[icon];
    if (!def) return;
    const x = Math.round(cx) - 5, y = Math.round(top) - 13;
    R(x + 1, y, 9, 1, OUT); R(x + 1, y + 10, 9, 1, OUT); R(x, y + 1, 1, 9, OUT); R(x + 10, y + 1, 1, 9, OUT);
    R(x + 1, y + 1, 9, 9, '#fffaf0');
    R(x + 4, y + 10, 3, 1, '#fffaf0'); R(x + 4, y + 11, 1, 1, OUT); R(x + 5, y + 11, 1, 1, '#fffaf0'); R(x + 6, y + 11, 1, 1, OUT); R(x + 5, y + 12, 1, 1, OUT);
    stamp(def.rows, x + 2, y + 2, { '#': def.c, '+': def.c2 || def.c });
  }

  const Z_ROWS = ['####', '..#.', '.#..', '####'];
  const HEART_ROWS = ['.#.#.', '#####', '.###.', '..#..'];

  function spawn(p) {
    S.particles.push(Object.assign({ vx: 0, vy: -8, life: 1, age: 0, kind: 'px', color: '#fff' }, p));
  }
  function drawParticles(dt) {
    for (const p of S.particles) { p.age += dt; p.x += p.vx * dt; p.y += p.vy * dt; }
    S.particles = S.particles.filter((p) => p.age < p.life);
    for (const p of S.particles) {
      g.globalAlpha = clamp((1 - p.age / p.life) * 1.5, 0, 1);
      const x = Math.round(p.x), y = Math.round(p.y);
      if (p.kind === 'spark') { R(x, y - 1, 1, 3, p.color); R(x - 1, y, 3, 1, p.color); }
      else if (p.kind === 'z') stamp(Z_ROWS, x, y, { '#': p.color });
      else if (p.kind === 'heart') stamp(HEART_ROWS, x - 2, y - 2, { '#': p.color });
      else R(x, y, 1, 1, p.color);
    }
    g.globalAlpha = 1;
  }

  /* ---------- marigolds ---------- */

  function marigold(x, y) {
    R(x, y, 3, 3, '#f5a01f');
    R(x, y, 1, 1, '#ffcf3f'); R(x + 2, y + 2, 1, 1, '#ffcf3f');
    R(x + 2, y, 1, 1, '#e8841a'); R(x, y + 2, 1, 1, '#e8841a');
    R(x + 1, y + 1, 1, 1, '#b8451a');
  }

  function drawMarigoldPot(x, base) {
    R(x + 1, base - 10, 1, 5, '#3a7a35'); R(x + 4, base - 11, 1, 6, '#3a7a35'); R(x + 6, base - 9, 1, 4, '#3a7a35');
    R(x, base - 8, 3, 2, '#5ba044'); R(x + 5, base - 8, 3, 2, '#5ba044');
    marigold(x - 1, base - 13); marigold(x + 3, base - 14); marigold(x + 5, base - 11);
    box(x, base - 6, 8, 6, '#b5552b'); R(x, base - 6, 8, 1, '#d0703a'); R(x, base - 6, 8, 1, OUT);
  }

  /* ---------- scenery ---------- */

  function skyAt(date) {
    const h = date.getHours() + date.getMinutes() / 60;
    const P = { night: ['#0f1638', '#2a3570'], dawn: ['#f09a9a', '#fcd7a4'], day: ['#5fb4ee', '#bfe6f7'], dusk: ['#6d5bb0', '#f59f6a'] };
    const blend = (A, B, t) => ({ top: mix(A[0], B[0], t), bot: mix(A[1], B[1], t) });
    let s, dark;
    if (h < 5) { s = blend(P.night, P.night, 0); dark = 1; }
    else if (h < 6.5) { s = blend(P.night, P.dawn, (h - 5) / 1.5); dark = 1 - (h - 5) / 1.5; }
    else if (h < 8) { s = blend(P.dawn, P.day, (h - 6.5) / 1.5); dark = 0; }
    else if (h < 17.5) { s = blend(P.day, P.day, 0); dark = 0; }
    else if (h < 19) { s = blend(P.day, P.dusk, (h - 17.5) / 1.5); dark = ((h - 17.5) / 1.5) * 0.35; }
    else if (h < 20.5) { s = blend(P.dusk, P.night, (h - 19) / 1.5); dark = 0.35 + ((h - 19) / 1.5) * 0.65; }
    else { s = blend(P.night, P.night, 0); dark = 1; }
    return { top: s.top, bot: s.bot, dark, hour: h };
  }

  function cloud(x, y, c = '#ffffff') {
    x = Math.round(x);
    R(x + 2, y, 6, 1, c); R(x, y + 1, 10, 2, c); R(x + 1, y + 3, 8, 1, shade(c, 0.93));
  }

  function drawWindow(x, y, w, h, sky, t, seed) {
    R(x - 6, y - 4, w + 12, 1, OUT); // curtain rod
    box(x - 2, y - 2, w + 4, h + 4, '#8a4f24');
    const bands = 5;
    for (let i = 0; i < bands; i++) {
      const y0 = y + Math.floor((i * h) / bands), y1 = y + Math.floor(((i + 1) * h) / bands);
      R(x, y0, w, y1 - y0, mix(sky.top, sky.bot, i / (bands - 1)));
    }
    g.save();
    g.beginPath(); g.rect(x, y, w, h); g.clip();
    if (sky.dark > 0.5) {
      for (let i = 0; i < 9; i++) {
        const sx = x + ((seed * 7 + i * 13) % w), sy = y + ((seed * 3 + i * 7) % (h - 4));
        if (Math.sin(t * 2 + i * 1.7) > -0.3) R(sx, sy, 1, 1, '#fff7c2');
      }
      if (seed === 1) { R(x + w - 12, y + 3, 5, 5, '#f4f1d0'); R(x + w - 10, y + 2, 4, 4, sky.top); }
    } else {
      if (seed === 5 && sky.hour > 7 && sky.hour < 17.5) { R(x + w - 11, y + 3, 5, 5, '#fff3a0'); R(x + w - 12, y + 4, 7, 3, '#fff3a0'); }
      for (let i = 0; i < 2; i++) {
        const cx = x + ((t * (1.5 + i) + seed * 17 + i * 30) % (w + 24)) - 12;
        cloud(cx, y + 3 + i * 8, sky.dark > 0.2 ? '#f3d6d0' : '#ffffff');
      }
    }
    g.restore();
    R(x + Math.floor(w / 2), y, 1, h, '#8a4f24');
    R(x, y + Math.floor(h / 2), w, 1, '#8a4f24');
    R(x - 3, y + h + 2, w + 6, 2, '#b8612a'); R(x - 3, y + h + 4, w + 6, 1, OUT);
    R(x - 5, y - 3, 3, h + 6, '#c0433f'); R(x - 5, y - 3, 1, h + 6, '#8e3228');
    R(x + w + 2, y - 3, 3, h + 6, '#c0433f'); R(x + w + 4, y - 3, 1, h + 6, '#8e3228');
    // window box full of marigolds
    R(x - 1, y + h + 1, w + 2, 3, '#4f9a45');
    for (let i = 0; i < Math.floor(w / 6); i++) {
      R(x + 2 + i * 6, y + h - 1, 1, 3, '#3a7a35');
      marigold(x + 1 + i * 6 + (i % 2), y + h - 2 - (i % 2));
    }
    box(x - 2, y + h + 4, w + 4, 6, '#9a5627'); R(x - 1, y + h + 5, w + 2, 1, '#c98646');
  }

  function drawClock(cx, cy, date) {
    R(cx - 3, cy - 5, 7, 11, OUT); R(cx - 5, cy - 3, 11, 7, OUT); R(cx - 4, cy - 4, 9, 9, OUT);
    R(cx - 2, cy - 4, 5, 9, '#fbf3dc'); R(cx - 4, cy - 2, 9, 5, '#fbf3dc'); R(cx - 3, cy - 3, 7, 7, '#fbf3dc');
    R(cx, cy - 4, 1, 1, '#b8612a'); R(cx, cy + 4, 1, 1, '#b8612a'); R(cx - 4, cy, 1, 1, '#b8612a'); R(cx + 4, cy, 1, 1, '#b8612a');
    const m = date.getMinutes(), hr = (date.getHours() % 12) + m / 60;
    const ma = (m / 60) * Math.PI * 2, ha = (hr / 12) * Math.PI * 2;
    line(cx, cy, cx + Math.round(Math.sin(ma) * 3.4), cy - Math.round(Math.cos(ma) * 3.4), OUT);
    line(cx, cy, cx + Math.round(Math.sin(ha) * 2.2), cy - Math.round(Math.cos(ha) * 2.2), '#c0392b');
  }

  function drawBoard(x, y) {
    box(x, y, 42, 24, '#8a4f24');
    R(x + 2, y + 2, 38, 20, '#c49a6c');
    for (let i = 0; i < 18; i++) R(x + 3 + ((i * 11) % 36), y + 3 + ((i * 7) % 18), 1, 1, '#a97f55');
    S.notes.slice(0, 12).forEach((n, i) => {
      const nx = x + 4 + (i % 6) * 6, ny = y + 4 + Math.floor(i / 6) * 9;
      R(nx, ny, 5, 6, n.color); R(nx, ny + 5, 5, 1, shade(n.color, 0.8)); R(nx + 2, ny, 1, 1, '#c0392b');
      R(nx + 1, ny + 2, 3, 1, 'rgba(59,31,14,.35)');
    });
  }

  function makeBooks() {
    const r = seeded(42);
    const colors = ['#c0433f', '#3f78c0', '#4f9a45', '#d99a2b', '#8a5bbf', '#2f9e9e', '#e8d8b0'];
    return [0, 1, 2].map(() => {
      const books = [];
      for (let x = 0; x < 19;) {
        const w = 2 + Math.floor(r() * 2), h = 5 + Math.floor(r() * 4);
        books.push({ x, w, h, c: pick(colors, r()) });
        x += w + (r() < 0.15 ? 2 : 0);
      }
      return books;
    });
  }

  function drawBookshelf(x, y) {
    box(x, y, 24, 34, '#6e3a18');
    S.books.forEach((books, s) => {
      const sy = y + 2 + s * 11;
      R(x + 2, sy, 20, 9, '#3f200d');
      for (const b of books) if (b.x + b.w <= 20) { R(x + 2 + b.x, sy + 9 - b.h, b.w, b.h, b.c); R(x + 2 + b.x, sy + 9 - b.h, 1, b.h, shade(b.c, 1.2)); }
      R(x + 1, sy + 9, 22, 2, '#8a4f24');
    });
  }

  function drawArcade(x, y, t, playing) {
    box(x, y, 14, 28, '#3a3a86');
    R(x + 1, y + 6, 1, 21, '#e04a8a'); R(x + 12, y + 6, 1, 21, '#e04a8a');
    R(x + 1, y + 1, 12, 5, '#f2c14e'); R(x + 3, y + 3, 8, 1, '#c0392b');
    R(x + 2, y + 7, 10, 8, OUT);
    const screens = ['#1d7a46', '#2a3aa0', '#7a1d5a', '#10141f'];
    R(x + 3, y + 8, 8, 6, playing ? screens[Math.floor(t * 5) % 4] : '#12203a');
    if (playing) R(x + 4 + (Math.floor(t * 6) % 6), y + 11, 1, 1, '#fff3a0');
    else if (Math.floor(t * 1.5) % 2) R(x + 5, y + 10, 4, 1, '#8ae3ff');
    R(x + 1, y + 16, 12, 3, '#22224a'); R(x + 4, y + 15, 1, 2, OUT); R(x + 3, y + 14, 3, 1, '#d33a2c');
    R(x + 8, y + 17, 1, 1, '#f2c14e'); R(x + 10, y + 17, 1, 1, '#3fa7e0');
    R(x + 2, y + 20, 10, 7, '#2c2c66'); R(x + 5, y + 22, 4, 2, OUT);
  }

  function drawTallPlant(x, base) {
    const leaves = [[5, -27, 3, 7], [1, -23, 5, 4], [7, -22, 5, 5], [2, -17, 5, 5], [7, -16, 5, 4], [4, -20, 4, 11]];
    for (const [lx, ly, w, h] of leaves) R(x + lx - 1, base + ly - 1, w + 2, h + 2, OUT);
    for (const [lx, ly, w, h] of leaves) {
      R(x + lx, base + ly, w, h, '#3a7a35'); R(x + lx, base + ly, w - 1, h - 1, '#5ba044'); R(x + lx, base + ly, 1, 1, '#8fd16a');
    }
    box(x + 2, base - 8, 9, 8, '#b5552b'); R(x + 2, base - 8, 9, 2, '#d0703a'); R(x + 2, base - 8, 9, 1, OUT);
  }

  const COUCH = '#b5473a', COUCH_D = '#8e3228', COUCH_L = '#d0634f';
  function drawCouch(t) {
    const { x, y } = S.couch;
    box(x, y, 46, 14, COUCH); R(x + 2, y + 2, 42, 1, COUCH_L); R(x + 3, y + 10, 40, 4, COUCH_D);
    R(x + 22, y + 3, 1, 7, COUCH_D);
    for (const a of S.agents.values()) {
      if (a.pose && a.pose.couch != null) drawCharAt(a, S.seats[a.pose.couch].x - 6, y - 4, 'stand', t);
    }
    box(x - 3, y + 6, 7, 18, COUCH); R(x - 2, y + 7, 5, 1, COUCH_L);
    box(x + 42, y + 6, 7, 18, COUCH); R(x + 43, y + 7, 5, 1, COUCH_L);
    box(x, y + 14, 46, 10, COUCH_D); R(x + 1, y + 14, 44, 2, COUCH);
    R(x + 1, y + 24, 2, 2, OUT); R(x + 43, y + 24, 2, 2, OUT);
  }

  function drawBin() {
    const { x, base } = S.bin;
    const y = base - 14;
    const open = S.now < S.binOpenUntil;
    box(x, y + 3, 20, 11, '#8a4f24');
    R(x + 1, y + 7, 18, 1, '#6e3a18'); R(x + 1, y + 10, 18, 1, '#6e3a18');
    R(x + 2, y + 4, 1, 9, '#6e3a18'); R(x + 17, y + 4, 1, 9, '#6e3a18');
    if (open) { R(x + 1, y + 4, 18, 3, '#2b1408'); box(x - 1, y - 6, 22, 5, '#c98646'); R(x, y - 5, 20, 1, '#e0a060'); }
    else { box(x - 1, y, 22, 5, '#c98646'); R(x, y + 1, 20, 1, '#e0a060'); R(x + 9, y + 2, 2, 1, '#f2c14e'); }
  }

  function drawCounter() {
    const { x, base } = S.counter;
    const y = base - 16;
    box(x, y, 42, 16, '#8a4f24');
    R(x + 1, y + 1, 40, 3, '#c98646'); R(x + 1, y + 1, 40, 1, '#e0a060'); R(x + 1, y + 4, 40, 1, '#6e3a18');
    box(x + 3, y + 6, 17, 9, '#9a5627'); box(x + 22, y + 6, 17, 9, '#9a5627');
    R(x + 17, y + 10, 1, 2, '#f2c14e'); R(x + 24, y + 10, 1, 2, '#f2c14e');
    box(x + 6, y - 13, 11, 14, '#4a4a55'); R(x + 7, y - 12, 9, 3, '#6a6a78');
    R(x + 9, y - 6, 5, 5, OUT); R(x + 10, y - 5, 3, 4, '#6b3d1f');
    R(x + 14, y - 11, 1, 1, S.coffeeBusy ? '#5bdc5b' : '#d33a2c');
    box(x + 23, y - 3, 4, 4, '#ffffff'); box(x + 29, y - 3, 4, 4, '#8ae3ff');
    R(x + 34, y - 3, 6, 3, OUT); R(x + 35, y - 3, 4, 2, '#f2c14e'); R(x + 36, y - 4, 2, 1, '#c0433f');
  }

  function drawDeskUnit(d, t) {
    const a = d.agent && d.agent.seated && d.agent.deskIndex === d.i ? d.agent : null;
    const x = d.cx - 15, y = d.ty;
    const chair = d.agent ? d.agent.look.chair : '#7a4424';
    box(d.cx - 8, y - 9, 16, 12, chair); R(d.cx - 7, y - 8, 14, 1, shade(chair, 1.3));
    const working = !!(a && a.want.working);
    if (a) drawCharAt(a, d.cx - 6, y - 11 + (working ? Math.floor(t * 4 + a.phase) % 2 : 0), 'stand', t);

    box(x, y, 30, 14, '#9a5627');
    R(x + 1, y + 1, 28, 4, '#c98646'); R(x + 1, y + 1, 28, 1, '#e0a060'); R(x + 1, y + 5, 28, 1, '#6e3a18');
    box(x + 3, y + 7, 10, 6, '#b06a33'); box(x + 17, y + 7, 10, 6, '#b06a33');
    R(x + 7, y + 9, 2, 1, '#f2c14e'); R(x + 21, y + 9, 2, 1, '#f2c14e');
    R(x + 1, y + 14, 2, 2, OUT); R(x + 27, y + 14, 2, 2, OUT);
    if (d.gold) R(x + 1, y + 1, 28, 1, '#f2c14e');

    // laptop, seen from behind, on the left of the desk
    const lx = d.cx - 14, ly = y - 5;
    box(lx, ly, 9, 6, '#c9ced6');
    R(lx + 4, ly + 2, 1, 2, d.gold ? '#f2c14e' : '#9aa3ad');
    R(lx - 1, ly + 5, 11, 1, '#8a8f99');
    if (working && Math.floor(t * 8 + d.i) % 3) R(lx + 1, ly, 7, 1, '#bff6ff');

    const ix = d.cx + 8, iy = y - 3;
    if (d.gold) {
      // a vase of marigolds on the head desk
      R(ix + 1, iy - 3, 1, 3, '#3a7a35'); R(ix + 3, iy - 4, 1, 4, '#3a7a35');
      marigold(ix - 1, iy - 6); marigold(ix + 2, iy - 7);
      box(ix, iy, 5, 4, '#3a6fd8'); R(ix + 1, iy + 1, 3, 1, '#7ea6f0');
    } else if (d.item === 0) { box(ix, iy, 4, 4, '#ffffff'); R(ix + 4, iy + 1, 1, 2, OUT); }
    else if (d.item === 1) { box(ix, iy, 5, 4, '#b5552b'); R(ix, iy - 4, 5, 4, '#4f9a45'); R(ix + 1, iy - 5, 2, 1, '#5ba044'); }
    else { R(ix - 1, iy, 7, 1, '#c0433f'); R(ix - 1, iy + 1, 7, 1, '#3f78c0'); R(ix, iy - 1, 6, 1, '#4f9a45'); R(ix - 1, iy + 2, 7, 1, OUT); }

    if (working) {
      const p = Math.floor(t * 9 + a.phase) % 2;
      R(d.cx - 4 + p, y + 1, 2, 1, a.look.skin);
      R(d.cx + 2 - p, y + 1, 2, 1, a.look.skin);
    }
  }

  /* ---------- the office dog (white with black spots) ---------- */

  function paintDog(c, x, y, t) {
    const fx = (px, w) => (c.dir > 0 ? x + px : x - px - w);
    const WH = '#f6f5f0', BL = '#1e1e24';
    const step = c.moving ? Math.floor(t * 10) % 2 : 0;
    const wag = Math.floor(t * (c.happy ? 14 : 4)) % 2;
    let parts, spots;
    if (c.sleep) {
      parts = [[-5, -4, 10, 4, WH], [3, -6, 4, 3, WH], [-7, -3, 2, 1, WH]];
      spots = [[3, -6, 2, 3, BL], [-2, -4, 2, 2, BL], [1, -2, 2, 1, BL], [-4, -2, 1, 1, BL], [5, -4, 1, 1, '#6a6a70']];
    } else {
      parts = [
        [-5, -7, 9, 4, WH],
        [3, -10, 5, 5, WH],
        [8, -8, 2, 2, WH],
        wag ? [-7, -9, 2, 1, WH] : [-6, -10, 1, 3, WH],
        [-4, -3, 1, step ? 2 : 3, WH], [-2, -3, 1, step ? 3 : 2, WH], [1, -3, 1, step ? 2 : 3, WH], [3, -3, 1, step ? 3 : 2, WH],
      ];
      spots = [[3, -10, 2, 4, BL], [-3, -6, 2, 2, BL], [0, -7, 2, 1, BL], [1, -5, 1, 1, BL], [-5, -4, 1, 1, BL],
        [9, -8, 1, 1, BL], [6, -9, 1, 1, '#2a1a10'], [4, -6, 1, 2, '#c0392b']];
      if (c.happy) spots.push([8, -6, 1, 1, '#e86a7a']);
    }
    for (const [px, py, w, h] of parts) R(fx(px, w) - 1, y + py - 1, w + 2, h + 2, OUT);
    for (const [px, py, w, h, col] of parts) R(fx(px, w), y + py, w, h, col);
    for (const [px, py, w, h, col] of spots) R(fx(px, w), y + py, w, h, col);
  }

  function updateDog(dt, t) {
    const d = S.dog;
    d.happy = t < d.happyUntil;
    if (d.follow) {
      const a = S.agents.get(d.follow);
      if (!a || a.seated || a.pose || t > d.followUntil) { d.follow = null; d.target = null; d.until = t + rnd(2, 5); }
      else d.target = { x: clamp(a.x + (a.x > d.x ? -10 : 10), 8, W - 8), y: a.y + 1 };
    }
    if (d.target) {
      const dx = d.target.x - d.x, dy = d.target.y - d.y, dist = Math.hypot(dx, dy), step = (d.follow ? 24 : 16) * dt;
      if (dist <= Math.max(step, 0.5)) {
        d.x = d.target.x; d.y = d.target.y; d.moving = false;
        if (d.follow) { d.happyUntil = t + 0.4; return; }
        d.target = null;
        d.until = t + rnd(3, 9);
        d.sleep = Math.random() < (S.dark > 0.5 ? 0.55 : 0.2);
        return;
      }
      d.moving = true;
      if (Math.abs(dx) > 0.3) d.dir = Math.sign(dx);
      d.x += (dx / dist) * step;
      d.y += (dy / dist) * step;
      return;
    }
    d.moving = false;
    if (d.sleep && t > d.nextZ) { d.nextZ = t + 1.6; spawn({ kind: 'z', x: d.x + 2, y: d.y - 10, vx: 2, vy: -5, life: 1.8, color: '#6b7fd8' }); }
    if (t > d.until) {
      d.sleep = false;
      const walkers = [...S.agents.values()].filter((a) => !a.seated && !a.pose);
      const r = Math.random();
      if (r < 0.35 && walkers.length) { d.follow = pick(walkers).id; d.followUntil = t + rnd(6, 14); }
      else d.target = r < 0.75 ? { x: rnd(80, 150), y: rnd(S.LT + 16, S.LT + 50) } : { x: rnd(20, 236), y: pick(S.corridors) + 2 };
    }
  }

  function petDog() {
    const d = S.dog;
    for (let i = 0; i < 3; i++) spawn({ kind: 'heart', x: d.x + rnd(-4, 4), y: d.y - 12, vx: rnd(-4, 4), vy: rnd(-14, -8), life: 1.3, color: '#e0415a' });
    d.sleep = false;
    d.happyUntil = S.now + 2.5;
    d.bubbleUntil = S.now + 2;
    d.until = Math.max(d.until, S.now + 2.5);
  }

  /* ---------- layout & movement ---------- */

  const S = {
    agents: new Map(), desks: [], pois: [], corridors: [], particles: [], notes: [],
    H: 200, LT: 150, scale: 1, now: 0, last: 0, binOpenUntil: 0, dark: 0, coffeeBusy: false,
  };

  function layout(n) {
    const count = Math.max(n, 3);
    S.desks = [];
    for (let i = 0; i < count; i++) {
      S.desks.push({ i, cx: COL_X[i % 3], ty: FIRST_DESK_Y + Math.floor(i / 3) * ROW_H, item: i % 3, gold: i === 0, agent: null });
    }
    const rows = Math.ceil(count / 3);
    const lastTy = FIRST_DESK_Y + (rows - 1) * ROW_H;
    S.LT = lastTy + DESK_H + 14;
    S.H = S.LT + LOUNGE_H;
    S.corridors = [WALL_H + 8];
    for (let r = 0; r < rows; r++) S.corridors.push(FIRST_DESK_Y + r * ROW_H + DESK_H + 10);

    const LT = S.LT;
    S.couch = { x: 12, y: LT + 12 };
    S.seats = [{ x: S.couch.x + 12 }, { x: S.couch.x + 34 }];
    S.bin = { x: 164, base: LT + 30, stand: { x: 174, y: LT + 40 } };
    S.counter = { x: 206, base: LT + 30 };
    S.pois = [
      { id: 'coffee', x: 222, y: LT + 40, emote: 'coffee' },
      { id: 'books', x: 146, y: WALL_H + 8, emote: 'book' },
      { id: 'arcade', x: 233, y: WALL_H + 8, emote: 'note', arcade: true },
      { id: 'plant', x: 22, y: WALL_H + 8, emote: 'drop' },
      { id: 'window', x: 38, y: WALL_H + 8, emote: 'flower' },
      { id: 'window2', x: 188, y: WALL_H + 8, emote: 'heart' },
      { id: 'marigolds', x: 68, y: LT + 40, emote: 'flower' },
      { id: 'couch0', seat: 0, x: S.seats[0].x, y: LT + 40, emote: 'heart' },
      { id: 'couch1', seat: 1, x: S.seats[1].x, y: LT + 40, emote: 'note' },
    ].map((p) => Object.assign(p, { occ: null }));

    S.canvas.width = W;
    S.canvas.height = S.H;
    S.bg = document.createElement('canvas');
    S.bg.width = W; S.bg.height = S.H;
    const prev = g;
    g = S.bg.getContext('2d');
    drawRoomShell();
    g = prev;
    resize();
  }

  function drawRoomShell() {
    for (let x = 0; x < W; x += 8) { R(x, 0, 4, 36, '#e6d3a8'); R(x + 4, 0, 4, 36, '#dcc596'); }
    for (let y = 7; y < 34; y += 9) for (let x = 2 + ((y / 9) % 2) * 4; x < W; x += 8) R(x, y, 1, 1, '#c9ae7e');
    R(0, 0, W, 3, '#5b2d0f');
    R(0, 36, W, 2, '#8a4a22');
    R(0, 38, W, 16, '#7a4424');
    for (let x = 0; x < W; x += 16) { R(x, 38, 1, 16, '#6a3a1e'); R(x + 1, 38, 1, 16, '#8f5530'); }
    R(0, 54, W, 4, '#4a2512');
    const tones = ['#a8652f', '#9c5b29', '#b06c33'];
    for (let y = WALL_H, row = 0; y < S.H; y += 6, row++) {
      R(0, y, W, 6, tones[row % 3]);
      R(0, y + 5, W, 1, '#7d4520');
      for (let x = (row * 19) % 40; x < W; x += 40) R(x, y, 1, 5, '#7d4520');
      R(0, y, W, 1, 'rgba(255,220,160,0.10)');
    }
    const rx = 76, ry = S.LT + 8, rw = 80, rh = 44;
    R(rx, ry, rw, rh, '#7a2b2b');
    R(rx + 2, ry + 2, rw - 4, rh - 4, '#b8483a');
    R(rx + 4, ry + 4, rw - 8, 1, '#e8b04a'); R(rx + 4, ry + rh - 5, rw - 8, 1, '#e8b04a');
    R(rx + 4, ry + 4, 1, rh - 8, '#e8b04a'); R(rx + rw - 5, ry + 4, 1, rh - 8, '#e8b04a');
    for (let i = 0; i < 5; i++) {
      const cx = rx + 16 + i * 12, cy = ry + rh / 2;
      R(cx - 1, cy - 3, 3, 7, '#e8b04a'); R(cx - 3, cy - 1, 7, 3, '#e8b04a'); R(cx, cy - 1, 1, 3, '#7a2b2b'); R(cx - 1, cy, 3, 1, '#7a2b2b');
    }
    for (let i = rx; i < rx + rw; i += 2) { R(i, ry - 1, 1, 1, '#e8d8b0'); R(i, ry + rh, 1, 1, '#e8d8b0'); }
  }

  function resize() {
    if (!S.wrap) return;
    const cw = S.wrap.clientWidth, ch = S.wrap.clientHeight;
    if (!cw || !ch) return;
    let scale = Math.min(cw / W, ch / S.H);
    if (scale < (cw / W) * 0.72) scale = cw / W; // too tall to fit: fill the width and let it scroll
    S.scale = scale;
    S.stage.style.width = Math.floor(W * scale) + 'px';
    S.stage.style.height = Math.floor(S.H * scale) + 'px';
    for (const a of S.agents.values()) a._tr = '';
  }

  const nearest = (arr, v) => arr.reduce((b, x) => (Math.abs(x - v) < Math.abs(b - v) ? x : b), arr[0]);

  function route(from, to) {
    if (from.y >= S.LT - 6 && to.y >= S.LT - 6) return [{ x: to.x, y: to.y }];
    if (Math.abs(from.y - to.y) < 1 && S.corridors.some((c) => Math.abs(c - from.y) < 1)) return [{ x: to.x, y: to.y }];
    const A = nearest(AISLES, from.x), B = nearest(AISLES, to.x);
    const cy = nearest(S.corridors.concat([S.LT + 40]), to.y);
    const pts = [{ x: A, y: from.y }, { x: A, y: cy }, { x: B, y: cy }, { x: B, y: to.y }, { x: to.x, y: to.y }];
    const out = [];
    let px = from.x, py = from.y;
    for (const p of pts) {
      if (Math.abs(p.x - px) + Math.abs(p.y - py) > 0.5) { out.push(p); px = p.x; py = p.y; }
    }
    return out;
  }

  const seatOf = (d) => ({ x: d.cx, y: d.ty + 7 });
  function wanderSpot() {
    return Math.random() < 0.65
      ? { x: rnd(84, 150), y: rnd(S.LT + 14, S.LT + 50) }
      : { x: rnd(20, 236), y: pick(S.corridors) };
  }
  function releaseSpots(a) { for (const p of S.pois) if (p.occ === a.id) p.occ = null; }
  function freePoi(filter) {
    const free = S.pois.filter((p) => !p.occ && filter(p));
    return free.length ? pick(free) : null;
  }

  function emote(a, icon, dur = 2.6) { a.emote = { icon, until: S.now + dur }; }

  function go(a, dest, task) {
    a.path = route(a, dest);
    a.task = Object.assign(task, { dest, arrived: false });
    if (task.poi) task.poi.occ = a.id;
  }

  function think(a) {
    releaseSpots(a);
    a.pose = null;
    a.sleeping = false;
    const desk = S.desks[a.deskIndex];
    if (a.want.working && desk) {
      if (a.seated) { a.task = { kind: 'desk', until: Infinity, arrived: true }; return; }
      return go(a, seatOf(desk), { kind: 'desk', until: Infinity });
    }
    a.seated = false;
    if (a.pendingDeliver) { a.pendingDeliver = false; return go(a, S.bin.stand, { kind: 'deliver', dur: 1.8 }); }
    if (a.want.paused) {
      const seat = freePoi((p) => p.seat != null);
      return go(a, seat || wanderSpot(), { kind: 'sleep', poi: seat, until: Infinity });
    }
    const r = Math.random();
    if (r < 0.55) {
      const poi = freePoi(() => true);
      if (poi) return go(a, poi, { kind: 'poi', poi, dur: rnd(5, 12) });
    }
    if (r < 0.7 && desk) return go(a, seatOf(desk), { kind: 'deskIdle', dur: rnd(6, 14) });
    return go(a, wanderSpot(), { kind: 'wander', dur: rnd(1.5, 4) });
  }

  function arrive(a) {
    const tk = a.task;
    tk.arrived = true;
    if (tk.until !== Infinity) tk.until = S.now + (tk.dur || 3);
    switch (tk.kind) {
      case 'desk':
        a.seated = true;
        break;
      case 'deskIdle':
        a.seated = true;
        emote(a, pick(['dots', 'book', 'q']));
        break;
      case 'poi':
        if (tk.poi.seat != null) a.pose = { couch: tk.poi.seat };
        emote(a, tk.poi.emote);
        break;
      case 'sleep':
        a.sleeping = true;
        if (tk.poi && tk.poi.seat != null) a.pose = { couch: tk.poi.seat };
        break;
      case 'deliver':
        S.binOpenUntil = S.now + 1.3;
        for (let i = 0; i < 12; i++) {
          spawn({ kind: 'spark', x: S.bin.x + 10 + rnd(-7, 7), y: S.bin.base - 14 + rnd(-4, 2), vx: rnd(-10, 10), vy: rnd(-24, -8), life: rnd(0.6, 1.2), color: pick(['#fff3a0', '#f2c14e', '#ffffff']) });
        }
        emote(a, a.want.error ? 'bang' : 'check');
        break;
      default:
        if (Math.random() < 0.35) emote(a, pick(['dots', 'note', 'heart', 'q']));
    }
  }

  function updateAgent(a, dt) {
    const now = S.now;
    if (a.replan) {
      a.replan = false;
      if (!(a.want.working && a.seated && a.task && a.task.kind === 'desk')) { a.task = null; a.path = []; }
    }
    if (a.path.length) {
      a.seated = false; a.pose = null; a.sleeping = false;
      const p = a.path[0];
      const dx = p.x - a.x, dy = p.y - a.y, dist = Math.hypot(dx, dy), step = SPEED * dt;
      if (dist <= step) { a.x = p.x; a.y = p.y; a.path.shift(); }
      else { a.x += (dx / dist) * step; a.y += (dy / dist) * step; }
      a.walkT += dt;
      a.moving = true;
      return;
    }
    a.moving = false;
    if (a.task && !a.task.arrived) arrive(a);
    if (!a.task || now >= a.task.until) { a.task = null; think(a); }

    if (now > a.nextEmote) {
      a.nextEmote = now + rnd(5, 9);
      if (a.want.error && !a.sleeping && Math.random() < 0.6) emote(a, 'bang');
      else if (a.seated && a.want.working && Math.random() < 0.4) emote(a, pick(['gear', 'dots', 'star']));
    }
    if (a.sleeping && now > a.nextZ) {
      a.nextZ = now + 1.2;
      spawn({ kind: 'z', x: headX(a) + 3, y: topOf(a) - 3, vx: 3, vy: -7, life: 2, color: '#3a6fd8' });
    }
    if (a.seated && a.want.working && now > a.nextBit) {
      a.nextBit = now + 0.18;
      const d = S.desks[a.deskIndex];
      spawn({ x: d.cx - 13 + rnd(0, 7), y: d.ty - 6, vx: rnd(-3, 3), vy: rnd(-16, -9), life: rnd(0.7, 1.2), color: pick(['#7cfc9a', '#8ae3ff', '#fff3a0']) });
    }
  }

  function headX(a) {
    if (a.seated) return S.desks[a.deskIndex].cx;
    if (a.pose) return S.seats[a.pose.couch].x;
    return Math.round(a.x);
  }
  function topOf(a) {
    if (a.seated) return S.desks[a.deskIndex].ty - 11;
    if (a.pose) return S.couch.y - 4;
    return Math.round(a.y) - 18 - (a.moving && Math.floor(a.walkT * 7) % 2 ? 1 : 0);
  }
  function footY(a) {
    if (a.seated) return S.desks[a.deskIndex].ty + 17;
    if (a.pose) return S.couch.y + 26;
    return a.y + 1;
  }

  function createAgent(info) {
    const look = lookFor(info.id, info.look);
    const a = {
      id: info.id, name: info.name, look, lookKey: JSON.stringify(info.look || null), sprites: buildSprites(look), level: 0,
      x: rnd(84, 150), y: S.LT + rnd(16, 46), path: [], task: null, seated: false, pose: null, sleeping: false,
      emote: null, want: {}, phase: Math.random() * 10, blinkOffset: Math.random() * 4,
      nextEmote: S.now + rnd(2, 6), nextZ: 0, nextBit: 0, pendingDeliver: false, walkT: 0, deskIndex: 0, moving: false,
    };
    a.tag = document.createElement('div');
    a.tag.className = 'tag';
    a.tagLv = document.createElement('span');
    a.tagLv.className = 'lv';
    a.tagName = document.createElement('span');
    a.tag.append(a.tagLv, a.tagName);
    S.tagsEl.append(a.tag);
    return a;
  }

  /* ---------- public API ---------- */

  function setAgents(list) {
    const needLayout = Math.max(list.length, 3) !== S.desks.length;
    if (needLayout) layout(list.length);
    const seen = new Set();
    list.forEach((info, i) => {
      seen.add(info.id);
      let a = S.agents.get(info.id);
      if (!a) { a = createAgent(info); S.agents.set(info.id, a); }
      const key = JSON.stringify(info.look || null);
      if (a.lookKey !== key) { a.lookKey = key; a.look = lookFor(a.id, info.look); a.sprites = buildSprites(a.look); }
      a.name = info.name;
      a.level = info.level || 0;
      a.statusText = info.status || '';
      const want = { working: !!info.working, paused: !!info.paused && !info.working, error: !!info.error };
      if (a.want.working && !want.working) {
        if (a.id === 'hermes') emote(a, 'heart');
        else a.pendingDeliver = true;
      }
      if (want.working !== a.want.working || want.paused !== a.want.paused) a.replan = true;
      a.want = want;
      a.deskIndex = i;
    });
    for (const [id, a] of S.agents) {
      if (!seen.has(id)) { a.tag.remove(); releaseSpots(a); S.agents.delete(id); }
    }
    for (const d of S.desks) d.agent = null;
    for (const a of S.agents.values()) { const d = S.desks[a.deskIndex]; if (d) d.agent = a; }
    if (needLayout) {
      for (const a of S.agents.values()) {
        releaseSpots(a);
        a.path = []; a.task = null; a.seated = false; a.pose = null;
        a.x = clamp(a.x, 8, W - 8); a.y = clamp(a.y, WALL_H + 8, S.H - 4);
        a.replan = true;
      }
      if (S.dog) { S.dog.y = clamp(S.dog.y, WALL_H + 10, S.H - 4); S.dog.target = null; S.dog.follow = null; }
    }
    S.notes = list.filter((x) => x.id !== 'hermes').map((x) => ({
      color: x.working ? '#b5ec8a' : x.paused ? '#d9d2c0' : x.error ? '#f4a09a' : '#fbe9a0',
    }));
  }

  function updateTag(a) {
    const txt = a.name + (a.statusText ? ' · ' + a.statusText : '');
    const lv = a.level ? `Lv${a.level}` : '';
    if (a._txt !== txt || a._lv !== lv) {
      a.tagName.textContent = txt;
      a.tagLv.textContent = lv;
      a.tagLv.hidden = !lv;
      a._txt = txt; a._lv = lv; a._w = 0;
    }
    const cls = 'tag' + (a.want.working ? ' is-working' : a.want.paused ? ' is-paused' : '') +
      (a.want.error ? ' is-error' : '') + (a.id === 'hermes' ? ' is-hermes' : '');
    if (a._cls !== cls) { a.tag.className = cls; a._cls = cls; a._w = 0; }
    if (!a._w) a._w = a.tag.offsetWidth;
    // Keep the whole tag inside the room so edge desks don't clip their labels.
    const half = a._w / 2 + 2;
    const cx = clamp(headX(a) * S.scale, half, Math.max(half, W * S.scale - half));
    const tr = `translate(${(cx - a._w / 2).toFixed(1)}px, ${(footY(a) * S.scale).toFixed(1)}px)`;
    if (a._tr !== tr) { a.tag.style.transform = tr; a._tr = tr; }
  }

  function floatText(id, text) {
    let x, y;
    if (id === 'dog') { x = S.dog.x; y = S.dog.y - 14; }
    else {
      const a = S.agents.get(id);
      if (!a) return;
      x = headX(a); y = topOf(a) - 3;
    }
    const n = document.createElement('div');
    n.className = 'float-xp';
    n.textContent = text;
    n.style.setProperty('--x', `${(clamp(x, 16, W - 16) * S.scale).toFixed(1)}px`);
    n.style.setProperty('--y', `${(Math.max(y, 8) * S.scale).toFixed(1)}px`);
    S.tagsEl.append(n);
    setTimeout(() => n.remove(), 2100);
  }

  function levelUp(id) {
    const a = S.agents.get(id);
    if (!a) return;
    const x = headX(a), y = topOf(a) + 6;
    for (let i = 0; i < 24; i++) {
      const ang = (i / 24) * Math.PI * 2;
      spawn({ kind: 'spark', x: x + Math.cos(ang) * 3, y: y + Math.sin(ang) * 3, vx: Math.cos(ang) * 24, vy: Math.sin(ang) * 24 - 8, life: 1.2, color: pick(['#fff3a0', '#f2c14e', '#ffffff', '#9ee05a']) });
    }
    emote(a, 'star', 3.5);
  }

  function hit(wx, wy) {
    let best = null, by = -Infinity;
    for (const a of S.agents.values()) {
      const hx = headX(a), top = topOf(a), bottom = a.seated ? S.desks[a.deskIndex].ty + 16 : footY(a);
      if (wx >= hx - 10 && wx <= hx + 10 && wy >= top - 4 && wy <= bottom + 4 && bottom > by) { best = a; by = bottom; }
    }
    if (best) return best.id;
    const d = S.dog;
    if (Math.abs(wx - d.x) < 11 && wy > d.y - 14 && wy < d.y + 3) return 'dog';
    for (const desk of S.desks) {
      if (desk.agent && wx >= desk.cx - 16 && wx <= desk.cx + 16 && wy >= desk.ty - 12 && wy <= desk.ty + 17) return desk.agent.id;
    }
    return null;
  }

  function onClick(e) {
    const rect = S.canvas.getBoundingClientRect();
    const wx = ((e.clientX - rect.left) * W) / rect.width;
    const wy = ((e.clientY - rect.top) * S.H) / rect.height;
    const id = hit(wx, wy);
    if (id === 'dog') petDog();
    if (id && S.onTap) S.onTap(id);
  }

  function frame(ts) {
    S.raf = requestAnimationFrame(frame);
    const dt = S.last ? Math.min(0.05, (ts - S.last) / 1000) : 0;
    S.last = ts;
    S.now += dt;
    const t = S.now;
    const date = new Date();
    const sky = skyAt(date);
    S.dark = sky.dark;

    for (const a of S.agents.values()) updateAgent(a, dt);
    updateDog(dt, t);

    const coffeePoi = S.pois.find((p) => p.id === 'coffee');
    S.coffeeBusy = !!(coffeePoi && coffeePoi.occ && S.agents.get(coffeePoi.occ) && !S.agents.get(coffeePoi.occ).moving);
    if (Math.random() < (S.coffeeBusy ? 0.25 : 0.04)) {
      spawn({ x: S.counter.x + 11 + rnd(-1, 1), y: S.counter.base - 30, vx: rnd(-2, 2), vy: rnd(-8, -4), life: 1.4, color: '#e8e8e8' });
    }

    g = S.ctx;
    g.imageSmoothingEnabled = false;
    g.drawImage(S.bg, 0, 0);
    drawWindow(18, 8, 40, 24, sky, t, 1);
    drawWindow(168, 8, 40, 24, sky, t, 5);
    drawClock(72, 18, date);
    drawBoard(84, 8);

    const arcadePoi = S.pois.find((p) => p.arcade);
    const playing = !!(arcadePoi && arcadePoi.occ && S.agents.get(arcadePoi.occ) && !S.agents.get(arcadePoi.occ).moving);
    const drawables = [
      { y: 60, draw: () => drawBookshelf(134, 26) },
      { y: 62, draw: () => drawArcade(226, 34, t, playing) },
      { y: 62, draw: () => drawTallPlant(2, 62) },
      { y: S.couch.y + 24, draw: () => drawCouch(t) },
      { y: S.bin.base, draw: drawBin },
      { y: S.counter.base, draw: drawCounter },
      { y: S.LT + 34, draw: () => drawMarigoldPot(64, S.LT + 34) },
      { y: S.dog.y, draw: () => paintDog(S.dog, Math.round(S.dog.x), Math.round(S.dog.y), t) },
    ];
    for (const d of S.desks) drawables.push({ y: d.ty + DESK_H, draw: () => drawDeskUnit(d, t) });
    for (const a of S.agents.values()) {
      if (a.seated || a.pose) continue;
      drawables.push({
        y: a.y,
        draw: () => {
          const fr = !a.moving ? 'stand' : Math.floor(a.walkT * 7) % 2 ? 'walkA' : 'walkB';
          drawCharAt(a, Math.round(a.x) - 6, topOf(a), fr, t);
        },
      });
    }
    drawables.sort((p, q) => p.y - q.y).forEach((o) => o.draw());

    for (const a of S.agents.values()) {
      if (a.emote && t < a.emote.until) bubble(headX(a), topOf(a), a.emote.icon);
    }
    if (t < S.dog.bubbleUntil) bubble(S.dog.x + S.dog.dir * 4, S.dog.y - 10, 'heart');
    drawParticles(dt);
    lighting(sky, playing);
    for (const a of S.agents.values()) updateTag(a);
  }

  function lighting(sky, playing) {
    const d = sky.dark * 0.42;
    if (d <= 0.01) return;
    g.fillStyle = `rgba(16,20,60,${d.toFixed(3)})`;
    g.fillRect(0, 0, W, S.H);
    g.globalCompositeOperation = 'lighter';
    const glow = (x, y, r, a) => {
      const gr = g.createRadialGradient(x, y, 1, x, y, r);
      gr.addColorStop(0, `rgba(255,190,110,${a})`);
      gr.addColorStop(1, 'rgba(255,190,110,0)');
      g.fillStyle = gr;
      g.fillRect(x - r, y - r, r * 2, r * 2);
    };
    glow(64, 80, 70, 0.10 * sky.dark);
    glow(192, 80, 70, 0.10 * sky.dark);
    glow(128, S.LT + 30, 80, 0.12 * sky.dark);
    for (const dsk of S.desks) {
      if (dsk.agent && dsk.agent.seated && dsk.agent.want.working) glow(dsk.cx - 10, dsk.ty - 4, 26, 0.24 * sky.dark);
    }
    if (playing) glow(233, 45, 18, 0.2 * sky.dark);
    g.globalCompositeOperation = 'source-over';
  }

  function init(opts) {
    S.canvas = opts.canvas;
    S.ctx = S.canvas.getContext('2d');
    S.stage = opts.stage;
    S.wrap = opts.wrap;
    S.tagsEl = opts.tags;
    S.onTap = opts.onTap;
    S.books = makeBooks();
    layout(0);
    S.dog = { x: 112, y: S.LT + 32, dir: 1, target: null, until: 3, sleep: false, nextZ: 0, moving: false, happy: false, happyUntil: 0, bubbleUntil: 0, follow: null, followUntil: 0 };
    new ResizeObserver(resize).observe(S.wrap);
    S.stage.addEventListener('click', onClick);
    document.addEventListener('visibilitychange', () => {
      cancelAnimationFrame(S.raf);
      if (!document.hidden) { S.last = 0; S.raf = requestAnimationFrame(frame); }
    });
    S.raf = requestAnimationFrame(frame);
  }

  // Head-and-shoulders portrait, or the whole body when `full` is set (used while customizing).
  function drawPortrait(canvas, id, look, full) {
    const prev = g;
    g = canvas.getContext('2d');
    if (id === 'dog') {
      canvas.width = 18; canvas.height = 14;
      g.imageSmoothingEnabled = false;
      g.clearRect(0, 0, 18, 14);
      paintDog({ dir: 1, sleep: false, moving: false, happy: true }, 8, 13, 0);
      g = prev;
      return;
    }
    const L = lookFor(id, look);
    const sprites = buildSprites(L);
    const h = full ? 18 : 12;
    canvas.width = 14;
    canvas.height = h + 2;
    g.imageSmoothingEnabled = false;
    g.clearRect(0, 0, 14, h + 2);
    g.drawImage(sprites.stand, 0, 0, 12, h, 1, 1, 12, h);
    face({ look: L, sleeping: false, blinkOffset: 1 }, 1, 1, 0);
    g = prev;
  }

  /* ---------- title screen ---------- */

  function title(canvas) {
    const ctx = canvas.getContext('2d');
    const hermes = { look: lookFor('hermes'), sleeping: false, blinkOffset: 0.5 };
    hermes.sprites = buildSprites(hermes.look);
    const pup = { dir: -1, sleep: false, moving: false, happy: true };
    const clouds = Array.from({ length: 5 }, (_, i) => ({ x: i * 44 + rnd(0, 20), y: rnd(8, 46), s: rnd(2, 5), big: Math.random() < 0.5 }));
    const birds = [];
    let raf = 0;

    function bigCloud(x, y, big) {
      R(x + 4, y, 10, 2, '#ffffff'); R(x + 1, y + 2, 18, 3, '#ffffff'); R(x, y + 5, 22, 2, '#eaf6fd');
      if (big) { R(x + 12, y - 3, 10, 3, '#ffffff'); R(x + 18, y + 1, 10, 5, '#ffffff'); R(x + 18, y + 6, 10, 1, '#eaf6fd'); }
    }
    function tree(x, base) {
      R(x - 1, base - 5, 3, 5, '#6b3d1f');
      R(x - 6, base - 16, 13, 11, OUT);
      R(x - 5, base - 15, 11, 9, '#2f6a33'); R(x - 4, base - 15, 8, 7, '#3a7a35'); R(x - 3, base - 14, 3, 2, '#5ba044');
    }

    function draw(ts) {
      raf = requestAnimationFrame(draw);
      const t = ts / 1000;
      const w = 160;
      const h = Math.max(100, Math.round((w * canvas.clientHeight) / Math.max(1, canvas.clientWidth)));
      if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
      g = ctx;
      g.imageSmoothingEnabled = false;
      const bands = 10;
      for (let i = 0; i < bands; i++) R(0, Math.floor((i * h) / bands), w, Math.ceil(h / bands) + 1, mix('#3f8fe0', '#c6ecfa', i / (bands - 1)));
      R(w - 34, 14, 12, 12, '#fff3a0'); R(w - 36, 16, 16, 8, '#fff3a0'); R(w - 32, 12, 8, 16, '#fff3a0');
      for (const c of clouds) bigCloud(Math.round(((c.x + t * c.s) % (w + 50)) - 30), Math.round(c.y), c.big);

      if (Math.random() < 0.004 && birds.length < 3) birds.push({ x: -6, y: rnd(20, h * 0.4), s: rnd(10, 18) });
      for (const b of birds) {
        b.x += b.s / 60;
        const up = Math.floor(t * 5 + b.y) % 2;
        const bx = Math.round(b.x), by = Math.round(b.y);
        if (up) { R(bx, by, 1, 1, '#2b2b3a'); R(bx + 1, by + 1, 1, 1, '#2b2b3a'); R(bx + 2, by, 1, 1, '#2b2b3a'); }
        else { R(bx, by + 1, 1, 1, '#2b2b3a'); R(bx + 1, by, 1, 1, '#2b2b3a'); R(bx + 2, by + 1, 1, 1, '#2b2b3a'); }
      }
      for (let i = birds.length - 1; i >= 0; i--) if (birds[i].x > w + 5) birds.splice(i, 1);

      const horizon = h - 44;
      for (let x = 0; x < w; x++) {
        const y1 = horizon - 12 + Math.round(Math.sin(x / 23) * 5 + Math.sin(x / 9 + 1) * 2);
        R(x, y1, 1, h - y1, '#86c46b');
      }
      const near = (x) => horizon + Math.round(Math.sin(x / 31 + 2) * 4 + Math.sin(x / 13) * 2);
      for (let x = 0; x < w; x++) R(x, near(x), 1, h - near(x), '#4f9a45');
      for (const tx of [12, 30, 118, 138, 152]) tree(tx, near(tx) + 2);
      R(0, h - 22, w, 22, '#5ba044'); R(0, h - 22, w, 1, '#8fd16a');
      for (let x = 3; x < w; x += 11) { R(x, h - 12 + (x % 5), 1, 2, '#3a7a35'); R(x + 1, h - 13 + (x % 5), 1, 3, '#3a7a35'); }
      for (let x = 4; x < w; x += 16) { R(x - 1, h - 33, 5, 13, OUT); R(x, h - 32, 3, 12, '#c98646'); R(x, h - 32, 3, 1, '#e0a060'); }
      R(0, h - 29, w, 2, '#b8733c'); R(0, h - 24, w, 2, '#b8733c');
      // a field of marigolds in front of the fence
      for (let x = 5, i = 0; x < w; x += 9, i++) {
        const y = h - 16 + (i % 3) * 3;
        R(x + 1, y + 3, 1, 3, '#3a7a35');
        marigold(x, y);
      }

      const hx = Math.round(w * 0.5) - 6, hy = h - 38 + (Math.floor(t * 2) % 2);
      g.drawImage(hermes.sprites.stand, hx, hy);
      face(hermes, hx, hy, t);
      if (Math.floor(t * 3) % 2) R(hx - 1, hy + 9, 1, 2, hermes.look.skin); // wave
      paintDog(pup, hx + 24, h - 20, t);
    }
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }

  window.Office = {
    init,
    setAgents,
    drawPortrait,
    title,
    floatText,
    levelUp,
    petDog,
    defaultLook: (id) => baseLook(id),
    palette: { skin: SKIN, hair: HAIR, shirt: SHIRT, pants: PANTS, styles: STYLE_OPTIONS },
    emote(id, icon) { const a = S.agents.get(id); if (a) emote(a, icon); },
    pulse(id, kind) {
      const a = S.agents.get(id);
      if (!a || kind !== 'done') return;
      if (a.id === 'hermes') { emote(a, 'heart'); return; }
      if (!a.want.working && !a.pendingDeliver) { a.pendingDeliver = true; if (!a.seated) a.replan = true; }
    },
  };
})();
