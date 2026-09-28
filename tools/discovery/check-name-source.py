exec(open('local-data/crash-analysis/disassemble.py').read().split('lines=[];entries=[]')[0])
for ins in cs.disasm(read(0x7fffbf900000+0x977330,200),0x977330):print(hex(ins.address),ins.mnemonic,ins.op_str)
