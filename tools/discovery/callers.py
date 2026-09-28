"""Direct callers of one or more RVAs in a client's GameAssembly.dll (E8 rel32 calls in the
il2cpp section). mmap + bytes.find: ~5 s for the whole section.

    python tools/discovery/callers.py <version> <rva> [<rva>...]     e.g. 3.3.2 0x16A012B0
"""
import struct,sys,mmap,os
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'update'))
from paths import game_assembly
f=open(game_assembly(sys.argv[1]),'rb'); b=mmap.mmap(f.fileno(),0,access=mmap.ACCESS_READ)
pe=struct.unpack_from('<I',b,0x3c)[0]; nsec=struct.unpack_from('<H',b,pe+6)[0]; optsz=struct.unpack_from('<H',b,pe+20)[0]; sec=pe+24+optsz
il=None
for i in range(nsec):
    s=b[sec+i*40:sec+i*40+40]; name=s[:8].rstrip(b'\0').decode()
    if name=='il2cpp': il=dict(va=struct.unpack_from('<I',s,12)[0],rsz=struct.unpack_from('<I',s,16)[0],raw=struct.unpack_from('<I',s,20)[0])
targets={int(t,16):[] for t in sys.argv[2:]}
lo,hi=il['raw'],il['raw']+il['rsz']-5
i=b.find(b'\xe8',lo,hi)
while i!=-1:
    rel=struct.unpack_from('<i',b,i+1)[0]; rva=il['va']+(i-il['raw']); dst=(rva+5+rel)&0xffffffff
    if dst in targets: targets[dst].append(rva)
    i=b.find(b'\xe8',i+1,hi)
for t,v in targets.items(): print(hex(t),len(v),' '.join('0x%X'%x for x in v))
