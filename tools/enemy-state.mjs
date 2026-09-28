// Enemy-side stats at each hit, from state.tsv (src/statelog.zig's property writes): what debuffs on
// the target did to it, which the hit's own record (the attacker's side) cannot show. Nicole's DEF
// reduction, for one, is a debuff on the enemy, so a hit's DefenceRatio modifier leaves it out.
//
//   import { enemyStats } from "./enemy-state.mjs";
//   const at = enemyStats(dir, perHitRows);   // rows of per-hit-log.csv
//   at(row) -> { enemy_def, enemy_def_reduction_pct }   ("" when not known)
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
import fs from "node:fs";
import path from "node:path";

const DEF_REDUCTION_TYPE = { "CNBetaWin3.3.4": "562" };
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

function readProps(dir) {
  let text;
  try {
    text = fs.readFileSync(path.join(dir, "state.tsv"), "utf8");
  } catch {
    return null;
  }
  const lines = text.split(/\r?\n/).filter((l) => l && !l.startsWith("#"));
  const head = (lines[0] ?? "").split("\t");
  const [T, KIND, SELF, TYPE, F0, F1] = ["elapsed_ms", "kind", "self", "i0", "f0", "f1"].map((n) => head.indexOf(n));
  const out = [];
  for (const l of lines.slice(1)) {
    const c = l.split("\t");
    if (c[KIND] === "prop") out.push({ t: +c[T], table: c[SELF], type: c[TYPE], change: +c[F0], after: +c[F1] });
  }
  return out;
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

export function enemyStats(dir, perHitRows) {
  const none = () => ({ enemy_def: "", enemy_def_reduction_pct: "" });
  const type = DEF_REDUCTION_TYPE[clientOf(dir)];
  const props = type ? readProps(dir) : null;
  if (!props) return none;
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
  // DEF before the first write: the first write's DEF with its reduction undone.
  const baseDef = new Map([...series].map(([table, s]) => [table, s[0].def / (1 - s[0].reduction)]));
  const pct = (v) => (Math.abs(v) < 1e-9 ? "0" : (v * 100).toFixed(2));
  return (row) => {
    const table = tables.get(String(row.target_entity).toLowerCase());
    if (!table) return none();
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
}
