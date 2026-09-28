import json,struct,bisect,pathlib,mmap
from capstone import Cs,CS_ARCH_X86,CS_MODE_64
root=pathlib.Path('local-data/crash-analysis')
f=open(root/'GameAssembly.dll','rb');b=mmap.mmap(f.fileno(),0,access=mmap.ACCESS_READ)
u=lambda o:struct.unpack_from('<I',b,o)[0]
p=u(60);st=p+24+struct.unpack_from('<H',b,p+20)[0];sections=[]
for i in range(struct.unpack_from('<H',b,p+6)[0]):
 o=st+40*i;sections.append((u(o+12),u(o+16),u(o+20),b[o:o+8].rstrip(b'\0').decode(),u(o+36)))
methods={};cls=''
for row in (root/'il2cpp-v6.tsv').read_text(encoding='utf8').splitlines():
 x=row.split('\t')
 if x[0]=='CLASS':cls='.'.join(x[3:5])
 if x[0]=='METHOD' and x[3]=='RVA':methods.setdefault(int(x[4],16),[]).append((cls,x[1],int(x[2])))
starts=sorted(methods)
def owner(rva):
 i=bisect.bisect_right(starts,rva)-1
 return (hex(starts[i]),methods[starts[i]]) if i>=0 else None
def read(rva,n):
 for va,size,off,_,_ in sections:
  if va<=rva<va+size:return b[off+rva-va:off+rva-va+n]
 return b''
cs=Cs(CS_ARCH_X86,CS_MODE_64)
if __name__=='__main__':
 targets={0x17a282f0,0x1a4bfa90,0x1a4bff50,0x1a4bfa30,0x1a4bfa40,0x148284b0}
 for va,size,off,n,flags in sections:
  if not flags&0x20000000:continue
  pos=off
  while True:
   pos=b.find(b'\xe8',pos,off+size-4)
   if pos<0:break
   rva=va+pos-off;dst=rva+5+struct.unpack_from('<i',b,pos+1)[0]
   if dst in targets:print(hex(dst),hex(rva),owner(rva))
   pos+=1
