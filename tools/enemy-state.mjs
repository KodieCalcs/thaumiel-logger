// Enemy-side stats at each hit, from state.tsv (src/statelog.zig's property writes): what debuffs on
// the target did to it, which the hit's own record (the attacker's side) cannot show. Nicole's DEF
// reduction, for one, is a debuff on the enemy, so a hit's DefenceRatio modifier leaves it out.
//
//   import { enemyStats } from "./enemy-state.mjs";
//   const at = enemyStats(dir, perHitRows);   // rows of per-hit-log.csv
//   at(row) -> { enemy_def, enemy_def_reduction_pct, enemy_dmg_res_pct, enemy_daze_taken_pct,
//                enemy_debuffs }   ("" when not known)
//
// enemy_debuffs names the team's modifiers live on the target at the hit (Velina's RES shred,
// Phoenix's core, a Disc set's Anomaly RES shred...). Most such debuffs change no stored stat: the
// game applies them while the hit is computed, and their amounts are in no log, so the names (and
// when they were on) are what is captured. DEF reduction and DMG RES are stored stats, read below.
//
// enemy_daze_taken_pct is measured, not read: the Daze a hit asked for divided by its Daze
// multiplier x (Impact + flat Impact bonus, BreakStunDelta) x (1 + the attacker's Daze bonus,
// AddedBreakStunRatio) x its distance falloff is exactly 1 on every hit of four test battles except
// under Assault, where it is 1.075 (33 of 35 hits in its window). The rest is the target's side.
// Anomaly procs (their Daze does not come from Impact) and hits with no Daze get none.
//
// Every entity's stats live in a property table that the log names by the table's pointer. A table
// is matched to the target whose damage it records: each hit's damage is written to its target's HP
// (type 0) as a negative change within a frame of the hit (a Nicole battle: 772 of 772 writes on the
// enemy's table matched hits on that one enemy).
//
// Type ids are the client's Share.EPropertyType numbers. The dump has no names for them, so each is
// identified by value from a capture, per client version; a client not listed gets empty columns.
//   DEF reduction: the write's value is the change to the target's DEF reduction ratio (Nicole's
//   core passive: -0.4 on, +0.4 off) and its second value is the target's DEF after it
//   (952.8 -> 571.68, x 0.6). CNBetaWin3.3.4 type 562: 191 applies / 190 removes, one per
//   attach / detach of NosUniqueDebuffModifier (Nicole's codename is Nostradamus).
//   DMG RES: the second value is the target's total DMG RES change in 1/10000 (-1000 = -10%, the
//   target takes more), the first the change. CNBetaWin3.3.4 type 574: its writes coincide with
//   every attach / detach of DamageResistRatio_Talent02 (a Mindscape 2 debuff) in a Yuzuha battle.
import fs from "node:fs";
import path from "node:path";

const DEF_REDUCTION_TYPE = { "CNBetaWin3.3.4": "562" };
const DMG_RES_TYPE = { "CNBetaWin3.3.4": "574" };
const HP_TYPE = "0";
const MATCH_MS = 50;

function clientOf(dir) {
  try {
    const result = fs.readdirSync(dir).find((n) => /^damage-result-.*\.tsv$/.test(n));
    const header = fs.readFileSync(path.join(dir, result), "utf8").split("\n", 1)[0];
    return /client=(\S+)/.exec(header)?.[1] ?? null;
  } catch {
    return null;
  }
}

/** state.tsv as property writes and modifier attach / detach rows, or null without it. */
function readState(dir) {
  let text;
  try {
    text = fs.readFileSync(path.join(dir, "state.tsv"), "utf8");
  } catch {
    return null;
  }
  const lines = text.split(/\r?\n/).filter((l) => l && !l.startsWith("#"));
  const head = (lines[0] ?? "").split("\t");
  const [T, KIND, SELF, A, B, TYPE, F0, F1, NAME] = ["elapsed_ms", "kind", "self", "a", "b", "i0", "f0", "f1", "name"].map((n) => head.indexOf(n));
  const props = [];
  const mods = [];
  for (const l of lines.slice(1)) {
    const c = l.split("\t");
    if (c[KIND] === "prop") props.push({ t: +c[T], table: c[SELF], type: c[TYPE], change: +c[F0], after: +c[F1] });
    else if ((c[KIND] === "mod+" || c[KIND] === "modA" || c[KIND] === "modD") && c[NAME])
      mods.push({ t: +c[T], kind: c[KIND], self: c[SELF], on: c[A].toLowerCase(), caster: (c[B] || "").toLowerCase(), name: c[NAME] });
  }
  return { props, mods };
}

