// Check a battle folder's state.tsv (statelog.zig) and summarise what it adds over the per-hit
// log: buff lifetimes, the property table's own numbers (Energy, Decibels, CurStun), and the
// Stun window measured from the meter itself rather than inferred from the hits that landed
// inside it.
//
//   node tools/state-check.mjs <battle folder> [--buff <substring>] [--prop <type id>] [--rows]
//
// Prints, in order:
//   1. row counts by kind, and the file's wall span
//   2. Stun windows, derived from the CurStun property series (no hook of its own is needed):
//      start = the write the game clamps at MaxStun, end = the write reaching 0, and a re-fill
//      to the cap in between is a Reset. Printed next to the hit-log window (first..last hit
//      whose pre-hit target_state was 3) when a per-hit-log.csv is in the folder
//   3. buffs: per modifier name, how many times it went on and off, its stacking mode and the
//      MEASURED on-time (attach -> detach). The config's own duration field is not identified
//      -- the float pinned as `c_duration` reads 0 on every modifier -- so it is not printed;
//      the measured time is the ground truth anyway. --buff narrows to one name
//   4. property writes: per type id, the count and the value range, plus the series for one id
//      with --prop (this is how an Energy or Decibel gauge is identified -- the id whose value
//      rises by the per-hit `energy` grants and drops ~40 at each EX)
// Nothing here is tuned or fitted; every number is a column of the log.

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const args = process.argv.slice(2);
const dir = args.find((a) => !a.startsWith("--"));
if (!dir) {
  console.error("usage: node tools/state-check.mjs <battle folder> [--buff <substring>] [--prop <type id>] [--rows]");
  process.exit(2);
}
const arg = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : null;
};
const buffFilter = arg("--buff");
const propFilter = arg("--prop");
const showRows = args.includes("--rows");

function tsv(file) {
  const lines = readFileSync(file, "utf8").split(/\r?\n/).filter((l) => l.length && !l.startsWith("#"));
  const cols = lines[0].split("\t");
  return lines.slice(1).map((l) => Object.fromEntries(l.split("\t").map((v, i) => [cols[i], v])));
}

const stateFile = join(dir, "state.tsv");
if (!existsSync(stateFile)) {
  console.error(`no state.tsv in ${dir} (a capture from before the state log, or the hooks refused -- check hitlog-startup.log)`);
  process.exit(1);
}
const rows = tsv(stateFile);
const t = (r) => Number(r.elapsed_ms);
const s_ = (ms) => (ms / 1000).toFixed(2).padStart(7) + "s";

// 1. what is in the file ------------------------------------------------------------
const byKind = new Map();
for (const r of rows) byKind.set(r.kind, (byKind.get(r.kind) ?? 0) + 1);
console.log(`state.tsv: ${rows.length} rows, ${s_(t(rows[0]))} .. ${s_(t(rows[rows.length - 1]))}`);
console.log("  " + [...byKind].map(([k, n]) => `${k} ${n}`).join("   "));

// 2. Stun windows, derived from CurStun (property type 11) -------------------------
// The Stun needs no hook of its own: CurStun is a property, so the `prop` rows carry it.
// A Stun starts on the write the game CLAMPS at MaxStun (requested > applied at the cap),
// runs while the meter drains, and ends when it reaches 0. A re-fill to the cap during the
// drain is a Reset. Verified on capture 20260922-142706: clamp at 61.875 s against the hit
// log's first stunned hit at 61.9 s.
console.log("\nStun (derived from CurStun, property type 11):");
const CURSTUN = "11";
const curStun = rows.filter((r) => r.kind === "prop" && r.i0 === CURSTUN)
  .map((r) => ({ t: t(r), req: Number(r.f0), val: Number(r.f1), self: r.self }));
const maxStun = curStun.reduce((m, r) => Math.max(m, r.val), 0);
if (!curStun.length) {
  console.log("  no CurStun writes in this battle");
} else {
  console.log(`  ${curStun.length} CurStun writes, MaxStun seen ${maxStun.toFixed(2)}`);
  const atCap = (v) => maxStun > 0 && v >= maxStun - 0.01;
  const stunWindows = [];
  let open = null;
  for (const r of curStun) {
    if (atCap(r.val)) {
      if (!open) open = { from: r.t, self: r.self, resets: [], max: r.val, min: r.val };
      else open.resets.push(r.t);
    } else if (open) {
      open.min = Math.min(open.min, r.val);
      if (r.val <= 0.01) {
        open.to = r.t;
        stunWindows.push(open);
        open = null;
      }
    }
  }
  if (open) stunWindows.push({ ...open, to: null });
  if (!stunWindows.length) console.log("  the meter never reached MaxStun -- no Stun in this battle");
  for (const [i, win] of stunWindows.entries()) {
    const len = win.to === null ? null : (win.to - win.from) / 1000;
    console.log(
      `  ${i + 1}. ${s_(win.from)} -> ${win.to === null ? "   (open)" : s_(win.to)}` +
        (len === null ? "" : `  ${len.toFixed(2)} s`) +
        (win.resets.length ? `, ${win.resets.length} refill${win.resets.length > 1 ? "s" : ""} at the cap (${win.resets.map((x) => s_(x).trim()).join(", ")}) = Resets` : ", no Reset"),
    );
  }
}

