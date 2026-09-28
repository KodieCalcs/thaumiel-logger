from native import *

for rva, size in [(0x1823A830, 0x1500)]:
    lines = [f'FUNCTION/RANGE {hex(rva)} {owner(rva)}']
    for ins in cs.disasm(read(rva, size), rva):
        lines.append(f'{ins.address:x}: {ins.mnemonic} {ins.op_str}')
    path = root / f'enqueue-publisher-{rva:x}.txt'
    path.write_text('\n'.join(lines), encoding='utf8')
    print(path, len(lines))
    print('fingerprint', ','.join(f'0x{x:02x}' for x in read(rva,64)))

dump = pathlib.Path('local-data/damage-probe-captures/20260912-122246/il2cpp-v7.tsv')
out = []
keep = False
with dump.open(encoding='utf8') as f:
    for line in f:
        if line.startswith('CLASS\t'):
            keep = line.split('\t')[4] == 'CGMHCDLDPOH'
        if keep:
            out.append(line)
(root / 'enqueue-publisher-metadata.tsv').write_text(''.join(out), encoding='utf8')
