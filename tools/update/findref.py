"""Find methods of a class (in one build) whose code references given field displacements.
  py findref.py <ver:3.3.2|3.3.3> <class> <disp,disp,...>
"""
import struct, sys, re
from paths import LOCAL_DATA
from capstone import Cs, CS_ARCH_X86, CS_MODE_64
DUMP={'3.3.2':LOCAL_DATA+'/il2cpp-dump/CNBetaWin3.3.2/il2cpp-v7.tsv',
      '3.3.3':LOCAL_DATA+'/il2cpp-dump/CNBetaWin3.3.3/il2cpp-v7.tsv'}
BIN={'3.3.2':LOCAL_DATA+'/client-binaries-CNBetaWin3.3.2/GameAssembly.dll',
     '3.3.3':LOCAL_DATA+'/client-binaries-CNBetaWin3.3.3/GameAssembly.dll'}
def load(p):
    b=open(p,'rb').read(); pe=struct.unpack_from('<I',b,0x3c)[0]; n=struct.unpack_from('<H',b,pe+6)[0]
    opt=struct.unpack_from('<H',b,pe+20)[0]; off=pe+24+opt; secs=[]
    for i in range(n):
        vs,va,rs,ro=struct.unpack_from('<IIII',b,off+i*40+8); secs.append((va,vs,ro,rs))
    return b,secs
def r2o(secs,rva):
    for va,vs,ro,rs in secs:
        if va<=rva<va+max(vs,rs): return ro+(rva-va)
def methods(path, cls):
    out=[]; inside=False
    for raw in open(path,'rb'):
        p=raw.rstrip(b'\r\n').split(b'\t')
        if p[0]==b'CLASS':
            name=p[4].decode('latin1') if len(p)>4 else ''
            if inside: break
            inside=(name==cls)
        elif inside and p[0]==b'METHOD' and len(p)>4 and p[3]==b'RVA':
            out.append((p[1].decode('latin1'), int(p[2]), int(p[4],16)))
    return out
ver,cls = sys.argv[1], sys.argv[2]
disps=[int(x,16) for x in sys.argv[3].split(',')]
b,secs=load(BIN[ver]); md=Cs(CS_ARCH_X86,CS_MODE_64)
pats={d: re.compile(r'\+ 0x%x\]' % d) for d in disps}
print('methods of %s (%s) referencing %s:' % (cls,ver,', '.join(hex(d) for d in disps)))
for name,arity,rva in methods(DUMP[ver],cls):
    o=r2o(secs,rva)
    if o is None: continue
    hits={d:0 for d in disps}; n=0
    for ins in md.disasm(b[o:o+0x4000], rva):
        n+=1
        for d,pat in pats.items():
            if pat.search(ins.op_str): hits[d]+=1
        if ins.mnemonic=='ret': break
        # int3 padding marks the end of the function; running past it walks into the NEXT
        # function and attributes ITS field references to this method (bug found 2026-09-22).
        if ins.mnemonic=='int3' and n>8: break
    if any(hits.values()):
        print('  %-14s arity=%d rva=%#-12x insns=%-5d %s' % (name,arity,rva,n,
              ' '.join('%s x%d'%(hex(d),c) for d,c in hits.items() if c)))
