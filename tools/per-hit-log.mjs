// Per-hit log from a schema-5 result capture (lean a8 strings), plus the settlement check and
// the gauge probes. node per-hit-log.mjs <archive-dir>
//   reads   damage-result-*.tsv (schema 5), endbattle_*.pb (optional), damage-snapshot-*.tsv,
//           damage-daze-*.tsv, damage-anomaly-*.tsv, damage-stun-*.tsv (all optional)
//   writes  per-hit-log.csv, settlement-check.json, snapshot-log.csv, daze-log.csv, anomaly-log.csv,
//           stun-log.csv (each when its capture exists)
// Field offsets in the 0x290 result (all established against actions.json / the settlement,
// see docs/reference/damage-probe-howto.md): every value is what the game applied for that hit.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { identityIndex, attribute } from "./attribution.mjs";
const dir = process.argv[2];
if (!dir) { console.error("usage: node per-hit-log.mjs <archive-dir>"); process.exit(2); }
const here = path.dirname(fileURLToPath(import.meta.url));
const mapFile = path.join(here, "attack-property-skill-map.json");
const mapAvailable = fs.existsSync(mapFile);
const skillMap = mapAvailable ? JSON.parse(fs.readFileSync(mapFile, "utf8")).map : {};
// The client's AttackProperty -> skill id table (generate-attack-property-skills.mjs): names
// projectile hits of any Agent, including ones with no hand map entry.
const clientMapFile = path.join(here, "attack-property-client-skills.json");
const clientMap = fs.existsSync(clientMapFile) ? JSON.parse(fs.readFileSync(clientMapFile, "utf8")).map : {};
// Default report preserves historical accounting. --all-skills includes newly identified
// enemy/guest skills too; the CSV always exposes the capture-derived attribution.
const allSkills = process.argv.includes("--all-skills");
if (!mapAvailable) console.warn("Skill map absent: identity attribution remains available; fallback and historical report scope are unavailable.");

function loadTsv(file) {
  const lines = fs.readFileSync(file, "utf8").split("\n");
  let header = null, schema = null; const rows = [];
  for (const line of lines) {
    if (!line) continue;
    if (line.startsWith("#")) { schema = line; continue; }
    const p = line.split("\t");
    if (!header) { header = p; continue; }
    const o = {}; header.forEach((h, i) => (o[h] = p[i] ?? "")); rows.push(o);
  }
  return { schema, header, rows };
}
const utf16 = (hex) => Buffer.from(hex, "hex").toString("utf16le");

