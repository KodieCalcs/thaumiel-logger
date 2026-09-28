"""Rank candidate 3.3.3 functions against a 3.3.2 target by instruction shape.

  py shapematch.py <oldRVA> <newRVA>[,<newRVA>...]

Generated il2cpp code is re-emitted per build, so byte signatures fail; the mnemonic
sequence survives. This is the technique the 3.3.2 update used to confirm the hit-result
factory ("same shape, 1410 vs 1409 instructions, 99.5%").
"""
import struct, sys, difflib
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
def shape(b,secs,rva,maxb=0x6000):
    o=r2o(secs,rva)
    if o is None: return [],[]
    mn=[]; full=[]
    depth=0
    for ins in md.disasm(b[o:o+maxb], rva):
        mn.append(ins.mnemonic)
        full.append('%s %s' % (ins.mnemonic, ins.op_str))
        if ins.mnemonic=='ret': break
        if ins.mnemonic=='int3' and len(mn)>8: break
    return mn, full
OLD=LOCAL_DATA+'/client-binaries-CNBetaWin3.3.2/GameAssembly.dll'
NEW=LOCAL_DATA+'/client-binaries-CNBetaWin3.3.3/GameAssembly.dll'
ob,os_=load(OLD); nb,ns=load(NEW)
oldrva=int(sys.argv[1],16)
cands=[int(x,16) for x in sys.argv[2].split(',')]
om,of=shape(ob,os_,oldrva)
print('TARGET 3.3.2 %#x: %d instructions' % (oldrva,len(om)))
print('   first 8: %s' % ' | '.join(of[:8]))
rows=[]
for c in cands:
    nm,nf=shape(nb,ns,c)
    r=difflib.SequenceMatcher(None,om,nm).ratio()
    rows.append((r,c,len(nm),nf))
rows.sort(reverse=True)
print('\nranked candidates:')
for r,c,n,nf in rows:
    print('  %6.2f%%  %#-12x %5d instructions  (delta %+d)' % (100*r,c,n,n-len(om)))
best=rows[0]
print('\nBEST %#x at %.2f%%; runner-up %.2f%% (gap %.2f pts)'
      % (best[1],100*best[0],100*rows[1][0] if len(rows)>1 else 0,
         100*(best[0]-rows[1][0]) if len(rows)>1 else 0))
print('\nbest candidate first 8: %s' % ' | '.join(best[3][:8]))
