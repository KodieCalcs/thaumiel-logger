// Publishes settled battles and writes their two readable files: combat-log.xlsx (a Breakdown tab of
// damage and Daze per character and ability, and every hit) and combat-log.json (every hit, for
// programs and AI tools to summarize themselves).
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
// with the settlement and its loadout copied in (visible: the site takes both). Retried or quit battles have no
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
import { writeXlsx } from "./xlsx.mjs";

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

/** The team's hits on enemies, and the enemies' hits on the team. The team is whoever attacks the
 *  most-hit target: the log names an enemy once it has hit an Agent, so without this its hits on
 *  the team would count as team damage. */
function splitTeam(allRows) {
  const targetHits = new Map();
  for (const r of allRows) targetHits.set(r.target, (targetHits.get(r.target) ?? 0) + 1);
  const mainTarget = [...targetHits].sort((a, b) => b[1] - a[1])[0]?.[0];
  const team = new Set(allRows.filter((r) => r.target === mainTarget && r.attacker !== mainTarget).map((r) => r.attacker));
  return {
    rows: allRows.filter((r) => team.has(r.attacker) && !team.has(r.target)),
    taken: allRows.filter((r) => team.has(r.target) && !team.has(r.attacker)),
  };
}

const abilityOf = (r) => r.ability.replace(/ #\d+$/, "");

/** Damage and Daze per attacker and per skill from the readable log, plus the settlement cross-check. */
function summarize(dir, allRows, check) {
  const header = fs.readFileSync(resultFileOf(dir), "utf8").split("\n", 1)[0];
  const { rows, taken } = splitTeam(allRows);
  const total = rows.reduce((s, r) => s + (+r.damage || 0), 0);
  const totalDaze = rows.reduce((s, r) => s + (+r.daze || 0), 0);
  const byAttacker = new Map();
  for (const r of rows) {
    const name = r.attacker || "unknown";
    const a = byAttacker.get(name) ?? { name, damage: 0, daze: 0, hits: 0, crits: 0, skills: new Map() };
    const dmg = +r.damage || 0;
    const daze = +r.daze || 0;
    a.damage += dmg;
    a.daze += daze;
    a.hits += 1;
    if (r.crit === "Yes") a.crits += 1;
    const ability = abilityOf(r);
    const key = `${r.skill_id}|${ability}`;
    const s = a.skills.get(key) ?? { skill_id: r.skill_id, ability, damage: 0, daze: 0, hits: 0 };
    s.damage += dmg;
    s.daze += daze;
    s.hits += 1;
    a.skills.set(key, s);
    byAttacker.set(name, a);
  }
  const times = rows.map((r) => +r.time_s).filter(Number.isFinite);
  return {
    gameVersion: /client=(\S+)/.exec(header)?.[1] ?? null,
    battle: `${path.basename(path.dirname(dir))} ${path.basename(dir)}`,
    settlement: check?.settlement
      ? { file: check.settlement, skillsMatchingExactly: check.exact, skillsNotMatching: check.mismatched }
      : null,
    durationSeconds: times.length ? round(Math.max(...times) - Math.min(...times), 1) : 0,
    hits: rows.length,
    totalDamage: Math.round(total),
    totalDaze: round(totalDaze, 1),
    damageTaken: { hits: taken.length, damage: Math.round(taken.reduce((s, r) => s + (+r.damage || 0), 0)) },
    attackers: [...byAttacker.values()]
      .sort((a, b) => b.damage - a.damage)
      .map((a) => ({
        name: a.name,
        damage: Math.round(a.damage),
        damageShare: total ? round((a.damage / total) * 100, 2) : 0,
        daze: round(a.daze, 1),
        dazeShare: totalDaze ? round((a.daze / totalDaze) * 100, 2) : 0,
        hits: a.hits,
        critRate: a.hits ? round((a.crits / a.hits) * 100, 1) : 0,
        skills: [...a.skills.values()]
          .sort((x, y) => y.damage - x.damage)
          .map((s) => ({ ...s, damage: Math.round(s.damage), daze: round(s.daze, 1) })),
      })),
  };
}

/** The workbook's first sheet: damage and Daze per character, then per character and ability. */
function breakdownSheet(summary, allRows) {
  const { rows } = splitTeam(allRows);
  const share = (part, whole) => ({ v: whole ? part / whole : 0, s: "pct" });
  const out = [
    [{ v: "Damage and Daze breakdown", s: "title" }],
    ["Battle", summary.battle],
    ["Game version", summary.gameVersion ?? ""],
    ["Duration (seconds)", { v: summary.durationSeconds, s: "dec" }],
    [
      "Server settlement",
      summary.settlement
        ? `${summary.settlement.file}: ${summary.settlement.skillsMatchingExactly} skill totals match exactly, ${summary.settlement.skillsNotMatching} do not`
        : "none found (totals not cross-checked)",
    ],
    ["Damage taken by the team", { v: summary.damageTaken.damage, s: "int" }, `${summary.damageTaken.hits} hits`],
    [],
    ["Character", "Damage", "Share of damage", "Daze", "Share of Daze", "Hits", "Crit rate"].map((v) => ({ v, s: "bold" })),
  ];
  for (const a of summary.attackers) {
    out.push([a.name, { v: a.damage, s: "int" }, share(a.damage, summary.totalDamage), { v: a.daze, s: "dec" }, share(a.daze, summary.totalDaze), a.hits, { v: a.critRate / 100, s: "pct" }]);
  }
  out.push([
    { v: "Team", s: "bold" },
    { v: summary.totalDamage, s: "boldInt" },
    { v: 1, s: "boldPct" },
    { v: summary.totalDaze, s: "boldDec" },
    { v: summary.totalDaze ? 1 : 0, s: "boldPct" },
    { v: summary.hits, s: "boldInt" },
  ]);
  out.push([]);
  out.push(
    ["Character", "Ability", "Damage", "Share of team damage", "Share of character's damage", "Daze", "Share of team Daze", "Share of character's Daze", "Hits"].map(
      (v) => ({ v, s: "bold" }),
    ),
  );
  // By the ability's name: skills the game splits into several ids under one name read as one line.
  for (const a of summary.attackers) {
    const byName = new Map();
    for (const r of rows) {
      if ((r.attacker || "unknown") !== a.name) continue;
      const name = abilityOf(r);
      const e = byName.get(name) ?? { name, damage: 0, daze: 0, hits: 0 };
      e.damage += +r.damage || 0;
      e.daze += +r.daze || 0;
      e.hits += 1;
      byName.set(name, e);
    }
    for (const e of [...byName.values()].sort((x, y) => y.damage - x.damage || y.daze - x.daze)) {
      out.push([
        a.name,
        e.name,
        { v: Math.round(e.damage), s: "int" },
        share(e.damage, summary.totalDamage),
        share(e.damage, a.damage),
        { v: round(e.daze, 1), s: "dec" },
        share(e.daze, summary.totalDaze),
        share(e.daze, a.daze),
        e.hits,
      ]);
    }
  }
  return { name: "Breakdown", rows: out, widths: [24, 44, 14, 20, 26, 12, 20, 24, 8] };
}

/** The workbook's second sheet: the readable log, one row per hit. */
function hitsSheet(csv) {
  const lines = parseCsv(csv);
  const header = Object.keys(lines[0] ?? {});
  const wide = { attacker: 18, target: 14, ability: 40, client_name: 30, other_modifiers: 60 };
  return {
    name: "Every hit",
    rows: [header.map((v) => ({ v, s: "bold" })), ...lines.map((r) => header.map((h) => r[h]))],
    widths: header.map((h) => wide[h] ?? Math.max(9, h.length + 2)),
    freezeRows: 1,
    filter: true,
  };
}

/** What each hit field means, written into combat-log.json for whoever (or whatever) reads it. */
const HIT_FIELDS = {
  time_s: "seconds since the battle's first hit, with time spent paused left out",
  attacker: "who dealt the hit: an Agent, a Bangboo, or an enemy",
  target: 'who took it; "enemy (main)" is the most-hit enemy',
  skill_id: "the game's skill id",
  ability: "the in-game name of the action",
  client_name: "the game's internal name for the hit",
  attack_tags: "the game's own tags on the hit, | separated: an attack's type (AttackNormal|Normal = Basic Attack, AttackSpecial|ExSp = EX Special, AttackQTE|NormalQTE = Chain, AttackQTE|ExQTE = Ultimate, AttackAid|BeHitAid = Quick Assist, AttackAid|AssaultAid = Assist Follow-Up, ParryAid = Defensive Assist, Counter = Dodge Counter), or for Anomaly damage Buff + the Anomaly (Burn, Electric = Shock, Erosion = Corruption, Frozen/Frost = Shatter, Strike = Assault, Wind = Windswept, Catalysis = Vortex, Disorder), ending in Abloom for an Abloom",
  hit_split: "this hit's fraction of its action's total multiplier",
  damage: "final damage, as the game shows it",
  daze: "Daze the target's Stun gauge took from this hit (0 while it is Stunned)",
  anomaly_buildup: "Anomaly buildup the target's gauge took from this hit (per Attribute: see the attacker)",
  crit: "Yes or No",
  during_stun: "Yes when the target was Stunned as the hit landed; null when that is not known",
  enemy_def: "the target's DEF at the hit, after debuffs on it; null when not known (and for hits on the team)",
  enemy_def_reduction_pct:
    "DEF reduction from debuffs on the target (e.g. Nicole's), %. The attacker's own DEF reduction is not in it: that is the DefenceRatio in other_modifiers",
  enemy_dmg_res_pct: "the target's DMG RES change from debuffs on it, %; negative = it takes more damage (e.g. -10)",
  enemy_daze_taken_pct:
    "extra Daze the target took from this hit because of its side (e.g. Assault: 7.5), %, measured: the hit's Daze against its Daze multiplier, the attacker's Impact (with flat bonuses) and Daze bonus, and distance. Empty on Anomaly procs and hits with no Daze",
  enemy_debuffs:
    "the team's debuffs on the target at the hit, by the game's internal names (Pheony = Phoenix, Summer = Sunna, Nostradamus = Nicole). Their amounts are not in the log: the game applies most of them while the hit is computed, without storing a stat",
  damage_mv_pct: "the hit's damage multiplier, %",
  daze_mv_pct: "the hit's Daze multiplier, %",
  distance_attenuation: "the game's distance falloff on the hit, 1 = none (only some ranged attacks have one)",
  energy: "Energy the attacker gained from the hit",
  decibels: "Decibels the team gained from the hit",
  atk: "the attacker's ATK at the hit",
  impact: "the attacker's Impact at the hit",
  anomaly_mastery: "the attacker's Anomaly Mastery at the hit",
  anomaly_proficiency: "the attacker's Anomaly Proficiency at the hit",
  dmg_bonus_pct: "total DMG bonus on the hit, %",
  crit_rate_pct: "the attacker's CRIT Rate at the hit, %",
  crit_dmg_pct: "the attacker's CRIT DMG at the hit, %",
  pen_ratio_pct: "the attacker's PEN Ratio at the hit, %. Flat PEN is not in the log: the build's flat PEN is in the loadout file",
  other_modifiers: "other modifiers active on the hit, name=value",
};

/** combat-log.json: the battle's details, then every hit as an object (numbers as numbers, empty
 *  fields as null), one hit per line. */
function hitsJson(summary, rows) {
  const value = (v) => (v === "" ? null : /^-?\d+(\.\d+)?$/.test(v) && v.length < 16 ? Number(v) : v);
  const head = {
    about:
      "Every hit of one battle, one object per hit in time order (the same rows as the Every hit tab of combat-log.xlsx). Totals are left to the reader: sum damage or daze by attacker and ability.",
    gameVersion: summary.gameVersion,
    battle: summary.battle,
    settlement: summary.settlement,
    durationSeconds: summary.durationSeconds,
    hitCount: rows.length,
    fields: HIT_FIELDS,
  };
  const lines = rows.map((r) => "    " + JSON.stringify(Object.fromEntries(Object.entries(r).map(([k, v]) => [k, value(v)]))));
  return JSON.stringify(head, null, 2).replace(/\n}$/, `,\n  "hits": [\n${lines.join(",\n")}\n  ]\n}\n`);
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
      // Everything the readers use: the probes, hits.tsv (skill attribution), state.tsv (Stun
      // windows) and the settlement.
      if (/^(damage-.*\.tsv|hits\.tsv|state\.tsv|endbattle_\d+\.pb)$/.test(name)) fs.copyFileSync(path.join(dir, name), path.join(work, name));
    }
    run("per-hit-log.mjs", work);
    run("readable-log.mjs", work);
    const csv = fs.readFileSync(path.join(work, "combat-log-readable.csv"), "utf8");
    let check = null;
    try {
      check = JSON.parse(fs.readFileSync(path.join(work, "settlement-check.json"), "utf8"));
    } catch {}
    const rows = parseCsv(csv);
    const summary = summarize(dir, rows, check);
    writeXlsx(path.join(dir, "combat-log.xlsx"), [breakdownSheet(summary, rows), hitsSheet(csv)]);
    fs.writeFileSync(path.join(dir, "combat-log.json"), hitsJson(summary, rows));
    // Earlier versions wrote combat-log.csv and summary.json; the two files above replace them.
    for (const old of ["combat-log.csv", "summary.json"]) fs.rmSync(path.join(dir, old), { force: true });
    return `${summary.hits} hits, ${summary.totalDamage} damage`;
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
}

