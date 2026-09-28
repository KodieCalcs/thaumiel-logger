"""Seed the stable-name pins manifests (tools/update/pins/<version>.json) from the committed pins.

    py tools/update/seed_pins.py [3.3.3 3.3.4 ...]      (default: every version below)

One-time bootstrap for rederive.py. It reads the pre-refactor sources from commits of the private
development history, so it only runs there; the pins/*.json it wrote are committed and are all a
client update needs.
The tables below are transcribed from the committed sources of each build (thaumiel branch 3.3.3 at
b98db0a, branch 3.3.4 at aa31561, sheet-webapp tools/client-build-constants.mjs) and keyed by
STABLE names. Obfuscated class, method and field names are never typed here: they are read out of
that build's dump at the pinned RVA or offset, and anything that does not resolve uniquely fails the
seed. Later manifests are written by rederive.py, not by this file.

Field `rule` records how that build's committed value was established, so a replay can tell a tool
bug from a value that was never code-derived:
  code          aligned witness rows on the object's register
  type_unique   the only field of its (mapped) type in the class
  elimination   the only remaining field of its type once the others were code-pinned
  positional    sorted position among fields of one type (a judgment call, always reviewed)
  measured      from a capture, not from code (the `measure` stage's job)
  unchanged     byte-identical read in an aligned witness
"""
import json
import re
import subprocess
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from rederive_image import Image  # noqa: E402
from rederive_runtime import parse_readiness, parse_zon  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
PINS = os.path.join(HERE, 'pins')

# --- classes: stable name -> {version: obfuscated or real name (None = no dump class known)} -------
CLASSES = {
    'PropertyTable':        {'3.3.3': 'CCMIHBAGMNI', '3.3.4': 'IHNAJAGFLDC'},
    'PropertyNotifier':     {'3.3.3': 'MJMFEDHPCNM', '3.3.4': 'JEKJGCLPBMC'},
    'ModifierInstance':     {'3.3.3': 'KGPNKBLEBBE', '3.3.4': 'JIBFNGPOOJJ'},
    'ModifierConfig':       {'3.3.3': 'PJBPHJHEABN', '3.3.4': 'DMJBGLLLJOI'},
    'StunMixin':            {'3.3.3': 'CDANMPBMFIJ', '3.3.4': 'FLDOPGOJDOP'},
    'EntityWrapper':        {'3.3.3': 'NHLMGBOONKB', '3.3.4': 'CAJPNCGFJEG'},
    'TimeScaleManager':     {'3.3.3': 'PGHCHDNHLNH', '3.3.4': 'FEIGLFFGABJ'},
    'AnimEventSystem':      {'3.3.3': 'DIDDGLDPGMD', '3.3.4': 'ODOHDPHKFIC'},
    # the drain's static argument (3.3.3 eventlog.zig: `DIDDGLDPGMD::LKMGABPFJBM(CFDKCDCGKAG*)`);
    # 3.3.4's sources do not name it, so the 3.3.4 answer key leaves it null
    'AnimEventComponent':   {'3.3.3': 'CFDKCDCGKAG', '3.3.4': None},
    'DamageTextController': {'3.3.3': 'UIInLevelDamageTextContainerChildWindowController',
                             '3.3.4': 'UIInLevelDamageTextContainerChildWindowController'},
    'ResultConverter':      {'3.3.3': 'NJCELHGICGI', '3.3.4': 'OLIFMMEBMGL'},
    'ResultFactory':        {'3.3.3': 'GFNGNPNAJHE', '3.3.4': 'ONBKKHGOGDE'},
    'DamageResult':         {'3.3.3': 'KJDILJALAJA', '3.3.4': 'HAJJIAGHAFN'},
    'AnomalyGauge':         {'3.3.3': 'GJCMIEECHCL', '3.3.4': 'HEECCHMMMHJ'},
    # 3.3.3 names from the probe comments; 3.3.4's sources name neither (answer key null)
    'AnomalyHitEvent':      {'3.3.3': 'HEKCAINABCC', '3.3.4': None},
    'HitNames':             {'3.3.3': 'KAMFFCFIJLK', '3.3.4': 'HMKMLBCLJAH'},
    'HitContext':           {'3.3.3': 'FBIHGGIOCMM', '3.3.4': None},
    # The factory's rcx object. damage_snapshot.c names KJFAPLPNFON for 3.3.3, which is not in the
    # 3.3.3 dump: code evidence only.
    'AttackSnapshot':       {'3.3.3': None, '3.3.4': None},
    # sheet-webapp tools/client-build-constants.mjs (named by the namer's event-class-map).
    'AudioEffectEvent':     {'3.3.3': 'DIHHICLKNFN', '3.3.4': 'HMHFPKAALAP'},
    'AnimEventHandlerEvent': {'3.3.3': 'MHCIEODABCK', '3.3.4': 'PCJHIABICAM'},
}

# How each class name was established, when not by a structural code match.
CLASS_RULES = {'AudioEffectEvent': 'measured', 'AnimEventHandlerEvent': 'measured'}

