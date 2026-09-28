import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseCsv } from './log-csv.mjs';
import { identityIndex, identitySkill, attribute } from './attribution.mjs';

// Captured bytes, not buffers populated from the decoder's own offsets. Crit is independently
// witnessed by UI marker/category and the converter; stat copies by full-method disassembly.
const samples = JSON.parse(fs.readFileSync(new URL('./fixtures/decoder-333.json', import.meta.url)));
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'decoder-333-'));
try {
  const columns = Object.keys(samples[0].row);
  const rows = samples.map((s, i) => ({ ...s.row, sequence: String(i + 1) }));
  fs.writeFileSync(path.join(dir, 'damage-result-fixture.tsv'),
    '# schema=5 client=CNBetaWin3.3.3\n' + columns.join('\t') + '\n' +
    rows.map(r => columns.map(k => r[k]).join('\t')).join('\n') + '\n');
  execFileSync(process.execPath, [fileURLToPath(new URL('./per-hit-log.mjs', import.meta.url)), dir], { stdio: 'pipe' });
  const decoded = parseCsv(fs.readFileSync(path.join(dir, 'per-hit-log.csv'), 'utf8'));
  assert.equal(decoded.length, samples.length);
  for (let i = 0; i < samples.length; i++) {
    for (const [key, value] of Object.entries(samples[i].expected)) {
      assert.equal(decoded[i][key], value, `${samples[i].capture} seq ${samples[i].sequence}: ${key}`);
    }
    assert.ok(Number(decoded[i].damage_unrounded) > 0);
  }
  // Live raw Daze MV 1.0394367 rounds to 1.03944 in CSV; that must not break joins.
  const joinSample = JSON.parse(fs.readFileSync(new URL('./fixtures/probe-join-333.json', import.meta.url)));
  for (const [kind, row] of Object.entries(joinSample)) {
    const keys = Object.keys(row);
    fs.writeFileSync(path.join(dir, `damage-${kind}-fixture.tsv`),
      '# schema=5 client=CNBetaWin3.3.3\n' + keys.join('\t') + '\n' + keys.map(k => row[k]).join('\t') + '\n');
  }
  const runJoins = () => {
    execFileSync(process.execPath, [fileURLToPath(new URL('./per-hit-log.mjs', import.meta.url)), dir], { stdio: 'pipe' });
    return ['daze', 'anomaly'].map(kind => parseCsv(fs.readFileSync(path.join(dir, `${kind}-log.csv`), 'utf8'))[0].pair_check);
  };
  assert.deepEqual(runJoins(), ['ok', 'ok']);
  // A real float disagreement must still fail the check.
  const raw = Buffer.from(joinSample.result.result_hex, 'hex');
  raw.writeFloatLE(2, 0x170);
  const changed = { ...joinSample.result, result_hex: raw.toString('hex') };
  fs.writeFileSync(path.join(dir, 'damage-result-fixture.tsv'), '# schema=5 client=CNBetaWin3.3.3\n' + Object.keys(changed).join('\t') + '\n' + Object.values(changed).join('\t') + '\n');
  assert.deepEqual(runJoins(), ['pointer-only', 'pointer-only']);
  // Captured effect identities, with collision and anomaly negative controls.
  const b = Buffer.from(samples[2].row.result_hex, 'hex');
  const pointer = '0x' + b.readBigUInt64LE(0x30).toString(16);
  const index = identityIndex([{ skillId: '1631010', attackEffect: pointer }]);
  assert.equal(identitySkill(b, 'CNBetaWin3.3.3', index).id, 1631010);
  const collision = identityIndex([{ skillId: '1631010', attackEffect: pointer }, { skillId: '1631001', attackEffect: pointer }]);
  assert.equal(identitySkill(b, 'CNBetaWin3.3.3', collision).id, null);
  assert.deepEqual(attribute({ ability: 'Player_ElementAbnormalBuff', prop: '', buffer: b,
    client: 'CNBetaWin3.3.3', index, map: {} }), { id: 'anomaly', source: 'name' });
  assert.equal(identitySkill(b, 'unknown-client', index).id, null);
  console.log('3.3.3 captured decoder regression: 5 rows, names, crit, stats, Energy, identity controls pass');
} finally {
  fs.rmSync(dir, { recursive: true, force: true });
}
