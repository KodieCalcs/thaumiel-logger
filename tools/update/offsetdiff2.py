"""Align two functions by mnemonic sequence (difflib) and report operand/field changes.

Improvement over naive index pairing: tolerates inserted/removed instructions, which a
build-to-build re-emission routinely has. Only instructions inside EQUAL blocks are compared,
so a displacement change reported here is a genuine field move, not drift past an insertion.

  py offsetdiff2.py <oldRVA> <newRVA> [focus disps, hex, comma separated]
"""
import struct, sys, re, difflib
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
def dis(b,secs,rva,maxb=0x8000):
    o=r2o(secs,rva); out=[]
    for ins in md.disasm(b[o:o+maxb], rva):
        out.append(ins)
        if ins.mnemonic=='ret': break
        if ins.mnemonic=='int3' and len(out)>8: break
    return out
OLD=LOCAL_DATA+'/client-binaries-CNBetaWin3.3.2/GameAssembly.dll'
NEW=LOCAL_DATA+'/client-binaries-CNBetaWin3.3.3/GameAssembly.dll'
ob,os_=load(OLD); nb,ns=load(NEW)
a=dis(ob,os_,int(sys.argv[1],16)); b=dis(nb,ns,int(sys.argv[2],16))
focus=[int(x,16) for x in sys.argv[3].split(',')] if len(sys.argv)>3 else []
print('3.3.2: %d insns    3.3.3: %d insns' % (len(a),len(b)))
ma=[i.mnemonic for i in a]; mb=[i.mnemonic for i in b]
sm=difflib.SequenceMatcher(None,ma,mb)
print('alignment ratio %.2f%%' % (100*sm.ratio()))
DISP=re.compile(r'([a-z0-9]+) ([+-]) (0x[0-9a-f]+)\]')
found={}
for tag,i1,i2,j1,j2 in sm.get_opcodes():
    if tag!='equal': continue
    for k in range(i2-i1):
        x=a[i1+k]; y=b[j1+k]
        if x.op_str==y.op_str: continue
        ox=DISP.findall(x.op_str); oy=DISP.findall(y.op_str)
        if not (ox and oy and len(ox)==len(oy)): continue
        for (rx,sx,vx),(ry,sy,vy) in zip(ox,oy):
            if vx==vy: continue
            d=int(vx,16)
            if focus and d not in focus: continue
            found.setdefault(d,set()).add(vy)
            print('  %-7s %-42s | %-42s   %s %s -> %s' % (x.mnemonic,x.op_str,y.op_str,rx,vx,vy))
print()
for d in sorted(found):
    vals=found[d]
    print('  0x%-5x -> %s%s' % (d, ', '.join(sorted(vals)), '   AMBIGUOUS' if len(vals)>1 else ''))
