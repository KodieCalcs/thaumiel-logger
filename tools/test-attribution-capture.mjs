// Optional private-fixture regression. Baselines must be produced by the pre-change decoder.
// node tools/test-attribution-capture.mjs <capture-dir> <baseline-per-hit.csv> <baseline-settlement.json>
// The supplied capture directory is regenerated; use a scratch copy to preserve an archive.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseCsv } from './log-csv.mjs';
const [dir, beforeCsv, beforeReport] = process.argv.slice(2);
if (!dir) { console.log('Private capture regression: supply capture-dir, baseline CSV and baseline report.'); process.exit(0); }
assert.ok(beforeCsv && beforeReport, 'Both baseline paths are required');
const baselineCsv = fs.readFileSync(beforeCsv, 'utf8');
const baselineReport = fs.readFileSync(beforeReport);
const before = parseCsv(baselineCsv);
execFileSync(process.execPath, [fileURLToPath(new URL('./per-hit-log.mjs', import.meta.url)), dir], { stdio: 'pipe' });
const afterCsv = fs.readFileSync(path.join(dir, 'per-hit-log.csv'), 'utf8');
const after = parseCsv(afterCsv);
assert.equal(afterCsv.split('\n')[0], baselineCsv.split('\n')[0], 'CSV columns and order');
assert.equal(after.length, before.length);
for (let i = 0; i < before.length; i++) for (const key of Object.keys(before[i])) {
  if (key === 'skill_id_source') continue;
  if (key === 'skill_id' && !before[i][key]) continue; // New attribution is intentional.
  assert.equal(after[i][key], before[i][key], `row ${i + 1}, ${key}`);
}
assert.deepEqual(fs.readFileSync(path.join(dir, 'settlement-check.json')), baselineReport, 'Byte-identical report');
assert.ok(after.filter((r) => r.skill_id_source === 'unmapped').length <= before.filter((r) => r.skill_id_source === 'unmapped').length);
execFileSync(process.execPath, [fileURLToPath(new URL('./readable-log.mjs', import.meta.url)), dir], { stdio: 'pipe' });
assert.equal(parseCsv(fs.readFileSync(path.join(dir, 'combat-log-readable.csv'), 'utf8')).length, before.length);
const histogram = (rows) => rows.reduce((acc, r) => { acc[r.skill_id_source] = (acc[r.skill_id_source] || 0) + 1; return acc; }, {});
console.log(path.basename(dir), JSON.stringify({ before: histogram(before), after: histogram(after), report: 'byte-identical', decodedFields: 'unchanged' }));
