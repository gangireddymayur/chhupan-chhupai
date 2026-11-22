// Drawing the village. The map that never moves (ground, houses, furniture, trees) is drawn once into a big
// picture. Every frame we only draw that picture, the moving things (people, smoke, fireflies) and the night lights.
import { TW, TH, ZS, iso, isoV, toView, faceVisible, hash, shade, rgba, fillPoly, line, quad, prism, groundEllipse, cylinder, vcircle } from './iso.js';
import { N, T } from './village.js';

// walls: back walls go full height (taller than a person), front walls are cut low so we can see inside
export const WALL_LOW = 22, WALL_FULL = 68;
const PAD = 90, TOP = 280;
export const WORLD = { w: N * TW + PAD * 2, h: N * TH + TOP + PAD + 40, ox: (N * TW) / 2 + PAD, oy: TOP };

const FLOOR = {
  bedroom: '#8f938a', kitchen: '#93412f', hall: '#a69681', puja: '#ddd5c4', bath: '#5d8ea3', aangan: '#8f836b',
  shop: '#817d73', store: '#716655', shed: '#6c5737', class: '#8d877a',
};
const FLAT = new Set(['rangoli', 'rug']);

// ---------------------------------------------------------------- static picture
export function renderStatic(v, scale, wallMode = 'cut') {
  const c = document.createElement('canvas');
  c.width = Math.ceil(WORLD.w * scale);
  c.height = Math.ceil(WORLD.h * scale);
  const ctx = c.getContext('2d');
  ctx.setTransform(scale, 0, 0, scale, WORLD.ox * scale, WORLD.oy * scale);
  ctx.lineJoin = 'round';

  // the slab of earth under the village, so it reads like a diorama
  prism(ctx, 0, 0, N, N, -38, 0, '#4b3b29', { left: '#2f251a', right: '#3d3022' });
  for (let k = 1; k < 4; k++) {
    line(ctx, iso(0, N, -k * 9), iso(N, N, -k * 9), 'rgba(0,0,0,0.18)', 1);
    line(ctx, iso(N, 0, -k * 9), iso(N, N, -k * 9), 'rgba(0,0,0,0.18)', 1);
  }

  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) drawTile(ctx, v, x, y);
  for (const o of v.objects) if (FLAT.has(o.kind)) DRAW[o.kind](ctx, o);

  // things are drawn from the back of the view to the front
  const vkey = (x, y) => { const [a, b] = toView(x, y); return a + b; };
  const solids = [];
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) if (v.tiles[y][x].t === T.WALL) solids.push({ kind: 'wall', x, y, key: vkey(x + 0.5, y + 0.5) });
  for (const o of v.objects) {
    if (FLAT.has(o.kind)) continue;
    solids.push({ ...o, key: vkey(o.x + (o.w || 0) / 2, o.y + (o.d || 0) / 2) + (o.bias || 0) });
  }
  solids.sort((a, b) => a.key - b.key);
  const bounds = houseBounds(v);
  for (const o of solids) {
    if (o.kind === 'wall') drawWall(ctx, v, o.x, o.y, wallMode, bounds);
    else DRAW[o.kind](ctx, o);
  }

  // electric wires between the poles
  for (const chain of v.wires) {
    for (let i = 0; i + 1 < chain.length; i++) {
      const [ax, ay] = chain[i], [bx, by] = chain[i + 1];
      for (const dz of [0, 5]) {
        const a = iso(ax, ay, 112 - dz), b = iso(bx, by, 112 - dz);
        ctx.beginPath(); ctx.moveTo(a[0], a[1]);
        ctx.quadraticCurveTo((a[0] + b[0]) / 2, (a[1] + b[1]) / 2 + 22, b[0], b[1]);
        ctx.strokeStyle = 'rgba(18,18,22,0.85)'; ctx.lineWidth = 1; ctx.stroke();
      }
    }
  }
  c.solids = solids; c.bounds = bounds; c.wallMode = wallMode;
  return c;
}

// Draw one wall or object again, live. Used to put things that are IN FRONT of a person back on top of them.
export function drawSolid(ctx, v, o, wallMode, bounds) {
  if (o.kind === 'wall') drawWall(ctx, v, o.x, o.y, wallMode, bounds);
  else DRAW[o.kind](ctx, o);
}

// ---------------------------------------------------------------- ground tiles
function speckle(ctx, x, y, n, colors, seed) {
  for (let i = 0; i < n; i++) {
    const [sx, sy] = iso(x + 0.1 + 0.8 * hash(x, y, seed * 10 + i), y + 0.1 + 0.8 * hash(x, y, seed * 10 + i + 50));
    ctx.fillStyle = colors[i % colors.length];
    ctx.fillRect(sx - 0.9, sy - 0.6, 1.8, 1.2);
  }
}
function tufts(ctx, x, y, c) {
  ctx.strokeStyle = c; ctx.lineWidth = 1; ctx.beginPath();
  for (let i = 0; i < 3; i++) {
    const [sx, sy] = iso(x + 0.15 + 0.7 * hash(x, y, i + 3), y + 0.15 + 0.7 * hash(x, y, i + 9));
    ctx.moveTo(sx - 2, sy); ctx.lineTo(sx - 1, sy - 4);
    ctx.moveTo(sx, sy); ctx.lineTo(sx + 0.5, sy - 5);
    ctx.moveTo(sx + 2, sy); ctx.lineTo(sx + 2.6, sy - 3.5);
  }
  ctx.stroke();
}
function grid(ctx, x, y, n, color, lw = 1, z = 0) {
  ctx.strokeStyle = color; ctx.lineWidth = lw; ctx.beginPath();
  for (let i = 1; i < n; i++) {
    const f = i / n;
    let a = iso(x + f, y, z), b = iso(x + f, y + 1, z); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]);
    a = iso(x, y + f, z); b = iso(x + 1, y + f, z); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]);
  }
  ctx.stroke();
}

function drawFloor(ctx, x, y, type) {
  quad(ctx, x, y, x + 1, y + 1, 0, FLOOR[type] || '#999', 'rgba(0,0,0,0.12)');
  switch (type) {
    case 'kitchen': grid(ctx, x, y, 2, 'rgba(0,0,0,0.2)'); break;            // red oxide floor
    case 'bath': grid(ctx, x, y, 3, 'rgba(255,255,255,0.28)'); break;        // small tiles
    case 'puja': grid(ctx, x, y, 2, 'rgba(150,135,110,0.4)'); break;          // marble
    case 'aangan': grid(ctx, x, y, 2, 'rgba(0,0,0,0.22)', 1.2); break;        // stone slabs
    case 'shed': {
      ctx.strokeStyle = 'rgba(214,176,96,0.6)'; ctx.lineWidth = 1; ctx.beginPath();
      for (let i = 0; i < 7; i++) {
        const [sx, sy] = iso(x + hash(x, y, i), y + hash(x, y, i + 20));
        const a = hash(x, y, i + 40) * Math.PI;
        ctx.moveTo(sx, sy); ctx.lineTo(sx + Math.cos(a) * 6, sy + Math.sin(a) * 3);
      }
      ctx.stroke(); break;
    }
    case 'class': case 'shop': case 'store': grid(ctx, x, y, 2, 'rgba(0,0,0,0.1)'); break;
    default: speckle(ctx, x, y, 8, ['#d2c8b6', '#6b645a', '#b48f6a'], 3);   // terrazzo / mosaic
  }
}

