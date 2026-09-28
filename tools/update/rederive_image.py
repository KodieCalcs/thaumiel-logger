"""One client build as rederive.py sees it: the v7 dump, GameAssembly's bytes, and a disassembler
bounded by the dump's own method RVAs.

Generalised from sheet-webapp/local-data/client-update-33{3,4}/trace-hooks.py (both hand-edited
one-offs). A function ends at the NEXT method RVA in the dump (capped at 0x20000 bytes), never at
the first `ret`: il2cpp bodies routinely tail-`jmp` into int3 padding, and a first-ret reader walks
into the neighbour and credits it with the neighbour's field references (HANDOFF-3.3.3.md trap 5).
Trailing int3/nop padding is dropped so instruction counts compare across builds.
"""
import bisect
import json
import os
import re
import struct
import sys
from collections import Counter

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from capstone import Cs, CS_ARCH_X86, CS_MODE_64  # noqa: E402
from dumpq import load  # noqa: E402
from paths import dump_dir, game_assembly, version  # noqa: E402

OBF = re.compile(r'^[A-Z]{11}$')
OBF_TOKEN = re.compile(r'(?<![A-Za-z])[A-Z]{11}(?![A-Za-z])')


def is_obfuscated(name):
    return bool(OBF.match(name))


class PE:
    def __init__(self, path):
        self.blob = open(path, 'rb').read()
        pe = struct.unpack_from('<I', self.blob, 0x3c)[0]
        self.timestamp = struct.unpack_from('<I', self.blob, pe + 8)[0]
        n = struct.unpack_from('<H', self.blob, pe + 6)[0]
        opt = struct.unpack_from('<H', self.blob, pe + 20)[0]
        self.size_of_image = struct.unpack_from('<I', self.blob, pe + 24 + 56)[0]
        self.sections = []
        for i in range(n):
            base = pe + 24 + opt + 40 * i
            name = self.blob[base:base + 8].rstrip(b'\0').decode('ascii', 'replace')
            vs, va, rs, ro = struct.unpack_from('<IIII', self.blob, base + 8)
            chars = struct.unpack_from('<I', self.blob, base + 36)[0]
            self.sections.append((name, vs, va, rs, ro, chars))

    def data(self, rva, n):
        for _name, vs, va, rs, ro, _c in self.sections:
            if va <= rva < va + max(vs, rs):
                return self.blob[ro + rva - va:ro + rva - va + n]
        return b''

    def section_of(self, rva):
        for name, vs, va, rs, ro, _c in self.sections:
            if va <= rva < va + max(vs, rs):
                return name
        return None

    def code_sections(self):
        return [s for s in self.sections if s[5] & 0x20000000]  # IMAGE_SCN_MEM_EXECUTE


