"""Every instruction in the il2cpp section whose memory operand displacement equals <disp>,
grouped by enclosing dumped method, with load/store direction. Byte-pattern prefilter (the
4-byte LE displacement) selects candidate functions; each is then linearly disassembled from
its start (bounded by the next dumped RVA) so decoding stays in sync.

    py tools/discovery/disp-xref.py <version> <disp> [store|load] [minsize]
minsize (default 4): ignore byte/word accesses, which are mostly false positives.
"""
import os, sys, struct, bisect, mmap
from capstone import Cs, CS_ARCH_X86, CS_MODE_64
from capstone.x86 import X86_OP_MEM
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'update'))
from dumpq import load
from paths import game_assembly
ver, disp = sys.argv[1], int(sys.argv[2], 16); want = sys.argv[3] if len(sys.argv) > 3 and sys.argv[3] in ('store', 'load') else None
minsize = int(sys.argv[4]) if len(sys.argv) > 4 else 4
f = open(game_assembly(ver), 'rb'); b = mmap.mmap(f.fileno(), 0, access=mmap.ACCESS_READ)
pe = struct.unpack_from('<I', b, 0x3c)[0]; nsec = struct.unpack_from('<H', b, pe + 6)[0]; optsz = struct.unpack_from('<H', b, pe + 20)[0]; sec = pe + 24 + optsz
for i in range(nsec):
    s = b[sec + i * 40:sec + i * 40 + 40]
    if s[:8].rstrip(b'\0') == b'il2cpp': il = dict(va=struct.unpack_from('<I', s, 12)[0], rsz=struct.unpack_from('<I', s, 16)[0], raw=struct.unpack_from('<I', s, 20)[0])
names = {}
for c in load(ver):
    for mn, pc, mr in c['methods']:
        if mr: names.setdefault(mr, f"{c['ns']}.{c['name']}::{mn}/{pc}")
rvas = sorted(names)
pat = struct.pack('<I', disp); lo, hi = il['raw'], il['raw'] + il['rsz']
cands = set()
i = b.find(pat, lo, hi)
while i != -1:
    rva = il['va'] + (i - il['raw']); k = bisect.bisect_right(rvas, rva) - 1
    if k >= 0: cands.add(k)
    i = b.find(pat, i + 1, hi)
md = Cs(CS_ARCH_X86, CS_MODE_64); md.detail = True
total = 0; nf = 0
for k in sorted(cands):
    f0 = rvas[k]; end = rvas[k + 1] if k + 1 < len(rvas) else f0 + 0x10000
    if end - f0 > 0x40000: end = f0 + 0x40000
    o = il['raw'] + (f0 - il['va']); lines = []
    for ins in md.disasm(b[o:o + (end - f0)], f0):
        mem = [op for op in ins.operands if op.type == X86_OP_MEM and op.mem.disp == disp and op.size >= minsize and op.mem.base not in (0,)]
        if not mem: continue
        store = ins.operands[0].type == X86_OP_MEM and ins.mnemonic not in ('cmp', 'test', 'ucomiss', 'comiss', 'ucomisd')
        kind = 'store' if store else 'load'
        if want and kind != want: continue
        lines.append(f"{ins.address:08x} {kind:5s} {ins.mnemonic} {ins.op_str}")
    if lines:
        nf += 1; total += len(lines); print(f"0x{f0:X} {names[f0]}")
        for l in lines[:8]: print("    " + l)
print(f"# {total} sites in {nf} functions")
