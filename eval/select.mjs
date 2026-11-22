// Picks the best saved round for a short video and writes video/best.json (frames + audio schedule).
// "Best" = Arjun finds Meera after a real search (2 to 5 places), she hid far from the den and not in the two places the AI
// loves (haystack, pond steps), and it tells well in about 25 s.
// The round is made shorter WITHOUT changing what happens: counting plays 4x faster, waiting for the AI 4x faster, walking 2x faster.
// Audio: every spoken line is made with the Mac's own voices (say), and lines take turns: when the next line would start
// while the previous one is still being said, the picture simply holds for a moment, so nothing overlaps.
// Usage: node eval/select.mjs [round-number]   (a number forces that round)
import { readFileSync, writeFileSync, readdirSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const dir = join(dirname(fileURLToPath(import.meta.url)), '..', 'video');
mkdirSync(join(dir, 'audio'), { recursive: true });
const RATE = 24, GAP = 0.25, TARGET = 24;
const VOICE = { 0: 'Rishi (Enhanced)', 1: 'Isha (Premium)' };

// which raw ticks to keep (their indices)
function keptTicks(snaps) {
  const kept = []; let ci = 0, ti = 0, wi = 0;
  snaps.forEach((s, i) => {
    const thinking = s.a[0][6] || s.a[1][6];
    if (thinking) { if (ti++ % 4 === 0) kept.push(i); }
    else if (s.p === 'hiding' && s.c) { if (ci++ % 4 === 0) kept.push(i); }
    else if (s.p === 'seeking' && (s.a[0][4] || s.a[1][4])) { if (wi++ % 2 === 0) kept.push(i); }
    else kept.push(i);
  });
  return kept;
}

const files = readdirSync(join(dir, 'traces')).filter((f) => /^round-\d+\.json$/.test(f));
const rounds = files.map((f) => JSON.parse(readFileSync(join(dir, 'traces', f), 'utf8'))).map((r) => ({ ...r, kept: keptTicks(r.snaps) }));
const boring = new Set(['Behind the haystack', 'Pond ghat steps']);
const forced = Number(process.argv[2]);
const approx = (r) => r.kept.length / RATE;
const good = rounds.filter((r) => r.meta.found && r.meta.searches >= 2 && r.meta.searches <= 5 && r.meta.farFromDen >= 12 && !boring.has(r.meta.spot))
  .sort((a, b) => Math.abs(approx(a) - TARGET) - Math.abs(approx(b) - TARGET));
console.log(`${rounds.length} rounds saved; ${rounds.filter((r) => r.meta.found).length} found; places Meera used:`,
  Object.entries(rounds.reduce((m, r) => ({ ...m, [r.meta.spot]: (m[r.meta.spot] || 0) + 1 }), {})).map(([k, v]) => `${k} x${v}`).join(', '));
console.log('candidates:', good.map((r) => `#${r.meta.round} ${r.meta.spot} (${r.meta.searches} searches, ~${approx(r).toFixed(0)} s)`).join(' | ') || 'none');
const pick = forced ? rounds.find((r) => r.meta.round === forced) : good[0];
if (!pick) { console.log('no round picked'); process.exit(0); }

// ---- which lines go into the video
const ev = pick.meta.events;
const lines = ev.filter((e) => e.kind === 'line');
const seekerThoughts = lines.filter((e) => e.agent === 0 && !/^Thirty/.test(e.text) && !/I see you/.test(e.text) && !/Time's up/.test(e.text));
const chosen = [];
const hideLine = lines.find((e) => e.agent === 1); if (hideLine) chosen.push(hideLine);
const count = ev.find((e) => e.kind === 'count'); if (count) chosen.push({ ...count, text: 'one two three four five six seven eight nine ten twenty five twenty six twenty seven twenty eight twenty nine thirty', gain: 0.3, rate: 400 });
const thirty = lines.find((e) => /^Thirty/.test(e.text)); if (thirty) chosen.push(thirty);
if (seekerThoughts[0]) chosen.push(seekerThoughts[0]);
if (seekerThoughts.length > 1) chosen.push(seekerThoughts.at(-1));
const caught = lines.find((e) => /I see you/.test(e.text)); if (caught) chosen.push(caught);
const oh = lines.find((e) => e.agent === 1 && /found me/.test(e.text)); if (oh) chosen.push(oh);
chosen.sort((a, b) => a.tick - b.tick);

// ---- make the audio and measure it
chosen.forEach((e, k) => {
  e.file = `audio/e${k}.wav`;
  const args = ['-v', VOICE[e.agent], '-o', join(dir, e.file), '--data-format=LEI16@24000'];
  if (e.rate) args.push('-r', String(e.rate));
  execFileSync('say', [...args, e.text]);
  const m = /estimated duration: ([\d.]+)/.exec(execFileSync('afinfo', [join(dir, e.file)]).toString());
  e.secs = +m[1];
});

// ---- build the final frame list, holding the picture where a line would start before the last one has ended
let frames = pick.kept.slice(), cursorEnd = 0;
const schedule = [];
for (const e of chosen) {
  let pos = frames.findIndex((i) => i >= e.tick); if (pos < 0) pos = frames.length - 1;
  if (pos < cursorEnd) {
    const extra = cursorEnd - pos;
    frames.splice(pos, 0, ...Array(extra).fill(frames[Math.max(0, pos - 1)]));
    pos = cursorEnd;
  }
  schedule.push({ file: e.file, tick: pos, gain: e.gain ?? 1, agent: e.agent, text: e.text, secs: e.secs });
  cursorEnd = pos + Math.ceil((e.secs + GAP) * RATE);
}
// end shortly after the last line has finished
const endTick = cursorEnd + Math.round(1.2 * RATE);
frames = frames.slice(0, Math.max(endTick, 1));
while (frames.length < endTick) frames.push(frames.at(-1));

const snaps = frames.map((i) => pick.snaps[i]);
writeFileSync(join(dir, 'best.json'), JSON.stringify({ meta: { ...pick.meta, events: undefined, picked: `round ${pick.meta.round} of ${rounds.length}` }, rate: RATE, snaps, audio: schedule }));
console.log(`best: round ${pick.meta.round} of ${rounds.length}: ${pick.meta.spot}, ${pick.meta.searches} searches, ${(snaps.length / RATE).toFixed(1)} s with audio`);
for (const a of schedule) console.log(`  ${(a.tick / RATE).toFixed(1)} s  ${a.agent ? 'Meera' : 'Arjun'}  (${a.secs.toFixed(1)} s)  ${a.text.slice(0, 70)}`);
