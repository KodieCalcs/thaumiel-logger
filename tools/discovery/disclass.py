"""Disassemble every method of one class (dump index loaded once) and print the lines matching a
regex, prefixed by the method name — e.g. all stores to a field:

    py tools/discovery/disclass.py <version> <ClassName> "<regex>"
"""
import os, sys, struct, bisect, re
from capstone import Cs, CS_ARCH_X86, CS_MODE_64
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'update'))
from dumpq import load
from paths import game_assembly
ver, cls, pat = sys.argv[1], sys.argv[2], re.compile(sys.argv[3])
b = open(game_assembly(ver), 'rb').read(); pe = struct.unpack_from('<I', b, 0x3c)[0]; n = struct.unpack_from('<H', b, pe + 6)[0]
opt = struct.unpack_from('<H', b, pe + 20)[0]; off = pe + 24 + opt; secs = []
for i in range(n):
    vs, va, rs, ro = struct.unpack_from('<IIII', b, off + i * 40 + 8); secs.append((va, vs, ro, rs))
def r2o(r):
    for va, vs, ro, rs in secs:
        if va <= r < va + max(vs, rs): return ro + (r - va)
names = {}; mine = []
for c in load(ver):
    for mn, pc, mr in c['methods']:
        if mr:
            names.setdefault(mr, f"{c['ns']}.{c['name']}::{mn}/{pc}")
            if c['name'] == cls: mine.append((mr, mn, pc))
rvas = sorted(names)
md = Cs(CS_ARCH_X86, CS_MODE_64)
for mr, mn, pc in sorted(mine):
    i = bisect.bisect_right(rvas, mr); end = min(rvas[i] if i < len(rvas) else mr + 0x4000, mr + 0x8000)
    for ins in md.disasm(b[r2o(mr):r2o(mr) + (end - mr)], mr):
        s = f"{ins.mnemonic} {ins.op_str}"
        if pat.search(s):
            note = ''
            if ins.mnemonic == 'call' and ins.op_str.startswith('0x'): note = '  ; ' + names.get(int(ins.op_str, 16), '')
            print(f"{mn}/{pc} @0x{mr:X}  {ins.address:08x}  {s}{note}")
