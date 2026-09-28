"""Pair two shape-identical functions instruction-by-instruction and report operand changes.
Because the mnemonic sequences match 1:1, any changed memory displacement is a moved field.

  py offsetdiff.py <oldRVA> <newRVA> [maxbytes]
"""
import struct, sys, re
from paths import LOCAL_DATA
from capstone import Cs, CS_ARCH_X86, CS_MODE_64
def load(p):
    b=open(p,'rb').read(); pe=struct.unpack_from('<I',b,0x3c)[0]; n=struct.unpack_from('<H',b,pe+6)[0]
    opt=struct.unpack_from('<H',b,pe+20)[0]; off=pe+24+opt; secs=[]
    for i in range(n):
        vs,va,rs,ro=struct.unpack_from('<IIII',b,off+i*40+8); secs.append((va,vs,ro,rs))
    return b,secs
def r2o(secs,rva):
    for va,vs,ro,rs in secs:
        if va<=rva<va+max(vs,rs): return ro+(rva-va)
md=Cs(CS_ARCH_X86,CS_MODE_64)
def dis(b,secs,rva,maxb):
    o=r2o(secs,rva); out=[]
    for ins in md.disasm(b[o:o+maxb], rva):
        out.append(ins)
        if ins.mnemonic=='ret': break
    return out
OLD=LOCAL_DATA+'/client-binaries-CNBetaWin3.3.2/GameAssembly.dll'
NEW=LOCAL_DATA+'/client-binaries-CNBetaWin3.3.3/GameAssembly.dll'
ob,os_=load(OLD); nb,ns=load(NEW)
o_rva=int(sys.argv[1],16); n_rva=int(sys.argv[2],16)
maxb=int(sys.argv[3],16) if len(sys.argv)>3 else 0x6000
a=dis(ob,os_,o_rva,maxb); b=dis(nb,ns,n_rva,maxb)
print('3.3.2 %#x: %d insns    3.3.3 %#x: %d insns' % (o_rva,len(a),n_rva,len(b)))
if len(a)!=len(b): print('WARNING: lengths differ; pairing by index anyway')
DISP=re.compile(r'([a-z0-9]+) \+ (0x[0-9a-f]+)')
print('\ninstructions whose operands differ (field/stack offsets):')
n=0
for i,(x,y) in enumerate(zip(a,b)):
    if x.mnemonic!=y.mnemonic:
        print('  [%3d] MNEMONIC DIFFERS  %s %s   vs   %s %s' % (i,x.mnemonic,x.op_str,y.mnemonic,y.op_str)); n+=1
    elif x.op_str!=y.op_str:
        ox=DISP.findall(x.op_str); oy=DISP.findall(y.op_str)
        tag=''
        if ox and oy and len(ox)==len(oy):
            moves=[(rx,vx,vy) for (rx,vx),(ry,vy) in zip(ox,oy) if vx!=vy]
            if moves: tag='   FIELD MOVED: ' + ', '.join('%s %s->%s'%(r,vx,vy) for r,vx,vy in moves)
        print('  [%3d] %-7s %-44s | %-44s%s' % (i,x.mnemonic,x.op_str,y.op_str,tag)); n+=1
print('\n%d differing instruction(s) of %d' % (n,min(len(a),len(b))))
