"""Validate statelog.zig's pinned RVAs, method arities and field offsets against a dump.

    py tools/update/check_pins.py [version]      (default 3.3.2)

Every hook module pins what it expects of the client and refuses to patch on a mismatch. That
refusal is correct but expensive to discover: it costs a launch and a fight to learn that one
offset was mistyped (2026-09-22, `GILABPBBMJH+0xca` was pinned to the field name one byte
earlier, so nothing installed and state.tsv came back header-only). This reads the pins straight
out of the source and checks them offline, in a second.

Exit code 0 when every pin matches, 1 otherwise. Checks, per pin:
  Target  the class resolves uniquely, the method resolves uniquely at that arity, and its RVA
          is the pinned one; the prologue bytes are the real first bytes at that RVA
  Field   the class resolves uniquely, the field name exists exactly once in the class + its
          parent chain (dumper.findField searches the chain and refuses duplicates), and its
          offset is the pinned one
"""
import os, re, struct, sys, bisect

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from dumpq import load
from paths import game_assembly

ver = sys.argv[1] if len(sys.argv) > 1 else '3.3.2'
here = os.path.dirname(os.path.abspath(__file__))
source = os.path.join(here, '..', '..', 'src', 'statelog.zig')

classes = load(ver)
by_name = {}
for c in classes:
    by_name.setdefault(c['name'], []).append(c)


def unique(name):
    got = by_name.get(name, [])
    return got[0] if len(got) == 1 else None


def chain(cls):
    out, cur, seen = [], cls, set()
    while cur is not None and id(cur) not in seen:
        out.append(cur)
        seen.add(id(cur))
        got = by_name.get(cur.get('parent') or '', [])
        cur = got[0] if len(got) == 1 else None
    return out


# --- the client's bytes, for the prologue check -------------------------------------
blob = open(game_assembly(ver), 'rb').read()
pe = struct.unpack_from('<I', blob, 0x3c)[0]
nsec = struct.unpack_from('<H', blob, pe + 6)[0]
optsz = struct.unpack_from('<H', blob, pe + 20)[0]
secs = []
for i in range(nsec):
    vs, va, rs, ro = struct.unpack_from('<IIII', blob, pe + 24 + optsz + i * 40 + 8)
    secs.append((va, vs, ro, rs))


def at(rva, n):
    for va, vs, ro, rs in secs:
        if va <= rva < va + max(vs, rs):
            off = ro + (rva - va)
            return blob[off:off + n]
    return b''


text = open(source, encoding='utf-8').read()
failures = []
checked = 0

# --- targets --------------------------------------------------------------------
target_re = re.compile(
    r'const (\w+): Target = \.\{(.*?)\n\};', re.S)
for m in target_re.finditer(text):
    name, body = m.group(1), m.group(2)
    cls = re.search(r'\.class = "(\w+)"', body).group(1)
    method = re.search(r'\.method = "(\w+)"', body).group(1)
    params = int(re.search(r'\.params = (\d+)', body).group(1))
    rva = int(re.search(r'\.rva = (0x[0-9A-Fa-f]+)', body).group(1), 16)
    prologue = [int(b, 16) for b in re.findall(r'0x([0-9A-Fa-f]{2})', re.search(r'\.prologue = &\.\{(.*?)\}', body, re.S).group(1))]
    checked += 1
    c = unique(cls)
    if c is None:
        failures.append(f"{name}: class {cls} resolves to {len(by_name.get(cls, []))} classes, need exactly 1")
        continue
    hits = [r for n, p, r in c['methods'] if n == method and p == params]
    if len(hits) != 1:
        failures.append(f"{name}: {cls}::{method}/{params} resolves to {len(hits)} methods, need exactly 1")
        continue
    if hits[0] != rva:
        failures.append(f"{name}: {cls}::{method} is at 0x{hits[0]:X}, pinned 0x{rva:X}")
        continue
    actual = at(rva, len(prologue))
    if list(actual) != prologue:
        failures.append(f"{name}: prologue at 0x{rva:X} is {actual.hex()}, pinned {bytes(prologue).hex()}")

# --- fields ---------------------------------------------------------------------
field_re = re.compile(r'const (\w+): Field = \.\{ \.class = "(\w+)", \.name = "([\w<>`\.]+)", \.offset = (0x[0-9A-Fa-f]+) \};')
for m in field_re.finditer(text):
    pin, cls, field, off = m.group(1), m.group(2), m.group(3), int(m.group(4), 16)
    checked += 1
    c = unique(cls)
    if c is None:
        failures.append(f"{pin}: class {cls} resolves to {len(by_name.get(cls, []))} classes, need exactly 1")
        continue
    hits = [(k['name'], o) for k in chain(c) for n, o in k['fields'] if n == field]
    if len(hits) != 1:
        where = ', '.join(f"{k}+0x{o:X}" for k, o in hits) or 'nowhere'
        failures.append(f"{pin}: {cls}.{field} found {len(hits)} times in the chain ({where}), need exactly 1")
        continue
    if hits[0][1] != off:
        owner = hits[0][0]
        real = [n for n, o in c['fields'] if o == off]
        failures.append(
            f"{pin}: {cls}.{field} is at +0x{hits[0][1]:X} (on {owner}), pinned +0x{off:X}"
            + (f" -- the field actually at +0x{off:X} is {real[0]}" if real else ""))

print(f"checked {checked} pins in {os.path.relpath(source)} against {ver}")
for f in failures:
    print("  MISMATCH " + f)
print("all pins match" if not failures else f"{len(failures)} mismatch(es)")
sys.exit(1 if failures else 0)