class Image:
    def __init__(self, ver, cache_dir=None):
        self.version = version(ver)
        self.classes = load(self.version)
        self.by_name = {}
        self.names = {}
        for c in self.classes:
            self.by_name.setdefault(c['name'], []).append(c)
            for n, p, r in c['methods']:
                if r:
                    self.names[r] = (c['name'], n, p)
        self.rvas = sorted(self.names)
        self.pe = PE(game_assembly(self.version))
        self.md = Cs(CS_ARCH_X86, CS_MODE_64)
        self.cache = {}
        self.cache_dir = cache_dir or dump_dir(self.version)
        self._callers = None

    # --- dump -------------------------------------------------------------------------------
    def cls(self, name, ns=None):
        found = [c for c in self.by_name.get(name, []) if ns is None or c['ns'] == ns]
        if len(found) != 1:
            raise KeyError(f'{self.version}: class {name!r} has {len(found)} entries')
        return found[0]

    def method_at(self, rva):
        return self.names.get(rva)

    def containing_method(self, rva):
        i = bisect.bisect_right(self.rvas, rva) - 1
        return self.rvas[i] if i >= 0 else None

    def field_type(self, klass, offset):
        types = klass.get('ftypes', [])
        return [(n, types[i] if i < len(types) else '') for i, (n, o) in enumerate(klass['fields']) if o == offset]

    def instance_fields(self, klass):
        """(name, offset, type) of instance fields. Static fields carry large offsets into the static
        block; the dump does not flag them, so anything past 0x10000 is treated as static."""
        types = klass.get('ftypes', [])
        return [(n, o, types[i] if i < len(types) else '') for i, (n, o) in enumerate(klass['fields']) if o < 0x10000]

    # --- code -------------------------------------------------------------------------------
    def data(self, rva, n):
        return self.pe.data(rva, n)

    def dis(self, rva):
        if rva not in self.cache:
            i = bisect.bisect_right(self.rvas, rva)
            end = min(self.rvas[i] if i < len(self.rvas) else rva + 0x20000, rva + 0x20000)
            ins = list(self.md.disasm(self.data(rva, end - rva), rva))
            while ins and ins[-1].mnemonic in ('int3', 'nop'):
                ins.pop()
            self.cache[rva] = ins
        return self.cache[rva]

    def shape(self, rva):
        return [i.mnemonic for i in self.dis(rva)]

    def listing(self, rva):
        lines = []
        for ins in self.dis(rva):
            note = ''
            if ins.mnemonic in ('call', 'jmp') and ins.op_str.startswith('0x'):
                note = ' ; ' + str(self.names.get(int(ins.op_str, 16), ''))
            lines.append(f'{ins.address:08x} {ins.bytes.hex():24s} {ins.mnemonic} {ins.op_str}{note}')
        return '\n'.join(lines) + '\n'

    # --- direct callers ---------------------------------------------------------------------
    def callers(self, targets):
        """{target: [(call_address, containing_method_rva)]} for real `call rel32` instructions,
        each confirmed by disassembling its containing method (a stray E8 byte is not a call).
        The raw E8 scan over every code section is cached per build (it takes a while)."""
        want = set(targets)
        raw = self._raw_calls(want)
        found = {t: [] for t in want}
        for target, sites in raw.items():
            for addr in sites:
                start = self.containing_method(addr)
                if start is None:
                    continue
                if any(i.address == addr and i.mnemonic == 'call' and i.op_str == hex(target) for i in self.dis(start)):
                    found[target].append((addr, start))
        return found

    def _raw_calls(self, want):
        path = os.path.join(self.cache_dir, 'rederive-calls.json')
        cached = {}
        if os.path.exists(path):
            cached = {int(k, 16): v for k, v in json.load(open(path)).items()}
        missing = want - set(cached)
        if missing:
            for _name, vs, va, rs, ro, _c in self.pe.code_sections():
                section = self.pe.blob[ro:ro + rs]
                pos = section.find(b'\xe8')
                unpack = struct.unpack_from
                while 0 <= pos <= len(section) - 5:
                    target = (va + pos + 5 + unpack('<i', section, pos + 1)[0]) & 0xffffffff
                    if target in missing:
                        cached.setdefault(target, []).append(va + pos)
                    pos = section.find(b'\xe8', pos + 1)
            for t in missing:
                cached.setdefault(t, [])
            try:
                json.dump({hex(k): v for k, v in cached.items()}, open(path, 'w'))
            except OSError:
                pass
        return {t: cached[t] for t in want}


# --- structural class matching (tools/update/classmatch.py's signature) -----------------------
def class_signature(c):
    parent = c['parent']
    if not (parent is None or parent.startswith(('MoleMole', 'System', 'UnityEngine'))):
        parent = 'obf'
    return (c['ns'], len(c['fields']), tuple(sorted(pc for _, pc, _ in c['methods'])), parent,
            tuple(sorted(n for n, _, _ in c['methods'] if not is_obfuscated(n))))


class ClassMatcher:
    def __init__(self, old, new):
        self.old, self.new = old, new
        self.index = {}
        for c in new.classes:
            self.index.setdefault(class_signature(c), []).append(c)
        self.memo = {}

    def match(self, name):
        """-> (new_class or None, candidates, note). Named classes match by name; obfuscated ones
        by signature, accepted only with exactly one candidate."""
        if name in self.memo:
            return self.memo[name]
        olds = self.old.by_name.get(name, [])
        if len(olds) != 1:
            result = (None, [], f'{len(olds)} classes named {name} in {self.old.version}')
        elif not is_obfuscated(name):
            news = [c for c in self.new.by_name.get(name, []) if c['ns'] == olds[0]['ns']]
            result = (news[0], news, 'named') if len(news) == 1 else (None, news, f'{len(news)} named candidates')
        else:
            cands = self.index.get(class_signature(olds[0]), [])
            if len(cands) == 1:
                result = (cands[0], cands, 'structural, one candidate')
            else:
                result = (None, cands, f'structural signature has {len(cands)} candidates')
        self.memo[name] = result
        return result

    def map_type(self, type_name):
        """Rewrite every obfuscated class token in a field type through match(); None if any token
        does not match uniquely."""
        out = type_name
        for tok in set(OBF_TOKEN.findall(type_name)):
            new, _c, _n = self.match(tok)
            if new is None:
                return None
            out = re.sub(r'(?<![A-Za-z])' + tok + r'(?![A-Za-z])', new['name'], out)
        return out


def counter_top(values):
    return Counter(values).most_common()
