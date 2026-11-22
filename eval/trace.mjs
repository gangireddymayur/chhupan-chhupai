// Plays real rounds (qwen3:8b for both) without drawing, saves every moment of each round, and picks a good one to replay as a video.
// Usage:  node eval/trace.mjs <rounds>      Output: video/traces/round-N.json (every tick of the round), video/traces/index.json
// Then: node eval/select.mjs   picks the best round and makes video/best.json
// Arjun is always the seeker and Meera the hider, so the story is easy to follow.
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const src = join(here, '..', 'src') + '/';
const { buildVillage } = await import(src + 'village.js');
const { makeBlockGrid } = await import(src + 'sim.js');
const { lightMap, makeSightGrid } = await import(src + 'rules.js');
const { Game } = await import(src + 'game.js');
const outDir = join(here, '..', 'video', 'traces');
mkdirSync(outDir, { recursive: true });

const village = buildVillage(), block = makeBlockGrid(village), sight = makeSightGrid(village, block);
const HOME = [[21.5, 11.35], [23.4, 10.35]];
const mk = (id, name, stats) => ({ id, name, voice: id ? 'f' : 'm', model: 'qwen3:8b', stats, x: HOME[id][0], y: HOME[id][1], z: 10, bubble: '', status: '', thoughts: [], path: [] });
const agents = [mk(0, 'Arjun', { speed: 4, night: 4, stealth: 2, memory: 4 }), mk(1, 'Meera', { speed: 3, night: 2, stealth: 4, memory: 4 })];
// Speech is not played here, but it takes time, so the game waits for it exactly as in the browser: a spoken line
// holds the voice queue for a while (words x 0.4 s), the hider's line comes before the counting, and so on.
// Every line and the start of the counting are logged with the tick they happen at, so the video can add real audio later.
let tick = 0, qEnd = 0, events = [];
const waits = [];
const dur = (t) => Math.round((String(t).split(/\s+/).length * 0.4 + 0.3) * 20); // in ticks (20 per second)
const game = new Game({ village, block, sight, agents, home: HOME, ui: {
  log() {}, changed() {}, finished() {},
  speak: (a, text) => new Promise((res) => {
    const start = Math.max(tick, qEnd), end = start + dur(text); qEnd = end;
    events.push({ kind: 'line', agent: a.id, text, tick: start }); // the tick where the voice actually starts
    waits.push({ at: end, res });
  }),
  countAloud: (a) => { events.push({ kind: 'count', agent: a.id, tick: Math.max(tick, qEnd) }); return false; },
} });
const advance = () => { tick++; for (let k = waits.length - 1; k >= 0; k--) if (waits[k].at <= tick) waits.splice(k, 1)[0].res(); };
game.online = true; game.light = lightMap(village, false); game.seekTime = Number(process.env.SEEK) || 60; game.seekerId = 0;
const WANT = process.env.WANT || 'found'; // 'found': keep rounds where the seeker wins; 'hiderwin': keep rounds where the hider stays hidden (files fail-N.json)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const n = Number(process.argv[2]) || 20;

const snap = () => ({
  p: game.phase, tl: +game.timeLeft.toFixed(2), c: game.counting ? 1 : 0,
  tg: game.target ? [game.target.x, game.target.y] : null,
  a: agents.map((a) => [+a.x.toFixed(3), +a.y.toFixed(3), a.z, a.hidden ? 1 : 0, a.moving ? 1 : 0, +(a.walk || 0).toFixed(2), a.thinking ? 1 : 0, a.bubble, a.status]),
});

const index = [];
const boring = new Set(['Behind the haystack', 'Pond ghat steps']);
const den = village.den;
let saved = 0, attempts = 0;
while (saved < n && attempts < n * (WANT === 'hiderwin' ? 150 : 8)) {
  attempts++;
  await sleep(20); // let the last round's speech chain finish before starting over
  agents.forEach((a, k) => { a.x = HOME[k][0]; a.y = HOME[k][1]; a.path = []; a.hidden = false; a.thoughts = []; a.bubble = ''; });
  game.phase = 'setup'; game.speechMode = false;
  tick = 0; qEnd = 0; events = []; waits.length = 0;
  game.start();
  const snaps = [snap()];
  let guard = 0, skip = false;
  while (game.phase !== 'over') {
    advance(); game.update(0.05); snaps.push(snap());
    // not interesting for a video? (she hid close to the den, or in one of the two spots the AI loves): drop the round now
    if (game.spot && (boring.has(game.spot.name) || Math.hypot(game.spot.x - den.x, game.spot.y - den.y) < 12)) { skip = true; break; }
    if (agents.some((a) => a.thinking)) await sleep(15); else if (++guard % 200 === 0) await sleep(0);
    if (snaps.length > 9000) throw new Error(`round did not finish: phase=${game.phase} counting=${game.counting} speechMode=${game.speechMode} hidden=${agents[1].hidden} moving=${agents[1].moving} thinking=${agents.map((x) => x.thinking)} waits=${waits.length} tick=${tick} qEnd=${qEnd} spot=${game.spot && game.spot.name} count=${game.count}`);
  }
  if (skip) { game.token++; waits.length = 0; console.log(`  (attempt ${attempts}: dropped, she chose "${game.spot.name}")`); continue; }
  for (let k = 0; k < 110; k++) { advance(); game.update(0.05); snaps.push(snap()); await sleep(0); } // a few seconds after the end: the last lines are still being said
  const rec = game.result.rec;
  if ((WANT === 'hiderwin') === rec.found) { console.log(`  (attempt ${attempts}: ${rec.found ? 'seeker won' : 'hider won'}, not wanted)`); continue; }
  const spot = village.hideSpots.find((s) => s.name === rec.spot);
  const far = spot ? Math.hypot(spot.x - den.x, spot.y - den.y) : 0;
  saved++;
  const meta = { events, round: saved, found: rec.found, spot: rec.spot, searches: rec.searches.length, farFromDen: +far.toFixed(1), ticks: snaps.length,
    seekSecs: +(game.seekTime - game.timeLeft).toFixed(1), thoughts: agents.map((a) => a.thoughts.map((t) => t.text).reverse()) };
  writeFileSync(join(outDir, `${WANT === 'hiderwin' ? 'fail' : 'round'}-${saved}.json`), JSON.stringify({ meta, snaps }));
  index.push(meta);
  console.log(`round ${saved}: ${rec.found ? 'FOUND' : 'hider won'} at "${rec.spot}" after ${rec.searches.length} searches, ${snaps.length} ticks, ${far.toFixed(0)} tiles from the den (attempt ${attempts})`);
}
writeFileSync(join(outDir, 'index.json'), JSON.stringify(index, null, 1));
console.log(`saved ${saved} rounds in ${attempts} attempts. Next: node eval/select.mjs`);
