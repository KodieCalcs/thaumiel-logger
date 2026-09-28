"""Query the il2cpp-v7.tsv dumps.

  py dumpq.py <ver> class <Name>            classes whose name == Name (any namespace): fields + methods
  py dumpq.py <ver> method <Name>           every method named Name: class, params, RVA
  py dumpq.py <ver> rva <0xRVA>             which method has this RVA
  py dumpq.py <ver> grep <regex>            class names matching regex
  py dumpq.py <ver> classat <0xptr>         class by runtime pointer
ver = client version, e.g. 3.3.2 (see paths.py). Builds an index.pkl beside the dump on first use.
"""
import sys, re, os, pickle
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from paths import dump_dir


def load(ver):
    cache = os.path.join(dump_dir(ver), 'index.pkl')
    if os.path.exists(cache):
        return pickle.load(open(cache, 'rb'))
    classes = []  # dict(ns, name, ptr, fields=[(name,off)], methods=[(name,params,rva)], parent)
    cur = None
    with open(os.path.join(dump_dir(ver), 'il2cpp-v7.tsv'), 'rb') as f:
        for raw in f:
            p = raw.rstrip(b'\r\n').split(b'\t')
            t = p[0]
            if t == b'CLASS':
                cur = {'ns': p[3].decode('utf-8', 'replace'), 'name': p[4].decode('utf-8', 'replace'),
                       'ptr': int(p[5], 16), 'fields': [], 'methods': [], 'parent': None}
                classes.append(cur)
            elif t == b'FIELD' and cur is not None:
                cur['fields'].append((p[1].decode('utf-8', 'replace'), int(p[2], 16)))
            elif t == b'FIELD_TYPE' and cur is not None and cur['fields']:
                cur.setdefault('ftypes', []).append(p[2].decode('utf-8', 'replace') if len(p) > 2 else '')
            elif t == b'METHOD' and cur is not None:
                rva = int(p[4], 16) if p[3] == b'RVA' else None
                cur['methods'].append((p[1].decode('utf-8', 'replace'), int(p[2]), rva))
            elif t == b'PARENT' and cur is not None:
                cur['parent'] = p[2].decode('utf-8', 'replace') if len(p) > 2 else None
    pickle.dump(classes, open(cache, 'wb'))
    return classes


def show(c, methods=True):
    print(f"CLASS {c['ns']}.{c['name']}  ptr=0x{c['ptr']:X}  parent={c['parent']}")
    for n, o in c['fields']:
        print(f"  FIELD  {n:40s} 0x{o:X}")
    if methods:
        for n, pc, rva in c['methods']:
            print(f"  METHOD {n:40s} params={pc:<2d} {'RVA 0x%X' % rva if rva else 'unresolved'}")


if __name__ == '__main__':
    ver, cmd, arg = sys.argv[1], sys.argv[2], sys.argv[3]
    cs = load(ver)
    if cmd == 'class':
        for c in cs:
            if c['name'] == arg: show(c)
    elif cmd == 'method':
        for c in cs:
            for n, pc, rva in c['methods']:
                if n == arg: print(f"{c['ns']}.{c['name']}::{n}  params={pc}  {'RVA 0x%X' % rva if rva else 'unresolved'}")
    elif cmd == 'rva':
        want = int(arg, 16)
        for c in cs:
            for n, pc, rva in c['methods']:
                if rva == want: print(f"{c['ns']}.{c['name']}::{n}  params={pc}")
    elif cmd == 'grep':
        rx = re.compile(arg)
        for c in cs:
            if rx.search(c['name']): print(f"{c['ns']}.{c['name']}  fields={len(c['fields'])} methods={len(c['methods'])} ptr=0x{c['ptr']:X}")
    elif cmd == 'classat':
        want = int(arg, 16)
        for c in cs:
            if c['ptr'] == want: show(c)
