// One round of chhupan chhupai:
//   1. hiding:  the seeker counts with eyes closed; the hider's brain picks a spot and the hider runs there
//   2. seeking: the seeker's brain picks where to search next and walks there, until the seek time runs out.
//               The clock pauses while a model is thinking, so a slower (bigger) model is not punished for speed.
//               At every step the rules check whether the seeker can see the hider. Seen = caught.
//   3. over:    seeker wins if the hider was seen, hider wins when the time runs out
// Rounds are remembered (in this browser) so each agent can use what happened before.
import { findPath, goTo, stepAgent } from './sim.js';
import { canSee, lightWord, detectChance } from './rules.js';
import { decide, memoryNotes } from './agents.js';

// in-place Fisher-Yates shuffle
function shuffle(a) { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }

export const SEEK_TIMES = [30, 60, 90, 120];
const COUNT_TO = 30;
const COUNT_SECS = 12; // counting 1 to 30 without a voice (with a voice, counting ends when the speech ends)
const HISTORY_KEY = 'chhupan.history.v1';
const load = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } };
const save = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode: fine */ } };

export class Game {
  constructor({ village, block, sight, agents, home, ui }) {
    Object.assign(this, { village, block, sight, agents, home, ui });
    this.phase = 'setup';
    this.seekerId = 0;
    this.seekTime = 60;
    this.history = load(HISTORY_KEY, []);
    this.online = false;
    this.light = null;
    this.token = 0;
    this.reset();
  }
  get seeker() { return this.agents[this.seekerId]; }
  get hider() { return this.agents[1 - this.seekerId]; }
  get roundNo() { return (this.history.at(-1)?.n || 0) + 1; }
  reset() { this.timeLeft = this.seekTime; this.count = 0; this.counted = 0; this.counting = false; this.speechMode = false; this.speechDone = false; this.searches = 0; this.checked = []; this.spot = null; this.target = null; this.pause = 0; this.result = null; }
  clearHistory() { this.history = []; save(HISTORY_KEY, []); }

  steps(from, to) { const p = findPath(this.block, from.x, from.y, to.x, to.y); return p ? p.length : 99; }
  lightAt(p) { return lightWord(this.light[Math.floor(p.y)][Math.floor(p.x)]); }

  start() {
    const token = ++this.token;
    this.reset();
    this.phase = 'hiding';
    const S = this.seeker, H = this.hider;
    for (const a of this.agents) { a.hidden = false; a.thinking = false; a.path = []; }
    S.status = 'Eyes closed at the den'; S.bubble = 'Eyes closed…';
    H.status = 'Thinking where to hide'; H.thinking = true; H.bubble = 'Where should I hide?';
    this.ui.log(`Round ${this.roundNo}: ${S.name} has the den, ${H.name} hides.`);
    this.counting = false; // the counting starts once the hider has said where she is going (see decideHide)
    this.ui.changed();
    this.decideHide(token);
  }
  stop() { this.token++; this.goHome('Round stopped.'); }

  async decideHide(token) {
    const S = this.seeker, H = this.hider, den = this.village.den;
    const spots = this.village.hideSpots
      .map((s) => ({ ...s, steps: this.steps(den, s), light: this.lightAt(s) }))
      .filter((s) => s.steps < 99);
    shuffle(spots); // a model tends to favour a list position, so the order is new every time
    const ctx = { me: H, seeker: S, spots, seekTime: this.seekTime, memory: memoryNotes(this.history, H, H.stats.memory) };
    const r = await decide('hide', H, ctx, this.online);
    if (token !== this.token) return;
    H.thinking = false;
    this.spot = spots[r.choice];
    const said = this.think(H, r, `hide → ${this.spot.name}`); // she says it first, then the seeker counts
    said.then(() => { if (token === this.token && this.phase === 'hiding') this.beginCount(token); });
    goTo(H, this.block, this.spot.x, this.spot.y);
    H.status = `Running to hide: ${this.spot.name}`;
    this.ui.changed();
  }

  async decideSeek(token) {
    const S = this.seeker, H = this.hider;
    S.thinking = true; S.bubble = '…'; S.status = 'Thinking where to look';
    this.ui.changed();
    const options = this.village.hideSpots
      .filter((s) => !this.checked.includes(s.name))
      .map((s) => ({ ...s, steps: this.steps(S, s), light: this.lightAt(s) }))
      .filter((s) => s.steps < 99);
    shuffle(options);
    const here = this.village.tiles[Math.floor(S.y)][Math.floor(S.x)].place;
    const ctx = { me: S, hider: H, options, checked: this.checked, left: Math.ceil(this.timeLeft), here,
      memory: memoryNotes(this.history, S, S.stats.memory) };
    const r = await decide('seek', S, ctx, this.online);
    if (token !== this.token || this.phase !== 'seeking') return;
    S.thinking = false;
    this.searches++;
    this.target = options[r.choice];
    this.think(S, r, `search ${this.searches} → ${this.target.name}`);
    S.status = `Search ${this.searches}: ${this.target.name}`;
    if (!goTo(S, this.block, this.target.x, this.target.y)) { this.checked.push(this.target.name); this.target = null; }
    this.ui.changed();
  }

  // the seeker counts 1 to 30 softly aloud (voice on) or on a timer (voice off); he starts looking only after 30
  beginCount(token) {
    const S = this.seeker;
    this.counting = true; this.count = 0;
    S.status = 'Counting with eyes closed';
    this.speechMode = !!(this.ui.countAloud && this.ui.countAloud(S, (n) => { if (token === this.token) this.counted = n; }, () => { if (token === this.token) this.speechDone = true; }));
    this.ui.changed();
  }

