"""Disassemble one method of a client build, naming call targets from the dump.

    py tools/discovery/disfn.py <version> <rva> [maxbytes]     e.g. 3.3.2 0x19885E90
Stops at the next method RVA in the dump (or maxbytes). Calls to dumped methods are annotated
Class::Method; other calls show the raw target.
"""
import os, sys, struct, bisect
from capstone import Cs, CS_ARCH_X86, CS_MODE_64
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'update'))
from dumpq import load
from paths import game_assembly
ver, rva = sys.argv[1], int(sys.argv[2], 16); maxb = int(sys.argv[3], 16) if len(sys.argv) > 3 else 0x4000
b = open(game_assembly(ver), 'rb').read(); pe = struct.unpack_from('<I', b, 0x3c)[0]; n = struct.unpack_from('<H', b, pe + 6)[0]
opt = struct.unpack_from('<H', b, pe + 20)[0]; off = pe + 24 + opt; secs = []
for i in range(n):
    vs, va, rs, ro = struct.unpack_from('<IIII', b, off + i * 40 + 8); secs.append((va, vs, ro, rs))
def r2o(r):
    for va, vs, ro, rs in secs:
        if va <= r < va + max(vs, rs): return ro + (r - va)
names = {}
for c in load(ver):
    for mn, pc, mr in c['methods']:
        if mr: names.setdefault(mr, f"{c['ns']}.{c['name']}::{mn}/{pc}")
rvas = sorted(names)
i = bisect.bisect_right(rvas, rva); end = rvas[i] if i < len(rvas) else rva + maxb
end = min(end, rva + maxb)
print(f"; {names.get(rva, '?')} @ 0x{rva:X} .. 0x{end:X}")
md = Cs(CS_ARCH_X86, CS_MODE_64); md.detail = True
o = r2o(rva)
for ins in md.disasm(b[o:o + (end - rva)], rva):
    note = ''
    if ins.mnemonic in ('call', 'jmp') and ins.op_str.startswith('0x'):
        t = int(ins.op_str, 16); note = '  ; ' + names.get(t, '')
    print(f"{ins.address:08x}  {ins.bytes.hex():22s} {ins.mnemonic} {ins.op_str}{note}")