# --- methods: stable name -> ({version: RVA}, meta) ------------------------------------------------
# meta: hook = 'prologue' (the Zig trampolines compare `prologue` bytes) or 'fingerprint' (the C
# probes compare 64 bytes) or None (witness only); regs = per version, which registers hold which
# stable class for the whole function, or a register loaded from a field / an operand; used_by =
# where the RVA lands.
S = 'src/statelog.zig'
METHODS = {
    'PropertyTable.set': ({'3.3.3': 0x198DE980, '3.3.4': 0x18D640A0},
        dict(hook='prologue', prologue_len=12, used_by=[S + ':t_property_set'],
             # an identical 54-instruction sibling exists in both builds; 173 vs 9 direct callers,
             # and the stun mixin's property caller calls only the real one
             disambiguate={'by': 'callers', 'called_by': 'StunMixin.property_caller'})),
    'PropertyNotifier.notify': ({'3.3.3': 0x169FCB00, '3.3.4': 0x19DB2600},
        dict(hook='prologue', prologue_len=12, used_by=[S + ':t_property_notify'])),
    'ModifierInstance.init': ({'3.3.3': 0x1721C080, '3.3.4': 0x14F6EB30},
        dict(hook='prologue', prologue_len=19, used_by=[S + ':t_modifier_init'],
             regs={'3.3.3': {'ModifierInstance': ['rdi']}})),
    'ModifierInstance.attach': ({'3.3.3': 0x1721EAA0, '3.3.4': 0x14F70230},
        dict(hook='prologue', prologue_len=10, used_by=[S + ':t_modifier_attach'],
             regs={'3.3.3': {'ModifierInstance': ['rsi']}})),
    'ModifierInstance.detach': ({'3.3.3': 0x1721D4D0, '3.3.4': 0x14F6D980},
        dict(hook='prologue', prologue_len=8, used_by=[S + ':t_modifier_detach'],
             regs={'3.3.3': {'ModifierInstance': ['rsi']}})),
    'ModifierInstance.to_string': ({'3.3.3': 0x1721B2E0, '3.3.4': 0x14F6B2E0},
        dict(regs={'3.3.3': {'ModifierInstance': ['rdi'],
                             'ModifierConfig': [{'reg': 'rax', 'from_field': 'ModifierInstance.config'}]}})),
    'ModifierConfig.parse_binary': ({'3.3.3': 0x1ADD5960, '3.3.4': 0x19328070},
        dict(regs={'3.3.3': {'ModifierConfig': ['rsi']}})),
    'ModifierConfig.stacking_getter': ({'3.3.3': 0x1ADE1AC0, '3.3.4': 0x193BCC90},
        dict(regs={'3.3.3': {'ModifierConfig': ['rsi']}})),
    'StunMixin.enter': ({'3.3.3': 0x136AA5C0, '3.3.4': 0x15F876B0},
        dict(hook='prologue', prologue_len=13, used_by=[S + ':t_stun_enter'],
             regs={'3.3.3': {'StunMixin': ['rsi']}})),
    'StunMixin.update': ({'3.3.3': 0x136A7770, '3.3.4': 0x15F81460},
        dict(hook='prologue', prologue_len=16, used_by=[S + ':t_stun_update'],
             regs={'3.3.3': {'StunMixin': ['rsi']}})),
    'StunMixin.be_hit': ({'3.3.3': 0x136AE770, '3.3.4': 0x15F83660},
        dict(hook='fingerprint', used_by=['src/damage_daze.c:DAZE_RVA'],
             # rdx is the context on entry (moved to rdi); an rdx row is NOT the mixin (3.3.4 trap)
             # the result is `mov r14, [rdi+0x20]` (ctx.result); r14 holds other structs elsewhere
             regs={'3.3.3': {'StunMixin': ['rsi'], 'HitContext': ['rdi'],
                             'DamageResult': [{'reg': 'r14', 'from_field': 'HitContext.result'}]}})),
    'StunMixin.fields_witness': ({'3.3.3': 0x136A4D80, '3.3.4': 0x15F7EA80},
        dict(regs={'3.3.3': {'StunMixin': ['rsi']}})),
    'StunMixin.property_caller': ({'3.3.3': 0x136A4730, '3.3.4': None}, dict()),
    'TimeScaleManager.update': ({'3.3.3': 0x1552D4E0, '3.3.4': 0x1942A6A0},
        dict(hook='prologue', prologue_len=12, used_by=['src/timescalelog.zig:expected_update_rva'],
             regs={'3.3.3': {'TimeScaleManager': ['rsi']}})),
    'AnimEventSystem.drain': ({'3.3.3': 0x166163D0, '3.3.4': 0x13C42F30},
        dict(hook='prologue', prologue_len=15, used_by=['src/eventlog.zig:drain_rva'],
             regs={'3.3.3': {'AnimEventComponent': ['rsi', {'reg': 'r8', 'from_operand': 'qword ptr [rbp - 0x28]'}]}})),
    'DamageTextController.query': ({'3.3.3': 0x149C6E90, '3.3.4': 0x14AE0070},
        dict(hook='fingerprint', used_by=['src/damage_probe.c:string_target'])),
    'ResultConverter.convert': ({'3.3.3': 0x1A495BF0, '3.3.4': 0x19BF3530},
        dict(hook='fingerprint', used_by=['src/damage_result.c:target'],
             # the result arrives in r9 (-> r14); `mov rbx, r14` is the tail alias. rbx on entry is
             # an Entity argument, not the result.
             regs={'3.3.3': {'DamageResult': [{'reg': 'r14', 'from_operand': 'r9'}]}})),
    'ResultFactory.create': ({'3.3.3': 0x1B64A750, '3.3.4': 0x1BFC5500},
        dict(hook='fingerprint', used_by=['src/damage_snapshot.c:SNAPSHOT_RVA'],
             # rbp = the pooled result being built; the snapshot (rcx -> rbx) is spilled to
             # [rsp+0x60] and read back through rdi
             regs={'3.3.3': {'DamageResult': ['rbp'],
                             'AttackSnapshot': [{'reg': 'rbx', 'from_operand': 'rcx'},
                                                {'reg': 'rdi', 'from_operand': 'qword ptr [rsp + 0x60]'}]}})),
    'ResultFactory.energy_copy': ({'3.3.3': 0x1B64A1D0, '3.3.4': 0x1BFC7110},
        dict(regs={'3.3.3': {'DamageResult': ['rdi']}})),
    'DamageResult.energy_reset': ({'3.3.3': 0x13542A40, '3.3.4': 0x17109800},
        dict(regs={'3.3.3': {'DamageResult': ['rsi']}})),
    'AnomalyGauge.be_hit': ({'3.3.3': 0x1962EC60, '3.3.4': 0x167E0190},
        dict(hook='fingerprint', used_by=['src/damage_anomaly.c:ANOMALY_RVA'],
             # evt (rdi) -> [rdi+0x20] ctx (rax) -> [rax+0x20] result (rbx)
             regs={'3.3.3': {'AnomalyGauge': ['rsi'], 'AnomalyHitEvent': ['rdi'],
                             'HitContext': [{'reg': 'rax', 'from_field': 'AnomalyHitEvent.ctx'}],
                             'DamageResult': [{'reg': 'rbx', 'from_field': 'HitContext.result'}]}})),
    'AnomalyGauge.max_update': ({'3.3.3': 0x19631A50, '3.3.4': 0x167DE730},
        dict(regs={'3.3.3': {'AnomalyGauge': ['rsi']}})),
}

