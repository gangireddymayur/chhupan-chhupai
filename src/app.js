// The page: camera (free, follow, auto), minimap, turning the view, wall styles, thought bubbles, voices,
// the agents' cards (abilities, brain, inner voice, memory), predictions and the round itself (see game.js).
import { buildVillage, N, T, TILE_NAMES } from './village.js';
import { iso, unIso, setView, getRot, toView, TW, HH } from './iso.js';
import { renderStatic, drawSky, drawLighting, drawPerson, drawSmoke, drawFireflies, drawBubble, drawSolid, blitPicture, WORLD } from './render.js';
import { makeBlockGrid } from './sim.js';
import { lightMap, makeSightGrid, visibleTiles } from './rules.js';
import { ollamaModels } from './agents.js';
import { Game, SEEK_TIMES } from './game.js';
import { speak, stopSpeaking, voiceName, countAloud, onVoiceProblem, checkRemote } from './voice.js';
import { Mp4Writer } from './mp4.js';

const village = buildVillage();
const block = makeBlockGrid(village);
const sight = makeSightGrid(village, block);
const $ = (id) => document.getElementById(id);
const canvas = $('world'), ctx = canvas.getContext('2d');
const mini = $('mini'), mctx = mini.getContext('2d');
const dark = document.createElement('canvas'), glow = document.createElement('canvas');
const stage = $('stage'), tooltip = $('tooltip');
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const dpr = Math.min(2, window.devicePixelRatio || 1);
const staticScale = Math.min(2, dpr);
const store = {
  get(k, d) { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* ignore */ } },
};

const opts = { labels: true, hides: false, power: false, bubbles: true, voices: true, eyes: false, walls: 'cut', bigMap: false, autoplay: false, watch: false };
const HOME = [[21.5, 11.35], [23.4, 10.35]];
const STATS = [['speed', 'Speed'], ['night', 'Night vision'], ['stealth', 'Stealth'], ['memory', 'Memory']];
const saved = store.get('chhupan.agents.v1', null);
const agents = [
  { id: 0, name: 'Arjun', color: '#ff7a59', hair: 'short', voice: 'm', model: 'qwen3:8b', stats: { speed: 4, night: 4, stealth: 2, memory: 4 } },
  { id: 1, name: 'Meera', color: '#5ad1c7', hair: 'long', voice: 'f', model: 'qwen3:8b', stats: { speed: 3, night: 2, stealth: 5, memory: 4 } },
].map((a, i) => ({ ...a, ...(saved?.[i] || {}), x: HOME[i][0], y: HOME[i][1], z: 10, bubble: '', status: 'At the peepal chabutra', thoughts: [], path: [] }));
const saveAgents = () => store.set('chhupan.agents.v1', agents.map(({ name, model, stats }) => ({ name, model, stats })));
const score = store.get('chhupan.score.v1', { right: 0, total: 0 });
let prediction = null; // agent id, or -1 for "no prediction"
let models = null;
const view = { cam: { x: 0, y: 0 }, zoom: 0.9, w: 0, h: 0, dpr, mode: 'free', fx: 0, fy: 0 };
let hover = null;

const game = new Game({
  village, block, sight, agents, home: HOME,
  ui: {
    log: addLog,
    changed: () => { dirty = true; },
    speak: (a, text) => (opts.voices ? speak(a.voice, text) : Promise.resolve()),
    countAloud: (a, onNumber, onDone) => opts.voices && countAloud(a.voice, onNumber, onDone),
    finished: showResult,
  },
});
let dirty = true;
function relight() { game.light = lightMap(village, opts.power); }
relight();

// ---------------------------------------------------------------- the big static picture (one per view angle and wall style)
setView(0, N);
const cache = new Map();
let picture, miniPic, current;
function rebuild() {
  const key = `${getRot()}|${opts.walls}`;
  if (!cache.has(key)) {
    const pic = renderStatic(village, staticScale, opts.walls);
    const small = document.createElement('canvas');
    small.width = 760; small.height = Math.round((760 * WORLD.h) / WORLD.w);
    small.getContext('2d').drawImage(pic, 0, 0, small.width, small.height);
    const entry = { pic, small, solids: pic.solids, bounds: pic.bounds, wallMode: opts.walls };
    cache.set(key, entry);
    // an ImageBitmap lives on the graphics card, so drawing it every frame is cheap
    createImageBitmap(pic).then((bm) => { entry.pic = bm; if (cache.get(`${getRot()}|${opts.walls}`) === entry) picture = bm; });
    if (cache.size > 3) { const old = cache.keys().next().value; const e = cache.get(old); if (e.pic.close) e.pic.close(); cache.delete(old); }
  }
  ({ pic: picture, small: miniPic } = cache.get(key));
  current = cache.get(key);
}

// ---------------------------------------------------------------- camera
function resize() {
  const r = stage.getBoundingClientRect();
  view.w = r.width; view.h = r.height;
  canvas.width = Math.round(r.width * dpr); canvas.height = Math.round(r.height * dpr);
}
function lookAt(x, y, zoom = view.zoom) {
  view.zoom = zoom;
  const [ix, iy] = iso(x, y, 30);
  view.cam.x = view.w / 2 - ix * zoom; view.cam.y = view.h / 2 - iy * zoom;
  view.fx = x; view.fy = y;
}
function zoomAt(f, sx, sy) {
  const z = Math.min(2.4, Math.max(0.32, view.zoom * f));
  view.cam.x = sx - (sx - view.cam.x) * (z / view.zoom);
  view.cam.y = sy - (sy - view.cam.y) * (z / view.zoom);
  view.zoom = z;
}
const toGrid = (sx, sy) => unIso((sx - view.cam.x) / view.zoom, (sy - view.cam.y) / view.zoom);
const centreGrid = () => unIso((view.w / 2 - view.cam.x) / view.zoom, (view.h / 2 - view.cam.y) / view.zoom + 30);

function setCam(mode) {
  if (mode !== 'free' && view.mode === 'free') [view.fx, view.fy] = centreGrid();
  view.mode = mode;
  document.querySelectorAll('#camctl button').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.cam === mode)));
}
document.querySelectorAll('#camctl button').forEach((b) => (b.onclick = () => setCam(b.dataset.cam)));

// where each camera mode wants to look, and how close
function camTarget() {
  const S = game.seeker, H = game.hider;
  if (view.mode === 'seeker') return [S.x, S.y, 1.45];
  if (view.mode === 'hider') return [H.x, H.y, 1.45];
  // Auto: a small camera director.
  //  - the hider decides and runs to her spot: follow her, close
  //  - then the seeker counts: close-up of him at the den
  //  - searching: follow the seeker, a little ahead of where he is walking, never zoomed far out
  //  - caught or time up: both in the frame, close
  //  - between rounds: the den
  if (game.phase === 'hiding') return H.hidden || (game.counting && !H.moving) ? [S.x, S.y, 1.5] : [H.x, H.y, 1.45];
  if (game.phase === 'seeking') {
    const t = game.target, ahead = t && S.moving ? 0.25 : 0;
    const d = Math.hypot(S.x - H.x, S.y - H.y);
    if (d < 7) return [S.x * 0.6 + H.x * 0.4, S.y * 0.6 + H.y * 0.4, Math.min(1.5, Math.max(1.0, 9 / (d + 3)))]; // close: show both
    return [S.x + (t ? (t.x - S.x) * ahead : 0), S.y + (t ? (t.y - S.y) * ahead : 0), 1.2];
  }
  if (game.phase === 'over') {
    const found = replay ? (replay.cur && replay.cur.rf !== undefined ? replay.cur.rf : replay.meta.found) : game.result && game.result.found;
    return found ? [(S.x + H.x) / 2, (S.y + H.y) / 2, 1.5] : [H.x, H.y, 1.45]; // hider won: show where she stayed hidden
  }
  return [village.den.x, village.den.y, 1.1];
}
function updateCamera(dt) {
  if (view.mode === 'free') return;
  const [tx, ty, tz] = camTarget();
  const k = 1 - Math.exp(-dt * 2.6);
  view.fx += (tx - view.fx) * k; view.fy += (ty - view.fy) * k; view.zoom += (tz - view.zoom) * k;
  const [ix, iy] = iso(view.fx, view.fy, 30);
  view.cam.x = view.w / 2 - ix * view.zoom; view.cam.y = view.h / 2 - iy * view.zoom;
}

