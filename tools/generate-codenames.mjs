// node tools/generate-codenames.mjs <ZenlessData directory> <data-version-or-revision> [output.json]
// Only the generated naming metadata ships; client assets are not runtime dependencies.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const [root, version, output = fileURLToPath(new URL('./codenames.json', import.meta.url))] = process.argv.slice(2);
if (!root || !version) throw new Error('usage: generate-codenames.mjs <data-dir> <data-version-or-revision> [output.json]');
const read = (p) => JSON.parse(fs.readFileSync(path.join(root, p), 'utf8'));
const table = (name) => Object.values(read(`FileCfg/${name}.json`)).find(Array.isArray);
const text = { ...read('TextMap/TextMap_ENTemplateTb.json'), ...read('TextMap/TextMap_ENOverwriteTemplateTb.json') };
const names = {};
const unresolved = [];
function add(code, display, source) {
  if (!code || !/^[A-Za-z][A-Za-z0-9_]*$/.test(code)) return;
  const name = display || code;
  if (names[code] && names[code].name !== name) throw new Error(`Conflicting name for ${code}: ${names[code].name} / ${name}`);
  names[code] = { name, source };
  if (!display) unresolved.push(code);
}
const abilityRoot = path.join(root, 'Data/JsonBytes/NewAbility/AvatarAbility');
const folders = fs.readdirSync(abilityRoot, { withFileTypes: true }).filter((d) => d.isDirectory() && d.name.endsWith('Ability')).map((d) => d.name.slice(0, -7));
// Snapshot schemas are obfuscated. Detect string roles by their values, not guessed field names.
for (const row of table('AvatarBaseTemplateTb')) {
  const values = Object.values(row).filter((v) => typeof v === 'string');
  const key = values.find((v) => /^Avatar_.*_En$/.test(v));
  if (!key) continue;
  const base = key.slice(0, -3);
  // unk_16 was verified against Lisa and the ability directory names in this snapshot.
  const code = row.unk_16;
  if (!code) throw new Error(`Cannot resolve avatar codename: ${key}`);
  add(code, text[key] || text[base], 'AvatarBaseTemplateTb + English TextMap');
  const alias = base.replace(/^Avatar_(?:Female|Male)_Size\d+_/, '');
  add(alias, text[key] || text[base], 'AvatarBaseTemplateTb localization codename');
}
for (const code of folders) if (!names[code]) {
  const match = Object.keys(names).find((key) => key.toLowerCase() === code.toLowerCase());
  add(code, match ? names[match].name : null, 'AvatarAbility folder');
}
// BuddyBase has the localization key, but no codename; BuddyBattle's string-list field supplies it.
const buddies = table('BuddyBaseTemplateTb');
for (const row of table('BuddyBattleTemplateTb')) {
  const buddy = buddies.find((b) => b.FONBHALHDIJ === row.FONBHALHDIJ);
  if (!buddy) continue;
  const key = Object.values(buddy).find((v) => typeof v === 'string' && /^Bangboo_Name_en_\d+$/.test(v));
  const codes = Object.values(row).filter(Array.isArray).flat().filter((v) => typeof v === 'string' && /^[A-Za-z][A-Za-z0-9_]*$/.test(v));
  for (const code of codes) add('Bangboo_' + code, text[key], 'BuddyBattleTemplateTb.FONBHALHDIJ -> BuddyBaseTemplateTb + English TextMap');
}
// *MonsterTemplate tables mostly hold encounter IDs. MonsterConfig supplies entity codes;
// OfficialName_* localization keys (also referenced by monster card tables) supply display names.
for (const file of fs.readdirSync(path.join(root, 'FileCfg')).filter((f) => /Monster.*TemplateTb\.json$/.test(f))) {
  for (const row of table(file.slice(0, -5)) || []) {
    for (const value of Object.values(row)) {
      if (typeof value !== 'string') continue;
      const code = value.replace(/^OfficialName_/, '');
      if (!/^Monster_[A-Za-z0-9_]+$/.test(code)) continue;
      add(code, text['OfficialName_' + code] || text[code], `${file} + English TextMap`);
    }
  }
}
for (const [code, name] of [['Lisa', 'Grace'], ['Bangboo_Plugboo', 'Plugboo']]) {
  if (names[code]?.name !== name) throw new Error(`Naming anchor failed: ${code} -> ${name}`);
}
if (!names.Monster_Cottus || names.Monster_Cottus.name === 'Monster_Cottus') throw new Error('Missing Cottus localization');
const result = { _note: 'Generated naming metadata; regenerate with generate-codenames.mjs. Unknown/untranslated codenames remain raw. No combat stats.', data_version: version, names: Object.fromEntries(Object.entries(names).sort(([a], [b]) => a.localeCompare(b, 'en'))) };
fs.writeFileSync(output, JSON.stringify(result, null, 2) + '\n');
console.log(`${Object.keys(names).length} codenames; ${new Set(unresolved).size} untranslated; anchors: Lisa=${names.Lisa.name}, Bangboo_Plugboo=${names.Bangboo_Plugboo.name}, Monster_Cottus=${names.Monster_Cottus.name}`);
