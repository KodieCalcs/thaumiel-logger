// node tools/test-stun-order.mjs — during_stun and enemy_debuffs at a Stun's edges, by the shared row
// order (per-hit-log.mjs hit_order / order, state.tsv order) and, without it, by millisecond.
// SYNTHETIC fixture: entity pointers, orders and the debuff name are made up. The shape is the one
// capture 3797 showed: the hit whose Daze fills the gauge shares the Stun's millisecond, its Daze
// be-hit row comes before the StunBuffModifier attach and its converter row after; it took no Stun
// multiplier, the next hit in the same millisecond did. A hit in the Stun's last millisecond that
// the game computed before the detach took the multiplier too.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { parseCsv } from "./log-csv.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const cols = ["seq", "elapsed_ms", "thread", "attacker_entity", "target_entity", "ability_name", "attack_property_name", "skill_id", "skill_id_source",
  "hit_split", "damage_unrounded", "damage_ceil", "crit", "dmg_mv", "daze_mv", "energy", "decibels", "daze", "daze_requested", "buildup_requested", "buildup_applied",
  "atk", "impact", "anomaly_mastery", "anomaly_proficiency", "level", "target_state", "dmg_mult", "attenuation_curve", "attenuation", "modifiers", "order", "hit_order"];
const A = "0xa1", E = "0xe1";
// [seq, ms, daze, hit_order, order]
const hitRows = [
  [1, 1000, 50, 8, 10], //  fills the gauge: before the Stun
  [2, 1000, 0, 13, 14], //  same millisecond, after the attach: in Stun
  [3, 2000, 0, 20, 21], //  the Stun's last millisecond, before the detach: in Stun
  [4, 2000, 0, 26, 27], //  after the detach: not
];
const perHit = (withOrder) => [cols.join(","), ...hitRows.map(([seq, ms, daze, hitOrder, order]) => cols.map((c) => ({
  seq, elapsed_ms: ms, thread: "1", attacker_entity: A, target_entity: E, ability_name: "Test_Attack", attack_property_name: "Test_Attack_AttackProperty_01",
  skill_id: "", skill_id_source: "unmapped", hit_split: 1, damage_unrounded: 100, damage_ceil: 100, crit: 0, dmg_mv: 1, daze_mv: 1, daze, level: 60, target_state: "",
  modifiers: "", order: withOrder ? order : "", hit_order: withOrder ? hitOrder : "",
})[c] ?? "").join(","))].join("\n") + "\n";
const stateHead = "elapsed_ms\tkind\tself\ta\tb\tc\td\ti0\ti1\tf0\tf1\tname\tcaller\torder";
const state = (withOrder) => [stateHead, ...[
  [1000, "mod+", "0x51", E, "0xc0", 9, "StunBuffModifier"],
  [1000, "modA", "0x51", E, "", 11, "StunBuffModifier"],
  [1000, "mod+", "0x52", E, A, 12, "Test_Debuff"], // the gauge-filling hit's own landing applies it
  [1000, "modA", "0x52", E, "", 12.5, "Test_Debuff"],
  [2000, "modD", "0x51", E, "", 25, "StunBuffModifier"],
].map(([t, kind, self, a, b, order, name]) => [t, kind, self, a, b, "", "", "", "", "", "", name, "0x0", withOrder ? order : ""].join("\t"))].join("\n") + "\n";

function run(withOrder) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "stun-order-"));
  try {
    fs.writeFileSync(path.join(dir, "per-hit-log.csv"), perHit(withOrder));
    fs.writeFileSync(path.join(dir, "state.tsv"), state(withOrder));
    execFileSync(process.execPath, [path.join(here, "readable-log.mjs"), dir], { stdio: "pipe" });
    return parseCsv(fs.readFileSync(path.join(dir, "combat-log-readable.csv"), "utf8"));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// With the order: the gauge-filling hit is out of Stun, both hits the game computed while Stunned
// are in, and the debuff the first hit applied is not on that hit.
const ordered = run(true);
assert.deepEqual(ordered.map((r) => r.during_stun), ["No", "Yes", "Yes", "No"]);
assert.deepEqual(ordered.map((r) => r.enemy_debuffs), ["", "Test_Debuff", "Test_Debuff", "Test_Debuff"]);
// Daze in Stun is 0: only the hit that started the Stun carried Daze.
assert.equal(ordered.filter((r) => r.during_stun === "Yes").reduce((s, r) => s + +r.daze, 0), 0);

// Without it (captures before 2026-09-29) the millisecond rule is unchanged, including its two edge
// errors this order exists to fix: the gauge-filling hit reads in Stun, the last-millisecond one out.
const legacy = run(false);
assert.deepEqual(legacy.map((r) => r.during_stun), ["Yes", "Yes", "No", "No"]);
assert.deepEqual(legacy.map((r) => r.enemy_debuffs), ["Test_Debuff", "Test_Debuff", "Test_Debuff", "Test_Debuff"]);

console.log("PASS stun order: edges by row order (gauge-filling hit out, last-ms hit in, own debuff not on its hit); millisecond rule unchanged without it");