function drawTile(ctx, v, x, y) {
  const t = v.tiles[y][x], h = hash(x, y);
  const edge = 'rgba(0,0,0,0.07)';
  switch (t.t) {
    case T.GROUND: {
      const grassy = h < 0.45;
      quad(ctx, x, y, x + 1, y + 1, 0, grassy ? (h < 0.2 ? '#56743c' : '#5f7d43') : (h < 0.75 ? '#7d6a4b' : '#87724f'), edge);
      if (grassy) tufts(ctx, x, y, '#80a359'); else speckle(ctx, x, y, 4, ['#a08b69', '#665640'], 1);
      break;
    }
    case T.SHOULDER:
      quad(ctx, x, y, x + 1, y + 1, 0, h < 0.5 ? '#8a7556' : '#857153', edge);
      speckle(ctx, x, y, 5, ['#ab9672', '#6b5a42'], 2);
      break;
    case T.ROAD: {
      quad(ctx, x, y, x + 1, y + 1, 0, h < 0.5 ? '#3b3e44' : '#3f4249', null);
      if (h > 0.72) groundEllipse(ctx, x + 0.3 + h * 0.35, y + 0.5, 0.17, 0, '#33353a');
      const chowk = x === 16 || x === 17;
      if (!chowk && y === 17 && x % 2 === 0) line(ctx, iso(x + 0.15, 17.5), iso(x + 0.85, 17.5), '#e9e1c4', 2.4);
      if (!chowk && y === 16) line(ctx, iso(x, 16.1), iso(x + 1, 16.1), 'rgba(230,222,190,0.5)', 1.4);
      if (!chowk && y === 18) line(ctx, iso(x, 18.9), iso(x + 1, 18.9), 'rgba(230,222,190,0.5)', 1.4);
      if (chowk && (x === 15 || x === 16)) {
        // zebra crossing on the left side of the chowk
        for (let i = 0; i < 5; i++) { const f = 0.1 + i * 0.18; quad(ctx, x + f, y + 0.05, x + f + 0.09, y + 0.95, 0, 'rgba(235,230,210,0.55)'); }
      }
      break;
    }
    case T.CC:
      quad(ctx, x, y, x + 1, y + 1, 0, h < 0.5 ? '#9d998f' : '#a29e94', edge);
      if (y % 3 === 0) line(ctx, iso(x, y), iso(x + 1, y), '#7b776d', 1.2);
      if (x === 17) line(ctx, iso(17, y), iso(17, y + 1), '#86827a', 1);
      if (h > 0.86) line(ctx, iso(x + 0.3, y + 0.2), iso(x + 0.55, y + 0.6), 'rgba(60,55,50,0.6)', 0.8);
      break;
    case T.GULLY: {
      quad(ctx, x, y, x + 1, y + 1, 0, h < 0.5 ? '#867b67' : '#8c816c', null);
      const vert = t.dir === 'v';
      ctx.strokeStyle = 'rgba(40,34,26,0.35)'; ctx.lineWidth = 1; ctx.beginPath();
      for (let i = 1; i < 4; i++) {
        const f = i / 4;
        const a = vert ? iso(x, y + f) : iso(x + f, y), b = vert ? iso(x + 0.8, y + f) : iso(x + f, y + 0.8);
        ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]);
      }
      const m = vert ? [iso(x + 0.4, y), iso(x + 0.4, y + 1)] : [iso(x, y + 0.4), iso(x + 1, y + 0.4)];
      ctx.moveTo(m[0][0], m[0][1]); ctx.lineTo(m[1][0], m[1][1]);
      ctx.stroke();
      // open drain (nala) along one side, with a few cover slabs
      if (vert) quad(ctx, x + 0.8, y, x + 1, y + 1, 0, '#23221e'); else quad(ctx, x, y + 0.8, x + 1, y + 1, 0, '#23221e');
      if (h > 0.6) { if (vert) quad(ctx, x + 0.8, y + 0.3, x + 1, y + 0.55, 0, '#77705f'); else quad(ctx, x + 0.3, y + 0.8, x + 0.55, y + 1, 0, '#77705f'); }
      break;
    }
    case T.FLOOR: drawFloor(ctx, x, y, t.floor); break;
    case T.DOOR: {
      drawFloor(ctx, x, y, t.floor);
      if (t.along === 'x') quad(ctx, x, y + 0.36, x + 1, y + 0.64, 0, '#6d4a2c');
      else quad(ctx, x + 0.36, y, x + 0.64, y + 1, 0, '#6d4a2c');
      break;
    }
    case T.WALL: quad(ctx, x, y, x + 1, y + 1, 0, '#a99c84', edge); break;
    case T.WATER: {
      quad(ctx, x, y, x + 1, y + 1, 0, h < 0.5 ? '#1b465e' : '#1d4b64', null);
      line(ctx, iso(x + 0.2, y + 0.5), iso(x + 0.5, y + 0.42), 'rgba(150,200,230,0.22)', 1);
      line(ctx, iso(x + 0.55, y + 0.8), iso(x + 0.85, y + 0.72), 'rgba(150,200,230,0.18)', 1);
      if (h > 0.7) {
        const lx = x + 0.25 + 0.5 * hash(x, y, 3), ly = y + 0.25 + 0.5 * hash(x, y, 4);
        groundEllipse(ctx, lx, ly, 0.13, 0, '#3e7a3c');
        if (h > 0.85) groundEllipse(ctx, lx + 0.04, ly - 0.02, 0.05, 1, '#f28bb5');
      }
      const isW = (a, b) => v.tiles[b]?.[a]?.t === T.WATER;
      const stone = '#8b8370';
      if (!isW(x - 1, y)) line(ctx, iso(x, y), iso(x, y + 1), stone, 3);
      if (!isW(x + 1, y)) line(ctx, iso(x + 1, y), iso(x + 1, y + 1), stone, 3);
      if (!isW(x, y - 1)) line(ctx, iso(x, y), iso(x + 1, y), stone, 3);
      if (!isW(x, y + 1)) line(ctx, iso(x, y + 1), iso(x + 1, y + 1), stone, 3);
      break;
    }
    case T.YARD:
      quad(ctx, x, y, x + 1, y + 1, 0, h < 0.5 ? '#9c8a68' : '#a08e6b', edge);
      speckle(ctx, x, y, 4, ['#bcab8b', '#7d6d52'], 4);
      break;
    case T.FIELD: {
      quad(ctx, x, y, x + 1, y + 1, 0, '#5d4a2e', edge);
      for (let k = 0; k < 4; k++) {
        const yy = y + 0.125 + k * 0.25;
        line(ctx, iso(x + 0.04, yy), iso(x + 0.96, yy), '#4b7a34', 3);
        for (let j = 0; j < 4; j++) { const [sx, sy] = iso(x + 0.12 + j * 0.25, yy); ctx.fillStyle = '#5f9442'; ctx.beginPath(); ctx.arc(sx, sy - 2, 2.2, 0, 7); ctx.fill(); }
      }
      break;
    }
  }
}

// ---------------------------------------------------------------- walls (cut low so we can see inside)
// for each house: its back edges in view space (the two sides furthest from the camera)
function houseBounds(v) {
  const b = {};
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const t = v.tiles[y][x];
    if (!t.house) continue;
    const [vx, vy] = toView(x + 0.5, y + 0.5).map(Math.floor);
    const h = b[t.house] || (b[t.house] = { minX: Infinity, minY: Infinity });
    h.minX = Math.min(h.minX, vx); h.minY = Math.min(h.minY, vy);
  }
  return b;
}

function drawWall(ctx, v, x, y, mode, bounds) {
  const t = v.tiles[y][x];
  const conn = (a, b) => { const q = v.tiles[b]?.[a]; return !!q && (q.t === T.WALL || q.t === T.DOOR) && q.house === t.house; };
  const L = conn(x - 1, y), R = conn(x + 1, y), U = conn(x, y - 1), D = conn(x, y + 1);
  let H = mode === 'full' ? WALL_FULL : WALL_LOW;
  if (mode === 'cut') {
    const [vx, vy] = toView(x + 0.5, y + 0.5).map(Math.floor), hb = bounds[t.house];
    if (vx === hb.minX || vy === hb.minY) H = WALL_FULL;
  }
  const a = 0.38, b = 0.62;
  const o = { top: H === WALL_FULL ? shade(t.color, -0.05) : '#f1e8d8', edge: 'rgba(0,0,0,0.2)', lw: 0.6 };
  if (U || D || !(L || R)) prism(ctx, x + a, U ? y : y + a, x + b, D ? y + 1 : y + b, 0, H, t.color, o);
  if (L || R) prism(ctx, L ? x : x + a, y + a, R ? x + 1 : x + b, y + b, 0, H, t.color, o);
}

// drawing on one side of a box: pick a side that faces the camera
function face(prefs) { return prefs.find(([a, b]) => faceVisible(a, b)) || null; }
const ALL = [[0, 1], [1, 0], [0, -1], [-1, 0]];
function fpt(x, y, w, d, n, t, z) {
  const [nx, ny] = n;
  if (ny === 1) return iso(x + w * t, y + d, z);
  if (ny === -1) return iso(x + w * t, y, z);
  if (nx === 1) return iso(x + w, y + d * t, z);
  return iso(x, y + d * t, z);
}
function facePoly(ctx, x, y, w, d, n, t0, t1, z0, z1, fill) {
  fillPoly(ctx, [fpt(x, y, w, d, n, t0, z0), fpt(x, y, w, d, n, t1, z0), fpt(x, y, w, d, n, t1, z1), fpt(x, y, w, d, n, t0, z1)], fill);
}

// ---------------------------------------------------------------- objects
const K = (cond, a, b) => (cond ? a : b);
function blob(ctx, x, y, rx, ry, fill, stroke) {
  ctx.beginPath(); ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
  if (fill) { ctx.fillStyle = fill; ctx.fill(); }
  if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = 0.8; ctx.stroke(); }
}
function shadow(ctx, x, y, r) { groundEllipse(ctx, x, y, r, 0, 'rgba(0,0,0,0.22)'); }