# A return address inside a method (sheet-webapp tools/client-build-constants.mjs `animFrame`).
RETURN_SITES = {
    'AnimHit.caller_return': {'3.3.3': 0x15008FE6, '3.3.4': 0x19C12086,
                              'used_by': ['sheet-webapp:tools/client-build-constants.mjs:animFrame']},
}

# --- fields: stable name -> ({version: offset or None}, {version: rule}, used_by) ---------------------
L = 'tools/per-hit-log.mjs:LAYOUTS.'
F = {}


def field(name, v333, v334, used_by, rule333='code', rule334='code'):
    F[name] = ({'3.3.3': v333, '3.3.4': v334}, {'3.3.3': rule333, '3.3.4': rule334}, used_by)


# statelog.zig
for n, a, b in [('owner', 0x1d0, 0x1d8), ('caster', 0x1f8, 0x200), ('ability', 0x200, 0x1e0),
                ('config', 0x1e8, 0x1f0), ('flags', 0x220, 0x218), ('slot', 0x21c, 0x21c), ('stacks', 0x224, 0x224)]:
    field('ModifierInstance.' + n, a, b, [S + ':m_' + n])
for n, a, b in [('name', 0x220, 0x4d8), ('stacking', 0x998, 0x988), ('duration', 0x98c, 0x998), ('max_stacks', 0x99c, 0x994)]:
    field('ModifierConfig.' + n, a, b, [S + ':c_' + n])
for n, a, b in [('entity', 0x60, 0x58), ('cur_at_entry', 0xc0, 0xb4), ('entered', 0xbd, 0xf7), ('stunned', 0xbe, 0xc4),
                ('config_value', 0xf8, 0xc0), ('cur_stun', 0xb0, 0xe8), ('remaining', 0xec, 0xb8)]:
    field('StunMixin.' + n, a, b, [S + ':s_' + n] + (['src/damage_daze.c:DAZE_THIS_BEFORE'] if n == 'cur_stun' else [])
          + (['src/damage_daze.c:DAZE_THIS_ENTITY'] if n == 'entity' else []),
          rule334='type_unique' if n == 'entity' else 'code')
