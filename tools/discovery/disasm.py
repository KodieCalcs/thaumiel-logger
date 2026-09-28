import sys,struct
from capstone import Cs,CS_ARCH_X86,CS_MODE_64
b=open('local-data/client-binaries-CNBetaWin3.3.0/GameAssembly.dll','rb').read()
pe=struct.unpack_from('<I',b,0x3c)[0]; nsec=struct.unpack_from('<H',b,pe+6)[0]; optsz=struct.unpack_from('<H',b,pe+20)[0]; sec=pe+24+optsz
secs=[]
for i in range(nsec):
    s=b[sec+i*40:sec+i*40+40]; secs.append((s[:8].rstrip(b'\0').decode(),struct.unpack_from('<I',s,12)[0],struct.unpack_from('<I',s,8)[0],struct.unpack_from('<I',s,20)[0],struct.unpack_from('<I',s,16)[0]))
def off(rva):
    for n,va,vsz,raw,rsz in secs:
        if va<=rva<va+max(vsz,rsz): return raw+rva-va
rva=int(sys.argv[1],16); n=int(sys.argv[2],16) if len(sys.argv)>2 else 0x200
md=Cs(CS_ARCH_X86,CS_MODE_64)
for ins in md.disasm(b[off(rva):off(rva)+n],rva): print(f"0x{ins.address:x}\t{ins.mnemonic}\t{ins.op_str}")
