// Enemy-side stats at each hit, from state.tsv (src/statelog.zig's property writes): what debuffs on
// the target did to it, which the hit's own record (the attacker's side) cannot show. Nicole's DEF
// reduction, for one, is a debuff on the enemy, so a hit's DefenceRatio modifier leaves it out.
//
//   import { enemyStats } from "./enemy-state.mjs";
//   const at = enemyStats(dir, perHitRows);   // rows of per-hit-log.csv
//   at(row) -> { enemy_def, enemy_def_reduction_pct, enemy_res_pct, enemy_daze_taken_pct,
//                enemy_damage_taken_pct, enemy_debuffs, flat_pen, sheer_force, res_ignore_pct }
//                ("" when not known)
//
// enemy_damage_taken_pct is measured like the Daze one: a hit's unrounded damage divided by what the
// attacker's side accounts for --
//   standard: MV x ATK x DMG multiplier x crit x DEF multiplier x distance x (1 + RES ignore)
//             DEF multiplier = 794 / (794 + max(DEF x (1 - DEF reduction - DEF ignore)
//                              x (1 - PEN Ratio) - flat PEN, 0))   (level 60; wiki "Damage")
//   Sheer:    MV x Sheer Force x DMG multiplier x (1 + Sheer DMG bonus) x crit x distance
//             x (1 + RES ignore)   (no DEF; Sheer DMG bonus = Actor_AddedSkipDefDamageRatio)
// is exactly 1.000 on every hit with no enemy-side effect in two 2026-09-28 captures (Phoenix,
// Velina, Nicole, Yixuan, a Bangboo), and 1.100 on every hit under Phoenix's
// Pheony_UniqueSkill_Vulnerable. What is left is the target's side all together: RES shred, DMG
// taken, and the Stun multiplier while it is Stunned. Blank on Anomaly procs (their own formula)
// and when an input is missing. Flat PEN and Sheer Force come from the attacker's property table
// (docs/property-types.md: 568 / 22, 65), paired with the attacker by its Energy writes, else a
// unique ATK match; without the stat-read log, flat PEN falls back to the loadout's disc substats
// for the flat_pen column only -- the factor needs the game's own reads (a loadout knows no PEN from
// buffs), so captures before 2026-09-28 get no factor. An ability whose factor sits off the same
// attacker's other hits within a second (median beyond 3%) follows a rule of its own (Cissia's
// Corrode Bone curse: a steady x2.317) and gets none either.
//
// enemy_debuffs names the team's modifiers live on the target at the hit (Velina's RES shred,
// Phoenix's core, a Disc set's Anomaly RES shred...). Most such debuffs change no stored stat: the
// game applies them while the hit is computed, and their amounts are in no log, so the names (and
// when they were on) are what is captured. DEF reduction and All-Attribute RES are stored stats, read below.
//
// enemy_def when nothing has lowered it: the target's own hits carry its DEF (the result's DEF field is
// the attacker's), so the nearest of those is used; a target that never attacked has none.
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
//   All-Attribute RES: the second value is the target's total All-Attribute RES change in 1/10000
//   (-1000 = -10%), the first the change. CNBetaWin3.3.4 type 574: its writes coincide with every
//   attach / detach of Yuzuha's DamageResistRatio_Talent02, which her ability data defines as
//   Actor_AllDamageResist on the enemy, applied at talent index 1 (Mindscape 1).
import fs from "node:fs";
import path from "node:path";

const DEF_REDUCTION_TYPE = { "CNBetaWin3.3.4": "562" };
const ALL_RES_TYPE = { "CNBetaWin3.3.4": "574" };
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
  const gets = [];
  const mods = [];
  for (const l of lines.slice(1)) {
    const c = l.split("\t");
    if (c[KIND] === "prop") props.push({ t: +c[T], table: c[SELF], type: c[TYPE], change: +c[F0], after: +c[F1] });
    else if (c[KIND] === "get") gets.push({ t: +c[T], table: c[SELF], type: c[TYPE], value: +c[F0] });
    else if ((c[KIND] === "mod+" || c[KIND] === "modA" || c[KIND] === "modD") && c[NAME])
      mods.push({ t: +c[T], kind: c[KIND], self: c[SELF], on: c[A].toLowerCase(), caster: (c[B] || "").toLowerCase(), name: c[NAME] });
  }
  return { props, mods, gets };
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

const LEVEL_FACTOR = 794; // attacker level 60 (wiki "Damage"); rows at other levels get no factor
const mods = (row) => Object.fromEntries((row.modifiers || "").split(";").filter(Boolean).map((kv) => kv.split("=")));

