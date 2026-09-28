from native import *
for rva,size in [(0x129833f0,0x500)]:
    path=root/f'result-accessor-{rva:x}.txt'
    path.write_text('\n'.join(f'{i.address:x}: {i.mnemonic} {i.op_str}' for i in cs.disasm(read(rva,size),rva)),encoding='utf8')
    print(path)
