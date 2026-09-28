// node tools/generate-attack-property-skills.mjs <label> <decoded-dir> [<decoded-dir> ...] [--out file.json]
//
// AttackProperty name -> skill id, read from the client's own AttackProperty configs (the decoded
// roster extract's zzz312-roster-AttackProperty_*.jsonl): every ConfigEntityAnimEvent whose
// ActiveDynamicProp has IsOverrideDynamicProp=true names its skill in OverrdieDynamicPropKey (the
// client's spelling). This is the fallback for hits the identity join cannot see — projectiles and
// bullets do not pass through TriggerAttackPattern, so they have no hits.tsv row to join on.
// OverrideDynamicPropKey2 is kept as alt_skill_id for reference only; attribution uses the first key.
//
// Pass directories oldest first: the client's hotfix tree replaces whole files, so a later directory's
// file of the same name replaces the earlier one (docs/reference/kit-update-procedure.md in
// sheet-webapp). A name that two files map to different ids is a conflict and is left out of the map.
// Only the generated JSON ships; client assets are not runtime dependencies.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const FILE = /^zzz312-roster-(AttackProperty_.+)\.jsonl$/;

/** One decoded AttackProperty file -> [{ name, skillId, altSkillId }], overriding entries only. */
export function readAttackProperties(text) {
  const entries = new Map(); // "$/.../[i]" -> { name, override, key1, key2 }
  const at = (p) => { if (!entries.has(p)) entries.set(p, {}); return entries.get(p); };
  for (const line of text.split('\n')) {
    if (!line) continue;
    const node = JSON.parse(line);
    let m;
    if ((m = node.path.match(/^(.*)\/\$k$/))) at(m[1]).name = node.value;
    else if ((m = node.path.match(/^(.*)\/\$v\/ActiveDynamicProp\/(IsOverrideDynamicProp|OverrdieDynamicPropKey|OverrideDynamicPropKey2)$/))) {
      const e = at(m[1]);
      if (m[2] === 'IsOverrideDynamicProp') e.override = node.value; else if (m[2] === 'OverrdieDynamicPropKey') e.key1 = node.value; else e.key2 = node.value;
    }
  }
  return [...entries.values()].filter((e) => e.name && e.override === true && e.key1 > 0).map((e) => ({ name: e.name, skillId: e.key1, altSkillId: e.key2 > 0 ? e.key2 : null }));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const args = process.argv.slice(2);
  const outAt = args.indexOf('--out');
  const output = outAt >= 0 ? args.splice(outAt, 2)[1] : fileURLToPath(new URL('./attack-property-client-skills.json', import.meta.url));
  const [label, ...dirs] = args;
  if (!label || !dirs.length) throw new Error('usage: generate-attack-property-skills.mjs <label> <decoded-dir> [<decoded-dir> ...] [--out file.json]');
  const files = new Map(); // AttackProperty_<entity> -> newest path
  for (const dir of dirs) for (const f of fs.readdirSync(dir)) { const m = f.match(FILE); if (m) files.set(m[1], path.join(dir, f)); }
  const seen = new Map(); // name -> Map(skillId -> { alt, sources })
  for (const [entity, file] of [...files].sort(([a], [b]) => a.localeCompare(b, 'en'))) {
    for (const e of readAttackProperties(fs.readFileSync(file, 'utf8'))) {
      if (!seen.has(e.name)) seen.set(e.name, new Map());
      const ids = seen.get(e.name);
      if (!ids.has(e.skillId)) ids.set(e.skillId, { alt: e.altSkillId, sources: [] });
      if (!ids.get(e.skillId).sources.includes(entity)) ids.get(e.skillId).sources.push(entity);
    }
  }
  const map = {}, alt = {}, conflicts = {};
  let variantResolved = 0;
  for (const [name, ids] of [...seen].sort(([a], [b]) => a.localeCompare(b, 'en'))) {
    let chosen = ids.size === 1 ? [...ids][0] : null;
    if (!chosen) {
      // An event-mode copy of an Agent (AttackProperty_..._Aria_MusicBattleActivity) reuses the base
      // file's names with its own ids; combat uses the base file. Only that exact shape resolves.
      const all = [...ids].flatMap(([, v]) => v.sources);
      const base = all.reduce((a, b) => (a.length <= b.length ? a : b));
      const withBase = [...ids].filter(([, v]) => v.sources.includes(base));
      if (withBase.length === 1 && all.every((s) => s === base || s.startsWith(base + '_'))) { chosen = withBase[0]; variantResolved++; }
    }
    if (!chosen) { conflicts[name] = Object.fromEntries([...ids].map(([id, v]) => [id, v.sources])); continue; }
    const [skillId, v] = chosen;
    map[name] = skillId;
    if (v.alt) alt[name] = v.alt;
  }
  const result = {
    _note: 'Generated from the client AttackProperty configs (ActiveDynamicProp.OverrdieDynamicPropKey); regenerate with generate-attack-property-skills.mjs. map: AttackProperty name -> skill id, the fallback after identity and attack-property-skill-map.json. alt: OverrideDynamicPropKey2, reference only. No combat stats.',
    data_version: label, sources: dirs.map((d) => path.basename(path.dirname(d)) + '/' + path.basename(d)), files: files.size, map, alt, conflicts,
  };
  // One entry per line keeps diffs readable after a regenerate without the size of indented JSON.
  const lines = (o) => Object.entries(o).map(([k, v]) => `  ${JSON.stringify(k)}:${JSON.stringify(v)}`).join(',\n');
  fs.writeFileSync(output, `{\n${Object.entries(result).map(([k, v]) => v && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length ? `${JSON.stringify(k)}:{\n${lines(v)}\n}` : `${JSON.stringify(k)}:${JSON.stringify(v)}`).join(',\n')}\n}\n`);
  console.log(`${files.size} AttackProperty files -> ${Object.keys(map).length} names mapped (${variantResolved} base-over-event-variant), ${Object.keys(conflicts).length} conflicting (left out) -> ${output}`);
}