  think(a, r, what, speak = true) {
    a.thoughts.unshift({ text: r.thought, what, model: r.model, secs: r.secs, valid: r.valid, error: r.error });
    a.thoughts.length = Math.min(a.thoughts.length, 12);
    a.bubble = r.thought;
    const spoken = speak ? this.ui.speak(a, r.thought) : null;
    if (r.error) this.ui.log(`${a.name}'s model failed (${r.error}); used the scripted brain once.`);
    else if (!r.valid) this.ui.log(`${a.name}'s model gave an invalid choice; picked at random.`);
    return spoken && spoken.then ? spoken : Promise.resolve();
  }

  speed(a) { return 1.7 + 0.32 * a.stats.speed; }

  update(dt) {
    const S = this.seeker, H = this.hider;
    if (this.phase === 'hiding') {
      if (this.counting) this.count += dt;
      const n = this.speechMode ? this.counted : Math.min(COUNT_TO, Math.floor((this.count / COUNT_SECS) * COUNT_TO));
      S.bubble = !this.counting ? 'Eyes closed…' : n > 0 ? `${n}…` : 'One…';
      const counted = this.counting && (this.speechMode ? this.speechDone || this.count > 40 : this.count >= COUNT_SECS);
      if (this.spot && !H.hidden && stepAgent(H, dt, this.speed(H))) {
        H.hidden = true; H.status = `Hiding: ${this.spot.name}`; this.ui.changed();
      }
      if (H.hidden && counted) {
        this.phase = 'seeking';
        this.line(S, 'Thirty! Ready or not, here I come!');
        S.status = 'Done counting';
        this.pause = 1.2;
        this.ui.changed();
      }
    } else if (this.phase === 'seeking') {
      if (canSee(this.sight, this.light, S, H)) return this.caught();
      if (S.thinking) return;
      this.timeLeft -= dt;
      if (this.timeLeft <= 0) return this.hiderWins();
      if (this.target) {
        if (stepAgent(S, dt, this.speed(S))) {
          const T = this.target;
          this.checked.push(T.name); this.target = null;
          // he checks the spot: if she is crouched there, he may or may not notice her
          if (H.hidden && Math.hypot(H.x - T.x, H.y - T.y) < 1.6
              && Math.random() < detectChance(S.stats, H.stats, this.light[Math.floor(H.y)][Math.floor(H.x)])) return this.caught();
          S.bubble = 'Not here…'; this.pause = 0.7; this.ui.changed();
        }
        return;
      }
      if (this.pause > 0) { this.pause -= dt; return; }
      this.decideSeek(this.token);
    } else if (this.phase === 'return') {
      const done = this.agents.map((a, i) => stepAgent(a, dt, this.speed(a))).every(Boolean);
      if (done) { this.phase = 'setup'; this.agents.forEach((a) => { a.status = 'At the peepal chabutra'; a.bubble = ''; }); this.ui.changed(); }
    }
    for (const a of this.agents) a.z = a.x >= 21 && a.x < 24 && a.y >= 9 && a.y < 12 ? 10 : 0;
  }

  caught() {
    const S = this.seeker, H = this.hider;
    S.path = []; S.moving = false; S.thinking = false;
    S.bubble = `${H.name}, I see you! Caught you!`; H.bubble = 'Oh no, you found me!';
    this.turns([[S, S.bubble], [H, H.bubble]]);
    this.finish(true);
  }
  hiderWins() {
    const S = this.seeker, H = this.hider;
    S.bubble = "Time's up! Where are you?"; H.bubble = "I'm right here! You never found me!";
    this.turns([[S, S.bubble], [H, H.bubble]]);
    this.finish(false);
  }
  finish(found) {
    const S = this.seeker, H = this.hider;
    this.token++;
    this.phase = 'over';
    const rec = { n: this.roundNo, seeker: S.name, hider: H.name, spot: this.spot.name, found, searches: [...this.checked, ...(found && this.target ? [] : [])],
      seekerModel: S.model, hiderModel: H.model, at: Date.now() };
    this.history.push(rec); this.history = this.history.slice(-40); save(HISTORY_KEY, this.history);
    S.status = found ? `Found ${H.name}` : `Could not find ${H.name}`; H.status = found ? 'Caught' : 'Won: never found';
    this.result = { winner: found ? S : H, loser: found ? H : S, found, rec };
    this.ui.log(found
      ? `${S.name} found ${H.name} at ${this.spot.name.toLowerCase()} on search ${Math.max(1, this.searches)}.`
      : `${H.name} stayed hidden at ${this.spot.name.toLowerCase()} for all ${this.seekTime} seconds.`);
    this.ui.finished(this.result);
    this.ui.changed();
  }
  // several lines, spoken one after the other (never over each other)
  turns(list) { let p = Promise.resolve(); for (const [a, text] of list) p = p.then(() => this.ui.speak(a, text)); }

  // a fixed line, shown and spoken
  line(a, text) { a.bubble = text; this.ui.speak(a, text); }

  goHome(msg) {
    this.phase = 'return';
    this.agents.forEach((a, i) => { a.hidden = false; a.thinking = false; goTo(a, this.block, ...this.home[i]); a.status = 'Walking back to the den'; });
    if (msg) this.ui.log(msg);
    this.ui.changed();
  }
}
