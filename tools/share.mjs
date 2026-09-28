// Make a shareable copy of one battle: <battle folder>\Share\combat-log.csv + summary.json.
//
//   node share.mjs                  pick a battle from a list (Enter = the newest)
//   node share.mjs <battle folder>  that battle (what dragging a folder onto the .cmd does)
//   node share.mjs --latest         the newest battle, no questions (--no-open: do not open Explorer)
//
// Battles are looked for under "Combat Logs" (and the older "captures") in the current folder,
// which "Make shareable log.cmd" sets to the game folder. Runs per-hit-log.mjs and
// readable-log.mjs on the battle, then copies the one readable CSV and writes a small summary
// into Share\. The raw .tsv files and the settlement's loadout are never copied there.
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline/promises";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { parseCsv } from "./log-csv.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const folderArg = args.find((a) => !a.startsWith("--"));

function fail(message) {
  console.error("\n" + message + "\n");
  process.exit(1);
}

/** The damage-result capture in a battle folder, or null. */
const resultFileOf = (dir) => {
  try {
    const f = fs.readdirSync(dir).find((n) => /^damage-result-.*\.tsv$/.test(n));
    return f ? path.join(dir, f) : null;
  } catch {
    return null;
  }
};
/** Rows beyond the two header lines: a battle with no hits has none. */
const hasHits = (file) => {
  const fd = fs.openSync(file, "r");
  const buf = Buffer.alloc(64 * 1024);
  const n = fs.readSync(fd, buf, 0, buf.length, 0);
  fs.closeSync(fd);
  return buf.subarray(0, n).toString("utf8").split("\n").filter(Boolean).length > 2;
};

/** Every battle folder (one with hit data) under the log roots, newest first. */
function findBattles(base) {
  const battles = [];
  for (const root of ["Combat Logs", "captures"]) {
    const rootDir = path.join(base, root);
    if (!fs.existsSync(rootDir)) continue;
    for (const launch of fs.readdirSync(rootDir, { withFileTypes: true })) {
      if (!launch.isDirectory()) continue;
      const launchDir = path.join(rootDir, launch.name);
      for (const battle of fs.readdirSync(launchDir, { withFileTypes: true })) {
        if (!battle.isDirectory()) continue;
        const dir = path.join(launchDir, battle.name);
        const result = resultFileOf(dir);
        if (!result || !hasHits(result)) continue;
        battles.push({ dir, label: `${launch.name}  >  ${battle.name}`, mtime: fs.statSync(result).mtimeMs });
      }
    }
  }
  return battles.sort((a, b) => b.mtime - a.mtime);
}

async function chooseBattle() {
  if (folderArg) {
    const dir = path.resolve(folderArg);
    if (!fs.existsSync(dir)) fail(`Folder not found: ${dir}`);
    const result = resultFileOf(dir);
    if (!result) fail(`No damage data in ${dir}.\nDrag a "Battle N" folder (inside "Combat Logs") onto the file instead.`);
    if (!hasHits(result)) fail(`That battle has no recorded hits: ${dir}`);
    return dir;
  }
  const battles = findBattles(process.cwd());
  if (battles.length === 0) {
    fail(
      'No battles with damage data were found in "Combat Logs" next to this file.\n' +
        "Check that:\n" +
        "  - this file is in the game folder (next to remielle.exe),\n" +
        "  - logger-status.txt says \"Combat logger: ON\",\n" +
        "  - damage-probe-enable.txt is in the game folder, and\n" +
        "  - you finished at least one battle after starting the game with remielle.exe.",
    );
  }
  if (flag("--latest") || battles.length === 1 || !process.stdin.isTTY) return battles[0].dir;
  const shown = battles.slice(0, 15);
  console.log("\nRecent battles (newest first):\n");
  shown.forEach((b, i) => console.log(`  ${String(i + 1).padStart(2)}. ${b.label}`));
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const answer = (await rl.question("\nType a number and press Enter (just Enter = 1, the newest): ")).trim();
  rl.close();
  const pick = answer === "" ? 1 : Number(answer);
  if (!Number.isInteger(pick) || pick < 1 || pick > shown.length) fail(`"${answer}" is not one of the numbers above.`);
  return shown[pick - 1].dir;
}

