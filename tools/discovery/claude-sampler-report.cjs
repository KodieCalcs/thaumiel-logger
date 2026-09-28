// Turn sampler.csv into a ranked list of functions that run during combat.
//
//   node claude-sampler-report.cjs <sampler.csv> <idle_end_ms> [combat_start_ms]
//
// The point is the subtraction: rendering, animation and UI dominate both
// phases, so what matters is what appears while fighting and not while idle.
const fs = require("fs");
const path = require("path");

const csv = process.argv[2];
const idleEnd = Number(process.argv[3] ?? 60000);
const combatStart = Number(process.argv[4] ?? idleEnd + 5000);

if (!csv) {
  console.error("usage: node claude-sampler-report.cjs <sampler.csv> <idle_end_ms> [combat_start_ms]");
  process.exit(2);
}

// --- method table ------------------------------------------------------------
const TSV = path.join(__dirname, "il2cpp-v6.tsv");
const methods = [];
{
  let cls = "";
  for (const row of fs.readFileSync(TSV, "utf8").split(/\r?\n/)) {
    if (row.startsWith("CLASS\t")) {
      const p = row.split("\t");
      cls = p[3] ? `${p[3]}.${p[4]}` : p[4];
    } else if (row.startsWith("METHOD\t")) {
      const p = row.split("\t");
      if (p[3] === "RVA") {
        const rva = parseInt(p[4], 16);
        if (rva) methods.push({ rva, cls, name: p[1], args: p[2] });
      }
    }
  }
}
methods.sort((a, b) => a.rva - b.rva);
const starts = methods.map((m) => m.rva);

function owner(rva) {
  let lo = 0;
  let hi = starts.length - 1;
  let best = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (starts[mid] <= rva) {
      best = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  if (best < 0) return null;
  const m = methods[best];
  // A sample more than a plausible body length past a method start is probably
  // in an unlisted stub; report it as unmapped rather than mislabel it.
  return rva - m.rva > 0x4000 ? null : m;
}

// --- read samples ------------------------------------------------------------
const idle = new Map();
const combat = new Map();
let nIdle = 0;
let nCombat = 0;

for (const row of fs.readFileSync(csv, "utf8").split(/\r?\n/)) {
  if (!row || row.startsWith("#") || row.startsWith("elapsed")) continue;
  const [msRaw, , rvaRaw] = row.split(",");
  const ms = Number(msRaw);
  const rva = parseInt(rvaRaw, 16);
  if (!Number.isFinite(ms) || !Number.isFinite(rva)) continue;

  const m = owner(rva);
  const key = m ? `${m.cls}::${m.name}(${m.args})` : `<unmapped 0x${rva.toString(16)}>`;
  const start = m ? m.rva : rva;

  if (ms <= idleEnd) {
    idle.set(key, (idle.get(key) || 0) + 1);
    nIdle++;
  } else if (ms >= combatStart) {
    const rec = combat.get(key) || { n: 0, start };
    rec.n++;
    combat.set(key, rec);
    nCombat++;
  }
}

console.log(`idle samples: ${nIdle}  combat samples: ${nCombat}`);
if (!nIdle || !nCombat) {
  console.error("One of the phases is empty -- check the idle_end_ms / combat_start_ms split.");
  process.exit(1);
}

// --- rank --------------------------------------------------------------------
// Rate per 1000 samples, so the two phases are comparable even at different lengths.
const rows = [];
for (const [key, rec] of combat) {
  const combatRate = (rec.n / nCombat) * 1000;
  const idleRate = ((idle.get(key) || 0) / nIdle) * 1000;
  rows.push({ key, start: rec.start, n: rec.n, combatRate, idleRate, delta: combatRate - idleRate });
}
rows.sort((a, b) => b.delta - a.delta);

console.log("\n=== combat-only (highest excess over idle) ===\n");
console.log("  rva        samples  combat/1k  idle/1k   method");
for (const r of rows.slice(0, 40)) {
  if (r.delta <= 0) break;
  console.log(
    `  0x${r.start.toString(16).padEnd(9)} ${String(r.n).padStart(6)}  ` +
      `${r.combatRate.toFixed(1).padStart(8)}  ${r.idleRate.toFixed(1).padStart(7)}   ${r.key}`,
  );
}

const exclusive = rows.filter((r) => (idle.get(r.key) || 0) === 0 && r.n >= 3);
console.log(`\n=== never seen while idle (${exclusive.length}, showing 40) ===\n`);
for (const r of exclusive.slice(0, 40))
  console.log(`  0x${r.start.toString(16).padEnd(9)} ${String(r.n).padStart(6)}   ${r.key}`);

fs.writeFileSync(
  path.join(__dirname, "claude-sampler-report.json"),
  JSON.stringify({ nIdle, nCombat, rows: rows.slice(0, 400) }, null, 2),
);
console.log("\nwrote claude-sampler-report.json");