field('StunMixin.daze_target', 0xb8, 0xf0, ['src/damage_daze.c:DAZE_THIS_TARGET'])
# timescalelog.zig
for n, a, b in [('frame', 0xbc, 0xb4), ('raw', 0xc0, 0x78), ('mult', 0xf8, 0xe0), ('pause', 0x104, 0xb0),
                ('world', 0xb8, 0xd0), ('unscaled', 0xe0, 0x95), ('scaled_dt', 0x94, 0xf8)]:
    field('TimeScaleManager.' + n, a, b, ['src/timescalelog.zig:f_' + n])
# eventlog.zig (owner is inherited)
field('AnimEventComponent.owner', 0x38, 0x38, ['src/eventlog.zig:component_owner'], rule334='unchanged')
field('AnimEventComponent.queue', 0x138, 0x50, ['src/eventlog.zig:component_queue'])
# damage_daze.c / damage_anomaly.c
field('HitContext.result', 0x20, 0x30, ['src/damage_daze.c:DAZE_CTX_RESULT', 'src/damage_anomaly.c:ANOMALY_CTX_RESULT'])
field('HitContext.attacker_id', 0x48, None, ['src/damage_daze.c:DAZE_CTX_BYTES'], rule334='measured')
field('AnomalyHitEvent.ctx', 0x20, 0x20, ['src/damage_anomaly.c:ANOMALY_EVT_CTX'], rule334='unchanged')
for n, a, b in [('entity', 0x48, 0x58), ('cur', 0x7c, 0x6c), ('f68', 0x84, 0x84), ('element', 0x68, 0x78),
                ('variant', 0x88, 0x70), ('variant2', 0x78, 0x88), ('max', 0x80, 0x74)]:
    field('AnomalyGauge.' + n, a, b, ['src/damage_anomaly.c:ANOMALY_THIS_' + n.upper()],
          rule334='unchanged' if n == 'f68' else 'code')
# the result object: decoder LAYOUTS keys, plus the probes' own reads
RESULT = [
    ('attacker_entity', 0x58, 0x68, 'code', 'code'), ('target_entity', 0xb8, 0x20, 'code', 'elimination'),
    ('damage', 0x12c, 0x118, 'code', 'code'), ('crit', 0xe4, 0x19c, 'code', 'code'),
    ('hit_split', 0x1ec, 0x184, 'code', 'code'), ('dmg_mv', 0x1a8, 0xf0, 'code', 'code'),
    ('daze_mv', 0x170, 0x278, 'code', 'code'), ('energy', 0x190, 0x188, 'code', 'code'),
    ('decibels', 0xe0, 0x168, 'code', 'code'), ('daze', 0xd4, 0x240, 'code', 'code'),
    ('daze_requested', 0x1a0, 0x17c, 'measured', 'measured'),
    ('buildup_requested', 0x114, 0x1f0, 'code', 'code'), ('buildup_applied', 0x21c, 0x174, 'code', 'code'),
    ('atk', 0x178, 0x110, 'code', 'code'), ('impact', 0x108, 0x134, 'code', 'code'),
    ('anomaly_mastery', 0x230, 0x258, 'code', 'code'), ('anomaly_proficiency', 0x1d0, 0x21c, 'code', 'code'),
    ('level', 0x1b4, 0x190, 'code', 'code'), ('target_state', 0x158, None, 'measured', 'measured'),
    ('dmg_mult', 0x194, 0x1fc, 'code', 'code'), ('f11c', 0x14c, 0x200, 'code', 'code'),
    ('f174', 0x284, 0x1b0, 'code', 'code'), ('f0f8', 0x1b8, 0x1bc, 'code', 'code'),
    ('display_skill_id', 0xf0, 0x208, 'code', 'code'),
]
EXTRA_USERS = {
    'daze_mv': ['src/damage_daze.c:DAZE_RESULT_DAZE_MV', 'src/damage_anomaly.c:ANOMALY_RESULT_DAZE_MV',
                'src/damage_snapshot.c:snapshot_header(join)'],
    'impact': ['src/damage_daze.c:DAZE_RESULT_IMPACT'],
    'buildup_requested': ['src/damage_anomaly.c:ANOMALY_RESULT_REQUESTED'],
    'buildup_applied': ['src/damage_anomaly.c:anomaly_header(applied)'],
    'atk': ['src/damage_snapshot.c:snapshot_header(join)'],
}
for n, a, b, r3, r4 in RESULT:
    field('DamageResult.' + n, a, b, [L + n] + EXTRA_USERS.get(n, []), r3, r4)
field('DamageResult.attenuation_curve', 0xa0, 0x88, [L + 'attn_col'])
field('DamageResult.geometry', 0x78, 0x60, ['src/damage_result.c:geometry'], 'type_unique', 'type_unique')
field('DamageResult.stat_dict', 0xc8, 0xb0, ['src/damage_result.c:dict'], 'type_unique', 'type_unique')
field('DamageResult.hit_names', 0x50, 0x80, ['src/damage_result.c:result_a8'], 'type_unique', 'type_unique')
# pinned after 3.3.4; its 3.3.3 value is seeded by the same type rule (the only List<String>)
field('DamageResult.attack_tags', 0x68, 0x48, ['src/damage_result.c:result_tags'], 'type_unique', 'type_unique')
field('AttackSnapshot.atk', 0xe8, 0x188, [L + 'snapshot_atk', 'src/damage_snapshot.c:snapshot_header(join)'])
field('AttackSnapshot.daze_mv', 0x1b4, 0x1a4, ['src/damage_snapshot.c:snapshot_header(join)'])

