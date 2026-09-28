"""Print a class's methods with parameter and return types from the dump.
    py tools/discovery/sig.py <version> <ClassName> [regex on types/names]"""
import sys, os, re
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'update'))
from paths import dump_dir
ver, cls = sys.argv[1], sys.argv[2]; pat = re.compile(sys.argv[3]) if len(sys.argv) > 3 else None
cur = None; meth = None; out = []
with open(os.path.join(dump_dir(ver), 'il2cpp-v7.tsv'), 'rb') as f:
    for raw in f:
        p = raw.rstrip(b'\r\n').split(b'\t'); t = p[0]
        if t == b'CLASS':
            if cur: break
            if p[4].decode('utf-8', 'replace') == cls: cur = p
        elif cur is None: continue
        elif t == b'FIELD': out.append(['F', p[1].decode(), p[2].decode(), []])
        elif t == b'FIELD_TYPE': out[-1][3].append(p[2].decode('utf-8', 'replace') if len(p) > 2 else '')
        elif t == b'METHOD': out.append(['M', p[1].decode(), p[4].decode() if p[3] == b'RVA' else '-', []])
        elif t in (b'PARAM_TYPE', b'RETURN_TYPE'): out[-1][3].append(('->' if t == b'RETURN_TYPE' else '') + (p[2].decode('utf-8', 'replace') if len(p) > 2 else ''))
        elif t == b'METHOD_FLAGS': out[-1][3].append('flags=' + p[1].decode())
for k, n, r, ts in out:
    line = f"{k} {n:32s} {r:12s} {' '.join(ts)}"
    if pat is None or pat.search(line): print(line)
