// Writes a battle's two readable files, combat-log.csv and summary.json, into its folder.
//
//   node summarize.mjs --pending "<Combat Logs>"   every battle folder that has no summary yet
//   node summarize.mjs "<battle folder>"           that battle (re-summarizes it)
//
// The DLL runs the --pending form in the background when a battle ends (src/capture.zig), from
// "Combat Logs\.tools\" where install.cmd / the release zip put this file and its readers, once
// the DLL has moved the finished battle to "Combat Logs\<day>\Battle <n>\". The
// readers (per-hit-log.mjs, readable-log.mjs) run on a temporary copy of the raw files, so their
// intermediate outputs never appear in the battle folder. Nothing in the battle folder is
// changed except the two files written here.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { parseCsv } from "./log-csv.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const pending = args.includes("--pending");
const target = args.find((a) => !a.startsWith("--"));
if (!target) {
  console.error('usage: node summarize.mjs --pending "<Combat Logs>" | node summarize.mjs "<battle folder>"');
  process.exit(2);
}

const resultFileOf = (dir) => {
  try {
    const f = fs.readdirSync(dir).find((n) => /^damage-result-.*\.tsv$/.test(n));
    return f ? path.join(dir, f) : null;
  } catch {
    return null;
  }
};
/** More than the two header lines: the battle recorded at least one hit. */
const hasHits = (file) => {
  const fd = fs.openSync(file, "r");
  const buf = Buffer.alloc(64 * 1024);
  const n = fs.readSync(fd, buf, 0, buf.length, 0);
  fs.closeSync(fd);
  return buf.subarray(0, n).toString("utf8").split("\n").filter(Boolean).length > 2;
};

const round = (v, d = 0) => Number(v.toFixed(d));

