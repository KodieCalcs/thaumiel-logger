"""Verify readiness anchors against an extracted CNBetaWin3.3.2 GameAssembly.dll.

Usage: python tools/test-readiness-client.py <GameAssembly.dll>
No client code is executed. Requires only Python's standard library.
"""
from pathlib import Path
import re
import struct
import sys

b = Path(sys.argv[1]).read_bytes()
p = struct.unpack_from('<I', b, 60)[0]
s = p + 24 + struct.unpack_from('<H', b, p + 20)[0]
sections = [struct.unpack_from('<IIII', b, s + 40*i + 8)
            for i in range(struct.unpack_from('<H', b, p + 6)[0])]

def data(rva, count):
    offset = next(raw + rva - va for vs, va, rs, raw in sections
                  if va <= rva and rva + count <= va + rs)
    return b[offset:offset + count]

assert struct.unpack_from('<I', b, p + 0x50)[0] == 0x21396000
source = (Path(__file__).resolve().parents[1] / 'src/runtime_readiness.zig').read_text()
anchors = re.findall(r'\.\{ (0x[0-9a-f]+), "([^"]+)" \}', source)
assert len(anchors) == 4
for rva, escaped in anchors:
    expected = bytes(int(x, 16) for x in re.findall(r'\\x([0-9a-f]{2})', escaped))
    assert data(int(rva, 16), len(expected)) == expected, rva
    print('PASS real-client readiness anchor', rva)
# The call is the same Thread::Attach target as the already verified API slot 152.
assert 0x966cf1 + struct.unpack('<i', data(0x966ced, 4))[0] == 0x991f90
assert 0x90a705 + struct.unpack('<i', data(0x90a701, 4))[0] == 0x991f90
assert 0x966cf8 + struct.unpack('<i', data(0x966cf4, 4))[0] == 0x5659780
# Negative control: API 154 is a setter, not a thread-list query. It must never be polled.
assert data(0x90a780, 8) == bytes.fromhex('48890de9e4d404c3')
assert 0x90a787 + struct.unpack('<i', data(0x90a783, 4))[0] == 0x5658c70
print('PASS verified thread-attachment publication and callback-setter negative control')
