exec(open('local-data/crash-analysis/disassemble.py').read().split('lines=[];entries=[]')[0])
for rva,size in [(0x961680,320),(0x961230,256),(0x9848c0,256),(0x96ccd0,128),(0x986410,400),(0x97fd70,100)]:
 print('\nFUNCTION',hex(rva))
 for ins in cs.disasm(read(0x7fffbf900000+rva,size),rva):
  print(hex(ins.address),ins.mnemonic,ins.op_str)