const DRAW = {
  rangoli(ctx, o) {
    const cx = o.x + 0.5, cy = o.y + 0.5;
    groundEllipse(ctx, cx, cy, 0.4, 0, '#e8478b');
    groundEllipse(ctx, cx, cy, 0.3, 0, '#ffd23f');
    groundEllipse(ctx, cx, cy, 0.2, 0, '#ff7b29');
    groundEllipse(ctx, cx, cy, 0.09, 0, '#ffffff');
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2 + (o.seed || 0);
      groundEllipse(ctx, cx + Math.cos(a) * 0.34, cy + Math.sin(a) * 0.34, 0.045, 0, i % 2 ? '#ffffff' : '#2ec4b6');
    }
  },
  rug(ctx, o) {
    quad(ctx, o.x, o.y, o.x + o.w, o.y + o.d, 0.5, o.color, 'rgba(0,0,0,0.25)');
    quad(ctx, o.x + 0.1, o.y + 0.1, o.x + o.w - 0.1, o.y + o.d - 0.1, 0.6, null, 'rgba(240,200,110,0.7)');
    quad(ctx, o.x + 0.25, o.y + 0.25, o.x + o.w - 0.25, o.y + o.d - 0.25, 0.6, null, 'rgba(240,200,110,0.4)');
  },
  bed(ctx, o) {
    const { x, y, w, d } = o, c = o.color || '#b8443f', alongY = d >= w;
    if (alongY) prism(ctx, x, y, x + w, y + 0.08, 0, 26, '#5a3820'); else prism(ctx, x, y, x + 0.08, y + d, 0, 26, '#5a3820');
    prism(ctx, x, y, x + w, y + d, 0, 9, '#6b4428');
    prism(ctx, x + 0.04, y + 0.04, x + w - 0.04, y + d - 0.04, 9, 15, '#ece6da');
    if (alongY) {
      prism(ctx, x + 0.12, y + 0.1, x + w - 0.12, y + 0.32, 15, 19, '#f7f3ea');
      prism(ctx, x + 0.03, y + d * 0.4, x + w - 0.03, y + d - 0.03, 9, 16, c);
    } else {
      prism(ctx, x + 0.1, y + 0.12, x + 0.32, y + d - 0.12, 15, 19, '#f7f3ea');
      prism(ctx, x + w * 0.4, y + 0.03, x + w - 0.03, y + d - 0.03, 9, 16, c);
    }
    if (o.sleeper) {
      const [bx, by] = alongY ? iso(x + w / 2, y + d * 0.65, 18) : iso(x + w * 0.65, y + d / 2, 18);
      blob(ctx, bx, by, 13, 6, shade(c, -0.1));
      const [hx, hy] = alongY ? iso(x + w / 2, y + 0.24, 21) : iso(x + 0.24, y + d / 2, 21);
      blob(ctx, hx, hy, 4.5, 4, '#2d211b');
    }
  },
  charpai(ctx, o) {
    const { x, y, w, d } = o, L = 0.07;
    for (const [px, py] of [[x, y], [x + w - L, y], [x, y + d - L], [x + w - L, y + d - L]]) prism(ctx, px, py, px + L, py + L, 0, 9, '#6b4423');
    prism(ctx, x, y, x + w, y + d, 9, 12, '#7d5130');
    quad(ctx, x + 0.06, y + 0.06, x + w - 0.06, y + d - 0.06, 12, '#d6be86');
    ctx.strokeStyle = 'rgba(120,88,40,0.55)'; ctx.lineWidth = 0.7; ctx.beginPath();
    for (let f = x + 0.14; f < x + w - 0.08; f += 0.1) { const a = iso(f, y + 0.06, 12), b = iso(f, y + d - 0.06, 12); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); }
    for (let f = y + 0.14; f < y + d - 0.08; f += 0.1) { const a = iso(x + 0.06, f, 12), b = iso(x + w - 0.06, f, 12); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); }
    ctx.stroke();
  },
  almirah(ctx, o) {
    const { x, y, w, d } = o;
    prism(ctx, x, y, x + w, y + d, 0, 46, '#8e959b', { top: '#a7aeb4', edge: 'rgba(0,0,0,0.25)' });
    const n = face(ALL);
    line(ctx, fpt(x, y, w, d, n, 0.5, 3), fpt(x, y, w, d, n, 0.5, 43), 'rgba(0,0,0,0.35)', 1);
    const [hx, hy] = fpt(x, y, w, d, n, 0.6, 24); blob(ctx, hx, hy, 1.4, 2.2, '#d9dde0');
  },
  counter(ctx, o) {
    const { x, y, w, d } = o;
    prism(ctx, x, y, x + w, y + d, 0, 15, o.shop ? '#7a5532' : '#6a6d72', { top: o.shop ? '#9b7047' : '#3d4045' });
    if (o.stove) {
      const alongX = w >= d;
      const sx = alongX ? x + 0.25 : x + 0.05, sy = alongX ? y + 0.05 : y + 0.25;
      prism(ctx, sx, sy, sx + K(alongX, 0.55, 0.35), sy + K(alongX, 0.35, 0.55), 15, 18, '#1d1e21');
      for (const f of [0.3, 0.7]) groundEllipse(ctx, alongX ? sx + 0.55 * f : sx + 0.17, alongY(alongX, sy, f), 0.07, 18.5, '#55585d');
      // steel vessels
      const [vx, vy] = iso(alongX ? x + w - 0.3 : x + 0.22, alongX ? y + 0.22 : y + d - 0.3, 15);
      blob(ctx, vx, vy - 3, 5, 3, '#c9ced3'); blob(ctx, vx + 7, vy - 2, 3.5, 2.2, '#b8bec4');
    }
    if (o.shop) {
      // jars of toffees and a weighing scale
      for (let i = 0; i < 4; i++) { const [jx, jy] = iso(x + 0.3 + i * 0.4, y + 0.25, 15); cylinderPx(ctx, jx, jy, 3.5, 9, ['#e63946', '#f4a261', '#2a9d8f', '#e9c46a'][i]); }
    }
  },
  gas(ctx, o) { cylinder(ctx, o.x, o.y, 0.14, 0, 21, '#c62f2f', '#d94a43'); cylinder(ctx, o.x, o.y, 0.05, 21, 25, '#9aa0a6'); },
  matka(ctx, o) {
    const [sx, sy] = iso(o.x, o.y, 0);
    blob(ctx, sx, sy - 1, 8, 3.5, 'rgba(0,0,0,0.25)');
    const g = ctx.createRadialGradient(sx - 3, sy - 10, 1, sx, sy - 8, 10);
    g.addColorStop(0, '#c8703f'); g.addColorStop(1, '#7c3b1d');
    blob(ctx, sx, sy - 8, 8, 8, g);
    blob(ctx, sx, sy - 16, 4, 1.8, '#5d2a14');
  },
  drum(ctx, o) { cylinder(ctx, o.x, o.y, 0.21, 0, 24, '#2f6db5', '#3f82cf'); groundEllipse(ctx, o.x, o.y, 0.09, 24.2, '#245a96'); },
  bucket(ctx, o) { cylinder(ctx, o.x, o.y, 0.13, 0, 11, '#2a74c9', '#1d4f8a'); cylinder(ctx, o.x + 0.22, o.y + 0.1, 0.06, 0, 6, '#e0a030'); },
  sofa(ctx, o) {
    const { x, y, w, d } = o, c = o.color, seat = shade(c, 0.12);
    if (o.back === 'x0') {
      prism(ctx, x, y, x + 0.16, y + d, 0, 22, c);
      prism(ctx, x, y, x + w, y + 0.13, 0, 15, c);
      prism(ctx, x + 0.16, y + 0.13, x + w, y + d - 0.13, 0, 11, seat);
      prism(ctx, x, y + d - 0.13, x + w, y + d, 0, 15, c);
    } else {
      prism(ctx, x, y, x + w, y + 0.16, 0, 22, c);
      prism(ctx, x, y, x + 0.13, y + d, 0, 15, c);
      prism(ctx, x + 0.13, y + 0.16, x + w - 0.13, y + d, 0, 11, seat);
      prism(ctx, x + w - 0.13, y, x + w, y + d, 0, 15, c);
    }
  },
  tv(ctx, o) {
    const { x, y, w, d } = o, alongX = w >= d;
    prism(ctx, x, y, x + w, y + d, 0, 10, '#6b4a2e');
    const s = alongX ? [x + 0.1, y + d / 2 - 0.04, w - 0.2, 0.08] : [x + w / 2 - 0.04, y + 0.1, 0.08, d - 0.2];
    prism(ctx, s[0], s[1], s[0] + s[2], s[1] + s[3], 10, 30, '#16181d');
    const n = face(alongX ? [[0, 1], [0, -1]] : [[1, 0], [-1, 0]]);
    facePoly(ctx, ...s, n, 0.05, 0.95, 12, 28, '#4f86d6');
  },
  table(ctx, o) {
    const { x, y, w, d } = o, L = 0.06;
    for (const [px, py] of [[x, y], [x + w - L, y], [x, y + d - L], [x + w - L, y + d - L]]) prism(ctx, px, py, px + L, py + L, 0, 15, '#5c3b22');
    prism(ctx, x, y, x + w, y + d, 15, 18, '#8a5a34', { top: '#9c6a41' });
    const [px, py] = iso(x + w * 0.4, y + d * 0.5, 18); blob(ctx, px, py - 2, 3.5, 2, '#e9e5dc'); blob(ctx, px + 9, py, 3, 2, '#c9ced3');
  },
  cooler(ctx, o) {
    const { x, y, w, d } = o;
    prism(ctx, x, y, x + w, y + d, 0, 32, '#cdb68b', { top: '#dccaa2' });
    const n = face(ALL);
    ctx.strokeStyle = 'rgba(80,60,30,0.45)'; ctx.lineWidth = 0.8; ctx.beginPath();
    for (let z = 6; z < 30; z += 3.5) { const a = fpt(x, y, w, d, n, 0.08, z), b = fpt(x, y, w, d, n, 0.92, z); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); }
    ctx.stroke();
    groundEllipse(ctx, x + w / 2, y + d / 2, 0.16, 32.5, '#8c7b57');
  },
  puja(ctx, o) {
    const { x, y, w, d } = o;
    prism(ctx, x, y, x + w, y + d, 0, 18, '#7d3a26', { top: '#b52a2e' });
    const n = Math.max(1, Math.round(w / 0.4));
    for (let i = 0; i < n; i++) {
      const fx = x + (i + 0.5) * (w / n);
      prism(ctx, fx - 0.06, y + d * 0.35, fx + 0.06, y + d * 0.5, 18, 28, i % 2 ? '#e39b2d' : '#d9a933');
      const [gx, gy] = iso(fx, y + d * 0.5, 26); blob(ctx, gx, gy - 5, 2.5, 2.5, '#d9a933');
    }
    for (let i = 0; i < 6; i++) { const [mx, my] = iso(x + (i + 0.5) * (w / 6), y + d, 15); blob(ctx, mx, my, 1.8, 1.8, i % 2 ? '#ffb703' : '#fb8500'); }
    const [dx, dy] = iso(x + w / 2, y + d * 0.8, 18); blob(ctx, dx, dy, 2.5, 1.2, '#a0522d'); blob(ctx, dx, dy - 2.5, 1.2, 2.2, '#ffd166');
  },
  tulsi(ctx, o) {
    const { x, y } = o;
    prism(ctx, x - 0.2, y - 0.2, x + 0.2, y + 0.2, 0, 18, '#c8693b', { top: '#d9804e' });
    const [fx, fy] = iso(x, y + 0.2, 9); blob(ctx, fx, fy, 2.4, 2.4, '#f7f1e3');
    const [px, py] = iso(x, y, 18);
    for (let i = 0; i < 7; i++) blob(ctx, px + Math.cos(i * 0.9) * 5, py - 7 - (i % 3) * 3, 4, 3.4, i % 2 ? '#3f7a39' : '#4f8f46');
  },
  handpump(ctx, o) {
    const { x, y } = o;
    quad(ctx, x - 0.25, y - 0.25, x + 0.25, y + 0.25, 1, '#9a978f', 'rgba(0,0,0,0.25)');
    cylinder(ctx, x, y, 0.06, 1, 26, '#2f5d46', '#3c7258');
    line(ctx, iso(x, y, 20), iso(x + 0.2, y + 0.02, 17), '#2f5d46', 3);
    line(ctx, iso(x, y, 27), iso(x - 0.32, y, 36), '#2a503c', 2.4);
  },
  clothesline(ctx, o) {
    const pts = [[o.x, o.y], [o.x2, o.y2]];
    for (const [px, py] of pts) line(ctx, iso(px, py, 0), iso(px, py, 34), '#5b4128', 2);
    const a = iso(o.x, o.y, 33), b = iso(o.x2, o.y2, 33);
    ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.quadraticCurveTo((a[0] + b[0]) / 2, (a[1] + b[1]) / 2 + 8, b[0], b[1]);
    ctx.strokeStyle = '#ddd'; ctx.lineWidth = 0.8; ctx.stroke();
    const cols = ['#e63946', '#ffb703', '#219ebc', '#f1faee', '#8338ec'];
    for (let i = 0; i < 5; i++) {
      const f = 0.12 + i * 0.19, sag = 8 * 4 * f * (1 - f) / 2;
      const px = a[0] + (b[0] - a[0]) * f, py = a[1] + (b[1] - a[1]) * f + sag;
      ctx.fillStyle = cols[i]; ctx.fillRect(px - 4, py, 8, 9 + (i % 2) * 4);
    }
  },
  bicycle(ctx, o) {
    const { x, y } = o;
    vcircle(ctx, x - 0.22, y, 8, 0.2, 'x', null, '#1c1c1c', 1.8);
    vcircle(ctx, x + 0.22, y, 8, 0.2, 'x', null, '#1c1c1c', 1.8);
    ctx.strokeStyle = '#b23a3a'; ctx.lineWidth = 1.8; ctx.beginPath();
    const r = iso(x - 0.22, y, 8), s = iso(x - 0.06, y, 20), f = iso(x + 0.22, y, 8), hnd = iso(x + 0.17, y, 23);
    ctx.moveTo(r[0], r[1]); ctx.lineTo(s[0], s[1]); ctx.lineTo(hnd[0], hnd[1]); ctx.lineTo(f[0], f[1]);
    ctx.moveTo(r[0], r[1]); ctx.lineTo(iso(x + 0.02, y, 9)[0], iso(x + 0.02, y, 9)[1]); ctx.lineTo(s[0], s[1]);
    ctx.stroke();
    blob(ctx, s[0], s[1] - 1, 3.5, 1.5, '#222');
  },
  shelf(ctx, o) {
    const { x, y, w, d } = o, alongY = d > w;
    prism(ctx, x, y, x + w, y + d, 0, 34, '#6c5132');
    const cols = ['#e63946', '#f4a261', '#2a9d8f', '#e9c46a', '#457b9d', '#f1faee'];
    const n = face(alongY ? [[1, 0], [-1, 0]] : [[0, 1], [0, -1]]);
    for (let r = 0; r < 3; r++) for (let i = 0; i < 6; i++) {
      const f0 = i / 6 + 0.02, f1 = (i + 1) / 6 - 0.02, z0 = 4 + r * 10, z1 = z0 + 7;
      facePoly(ctx, x, y, w, d, n, f0, f1, z0, z1, cols[(i * 7 + r * 3 + Math.floor(x + y)) % cols.length]);
    }
  },
  sacks(ctx, o) {
    const n = o.n || 3;
    for (let i = 0; i < n; i++) {
      const [sx, sy] = iso(o.x + (i % 2) * 0.35, o.y + Math.floor(i / 2) * 0.3, 0);
      blob(ctx, sx, sy - 6, 11, 7, '#d8c79f', '#9e8d66');
      line(ctx, [sx - 6, sy - 7], [sx + 6, sy - 7], 'rgba(140,120,80,0.6)', 0.8);
    }
    if (n > 2) { const [sx, sy] = iso(o.x + 0.17, o.y + 0.15, 12); blob(ctx, sx, sy - 6, 11, 7, '#e1d2ab', '#9e8d66'); }
  },
  trough(ctx, o) {
    const { x, y, w, d } = o;
    prism(ctx, x, y, x + w, y + d, 0, 9, '#8a8479');
    quad(ctx, x + 0.06, y + 0.06, x + w - 0.06, y + d - 0.06, 9, '#35525f');
  },
  desk(ctx, o) {
    const { x, y, w, d } = o;
    prism(ctx, x, y, x + 0.05, y + d, 0, 13, '#5a3f28'); prism(ctx, x + w - 0.05, y, x + w, y + d, 0, 13, '#5a3f28');
    prism(ctx, x, y, x + w, y + d, 13, 16, '#7b5a3c', { top: '#8d6a48' });
    prism(ctx, x, y + d + 0.1, x + w, y + d + 0.3, 6, 9, '#6a4c31');
  },
  blackboard(ctx, o) {
    const { x, y, w, d } = o;
    prism(ctx, x, y, x + w, y + d, 4, 36, '#2d4a37', { top: '#6a4c31', right: '#2f5240' });
    const n = face([[1, 0], [-1, 0]]);
    ctx.strokeStyle = 'rgba(240,240,230,0.55)'; ctx.lineWidth = 0.9; ctx.beginPath();
    for (let i = 0; i < 4; i++) { const a = fpt(x, y, w, d, n, 0.12 + i * 0.05, 30 - i * 5), b = fpt(x, y, w, d, n, 0.45 + i * 0.08, 30 - i * 5); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); }
    ctx.stroke();
  },
  chabutra(ctx, o) {
    const { x, y, w, d } = o;
    prism(ctx, x, y, x + w, y + d, 0, 10, '#b9ac93', { top: '#c9bda5', edge: 'rgba(0,0,0,0.2)' });
    grid(ctx, x, y, 1, 'rgba(0,0,0,0.12)', 1, 10);
    ctx.strokeStyle = 'rgba(0,0,0,0.12)'; ctx.lineWidth = 1; ctx.beginPath();
    for (let i = 1; i < 3; i++) { let a = iso(x + i, y, 10), b = iso(x + i, y + d, 10); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); a = iso(x, y + i, 10); b = iso(x + w, y + i, 10); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); }
    ctx.stroke();
    // a small sacred stone with sindoor, and marigolds
    prism(ctx, x + 0.45, y + 0.35, x + 0.68, y + 0.55, 10, 20, '#d9531e', { top: '#e8692e' });
    for (let i = 0; i < 5; i++) { const [mx, my] = iso(x + 0.4 + i * 0.07, y + 0.68, 10); blob(ctx, mx, my, 1.8, 1.4, i % 2 ? '#ffb703' : '#fb8500'); }
  },
  temple(ctx, o) {
    const { x, y } = o;
    prism(ctx, x, y, x + 3, y + 3, 0, 10, '#cdc3ae', { top: '#ddd3bf', edge: 'rgba(0,0,0,0.2)' });
    prism(ctx, x + 1.1, y + 3, x + 1.9, y + 3.3, 0, 6, '#c4b9a3'); prism(ctx, x + 1.1, y + 3.3, x + 1.9, y + 3.55, 0, 3, '#c4b9a3');
    // pillared porch (mandapa) and sanctum
    for (const [px, py] of [[x + 0.3, y + 2.55], [x + 2.55, y + 2.55], [x + 2.55, y + 0.3]]) prism(ctx, px, py, px + 0.14, py + 0.14, 10, 40, '#ede4d3');
    prism(ctx, x + 0.5, y + 0.5, x + 2.5, y + 2.5, 10, 48, '#f3ede1', { edge: 'rgba(0,0,0,0.15)' });
    if (faceVisible(0, 1)) fillPoly(ctx, [iso(x + 1.15, y + 2.5, 10), iso(x + 1.85, y + 2.5, 10), iso(x + 1.85, y + 2.5, 34), iso(x + 1.5, y + 2.5, 40), iso(x + 1.15, y + 2.5, 34)], '#3a2412');
    const z0 = 48, tip = iso(x + 1.5, y + 1.5, 122);
    const A = iso(x + 0.55, y + 0.55, z0), B = iso(x + 2.45, y + 0.55, z0), C = iso(x + 2.45, y + 2.45, z0), D = iso(x + 0.55, y + 2.45, z0);
    fillPoly(ctx, [D, C, tip], '#dc6f2c');
    fillPoly(ctx, [B, C, tip], '#f08c3e');
    const lerp = (p, f) => [p[0] + (tip[0] - p[0]) * f, p[1] + (tip[1] - p[1]) * f];
    ctx.strokeStyle = 'rgba(110,45,10,0.45)'; ctx.lineWidth = 1; ctx.beginPath();
    for (let k = 1; k < 6; k++) { const f = k / 6, p = lerp(D, f), q = lerp(C, f), r = lerp(B, f); ctx.moveTo(p[0], p[1]); ctx.lineTo(q[0], q[1]); ctx.lineTo(r[0], r[1]); }
    ctx.stroke();
    blob(ctx, tip[0], tip[1] - 2, 4.5, 4, '#e0b13a'); blob(ctx, tip[0], tip[1] - 8, 2.4, 3, '#e0b13a');
    line(ctx, [tip[0], tip[1] - 8], [tip[0], tip[1] - 42], '#6b4a2b', 1.5);
    fillPoly(ctx, [[tip[0], tip[1] - 42], [tip[0] + 24, tip[1] - 36], [tip[0], tip[1] - 29]], '#ff8c1a');
    const [bx, by] = iso(x + 1.5, y + 2.75, 36); line(ctx, [bx, by - 6], [bx, by], '#6b4a2b', 1); blob(ctx, bx, by + 2.5, 3, 3.2, '#d9a933');
  },
  well(ctx, o) {
    const { x, y, r } = o;
    prism(ctx, x - 0.05, y - r - 0.04, x + 0.05, y - r + 0.06, 0, 46, '#5b4128');
    cylinder(ctx, x, y, r, 0, 16, '#8e8473', '#a39885');
    groundEllipse(ctx, x, y, r * 0.74, 16, '#0d222d');
    line(ctx, iso(x, y - r, 44), iso(x, y + r, 44), '#5b4128', 3);
    line(ctx, iso(x, y, 43), iso(x, y, 22), '#c9b48a', 1);
    cylinderPx(ctx, ...iso(x, y, 18), 3, 5, '#7a8a96');
    prism(ctx, x - 0.05, y + r - 0.06, x + 0.05, y + r + 0.04, 0, 46, '#5b4128');
  },
  tank(ctx, o) {
    const { x, y } = o, s = 0.42, H = 74;
    ctx.lineCap = 'round';
    for (const [dx, dy] of [[-s, -s], [s, -s], [-s, s], [s, s]]) line(ctx, iso(x + dx, y + dy, 0), iso(x + dx * 0.8, y + dy * 0.8, H), '#6b6f74', 3);
    for (const z of [24, 50]) {
      const p = [[-s, -s], [s, -s], [s, s], [-s, s]].map(([dx, dy]) => iso(x + dx * (1 - z / H * 0.2), y + dy * (1 - z / H * 0.2), z));
      ctx.strokeStyle = '#5d6166'; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.moveTo(p[0][0], p[0][1]); for (const q of p.slice(1)) ctx.lineTo(q[0], q[1]); ctx.closePath(); ctx.stroke();
    }
    prism(ctx, x - 0.48, y - 0.48, x + 0.48, y + 0.48, H, H + 4, '#7a7d80');
    cylinder(ctx, x, y, 0.42, H + 4, H + 46, '#222326', '#2f3034');
    for (const z of [H + 16, H + 30]) { const [ex, ey] = iso(x, y, z); ctx.beginPath(); ctx.ellipse(ex, ey, 0.42 * TW / Math.SQRT2, 0.42 * TH / Math.SQRT2, 0, 0, Math.PI); ctx.strokeStyle = 'rgba(255,255,255,0.1)'; ctx.lineWidth = 1; ctx.stroke(); }
    cylinder(ctx, x, y, 0.12, H + 46, H + 50, '#2f3034');
    line(ctx, iso(x + 0.3, y + 0.55, 0), iso(x + 0.3, y + 0.5, H), '#888', 1); line(ctx, iso(x + 0.48, y + 0.55, 0), iso(x + 0.48, y + 0.5, H), '#888', 1);
  },
  tree(ctx, o) {
    const { x, y } = o, base = o.base || 0;
    if (o.type === 'coconut') {
      shadow(ctx, x + 0.3, y + 0.1, 0.55);
      const [bx, by] = iso(x, y, base), lean = o.lean ?? 12, H = 122, tx = bx + lean, ty = by - H;
      ctx.lineCap = 'round';
      ctx.strokeStyle = '#7d5f3c'; ctx.lineWidth = 5.5; ctx.beginPath(); ctx.moveTo(bx, by); ctx.quadraticCurveTo(bx + lean * 0.15, by - H * 0.6, tx, ty); ctx.stroke();
      ctx.strokeStyle = 'rgba(60,40,20,0.5)'; ctx.lineWidth = 1;
      for (let i = 1; i < 10; i++) { const f = i / 10, px = bx + (tx - bx) * f * f, py = by - H * f; ctx.beginPath(); ctx.moveTo(px - 3, py); ctx.lineTo(px + 3, py); ctx.stroke(); }
      for (let i = 0; i < 9; i++) {
        const a = (i / 9) * Math.PI * 2 + 0.4, len = 34 + (i % 3) * 7;
        const ex = tx + Math.cos(a) * len, ey = ty + Math.sin(a) * len * 0.5 + 14;
        ctx.strokeStyle = i % 2 ? '#3d7537' : '#4f8c45'; ctx.lineWidth = 4;
        ctx.beginPath(); ctx.moveTo(tx, ty); ctx.quadraticCurveTo((tx + ex) / 2, Math.min(ty, ey) - 12, ex, ey); ctx.stroke();
      }
      for (const [dx, dy] of [[-3, 4], [3, 5], [0, 7]]) blob(ctx, tx + dx, ty + dy, 3, 3, '#5a3d1f');
      return;
    }
    const big = o.type === 'peepal' || o.type === 'banyan';
    const tw = big ? 0.17 : 0.08, trunkH = big ? 70 : 44, cz = big ? 104 : 66, R = big ? 60 : 30;
    shadow(ctx, x, y, big ? 1.5 : 0.8);
    if (o.type === 'banyan') {
      ctx.strokeStyle = 'rgba(92,66,42,0.9)'; ctx.lineWidth = 1.4;
      for (let i = 0; i < 9; i++) { const dx = (hash(i, 3) - 0.5) * 1.9, dy = (hash(i, 9) - 0.5) * 1.4; line(ctx, iso(x + dx, y + dy, cz - 24), iso(x + dx, y + dy, 0), 'rgba(92,66,42,0.85)', 1.4); }
    }
    prism(ctx, x - tw, y - tw, x + tw, y + tw, base, base + trunkH, '#5b4029');
    const [cx, cy] = iso(x, y, base + cz);
    const greens = o.type === 'peepal' ? ['#244a26', '#2e5a2f', '#3a6c37', '#4b8243'] : ['#26492a', '#305a31', '#3c6a38', '#4d7e42'];
    const n = big ? 13 : 7;
    for (let i = 0; i < n; i++) {
      const ox = (hash(i, x * 7, 1) - 0.5) * R * 1.6, oy = (hash(i, y * 5, 2) - 0.5) * R * 0.95;
      blob(ctx, cx + ox, cy + oy, R * (0.42 + 0.22 * hash(i, x + y, 3)), R * (0.36 + 0.2 * hash(i, x + y, 4)), greens[i % 3]);
    }
    for (let i = 0; i < (big ? 6 : 3); i++) {
      const ox = (hash(i, x, 5) - 0.7) * R * 0.9, oy = -R * 0.3 - hash(i, y, 6) * R * 0.3;
      blob(ctx, cx + ox, cy + oy, R * 0.26, R * 0.2, greens[3]);
    }
  },
  bush(ctx, o) {
    const [sx, sy] = iso(o.x, o.y, 0);
    shadow(ctx, o.x, o.y, 0.3);
    for (let i = 0; i < 4; i++) blob(ctx, sx + (i - 1.5) * 5, sy - 6 - (i % 2) * 3, 7, 6, i % 2 ? '#3a6a34' : '#2f5a2c');
  },
  reeds(ctx, o) {
    const [sx, sy] = iso(o.x, o.y, 0);
    ctx.strokeStyle = '#5c8a3e'; ctx.lineWidth = 1.2; ctx.beginPath();
    for (let i = 0; i < 9; i++) { const dx = (i - 4) * 2.2; ctx.moveTo(sx + dx, sy); ctx.quadraticCurveTo(sx + dx, sy - 10, sx + dx + (i % 3 - 1) * 4, sy - 16 - (i % 4) * 3); }
    ctx.stroke();
    for (let i = 0; i < 3; i++) blob(ctx, sx + (i - 1) * 5, sy - 20 - i * 2, 1.4, 3.5, '#6b4a2b');
  },
  haystack(ctx, o) {
    const { x, y, r } = o;
    shadow(ctx, x + 0.1, y + 0.1, r * 1.1);
    const [sx, sy] = iso(x, y, 0), rx = (r * TW) / Math.SQRT2, ry = (r * TH) / Math.SQRT2, H = r * 72;
    const g = ctx.createLinearGradient(sx - rx, 0, sx + rx, 0);
    g.addColorStop(0, '#9c7a35'); g.addColorStop(0.45, '#d4ae58'); g.addColorStop(1, '#a8843c');
    ctx.beginPath(); ctx.moveTo(sx - rx, sy);
    ctx.ellipse(sx, sy, rx, ry, 0, Math.PI, 0, true);
    ctx.ellipse(sx, sy, rx, H, 0, 0, Math.PI, true);
    ctx.closePath(); ctx.fillStyle = g; ctx.fill();
    ctx.strokeStyle = 'rgba(240,210,130,0.5)'; ctx.lineWidth = 0.8; ctx.beginPath();
    for (let i = 0; i < 9; i++) { const f = (i + 0.5) / 9 * 2 - 1; ctx.moveTo(sx + f * rx * 0.3, sy - H * 0.95); ctx.lineTo(sx + f * rx, sy + ry * 0.4 * Math.sqrt(1 - f * f)); }
    ctx.stroke();
    line(ctx, [sx, sy - H + 1], [sx, sy - H - 9], '#6b4a2b', 2);
  },
  cow(ctx, o) {
    const [sx, sy] = iso(o.x, o.y, 0), s = o.s || 1, dir = o.flip ? -1 : 1;
    const body = o.stone ? '#a19c92' : o.buffalo ? '#2b2b2f' : '#e7e0d1', dark = o.stone ? '#86827a' : o.buffalo ? '#1c1c1f' : '#bdb4a2';
    blob(ctx, sx, sy + 1, 20 * s, 7 * s, 'rgba(0,0,0,0.25)');
    blob(ctx, sx - 4 * dir * s, sy - 4 * s, 8 * s, 4 * s, dark);
    blob(ctx, sx, sy - 9 * s, 17 * s, 9 * s, body);
    if (!o.buffalo) blob(ctx, sx - 5 * dir * s, sy - 16 * s, 6 * s, 4 * s, body);
    blob(ctx, sx + 16 * dir * s, sy - 13 * s, 6.5 * s, 5.5 * s, body);
    blob(ctx, sx + 20 * dir * s, sy - 11 * s, 3.5 * s, 3 * s, dark);
    ctx.strokeStyle = o.buffalo ? '#55504a' : '#d8cfb9'; ctx.lineWidth = 1.6 * s; ctx.beginPath();
    if (o.buffalo) { ctx.arc(sx + 14 * dir * s, sy - 18 * s, 6 * s, Math.PI * 0.9, Math.PI * 1.9); }
    else { ctx.moveTo(sx + 14 * dir * s, sy - 17 * s); ctx.lineTo(sx + 12 * dir * s, sy - 23 * s); ctx.moveTo(sx + 18 * dir * s, sy - 17 * s); ctx.lineTo(sx + 20 * dir * s, sy - 23 * s); }
    ctx.stroke();
    if (!o.stone && !o.buffalo) blob(ctx, sx + 4 * s, sy - 10 * s, 5 * s, 3.5 * s, '#a1785a');
  },
  dog(ctx, o) {
    const [sx, sy] = iso(o.x, o.y, 0);
    blob(ctx, sx, sy + 1, 11, 4, 'rgba(0,0,0,0.25)');
    blob(ctx, sx, sy - 4, 9, 5, '#a8743f');
    blob(ctx, sx + 7, sy - 5, 4.5, 3.8, '#b88048');
    blob(ctx, sx + 9, sy - 8, 1.8, 2.6, '#7a4f27');
    ctx.strokeStyle = '#a8743f'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(sx - 8, sy - 4); ctx.quadraticCurveTo(sx - 13, sy - 8, sx - 7, sy - 9); ctx.stroke();
  },
  auto(ctx, o) {
    const { x, y, w, d } = o;
    shadow(ctx, x + w / 2, y + d / 2, 0.7);
    vcircle(ctx, x + 0.3, y + 0.08, 6, 0.15, 'x', '#151515');
    vcircle(ctx, x + w - 0.14, y + d / 2, 6, 0.14, 'x', '#151515');
    prism(ctx, x + 0.04, y + 0.06, x + w * 0.72, y + d - 0.06, 5, 17, '#2e7d4a');
    prism(ctx, x + w * 0.72, y + 0.17, x + w, y + d - 0.17, 5, 19, '#2e7d4a');
    prism(ctx, x + 0.04, y + 0.06, x + w * 0.72, y + d - 0.06, 17, 35, '#f2c230', { top: '#1d1d1f' });
    const cw = w * 0.72 - 0.04, side = face([[0, 1], [0, -1]]);
    facePoly(ctx, x + 0.04, y + 0.06, cw, d - 0.12, side, 0.18 / cw, 0.66 / cw, 18, 32, '#262626');
    if (faceVisible(1, 0)) fillPoly(ctx, [iso(x + w * 0.72, y + 0.12, 19), iso(x + w * 0.72, y + d - 0.12, 19), iso(x + w * 0.72, y + d - 0.12, 33), iso(x + w * 0.72, y + 0.12, 33)], 'rgba(160,205,230,0.6)');
    prism(ctx, x + 0.02, y + 0.04, x + w * 0.75, y + d - 0.04, 35, 38, '#1d1d1f');
    vcircle(ctx, x + 0.3, y + (side[1] === 1 ? d - 0.06 : 0.08), 6, 0.15, 'x', '#151515', '#4a4a4a', 1);
    if (faceVisible(1, 0)) { const [lx, ly] = iso(x + w, y + d / 2, 13); blob(ctx, lx, ly, 2.2, 2.2, '#fff4c2'); }
  },
  tractor(ctx, o) {
    const { x, y, w, d } = o;
    shadow(ctx, x + w / 2, y + d / 2, 0.85);
    vcircle(ctx, x + 0.4, y + 0.08, 13, 0.33, 'x', '#141414');
    vcircle(ctx, x + w - 0.25, y + 0.2, 7, 0.17, 'x', '#141414');
    prism(ctx, x + 0.12, y + 0.22, x + 0.78, y + d - 0.22, 8, 18, '#a93226');
    prism(ctx, x + 0.62, y + 0.27, x + w, y + d - 0.27, 8, 25, '#c0392b', { top: '#d24a3a' });
    prism(ctx, x + 0.25, y + 0.36, x + 0.45, y + d - 0.36, 18, 27, '#222');
    line(ctx, iso(x + 0.6, y + d / 2, 26), iso(x + 0.52, y + d / 2, 34), '#222', 2);
    line(ctx, iso(x + 0.9, y + 0.4, 25), iso(x + 0.9, y + 0.4, 48), '#333', 2.6);
    vcircle(ctx, x + 0.4, y + d - 0.08, 13, 0.33, 'x', '#141414', '#3b3b3b', 2);
    vcircle(ctx, x + 0.4, y + d - 0.06, 13, 0.12, 'x', '#e08a1e');
    vcircle(ctx, x + w - 0.25, y + d - 0.2, 7, 0.17, 'x', '#141414', '#3b3b3b', 1.5);
    vcircle(ctx, x + w - 0.25, y + d - 0.19, 7, 0.07, 'x', '#e08a1e');
  },
  cart(ctx, o) {
    const { x, y, w, d } = o;
    shadow(ctx, x + w / 2, y + d / 2, 0.55);
    vcircle(ctx, x + w * 0.4, y, 10, 0.2, 'x', null, '#2a2a2a', 2);
    prism(ctx, x, y, x + w, y + d, 12, 15, '#7a5432');
    prism(ctx, x + 0.06, y + 0.06, x + w - 0.06, y + d - 0.06, 15, 23, '#3a6ea5', { top: '#467ec0' });
    line(ctx, iso(x + w, y + 0.1, 14), iso(x + w + 0.35, y + 0.1, 12), '#5b4128', 2);
    line(ctx, iso(x + w, y + d - 0.1, 14), iso(x + w + 0.35, y + d - 0.1, 12), '#5b4128', 2);
    vcircle(ctx, x + w * 0.4, y + d, 10, 0.2, 'x', null, '#2a2a2a', 2);
  },
  tapri(ctx, o) {
    const { x, y, w, d } = o;
    prism(ctx, x, y, x + 0.06, y + 0.06, 0, 50, '#4a3020'); prism(ctx, x + w - 0.06, y, x + w, y + 0.06, 0, 50, '#4a3020');
    fillPoly(ctx, [iso(x, y, 0), iso(x + w, y, 0), iso(x + w, y, 48), iso(x, y, 48)], '#2f6db5');
    for (let i = 0; i < 5; i++) { const [jx, jy] = iso(x + 0.25 + i * 0.32, y + 0.12, 30); cylinderPx(ctx, jx, jy, 3.2, 8, ['#e9c46a', '#e76f51', '#f4a261', '#2a9d8f', '#e9c46a'][i]); }
    prism(ctx, x, y + d - 0.45, x + w, y + d, 0, 22, '#7b4b2b', { top: '#9c6a43' });
    cylinder(ctx, x + 0.45, y + d - 0.22, 0.09, 22, 31, '#b9c0c6');
    for (let i = 0; i < 4; i++) { const [gx, gy] = iso(x + 0.9 + i * 0.18, y + d - 0.2, 22); ctx.fillStyle = 'rgba(230,210,170,0.9)'; ctx.fillRect(gx - 1.5, gy - 5, 3, 5); }
    prism(ctx, x, y + d - 0.06, x + 0.06, y + d, 0, 44, '#4a3020'); prism(ctx, x + w - 0.06, y + d - 0.06, x + w, y + d, 0, 44, '#4a3020');
    fillPoly(ctx, [iso(x - 0.1, y - 0.1, 54), iso(x + w + 0.12, y - 0.1, 54), iso(x + w + 0.12, y + d + 0.18, 44), iso(x - 0.1, y + d + 0.18, 44)], '#8d99a3', 'rgba(0,0,0,0.3)');
    ctx.strokeStyle = 'rgba(60,70,80,0.45)'; ctx.lineWidth = 1; ctx.beginPath();
    for (let i = 1; i < 9; i++) { const fx = x - 0.1 + (i / 9) * (w + 0.22); const a = iso(fx, y - 0.1, 54), b = iso(fx, y + d + 0.18, 44); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); }
    ctx.stroke();
    // board on the front: "चाय"
    if (!faceVisible(0, 1)) return;
    const p0 = iso(x + 0.25, y + d + 0.18, 43), p1 = iso(x + w - 0.25, y + d + 0.18, 43);
    fillPoly(ctx, [p0, p1, [p1[0], p1[1] + 11], [p0[0], p0[1] + 11]], '#c1121f');
    ctx.save(); ctx.translate((p0[0] + p1[0]) / 2, (p0[1] + p1[1]) / 2 + 6); ctx.transform(1, (p1[1] - p0[1]) / (p1[0] - p0[0]), 0, 1, 0, 0);
    ctx.fillStyle = '#fff3d6'; ctx.font = 'bold 8px "Baloo 2", system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('चाय · CHAI', 0, 0); ctx.restore();
  },
  bench(ctx, o) {
    const { x, y, w, d } = o;
    prism(ctx, x, y, x + w, y + 0.06, 0, 8, '#4e3420'); prism(ctx, x, y + d - 0.06, x + w, y + d, 0, 8, '#4e3420');
    prism(ctx, x, y, x + w, y + d, 8, 11, '#6e4a2c', { top: '#80583a' });
  },
  ghat(ctx, o) {
    const { x, y, w, d } = o;
    prism(ctx, x, y, x + w * 0.4, y + d, 0, 7, '#aaa08b'); prism(ctx, x + w * 0.4, y, x + w * 0.7, y + d, 0, 4.5, '#a1977f'); prism(ctx, x + w * 0.7, y, x + w, y + d, 0, 2, '#978d77');
  },
  lamp(ctx, o) {
    const { x, y, ax = 0, ay = 0 } = o;
    prism(ctx, x - 0.035, y - 0.035, x + 0.035, y + 0.035, 0, 114, '#4f5359');
    line(ctx, iso(x - 0.14, y + 0.14, 112), iso(x + 0.14, y - 0.14, 112), '#4f5359', 2);
    line(ctx, iso(x, y, 108), iso(x + ax, y + ay, 105), '#4f5359', 2.4);
    const [hx, hy] = iso(x + ax, y + ay, 104);
    blob(ctx, hx, hy, 7, 3.2, '#2b2d31'); blob(ctx, hx, hy + 1.6, 4.5, 1.7, '#fff1c9');
  },
  tube(ctx, o) {
    const { x, y, along } = o;
    prism(ctx, x - 0.03, y - 0.03, x + 0.03, y + 0.03, 0, 40, '#6a6e73');
    const a = along === 'y' ? iso(x, y - 0.22, 40) : iso(x - 0.22, y, 40), b = along === 'y' ? iso(x, y + 0.22, 40) : iso(x + 0.22, y, 40);
    ctx.lineCap = 'round'; line(ctx, a, b, '#e9fff6', 3.2);
  },
};
function alongY(alongX, sy, f) { return alongX ? sy + 0.17 : sy + 0.55 * f; }
function cylinderPx(ctx, sx, sy, r, h, color) {
  ctx.fillStyle = shade(color, -0.2); ctx.fillRect(sx - r, sy - h, r * 2, h);
  blob(ctx, sx, sy, r, r * 0.5, shade(color, -0.2));
  blob(ctx, sx, sy - h, r, r * 0.5, color);
}

