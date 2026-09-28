"""Validate event/timescale hook pins and all active damage-probe fingerprints offline.

THAUMIEL_LOCAL_DATA=<archive-root> python tools/update/check_capture_pins.py
Run check_pins.py 3.3.3 separately for the 25 statelog pins.
"""
import re, struct
from pathlib import Path
from capstone import Cs, CS_ARCH_X86, CS_MODE_64
from dumpq import load
from paths import game_assembly

root=Path(__file__).resolve().parents[2]
blob=Path(game_assembly('3.3.3')).read_bytes()
pe=struct.unpack_from('<I',blob,0x3c)[0]
timestamp=struct.unpack_from('<I',blob,pe+8)[0]
size=struct.unpack_from('<I',blob,pe+0x50)[0]
n=struct.unpack_from('<H',blob,pe+6)[0]; opt=struct.unpack_from('<H',blob,pe+20)[0]
sections=[struct.unpack_from('<IIII',blob,pe+24+opt+40*i+8) for i in range(n)]
classes=load('3.3.3'); md=Cs(CS_ARCH_X86,CS_MODE_64)
def cls(name):
    found=[c for c in classes if c['name']==name]
    assert len(found)==1,(name,len(found))
    return found[0]
def data(rva,count):
    for vs,va,rs,ro in sections:
        if va<=rva<va+max(vs,rs): return blob[ro+rva-va:ro+rva-va+count]
    raise AssertionError(hex(rva))
def scalar(text,name): return int(re.search(r'const '+name+r'(?:\s*:\s*\w+)?\s*=\s*(0x[\da-fA-F]+)',text)[1],16)
def prologue(text,rva):
    raw=re.search(r'const expected_prologue.*?\{(.*?)\}',text,re.S)[1]
    b=bytes(int(x,16) for x in re.findall(r'0x([\da-fA-F]{2})\b',raw))
    assert data(rva,len(b))==b,'prologue mismatch'
    ins=list(md.disasm(b,rva))
    assert sum(i.size for i in ins)==len(b),'split instruction'
    assert all('rip' not in i.op_str and not i.mnemonic.startswith(('j','call','ret')) for i in ins),'non-relocatable prologue'

t=(root/'src/timescalelog.zig').read_text()
c=cls(re.search(r'const class_name = "([^"]+)"',t)[1]); r=scalar(t,'expected_update_rva')
assert [(p,rva) for name,p,rva in c['methods'] if name=='Update']==[(1,r)]
prologue(t,r)
fields=re.findall(r'const (f_\w+): Field = \.\{ \.name = "([^"]+)", \.offset = (0x[\da-fA-F]+)',t)
assert len(fields)==7
for pin,name,off in fields: assert [(o) for fn,o in c['fields'] if fn==name]==[int(off,16)],pin
print('PASS timescale: method, seven named field offsets, whole relocatable prologue')

t=(root/'src/eventlog.zig').read_text(); r=scalar(t,'drain_rva')
assert timestamp==scalar(t,'expected_timestamp') and size==scalar(t,'expected_size_of_image')
assert [(p,rva) for name,p,rva in cls('DIDDGLDPGMD')['methods'] if name=='LKMGABPFJBM']==[(1,r)]
prologue(t,r)
ins=list(md.disasm(data(r,0x220),r))
assert any(i.mnemonic=='mov' and i.op_str==f'rdi, qword ptr [rsi + {hex(scalar(t,"component_queue"))}]' for i in ins)
assert any(i.mnemonic=='mov' and i.op_str==f'rdx, qword ptr [r8 + {hex(scalar(t,"component_owner"))}]' for i in ins)
print('PASS eventlog: client identity, method, queue/owner read instructions, whole relocatable prologue')

for file,label,rva in [('damage_result.c','result',0x1a495bf0),('damage_snapshot.c','snapshot',0x1b64a750),('damage_daze.c','daze',0x136ae770),('damage_anomaly.c','anomaly',0x1962ec60)]:
    t=(root/'src'/file).read_text()
    raw=re.search(label+r'_fingerprint\[64\] = \{(.*?)\}',t,re.S)[1]
    b=bytes(int(x,16) for x in re.findall(r'0x([\da-fA-F]{2})\b',raw))
    assert len(b)==64 and b==data(rva,64),file
    assert f'client=CNBetaWin3.3.3 target_rva={hex(rva)}' in t,file
    print('PASS',label,'64-byte fingerprint and versioned header')
print('All active capture pin checks passed; live hook installation still requires a client launch.')