// --- result rows -------------------------------------------------------------------------
const resultFile = fs.readdirSync(dir).find((f) => /^damage-result-.*\.tsv$/.test(f));
if (!resultFile) { console.error("no damage-result-*.tsv in " + dir); process.exit(2); }
const res = loadTsv(path.join(dir, resultFile));
if (!/schema=5\b/.test(res.schema || "")) { console.error("expected schema=5, got: " + res.schema); process.exit(2); }
// Result-object layout per client build. The client shuffles class layouts every build, so every
// offset below is re-derived on update (docs/client-update-playbook.md, "Re-pointing the probes"):
// 3.3.2 values come from aligning the 3.3.0/3.3.2 bodies of the hit-result factory (writes the
// stat copies), the result converter (reads damage/crit/attacker) and the result class's own
// getters/setters, plus field types for the pointer fields. target_state was only ever labelled
// empirically and was re-labelled the same way from capture 20260913-132556: the float whose value
// set is {1,3,5,6} in the 3.3.0 proportions (3 = stunned, 420 rows).
// daze / daze_requested (formerly "buildup_est" and its unnamed near-twin) are code-anchored since
// 2026-09-18 (docs/damage-probe-howto.md, "Per-hit Daze"): the target's stun component writes
// result+0x18c = CurStun_after - CurStun_before (the Daze the gauge received, clamped at MaxStun;
// 3.3.0 PHIPMJHEJBH::GOBDAKFLFKI @ 0x1B1B7BD0 -> +0x134; 3.3.2 GILABPBBMJH::JKAJPLNGPEK @ 0x1A4F76A0)
// and result+0x250 = the requested delta after the take-ratio multiplier, before the clamp (3.3.0
// DNMNLFKJJPC @ 0x1B1AD6F0 -> +0x184; 3.3.2 JCELMPFPFBH @ 0x1A4F1430). Both are written before
// the result converter runs, so the result probe's snapshot carries the values of the same hit.
// buildup_requested / buildup_applied (3.3.2 only; 3.3.0 offsets not traced): the hit's Anomaly
// Buildup, written at hit-result construction to result+0xf8 (GOOCOICILAJ::KAFEKGEDAAI, the
// snapshot factory, and its anim-event sibling), and the amount the target's per-element gauge
// actually took, written to result+0x150 by PNNLDJHFOAO::BAIEOPOHGNL @ 0x19235B40 (gauge
// cur +0x6c, max +0x8c: after = clamp(cur + requested, 0, max); applied = after - cur). A hit
// with requested > 0 and applied == 0 was refused by JIDDJOHMOLF::ODJNEPMDHLA (element locked /
// anomaly state) or matched no gauge. See docs/damage-probe-howto.md, "Per-hit Anomaly Buildup".
const LAYOUTS = {
  "CNBetaWin3.3.0": { attacker_entity: 0x20, target_entity: 0x90, damage: 0x138, crit: 0x200, hit_split: 0x280, dmg_mv: 0x168, daze_mv: 0x164, energy: 0x1b8, decibels: 0x144,
    daze: 0x134, daze_requested: 0x184, buildup_requested: null, buildup_applied: null, atk: 0x180, impact: 0x1bc, anomaly_mastery: 0x238, anomaly_proficiency: 0x25c, level: 0x1b4, target_state: 0x130, dmg_mult: 0x118, f11c: 0x11c, f174: 0x174, f0f8: 0xf8, display_skill_id: 0x284,
    snapshot_atk: 0x130, a8: { ability: 0, attack_property: 2, other: 1 } }, // slot columns a8s10 / a8s18 / a8s20
  "CNBetaWin3.3.2": { attacker_entity: 0x10, target_entity: 0x68, damage: 0x200, crit: 0x214, hit_split: 0x274, dmg_mv: 0x260, daze_mv: 0x144, energy: 0x100, decibels: 0x21c,
    daze: 0x18c, daze_requested: 0x250, buildup_requested: 0xf8, buildup_applied: 0x150, atk: 0x23c, impact: 0x1ac, anomaly_mastery: 0xfc, anomaly_proficiency: 0x254, level: 0x1d4, target_state: 0x174, dmg_mult: 0x15c, f11c: 0x284, f174: 0x138, f0f8: 0x19c, display_skill_id: 0x194,
    // the per-hit name object's three string slots moved to +0x10/+0x20/+0x28. Pinned by content
    // on capture 20260913-132556 (1405 rows): +0x20 = ability name, +0x28 = AttackProperty name,
    // +0x10 = the third slot, which was empty in every 3.3.0 capture and now carries the
    // *triggering* AttackProperty on anomaly ticks (Player_ElementAbnormalBuff rows). The first
    // 3.3.2 capture's columns are still named a8s10/a8s18/a8s20 (header fixed afterwards to
    // a8s10/a8s20/a8s28), hence roles by slot index, not column name.
    snapshot_atk: 0x194, a8: { ability: 1, attack_property: 2, other: 0 } },
  // CNBetaWin3.3.3, from capture 20260923-024209 (1341 result rows). DERIVED BY MEASUREMENT, not by
  // disassembly: the daze and anomaly probes each log a gauge's cur_before, so the applied value is
  // ground truth, and the result probe dumps the object raw -- the field is whichever offset equals
  // that value on (nearly) every hit. Joined per hit by result_ptr AND elapsed_ms within 50 ms, so
  // each row is tested against ONE expected value rather than any value for that pointer.
  //   daze 0xd4 / daze_requested 0x1a0: both match 92% of joinable rows; equal on 532 of 533 non-zero
  //     rows and diverging exactly once (0x1a0 = 156.279 vs 0xd4 = 6.076), which is the MaxStun clamp
  //     -- so 0x1a0 is pre-clamp, 0xd4 applied. 0xd4 is also what tools/update/offsetdiff2.py read out
  //     of the daze handler's own code (0x18c -> 0xd4), so it is confirmed two independent ways.
  //   buildup_requested 0x114 / buildup_applied 0x21c: initially empirical. 0x114 matches wherever 0x21c does plus
  //     5 rows more, and where the gauge clamped at max 0x114 > 0x21c (3 of 3, never the reverse) --
  //     the requested/applied signature. Now independently confirmed by the full 548-instruction
  //     gauge function (100% alignment): reads +0x114, writes the clamped delta to +0x21c.
  // Remaining fields verified 2026-09-23 against the high-crit session 20260923-030316-8408.
  // See docs/decoder-333-validation.md for instruction witnesses and independent UI matches.
  // crit +0xe4 is the 0/2 enum: 1,389 unique damage/time matches agree with the UI's !! marker.
  // The earlier rejection based on pooled damage averages was invalid (different hit populations).
  // Full-method converter alignment maps +0x214 -> +0xe4; do not stop at its first early return.
  // Factory stat writes map ATK +0x23c -> +0x178, Impact +0x1ac -> +0x108,
  // AP +0x254 -> +0x1d0, AM +0xfc -> +0x230; snapshot ATK is read at +0xe8.
  // Energy +0x190: 75-instruction copy function and 24-instruction reset both align 100%.
  // The name slots also shuffled: +0x20 is AttackProperty; +0x28 is ability, including anomaly.
  "CNBetaWin3.3.3": { attacker_entity: 0x58, target_entity: 0xb8, damage: 0x12c, crit: 0xe4, hit_split: 0x1ec, dmg_mv: 0x1a8, daze_mv: 0x170, energy: 0x190, decibels: 0xe0,
    daze: 0xd4, daze_requested: 0x1a0, buildup_requested: 0x114, buildup_applied: 0x21c, atk: 0x178, impact: 0x108, anomaly_mastery: 0x230, anomaly_proficiency: 0x1d0, level: 0x1b4, target_state: 0x158, dmg_mult: 0x194, f11c: 0x14c, f174: 0x284, f0f8: 0x1b8, display_skill_id: 0xf0,
    target_state_int: true,
    snapshot_atk: 0xe8, a8: { ability: 2, attack_property: 1, other: 0 } },
  // CNBetaWin3.3.4, derived OFFLINE 2026-09-25 by register-disciplined witness diffs (the
  // converter at 0.997/747, factory at 0.999/1408, daze handler 1.0/666, anomaly handler
  // 1.0/548 -- pairs counted only on each function's RESULT register), witnesses in
  // sheet-webapp/local-data/client-update-334/. Independent second witnesses where 3.3.3 had
  // them: crit follows the converter's same enum read (+0xe4 -> +0x19c); energy from the
  // 75-instruction copy AND the 24-instruction reset (+0x190 -> +0x188); target_entity is the
  // only OTHER EntityHandle field (attacker's +0x68 is code-pinned); snapshot_atk from the
  // read-feeds-write pair with the result ATK store. NULLS are honest gaps to be measured from
  // the FIRST 3.3.4 capture exactly as 3.3.3 did: daze_requested and target_state were
  // measurement-derived fields with no code witness in the four functions.
  // Measured 2026-09-25 from the first 3.3.4 battle (20260925-192126, battle-1, 2004 result rows):
  //   a8 slot mapping CONFIRMED -- decoded ability/AttackProperty names are real kit names.
  //   daze_requested 0x17c: equals the daze probe's (target_value - cur_before) on 840/840
  //     joined rows, and vs applied 0x240 it is equal on 1063 rows and diverges on 13, always
  //     requested > applied -- the MaxStun-clamp signature that ordered the 3.3.3 pair.
  //   target_state: NO offset in the 0x2b0 dump encodes "stunned" this build (value-agnostic
  //     byte/int sweep on the stun-logged target: nothing above precision 0.9/recall 0.8 vs the
  //     two StunBuffModifier windows). Left null: state.tsv is the authoritative Stun source
  //     since 2026-09-22 and judge-capture only uses per-hit target_state on OLDER captures.
  "CNBetaWin3.3.4": { attacker_entity: 0x68, target_entity: 0x20, damage: 0x118, crit: 0x19c, hit_split: 0x184, dmg_mv: 0xf0, daze_mv: 0x278, energy: 0x188, decibels: 0x168,
    daze: 0x240, daze_requested: 0x17c, buildup_requested: 0x1f0, buildup_applied: 0x174, atk: 0x110, impact: 0x134, anomaly_mastery: 0x258, anomaly_proficiency: 0x21c, level: 0x190, target_state: null, dmg_mult: 0x1fc, f11c: 0x200, f174: 0x1b0, f0f8: 0x1bc, display_skill_id: 0x208,
    target_state_int: true, attn_col: "s58", // attenuation string is result+0x88, the THIRD sorted slot this build (column s58); older builds default to sa0
    snapshot_atk: 0x188, a8: { ability: 2, attack_property: 1, other: 0 } },
};
const client = (res.schema.match(/client=(\S+)/) || [])[1];
const L = LAYOUTS[client];
if (!L) { console.error("no result layout for " + client + "; known: " + Object.keys(LAYOUTS).join(", ")); process.exit(2); }
const Fo = (b, o) => (o == null ? "" : b.readFloatLE(o));
// slot columns are whatever the probe wrote (a8s<hex>_length/_hex triples), in offset order
const slotCols = res.header.filter((h) => /^a8s[0-9a-f]+_length$/.test(h)).map((h) => h.slice(0, -"_length".length));
if (slotCols.length !== 3) { console.error("expected three a8 string slots, got " + slotCols.join(",")); process.exit(2); }
function a8Names(r) {
  const slots = slotCols.map((k) => (+r[k + "_length"] > 0 ? utf16(r[k + "_hex"]) : ""));
  return { ability: slots[L.a8.ability], prop: slots[L.a8.attack_property], other: slots[L.a8.other] };
}

