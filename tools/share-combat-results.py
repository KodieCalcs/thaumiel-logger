"""Presentation-only export of the verified capture. No timing-based skill guesses."""
import csv,pathlib,sys
LABELS={
'Actor_AddedBreakStunRatio':('Impact modifier','percent'),
'Actor_AddedDamageRatio':('DMG modifier','percent'),
'Actor_AddedDamageRatio_Elec':('Electric DMG modifier','percent'),
'Actor_AddedElementAccumulationRatio':('Anomaly buildup modifier','percent'),
'Actor_Backstab':('Backstab','flag'),
'Actor_BuffCriticalDamageRatioDelta':('Buff CRIT DMG modifier','percent'),
'Actor_BuffCriticalDelta':('Buff CRIT Rate modifier','percent'),
'Actor_BuffDamageRatio':('Buff DMG modifier','percent'),
'Actor_CanTriggerElementAbnormal':('Can trigger Anomaly','flag'),
'Actor_CatalyzeDamageDelta':('Catalyze flat modifier (meaning unverified)','number'),
'Actor_CatalyzeDamagePercentage':('Catalyze percentage (meaning unverified)','percent'),
'Actor_CatalyzeDamageRatio':('Catalyze ratio (meaning unverified)','percent'),
'Actor_CriticalDamageRatioDelta':('CRIT DMG modifier','percent'),
'Actor_CriticalDelta':('CRIT Rate modifier','percent'),
'Actor_DisorderDamageDelta':('Disorder flat DMG modifier','number'),
'Actor_DisorderDamagePercentage':('Disorder DMG percentage','percent'),
'Actor_DisorderDamageRatio':('Disorder DMG ratio','percent'),
'Actor_ElementAbnormalPowerDelta':('Anomaly Proficiency modifier','number'),
'Actor_ElementMysteryDelta':('Anomaly Mastery modifier','number'),
'Actor_FinalDamageRatio':('Final DMG modifier','percent'),
'Actor_IsCauseStun':('Stun flag','rawflag'),
'Actor_IsHeavyAttack':('Heavy attack','flag'),
}
ACTORS={'5':'Grace','6':'Velina','7':'Rina','9':'Bangboo (name unknown)',
        '19':'Rina summon','21':'Rina summon','107':'Summon (owner unverified)'}
ELEMENTS={'200':'Physical','203':'Electric','204':'Wind'}
def short(value):return f'{value:.2f}'.rstrip('0').rstrip('.')
def main(root):
    with (root/'combat-results.csv').open(encoding='utf8') as f:source=list(csv.DictReader(f))
    first=int(source[0]['elapsed_ms']);out=[]
    for r in source:
        modifiers=[]
        for raw,(name,kind) in LABELS.items():
            if r.get(raw,'')=='':continue
            value=float(r[raw])
            if value==0:continue # Presentation only; raw export retains zeros and absent values.
            if kind=='flag' and value==1:modifiers.append(name)
            elif kind=='percent':modifiers.append(f'{name} {chr(43) if value>0 else chr(45)}{short(abs(value)*100)}%')
            elif kind=='rawflag':modifiers.append(f'{name} {short(value)} (meaning unverified)')
            else:modifiers.append(f'{name} {"+" if value>0 else ""}{short(value)}')
        notes=[]
        if r['special_enum']!='0':notes.append('Special damage; exact effect unverified')
        if int(r['damage_ceil'])==0:notes.append('Zero-damage record')
        out.append({'Hit':r['sequence'],'Time (s)':f"{(int(r['elapsed_ms'])-first)/1000:.3f}",
            'Source':ACTORS.get(r['attacker_entity'],'Unknown source'),
            'Attribute':ELEMENTS.get(r['element_enum'],'Unknown'),
            'Damage':r['damage_ceil'],'Critical hit':{'0':'No','2':'Yes'}.get(r['crit_enum'],'Unknown'),
            'Attack / effect':'Unknown','Modifiers':'; '.join(modifiers),'Notes':'; '.join(notes)})
    with (root/'combat-log-share.csv').open('w',newline='',encoding='utf-8-sig') as f:
        w=csv.DictWriter(f,fieldnames=list(out[0]));w.writeheader();w.writerows(out)
    assert len(out)==len(source)
    assert sum(int(r['Damage']) for r in out)==sum(int(r['damage_ceil']) for r in source)
    with (root/'combat-log-column-guide.csv').open('w',newline='',encoding='utf-8-sig') as f:
        w=csv.writer(f);w.writerow(['Readable name','Original field','Display format'])
        for raw,(name,kind) in LABELS.items():w.writerow([name,raw,kind])
    (root/'combat-log-share-notes.txt').write_text(
        'Shareable combat capture â€” 12 September 2026\n\n'
        '220 records retained, including 49 zero-damage records. Damage is the game-verified\n'
        'per-hit ceiling, kept as a full integer. Time is seconds since the first recorded hit.\n'
        'Modifiers use at most two decimals; ratios are percentages. Zero-valued modifiers are\n'
        'omitted for readability. The raw export retains zero versus absent distinctions.\n'
        'Modifiers are not total character stats. Attack/effect names, the Bangboo species and\n'
        'one summon owner are unresolved and explicitly marked. No skill names were inferred\n'
        'from nearby animation timestamps. Stun flag -1/1 semantics remain unverified.\n'
        'Name translations: ElementMystery = Anomaly Mastery; ElementAbnormalPower = Anomaly\n'
        'Proficiency; BreakStun = Impact (repository battle-report reference). The column guide\n'
        'preserves the exact source keys for every translated modifier.\n',encoding='utf8')
    print(f'Exported {len(out)} rows; integer damage total preserved: {sum(int(r["Damage"]) for r in out):,}')
    for r in out[:3]:print(r)
if __name__=='__main__':main(pathlib.Path(sys.argv[1]))
