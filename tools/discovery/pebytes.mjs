import fs from 'node:fs';
const [,, file, ...rvas]=process.argv;
const fd=fs.openSync(file,'r'); const rd=(off,n)=>{const b=Buffer.alloc(n); fs.readSync(fd,b,0,n,off); return b;};
const pe=rd(0x3c,4).readUInt32LE(0); const nsec=rd(pe+6,2).readUInt16LE(0); const optsz=rd(pe+20,2).readUInt16LE(0); const sec=pe+24+optsz;
const secs=[]; for(let i=0;i<nsec;i++){const s=rd(sec+i*40,40); secs.push({name:s.toString('ascii',0,8).replace(/\0.*/,''),va:s.readUInt32LE(12),vsz:s.readUInt32LE(8),raw:s.readUInt32LE(20),rsz:s.readUInt32LE(16)});}
for(const r of rvas){ const rva=parseInt(r,16); const s=secs.find(s=>rva>=s.va&&rva<s.va+Math.max(s.vsz,s.rsz)); const off=s.raw+(rva-s.va); const b=rd(off,64); console.log(r, s.name, 'fileoff 0x'+off.toString(16)); for(let i=0;i<64;i+=16) console.log('  '+[...b.subarray(i,i+16)].map(x=>x.toString(16).padStart(2,'0')).join(' ')); }