/** Damage per attacker and per skill from the readable log. */
function summarize(dir, rows) {
  const header = fs.readFileSync(resultFileOf(dir), "utf8").split("\n", 1)[0];
  const total = rows.reduce((s, r) => s + (+r.damage || 0), 0);
  const byAttacker = new Map();
  for (const r of rows) {
    const name = r.attacker || "unknown";
    const a = byAttacker.get(name) ?? { name, damage: 0, hits: 0, crits: 0, skills: new Map() };
    const dmg = +r.damage || 0;
    a.damage += dmg;
    a.hits += 1;
    if (r.crit === "Yes") a.crits += 1;
    const ability = r.ability.replace(/ #\d+$/, "");
    const key = `${r.skill_id}|${ability}`;
    const s = a.skills.get(key) ?? { skill_id: r.skill_id, ability, damage: 0, hits: 0 };
    s.damage += dmg;
    s.hits += 1;
    a.skills.set(key, s);
    byAttacker.set(name, a);
  }
  const times = rows.map((r) => +r.time_s).filter(Number.isFinite);
  return {
    about: "Combat logger summary. combat-log.csv next to this file has every hit.",
    gameVersion: /client=(\S+)/.exec(header)?.[1] ?? null,
    battle: `${path.basename(path.dirname(dir))} ${path.basename(dir)}`,
    durationSeconds: times.length ? round(Math.max(...times) - Math.min(...times), 1) : 0,
    hits: rows.length,
    totalDamage: Math.round(total),
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

function run(script, dir) {
  const r = spawnSync(process.execPath, [path.join(here, script), dir], { encoding: "utf8" });
  if (r.status !== 0) throw new Error(`${script} failed:\n${r.stdout}\n${r.stderr}`);
}

/** Summarize one battle folder; returns a one-line result. */
function summarizeBattle(dir) {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), "combat-logger-"));
  try {
    for (const name of fs.readdirSync(dir)) {
      if (/^(damage-.*\.tsv|endbattle_\d+\.pb)$/.test(name)) fs.copyFileSync(path.join(dir, name), path.join(work, name));
    }
    run("per-hit-log.mjs", work);
    run("readable-log.mjs", work);
    const csv = fs.readFileSync(path.join(work, "combat-log-readable.csv"), "utf8");
    const summary = summarize(dir, parseCsv(csv));
    fs.writeFileSync(path.join(dir, "combat-log.csv"), csv);
    fs.writeFileSync(path.join(dir, "summary.json"), JSON.stringify(summary, null, 2) + "\n");
    return `${summary.hits} hits, ${summary.totalDamage} damage`;
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
}

/** Battle folders under the root (<day>\<battle>) with hits and no summary.json yet. */
function pendingBattles(root) {
  const out = [];
  for (const day of fs.readdirSync(root, { withFileTypes: true })) {
    if (!day.isDirectory() || day.name.startsWith(".")) continue;
    for (const battle of fs.readdirSync(path.join(root, day.name), { withFileTypes: true })) {
      if (!battle.isDirectory()) continue;
      const dir = path.join(root, day.name, battle.name);
      const result = resultFileOf(dir);
      if (result && hasHits(result) && !fs.existsSync(path.join(dir, "summary.json"))) out.push(dir);
    }
  }
  return out;
}

/** One summarizer at a time: two battles ending close together must not write the same files. */
function takeLock(root) {
  const lock = path.join(root, ".tools", "summarize.lock");
  try {
    if (Date.now() - fs.statSync(lock).mtimeMs < 15 * 60 * 1000) return null; // someone is working
    fs.rmSync(lock, { force: true }); // stale: a previous run died
  } catch {}
  try {
    fs.writeFileSync(lock, String(process.pid), { flag: "wx" });
    return lock;
  } catch {
    return null;
  }
}

/** Battles left through the pause menu stay in .diagnostics\<launch>\ as "battle <k>" (tens of MB
 *  each), with an "after battle <k>" folder for the result screen and lobby. Delete those a week
 *  after they were last written; finished battles and the per-launch logs are never touched. */
function pruneDiagnostics(root) {
  const cutoff = Date.now() - 7 * 24 * 3600 * 1000;
  const diagnostics = path.join(root, ".diagnostics");
  let launches = [];
  try {
    launches = fs.readdirSync(diagnostics, { withFileTypes: true }).filter((d) => d.isDirectory());
  } catch {
    return;
  }
  for (const launch of launches) {
    const launchDir = path.join(diagnostics, launch.name);
    for (const sub of fs.readdirSync(launchDir, { withFileTypes: true })) {
      if (!sub.isDirectory() || !/^(after )?battle \d+$/.test(sub.name)) continue;
      const dir = path.join(launchDir, sub.name);
      const newest = Math.max(0, ...fs.readdirSync(dir).map((f) => fs.statSync(path.join(dir, f)).mtimeMs));
      if (newest < cutoff) {
        try {
          fs.rmSync(dir, { recursive: true, force: true });
          note(`pruned ${dir}`);
        } catch {}
      }
    }
  }
}

const logLines = [];
const note = (line) => {
  logLines.push(`${new Date().toISOString()} ${line}`);
  console.log(line);
};

if (pending) {
  const root = path.resolve(target);
  const lock = takeLock(root);
  if (!lock) process.exit(0);
  try {
    // Loop until nothing is pending, so a battle that ended while this ran is not left behind.
    const failed = new Set();
    for (;;) {
      const todo = pendingBattles(root).filter((d) => !failed.has(d));
      if (todo.length === 0) break;
      for (const dir of todo) {
        try {
          note(`${dir}: ${summarizeBattle(dir)}`);
        } catch (e) {
          failed.add(dir);
          note(`${dir}: FAILED ${e.message}`);
        }
      }
    }
    pruneDiagnostics(root);
  } finally {
    fs.rmSync(lock, { force: true });
    try {
      fs.appendFileSync(path.join(root, ".diagnostics", "summarize.log"), logLines.map((l) => l + "\n").join(""));
    } catch {}
  }
} else {
  const dir = path.resolve(target);
  if (!resultFileOf(dir)) {
    console.error(`No damage data in ${dir}`);
    process.exit(1);
  }
  note(`${dir}: ${summarizeBattle(dir)}`);
}
