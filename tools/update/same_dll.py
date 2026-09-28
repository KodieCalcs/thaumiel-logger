"""Are two thaumiel.dll builds the same program?  py tools/update/same_dll.py <a.dll> <b.dll>

Two clean builds of one tree differ only in the PE timestamp and the .buildid section, so every
other section byte-identical means a source change (e.g. moving pins into the generated
src/pins.zig / pins.h) changed nothing the DLL does. Exit 0 when identical, 1 otherwise.
"""
import struct
import sys


def sections(path):
    b = open(path, 'rb').read()
    pe = struct.unpack_from('<I', b, 0x3c)[0]
    n = struct.unpack_from('<H', b, pe + 6)[0]
    opt = struct.unpack_from('<H', b, pe + 20)[0]
    out = {}
    for i in range(n):
        o = pe + 24 + opt + 40 * i
        name = b[o:o + 8].rstrip(b'\0').decode()
        vs, va, rs, ro = struct.unpack_from('<IIII', b, o + 8)
        out[name] = b[ro:ro + rs]
    return out


a, b = sections(sys.argv[1]), sections(sys.argv[2])
bad = []
for name in sorted(set(a) | set(b)):
    if name == '.buildid':
        continue
    if a.get(name) != b.get(name):
        x, y = a.get(name, b''), b.get(name, b'')
        first = next((i for i in range(min(len(x), len(y))) if x[i] != y[i]), min(len(x), len(y)))
        bad.append(f'{name}: {len(x)} vs {len(y)} bytes, first difference at +{first:#x}')
print('\n'.join(bad) if bad else 'identical (all sections but .buildid)')
sys.exit(1 if bad else 0)
