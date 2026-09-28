// Config object identities are capture-local; never persist their addresses across runs.
export const EFFECT_OFFSETS = {
  'CNBetaWin3.3.0': [0x68, 0x48],
  'CNBetaWin3.3.2': [0xa8, 0x48, 0x30],
  // Exact capture-local effect identities in all three 3.3.3 battles; see decoder-333-validation.md.
  'CNBetaWin3.3.3': [0x30, 0x88, 0x90],
  // 3.3.4 (measured on 20260925-192126 battle-1): the result class's effect-typed fields are
  // 0x18/0x38/0x58 (ConfigHitEffect) and 0x40 (ConfigEntityAttackEffect). 0x18 and 0x40 resolve
  // 1098 rows each, ALL unique; 0x38 (like 0x30/0x10) holds a pointer shared across every skill
  // and poisons the union; 0x58 adds 273 ambiguous rows for 2 fewer uniques. So exactly two.
  'CNBetaWin3.3.4': [0x18, 0x40],
};
export function identityIndex(rows) {
  const index = new Map();
  for (const row of rows) {
    const id = Number(row.skillId);
    if (!Number.isSafeInteger(id) || id <= 0) continue;
    for (const field of ['attackEffect', 'groundHitEffect', 'downHitEffect', 'skyHitEffect']) {
      const value = row[field];
      if (!/^0x[0-9a-f]+$/i.test(value || '')) continue;
      const pointer = BigInt(value);
      if (!pointer) continue;
      if (!index.has(pointer)) index.set(pointer, new Set());
      index.get(pointer).add(id);
    }
  }
  return index;
}
export function identitySkill(buffer, client, index) {
  const ids = new Set();
  for (const offset of EFFECT_OFFSETS[client] || []) {
    if (offset + 8 > buffer.length) continue;
    for (const id of index.get(buffer.readBigUInt64LE(offset)) || []) ids.add(id);
  }
  return { id: ids.size === 1 ? [...ids][0] : null, candidates: [...ids].sort((a, b) => a - b) };
}
// The universal base Anomaly multipliers (Burn, Shock, Corruption, Shatter, Assault, Windswept).
// Corruption ticks arrive with NO ability or AttackProperty string at all (null pointer, 14 of 14
// on the 2026-09-28 Disorder capture); a nameless row at one of these multipliers is that Anomaly's tick.
// Across 69 captures no other damaging row is nameless, and Phoenix's Nirvana (0.5, no
// AttackProperty) keeps its ability name, so it never matches.
const BASE_ANOMALY_MV = [0.5, 1.25, 0.625, 5, 7.13, 12.5];
// Order: config-pointer identity, then the hand/capture map, then the client's own AttackProperty
// config (clientMap, generate-attack-property-skills.mjs) for hits identity cannot see (projectiles).
export function attribute({ ability, prop, buffer, client, index, map, clientMap = {}, dmgMv, attackTags = '', warn = console.error }) {
  // Anomaly effect pointers can retain the triggering attack. That is not the tick's skill.
  if (ability === 'Player_ElementAbnormalBuff') return { id: 'anomaly', source: 'name' };
  // The game's own tags (logged since 2026-09-28): every Anomaly instance leads with "Buff" (on the
  // first tagged capture exactly the 147 Anomaly rows did, and no direct hit).
  if (attackTags.split('|')[0] === 'Buff') return { id: 'anomaly', source: 'tags' };
  if (!ability && !prop && typeof dmgMv === 'number' && BASE_ANOMALY_MV.some((mv) => Math.abs(dmgMv - mv) < 1e-4)) return { id: 'anomaly', source: 'mv' };
  const derived = identitySkill(buffer, client, index);
  const mapped = map[prop]?.skill_id;
  if (derived.candidates.length > 1) warn(`AMBIGUOUS skill identity: ${prop}: ${derived.candidates.join(', ')}`);
  if (derived.id != null) {
    if (mapped != null && mapped !== derived.id) warn(`SKILL MAP DISAGREEMENT: ${prop}: identity=${derived.id}, map=${mapped}`);
    return { id: derived.id, source: 'identity' };
  }
  if (mapped != null) return { id: mapped, source: 'map' };
  const configured = clientMap[prop];
  if (configured != null) return { id: configured, source: 'client' };
  return { id: '', source: prop ? 'unmapped' : 'no-name' };
}
