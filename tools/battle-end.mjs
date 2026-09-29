// Where a battle's countdown began and which late hits the game did not count.
//
// The Deadly Assault countdown runs on the game clock (timescale.tsv world_s, as time_s): a screen
// recording of run 3797 (2026-09-29) read 149 timer ticks against the log and put the countdown's
// start at the same game time on every one (7.82 s, +-0.13), through every Ultimate cutscene and
// slow-motion. Damage stops the moment it reaches zero, 180 s later. The boss spawns within ~1.4 s
// of the start (7.96 on 3797; 0.1-1.4 s after it on ten timed-out runs), so a fight that ran into
// the time limit is placed by its end, and any other fight by the spawn.
//
// After time-up the level keeps running until it closes: a periodic effect can go on hitting the
// boss (Phoenix's Core Passive: Nirvana twice, 7.5 s and 15.5 s after time-up on 3797, 5,488 damage
// the settlement lacks). But an effect a final hit triggers can land after it and still be counted
// (Remielle's Luminize 110 ms after the last Fleeting Grace on 3562). So nothing is cut by time: the
// settlement's team damage total decides, as in sheet-webapp's export-run-workbook.mjs battleCutoff.

export const TIME_LIMIT_S = 180;
/** How far a fight's spawn-to-end span may sit from the time limit and still be read as timed out. */
const TIME_LIMIT_SLACK_S = 2;

/**
 * Rows the game did not count. `rows`: { t: ms, damage, team: hit by the team on an enemy,
 * named: carries a real skill id }. Only damaging team rows without a skill id that land after the
 * last one with a skill id can be left out, latest landing time first, and only as far as needed for
 * the log's team total to meet the settlement's (within per-hit rounding). Returns their indices;
 * none when nothing reconciles, so a real mismatch stays visible.
 */
export function uncountedTail(rows, battleTotal) {
  const out = new Set();
  if (!battleTotal) return out;
  const team = rows.map((r, i) => ({ ...r, i })).filter((r) => r.team && r.damage > 0);
  const total = team.reduce((s, r) => s + r.damage, 0);
  const tolerance = Math.ceil(team.length / 100) + 5;
  let lastNamed = -Infinity;
  for (const r of team) if (r.named && r.t > lastNamed) lastNamed = r.t;
  const late = team.filter((r) => !r.named && r.t > lastNamed).sort((a, b) => b.t - a.t);
  let removed = 0;
  for (let k = 0; k <= late.length; k++) {
    // Cut whole landing times: rows sharing a millisecond go together.
    if (k > 0 && k < late.length && late[k].t === late[k - 1].t) continue;
    const cut = late.slice(0, k);
    removed = cut.reduce((s, r) => s + r.damage, 0);
    if (Math.abs(total - removed - battleTotal) <= tolerance) {
      for (const r of cut) out.add(r.i);
      return out;
    }
  }
  return out;
}

/**
 * The countdown's start in game seconds, from the boss's spawn and the fight's last counted hit
 * (both game seconds; either may be null). A fight whose spawn-to-end span is the time limit (within
 * TIME_LIMIT_SLACK_S) ran out of time and started exactly TIME_LIMIT_S before its end; otherwise the
 * spawn is used. Null when neither is known.
 */
export function countdownStart(spawn, end) {
  if (spawn !== null && end !== null && Math.abs(end - spawn - TIME_LIMIT_S) <= TIME_LIMIT_SLACK_S) return { start: end - TIME_LIMIT_S, source: "time-up" };
  if (spawn !== null) return { start: spawn, source: "spawn" };
  return null;
}

/**
 * The boss's spawn (state.tsv elapsed_ms): the first row of the entity whose HP (property 0) fell
 * the most times. Null without state.tsv or HP writes.
 */
export function bossSpawnMs(stateText) {
  const lines = stateText.split(/\r?\n/).filter((l) => l && !l.startsWith("#"));
  const head = (lines[0] ?? "").split("\t");
  const [T, KIND, SELF, I0, F0] = ["elapsed_ms", "kind", "self", "i0", "f0"].map((n) => head.indexOf(n));
  if ([T, KIND, SELF, I0, F0].some((i) => i < 0)) return null;
  const losses = new Map();
  const first = new Map();
  for (const l of lines.slice(1)) {
    const c = l.split("\t");
    if (!first.has(c[SELF])) first.set(c[SELF], +c[T]);
    if (c[KIND] === "prop" && c[I0] === "0" && +c[F0] < 0) losses.set(c[SELF], (losses.get(c[SELF]) ?? 0) + 1);
  }
  const boss = [...losses].sort((a, b) => b[1] - a[1])[0]?.[0];
  return boss === undefined ? null : first.get(boss);
}