# Capture-measured values the offline stage cannot derive (carried for the replay's comparison).
MEASURED = {
    'DamageResult.effect_fields': {'3.3.3': [0x30, 0x88, 0x90], '3.3.4': [0x18, 0x40],
                                   'used_by': ['tools/attribution.mjs:EFFECT_OFFSETS']},
    'HitNames.roles': {'3.3.3': {'ability': 2, 'attack_property': 1, 'other': 0},
                       '3.3.4': {'ability': 2, 'attack_property': 1, 'other': 0},
                       'used_by': [L + 'a8']},
}
# Every instance field of one type, sorted: the probes dump the whole set, and which slot means
# what is settled separately (attenuation_curve by code; HitNames.roles by capture). Code shows the
# slots do NOT keep their sorted positions across builds, so no per-slot stable name is claimed.
SETS = {
    'DamageResult.strings': {'type': 'System.String', '3.3.3': [0x20, 0x28, 0x38, 0x40, 0xa0, 0xb0],
                             '3.3.4': [0x10, 0x30, 0x88, 0x90, 0xb8, 0xc0],
                             'used_by': ['src/damage_result.c:damage_result_record offsets[]']},
    'HitNames.strings': {'type': 'System.String', '3.3.3': [0x10, 0x20, 0x28], '3.3.4': [0x18, 0x20, 0x28],
                         'used_by': ['src/damage_result.c:result_a8 offsets[]']},
}
SIZES = {  # derived from the dump: align16(last instance field) + 0x10
    'DamageResult.dump_bytes': {'3.3.3': 0x290, '3.3.4': 0x2b0, 'used_by': ['src/damage_result.c:result[]']},
}

# --- CNBetaWin3.3.2, from the tree just before the 3.3.3 bootstrap (thaumiel eaee0cb^ = 6593cfd) ---
# The old side of the 3.3.2 -> 3.3.3 replay. Register specs are the 3.3.3 ones carried backwards by
# `rederive.py match 3.3.3 3.3.2` and checked there (see REGS_332).
for stable, name in {
    'PropertyTable': 'FNNLNAIBANN', 'PropertyNotifier': 'MGBLBALKPKM', 'ModifierInstance': 'BALGGDCFODF',
    'ModifierConfig': 'GBCCPCMJCGE', 'StunMixin': 'GILABPBBMJH', 'EntityWrapper': 'FGENDNBPAMB',
    'TimeScaleManager': 'LOLPDHOFIHG', 'AnimEventSystem': 'EGMKKHDDOGE', 'AnimEventComponent': 'CEODKDLMABB',
    'DamageTextController': 'UIInLevelDamageTextContainerChildWindowController', 'ResultConverter': 'PLPNKFLOLON',
    'ResultFactory': 'GOOCOICILAJ', 'DamageResult': 'AKHIBBLFBDH', 'AnomalyGauge': 'PNNLDJHFOAO',
    'AnomalyHitEvent': 'HKMPLIFFNHO', 'HitNames': 'MDJPKKMNNCB', 'HitContext': 'PDOGBEADLIE',
    'AttackSnapshot': 'HNKLKHEIEOD', 'AudioEffectEvent': 'LFMNGPGMJMD', 'AnimEventHandlerEvent': 'PGFCLHOPNKO',
}.items():
    CLASSES[stable]['3.3.2'] = name
for stable, rva in {
    'PropertyTable.set': 0x18106F70, 'PropertyNotifier.notify': 0x17BD6F60, 'ModifierInstance.init': 0x146FB120,
    'ModifierInstance.attach': 0x146FC4F0, 'ModifierInstance.detach': 0x146FCBA0, 'ModifierInstance.to_string': 0x146F94E0,
    'ModifierConfig.parse_binary': 0x16FF5E10, 'ModifierConfig.stacking_getter': 0x17001F70,
    'StunMixin.enter': 0x1A4FB4D0, 'StunMixin.update': 0x1A4F4DE0, 'StunMixin.be_hit': 0x1A4F76A0,
    'StunMixin.fields_witness': 0x1A4F23E0, 'StunMixin.property_caller': 0x1A4F1DA0,
    'TimeScaleManager.update': 0x136C9610, 'AnimEventSystem.drain': 0x13CE2D40,
    'DamageTextController.query': 0x14B12370, 'ResultConverter.convert': 0x1ACE5C70, 'ResultFactory.create': 0x133C7BF0,
    'ResultFactory.energy_copy': 0x133C7910, 'DamageResult.energy_reset': 0x184A2BC0,
    'AnomalyGauge.be_hit': 0x19235B40, 'AnomalyGauge.max_update': 0x19235440,
}.items():
    METHODS[stable][0]['3.3.2'] = rva
