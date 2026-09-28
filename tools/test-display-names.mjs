// node tools/test-display-names.mjs — display-names.mjs, the readable log's in-game naming.
import assert from 'node:assert/strict';
import { loadDisplayNames, entityNames, actionName, dropSummonCopies } from './display-names.mjs';

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

// The shipped table, when present, has only names.
const shipped = loadDisplayNames();
if (shipped) {
  assert.ok(Object.keys(shipped.skills).length > 1000);
  assert.deepEqual(shipped.skills['1631013'], ['Severian', 'Ultimate: Annihilating Windstorm']);
  assert.ok(Object.values(shipped.skills).every((v) => Array.isArray(v) && v.length === 2 && v.every((s) => typeof s === 'string')));
}
console.log('display-names: in-game names, Core Passive owner, entity naming and summon copies pass.');
