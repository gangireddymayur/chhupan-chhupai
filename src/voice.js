// Voices. Two ways to speak, the first one preferred:
//  1. The Mac's own voices through the local server (server.py, GET /tts): the same Isha and Rishi voices as in the video.
//     This works in every browser, because the sound is an ordinary audio file.
//  2. The browser's built-in speech (speechSynthesis), used when the server is not running. It can be silent in some browsers,
//     so a voice that does not start is skipped and the line is said again with another voice.
// Everything goes through ONE queue: lines take turns and never cut each other off. speak() returns a promise that resolves when
// the line has been spoken, so the game can wait for one character to finish before the next one starts.
const BOY = ['Rishi', 'Aman', 'Prabhat', 'Ravi'];
const GIRL = ['Isha', 'Veena', 'Tara', 'Sangeeta', 'Neerja', 'Lekha'];
const supported = typeof window !== 'undefined' && !!window.speechSynthesis;
let voices = [];
const load = () => { voices = supported ? speechSynthesis.getVoices() : []; };
if (supported) { load(); speechSynthesis.onvoiceschanged = load; }

export const onVoiceProblem = { fn: null };
const problem = (m) => { if (onVoiceProblem.fn) onVoiceProblem.fn(m); };

// ---- way 1: the Mac voice server ----
let remote = null; // { m: 'Rishi (Enhanced)', f: 'Isha (Premium)' } when server.py is running on a Mac
export async function checkRemote() {
  try {
    const r = await fetch('/health', { signal: AbortSignal.timeout(1500) });
    const j = await r.json();
    remote = j.say && j.voices && j.voices.m && j.voices.f ? j.voices : null;
  } catch { remote = null; }
  return remote;
}
let audio = null;
// The recorder sets ctx and node: every voice clip is then played through that audio context, both to the speakers and into
// the recording, so the recording gets the voices directly (no "share tab audio" needed).
export const audioTap = { ctx: null, node: null };
function route(a) {
  const { ctx, node } = audioTap;
  if (!ctx) return;
  try {
    const g = ctx.createGain(); g.gain.value = a.volume; a.volume = 1; // the volume is applied once, in the audio graph
    ctx.createMediaElementSource(a).connect(g);
    g.connect(ctx.destination); if (node) g.connect(node);
  } catch (e) { /* plays normally */ }
}
function playRemote(item, done, fail) {
  const url = `/tts?voice=${item.kind}${item.sayRate ? `&rate=${item.sayRate}` : ''}&text=${encodeURIComponent(item.text)}`;
  fetch(url).then((r) => { if (!r.ok) throw new Error(`voice server ${r.status}`); return r.blob(); }).then((blob) => {
    if (item.cancelled) return null;
    const a = new Audio(URL.createObjectURL(blob));
    a.volume = item.volume ?? 1; audio = a; route(a);
    let iv = null;
    if (item.onProgress) iv = setInterval(() => { if (a.duration) item.onProgress(a.currentTime / a.duration); }, 80);
    a.onended = () => { clearInterval(iv); URL.revokeObjectURL(a.src); if (audio === a) audio = null; done(); };
    a.onerror = () => { clearInterval(iv); fail('audio could not play'); };
    return a.play();
  }).catch((e) => fail(String((e && e.message) || e)));
}

// ---- way 2: the browser's own speech ----
const bad = new Set(); // voices that load but never make a sound (Chrome on macOS can do this): skipped from then on
const lang = (v) => v.lang.replace('_', '-');
const quality = (v) => (/premium/i.test(v.name) ? 2 : /enhanced/i.test(v.name) ? 1 : 0);
function pick(kind) {
  const names = kind === 'm' ? BOY : GIRL;
  const matches = voices.filter((v) => !bad.has(v.name) && names.some((n) => v.name.includes(n)));
  matches.sort((a, b) => quality(b) - quality(a)
    || (lang(b) === 'en-IN') - (lang(a) === 'en-IN')
    || names.findIndex((n) => a.name.includes(n)) - names.findIndex((n) => b.name.includes(n)));
  return matches[0] || voices.find((v) => !bad.has(v.name) && lang(v) === 'en-IN') || voices.find((v) => !bad.has(v.name) && lang(v).startsWith('en')) || null;
}
export function voiceName(kind) {
  if (remote) return `${remote[kind]}, Mac voice`;
  const v = pick(kind); return v ? v.name : 'default voice';
}
function utterance(item) {
  const u = new SpeechSynthesisUtterance(item.text);
  const v = pick(item.kind);
  if (v) { u.voice = v; u.lang = v.lang; } else u.lang = 'en-IN';
  u.rate = item.rate || 1.0;
  u.volume = item.volume ?? 1;
  u.pitch = v && quality(v) > 0 ? 1.0 : item.kind === 'm' ? 0.85 : 1.0; // basic voices: a deeper boy so the two differ
  return u;
}

