// Isometric maths and small drawing helpers.
// A tile is 1 x 1 in grid units. On screen a tile is a 64 x 32 diamond (2:1 isometric, like Clash of Clans).
export const TW = 64, TH = 32, HW = TW / 2, HH = TH / 2;
export const ZS = 40; // screen pixels per 1 tile of height (used for round things standing up)

// The view can be turned in 90 degree steps. "World" coordinates never change (the game uses them);
// "view" coordinates are the world turned, and only the drawing uses them.
let ROT = 0, RN = 36;
export function setView(r, n) { ROT = ((r % 4) + 4) % 4; RN = n; }
export const getRot = () => ROT;
export function toView(x, y) {
  switch (ROT) { case 1: return [RN - y, x]; case 2: return [RN - x, RN - y]; case 3: return [y, RN - x]; default: return [x, y]; }
}
export function fromView(vx, vy) {
  switch (ROT) { case 1: return [vy, RN - vx]; case 2: return [RN - vx, RN - vy]; case 3: return [RN - vy, vx]; default: return [vx, vy]; }
}
// a direction in view space -> the same direction in world space
export function dirFromView(a, b) {
  switch (ROT) { case 1: return [b, -a]; case 2: return [-a, -b]; case 3: return [-b, a]; default: return [a, b]; }
}
// does a face whose outward direction is (nx, ny) in the world face the camera?
export function faceVisible(nx, ny) {
  const v = ROT === 1 ? [-ny, nx] : ROT === 2 ? [-nx, -ny] : ROT === 3 ? [ny, -nx] : [nx, ny];
  return v[0] > 0 || v[1] > 0;
}

export const isoV = (vx, vy, z = 0) => [(vx - vy) * HW, (vx + vy) * HH - z];
// world grid (x, y, height z in px) -> screen point, with view tile (0,0) at the top corner
export const iso = (x, y, z = 0) => { const [vx, vy] = toView(x, y); return isoV(vx, vy, z); };

// screen point (relative to the iso origin) -> world grid point on the ground
export const unIso = (sx, sy) => fromView((sx / HW + sy / HH) / 2, (sy / HH - sx / HW) / 2);

// repeatable "random" number in [0, 1) for a tile, so the map looks the same every time
export function hash(x, y, s = 0) {
  const v = Math.sin(x * 127.1 + y * 311.7 + s * 74.7) * 43758.5453;
  return v - Math.floor(v);
}

export function hexRgb(hex) {
  let c = hex.replace('#', '');
  if (c.length === 3) c = [...c].map((ch) => ch + ch).join('');
  const n = parseInt(c, 16);
  return [n >> 16, (n >> 8) & 255, n & 255];
}
export function shade(hex, amt) {
  const [r, g, b] = hexRgb(hex);
  const t = amt < 0 ? 0 : 255, p = Math.abs(amt);
  const f = (v) => Math.round((t - v) * p + v);
  return `rgb(${f(r)},${f(g)},${f(b)})`;
}
export const rgba = (hex, a) => { const [r, g, b] = hexRgb(hex); return `rgba(${r},${g},${b},${a})`; };

export function fillPoly(ctx, pts, fill, stroke, lw = 1) {
  ctx.beginPath();
  ctx.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
  ctx.closePath();
  if (fill) { ctx.fillStyle = fill; ctx.fill(); }
  if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = lw; ctx.stroke(); }
}

export function line(ctx, a, b, color, lw = 1) {
  ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]);
  ctx.strokeStyle = color; ctx.lineWidth = lw; ctx.stroke();
}

// flat rectangle on the ground (or at height z)
export function quad(ctx, x0, y0, x1, y1, z, fill, stroke) {
  fillPoly(ctx, [iso(x0, y0, z), iso(x1, y0, z), iso(x1, y1, z), iso(x0, y1, z)], fill, stroke);
}

// a box from (x0,y0) to (x1,y1), from height z0 to z1. Only the three faces the camera sees are drawn.
export function prism(ctx, wx0, wy0, wx1, wy1, z0, z1, color, o = {}) {
  // turn the box into view space; a turned box is still a box, so only its corners need sorting
  const [a, b] = toView(wx0, wy0), [c, d] = toView(wx1, wy1);
  const x0 = Math.min(a, c), x1 = Math.max(a, c), y0 = Math.min(b, d), y1 = Math.max(b, d);
  const iso = isoV;
  const top = o.top || color;
  const right = o.right || shade(color, -0.16);
  const left = o.left || shade(color, -0.34);
  const e = o.edge, lw = o.lw || 0.7;
  fillPoly(ctx, [iso(x0, y1, z0), iso(x1, y1, z0), iso(x1, y1, z1), iso(x0, y1, z1)], left, e, lw);
  fillPoly(ctx, [iso(x1, y0, z0), iso(x1, y1, z0), iso(x1, y1, z1), iso(x1, y0, z1)], right, e, lw);
  fillPoly(ctx, [iso(x0, y0, z1), iso(x1, y0, z1), iso(x1, y1, z1), iso(x0, y1, z1)], top, e, lw);
}

// a circle lying on the ground (r in tiles)
export function groundEllipse(ctx, cx, cy, r, z, fill, stroke, lw = 1) {
  const [sx, sy] = iso(cx, cy, z);
  ctx.beginPath();
  ctx.ellipse(sx, sy, (r * TW) / Math.SQRT2, (r * TH) / Math.SQRT2, 0, 0, Math.PI * 2);
  if (fill) { ctx.fillStyle = fill; ctx.fill(); }
  if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = lw; ctx.stroke(); }
}

// an upright cylinder (pots, drums, gas cylinders, the well, the water tank)
export function cylinder(ctx, cx, cy, r, z0, z1, color, top) {
  const rx = (r * TW) / Math.SQRT2, ry = (r * TH) / Math.SQRT2;
  const [bx, by] = iso(cx, cy, z0);
  const ty = by - (z1 - z0);
  const g = ctx.createLinearGradient(bx - rx, 0, bx + rx, 0);
  g.addColorStop(0, shade(color, -0.38)); g.addColorStop(0.55, color); g.addColorStop(1, shade(color, -0.22));
  ctx.beginPath();
  ctx.moveTo(bx - rx, ty); ctx.lineTo(bx - rx, by);
  ctx.ellipse(bx, by, rx, ry, 0, Math.PI, 0, true);
  ctx.lineTo(bx + rx, ty); ctx.closePath();
  ctx.fillStyle = g; ctx.fill();
  ctx.beginPath(); ctx.ellipse(bx, ty, rx, ry, 0, 0, Math.PI * 2);
  ctx.fillStyle = top || shade(color, 0.12); ctx.fill();
}

// a standing circle (wheels): axis 'x' means the wheel faces along the x direction
export function vcircle(ctx, cx, cy, cz, r, axis, fill, stroke, lw = 1) {
  const pts = [];
  for (let i = 0; i < 24; i++) {
    const a = (i / 24) * Math.PI * 2;
    const u = Math.cos(a) * r, w = Math.sin(a) * r * ZS;
    pts.push(axis === 'x' ? iso(cx + u, cy, cz + w) : iso(cx, cy + u, cz + w));
  }
  fillPoly(ctx, pts, fill, stroke, lw);
}
