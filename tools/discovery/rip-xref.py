"""Every RIP-relative memory operand in the il2cpp section that resolves to <abs_rva> (a class
slot, a static-field base, a type-init flag, ...), grouped by enclosing dumped method. This is
how to find every user of an obfuscated class whose objects are pooled / whose methods are only
reached through delegates: take the slot its .cctor loads (`mov rcx, [rip - X]` -> rva) and ask
who else loads it.
    py tools/discovery/rip-xref.py <version> <abs_rva> [<abs_rva>...]     e.g. 3.3.2 0x4F1B300
Scan: for each candidate byte position of a ModRM RIP-relative form (opcode-agnostic: we test
every 4-byte window as a disp32 and check rip == abs), the enclosing method is disassembled once
and the instruction whose operand actually resolves to abs is printed.
"""
import os, sys, struct, bisect, mmap
from capstone import Cs, CS_ARCH_X86, CS_MODE_64
from capstone.x86 import X86_OP_MEM, X86_REG_RIP
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'update'))
from dumpq import load
from paths import game_assembly
ver = sys.argv[1]; targets = [int(a, 16) for a in sys.argv[2:]]
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
lo, hi = il['raw'], il['raw'] + il['rsz']
# candidate positions: a disp32 at file offset i means rip-relative target = rva(i+4+trailing) + disp;
# the instruction may carry 0..4 trailing immediate bytes, so accept any of those.
cands = set()
data = bytes(b[lo:hi])
# disp32 at data[i:i+4] is a hit when disp == t - (il.va + i + 4 + tr), tr = trailing immediate
# bytes (0/1/2/4). disp decreases by one per byte of i, so within a 64 KB block its high 16 bits
# take at most two values: find those 2-byte patterns with bytes.find (C speed) and verify.
BLK = 1 << 16
for t in targets:
    for tr in (0, 1, 2, 4):
        C = t - il['va'] - 4 - tr  # disp(i) = C - i
        for s0 in range(0, len(data), BLK):
            s1 = min(len(data), s0 + BLK)
            highs = {((C - s0) >> 16) & 0xffff, ((C - (s1 - 1)) >> 16) & 0xffff}
            for h in highs:
                pat = struct.pack('<H', h)
                p = data.find(pat, s0 + 2, s1 + 2)
                while p != -1:
                    i = p - 2
                    if i >= 0 and i + 4 <= len(data):
                        disp = struct.unpack_from('<i', data, i)[0]
                        if disp == C - i:
                            rva = il['va'] + i; k = bisect.bisect_right(rvas, rva) - 1
                            if k >= 0: cands.add(k)
                    p = data.find(pat, p + 1, s1 + 2)
md = Cs(CS_ARCH_X86, CS_MODE_64); md.detail = True
tset = set(targets)
for k in sorted(cands):
    f0 = rvas[k]; end = rvas[k + 1] if k + 1 < len(rvas) else f0 + 0x10000
    if end - f0 > 0x40000: end = f0 + 0x40000
    o = il['raw'] + (f0 - il['va']); lines = []
    for ins in md.disasm(b[o:o + (end - f0)], f0):
        for op in ins.operands:
            if op.type == X86_OP_MEM and op.mem.base == X86_REG_RIP:
                a = ins.address + ins.size + op.mem.disp
                if a in tset: lines.append(f"    {ins.address:08x} -> {a:#x}  {ins.mnemonic} {ins.op_str}")
    if lines: print(f"{f0:#X} {names[f0]}"); print("\n".join(lines))
