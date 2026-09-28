import struct,json,pathlib
from capstone import Cs,CS_ARCH_X86,CS_MODE_64
b=pathlib.Path('local-data/crash-analysis/ZenlessZoneZeroBeta.exe.15728.dmp').read_bytes()
u=lambda o:struct.unpack_from('<I',b,o)[0]
q=lambda o:struct.unpack_from('<Q',b,o)[0]
s={u(u(12)+12*i):u(u(12)+12*i+8) for i in range(u(8))}
ranges=[]
if 5 in s:
 for i in range(u(s[5])):
  o=s[5]+4+16*i;ranges.append((q(o),u(o+8),u(o+12)))
if 9 in s:
 o=s[9];r=q(o+8)
 for i in range(q(o)):
  a,n=q(o+16+i*16),q(o+24+i*16);ranges.append((a,n,r));r+=n
def read(a,n):
 for base,size,off in ranges:
  if base<=a and a+n<=base+size:return b[off+a-base:off+a-base+n]
 return b''
disk=pathlib.Path('local-data/crash-analysis/GameAssembly-first14MB.dll').read_bytes()
p=struct.unpack_from('<I',disk,60)[0];sec=p+24+struct.unpack_from('<H',disk,p+20)[0];sections=[]
for i in range(struct.unpack_from('<H',disk,p+6)[0]):
 o=sec+40*i;v,n,r=struct.unpack_from('<III',disk,o+12);sections.append((v,n,r))
oldread=read
def read(a,n):
 result=oldread(a,n)
 if result:return result
 v=a-0x7fffbf900000
 for base,size,off in sections:
  if base<=v and v+n<=base+size and off+v-base+n<=len(disk):return disk[off+v-base:off+v-base+n]
 return b''
cs=Cs(CS_ARCH_X86,CS_MODE_64)
lines=[];entries=[]
for i in range(194):
 raw=read(0x7ff8b2dc0000+0x1f96648+i*8,8)
 if not raw:break
 a=struct.unpack('<Q',raw)[0];entries.append(a-0x7fffbf900000)
 lines.append(f'INDEX {i} RVA {a-0x7fffbf900000:x}')
 for j,ins in enumerate(cs.disasm(read(a,96),a)):
  lines.append(f'{ins.address-0x7fffbf900000:x}: {ins.mnemonic} {ins.op_str}')
  if ins.mnemonic in ('ret','jmp') or j>=16:break
pathlib.Path('local-data/crash-analysis/api-disassembly.txt').write_text('\n'.join(lines))
pathlib.Path('local-data/crash-analysis/api-rvas.json').write_text(json.dumps(entries))
print('Saved',len(entries),'entries')
