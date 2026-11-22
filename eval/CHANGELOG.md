# Development log (pilot runs)

Pilots are small practice runs (`PILOT=1 node eval/run.mjs <experiment> 30`) used to find and fix problems.
Only the final run on frozen code (`eval/run_all.sh`, results in `results.jsonl`) is reported as a result.

## Pilot 1 (ai8-vs-ai8, 30 rounds), before any fix
Found with a direct test: hiding place chosen by list position, not by place (position 4 in 24 of 24 tries).
Fix: the order of places is shuffled before every decision (hiding and searching).

## Pilot 2 (ai8-vs-ai8, 30 rounds), after the shuffle
Position bias gone (8 places used, 0 invalid answers). New problem: "Behind the haystack" chosen in 53% of rounds
(close and dark), and the same place as the round before in 38% (random would be about 13%); seeker found the hider in 80%.
Cause: the hider was never told that seekers check close places first and may remember an old spot.
Fix: that knowledge was added to the hider's instructions.

## Pilot 2 result (ai8-vs-ai8, 30 rounds, after telling the hider that seekers check close places first)
Most common place 40% (was 53%), same place as the round before 21% (was 38%), 0 invalid answers.
Seeker found the hider in 83% of rounds. Left as it is: an AI hider that prefers close, dark places is predictable,
and that is a finding, not a bug (the scripted baseline is about 50%).

## Fixes before the final run (no change to the rules of seeing or to the prompts)
Red ring under people removed; walls and furniture now drawn in front of or behind a person correctly;
bubbles kept inside the screen and hidden when far away; the hider speaks first, the seeker then counts 1 to 30 softly,
and voices take turns instead of cutting each other off. Furniture was made solid and then reverted: rooms are only
2 x 2 tiles, so it closed off rooms and two hiding spots.

## Final run
Code frozen. `sh eval/run_all.sh` (rounds per experiment are in eval/run.mjs: 200 for scripted, 60 for AI vs scripted
and AI vs AI, 40 for memory, 20 for 14b vs 8b). Results: eval/results.jsonl, table: `node eval/report.mjs`.

## First full run (old rules): results saved in results_v1_old-rules.jsonl
AI seeker no better than simple rules (47% vs 47%); the 8b AI hider was worse than a random scripted hider (found 82% vs 47%);
the 14b hider was much better than the 8b hider (found 45% vs 87%, only 20 rounds each); memory made no difference (93% vs 93%).
And stealth 5 vs 1 (48% vs 50%) and night vision 5 vs 1 (51% vs 53%) made no difference either.
That last result was a design bug: the seeker walks right up to every spot he checks, so a "how close must he come" stealth
rule was never tested. Abilities did nothing, and the first version of the game claimed they did.

## Rule change: noticing is a chance
When the seeker checks a spot where the hider is crouched, he notices her with a chance:
85% + 8 points per night-vision level above 3 - 8 points per stealth level above 3, +4 (dim) or +8 (lit) for light, kept between 10% and 98%.
The AI instructions were updated to describe this. Scripted check, 400 rounds each: equal abilities 45% found; stealth 5 vs 1: 36% vs 50%;
night vision 5 vs 1: 48% vs 38%. Abilities now change the outcome. Everything is re-measured from scratch on these rules.

## Final run results (final rules)
Equal scripted brains and abilities: seeker found the hider 42% (200 rounds). AI seeker vs scripted seeker: 37% vs 42% (no difference).
8b AI hider vs scripted hider: found 72% vs 42% (the AI hider is worse). 14b hider vs 8b hider: found 20% vs 80% (20 rounds each).
Memory 5 vs none: 83% vs 78% (no difference). Night vision 5 vs 1: 51% vs 37% (real). Stealth 5 vs 1: 38% vs 47% (right direction, not clearly beyond luck at 200 rounds).
0 invalid or failed AI answers in 12 experiments.
