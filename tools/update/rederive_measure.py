"""The capture-measured part of a client update (`rederive.py measure <version> <battle folder>`).

Three values have no code witness and were read off the first capture each time:

  daze_requested  the result float equal to the Daze the hit asked for. The daze probe logs the
                  mixin's cur_before and target_value, so requested = target - cur_before; daze rows
                  join result rows by result pointer AND |elapsed_ms| <= 50 (pointers are pooled and
                  reused). Accepted when one offset matches >= 90% of joined rows and, against the
                  already-pinned applied field, only ever diverges with requested > applied (the
                  MaxStun clamp orders the pair).
  effect_fields   the result's effect-typed fields (ConfigHitEffect / ConfigEntityAttackEffect in
                  the dump) whose pointers name exactly one skill in hits.tsv's effect index, with
                  no ambiguous row: a shared pointer (3.3.4's +0x38) poisons attribution.
  HitNames.roles  which of the three name-object string slots is the ability name, the hit's
                  AttackProperty and the other (the triggering AttackProperty on anomaly ticks): the
                  ability slot holds no AttackProperty names; of the other two the busier is the hit's.
"""
import csv
import os
import struct
from collections import Counter, defaultdict

csv.field_size_limit(1 << 28)


def _probe_rows(battle, prefix):
    names = [f for f in os.listdir(battle) if f.startswith(prefix) and f.endswith('.tsv')]
    if not names:
        return None, []
    with open(os.path.join(battle, names[0]), newline='', encoding='utf-8', errors='replace') as f:
        first = f.readline()
        header = f.readline() if first.startswith('#') else first
        cols = header.rstrip('\r\n').split('\t')
        return cols, list(csv.DictReader(f, fieldnames=cols, delimiter='\t'))


def daze_requested(battle, damage_off, applied_off, dump_bytes):
    _c, res = _probe_rows(battle, 'damage-result-')
    _c, daze = _probe_rows(battle, 'damage-daze-')
    if not res or not daze:
        return None, 'no damage-result / damage-daze rows in this folder'
    by_ptr = defaultdict(list)
    for r in res:
        b = bytes.fromhex(r.get('result_hex') or '')
        if len(b) >= dump_bytes:
            by_ptr[r['result_ptr']].append((int(r['elapsed_ms']), b))
    hits, joined = Counter(), 0
    for d in daze:
        try:
            req = float(d['target_value']) - float(d['cur_before'])
        except (KeyError, ValueError):
            continue
        if req <= 0:
            continue
        cands = [b for t, b in by_ptr.get(d['result_ptr'], []) if abs(t - int(d['elapsed_ms'])) <= 50]
        if len(cands) != 1:
            continue
        joined += 1
        for off in range(0, dump_bytes - 4, 4):
            if off in (damage_off, applied_off):
                continue
            if abs(struct.unpack_from('<f', cands[0], off)[0] - req) <= max(0.01, req * 1e-4):
                hits[off] += 1
    if not joined:
        return None, 'no daze row joined a result row'
    ranked = hits.most_common(2)
    if not ranked or ranked[0][1] < 0.9 * joined or (len(ranked) > 1 and ranked[1][1] >= 0.9 * joined):
        return None, f'no single offset matches >= 90% of {joined} joined rows: {[(hex(o), n) for o, n in ranked]}'
    best = ranked[0][0]
    eq = above = below = 0
    for rows in by_ptr.values():
        for _t, b in rows:
            rq, ap = struct.unpack_from('<f', b, best)[0], struct.unpack_from('<f', b, applied_off)[0]
            if rq == 0 and ap == 0:
                continue
            if abs(rq - ap) <= 0.01:
                eq += 1
            elif rq > ap:
                above += 1
            else:
                below += 1
    note = (f'{hex(best)}: {ranked[0][1]}/{joined} joined rows; vs applied {hex(applied_off)} equal {eq}, '
            f'requested > applied {above}, requested < applied {below}')
    if below:
        return None, note + ' -- requested below applied is not the clamp signature'
    return best, note


