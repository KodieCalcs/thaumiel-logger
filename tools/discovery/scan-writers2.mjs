import fs from 'node:fs';
const b=fs.readFileSync('local-data/client-binaries-CNBetaWin3.3.0/GameAssembly.dll');
const pe=b.readUInt32LE(0x3c), nsec=b.readUInt16LE(pe+6), optsz=b.readUInt16LE(pe+20), sec=pe+24+optsz;
const secs=[]; for(let i=0;i<nsec;i++){const s=b.subarray(sec+i*40,sec+i*40+40); secs.push({name:s.toString('ascii',0,8).replace(/\0.*/,''),va:s.readUInt32LE(12),vsz:s.readUInt32LE(8),raw:s.readUInt32LE(20),rsz:s.readUInt32LE(16)});}
const il=secs.find(s=>s.name==='il2cpp'); const start=il.raw, end=il.raw+il.rsz; const toRva=(off)=>il.va+(off-il.raw);
const disps={0x180:'atk',0x1bc:'impact',0x238:'am',0x25c:'ap'};
const hits=[];
for(let i=start;i<end-8;i++){
  // any disp32 memory store: 89 /r (mov r32->mem), F3 0F 11 (movss), 66 0F D6? skip; C7 (mov imm) skip
  let j=i; if((b[j]&0xf0)===0x40) j++;
  let op=null; if(b[j]===0x89) op='mov'; else if(b[j]===0xf3&&b[j+1]===0x0f&&b[j+2]===0x11) op='movss'; else continue;
  const mi=op==='mov'?j+1:j+3; const modrm=b[mi]; if((modrm&0xc0)!==0x80) continue;
  let k=mi+1; if((modrm&7)===4) k++;
  const disp=b.readInt32LE(k); if(!disps[disp]) continue;
  hits.push({off:i,rva:toRva(i),label:disps[disp],op});
}
const byWin=new Map(); for(const h of hits){ const w=h.off>>10; (byWin.get(w)||byWin.set(w,[]).get(w)).push(h); }
for(const [w,hs] of byWin){ const labels=new Set(hs.map(h=>h.label)); if(labels.size>=3) console.log('0x'+toRva(w<<10).toString(16), [...labels].join(','), hs.map(h=>h.label+'@0x'+h.rva.toString(16)+'/'+h.op).join(' ')); }
console.log('total',hits.length);
