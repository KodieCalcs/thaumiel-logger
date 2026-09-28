import assert from 'node:assert/strict';
import { identityIndex, identitySkill, attribute } from './attribution.mjs';
import { codename, displayName, stripCodename } from './codename-labels.mjs';
import { parseCsv } from './log-csv.mjs';
import { readAttackProperties } from './generate-attack-property-skills.mjs';
const client = 'CNBetaWin3.3.2';
const buffer = Buffer.alloc(0x290);
buffer.writeBigUInt64LE(0x123n, 0xa8);
const index = identityIndex([{ skillId: '7654321', attackEffect: '0x123' }, { skillId: '7654321', attackEffect: '0x0123' }]);
assert.equal(identitySkill(buffer, client, index).id, 7654321);
const warnings = [];
const args = { ability: 'Unknown_Normal', prop: 'Unknown_Hit', buffer, client, index, map: {}, warn: (m) => warnings.push(m) };
assert.deepEqual(attribute(args), { id: 7654321, source: 'identity' });
assert.deepEqual(attribute({ ...args, map: { Unknown_Hit: { skill_id: 111 } } }), { id: 7654321, source: 'identity' });
assert.match(warnings.pop(), /DISAGREEMENT/);
assert.deepEqual(attribute({ ...args, ability: 'Player_ElementAbnormalBuff' }), { id: 'anomaly', source: 'name' });
const collision = identityIndex([{ skillId: '7654321', attackEffect: '0x123' }, { skillId: '7654322', groundHitEffect: '0x123' }]);
assert.equal(identitySkill(buffer, client, collision).id, null);
assert.deepEqual(attribute({ ...args, index: collision }), { id: '', source: 'unmapped' });
assert.match(warnings.pop(), /AMBIGUOUS/);
assert.deepEqual(attribute({ ...args, index: new Map(), map: { Unknown_Hit: { skill_id: 111 } } }), { id: 111, source: 'map' });
// Decoded AttackProperty config: only overriding entries with a nonzero key; the second key is kept aside.
const line = (p, value) => JSON.stringify({ path: `$/AnimEvents/[1]/${p}`, value });
const decoded = [
  line('[0]/$k', 'Agent_Bullet_AttackProperty_01'), line('[0]/$v/ActiveDynamicProp/IsOverrideDynamicProp', true),
  line('[0]/$v/ActiveDynamicProp/OverrdieDynamicPropKey', 1311009), line('[0]/$v/ActiveDynamicProp/OverrideDynamicPropKey2', 1311018),
  line('[1]/$k', 'Agent_NoOverride'), line('[1]/$v/ActiveDynamicProp/IsOverrideDynamicProp', false), line('[1]/$v/ActiveDynamicProp/OverrdieDynamicPropKey', 1311001),
  line('[2]/$k', 'Agent_ZeroKey'), line('[2]/$v/ActiveDynamicProp/IsOverrideDynamicProp', true), line('[2]/$v/ActiveDynamicProp/OverrdieDynamicPropKey', 0),
].join('\n');
assert.deepEqual(readAttackProperties(decoded), [{ name: 'Agent_Bullet_AttackProperty_01', skillId: 1311009, altSkillId: 1311018 }]);
// Client config is the last fallback: never over identity or the hand map, and only for its own name.
const clientMap = { Unknown_Hit: 222 };
assert.deepEqual(attribute({ ...args, clientMap }), { id: 7654321, source: 'identity' });
assert.deepEqual(attribute({ ...args, index: new Map(), map: { Unknown_Hit: { skill_id: 111 } }, clientMap }), { id: 111, source: 'map' });
assert.deepEqual(attribute({ ...args, index: new Map(), clientMap }), { id: 222, source: 'client' });
assert.deepEqual(attribute({ ...args, index: new Map(), prop: 'Other_Hit', clientMap }), { id: '', source: 'unmapped' });
assert.equal(identityIndex([{ skillId: '0', attackEffect: '0x123' }, { skillId: '111', attackEffect: '0x0' }]).size, 0);
assert.equal(identitySkill(Buffer.alloc(4), client, index).id, null);
const old = Buffer.alloc(0x290); old.writeBigUInt64LE(0x123n, 0x68);
assert.equal(identitySkill(old, 'CNBetaWin3.3.0', index).id, 7654321);
assert.equal(identitySkill(old, client, index).id, null);
assert.equal(displayName(codename('Lisa_Attack_01')), 'Grace');
assert.equal(displayName(codename('Bangboo_Plugboo_Attack01')), 'Plugboo');
assert.equal(displayName(codename('Monster_Cottus_ATK04')), 'Newborn Dead End Butcher');
assert.equal(displayName(codename('BrandNewAgent_Attack_01')), 'BrandNewAgent');
assert.equal(displayName(codename('Bangboo_NewBuddy_Attack_01')), 'Bangboo_NewBuddy');
assert.equal(stripCodename('Lisa_Attack_01'), 'Attack_01');
assert.equal(stripCodename('Bangboo_Plugboo_Attack01'), 'Attack01');
assert.deepEqual(parseCsv('a,b,c\r\n1,"two,""quoted""",\r\n'), [{ a: '1', b: 'two,"quoted"', c: '' }]);
console.log('Attribution, layout isolation, anomaly, ambiguity, naming and CSV tests passed.');