// --- publishing ---------------------------------------------------------------------------------

/** Every logs folder a settlement may be in: the one in .tools\server-logs.txt (relative to the game
 *  folder; written by install.cmd) and the logs\ of every folder beside the game folder with gamesv\
 *  in it. All of them, because a player can keep an old plain Remielle server next to the
 *  battlestats one, and only the battlestats server writes settlements: picking one folder picked
 *  the wrong one. A logs\ folder may not exist until the server's first settlement. */
function serverLogsDirs(root) {
  const gameDir = path.dirname(root);
  const dirs = [];
  try {
    const configured = fs.readFileSync(path.join(root, ".tools", "server-logs.txt"), "utf8").replace(/^﻿/, "").trim();
    if (configured) dirs.push(path.resolve(gameDir, configured));
  } catch {}
  try {
    const parent = path.dirname(gameDir);
    for (const d of fs.readdirSync(parent, { withFileTypes: true })) {
      if (d.isDirectory() && fs.existsSync(path.join(parent, d.name, "gamesv"))) dirs.push(path.join(parent, d.name, "logs"));
    }
  } catch {}
  return [...new Set(dirs.map((d) => path.resolve(d).toLowerCase()))].map((lower) => dirs.find((d) => path.resolve(d).toLowerCase() === lower));
}