RETURN_SITES['AnimHit.caller_return']['3.3.2'] = 0x1B4F0BD6
V332 = {
    'ModifierInstance.owner': 0x1d0, 'ModifierInstance.caster': 0x1e0, 'ModifierInstance.ability': 0x1e8,
    'ModifierInstance.config': 0x1f8, 'ModifierInstance.flags': 0x218, 'ModifierInstance.slot': 0x220,
    'ModifierInstance.stacks': 0x224,
    'ModifierConfig.name': 0x800, 'ModifierConfig.stacking': 0x98c, 'ModifierConfig.duration': 0x994,
    'ModifierConfig.max_stacks': 0x9a0,
    'StunMixin.entity': 0xa0, 'StunMixin.cur_at_entry': 0xbc, 'StunMixin.entered': 0xca, 'StunMixin.stunned': 0xcb,
    'StunMixin.config_value': 0xd0, 'StunMixin.cur_stun': 0xd4, 'StunMixin.remaining': 0xe0, 'StunMixin.daze_target': 0xb0,
    'TimeScaleManager.frame': 0x7c, 'TimeScaleManager.raw': 0xbc, 'TimeScaleManager.mult': 0xc4,
    'TimeScaleManager.pause': 0xc8, 'TimeScaleManager.world': 0xd0, 'TimeScaleManager.unscaled': 0xec,
    'TimeScaleManager.scaled_dt': 0xf4,
    'AnimEventComponent.owner': 0x38, 'AnimEventComponent.queue': 0xa0,
    'HitContext.result': 0x30, 'HitContext.attacker_id': 0x48, 'AnomalyHitEvent.ctx': 0x20,
    'AnomalyGauge.entity': 0x48, 'AnomalyGauge.cur': 0x6c, 'AnomalyGauge.f68': 0x68, 'AnomalyGauge.element': 0x70,
    'AnomalyGauge.variant': 0x7c, 'AnomalyGauge.variant2': 0x84, 'AnomalyGauge.max': 0x8c,
    'DamageResult.attacker_entity': 0x10, 'DamageResult.target_entity': 0x68, 'DamageResult.damage': 0x200,
    'DamageResult.crit': 0x214, 'DamageResult.hit_split': 0x274, 'DamageResult.dmg_mv': 0x260,
    'DamageResult.daze_mv': 0x144, 'DamageResult.energy': 0x100, 'DamageResult.decibels': 0x21c,
    'DamageResult.daze': 0x18c, 'DamageResult.daze_requested': 0x250, 'DamageResult.buildup_requested': 0xf8,
    'DamageResult.buildup_applied': 0x150, 'DamageResult.atk': 0x23c, 'DamageResult.impact': 0x1ac,
    'DamageResult.anomaly_mastery': 0xfc, 'DamageResult.anomaly_proficiency': 0x254, 'DamageResult.level': 0x1d4,
    'DamageResult.target_state': 0x174, 'DamageResult.dmg_mult': 0x15c, 'DamageResult.f11c': 0x284,
    'DamageResult.f174': 0x138, 'DamageResult.f0f8': 0x19c, 'DamageResult.display_skill_id': 0x194,
    # the decoder never named 3.3.2's attenuation slot (its column default `sa0` is a 3.3.3 offset)
    'DamageResult.attenuation_curve': None,
    'DamageResult.geometry': 0x78, 'DamageResult.stat_dict': 0x38, 'DamageResult.hit_names': 0x20,
    'AttackSnapshot.atk': 0x194, 'AttackSnapshot.daze_mv': 0xf8,
}
for stable, off in V332.items():
    F[stable][0]['3.3.2'] = off
    F[stable][1]['3.3.2'] = F[stable][1]['3.3.3']
F['DamageResult.attack_tags'][0]['3.3.2'] = 'type'  # resolved from the dump by the type rule below
F['DamageResult.attack_tags'][1]['3.3.2'] = 'type_unique'
MEASURED['DamageResult.effect_fields']['3.3.2'] = [0xa8, 0x48, 0x30]
MEASURED['HitNames.roles']['3.3.2'] = {'ability': 1, 'attack_property': 2, 'other': 0}
SETS['DamageResult.strings']['3.3.2'] = [0x28, 0x58, 0x88, 0x90, 0xb8, 0xc8]
SETS['HitNames.strings']['3.3.2'] = [0x10, 0x20, 0x28]
SIZES['DamageResult.dump_bytes']['3.3.2'] = 0x290
# REGS_332: `rederive.py match 3.3.3 3.3.2` carried every 3.3.3 spec back unchanged (register pairing
# identity in all 22 functions), and the two stack slots were read in the 3.3.2 listings
# (client-update-333/result_factory-332.txt:62, event_drain-332.txt:52). init failed the shape gate
# backwards (0.546, finding 1); its `mov rdi, rcx` is at client-update-333/modifier_init-332.txt:23.
for stable, (_rvas, meta) in METHODS.items():
    if '3.3.3' in meta.get('regs', {}):
        meta['regs']['3.3.2'] = meta['regs']['3.3.3']


