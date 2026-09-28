exec(open('local-data/crash-analysis/disassemble.py').read().split('lines=[];entries=[]')[0])
for rva,size in [(0x8fcca0,224),(0x977500,128),(0x977400,128)]:
 print('\nFUNCTION',hex(rva))
 for ins in cs.disasm(read(0x7fffbf900000+rva,size),rva):print(hex(ins.address),ins.mnemonic,ins.op_str)
