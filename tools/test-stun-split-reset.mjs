// node tools/test-stun-split-reset.mjs — a Stun Reset whose detach and re-attach straddle a tick.
// SYNTHETIC fixture: entity pointers and orders are made up. The shape is the one a 2026-10-01
// capture showed: the StunBuffModifier detached at 224344 ms and re-attached at 224359 ms as
// adjacent rows (orders 280941 / 280942), because elapsed_ms (GetTickCount64) moved a step between
// them. That is a Reset, not an End and a new Start: the window stays open, and a hit stamped in the
// gap is in Stun. A re-attach a second after a real End is still a new Stun.
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
const perHit = (hitRows, withOrder) => [cols.join(","), ...hitRows.map(([seq, ms, order]) => cols.map((c) => ({
  seq, elapsed_ms: ms, thread: "1", attacker_entity: A, target_entity: E, ability_name: "Test_Attack", attack_property_name: "Test_Attack_AttackProperty_01",
  skill_id: "", skill_id_source: "unmapped", hit_split: 1, damage_unrounded: 100, damage_ceil: 100, crit: 0, dmg_mv: 1, daze_mv: 1, daze: 0, level: 60, target_state: "",
  modifiers: "", order: withOrder ? order : "", hit_order: withOrder ? order : "",
})[c] ?? "").join(","))].join("\n") + "\n";
const stateHead = "elapsed_ms\tkind\tself\ta\tb\tc\td\ti0\ti1\tf0\tf1\tname\tcaller\torder";
const state = (stunRows, withOrder) => [stateHead, ...stunRows.map(([t, kind, self, order]) =>
  [t, kind, self, E, kind === "mod+" ? "0xc0" : "", "", "", "", "", "", "", "StunBuffModifier", "0x0", withOrder ? order : ""].join("\t"))].join("\n") + "\n";

function run(stunRows, hitRows, withOrder) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "stun-split-"));
  try {
    fs.writeFileSync(path.join(dir, "per-hit-log.csv"), perHit(hitRows, withOrder));
    fs.writeFileSync(path.join(dir, "state.tsv"), state(stunRows, withOrder));
    execFileSync(process.execPath, [path.join(here, "readable-log.mjs"), dir], { stdio: "pipe" });
    return parseCsv(fs.readFileSync(path.join(dir, "combat-log-readable.csv"), "utf8")).map((r) => r.during_stun);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// [ms, kind, instance, order]
const split = [
  [1000, "mod+", "0x51", 10], [1000, "modA", "0x51", 11], // Start
  [2000, "modD", "0x51", 25], [2016, "modA", "0x51", 26], // the Reset, across a tick, adjacent rows
  [5000, "modD", "0x51", 60], // End
];
// [seq, ms, order]
const hits = [
  [1, 1500, 15], // in Stun
  [2, 2000, 24], // the Reset's own hit, before the detach
  [3, 2000, 27], // without order: stamped in the gap's first tick. With order: after the re-attach
  [4, 3000, 40], // in Stun after the Reset
  [5, 6000, 70], // after the End
];

// Without order (captures before 2026-09-29) the millisecond rule decides. Before this fix hits 2
// and 3 read "No": the window ended at 2000 and the next began at 2016.
assert.deepEqual(run(split, hits, false), ["Yes", "Yes", "Yes", "Yes", "No"]);
// With order the gap held no hit already; merging the windows keeps that.
assert.deepEqual(run(split, hits, true), ["Yes", "Yes", "Yes", "Yes", "No"]);

// Negative control: a real End, then a new Start a second later, stays two windows. A hit between
// them is not in Stun.
const twoStuns = [
  [1000, "modA", "0x51", 10],
  [2000, "modD", "0x51", 25],
  [3000, "modA", "0x52", 45],
  [5000, "modD", "0x52", 60],
];
const between = [[1, 1500, 15], [2, 2500, 30], [3, 4000, 50]];
assert.deepEqual(run(twoStuns, between, false), ["Yes", "No", "Yes"]);
assert.deepEqual(run(twoStuns, between, true), ["Yes", "No", "Yes"]);

console.log("PASS stun split reset: a detach and re-attach across a tick is one Stun, with or without order; an End a second before the next Start is not");