// Not debuffs in the sense a reader means: the Stun itself (during_stun has it) and the engine's
// placeholder instance.
const NOT_DEBUFFS = new Set(["StunBuffModifier", "__DEFAULT_MODIFIER"]);

/** The team's modifiers on each target over time: a modifier counts when some instance of it was
 *  created on that target by one of the hits' attackers other than the target itself (a fresh
 *  instance carries its caster; a pooled one reused does not, so the name decides). Returns
 *  (target, t) -> the names live on it at t, sorted. */
function debuffsOn(mods, attackers) {
  const teamNames = new Map(); // target -> Set(names the team cast on it)
  for (const m of mods) {
    if (m.kind !== "mod+" || !m.caster || m.caster === m.on || !attackers.has(m.caster) || NOT_DEBUFFS.has(m.name)) continue;
    const s = teamNames.get(m.on) ?? new Set();
    s.add(m.name);
    teamNames.set(m.on, s);
  }
  // Per target, each name's live instances as change points: [t, name, +1 | -1].
  const events = new Map();
  const live = new Map(); // `${target}\t${self}` -> name, so a detach is counted once
  for (const m of mods) {
    if (!teamNames.get(m.on)?.has(m.name)) continue;
    const key = `${m.on}\t${m.self}`;
    const list = events.get(m.on) ?? [];
    if (m.kind === "modD") {
      if (live.get(key) !== m.name) continue;
      live.delete(key);
      list.push([m.t, m.name, -1]);
    } else {
      if (live.get(key) === m.name) continue; // mod+ and modA of one attach
      live.set(key, m.name);
      list.push([m.t, m.name, +1]);
    }
    events.set(m.on, list);
  }
  return (target, t) => {
    const list = events.get(target);
    if (!list) return [];
    const count = new Map();
    for (const [at, name, d] of list) {
      if (at > t) break;
      count.set(name, (count.get(name) ?? 0) + d);
    }
    return [...count].filter(([, n]) => n > 0).map(([name]) => name).sort();
  };
}

/** Which target each property table belongs to: the target whose hits its HP losses match. */
function tableTargets(props, hits) {
  const byTime = [...hits].sort((a, b) => a.t - b.t);
  const votes = new Map(); // table -> Map(target -> n)
  for (const w of props) {
    if (w.type !== HP_TYPE || !(w.change < 0)) continue;
    const damage = -w.change;
    // Hits within MATCH_MS of the write (binary search to the window's start).
    let lo = 0;
    let hi = byTime.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (byTime[mid].t < w.t - MATCH_MS) lo = mid + 1;
      else hi = mid;
    }
    for (let i = lo; i < byTime.length && byTime[i].t <= w.t + MATCH_MS; i++) {
      if (Math.abs(byTime[i].damage - damage) > 1) continue;
      const v = votes.get(w.table) ?? new Map();
      v.set(byTime[i].target, (v.get(byTime[i].target) ?? 0) + 1);
      votes.set(w.table, v);
    }
  }
  const tableOf = new Map(); // target -> table
  for (const [table, v] of votes) {
    const [target, n] = [...v].sort((a, b) => b[1] - a[1])[0];
    const current = tableOf.get(target);
    if (!current || n > current.n) tableOf.set(target, { table, n });
  }
  return new Map([...tableOf].map(([target, { table }]) => [target, table]));
}

/** The target's share of a hit's Daze, % over what the attacker's side accounts for (see the header). */
export function dazeTakenPct(row) {
  if (row.skill_id === "anomaly" || !(+row.daze_mv > 0) || !(+row.daze_requested > 0) || !(+row.impact > 0)) return "";
  const m = Object.fromEntries((row.modifiers || "").split(";").filter(Boolean).map((kv) => kv.split("=")));
  const flat = +(m.Actor_BreakStunDelta || 0);
  const bonus = +(m.Actor_AddedBreakStunRatio || 0);
  const distance = row.attenuation === "" || row.attenuation === undefined ? 1 : +row.attenuation;
  const expected = +row.daze_mv * (+row.impact + flat) * (1 + bonus) * distance;
  if (!(expected > 0)) return "";
  const v = (+row.daze_requested / expected - 1) * 100;
  // Float rounding in the logged multipliers leaves up to ~0.1% on an unaffected hit.
  return Math.abs(v) < 0.2 ? "0" : v.toFixed(1);
}

