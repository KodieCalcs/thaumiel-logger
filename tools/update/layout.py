"""Print two classes' field layouts side by side, aligned by offset.
  py layout.py <oldcls> <newcls> [pinned offsets, hex, comma separated]
"""
import sys, re
from paths import LOCAL_DATA
D2=LOCAL_DATA+'/il2cpp-dump/CNBetaWin3.3.2/il2cpp-v7.tsv'
D3=LOCAL_DATA+'/il2cpp-dump/CNBetaWin3.3.3/il2cpp-v7.tsv'
OBF=re.compile(r'\b[A-Z]{11}\b')
def norm(t): return OBF.sub('#OBF#', t)
def fields(path, cls):
    out=[]; inside=False; pend=None
    for raw in open(path,'rb'):
        p=raw.rstrip(b'\r\n').split(b'\t')
        t=p[0]
        if t==b'CLASS':
            name=p[4].decode('latin1') if len(p)>4 else ''
            if inside: break
            inside=(name==cls)
        elif inside and t==b'FIELD':
            pend=(p[1].decode('latin1'), int(p[2],16))
        elif inside and t==b'FIELD_TYPE' and pend:
            out.append((pend[1], pend[0], norm(p[2].decode('latin1') if len(p)>2 else '?'))); pend=None
    return sorted(out)
oldcls,newcls = sys.argv[1], sys.argv[2]
pins = [int(x,16) for x in sys.argv[3].split(',')] if len(sys.argv)>3 else []
a=fields(D2,oldcls); b=fields(D3,newcls)
print('%-40s | %s' % ('3.3.2 '+oldcls+' (%d fields)'%len(a), '3.3.3 '+newcls+' (%d fields)'%len(b)))
print('-'*100)
n=max(len(a),len(b))
for i in range(n):
    L = '  0x%-5x %-28s' % (a[i][0],a[i][2]) if i<len(a) else ' '*36
    R = '  0x%-5x %-28s' % (b[i][0],b[i][2]) if i<len(b) else ''
    mark=''
    if i<len(a) and a[i][0] in pins: mark=' <== PINNED 0x%x' % a[i][0]
    same = '  ' if (i<len(a) and i<len(b) and a[i][2]==b[i][2]) else '~ '
    print('%s%-38s|%s%s' % (same,L,R,mark))
print()
ta={o:t for o,_,t in a}; tb={o:t for o,_,t in b}
print('by-index type agreement: %d/%d' % (sum(1 for i in range(min(len(a),len(b))) if a[i][2]==b[i][2]), min(len(a),len(b))))
for p in pins:
    if p in ta:
        idx=[i for i,(o,_,_) in enumerate(a) if o==p][0]
        t=ta[p]
        print('\nPINNED 0x%x  type=%s  (index %d of %d)' % (p,t,idx,len(a)))
        if idx < len(b):
            print('   same index in 3.3.3: 0x%x type=%s  %s' % (b[idx][0],b[idx][2],'TYPE OK' if b[idx][2]==t else 'TYPE DIFFERS'))
        cands=[(o,tt) for o,_,tt in b if tt==t]
        print('   3.3.3 fields of this type: %s' % ', '.join('0x%x'%o for o,_ in cands))
