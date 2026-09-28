"""For each direct caller of <rva>, disassemble the ~24 instructions before the call and print the
immediate loaded into a chosen register (edx/r8d/r9d) closest to the call, plus the enclosing
method. Used to find which call sites pass a hard-coded enum id (e.g. BaseProperty.CurStun = 0xB).

    py tools/discovery/callsite-imm.py <version> <rva> [reg=edx] [want=0xB]
"""
import os, sys, struct, bisect, mmap, subprocess
from capstone import Cs, CS_ARCH_X86, CS_MODE_64
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'update'))
from dumpq import load
from paths import game_assembly
ver, target = sys.argv[1], int(sys.argv[2], 16)
reg = sys.argv[3] if len(sys.argv) > 3 else 'edx'; want = int(sys.argv[4], 16) if len(sys.argv) > 4 else None
b = open(game_assembly(ver), 'rb').read(); pe = struct.unpack_from('<I', b, 0x3c)[0]; nsec = struct.unpack_from('<H', b, pe + 6)[0]; optsz = struct.unpack_from('<H', b, pe + 20)[0]; sec = pe + 24 + optsz
il = None
for i in range(nsec):
    s = b[sec + i * 40:sec + i * 40 + 40]
    if s[:8].rstrip(b'\0') == b'il2cpp': il = dict(va=struct.unpack_from('<I', s, 12)[0], rsz=struct.unpack_from('<I', s, 16)[0], raw=struct.unpack_from('<I', s, 20)[0])
def r2o(r): return il['raw'] + (r - il['va'])
names = {}
for c in load(ver):
    for mn, pc, mr in c['methods']:
        if mr: names.setdefault(mr, f"{c['ns']}.{c['name']}::{mn}/{pc}")
rvas = sorted(names)
def fn(rva):
    i = bisect.bisect_right(rvas, rva) - 1
    return rvas[i]
callers = []
lo, hi = il['raw'], il['raw'] + il['rsz'] - 5
i = b.find(b'\xe8', lo, hi)
while i != -1:
    rel = struct.unpack_from('<i', b, i + 1)[0]; rva = il['va'] + (i - il['raw'])
    if (rva + 5 + rel) & 0xffffffff == target: callers.append(rva)
    i = b.find(b'\xe8', i + 1, hi)
md = Cs(CS_ARCH_X86, CS_MODE_64)
for site in callers:
    f0 = fn(site); start = max(f0, site - 160)
    insns = list(md.disasm(b[r2o(start):r2o(site)], start))
    # re-sync: keep the tail that ends exactly at the call
    imm = None; how = ''
    for ins in reversed(insns[-24:]):
        if ins.mnemonic == 'mov' and ins.op_str.startswith(reg + ', '):
            v = ins.op_str.split(', ')[1]
            if v.startswith('0x') or v.isdigit(): imm = int(v, 0); how = 'imm'
            else: how = 'reg:' + v
            break
        if ins.mnemonic in ('xor',) and ins.op_str == f'{reg}, {reg}': imm = 0; how = 'xor'; break
    if want is None or imm == want:
        print(f"0x{site:X} in 0x{f0:X} {names[f0]:60s} {reg}={'0x%X' % imm if imm is not None else '?'} {how}")
print(f"# {len(callers)} call sites")
