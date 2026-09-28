# Property type ids (CNBetaWin3.3.4)

Every entity's stats live in a property table (`IHNAJAGFLDC`) keyed by `Share.EPropertyType`. The
il2cpp dump has no values for that enum, so each id below was identified **by value** from captures
(2026-09-28): state.tsv `prop` rows (writes, `statelog.zig`) and `get` rows (reads, the
`GEHFLAPAAJJ` hook, one row per change of value). Ids have held from 3.3.3 to 3.3.4 where checked
(0, 7, 11, 59); re-check after a client update.

Most stats come in two ids: the base value and a "battle" value (5xx) with buffs applied.

| id | stat | evidence |
|---|---|---|
| 0 | HP (current) | falls by each hit's damage (enemy); `tools/enemy-state.mjs` maps tables to targets with it |
| 1 | HP max | equals the first HP value; Yixuan 8373 |
| 2 | ATK (base) | Velina 2604; battle value 560 = 2604 -> 2994.6 |
| 3 | DEF (base) | enemy 952.8; Velina 884 |
| 4 | CRIT Rate | 0.098 (the test account's substats) |
| 6 | CRIT DMG | 0.596 / 0.5 |
| 7 | Energy | balance (docs: energy-decibels) |
| 11 | Stun meter (CurStun) | enemy only |
| 12 | Stun meter max | enemy 17582.7 |
| 13 | Impact | Velina 86, Yixuan 93, Nicole 88 |
| 21 | PEN Ratio | Velina 0.24 = her PEN Ratio Disc 5 (6% x 4 at +15); battle value 567 |
| 22 | PEN (flat) | Velina 54, Phoenix 54, Nicole 18 = each loadout's PEN substats (9 x rolls); battle value 568 |
| 46 | Anomaly Proficiency | Velina 383, Phoenix 366; battle value 577 (366 -> 541 / 601) |
| 49 | level | 60 |
| 50 | Anomaly Mastery | Velina 112, Phoenix 255 |
| 59 | Decibels | balance |
| 60 | Decibels max | 3000 |
| 65 | Sheer Force | Yixuan 1098 = 0.3 x ATK 872 + 0.1 x HP 8373 (1098.9) |
| 562 | DEF (battle) | enemy 952.8 -> 571.68 under Nicole's core debuff (x 0.6) |
| 574 | DMG RES (battle, 1/10000) | enemy -1000 while `DamageResistRatio_Talent02` is on |

Enemy base RES: the enemy table's other stats (18-24, 39-44, ...) all read 0 on the test boss,
which is a modified no-resistance enemy, so which id is which Attribute's RES is not settled.
A capture against a stock enemy with a weakness or resistance settles it.

## What is not a stored stat

RES shred (Velina's `ResistDown_Wind` / `_Fire`), Phoenix's `Pheony_UniqueSkill_Vulnerable` and a
Disc set's `AbnormalResistDelta` change no property on the enemy (no writes, reads unchanged) and
are not in the result's dictionaries: the result's `Dictionary<BaseProperty,Single>` (+0xe0) is
empty on every hit and `Dictionary<TeamProperty,Single>` (+0xd0) only ever holds one zero. They
act while the hit is computed. Their effect can be MEASURED: damage / (MV x ATK x DMG multiplier x
crit x DEF multiplier x distance) is a constant per attacker outside the debuff and steps by the
debuff's factor inside it. First reading (Phoenix + Velina capture): +10% on both attackers' hits
while `Pheony_UniqueSkill_Vulnerable` is on (Phoenix 1.187 -> 1.305, Velina 1.037 -> 1.141). The
constant is not 1 yet: flat PEN and the Stun multiplier are not in that formula, so it is not a
column until it is.