// ---------------------------------------------------------------- sky (screen space)
let stars = null;
export function drawSky(ctx, w, h) {
  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, '#050816'); g.addColorStop(0.6, '#0b1430'); g.addColorStop(1, '#131c3a');
  ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
  if (!stars) stars = Array.from({ length: 220 }, (_, i) => [hash(i, 1), hash(i, 2), 0.3 + hash(i, 3) * 1.1, hash(i, 4)]);
  for (const [sx, sy, r, a] of stars) { ctx.fillStyle = `rgba(220,230,255,${0.25 + a * 0.6})`; ctx.beginPath(); ctx.arc(sx * w, sy * h, r, 0, 7); ctx.fill(); }
  const mx = w * 0.86, my = h * 0.14;
  const mg = ctx.createRadialGradient(mx, my, 6, mx, my, 120);
  mg.addColorStop(0, 'rgba(230,236,255,0.35)'); mg.addColorStop(1, 'rgba(230,236,255,0)');
  ctx.fillStyle = mg; ctx.beginPath(); ctx.arc(mx, my, 120, 0, 7); ctx.fill();
  ctx.fillStyle = '#eef1ff'; ctx.beginPath(); ctx.arc(mx, my, 20, 0, 7); ctx.fill();
  ctx.fillStyle = 'rgba(160,170,200,0.35)'; ctx.beginPath(); ctx.arc(mx - 6, my - 4, 4, 0, 7); ctx.arc(mx + 7, my + 6, 3, 0, 7); ctx.fill();
}

