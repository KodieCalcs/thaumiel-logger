"""The il2cpp API table stage of rederive.py: what dumper.zig pins about the runtime itself.

Unity keeps a 194-entry table of il2cpp API pointers; dumper.zig reads it instead of calling
get_api_table, and fails closed unless every pinned slot holds its pinned RVA and seven slots
start with known code bytes. Per client update:

  bootstrap  before launch 1: carry each old slot's function to the new binary by its masked
             bytes (rel32 / RIP-relative displacements masked), and pin it only when that masked
             signature occurs ONCE in the new code. The committed bootstraps pinned by block delta
             first, which put short look-alike stubs one slot off (20 wrong pins on 3.3.4, 10 on
             3.3.3; finding 3). A slot left 0 is reported by launch 1 like a wrong one, so being
             unsure costs nothing.
  table      after launch 1: apply the report (`API[n] unpinned; actual RVA X`, `API[n] expected
             RVA X, actual Y`) to the bootstrap. A slot neither reported nor pinned is an error.
  checks     re-read each code check at its slot's new RVA, same byte length, and classify every
             instruction the check covers against the old build (finding 4).
"""
import re
import struct

from capstone import Cs, CS_ARCH_X86, CS_MODE_64, CS_GRP_CALL, CS_GRP_JUMP
from capstone.x86 import X86_OP_IMM, X86_OP_MEM, X86_REG_RIP

REPORT_UNPINNED = re.compile(r'API\[(\d+)\] unpinned; actual RVA (0x[0-9A-Fa-f]+)')
REPORT_WRONG = re.compile(r'API\[(\d+)\] expected RVA (0x[0-9A-Fa-f]+), actual (0x[0-9A-Fa-f]+)')
REPORT_OUTSIDE = re.compile(r'API\[(\d+)\] unpinned entry outside GameAssembly')
MAXB = 96
MIN_DELTA_SUPPORT = 3

_md = Cs(CS_ARCH_X86, CS_MODE_64)
_md.detail = True


def parse_zon(text):
    """The `.{ ... }` list, one entry per comma; `//` comments (the bootstraps note old RVAs in
    them) are dropped and a bare `0` is an unpinned slot."""
    body = re.sub(r'//[^\n]*', '', text)
    body = body[body.index('{') + 1:body.rindex('}')]
    return [int(tok, 0) for tok in (t.strip() for t in body.split(',')) if tok]


def write_zon(table):
    return '.{\n' + ''.join(f'    0x{x:x},\n' for x in table) + '}\n'


# --- table ---------------------------------------------------------------------------------------
def apply_report(bootstrap, report_text):
    """-> (table, notes, errors). Final table = bootstrap with every report line applied."""
    table = list(bootstrap)
    reported, errors = {}, []
    for m in REPORT_UNPINNED.finditer(report_text):
        slot, rva = int(m.group(1)), int(m.group(2), 16)
        if table[slot] != 0:
            errors.append(f'API[{slot}] reported unpinned but the bootstrap pins {table[slot]:#x}')
        reported[slot] = rva
    wrong = 0
    for m in REPORT_WRONG.finditer(report_text):
        slot, exp, act = int(m.group(1)), int(m.group(2), 16), int(m.group(3), 16)
        if table[slot] != exp:
            errors.append(f'API[{slot}] report expected {exp:#x}, bootstrap pins {table[slot]:#x}')
        reported[slot] = act
        wrong += 1
    for m in REPORT_OUTSIDE.finditer(report_text):
        errors.append(f'API[{m.group(1)}] points outside GameAssembly: the table offset is wrong or moved')
    for slot, rva in reported.items():
        table[slot] = rva
    missing = [i for i, x in enumerate(table) if x == 0]
    if missing:
        errors.append(f'{len(missing)} slots neither pinned nor reported: {missing[:12]} (the report is incomplete)')
    notes = {'reported_unpinned': len(reported) - wrong, 'corrected': wrong,
             'validated_as_pinned': len(table) - len(reported)}
    return table, notes, errors


# --- code checks --------------------------------------------------------------------------------
def _instructions(img, rva, n):
    return list(_md.disasm(img.data(rva, n + 16), rva))


