// The rules of seeing. Everything works on the world grid, never on the drawing.
//  - Walls and big objects (temple, haystack, tank…) block the line of sight. Water does not.
//  - Light matters: in a lit place the seeker spots you from far away; in the dark only close up.
//    How close depends on the seeker's night vision.
//  - A hider who is crouched in a hiding spot is harder to notice: the better their stealth,
//    the closer the seeker must come.
import { T } from './village.js';

export const MAX_SIGHT = 9;      // tiles
const LIT_RANGE = 8.5;           // how far you can see a person standing in good light

// how bright each tile is, from 0 (dark) to about 1 (right under a lamp)
export function lightMap(v, powerCut) {
  const n = v.N;
  const L = Array.from({ length: n }, () => new Float32Array(n));
  for (const l of v.lights) {
    if (l.kind === 'tv') continue;
    if (powerCut && l.kind !== 'diya' && l.kind !== 'lantern') continue;
    for (let y = Math.max(0, Math.floor(l.y - l.r)); y <= Math.min(n - 1, Math.ceil(l.y + l.r)); y++)
      for (let x = Math.max(0, Math.floor(l.x - l.r)); x <= Math.min(n - 1, Math.ceil(l.x + l.r)); x++) {
        const d = Math.hypot(x + 0.5 - l.x, y + 0.5 - l.y);
        if (d < l.r) L[y][x] = Math.max(L[y][x], l.k * (1 - d / l.r));
      }
  }
  return L;
}
export const lightWord = (v) => (v < 0.15 ? 'dark' : v < 0.4 ? 'dim' : 'lit');

// what blocks the view: the walking grid, except that you can see across water
export function makeSightGrid(v, block) {
  return block.map((row, y) => row.map((b, x) => b && v.tiles[y][x].t !== T.WATER));
}

export function lineOfSight(sight, ax, ay, bx, by) {
  const d = Math.hypot(bx - ax, by - ay), steps = Math.ceil(d * 4);
  const sx = Math.floor(ax), sy = Math.floor(ay), ex = Math.floor(bx), ey = Math.floor(by);
  for (let i = 1; i < steps; i++) {
    const x = Math.floor(ax + ((bx - ax) * i) / steps), y = Math.floor(ay + ((by - ay) * i) / steps);
    if ((x === sx && y === sy) || (x === ex && y === ey)) continue;
    if (sight[y]?.[x]) return false;
  }
  return true;
}

// how far the seeker can spot a person standing in this much light
export function sightRange(stats, light) {
  const dark = 1.2 + 0.6 * stats.night; // night vision 1..5 -> 1.8..4.2 tiles in the dark
  return dark + (LIT_RANGE - dark) * Math.min(1, light / 0.5);
}
// how close the seeker must come to notice a crouched hider
export const hiddenRange = (stealth) => 3.0 - 0.35 * stealth; // stealth 1..5 -> 2.65..1.25 tiles

// When the seeker CHECKS a spot where the hider is crouched, does he notice her? A chance, not a certainty:
// better stealth hides her, better night vision and more light help him.
//   chance = 85% + 8 points per night-vision level above 3 - 8 points per stealth level above 3 + light (dim +4, lit +8), kept between 10% and 98%
// examples (dark spot): equal 3/3 -> 85%;  stealth 5 -> 69%;  stealth 1 -> 98%;  night vision 5 -> 98%, night vision 1 -> 69%
export function detectChance(seekerStats, hiderStats, light) {
  const lightBonus = light >= 0.4 ? 0.08 : light >= 0.15 ? 0.04 : 0;
  const p = 0.85 + 0.08 * (seekerStats.night - 3) - 0.08 * (hiderStats.stealth - 3) + lightBonus;
  return Math.min(0.98, Math.max(0.10, p));
}

export function canSee(sight, light, S, H) {
  const d = Math.hypot(S.x - H.x, S.y - H.y);
  if (d > MAX_SIGHT) return false;
  let range = sightRange(S.stats, light[Math.floor(H.y)][Math.floor(H.x)]);
  if (H.hidden) return false; // a crouched hider is found by checking her spot (see detectChance), not by walking past
  if (d > range) return false;
  return lineOfSight(sight, S.x, S.y, H.x, H.y);
}

// every tile the seeker could see a standing person on (for the "seeker's eyes" overlay)
export function visibleTiles(sight, light, S) {
  const out = [];
  const n = sight.length;
  for (let y = Math.max(0, Math.floor(S.y - MAX_SIGHT)); y <= Math.min(n - 1, Math.ceil(S.y + MAX_SIGHT)); y++)
    for (let x = Math.max(0, Math.floor(S.x - MAX_SIGHT)); x <= Math.min(n - 1, Math.ceil(S.x + MAX_SIGHT)); x++) {
      if (sight[y][x]) continue;
      const d = Math.hypot(x + 0.5 - S.x, y + 0.5 - S.y);
      if (d > sightRange(S.stats, light[y][x])) continue;
      if (lineOfSight(sight, S.x, S.y, x + 0.5, y + 0.5)) out.push([x, y]);
    }
  return out;
}
