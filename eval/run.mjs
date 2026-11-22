// Headless measurement: plays many rounds with the real game rules (no drawing, no voices) and writes results.
// Usage:  node eval/run.mjs <experiment> [rounds]       experiments are listed below
// Results are appended to eval/results.jsonl, one line per round, so a stopped run loses nothing.
import { appendFileSync, readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const src = join(here, '..', 'src') + '/';
const { buildVillage } = await import(src + 'village.js');
const { makeBlockGrid } = await import(src + 'sim.js');
const { lightMap, makeSightGrid } = await import(src + 'rules.js');
const { Game } = await import(src + 'game.js');

const village = buildVillage(), block = makeBlockGrid(village), sight = makeSightGrid(village, block);
const HOME = [[21.5, 11.35], [23.4, 10.35]];
const base = { speed: 3, night: 3, stealth: 3, memory: 3 };

// each experiment: a name, a brain/ability setup for the seeker (agent 0) and the hider (agent 1), and the number of rounds
const S = (model, over = {}) => ({ model, stats: { ...base, ...over } });
const EXPERIMENTS = {
  // does the AI beat simple rules? (equal abilities)
  'scripted-vs-scripted': { seeker: S('scripted'), hider: S('scripted'), rounds: 200 },
  'ai8-seeker-vs-scripted': { seeker: S('qwen3:8b'), hider: S('scripted'), rounds: 60 },
  'scripted-vs-ai8-hider': { seeker: S('scripted'), hider: S('qwen3:8b'), rounds: 60 },
  'ai8-vs-ai8': { seeker: S('qwen3:8b'), hider: S('qwen3:8b'), rounds: 60 },
  // does the bigger model help?
  'ai14-seeker-vs-ai8': { seeker: S('qwen3:14b'), hider: S('qwen3:8b'), rounds: 20 },
  'ai8-seeker-vs-ai14': { seeker: S('qwen3:8b'), hider: S('qwen3:14b'), rounds: 20 },
  // does memory help? (both agents remember 0 rounds, or the last 5)
  'ai8-no-memory': { seeker: S('qwen3:8b', { memory: 0 }), hider: S('qwen3:8b', { memory: 0 }), rounds: 40 },
  'ai8-memory5': { seeker: S('qwen3:8b', { memory: 5 }), hider: S('qwen3:8b', { memory: 5 }), rounds: 40 },
  // do the abilities change anything? (scripted brains so only the abilities differ)
  'stealth5-vs-stealth1': { seeker: S('scripted'), hider: S('scripted', { stealth: 5 }), rounds: 200 },
  'stealth1-hider': { seeker: S('scripted'), hider: S('scripted', { stealth: 1 }), rounds: 200 },
  'night5-seeker': { seeker: S('scripted', { night: 5 }), hider: S('scripted'), rounds: 200 },
  'night1-seeker': { seeker: S('scripted', { night: 1 }), hider: S('scripted'), rounds: 200 },
};
export { EXPERIMENTS };

const [, , name, nArg] = process.argv;
if (!name || !EXPERIMENTS[name]) { console.log('experiments:', Object.keys(EXPERIMENTS).join(', ')); process.exit(name ? 1 : 0); }
const ex = EXPERIMENTS[name], rounds = Number(nArg) || ex.rounds;
const out = join(here, process.env.PILOT ? 'pilot.jsonl' : 'results.jsonl'); // PILOT=1: a small practice run, kept apart from the final results
const done = existsSync(out) ? readFileSync(out, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)).filter((r) => r.experiment === name).length : 0;

const mk = (id, name, cfg) => ({ id, name, voice: id ? 'f' : 'm', model: cfg.model, stats: { ...cfg.stats }, x: HOME[id][0], y: HOME[id][1], z: 10, bubble: '', status: '', thoughts: [], path: [] });
const agents = [mk(0, 'Arjun', ex.seeker), mk(1, 'Meera', ex.hider)];
let invalid = 0, failed = 0;
const game = new Game({ village, block, sight, agents, home: HOME, ui: {
  log(m) { if (/invalid choice/.test(m)) invalid++; if (/model failed/.test(m)) failed++; },
  changed() {}, speak() {}, finished() {},
} });
game.online = ex.seeker.model !== 'scripted' || ex.hider.model !== 'scripted';
game.light = lightMap(village, false);
game.seekTime = 60;
game.seekerId = 0;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

console.log(`${name}: ${rounds} rounds (${done} already saved)`);
const started = Date.now();
for (let i = 0; i < rounds; i++) {
  agents.forEach((a, k) => { a.x = HOME[k][0]; a.y = HOME[k][1]; a.path = []; a.hidden = false; a.thoughts = []; });
  game.phase = 'setup'; game.speechMode = false;
  const before = { invalid, failed };
  game.start();
  let guard = 0;
  while (game.phase !== 'over') {
    game.update(0.05);
    if (agents.some((a) => a.thinking)) await sleep(15); else if (++guard % 200 === 0) await sleep(0);
    if (++guard > 2_000_000) throw new Error('round did not finish');
  }
  const rec = game.result.rec;
  const line = { experiment: name, round: i + 1, found: rec.found, searches: rec.searches.length, timeUsed: +(game.seekTime - game.timeLeft).toFixed(1),
    spot: rec.spot, seekerBrain: ex.seeker.model, hiderBrain: ex.hider.model, invalid: invalid - before.invalid, failed: failed - before.failed };
  appendFileSync(out, JSON.stringify(line) + '\n');
  if ((i + 1) % 10 === 0) console.log(`  ${i + 1}/${rounds} (${Math.round((Date.now() - started) / 1000)} s)`);
}
console.log(`done in ${Math.round((Date.now() - started) / 1000)} s`);