function modifiers(row) {
  // keys60: slot:length:bytes:utf16hex| ; entries60_hex: 24-byte slots, float value at +16
  const entries = Buffer.from(row.entries60_hex || "", "hex");
  const out = [];
  for (const cell of (row.keys60 || "").split("|")) {
    if (!cell) continue;
    const [slot, , , hex] = cell.split(":");
    const i = +slot; if (i * 24 + 20 > entries.length) continue;
    out.push(utf16(hex || "") + "=" + +entries.readFloatLE(i * 24 + 16).toPrecision(6));
  }
  return out.join(";");
}
// A null offset means "not established for this client build" and must render as an empty cell, not
// throw and not read at +0. Only Fo handled that; F/I/Q now do too, because a partially-derived
// layout (CNBetaWin3.3.3) is the normal state right after a client patch.
const F = (b, o) => (o == null ? "" : b.readFloatLE(o)), I = (b, o) => (o == null ? "" : b.readInt32LE(o)),
      Q = (b, o) => (o == null ? "" : "0x" + b.readBigUInt64LE(o).toString(16));
const cols = ["seq", "elapsed_ms", "thread", "attacker_entity", "target_entity", "ability_name", "attack_property_name", "skill_id", "skill_id_source",
  "hit_split", "damage_unrounded", "damage_ceil", "crit", "dmg_mv", "daze_mv", "energy", "decibels", "daze", "daze_requested", "buildup_requested", "buildup_applied",
  "atk", "impact", "anomaly_mastery", "anomaly_proficiency", "level", "target_state", "dmg_mult", "attenuation_curve", "attenuation", "f11c", "f174", "f0f8", "display_skill_id", "a8_str18", "modifiers"];
// attenuation_curve: the result's fifth string slot (3.3.2 +0xb8, 3.3.0 +0xa0; probe column sa0), e.g.
// DistanceAttenuation_Lisa / DistanceAttenuation_Curve_01, empty on anomaly ticks and field hits.
// The stun component's applier multiplies the hit's Daze by that curve evaluated on the
// attacker-target distance (HEGDGDNNAGM::NKNMBBMLGGE(curve, attacker, target, result)), and the
// damage path applies the same factor: capture 20260918-181913, Grace's opening hits at 0.70 /
// 0.907 of both damage and Daze, 1.0 once in range. `attenuation` is that factor measured from the
// daze log (daze_requested / (target_value - cur_before)); filled only when a daze log is present
// and the hit carried Daze. See docs/damage-probe-howto.md, "Distance attenuation".