# --- resolution ---------------------------------------------------------------------------------
def hx(v):
    return None if v is None else hex(v)


def seed(ver):
    img = Image(ver)
    errors = []
    out = {'version': img.version, 'seeded_from': 'committed sources (tools/update/seed_pins.py)',
           'classes': {}, 'methods': {}, 'fields': {}, 'return_sites': {}, 'sets': {}, 'measured': {}, 'sizes': {}}
    klass = {}
    for stable, names in CLASSES.items():
        name = names.get(ver)
        if name is None:
            out['classes'][stable] = {'name': None, 'ns': None}
            continue
        found = img.by_name.get(name, [])
        if len(found) != 1:
            errors.append(f'class {stable}: {name} has {len(found)} dump entries')
            continue
        klass[stable] = found[0]
        out['classes'][stable] = {'name': name, 'ns': found[0]['ns']}
        if stable in CLASS_RULES:
            out['classes'][stable]['rule'] = CLASS_RULES[stable]

    for stable, (rvas, meta) in METHODS.items():
        rva = rvas.get(ver)
        entry = {'name': None, 'params': None, 'rva': hx(rva)}
        if rva is not None:
            got = img.method_at(rva)
            cls_stable = stable.split('.')[0]
            if got is None:
                errors.append(f'method {stable}: no dump method at {rva:#x}')
            else:
                owner, mname, params = got
                expect = CLASSES[cls_stable].get(ver)
                if expect is not None and owner != expect:
                    errors.append(f'method {stable}: {rva:#x} belongs to {owner}, not {expect}')
                entry.update(name=mname, params=params)
            if meta.get('hook') == 'prologue':
                entry['prologue'] = img.data(rva, meta['prologue_len']).hex()
            elif meta.get('hook') == 'fingerprint':
                entry['fingerprint'] = img.data(rva, 64).hex()
            entry['instructions'] = len(img.dis(rva))
        for k in ('hook', 'used_by', 'disambiguate'):
            if k in meta:
                entry[k] = meta[k]
        if ver in meta.get('regs', {}):
            entry['regs'] = meta['regs'][ver]
        out['methods'][stable] = entry

    for stable, vals in RETURN_SITES.items():
        addr = vals.get(ver)
        start = img.containing_method(addr)
        owner, mname, params = img.method_at(start)
        out['return_sites'][stable] = {'address': hx(addr), 'method_rva': hx(start), 'class': owner, 'method': mname,
                                       'params': params, 'offset': hx(addr - start), 'used_by': vals['used_by']}

    for stable, (offs, rules, used_by) in F.items():
        off = offs.get(ver)
        cls_stable = stable.split('.')[0]
        if off == 'type':  # the only field of the type the later builds pin
            want = next(e['type'] for v in ('3.3.4', '3.3.3') for e in [seed_field_type(v, stable)] if e)
            got = type_set(img, klass[cls_stable], want)
            if len(got) != 1:
                errors.append(f'field {stable}: {len(got)} fields of type {want}')
            off = got[0] if len(got) == 1 else None
        entry = {'offset': hx(off), 'rule': rules.get(ver), 'used_by': used_by}
        if off is not None and cls_stable in klass:
            hits = [(n, t) for c in chain(img, klass[cls_stable]) for (n, t) in img.field_type(c, off)]
            if len(hits) == 1:
                entry['name'], entry['type'] = hits[0]
            elif len(hits) > 1:
                errors.append(f'field {stable}: {len(hits)} dump fields at {off:#x}: {hits}')
            else:
                entry['name'] = None
                entry['note'] = 'no dump field at this offset (inside a field, or not a field of this class)'
        out['fields'][stable] = entry

    for stable, vals in MEASURED.items():
        if ver in vals:
            v = vals[ver]
            out['measured'][stable] = {'value': [hex(x) for x in v] if isinstance(v, list) else v, 'used_by': vals['used_by']}
    for stable, vals in SETS.items():
        got = type_set(img, klass[stable.split('.')[0]], vals['type'])
        if got != vals[ver]:
            errors.append(f'set {stable}: committed {[hex(x) for x in vals[ver]]}, dump has {[hex(x) for x in got]}')
        out['sets'][stable] = {'type': vals['type'], 'value': [hex(x) for x in vals[ver]], 'used_by': vals['used_by']}
    for stable, vals in SIZES.items():
        out['sizes'][stable] = {'value': hx(vals[ver]), 'used_by': vals['used_by']}
        derived = dump_bytes(img, klass['DamageResult'])
        if derived != vals[ver]:
            errors.append(f'size {stable}: committed {vals[ver]:#x}, dump rule gives {derived:#x}')
    out['runtime'] = seed_runtime(img, ver, errors)
    return out, errors


