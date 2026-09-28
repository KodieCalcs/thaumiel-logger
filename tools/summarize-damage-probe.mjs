import { readFileSync, writeFileSync } from 'node:fs';
const [file,out]=process.argv.slice(2);
const lines=readFileSync(file,'utf8').trim().split(/\r?\n/).filter(l=>!l.startsWith('#'));
const header=lines.shift().split('\t');
const rows=lines.map(l=>Object.fromEntries(l.split('\t').map((v,i)=>[header[i],v])));
const columns=header.filter(n=>/^arg\d+$|^xmm\d_\d$/.test(n));
const decode=h=>{const b=Buffer.alloc(8);b.writeBigUInt64LE(BigInt(h));return {u32:b.readUInt32LE(),f32:b.readFloatLE(),hi:b.readFloatLE(4),f64:b.readDoubleLE()};};
const stats=Object.fromEntries(columns.map(c=>{
  const counts=new Map();for(const r of rows)counts.set(r[c],(counts.get(r[c])??0)+1);
  return[c,{unique:counts.size,common:[...counts].sort((a,b)=>b[1]-a[1]).slice(0,5).map(([hex,count])=>({hex,count,...decode(hex)}))}];
}));
const summary={records:rows.length,firstMs:rows[0]?.elapsed_ms,lastMs:rows.at(-1)?.elapsed_ms,
  skipped:[...new Set(rows.map(r=>r.skipped))],stackBytes:[...new Set(rows.map(r=>r.stack_bytes))],arg1Bytes:[...new Set(rows.map(r=>r.arg1_bytes))],stats};
if(out)writeFileSync(out,JSON.stringify(summary,null,2));else console.log(JSON.stringify(summary,null,2));
