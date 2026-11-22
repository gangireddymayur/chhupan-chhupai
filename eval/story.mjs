// Builds a short two-round video story into video/story.json:
//   Round 1: the seeker FAILS (the hider stays hidden until the time runs out)   -> a trace from: WANT=hiderwin node eval/trace.mjs
//   Round 2: the seeker FINDS the hider                                          -> a trace from: node eval/trace.mjs
// Each round is shortened without changing what happens (counting, waiting for the AI and walking are sped up) and only the key
// lines are voiced, so the whole thing is about 30 to 35 seconds. Lines take turns: if a line would start before the previous one
// has finished, the picture holds for a moment.
// Usage: node eval/story.mjs [failFile] [winFile]     (defaults: the first fail-*.json and round-3.json in video/traces)
// Then render: open http://127.0.0.1:8790/?replay=video/story.json&offline=1&name=chhupan-story.mp4
import { readFileSync, writeFileSync, readdirSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const dir = join(dirname(fileURLToPath(import.meta.url)), '..', 'video');
const tdir = join(dir, 'traces');
mkdirSync(join(dir, 'audio'), { recursive: true });
const RATE = 24, GAP = 0.25, CARD = Math.round(0.9 * RATE);
const VOICE = { 0: 'Rishi (Enhanced)', 1: 'Isha (Premium)' };
const files = readdirSync(tdir);
const failFile = process.argv[2] || files.find((f) => /^fail-\d+\.json$/.test(f));
const winFile = process.argv[3] || (files.includes('round-3.json') ? 'round-3.json' : files.find((f) => /^round-\d+\.json$/.test(f)));
if (!failFile || !winFile) { console.log('need one fail-N.json and one round-N.json in video/traces'); process.exit(1); }

// how many ticks to skip per kind of moment (bigger = faster): thinking, counting, walking while searching, the hider running before the count
function keptTicks(snaps, f) {
  const kept = [], n = { think: 0, count: 0, walk: 0, hide: 0, other: 0 };
  const keep = (k, i) => { if (n[k]++ % f[k] === 0) kept.push(i); };
  snaps.forEach((s, i) => {
    const thinking = s.a[0][6] || s.a[1][6];
    if (thinking) keep('think', i);
    else if (s.p === 'hiding' && s.c) keep('count', i);
    else if (s.p === 'hiding') keep('hide', i);
    else if (s.p === 'seeking' && (s.a[0][4] || s.a[1][4])) keep('walk', i);
    else if (s.p === 'seeking') keep('other', i);
    else kept.push(i);
  });
  return kept;
}

let clip = 0;
function say(e) {
  e.file = `audio/s${clip++}.wav`;
  const args = ['-v', VOICE[e.agent], '-o', join(dir, e.file), '--data-format=LEI16@24000'];
  if (e.rate) args.push('-r', String(e.rate));
  execFileSync('say', [...args, e.text]);
  e.secs = +/estimated duration: ([\d.]+)/.exec(execFileSync('afinfo', [join(dir, e.file)]).toString())[1];
  return e;
}

// one round -> { snaps, audio } with ticks starting at 0
function buildRound(trace, n, pickLines, speed) {
  const lines = pickLines(trace.meta.events);
  lines.forEach(say);
  lines.sort((a, b) => a.tick - b.tick);
  let frames = keptTicks(trace.snaps, speed), cursorEnd = 0;
  const audio = [];
  for (const e of lines) {
    let pos = frames.findIndex((i) => i >= e.tick); if (pos < 0) pos = frames.length - 1;
    if (pos < cursorEnd) { frames.splice(pos, 0, ...Array(cursorEnd - pos).fill(frames[Math.max(0, pos - 1)])); pos = cursorEnd; }
    audio.push({ file: e.file, tick: pos, gain: e.gain ?? 1, agent: e.agent, text: e.text, secs: e.secs });
    cursorEnd = pos + Math.ceil((e.secs + GAP) * RATE);
  }
  const end = cursorEnd + Math.round(0.9 * RATE);
  frames = frames.slice(0, end); while (frames.length < end) frames.push(frames.at(-1));
  const tag = { rn: n, rf: trace.meta.found, rs: trace.meta.spot };
  const snaps = frames.map((i) => ({ ...trace.snaps[i], ...tag, ...(speed.ff && trace.snaps[i].p === 'seeking' ? { ff: 1 } : {}) }));
  // a short title card before the round
  const card = Array.from({ length: CARD }, () => ({ ...snaps[0], card: `Round ${n}` }));
  return { snaps: [...card, ...snaps], audio: audio.map((a) => ({ ...a, tick: a.tick + CARD })), meta: trace.meta };
}

const lineOf = (ev, test) => ev.find((e) => e.kind === 'line' && test(e));
const count = (ev) => { const c = ev.find((e) => e.kind === 'count'); return c ? [{ ...c, text: 'one two three four five six seven eight nine ten twenty five twenty six twenty seven twenty eight twenty nine thirty', gain: 0.3, rate: 400 }] : []; };

// Round 1 (fail): Meera says where she goes, Arjun counts, "Thirty!", one search thought, then the time runs out
const fail = JSON.parse(readFileSync(join(tdir, failFile), 'utf8'));
const r1 = buildRound(fail, 1, (ev) => {
  const out = [];
  const hide = lineOf(ev, (e) => e.agent === 1); if (hide) out.push({ ...hide });
  out.push(...count(ev));
  const thirty = lineOf(ev, (e) => /^Thirty/.test(e.text)); if (thirty) out.push({ ...thirty });
  const up = lineOf(ev, (e) => /Time's up/.test(e.text)); // not voiced (the screen says "Time up"), only used for timing
  const here = lineOf(ev, (e) => e.agent === 1 && /right here/.test(e.text))
    || (up && { kind: 'line', agent: 1, text: "I'm right here! You never found me!", tick: up.tick + 1 }); // said right after "Time's up"
  if (here) out.push({ ...here });
  return out;
}, { think: 20, count: 6, walk: 18, hide: 3, other: 8, ff: true });

// Round 2 (win): no repeat of the intro; Meera's choice shows in her bubble; "Thirty!", one search thought, the catch
const win = JSON.parse(readFileSync(join(tdir, winFile), 'utf8'));
const r2 = buildRound(win, 2, (ev) => {
  const out = [];
  const thirty = lineOf(ev, (e) => /^Thirty/.test(e.text)); if (thirty) out.push({ ...thirty });
  const think = ev.filter((e) => e.kind === 'line' && e.agent === 0 && !/^Thirty|I see you|Time's up/.test(e.text));
  if (think.length) out.push({ ...think.at(-1) });
  const caught = lineOf(ev, (e) => /I see you/.test(e.text)); if (caught) out.push({ ...caught });
  const oh = lineOf(ev, (e) => e.agent === 1 && /found me/.test(e.text)); if (oh) out.push({ ...oh });
  return out;
}, { think: 10, count: 16, walk: 4, hide: 8, other: 2 });

const snaps = [...r1.snaps, ...r2.snaps];
const audio = [...r1.audio, ...r2.audio.map((a) => ({ ...a, tick: a.tick + r1.snaps.length }))];
writeFileSync(join(dir, 'story.json'), JSON.stringify({ meta: { story: true, found: true, spot: win.meta.spot, rounds: [failFile, winFile] }, rate: RATE, snaps, audio }));
console.log(`story: round 1 (${failFile}, hider stays at ${fail.meta.spot}) ${(r1.snaps.length / RATE).toFixed(1)} s + round 2 (${winFile}, found at ${win.meta.spot}) ${(r2.snaps.length / RATE).toFixed(1)} s = ${(snaps.length / RATE).toFixed(1)} s`);
for (const a of audio) console.log(`  ${(a.tick / RATE).toFixed(1)} s  ${a.agent ? 'Meera' : 'Arjun'} (${a.secs.toFixed(1)} s)  ${a.text.slice(0, 70)}`);
