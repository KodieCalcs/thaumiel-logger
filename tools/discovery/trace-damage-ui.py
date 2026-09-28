from native import *
for rva in [0x1482c410,0x1482d340,0x1482d390,0x1482d7d0,0x1482efd0,0x1482a530]:
 lines=[f'FUNCTION {hex(rva)} {owner(rva)}']
 end=starts[bisect.bisect_right(starts,rva)]
 for ins in cs.disasm(read(rva,min(end-rva,1600)),rva):
  text=f'{ins.address:x}: {ins.mnemonic} {ins.op_str}'
  if ins.mnemonic in ('call','jmp') and ins.op_str.startswith('0x'):text+=' '+str(owner(int(ins.op_str,16)))
  lines.append(text)
 (root/f'fn-{rva:x}.txt').write_text('\n'.join(lines),encoding='utf8')
 print('\n'.join(lines[:24]))
