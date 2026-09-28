// Human-readable combat log from per-hit-log.csv. node readable-log.mjs <archive-dir>
//   writes <archive-dir>/combat-log-readable.csv
// Only labelled fields are included; the unlabelled raw offsets stay in per-hit-log.csv.
// `ability` is the in-game action from skill-display-names.json when this install has it (the
// client's internal name stays in `client_name`); `daze` is the Daze the target's Stun gauge took
// from the hit (per-hit-log.mjs `daze`, clamped at the gauge's maximum); a summon's zero-damage copy
// of its Agent's hit is left out (display-names.mjs). `during_stun` is the result's own stunned flag
// where the client has one, else the Stun windows in state.tsv (see stunWindows).
import fs from "node:fs";
import path from "node:path";
import { parseCsv } from "./log-csv.mjs";
import { codename, displayName, stripCodename } from "./codename-labels.mjs";
import { loadDisplayNames, entityNames, actionName, dropSummonCopies } from "./display-names.mjs";
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
// A Reset (detach + attach on one frame) keeps it open. Per recipient pointer, which is not the
// hit's target handle, so the windows are used only when exactly one enemy was Stunned (read as the
// main target); otherwise, or without state.tsv, during_stun is left empty.
function stunWindows() {
  let text;
  try {
    text = fs.readFileSync(path.join(dir, "state.tsv"), "utf8");
  } catch {
    return null;
  }
  const lines = text.split(/\r?\n/).filter((l) => l && !l.startsWith("#"));
  const head = (lines[0] ?? "").split("\t");
  const [T, KIND, SELF, A, NAME] = ["elapsed_ms", "kind", "self", "a", "name"].map((n) => head.indexOf(n));
  const live = new Map(); // enemy -> live instances
  const windows = new Map(); // enemy -> [[start, end]]
  for (const l of lines.slice(1)) {
    const c = l.split("\t");
    if (c[NAME] !== "StunBuffModifier") continue;
    const enemy = c[A];
    const set = live.get(enemy) ?? new Set();
    const list = windows.get(enemy) ?? [];
    live.set(enemy, set);
    windows.set(enemy, list);
    if (c[KIND] === "mod+" || c[KIND] === "modA") {
      if (set.size === 0) list.push([+c[T], Infinity]);
      set.add(c[SELF]);
    } else if (c[KIND] === "modD" && set.delete(c[SELF]) && set.size === 0 && list.length) list[list.length - 1][1] = +c[T];
  }
  return windows;
}
const stunned = [...(stunWindows() ?? new Map()).values()].filter((w) => w.length);
const mainStun = stunned.length === 1 ? stunned[0] : null;
const duringStun = (r) => {
  if (r.target_state !== "" && r.target_state !== undefined) return r.target_state === "3" ? "Yes" : "No";
  if (!mainStun) return stunned.length === 0 && stunWindows() ? "No" : "";
  if (r.target_entity !== mainTarget) return "No";
  const t = +r.elapsed_ms;
  return mainStun.some(([start, end]) => t >= start && t < end) ? "Yes" : "No";
};
const targetOf = (e) => (entityName.has(e) ? nameOf(e) : e === mainTarget ? "enemy (main)" : "enemy " + e.slice(-5));

// Readable ability from the AttackProperty name: drop the codename, "AttackProperty", keep the rest.
const readable = (r) => {
  // per-hit-log's attribution: by name, or a nameless row at a base Anomaly multiplier (Corruption).
  if (r.skill_id === "anomaly") return "Anomaly proc";
  const s = stripCodename(r.attack_property_name || r.ability_name || "").replace(/_?Attack[pP]roperty_?/, " #").replace(/_/g, " ").trim();
  return s;
};
const t0 = rows.reduce((min, r) => Math.min(min, +r.elapsed_ms), Infinity);
const pct = (v) => (v === "" ? "" : (+v * 100).toFixed(2));
const mods = (r) => Object.fromEntries((r.modifiers || "").split(";").filter(Boolean).map((m) => m.split("=")));
const cols = ["time_s", "attacker", "target", "skill_id", "ability", "client_name", "hit_split", "damage", "daze", "crit", "during_stun",
  "damage_mv_pct", "daze_mv_pct", "energy", "decibels", "atk", "impact", "anomaly_mastery", "anomaly_proficiency",
  "dmg_bonus_pct", "crit_rate_pct", "crit_dmg_pct", "other_modifiers"];
const out = [cols.join(",")];
for (const r of rows) {
  const m = mods(r); const att = nameOf(r.attacker_entity);
  const other = Object.entries(m).filter(([k]) => !/^Actor_(CriticalDelta|CriticalDamageRatioDelta|AddedDamageRatio(_\w+)?)$/.test(k)).filter(([, v]) => +v !== 0)
    .map(([k, v]) => k.replace(/^Actor_/, "") + "=" + v).join("; ");
  const o = {
    time_s: ((+r.elapsed_ms - t0) / 1000).toFixed(3), attacker: att, target: targetOf(r.target_entity), skill_id: r.skill_id,
    ability: actionName(r, att, names) ?? readable(r), client_name: readable(r), hit_split: r.hit_split, damage: r.damage_ceil, daze: r.daze === "" ? "" : (+r.daze).toFixed(2), crit: +r.crit ? "Yes" : "No", during_stun: duringStun(r),
    damage_mv_pct: pct(r.dmg_mv), daze_mv_pct: pct(r.daze_mv), energy: r.energy, decibels: r.decibels,
    atk: r.atk, impact: r.impact, anomaly_mastery: r.anomaly_mastery, anomaly_proficiency: r.anomaly_proficiency,
    dmg_bonus_pct: r.dmg_mult === "" ? "" : ((+r.dmg_mult - 1) * 100).toFixed(2),
    crit_rate_pct: m.Actor_CriticalDelta ? pct(m.Actor_CriticalDelta) : "", crit_dmg_pct: m.Actor_CriticalDamageRatioDelta ? pct(m.Actor_CriticalDamageRatioDelta) : "",
    other_modifiers: other,
  };
  out.push(cols.map((c) => { const v = String(o[c] ?? ""); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; }).join(","));
}
fs.writeFileSync(path.join(dir, "combat-log-readable.csv"), out.join("\n") + "\n");
console.log(rows.length, "rows ->", path.join(dir, "combat-log-readable.csv"), `(${logged.length - rows.length} summon copies left out; names ${names ? "from skill-display-names.json" : "from the client"})`, "attackers:", [...new Set(entityName.values())].join(", "));
