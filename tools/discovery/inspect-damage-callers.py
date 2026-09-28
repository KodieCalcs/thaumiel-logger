# Saved-binary analysis for the first live damage probe. Do not infer function
# owners from arbitrary nearest RVAs across gaps: these targets have exact entries.
from native import *
for rva in [0x14832350, 0x14831910, 0x14830170, 0x1482F330, 0x148284B0]:
    end = starts[bisect.bisect_right(starts, rva)]
    lines = [f'FUNCTION {hex(rva)} {owner(rva)}']
    for ins in cs.disasm(read(rva, end-rva), rva):
        lines.append(f'{ins.address:x}: {ins.mnemonic} {ins.op_str}')
    path = root / f'damage-probe-fn-{rva:x}.txt'
    path.write_text('\n'.join(lines), encoding='utf8')
    print(path, len(lines), 'instructions/heading')
