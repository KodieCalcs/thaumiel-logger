# 3.3.3 decoder validation, 2026-09-23

This supersedes the crit rejection and unresolved-field list in HANDOFF-3.3.3.md.
No client rebuild or new capture was required. The capture archive is in the sibling
sheet-webapp repo at `local-data/damage-probe-captures/20260923-030316-8408/`.
Scripts `analyze-crit.py` and `validate-fields.py`, full converter/factory disassemblies,
and `ui-crit-validation.json` preserve the derivation. The first low-crit capture is
`20260923-024209-333-first/`.

## Crit: two independent witnesses

`result+0xe4` is the **uint32 crit enum, 0 = ordinary, 2 = crit**. Existing CSV semantics
already use 0/2, so this does not convert it to a boolean.

The string probe records the displayed integer and `!!` suffix, plus display category 1
for crit. Decode the UTF-16 string from `arg1_mem0..7` (length at +0x10, data at +0x14).
Join independently by displayed damage = ceil(result damage) and elapsed time within 50 ms.
Only unique candidates count; do not select the first of several equal simultaneous hits.

| Battle | UI rows | Unique pairs | Crit | Noncrit | Flag mismatches | Ambiguous | Unmatched |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| battle-1 | 1743 | 1187 | 853 | 334 | 0 | 537 | 19 |
| battle-3 | 276 | 202 | 144 | 58 | 0 | 74 | 0 |

`0xe4` is the **only** byte outside the damage float whose nonzero state agrees with every
unique pair in each battle. UI category and suffix also agree on every unique pair.
The probe header still says 3.3.2; it is stale metadata, not evidence of the loaded client.
The raw result header identifies 3.3.3, and instruction evidence is from its archived DLL.

Independently, full-method alignment of converters `0x1ace5c70` (3.3.2) and `0x1a495bf0`
(3.3.3) is 99.732% (745/747 instructions):

```
1ace62cd mov eax, dword ptr [r14 + 0x214]
1a49624d mov eax, dword ptr [r14 + 0xe4]
1a496254 mov dword ptr [rbp + 0x38], eax
```

This is the same output-event crit enum traced in damage-probe-howto.md. The {0,2}
encoding was already documented there; it was never unexplained.

Positive-hit flag counts support the build contrast: old Grace 61/545, Rina 16/165,
Velina 19/160; new battle-1 Severian 638/638 and Azural 224/228; battle-3 Severian
113/113 and Azural 20/21. These are measured rates, not reconstructed loadout rates.
All 40 anomaly rows across the three captures have flag 0. Do not apply a universal
no-anomaly-crit rule to other Agents without checking their kit.

**Correction to trap 8:** a reversed pooled average does not disprove an effect observed
within comparable groups. Different attack populations caused the reversal. The old
evidence was insufficient to confirm crit, but it was also insufficient to reject it.

## New disassembly trap: an early ret is not the end of a method

`offsetdiff2.py` stops at the first ret. For this converter it reports 324/324 instructions,
100% alignment, and never visits the damage/crit copies, which occur after that return.
Use `discovery/disfn.py`, bounded by the next method RVA in the dump. Cross-check that
instruction count before treating a missing field reference as evidence of absence.
This is distinct from the known tail-jmp/int3 fall-through bug. The helper itself is
unchanged; its early-return limitation is documented here.

## Field witnesses

Full factory bodies `0x133c7bf0` / `0x1b64a750` each have 1410 instructions and align
99.858%. Follow writes to the result register `rbp`, not every occurrence of a displacement
on unrelated objects. Each mapping below is inside an equal instruction block.

| Field | 3.3.2 | 3.3.3 | 3.3.3 copy instruction RVA |
| --- | --- | --- | --- |
| ATK | 0x23c | 0x178 | 0x1b64b52b |
| Impact | 0x1ac | 0x108 | 0x1b64b485, 0x1b64b4d3 |
| AP | 0x254 | 0x1d0 | 0x1b64b54b |
| AM | 0xfc | 0x230 | 0x1b64b55b |
| Level | 0x1d4 | 0x1b4 | 0x1b64b34d |
| Hit split | 0x274 | 0x1ec | 0x1b64bceb |
| DMG MV | 0x260 | 0x1a8 | 0x1b64b6e9 |
| Daze MV | 0x144 | 0x170 | 0x1b64b44c |
| Decibels | 0x21c | 0xe0 | 0x1b64b7ec |
| DMG multiplier | 0x15c | 0x194 | 0x1b64b5b5 |
| f11c | 0x284 | 0x14c | 0x1b64b53b |
| f174 | 0x138 | 0x284 | 0x1b64b358 |
| f0f8 | 0x19c | 0x1b8 | 0x1b64bd36 |
| Display skill ID | 0x194 | 0xf0 | 0x1b64acc1 |

Snapshot ATK is loaded from `[rdi+0xe8]` at `0x1b64b523`, immediately before the result
ATK copy; the old source was `[rdi+0x194]`. Captured low-build stats read Grace ATK
2794.4/3370.4, Impact 83, AM 196, AP 364; Rina 2918/83/93/310;
Velina ATK 2604/3180, Impact 86, AM 112, AP 383. These support the code-derived meanings;
plausibility alone was not used to select the offsets.

## Names and identity

Actual name contents establish `a8s20 = AttackProperty`, `a8s28 = ability`, `a8s10 = other`.
The old carried-over mapping reversed the first two roles and missed anomaly attribution.
Result `+0x58` matches `entity2_ptr` (attacker), `+0xb8` matches `entity1_ptr` (target)
on all 3710 result rows. The converter's old attacker pair at +0x10 moves to +0x58.

Capture-local attack-effect identities from hits.tsv occur at result offsets 0x30/0x88/0x90:
old capture 1146/1137/1141 matches, battle-1 1434/1434/1150, battle-3 227/227/173.
Reuse the existing identity resolver and its collision rejection, with anomaly-name precedence.
No pointer addresses are reused between capture sessions.

## Remaining limits

Follow-up: [hooks-333-validation.md](hooks-333-validation.md) completes Energy, gauge join-checks,
the attenuation-string trace, and code confirmation of Anomaly requested/applied. State/event/
time-scale hooks are re-pinned and built, awaiting a live client test. Historical captures do
not gain the newly restored hook data retroactively.
The high-crit settlement/loadout were preserved at the session root and matched to battle-1:
30 skill totals exact, 1491018 differs by 1 damage and 1631006 by 7 damage (hit counts agree).
These small differences remain unexplained; no rounding formula was changed. Skill-0 damage
3,041,313 remains unattributed. The earlier low-crit capture now has 33 exact skill totals,
zero mismatches. Snapshot pairing yields old 122/145, battle-1 575/607, battle-3 98/106;
unpaired rows are retained explicitly, not forced into matches.
Do not use the default Grace/Rina/Velina team to judge the new Severian/Azural/Summer team.

Run `node tools/test-decoder-333.mjs` and `node tools/test-attribution.mjs` for regression checks.
Both pass. The sibling sheet-webapp also passes typecheck, all 1,863 tests (63 files), and build.
