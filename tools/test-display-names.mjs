// node tools/test-display-names.mjs — display-names.mjs, the readable log's in-game naming.
import assert from 'node:assert/strict';
import { loadDisplayNames, entityNames, actionName, anomalyName, abloomTriggers, dropSummonCopies } from './display-names.mjs';

const names = {
  skills: { '1631013': ['Severian', 'Ultimate: Annihilating Windstorm'], '1571013': ['Norma', 'Special Attack: Target Practice'], '5402201': ['Ultra Jake', 'Active Skill: Ultra Firepower Suppression'] },
  corePassive: { Sunna: 'Core Passive: Cuteness Is Justice', Phoenix: 'Core Passive: Nirvana' },
  codenames: { summer: 'Sunna', pheony: 'Phoenix' },
};
// Named by skill id; the client name is untouched when the table does not know the row.
assert.equal(actionName({ skill_id: '1631013' }, 'Severian', names), 'Ultimate: Annihilating Windstorm');
assert.equal(actionName({ skill_id: '9999999', ability_name: 'X_Attack' }, 'X', names), null);
assert.equal(actionName({ skill_id: '1631013' }, 'Severian', null), null);
// Core Passive rows carry no skill id: the owner's title, naming the owner when another Agent is credited.
assert.equal(actionName({ skill_id: '', ability_name: 'Summer_UniqueSkill_Bullet_Attack' }, 'Severian', names), "Sunna's Core Passive: Cuteness Is Justice");
assert.equal(actionName({ skill_id: '', ability_name: 'Pheony_UniqueSkill' }, 'Phoenix', names), 'Core Passive: Nirvana');

// An entity is named by its skills (a Bangboo codenames.json lacks), else by the fallback.
const rows = [
  { attacker_entity: '0xB', skill_id: '5402201' }, { attacker_entity: '0xB', skill_id: '5402201' },
  { attacker_entity: '0xE', skill_id: '' },
];
const byEntity = entityNames(rows, names, (e) => (e === '0xE' ? 'Newborn Dead End Butcher' : 'Bangboo_Ultraboo'));
assert.equal(byEntity.get('0xB'), 'Ultra Jake');
assert.equal(byEntity.get('0xE'), 'Newborn Dead End Butcher');

// A summon's zero-damage copy of its Agent's hit is dropped (same attack and target, within 20 ms);
// a zero-damage row with no such twin, or a copy carrying a different resource, stays.
const hit = (e, ms, dmg, extra = {}) => ({ attacker_entity: e, elapsed_ms: String(ms), damage_unrounded: String(dmg), target_entity: '0xT', skill_id: '1571013', attack_property_name: 'Norma_Weapon_White_Attack_01_AttackProperty_01', ...extra });
const norma = [hit('0xN', 1000, 15381), hit('0xW', 1000, 0), hit('0xN', 2000, 15381), hit('0xW', 2000, 0, { energy: '0.5' }), hit('0xW', 3000, 0)];
const kept = dropSummonCopies(norma, () => 'Norma');
assert.deepEqual(kept.map((r) => `${r.attacker_entity}@${r.elapsed_ms}`), ['0xN@1000', '0xN@2000', '0xW@2000', '0xW@3000']);

