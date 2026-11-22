// Movement on the grid: which tiles you can walk on, shortest paths, and walking along a path.
// Works in world tiles only, so it does not care how the map is drawn or turned.
import { T } from './village.js';

// big objects you cannot walk through
const BLOCKING = new Set(['temple', 'well', 'tank', 'tractor', 'auto', 'haystack', 'tapri']);
// Furniture (beds, sofas, counters…) is NOT blocking on purpose: rooms are only 2 x 2 tiles and furniture is smaller
// than a tile, so blocking whole tiles shuts rooms and hiding spots off. People walk past furniture; the drawing
// puts it in front of or behind them correctly.

export function makeBlockGrid(v) {
  const n = v.N;
  const block = Array.from({ length: n }, () => Array(n).fill(false));
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const t = v.tiles[y][x].t;
    if (t === T.WALL || t === T.WATER) block[y][x] = true;
  }
  for (const o of v.objects) {
    if (!BLOCKING.has(o.kind)) continue;
    if (o.w) {
      for (let y = Math.floor(o.y); y < Math.ceil(o.y + o.d); y++)
        for (let x = Math.floor(o.x); x < Math.ceil(o.x + o.w); x++) if (block[y]) block[y][x] = true;
    } else block[Math.floor(o.y)][Math.floor(o.x)] = true;
  }
  return block;
}

// shortest path (breadth-first search, 4 directions), as tile centres, not including the start tile
export function findPath(block, sx, sy, tx, ty) {
  const n = block.length;
  const s = [Math.floor(sx), Math.floor(sy)], g = [Math.floor(tx), Math.floor(ty)];
  if (block[g[1]]?.[g[0]] !== false) return null;
  const id = (x, y) => y * n + x;
  const prev = new Int32Array(n * n).fill(-1);
  const queue = [id(...s)];
  prev[queue[0]] = queue[0];
  for (let head = 0; head < queue.length; head++) {
    const c = queue[head], cx = c % n, cy = (c / n) | 0;
    if (cx === g[0] && cy === g[1]) break;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = cx + dx, ny = cy + dy;
      if (nx < 0 || ny < 0 || nx >= n || ny >= n || block[ny][nx]) continue;
      const k = id(nx, ny);
      if (prev[k] !== -1) continue;
      prev[k] = c; queue.push(k);
    }
  }
  const goal = id(...g);
  if (prev[goal] === -1) return null;
  const path = [];
  for (let k = goal; k !== prev[k]; k = prev[k]) path.push([(k % n) + 0.5, ((k / n) | 0) + 0.5]);
  return path.reverse();
}

// send an agent to an exact point; returns false when there is no way there
export function goTo(a, block, x, y) {
  const p = findPath(block, a.x, a.y, x, y);
  if (!p) return false;
  if (p.length) p.pop();
  p.push([x, y]);
  a.path = p;
  return true;
}

// move along the path; returns true when the agent has arrived
export function stepAgent(a, dt, speed = 2.4) {
  if (!a.path || !a.path.length) { a.moving = false; return true; }
  let left = speed * dt;
  while (left > 0 && a.path.length) {
    const [tx, ty] = a.path[0];
    const dx = tx - a.x, dy = ty - a.y, d = Math.hypot(dx, dy);
    if (d <= left) { a.x = tx; a.y = ty; a.path.shift(); left -= d; }
    else { a.x += (dx / d) * left; a.y += (dy / d) * left; left = 0; }
  }
  a.moving = a.path.length > 0;
  a.walk = (a.walk || 0) + dt * 10;
  return !a.moving;
}