const triggerFile = path.join(dir, "hits.tsv");
const identity = identityIndex(fs.existsSync(triggerFile) ? loadTsv(triggerFile).rows : []);
const warnings = new Set();
const warn = (message) => { if (!warnings.has(message)) { warnings.add(message); console.error(message); } };
const rawJoinFields = new Map(); // Compare raw float32 values, never CSV display rounding.
const hits = []; const rawResultPtr = new Map(); // result_ptr per row, for the daze-log join
for (const r of res.rows) {
  const b = Buffer.from(r.result_hex, "hex"); rawResultPtr.set(+r.sequence, r.result_ptr);
  if (b.length < 0x290) { hits.push({ seq: r.sequence, elapsed_ms: r.elapsed_ms, thread: r.thread, incomplete: b.length }); continue; }
  rawJoinFields.set(+r.sequence, { daze_mv: F(b, L.daze_mv), impact: F(b, L.impact), buildup_requested: F(b, L.buildup_requested) });
  const { ability, prop, other: s18 } = a8Names(r);
  const mapped = prop ? skillMap[prop] : undefined;
  const attribution = attribute({ ability, prop, buffer: b, client, index: identity, map: skillMap, clientMap, warn });
  const damage = F(b, L.damage);
  const p6 = (v) => (v === "" ? "" : +v.toPrecision(6));
  const prec = (v, digits) => (v === "" ? "" : +v.toPrecision(digits));
  hits.push({
    seq: +r.sequence, elapsed_ms: +r.elapsed_ms, thread: r.thread, attacker_entity: Q(b, L.attacker_entity), target_entity: Q(b, L.target_entity),
    ability_name: ability, attack_property_name: prop, attenuation_curve: +r[(L.attn_col || "sa0") + "_length"] > 0 ? utf16(r[(L.attn_col || "sa0") + "_hex"]) : "", attenuation: "",
    skill_id: attribution.id, skill_id_source: attribution.source,
    // Map is only a cross-check and scope manifest here: never replace a derived ID.
    report_skill_id: allSkills || !mapAvailable || mapped || attribution.id === "anomaly" ? attribution.id : "",
    // prec() keeps .toPrecision() off the empty string a null offset yields (see LAYOUTS): a
    // partially-derived layout is normal right after a client patch, and an unknown field must come
    // out blank rather than crash the decode or print a number read from the wrong place.
    hit_split: prec(F(b, L.hit_split), 5), damage_unrounded: damage, damage_ceil: damage === "" ? "" : Math.ceil(damage - 1e-6), crit: L.crit == null ? "" : b[L.crit],
    dmg_mv: p6(F(b, L.dmg_mv)), daze_mv: p6(F(b, L.daze_mv)), energy: p6(F(b, L.energy)), decibels: p6(F(b, L.decibels)),
    daze: p6(Fo(b, L.daze)), daze_requested: p6(Fo(b, L.daze_requested)), buildup_requested: p6(Fo(b, L.buildup_requested)), buildup_applied: p6(Fo(b, L.buildup_applied)), atk: prec(F(b, L.atk), 7), impact: F(b, L.impact), anomaly_mastery: F(b, L.anomaly_mastery), anomaly_proficiency: prec(F(b, L.anomaly_proficiency), 7),
    // target_state is a float in 3.3.0/3.3.2 but an int32 in 3.3.3 (no float offset in the 3.3.3
    // object ever holds 3.0, and the int32 at 0x158 does), so the layout says how to read it.
    // Reading an int 3 as a float yields 4.2e-45, which silently fails the `!== 3` stun test below.
    level: I(b, L.level), target_state: L.target_state_int ? I(b, L.target_state) : Fo(b, L.target_state), dmg_mult: p6(F(b, L.dmg_mult)), f11c: F(b, L.f11c), f174: p6(F(b, L.f174)), f0f8: p6(F(b, L.f0f8)),
    display_skill_id: I(b, L.display_skill_id), a8_str18: s18, modifiers: modifiers(r),
  });
}
const csvCell = (v) => (v === undefined || v === null ? "" : /[",\n]/.test(String(v)) ? '"' + String(v).replace(/"/g, '""') + '"' : String(v));
fs.writeFileSync(path.join(dir, "per-hit-log.csv"), [cols.join(","), ...hits.map((h) => cols.map((c) => csvCell(h[c])).join(","))].join("\n") + "\n");
const complete = hits.filter((h) => !h.incomplete);
const bySource = {}; for (const h of complete) bySource[h.skill_id_source] = (bySource[h.skill_id_source] || 0) + 1;
console.log(`${hits.length} result rows (${hits.length - complete.length} incomplete); skill_id_source:`, bySource);
const unmapped = {}; for (const h of complete) if (h.skill_id_source === "unmapped") { const k = h.ability_name + " / " + h.attack_property_name; unmapped[k] = (unmapped[k] || 0) + h.damage_ceil; }
if (Object.keys(unmapped).length) console.log("unmapped AttackProperty names (damage ceil sums, reconcile against settlement leftovers):", unmapped);

// --- settlement check ------------------------------------------------------------------------
function readVarint(b, p) { let r = 0n, s = 0n; for (;;) { const c = b[p++]; r |= BigInt(c & 0x7f) << s; if (!(c & 0x80)) break; s += 7n; } return [r, p]; }
function parse(b) { const out = []; let p = 0; while (p < b.length) { let tag; [tag, p] = readVarint(b, p); const f = Number(tag >> 3n), wt = Number(tag & 7n); let v; if (wt === 0) [v, p] = readVarint(b, p); else if (wt === 1) { v = b.subarray(p, p + 8); p += 8; } else if (wt === 5) { v = b.subarray(p, p + 4); p += 4; } else if (wt === 2) { let n; [n, p] = readVarint(b, p); v = b.subarray(p, p + Number(n)); p += Number(n); } else throw new Error("wire type " + wt); out.push({ f, wt, v }); } return out; }
const pbFile = fs.readdirSync(dir).find((f) => /^endbattle_\d+\.pb$/.test(f));
const check = { capture: resultFile, settlement: pbFile || null, perSkill: {}, exact: 0, mismatched: 0, settlementOnly: [], logOnly: [] };
if (pbFile) {
  const settlement = {}; // skill id -> {damage, hits, avatar}
  // The battle-result container is top-level field 8 in the 3.3.0 protocol, 12 in 3.3.2 and 9 in
  // 3.3.4; the avatar (f6 -> f7) and per-skill (f14: id, damage, hits at f10) layout inside is
  // unchanged.
  for (const f8 of parse(fs.readFileSync(path.join(dir, pbFile))).filter((x) => (x.f === 8 || x.f === 9 || x.f === 12) && x.wt === 2))
    for (const f6 of parse(f8.v).filter((x) => x.f === 6 && x.wt === 2))
      for (const f7 of parse(f6.v).filter((x) => x.f === 7 && x.wt === 2)) {
        const avatar = parse(f7.v); const id = Number(avatar.find((x) => x.f === 1)?.v ?? 0);
        for (const f14 of avatar.filter((x) => x.f === 14 && x.wt === 2)) {
          const e = parse(f14.v); const g = (n) => Number(e.find((x) => x.f === n)?.v ?? 0);
          settlement[g(1)] = { damage: g(2), hits: g(10), avatar: id };
        }
      }
  // New Agents present in this settlement must reconcile without needing a name map.
  // Keep historical map-known log-only skills (e.g. Bangboo) for report compatibility.
  for (const h of complete) if (typeof h.skill_id === "number" && settlement[h.skill_id]) h.report_skill_id = h.skill_id;
  const outsideScope = complete.filter((h) => typeof h.skill_id === "number" && h.report_skill_id === "").length;
  if (outsideScope) console.log(`${outsideScope} newly identified non-settlement rows stay in the historical unattributed report pool; use --all-skills to include them. CSV IDs are unaffected.`);
  const logSum = {};
  for (const h of complete) if (typeof h.report_skill_id === "number") { const s = (logSum[h.report_skill_id] ||= { damage: 0, rows: 0 }); s.damage += h.damage_ceil; s.rows++; }
  for (const id of new Set([...Object.keys(settlement), ...Object.keys(logSum)])) {
    const s = settlement[id], l = logSum[id];
    check.perSkill[id] = { settlement: s?.damage ?? null, settlement_hits: s?.hits ?? null, log: l?.damage ?? null, log_rows: l?.rows ?? null, avatar: s?.avatar ?? null };
    if (s && l) { if (s.damage === l.damage) check.exact++; else check.mismatched++; }
    else if (s) check.settlementOnly.push({ skill: +id, damage: s.damage, hits: s.hits });
    else check.logOnly.push({ skill: +id, damage: l.damage, rows: l.rows });
  }
  const anomaly = complete.filter((h) => h.skill_id === "anomaly").reduce((a, h) => a + h.damage_ceil, 0);
  const unattributed = complete.filter((h) => typeof h.report_skill_id !== "number" && h.report_skill_id !== "anomaly").reduce((a, h) => a + h.damage_ceil, 0);
  check.anomalyDamage = anomaly; check.unattributedDamage = unattributed;
  check.settlementOnlyDamage = check.settlementOnly.reduce((a, x) => a + x.damage, 0);
  console.log(`settlement: ${check.exact} skills exact, ${check.mismatched} mismatched, ${check.settlementOnly.length} settlement-only (${check.settlementOnlyDamage}), ${check.logOnly.length} log-only; anomaly ${anomaly}, unattributed ${unattributed}`);
  for (const [id, v] of Object.entries(check.perSkill)) if (v.settlement !== v.log) console.log("  ", id, v);
}
fs.writeFileSync(path.join(dir, "settlement-check.json"), JSON.stringify(check, null, 1));

// --- stun windows: target_state (result+0x130) == 3 -------------------------------------------
// Established 2026-09-13 (fight 2): 3 only inside a ~19 s window on one target, and only those rows
// carry the x1.5 stun multiplier. Damage dealt during stun = the rows in each window.
{
  // A window runs from the first state-3 row on a target until that target's next non-3 row.
  // dazeBefore = the applied Daze (result+0x18c) logged on that target since its previous window
  // ended (or since the capture began), by attacker: the gauge the stun was reached with, minus any
  // Daze from sources the result probe does not see (assists, parries) and any recovery.
  const windows = []; const open = new Map(); const pending = new Map(); // target -> {total, byAttacker, rows, lastHit}
  for (const h of complete) {
    const t = h.target_entity; let cur = open.get(t);
    if (h.target_state !== 3) {
      if (cur) open.delete(t);
      const d = +h.daze || 0; if (d) { const acc = pending.get(t) || { total: 0, byAttacker: {}, rows: 0 }; acc.total += d; const a = h.attack_property_name.split("_")[0] || h.ability_name; acc.byAttacker[a] = (acc.byAttacker[a] || 0) + d; acc.rows++; acc.lastHit = { seq: h.seq, elapsed_ms: h.elapsed_ms, attack_property_name: h.attack_property_name, daze: +h.daze, daze_requested: +h.daze_requested }; pending.set(t, acc); }
      continue;
    }
    if (!cur) {
      const acc = pending.get(t); pending.delete(t);
      cur = { target: t, from: h.elapsed_ms, to: h.elapsed_ms, rows: 0, damage: 0, anomaly: 0, dazeBefore: acc ? +acc.total.toFixed(3) : 0, dazeBeforeRows: acc?.rows ?? 0, dazeBeforeByAttacker: acc ? Object.fromEntries(Object.entries(acc.byAttacker).map(([k, v]) => [k, +v.toFixed(3)])) : {}, lastDazeHit: acc?.lastHit ?? null };
      windows.push(cur); open.set(t, cur);
    }
    cur.to = h.elapsed_ms; cur.rows++; if (h.skill_id === "anomaly") cur.anomaly += h.damage_ceil; else cur.damage += h.damage_ceil;
    if (+h.daze) cur.dazeDuringStun = (cur.dazeDuringStun || 0) + +h.daze; // expected 0: a stunned target takes no Daze
  }
  check.stunWindows = windows;
  fs.writeFileSync(path.join(dir, "settlement-check.json"), JSON.stringify(check, null, 1));
  if (windows.length) console.log("stun windows (target_state 3):", windows.map((w) => (w.from / 1000).toFixed(1) + "-" + (w.to / 1000).toFixed(1) + "s " + w.rows + " rows, direct " + w.damage + ", anomaly " + w.anomaly + ", daze before " + w.dazeBefore + " over " + w.dazeBeforeRows + " hits" + (w.lastDazeHit && w.lastDazeHit.daze < w.lastDazeHit.daze_requested - 1e-3 ? " (last hit clamped: " + w.lastDazeHit.daze + " of " + w.lastDazeHit.daze_requested + ")" : "")).join("; "));
  else console.log("stun windows: none (no target_state 3 rows)");
}

// --- Daze widget rows --------------------------------------------------------------------
const stunFile = fs.readdirSync(dir).find((f) => /^damage-stun-.*\.tsv$/.test(f));
if (stunFile) {
  const st = loadTsv(path.join(dir, stunFile));
  const scols = ["seq", "elapsed_ms", "thread", "hook", "this", "arg1_f32", "arg2_i32", "arg3_f32", "arg4_i32", "caller_rva", "nearest_hit_seq", "nearest_hit_dt_ms", "nearest_hit_attack_property"];
  const out = [];
  for (const r of st.rows) {
    const t = +r.elapsed_ms; let best = null;
    for (const h of complete) { const dt = t - h.elapsed_ms; if (dt >= -50 && dt <= 200 && (!best || Math.abs(dt) < Math.abs(best.dt))) best = { h, dt }; }
    out.push({ seq: r.sequence, elapsed_ms: r.elapsed_ms, thread: r.thread, hook: r.hook, this: r.this, arg1_f32: r.arg1_f32, arg2_i32: r.arg2_i32, arg3_f32: r.arg3_f32, arg4_i32: r.arg4_i32, caller_rva: r.caller_rva,
      nearest_hit_seq: best?.h.seq ?? "", nearest_hit_dt_ms: best?.dt ?? "", nearest_hit_attack_property: best?.h.attack_property_name ?? "" });
  }
  fs.writeFileSync(path.join(dir, "stun-log.csv"), [scols.join(","), ...out.map((o) => scols.map((c) => csvCell(o[c])).join(","))].join("\n") + "\n");
  const hooks = {}; for (const r of st.rows) hooks[r.hook] = (hooks[r.hook] || 0) + 1;
  const widgets = new Set(st.rows.map((r) => r.this));
  console.log(`stun widget rows: ${st.rows.length} (${JSON.stringify(hooks)}), ${widgets.size} distinct this, ${out.filter((o) => o.nearest_hit_seq !== "").length} within [-50,+200] ms of a hit`);
  const first = st.rows.slice(0, 8).map((r) => `${r.elapsed_ms}ms ${r.hook} a1=${r.arg1_f32} a2=${r.arg2_i32} a3=${r.arg3_f32} a4=${r.arg4_i32}`);
  console.log("first rows:\n  " + first.join("\n  "));
}

// --- attacker snapshot rows (hit-result factory) ----------------------------------------------
// Pair by time: the factory row and its result row carry the same elapsed_ms on the same thread
// (capture 20260913-035206: 29/29 at dt = 0). Only bullet / summon / wind-region hits go through
// this factory (JJNCFKMGDDP::PCLAJDPJJMN; 3.3.2 GOOCOICILAJ::KAFEKGEDAAI); anim-event hits use a
// sibling path, so most result rows have no snapshot row. Verified per pair by snapshot ATK ==
// result ATK (3.3.0: +0x130 == +0x180; 3.3.2: +0x194 == +0x23C).
const snapFile = fs.readdirSync(dir).find((f) => /^damage-snapshot-.*\.tsv$/.test(f));
if (snapFile) {
  const sn = loadTsv(path.join(dir, snapFile));
  const used = new Set();
  const bufs = new Map(); for (const r of res.rows) bufs.set(+r.sequence, Buffer.from(r.result_hex, "hex"));
  let verified = 0; const out = [];
  const nf = 0x200 / 4; const scols = ["seq", "elapsed_ms", "thread", "result_seq", "pair_check", "attack_property_name", "snapshot_ptr", "arg2", "arg3", "arg4_ptr", "arg6_ptr", "snapshot_bytes"];
  for (let i = 0; i < nf; i++) scols.push("f" + (i * 4).toString(16).padStart(3, "0"));
  for (const r of sn.rows) {
    const b = Buffer.from(r.snapshot_hex, "hex");
    const t = +r.elapsed_ms; let h = null;
    for (const c of complete) {
      if (c.thread !== r.thread || used.has(c.seq) || Math.abs(c.elapsed_ms - t) > 1) continue;
      const rb = bufs.get(c.seq); if (L.snapshot_atk != null && L.atk != null && b.length >= L.snapshot_atk + 4 && rb && b.readFloatLE(L.snapshot_atk) === rb.readFloatLE(L.atk)) { h = c; break; }
    }
    if (h) { used.add(h.seq); verified++; }
    const check = h ? "ok" : "unpaired";
    const o = { seq: r.sequence, elapsed_ms: r.elapsed_ms, thread: r.thread, result_seq: h?.seq ?? "", pair_check: check, attack_property_name: h?.attack_property_name ?? "", snapshot_ptr: r.snapshot_ptr, arg2: r.arg2, arg3: r.arg3, arg4_ptr: r.arg4_ptr, arg6_ptr: r.arg6_ptr, snapshot_bytes: r.snapshot_bytes };
    for (let i = 0; i < nf; i++) { const off = i * 4; if (off + 4 > b.length) { o["f" + off.toString(16).padStart(3, "0")] = ""; continue; } const f = b.readFloatLE(off), n = b.readInt32LE(off); o["f" + off.toString(16).padStart(3, "0")] = n === 0 ? 0 : (Number.isFinite(f) && Math.abs(f) > 1e-6 && Math.abs(f) < 1e8 ? +f.toPrecision(7) : n); }
    out.push(o);
  }
  fs.writeFileSync(path.join(dir, "snapshot-log.csv"), [scols.join(","), ...out.map((o) => scols.map((c) => csvCell(o[c])).join(","))].join("\n") + "\n");
  console.log(`snapshot rows: ${sn.rows.length}; paired (same thread, same ms, ATK equal) ${verified}, unpaired ${sn.rows.length - verified}`);
}

// --- Daze gauge rows (stun component be-hit handler) ------------------------------------------
// damage_daze.c hooks the target's stun component handler that writes result+0x18c (3.3.2
// GILABPBBMJH::JKAJPLNGPEK). At entry this+0xd4 = CurStun before the hit and this+0xb0 = CurStun +
// the requested Daze (before the take-ratio multiplier and the MaxStun clamp); ctx+0x30 is the
// result the row belongs to. The handler runs before the result converter, so the daze row is at or
// just before its result row on the same thread; pooled result objects are reused, so the pair is
// the same result_ptr, same thread, first result row at or after the daze row within 200 ms, and
// is verified by the two result floats the probe copies (Daze MV, Impact). gauge_after = cur_before
// + applied (result daze); at a stun onset that is MaxStun. unlogged_delta = cur_before minus the
// previous paired hit's gauge_after on the same target: recovery, resets and Daze from sources the
// result probe does not see (assists, parries) show up here, nowhere else.
const dazeFile = fs.readdirSync(dir).find((f) => /^damage-daze-.*\.tsv$/.test(f));
if (dazeFile) {
  const dz = loadTsv(path.join(dir, dazeFile));
  const used = new Set(); const byTarget = new Map();
  let paired = 0, verified = 0; const out = [];
  const dcols = ["seq", "elapsed_ms", "thread", "result_seq", "pair_check", "attack_property_name", "target_entity", "target_state", "this", "entity_ptr", "result_ptr",
    "cur_before", "target_value", "requested_pre_ratio", "daze_requested", "daze", "gauge_after", "unlogged_delta", "result_daze_mv", "result_impact"];
  for (const r of dz.rows) {
    const t = +r.elapsed_ms; let h = null; let best = Infinity;
    // Same pointer, same thread, nearest later result row; the two copied floats break ties between
    // result rows of the same millisecond (capture 20260918-181913: two Rina drone hits in one ms
    // paired crosswise by time alone, one of them then looked like an unlogged 7.055 Daze).
    const floatsMatch = (hit) => { const c = rawJoinFields.get(hit?.seq); return !!c && Math.abs(+r.result_daze_mv - c.daze_mv) <= 1e-6 * Math.max(1, Math.abs(c.daze_mv)) && Math.fround(+r.result_impact) === c.impact; };
    for (const c of complete) {
      if (c.thread !== r.thread || used.has(c.seq)) continue;
      const dt = c.elapsed_ms - t; if (dt < 0 || dt > 200) continue;
      if (rawResultPtr.get(c.seq) !== r.result_ptr) continue;
      if (dt < best || (dt === best && floatsMatch(c) && !floatsMatch(h))) { best = dt; h = c; }
    }
    let check = "unpaired";
    if (h) {
      used.add(h.seq); paired++;
      const ok = floatsMatch(h);
      check = ok ? "ok" : "pointer-only"; if (ok) verified++;
    }
    const before = +r.cur_before, target = +r.target_value, applied = h ? +h.daze : NaN;
    const after = h ? before + applied : NaN;
    const prev = h ? byTarget.get(h.target_entity) : undefined;
    const o = { seq: r.sequence, elapsed_ms: r.elapsed_ms, thread: r.thread, result_seq: h?.seq ?? "", pair_check: check, attack_property_name: h?.attack_property_name ?? "",
      target_entity: h?.target_entity ?? "", target_state: h?.target_state ?? "", this: r.this, entity_ptr: r.entity_ptr, result_ptr: r.result_ptr,
      cur_before: before, target_value: target, requested_pre_ratio: +(target - before).toPrecision(7), daze_requested: h?.daze_requested ?? "", daze: h?.daze ?? "",
      gauge_after: h ? +after.toPrecision(8) : "", unlogged_delta: prev === undefined || !h ? "" : +(before - prev).toFixed(3), // 3 decimals: the gauge is a float
      result_daze_mv: r.result_daze_mv, result_impact: r.result_impact };
    if (h) byTarget.set(h.target_entity, after);
    if (h && target - before > 0.01) h.attenuation = +(+h.daze_requested / (target - before)).toFixed(4);
    out.push(o);
  }
  fs.writeFileSync(path.join(dir, "per-hit-log.csv"), [cols.join(","), ...hits.map((h) => cols.map((c) => csvCell(h[c])).join(","))].join("\n") + "\n"); // now with attenuation
  fs.writeFileSync(path.join(dir, "daze-log.csv"), [dcols.join(","), ...out.map((o) => dcols.map((c) => csvCell(o[c])).join(","))].join("\n") + "\n");
  // MaxStun: the highest gauge the target reached between the previous stun window's end and this
  // one's start. (Not "the last paired row before the window": the gauge resets to 0 at the stun,
  // and the reset can precede the first target_state == 3 row — capture 20260918-181913 had a
  // state-4 row with cur_before 0 half a second before window 2 opened.)
  const onsets = (check.stunWindows || []).map((w, i) => {
    const prevTo = (check.stunWindows || []).slice(0, i).filter((v) => v.target === w.target).pop()?.to ?? -1;
    const o = out.filter((x) => x.pair_check !== "unpaired" && x.target_entity === w.target && +x.elapsed_ms < w.from && +x.elapsed_ms > prevTo && x.gauge_after !== "").sort((a, b) => a.gauge_after - b.gauge_after).pop();
    return o ? { window_from: w.from, max_stun: o.gauge_after, last_daze_seq: o.seq } : { window_from: w.from, max_stun: null };
  });
  for (const w of check.stunWindows || []) w.maxStunFromGauge = onsets.find((o) => o.window_from === w.from)?.max_stun ?? null;
  fs.writeFileSync(path.join(dir, "settlement-check.json"), JSON.stringify(check, null, 1));
  const unlogged = out.filter((o) => o.unlogged_delta !== "" && Math.abs(o.unlogged_delta) >= 0.001);
  console.log(`daze rows: ${dz.rows.length}; paired by result pointer ${paired}, verified by Daze MV + Impact ${verified}, unpaired ${dz.rows.length - paired}; unlogged gauge changes ${unlogged.length}` +
    (onsets.length ? `; MaxStun from the gauge at stun onset: ${onsets.map((o) => o.max_stun).join(", ")}` : ""));
}

// --- Anomaly Buildup gauge rows (per-element gauge receive) -----------------------------------
// damage_anomaly.c hooks PNNLDJHFOAO::BAIEOPOHGNL (3.3.2 0x19235B40), the per-element gauge on the
// target's anomaly component receiving a hit event. Every gauge on the target receives every hit;
// only the one whose element matches the result's accumulates (after = clamp(cur + result+0xf8, 0,
// max); result+0x150 = applied). So one result row pairs with one anomaly row per gauge; the gauge
// that took the hit is the one whose state advances: its next row's cur_before equals this row's
// cur_before + applied. Pairing: same result_ptr, same thread, nearest result row at or after the
// anomaly row within 200 ms, verified by the two copied floats (requested = result+0xf8, Daze MV).
// gauge_after is filled only on the taking gauge; unlogged_delta = cur_before minus the previous
// row's gauge_after (or cur_before) on the same gauge object: decay, resets at trigger, and any
// change the result probe does not see show up here.
const anomalyFile = fs.readdirSync(dir).find((f) => /^damage-anomaly-.*\.tsv$/.test(f));
if (anomalyFile) {
  const an = loadTsv(path.join(dir, anomalyFile));
  let paired = 0, verified = 0; const out = [];
  const acols = ["seq", "elapsed_ms", "thread", "result_seq", "pair_check", "attack_property_name", "target_entity", "target_state", "gauge", "entity_ptr", "element", "variant", "variant2",
    "cur_before", "max", "requested", "applied", "took", "gauge_after", "unlogged_delta", "fill", "f68", "result_ptr"];
  for (const r of an.rows) {
    const t = +r.elapsed_ms; let h = null; let best = Infinity;
    const floatsMatch = (hit) => { const c = rawJoinFields.get(hit?.seq); return !!c && Math.abs(+r.result_requested - +c.buildup_requested) <= 1e-5 * Math.max(1, Math.abs(+c.buildup_requested)) && Math.abs(+r.result_daze_mv - c.daze_mv) <= 1e-6 * Math.max(1, Math.abs(c.daze_mv)); };
    for (const c of complete) {
      if (c.thread !== r.thread) continue;
      const dt = c.elapsed_ms - t; if (dt < 0 || dt > 200) continue;
      if (rawResultPtr.get(c.seq) !== r.result_ptr) continue;
      if (dt < best || (dt === best && floatsMatch(c) && !floatsMatch(h))) { best = dt; h = c; }
    }
    let check = "unpaired";
    if (h) { paired++; check = floatsMatch(h) ? "ok" : "pointer-only"; if (check === "ok") verified++; }
    out.push({ seq: +r.sequence, elapsed_ms: +r.elapsed_ms, thread: r.thread, result_seq: h?.seq ?? "", pair_check: check, attack_property_name: h?.attack_property_name ?? "",
      target_entity: h?.target_entity ?? "", target_state: h?.target_state ?? "", gauge: r.this, entity_ptr: r.entity_ptr, element: +r.element, variant: +r.variant, variant2: +r.variant2,
      cur_before: +r.cur_before, max: +r.max, requested: h ? +h.buildup_requested : "", applied: h ? +h.buildup_applied : "", took: "", gauge_after: "", unlogged_delta: "", fill: "", f68: +r.f68, result_ptr: r.result_ptr });
  }
  // Which gauge took each hit: the one whose next row's cur_before equals cur_before + applied (state advanced).
  const byGauge = new Map(); for (const o of out) (byGauge.get(o.gauge) || byGauge.set(o.gauge, []).get(o.gauge)).push(o);
  for (const rows of byGauge.values()) {
    rows.sort((a, b) => a.seq - b.seq);
    for (let i = 0; i < rows.length; i++) {
      const o = rows[i], next = rows[i + 1];
      const applied = o.applied === "" ? 0 : o.applied;
      if (o.result_seq !== "" && applied > 0) {
        const after = o.cur_before + applied;
        // taking gauge: the state advanced by exactly `applied` (or reached max and was reset by the trigger)
        const advanced = next ? Math.abs(next.cur_before - after) <= 1e-2 * Math.max(1, after) : true;
        const filled = after >= o.max - 1e-2;
        const reset = filled && next && next.cur_before < o.cur_before; // trigger consumed the gauge
        if (advanced || reset) { o.took = 1; o.gauge_after = +after.toFixed(3); o.fill = filled ? 1 : ""; }
      }
      if (i > 0) { const p = rows[i - 1]; const prevAfter = p.gauge_after !== "" ? p.gauge_after : p.cur_before; o.unlogged_delta = +(o.cur_before - prevAfter).toFixed(3); }
    }
  }
  // Rows of the same result where no gauge advanced but applied > 0: attribute by element majority of that attacker's other hits.
  fs.writeFileSync(path.join(dir, "anomaly-log.csv"), [acols.join(","), ...out.map((o) => acols.map((c) => csvCell(o[c])).join(","))].join("\n") + "\n");
  const gaugeSummary = [...byGauge.entries()].map(([g, rows]) => {
    const took = rows.filter((o) => o.took === 1); const fills = took.filter((o) => o.fill === 1);
    const maxes = [...new Set(rows.map((o) => +o.max.toFixed(2)))];
    const attackers = Object.entries(took.reduce((m, o) => { const k = o.attack_property_name.split("_")[0]; m[k] = (m[k] || 0) + 1; return m; }, {}));
    const unlogged = rows.filter((o) => o.unlogged_delta !== "" && Math.abs(o.unlogged_delta) >= 0.01);
    return { gauge: g, element: rows[0].element, variant: rows[0].variant, rows: rows.length, took: took.length, fills: fills.map((o) => ({ t: +(o.elapsed_ms / 1000).toFixed(2), max: +o.max.toFixed(2), sum_from_zero: o.gauge_after })), maxes, attackers, unlogged: unlogged.length, unloggedDeltas: unlogged.slice(0, 12).map((o) => [+(o.elapsed_ms / 1000).toFixed(2), o.unlogged_delta]) };
  });
  check.anomalyGauges = gaugeSummary;
  fs.writeFileSync(path.join(dir, "settlement-check.json"), JSON.stringify(check, null, 1));
  const requestedRows = out.filter((o) => o.requested !== "" && o.requested > 0);
  const takenResults = new Set(out.filter((o) => o.took === 1).map((o) => o.result_seq));
  const refused = [...new Set(requestedRows.filter((o) => o.applied === 0).map((o) => o.result_seq))].length;
  console.log(`anomaly rows: ${an.rows.length} (${byGauge.size} gauges); paired by result pointer ${paired}, verified by requested + Daze MV ${verified}, unpaired ${an.rows.length - paired}; hits taken by a gauge ${takenResults.size}, hits with buildup refused ${refused}`);
  for (const g of gaugeSummary) console.log(`  gauge ${g.gauge} element ${g.element} variant ${g.variant}: ${g.rows} rows, took ${g.took} (${g.attackers.map(([k, v]) => k + " " + v).join(", ")}), fills ${g.fills.length} at max ${g.fills.map((f) => f.max).join("/")}, max values seen ${g.maxes.join(", ")}, unlogged changes ${g.unlogged}${g.unlogged ? " e.g. " + g.unloggedDeltas.slice(0, 5).map((d) => d.join("s:")).join(" ") : ""}`);
}
