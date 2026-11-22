// The agents' brains. Each decision is one call to a local model through Ollama (on this Mac, nothing leaves it).
// The model gets a short description of the situation and a numbered list of choices, and must answer in JSON:
//   { "thought": "...", "choice": 3 }
// The game, not the model, moves the characters and applies the rules, so the model cannot cheat
// (it never sees where the hider really is). A "scripted" brain with simple fixed rules is the fallback.

const OLLAMA = 'http://localhost:11434';
const SCHEMA = {
  type: 'object',
  // choice comes first, so the model decides before it explains (the thought then matches the choice)
  properties: { choice: { type: 'integer' }, thought: { type: 'string' } },
  required: ['choice', 'thought'],
};

export async function ollamaModels() {
  try {
    const r = await fetch(`${OLLAMA}/api/tags`, { signal: AbortSignal.timeout(2500) });
    const j = await r.json();
    return j.models.map((m) => m.name);
  } catch { return null; }
}

async function ask(model, system, user, n, earlier = [], temperature = 0.9) {
  const t0 = performance.now();
  const r = await fetch(`${OLLAMA}/api/chat`, {
    method: 'POST',
    body: JSON.stringify({
      model, stream: false, think: false, format: SCHEMA, keep_alive: '30m',
      options: { temperature, repeat_penalty: 1.15, num_predict: 120 },
      messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
    }),
    signal: AbortSignal.timeout(90000),
  });
  const j = await r.json();
  if (j.error) throw new Error(j.error);
  const out = JSON.parse(j.message.content);
  // too similar to an earlier thought? Compare the words (ignoring the place names, which always differ).
  const places = new Set((user.match(/^\d+\. ([^(]+)/gm) || []).join(' ').toLowerCase().replace(/[^a-z ]/g, ' ').split(/\s+/));
  const words = (t) => new Set(String(t || '').toLowerCase().replace(/[^a-z ]/g, ' ').split(/\s+/).filter((w) => w.length > 2 && !places.has(w)));
  const similar = (a, b) => { const A = words(a), B = words(b); const inter = [...A].filter((w) => B.has(w)).length; return inter / Math.max(1, Math.min(A.size, B.size)); };
  if (earlier.some((e) => similar(e, out.thought) >= 0.6) && temperature < 1.2) {
    return ask(model, `${system}\nYour last answer repeated an earlier thought. Say something different.`, user, n, earlier, 1.25);
  }
  const c = Math.round(Number(out.choice));
  const valid = c >= 1 && c <= n;
  return {
    thought: String(out.thought || '').trim().slice(0, 180) || '…',
    choice: valid ? c - 1 : Math.floor(Math.random() * n),
    valid, secs: (performance.now() - t0) / 1000, model,
  };
}

const style = () => `First decide: choice = the number of your pick.
Then thought = your inner voice about THAT choice: ONE short, natural sentence in simple English, at most 15 words, like a real kid playing. Name the place you picked and give your actual reason (light, distance, what you remember, what is left).
Talk like you are thinking, not reporting: never start with "I pick" or "I choose". Every thought must be new: do not reuse the words or the opening of your earlier thoughts. Answer only with the JSON.`;
const recent = (me) => (me.thoughts.length ? `\nYour last thoughts (do not repeat their words or opening): ${me.thoughts.slice(0, 3).map((t) => `"${t.text}"`).join(' ')}` : '');
const level = (v) => `${v}/5`;

// what this agent remembers: the last few rounds it played, seen from its side
export function memoryNotes(history, me, rounds) {
  if (rounds <= 0) return [];
  const mine = history.filter((h) => h.seeker === me.name || h.hider === me.name).slice(-rounds);
  return mine.map((h) => {
    const checks = h.searches.length ? h.searches.join(', ') : 'nothing';
    if (h.hider === me.name)
      return `Round ${h.n}: you hid at "${h.spot}". ${h.seeker} ${h.found ? `found you after ${h.searches.length} search${h.searches.length === 1 ? '' : 'es'}` : 'never found you'}. ${h.seeker} checked: ${checks}.`;
    return `Round ${h.n}: you were the seeker. ${h.hider} hid at "${h.spot}". You ${h.found ? 'found' : 'did not find'} ${h.hider}. You checked: ${checks}.`;
  });
}

export function hidePrompt(ctx) {
  const { me, seeker, spots, memory } = ctx;
  const system = `You are ${me.name}, playing chhupan chhupai (hide and seek) at night in Rampur, a small village in India. ${seeker.name} is the seeker, counting with eyes closed at the peepal chabutra (the den). Choose where to hide.
How the game works: dark places are hard to see into; in lit places a standing person is spotted from far away. Walls block the view. Once you crouch in your spot, ${seeker.name} only finds you if he checks that spot and then notices you, which is a matter of chance: your stealth, his night vision and the light decide (a lit spot is easier to notice). Seekers usually check the nearest places first, so the closest spot is often the first one searched, and a spot you have used before is risky because ${seeker.name} may remember it. ${seeker.name} has only ${ctx.seekTime} seconds to search. But ${seeker.name} may remember where you hid before.
Your stealth is ${level(me.stats.stealth)}. ${seeker.name}'s night vision is ${level(seeker.stats.night)}.
${style()}`;
  const user = [
    'Hiding spots:',
    ...spots.map((s, i) => `${i + 1}. ${s.name} (${s.steps} steps from the den, ${s.light})`),
    '',
    memory.length ? `What you remember:\n${memory.join('\n')}` : 'This is your first round with nothing to remember.',
    recent(me),
    '',
    'Pick one spot.',
  ].join('\n');
  return { system, user, n: spots.length };
}

export function seekPrompt(ctx) {
  const { me, hider, options, checked, left, here, memory } = ctx;
  const system = `You are ${me.name}, the seeker in chhupan chhupai (hide and seek) at night in Rampur, a small village in India. You counted to 30 at the peepal chabutra and now must find ${hider.name}. Choose the next place to search.
How the game works: in lit places you spot a person from far away; in the dark only close up (your night vision is ${level(me.stats.night)}). Walls block your view. ${hider.name}'s stealth is ${level(hider.stats.stealth)}: when you check the spot where ${hider.name} is crouched you only notice ${hider.name} by chance; the light helps you. Far places take longer to reach.
${style()}`;
  const user = [
    `You are at: ${here}. You cannot see ${hider.name} right now.`,
    `Time left: ${left} seconds. Already searched: ${checked.length ? checked.join(', ') : 'nothing yet'}.`,
    '',
    'Places you have not searched:',
    ...options.map((s, i) => `${i + 1}. ${s.name} (${s.steps} steps from you, ${s.light})`),
    '',
    memory.length ? `What you remember:\n${memory.join('\n')}` : 'You have no memory of earlier rounds.',
    recent(me),
    '',
    'Pick where to search next.',
  ].join('\n');
  return { system, user, n: options.length };
}

// scripted brains: simple fixed rules, used when Ollama is not running or the player picks "Scripted"
const pick = (a) => a[Math.floor(Math.random() * a.length)];
function scriptedHide(ctx) {
  const dark = ctx.spots.map((s, i) => [s, i]).filter(([s]) => s.light !== 'lit');
  const [s, i] = pick(dark.length ? dark : ctx.spots.map((q, k) => [q, k]));
  const thought = pick([`${s.name}. Nobody looks there.`, `I'll go ${s.name.toLowerCase()}, it's dark enough.`, `${s.name} should keep me hidden.`]);
  return { thought, choice: i, valid: true, secs: 0, model: 'scripted' };
}
function scriptedSeek(ctx) {
  const order = ctx.options.map((s, i) => [s, i]).sort((a, b) => a[0].steps - b[0].steps);
  const [s, i] = Math.random() < 0.7 ? order[0] : pick(order);
  const thought = pick([`Let me check ${s.name.toLowerCase()}.`, `Maybe ${s.name.toLowerCase()}?`, `Closest first: ${s.name.toLowerCase()}.`]);
  return { thought, choice: i, valid: true, secs: 0, model: 'scripted' };
}

export async function decide(kind, agent, ctx, online) {
  const useModel = online && agent.model !== 'scripted';
  if (useModel) {
    const p = kind === 'hide' ? hidePrompt(ctx) : seekPrompt(ctx);
    try { return await ask(agent.model, p.system, p.user, p.n, agent.thoughts.slice(0, 4).map((t) => t.text)); }
    catch (e) { const r = kind === 'hide' ? scriptedHide(ctx) : scriptedSeek(ctx); return { ...r, error: String(e.message || e) }; }
  }
  return kind === 'hide' ? scriptedHide(ctx) : scriptedSeek(ctx);
}
