// Join events.tsv (animator events, eventlog.zig) with hits.tsv (attack patterns, hitlog.zig):
// state entries per entity, the hits each state produced, hitless states, and projectile
// launch -> impact pairs with the flight-time distribution. node events-timeline.mjs <archive-dir>
//   reads   events.tsv, hits.tsv (with the `stack` column for hit-path classification)
//   writes  state-timeline.csv, projectile-pairs.csv, persistent-sources.csv, events-summary.json
// Join key: events.tsv `owner` == hits.tsv `arg2` (the entity). Clocks are shared.
// Docs: docs/action-start-hook-plan.md, 2026-09-18 updates.
import fs from "node:fs";
import path from "node:path";
const dir = process.argv[2];
if (!dir) { console.error("usage: node events-timeline.mjs <archive-dir>"); process.exit(2); }

function loadTsv(file) {
  const lines = fs.readFileSync(file, "utf8").split("\n");
  let header = null; const rows = [];
  for (const line of lines) {
    if (!line) continue;
    const p = line.split("\t");
    if (!header) { header = p; continue; }
    const o = {}; header.forEach((h, i) => (o[h] = p[i] ?? "")); rows.push(o);
  }
  return { header, rows };
}
const csvCell = (v) => (/[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
const writeCsv = (name, cols, rows) =>
  fs.writeFileSync(path.join(dir, name), [cols.join(","), ...rows.map((r) => cols.map((c) => csvCell(r[c] ?? "")).join(","))].join("\n") + "\n");
const median = (xs) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : null; };

const events = loadTsv(path.join(dir, "events.tsv")).rows.map((r) => ({
  t: +r.elapsed_ms, owner: r.owner, component: r.component, event: r.event, cls: r.className,
  f0: +r.f0, f1: +r.f1, len: +r.f2, trigger: +r.trigger,
}));
const hitsAll = loadTsv(path.join(dir, "hits.tsv")).rows;
const hasStack = hitsAll.length > 0 && "stack" in hitsAll[0];
// Which of the four call paths delivered the hit (3.3.2 RVAs of the frame above the adapter,
// see the plan's run-2 table). Only the dispatcher's own rows count; leaf rows duplicate them.
const PATH = { "0x1B4F0BD6": "anim", "0x161288DD": "bullet", "0x1504AC1D": "ability", "0x13CCE654": "config" };
const hits = hitsAll.filter((r) => r.via === "T").map((r) => {
  const frames = hasStack ? r.stack.split(";") : [];
  return { t: +r.elapsed_ms, owner: r.arg2, skill: r.skillId, dmg: +r.dmgPct, daze: +r.dazePct, buildup: +r.buildupPct,
    path: hasStack ? (PATH[frames[1]] ?? "?") : "?" };
});

// --- state entries -----------------------------------------------------------------------
// A state entry is the group of trigger=1 (ForceTriggerOnTransitionIn) rows an entity gets in
// one millisecond. Its span runs to the entity's next entry, or its own length if none follows.
const byOwner = new Map();
for (const e of events) { if (!byOwner.has(e.owner)) byOwner.set(e.owner, []); byOwner.get(e.owner).push(e); }
const hitsByOwner = new Map();
for (const h of hits) { if (!hitsByOwner.has(h.owner)) hitsByOwner.set(h.owner, []); hitsByOwner.get(h.owner).push(h); }

const states = [];
for (const [owner, evs] of byOwner) {
  const entries = new Map();
  for (const e of evs) {
    if (e.trigger !== 1) continue;
    if (!entries.has(e.t)) entries.set(e.t, { owner, t: e.t, len_s: e.len, classes: new Set() });
    entries.get(e.t).classes.add(e.cls);
  }
  const list = [...entries.values()].sort((a, b) => a.t - b.t);
  const ownerHits = (hitsByOwner.get(owner) ?? []).sort((a, b) => a.t - b.t);
  list.forEach((s, i) => {
    const end = i + 1 < list.length ? list[i + 1].t : s.t + Math.round(s.len_s * 1000);
    const inState = ownerHits.filter((h) => h.t >= s.t && h.t < end);
    s.end = end;
    s.signature = [...s.classes].sort().join("+");
    s.hits = inState.length;
    s.skills = [...new Set(inState.map((h) => h.skill))].join(" ");
    s.hit_offsets_ms = inState.map((h) => h.t - s.t).join(" ");
    s.paths = [...new Set(inState.map((h) => h.path))].join(" ");
    states.push(s);
  });
}
states.sort((a, b) => a.t - b.t);
writeCsv("state-timeline.csv", ["t", "owner", "len_s", "end", "signature", "hits", "skills", "paths", "hit_offsets_ms"], states);

// --- projectiles: launch -> impact ----------------------------------------------------------
// One projectile launch can produce several hits (a grenade's two halves, a lingering field
// ticking for a second), so the unit is the launch, not the hit. For each bullet-path skill, the
// launch class is the event class whose occurrences best explain that skill's hits: coverage
// (share of hits that fall within `window` ms after some occurrence) times precision (share of
// occurrences followed by any bullet-path hit on that entity). Precision is what rules out the
// per-frame housekeeping events, which precede everything. Reported, not assumed: the class
// names are obfuscated and the choice, with runners-up, is in events-summary.json.
const window = 600; // launch -> first impact
const linger = 2000; // later hits of the same skill attach to the most recent launch within this
const bulletHits = hits.filter((h) => h.path === "bullet");
const bulletSkills = [...new Set(bulletHits.map((h) => h.skill))];
const launchBySkill = {};
const pairs = [];
for (const skill of bulletSkills) {
  const skillHits = bulletHits.filter((h) => h.skill === skill);
  const owners = new Set(skillHits.map((h) => h.owner));
  const classes = new Set(events.filter((e) => e.trigger !== 1 && owners.has(e.owner)).map((e) => e.cls));
  const ranked = [];
  for (const cls of classes) {
    const occ = events.filter((e) => e.cls === cls && e.trigger !== 1 && owners.has(e.owner));
    const explained = new Set(); const firstDelays = [];
    let followed = 0;
    for (const e of occ) {
      const mine = skillHits.filter((h) => h.owner === e.owner && h.t >= e.t && h.t - e.t <= window);
      if (bulletHits.some((h) => h.owner === e.owner && h.t >= e.t && h.t - e.t <= window)) followed++;
      if (mine.length) { firstDelays.push(mine[0].t - e.t); mine.forEach((h) => explained.add(h)); }
    }
    const coverage = explained.size / skillHits.length, precision = occ.length ? followed / occ.length : 0;
    if (coverage === 0) continue;
    ranked.push({ cls, coverage, precision, score: coverage * precision, occurrences: occ.length, launches: firstDelays.length,
      median: median(firstDelays), min: Math.min(...firstDelays), max: Math.max(...firstDelays) });
  }
  ranked.sort((a, b) => b.score - a.score || a.median - b.median);
  // Below 80 % precision the class fires too often to be the spawn (a per-frame event scored
  // 54 % on a lingering field's ticks); report the runner-up list instead of pairing on it.
  const usable = ranked.filter((c) => c.precision >= 0.8 && c.coverage >= 0.5);
  const best = usable[0] ?? null;
  launchBySkill[skill] = { hits: skillHits.length, launch: best, alternatives: ranked.filter((c) => c !== best).slice(0, 4) };
  if (!best) continue; // autonomous summons: no launch on the Agent
  const launches = events.filter((e) => e.cls === best.cls && e.trigger !== 1 && owners.has(e.owner)).sort((a, b) => a.t - b.t);
  const taken = new Set();
  for (const e of launches) {
    const next = launches.find((x) => x.owner === e.owner && x.t > e.t);
    const limit = Math.min(e.t + linger, next ? next.t : Infinity);
    const mine = skillHits.filter((h) => !taken.has(h) && h.owner === e.owner && h.t >= e.t && h.t < limit);
    if (!mine.length || mine[0].t - e.t > window) continue;
    mine.forEach((h) => taken.add(h));
    const state = states.filter((s) => s.owner === e.owner && s.t <= e.t).pop();
    pairs.push({ skill, owner: e.owner, state_t: state?.t ?? "", state_len_s: state?.len_s ?? "", launch_offset_ms: state ? e.t - state.t : "",
      launch_norm: e.f1, launch_t: e.t, first_impact_t: mine[0].t, flight_ms: mine[0].t - e.t, hits: mine.length,
      last_impact_ms: mine[mine.length - 1].t - e.t, dmg_total: mine.reduce((a, h) => a + h.dmg, 0).toFixed(6), launch_class: best.cls });
  }
}
pairs.sort((a, b) => a.launch_t - b.launch_t);
writeCsv("projectile-pairs.csv", ["skill", "owner", "state_t", "state_len_s", "launch_offset_ms", "launch_norm", "launch_t", "first_impact_t", "flight_ms", "hits", "last_impact_ms", "dmg_total", "launch_class"], pairs);

// --- persistent sources: fields and summons ---------------------------------------------------
// A bullet-path skill the launch pairing could not resolve is usually one spawn followed by many
// ticks: a lingering field (a dozen ticks in under a second) or an autonomous summon (Rina's
// drones: one deploy, hits for 48 s while she is off field). Group its hits into bursts (gap >
// `burst_gap`), then take the deploy as the nearest preceding event on the owner of a spawn
// class proven by the confident skills above. Spawn classes are config event *types*, shared by
// every Agent (Rina's drones deploy with the same IJIGCMCCGNF as Grace's projectiles), so the
// set is global. A deploy may be the state-entry occurrence itself (trigger 1): Rina's is.
const burst_gap = 1000;
const sources = [];
const spawnClasses = new Set(pairs.map((p) => p.launch_class));
for (const [skill, v] of Object.entries(launchBySkill)) {
  if (v.launch) continue;
  const skillHits = bulletHits.filter((h) => h.skill === skill).sort((a, b) => a.t - b.t);
  const bursts = [];
  for (const h of skillHits) {
    const cur = bursts[bursts.length - 1];
    if (cur && h.owner === cur.owner && h.t - cur.hits[cur.hits.length - 1].t <= burst_gap) cur.hits.push(h);
    else bursts.push({ owner: h.owner, hits: [h] });
  }
  for (const b of bursts) {
    const t0 = b.hits[0].t, t1 = b.hits[b.hits.length - 1].t;
    const evs = (byOwner.get(b.owner) ?? []).filter((e) => e.t <= t0);
    let deploy = null;
    for (let i = evs.length - 1; i >= 0 && !deploy; i--) if (spawnClasses.has(evs[i].cls)) deploy = evs[i];
    const state = deploy ? states.filter((st) => st.owner === b.owner && st.t <= deploy.t).pop() : null;
    const intervals = b.hits.slice(1).map((h, i) => h.t - b.hits[i].t);
    sources.push({ skill, owner: b.owner, first_hit_t: t0, last_hit_t: t1, active_ms: t1 - t0, hits: b.hits.length,
      interval_median_ms: median(intervals) ?? "", interval_min_ms: intervals.length ? Math.min(...intervals) : "", interval_max_ms: intervals.length ? Math.max(...intervals) : "",
      deploy_class: deploy?.cls ?? "", deploy_t: deploy?.t ?? "", deploy_to_first_hit_ms: deploy ? t0 - deploy.t : "",
      state_t: state?.t ?? "", state_len_s: state?.len_s ?? "", deploy_offset_ms: state && deploy ? deploy.t - state.t : "",
      dmg_total: b.hits.reduce((a, h) => a + h.dmg, 0).toFixed(6) });
  }
}
writeCsv("persistent-sources.csv", ["skill", "owner", "state_t", "state_len_s", "deploy_class", "deploy_offset_ms", "deploy_t", "deploy_to_first_hit_ms", "first_hit_t", "last_hit_t", "active_ms", "hits", "interval_min_ms", "interval_median_ms", "interval_max_ms", "dmg_total"], sources);

// --- summary ---------------------------------------------------------------------------
const hitless = states.filter((s) => s.hits === 0);
const sigCount = new Map();
for (const s of hitless) { const k = `${s.owner.slice(-5)} ${s.len_s.toFixed(3)}s ${s.signature}`; sigCount.set(k, (sigCount.get(k) ?? 0) + 1); }
const summary = {
  events: events.length, hits: hits.length, entities: byOwner.size, event_classes: new Set(events.map((e) => e.cls)).size,
  hits_by_path: Object.fromEntries([...new Set(hits.map((h) => h.path))].map((p) => [p, hits.filter((h) => h.path === p).length])),
  state_entries: states.length, with_hits: states.length - hitless.length, hitless: hitless.length,
  hitless_signatures: [...sigCount].sort((a, b) => b[1] - a[1]).map(([k, n]) => ({ signature: k, n })),
  projectiles: Object.fromEntries(Object.entries(launchBySkill).map(([skill, v]) => [skill, {
    hits: v.hits, launch_class: v.launch?.cls ?? null, coverage: v.launch?.coverage ?? 0, precision: v.launch?.precision ?? 0,
    flight_ms: v.launch ? { min: v.launch.min, median: v.launch.median, max: v.launch.max } : null,
    launches: pairs.filter((p) => p.skill === skill).length,
    hits_per_launch: median(pairs.filter((p) => p.skill === skill).map((p) => p.hits)), alternatives: v.alternatives,
  }])),
};
fs.writeFileSync(path.join(dir, "events-summary.json"), JSON.stringify(summary, null, 1));

console.log(`${events.length} events, ${hits.length} dispatcher hits, ${byOwner.size} entities; hits by path ${JSON.stringify(summary.hits_by_path)}`);
console.log(`state entries ${states.length}: ${summary.with_hits} with hits, ${hitless.length} hitless`);
console.log("projectiles (bullet-path skills):");
for (const [skill, v] of Object.entries(summary.projectiles)) {
  if (v.launch_class) console.log(`  ${skill}: ${v.hits} hits from ${v.launches} launches (${v.hits_per_launch}/launch), launch ${v.launch_class} (coverage ${Math.round(v.coverage * 100)}%, precision ${Math.round(v.precision * 100)}%), first impact ms min/median/max ${v.flight_ms.min}/${v.flight_ms.median}/${v.flight_ms.max}`);
  else {
    const src = sources.filter((x) => x.skill === skill);
    const deployed = src.filter((x) => x.deploy_class !== "");
    console.log(`  ${skill}: ${v.hits} hits, persistent source: ${src.length} burst(s), ${deployed.length} with a deploy event` +
      (deployed.length ? ` (${deployed[0].deploy_class}, ${Math.round(median(deployed.map((x) => x.deploy_to_first_hit_ms)))} ms to first hit)` : "") +
      `; active ms ${src.map((x) => x.active_ms).join("/")}, hits ${src.map((x) => x.hits).join("/")}, tick median ms ${src.map((x) => x.interval_median_ms).join("/")}`);
  }
}
console.log(`wrote state-timeline.csv (${states.length}), projectile-pairs.csv (${pairs.length}), persistent-sources.csv (${sources.length}), events-summary.json`);
