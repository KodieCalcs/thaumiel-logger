// Human-readable combat log from per-hit-log.csv. node readable-log.mjs <archive-dir>
//   writes <archive-dir>/combat-log-readable.csv
// Only labelled fields are included; the unlabelled raw offsets stay in per-hit-log.csv.
// `ability` is the in-game action from skill-display-names.json when this install has it (the
// client's internal name stays in `client_name`); `daze` is the Daze the target's Stun gauge took
// from the hit (per-hit-log.mjs `daze`, clamped at the gauge's maximum); a summon's zero-damage copy
// of its Agent's hit is left out (display-names.mjs). `during_stun` is the result's own stunned flag
// where the client has one, else the Stun windows in state.tsv (see stunWindows): Yes when the
// target was already Stunned as the hit was computed, so not on the hit whose Daze starts the Stun.
import fs from "node:fs";
import path from "node:path";
import { parseCsv } from "./log-csv.mjs";
import { enemyStats } from "./enemy-state.mjs";
import { codename, displayName, stripCodename } from "./codename-labels.mjs";
import { loadDisplayNames, entityNames, actionName, anomalyName, abloomTriggers, dropSummonCopies } from "./display-names.mjs";
import { uncountedTail, countdownStart, bossSpawnMs } from "./battle-end.mjs";
const dir = process.argv[2];
if (!dir) { console.error("usage: node readable-log.mjs <archive-dir>"); process.exit(2); }
const logged = parseCsv(fs.readFileSync(path.join(dir, "per-hit-log.csv"), "utf8"));
const names = loadDisplayNames();
const codeName = new Map();
for (const r of logged) {
  // Prefer the property: enemy ability names sometimes omit the Monster_ namespace.
  for (const value of [r.attack_property_name, r.ability_name, r.a8_str18]) {
    const code = codename(value);
    if (code && code !== "Player" && !codeName.has(r.attacker_entity)) codeName.set(r.attacker_entity, displayName(code));
  }
}
// Agents and Bangboos by the skills they used; everything else (the enemy) by its codename.
const entityName = entityNames(logged, names, (e) => codeName.get(e));
for (const [e, n] of [...entityName]) if (!n) entityName.delete(e);
const nameOf = (e) => entityName.get(e) || e || "";
const rows = dropSummonCopies(logged, nameOf);
const targets = new Map(); for (const r of rows) targets.set(r.target_entity, (targets.get(r.target_entity) || 0) + 1);
const mainTarget = [...targets].sort((a, b) => b[1] - a[1])[0]?.[0];
// The enemy's StunBuffModifier IS the Stun (statelog.zig writes its attach "mod+"/"modA" and detach
// "modD"): a window runs from the first attach while none is live to the detach that leaves none.
// A Reset (detach + attach as adjacent rows) keeps it open, also when the two rows straddle a tick
// (RESET_TICK_MS below). Per recipient pointer, which is not the
// hit's target handle, so the windows are used only when exactly one enemy was Stunned (read as the
// main target); otherwise, or without state.tsv, during_stun is left empty.
// Each window is [start ms, end ms, start order, end order]. The orders (the shared row counter,
// captures from 2026-09-29 on) decide a hit in the same ~16 ms step as an attach or detach: the hit
// whose Daze fills the gauge shares the Stun's millisecond but was computed before it (capture 3797:
// no Stun multiplier on that hit, the multiplier on the next one in the same ms).
// A Reset's detach and re-attach are adjacent rows, but elapsed_ms is GetTickCount64 (~15.6 ms
// steps), so the tick can land between them. One capture (2026-10-01) detached at 224344 ms and
// re-attached at 224359, at consecutive orders 280941 / 280942. Two captures without `order` show
// the same at 461031 / 461047 and 152032 / 152047. Read as an End and a new Start, that is a
// 0.48 s Stun with no Reset, then a second Stun that is one Reset short. Without `order`, hits
// stamped in the gap also read "No". Neither can be right. An End is the meter running out
// (CurStun is written to 0 on the detach; here it kept its value), and a new Start needs the whole
// Daze gauge filled again. So an attach within RESET_TICK_MS of an End re-opens that window.
const RESET_TICK_MS = 50;
function stunWindows() {
  let text;
  try {
    text = fs.readFileSync(path.join(dir, "state.tsv"), "utf8");
  } catch {
    return null;
  }
  const lines = text.split(/\r?\n/).filter((l) => l && !l.startsWith("#"));
  const head = (lines[0] ?? "").split("\t");
  const [T, KIND, SELF, A, NAME, ORDER] = ["elapsed_ms", "kind", "self", "a", "name", "order"].map((n) => head.indexOf(n));
  const orderOf = (c) => (ORDER < 0 || c[ORDER] === undefined || c[ORDER] === "" ? null : +c[ORDER]);
  const live = new Map(); // enemy -> live instances
  const windows = new Map(); // enemy -> [[start, end, startOrder, endOrder]]
  for (const l of lines.slice(1)) {
    const c = l.split("\t");
    if (c[NAME] !== "StunBuffModifier") continue;
    const enemy = c[A];
    const set = live.get(enemy) ?? new Set();
    const list = windows.get(enemy) ?? [];
    live.set(enemy, set);
    windows.set(enemy, list);
    if (c[KIND] === "mod+" || c[KIND] === "modA") {
      const last = list[list.length - 1];
      if (set.size === 0 && last && last[1] !== Infinity && +c[T] - last[1] <= RESET_TICK_MS) {
        last[1] = Infinity; // a Reset across a tick: the same window
        last[3] = Infinity;
      } else if (set.size === 0) list.push([+c[T], Infinity, orderOf(c), Infinity]);
      set.add(c[SELF]);
    } else if (c[KIND] === "modD" && set.delete(c[SELF]) && set.size === 0 && list.length) {
      list[list.length - 1][1] = +c[T];
      list[list.length - 1][3] = orderOf(c) ?? Infinity;
    }
  }
  return windows;
}
// Game time: timescale.tsv (timescalelog.zig, change-only) carries the level's own world clock
// (`world_s`), which stands still in Ultimate cinematics (scale 0) and slows with the Chain wheel
// and slow-motions, so time_s is that clock rather than wall time. Between two rows the scale is
// constant, so world time interpolates exactly. The game's pause does NOT stop world_s (the time
// manager keeps integrating while its `pause` counter is up), so a paused span -- from the first
// row with pause > 0 to the next with it back at 0 -- holds the clock still and every later world
// time drops by its length. The `awake` row repeats the previous level's state, and the result
// screen's level restarts world_s and frame, so only the first level's rows are used. Without
// timescale.tsv (or without such rows) time_s is wall time.
function gameClock() {
  let text;
  try {
    text = fs.readFileSync(path.join(dir, "timescale.tsv"), "utf8");
  } catch {
    return null;
  }
  const lines = text.split(/\r?\n/).filter((l) => l && !l.startsWith("#"));
  const head = (lines[0] ?? "").split("\t");
  const [T, SOURCE, WORLD, FRAME, SCALE, PAUSE] = ["elapsed_ms", "source", "world_s", "frame", "scale", "pause"].map((n) => head.indexOf(n));
  if (T < 0 || WORLD < 0 || FRAME < 0 || SCALE < 0) return null;
  const steps = [];
  let removed = 0; // world seconds taken out by pauses so far
  let heldAt = null; // the world time the clock holds at while paused
  let last = null;
  for (const l of lines.slice(1)) {
    const c = l.split("\t");
    const t = +c[T], world = +c[WORLD], frame = +c[FRAME];
    if (c[SOURCE] === "awake" || !Number.isFinite(t) || !Number.isFinite(world)) continue;
    if (last && (frame < last.frame || world < last.world)) break; // the next level
    last = { frame, world };
    if (PAUSE >= 0 && +c[PAUSE] > 0) {
      if (heldAt === null) heldAt = world - removed;
      steps.push({ t, world: heldAt, scale: 0 });
    } else {
      if (heldAt !== null) { removed = world - heldAt; heldAt = null; }
      steps.push({ t, world: world - removed, scale: +c[SCALE] });
    }
  }
  if (!steps.length) return null;
  return (ms) => {
    let i = steps.length - 1;
    while (i > 0 && steps[i].t > ms) i--;
    const a = steps[i], b = steps[i + 1];
    if (b && b.t > a.t && ms >= a.t) return (a.world + (b.world - a.world) * (ms - a.t) / (b.t - a.t)) * 1000;
    return (a.world + a.scale * (ms - a.t) / 1000) * 1000; // before the first row / after the last: the row's scale
  };
}
const clock = gameClock() ?? ((ms) => ms);
const stunned = [...(stunWindows() ?? new Map()).values()].filter((w) => w.length);
const mainStun = stunned.length === 1 ? stunned[0] : null;
const duringStun = (r) => {
  if (r.target_state !== "" && r.target_state !== undefined) return r.target_state === "3" ? "Yes" : "No";
  if (!mainStun) return stunned.length === 0 && stunWindows() ? "No" : "";
  if (r.target_entity !== mainTarget) return "No";
  const t = +r.elapsed_ms;
  const o = r.hit_order === undefined || r.hit_order === "" ? null : +r.hit_order;
  return mainStun.some(([start, end, startOrder, endOrder]) =>
    o !== null && startOrder !== null ? o > startOrder && o < endOrder : t >= start && t < end) ? "Yes" : "No";
};
const targetOf = (e) => (entityName.has(e) ? nameOf(e) : e === mainTarget ? "enemy (main)" : "enemy " + e.slice(-5));

