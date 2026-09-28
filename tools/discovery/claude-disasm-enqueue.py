# FHJJBJLAPCN::JJDHHPGOMMD(AGLNJHOEMAL&) at 0x142ACFF0 -- the damage-display event enqueue.
from native import *
rva = 0x142ACFF0
end = starts[bisect.bisect_right(starts, rva)]
raw = read(rva, min(end - rva, 0x300))
print('first 64 bytes:', ','.join('0x%02x' % x for x in raw[:64]))
lines = [f'FUNCTION {hex(rva)} {owner(rva)} size<= {end-rva:#x}']
for ins in cs.disasm(raw, rva):
    lines.append(f'{ins.address:x}: {ins.mnemonic} {ins.op_str}')
(root / 'damage-probe-fn-142acff0.txt').write_text('\n'.join(lines), encoding='utf8')
print('\n'.join(lines[:30]))
