// Turns eval/results.jsonl into a table. Usage: node eval/report.mjs
// For each experiment: how often the seeker found the hider, with a 95% range (Wilson interval), and how long it took.
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const file = join(dirname(fileURLToPath(import.meta.url)), 'results.jsonl');
if (!existsSync(file)) { console.log('no results yet'); process.exit(0); }
const rows = readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));

function wilson(k, n, z = 1.96) {
  if (!n) return [0, 0];
  const p = k / n, d = 1 + (z * z) / n;
  const c = (p + (z * z) / (2 * n)) / d, h = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / d;
  return [c - h, c + h];
}
const pct = (x) => `${Math.round(x * 100)}%`;
const median = (a) => { const s = [...a].sort((x, y) => x - y); return s.length ? (s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : 0; };

const by = new Map();
for (const r of rows) { if (!by.has(r.experiment)) by.set(r.experiment, []); by.get(r.experiment).push(r); }

const lines = ['| Experiment | Rounds | Seeker found hider | 95% range | Median time to find | Invalid / failed AI answers |', '|---|---|---|---|---|---|'];
const summary = {};
for (const [name, rs] of by) {
  const k = rs.filter((r) => r.found).length, n = rs.length, [lo, hi] = wilson(k, n);
  const t = median(rs.filter((r) => r.found).map((r) => r.timeUsed));
  const bad = rs.reduce((a, r) => a + r.invalid, 0), fail = rs.reduce((a, r) => a + r.failed, 0);
  summary[name] = { n, k, rate: k / n, lo, hi };
  lines.push(`| ${name} | ${n} | ${k} (${pct(k / n)}) | ${pct(lo)} to ${pct(hi)} | ${t ? `${t.toFixed(0)} s` : '-'} | ${bad} / ${fail} |`);
}
console.log(lines.join('\n'));

// a plain comparison of two experiments: is the gap bigger than luck would explain? (two-proportion z test)
function compare(a, b, what) {
  const A = summary[a], B = summary[b];
  if (!A || !B) return;
  const p = (A.k + B.k) / (A.n + B.n), se = Math.sqrt(p * (1 - p) * (1 / A.n + 1 / B.n));
  const z = se ? (A.rate - B.rate) / se : 0;
  const verdict = Math.abs(z) >= 1.96 ? 'a real difference (not just luck)' : 'within the range luck can explain';
  console.log(`- ${what}: ${pct(A.rate)} vs ${pct(B.rate)} (gap ${((A.rate - B.rate) * 100).toFixed(0)} points, z = ${z.toFixed(2)}): ${verdict}`);
}
console.log('\nComparisons (seeker find rate):');
compare('ai8-seeker-vs-scripted', 'scripted-vs-scripted', 'AI seeker vs scripted seeker (scripted hider)');
compare('scripted-vs-ai8-hider', 'scripted-vs-scripted', 'AI hider vs scripted hider (scripted seeker); a LOWER find rate means a better hider');
compare('ai14-seeker-vs-ai8', 'ai8-vs-ai8', '14b seeker vs 8b seeker (8b hider)');
compare('ai8-seeker-vs-ai14', 'ai8-vs-ai8', '14b hider vs 8b hider (8b seeker); a LOWER find rate means a better hider');
compare('ai8-memory5', 'ai8-no-memory', 'memory 5 rounds vs no memory (8b vs 8b)');
compare('stealth5-vs-stealth1', 'stealth1-hider', 'hider stealth 5 vs stealth 1 (scripted); LOWER find rate = stealth helps');
compare('night5-seeker', 'night1-seeker', 'seeker night vision 5 vs 1 (scripted)');
