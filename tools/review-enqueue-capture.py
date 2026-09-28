"""Archive-side checks, no client access. Usage: python review-enqueue-capture.py DIRECTORY"""
import csv, collections, json, math, pathlib, sys
root = pathlib.Path(sys.argv[1])
def rows(pattern):
    with next(root.glob(pattern)).open(encoding='utf-8-sig') as f:
        return list(csv.DictReader((l for l in f if not l.startswith('#')), delimiter='\t'))
enqueue, event = rows('damage-enqueue-*.tsv'), rows('damage-event-*.tsv')
def key(row):
    return tuple(row[f'ev_mem{i}'] for i in range(14))
qc, ec = map(lambda rs: collections.Counter(map(key, rs)), (enqueue, event))
unshown = qc-ec
extras = [r for r in enqueue if key(r) in unshown]
report = dict(enqueue_rows=len(enqueue), event_rows=len(event),
              enqueue_callers=dict(collections.Counter(r['caller_rva'] for r in enqueue)),
              event_missing_from_enqueue=sum((ec-qc).values()), enqueue_not_displayed=sum(unshown.values()),
              unshown_damage_values=sorted(set(r['f32_44'] for r in extras)),
              enqueue_short_snapshots=sum(int(r['event_bytes'])!=112 for r in enqueue),
              enqueue_max_skipped=max(int(r['skipped']) for r in enqueue))

def varint(b, p):
    value=shift=0
    while True:
        c=b[p];p+=1;value|=(c&127)<<shift
        if c<128:return value,p
        shift+=7
        if shift>70:raise ValueError('bad varint')
def parse(b):
    out=collections.defaultdict(list);p=0
    while p<len(b):
        tag,p=varint(b,p);field,wire=tag>>3,tag&7
        if wire==0:value,p=varint(b,p)
        elif wire==2:
            size,p=varint(b,p);value=b[p:p+size];p+=size
        elif wire in (1,5):
            size=8 if wire==1 else 4;value=b[p:p+size];p+=size
        else:raise ValueError('unsupported wire')
        out[field].append(value)
    return out
reports=list(root.glob('endbattle_*.pb'))
if len(reports)!=1:raise ValueError('archive must contain exactly one settlement')
top=parse(reports[0].read_bytes())
avatars=parse(parse(top[8][0])[6][0])[7]
report['settlement_direct_checks']=[]
for raw in avatars:
    av=parse(raw);aid=av[1][0]
    direct=[r for r in event if int(r['i32_74'])//1000==aid and int(r['special_60'])==0]
    total=sum(math.ceil(float(r['f32_44'])) for r in direct)
    expected=av.get(25,[0])[0]
    report['settlement_direct_checks'].append(dict(avatar=aid,rows=len(direct),event_ceil_sum=total,settlement=expected,match=total==expected))
text=json.dumps(report,indent=2)
(root/'capture-review.json').write_text(text+'\n',encoding='utf8');print(text)
