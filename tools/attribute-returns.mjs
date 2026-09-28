// Attribute schema-2 damage-probe return addresses to dump methods.
//   node attribute-returns.mjs <damage-probe-*.tsv> <il2cpp-v7.tsv> [out.json]
// For every row, ret0..ret15 are "stack_index:rva" shallowest-first. Each rva is mapped to the
// greatest METHOD start <= rva in the dump (no .pdata, so this is a heuristic; the distance is
// reported and anything > 64 KB past a start is marked unattributed). Output: per display
// category (arg2: 0 hit, 1 crit, 3 anomaly) the most common chains, and per RVA its method.
import { readFileSync, writeFileSync } from 'node:fs';
const [capture, dump, out] = process.argv.slice(2);
if (!capture || !dump) { console.error('usage: attribute-returns.mjs <capture.tsv> <il2cpp-v7.tsv> [out.json]'); process.exit(2); }

// --- dump: sorted method starts ------------------------------------------------------------
const methods = [];
{
  let cls = '';
  for (const line of readFileSync(dump, 'utf8').split(/\r?\n/)) {
    if (line.startsWith('CLASS\t')) { const p = line.split('\t'); cls = (p[3] ? p[3] + '.' : '') + p[4]; continue; }
    if (!line.startsWith('METHOD\t')) continue;
    const p = line.split('\t');
    const rva = parseInt(p[4], 16);
    if (!rva) continue;
    methods.push({ rva, name: cls + '::' + p[1], args: +p[2] });
  }
  methods.sort((a, b) => a.rva - b.rva);
}
const attribute = (rva) => {
  let lo = 0, hi = methods.length - 1, best = -1;
  while (lo <= hi) { const m = (lo + hi) >> 1; if (methods[m].rva <= rva) { best = m; lo = m + 1; } else hi = m - 1; }
  if (best < 0) return { name: '?', dist: -1 };
  const d = rva - methods[best].rva;
  return d > 0x10000 ? { name: '?(>64K past ' + methods[best].name + ')', dist: d } : { name: methods[best].name, args: methods[best].args, dist: d };
};

// --- capture --------------------------------------------------------------------------------
// No trim() on the whole file: rows end in empty ret cells, and trimming would shorten the last row.
const lines = readFileSync(capture, 'utf8').split(/\r?\n/).filter(l => l.length && !l.startsWith('#'));
const names = lines.shift().split('\t');
if (!names.includes('ret0')) { console.error('not a schema-2 capture (no ret0 column)'); process.exit(1); }
const rows = [];
for (const line of lines) {
  const v = line.split('\t'); if (v.length !== names.length) continue;
  const r = Object.fromEntries(names.map((n, i) => [n, v[i]]));
  const rets = [];
  for (let i = 0; i < 16; i++) { const s = r['ret' + i]; if (!s) break; const [idx, rva] = s.split(':'); rets.push({ idx: +idx, rva: parseInt(rva, 16) }); }
  rows.push({ seq: +r.sequence, t: +r.elapsed_ms, cat: Number(BigInt(r.arg2)), el: Number(BigInt(r.arg6) & 0xffffffffn), p12: r.arg13, p12_bytes: +r.p12_bytes, rets });
}

// --- summarise ------------------------------------------------------------------------------
const rvaInfo = new Map();
for (const r of rows) for (const h of r.rets) if (!rvaInfo.has(h.rva)) rvaInfo.set(h.rva, attribute(h.rva));
const chainKey = (r) => r.rets.map(h => '0x' + h.rva.toString(16)).join(' > ');
const byCat = {};
for (const r of rows) { const k = chainKey(r); (byCat[r.cat] ??= {})[k] = ((byCat[r.cat] ??= {})[k] ?? 0) + 1; }

console.log('rows', rows.length, 'distinct return rvas', rvaInfo.size);
for (const [cat, chains] of Object.entries(byCat)) {
  console.log(`\n== arg2=${cat} (${{ 0: 'hit', 1: 'crit', 3: 'anomaly' }[cat] ?? '?'}): ${Object.keys(chains).length} distinct chains`);
  for (const [k, n] of Object.entries(chains).sort((a, b) => b[1] - a[1]).slice(0, 4)) {
    console.log(`  x${n}`);
    for (const rva of k.split(' > ')) { const i = rvaInfo.get(parseInt(rva, 16)); console.log(`     ${rva.padEnd(11)} ${i.name}${i.args != null ? '(' + i.args + ')' : ''}  +0x${(i.dist ?? 0).toString(16)}`); }
  }
}
// The first return whose method is NOT in the damage-text container is the calc-side caller.
const firstOutside = {};
for (const r of rows) {
  const h = r.rets.find(h => !/UIInLevelDamageText|UIInLevelSpecialDamageText/.test(rvaInfo.get(h.rva).name));
  if (h) { const k = '0x' + h.rva.toString(16); firstOutside[k] = (firstOutside[k] ?? 0) + 1; }
}
console.log('\n== first return address outside the damage-text classes (candidate calc-side callers):');
for (const [k, n] of Object.entries(firstOutside).sort((a, b) => b[1] - a[1]).slice(0, 10)) { const i = rvaInfo.get(parseInt(k, 16)); console.log(`  x${String(n).padStart(5)}  ${k.padEnd(11)} ${i.name}${i.args != null ? '(' + i.args + ')' : ''}  +0x${(i.dist ?? 0).toString(16)}`); }
// p12 identity
const p12 = {};
for (const r of rows) p12[r.p12] = (p12[r.p12] ?? 0) + 1;
console.log('\n== p12 distinct values:', Object.keys(p12).length, JSON.stringify(Object.entries(p12).sort((a, b) => b[1] - a[1]).slice(0, 6)));
if (out) writeFileSync(out, JSON.stringify({ rvaInfo: Object.fromEntries([...rvaInfo].map(([k, v]) => ['0x' + k.toString(16), v])), byCat, firstOutside, p12 }, null, 2));