// ---------------------------------------------------------------- night lights
function level(L, t, powerCut) {
  if (powerCut && L.kind !== 'diya' && L.kind !== 'lantern') return 0;
  let k = L.k;
  if (L.flicker === 'tube') {
    const ph = (t + L.x * 1.7) % 7;
    if (ph > 5.2 && ph < 6.1) k *= Math.sin(t * 55 + L.y) > 0.1 ? 1 : 0.08;
    else if (ph >= 6.1 && ph < 6.3) k *= 0.08;
  }
  if (L.flicker === 'diya' || L.kind === 'lantern') k *= 0.86 + 0.14 * Math.sin(t * 9.1 + L.x * 3) * Math.sin(t * 6.3 + L.y);
  return k;
}
function pool(c, L, alphaStops) {
  const [px, py] = iso(L.x, L.y, 0);
  const R = (L.r * TW) / Math.SQRT2;
  c.save(); c.translate(px, py); c.scale(1, 0.5);
  const g = c.createRadialGradient(0, 0, 0, 0, 0, R);
  for (const [s, col] of alphaStops) g.addColorStop(s, col);
  c.fillStyle = g; c.beginPath(); c.arc(0, 0, R, 0, Math.PI * 2); c.fill(); c.restore();
}

// Draw only the part of the big picture that is on screen (much faster than drawing all of it).
// k = canvas pixels per CSS pixel of the target canvas.
export function blitPicture(c, pic, picScale, view, k) {
  const { zoom, cam, w, h } = view;
  const X0 = cam.x - WORLD.ox * zoom, Y0 = cam.y - WORLD.oy * zoom; // where the picture's corner lands (CSS px)
  const dx0 = Math.max(0, X0), dy0 = Math.max(0, Y0);
  const dx1 = Math.min(w, X0 + WORLD.w * zoom), dy1 = Math.min(h, Y0 + WORLD.h * zoom);
  if (dx1 <= dx0 || dy1 <= dy0) return;
  const f = picScale / zoom;
  c.setTransform(k, 0, 0, k, 0, 0);
  c.drawImage(pic, (dx0 - X0) * f, (dy0 - Y0) * f, (dx1 - dx0) * f, (dy1 - dy0) * f, dx0, dy0, dx1 - dx0, dy1 - dy0);
}

