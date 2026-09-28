"""Check typed result against enqueue without guessing a time-based ability join."""
import collections,csv,json,pathlib,struct,sys
root=pathlib.Path(sys.argv[1])
def rows(pattern):
    with next(root.glob(pattern)).open(encoding='utf-8-sig') as f:
        return list(csv.DictReader((l for l in f if not l.startswith('#')),delimiter='\t'))
rs,qs=rows('damage-result-*.tsv'),rows('damage-enqueue-*.tsv')
pending=collections.defaultdict(collections.deque)
for r in rs:pending[(r['thread'],int(r['output_event_ptr'],16))].append(r)
matches=[];errors=[]
for q in qs:
    k=(q['thread'],int(q['event_ptr'],16))
    if not pending[k]:errors.append({'enqueue':q['sequence'],'reason':'no result'});continue
    r=pending[k].popleft(); b=bytes.fromhex(r['result_hex'])
    dmg=struct.unpack_from('<f',b,0x138)[0];crit=struct.unpack_from('<I',b,0x200)[0]
    # TSV uses %.9g for float: round-trip as float32, not double equality.
    qdmg=struct.unpack('<f',struct.pack('<f',float(q['f32_44'])))[0]
    dt=int(q['elapsed_ms'])-int(r['elapsed_ms'])
    valid=dmg==qdmg and crit==int(q['u32_48']) and 0<=dt<=100
    if not valid:errors.append({'result':r['sequence'],'enqueue':q['sequence'],'damage':dmg,'event':qdmg,'dt':dt})
    matches.append(dict(result_sequence=r['sequence'],enqueue_sequence=q['sequence'],elapsed_ms=r['elapsed_ms'],delay_ms=dt,
        attacker=q['u32_14'],damage=dmg,crit=crit,element=q['element_50'],special=q['special_60'],validated=valid))
report=dict(result_rows=len(rs),enqueue_rows=len(qs),paired=len(matches),unmatched_results=sum(map(len,pending.values())),errors=errors,
    bytes=dict(collections.Counter(r['result_bytes'] for r in rs)),max_skipped=max(int(r['skipped']) for r in rs),
    max_delay_ms=max(x['delay_ms'] for x in matches),
    strings={k:dict(collections.Counter(bytes.fromhex(r[k+'_hex']).decode('utf-16le') for r in rs)) for k in ['s10','s40','s58','s70','sa0','sc0']})
(root/'result-review.json').write_text(json.dumps(report,indent=2)+'\n',encoding='utf8')
with (root/'result-event-join.csv').open('w',newline='',encoding='utf8') as f:
    w=csv.DictWriter(f,fieldnames=list(matches[0]));w.writeheader();w.writerows(matches)
print(json.dumps(report,indent=2))