let drag = null;
canvas.addEventListener('pointerdown', (e) => { drag = { x: e.clientX, y: e.clientY, cx: view.cam.x, cy: view.cam.y, moved: false }; canvas.setPointerCapture(e.pointerId); canvas.classList.add('dragging'); });
canvas.addEventListener('pointerup', (e) => { drag = null; canvas.releasePointerCapture(e.pointerId); canvas.classList.remove('dragging'); });
canvas.addEventListener('pointermove', (e) => {
  const r = canvas.getBoundingClientRect(), sx = e.clientX - r.left, sy = e.clientY - r.top;
  if (drag) {
    if (!drag.moved && Math.hypot(e.clientX - drag.x, e.clientY - drag.y) > 4) { drag.moved = true; setCam('free'); }
    if (drag.moved) { view.cam.x = drag.cx + e.clientX - drag.x; view.cam.y = drag.cy + e.clientY - drag.y; tooltip.hidden = true; hover = null; return; }
  }
  const [gx, gy] = toGrid(sx, sy), x = Math.floor(gx), y = Math.floor(gy);
  if (x < 0 || y < 0 || x >= N || y >= N) { hover = null; tooltip.hidden = true; return; }
  hover = { x, y };
  showTooltip(x, y, sx, sy);
});
canvas.addEventListener('pointerleave', () => { hover = null; tooltip.hidden = true; });
canvas.addEventListener('wheel', (e) => {
  e.preventDefault(); setCam('free');
  const r = canvas.getBoundingClientRect();
  zoomAt(Math.exp(-e.deltaY * 0.0015), e.clientX - r.left, e.clientY - r.top);
}, { passive: false });
$('zin').onclick = () => { setCam('free'); zoomAt(1.25, view.w / 2, view.h / 2); };
$('zout').onclick = () => { setCam('free'); zoomAt(0.8, view.w / 2, view.h / 2); };
$('zden').onclick = () => { setCam('free'); lookAt(village.den.x, village.den.y, 1.15); };
function turn(by) {
  const [x, y] = centreGrid();
  setView(getRot() + by, N); rebuild();
  if (view.mode === 'free') lookAt(x, y);
}
$('rotl').onclick = () => turn(-1);
$('rotr').onclick = () => turn(1);

function showTooltip(x, y, sx, sy) {
  const t = village.tiles[y][x];
  const spot = village.hideSpots.find((h) => Math.floor(h.x) === x && Math.floor(h.y) === y);
  const kind = t.t === T.FLOOR ? 'inside a house' : TILE_NAMES[t.t];
  const lv = game.light[y][x], light = lv < 0.15 ? 'dark' : lv < 0.4 ? 'dim' : 'lit';
  const walk = block[y][x] ? ' · cannot walk here' : '';
  tooltip.innerHTML = `<b>${esc(t.place)}</b><span>${kind} · ${light}${walk} · tile ${x}, ${y}</span>${spot ? `<div class="hide">Hiding spot: ${esc(spot.name)}</div>` : ''}`;
  tooltip.hidden = false;
  tooltip.style.left = `${Math.min(sx + 16, view.w - tooltip.offsetWidth - 10)}px`;
  tooltip.style.top = `${Math.min(sy + 16, view.h - tooltip.offsetHeight - 10)}px`;
}
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// ---------------------------------------------------------------- minimap
function miniLayout() {
  const S = opts.bigMap ? Math.max(168, Math.min(340, view.h - 110, view.w * 0.55)) : 168;
  return { S, s: (S * 0.94) / (N * TW), c: [S / 2, S / 2], iC: [0, N * HH] };
}
function drawMini() {
  const { S, s, c, iC } = miniLayout();
  if (mini.width !== Math.round(S * dpr)) { mini.width = mini.height = Math.round(S * dpr); mini.style.width = mini.style.height = `${S}px`; }
  const m = mctx;
  m.setTransform(dpr, 0, 0, dpr, 0, 0); m.clearRect(0, 0, S, S);
  m.save();
  m.beginPath(); if (opts.bigMap) m.roundRect(0, 0, S, S, 18); else m.arc(S / 2, S / 2, S / 2 - 1, 0, 7);
  m.fillStyle = '#080d22'; m.fill(); m.clip();
  m.drawImage(miniPic, c[0] - (WORLD.ox + iC[0]) * s, c[1] - (WORLD.oy + iC[1]) * s, WORLD.w * s, WORLD.h * s);
  m.fillStyle = opts.power ? 'rgba(2,5,18,0.55)' : 'rgba(5,9,30,0.3)'; m.fillRect(0, 0, S, S);
  const P = (ix, iy) => [c[0] + (ix - iC[0]) * s, c[1] + (iy - iC[1]) * s];
  const corners = [[0, 0], [view.w, 0], [view.w, view.h], [0, view.h]].map(([sx, sy]) => P((sx - view.cam.x) / view.zoom, (sy - view.cam.y) / view.zoom));
  m.beginPath(); m.moveTo(...corners[0]); corners.slice(1).forEach((q) => m.lineTo(...q)); m.closePath();
  m.fillStyle = 'rgba(255,209,102,0.08)'; m.fill(); m.strokeStyle = 'rgba(255,209,102,0.9)'; m.lineWidth = 1.2; m.stroke();
  if (opts.hides) for (const h of village.hideSpots) { const [px, py] = P(...iso(h.x, h.y)); m.fillStyle = '#3ee0cf'; m.beginPath(); m.arc(px, py, 2, 0, 7); m.fill(); }
  const t = performance.now() / 1000;
  for (const a of agents) {
    const [px, py] = P(...iso(a.x, a.y));
    const col = a.id === game.seekerId ? '#ff5d5d' : '#3ee0cf', r = opts.bigMap ? 6 : 4.5;
    m.strokeStyle = col; m.globalAlpha = 0.5 * (1 - ((t * 0.8) % 1)); m.lineWidth = 2;
    m.beginPath(); m.arc(px, py, r + ((t * 0.8) % 1) * 10, 0, 7); m.stroke(); m.globalAlpha = 1;
    m.fillStyle = col; m.strokeStyle = '#fff'; m.lineWidth = 1.5; m.beginPath(); m.arc(px, py, r, 0, 7); m.fill(); m.stroke();
    if (opts.bigMap) { m.font = '600 11px Inter, system-ui'; m.fillStyle = '#fff'; m.textAlign = 'left'; m.fillText(a.name, px + 9, py + 4); }
  }
  m.restore();
  m.beginPath(); if (opts.bigMap) m.roundRect(0.75, 0.75, S - 1.5, S - 1.5, 18); else m.arc(S / 2, S / 2, S / 2 - 1, 0, 7);
  m.strokeStyle = 'rgba(255,255,255,0.18)'; m.lineWidth = 1.5; m.stroke();
}
mini.addEventListener('click', (e) => {
  const r = mini.getBoundingClientRect(), { s, c, iC } = miniLayout();
  const ix = iC[0] + (e.clientX - r.left - c[0]) / s, iy = iC[1] + (e.clientY - r.top - c[1]) / s;
  setCam('free');
  view.cam.x = view.w / 2 - ix * view.zoom; view.cam.y = view.h / 2 - iy * view.zoom;
});
$('mapsize').onclick = () => {
  opts.bigMap = !opts.bigMap;
  $('mapsize').setAttribute('aria-label', opts.bigMap ? 'Make the map small' : 'Make the map big');
  $('mapsize').textContent = opts.bigMap ? '⤡' : '⤢';
  $('minimap').classList.toggle('big', opts.bigMap);
};

// ---------------------------------------------------------------- top bar switches
function bindToggle(id, key, after) {
  const b = $(id);
  b.classList.toggle('on', opts[key]); b.setAttribute('aria-pressed', opts[key]);
  b.onclick = () => { opts[key] = !opts[key]; b.classList.toggle('on', opts[key]); b.setAttribute('aria-pressed', opts[key]); if (after) after(); dirty = true; };
}
bindToggle('tg-labels', 'labels'); bindToggle('tg-hides', 'hides'); bindToggle('tg-bubbles', 'bubbles'); bindToggle('tg-eyes', 'eyes');
bindToggle('tg-power', 'power', relight);

