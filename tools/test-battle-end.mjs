// node tools/test-battle-end.mjs — battle-end.mjs: which late hits the game did not count, where the
// countdown began, and the boss's spawn.
// SYNTHETIC fixtures: times, damage and entity pointers are made up. The shapes are the captures':
// run 3797 (two Core Passive: Nirvana ticks 7.5 s and 15.5 s after time-up, not in the settlement's
// team total), run 3562 (a Luminize 110 ms after the last skill hit, in it), and a spawn-to-end span
// of 178.6-180.1 game s on ten timed-out runs.
import assert from "node:assert/strict";
import { uncountedTail, countdownStart, bossSpawnMs, TIME_LIMIT_S } from "./battle-end.mjs";

const hit = (t, damage, named = true, team = true) => ({ t, damage, named, team });
const fight = [hit(1000, 5000), hit(2000, 7000), hit(3000, 9000), hit(3050, 1000, false)]; // last: an unnamed proc
const total = fight.reduce((s, r) => s + r.damage, 0);

// No settlement total: nothing is cut.
assert.equal(uncountedTail([...fight, hit(10000, 2744, false)], undefined).size, 0);
// The log already matches: nothing is cut, late unnamed rows included (a Luminize just after the last hit).
assert.equal(uncountedTail(fight, total).size, 0);
// Two periodic ticks after the battle, not in the total: both cut, and only they.
{
  const rows = [...fight, hit(10000, 2744, false), hit(18000, 2744, false)];
  assert.deepEqual([...uncountedTail(rows, total)].sort(), [4, 5]);
}
// Only as far as needed, latest first: the settlement counted the first tick, not the second.
{
  const rows = [...fight, hit(10000, 2744, false), hit(18000, 2744, false)];
  assert.deepEqual([...uncountedTail(rows, total + 2744)], [5]);
}
// Per-hit rounding stays inside the tolerance (ceil(hits / 100) + 5).
assert.equal(uncountedTail(fight, total + 5).size, 0);
// A row with a skill id is never cut, and rows before the last one with a skill id are never cut.
{
  const rows = [hit(1000, 2744, false), ...fight, hit(10000, 2744)];
  assert.equal(uncountedTail(rows, total).size, 0); // no cut reconciles: the mismatch stays visible
}
// Rows landing on one millisecond go together.
{
  const rows = [...fight, hit(10000, 1000, false), hit(10000, 1500, false)];
  assert.deepEqual([...uncountedTail(rows, total)].sort(), [4, 5]);
  assert.equal(uncountedTail(rows, total + 1000).size, 0); // cutting half the millisecond is not tried
}
// Enemy hits on the team are not team damage and are never cut.
assert.equal(uncountedTail([...fight, hit(10000, 2744, false, false)], total).size, 0);

// The countdown: a fight whose spawn-to-end span is the time limit ran out of time.
assert.deepEqual(countdownStart(7.96, 187.86), { start: 187.86 - TIME_LIMIT_S, source: "time-up" });
assert.equal(countdownStart(7.07, 185.64).source, "time-up"); // 178.57 s: the shortest seen
assert.deepEqual(countdownStart(7.0, 120), { start: 7.0, source: "spawn" }); // killed or quit early
assert.deepEqual(countdownStart(7.0, null), { start: 7.0, source: "spawn" });
assert.equal(countdownStart(null, 187.86), null);

// The boss's spawn: the first row of the entity whose HP fell the most times.
{
  const head = "elapsed_ms\tkind\tself\ta\tb\tc\td\ti0\ti1\tf0\tf1\tname\tcaller\torder";
  const row = (ms, kind, self, i0 = "", f0 = "") => [ms, kind, self, "", "", "", "", i0, "", f0, "", "", "", ""].join("\t");
  const state = [
    head,
    row(31, "mod+", "0xagent"),
    row(8187, "get", "0xboss", "0"),
    row(9000, "prop", "0xagent", "0", "-50"), // the team takes a hit
    row(9609, "prop", "0xboss", "0", "-627"),
    row(9671, "prop", "0xboss", "0", "-940"),
    row(9700, "prop", "0xboss", "0", "12"), // a heal is not a loss
  ].join("\n");
  assert.equal(bossSpawnMs(state), 8187);
  assert.equal(bossSpawnMs(head), null);
}
console.log("battle-end: ok");
