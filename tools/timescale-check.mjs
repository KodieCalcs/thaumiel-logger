// Check a battle folder's timescale.tsv (timescalelog.zig) against its hits.tsv and, when
// sheet-webapp's name-capture-states.mjs has been run on the folder, its state-names.csv.
//
//   node tools/timescale-check.mjs <battle folder> [--settlement <seconds>]
//
// Prints: every row; the distinct scales with their wall time; per Ultimate (an owner's
// *_SwitchIn_Attack_Ex_Start -> *_SwitchIn_Attack_Ex) the scale rows inside and the hits inside;
// per Chain entry (*_SwitchIn_Attack) the scale rows in the 3 s before it; and the game time
// between the first and last hit two ways -- the integral of scale*dt over the rows, and the
// game's own world_s column -- next to the settlement's seconds if given. Nothing is tuned here.

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const args = process.argv.slice(2);
const dir = args.find((a) => !a.startsWith("--"));
if (!dir) {
  console.error("usage: node tools/timescale-check.mjs <battle folder> [--settlement <seconds>]");
  process.exit(2);
}
const si = args.indexOf("--settlement");
const settlement = si >= 0 ? Number(args[si + 1]) : null;

function tsv(file) {
  const lines = readFileSync(file, "utf8").split(/\r?\n/).filter((l) => l.length);
  const cols = lines[0].split("\t");
  return lines.slice(1).map((l) => Object.fromEntries(l.split("\t").map((v, i) => [cols[i], v])));
}
function csv(file) {
  const lines = readFileSync(file, "utf8").split(/\r?\n/).filter((l) => l.length);
  const cols = lines[0].split(",");
  return lines.slice(1).map((l) => {
    const out = {};
    let i = 0, field = "", q = false;
    const vals = [];
    for (const ch of l) {
      if (q) { if (ch === '"') q = false; else field += ch; }
      else if (ch === '"') q = true;
      else if (ch === ",") { vals.push(field); field = ""; }
      else field += ch;
    }
    vals.push(field);
    cols.forEach((c, k) => { out[c] = vals[k] ?? ""; i++; });
    return out;
  });
}

const ts = tsv(join(dir, "timescale.tsv")).map((r) => ({
  t: Number(r.elapsed_ms), scale: Number(r.scale), source: r.source, world: Number(r.world_s),
  frame: Number(r.frame), raw: Number(r.raw), mult: Number(r.mult), unscaled: Number(r.unscaled),
  pause: Number(r.pause), dt: Number(r.dt),
}));
if (!ts.length) { console.error("timescale.tsv has no rows"); process.exit(1); }

const hits = existsSync(join(dir, "hits.tsv")) ? tsv(join(dir, "hits.tsv")).map((h) => ({ t: Number(h.elapsed_ms), self: h.self, via: h.via })) : [];
const states = existsSync(join(dir, "state-names.csv")) ? csv(join(dir, "state-names.csv")).map((s) => ({ t: Number(s.t), end: Number(s.end), owner: s.owner, agent: s.agent, name: s.name })) : [];

// --- the rows -----------------------------------------------------------------------------
console.log(`${ts.length} rows in timescale.tsv`);
console.log("elapsed_ms  scale     source  world_s     frame  raw      mult  unscaled pause dt");
for (const r of ts) {
  console.log(`${String(r.t).padStart(10)}  ${r.scale.toFixed(6)}  ${r.source.padEnd(6)}  ${r.world.toFixed(4).padStart(10)}  ${String(r.frame).padStart(5)}  ${r.raw.toFixed(5)}  ${r.mult.toFixed(2)}  ${r.unscaled}        ${r.pause}     ${r.dt.toFixed(5)}`);
}