// ---- the queue ----
const queue = [];
let current = null;
function pump() {
  if (current || !queue.length) return;
  const item = (current = queue.shift());
  let over = false, started = false;
  const finish = () => { // leave this line for good
    if (over) return; over = true; clearTimeout(timer); clearTimeout(startTimer);
    if (current === item) current = null;
    item.after?.(); item.resolve();
    pump();
  };
  const timer = setTimeout(finish, item.maxMs || 25000); // never get stuck
  let startTimer = null;
  const again = (why, useBrowser) => { // this way failed: say the line again another way, once
    if (over) return;
    over = true; clearTimeout(timer); clearTimeout(startTimer);
    try { speechSynthesis.cancel(); } catch (e) { /* ignore */ }
    if (current === item) current = null;
    if (useBrowser) { remote = null; problem(`Mac voice server: ${why}. Using the browser's voices instead.`); }
    if (!item.retried) { item.retried = true; queue.unshift(item); } else { item.after?.(); item.resolve(); }
    pump();
  };

  if (remote && !item.noRemote) { playRemote(item, finish, (why) => again(why, true)); return; }

  const u = utterance(item);
  const name = u.voice ? u.voice.name : 'default voice';
  startTimer = setTimeout(() => { if (!started) { bad.add(name); problem(`${name}: no sound started. Trying another voice.`); again('', false); } }, 7000);
  u.onstart = () => { started = true; clearTimeout(startTimer); };
  u.onend = finish;
  u.onerror = (e) => { if (e.error === 'interrupted' || e.error === 'canceled') finish(); else { bad.add(name); problem(`${name}: ${e.error || 'error'}. Trying another voice.`); again('', false); } };
  if (item.onboundary) u.onboundary = item.onboundary;
  speechSynthesis.speak(u);
}
function push(item) {
  return new Promise((resolve) => {
    if (!item.text || (!supported && !remote)) { item.after?.(); resolve(); return; }
    item.resolve = resolve;
    while (queue.length >= 2) { const o = queue.shift(); o.after?.(); o.resolve(); } // fall behind? drop the oldest waiting line
    queue.push(item); pump();
  });
}

export function stopSpeaking() {
  while (queue.length) { const i = queue.shift(); i.after?.(); i.resolve(); }
  if (current) { const i = current; current = null; i.cancelled = true; i.after?.(); i.resolve(); }
  if (audio) { audio.pause(); audio = null; }
  if (supported) speechSynthesis.cancel();
}

// speak a line as one of the two characters; resolves when it has been spoken
export const speak = (kind, text, opts = {}) => push({ kind, text, ...opts });

// Count 1 to 30 aloud, softly, like a child at the den with eyes closed. onNumber(n) fires as each number is spoken;
// onDone() at the end. Returns false when no voice is available (the game then counts on a timer).
const WORDS = ['one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen',
  'sixteen', 'seventeen', 'eighteen', 'nineteen', 'twenty', 'twenty one', 'twenty two', 'twenty three', 'twenty four', 'twenty five',
  'twenty six', 'twenty seven', 'twenty eight', 'twenty nine', 'thirty'];
export function countAloud(kind, onNumber, onDone) {
  if (!supported && !remote) return false;
  const starts = []; let at = 0;
  for (const w of WORDS) { starts.push(at); at += w.length + 2; }
  push({
    kind, text: WORDS.join(', '), rate: 1.45, sayRate: 330, volume: 0.3, maxMs: 40000,
    onboundary: (e) => { let n = 0; while (n + 1 < starts.length && starts[n + 1] <= e.charIndex) n++; onNumber(n + 1); }, // browser speech
    onProgress: (p) => onNumber(Math.min(WORDS.length, Math.floor(p * WORDS.length) + 1)),                                    // Mac voice
    after: () => { onNumber(WORDS.length); onDone(); },
  });
  return true;
}
