import sys
from paths import LOCAL_DATA
D3=LOCAL_DATA+'/il2cpp-dump/CNBetaWin3.3.3/il2cpp-v7.tsv'
cls=sys.argv[1]; inside=False; out=[]
for raw in open(D3,'rb'):
    p=raw.rstrip(b'\r\n').split(b'\t')
    if p[0]==b'CLASS':
        name=p[4].decode('latin1') if len(p)>4 else ''
        if inside: break
        inside=(name==cls)
    elif inside and p[0]==b'METHOD' and len(p)>4:
        try: out.append(int(p[4],16))
        except ValueError: pass
print(','.join(hex(x) for x in out))
