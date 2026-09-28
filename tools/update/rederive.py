"""Re-derive the logger's pins for a new client build, keyed by stable names.

    py tools/update/rederive.py check <version>
        Every entry of pins/<version>.json resolves in that build's dump and binary (class names,
        method name/arity at the RVA, prologue/fingerprint bytes, field names at the offsets).
    py tools/update/rederive.py match <old> <new> [--out <file>]
        Classes -> methods -> return sites -> fields, from pins/<old>.json against the new build.
        Writes the new manifest (the rename map: stable name -> this build's obfuscated name +
        RVA/offset) and prints the review list. Default output:
        $THAUMIEL_LOCAL_DATA/rederive/<old>-to-<new>.json -- never pins/, so a replay cannot
        overwrite a committed manifest.
    py tools/update/rederive.py compare <derived.json> <expected.json>
        Replay check: every difference, and whether the derived side flagged it for review.
    py tools/update/rederive.py prepare <old> <new> [--no-build]
        THE STEP BEFORE LAUNCH 1. bootstrap, the code checks at the pinned check slots, readiness
        re-traced from the bootstrap table, then a launch-1 manifest (the old pins, the new client
        identity for the dumper only -- hooks keep the OLD identity so they refuse
        deterministically) emitted into src/ and built. Launch 1 writes the dump and the table report.
    py tools/update/rederive.py finish <old> <new> --report <launch-1 log> [--bootstrap <zon | git:REF>]
                                       [--pins-out <file>] [--no-build]
        THE STEP AFTER LAUNCH 1. table + match, the new manifest written to pins/<new>.json (never
        over an existing one; --pins-out elsewhere), emitted into src/, built, and the offline
        gates run. Prints the review list and what stays manual.
    py tools/update/rederive.py measure <version> <battle folder> [--apply]
        After launch 2: daze_requested, the effect fields and the name-object roles read off the
        capture (rederive_measure.py); --apply writes them into the manifest, the build's generated
        LAYOUTS entry and tools/attribution.mjs EFFECT_OFFSETS.
    py tools/update/rederive.py emit <manifest.json>
        Generate src/pins.zig, src/pins.h and src/dumper-rvas.zon from a manifest (emit_pins.py).
    py tools/update/rederive.py bootstrap <old> <new> [--zon <file>]
        Before launch 1: Unity's table offset (anchor-free), the client identity, and a bootstrap
        API table -- certain pins only, plus a guess for every slot the DLL calls, so launch 1
        either verifies each called slot or fails closed and reports it (rederive_runtime.py).
    py tools/update/rederive.py table <old> <new> --report <launch-1 log> --bootstrap <zon | git:REF>
        After launch 1: the report applied to the bootstrap it ran against (every slot must end up
        pinned), and the seven code checks re-read and classified. Merged into the derived manifest.

How to run a whole update: docs/client-update-playbook.md, "Updating with rederive.py". Acceptance gates, from the 3.3.3
and 3.3.4 updates: a class matches only with ONE structural candidate; a method only with shape
score >= MIN_SCORE and a runner-up at least MIN_GAP behind; a field only from same-width rows on
the object's register (register carried old -> new through the function's dominant pairing) or
from a type-unique class match, and only when every witness agrees. Anything else stops and is
reported; nothing is picked.
"""
import argparse
import bisect
import difflib
import json
import math
import os
import re
import sys
from collections import Counter, defaultdict

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from paths import LOCAL_DATA, version  # noqa: E402
from rederive_image import Image, ClassMatcher, class_signature, is_obfuscated, PE  # noqa: E402
import rederive_runtime as rt  # noqa: E402
from paths import unity_player  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
PINS = os.path.join(HERE, 'pins')
MIN_SCORE = 0.985
MIN_GAP = 0.10
TIE = 0.002

MEM = re.compile(r'(?:(byte|word|dword|qword|xmmword|ymmword|tbyte) ptr )?\[([a-z0-9]+)'
                 r'(?: \+ ((?:r|e)[a-z0-9]+)(?:\*\d)?)?(?: ([+-]) (0x[0-9a-f]+|\d+))?\]')
REG = re.compile(r'\b(r(?:[abcd]x|[sd]i|[sb]p|8|9|1[0-5])|e(?:[abcd]x|[sd]i|[sb]p)|r(?:8|9|1[0-5])d)\b')
# `pop` only appears in epilogues in these il2cpp bodies; an early return's `pop r14` is followed
# by another path on which r14 still holds what it held (the 3.3.3 converter), so it changes nothing.
WRITES_NOT = {'cmp', 'test', 'push', 'pop', 'bt', 'ucomiss', 'comiss', 'ucomisd', 'comisd'}
VOLATILE = {'rax', 'rcx', 'rdx', 'r8', 'r9', 'r10', 'r11'}
BRACKETS = re.compile(r'\[[^\]]*\]')
OPERAND_KIND = [(re.compile(r'^(?:(\w+) ptr )?\[.*rip.*\]$'), lambda m: (m.group(1) or '') + 'mrip'),
                (re.compile(r'^(?:(\w+) ptr )?\[.*\]$'), lambda m: (m.group(1) or '') + 'm'),
                (re.compile(r'^[xy]mm\d+$'), lambda m: 'x'),
                (re.compile(r'^r(?:[abcd]x|[sd]i|[sb]p|8|9|1[0-5])$'), lambda m: 'r64'),
                (re.compile(r'^(?:e(?:[abcd]x|[sd]i|[sb]p)|r(?:8|9|1[0-5])d)$'), lambda m: 'r32'),
                (re.compile(r'^(?:[abcd][lhx]|[sd]il?|[sb]pl?|r(?:8|9|1[0-5])[bw])$'), lambda m: 'r8/16'),
                (re.compile(r'^-?(?:0x[0-9a-f]+|\d+)$'), lambda m: 'i')]


def hx(v):
    return None if v is None else hex(v)


def ix(v):
    return None if v is None else int(v, 16)


def load_manifest(ver):
    with open(os.path.join(PINS, version(ver) + '.json')) as f:
        return json.load(f)


def mem_operands(op_str):
    """[(width, base, index, disp)] for each memory operand."""
    out = []
    for width, base, index, sign, disp in MEM.findall(op_str):
        d = int(disp, 0) if disp else 0
        out.append((width or None, base, index or None, -d if sign == '-' else d))
    return out


def reg64(r):
    """rax for eax, r8 for r8d."""
    if r.endswith('d') and r.startswith('r'):
        return r[:-1]
    if r.startswith('e'):
        return 'r' + r[1:]
    return r


def same_width(template, r64):
    """r64 written in template's width (eax + rsi -> esi, r8d + r10 -> r10d)."""
    if template == reg64(template):
        return r64
    return r64 + 'd' if r64[1:].isdigit() else 'e' + r64[1:]


def kind_token(ins):
    """Mnemonic plus operand kinds (qword memory, 64-bit register, immediate, ...), without
    register names or displacements. Aligns store blocks whose rows moved by one (3.3.4's
    initializer) without depending on register allocation."""
    kinds = []
    for op in ins.op_str.split(', ') if ins.op_str else []:
        for rx, f in OPERAND_KIND:
            m = rx.match(op)
            if m:
                kinds.append(f(m))
                break
        else:
            kinds.append('?')
    return ins.mnemonic + ' ' + ','.join(kinds)


def store_run(ins, i, base, window=4, needed=3):
    """True when ins[i] stores to [base+..] and at least `needed` other stores to the same base sit
    within `window` rows: an initializer or reset block. The compiler re-orders those freely
    between builds, and two constant stores can line up by accident (3.3.2 <-> 3.3.3 stun reset
    block: `[rsi+0xc0], 0` against `[rsi+0xd8], 0`), so such a row is weak evidence."""
    def stores(k):
        ops = ins[k].op_str.split(', ')
        mem = mem_operands(ops[0]) if ops and '[' in ops[0] else []
        return bool(mem) and mem[0][1] == base and ins[k].mnemonic not in ('cmp', 'test')
    if not stores(i):
        return False
    lo, hi = max(0, i - window), min(len(ins), i + window + 1)
    return sum(1 for k in range(lo, hi) if k != i and stores(k)) >= needed


def chain(img, c):
    out, seen = [], set()
    while c is not None and c['name'] not in seen:
        out.append(c)
        seen.add(c['name'])
        found = img.by_name.get((c['parent'] or '').split('.')[-1], [])
        c = found[0] if len(found) == 1 else None
    return out