// Readable ability from the AttackProperty name: drop the codename, "AttackProperty", keep the rest.
const readable = (r) => {
  // per-hit-log's attribution: by name, or a nameless row at a base Anomaly multiplier (Corruption).
  if (r.skill_id === "anomaly") return "Anomaly proc";
  const s = stripCodename(r.attack_property_name || r.ability_name || "").replace(/_?Attack[pP]roperty_?/, " #").replace(/_/g, " ").trim();
  return s;
};
// What triggers each Abloom in this log, learned from the hits just before it (display-names.mjs).
const triggers = abloomTriggers(rows, (r) => actionName(r, nameOf(r.attacker_entity), names));
// Late hits the game did not count (battle-end.mjs): kept here with not_counted = Yes, left out of
// every total by summarize.mjs. The team is whoever hits the main target, as in summarize.mjs.
const team = new Set(rows.filter((r) => r.target_entity === mainTarget && r.attacker_entity !== mainTarget).map((r) => r.attacker_entity));
const teamHit = (r) => team.has(r.attacker_entity) && !team.has(r.target_entity);
let settlementCheck = null;
try {
  settlementCheck = JSON.parse(fs.readFileSync(path.join(dir, "settlement-check.json"), "utf8"));
} catch {}
const notCounted = uncountedTail(
  rows.map((r) => ({ t: +r.elapsed_ms, damage: +r.damage_ceil || 0, team: teamHit(r), named: /^[1-9]\d*$/.test(r.skill_id ?? "") })),
  settlementCheck?.battleTotal,
);
// time_s is zero where the countdown began (battle-end.mjs): 180 s before the last counted hit of a
// fight that ran out of time, else the boss's spawn; the first hit on captures without state.tsv.
const sec = (ms) => clock(ms) / 1000;
let lastCounted = -Infinity;
rows.forEach((r, i) => {
  if (!notCounted.has(i) && teamHit(r) && (+r.damage_ceil || 0) > 0) lastCounted = Math.max(lastCounted, +r.elapsed_ms);
});
let spawnMs = null;
try {
  spawnMs = bossSpawnMs(fs.readFileSync(path.join(dir, "state.tsv"), "utf8"));
} catch {}
const countdown = countdownStart(spawnMs === null ? null : sec(spawnMs), Number.isFinite(lastCounted) ? sec(lastCounted) : null);
const t0 = rows.reduce((min, r) => Math.min(min, +r.elapsed_ms), Infinity);
const zero = countdown ? countdown.start : sec(t0);
const pct = (v) => (v === "" ? "" : (+v * 100).toFixed(2));
const mods = (r) => Object.fromEntries((r.modifiers || "").split(";").filter(Boolean).map((m) => m.split("=")));
const cols = ["time_s", "attacker", "target", "skill_id", "ability", "client_name", "attack_tags", "hit_split", "damage", "daze", "anomaly_buildup", "crit", "during_stun",
  "enemy_def", "enemy_def_reduction_pct", "enemy_res_pct", "enemy_damage_taken_pct", "enemy_buildup_taken_pct", "enemy_daze_taken_pct", "enemy_debuffs",
  "damage_mv_pct", "daze_mv_pct", "distance_attenuation", "energy", "decibels", "atk", "impact", "anomaly_mastery", "anomaly_proficiency", "attacker_level",
  "dmg_bonus_pct", "crit_rate_pct", "crit_dmg_pct", "pen_ratio_pct", "flat_pen", "res_ignore_pct", "sheer_force", "other_modifiers", "not_counted"];