// The night: a dark layer with soft holes where lights are, plus coloured glows. Both are soft, so they are
// worked out at half resolution and stretched, which is four times less work and looks the same.
const LS = 0.5;
export function drawLighting(ctx, dark, glow, view, lights, t, powerCut, picture, picScale) {
  const { dpr, zoom, cam, w, h } = view;
  const W = Math.max(1, Math.ceil(w * LS)), H = Math.max(1, Math.ceil(h * LS));
  for (const c of [dark, glow]) if (c.width !== W || c.height !== H) { c.width = W; c.height = H; }
  const d = dark.getContext('2d'), g = glow.getContext('2d');
  d.setTransform(1, 0, 0, 1, 0, 0); d.globalCompositeOperation = 'source-over'; d.clearRect(0, 0, W, H);
  d.fillStyle = powerCut ? 'rgba(2,5,18,0.9)' : 'rgba(5,9,30,0.8)'; d.fillRect(0, 0, W, H);
  g.setTransform(1, 0, 0, 1, 0, 0); g.globalCompositeOperation = 'source-over'; g.clearRect(0, 0, W, H);
  const T = [LS * zoom, 0, 0, LS * zoom, LS * cam.x, LS * cam.y];
  d.setTransform(...T); d.globalCompositeOperation = 'destination-out';
  g.setTransform(...T); g.globalCompositeOperation = 'lighter';
  for (const L of lights) {
    const k = level(L, t, powerCut);
    if (k < 0.02) continue;
    // skip lights that are off screen
    const [px, py] = iso(L.x, L.y, 0), R = ((L.r * TW) / Math.SQRT2) * zoom;
    const sx = cam.x + px * zoom, sy = cam.y + py * zoom;
    if (sx < -R || sx > w + R || sy < -R - 140 * zoom || sy > h + R) continue;
    pool(d, L, [[0, `rgba(0,0,0,${k})`], [0.45, `rgba(0,0,0,${k * 0.72})`], [1, 'rgba(0,0,0,0)']]);
    pool(g, L, [[0, rgba(L.color, 0.2 * k)], [1, rgba(L.color, 0)]]);
    const [hx, hy] = iso(L.x, L.y, L.z);
    const hr = L.kind === 'lamp' ? 26 : L.kind === 'tube' ? 18 : L.kind === 'diya' ? 12 : L.kind === 'tv' ? 8 : 14;
    const rg = g.createRadialGradient(hx, hy, 0, hx, hy, hr);
    rg.addColorStop(0, rgba(L.color, 0.85 * k)); rg.addColorStop(0.3, rgba(L.color, 0.3 * k)); rg.addColorStop(1, rgba(L.color, 0));
    g.fillStyle = rg; g.beginPath(); g.arc(hx, hy, hr, 0, Math.PI * 2); g.fill();
  }
  // keep the darkness only where the village is drawn, so the sky, moon and stars stay bright
  d.globalCompositeOperation = 'destination-in';
  blitPicture(d, picture, picScale, view, LS);
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(dark, 0, 0, Math.round(w * dpr), Math.round(h * dpr));
  ctx.globalCompositeOperation = 'lighter';
  ctx.drawImage(glow, 0, 0, Math.round(w * dpr), Math.round(h * dpr));
  ctx.restore();
}

