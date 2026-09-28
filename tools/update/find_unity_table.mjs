// Re-find Unity's il2cpp API table offset inside a new UnityPlayer.dll.
//   node find_unity_table.mjs <old UnityPlayer.dll> <new UnityPlayer.dll> <old table offset hex>
// Scans the old .text for RIP-relative displacements resolving to the old table, masked-searches the
// surrounding code in the new build, and validates the candidate by counting call [rip+..] sites
// that land inside it (should match the old build's count / distinct-slot count).
// The anchor byte patterns below are the two sites found for 3.3.3 (0xb65750 mov rax,[rip+..] -> table[0];
// 0xb6562f -> table[2]); if they fail on a future build, re-derive them from the OLD-line output above
// (the disp@ address minus 3 is the mov's own address). 3.3.0 anchors were 0xb63de0 / 0xb63cbf.
import { readFileSync } from "node:fs";
function load(p){const b=readFileSync(p);const pe=b.readUInt32LE(0x3c);const n=b.readUInt16LE(pe+6);const opt=b.readUInt16LE(pe+20);const off=pe+24+opt;const secs={};
 for(let i=0;i<n;i++){const o=off+i*40;const name=b.toString('latin1',o,o+8).replace(/\0+$/,'');secs[name]={vs:b.readUInt32LE(o+8),va:b.readUInt32LE(o+12),rs:b.readUInt32LE(o+16),ro:b.readUInt32LE(o+20)};}return {b,secs};}
function refs(b,secs,target,slack){const {va,ro,rs}=secs['.text'];const hits=[];
 for(let p=0;p+4<=rs;p++){const d=b.readInt32LE(ro+p);for(const tail of [0,1,4]){const tgt=va+p+4+tail+d;if(tgt>=target-slack&&tgt<=target+slack)hits.push({p,tail,tgt});}}return hits;}
const [oldp,newp,t]=process.argv.slice(2);const target=parseInt(t,16);
const o=load(oldp);
for(const h of refs(o.b,o.secs,target,0x10)){const {va,ro}=o.secs['.text'];const ctx=o.b.subarray(ro+h.p-8,ro+h.p+4+h.tail+4);console.log(`OLD disp@0x${(va+h.p).toString(16)} tail=${h.tail} -> 0x${h.tgt.toString(16)}  ctx=${ctx.toString('hex')}`);}
// --- phase 2: masked search for the anchors in the new build
const n=load(newp);
function maskedSearch(oldRva, before, after, dispOffsets){ // dispOffsets: positions (relative to ctx start) of 4-byte disp fields to wildcard
  const {va:ova,ro:oro}=o.secs['.text'];const ctx=o.b.subarray(oro+oldRva-ova-before,oro+oldRva-ova+after);
  const {va:nva,ro:nro,rs:nrs}=n.secs['.text'];const t=n.b.subarray(nro,nro+nrs);const hits=[];
  outer: for(let p=0;p+ctx.length<=t.length;p++){for(let i=0;i<ctx.length;i++){if(dispOffsets.some(d=>i>=d&&i<d+4))continue;if(t[p+i]!==ctx[i])continue outer;}hits.push(nva+p+before);}
  return hits;}
// anchor A: 0xb65750 = mov rax,[rip+d] -> table[0]; ctx: ff15 dddd | 488b05 dddd | 488d0d dddd
const A=maskedSearch(0xb65750,6,14,[2,9,16]);
console.log('anchor A candidates',A.map(x=>'0x'+x.toString(16)));
for(const a of A){const {va,ro}=n.secs['.text'];const d=n.b.readInt32LE(ro+a-va+3);console.log(`  new mov rax,[rip+..] at 0x${a.toString(16)} -> table[0] = 0x${(a+7+d).toString(16)}`);}
// anchor B: 0xb6562f = mov rax,[rip+d] -> table[2]; ctx: 4301 498b0e | 488b05 dddd | 4885c9 75
const B=maskedSearch(0xb6562f,5,14,[8]);
for(const a of B){const {va,ro}=n.secs['.text'];const d=n.b.readInt32LE(ro+a-va+3);console.log(`  anchor B at 0x${a.toString(16)} -> table[2] = 0x${(a+7+d).toString(16)}  => table[0]=0x${(a+7+d-16).toString(16)}`);}
// reference count check: how many ff15 call sites land inside [table, table+194*8) in each build
function callsInto(x,table){const {va,ro,rs}=x.secs['.text'];let c=0;const slots=new Set();for(let p=0;p+6<=rs;p++){if(x.b[ro+p]===0xff&&x.b[ro+p+1]===0x15){const tgt=va+p+6+x.b.readInt32LE(ro+p+2);if(tgt>=table&&tgt<table+194*8&&(tgt-table)%8===0){c++;slots.add((tgt-table)/8);}}}return [c,slots.size];}
console.log('old: call[rip] sites into table, distinct slots =',callsInto(o,parseInt(t,16)));
for(const a of A){const {va,ro}=n.secs['.text'];const d=n.b.readInt32LE(ro+a-va+3);const cand=a+7+d;console.log(`new: candidate 0x${cand.toString(16)} sites,slots =`,callsInto(n,cand));}
