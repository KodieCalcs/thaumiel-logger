"""Find the new-build counterpart of an obfuscated class by structural signature
(namespace, field count, method-arity multiset, named parent, surviving named methods).

  py classmatch.py <OldClassName> [...]      (THAUMIEL_OLD / THAUMIEL_NEW, default 3.3.0 / 3.3.2)
"""
import os, sys
from collections import Counter
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from dumpq import load

old = load(os.environ.get('THAUMIEL_OLD', '3.3.0')); new = load(os.environ.get('THAUMIEL_NEW', '3.3.2'))


def sig(c):
    return (c['ns'], len(c['fields']), tuple(sorted(pc for _, pc, _ in c['methods'])),
            c['parent'] if (c['parent'] or '').startswith(('MoleMole', 'System', 'UnityEngine')) or c['parent'] is None else 'obf',
            tuple(sorted(n for n, _, _ in c['methods'] if not (len(n) == 11 and n.isupper()))))  # named methods survive


idx = {}
for c in new:
    idx.setdefault(sig(c), []).append(c)

for name in sys.argv[1:]:
    cands = [c for c in old if c['name'] == name]
    for c in cands:
        s = sig(c)
        m = idx.get(s, [])
        print(f"OLD {c['ns']}.{c['name']} fields={len(c['fields'])} methods={len(c['methods'])} parent={c['parent']} -> {len(m)} candidate(s)")
        for n in m:
            print(f"    NEW {n['ns']}.{n['name']} ptr=0x{n['ptr']:X}")
        if not m:
            # relax: drop the named-method tuple and parent
            loose = [n for n in new if (n['ns'], len(n['fields']), tuple(sorted(pc for _, pc, _ in n['methods']))) == s[:3]]
            print(f"    loose (ns,fields,arity) matches: {len(loose)}: " + ", ".join(f"{n['name']}" for n in loose[:8]))