// ---------------------------------------------------------------- moving things
export function drawPerson(ctx, a, t, seeker, covering, crouch) {
  const [sx, sy] = iso(a.x, a.y, a.z || 0);
  const step = a.moving ? Math.sin(a.walk || 0) : 0;
  const bob = a.moving ? -Math.abs(step) * 1.6 : Math.sin(t * 2.2 + a.id * 1.7) * 1.1;
  ctx.save(); ctx.translate(sx, sy);
  ctx.beginPath(); ctx.ellipse(0, 0, 13, 6.5, 0, 0, Math.PI * 2); ctx.fillStyle = 'rgba(0,0,0,0.35)'; ctx.fill();
  if (crouch) ctx.scale(1.08, 0.58); // crouched down in the hiding spot
  ctx.fillStyle = '#2b2d42';
  ctx.fillRect(-5 + step * 2, -19 + bob, 4, 19 - bob - Math.max(0, step) * 2);
  ctx.fillRect(1 - step * 2, -19 + bob, 4, 19 - bob - Math.max(0, -step) * 2);
  ctx.fillStyle = a.color;
  ctx.beginPath(); ctx.roundRect(-8.5, -43 + bob, 17, 27, 5); ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,0.18)'; ctx.fillRect(-1, -41 + bob, 2, 22);
  ctx.strokeStyle = '#c68a5a'; ctx.lineWidth = 3.2; ctx.lineCap = 'round'; ctx.beginPath();
  if (covering) { ctx.moveTo(-8, -38 + bob); ctx.lineTo(-4, -50 + bob); ctx.moveTo(8, -38 + bob); ctx.lineTo(4, -50 + bob); }
  else { ctx.moveTo(-8.5, -38 + bob); ctx.lineTo(-11 - step * 3, -23 + bob); ctx.moveTo(8.5, -38 + bob); ctx.lineTo(11 + step * 3, -23 + bob); }
  ctx.stroke();
  ctx.fillStyle = '#c68a5a'; ctx.beginPath(); ctx.arc(0, -50 + bob, 7, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#1b1b1b'; ctx.beginPath(); ctx.arc(0, -52 + bob, 7.3, Math.PI, 0); ctx.fill();
  if (a.hair === 'long') { ctx.beginPath(); ctx.ellipse(-5, -42 + bob, 2.6, 8, 0.2, 0, Math.PI * 2); ctx.fill(); }
  ctx.restore();
}