/** RES ignore on the hit, from the attacker's own <Attribute>DamageResist / AllDamageResist modifiers
 *  (negative = the target's RES is lowered for this hit). */
export function resIgnore(row) {
  return Object.entries(mods(row)).filter(([k]) => /DamageResist$/.test(k)).reduce((sum, [, v]) => sum - +v, 0);
}

/** Flat PEN per avatar id from the loadout's disc substats (9 per roll: base x rolls). */
function loadoutFlatPen(dir) {
  const out = new Map();
  try {
    const f = fs.readdirSync(dir).find((n) => /^endbattle_\d+_loadout\.json$/.test(n));
    if (!f) return out;
    for (const a of JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")).avatars ?? []) {
      let pen = 0;
      for (const disc of a.drive_discs ?? []) (disc.properties ?? []).forEach((p, i) => { if (i > 0 && p.key === 23203) pen += p.base_value * p.add_value; });
      out.set(a.avatar_id, pen);
    }
  } catch {}
  return out;
}

/** attacker entity -> its property table: Energy (type 7) writes equal to a hit's Energy within 50 ms,
 *  else the one table whose ATK (560 / 2) equals the hits' ATK. */
function attackerTables(props, series, perHitRows) {
  const out = new Map();
  const energy = perHitRows.filter((h) => +h.energy > 0).map((h) => ({ t: +h.elapsed_ms, e: +h.energy, a: String(h.attacker_entity).toLowerCase() })).sort((x, y) => x.t - y.t);
  const votes = new Map();
  for (const w of props) {
    if (w.type !== "7" || !(w.change > 0)) continue;
    for (const h of energy) {
      if (h.t < w.t - MATCH_MS) continue;
      if (h.t > w.t + MATCH_MS) break;
      if (Math.abs(h.e - w.change) > 1e-3) continue;
      const v = votes.get(h.a) ?? new Map();
      v.set(w.table, (v.get(w.table) || 0) + 1);
      votes.set(h.a, v);
    }
  }
  for (const [a, v] of votes) out.set(a, [...v].sort((x, y) => y[1] - x[1])[0][0]);
  const byAtk = new Map();
  for (const [table, types] of series) {
    if (!types.has("22") && !types.has("65")) continue; // a character's own table
    for (const type of ["560", "2"]) for (const [, v] of types.get(type) ?? []) {
      const k = v.toFixed(1);
      const set = byAtk.get(k) ?? new Set();
      set.add(table);
      byAtk.set(k, set);
    }
  }
  for (const h of perHitRows) {
    const a = String(h.attacker_entity).toLowerCase();
    if (out.has(a)) continue;
    const cands = byAtk.get((+h.atk).toFixed(1));
    if (cands?.size === 1) out.set(a, [...cands][0]);
  }
  return out;
}

/** Skill id -> Anomaly buildup (skill-buildup.json, written by sheet-webapp tools/export-skill-buildup.mjs
 *  from the client's AvatarSkillTemplateTb). Optional: without it there is no buildup factor. */
const SKILL_BUILDUP = (() => {
  try {
    return JSON.parse(fs.readFileSync(new URL("./skill-buildup.json", import.meta.url), "utf8")).buildup;
  } catch {
    return null;
  }
})();

/** A factor per row -> "% over 1" per row, with the consistency check: the target's side is the same
 *  for every hit landing at the same moment, so an ability whose factor sits off the same attacker's
 *  other hits within a second (median ratio beyond 3%, 3+ hits) follows a rule of its own -- Cissia's
 *  Corrode Bone curse reads a steady x2.317 for damage -- and is left blank rather than shown as a
 *  target-side effect. */
