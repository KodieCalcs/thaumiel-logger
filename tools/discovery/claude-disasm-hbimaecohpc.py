# Disassemble UIInLevelDamageTextContainerChildWindowController::HBIMAECOHPC (0x1482D830) from the
# saved CNBetaWin3.3.0 binary: prologue bytes for the hook, and how it uses its arguments.
from native import *
rva = 0x1482D830
end = starts[bisect.bisect_right(starts, rva)]
raw = read(rva, min(end - rva, 0x900))
print('first 32 bytes:', raw[:32].hex(' '))
lines = [f'FUNCTION {hex(rva)} {owner(rva)} size<= {end-rva:#x}']
for ins in cs.disasm(raw, rva):
    lines.append(f'{ins.address:x}: {ins.mnemonic} {ins.op_str}')
(root / 'damage-probe-fn-1482d830.txt').write_text('\n'.join(lines), encoding='utf8')
print('\n'.join(lines[:40]))
