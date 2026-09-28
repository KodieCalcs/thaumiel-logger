// Publishes settled battles and writes their two readable files, combat-log.csv and summary.json.
//
//   node summarize.mjs --pending "<Combat Logs>"   publish + summarize everything outstanding
//   node summarize.mjs "<battle folder>"           summarize that battle (again)
//
// The DLL runs the --pending form in the background when a battle ends (src/capture.zig), from
// "Combat Logs\.tools\" where install.cmd / the release zip put this file and its readers. The
// DLL leaves each battle in "Combat Logs\.diagnostics\<launch>\battle <k>\" with a battle.txt
// giving its start and end. A battle is published only if the (battlestats) Remielle server
// wrote a settlement for it -- "<server>\logs\endbattle_<n>.pb", matched by time, since the
// server's counter restarts with the server -- and then becomes "Combat Logs\<day>\Battle <n>\"
// with the settlement and its loadout copied in (hidden). Retried or quit battles have no
// settlement and stay in diagnostics, where they are deleted 7 days later.
//
// The readers (per-hit-log.mjs, readable-log.mjs) run on a temporary copy of the raw files, so
// their intermediate outputs never appear in the battle folder.
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

/** A settlement can reach the disk a little after the level closes; wait this long for it. */
const SETTLEMENT_GRACE_MS = 20_000;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const hide = (file) => {
  if (process.platform === "win32") spawnSync("attrib", ["+h", file], { windowsHide: true });
};
const logLines = [];
const note = (line) => {
  logLines.push(`${new Date().toISOString()} ${line}`);
  console.log(line);
};

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

// --- summarizing -------------------------------------------------------------------------------

/** Damage per attacker and per skill from the readable log, plus the settlement cross-check. */
function summarize(dir, allRows, check) {
  const header = fs.readFileSync(resultFileOf(dir), "utf8").split("\n", 1)[0];
  // The team is whoever attacks the most-hit target. The log names an enemy once it has hit an
  // Agent, so without this its hits on the team would count as team damage.
  const targetHits = new Map();
  for (const r of allRows) targetHits.set(r.target, (targetHits.get(r.target) ?? 0) + 1);
  const mainTarget = [...targetHits].sort((a, b) => b[1] - a[1])[0]?.[0];
  const team = new Set(allRows.filter((r) => r.target === mainTarget && r.attacker !== mainTarget).map((r) => r.attacker));
  const rows = allRows.filter((r) => team.has(r.attacker) && !team.has(r.target));
  const taken = allRows.filter((r) => team.has(r.target) && !team.has(r.attacker));
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
    settlement: check?.settlement
      ? { file: check.settlement, skillsMatchingExactly: check.exact, skillsNotMatching: check.mismatched }
      : null,
    durationSeconds: times.length ? round(Math.max(...times) - Math.min(...times), 1) : 0,
    hits: rows.length,
    totalDamage: Math.round(total),
    damageTaken: { hits: taken.length, damage: Math.round(taken.reduce((s, r) => s + (+r.damage || 0), 0)) },
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
  const r = spawnSync(process.execPath, [path.join(here, script), dir], { encoding: "utf8", windowsHide: true });
  if (r.status !== 0) throw new Error(`${script} failed:\n${r.stdout}\n${r.stderr}`);
}

/** Summarize one battle folder; returns a one-line result. */
function summarizeBattle(dir) {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), "combat-logger-"));
  try {
    for (const name of fs.readdirSync(dir)) {
      // Everything per-hit-log.mjs reads: the probes, hits.tsv (skill attribution) and the settlement.
      if (/^(damage-.*\.tsv|hits\.tsv|endbattle_\d+\.pb)$/.test(name)) fs.copyFileSync(path.join(dir, name), path.join(work, name));
    }
    run("per-hit-log.mjs", work);
    run("readable-log.mjs", work);
    const csv = fs.readFileSync(path.join(work, "combat-log-readable.csv"), "utf8");
    let check = null;
    try {
      check = JSON.parse(fs.readFileSync(path.join(work, "settlement-check.json"), "utf8"));
    } catch {}
    const summary = summarize(dir, parseCsv(csv), check);
    fs.writeFileSync(path.join(dir, "combat-log.csv"), csv);
    fs.writeFileSync(path.join(dir, "summary.json"), JSON.stringify(summary, null, 2) + "\n");
    return `${summary.hits} hits, ${summary.totalDamage} damage`;
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
}

// --- publishing ---------------------------------------------------------------------------------

/** The server's logs folder, from .tools\server-logs.txt (relative to the game folder), or null. */
function serverLogsDir(root) {
  try {
    const configured = fs.readFileSync(path.join(root, ".tools", "server-logs.txt"), "utf8").replace(/^﻿/, "").trim();
    const dir = path.resolve(path.dirname(root), configured);
    return fs.statSync(dir).isDirectory() ? dir : null;
  } catch {
    return null;
  }
}

/** Battles the DLL has finished with (battle.txt written) and nobody has judged yet. */
function stagedBattles(root) {
  const out = [];
  const diagnostics = path.join(root, ".diagnostics");
  let launches = [];
  try {
    launches = fs.readdirSync(diagnostics, { withFileTypes: true }).filter((d) => d.isDirectory());
  } catch {
    return out;
  }
  for (const launch of launches) {
    const launchDir = path.join(diagnostics, launch.name);
    for (const sub of fs.readdirSync(launchDir, { withFileTypes: true })) {
      if (!sub.isDirectory() || !/^battle \d+$/.test(sub.name)) continue;
      const dir = path.join(launchDir, sub.name);
      if (fs.existsSync(path.join(dir, "no-settlement.txt"))) continue;
      let info;
      try {
        info = Object.fromEntries(
          fs.readFileSync(path.join(dir, "battle.txt"), "utf8").split(/\r?\n/).filter(Boolean).map((l) => l.split("=")),
        );
      } catch {
        continue; // still running, or from before battle.txt existed
      }
      out.push({ dir, awake: +info.awake_unix_ms, destroy: +info.destroy_unix_ms, hits: +info.hits });
    }
  }
  return out.sort((a, b) => a.awake - b.awake);
}