// The target's side (debuffs on it, e.g. Nicole's DEF reduction), which the hit's own record leaves out.
const enemyAt = enemyStats(dir, logged);
// battle_am / battle_ap feed anomaly_mastery / anomaly_proficiency below rather than their own columns.
const enemyColumns = ({ battle_am, battle_ap, ...rest }) => rest;
const out = [cols.join(",")];
for (const [i, r] of rows.entries()) {
  const m = mods(r); const att = nameOf(r.attacker_entity);
  const enemy = enemyAt(r);
  const other = Object.entries(m).filter(([k]) => !/^Actor_(CriticalDelta|CriticalDamageRatioDelta|AddedDamageRatio(_\w+)?)$/.test(k)).filter(([, v]) => +v !== 0)
    .map(([k, v]) => k.replace(/^Actor_/, "") + "=" + v).join("; ");
  const o = {
    time_s: (sec(+r.elapsed_ms) - zero).toFixed(3), attacker: att, target: targetOf(r.target_entity), skill_id: r.skill_id,
    ability: (r.skill_id === "anomaly" ? anomalyName(r, att, names, triggers) : null) ?? actionName(r, att, names) ?? readable(r), client_name: readable(r), attack_tags: r.attack_tags ?? "", hit_split: r.hit_split, damage: r.damage_ceil, daze: r.daze === "" ? "" : (+r.daze).toFixed(2), anomaly_buildup: r.buildup_applied === "" ? "" : (+r.buildup_applied).toFixed(2), crit: +r.crit ? "Yes" : "No", during_stun: duringStun(r), ...enemyColumns(enemy),
    damage_mv_pct: pct(r.dmg_mv), daze_mv_pct: pct(r.daze_mv), distance_attenuation: r.attenuation === "" ? "" : (+r.attenuation).toFixed(4), energy: r.energy, decibels: r.decibels,
    atk: r.atk, impact: r.impact, // In-battle Mastery / Proficiency from the per-hit stat reads on direct hits (the result's fields
    // are the base values there); an Anomaly proc keeps its own snapshotted values.
    anomaly_mastery: (r.skill_id !== "anomaly" && enemy.battle_am) || r.anomaly_mastery,
    anomaly_proficiency: (r.skill_id !== "anomaly" && enemy.battle_ap) || r.anomaly_proficiency, attacker_level: r.level,
    dmg_bonus_pct: r.dmg_mult === "" ? "" : ((+r.dmg_mult - 1) * 100).toFixed(2),
    crit_rate_pct: m.Actor_CriticalDelta ? pct(m.Actor_CriticalDelta) : "", crit_dmg_pct: m.Actor_CriticalDamageRatioDelta ? pct(m.Actor_CriticalDamageRatioDelta) : "", pen_ratio_pct: pct(r.f174 ?? ""),
    other_modifiers: other, not_counted: notCounted.has(i) ? "Yes" : "",
  };
  out.push(cols.map((c) => { const v = String(o[c] ?? ""); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; }).join(","));
}
fs.writeFileSync(path.join(dir, "combat-log-readable.csv"), out.join("\n") + "\n");
const notCountedDamage = [...notCounted].reduce((s, i) => s + (+rows[i].damage_ceil || 0), 0);
const round3 = (v) => (v === null ? null : Number(v.toFixed(3)));
fs.writeFileSync(path.join(dir, "combat-log-clock.json"), JSON.stringify({
  zero: countdown?.source ?? "first hit",
  zeroGameS: round3(zero),
  spawnGameS: spawnMs === null ? null : round3(sec(spawnMs)),
  lastCountedGameS: Number.isFinite(lastCounted) ? round3(sec(lastCounted)) : null,
  notCounted: { hits: notCounted.size, damage: notCountedDamage },
}, null, 1));
console.log(rows.length, "rows ->", path.join(dir, "combat-log-readable.csv"), `(${logged.length - rows.length} summon copies left out; names ${names ? "from skill-display-names.json" : "from the client"})`, "attackers:", [...new Set(entityName.values())].join(", "));