// Anomaly rows are named from the game's tags (tag sets as logged on the first tagged battle).
const tagged = (tags, mv = '0.5') => ({ attack_tags: tags, dmg_mv: mv });
assert.equal(anomalyName(tagged('Buff|Burn'), 'Phoenix', names), 'Burn');
assert.equal(anomalyName(tagged('Buff|Erosion', '0.625'), 'Nangong Yu', names), 'Corruption');
assert.equal(anomalyName(tagged('Buff|Disorder', '5'), 'Nangong Yu', names), 'Disorder'); // 500 %: Shatter's base, still a Disorder
assert.equal(anomalyName(tagged('Buff|Strike', '7.13'), 'Yuzuha', names), 'Assault');
assert.equal(anomalyName(tagged('Buff|Catalysis', '22.75'), 'Velina', names), 'Vortex');
assert.equal(anomalyName(tagged('Buff|Chaos', '0.625'), 'Yanagi', names), 'Corruption (Chaos)');
assert.equal(anomalyName(tagged('Buff|Burn|Pheony_TriggerBuffAttack_Brust|ExtraElementAbnormalAttack|Abloom', '4.45'), 'Phoenix', names), 'Abloom (Brust, Burn)');
assert.equal(anomalyName(tagged('Buff|Erosion|Pheony_TriggerBuffAttack_SwitchIn_Ex|ExtraElementAbnormalAttack|Abloom', '5.97'), 'Phoenix', names), 'Abloom (SwitchIn Ex, Corruption)');
assert.equal(anomalyName(tagged('Buff|Burn|NangongYu_TriggerBuffAttack|ExtraElementAbnormalAttack|Abloom', '9'), 'Nangong Yu', { codenames: { nangongyu: 'Nangong Yu' } }), 'Abloom (900 %, Burn)');
assert.equal(anomalyName(tagged('Buff|Burn|Pheony_TriggerBuffAttack_Brust|ExtraElementAbnormalAttack|Abloom', '4.45'), 'Nangong Yu', names), "Abloom (Phoenix's Brust, Burn)");
assert.equal(anomalyName(tagged('Buff|Something'), 'Rina', names), 'Anomaly (Something)');
assert.equal(anomalyName(tagged('AttackNormal|Normal'), 'Rina', names), null);

// What triggers an Abloom is learned from the log: the attacker's last named hit within 100 ms
// (other Anomaly rows skipped), or the Mindscape a Talent tag names. Rows shaped like battle 5 +
// an M4 Phoenix: Sinburn's final hit, a Disorder in between, the Brust Abloom, then M4's.
const row = (seq, ms, e, extra) => ({ seq: String(seq), elapsed_ms: String(ms), attacker_entity: e, attack_tags: '', skill_id: '', ...extra });
const log = [
  row(1, 1000, '0xP', { skill_id: '1641005', attack_tags: 'AttackNormal|Normal' }),
  row(2, 1015, '0xP', { skill_id: 'anomaly', attack_tags: 'Buff|Disorder' }),
  row(3, 1015, '0xY', { skill_id: '1661001', attack_tags: 'AttackNormal|Normal' }), // another attacker
  row(4, 1015, '0xP', { skill_id: 'anomaly', attack_tags: 'Buff|Burn|Pheony_TriggerBuffAttack_Brust|ExtraElementAbnormalAttack|Abloom', dmg_mv: '4.45' }),
  row(5, 1015, '0xP', { skill_id: 'anomaly', attack_tags: 'Buff|Burn|Pheony_TriggerBuffAttack_Talent03|ExtraElementAbnormalAttack|Abloom', dmg_mv: '6' }),
  row(6, 9000, '0xP', { skill_id: 'anomaly', attack_tags: 'Buff|Burn|Pheony_TriggerBuffAttack_Late|ExtraElementAbnormalAttack|Abloom', dmg_mv: '3' }), // nothing within 100 ms
];
const actions = { '1641005': 'Basic Attack: Sinburn 3rd-Hit', '1661001': 'Basic Attack: Other' };
const triggers = abloomTriggers(log, (r) => actions[r.skill_id] ?? null);
assert.deepEqual([...triggers], [['Pheony_TriggerBuffAttack_Brust', 'Basic Attack: Sinburn 3rd-Hit']]);
assert.equal(anomalyName(log[3], 'Phoenix', names, triggers), 'Abloom (Sinburn, Burn)');
assert.equal(anomalyName(log[4], 'Phoenix', names, triggers), 'Abloom (M4, Burn)');
assert.equal(anomalyName(log[5], 'Phoenix', names, triggers), 'Abloom (Late, Burn)'); // unplaced: the game's name
assert.equal(anomalyName(tagged(''), 'Rina', names), null); // a log from before tags

// The shipped table, when present, has only names.
const shipped = loadDisplayNames();
if (shipped) {
  assert.ok(Object.keys(shipped.skills).length > 1000);
  assert.deepEqual(shipped.skills['1631013'], ['Severian', 'Ultimate: Annihilating Windstorm']);
  assert.ok(Object.values(shipped.skills).every((v) => Array.isArray(v) && v.length === 2 && v.every((s) => typeof s === 'string')));
}
console.log('display-names: in-game names, Core Passive owner, Anomaly names from tags, entity naming and summon copies pass.');