def chain_fields(img, c):
    return [(n, o, t) for k in chain(img, c) for (n, o, t) in img.instance_fields(k)]


class Report:
    def __init__(self):
        self.items = []

    def add(self, kind, stable, text):
        # kind: STOP (not derived), REVIEW (derived, a person confirms), INFO
        self.items.append({'kind': kind, 'item': stable, 'text': text})

    def flagged(self, stable):
        return [i for i in self.items if i['item'] == stable and i['kind'] in ('STOP', 'REVIEW')]


# --- alignment -----------------------------------------------------------------------------------
class Pair:
    """One old/new method pair: mnemonic alignment, aligned instruction pairs, register pairing."""

    def __init__(self, old, new, orva, nrva):
        self.a, self.b = old.dis(orva), new.dis(nrva)
        sm = difflib.SequenceMatcher(None, [kind_token(i) for i in self.a], [kind_token(i) for i in self.b], autojunk=False)
        self.kind_score = sm.ratio()
        self.pairs = []
        for tag, i, j, k, _l in sm.get_opcodes():
            if tag == 'equal':
                self.pairs.extend(zip(range(i, j), range(k, k + (j - i))))
        self.pair_set = set(self.pairs)
        votes = defaultdict(Counter)
        for i, j in self.pairs:
            ra, rb = REG.findall(self.a[i].op_str), REG.findall(self.b[j].op_str)
            if len(ra) == len(rb):
                for x, y in zip(ra, rb):
                    votes[reg64(x)][reg64(y)] += 1
        self.regmap = {r: c.most_common(1)[0][0] for r, c in votes.items()}

    def consistent(self, x, y):
        """Every register of x maps to y's through the pairing, immediates are equal, and only
        memory displacements may differ. A row whose OTHER operands disagree (3.3.4's initializer:
        `[rdi+0x1d0], rsi` aligned against `[rdi+0x1f0], r14`) is a misalignment, not a move."""
        def skel(ins, mapped):
            text = BRACKETS.sub(lambda m: re.sub(r'0x[0-9a-f]+|\b\d+\b', 'D', m.group(0)), ins.op_str)
            if ins.mnemonic == 'call' or ins.mnemonic.startswith('j'):
                text = re.sub(r'^0x[0-9a-f]+$', 'T', text)
            if mapped:
                text = REG.sub(lambda m: same_width(m.group(0), self.regmap.get(reg64(m.group(0)), reg64(m.group(0)))), text)
            return ins.mnemonic + ' ' + text
        return skel(x, True) == skel(y, False)


def old_holders(ins, regs, old_fields):
    """Per old instruction: {class: registers holding it}. regs = {class: [spec]}, a spec being a
    register name (holds the class for the whole function) or {'reg', 'from_field': 'Class.field'}
    / {'reg', 'from_operand': text} (holds it from a load of that field / operand until the
    register is next written). Register copies propagate; calls clobber the volatile registers.
    Linear, control flow ignored: a mistake shows up as disagreeing witnesses, never as an answer."""
    fixed = defaultdict(set)
    derived = []
    for cls, spec in regs.items():
        for sp in spec:
            if isinstance(sp, str):
                fixed[sp].add(cls)
            else:
                derived.append((cls, sp))
    live = {}
    out = []
    for i in ins:
        state = defaultdict(set)
        for r, cs in list(fixed.items()) + list(live.items()):
            for c in cs:
                state[c].add(r)
        out.append(state)
        if i.mnemonic == 'call':
            for r in VOLATILE:
                live.pop(r, None)
            continue
        ops = i.op_str.split(', ')
        if not ops or not REG.fullmatch(ops[0]) or i.mnemonic in WRITES_NOT:
            continue
        dst = reg64(ops[0])
        got = set()
        if i.mnemonic == 'mov' and len(ops) == 2 and dst == ops[0]:
            src = ops[1]
            if REG.fullmatch(src) and reg64(src) == src:
                got |= fixed.get(src, set()) | live.get(src, set())
            for cls, sp in derived:
                if sp['reg'] != dst:
                    continue
                if sp.get('from_operand') == src:
                    got.add(cls)
                elif 'from_field' in sp and sp['from_field'] in old_fields:
                    fcls, foff = old_fields[sp['from_field']]
                    for _w, base, index, disp in mem_operands(src):
                        if index is None and disp == foff and fcls in (fixed.get(base, set()) | live.get(base, set())):
                            got.add(cls)
        live[dst] = got
    return out


