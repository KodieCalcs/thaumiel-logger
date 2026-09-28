"""Relocation-aware re-match of a list of RVAs: old GameAssembly -> new GameAssembly.

  py masked_match.py <old.dll> <new.dll> <rvas.zon> <delta-hex|0> <out.tsv> [section]

Section defaults to .text (the il2cpp runtime); pass il2cpp for generated code. Delta is the
first guess for a block move (0xD7A0 for the API block 3.3.0->3.3.2; 0 to skip).

For each old RVA, disassemble the function (up to N insns or until ret/unconditional jmp),
mask rel32 / RIP-relative displacement bytes, and (1) test the candidate old+delta in the new
binary under the same mask, (2) if that fails, regex-search the masked pattern over new .text.
"""
import re, struct, sys
from capstone import Cs, CS_ARCH_X86, CS_MODE_64
from capstone.x86 import X86_REG_RIP, X86_OP_MEM, X86_OP_IMM
from capstone import CS_GRP_JUMP, CS_GRP_CALL

OLD, NEW, ZON = sys.argv[1], sys.argv[2], sys.argv[3]
DELTA = int(sys.argv[4], 16) if len(sys.argv) > 4 else None
MAXB = 96


def load(p):
    b = open(p, 'rb').read()
    pe = struct.unpack_from('<I', b, 0x3c)[0]
    n = struct.unpack_from('<H', b, pe + 6)[0]
    opt = struct.unpack_from('<H', b, pe + 20)[0]
    off = pe + 24 + opt
    secs = []
    for i in range(n):
        name = b[off + i * 40:off + i * 40 + 8].rstrip(b'\0').decode('latin1')
        vs, va, rs, ro = struct.unpack_from('<IIII', b, off + i * 40 + 8)
        secs.append((name, va, vs, ro, rs))
    return b, secs


def rva2off(secs, rva):
    for name, va, vs, ro, rs in secs:
        if va <= rva < va + max(vs, rs):
            return ro + (rva - va)
    return None


ob, osecs = load(OLD)
nb, nsecs = load(NEW)
otext = [s for s in osecs if s[0] == '.text'][0]
ntext = [s for s in nsecs if s[0] == (sys.argv[6] if len(sys.argv) > 6 else ".text")][0]
ntext_bytes = nb[ntext[3]:ntext[3] + ntext[4]]

md = Cs(CS_ARCH_X86, CS_MODE_64)
md.detail = True


def masked(buf, base):
    """Return (bytes, maskflags, mnemonics) for the function at buf start."""
    out = bytearray(); mask = bytearray(); mn = []
    for insn in md.disasm(bytes(buf), base):
        raw = bytearray(insn.bytes); m = bytearray(len(raw))
        rel = any(g in (CS_GRP_JUMP, CS_GRP_CALL) for g in insn.groups) and any(
            op.type == X86_OP_IMM for op in insn.operands)
        ripmem = any(op.type == X86_OP_MEM and op.mem.base == X86_REG_RIP for op in insn.operands)
        if rel and insn.imm_size:
            for k in range(insn.imm_offset, insn.imm_offset + insn.imm_size):
                m[k] = 1
        if ripmem and insn.disp_size:
            for k in range(insn.disp_offset, insn.disp_offset + insn.disp_size):
                m[k] = 1
        out += raw; mask += m; mn.append(insn.mnemonic)
        if insn.mnemonic in ('ret', 'jmp', 'int3') or len(out) >= MAXB:
            break
    return bytes(out), bytes(mask), mn


def eq_masked(a, b, mask):
    return len(a) == len(b) and all(mask[i] or a[i] == b[i] for i in range(len(a)))


def pattern(sig, mask):
    return b''.join(b'.' if mask[i] else re.escape(sig[i:i + 1]) for i in range(len(sig)))


rvas = [int(x, 16) for x in re.findall(r'0x[0-9a-fA-F]+', open(ZON).read())]
results = []
for idx, rva in enumerate(rvas):
    oo = rva2off(osecs, rva)
    sig, mask, mn = masked(ob[oo:oo + MAXB], rva)
    status = None; new = None
    if DELTA is not None:
        cand = rva + DELTA
        no = rva2off(nsecs, cand)
        if no is not None:
            nsig, nmask, nmn = masked(nb[no:no + MAXB], cand)
            if eq_masked(sig, nsig, mask) and mn == nmn:
                status, new = 'DELTA_OK', cand
    if status is None:
        pat = re.compile(pattern(sig, mask), re.DOTALL)
        hits = [m.start() for m in pat.finditer(ntext_bytes)]
        # require alignment to 16 like the old entries
        hits16 = [h for h in hits if (ntext[1] + h) % 16 == rva % 16]
        if len(hits16) == 1:
            status, new = 'SEARCH_OK', ntext[1] + hits16[0]
        elif len(hits16) > 1:
            status, new = "AMBIGUOUS", hits16[:4]
        else:
            status = 'NOT_FOUND'
    results.append((idx, rva, status, new, len(sig)))
    nv = (f'0x{new:x}' if isinstance(new, int) else new)
    d = (f'+0x{new - rva:x}' if isinstance(new, int) else '')
    print(f'[{idx:3d}] 0x{rva:08x} {status:10s} {nv} {d} siglen={len(sig)} {" ".join(mn[:6])}')

from collections import Counter
print(Counter(r[2] for r in results))
with open(sys.argv[5] if len(sys.argv) > 5 else 'masked-results.tsv', 'w') as f:
    for idx, rva, status, new, n in results:
        f.write(f'{idx}\t0x{rva:x}\t{status}\t{new if isinstance(new,int) else ""}\n')
