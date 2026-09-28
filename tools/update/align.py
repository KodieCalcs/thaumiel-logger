"""Align an old and a new function body and map memory displacements.

  py align.py <oldRVA> <newRVA> [maxbytes]      (THAUMIEL_OLD / THAUMIEL_NEW select the builds, default 3.3.0 / 3.3.2)

Disassembles both (bounded by the next method RVA in the respective dump), tokenises each
instruction as mnemonic + operand shapes (registers kept, displacements/immediates abstracted),
aligns with difflib, and prints (base, old_disp) -> new_disp for every aligned memory operand,
with counts and conflicts.
"""
import os, sys, struct, difflib, bisect
from collections import defaultdict, Counter
from capstone import Cs, CS_ARCH_X86, CS_MODE_64
from capstone.x86 import X86_OP_MEM, X86_OP_IMM, X86_OP_REG, X86_REG_RIP, X86_REG_RSP, X86_REG_RBP
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from dumpq import load
from paths import game_assembly

OLD = os.environ.get('THAUMIEL_OLD', '3.3.0')
NEW = os.environ.get('THAUMIEL_NEW', '3.3.2')


_pe = {}


def loadpe(p):
    if p in _pe: return _pe[p]
    b = open(p, 'rb').read(); pe = struct.unpack_from('<I', b, 0x3c)[0]; n = struct.unpack_from('<H', b, pe + 6)[0]
    opt = struct.unpack_from('<H', b, pe + 20)[0]; off = pe + 24 + opt; secs = []
    for i in range(n):
        vs, va, rs, ro = struct.unpack_from('<IIII', b, off + i * 40 + 8); secs.append((va, vs, ro, rs))
    _pe[p] = (b, secs)
    return b, secs


def r2o(secs, rva):
    for va, vs, ro, rs in secs:
        if va <= rva < va + max(vs, rs): return ro + (rva - va)


md = Cs(CS_ARCH_X86, CS_MODE_64); md.detail = True
_rvas = {}


def all_rvas(ver):
    if ver not in _rvas:
        s = sorted({rva for c in load(ver) for _, _, rva in c['methods'] if rva})
        _rvas[ver] = s
    return _rvas[ver]


def body(ver, rva, maxbytes=0x4000):
    b, secs = loadpe(game_assembly(ver))
    nxt = all_rvas(ver)[bisect.bisect_right(all_rvas(ver), rva)]
    end = min(nxt, rva + maxbytes)
    o = r2o(secs, rva)
    insns = list(md.disasm(b[o:o + (end - rva)], rva))
    # trim trailing int3 padding
    while insns and insns[-1].mnemonic == 'int3': insns.pop()
    return insns


def shape(i):
    ops = []
    for op in i.operands:
        if op.type == X86_OP_REG: ops.append(i.reg_name(op.reg))
        elif op.type == X86_OP_IMM: ops.append('imm')
        else:
            base = i.reg_name(op.mem.base) if op.mem.base else ''
            idx = i.reg_name(op.mem.index) if op.mem.index else ''
            ops.append(f'[{base}+{idx}*{op.mem.scale}+d{op.size}]' if op.mem.base != X86_REG_RIP else '[rip+d]')
    return i.mnemonic + ' ' + ','.join(ops)


def memops(i):
    out = []
    for op in i.operands:
        if op.type == X86_OP_MEM and op.mem.base not in (X86_REG_RIP, X86_REG_RSP, 0):
            out.append((i.reg_name(op.mem.base), op.mem.disp, op.size))
    return out


def align(old_rva, new_rva, maxbytes=0x4000, verbose=False):
    A = body(OLD, old_rva, maxbytes); B = body(NEW, new_rva, maxbytes)
    ta = [shape(i) for i in A]; tb = [shape(i) for i in B]
    sm = difflib.SequenceMatcher(None, ta, tb, autojunk=False)
    pairs = []
    for tag, i1, i2, j1, j2 in sm.get_opcodes():
        if tag == 'equal':
            for k in range(i2 - i1): pairs.append((A[i1 + k], B[j1 + k]))
    ratio = sm.ratio()
    print(f"old 0x{old_rva:X}: {len(A)} insns; new 0x{new_rva:X}: {len(B)} insns; aligned {len(pairs)}; similarity {ratio:.3f}")
    mapping = defaultdict(Counter)
    for a, b in pairs:
        ma, mb = memops(a), memops(b)
        if len(ma) == len(mb):
            for (ra, da, sa), (rb, db, sb) in zip(ma, mb):
                if ra == rb and sa == sb: mapping[(ra, da)][db] += 1
    return mapping, pairs, ratio


if __name__ == '__main__':
    o, n = int(sys.argv[1], 16), int(sys.argv[2], 16)
    mx = int(sys.argv[3], 16) if len(sys.argv) > 3 else 0x4000
    mapping, pairs, ratio = align(o, n, mx)
    for (reg, d), c in sorted(mapping.items(), key=lambda x: (x[0][0], x[0][1])):
        conf = '' if len(c) == 1 else '  CONFLICT ' + str(dict(c))
        best, cnt = c.most_common(1)[0]
        print(f"  {reg:4s} +0x{d:<4X} -> +0x{best:<4X} (x{cnt}){conf}")