// Scale in force at wall time t: the last row at or before t (rows are change points).
function rowAt(t) {
  let k = -1;
  for (let i = 0; i < ts.length; i++) if (ts[i].t <= t) k = i; else break;
  return k >= 0 ? ts[k] : ts[0];
}
// Integral of scale dt over [t0, t1] (ms in, seconds out).
function integrate(t0, t1) {
  let s = 0;
  for (let i = 0; i < ts.length; i++) {
    const a = Math.max(ts[i].t, t0);
    const b = Math.min(i + 1 < ts.length ? ts[i + 1].t : Infinity, t1);
    if (b > a) s += ts[i].scale * (b - a);
  }
  return s / 1000;
}
// The game's own world_s at wall time t: linear inside a segment (constant scale there).
function worldAt(t) {
  let i = ts.length - 1;
  while (i > 0 && ts[i].t > t) i--;
  const r = ts[i];
  return r.world + r.scale * (t - r.t) / 1000;
}

// --- distinct scales ------------------------------------------------------------------------
const byScale = new Map();
for (let i = 0; i < ts.length; i++) {
  const next = i + 1 < ts.length ? ts[i + 1].t : ts[i].t;
  const key = ts[i].scale.toFixed(6);
  byScale.set(key, (byScale.get(key) ?? 0) + (next - ts[i].t));
}
console.log("\nscale       wall ms");
for (const [k, v] of [...byScale].sort((a, b) => b[1] - a[1])) console.log(`${k}  ${v}`);

// --- Ultimates --------------------------------------------------------------------------------
const ults = states.filter((s) => /_SwitchIn_Attack_Ex_Start$/.test(s.name));
if (ults.length) console.log("\nUltimates (owner's SwitchIn_Attack_Ex_Start -> SwitchIn_Attack_Ex):");
for (const u of ults) {
  const end = states.find((s) => s.owner === u.owner && s.t > u.t && /_SwitchIn_Attack_Ex$/.test(s.name));
  const t1 = end ? end.t : u.end;
  const inside = ts.filter((r) => r.t >= u.t - 50 && r.t <= t1 + 50);
  const hitsInside = hits.filter((h) => h.t > u.t && h.t < t1);
  console.log(`  ${u.name} ${u.t} -> ${end ? end.name : "(no _Ex entry)"} ${t1}  wall ${t1 - u.t} ms, integral ${integrate(u.t, t1).toFixed(3)} s, world ${(worldAt(t1) - worldAt(u.t)).toFixed(3)} s, hits inside ${hitsInside.length}`);
  for (const r of inside) console.log(`     ${r.t} ${r.source} scale ${r.scale.toFixed(6)} (${r.t - u.t >= 0 ? "+" : ""}${r.t - u.t} ms from start)`);
}

// --- Chain entries ---------------------------------------------------------------------------
const chains = states.filter((s) => /_SwitchIn_Attack$/.test(s.name));
if (chains.length) console.log("\nChain entries (*_SwitchIn_Attack), scale rows in the 3 s before and 1 s after:");
for (const c of chains) {
  const around = ts.filter((r) => r.t >= c.t - 3000 && r.t <= c.t + 1000);
  console.log(`  ${c.name} ${c.t} (scale at entry ${rowAt(c.t).scale.toFixed(6)})`);
  for (const r of around) console.log(`     ${r.t} ${r.source} scale ${r.scale.toFixed(6)} (${r.t - c.t >= 0 ? "+" : ""}${r.t - c.t} ms)`);
}

// --- game time between the first and last hit --------------------------------------------------
if (hits.length) {
  const t0 = hits[0].t, t1 = hits[hits.length - 1].t;
  const wall = (t1 - t0) / 1000;
  const integral = integrate(t0, t1);
  const world = worldAt(t1) - worldAt(t0);
  console.log(`\nfirst hit ${t0} ms -> last hit ${t1} ms: wall ${wall.toFixed(3)} s, integral of scale dt ${integral.toFixed(3)} s, game world_s delta ${world.toFixed(3)} s` + (settlement != null ? `, settlement ${settlement} s` : ""));
  const last = ts[ts.length - 1];
  console.log(`last row: world_s ${last.world.toFixed(3)} at ${last.t} ms (frame ${last.frame})`);
}
