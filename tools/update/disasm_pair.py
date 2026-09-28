"""Side-by-side disassembly.  py disasm_pair.py <old.dll> <new.dll> <oldRVA:newRVA> [...]"""
import struct,sys
from capstone import Cs,CS_ARCH_X86,CS_MODE_64
def load(p):
    b=open(p,'rb').read(); pe=struct.unpack_from('<I',b,0x3c)[0]; n=struct.unpack_from('<H',b,pe+6)[0]; opt=struct.unpack_from('<H',b,pe+20)[0]; off=pe+24+opt; secs=[]
    for i in range(n):
        vs,va,rs,ro=struct.unpack_from('<IIII',b,off+i*40+8); secs.append((va,vs,ro,rs))
    return b,secs
def r2o(secs,rva):
    for va,vs,ro,rs in secs:
        if va<=rva<va+max(vs,rs): return ro+(rva-va)
md=Cs(CS_ARCH_X86,CS_MODE_64)
def dis(b,secs,rva,n=40,stop=True):
    o=r2o(secs,rva); out=[]
    for i in md.disasm(b[o:o+400],rva):
        out.append(f"  {i.address:08x}  {i.bytes.hex():24s} {i.mnemonic} {i.op_str}")
        if stop and i.mnemonic in('ret','int3') or len(out)>=n: break
    return out
ob,os_=load(sys.argv[1]); nb,ns=load(sys.argv[2])
for pair in sys.argv[3:]:
    a,b_=pair.split(':'); a=int(a,16); b_=int(b_,16)
    print(f"=== old 0x{a:x}"); print("\n".join(dis(ob,os_,a))); print(f"=== new 0x{b_:x}"); print("\n".join(dis(nb,ns,b_)))
