"""Functions of a client build whose body contains ALL the given disp32 operands (little-endian
4-byte immediates such as struct offsets), bounded by the dump's method RVAs. Cheap way to find
"the function that reads result+0x144 and result+0x1ac" without a disassembler pass.

    py tools/discovery/cooccur.py <version> <disp> [<disp>...]     e.g. 3.3.2 0x144 0x1ac
"""
import os, sys, struct, bisect, mmap
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'update'))
from dumpq import load
from paths import game_assembly
ver = sys.argv[1]; disps = [int(x, 16) for x in sys.argv[2:]]
f = open(game_assembly(ver), 'rb'); b = mmap.mmap(f.fileno(), 0, access=mmap.ACCESS_READ)
pe = struct.unpack_from('<I', b, 0x3c)[0]; nsec = struct.unpack_from('<H', b, pe + 6)[0]; optsz = struct.unpack_from('<H', b, pe + 20)[0]; sec = pe + 24 + optsz
il = None
for i in range(nsec):
    s = b[sec + i * 40:sec + i * 40 + 40]
    if s[:8].rstrip(b'\0') == b'il2cpp': il = dict(va=struct.unpack_from('<I', s, 12)[0], rsz=struct.unpack_from('<I', s, 16)[0], raw=struct.unpack_from('<I', s, 20)[0])
names = {}
for c in load(ver):
    for mn, pc, mr in c['methods']:
        if mr: names.setdefault(mr, f"{c['ns']}.{c['name']}::{mn}/{pc}")
rvas = sorted(names)
def fn(rva):
    i = bisect.bisect_right(rvas, rva) - 1
    return rvas[i] if i >= 0 else None
sets = []
for d in disps:
    pat = struct.pack('<I', d); hits = {}
    lo, hi = il['raw'], il['raw'] + il['rsz']
    i = b.find(pat, lo, hi)
    while i != -1:
        rva = il['va'] + (i - il['raw']); f0 = fn(rva)
        if f0 is not None: hits.setdefault(f0, []).append(rva)
        i = b.find(pat, i + 1, hi)
    sets.append(hits)
common = set(sets[0])
for s in sets[1:]: common &= set(s)
for f0 in sorted(common):
    print(f"0x{f0:X}  {names[f0]}  " + '  '.join(f"0x{d:x}:x{len(s[f0])}" for d, s in zip(disps, sets)))
print(f"# {len(common)} functions contain all of {[hex(d) for d in disps]}")
