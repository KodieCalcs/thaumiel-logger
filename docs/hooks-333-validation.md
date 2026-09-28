# 3.3.3 capture recovery: ready for a live test

2026-09-23. This supersedes the remaining-hook and Energy blockers in HANDOFF-3.3.3.md
and decoder-333-validation.md. The DLL builds; runtime installation has **not yet been
tested in the client**. Do not call the new state/event/time-scale logs verified until then.

## Evidence and reproducibility

The sibling sheet-webapp directory `local-data/client-update-333/` holds `trace-hooks.py`,
all old/new disassemblies, instruction-alignment reports, caller lists, `hook-witnesses.json`,
and the preparation/test scripts. It reads the archived 3.3.2 and 3.3.3 DLLs and v7 dumps.
Disassembly ends at the next method RVA, with a generous size cap, **not at the first ret**.
Trailing alignment nops/int3s are excluded from instruction counts. No METHOD_FLAGS data
from the pre-fix 3.3.3 dump is used. Structural class matching gives one candidate per class;
method matching sweeps the whole class without signature filtering.

## Recovered targets

| Hook | 3.3.2 RVA | 3.3.3 class/method | RVA | Full-body match |
| --- | --- | --- | --- | --- |
| property write | 0x18106f70 | CCMIHBAGMNI::LNBCILFKHDP/4 | 0x198de980 | 54 instructions, 100%, caller disambiguation below |
| property notify | 0x17bd6f60 | MJMFEDHPCNM::OAFFODEGLMO/3 | 0x169fcb00 | 130, 100% |
| modifier init | 0x146fb120 | KGPNKBLEBBE::DCDEKNMKEBP/4 | 0x1721c080 | 1101/1125, reordered; argument-flow witness below |
| modifier attach | 0x146fc4f0 | KGPNKBLEBBE::MDJGHGGAADP/0 | 0x1721eaa0 | 131, 100% |
| modifier detach | 0x146fcba0 | KGPNKBLEBBE::ADAAHGKPOJD/0 | 0x1721d4d0 | 43, 100% |
| Daze grace entry | 0x1a4fb4d0 | CDANMPBMFIJ::IDOMCAHGGLL/0 | 0x136aa5c0 | 157, 100% |
| Daze grace update | 0x1a4f4de0 | CDANMPBMFIJ::DKDOIFKHLDJ/1 | 0x136a7770 | 150, 100% |
| animator event drain | 0x13ce2d40 | DIDDGLDPGMD::LKMGABPFJBM/1 | 0x166163d0 | 154, 100% |
| time-scale Update | 0x136c9610 | PGHCHDNHLNH::Update/1 | 0x1552d4e0 | 329, 100% |

**Property-write ambiguity:** 0x198dda70 is also a 54-instruction, 100% match and calls
the same inner writer. Shape or callee alone cannot distinguish it. Scanning real call
instructions gives 173 callers of the old writer, 173 of 0x198de980, and only 9 of the
sibling. Independently, the stun caller at old 0x1a4f1da0 / new 0x136a4730 matches all
174 instructions: its call at 0x1a4f1ea5 to 0x18106f70 becomes the call at 0x136a483b
to **0x198de980**. The two functions' identical-looking bodies are not interchangeable
hook targets.

**Modifier init:** whole-body mnemonic alignment is only 54.6%; it is not a field map.
The matched class has one four-argument initializer. Entry moves preserve r9 -> r14
(config), r8 -> rsi (owner), rdx -> rbx (ability context), rcx -> rdi (self).
At 0x1721c11f the context's +0x1f0 goes to self+0x1f8 (caster); 0x1721c126 stores config
to +0x1e8; 0x1721c12d stores owner to +0x1d0. The extra stack argument is loaded from
rbp+0xf0 and stored to self+0x200 at 0x1721c265, matching old self+0x1e8. The same
slot sentinel and flags-or loop are present. Exact attach/detach/ToString bodies separately
confirm the config, ability, name, slot and stack fields. Do not reuse the naive aligned
field rows for this initializer: the merged word-zero store became two byte stores.

## Field mapping

| Object | Meaning: old -> new |
| --- | --- |
| modifier instance | owner 1d0 -> 1d0; caster 1e0 -> 1f8; ability 1e8 -> 200; config 1f8 -> 1e8; flags 218 -> 220; slot 220 -> 21c; stacks 224 -> 224 |
| modifier config | name 800 -> 220; stacking 98c -> 998; duration 994 -> 98c; max stacks 9a0 -> 99c |
| Daze mixin | entity a0 -> 60; entry value bc -> c0; entered ca -> bd; grace flag cb -> be; config value d0 -> f8; current d4 -> b0; remaining e0 -> ec |
| time manager | frame 7c -> bc; raw bc -> c0; multiplier c4 -> f8; pause c8 -> 104; world d0 -> b8; unscaled ec -> e0; scaled delta f4 -> 94 |
| event component | owner stays 38; queue a0 -> 138; list/array layout and 24-byte entries unchanged |

