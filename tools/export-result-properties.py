"""Decode schema-2 capture into a per-result CSV, preserving raw modifier names.

Usage: python export-result-properties.py CAPTURE_DIRECTORY
Requires review-result-capture.py to have validated and written result-event-join.csv.
No ability attribution or full-stat interpretation is inferred from modifier names.
"""
import collections,csv,json,math,pathlib,struct,sys

def decode_properties(row):
    raw=bytes.fromhex(row['entries60_hex'])
    capacity=int(row['entries60_capacity']);size=int(row['entries60_bytes'])
    if size!=len(raw) or size%24 or capacity>1048576 or size!=min(capacity,128)*24:
        raise ValueError('Unreadable, malformed, or partial dictionary entries')
    values={};seen=set()
    for encoded in row['keys60'].split('|'):
        if not encoded:continue
        index,length,size,hextext=encoded.split(':');index,length,size=map(int,(index,length,size))
        if index in seen or index<0 or index>=len(raw)//24:raise ValueError('Invalid/duplicate dictionary slot')
        seen.add(index)
        text=bytes.fromhex(hextext)
        if length<0 or size!=len(text) or size!=length*2:raise ValueError('Unreadable or truncated dictionary key')
        hashcode=struct.unpack_from('<i',raw,index*24)[0]
        keyptr=struct.unpack_from('<Q',raw,index*24+8)[0]
        if hashcode<0 or not keyptr:raise ValueError('Inactive slot has a key snapshot')
        name=text.decode('utf-16le')
        if name in values:raise ValueError('Duplicate dictionary key')
        value=struct.unpack_from('<f',raw,index*24+16)[0]
        if not math.isfinite(value):raise ValueError('Nonfinite modifier value')
        values[name]=value
    active={i for i in range(len(raw)//24) if struct.unpack_from('<i',raw,i*24)[0]>=0 and struct.unpack_from('<Q',raw,i*24+8)[0]}
    if active!=seen:raise ValueError('Active dictionary slot missing key snapshot')
    return values,capacity>128

def main(root):
    with next(root.glob('damage-result-*.tsv')).open(encoding='utf-8-sig') as f:
        rows=list(csv.DictReader((l for l in f if not l.startswith('#')),delimiter='\t'))
    with (root/'result-event-join.csv').open(encoding='utf8') as f:
        joins={r['result_sequence']:r for r in csv.DictReader(f)}
    if len(joins)!=len(rows):raise ValueError('Missing result/event joins')
    decoded=[];stats=collections.defaultdict(list);truncated=0
    for r in rows:
        join=joins[r['sequence']]
        if join['validated']!='True':raise ValueError('Result/event comparison not validated')
        props,cut=decode_properties(r);truncated+=cut
        geometry=bytes.fromhex(r['geometryb0_hex'])
        out=dict(sequence=r['sequence'],elapsed_ms=r['elapsed_ms'],attacker_entity=join['attacker'],
            damage_unrounded=join['damage'],damage_ceil=math.ceil(float(join['damage'])),
            crit_enum=join['crit'],element_enum=join['element'],special_enum=join['special'],
            geometry_u32_18=struct.unpack_from('<I',geometry,0x18)[0] if len(geometry)>=0x1c else '',
            ability_id='',dictionary_truncated=cut)
        out.update(props);decoded.append(out)
        for k,v in props.items():stats[k].append(v)
    columns=list(decoded[0])[:11]+sorted(stats)
    with (root/'combat-results.csv').open('w',newline='',encoding='utf8') as f:
        w=csv.DictWriter(f,fieldnames=columns);w.writeheader();w.writerows(decoded)
    summary=dict(rows=len(rows),dictionary_truncated_rows=truncated,distinct_keys=len(stats),
        properties={k:dict(rows=len(v),minimum=min(v),maximum=max(v)) for k,v in sorted(stats.items())},
        interpretation='Raw named modifiers; absent values are blank, not zero. Ability unknown. Geometry ID semantics unknown.')
    (root/'properties-review.json').write_text(json.dumps(summary,indent=2)+'\n',encoding='utf8')
    print(json.dumps(summary,indent=2))

if __name__=='__main__':main(pathlib.Path(sys.argv[1]))