# The il2cpp API table and client identity, read from each build's committed dumper/eventlog.
REFS = {'3.3.2': 'eaee0cb^', '3.3.3': 'b98db0a', '3.3.4': 'aa31561'}


def git_show(ref, path):
    return subprocess.run(['git', '-C', os.path.join(HERE, '..', '..'), 'show', f'{ref}:{path}'],
                          capture_output=True, text=True, check=True).stdout


def seed_runtime(img, ver, errors):
    ref = REFS[ver]
    dumper, eventlog = git_show(ref, 'src/dumper.zig'), git_show(ref, 'src/dumper-rvas.zon')
    table = parse_zon(eventlog)
    ev = git_show(ref, 'src/eventlog.zig')
    checks = {int(slot): bytes(int(b, 16) for b in re.findall(r'\\x([0-9a-f]{2})', text)).hex()
              for slot, text in re.findall(r'\.\{ (\d+), "((?:\\x[0-9a-f]{2})+)" \}', dumper)}
    rt = {
        'api_table': [hex(x) for x in table],
        'api_checks': {str(k): v for k, v in sorted(checks.items())},
        'unity_table_offset': re.search(r'const table_offset: usize = (0x[0-9a-f]+)', dumper).group(1),
        'size_of_image': re.search(r'game_size != (0x[0-9A-Fa-f]+)', dumper).group(1).lower(),
        'timestamp': re.search(r'expected_timestamp: u32 = (0x[0-9A-Fa-f]+)', ev).group(1).lower(),
        'used_by': ['src/dumper-rvas.zon', 'src/dumper.zig:checks', 'src/dumper.zig:table_offset',
                    'src/dumper.zig:game_size', 'src/eventlog.zig:expected_timestamp/size_of_image',
                    'src/damage_probe.c:string probe PE check'],
    }
    if len(table) != 194 or 0 in table:
        errors.append(f'runtime: committed table has {len(table)} entries, {table.count(0)} unpinned')
    if len(checks) != 7:
        errors.append(f'runtime: {len(checks)} code checks parsed, expected 7')
    if int(rt['size_of_image'], 16) != img.pe.size_of_image or int(rt['timestamp'], 16) != img.pe.timestamp:
        errors.append(f'runtime: PE identity {rt["size_of_image"]}/{rt["timestamp"]} != binary '
                      f'{img.pe.size_of_image:#x}/{img.pe.timestamp:#x}')
    for slot, want in checks.items():
        if img.data(table[slot], len(want) // 2).hex() != want:
            errors.append(f'runtime: code check {slot} bytes differ from the binary at {table[slot]:#x}')
    rt['readiness'] = parse_readiness(git_show(ref, 'src/runtime_readiness.zig'))
    rt['readiness']['used_by'] = ['src/runtime_readiness.zig:main_thread_rva/anchors']
    if len(rt['readiness']['anchors']) != 4:
        errors.append(f'runtime: {len(rt["readiness"]["anchors"])} readiness anchors parsed, expected 4')
    for rva, want in rt['readiness']['anchors']:
        if img.data(int(rva, 16), len(want) // 2).hex() != want:
            errors.append(f'runtime: readiness anchor {rva} bytes differ from the binary')
    return rt


def chain(img, c):
    """The class and its parents, as the dumper's findField searches them."""
    out, seen = [], set()
    while c is not None and c['name'] not in seen:
        out.append(c)
        seen.add(c['name'])
        parent = (c['parent'] or '').split('.')[-1]
        found = img.by_name.get(parent, [])
        c = found[0] if len(found) == 1 else None
    return out


def seed_field_type(ver, stable):
    """The field's entry in an already-seeded manifest (its dump type), or None."""
    path = os.path.join(PINS, 'CNBetaWin' + ver + '.json')
    if not os.path.exists(path):
        return None
    with open(path) as f:
        return json.load(f)['fields'].get(stable)


def type_set(img, c, type_name):
    return sorted(o for k in chain(img, c) for _n, o, t in img.instance_fields(k) if t == type_name)


def dump_bytes(img, c):
    last = max(o for _n, o, _t in img.instance_fields(c))
    return (last & ~0xf) + 0x10


if __name__ == '__main__':
    versions = sys.argv[1:] or ['3.3.2', '3.3.3', '3.3.4']
    os.makedirs(PINS, exist_ok=True)
    failed = False
    for v in versions:
        manifest, errors = seed(v)
        for e in errors:
            print(f'{manifest["version"]}: ERROR {e}')
        failed |= bool(errors)
        path = os.path.join(PINS, manifest['version'] + '.json')
        with open(path, 'w', newline='\n') as f:
            json.dump(manifest, f, indent=1)
            f.write('\n')
        print(f'{manifest["version"]}: {len(manifest["classes"])} classes, {len(manifest["methods"])} methods, '
              f'{len(manifest["fields"])} fields -> {os.path.relpath(path, HERE)}' + (' (WITH ERRORS)' if errors else ''))
    sys.exit(1 if failed else 0)