Config duration is confirmed by the **10,155-instruction binary parser**, 100% match:
old 0x16ff64fc / new 0x1add6052 takes the field address under the same `test r12d,0x20000`
serialization presence bit. Stacking also has a 25-instruction getter witness (100%).
Modifier ToString is 265 instructions, 100%, and confirms name/max-stacks/stack-count.
The current Daze field uses the existing verified hit handler's read of +0xb0, not the
initializer's reordered zero stores. Field names are read from the dump only **after**
the offsets are traced in code; no positional class-layout correspondence is assumed.

## Completed decoder/probe fields

- Energy grant is result+0x190: old 0x133c79c9 -> new 0x1b64a286 (75-instruction copy,
  100%), independently confirmed by the 24-instruction energy reset at 0x13542a40.
  Another 33-instruction helper has two perfect matches; the wrong one writes +0x144.
  Do not select it by rank. Captured regression rows cover nonzero grants and zero.
- The **full** Anomaly handler is 548 instructions, 100%: requested read +0xf8 -> +0x114
  at 0x1962edcb; clamped applied delta +0x150 -> +0x21c at 0x1962ee68. This supersedes
  the earlier weak requested/applied inference from three clamped rows.
- Anomaly f68 is +0x84, confirmed in the 24-instruction max updater at 0x19631a50 (100%).
- Daze join-checks now read result+0x170 (MV), +0x108 (Impact); Anomaly join-checks read
  +0x114 (requested), +0x170 (MV). Existing archived files still contain their old -1
  sentinels; only new captures can populate these restored checks.
- Snapshot header now identifies source ATK +0xe8 and MV +0x1b4 against result +0x178/+0x170.
- Attenuation string result+0xa0 is traced from old +0xb8 in the factory at 0x1b64aefa;
  the probe already captured that slot correctly. String-probe header now reports the
  actual 3.3.3 target, 0x149c6e90. Raw result header identifies the confirmed name slots.

## Offline checks

- `check_pins.py 3.3.3`: all 25 state-log target/field pins match dump and binary.
- `check_capture_pins.py`: event/time-scale method and field pins, executable prologues,
  PE identity, and four active damage-probe 64-byte fingerprints.
- All eight native C tests pass, including 10,000 calls through each of eight assembly bridges,
  recorder null/unreadable-pointer controls, unchanged inputs, duplicate/fingerprint refusal,
  file rotation and joins. Old result-recorder fixtures were updated from the 3.3.2 layout.
- All five detour tests and both runtime-readiness tests pass. Decoder and attribution tests pass.
- ReleaseFast DLL builds. The sibling app passes typecheck, 1,863 tests, and production build.

## Live completion gate

Installed on the game machine at 2026-09-22 23:54 local time. SHA256:
`092AC6B996CEFEDADD3868D3FA6F13EFB28D836E181C076FF9B2547F1C71F437`.
Previous DLL backed up beside the client in `damage-probe-backup-20260922-235446-082/`.
The matching ready payload and installer are also staged there. No game process was launched.

Close/relaunch the client with the new DLL and finish one battle containing a Stun and an
Ultimate (for time slowdown). Then inspect startup installation messages, nonempty state/event/
time-scale logs, five active probe statuses, zero skipped-row surprises, and restored gauge
join checks. Read StunBuffModifier Start/Reset/End with sheet-webapp's stun-log tool. Do not
replace measured Stun windows with the separate `grace` rows.

The historical numeric/damage-event/enqueue discovery probes remain intentionally disabled
and may still report -3. The active **animator** eventlog is a different hook. No client patch
or login offsets were changed; the already-merged 3.3.3 upstream assets remain in place.

Unrelated decoder limits remain explicit: some snapshot rows are unpaired, skill-0 damage in
the high-crit settlement lacks attribution, and two skill totals differ by 1 and 7 damage.
This update does not invent attribution or change rounding to erase those discrepancies.

## Live verification completed 2026-09-23

Session `20260923-035932-12828`, archived under sheet-webapp/local-data/damage-probe-captures/.
All seven state hooks installed, animator event and timescale hooks installed, and all five active
probe statuses are 1. Battle 2 has 121,649 state rows, 7,656 animator events (trigger 0/1/2/3),
1,252 timescale rows including slowdown and pause transitions, and zero skipped probe rows.
StunBuffModifier gives four complete Stun windows with Starts, Resets and Ends.

Battle 2 matches endbattle_1.pb: 27 exact skill totals; skill 1631006 differs by 5 damage.
The user's later battle 5 matches endbattle_2.pb: **32 exact skill totals, zero mismatches**.
Its unassigned skill-0 total remains 4,137,963; this is an attribution limitation, not missing
capture bytes. Snapshot joins retain their previous limitations (battle 5: 665/735 paired).
The anomaly gauge's optional entity_ptr is zero in this capture; target attribution comes from
the paired result, not that diagnostic pointer.

Daze / Anomaly joins verified: battle 2 2,014/1,524; battle 3 2,247/1,708;
battle 5 2,261/1,659. All rows paired and all float checks pass. The live test exposed a decoder
verification bug: Daze MV 1.0394367 was rounded to 1.03944 for CSV before the comparison.
Checks now use raw result floats. Captured regression fixture probe-join-333.json covers that
case and a deliberately different float as a negative control. This is a decoder-only fix;
the installed DLL is unchanged and no further client test is required for hook restoration.
Decoder and attribution regressions, app typecheck, and all 1,863 app tests pass.
