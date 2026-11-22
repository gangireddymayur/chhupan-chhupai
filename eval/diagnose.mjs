// Health check for a batch of rounds (used between small pilot runs). Usage: node eval/diagnose.mjs [pilot|results] [experiment]
// Looks for the things that make agents look dumb: always the same hiding place, repeating the same place
// round after round, AI answers that were invalid, and one side winning almost every time.
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
const here = dirname(fileURLToPath(import.meta.url));
const file = join(here, `${process.argv[2] || 'pilot'}.jsonl`);
if (!existsSync(file)) { console.log('no file', file); process.exit(0); }
let rows = readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
if (process.argv[3]) rows = rows.filter((r) => r.experiment === process.argv[3]);
const by = {}; for (const r of rows) (by[r.experiment] ||= []).push(r);
for (const [name, rs] of Object.entries(by)) {
  const c = {}; for (const r of rs) c[r.spot] = (c[r.spot] || 0) + 1;
  const top = Object.entries(c).sort((a, b) => b[1] - a[1]);
  const repeats = rs.slice(1).filter((r, i) => r.spot === rs[i].spot).length;
  const found = rs.filter((r) => r.found).length;
  console.log(`${name}: ${rs.length} rounds`);
  console.log(`  hiding places used: ${top.length}; most common "${top[0][0]}" = ${Math.round((100 * top[0][1]) / rs.length)}% of rounds (even spread over ${Object.keys(c).length} would be ${Math.round(100 / Object.keys(c).length)}%)`);
  console.log(`  same hiding place as the round before: ${Math.round((100 * repeats) / Math.max(1, rs.length - 1))}% (random would be about ${Math.round(100 / Math.max(1, top.length))}%)`);
  console.log(`  seeker found hider: ${Math.round((100 * found) / rs.length)}%; invalid AI answers: ${rs.reduce((a, r) => a + r.invalid, 0)}; failed calls: ${rs.reduce((a, r) => a + r.failed, 0)}`);
}