export function enemyStats(dir, perHitRows) {
  const empty = { enemy_def: "", enemy_def_reduction_pct: "", enemy_dmg_res_pct: "", enemy_debuffs: "" };
  const withDaze = (row, cols) => ({ ...cols, enemy_daze_taken_pct: dazeTakenPct(row) });
  const state = readState(dir);
  if (!state) return (row) => withDaze(row, empty);
  const { props, mods } = state;
  const attackers = new Set(perHitRows.map((r) => String(r.attacker_entity).toLowerCase()));
  const debuffs = debuffsOn(mods, attackers);
  const debuffText = (row) => debuffs(String(row.target_entity).toLowerCase(), +row.elapsed_ms).join("; ");
  const client = clientOf(dir);
  const type = DEF_REDUCTION_TYPE[client];
  if (!type) return (row) => withDaze(row, { ...empty, enemy_debuffs: debuffText(row) });
  const none = () => ({ enemy_def: "", enemy_def_reduction_pct: "" });
  const hits = perHitRows
    .map((r) => ({ t: +r.elapsed_ms, target: String(r.target_entity).toLowerCase(), damage: +r.damage_ceil }))
    .filter((h) => Number.isFinite(h.t) && h.damage > 0);
  const tables = tableTargets(props, hits);
  // Per table, the DEF-reduction writes in time order with the running reduction after each.
  const series = new Map();
  for (const w of props) {
    if (w.type !== type) continue;
    const s = series.get(w.table) ?? [];
    const reduction = (s.length ? s[s.length - 1].reduction : 0) - w.change;
    s.push({ t: w.t, reduction, def: w.after });
    series.set(w.table, s);
  }
  // DEF before the first write: the first write's DEF with its reduction undone. Every write must
  // give the same base DEF (DEF after = base x (1 - reduction)); a table where it does not is not
  // being read right -- the type id moved with a client update, or a flat change came in -- so its
  // columns are left empty rather than wrong.
  const baseDef = new Map();
  const unreadable = new Set();
  for (const [table, s] of series) {
    const bases = s.map((w) => w.def / (1 - w.reduction));
    if (bases.every((b) => Number.isFinite(b) && Math.abs(b - bases[0]) <= Math.abs(bases[0]) * 0.001)) baseDef.set(table, bases[0]);
    else unreadable.add(table);
  }
  const pct = (v) => (Math.abs(v) < 1e-9 ? "0" : (v * 100).toFixed(2));
  const defAt = (row) => {
    const table = tables.get(String(row.target_entity).toLowerCase());
    if (!table) return none();
    if (unreadable.has(table)) return none();
    const s = series.get(table);
    if (!s) return { enemy_def: "", enemy_def_reduction_pct: "0" }; // never debuffed; DEF not written
    const t = +row.elapsed_ms;
    let last = null;
    for (const w of s) {
      if (w.t > t) break;
      last = w;
    }
    return last
      ? { enemy_def: last.def.toFixed(2), enemy_def_reduction_pct: pct(last.reduction) }
      : { enemy_def: baseDef.get(table).toFixed(2), enemy_def_reduction_pct: "0" };
  };
  // DMG RES: the running total is the write's second value; each must equal the previous plus the
  // change, else the table is not read right and its column stays empty.
  const resType = DMG_RES_TYPE[client];
  const res = new Map();
  for (const w of props) {
    if (!resType || w.type !== resType) continue;
    const s = res.get(w.table) ?? [];
    s.push({ t: w.t, total: w.after, ok: Math.abs((s.length ? s[s.length - 1].total : 0) + w.change - w.after) <= 0.5 });
    res.set(w.table, s);
  }
  const resAt = (row) => {
    const table = tables.get(String(row.target_entity).toLowerCase());
    if (!table || !resType) return "";
    const s = res.get(table);
    if (!s) return "0";
    if (!s.every((w) => w.ok)) return "";
    let total = 0;
    for (const w of s) {
      if (w.t > +row.elapsed_ms) break;
      total = w.total;
    }
    return Math.abs(total) < 1e-6 ? "0" : (total / 100).toFixed(2);
  };
  return (row) => withDaze(row, { ...defAt(row), enemy_dmg_res_pct: resAt(row), enemy_debuffs: debuffText(row) });
}