/** Battles the DLL has finished with (battle.txt written). `judged` ones were found unsettled
 *  before; they are looked at again on every run until they are pruned, so a settlement the
 *  logger was not watching at the time (a wrong server folder) still publishes them once it is. */
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
      const judged = fs.existsSync(path.join(dir, "no-settlement.txt"));
      let info;
      try {
        info = Object.fromEntries(
          fs.readFileSync(path.join(dir, "battle.txt"), "utf8").split(/\r?\n/).filter(Boolean).map((l) => l.split("=")),
        );
      } catch {
        continue; // still running, or from before battle.txt existed
      }
      out.push({ dir, awake: +info.awake_unix_ms, destroy: +info.destroy_unix_ms, hits: +info.hits, judged });
    }
  }
  return out.sort((a, b) => a.awake - b.awake);
}

/** The settlement the server wrote while this battle ran (the latest, if somehow several). */
function findSettlement(battle, logsDirs) {
  let best = null;
  for (const logsDir of logsDirs) {
    let names = [];
    try {
      names = fs.readdirSync(logsDir);
    } catch {
      continue; // no settlement written there yet
    }
    for (const name of names) {
      const m = /^endbattle_(\d+)\.pb$/.exec(name);
      if (!m) continue;
      const file = path.join(logsDir, name);
      const t = fs.statSync(file).mtimeMs;
      if (t < battle.awake - 2000 || t > battle.destroy + SETTLEMENT_GRACE_MS) continue;
      if (!best || t > best.t) best = { n: +m[1], file, t };
    }
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
  const logsDirs = serverLogsDirs(root);
  if (!logsDirs.length) note("no server logs folder found (.tools\\server-logs.txt, or a server folder beside the game folder); publishing every battle with a hit");
  for (const battle of stagedBattles(root)) {
    try {
      // A battle that recorded no damage has nothing to show, settled or not (entered and left
      // without fighting: settled battles of 14 s to 7 min with 0 damage rows became empty folders).
      const result = resultFileOf(battle.dir);
      if (!result || !hasHits(result)) {
        if (!battle.judged) {
          fs.writeFileSync(path.join(battle.dir, "no-settlement.txt"), "no damage recorded\r\n");
          note(`${battle.dir}: no damage recorded, left in diagnostics`);
        }
        continue;
      }
      if (!logsDirs.length) {
        note(`${publishWithoutServer(root, battle)}: published (no server to check)`);
        continue;
      }
      let settlement = findSettlement(battle, logsDirs);
      // The level can close before the server has written the file; give it a moment.
      while (!settlement && Date.now() < battle.destroy + SETTLEMENT_GRACE_MS) {
        await sleep(2000);
        settlement = findSettlement(battle, logsDirs);
      }
      if (settlement) {
        const dest = publish(root, battle, settlement);
        fs.rmSync(path.join(dest, "no-settlement.txt"), { force: true });
        note(`${dest}: settled as ${path.basename(settlement.file)}${battle.judged ? " (found on a later look)" : ""}`);
      } else if (!battle.judged) {
        fs.writeFileSync(path.join(battle.dir, "no-settlement.txt"), "the server wrote no settlement while this battle ran (retried or quit)\r\n");
        note(`${battle.dir}: no settlement, left in diagnostics`);
      }
    } catch (e) {
      note(`${battle.dir}: FAILED to publish: ${e.message}`);
    }
  }
}

/** Visible battle folders (<day>\<battle>) with hits and without both combat-log.xlsx and
 *  combat-log.json (a folder an earlier version summarized is summarized again). */
function unsummarized(root) {
  const out = [];
  for (const day of fs.readdirSync(root, { withFileTypes: true })) {
    if (!day.isDirectory() || day.name.startsWith(".")) continue;
    for (const battle of fs.readdirSync(path.join(root, day.name), { withFileTypes: true })) {
      if (!battle.isDirectory()) continue;
      const dir = path.join(root, day.name, battle.name);
      const result = resultFileOf(dir);
      const done = fs.existsSync(path.join(dir, "combat-log.json")) && fs.existsSync(path.join(dir, "combat-log.xlsx"));
      if (result && hasHits(result) && !done) out.push(dir);
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
      if (todo.length === 0 && stagedBattles(root).every((b) => b.judged)) break;
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