/** The settlement the server wrote while this battle ran (the latest, if somehow several). */
function findSettlement(battle, logsDir) {
  let best = null;
  for (const name of fs.readdirSync(logsDir)) {
    const m = /^endbattle_(\d+)\.pb$/.exec(name);
    if (!m) continue;
    const file = path.join(logsDir, name);
    const t = fs.statSync(file).mtimeMs;
    if (t < battle.awake - 2000 || t > battle.destroy + SETTLEMENT_GRACE_MS) continue;
    if (!best || t > best.t) best = { n: +m[1], file, t };
  }
  return best;
}

const dayName = (ms) => {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

/** "Battle <n>", or "Battle <n> (2)" if the server's counter restarted and reused the number. */
function freeFolder(dayDir, n) {
  for (let i = 1; ; i++) {
    const dir = path.join(dayDir, i === 1 ? `Battle ${n}` : `Battle ${n} (${i})`);
    if (!fs.existsSync(dir)) return dir;
  }
}

/** Move a settled battle to Combat Logs\<day>\Battle <n>\ with its settlement and loadout. */
function publish(root, battle, settlement) {
  const dayDir = path.join(root, dayName(battle.destroy));
  fs.mkdirSync(dayDir, { recursive: true });
  const dest = freeFolder(dayDir, settlement.n);
  fs.renameSync(battle.dir, dest);
  const copies = [settlement.file, settlement.file.replace(/\.pb$/, "_loadout.json")];
  for (const file of copies) {
    if (!fs.existsSync(file)) continue;
    const to = path.join(dest, path.basename(file));
    fs.copyFileSync(file, to);
    hide(to);
  }
  return dest;
}

/** Without a configured server folder there is nothing to match: publish every battle with a
 *  hit, numbered through the day, rather than lose them. */
function publishWithoutServer(root, battle) {
  const dayDir = path.join(root, dayName(battle.destroy));
  fs.mkdirSync(dayDir, { recursive: true });
  const used = fs.readdirSync(dayDir).map((n) => +(/^Battle (\d+)/.exec(n)?.[1] ?? 0));
  const dest = freeFolder(dayDir, Math.max(0, ...used) + 1);
  fs.renameSync(battle.dir, dest);
  return dest;
}

/** Judge every staged battle: publish it, leave it for later, or mark it never settled. */
async function publishStaged(root) {
  const logsDir = serverLogsDir(root);
  if (!logsDir) note("no server logs folder configured (.tools\\server-logs.txt); publishing every battle with a hit");
  for (const battle of stagedBattles(root)) {
    try {
      if (!logsDir) {
        if (battle.hits > 0) note(`${publishWithoutServer(root, battle)}: published (no server to check)`);
        else fs.writeFileSync(path.join(battle.dir, "no-settlement.txt"), "no hits\r\n");
        continue;
      }
      let settlement = findSettlement(battle, logsDir);
      // The level can close before the server has written the file; give it a moment.
      while (!settlement && Date.now() < battle.destroy + SETTLEMENT_GRACE_MS) {
        await sleep(2000);
        settlement = findSettlement(battle, logsDir);
      }
      if (settlement) note(`${publish(root, battle, settlement)}: settled as ${path.basename(settlement.file)}`);
      else {
        fs.writeFileSync(path.join(battle.dir, "no-settlement.txt"), "the server wrote no settlement while this battle ran (retried or quit)\r\n");
        note(`${battle.dir}: no settlement, left in diagnostics`);
      }
    } catch (e) {
      note(`${battle.dir}: FAILED to publish: ${e.message}`);
    }
  }
}

/** Visible battle folders (<day>\<battle>) with hits and no summary.json yet. */
function unsummarized(root) {
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

/** Battles that never settled stay in .diagnostics\<launch>\ as "battle <k>" (tens of MB each),
 *  with an "after battle <k>" folder for the result screen and lobby. Delete those a week after
 *  they were last written; published battles and the per-launch logs are never touched. */
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
      // The folder's own date counts too: a battle that just started may have no files yet.
      const newest = Math.max(fs.statSync(dir).mtimeMs, ...fs.readdirSync(dir).map((f) => fs.statSync(path.join(dir, f)).mtimeMs));
      if (newest < cutoff) {
        try {
          fs.rmSync(dir, { recursive: true, force: true });
          note(`pruned ${dir}`);
        } catch {}
      }
    }
  }
}

/** One summarizer at a time: two battles ending close together must not move the same folder. */
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

if (pending) {
  const root = path.resolve(target);
  const lock = takeLock(root);
  if (!lock) process.exit(0);
  try {
    // Loop until nothing is outstanding, so a battle that ended while this ran is not left behind.
    const failed = new Set();
    for (;;) {
      await publishStaged(root);
      const todo = unsummarized(root).filter((d) => !failed.has(d));
      if (todo.length === 0 && stagedBattles(root).length === 0) break;
      for (const dir of todo) {
        try {
          note(`${dir}: ${summarizeBattle(dir)}`);
        } catch (e) {
          failed.add(dir);
          note(`${dir}: FAILED ${e.message}`);
        }
      }
      if (todo.length === 0) break;
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