function consistentPct(factor) {
  const groupOf = (row) => `${String(row.attacker_entity).toLowerCase()}|${row.attack_property_name || row.ability_name || row.skill_id}`;
  const byAttacker = new Map();
  for (const [row, f] of factor) {
    const a = String(row.attacker_entity).toLowerCase();
    const list = byAttacker.get(a) ?? [];
    list.push({ t: +row.elapsed_ms, f, g: groupOf(row) });
    byAttacker.set(a, list);
  }
  const median = (xs) => { const v = [...xs].sort((x, y) => x - y); return v[Math.floor(v.length / 2)]; };
  const ratios = new Map();
  for (const [row, f] of factor) {
    const g = groupOf(row);
    const near = (byAttacker.get(String(row.attacker_entity).toLowerCase()) ?? []).filter((x) => x.g !== g && Math.abs(x.t - +row.elapsed_ms) <= 1000).map((x) => x.f);
    if (!near.length) continue;
    const list = ratios.get(g) ?? [];
    list.push(f / median(near));
    ratios.set(g, list);
  }
  const special = new Set([...ratios].filter(([, r]) => r.length >= 3 && Math.abs(median(r) - 1) > 0.03).map(([g]) => g));
  return (row) => {
    const f = factor.get(row);
    if (f === undefined || special.has(groupOf(row))) return "";
    const v = (f - 1) * 100;
    return Math.abs(v) < 0.2 ? "0" : v.toFixed(1);
  };
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
  const empty = { enemy_def: "", enemy_def_reduction_pct: "", enemy_res_pct: "", enemy_damage_taken_pct: "", enemy_buildup_taken_pct: "", enemy_debuffs: "", flat_pen: "", sheer_force: "", battle_am: "", battle_ap: "" };
  const ignorePct = (row) => { const v = resIgnore(row) * 100; return Math.abs(v) < 1e-9 ? "0" : v.toFixed(2); };
  const withDaze = (row, cols) => ({ ...cols, enemy_daze_taken_pct: dazeTakenPct(row), res_ignore_pct: ignorePct(row) });
  const state = readState(dir);
  if (!state) return (row) => withDaze(row, empty);
  const { props, mods: modRows, gets } = state;
  const attackers = new Set(perHitRows.map((r) => String(r.attacker_entity).toLowerCase()));
  const debuffs = debuffsOn(modRows, attackers);
  const debuffText = (row) => debuffs(String(row.target_entity).toLowerCase(), +row.elapsed_ms).join("; ");
  const client = clientOf(dir);
  const type = DEF_REDUCTION_TYPE[client];
  if (!type) return (row) => withDaze(row, { ...empty, enemy_debuffs: debuffText(row) });
  const none = () => ({ enemy_def: "", enemy_def_reduction_pct: "" });
  const hits = perHitRows
    .map((r) => ({ t: +r.elapsed_ms, target: String(r.target_entity).toLowerCase(), damage: +r.damage_ceil }))
    .filter((h) => Number.isFinite(h.t) && h.damage > 0);
  const tables = tableTargets(props, hits);
  // The target's DEF from its own hits (f11c is the attacker's DEF), in time order.
  const ownDef = new Map();
  for (const r of perHitRows) {
    if (!(+r.f11c > 0)) continue;
    const who = String(r.attacker_entity).toLowerCase();
    const list = ownDef.get(who) ?? [];
    list.push({ t: +r.elapsed_ms, def: +r.f11c });
    ownDef.set(who, list);
  }
  const ownDefAt = (target, t) => {
    const list = ownDef.get(target);
    if (!list?.length) return "";
    let pick = list[0];
    for (const x of list) {
      if (x.t > t) break;
      pick = x;
    }
    return pick.def.toFixed(2);
  };
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
    if (!s) return { enemy_def: ownDefAt(String(row.target_entity).toLowerCase(), +row.elapsed_ms), enemy_def_reduction_pct: "0" }; // never debuffed
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
  // All-Attribute RES: the running total is the write's second value; each must equal the previous plus the
  // change, else the table is not read right and its column stays empty.
  const resType = ALL_RES_TYPE[client];
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
  // The attacker's own stats (stat-read log), per table and type, in time order.
  const statSeries = new Map();
  for (const g of gets) {
    const types = statSeries.get(g.table) ?? new Map();
    const list = types.get(g.type) ?? [];
    list.push([g.t, g.value]);
    types.set(g.type, list);
    statSeries.set(g.table, types);
  }
  const statAt = (table, type, t) => {
    const list = statSeries.get(table)?.get(type);
    if (!list) return null;
    let v = list[0][1];
    for (const [at, x] of list) {
      if (at > t) break;
      v = x;
    }
    return v;
  };
  const ownTable = attackerTables(props, statSeries, perHitRows);
  // Without the stat-read log (captures before 2026-09-28): the loadout's flat PEN, by the avatar id
  // the attacker's skill ids start with.
  const fromLoadout = loadoutFlatPen(dir);
  const avatarOf = new Map();
  for (const r of perHitRows) {
    const id = /^(\d{4})\d{3}$/.exec(String(r.skill_id))?.[1];
    if (id) avatarOf.set(String(r.attacker_entity).toLowerCase(), +id);
  }
  const attackerStats = (row) => {
    const a = String(row.attacker_entity).toLowerCase();
    const table = ownTable.get(a);
    const t = +row.elapsed_ms;
    const pen = table ? (statAt(table, "568", t) ?? statAt(table, "22", t)) : null;
    const sheer = table ? statAt(table, "65", t) : null;
    // `measured`: the stats came from the game's own reads, not the loadout -- the damage factor
    // needs that (a loadout knows no PEN from buffs).
    // In-battle Anomaly Mastery / Proficiency (579 / 577): the result's own fields are the BASE values
    // on direct hits (docs/property-types.md).
    const am = table ? statAt(table, "579", t) : null;
    const ap = table ? statAt(table, "577", t) : null;
    return { flatPen: pen ?? (statSeries.size === 0 ? fromLoadout.get(avatarOf.get(a)) ?? null : null), sheer: sheer ?? null, measured: pen !== null || sheer !== null, am, ap };
  };
  const factorOf = (row, def, reductionPct, stats) => {
    if (!stats.measured || row.skill_id === "anomaly" || !(+row.dmg_mv > 0) || !(+row.damage_unrounded > 0) || !(+row.dmg_mult > 0)) return "";
    const m = mods(row);
    const crit = +row.crit ? 1 + +(m.Actor_CriticalDamageRatioDelta || 0) : 1;
    const distance = row.attenuation === "" || row.attenuation === undefined ? 1 : +row.attenuation;
    const ignore = 1 + resIgnore(row);
    let expected;
    if (stats.sheer > 0) {
      expected = +row.dmg_mv * stats.sheer * +row.dmg_mult * (1 + +(m.Actor_AddedSkipDefDamageRatio || 0)) * crit * distance * ignore;
    } else {
      if (stats.flatPen === null || def === "" || +row.level !== 60) return null;
      const reduction = (+reductionPct || 0) / 100;
      const base = +def / (1 - reduction);
      const defIgnore = -(+(m.Actor_DefenceRatio || 0));
      const effective = Math.max(base * (1 - reduction - defIgnore) * (1 - (+row.f174 || 0)) - stats.flatPen, 0);
      expected = +row.dmg_mv * +row.atk * +row.dmg_mult * crit * (LEVEL_FACTOR / (LEVEL_FACTOR + effective)) * distance * ignore;
    }
    return expected > 0 ? +row.damage_unrounded / expected : null;
  };
  // Every row once, then the consistency check: the target's side is the same for every hit landing
  // at the same moment, so an ability whose factor sits off the same attacker's other hits within a
  // second (median ratio beyond 3%, 3+ hits) follows a rule of its own -- Cissia's Corrode Bone
  // curse reads a steady x2.317 -- and is left blank rather than shown as a target-side effect.
  // Buildup: requested = skill buildup x hit split x in-battle AM / 100 x (1 + buildup bonus) / 100
  // (skill-buildup.json, from the client skill table); what is left is the target's buildup RES side.
  const buildupOf = (row, stats) => {
    const base = SKILL_BUILDUP?.[row.skill_id];
    if (!base || !(stats.am > 0) || !(+row.buildup_requested > 0) || !(+row.hit_split > 0)) return null;
    const bonus = Object.entries(mods(row)).filter(([k]) => /^Actor_AddedElementAccumulationRatio/.test(k)).reduce((sum, [, v]) => sum + +v, 0);
    return +row.buildup_requested / ((base * +row.hit_split * (stats.am / 100) * (1 + bonus)) / 100);
  };
  const cols = new Map();
  const factor = new Map();
  const buildupFactor = new Map();
  for (const row of perHitRows) {
    const def = defAt(row);
    const stats = attackerStats(row);
    cols.set(row, { def, stats });
    const f = factorOf(row, def.enemy_def, def.enemy_def_reduction_pct, stats);
    if (f !== null && f !== "") factor.set(row, f);
    const b = buildupOf(row, stats);
    if (b !== null) buildupFactor.set(row, b);
  }
  const damagePct = consistentPct(factor);
  const buildupPct = consistentPct(buildupFactor);
  return (row) => {
    const { def, stats } = cols.get(row) ?? { def: defAt(row), stats: attackerStats(row) };
    return withDaze(row, {
      ...def,
      enemy_res_pct: resAt(row),
      enemy_damage_taken_pct: damagePct(row),
      enemy_buildup_taken_pct: buildupPct(row),
      battle_am: stats.am === null ? "" : String(+stats.am.toFixed(2)),
      battle_ap: stats.ap === null ? "" : String(+stats.ap.toFixed(2)),
      enemy_debuffs: debuffText(row),
      flat_pen: stats.flatPen === null ? "" : String(stats.flatPen),
      sheer_force: stats.sheer === null ? "" : String(stats.sheer),
    });
  };
}