// a thought bubble above a head, in screen pixels
export function drawBubble(ctx, sx, sy, text, accent, box) {
  ctx.font = 'italic 500 12.5px Inter, system-ui, sans-serif';
  const words = text.split(' '), lines = [];
  let cur = '';
  for (const w of words) { const next = cur ? `${cur} ${w}` : w; if (ctx.measureText(next).width > 170 && cur) { lines.push(cur); cur = w; } else cur = next; }
  if (cur) lines.push(cur);
  const w = Math.max(...lines.map((l) => ctx.measureText(l).width)) + 22, h = lines.length * 16 + 12;
  let x = sx - w / 2, y = sy - h;
  if (box) { x = Math.min(Math.max(x, 8), Math.max(8, box.w - w - 8)); y = Math.min(Math.max(y, 8), Math.max(8, box.h - h - 8)); }
  const tx = Math.min(Math.max(sx, x + 18), x + w - 18), by = y + h;
  ctx.fillStyle = 'rgba(248,246,240,0.96)'; ctx.strokeStyle = accent; ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.roundRect(x, y, w, h, 12); ctx.fill(); ctx.stroke();
  for (const [dx, dy, r] of [[-6, 7, 4], [-11, 15, 2.5]]) { ctx.beginPath(); ctx.arc(tx + dx, by + dy, r, 0, 7); ctx.fill(); ctx.stroke(); }
  ctx.fillStyle = '#1d2238'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  lines.forEach((l, i) => ctx.fillText(l, x + w / 2, y + 14 + i * 16));
}

export function drawSmoke(ctx, x, y, z, t) {
  for (let i = 0; i < 7; i++) {
    const age = (t * 0.45 + i / 7) % 1;
    const [sx, sy] = iso(x, y, z + age * 46);
    ctx.fillStyle = `rgba(215,215,225,${0.22 * (1 - age)})`;
    ctx.beginPath(); ctx.arc(sx + Math.sin(t + i) * 3 + age * 10, sy, 2.5 + age * 8, 0, Math.PI * 2); ctx.fill();
  }
}

const FLIES = Array.from({ length: 40 }, (_, i) => {
  const anchors = [[31.5, 10.5], [20, 12.5], [12, 34], [27.6, 33.5], [1.5, 12.5], [25.5, 3]];
  const [ax, ay] = anchors[i % anchors.length];
  return { ax, ay, p: hash(i, 11) * 10, s: 0.5 + hash(i, 12) };
});
export function drawFireflies(ctx, t, powerCut) {
  ctx.save(); ctx.globalCompositeOperation = 'lighter';
  for (const f of FLIES) {
    const x = f.ax + Math.sin(t * 0.3 * f.s + f.p) * 1.5, y = f.ay + Math.cos(t * 0.26 * f.s + f.p * 1.3) * 1.2;
    const [sx, sy] = iso(x, y, 14 + Math.sin(t * 0.8 + f.p) * 8);
    const a = Math.max(0, Math.sin(t * 1.6 * f.s + f.p)) * (powerCut ? 1 : 0.8);
    if (a < 0.05) continue;
    const g = ctx.createRadialGradient(sx, sy, 0, sx, sy, 7);
    g.addColorStop(0, `rgba(220,255,140,${a})`); g.addColorStop(1, 'rgba(220,255,140,0)');
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(sx, sy, 7, 0, Math.PI * 2); ctx.fill();
  }
  ctx.restore();
}
