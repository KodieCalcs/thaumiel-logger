exec(open('local-data/crash-analysis/disassemble.py').read().split('lines=[];entries=[]')[0])
for rva in [0x977400,0x977500]:
 print('FUNCTION',hex(rva))
 for ins in cs.disasm(read(0x7fffbf900000+rva,300),rva):print(hex(ins.address),ins.mnemonic,ins.op_str)
