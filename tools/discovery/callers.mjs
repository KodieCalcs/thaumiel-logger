import fs from 'node:fs';
const b=fs.readFileSync('local-data/client-binaries-CNBetaWin3.3.0/GameAssembly.dll');
const pe=b.readUInt32LE(0x3c), nsec=b.readUInt16LE(pe+6), optsz=b.readUInt16LE(pe+20), sec=pe+24+optsz;
const secs=[]; for(let i=0;i<nsec;i++){const s=b.subarray(sec+i*40,sec+i*40+40); secs.push({name:s.toString('ascii',0,8).replace(/\0.*/,''),va:s.readUInt32LE(12),raw:s.readUInt32LE(20),rsz:s.readUInt32LE(16)});}
const il=secs.find(s=>s.name==='il2cpp'); const target=parseInt(process.argv[2],16);
for(let i=il.raw;i<il.raw+il.rsz-5;i++){ if(b[i]!==0xe8)continue; const rel=b.readInt32LE(i+1); const rva=il.va+(i-il.raw); if(((rva+5+rel)>>>0)===target) console.log('call from 0x'+rva.toString(16)); }