def classify_checks(old_img, new_img, old_table, new_table, old_checks):
    """-> {slot: {'bytes': new hex, 'changes': [...], 'kind': summary}}. The check keeps its byte
    length (it may end mid-instruction); every instruction it overlaps is compared."""
    out = {}
    for slot, old_hex in old_checks.items():
        slot = int(slot)
        n = len(old_hex) // 2
        new_bytes = new_img.data(new_table[slot], n)
        a = [i for i in _instructions(old_img, old_table[slot], n) if i.address - old_table[slot] < n]
        b = [i for i in _instructions(new_img, new_table[slot], n) if i.address - new_table[slot] < n]
        changes = []
        if [i.mnemonic for i in a] != [i.mnemonic for i in b] or [i.size for i in a] != [i.size for i in b]:
            changes.append('SHAPE: ' + ' | '.join(f'{i.mnemonic} {i.op_str}' for i in a) + '  ->  '
                           + ' | '.join(f'{i.mnemonic} {i.op_str}' for i in b))
        else:
            for x, y in zip(a, b):
                # only the bytes the check covers matter (63's check stops before its disp32)
                k = min(x.size, n - (x.address - old_table[slot]))
                if bytes(x.bytes[:k]) == bytes(y.bytes[:k]):
                    continue
                changes.append(_kind(x, y))
        kinds = sorted({c.split(':')[0] for c in changes}) or ['unchanged']
        out[str(slot)] = {'bytes': new_bytes.hex(), 'kind': '+'.join(kinds), 'changes': changes}
    return out


def _kind(x, y):
    text = f'{x.mnemonic} {x.op_str} -> {y.op_str}'
    if any(op.type == X86_OP_MEM and op.mem.base == X86_REG_RIP for op in x.operands):
        return 'rip-relative: ' + text
    if any(g in (CS_GRP_JUMP, CS_GRP_CALL) for g in x.groups):
        return 'rel32: ' + text
    if any(op.type == X86_OP_IMM for op in x.operands) and x.op_str.split(', ')[0] == y.op_str.split(', ')[0]:
        return 'immediate: ' + text
    if any(op.type == X86_OP_MEM for op in x.operands):
        return 'displacement: ' + text
    return 'OTHER: ' + text


# --- bootstrap ----------------------------------------------------------------------------------
def _masked(img, rva):
    sig, mask, mn = bytearray(), bytearray(), []
    for ins in _md.disasm(img.data(rva, MAXB), rva):
        raw = bytearray(ins.bytes)
        m = bytearray(len(raw))
        rel = any(g in (CS_GRP_JUMP, CS_GRP_CALL) for g in ins.groups) and any(op.type == X86_OP_IMM for op in ins.operands)
        rip = any(op.type == X86_OP_MEM and op.mem.base == X86_REG_RIP for op in ins.operands)
        if rel and ins.imm_size:
            m[ins.imm_offset:ins.imm_offset + ins.imm_size] = b'\1' * ins.imm_size
        if rip and ins.disp_size:
            m[ins.disp_offset:ins.disp_offset + ins.disp_size] = b'\1' * ins.disp_size
        sig += raw
        mask += m
        mn.append(ins.mnemonic)
        if ins.mnemonic in ('ret', 'jmp', 'int3') or len(sig) >= MAXB:
            break
    return bytes(sig), bytes(mask), mn


def bootstrap(old_img, new_img, old_table):
    """-> (table with 0 for every slot not pinned uniquely, per-slot notes). Each slot is searched
    in the new section named like the one its old RVA lived in (.text for the il2cpp API block)."""
    code_of = {}
    for name, vs, va, rs, ro, _c in new_img.pe.sections:
        code_of[name] = (va, new_img.pe.blob[ro:ro + rs])
    table, notes = [], []
    for slot, rva in enumerate(old_table):
        va, code = code_of[old_img.pe.section_of(rva)]
        sig, mask, _mn = _masked(old_img, rva)
        pat = re.compile(b''.join(b'.' if mask[i] else re.escape(sig[i:i + 1]) for i in range(len(sig))), re.DOTALL)
        hits = [va + h.start() for h in pat.finditer(code) if (va + h.start()) % 16 == rva % 16]
        if len(hits) == 1:
            table.append(hits[0])
            notes.append((slot, 'unique', len(sig)))
        else:
            table.append(0)
            notes.append((slot, f'{len(hits)} matches', len(sig)))
    # A unique hit is kept only when its move (new - old) is a block move shared by at least
    # MIN_DELTA_SUPPORT other unique hits. Every wrong unique pin on 3.3.3 and 3.3.4 was a short
    # stub whose delta at most one other slot shared. Ambiguous slots never borrow a block delta:
    # the API block's deltas sit 0x10 apart, which is how the committed bootstraps put stubs one
    # slot off.
    support = {}
    for rva, new in zip(old_table, table):
        if new:
            support[new - rva] = support.get(new - rva, 0) + 1
    for slot, (rva, new) in enumerate(zip(old_table, table)):
        if new and support[new - rva] - 1 < MIN_DELTA_SUPPORT:
            table[slot] = 0
            notes[slot] = (slot, f'unique, but its move {new - rva:+#x} is shared by only '
                                 f'{support[new - rva] - 1} other slot(s)', notes[slot][2])
    return table, notes


