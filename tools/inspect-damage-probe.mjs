// Read-only inspection of raw probe words. Candidates are NOT decoded damage.
// node inspect-damage-probe.mjs <damage-probe-*.tsv> [visible-number]
import { readFileSync } from 'node:fs';
const [file, wantedText] = process.argv.slice(2);
if (!file) throw new Error('usage: node inspect-damage-probe.mjs <file.tsv> [visible-number]');
const lines = readFileSync(file, 'utf8').trim().split(/\r?\n/).filter(x => !x.startsWith('#'));
const names = lines.shift().split('\t');
const wanted = wantedText === undefined ? undefined : Number(wantedText);
if (wanted !== undefined && !Number.isFinite(wanted)) throw new Error('visible-number must be finite');
let rows=0, incomplete=0, matches=0;
const callers=new Map();
for (const line of lines) {
  const cells=line.split('\t');
  if(cells.length!==names.length){incomplete++;continue;}
  const row=Object.fromEntries(names.map((n,i)=>[n,cells[i]])); rows++;
  callers.set(row.caller_rva,(callers.get(row.caller_rva)??0)+1);
  if(wanted===undefined) continue;
  for(const name of names.filter(n=>/^arg\d+$|^xmm\d_\d$|^arg1_mem\d+$/.test(n))){
    if(name.startsWith('arg1_mem') && Number(name.slice(8))*8+8>Number(row.arg1_bytes))continue;
    if(/^arg\d+$/.test(name) && Number(name.slice(3))>=4 && (Number(name.slice(3))-3)*8>Number(row.stack_bytes))continue;
    const b=Buffer.alloc(8);b.writeBigUInt64LE(BigInt(row[name]));
    const views={u32:b.readUInt32LE(0),i32:b.readInt32LE(0),f32low:b.readFloatLE(0),f32high:b.readFloatLE(4),f64:b.readDoubleLE(0)};
    for(const [type,value] of Object.entries(views)){
      if(Number.isFinite(value)&&Math.abs(value-wanted)<=1){
        console.log(`event=${row.sequence} t=${row.elapsed_ms} ${name}/${type}=${value} caller=${row.caller_rva}`);matches++;
      }
    }
  }
}
console.log(JSON.stringify({rows,incomplete,callers:Object.fromEntries(callers),...(wanted===undefined?{}:{candidateMatches:matches})},null,2));
console.log('UI method invocations, not proven hit counts. Numeric matches are hypotheses; validate against repeated events.');