function run(script, dir) {
  const r = spawnSync(process.execPath, [path.join(here, script), dir], { encoding: "utf8" });
  if (r.status !== 0) {
    console.error(r.stdout, r.stderr);
    fail(`${script} failed on this battle (details above). Please include them if you report a problem.`);
  }
}

const round = (v, d = 0) => Number(v.toFixed(d));

/** A small, public summary of the readable log: who dealt what, with which skills. */
function summarize(dir, rows) {
  const header = fs.readFileSync(resultFileOf(dir), "utf8").split("\n", 1)[0];
  const client = /client=(\S+)/.exec(header)?.[1] ?? null;
  const total = rows.reduce((s, r) => s + (+r.damage || 0), 0);
  const byAttacker = new Map();
  for (const r of rows) {
    const name = r.attacker || "unknown";
    const a = byAttacker.get(name) ?? { name, damage: 0, hits: 0, crits: 0, skills: new Map() };
    const dmg = +r.damage || 0;
    a.damage += dmg;
    a.hits += 1;
    if (r.crit === "Yes") a.crits += 1;
    const key = `${r.skill_id}|${r.ability.replace(/ #\d+$/, "")}`;
    const s = a.skills.get(key) ?? { skill_id: r.skill_id, ability: r.ability.replace(/ #\d+$/, ""), damage: 0, hits: 0 };
    s.damage += dmg;
    s.hits += 1;
    a.skills.set(key, s);
    byAttacker.set(name, a);
  }
  const times = rows.map((r) => +r.time_s).filter(Number.isFinite);
  let settlement = null;
  try {
    const check = JSON.parse(fs.readFileSync(path.join(dir, "settlement-check.json"), "utf8"));
    if (check.settlement) settlement = { skillsMatchingExactly: check.exact, skillsNotMatching: check.mismatched };
  } catch {}
  return {
    about: "Per-hit combat log summary from the ZZZ combat logger. combat-log.csv next to this file has every hit.",
    gameVersion: client,
    battle: path.basename(dir),
    durationSeconds: times.length ? round(Math.max(...times) - Math.min(...times), 1) : 0,
    hits: rows.length,
    totalDamage: Math.round(total),
    settlementCheck: settlement,
    attackers: [...byAttacker.values()]
      .sort((a, b) => b.damage - a.damage)
      .map((a) => ({
        name: a.name,
        damage: Math.round(a.damage),
        damageShare: total ? round((a.damage / total) * 100, 2) : 0,
        hits: a.hits,
        critRate: a.hits ? round((a.crits / a.hits) * 100, 1) : 0,
        skills: [...a.skills.values()].sort((x, y) => y.damage - x.damage).map((s) => ({ ...s, damage: Math.round(s.damage) })),
      })),
  };
}

const dir = await chooseBattle();
console.log(`\nReading ${dir} ...`);
run("per-hit-log.mjs", dir);
run("readable-log.mjs", dir);

const readable = path.join(dir, "combat-log-readable.csv");
const rows = parseCsv(fs.readFileSync(readable, "utf8"));
const shareDir = path.join(dir, "Share");
fs.mkdirSync(shareDir, { recursive: true });
fs.copyFileSync(readable, path.join(shareDir, "combat-log.csv"));
const summary = summarize(dir, rows);
fs.writeFileSync(path.join(shareDir, "summary.json"), JSON.stringify(summary, null, 2) + "\n");

console.log(`\nDone: ${summary.hits} hits, ${summary.totalDamage.toLocaleString("en-US")} damage over ${summary.durationSeconds} s.`);
for (const a of summary.attackers) console.log(`  ${a.name.padEnd(20)} ${a.damageShare.toFixed(1).padStart(5)} %  (${a.damage.toLocaleString("en-US")})`);
console.log(`\nShareable files are in:\n  ${shareDir}\n    combat-log.csv   every hit (opens in Excel / Google Sheets)\n    summary.json     totals per character and skill`);
if (!flag("--no-open") && process.platform === "win32") spawnSync("explorer.exe", [shareDir]);