// The Daze no-decay grace, which is what the GILABPBBMJH hooks actually observe.
// Captures from 20260922-142706 and -143835 label these stun+/~/-; the rows are the same
// thing (the Daze no-decay grace), renamed after that capture disproved the Stun reading.
const grace = rows.filter((r) => r.kind.startsWith("grace") || r.kind.startsWith("stun"));
if (grace.length) {
  console.log(`  Daze no-decay grace (separate from the Stun): ${grace.length} transition rows`);
  for (const r of grace.slice(0, 12)) console.log(`    ${s_(t(r))} ${r.kind}  remaining ${r.f1 || r.f0 || ""}`);
}

// 3. buffs --------------------------------------------------------------------------
console.log("\nBuffs (modifier instances):");
const mods = new Map(); // name -> { on, off, stacking, duration, instances: Map(self -> t) , total }
const liveMod = new Map(); // self -> { name, from }
for (const r of rows) {
  if (r.kind === "mod+") {
    const m = mods.get(r.name) ?? { on: 0, off: 0, stacking: r.i0, duration: Number(r.f0), total: 0, owners: new Set() };
    m.stacking = r.i0;
    m.duration = Number(r.f0);
    mods.set(r.name, m);
    m.owners.add(r.a);
  } else if (r.kind === "modA") {
    const m = mods.get(r.name) ?? { on: 0, off: 0, stacking: "", duration: NaN, total: 0, owners: new Set() };
    m.on += 1;
    mods.set(r.name, m);
    liveMod.set(r.self, { name: r.name, from: t(r) });
  } else if (r.kind === "modD") {
    const m = mods.get(r.name) ?? { on: 0, off: 0, stacking: "", duration: NaN, total: 0, owners: new Set() };
    m.off += 1;
    const live = liveMod.get(r.self);
    if (live) {
      m.total += t(r) - live.from;
      liveMod.delete(r.self);
    }
    mods.set(r.name, m);
  }
}
const modList = [...mods].filter(([name]) => !buffFilter || name.toLowerCase().includes(buffFilter.toLowerCase()));
modList.sort((a, b) => b[1].on - a[1].on);
console.log(`  ${modList.length} distinct modifier${modList.length === 1 ? "" : "s"}${buffFilter ? ` matching "${buffFilter}"` : ""}`);
for (const [name, m] of modList.slice(0, buffFilter ? 200 : 40)) {
  const avg = m.off ? (m.total / m.off / 1000).toFixed(2) : "-";
  console.log(
    `  ${name.padEnd(44)} on ${String(m.on).padStart(4)}  off ${String(m.off).padStart(4)}` +
      `  avg on-time ${avg.padStart(6)} s  stacking ${m.stacking}  owners ${m.owners.size}`,
  );
}
if (!buffFilter && modList.length > 40) console.log(`  ... ${modList.length - 40} more (use --buff to narrow)`);
if (liveMod.size) console.log(`  ${liveMod.size} still attached when the battle ended`);

// 4. property writes ----------------------------------------------------------------
console.log("\nProperty writes (EPropertyType id -> what was written):");
const props = new Map();
for (const r of rows) {
  if (r.kind !== "prop") continue;
  const id = r.i0;
  const p = props.get(id) ?? { n: 0, min: Infinity, max: -Infinity, keys: new Set() };
  const v = Number(r.f1); // the value the call returned
  p.n += 1;
  if (Number.isFinite(v)) {
    p.min = Math.min(p.min, v);
    p.max = Math.max(p.max, v);
  }
  if (r.name) p.keys.add(r.name);
  props.set(id, p);
}
const propList = [...props].sort((a, b) => b[1].n - a[1].n);
for (const [id, p] of propList.slice(0, 30)) {
  console.log(
    `  type ${String(id).padStart(4)}  ${String(p.n).padStart(5)} writes  ` +
      `${p.min === Infinity ? "" : `${p.min.toFixed(2)} .. ${p.max.toFixed(2)}`}` +
      (p.keys.size ? `  keys: ${[...p.keys].slice(0, 3).join(", ")}${p.keys.size > 3 ? ` +${p.keys.size - 3}` : ""}` : ""),
  );
}
if (propList.length > 30) console.log(`  ... ${propList.length - 30} more type ids`);

if (propFilter !== null) {
  console.log(`\nSeries for property type ${propFilter} (elapsed, in -> out, key, caller):`);
  for (const r of rows) {
    if (r.kind !== "prop" || r.i0 !== String(propFilter)) continue;
    console.log(`  ${s_(t(r))}  ${Number(r.f0).toFixed(3).padStart(10)} -> ${Number(r.f1).toFixed(3).padStart(10)}  ${r.name || ""}  ${r.caller}`);
  }
}

if (showRows) {
  console.log("\nAll rows:");
  for (const r of rows) console.log(`  ${s_(t(r))} ${r.kind.padEnd(6)} ${r.self} ${r.name || ""}`);
}
