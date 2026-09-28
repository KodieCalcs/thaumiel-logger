// Human-readable combat log from per-hit-log.csv. node readable-log.mjs <archive-dir>
//   writes <archive-dir>/combat-log-readable.csv
// Only labelled fields are included; the unlabelled raw offsets stay in per-hit-log.csv.
import fs from "node:fs";
import path from "node:path";
import { parseCsv } from "./log-csv.mjs";
import { codename, displayName, stripCodename } from "./codename-labels.mjs";
const dir = process.argv[2];
if (!dir) { console.error("usage: node readable-log.mjs <archive-dir>"); process.exit(2); }
const rows = parseCsv(fs.readFileSync(path.join(dir, "per-hit-log.csv"), "utf8"));
const entityName = new Map();
for (const r of rows) {
  // Prefer the property: enemy ability names sometimes omit the Monster_ namespace.
  for (const value of [r.attack_property_name, r.ability_name, r.a8_str18]) {
    const code = codename(value);
    if (code && code !== "Player" && !entityName.has(r.attacker_entity)) entityName.set(r.attacker_entity, displayName(code));
  }
}
const nameOf = (e) => entityName.get(e) || e || "";
const targets = new Map(); for (const r of rows) targets.set(r.target_entity, (targets.get(r.target_entity) || 0) + 1);
const mainTarget = [...targets].sort((a, b) => b[1] - a[1])[0]?.[0];
const targetOf = (e) => (entityName.has(e) ? nameOf(e) : e === mainTarget ? "enemy (main)" : "enemy " + e.slice(-5));

// Readable ability from the AttackProperty name: drop the codename, "AttackProperty", keep the rest.
const readable = (r) => {
  if (r.ability_name === "Player_ElementAbnormalBuff") return "Anomaly proc";
  const s = stripCodename(r.attack_property_name || r.ability_name || "").replace(/_?Attack[pP]roperty_?/, " #").replace(/_/g, " ").trim();
  return s;
};
const t0 = rows.reduce((min, r) => Math.min(min, +r.elapsed_ms), Infinity);
const pct = (v) => (v === "" ? "" : (+v * 100).toFixed(2));
const mods = (r) => Object.fromEntries((r.modifiers || "").split(";").filter(Boolean).map((m) => m.split("=")));
const cols = ["time_s", "attacker", "target", "skill_id", "ability", "hit_split", "damage", "crit", "during_stun",
  "damage_mv_pct", "daze_mv_pct", "energy", "decibels", "atk", "impact", "anomaly_mastery", "anomaly_proficiency",
  "dmg_bonus_pct", "crit_rate_pct", "crit_dmg_pct", "other_modifiers"];
const out = [cols.join(",")];
for (const r of rows) {
  const m = mods(r); const att = nameOf(r.attacker_entity);
  const other = Object.entries(m).filter(([k]) => !/^Actor_(CriticalDelta|CriticalDamageRatioDelta|AddedDamageRatio(_\w+)?)$/.test(k)).filter(([, v]) => +v !== 0)
    .map(([k, v]) => k.replace(/^Actor_/, "") + "=" + v).join("; ");
  const o = {
    time_s: ((+r.elapsed_ms - t0) / 1000).toFixed(3), attacker: att, target: targetOf(r.target_entity), skill_id: r.skill_id,
    ability: readable(r), hit_split: r.hit_split, damage: r.damage_ceil, crit: +r.crit ? "Yes" : "No", during_stun: r.target_state === "3" ? "Yes" : "No",
    damage_mv_pct: pct(r.dmg_mv), daze_mv_pct: pct(r.daze_mv), energy: r.energy, decibels: r.decibels,
    atk: r.atk, impact: r.impact, anomaly_mastery: r.anomaly_mastery, anomaly_proficiency: r.anomaly_proficiency,
    dmg_bonus_pct: r.dmg_mult === "" ? "" : ((+r.dmg_mult - 1) * 100).toFixed(2),
    crit_rate_pct: m.Actor_CriticalDelta ? pct(m.Actor_CriticalDelta) : "", crit_dmg_pct: m.Actor_CriticalDamageRatioDelta ? pct(m.Actor_CriticalDamageRatioDelta) : "",
    other_modifiers: other,
  };
  out.push(cols.map((c) => { const v = String(o[c] ?? ""); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; }).join(","));
}
fs.writeFileSync(path.join(dir, "combat-log-readable.csv"), out.join("\n") + "\n");
console.log(rows.length, "rows ->", path.join(dir, "combat-log-readable.csv"), "attackers:", [...entityName.values()].join(", "));