# --- stages ----------------------------------------------------------------------------------------
class Rederive:
    def __init__(self, old_ver, new_ver):
        self.om = load_manifest(old_ver)
        self.old, self.new = Image(old_ver), Image(new_ver)
        self.cm = ClassMatcher(self.old, self.new)
        self.report = Report()
        self.pairs = {}
        self.out = {'version': self.new.version, 'derived_from': self.old.version, 'classes': {}, 'methods': {},
                    'return_sites': {}, 'fields': {}, 'sets': {}, 'measured': {}, 'sizes': {}}

    def pair(self, orva, nrva):
        key = (orva, nrva)
        if key not in self.pairs:
            self.pairs[key] = Pair(self.old, self.new, orva, nrva)
        return self.pairs[key]

    # classes -----------------------------------------------------------------------------------
    def classes(self):
        for stable, c in self.om['classes'].items():
            if c['name'] is None:
                self.out['classes'][stable] = {'name': None, 'ns': None}
                continue
            new, cands, note = self.cm.match(c['name'])
            if new is None and len(cands) > 1:
                new, cands, note = self.by_field_types(stable, c['name'], cands, note)
            if new is None and is_obfuscated(c['name']):
                new, cands, note = self.relaxed(c['name'])
            if new is None:
                if c.get('rule') == 'measured':
                    note += '; named from a capture last time (sheet-webapp name-capture-states.mjs event-class-map)'
                self.report.add('STOP', stable, f'class {c["name"]}: {note}' +
                                (f' ({", ".join(x["name"] for x in cands[:6])})' if cands else ''))
                self.out['classes'][stable] = {'name': None, 'ns': None, 'old': c['name']}
                continue
            self.cm.memo[c['name']] = (new, [new], note)
            self.out['classes'][stable] = {'name': new['name'], 'ns': new['ns'], 'old': c['name'], 'match': note}

    def by_field_types(self, stable, name, cands, note):
        """Several classes share the structural signature (AnimatorEvent subclasses do): keep those
        whose instance-field types, mapped and sorted, are the old class's. Field ORDER is
        reshuffled every build, so the types are compared as a multiset. One survivor or nothing."""
        old = self.old.by_name[name][0]
        want = sorted(self.cm.map_type(t) or '?' for _n, _o, t in self.old.instance_fields(old))
        keep = [c for c in cands if sorted(t for _n, _o, t in self.new.instance_fields(c)) == want]
        if len(keep) == 1:
            self.report.add('REVIEW', stable, f'class {name} -> {keep[0]["name"]}: {len(cands)} structural candidates, '
                            'one with the same field types')
            return keep[0], keep, 'structural + field types, one candidate'
        return None, cands, f'{note}; {len(keep)} with the same field types'

    def relaxed(self, name):
        """Structural signature without the field count: a class that gained or lost a field.
        Accepted with one candidate only, and always reviewed."""
        old = self.old.by_name[name][0]
        key = lambda c: (lambda s: (s[0],) + s[2:])(class_signature(c))  # noqa: E731
        want = key(old)
        cands = [c for c in self.new.classes if key(c) == want]
        if len(cands) == 1:
            stable = next(k for k, v in self.om['classes'].items() if v['name'] == name)
            self.report.add('REVIEW', stable, f'class {name} -> {cands[0]["name"]}: one candidate only after dropping '
                            f'the field count ({len(old["fields"])} -> {len(cands[0]["fields"])} fields)')
            return cands[0], cands, 'structural without field count, one candidate'
        return None, cands, f'no strict match; {len(cands)} candidates without the field count'

    def new_class(self, stable_class):
        c = self.out['classes'].get(stable_class) or {}
        if not c.get('name'):
            return None
        found = [k for k in self.new.by_name.get(c['name'], []) if k['ns'] == c['ns']]
        return found[0] if len(found) == 1 else None

    def old_class(self, stable_class):
        c = self.om['classes'].get(stable_class) or {}
        if not c.get('name'):
            return None
        found = [k for k in self.old.by_name.get(c['name'], []) if k['ns'] == c['ns']]
        return found[0] if len(found) == 1 else None

    # methods -----------------------------------------------------------------------------------
    def rank(self, orva, klass, params):
        shape = self.old.shape(orva)
        cands = [(n, p, r) for n, p, r in klass['methods'] if r and (params is None or p == params)]
        if not cands:
            cands = [(n, p, r) for n, p, r in klass['methods'] if r]
        ranked = []
        best = 0.0
        for n, p, r in sorted(cands, key=lambda x: abs(len(self.new.dis(x[2])) - len(shape))):
            ns = self.new.shape(r)
            upper = 2 * min(len(ns), len(shape)) / (len(ns) + len(shape)) if ns or shape else 0
            if upper < best - MIN_GAP - 0.05:
                continue
            score = difflib.SequenceMatcher(None, shape, ns, autojunk=False).ratio()
            best = max(best, score)
            ranked.append((score, r, n, p, len(ns)))
        ranked.sort(reverse=True)
        return ranked

    def rank_global(self, orva, params, slack=0.2, limit=300):
        """Every method in the dump with this arity and a body within `slack` of the old size, closest
        size first, shape-ranked like rank(). For a method whose class matched nothing (3.3.3's
        result converter against 3.3.2, found then as the only method with its signature)."""
        size = self.method_bytes(self.old, orva)
        cands = []
        for c in self.new.classes:
            for n, p, r in c['methods']:
                if r and p == params:
                    b = self.method_bytes(self.new, r)
                    if abs(b - size) <= slack * size:
                        cands.append((abs(b - size), c, n, p, r))
        cands.sort(key=lambda x: x[0])
        seen = set()
        pseudo = {'methods': []}
        for _d, c, n, p, r in cands[:limit]:
            if r not in seen:
                seen.add(r)
                pseudo['methods'].append((n, p, r))
        return self.rank(orva, pseudo, params)

    @staticmethod
    def method_bytes(img, rva):
        i = bisect.bisect_right(img.rvas, rva)
        return min(img.rvas[i] - rva, 0x20000) if i < len(img.rvas) else 0x20000

    def methods(self):
        deferred = []
        for stable, m in self.om['methods'].items():
            if m.get('disambiguate'):
                deferred.append(stable)
            else:
                self.method(stable, m)
        for stable in deferred:
            self.method(stable, self.om['methods'][stable])

    def method(self, stable, m):
        entry = {k: m[k] for k in ('hook', 'used_by', 'disambiguate') if k in m}
        entry.update(name=None, params=None, rva=None)
        self.out['methods'][stable] = entry
        if m['rva'] is None:
            entry['note'] = 'no RVA in the old manifest'
            return
        klass = self.new_class(stable.split('.')[0])
        orva = ix(m['rva'])
        if klass is None:
            ranked = self.rank_global(orva, m['params'])
            if not ranked:
                self.report.add('STOP', stable, 'owning class did not match, and no method of the same arity and size')
                return
            owner = self.new.method_at(ranked[0][1])[0]
            self.report.add('REVIEW', stable, f'owning class did not match; found by a whole-dump shape search '
                            f'(owner {owner}, {len(ranked)} same-arity candidates of similar size)')
            cls = stable.split('.')[0]
            runner = ranked[1][0] if len(ranked) > 1 else 0.0
            if not (self.out['classes'].get(cls) or {}).get('name') and ranked[0][0] >= MIN_SCORE \
                    and ranked[0][0] - runner >= MIN_GAP:
                found = self.new.by_name.get(owner, [])
                if len(found) == 1:
                    self.out['classes'][cls] = {'name': owner, 'ns': found[0]['ns'],
                                                'old': self.om['classes'][cls]['name'], 'match': 'owner of a globally matched method'}
                    self.report.items = [i for i in self.report.items if not (i['item'] == cls and i['kind'] == 'STOP')]
                    self.report.add('REVIEW', cls, f'class {self.om["classes"][cls]["name"]} -> {owner}: no structural '
                                    f'match; the owner of {stable}, found by whole-dump shape search')
        else:
            ranked = self.rank(orva, klass, m['params'])
        if not ranked:
            self.report.add('STOP', stable, f'{klass["name"]} has no methods with an RVA')
            return
        tied = [r for r in ranked if r[0] >= ranked[0][0] - TIE]
        chosen = tied[0]
        if len(tied) > 1:
            chosen = self.disambiguate(stable, m, orva, tied)
            if chosen is None:
                return
        rest = [r for r in ranked if r[1] != chosen[1] and r not in tied]
        runner = rest[0][0] if rest else 0.0
        top = ', '.join(f'{n}/{p} {s:.4f} ({k} ins)' for s, _r, n, p, k in ranked[:3])
        if chosen[0] < MIN_SCORE or chosen[0] - runner < MIN_GAP:
            self.report.add('STOP', stable, f'shape gate: best {chosen[0]:.4f}, runner-up {runner:.4f} '
                            f'(need >= {MIN_SCORE} and a {MIN_GAP} gap). Top: {top}')
            entry['candidates'] = [{'rva': hx(r), 'name': n, 'score': round(s, 4)} for s, r, n, _p, _k in ranked[:3]]
            return
        score, nrva, name, params, count = chosen
        entry.update(name=name, params=params, rva=hx(nrva), instructions=count, score=round(score, 4),
                     runner_up=round(runner, 4))
        if score < 0.995:
            self.report.add('INFO', stable, f'shape score {score:.4f} (gate {MIN_SCORE}), runner-up {runner:.4f}')
        pair = self.pair(orva, nrva)
        if 'regs' in m:
            entry['regs'] = {cls: [self.carry_reg(stable, pair, s) for s in spec] for cls, spec in m['regs'].items()}
        if 'prologue' in m:
            new = self.new.data(nrva, len(m['prologue']) // 2).hex()
            entry['prologue'] = new
            if new != m['prologue']:
                self.report.add('REVIEW', stable, f'prologue changed: {m["prologue"]} -> {new} (the trampoline '
                                'relocates these bytes verbatim; check they are position independent)')
        if 'fingerprint' in m:
            new = self.new.data(nrva, 64).hex()
            entry['fingerprint'] = new
            if new != m['fingerprint']:
                self.report.add('REVIEW', stable, 'fingerprint changed: ' + self.classify_bytes(orva, nrva, m['fingerprint'], new))

    def carry_reg(self, stable, pair, s):
        """A register spec in the new build: registers through the pairing; a `from_operand` stack
        slot through the aligned `mov reg, <slot>` rows (frame layouts can change per build)."""
        if isinstance(s, str):
            return pair.regmap.get(s, s)
        d = dict(s)
        d['reg'] = pair.regmap.get(s['reg'], s['reg'])
        src = s.get('from_operand')
        if src and '[' in src:
            seen = {pair.b[j].op_str.split(', ', 1)[1] for i, j in pair.pairs
                    if pair.a[i].mnemonic == 'mov' and pair.a[i].op_str == f'{s["reg"]}, {src}' and ', ' in pair.b[j].op_str}
            if len(seen) == 1:
                d['from_operand'] = seen.pop()
            else:
                self.report.add('REVIEW', stable, f'stack slot {src} for {s["reg"]} not carried: aligned loads give {sorted(seen)}')
        elif src:
            d['from_operand'] = pair.regmap.get(src, src)
        return d

    def classify_bytes(self, orva, nrva, old_hex, new_hex):
        """Which instructions in the first 64 bytes differ, and whether only a RIP-relative
        displacement did (expected every build) or something else."""
        old_b, new_b = bytes.fromhex(old_hex), bytes.fromhex(new_hex)
        diffs = [i for i in range(64) if old_b[i] != new_b[i]]
        notes = []
        for ins in self.new.dis(nrva):
            off = ins.address - nrva
            if off >= 64:
                break
            if any(off <= d < off + ins.size for d in diffs):
                kind = 'rip-relative' if 'rip' in ins.op_str else 'OTHER'
                notes.append(f'+{off:#x} {ins.mnemonic} {ins.op_str} [{kind}]')
        return '; '.join(notes) or 'bytes past the last whole instruction'

    def disambiguate(self, stable, m, orva, tied):
        rule = m['disambiguate']
        names = ', '.join(f'{n} {s:.4f}' for s, _r, n, _p, _k in tied)
        if rule.get('by') != 'callers':
            self.report.add('STOP', stable, f'{len(tied)} candidates tie ({names}) and no disambiguation rule')
            return None
        old_count = len(self.old.callers([orva])[orva])
        counts = self.new.callers([r for _s, r, *_ in tied])
        dist = sorted(((abs(math.log((len(counts[r]) + 1) / (old_count + 1))), t) for t in tied for r in [t[1]]),
                      key=lambda x: x[0])
        chosen = dist[0][1]
        summary = ', '.join(f'{t[2]} {len(counts[t[1]])}' for _d, t in dist)
        if len(dist) > 1 and dist[1][0] - dist[0][0] < math.log(3):
            self.report.add('STOP', stable, f'identical-shape tie not separated by caller count (old {old_count}; {summary})')
            return None
        note = f'identical-shape tie broken by caller count: old {old_count}; new {summary}'
        caller = rule.get('called_by')
        if caller:
            c = self.out['methods'].get(caller) or {}
            if not c.get('rva'):
                note += f'; called_by witness {caller} not matched, NOT checked'
                self.report.add('REVIEW', stable, note)
                return chosen
            calls = {int(i.op_str, 16) for i in self.new.dis(ix(c['rva'])) if i.mnemonic in ('call', 'jmp') and i.op_str.startswith('0x')}
            hits = [t for t in tied if t[1] in calls]
            if hits != [chosen]:
                self.report.add('STOP', stable, note + f'; but {caller} calls {[t[2] for t in hits]}')
                return None
            note += f'; {caller} calls only the chosen one'
        self.report.add('INFO', stable, note)
        return chosen

    # return sites -----------------------------------------------------------------------------
    def return_sites(self):
        for stable, s in self.om['return_sites'].items():
            entry = {'used_by': s['used_by'], 'address': None}
            self.out['return_sites'][stable] = entry
            stable_class = next((k for k, v in self.om['classes'].items() if v['name'] == s['class']), None)
            klass = self.new_class(stable_class) if stable_class else None
            if klass is None:
                self.report.add('STOP', stable, f'class {s["class"]} is not a manifest class, or did not match')
                continue
            orva = ix(s['method_rva'])
            ranked = self.rank(orva, klass, s['params'])
            runner = ranked[1][0] if len(ranked) > 1 else 0.0
            if not ranked or ranked[0][0] < MIN_SCORE or ranked[0][0] - runner < MIN_GAP:
                self.report.add('STOP', stable, 'containing method failed the shape gate: ' +
                                ', '.join(f'{n} {sc:.4f}' for sc, _r, n, _p, _k in ranked[:3]))
                continue
            nrva = ranked[0][1]
            pair = self.pair(orva, nrva)
            addr = ix(s['address'])
            call = next((i for i, ins in enumerate(pair.a) if ins.address + ins.size == addr), None)
            j = next((j for i, j in pair.pairs if i == call), None)
            if call is None or j is None or pair.b[j].mnemonic != 'call':
                self.report.add('STOP', stable, 'the call before the return address is not in an aligned block')
                continue
            ins = pair.b[j]
            entry.update(address=hx(ins.address + ins.size), method_rva=hx(nrva), class_=klass['name'], method=ranked[0][2],
                         params=ranked[0][3], offset=hx(ins.address + ins.size - nrva), score=round(ranked[0][0], 4))
            entry['class'] = entry.pop('class_')

    # fields ------------------------------------------------------------------------------------
    def fields(self):
        old_fields = {k: (k.split('.')[0], ix(f['offset'])) for k, f in self.om['fields'].items() if f['offset']}
        evidence = defaultdict(lambda: defaultdict(list))   # stable -> new offset -> [site]
        dropped = defaultdict(list)
        by_class = defaultdict(dict)                        # class -> old offset -> [stable]
        for k, (cls, off) in old_fields.items():
            by_class[cls].setdefault(off, []).append(k)
        for mstable, m in self.om['methods'].items():
            nm = self.out['methods'].get(mstable) or {}
            if not m.get('regs') or not nm.get('rva'):
                continue
            pair = self.pair(ix(m['rva']), ix(nm['rva']))
            holders = old_holders(pair.a, m['regs'], old_fields)
            for i, j in pair.pairs:
                x, y = pair.a[i], pair.b[j]
                ox, oy = mem_operands(x.op_str), mem_operands(y.op_str)
                if len(ox) != len(oy):
                    continue
                for (w1, b1, i1, d1), (w2, b2, i2, d2) in zip(ox, oy):
                    if i1 or i2:
                        continue
                    for cls, regs in holders[i].items():
                        if b1 not in regs:
                            continue
                        for stable in by_class[cls].get(d1, []):
                            site = f'{mstable}:{x.address:x}->{y.address:x}' + (' unchanged' if x.op_str == y.op_str else '')
                            if w1 != w2:
                                dropped[stable].append(site + f' width {w1}->{w2}')
                            elif not pair.consistent(x, y):
                                dropped[stable].append(site + f' other operands differ ({x.op_str} / {y.op_str})')
                            elif (i - 1, j - 1) not in pair.pair_set and (i + 1, j + 1) not in pair.pair_set:
                                # an isolated one-row match inside a re-ordered block (3.3.4's stun
                                # reset block: a constant store paired with an xorps-zero store)
                                dropped[stable].append(site + ' isolated row, neither neighbour aligned')
                            elif b2 != pair.regmap.get(b1, b1):
                                dropped[stable].append(site + f' register {b1}->{b2}, pairing says {pair.regmap.get(b1)}')
                            else:
                                evidence[stable][d2].append(site + (' weak' if store_run(pair.a, i, b1) else ''))
        resolved = {}
        for stable, f in self.om['fields'].items():
            self.out['fields'][stable] = self.field(stable, f, evidence.get(stable, {}), dropped.get(stable, []))
            # only code- or type-settled fields can eliminate others; a positional guess cannot
            if self.out['fields'][stable]['offset'] and self.out['fields'][stable]['rule'] != 'positional':
                resolved[stable] = ix(self.out['fields'][stable]['offset'])
        self.eliminate(resolved)
        for stable, f in self.out['fields'].items():
            self.name_field(stable, f)
        single = [k for k, f in self.out['fields'].items()
                  if f['rule'] in ('code', 'unchanged', 'code_weak') and sum(f.get('evidence', {}).values()) == 1]
        if single:
            self.report.add('INFO', 'fields', f'{len(single)} fields rest on ONE aligned witness row (no second '
                            'witness, no type check): ' + ', '.join(single))

    def type_candidates(self, stable, off):
        """Old type of the field; old/new instance fields of that (mapped) type."""
        cls = stable.split('.')[0]
        oc, nc = self.old_class(cls), self.new_class(cls)
        if oc is None or nc is None or off is None:
            return None, [], []
        olds = chain_fields(self.old, oc)
        t = [ft for _n, o, ft in olds if o == off]
        if len(t) != 1:
            return None, [], []
        mapped = self.cm.map_type(t[0])
        if mapped is None:
            return t[0], [o for _n, o, ft in olds if ft == t[0]], None
        return t[0], [o for _n, o, ft in olds if ft == t[0]], [o for _n, o, ft in chain_fields(self.new, nc) if ft == mapped]

    def field(self, stable, f, evidence, dropped):
        entry = {'offset': None, 'rule': None, 'used_by': f['used_by']}
        old_off = ix(f['offset'])
        if old_off is None:
            entry['note'] = 'no offset in the old manifest'
            self.report.add('STOP', stable, 'no offset in the old manifest; pin it on the old build first')
            return entry
        strong = {off: [x for x in v if not x.endswith(' weak')] for off, v in evidence.items()}
        strong = {off: v for off, v in strong.items() if v}
        code = strong or dict(evidence)
        weak_only = bool(code) and not strong
        entry['evidence'] = {hex(k): len(v) for k, v in evidence.items()}
        if strong and len(evidence) > len(strong):
            outvoted = {hex(k): len(v) for k, v in evidence.items() if k not in strong}
            self.report.add('INFO', stable, f'store-block rows ignored where strong witnesses exist: {outvoted}')
        if dropped:
            entry['dropped'] = len(dropped)
        otype, olds, news = self.type_candidates(stable, old_off)
        typed = news[0] if news and len(olds) == 1 and len(news) == 1 else None
        if len(code) > 1:
            self.report.add('STOP', stable, 'witnesses disagree: ' + '; '.join(
                f'{k:#x} x{len(v)} ({v[0]})' for k, v in code.items()))
            return entry
        if code:
            (off, sites), = code.items()
            if typed is not None and typed != off:
                self.report.add('STOP', stable, f'code says {off:#x} ({len(sites)} rows), type-unique says {typed:#x}')
                return entry
            entry.update(offset=hx(off), rule='code', sites=sites[:6])
            if all('unchanged' in x for x in sites):
                entry['rule'] = 'unchanged'
            if typed is not None:
                entry['rule'] += '+type_unique'
            elif weak_only:
                entry['rule'] += '_weak'
                self.report.add('REVIEW', stable, f'only store-block witnesses ({len(sites)}: {sites[0]}); '
                                'rows in initializer/reset blocks are re-ordered between builds')
        elif typed is not None:
            entry.update(offset=hx(typed), rule='type_unique')
        if f.get('rule') == 'positional':
            pos = self.positional(olds, news, old_off)
            if entry['offset'] is None and pos is not None:
                entry.update(offset=hx(pos), rule='positional')
            self.report.add('REVIEW', stable, f'positional mapping (sorted {otype} fields): '
                            f'{old_off:#x} -> {hx(pos)}' + (f'; code says {entry["offset"]}' if entry['rule'] != 'positional' else ''))
        if entry['offset'] is None:
            why = 'measured from a capture last time; re-measure (`measure` stage)' if f.get('rule') == 'measured' else \
                'no code witness on the object register and not type-unique'
            if dropped:
                why += f'; {len(dropped)} rows dropped by register/width discipline (e.g. {dropped[0]})'
            entry['elimination_type'] = otype
            self.report.add('STOP', stable, why)
        elif f.get('rule') == 'measured':
            self.report.add('REVIEW', stable, f'was capture-measured; the tool now derives {entry["offset"]} by {entry["rule"]} '
                            '-- confirm against the first capture')
        return entry

    @staticmethod
    def positional(olds, news, off):
        if not olds or news is None or len(olds) != len(news) or off not in olds:
            return None
        return sorted(news)[sorted(olds).index(off)]

    def eliminate(self, resolved):
        """A field whose type has k fields in both builds, with the other k-1 already resolved, takes
        the one remaining new field of that type. Reviewed, never silent."""
        for stable, entry in self.out['fields'].items():
            if entry['offset'] is not None or not entry.get('elimination_type'):
                continue
            old_off = ix(self.om['fields'][stable]['offset'])
            otype, olds, news = self.type_candidates(stable, old_off)
            if not news or len(olds) != len(news) or len(olds) < 2:
                continue
            cls = stable.split('.')[0]
            others = {o for o in olds if o != old_off}
            taken = set()
            for k, f in self.om['fields'].items():
                if k.split('.')[0] == cls and ix(f['offset']) in others and k in resolved:
                    taken.add(resolved[k])
                    others.discard(ix(f['offset']))
            left = [o for o in news if o not in taken]
            if not others and len(left) == 1:
                entry.update(offset=hx(left[0]), rule='elimination')
                self.report.items = [i for i in self.report.items if not (i['item'] == stable and i['kind'] == 'STOP')]
                self.report.add('REVIEW', stable, f'by elimination: the only {otype} field left once the others were '
                                f'code-pinned ({old_off:#x} -> {left[0]:#x})')

    def name_field(self, stable, entry):
        entry.pop('elimination_type', None)
        klass = self.new_class(stable.split('.')[0])
        off = ix(entry['offset'])
        if klass is None or off is None:
            return
        hits = [(n, t) for n, o, t in chain_fields(self.new, klass) if o == off]
        if len(hits) == 1:
            entry['name'], entry['type'] = hits[0]
            otype, _o, _n = self.type_candidates(stable, ix(self.om['fields'][stable]['offset']))
            mapped = self.cm.map_type(otype) if otype else None
            if mapped and mapped != hits[0][1]:
                self.report.add('REVIEW', stable, f'type changed: old {otype} (-> {mapped}), new field is {hits[0][1]}')
        elif not hits and self.om['fields'][stable].get('name'):
            self.report.add('REVIEW', stable, f'old offset was the dump field {self.om["fields"][stable]["name"]}, '
                            f'but no new dump field sits at {off:#x}')

    # measured and sizes -----------------------------------------------------------------------
    def rest(self):
        for stable, v in self.om.get('sets', {}).items():
            klass = self.new_class(stable.split('.')[0])
            mapped = self.cm.map_type(v['type'])
            if klass is None or mapped is None:
                self.report.add('STOP', stable, 'class or type did not match')
                continue
            got = sorted(o for _n, o, t in chain_fields(self.new, klass) if t == mapped)
            self.out['sets'][stable] = {'type': mapped, 'value': [hex(x) for x in got], 'used_by': v['used_by']}
            if len(got) != len(v['value']):
                self.report.add('REVIEW', stable, f'{len(v["value"])} -> {len(got)} fields of type {mapped}')
        for stable, v in self.om.get('measured', {}).items():
            self.out['measured'][stable] = {'value': None, 'used_by': v['used_by'], 'previous': v['value']}
            self.report.add('STOP', stable, f'capture-measured (previous {v["value"]}); re-measure from the first capture')
        for stable, v in self.om.get('sizes', {}).items():
            klass = self.new_class(stable.split('.')[0])
            if klass is None:
                self.report.add('STOP', stable, 'class did not match')
                continue
            last = max(o for _n, o, _t in self.new.instance_fields(klass))
            self.out['sizes'][stable] = {'value': hx((last & ~0xf) + 0x10), 'used_by': v['used_by'], 'last_field': hx(last)}

    def run(self):
        self.classes()
        self.methods()
        self.return_sites()
        self.fields()
        self.rest()
        self.out['review'] = self.report.items
        return self.out


# --- check and compare -----------------------------------------------------------------------------
def check(ver):
    m = load_manifest(ver)
    img = Image(ver)
    bad = []
    for stable, c in m['classes'].items():
        if c['name'] and len([k for k in img.by_name.get(c['name'], []) if k['ns'] == c['ns']]) != 1:
            bad.append(f'class {stable}: {c["name"]} does not resolve uniquely')
    for stable, e in m['methods'].items():
        if not e.get('rva'):
            continue
        rva = ix(e['rva'])
        got = img.method_at(rva)
        if got is None or got[1] != e['name'] or got[2] != e['params']:
            bad.append(f'method {stable}: dump has {got} at {e["rva"]}, manifest {e["name"]}/{e["params"]}')
        cls = m['classes'].get(stable.split('.')[0], {}).get('name')
        if got and cls and got[0] != cls:
            bad.append(f'method {stable}: {e["rva"]} belongs to {got[0]}, manifest class {cls}')
        for key, n in (('prologue', None), ('fingerprint', 64)):
            if key in e and img.data(rva, n or len(e[key]) // 2).hex() != e[key]:
                bad.append(f'method {stable}: {key} bytes differ from the binary')
    for stable, e in m['fields'].items():
        if not e.get('offset') or not e.get('name'):
            continue
        c = m['classes'].get(stable.split('.')[0], {})
        found = [k for k in img.by_name.get(c.get('name') or '', []) if k['ns'] == c.get('ns')]
        if len(found) != 1:
            continue
        names = [n for n, o, _t in chain_fields(img, found[0]) if o == ix(e['offset'])]
        if names != [e['name']]:
            bad.append(f'field {stable}: dump has {names} at {e["offset"]}, manifest {e["name"]}')
    for stable, e in m.get('return_sites', {}).items():
        if e.get('address') and img.containing_method(ix(e['address'])) != ix(e['method_rva']):
            bad.append(f'return site {stable}: {e["address"]} is not inside {e["method_rva"]}')
    run = m.get('runtime')
    if run:
        if ix(run['size_of_image']) != img.pe.size_of_image or ix(run['timestamp']) != img.pe.timestamp:
            bad.append(f'runtime: identity {run["size_of_image"]}/{run["timestamp"]} is not the binary\'s')
        table = [ix(x) for x in run['api_table']]
        if len(table) != 194 or 0 in table:
            bad.append(f'runtime: API table has {len(table)} entries, {table.count(0)} unpinned')
        for slot, want in run['api_checks'].items():
            if img.data(table[int(slot)], len(want) // 2).hex() != want:
                bad.append(f'runtime: code check {slot} is not the binary\'s bytes at its slot')
        for rva, want in run['readiness']['anchors']:
            if img.data(ix(rva), len(want) // 2).hex() != want:
                bad.append(f'runtime: readiness anchor {rva} is not the binary\'s bytes')
    # the generated sources: when src/ was emitted from this manifest, they must still equal it
    import emit_pins
    zig = os.path.join(emit_pins.SRC, 'pins.zig')
    if os.path.exists(zig) and f'pins/{m["version"]}.json' in open(zig).readline():
        for name, text in (('pins.zig', emit_pins.emit_zig(m)), ('pins.h', emit_pins.emit_c(m)),
                           ('dumper-rvas.zon', rt.write_zon([ix(x) for x in m['runtime']['api_table']]))):
            if open(os.path.join(emit_pins.SRC, name), newline='').read() != text:
                bad.append(f'src/{name} differs from what this manifest emits (hand-edited, or not re-emitted)')
        print(f'src/pins.zig, pins.h, dumper-rvas.zon: emitted from {m["version"]}, checked')
    for b in bad:
        print('BAD', b)
    counts = {k: len(m[k]) for k in ('classes', 'methods', 'fields', 'return_sites')}
    print(f'{m["version"]}: {counts} -- ' + ('all resolve' if not bad else f'{len(bad)} problems'))
    return 0 if not bad else 1


def compare(derived_path, expected_path):
    d, e = json.load(open(derived_path)), json.load(open(expected_path))
    review = defaultdict(list)
    for i in d.get('review', []):
        review[i['item']].append(i['kind'])
    rows = []

    def row(section, stable, want, got, status_ok):
        flagged = [k for k in review.get(stable, []) if k in ('STOP', 'REVIEW')]
        if want != got and got is None and status_ok is not True:
            rows.append((section, stable, want, got, 'explained: ' + status_ok))
            return
        if want == got:
            status = 'match' + (' (flagged)' if flagged else '')
        elif want is None:
            status = 'new (not in answer key)'
        else:
            status = ('explained: ' + '/'.join(sorted(set(flagged)))) if flagged else 'UNEXPLAINED'
        rows.append((section, stable, want, got, status))

    for stable, c in e['classes'].items():
        g = d['classes'].get(stable) or {}
        row('class', stable, c.get('name'), g.get('name'),
            'no class name in the old manifest (code-only class)' if 'old' not in g and not g.get('name') else True)
    for stable, m in e['methods'].items():
        g = d['methods'].get(stable) or {}
        row('method', stable, m.get('rva'), g.get('rva'), True)
        for key in ('name', 'prologue', 'fingerprint'):
            if m.get(key) is not None and (m.get(key) != g.get(key)):
                row('method.' + key, stable, m.get(key), g.get(key), True)
    for stable, s in e.get('return_sites', {}).items():
        row('return', stable, s.get('address'), (d['return_sites'].get(stable) or {}).get('address'), True)
    for stable, f in e['fields'].items():
        g = d['fields'].get(stable) or {}
        row('field', stable, f.get('offset'), g.get('offset'), True)
        if f.get('name') and g.get('offset') == f.get('offset') and g.get('name') != f.get('name'):
            unnamed = not (d['classes'].get(stable.split('.')[0]) or {}).get('name')
            row('field.name', stable, f.get('name'), g.get('name'), 'owning class unnamed in the derived build' if unnamed else True)
    for stable, s in e.get('sets', {}).items():
        row('set', stable, s.get('value'), (d.get('sets', {}).get(stable) or {}).get('value'), True)
    for stable, s in e.get('sizes', {}).items():
        row('size', stable, s.get('value'), (d['sizes'].get(stable) or {}).get('value'), True)
    for stable, s in e.get('measured', {}).items():
        row('measured', stable, s.get('value'), (d['measured'].get(stable) or {}).get('value'), True)
    ert, drt = e.get('runtime'), d.get('runtime') or {}
    if ert:
        for key in ('unity_table_offset', 'size_of_image', 'timestamp'):
            row('runtime', key, ert[key], drt.get(key), True)
        got = drt.get('api_table') or [None] * 194
        for slot, (want, have) in enumerate(zip(ert['api_table'], got)):
            row('api', f'API[{slot}]', want, have, True)
        for slot, want in ert['api_checks'].items():
            row('api_check', f'check {slot}', want, (drt.get('api_checks') or {}).get(slot), True)
        dr = drt.get('readiness') or {}
        row('readiness', 'main_thread_rva', ert['readiness']['main_thread_rva'], dr.get('main_thread_rva'), True)
        for k, (rva, b) in enumerate(ert['readiness']['anchors']):
            got = (dr.get('anchors') or [[None, None]] * 4)[k]
            row('readiness', f'anchor {k + 1}', f'{rva} {b}', f'{got[0]} {got[1]}' if got[0] else None, True)
    tally = Counter(r[4].split(':')[0].split(' (')[0] for r in rows)
    for section, stable, want, got, status in rows:
        if status != 'match':
            print(f'{status:26s} {section:18s} {stable:36s} expected {want}  derived {got}')
    print(f'\n{len(rows)} compared: ' + ', '.join(f'{k} {v}' for k, v in sorted(tally.items())))
    return 1 if tally.get('UNEXPLAINED') else 0


def derived_path(old, new):
    return os.path.join(LOCAL_DATA, 'rederive', f'{version(old)}-to-{version(new)}.json')


def merge_runtime(old, new, section):
    path = derived_path(old, new)
    out = json.load(open(path)) if os.path.exists(path) else {'version': version(new), 'derived_from': version(old), 'review': []}
    out.setdefault('runtime', {}).update(section)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, 'w', newline='\n') as f:
        json.dump(out, f, indent=1)
        f.write('\n')
    return path


def cmd_bootstrap(a):
    om = load_manifest(a.old)
    old, new = Image(a.old), Image(a.new)
    ort = om['runtime']
    offset, detail = rt.unity_table(PE(unity_player(a.old)), PE(unity_player(a.new)), ix(ort['unity_table_offset']))
    print(f'Unity table: {hx(offset)} (old {ort["unity_table_offset"]}); {detail}')
    old_table = [ix(x) for x in ort['api_table']]
    table, notes = rt.bootstrap(old, new, old_table)
    called = rt.called_slots(os.path.join(HERE, '..', '..', 'src'))
    table, notes = rt.guess_called(old, new, old_table, table, notes, called)
    guesses = [n for n in notes if 'GUESS' in str(n[1])]
    section = {'unity_table_offset': hx(offset), 'size_of_image': hx(new.pe.size_of_image),
               'timestamp': hx(new.pe.timestamp), 'bootstrap_table': [hex(x) for x in table],
               'bootstrap_notes': {str(sl): n for sl, n, _l in notes if n != 'unique'}}
    path = merge_runtime(a.old, a.new, section)
    if a.zon:
        with open(a.zon, 'w', newline='\n') as f:
            f.write(rt.write_zon(table))
    print(f'bootstrap: {sum(1 for x in table if x)}/194 pinned ({len(guesses)} guesses on called slots '
          f'{[g[0] for g in guesses]}), {table.count(0)} left for launch 1 to report; '
          f'SizeOfImage {new.pe.size_of_image:#x}, timestamp {new.pe.timestamp:#x} -> {path}')
    if offset is None:
        print('STOP   Unity table offset not found uniquely: run find_unity_table.mjs by hand (playbook)')
        return 1
    return 0


def cmd_table(a):
    om = load_manifest(a.old)
    if a.bootstrap.startswith('git:'):
        import subprocess
        text = subprocess.run(['git', '-C', os.path.join(HERE, '..', '..'), 'show', a.bootstrap[4:] + ':src/dumper-rvas.zon'],
                              capture_output=True, text=True, check=True).stdout
    else:
        text = open(a.bootstrap).read()
    boot = rt.parse_zon(text)
    table, notes, errors = rt.apply_report(boot, open(a.report, encoding='utf-8', errors='replace').read())
    old, new = Image(a.old), Image(a.new)
    checks = rt.classify_checks(old, new, [ix(x) for x in om['runtime']['api_table']], table, om['runtime']['api_checks'])
    ready, problems = rt.readiness(old, new, om['runtime']['readiness'], table)
    errors += ['readiness: ' + x for x in problems]
    offset, detail = rt.unity_table(PE(unity_player(a.old)), PE(unity_player(a.new)), ix(om['runtime']['unity_table_offset']))
    if offset is None:
        errors.append(f'Unity table offset not found uniquely ({detail}); find it by hand (find_unity_table.mjs)')
    section = {'readiness': ready, 'unity_table_offset': hx(offset),
               'api_table': [hex(x) for x in table], 'api_checks': {k: v['bytes'] for k, v in checks.items()},
               'api_check_kinds': {k: v['kind'] for k, v in checks.items()}, 'report': notes,
               'size_of_image': hx(new.pe.size_of_image), 'timestamp': hx(new.pe.timestamp)}
    path = merge_runtime(a.old, a.new, section)
    for e in errors:
        print('STOP  ', e)
    for slot, c in checks.items():
        flag = 'REVIEW' if any(x.startswith(('SHAPE', 'OTHER')) for x in c['changes']) else 'INFO  '
        print(f'{flag} check {slot:>3s} {c["kind"]:28s} {c["bytes"]}' + ''.join(f'\n         {x}' for x in c['changes']))
    if ready:
        print(f'INFO   readiness: Thread::Attach {ready["thread_attach"]}, main thread {ready["main_thread_rva"]}, '
              f'anchors {[a for a, _b in ready["anchors"]]}' + ''.join(f'; {x}' for x in ready['notes']))
    print(f'table: {notes}; {len(errors)} errors -> {path}')
    return 1 if errors else 0


ZIG = os.environ.get('THAUMIEL_ZIG') or os.path.join(LOCAL_DATA, 'tools', 'zig-x86_64-windows-0.16.0', 'zig.exe')
ROOT = os.path.normpath(os.path.join(HERE, '..', '..'))
NATIVE_TESTS = ['damage_probe_test', 'damage_probe_record_test', 'damage_probe_install_test', 'damage_probe_rotate_test',
                'damage_result_test', 'damage_snapshot_test', 'damage_daze_test', 'damage_anomaly_test']


def build_and_test(out_dir):
    """zig build (clean: zig's cache does not track the probes' #includes), the eight native probe
    tests, and the two Zig unit tests. -> list of failures."""
    import shutil
    import subprocess
    env = dict(os.environ, ZIG_GLOBAL_CACHE_DIR=os.path.join(ROOT, '.zig-global-cache'))
    shutil.rmtree(os.path.join(ROOT, '.zig-cache'), ignore_errors=True)
    fails = []
    r = subprocess.run([ZIG, 'build', '-Doptimize=ReleaseFast'], cwd=ROOT, env=env, capture_output=True, text=True)
    if r.returncode:
        return ['zig build: ' + (r.stderr.strip().splitlines() or ['failed'])[-1]] + \
               [line for line in r.stderr.splitlines() if 'error:' in line][:12]
    os.makedirs(out_dir, exist_ok=True)
    src = os.path.join(ROOT, 'src')
    for t in NATIVE_TESTS:
        exe = os.path.join(out_dir, t + '.exe')
        args = [ZIG, 'cc', '-O2', os.path.join(src, t + '.c')] + ([os.path.join(src, 'damage_probe.S')] if t == 'damage_probe_test' else []) + ['-o', exe]
        if subprocess.run(args, cwd=out_dir, env=env, capture_output=True).returncode:
            fails.append(f'{t}: compile failed')
        elif subprocess.run([exe], cwd=out_dir, capture_output=True).returncode:
            fails.append(f'{t}: FAILED')
    for z in ('detour_test.zig', 'runtime_readiness.zig'):
        if subprocess.run([ZIG, 'test', os.path.join(src, z)], cwd=ROOT, env=env, capture_output=True).returncode:
            fails.append(f'zig test {z}: FAILED')
    return fails


def cmd_prepare(a):
    import copy
    import emit_pins
    if cmd_bootstrap(argparse.Namespace(old=a.old, new=a.new, zon=None)):
        return 1
    om = load_manifest(a.old)
    boot = json.load(open(derived_path(a.old, a.new)))['runtime']
    table = [ix(x) for x in boot['bootstrap_table']]
    old, new = Image(a.old), Image(a.new)
    checks = {slot: new.data(table[int(slot)], len(b) // 2).hex()
              for slot, b in om['runtime']['api_checks'].items() if table[int(slot)]}
    ready, problems = rt.readiness(old, new, om['runtime']['readiness'], table)
    if ready is None:
        print('STOP   readiness not re-traced from the bootstrap table: ' + '; '.join(problems) +
              ' -- the dumper waits for readiness, so launch 1 would write nothing. Fix by hand (playbook).')
        return 1
    launch = copy.deepcopy(om)
    launch.update(version=version(a.new), launch1_from=om['version'])
    launch['runtime'] = {'size_of_image': boot['size_of_image'], 'timestamp': boot['timestamp'],
                         'hooks_identity': {'size_of_image': om['runtime']['size_of_image'],
                                            'timestamp': om['runtime']['timestamp']},
                         'unity_table_offset': boot['unity_table_offset'], 'api_table': boot['bootstrap_table'],
                         'api_checks': checks, 'readiness': ready}
    path = os.path.join(LOCAL_DATA, 'rederive', f'{version(a.new)}-launch1.json')
    with open(path, 'w', newline='\n') as f:
        json.dump(launch, f, indent=1)
        f.write('\n')
    for p in emit_pins.emit(path):
        print('wrote', p)
    print(f'launch-1 manifest: {path}; code checks kept for slots {sorted(checks, key=int)} '
          f'(the rest are unpinned until the report); readiness notes: {ready["notes"]}')
    if not a.no_build:
        fails = build_and_test(os.path.join(LOCAL_DATA, 'rederive', 'native-tests'))
        print('\n'.join(['BUILD/TEST ' + f for f in fails]) or 'build + 8 probe tests + detour + readiness: pass')
        if fails:
            return 1
    print('\nMANUAL: launch the client once with this DLL (zig-out/bin/thaumiel.dll). The dumper writes the '
          'new il2cpp dump and hitlog-startup.log (the table report); every hook refuses by design.\n'
          f'Then: rederive.py finish {a.old} {a.new} --report <that hitlog-startup.log>')
    return 0


def cmd_finish(a):
    import emit_pins
    boot = a.bootstrap
    if boot is None:
        prep = json.load(open(derived_path(a.old, a.new))).get('runtime', {})
        if 'bootstrap_table' not in prep:
            print('STOP   no bootstrap recorded for this pair: pass --bootstrap (the zon launch 1 ran with)')
            return 1
        boot = os.path.join(LOCAL_DATA, 'rederive', f'{version(a.new)}-bootstrap.zon')
        with open(boot, 'w', newline='\n') as f:
            f.write(rt.write_zon([ix(x) for x in prep['bootstrap_table']]))
    status = cmd_table(argparse.Namespace(old=a.old, new=a.new, report=a.report, bootstrap=boot))
    if status:
        return status
    out = Rederive(a.old, a.new).run()
    out['runtime'] = json.load(open(derived_path(a.old, a.new)))['runtime']
    for k in ('bootstrap_table', 'bootstrap_notes', 'report', 'api_check_kinds'):
        out['runtime'].pop(k, None)
    with open(derived_path(a.old, a.new), 'w', newline='\n') as f:
        json.dump(out, f, indent=1)
        f.write('\n')
    pins_path = a.pins_out or os.path.join(PINS, version(a.new) + '.json')
    if os.path.exists(pins_path) and not a.pins_out:
        print(f'STOP   {pins_path} exists (an answer key or a committed manifest): not overwritten; '
              f'pass --pins-out to write elsewhere. Derived: {derived_path(a.old, a.new)}')
        return 1
    manifest = {k: v for k, v in out.items() if k != 'review'}
    manifest['derived_by'] = f'rederive.py finish {version(a.old)} {version(a.new)}'
    with open(pins_path, 'w', newline='\n') as f:
        json.dump(manifest, f, indent=1)
        f.write('\n')
    kinds = Counter(i['kind'] for i in out['review'])
    for kind in ('STOP', 'REVIEW'):
        for i in out['review']:
            if i['kind'] == kind:
                print(f'{kind:6s} {i["item"]:36s} {i["text"]}')
    for p in emit_pins.emit(pins_path):
        print('wrote', p)
    decoder = os.path.join(ROOT, 'tools', 'per-hit-log.mjs')
    added, pending = emit_pins.insert_layout(decoder, manifest, load_manifest(a.old))
    print(f'per-hit-log.mjs LAYOUTS["{manifest["version"]}"]: ' + ('added' if added else pending) +
          (f'; PENDING the first capture: {", ".join(pending)}' if added and pending else ''))
    print('sheet-webapp tools/client-build-constants.mjs (another repo: add to BUILD_CONSTANTS and move\n'
          f'NEWEST_KNOWN_BUILD to {manifest["version"]}):\n' + emit_pins.build_constants_entry(manifest))
    fails = [] if a.no_build else build_and_test(os.path.join(LOCAL_DATA, 'rederive', 'native-tests'))
    print('\n'.join(['BUILD/TEST ' + f for f in fails]) or ('build + 8 probe tests + detour + readiness: pass' if not a.no_build else 'build skipped'))
    print(f'\n{manifest["version"]}: STOP {kinds["STOP"]}, REVIEW {kinds["REVIEW"]} -> {pins_path}\n'
          'A STOP that a module references fails the build: settle it in the manifest and re-run emit.\n'
          'MANUAL: launch 2 (one battle with a Stun and an Ultimate) for live validation, then\n'
          f'rederive.py measure {version(a.new)} <battle folder> --apply for the capture-measured values;\n'
          'the sheet-webapp line above.')
    return 1 if fails else 0


def _rewrite_keeping_eol(path, edit):
    """Apply edit(text, eol) to a file read and written untranslated (CRLF files stay CRLF)."""
    with open(path, encoding='utf-8', newline='') as f:
        text = f.read()
    eol = '\r\n' if '\r\n' in text else '\n'
    new = edit(text, eol)
    if new != text:
        with open(path, 'w', encoding='utf-8', newline='') as f:
            f.write(new)
    return new != text


def cmd_measure(a):
    import re
    import rederive_measure as ms
    mpath = a.manifest or os.path.join(PINS, version(a.version) + '.json')
    m = json.load(open(mpath))
    f = m['fields']
    dump_bytes = ix(m['sizes']['DamageResult.dump_bytes']['value'])
    img = Image(a.version)
    cls = [k for k in img.by_name.get(m['classes']['DamageResult']['name'], []) if k['ns'] == m['classes']['DamageResult']['ns']]
    effect_candidates = [o for _n, o, t in chain_fields(img, cls[0]) if t.endswith(('.ConfigHitEffect', '.ConfigEntityAttackEffect'))]
    req, req_note = ms.daze_requested(a.battle, ix(f['DamageResult.damage']['offset']), ix(f['DamageResult.daze']['offset']), dump_bytes)
    roles, roles_note = ms.hitnames_roles(a.battle)
    eff, eff_note = ms.effect_fields(a.battle, effect_candidates, dump_bytes, ms.ability_column(a.battle, roles))
    print(f'daze_requested  {hx(req)}  ({req_note})')
    print(f'effect_fields   {[hex(x) for x in eff] if eff else None}  ({eff_note})')
    print(f'HitNames.roles  {roles}  ({roles_note})')
    if not a.apply:
        return 0 if req is not None and eff and roles else 1
    where = '/'.join(os.path.normpath(a.battle).replace('\\', '/').split('/')[-2:])  # <session>/battle-N
    if req is not None:
        f['DamageResult.daze_requested'].update(offset=hx(req), rule='measured', note=f'measured on {where}')
    if eff:
        m['measured']['DamageResult.effect_fields']['value'] = [hex(x) for x in eff]
    if roles:
        m['measured']['HitNames.roles']['value'] = roles
    with open(mpath, 'w', newline='\n') as fh:
        json.dump(m, fh, indent=1)
        fh.write('\n')
    ver = m['version']

    def layout(text, eol):
        start = text.find(f'  "{ver}": {{')
        if start < 0 or 'generated by tools/update/rederive.py' not in text[text.rfind(eol, 0, start - len(eol)):start]:
            print(f'LAYOUTS["{ver}"]: not a generated entry; values above are for a hand edit')
            return text
        end = text.index('} },', start) + 4
        block = text[start:end]
        if req is not None:
            block = block.replace('daze_requested: null', f'daze_requested: {hex(req)}')
        if roles:
            block = re.sub(r'a8: (?:null|\{[^}]*\})', f'a8: {{ ability: {roles["ability"]}, attack_property: '
                           f'{roles["attack_property"]}, other: {roles["other"]} }}', block)
        done = [x for x, ok in (('daze_requested', req is not None), ('a8', roles)) if ok]
        cstart = text.rfind(eol, 0, start - len(eol)) + len(eol)
        comment = text[cstart:start].rstrip('\r\n')
        marker = ' PENDING the first capture (measure): '
        still = []
        if marker in comment:
            comment, listed = comment.split(marker, 1)
            still = [x for x in listed.rstrip('.').split(', ') if x.split(' ')[0] not in done]
        comment += f' Measured on {where}: {", ".join(done)}.' + (marker + ', '.join(still) + '.' if still else '')
        return text[:cstart] + comment + eol + block + text[end:]
    _rewrite_keeping_eol(os.path.join(ROOT, 'tools', 'per-hit-log.mjs'), layout)

    def effects(text, eol):
        if eff is None or f"'{ver}':" in text[text.index('EFFECT_OFFSETS'):]:
            return text
        start = text.index('export const EFFECT_OFFSETS = {')
        close = text.index(eol + '};', start) + len(eol)
        line = f"  '{ver}': [{', '.join(hex(x) for x in eff)}], // measured by rederive.py measure on {where}" + eol
        return text[:close] + line + text[close:]
    _rewrite_keeping_eol(os.path.join(ROOT, 'tools', 'attribution.mjs'), effects)
    print(f'applied to {mpath}, tools/per-hit-log.mjs, tools/attribution.mjs')
    return 0


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest='cmd', required=True)
    sub.add_parser('check').add_argument('version')
    mp = sub.add_parser('match')
    mp.add_argument('old')
    mp.add_argument('new')
    mp.add_argument('--out')
    cp = sub.add_parser('compare')
    cp.add_argument('derived')
    cp.add_argument('expected')
    pp = sub.add_parser('prepare')
    pp.add_argument('old')
    pp.add_argument('new')
    pp.add_argument('--no-build', action='store_true')
    fp = sub.add_parser('finish')
    fp.add_argument('old')
    fp.add_argument('new')
    fp.add_argument('--report', required=True)
    fp.add_argument('--bootstrap')
    fp.add_argument('--pins-out')
    fp.add_argument('--no-build', action='store_true')
    mp2 = sub.add_parser('measure')
    mp2.add_argument('version')
    mp2.add_argument('battle')
    mp2.add_argument('--manifest')
    mp2.add_argument('--apply', action='store_true')
    ep = sub.add_parser('emit')
    ep.add_argument('manifest')
    bp = sub.add_parser('bootstrap')
    bp.add_argument('old')
    bp.add_argument('new')
    bp.add_argument('--zon')
    tp = sub.add_parser('table')
    tp.add_argument('old')
    tp.add_argument('new')
    tp.add_argument('--report', required=True)
    tp.add_argument('--bootstrap', required=True)
    a = ap.parse_args()
    if a.cmd == 'prepare':
        return cmd_prepare(a)
    if a.cmd == 'finish':
        return cmd_finish(a)
    if a.cmd == 'measure':
        return cmd_measure(a)
    if a.cmd == 'emit':
        import emit_pins
        for path in emit_pins.emit(a.manifest):
            print('wrote', path)
        return 0
    if a.cmd == 'bootstrap':
        return cmd_bootstrap(a)
    if a.cmd == 'table':
        return cmd_table(a)
    if a.cmd == 'check':
        return check(a.version)
    if a.cmd == 'compare':
        return compare(a.derived, a.expected)
    out = Rederive(a.old, a.new).run()
    path = a.out or derived_path(a.old, a.new)
    if os.path.exists(path) and 'runtime' in json.load(open(path)):
        out['runtime'] = json.load(open(path))['runtime']
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, 'w', newline='\n') as f:
        json.dump(out, f, indent=1)
        f.write('\n')
    kinds = Counter(i['kind'] for i in out['review'])
    for kind in ('STOP', 'REVIEW', 'INFO'):
        for i in out['review']:
            if i['kind'] == kind:
                print(f'{kind:6s} {i["item"]:36s} {i["text"]}')
    print(f'\n{out["version"]}: {sum(1 for f in out["fields"].values() if f["offset"])}/{len(out["fields"])} fields, '
          f'{sum(1 for m in out["methods"].values() if m.get("rva"))}/{len(out["methods"])} methods; '
          f'STOP {kinds["STOP"]}, REVIEW {kinds["REVIEW"]}, INFO {kinds["INFO"]} -> {path}')
    return 0


if __name__ == '__main__':
    sys.exit(main())