def called_slots(src_dir):
    """API slots the DLL calls (`api(F.., n)` in src/*.zig)."""
    import glob
    out = set()
    for path in glob.glob(src_dir + '/*.zig'):
        out |= {int(n) for n in re.findall(r'api\(F\w*, *(\d+)\)', open(path, encoding='utf-8').read())}
    return sorted(out)


def guess_called(old_img, new_img, old_table, table, notes, called):
    """Pin every called slot the certain pass left open with a best guess: the masked hit whose move
    is the best-supported block move, else old + that move. Safe either way -- a right guess is
    verified by launch 1, a wrong one makes launch 1 fail closed and report the real RVA -- whereas
    an unpinned called slot would only be checked to point into GameAssembly."""
    support = {}
    for rva, new in zip(old_table, table):
        if new:
            support[new - rva] = support.get(new - rva, 0) + 1
    ranked = sorted(support, key=support.get, reverse=True)
    code_of = {name: (va, new_img.pe.blob[ro:ro + rs]) for name, vs, va, rs, ro, _c in new_img.pe.sections}
    for slot in called:
        if table[slot]:
            continue
        rva = old_table[slot]
        va, code = code_of[old_img.pe.section_of(rva)]
        sig, mask, _mn = _masked(old_img, rva)
        pat = re.compile(b''.join(b'.' if mask[i] else re.escape(sig[i:i + 1]) for i in range(len(sig))), re.DOTALL)
        hits = {va + h.start() for h in pat.finditer(code)}
        pick = next((rva + d for d in ranked if rva + d in hits), None)
        table[slot] = pick if pick is not None else rva + ranked[0]
        notes[slot] = (slot, 'GUESS (called slot; launch 1 verifies or reports it): '
                       + ('masked hit at a block move' if pick is not None else 'old + the main block move'), len(sig))
    return table, notes


# --- Unity's table offset -------------------------------------------------------------------------
def _rip_calls(pe):
    """{target RVA: count} of every `call qword ptr [rip+d]` (ff 15) in UnityPlayer's .text."""
    _name, vs, va, rs, ro, _c = next(s for s in pe.sections if s[0] == '.text')
    blob, out = pe.blob, {}
    pos = blob.find(b'\xff\x15', ro, ro + rs)
    while 0 <= pos < ro + rs - 6:
        t = va + (pos - ro) + 6 + struct.unpack_from('<i', blob, pos + 2)[0]
        out[t] = out.get(t, 0) + 1
        pos = blob.find(b'\xff\x15', pos + 1, ro + rs)
    return out


def unity_table(old_pe, new_pe, old_offset, slots=194):
    """Re-find the table in a new UnityPlayer.dll with no anchors: the old build calls into a set
    of slots through `call [rip+..]`; the new table is the one base at which every one of those
    slots is called again. -> (offset or None, detail)."""
    old = _rip_calls(old_pe)
    used = {(t - old_offset) // 8: c for t, c in old.items()
            if old_offset <= t < old_offset + slots * 8 and (t - old_offset) % 8 == 0}
    new = _rip_calls(new_pe)
    top = max(used, key=used.get)
    bases = {t - top * 8 for t in new}
    # the called slots must be exactly the old set (an import table has every slot called), and
    # the per-slot call counts close to the old ones
    def called(b):
        return {s for s in range(slots) if b + s * 8 in new}
    full = [b for b in bases if called(b) == set(used)
            and sum(abs(new[b + s * 8] - c) for s, c in used.items()) <= 0.05 * sum(used.values())]
    detail = {'old_sites': sum(used.values()), 'old_slots': len(used), 'candidates': [hex(b) for b in full]}
    if len(full) != 1:
        return None, detail
    b = full[0]
    detail['new_sites'] = sum(new.get(b + s * 8, 0) for s in range(slots))
    detail['new_slots'] = sum(1 for s in range(slots) if b + s * 8 in new)
    return b, detail