def effect_fields(battle, candidates, dump_bytes, ability_slot=None):
    """Offsets whose pointers resolve skills with NO ambiguous row, over the rows attribution.mjs
    actually resolves by identity: Anomaly rows (ability Player_ElementAbnormalBuff, or tags led by
    Buff) are attributed by name first -- their effect pointers keep the triggering attack. Because
    attribution takes the UNION of ids across offsets, one ambiguous field makes every row it touches
    ambiguous, so a field is kept only when it is clean."""
    index = defaultdict(set)
    path = os.path.join(battle, 'hits.tsv')
    if not os.path.exists(path):
        return None, 'no hits.tsv in this folder'
    with open(path, newline='', encoding='utf-8', errors='replace') as f:
        for r in csv.DictReader(f, delimiter='\t'):
            sid = int(r.get('skillId') or 0)
            if sid <= 0:
                continue
            for field in ('attackEffect', 'groundHitEffect', 'downHitEffect', 'skyHitEffect'):
                v = r.get(field) or ''
                if v.startswith('0x'):
                    index[int(v, 16)].add(sid)
    _c, res = _probe_rows(battle, 'damage-result-')
    rows, skipped = [], 0
    for r in res or []:
        b = bytes.fromhex(r.get('result_hex') or '')
        if len(b) < dump_bytes:
            continue
        name = ''
        if ability_slot and int(r.get(ability_slot + '_length') or -1) > 0:
            name = bytes.fromhex(r[ability_slot + '_hex']).decode('utf-16le', 'replace')
        tags = (r.get('tags') or '').split('|')[0]
        if name == 'Player_ElementAbnormalBuff' or tags.endswith(':' + 'Buff'.encode('utf-16le').hex()):
            skipped += 1
            continue
        rows.append(b)
    keep, notes = [], []
    for off in sorted(candidates):
        uniq = amb = 0
        for b in rows:
            ids = index.get(struct.unpack_from('<Q', b, off)[0])
            if ids:
                uniq += len(ids) == 1
                amb += len(ids) > 1
        notes.append(f'{hex(off)} unique {uniq} ambiguous {amb}')
        if uniq and not amb:
            keep.append(off)
    return (keep or None), '; '.join(notes) + f' (of {len(rows)} rows; {skipped} Anomaly rows left out)'


def ability_column(battle, roles):
    cols, _res = _probe_rows(battle, 'damage-result-')
    slots = [c[:-len('_length')] for c in cols or [] if c.startswith('a8s') and c.endswith('_length')]
    return slots[roles['ability']] if roles and len(slots) == 3 else None


def hitnames_roles(battle):
    cols, res = _probe_rows(battle, 'damage-result-')
    slots = [c[:-len('_length')] for c in cols or [] if c.startswith('a8s') and c.endswith('_length')]
    if len(slots) != 3:
        return None, f'expected three a8 string slots, found {slots}'
    stats = []
    for c in slots:
        vals = [bytes.fromhex(r[c + '_hex']).decode('utf-16le', 'replace') for r in res if int(r.get(c + '_length') or -1) > 0]
        ap = sum('attackproperty' in v.lower() for v in vals)
        stats.append((len(vals), ap))
    ability = [i for i, (n, ap) in enumerate(stats) if n and ap <= 0.02 * n]
    note = ', '.join(f'{c}: {n} names, {ap} AttackProperty' for c, (n, ap) in zip(slots, stats))
    if len(ability) != 1:
        return None, note + ' -- not exactly one slot free of AttackProperty names'
    rest = sorted((i for i in range(3) if i != ability[0]), key=lambda i: -stats[i][0])
    if stats[rest[0]][0] < 5 * max(1, stats[rest[1]][0]):
        return None, note + ' -- the two AttackProperty slots are not clearly apart'
    return {'ability': ability[0], 'attack_property': rest[0], 'other': rest[1]}, note
