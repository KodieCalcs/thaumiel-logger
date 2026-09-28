// The fresh v7 dump identifies arg1's observed class as System.String. Decode only
// captured bytes; text is UI output, not proof of a one-to-one damage result.
import { readFileSync, writeFileSync } from 'node:fs';
const [file,out]=process.argv.slice(2);
const lines=readFileSync(file,'utf8').trim().split(/\r?\n/).filter(l=>!l.startsWith('#'));
const names=lines.shift().split('\t');
const result=[];
for(const line of lines){
  const values=line.split('\t');if(values.length!==names.length)continue;
  const r=Object.fromEntries(names.map((n,i)=>[n,values[i]]));
  const b=Buffer.alloc(64);for(let i=0;i<8;i++)b.writeBigUInt64LE(BigInt(r[`arg1_mem${i}`]),i*8);
  if(b.readBigUInt64LE()!==0x50001550358n)continue; // THIS capture's runtime class pointer only
  const len=b.readInt32LE(16), available=Number(r.arg1_bytes);
  if(len<0||20+len*2>available)continue;
  result.push({sequence:Number(r.sequence),timeMs:Number(r.elapsed_ms),caller:r.caller_rva,
    text:b.toString('utf16le',20,20+len*2),arg2:Number(BigInt(r.arg2)),arg6low:Number(BigInt(r.arg6)&0xffffffffn)});
}
if(out)writeFileSync(out,JSON.stringify(result,null,2));
const counts={};for(const r of result)counts[r.text]=(counts[r.text]??0)+1;
console.log(JSON.stringify({decoded:result.length,textCounts:counts,firstNonzero:result.filter(r=>r.text!=='0').slice(0,15)},null,2));
