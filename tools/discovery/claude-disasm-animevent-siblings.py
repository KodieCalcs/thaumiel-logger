# ConfigEntityAnimEvent attack-pattern entry points: prologues and the calls between them.
from native import *
targets = {0x168A12A0:'TriggerAttackPattern',0x168A1570:'HandleAttackPattern',0x168A1B10:'HandleAttackPatternList',0x168A3950:'HandleAttackPatternListWithOverrideParam',0x168A2B90:'HandleContinuousAttackPatternList'}
for rva,name in targets.items():
    end = starts[bisect.bisect_right(starts, rva)]
    raw = read(rva, min(end - rva, 0x1200))
    calls = []
    for ins in cs.disasm(raw, rva):
        if ins.mnemonic == 'call' and ins.op_str.startswith('0x'):
            t = int(ins.op_str, 16)
            if t in targets: calls.append(f'{ins.address:x}->{targets[t]}')
    print(f'{name:42s} @ {rva:#x} size<= {end-rva:#x} prologue {raw[:16].hex(" ")}')
    print('   calls to siblings:', calls or 'none')