// ---------------------------------------------------------------- record the game tab, with the voices
// Chrome asks which tab to share: pick THIS tab and keep "Also share tab audio" ticked. The voices come from the Mac voice server
// as normal page audio, so they end up in the recording. Press the button again (or "Stop sharing") to finish.
// The frames and sound are compressed with the browser's own encoders and written by src/mp4.js into a NORMAL mp4: Chrome's
// built-in recorder writes a "fragmented" mp4 that Mac players show as a frozen picture. The file is saved in video/ and downloaded.
let screenRec = null;
async function startScreenRecording() {
  let stream;
  try {
    stream = await navigator.mediaDevices.getDisplayMedia({
      video: { frameRate: 30, displaySurface: 'browser' }, audio: true,
      preferCurrentTab: true, selfBrowserSurface: 'include', surfaceSwitching: 'exclude', systemAudio: 'exclude',
    });
  } catch (e) { addLog('Recording not started (the share window was closed).'); return; }
  return recordStream(stream);
}
async function recordStream(stream) {
  const vTrack = stream.getVideoTracks()[0], aTrack = stream.getAudioTracks()[0];
  if (!aTrack) addLog('Recording WITHOUT sound: next time keep "Also share tab audio" ticked in the share window.');
  const st = vTrack.getSettings();
  const scale = Math.min(1, 1920 / (st.width || 1920));
  const W = Math.round(((st.width || 1920) * scale) / 2) * 2, H = Math.round(((st.height || 1080) * scale) / 2) * 2;
  const TS = 90000; // video time units per second
  let writer = null, venc = null, aenc = null, t0 = null, prev = null, frames = 0, failed = null;
  const fail = (e) => { failed = failed || String((e && e.message) || e); };
  const canvasScaled = new OffscreenCanvas(W, H), cx = canvasScaled.getContext('2d');
  const started = Date.now();
  const rec = { stopping: false, stop: () => { rec.stopping = true; } };
  screenRec = rec; setRecButton(true, started);
  addLog(aTrack ? `Recording this tab with sound (${W}×${H}). Press ⏹ Stop to finish.` : `Recording this tab without sound (${W}×${H}).`);
  vTrack.addEventListener('ended', () => rec.stop()); // "Stop sharing"

  // the first audio packet tells us the real sample rate and channels
  const aReader = aTrack ? new MediaStreamTrackProcessor({ track: aTrack }).readable.getReader() : null;
  const vReader = new MediaStreamTrackProcessor({ track: vTrack }).readable.getReader();
  let firstAudio = null;
  if (aReader) { const r = await aReader.read(); firstAudio = r.value; }
  const sr = firstAudio ? firstAudio.sampleRate : 48000, ch = firstAudio ? Math.min(2, firstAudio.numberOfChannels) : 2;
  writer = new Mp4Writer({ width: W, height: H, fps: 30, sampleRate: sr, channels: ch, videoTimescale: TS });
  const stamps = []; // real time of each frame, so each frame lasts exactly until the next one (picture and sound stay together)
  venc = new VideoEncoder({ output: (chunk, meta) => { const b = new Uint8Array(chunk.byteLength); chunk.copyTo(b); stamps.push(chunk.timestamp); writer.addVideo(b, chunk.type === 'key', meta, TS / 30); }, error: fail });
  venc.configure({ codec: W * H > 2_100_000 ? 'avc1.640033' : 'avc1.640028', width: W, height: H, bitrate: 6_000_000, framerate: 30, latencyMode: 'realtime', avc: { format: 'avc' } });
  if (aReader) {
    aenc = new AudioEncoder({ output: (chunk, meta) => { const b = new Uint8Array(chunk.byteLength); chunk.copyTo(b); writer.addAudio(b, meta); }, error: fail });
    aenc.configure({ codec: 'mp4a.40.2', sampleRate: sr, numberOfChannels: ch, bitrate: 160_000 });
  }

  // sound: encode everything from the moment the first picture arrives
  const audioLoop = (async () => {
    let ad = firstAudio;
    while (ad && !rec.stopping) {
      if (t0 !== null && ad.timestamp >= t0) {
        const copy = ch === ad.numberOfChannels ? ad : null;
        if (copy) aenc.encode(copy);
        else { // mono/extra channels: keep the first ch channels
          const n = ad.numberOfFrames, data = new Float32Array(n * ch);
          for (let c = 0; c < ch; c++) ad.copyTo(data.subarray(c * n, (c + 1) * n), { planeIndex: Math.min(c, ad.numberOfChannels - 1), format: 'f32-planar' });
          aenc.encode(new AudioData({ format: 'f32-planar', sampleRate: sr, numberOfFrames: n, numberOfChannels: ch, timestamp: ad.timestamp, data }));
        }
      }
      ad.close();
      const r = await aReader.read(); ad = r.done ? null : r.value;
    }
    if (ad) ad.close();
  })();

  // pictures: scale to at most 1920 wide, give each frame its real duration
  while (!rec.stopping) {
    const r = await vReader.read(); if (r.done) break;
    const f = r.value;
    if (t0 === null) t0 = f.timestamp;
    cx.drawImage(f, 0, 0, W, H);
    const ts = f.timestamp - t0; f.close();
    if (prev !== null && ts - prev < 15000) continue; // more than about 60 frames a second: skip
    const vf = new VideoFrame(canvasScaled, { timestamp: ts, duration: 33333 });
    venc.encode(vf, { keyFrame: frames % 60 === 0 }); vf.close();
    prev = ts; frames++;
    if (venc.encodeQueueSize > 8) await new Promise((res) => setTimeout(res, 5));
  }

  // finish
  stream.getTracks().forEach((t) => t.stop());
  try { vReader.cancel(); } catch (e) { /* ignore */ }
  try { aReader && aReader.cancel(); } catch (e) { /* ignore */ }
  await audioLoop.catch(() => {});
  try { await venc.flush(); if (aenc) await aenc.flush(); } catch (e) { fail(e); }
  for (let k = 0; k + 1 < writer.video.length; k++) writer.video[k].dur = Math.max(1, ((stamps[k + 1] - stamps[k]) * TS) / 1e6);
  screenRec = null; setRecButton(false);
  if (failed) { addLog(`Recording failed: ${failed}`); return; }
  let bytes;
  try { bytes = writer.finish(); } catch (e) { addLog(`Recording failed: ${e.message}`); return; }
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
  const name = `game-recording-${stamp}.mp4`, secs = Math.round((Date.now() - started) / 1000);
  const blob = new Blob([bytes], { type: 'video/mp4' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; a.click(); // also into Downloads
  try { await fetch(`/save?name=${encodeURIComponent(name)}`, { method: 'POST', body: blob }); addLog(`Recording saved (${secs} s, ${(blob.size / 1e6).toFixed(0)} MB, ${frames} frames): video/${name}`); }
  catch { addLog(`Recording downloaded (${secs} s): ${name}`); }
}
let recTimer = null;
function setRecButton(on, started) {
  const b = $('rec-btn');
  b.classList.toggle('on', on); b.setAttribute('aria-pressed', on);
  clearInterval(recTimer);
  if (on) { const tick = () => { const s = Math.round((Date.now() - started) / 1000); b.textContent = `⏹ Stop ${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; }; tick(); recTimer = setInterval(tick, 500); }
  else b.textContent = '⏺ Record';
}
$('rec-btn').onclick = () => { if (screenRec) screenRec.stop(); else startScreenRecording(); };
function setWatch(on) {
  opts.watch = on; document.body.classList.toggle('watch', on);
  $('caption').hidden = !on; $('exitwatch').hidden = !on;
  $('tg-watch').classList.toggle('on', on); $('tg-watch').setAttribute('aria-pressed', on);
  if (on) { opts.eyes = false; if (view.mode === 'free') setCam('auto'); }
  requestAnimationFrame(() => { resize(); });
}
$('tg-watch').onclick = () => setWatch(!opts.watch);
$('exitwatch').onclick = () => setWatch(false);
addEventListener('keydown', (e) => { if (e.key === 'Escape' && opts.watch) setWatch(false); });
bindToggle('tg-voices', 'voices', () => { if (!opts.voices) stopSpeaking(); else { speak('m', `Hi, I'm ${agents[0].name}.`); speak('f', `And I'm ${agents[1].name}.`); } });
document.querySelectorAll('#walls button').forEach((b) => {
  b.onclick = () => {
    opts.walls = b.dataset.w; rebuild();
    document.querySelectorAll('#walls button').forEach((q) => q.setAttribute('aria-checked', String(q === b)));
  };
});

// ---------------------------------------------------------------- result banner
function showResult(r) {
  const p = prediction;
  let verdict = '';
  if (p !== null && p >= 0) {
    const right = p === r.winner.id;
    score.total++; if (right) score.right++; store.set('chhupan.score.v1', score);
    verdict = right ? `<p class="verdict ok">You predicted ${esc(r.winner.name)}. Correct!</p>` : `<p class="verdict no">You predicted ${esc(agents[p].name)}. Not this time.</p>`;
  }
  const how = r.found
    ? `found ${esc(r.loser.name)} at <b>${esc(r.rec.spot)}</b> after ${r.rec.searches.length} search${r.rec.searches.length === 1 ? '' : 'es'}`
    : `stayed hidden at <b>${esc(r.rec.spot)}</b> for all ${game.seekTime} seconds`;
  $('banner').innerHTML = `<div class="trophy" style="--c:${r.winner.color}">${esc(r.winner.name[0])}</div>
    <h3>${esc(r.winner.name)} wins round ${r.rec.n}</h3><p>${esc(r.winner.name)} ${how}.</p>${verdict}
    <button id="again">Next round</button>`;
  $('banner').hidden = false;
  $('again').onclick = () => { $('banner').hidden = true; prediction = null; game.goHome(); };
  if (opts.autoplay) setTimeout(() => { if (game.phase === 'over') { $('banner').hidden = true; prediction = null; game.goHome(); autoNextAt = performance.now() + 2500; } }, 5000);
}

// ---------------------------------------------------------------- side panel
const bars = (v) => `<span class="bars" aria-label="${v} out of 5">${[1, 2, 3, 4, 5].map((i) => `<i class="${i <= v ? 'on' : ''}"></i>`).join('')}</span>`;
function kindOf(st) {
  if (st.stealth >= 4 && st.night <= 3) return 'Good at hiding';
  if (st.night >= 4 && st.stealth <= 3) return 'Good at finding';
  return 'All-rounder';
}
function modelOptions(cur) {
  const list = [...new Set([...(models || []).filter((m) => m.startsWith('qwen') || m.includes(':')), cur].filter((m) => m && m !== 'scripted'))];
  return [...list.map((m) => `<option value="${esc(m)}" ${m === cur ? 'selected' : ''}>${esc(m)}${m.includes('14b') ? ' (deep thinker)' : m.includes('8b') ? ' (quick thinker)' : ''}</option>`),
    `<option value="scripted" ${cur === 'scripted' ? 'selected' : ''}>Scripted (no AI)</option>`].join('');
}

function renderRound() {
  const busy = game.phase !== 'setup';
  const online = game.online;
  const conn = models === null ? '<span class="conn wait">Looking for Ollama…</span>'
    : online ? `<span class="conn ok">Ollama connected · ${models.length} model${models.length === 1 ? '' : 's'}</span>`
      : '<span class="conn no">Ollama not found · scripted brains</span>';
  const pred = agents.map((a) => `<button data-p="${a.id}" aria-pressed="${prediction === a.id}" style="--c:${a.color}"><i></i>${esc(a.name)} wins</button>`).join('');
  $('roundcard').innerHTML = `
    <div class="row"><h2>Round ${game.roundNo}</h2>${conn}</div>
    <p class="lbl">Who has the den? <span>(the seeker)</span></p>
    <div class="seg" id="den" role="radiogroup" aria-label="Choose the seeker">
      ${agents.map((a) => `<button role="radio" data-i="${a.id}" aria-checked="${a.id === game.seekerId}" ${busy ? 'disabled' : ''}><i style="--c:${a.color}"></i>${esc(a.name)}</button>`).join('')}
    </div>
    <p class="lbl">Seek time <span>(how long the seeker gets)</span></p>
    <div class="segs times" role="radiogroup" aria-label="Seek time">${SEEK_TIMES.map((s) => `<button role="radio" data-t="${s}" aria-checked="${s === game.seekTime}" ${busy ? 'disabled' : ''}>${s} s</button>`).join('')}</div>
    <p class="lbl">Your prediction <span>(optional)</span></p>
    <div class="pred">${pred}</div>
    <div class="facts">
      <div><span>Seek time</span><b id="timer">${fmt(busy ? game.timeLeft : game.seekTime)}</b></div>
      <div><span>Your score</span><b>${score.right} / ${score.total}</b></div>
      <div><span>Rounds played</span><b>${game.history.length}</b></div>
    </div>
    <label class="autoplay"><input type="checkbox" id="autoplay" ${opts.autoplay ? 'checked' : ''}>Auto-play rounds (the seeker swaps every round)</label>
    <button class="start" id="start" ${game.phase === 'return' || game.phase === 'over' ? 'disabled' : ''}>${busy ? '■ Stop round' : '▶ Start round'}</button>
    <div class="row small-actions">
      <button class="link" id="testvoice">🔊 Test voices</button>
      <button class="link" id="reroll" ${busy ? 'disabled' : ''}>🎲 Re-roll abilities</button>
      <button class="link" id="forget" ${busy ? 'disabled' : ''}>Forget all rounds</button>
    </div>`;
  document.querySelectorAll('#den button').forEach((b) => (b.onclick = () => { game.seekerId = +b.dataset.i; addLog(`${game.seeker.name} has the den.`); dirty = true; }));
  document.querySelectorAll('.pred button').forEach((b) => (b.onclick = () => { if (game.phase === 'over') return; prediction = prediction === +b.dataset.p ? null : +b.dataset.p; dirty = true; }));
  $('start').onclick = () => {
    if (game.phase === 'setup') { $('banner').hidden = true; if (view.mode === 'free') setCam('auto'); game.start(); }
    else if (game.phase === 'hiding' || game.phase === 'seeking') game.stop();
  };
  document.querySelectorAll('.times button').forEach((b) => (b.onclick = () => { game.seekTime = +b.dataset.t; store.set('chhupan.seek.v1', game.seekTime); dirty = true; }));
  $('autoplay').onchange = (e) => { opts.autoplay = e.target.checked; if (opts.autoplay && game.phase === 'setup') autoNextAt = performance.now() + 800; };
  $('testvoice').onclick = testVoices;
  $('reroll').onclick = reroll;
  $('forget').onclick = () => { if (confirm('Forget every round played so far? The agents lose their memory and the round count starts again.')) { game.clearHistory(); agents.forEach((a) => (a.thoughts = [])); addLog('All rounds forgotten.'); dirty = true; } };
}

onVoiceProblem.fn = (m) => { addLog(`Voice problem: ${m}`); dirty = true; };

function testVoices() {
  addLog(`Testing voices: ${agents[0].name} = ${voiceName('m')}, ${agents[1].name} = ${voiceName('f')}.`);
  speak('m', `Hi, I am ${agents[0].name}. Can you hear me?`); speak('f', `And I am ${agents[1].name}. Hello!`); dirty = true;
}

function reroll() {
  // 14 points spread over four abilities (each 1 to 5), so no agent is simply better at everything
  for (const a of agents) {
    const s = { speed: 1, night: 1, stealth: 1, memory: 1 };
    let left = 10;
    while (left > 0) { const k = STATS[Math.floor(Math.random() * 4)][0]; if (s[k] < 5) { s[k]++; left--; } }
    a.stats = s;
  }
  saveAgents(); addLog(`New abilities: ${agents.map((a) => `${a.name} is ${kindOf(a.stats).toLowerCase()}`).join(', ')}.`); dirty = true;
}

function renderAgents() {
  const box = $('agents');
  const focus = document.activeElement?.dataset?.name; // keep typing focus while re-drawing
  box.innerHTML = agents.map((a) => {
    const isSeeker = a.id === game.seekerId, role = isSeeker ? 'seeker' : 'hider';
    const busy = game.phase !== 'setup';
    const th = a.thoughts.length
      ? a.thoughts.map((t, i) => `<li class="${i ? '' : 'new'}"><small>${esc(t.what)} · ${t.model === 'scripted' ? 'scripted' : `${esc(t.model)} · ${t.secs.toFixed(1)} s`}${t.error ? ' · model failed' : t.valid === false ? ' · invalid answer' : ''}</small>${esc(t.text)}</li>`).join('')
      : `<li class="empty">Thoughts appear here during a round${a.model === 'scripted' ? ' (scripted brain)' : ''}.</li>`;
    const mem = game.history.filter((h) => h.seeker === a.name || h.hider === a.name).slice(-a.stats.memory);
    const memChips = mem.length
      ? mem.map((h) => `<span>R${h.n}: ${h.hider === a.name ? `hid at ${esc(h.spot)}` : `${esc(h.hider)} at ${esc(h.spot)}`} · ${h.found ? 'found' : 'not found'}</span>`).join('')
      : '<span>No rounds yet</span>';
    return `<section class="card agent" style="--role:var(--${role})">
      <header>
        <div class="avatar" style="--c:${a.color}">${esc(a.name[0] || '?')}</div>
        <div class="who"><input value="${esc(a.name)}" maxlength="14" data-i="${a.id}" data-name="${a.id}" aria-label="Name of agent ${a.id + 1}" ${busy ? 'disabled' : ''}>
          <div class="role">${isSeeker ? 'Den · seeker' : 'Hider'} · ${kindOf(a.stats)}</div></div>
        <span class="state"><i class="${a.thinking ? 'thinking' : ''}"></i>${a.thinking ? 'Thinking' : busy ? 'Playing' : 'Waiting'}</span>
      </header>
      <p class="status">Now: <b>${esc(a.status)}</b></p>
      <div class="stats">${STATS.map(([k, label]) => `<div><span>${label}</span>${bars(a.stats[k])}</div>`).join('')}</div>
      <label class="brain"><span>Brain</span><select data-model="${a.id}" ${busy ? 'disabled' : ''}>${modelOptions(a.model)}</select></label>
      <div class="section-title">Inner voice ${a.model === 'scripted' || !game.online ? '<span class="tag">scripted, not AI</span>' : `<span class="tag ai">AI · voice: ${esc(voiceName(a.voice))}</span>`}</div>
      <ul class="thoughts">${th}</ul>
      <div class="section-title">Memory <span class="tag">last ${a.stats.memory} round${a.stats.memory === 1 ? '' : 's'}</span></div>
      <div class="chips">${memChips}</div>
    </section>`;
  }).join('');
  box.querySelectorAll('input').forEach((inp) => inp.addEventListener('change', () => {
    const a = agents[+inp.dataset.i]; const nm = inp.value.trim() || a.name; a.name = nm; saveAgents(); dirty = true;
  }));
  box.querySelectorAll('select').forEach((s) => s.addEventListener('change', () => {
    agents[+s.dataset.model].model = s.value; saveAgents(); dirty = true;
    if (agents[0].model !== agents[1].model && ![agents[0].model, agents[1].model].includes('scripted')) addLog('Two different models: Ollama keeps both in memory (about 15 GB with 8b + 14b).');
  }));
  if (focus != null) box.querySelector(`[data-name="${focus}"]`)?.focus();
}

let autoNextAt = 0, lastCaption = '';
const fmt = (sec) => { const v = Math.max(0, Math.ceil(sec)); return `${Math.floor(v / 60)}:${String(v % 60).padStart(2, '0')}`; };
game.seekTime = store.get('chhupan.seek.v1', 60);
const logEl = $('log');
function addLog(text) {
  const li = document.createElement('li');
  li.innerHTML = `<time>${$('clock').textContent}</time><span>${esc(text)}</span>`;
  logEl.prepend(li);
  while (logEl.children.length > 14) logEl.lastChild.remove();
}

// ---------------------------------------------------------------- drawing
function pill(c, x, y, text, color, bg) {
  c.font = '600 12px Inter, system-ui, sans-serif';
  const w = c.measureText(text).width + 16;
  c.fillStyle = bg; c.beginPath(); c.roundRect(x - w / 2, y - 11, w, 22, 11); c.fill();
  c.strokeStyle = 'rgba(255,255,255,0.12)'; c.lineWidth = 1; c.stroke();
  c.fillStyle = color; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(text, x, y + 0.5);
}
const toScreen = (x, y, z = 0) => { const [ix, iy] = iso(x, y, z); return [view.cam.x + ix * view.zoom, view.cam.y + iy * view.zoom]; };

// rough heights (in drawing pixels) of things people can hide behind, for the see-through outline
const HEIGHT = { wall: 68, tapri: 56, tree: 110, temple: 125, tank: 125, haystack: 45, tractor: 50, auto: 38, tank2: 0, almirah: 46, cooler: 32, cart: 25, well: 46 };
let last = performance.now();
// One frame. The wrapper keeps the loop alive: a page that is not laid out yet (size 0), or one bad frame, must never stop the game.
function frame(ms) {
  if (offline && !manual) return; // while the video is rendered frame by frame, the normal screen loop stays out of the way
  try {
    if (view.w < 2 || view.h < 2) resize(); // not measured yet: try again
    if (view.w >= 2 && view.h >= 2) frameBody(ms);
  } catch (e) {
    if (offline) throw e;
    console.error('frame error', e);
  }
  if (!offline) requestAnimationFrame(frame);
}
function frameBody(ms) {
  const dt = Math.max(0, Math.min(0.5, (ms - last) / 1000)); last = ms;
  const t = reduceMotion ? 0 : ms / 1000;
  // the game keeps real time even when the frame rate drops: it runs in small fixed steps,
  // so nobody can walk past the other between two sight checks
  if (replay) applyReplay(ms); else for (let left = dt; left > 1e-6; left -= 0.05) game.update(Math.min(0.05, left));
  if (autoNextAt && game.phase === 'setup' && performance.now() > autoNextAt) {
    autoNextAt = 0;
    if (opts.autoplay) { game.seekerId = 1 - game.seekerId; $('banner').hidden = true; prediction = null; game.start(); }
  }
  if (opts.watch) {
    const S = game.seeker, H = game.hider, live = game.phase === 'seeking' || game.phase === 'hiding';
    const txt = game.phase === 'hiding' ? 'Counting…' : game.phase === 'seeking' ? fmt(game.timeLeft) : game.phase === 'over' ? 'Round over' : 'Ready';
    const html = `<span class="dim">Round ${game.phase === 'setup' || game.phase === 'return' ? game.roundNo : game.roundNo}</span><span class="seeker"><span class="dim">seeker </span><b>${esc(S.name)}</b></span><span class="hider"><span class="dim">hider </span><b>${esc(H.name)}</b></span><span class="t">${txt}</span>`;
    if (html !== lastCaption) { $('caption').innerHTML = html; lastCaption = html; }
  }
  updateCamera(dt);
  if (dirty) { dirty = false; renderRound(); renderAgents(); }
  if (game.phase === 'seeking' || game.phase === 'hiding') { const el = $('timer'); const txt = fmt(game.timeLeft); if (el && el.textContent !== txt) { el.textContent = txt; el.classList.toggle('low', game.timeLeft <= 10); } }
  const W = view.w, H = view.h, z = view.zoom;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  drawSky(ctx, W, H);
  ctx.imageSmoothingQuality = 'medium';
  blitPicture(ctx, picture, staticScale, view, dpr);

  ctx.setTransform(dpr * z, 0, 0, dpr * z, dpr * view.cam.x, dpr * view.cam.y);
  drawSmoke(ctx, 4.55, 20.93, 31, t);
  const key = (a) => iso(a.x, a.y)[1];
  for (const a of [...agents].sort((p, q) => key(p) - key(q))) {
    ctx.globalAlpha = a.hidden && game.phase === 'seeking' ? 0.55 : 1; // crouched in a hiding spot
    drawPerson(ctx, a, t, a.id === game.seekerId, a.id === game.seekerId && game.phase === 'hiding', a.hidden && game.phase !== 'return');
    ctx.globalAlpha = 1;
    // walls and furniture that are closer to the camera than this person go back on top of them
    const [vx, vy] = toView(a.x, a.y), ak = vx + vy;
    const [px, py] = iso(a.x, a.y, a.z || 0);
    let covered = false;
    for (const o of current.solids) {
      if (o.key <= ak) continue;
      const w = o.w || (o.kind === 'wall' ? 1 : 0), d = o.d || (o.kind === 'wall' ? 1 : 0);
      if (Math.abs(o.x + w / 2 - a.x) > 4.5 || Math.abs(o.y + d / 2 - a.y) > 4.5) continue;
      drawSolid(ctx, village, o, current.wallMode, current.bounds);
      // does it cover this person on the screen? (rough box test)
      const q = [iso(o.x, o.y), iso(o.x + w, o.y), iso(o.x + w, o.y + d), iso(o.x, o.y + d)];
      const x0 = Math.min(...q.map((p) => p[0])), x1 = Math.max(...q.map((p) => p[0])), y1 = Math.max(...q.map((p) => p[1]));
      const y0 = Math.min(...q.map((p) => p[1])) - (HEIGHT[o.kind] || 50);
      if (x1 > px - 14 && x0 < px + 14 && y1 > py - 60 && y0 < py) covered = true;
    }
    // hidden behind something: show a faint see-through outline of the person on top, so you can still follow the story
    if (covered) { ctx.globalAlpha = 0.6; drawPerson(ctx, a, t, a.id === game.seekerId, false, a.hidden && game.phase !== 'return'); ctx.globalAlpha = 1; }
  }
  ctx.globalAlpha = 1;

  drawLighting(ctx, dark, glow, view, village.lights, t, opts.power, picture, staticScale);

  ctx.setTransform(dpr * z, 0, 0, dpr * z, dpr * view.cam.x, dpr * view.cam.y);
  // what the seeker can see right now
  if (opts.eyes && game.phase === 'seeking') {
    ctx.fillStyle = 'rgba(255,93,93,0.13)';
    ctx.beginPath();
    for (const [x, y] of visibleTiles(sight, game.light, game.seeker)) {
      const p = [iso(x, y), iso(x + 1, y), iso(x + 1, y + 1), iso(x, y + 1)];
      ctx.moveTo(...p[0]); ctx.lineTo(...p[1]); ctx.lineTo(...p[2]); ctx.lineTo(...p[3]); ctx.closePath();
    }
    ctx.fill();
  }
  drawFireflies(ctx, t, opts.power);
  if (hover) {
    const { x, y } = hover;
    const p = [iso(x, y), iso(x + 1, y), iso(x + 1, y + 1), iso(x, y + 1)];
    ctx.beginPath(); ctx.moveTo(...p[0]); for (const q of p.slice(1)) ctx.lineTo(...q); ctx.closePath();
    ctx.fillStyle = 'rgba(255,209,102,0.14)'; ctx.fill(); ctx.strokeStyle = '#ffd166'; ctx.lineWidth = 1.6 / z; ctx.stroke();
  }

  // screen-space overlays: labels, hiding spots, name tags, thought bubbles
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  if (opts.labels && z >= 0.55) for (const l of village.labels) { const [sx, sy] = toScreen(l.x, l.y, l.z); pill(ctx, sx, sy, l.text, '#f3e6c4', 'rgba(8,12,30,0.62)'); }
  if (opts.hides) for (const h of village.hideSpots) {
    const [sx, sy] = toScreen(h.x, h.y, 8);
    ctx.fillStyle = 'rgba(62,224,207,0.18)'; ctx.beginPath(); ctx.arc(sx, sy, 13, 0, 7); ctx.fill();
    ctx.strokeStyle = '#3ee0cf'; ctx.lineWidth = 1.5; ctx.stroke();
    ctx.beginPath(); ctx.ellipse(sx, sy, 7, 4, 0, 0, 7); ctx.stroke();
    ctx.fillStyle = '#3ee0cf'; ctx.beginPath(); ctx.arc(sx, sy, 2, 0, 7); ctx.fill();
  }
  const tags = agents.map((a) => toScreen(a.x, a.y, (a.z || 0) + 70));
  const gap = Math.hypot(tags[0][0] - tags[1][0], tags[0][1] - tags[1][1]);
  const push = gap < 210 ? (210 - gap) / 2 : 0; // keep two bubbles from covering each other
  for (const a of agents) {
    const [sx, sy] = tags[a.id];
    const s = a.id === game.seekerId;
    const side = Math.sign(sx - tags[1 - a.id][0]) || (a.id ? 1 : -1);
    let text = a.bubble;
    if (game.phase === 'setup') text = s ? 'Ready to count to 30…' : 'Where should I hide tonight?';
    if (a.thinking) text = `${'.'.repeat(1 + (Math.floor(t * 3) % 3))} (thinking)`;
    if (a.hidden && game.phase === 'seeking') text = ''; // a crouched hider stays quiet while she is being searched for
    const onScreen = sx > -30 && sx < W + 30 && sy > -30 && sy < H + 120; // nothing pinned to the edge for someone far away
    if (!onScreen) continue;
    if (opts.bubbles && text) drawBubble(ctx, sx + side * push, sy - 22, text, s ? '#ff8a8a' : '#5fe6d8', { w: W, h: H });
    pill(ctx, sx, sy, `${a.name} · ${s ? 'den' : 'hider'}`, s ? '#ffd2d2' : '#c9fff8', s ? 'rgba(120,20,30,0.82)' : 'rgba(10,70,70,0.82)');
  }
  // the moment she is found: a soft pulsing glow on her, so the eye goes to the right place
  const foundNow = game.phase === 'over'; // round over: a soft glow on the hider, whether she was found or stayed hidden
  if (foundNow) {
    const Hd = game.hider, [gx, gy] = toScreen(Hd.x, Hd.y, 22), pulse = (t * 1.6) % 1;
    const rad = (40 + pulse * 34) * Math.max(0.8, z), gr = ctx.createRadialGradient(gx, gy, 0, gx, gy, rad);
    gr.addColorStop(0, 'rgba(95,230,216,0.35)'); gr.addColorStop(0.6, 'rgba(95,230,216,0.12)'); gr.addColorStop(1, 'rgba(95,230,216,0)');
    ctx.fillStyle = gr; ctx.beginPath(); ctx.arc(gx, gy, rad, 0, 7); ctx.fill();
    ctx.strokeStyle = `rgba(95,230,216,${0.7 * (1 - pulse)})`; ctx.lineWidth = 2.5; ctx.beginPath(); ctx.arc(gx, gy, rad * 0.7, 0, 7); ctx.stroke();
  }
  drawMini();
  if (rec) drawRecordFrame(ms);
}

// ---------------------------------------------------------------- replay a saved round, and record it as a video
// ?replay=video/best.json plays a round saved by eval/trace.mjs with the real renderer (no new AI calls);
// add &record=1 to also record it to an MP4 (4:5, for LinkedIn) and save it through video/server.py.
let replay = null, rec = null, offline = false, manual = false;
const qs = new URLSearchParams(location.search);
async function startReplay(url) {
  const data = await (await fetch(url)).json();
  if (qs.get('offline')) return renderOffline(url, data);
  Object.assign(opts, { voices: false, eyes: false, hides: false, labels: true, bubbles: true });
  game.seekerId = 0; game.speechMode = false;
  setWatch(true); setCam('auto');
  const first = data.snaps[0];
  agents.forEach((a, k) => { a.x = first.a[k][0]; a.y = first.a[k][1]; });
  replay = { snaps: data.snaps, meta: data.meta, t0: null, rate: data.rate || 24, lead: 1.2, tail: 0.4 };
  await loadAudio(data.audio || [], new URL(url, location.href));
  // a page that is not on screen draws nothing, so wait until the window is visible before the replay (and recording) starts
  if (qs.get('record') && document.visibilityState !== 'visible') {
    window.__waiting = 'window is hidden: bring the app window to the front';
    await new Promise((res) => document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && res()));
    window.__waiting = null; await new Promise((r) => setTimeout(r, 800));
  }
  if (qs.get('record')) startRecording();
  window.__replay = replay;
}
// the voices in the replay: sound files made by eval/select.mjs, played at the tick they belong to
let ac = null, acDest = null, clips = [];
async function loadAudio(list, base) {
  if (!list.length) return;
  ac = new (window.AudioContext || window.webkitAudioContext)();
  acDest = ac.createMediaStreamDestination();
  await ac.resume().catch(() => {});
  window.__audio = () => ({ state: ac.state, clips: clips.length, played: clips.filter((c) => c.played).length });
  clips = await Promise.all(list.map(async (a) => ({ ...a, buf: await ac.decodeAudioData(await (await fetch(new URL(a.file, base))).arrayBuffer()), played: false })));
}
function playClips(tickNow) {
  if (!ac) return;
  for (const c of clips) {
    if (c.played || c.tick > tickNow) continue;
    c.played = true;
    const src = ac.createBufferSource(), g = ac.createGain();
    src.buffer = c.buf; g.gain.value = c.gain;
    src.connect(g); g.connect(acDest); g.connect(ac.destination); // into the video, and out of the speakers
    src.start();
  }
}
// Frame-by-frame video: no window, no waiting. Each frame is drawn on demand (so it works even when the page is hidden),
// the sound is mixed offline, both are compressed with the browser's encoders and written into an MP4 (src/mp4.js).
const yieldNow = () => new Promise((r) => { const ch = new MessageChannel(); ch.port1.onmessage = () => r(); ch.port2.postMessage(0); });
async function renderOffline(url, data) {
  offline = true; window.__video = null; window.__progress = 0;
  const FPS = 30, SR = 48000, W = REC_W, H = REC_H, rate = data.rate || 24, lead = 1.2, tail = 0.4;
  Object.assign(opts, { voices: false, eyes: false, hides: false, labels: true, bubbles: true });
  game.seekerId = 0; game.speechMode = false;
  setWatch(true); setCam('auto');
  void document.body.offsetHeight; resize(); // the page may be hidden: size the drawing area by hand
  const first = data.snaps[0];
  agents.forEach((a, k) => { a.x = first.a[k][0]; a.y = first.a[k][1]; });
  replay = { snaps: data.snaps, meta: data.meta, t0: null, rate, lead, tail }; window.__replay = replay;
  const total = lead + data.snaps.length / rate + tail, N = Math.ceil(total * FPS);

  const c = document.createElement('canvas'); c.width = W; c.height = H;
  rec = { c, ctx: c.getContext('2d'), offline: true }; offline = true;
  const writer = new Mp4Writer({ width: W, height: H, fps: FPS, sampleRate: SR, channels: 2 });
  const fail = (e) => { window.__video = { error: String(e && e.message || e) }; };
  const venc = new VideoEncoder({
    output: (chunk, meta) => { const b = new Uint8Array(chunk.byteLength); chunk.copyTo(b); writer.addVideo(b, chunk.type === 'key', meta); },
    error: fail,
  });
  venc.configure({ codec: 'avc1.640028', width: W, height: H, bitrate: (Number(qs.get('kbps')) || 8000) * 1000, framerate: FPS, avc: { format: 'avc' } });

  const shotFrames = new Set((qs.get('shots') || '').split(',').filter(Boolean).map((t) => Math.round(Number(t) * FPS)));
  last = 0;
  for (let i = 0; i < N; i++) {
    manual = true; frame((i * 1000) / FPS); manual = false;
    const vf = new VideoFrame(rec.c, { timestamp: Math.round((i * 1e6) / FPS) });
    venc.encode(vf, { keyFrame: i % 30 === 0 }); vf.close();
    // ?shots=1,9,20 saves a picture of the frame at those seconds, to check the video without decoding it
    if (shotFrames.has(i)) { const b = await new Promise((r) => rec.c.toBlob(r, 'image/png')); await fetch(`/save?name=shot-${(i / FPS).toFixed(1)}.png`, { method: 'POST', body: b }); }
    while (venc.encodeQueueSize > 6) await yieldNow();
    if (i % 15 === 0) { window.__progress = +(i / N).toFixed(2); await yieldNow(); }
  }
  await venc.flush();

  // the voices: each line placed at its moment, mixed offline
  const oac = new OfflineAudioContext(2, Math.ceil(N / FPS * SR), SR);
  for (const a of data.audio || []) {
    const buf = await new OfflineAudioContext(1, 1, SR).decodeAudioData(await (await fetch(new URL(a.file, new URL(url, location.href)))).arrayBuffer());
    const src = oac.createBufferSource(), g = oac.createGain();
    src.buffer = buf; g.gain.value = a.gain; src.connect(g); g.connect(oac.destination); src.start(lead + a.tick / rate);
  }
  const mix = await oac.startRendering();
  const aenc = new AudioEncoder({
    output: (chunk, meta) => { const b = new Uint8Array(chunk.byteLength); chunk.copyTo(b); writer.addAudio(b, meta); },
    error: fail,
  });
  aenc.configure({ codec: 'mp4a.40.2', sampleRate: SR, numberOfChannels: 2, bitrate: 128_000 });
  const L = mix.getChannelData(0), R = mix.numberOfChannels > 1 ? mix.getChannelData(1) : mix.getChannelData(0);
  for (let pos = 0; pos < L.length; pos += 4096) {
    const n = Math.min(4096, L.length - pos), planar = new Float32Array(n * 2);
    planar.set(L.subarray(pos, pos + n), 0); planar.set(R.subarray(pos, pos + n), n);
    const ad = new AudioData({ format: 'f32-planar', sampleRate: SR, numberOfFrames: n, numberOfChannels: 2, timestamp: Math.round((pos / SR) * 1e6), data: planar });
    aenc.encode(ad); ad.close(); await yieldNow();
  }
  await aenc.flush();

  const file = writer.finish();
  const name = qs.get('name') || 'chhupan-round.mp4';
  try {
    const r = await fetch(`/save?name=${encodeURIComponent(name)}`, { method: 'POST', body: file });
    window.__video = { done: true, saved: await r.text(), bytes: file.length, frames: N, seconds: +(N / FPS).toFixed(1) };
  } catch (e) { fail(e); }
  offline = false; rec = null;
}

function applyReplay(ms) {
  const R = replay; if (R.t0 === null) R.t0 = ms;
  // frames stopped for a while (the window was hidden)? a recording with a frozen stretch is no good: start over
  if (R.last !== undefined && ms - R.last > 400 && rec && !rec.stopping && !rec.offline) { rec.stopping = true; rec.mr.onstop = null; try { rec.mr.stop(); } catch (e) { /* ignore */ } window.__video = { error: 'interrupted, restarting' }; setTimeout(() => location.reload(), 300); return; }
  R.last = ms;
  const el = (ms - R.t0) / 1000 - R.lead;
  const n = R.snaps.length, f = Math.min(Math.max(el * R.rate, 0), n - 1);
  playClips(el * R.rate);
  const i = Math.floor(f), j = Math.min(i + 1, n - 1), u = f - i, A = R.snaps[i], B = R.snaps[j];
  game.phase = A.p; game.timeLeft = A.tl; game.counting = !!A.c; game.speechMode = false;
  game.target = A.tg ? { x: A.tg[0], y: A.tg[1] } : null;
  agents.forEach((a, k) => {
    const p = A.a[k], q = B.a[k];
    a.x = p[0] + (q[0] - p[0]) * u; a.y = p[1] + (q[1] - p[1]) * u; a.z = p[2];
    a.hidden = !!p[3]; a.moving = !!p[4]; a.walk = p[5] + (q[5] - p[5]) * u; a.thinking = !!p[6]; a.bubble = p[7]; a.status = p[8];
  });
  R.done = el * R.rate >= n - 1 + R.tail * R.rate;
  R.over = A.p === 'over';
  R.cur = A; // round number (rn), its result (rf, rs) and title card (card), for the two-round story
  if (R.done && rec && !rec.stopping && !rec.offline) stopRecording();
}

const REC_W = 1080, REC_H = 1350;
function startRecording() {
  const c = document.createElement('canvas'); c.width = REC_W; c.height = REC_H;
  const stream = c.captureStream(30);
  if (acDest) stream.addTrack(acDest.stream.getAudioTracks()[0]);
  const mime = ['video/mp4;codecs=avc1,mp4a.40.2', 'video/mp4;codecs=avc1', 'video/mp4', 'video/webm;codecs=vp9,opus', 'video/webm'].find((t) => MediaRecorder.isTypeSupported(t));
  const mr = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 8_000_000, audioBitsPerSecond: 160_000 });
  const chunks = [];
  mr.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
  mr.onstop = async () => {
    const blob = new Blob(chunks, { type: mime }), ext = mime.includes('mp4') ? 'mp4' : 'webm';
    const name = qs.get('name') || `chhupan-round.${ext}`;
    try {
      const r = await fetch(`/save?name=${encodeURIComponent(name)}`, { method: 'POST', body: blob });
      window.__video = { done: true, saved: await r.text(), mime, bytes: blob.size };
    } catch (e) { window.__video = { done: true, error: String(e), bytes: blob.size }; }
  };
  rec = { c, ctx: c.getContext('2d'), mr, stopping: false };
  mr.start(500);
}
function stopRecording() { rec.stopping = true; rec.mr.stop(); const r = rec; setTimeout(() => { if (rec === r) rec = null; }, 100); }

function rr(c, x, y, w, h, r, fill, stroke) {
  c.beginPath(); c.roundRect(x, y, w, h, r);
  if (fill) { c.fillStyle = fill; c.fill(); } if (stroke) { c.strokeStyle = stroke; c.lineWidth = 2; c.stroke(); }
}
function drawRecordFrame() {
  if (!rec || rec.stopping) return;
  const c = rec.ctx, W = REC_W, H = REC_H, top = 150, bottom = 250, mh = H - top - bottom;
  c.setTransform(1, 0, 0, 1, 0, 0);
  c.fillStyle = '#070b1a'; c.fillRect(0, 0, W, H);
  // the village, cropped to fill the middle
  const sw = canvas.width, sh = canvas.height, sc = Math.max(W / sw, mh / sh), cw = W / sc, ch = mh / sc;
  c.save(); c.beginPath(); c.rect(0, top, W, mh); c.clip();
  c.drawImage(canvas, (sw - cw) / 2, (sh - ch) / 2, cw, ch, 0, top, W, mh);
  // the round map, bottom left of the picture
  c.drawImage(mini, 0, 0, mini.width, mini.height, 28, top + mh - 230 - 24, 230, 230);
  c.restore();
  // header
  c.textBaseline = 'middle'; c.textAlign = 'left';
  c.fillStyle = '#ffd166'; c.font = '800 58px "Baloo 2", system-ui, sans-serif'; c.fillText('Chhupan Chhupai', 40, 58);
  c.fillStyle = '#9aa3c2'; c.font = '500 25px Inter, system-ui, sans-serif'; c.fillText('Two AI agents play hide and seek in an Indian village at night', 40, 112);
  // footer: who is who, the timer and what is happening
  const S = game.seeker, Hd = game.hider, R = replay;
  rr(c, 28, H - bottom + 18, W - 56, 130, 28, 'rgba(255,255,255,0.05)', 'rgba(255,255,255,0.1)');
  c.font = '600 22px Inter, system-ui, sans-serif'; c.fillStyle = '#ff9a9a'; c.fillText('SEEKER', 62, H - bottom + 52);
  c.font = '800 44px "Baloo 2", system-ui, sans-serif'; c.fillText(S.name, 62, H - bottom + 98);
  c.textAlign = 'right'; c.font = '600 22px Inter, system-ui, sans-serif'; c.fillStyle = '#8ff0e4'; c.fillText('HIDER', W - 62, H - bottom + 52);
  c.font = '800 44px "Baloo 2", system-ui, sans-serif'; c.fillText(Hd.name, W - 62, H - bottom + 98);
  c.textAlign = 'center'; c.fillStyle = '#ffd166'; c.font = '800 60px "Baloo 2", system-ui, sans-serif';
  const cur = R && R.cur ? R.cur : {}, found = cur.rf !== undefined ? cur.rf : R?.meta?.found, spot = cur.rs || R?.meta?.spot || '';
  const t = game.phase === 'hiding' ? 'Counting…' : game.phase === 'seeking' ? fmt(game.timeLeft) : game.phase === 'over' ? (found ? 'Found!' : 'Time up') : 'Ready';
  c.fillText(t, W / 2, H - bottom + 83);
  c.fillStyle = '#d9def0'; c.font = '500 26px Inter, system-ui, sans-serif';
  const line = game.phase === 'over' ? (found ? `${S.name} found ${Hd.name} at: ${spot.toLowerCase()}` : `${Hd.name} stayed hidden at: ${spot.toLowerCase()}. ${S.name} ran out of time`)
    : game.phase === 'seeking' ? S.status.replace(/^Search \d+: /, 'Searching: ') : game.phase === 'hiding' ? (game.counting ? `${S.name} counts with his eyes closed` : `${Hd.name} picks a hiding spot`) : '';
  c.fillText(line, W / 2, H - bottom + 176);
  c.fillStyle = '#7e88ab'; c.font = '500 19px Inter, system-ui, sans-serif';
  c.fillText('qwen3:8b via Ollama on a MacBook · the game rules decide who can see whom · sped up', W / 2, H - 24);
  // which round (two-round story)
  if (cur.rn) {
    c.textAlign = 'right'; c.font = '700 26px Inter, system-ui, sans-serif';
    const label = `ROUND ${cur.rn}`, lw = c.measureText(label).width + 36;
    rr(c, W - 40 - lw, 38, lw, 46, 23, 'rgba(255,209,102,0.14)', 'rgba(255,209,102,0.5)');
    c.fillStyle = '#ffd166'; c.fillText(label, W - 58, 62);
  }
  // fast-forwarded part of a round
  if (cur.ff && !cur.card) {
    c.textAlign = 'left'; c.font = '700 26px Inter, system-ui, sans-serif';
    rr(c, 40, top + 22, 250, 46, 23, 'rgba(10,14,32,0.82)', 'rgba(255,255,255,0.25)');
    c.fillStyle = '#ffffff'; c.fillText('⏩  fast forward', 62, top + 46);
  }
  // title card between rounds
  if (cur.card) {
    c.fillStyle = 'rgba(5,8,22,0.78)'; c.fillRect(0, top, W, mh);
    c.textAlign = 'center'; c.fillStyle = '#ffd166'; c.font = '800 110px "Baloo 2", system-ui, sans-serif';
    c.fillText(cur.card, W / 2, top + mh / 2 - 20);
    c.fillStyle = '#d9def0'; c.font = '500 30px Inter, system-ui, sans-serif';
    c.fillText(cur.rn === 1 ? 'Meera hides, Arjun seeks' : 'They play again', W / 2, top + mh / 2 + 60);
  }
}
if (qs.get('replay')) startReplay(qs.get('replay'));

rebuild();
new ResizeObserver(() => { const first = !view.w; resize(); if (first) lookAt(village.den.x - 2, village.den.y + 3, 0.85); }).observe(stage);
resize();
lookAt(village.den.x - 2, village.den.y + 3, 0.85);
addLog(`Map ready: ${village.houses.length} buildings, ${village.lights.length} lights, ${village.hideSpots.length} hiding spots.`);
addLog('Game version 2: the Record button saves a normal MP4 that QuickTime plays.');
requestAnimationFrame(frame);

checkRemote().then((r) => { addLog(r ? `Voices: your Mac's own voices through the local server (boy ${r.m}, girl ${r.f}).` : "Voices: the browser's built-in speech. For your Mac's voices run: python3 server.py"); dirty = true; });
ollamaModels().then((m) => {
  models = m || [];
  game.online = !!m && m.length > 0;
  for (const a of agents) if (a.model !== 'scripted' && game.online && !models.includes(a.model)) a.model = models[0];
  addLog(game.online ? `Ollama connected: ${models.join(', ')}.` : 'Ollama is not running, so both agents use the scripted brain. Start Ollama and reload to use AI.');
  dirty = true;
});

// game clock: one minute every 4 seconds
let mins = 21 * 60 + 40;
setInterval(() => {
  mins = (mins + 1) % (24 * 60);
  const h = Math.floor(mins / 60), m = mins % 60, h12 = ((h + 11) % 12) + 1;
  $('clock').textContent = `${h12}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
}, 4000);