# --- runtime_readiness.zig -----------------------------------------------------------------------
def _rel_target(ins):
    return int(ins.op_str, 16) if ins.op_str.startswith('0x') else None


def readiness(old_img, new_img, old_ready, new_table):
    """Re-trace runtime_readiness.zig's main-thread slot and anchors by its own method (module
    header, finding 5). -> (section, problems)."""
    problems = []
    first = list(_md.disasm(new_img.data(new_table[152], 16), new_table[152]))[0]
    attach = _rel_target(first) if first.mnemonic == 'jmp' else None
    if attach is None:
        return None, [f'slot 152 does not start with jmp rel32 ({first.mnemonic} {first.op_str})']
    sites = []
    # native runtime callers: no il2cpp method contains them, so the raw E8 scan plus the
    # call-then-store pattern is the confirmation (Image.callers() needs a containing method)
    for call in sorted(new_img._raw_calls({attach})[attach]):
        nxt = list(_md.disasm(new_img.data(call + 5, 7), call + 5))
        if nxt and nxt[0].mnemonic == 'mov' and nxt[0].op_str.startswith('qword ptr [rip +') and nxt[0].op_str.endswith(', rax'):
            sites.append((call, nxt[0]))
    if len(sites) != 2:
        return None, [f'{len(sites)} `call Thread::Attach; mov [rip+d],rax` sites (expected exactly two)']
    call, mov = sites[1]
    main_thread = mov.address + mov.size + struct.unpack_from('<i', mov.bytes, mov.size - 4)[0]
    anchors = [(call, new_img.data(call, 12))]
    # anchor 2: old bytes with every stack displacement wildcarded, unique in the new build
    a2_rva, a2_hex = ix(old_ready['anchors'][1][0]), old_ready['anchors'][1][1]
    a2 = bytes.fromhex(a2_hex)
    mask = bytearray(len(a2))
    for ins in _md.disasm(a2, a2_rva):
        if any(op.type == X86_OP_MEM and op.mem.base in (_reg('rbp'), _reg('rsp')) for op in ins.operands) and ins.disp_size:
            off = ins.address - a2_rva + ins.disp_offset
            mask[off:off + ins.disp_size] = b'\1' * ins.disp_size
    pat = re.compile(b''.join(b'.' if mask[i] else re.escape(a2[i:i + 1]) for i in range(len(a2))), re.DOTALL)
    _n, vs, va, rs, ro, _c = next(s for s in new_img.pe.sections if s[0] == new_img.pe.section_of(a2_rva) or s[0] == old_img.pe.section_of(a2_rva))
    hits = [va + m.start() for m in pat.finditer(new_img.pe.blob[ro:ro + rs])]
    if len(hits) != 1:
        return None, [f'anchor 2 (stack displacement wildcarded) found {len(hits)} times']
    base = hits[0]
    notes = []
    for rva, want in old_ready['anchors'][1:]:
        at = base + ix(rva) - a2_rva
        got = new_img.data(at, len(want) // 2)
        anchors.append((at, got))
        if got.hex() == want:
            continue
        if at == base and all(mask[i] or got[i] == a2[i] for i in range(len(a2))):
            notes.append(f'anchor 2: only its stack displacement changed ({want} -> {got.hex()})')
        else:
            problems.append(f'anchor at +{ix(rva) - a2_rva:#x} from anchor 2 changed: {want} -> {got.hex()}')
    return {'notes': notes, 'main_thread_rva': hex(main_thread), 'thread_attach': hex(attach),
            'anchors': [[hex(a), b.hex()] for a, b in anchors]}, problems


def ix(v):
    return int(v, 16) if isinstance(v, str) else v


def _reg(name):
    from capstone import x86_const
    return getattr(x86_const, 'X86_REG_' + name.upper())


def parse_readiness(text):
    main = re.search(r'main_thread_rva: usize = (0x[0-9a-fA-F]+)', text).group(1)
    anchors = [[a, bytes(int(b, 16) for b in re.findall(r'\\x([0-9a-fA-F]{2})', t)).hex()]
               for a, t in re.findall(r'\.\{ (0x[0-9a-fA-F]+), "((?:\\x[0-9a-fA-F]{2})+)" \}', text)]
    return {'main_thread_rva': main.lower(), 'anchors': anchors}
