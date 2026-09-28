import pathlib
dump = pathlib.Path('local-data/damage-probe-captures/20260912-122246/il2cpp-v7.tsv')
targets = {'KFANJOAHIOH', 'CMCIBGLJJCO', 'CJPACFEILFL', 'LBCELJNJAIK', 'BAKHIFHCNPO', 'KLHIEGCFDIE', 'NPHMDLKBCDH'}
blocks = []
block = []
def save(block):
    if block and block[0].startswith('CLASS\t') and (block[0].split('\t')[4] in targets or any('\t0x1823A830' in l for l in block)):
        blocks.extend(block)
with dump.open(encoding='utf8') as f:
    for line in f:
        if line.startswith('CLASS\t'):
            save(block)
            block = []
        block.append(line)
save(block)
pathlib.Path('local-data/crash-analysis/hit-types.tsv').write_text(''.join(blocks), encoding='utf8')
