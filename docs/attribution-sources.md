# Attribution sources

Measured 2026-09-19 before changing the decoder. Inputs: schema-5 captures; baseline regenerated with the existing per-hit-log.mjs. No client assets are used for identity attribution.

## Decision

Use config-pointer identity for direct hits, with the name map as fallback only. Do not use display_skill_id: it usually identifies an avatar/base display skill, not the settlement skill. Keep Player_ElementAbnormalBuff as anomaly even if its config pointers or third name slot identify a triggering attack. Neither candidate nor display with identity fallback is map-free.

The 3.3.2 pointer scan checked every aligned result field against nonzero dyn/prop/attackEffect/*HitEffect pointers. Matches occurred only at +0xa8 (attackEffect), +0x48 (groundHitEffect), and +0x30 (skyHitEffect). The documented 3.3.0 keys are +0x68 and +0x48. Zero pointers/skill IDs are excluded; conflicting identities are unresolved, never selected arbitrarily.

## 20260918-full180

3706 complete hits; baseline sources: `{'map': 3218, 'unmapped': 396, 'name': 92}`.

| Candidate | Agreement | Different answer | No answer |
|---|---:|---:|---:|
| display | 461 | 3143 | 102 |
| identity | 2865 | 29 | 812 |

Agreement compares to the baseline skill_id, including blank/unmapped and anomaly rows. Different answers on previously blank rows are newly available attribution, not contradictory mapped skills. No ambiguous identity sets occurred.

### display disagreements

| Baseline skill | Candidate skill | Ability / AttackProperty | Hits |
|---|---|---|---:|
| (blank) | 1011011 | Velina_WindRegion_Controller / Velina_Attack_WindRegion_ExtraDamage_AttackProperty_01_WindFake | 134 |
| (blank) | 1211015 |  / Rina_Anastacia_Attack_Branch_FollowAttack_AttackProperty_01_01 | 48 |
| (blank) | 1211015 |  / Rina_Anastacia_Attack_Branch_FollowAttack_AttackProperty_01_02 | 168 |
| (blank) | 1211015 |  / Rina_Anastacia_Attack_Branch_FollowAttack_AttackProperty_02 | 10 |
| (blank) | 1511001 |  / Velina_Attack_WindRegion_AttackProperty_02 | 26 |
| 1181002 | 1181001 | Lisa_Normal / Lisa_Attack_Normal_02_AttackProperty_01 | 77 |
| 1181002 | 1181001 | Lisa_Normal / Lisa_Attack_Normal_02_AttackProperty_02 | 38 |
| 1181003 | 1181001 | Lisa_Attack_Normal_03_BulletType_Blow_Target / Lisa_Attack_Normal_03_AttackProperty_03 | 56 |
| 1181003 | 1181001 | Lisa_Normal / Lisa_Attack_Normal_03_AttackProperty_01 | 90 |
| 1181003 | 1181001 | Lisa_Normal / Lisa_Attack_Normal_03_AttackProperty_02 | 61 |
| 1181004 | 1181001 | Lisa_Normal / Lisa_Attack_Normal_04_AttackProperty_01 | 301 |
| 1181004 | 1181001 | Lisa_Normal / Lisa_Attack_Normal_04_AttackProperty_02 | 43 |
| 1181007 | 1181001 | Lisa_Rush / Lisa_Attack_Rush_AttackProperty_01 | 4 |
| 1181007 | 1181001 | Lisa_Rush / Lisa_Attack_Rush_AttackProperty_02 | 2 |
| 1181008 | 1181001 | Lisa_Attack_Counter_BulletType_02_Blow_Target / Lisa_Attack_Counter_AttackProperty_01 | 46 |
| 1181008 | 1181001 | Lisa_Attack_Counter_BulletType_02_Blow_Target / Lisa_Attack_Counter_AttackProperty_02 | 23 |
| 1181011 | 1181001 | Lisa_Attack_BeHitAid_BulletType_02_Blow_Target / Lisa_Attack_BeHitAid_AttackProperty_01 | 38 |
| 1181011 | 1181001 | Lisa_Attack_BeHitAid_BulletType_02_Blow_Target / Lisa_Attack_BeHitAid_AttackProperty_02 | 19 |
| 1181015 | 1181001 | Lisa_Normal / Lisa_Attack_Normal_Move_AttackProperty_01 | 2 |
| 1181015 | 1181001 | Lisa_Normal / Lisa_Attack_Normal_Move_AttackProperty_02 | 1 |
| 1181016 | 1181001 | Lisa_Attack_Branch_01_BulletType_03_Blow_Target_UniqueSkill / Lisa_Attack_Branch_01_AttackProperty_01_UniqueSkill | 49 |
| 1181016 | 1181001 | Lisa_Attack_Branch_01_BulletType_03_Blow_Target_UniqueSkill / Lisa_Attack_Branch_01_AttackProperty_02_UniqueSkill | 49 |
| 1181017 | 1181001 | Lisa_Attack_Branch_02_BulletType_03_Blow_Ground_UniqueSkill / Lisa_Attack_Branch_02_AttackProperty_01_UniqueSkill | 2 |
| 1181017 | 1181001 | Lisa_Attack_Branch_02_BulletType_03_Blow_Ground_UniqueSkill / Lisa_Attack_Branch_02_AttackProperty_02_UniqueSkill | 1 |
| 1181017 | 1181001 | Lisa_Attack_Branch_02_BulletType_03_Blow_Target_UniqueSkill / Lisa_Attack_Branch_02_AttackProperty_01_UniqueSkill | 74 |
| 1181017 | 1181001 | Lisa_Attack_Branch_02_BulletType_03_Blow_Target_UniqueSkill / Lisa_Attack_Branch_02_AttackProperty_02_UniqueSkill | 37 |
| 1181019 | 1181001 | Lisa_Upgrade_Extra_Bullet_01_Blow_Target / Lisa_Attack_Branch_03_Extra_AttackProperty_01 | 16 |
| 1181020 | 1181001 | Lisa_Upgrade_AttachBullet_01 / Lisa_Attack_Branch_03_AttachBullet_AttackProperty_01 | 19 |
| 1181020 | 1181001 | Lisa_Upgrade_AttachBullet_02 / Lisa_Attack_Branch_03_AttachBullet_AttackProperty_02 | 114 |
| 1181020 | 1181001 | Lisa_Upgrade_AttachBullet_02 / Lisa_Attack_Branch_03_AttachBullet_AttackProperty_03 | 19 |
| 1211008 | 1211001 |  / Rina_Anastacia_Attack_Branch_01_AttackProperty_01 | 2 |
| 1211008 | 1211001 |  / Rina_Anastacia_Attack_Branch_01_AttackProperty_02 | 2 |
| 1211008 | 1211001 |  / Rina_Anastacia_Attack_Branch_01_AttackProperty_03 | 2 |
| 1211008 | 1211001 |  / Rina_Anastacia_Attack_Branch_01_AttackProperty_04 | 2 |
| 1211008 | 1211001 |  / Rina_Anastacia_Attack_Branch_01_AttackProperty_05_01 | 2 |
| 1211008 | 1211001 |  / Rina_Anastacia_Attack_Branch_01_AttackProperty_05_02 | 2 |
| 1211009 | 1211001 | Rina_Anastacia_Attack_Branch_02_BulletType_01 / Rina_Anastacia_Attack_Branch_02_AttackProperty_01 | 233 |
| 1211009 | 1211001 | Rina_Anastacia_Attack_Branch_02_BulletType_01 / Rina_Anastacia_Attack_Branch_02_AttackProperty_02_01 | 18 |
| 1211009 | 1211001 | Rina_Anastacia_Attack_Branch_02_BulletType_01 / Rina_Anastacia_Attack_Branch_02_AttackProperty_02_02 | 16 |
| 1211009 | 1211001 | Rina_Anastacia_Attack_Branch_02_BulletType_01 / Rina_Anastacia_Attack_Branch_02_AttackProperty_02_03 | 14 |
| 1211016 | 1211015 |  / Rina_Anastacia_SwitchIn_Attack_AttackProperty_01_01 | 8 |
| 1211016 | 1211015 |  / Rina_Anastacia_SwitchIn_Attack_AttackProperty_01_02 | 28 |
| 1211016 | 1211015 |  / Rina_Anastacia_SwitchIn_Attack_AttackProperty_02 | 2 |
| 1211018 | 1211017 |  / Rina_Anastacia_SwitchIn_Attack_Ex_AttackProperty_01_01 | 28 |
| 1211018 | 1211017 |  / Rina_Anastacia_SwitchIn_Attack_Ex_AttackProperty_01_02 | 64 |
| 1211018 | 1211017 |  / Rina_Anastacia_SwitchIn_Attack_Ex_AttackProperty_02 | 4 |
| 1211023 | 1211001 |  / Rina_Drusilla_Attack_Normal_01_02_FollowAttack_AttackProperty_01 | 30 |
| 1211023 | 1211001 |  / Rina_Drusilla_Attack_Normal_01_02_FollowAttack_AttackProperty_02 | 28 |
| 1211023 | 1211001 |  / Rina_Drusilla_Attack_Normal_01_02_FollowAttack_AttackProperty_03 | 24 |
| 1211024 | 1211001 |  / Rina_Drusilla_Attack_Normal_02_FollowAttack_AttackProperty_01 | 26 |
| 1211024 | 1211001 |  / Rina_Drusilla_Attack_Normal_02_FollowAttack_AttackProperty_02 | 20 |
| 1211024 | 1211001 |  / Rina_Drusilla_Attack_Normal_02_FollowAttack_AttackProperty_03 | 20 |
| 1211024 | 1211001 |  / Rina_Drusilla_Attack_Normal_02_FollowAttack_AttackProperty_04 | 20 |
| 1211024 | 1211001 |  / Rina_Drusilla_Attack_Normal_02_FollowAttack_AttackProperty_05 | 20 |
| 1211024 | 1211001 |  / Rina_Drusilla_Attack_Normal_02_FollowAttack_AttackProperty_06 | 20 |
| 1211024 | 1211001 |  / Rina_Drusilla_Attack_Normal_02_FollowAttack_AttackProperty_07 | 20 |
| 1211025 | 1211001 |  / Rina_Drusilla_Attack_Normal_03_FollowAttack_AttackProperty_01 | 24 |
| 1211025 | 1211001 |  / Rina_Drusilla_Attack_Normal_03_FollowAttack_AttackProperty_02 | 24 |
| 1211025 | 1211001 |  / Rina_Drusilla_Attack_Normal_03_FollowAttack_AttackProperty_03 | 24 |
| 1211026 | 1211001 |  / Rina_Anastacia_Attack_Normal_03_FollowAttack_AttackProperty_01 | 24 |
| 1211026 | 1211001 |  / Rina_Anastacia_Attack_Normal_03_FollowAttack_AttackProperty_02 | 24 |
| 1211026 | 1211001 |  / Rina_Anastacia_Attack_Normal_03_FollowAttack_AttackProperty_03 | 24 |
| 1211027 | 1211001 |  / Rina_Drusilla_Attack_Branch_FollowAttack_AttackProperty_01_01 | 48 |
| 1211027 | 1211001 |  / Rina_Drusilla_Attack_Branch_FollowAttack_AttackProperty_01_02 | 168 |
| 1211027 | 1211001 |  / Rina_Drusilla_Attack_Branch_FollowAttack_AttackProperty_02 | 12 |
| 1561005 | 1561001 | Velina_AttackNormalBullet_05 / Velina_Attack_Normal_05_AttackProperty_02_01 | 1 |
| 1561005 | 1561001 | Velina_AttackNormalBullet_05 / Velina_Attack_Normal_05_AttackProperty_02_02 | 5 |
| 1561005 | 1561001 | Velina_Normal / Velina_Attack_Normal_05_AttackProperty_01 | 4 |
| 1561006 | 1561001 | Velina_ExSp / Velina_Attack_Normal_Enhance_AttackProperty_01 | 34 |
| 1561006 | 1561001 | Velina_ExSp / Velina_Attack_Normal_Enhance_AttackProperty_02 | 6 |
| 1561007 | 1561001 |  / Velina_Attack_WindRegion_AttackProperty_01 | 242 |
| 1561009 | 1561001 | Velina_ExSp / Velina_Attack_Branch_02_01_AttackProperty_01 | 26 |
| 1561009 | 1561001 | Velina_ExSp / Velina_Attack_Branch_02_01_AttackProperty_02 | 13 |
| 1561010 | 1561001 | Velina_ExSp / Velina_Attack_Branch_02_02_AttackProperty_01 | 4 |
| 1561010 | 1561001 | Velina_ExSp / Velina_Attack_Branch_02_02_AttackProperty_02 | 1 |
| 1561010 | 1561001 | Velina_ExSp / Velina_Attack_Branch_02_AttackProperty_03_01 | 4 |
| 1561010 | 1561001 | Velina_ExSp / Velina_Attack_Branch_02_AttackProperty_03_02 | 1 |
| 1561015 | 1561001 | Velina_BeHitAid / Velina_Attack_BeHitAid_AttackProperty_01_01 | 1 |
| 1561015 | 1561001 | Velina_BeHitAid / Velina_Attack_BeHitAid_AttackProperty_01_02 | 1 |
| 1561015 | 1561001 | Velina_BeHitAid / Velina_Attack_BeHitAid_AttackProperty_02 | 4 |
| 1561015 | 1561001 | Velina_BeHitAid / Velina_Attack_BeHitAid_AttackProperty_03 | 1 |
| 1561020 | 1561001 | Velina_WindRegion_Controller / Velina_Attack_WindRegion_ExtraDamage_AttackProperty_01_Elec | 110 |
| 1561021 | 1561001 | Velina_SmallWind_Bullet / Velina_Attack_SmallWind_AttackProperty_01 | 78 |
| 1561021 | 1561001 | Velina_SmallWind_Bullet / Velina_Attack_SmallWind_AttackProperty_02 | 13 |

Settlement accounting is NOT identical using display alone (anomalies kept separate): 35 changed skill buckets (damage or row count): `1011011, 1181001, 1181002, 1181003, 1181004, 1181007, 1181008, 1181011, 1181015, 1181016, 1181017, 1181019, 1181020, 1211001, 1211008, 1211009, 1211015, 1211016, 1211017, 1211018, 1211023, 1211024, 1211025, 1211026, 1211027, 1511001, 1561001, 1561005, 1561006, 1561007, 1561009, 1561010, 1561015, 1561020, 1561021`.

### identity disagreements

| Baseline skill | Candidate skill | Ability / AttackProperty | Hits |
|---|---|---|---:|
| (blank) | 112303 | Cottus_P1_ATK_03 / Monster_Cottus_ATK03_Attackproperty_01_01 | 1 |
| (blank) | 112303 | Cottus_P1_ATK_03 / Monster_Cottus_ATK03_Attackproperty_02 | 3 |
| (blank) | 112303 | Cottus_P1_ATK_03 / Monster_Cottus_ATK03_Attackproperty_04 | 1 |
| (blank) | 112304 | Cottus_P1_ATK_04 / Monster_Cottus_ATK04_Attackproperty_01 | 1 |
| (blank) | 112304 | Cottus_P1_ATK_04 / Monster_Cottus_ATK04_Attackproperty_02 | 2 |
| (blank) | 112304 | Cottus_P1_ATK_04 / Monster_Cottus_ATK04_Attackproperty_03 | 1 |
| (blank) | 112309 | Cottus_P1_EvadeSlash / Monster_Cottus_EvadeATK_Attackproperty_01_01 | 1 |
| anomaly | 1181019 | Player_ElementAbnormalBuff /  | 16 |
| anomaly | 1561014 | Player_ElementAbnormalBuff /  | 3 |

Settlement accounting is NOT identical using identity alone (anomalies kept separate): 6 changed skill buckets (damage or row count): `112303, 112304, 112309, 1181020, 1561020, 1561021`.

### Identity coverage gaps

| Baseline skill | Ability / AttackProperty | Hits |
|---|---|---:|
| (blank) |  / Rina_Anastacia_Attack_Branch_FollowAttack_AttackProperty_01_01 | 48 |
| (blank) |  / Rina_Anastacia_Attack_Branch_FollowAttack_AttackProperty_01_02 | 168 |
| (blank) |  / Rina_Anastacia_Attack_Branch_FollowAttack_AttackProperty_02 | 10 |
| (blank) |  / Velina_Attack_WindRegion_AttackProperty_02 | 26 |
| (blank) | Velina_WindRegion_Controller / Velina_Attack_WindRegion_ExtraDamage_AttackProperty_01_WindFake | 134 |
| 1181020 | Lisa_Upgrade_AttachBullet_01 / Lisa_Attack_Branch_03_AttachBullet_AttackProperty_01 | 19 |
| 1181020 | Lisa_Upgrade_AttachBullet_02 / Lisa_Attack_Branch_03_AttachBullet_AttackProperty_02 | 114 |
| 1181020 | Lisa_Upgrade_AttachBullet_02 / Lisa_Attack_Branch_03_AttachBullet_AttackProperty_03 | 19 |
| 1561020 | Velina_WindRegion_Controller / Velina_Attack_WindRegion_ExtraDamage_AttackProperty_01_Elec | 110 |
| 1561021 | Velina_SmallWind_Bullet / Velina_Attack_SmallWind_AttackProperty_01 | 78 |
| 1561021 | Velina_SmallWind_Bullet / Velina_Attack_SmallWind_AttackProperty_02 | 13 |
| anomaly | Player_ElementAbnormalBuff /  | 73 |

## 20260919-170200-bangboo

512 complete hits; baseline sources: `{'unmapped': 28, 'map': 474, 'name': 10}`.

| Candidate | Agreement | Different answer | No answer |
|---|---:|---:|---:|
| display | 39 | 458 | 15 |
| identity | 420 | 9 | 83 |

Agreement compares to the baseline skill_id, including blank/unmapped and anomaly rows. Different answers on previously blank rows are newly available attribution, not contradictory mapped skills. No ambiguous identity sets occurred.

### display disagreements

| Baseline skill | Candidate skill | Ability / AttackProperty | Hits |
|---|---|---|---:|
| (blank) | 1011011 | Velina_WindRegion_Controller / Velina_Attack_WindRegion_ExtraDamage_AttackProperty_01_WindFake | 17 |
| (blank) | 1511001 |  / Velina_Attack_WindRegion_AttackProperty_02 | 2 |
| (blank) | 1511001 | NangongYu_Normal / NangongYu_Attack_Normal_01_AttackProperty_01 | 2 |
| (blank) | 1511001 | NangongYu_Rush / NangongYu_Attack_Rush_AttackProperty_01 | 1 |
| (blank) | 1511001 | NangongYu_Rush / NangongYu_Attack_Rush_AttackProperty_02 | 1 |
| 1181002 | 1181001 | Lisa_Normal / Lisa_Attack_Normal_02_AttackProperty_01 | 14 |
| 1181002 | 1181001 | Lisa_Normal / Lisa_Attack_Normal_02_AttackProperty_02 | 7 |
| 1181003 | 1181001 | Lisa_Attack_Normal_03_BulletType_Blow_Target / Lisa_Attack_Normal_03_AttackProperty_03 | 17 |
| 1181003 | 1181001 | Lisa_Normal / Lisa_Attack_Normal_03_AttackProperty_01 | 27 |
| 1181003 | 1181001 | Lisa_Normal / Lisa_Attack_Normal_03_AttackProperty_02 | 18 |
| 1181004 | 1181001 | Lisa_Normal / Lisa_Attack_Normal_04_AttackProperty_01 | 63 |
| 1181004 | 1181001 | Lisa_Normal / Lisa_Attack_Normal_04_AttackProperty_02 | 9 |
| 1181005 | 1181001 | Lisa_Attack_Branch_01_BulletType_03_Blow_Target / Lisa_Attack_Branch_01_AttackProperty_01 | 1 |
| 1181005 | 1181001 | Lisa_Attack_Branch_01_BulletType_03_Blow_Target / Lisa_Attack_Branch_01_AttackProperty_02 | 1 |
| 1181007 | 1181001 | Lisa_Rush / Lisa_Attack_Rush_AttackProperty_01 | 4 |
| 1181007 | 1181001 | Lisa_Rush / Lisa_Attack_Rush_AttackProperty_02 | 2 |
| 1181008 | 1181001 | Lisa_Attack_Counter_BulletType_02_Blow_Target / Lisa_Attack_Counter_AttackProperty_01 | 6 |
| 1181008 | 1181001 | Lisa_Attack_Counter_BulletType_02_Blow_Target / Lisa_Attack_Counter_AttackProperty_02 | 3 |
| 1181011 | 1181001 | Lisa_Attack_BeHitAid_BulletType_02_Blow_Target / Lisa_Attack_BeHitAid_AttackProperty_01 | 4 |
| 1181011 | 1181001 | Lisa_Attack_BeHitAid_BulletType_02_Blow_Target / Lisa_Attack_BeHitAid_AttackProperty_02 | 2 |
| 1181015 | 1181001 | Lisa_Normal / Lisa_Attack_Normal_Move_AttackProperty_01 | 4 |
| 1181015 | 1181001 | Lisa_Normal / Lisa_Attack_Normal_Move_AttackProperty_02 | 2 |
| 1181016 | 1181001 | Lisa_Attack_Branch_01_BulletType_03_Blow_Target_UniqueSkill / Lisa_Attack_Branch_01_AttackProperty_01_UniqueSkill | 10 |
| 1181016 | 1181001 | Lisa_Attack_Branch_01_BulletType_03_Blow_Target_UniqueSkill / Lisa_Attack_Branch_01_AttackProperty_02_UniqueSkill | 10 |
| 1181017 | 1181001 | Lisa_Attack_Branch_02_BulletType_03_Blow_Target_UniqueSkill / Lisa_Attack_Branch_02_AttackProperty_01_UniqueSkill | 16 |
| 1181017 | 1181001 | Lisa_Attack_Branch_02_BulletType_03_Blow_Target_UniqueSkill / Lisa_Attack_Branch_02_AttackProperty_02_UniqueSkill | 8 |
| 1181020 | 1181001 | Lisa_Upgrade_AttachBullet_01 / Lisa_Attack_Branch_03_AttachBullet_AttackProperty_01 | 4 |
| 1181020 | 1181001 | Lisa_Upgrade_AttachBullet_02 / Lisa_Attack_Branch_03_AttachBullet_AttackProperty_02 | 24 |
| 1181020 | 1181001 | Lisa_Upgrade_AttachBullet_02 / Lisa_Attack_Branch_03_AttachBullet_AttackProperty_03 | 4 |
| 1211009 | 1211001 | Rina_Anastacia_Attack_Branch_02_BulletType_01 / Rina_Anastacia_Attack_Branch_02_AttackProperty_01 | 26 |
| 1211009 | 1211001 | Rina_Anastacia_Attack_Branch_02_BulletType_01 / Rina_Anastacia_Attack_Branch_02_AttackProperty_02_01 | 2 |
| 1211009 | 1211001 | Rina_Anastacia_Attack_Branch_02_BulletType_01 / Rina_Anastacia_Attack_Branch_02_AttackProperty_02_02 | 2 |
| 1211009 | 1211001 | Rina_Anastacia_Attack_Branch_02_BulletType_01 / Rina_Anastacia_Attack_Branch_02_AttackProperty_02_03 | 2 |
| 1211011 | 1211001 |  / Rina_Drusilla_Attack_Rush_AttackProperty_01 | 2 |
| 1211011 | 1211001 |  / Rina_Drusilla_Attack_Rush_AttackProperty_02 | 2 |
| 1211011 | 1211001 |  / Rina_Drusilla_Attack_Rush_AttackProperty_03 | 2 |
| 1211011 | 1211001 |  / Rina_Drusilla_Attack_Rush_AttackProperty_04 | 2 |
| 1211011 | 1211001 |  / Rina_Drusilla_Attack_Rush_AttackProperty_05 | 2 |
| 1211011 | 1211001 |  / Rina_Drusilla_Attack_Rush_AttackProperty_06 | 2 |
| 1211011 | 1211001 |  / Rina_Drusilla_Attack_Rush_AttackProperty_07 | 2 |
| 1211011 | 1211001 |  / Rina_Drusilla_Attack_Rush_AttackProperty_08 | 2 |
| 1211011 | 1211001 |  / Rina_Drusilla_Attack_Rush_AttackProperty_09 | 2 |
| 1211011 | 1211001 |  / Rina_Drusilla_Attack_Rush_AttackProperty_10 | 2 |
| 1211012 | 1211001 |  / Rina_Anastacia_Attack_Rush_AttackProperty_01 | 2 |
| 1211012 | 1211001 |  / Rina_Anastacia_Attack_Rush_AttackProperty_02 | 2 |
| 1211012 | 1211001 |  / Rina_Anastacia_Attack_Rush_AttackProperty_03 | 2 |
| 1211012 | 1211001 |  / Rina_Anastacia_Attack_Rush_AttackProperty_04 | 2 |
| 1211012 | 1211001 |  / Rina_Anastacia_Attack_Rush_AttackProperty_05 | 2 |
| 1211012 | 1211001 |  / Rina_Anastacia_Attack_Rush_AttackProperty_06 | 2 |
| 1211012 | 1211001 |  / Rina_Anastacia_Attack_Rush_AttackProperty_07 | 2 |
| 1211012 | 1211001 |  / Rina_Anastacia_Attack_Rush_AttackProperty_08 | 2 |
| 1211012 | 1211001 |  / Rina_Anastacia_Attack_Rush_AttackProperty_09 | 2 |
| 1211012 | 1211001 |  / Rina_Anastacia_Attack_Rush_AttackProperty_10 | 2 |
| 1211023 | 1211001 |  / Rina_Drusilla_Attack_Normal_01_02_FollowAttack_AttackProperty_01 | 4 |
| 1211023 | 1211001 |  / Rina_Drusilla_Attack_Normal_01_02_FollowAttack_AttackProperty_02 | 4 |
| 1211023 | 1211001 |  / Rina_Drusilla_Attack_Normal_01_02_FollowAttack_AttackProperty_03 | 4 |
| 1211024 | 1211001 |  / Rina_Drusilla_Attack_Normal_02_FollowAttack_AttackProperty_01 | 4 |
| 1211024 | 1211001 |  / Rina_Drusilla_Attack_Normal_02_FollowAttack_AttackProperty_02 | 2 |
| 1211024 | 1211001 |  / Rina_Drusilla_Attack_Normal_02_FollowAttack_AttackProperty_03 | 2 |
| 1211024 | 1211001 |  / Rina_Drusilla_Attack_Normal_02_FollowAttack_AttackProperty_04 | 2 |
| 1211024 | 1211001 |  / Rina_Drusilla_Attack_Normal_02_FollowAttack_AttackProperty_05 | 2 |
| 1211024 | 1211001 |  / Rina_Drusilla_Attack_Normal_02_FollowAttack_AttackProperty_06 | 2 |
| 1211024 | 1211001 |  / Rina_Drusilla_Attack_Normal_02_FollowAttack_AttackProperty_07 | 2 |
| 1211025 | 1211001 |  / Rina_Drusilla_Attack_Normal_03_FollowAttack_AttackProperty_01 | 2 |
| 1211025 | 1211001 |  / Rina_Drusilla_Attack_Normal_03_FollowAttack_AttackProperty_02 | 2 |
| 1211025 | 1211001 |  / Rina_Drusilla_Attack_Normal_03_FollowAttack_AttackProperty_03 | 2 |
| 1211026 | 1211001 |  / Rina_Anastacia_Attack_Normal_03_FollowAttack_AttackProperty_01 | 2 |
| 1211026 | 1211001 |  / Rina_Anastacia_Attack_Normal_03_FollowAttack_AttackProperty_02 | 2 |
| 1211026 | 1211001 |  / Rina_Anastacia_Attack_Normal_03_FollowAttack_AttackProperty_03 | 2 |
| 1561006 | 1561001 | Velina_ExSp / Velina_Attack_Normal_Enhance_AttackProperty_01 | 5 |
| 1561006 | 1561001 | Velina_ExSp / Velina_Attack_Normal_Enhance_AttackProperty_02 | 1 |
| 1561007 | 1561001 |  / Velina_Attack_WindRegion_AttackProperty_01 | 32 |
| 1561009 | 1561001 | Velina_ExSp / Velina_Attack_Branch_02_01_AttackProperty_01 | 2 |
| 1561009 | 1561001 | Velina_ExSp / Velina_Attack_Branch_02_01_AttackProperty_02 | 1 |
| 1561020 | 1561001 | Velina_WindRegion_Controller / Velina_Attack_WindRegion_ExtraDamage_AttackProperty_01_Elec | 8 |
| 1561021 | 1561001 | Velina_SmallWind_Bullet / Velina_Attack_SmallWind_AttackProperty_01 | 12 |
| 1561021 | 1561001 | Velina_SmallWind_Bullet / Velina_Attack_SmallWind_AttackProperty_02 | 2 |

Settlement accounting is NOT identical using display alone (anomalies kept separate): 28 changed skill buckets (damage or row count): `1011011, 1181001, 1181002, 1181003, 1181004, 1181005, 1181007, 1181008, 1181011, 1181015, 1181016, 1181017, 1181020, 1211001, 1211009, 1211011, 1211012, 1211023, 1211024, 1211025, 1211026, 1511001, 1561001, 1561006, 1561007, 1561009, 1561020, 1561021`.

### identity disagreements

| Baseline skill | Candidate skill | Ability / AttackProperty | Hits |
|---|---|---|---:|
| (blank) | 112303 | Cottus_P1_ATK_03 / Monster_Cottus_ATK03_Attackproperty_02 | 2 |
| (blank) | 112305 | Cottus_P1_ATK_05 / Monster_Cottus_ATK05_Attackproperty_01 | 2 |
| (blank) | 112305 | Cottus_P1_ATK_05 / Monster_Cottus_ATK05_Attackproperty_02 | 1 |
| (blank) | 1511001 | NangongYu_Normal / NangongYu_Attack_Normal_01_AttackProperty_01 | 2 |
| (blank) | 1511009 | NangongYu_Rush / NangongYu_Attack_Rush_AttackProperty_01 | 1 |
| (blank) | 1511009 | NangongYu_Rush / NangongYu_Attack_Rush_AttackProperty_02 | 1 |

Settlement accounting is NOT identical using identity alone (anomalies kept separate): 7 changed skill buckets (damage or row count): `112303, 112305, 1181020, 1511001, 1511009, 1561020, 1561021`.

### Identity coverage gaps

| Baseline skill | Ability / AttackProperty | Hits |
|---|---|---:|
| (blank) |  / Velina_Attack_WindRegion_AttackProperty_02 | 2 |
| (blank) | Velina_WindRegion_Controller / Velina_Attack_WindRegion_ExtraDamage_AttackProperty_01_WindFake | 17 |
| 1181020 | Lisa_Upgrade_AttachBullet_01 / Lisa_Attack_Branch_03_AttachBullet_AttackProperty_01 | 4 |
| 1181020 | Lisa_Upgrade_AttachBullet_02 / Lisa_Attack_Branch_03_AttachBullet_AttackProperty_02 | 24 |
| 1181020 | Lisa_Upgrade_AttachBullet_02 / Lisa_Attack_Branch_03_AttachBullet_AttackProperty_03 | 4 |
| 1561020 | Velina_WindRegion_Controller / Velina_Attack_WindRegion_ExtraDamage_AttackProperty_01_Elec | 8 |
| 1561021 | Velina_SmallWind_Bullet / Velina_Attack_SmallWind_AttackProperty_01 | 12 |
| 1561021 | Velina_SmallWind_Bullet / Velina_Attack_SmallWind_AttackProperty_02 | 2 |
| anomaly | Player_ElementAbnormalBuff /  | 10 |

## Baseline caveat

The archived full180 settlement-check.json predates Daze bookkeeping in stunWindows. Running the untouched current decoder already adds dazeBefore, dazeBeforeRows, dazeBeforeByAttacker, lastDazeHit and dazeDuringStun fields. Its perSkill totals are unchanged (36 exact, 0 mismatched). The bangboo archived report is byte-identical to current baseline (25 exact, 0 mismatched). Both have Plugboo as a log-only skill. Byte regression below uses the current decoder baseline, not the stale full180 file.

The update playbook describes the existing 3.3.0 byte regression, but no executable test for it exists in tools/. Re-run that documented check using 20260913-035206-final and compare all decoded columns except deliberately changed attribution/source.

## Candidate settlement regeneration

Temporary decoder variants forced each candidate (with anomaly classification retained), and regenerated settlement-check.json with all numeric IDs included. Neither matched the baseline bytes. Display-first with identity fallback has the same direct-hit outcome as display alone: every non-anomaly row already has a nonzero display ID except enemy rows, where identity only adds further non-settlement skills.

| Capture | Candidate | Exact | Mismatched | Settlement-only | Log-only | Byte identical |
|---|---|---:|---:|---:|---:|---|
| 20260918-full180 | display | 6 | 2 | 30 | 4 | no |
| 20260919-170200-bangboo | display | 0 | 2 | 25 | 4 | no |
| 20260918-full180 | identity | 33 | 0 | 5 | 4 | no |
| 20260919-170200-bangboo | identity | 22 | 0 | 5 | 5 | no |

## Implemented policy and compatibility

`skill_id` now uses unambiguous capture-local effect identity first, with the optional map as fallback. Every mapped-name disagreement is printed to stderr; ambiguous pointer sets are reported and never arbitrarily resolved. `display_skill_id` remains a raw diagnostic column, not a fallback. With no hits.tsv, the existing map fallback still works; with no map file, identity still works and a notice explains the missing fallback. Missing both leaves raw names and unmapped IDs, not guessed skills.

Anomaly ticks stay `skill_id=anomaly`, `skill_id_source=name`. The triggering AttackProperty in `a8_str18` and any inherited effect pointer are provenance, not a settlement skill for the anomaly instance. Plugboo: all 45/full180 and 10/bangboo hits now use identity. The only mapped direct-hit gaps in these two captures are 1181020 (152/32), 1561020 (110/8), and 1561021 (91/14). Those 353/54 rows retain map fallback. No other mapped direct hits disagree.

To honor byte-identical settlement reports, default settlement accounting includes all skills actually present in the settlement, plus the previous map/name scope for historical log-only entries. Newly attributed enemy/guest rows absent from the settlement remain in the report's unattributed pool. New Agents present in the settlement reconcile without map entries. The map serves as a scope manifest, not the value source: a disagreeing derived skill is never overwritten. The CSV always includes the new IDs. Pass `--all-skills` to include every derived skill in settlement-check.json (including enemy/guest log-only skills); when the map is absent, all derived skills are included automatically. This default compatibility restriction is explicitly separate from CSV attribution and does not imply enemy damage belongs to the player's settlement.

| Capture | Before sources | After sources | Current-baseline report bytes |
|---|---|---|---|
| full180 | map 3218, unmapped 396, name 92 | identity 2875, map 353, unmapped 386, name 92 | identical |
| bangboo | map 474, unmapped 28, name 10 | identity 429, map 54, unmapped 19, name 10 | identical |
| 3.3.0 / 20260913-035206-final | map 1421, unmapped 143, name 37 | identity 1271, map 153, unmapped 140, name 37 | identical |

The 3.3.0 layout constants are unchanged. All existing columns and their order are unchanged, and every non-attribution decoded value is identical across all three captures. Existing nonblank skill IDs are identical. Intentional changes: 10/9/3 formerly unmapped rows gain skill IDs and covered rows change skill_id_source. Readable exports retain 3706/512/1601 rows. No state-names.csv or client assets are present in the scratch captures used by these tests.

The regression is executable as:

```
node tools/test-attribution.mjs
node tools/test-attribution-capture.mjs <scratch-capture> <before-per-hit-log.csv> <before-settlement-check.json>
```

The capture test runs both decoders, checks every original column/value (permitting new IDs on previously blank rows), compares report bytes, and checks readable row count. Baselines must come from the previous decoder. The two pre-existing tools tests are test-inspect-damage-probe.mjs and test-export-result-properties.py; the playbook's earlier 3.3.0 regression was documented, not a separate checked-in executable.

## Generated public naming data

Regenerate with `node tools/generate-codenames.mjs <ZenlessBetaData> ZenlessBetaData@964c0036`.
This is the exact local data revision; the checkout has no reliable client-version tag, so it is not mislabeled as the capture's 3.3.2 version. The JSON header records that revision. The generator emits 485 entries, with 166 untranslated names retained raw. It cross-references AvatarBaseTemplateTb.unk_16 and avatar localization keys with AvatarAbility folder names (including case aliases), and BuddyBattleTemplateTb.FONBHALHDIJ/string lists with BuddyBaseTemplateTb localization keys. BuddyBase alone does not contain a codename. Monster encounter tables alone do not contain all display names: MonsterConfigTemplateTb supplies entity codenames; OfficialName_Monster_* text keys, referenced by monster card tables, supply their English names.

Validated anchors: Lisa -> Grace; Bangboo_Plugboo -> Plugboo; Monster_Cottus -> Newborn Dead End Butcher. The generator checks these anchors and rejects conflicting names. Unknown entities use raw codenames (including Bangboo_/Monster_ namespaces), and prefixes are stripped using longest matching table keys. If a capture provides no name on any row for an entity, the only available identity is its raw full address; the decoder does not invent a codename or a truncated entity label.

The old element table was unused and emitted no element column. It has been removed rather than replacing it with unverified element metadata. Damage modifiers retain their captured names. Names do not add combat-stat logic.

## Public-release audit

- tools/update/paths.py now defaults to this repo's gitignored local-data/; THAUMIEL_LOCAL_DATA still overrides it. This removes the sibling sheet-webapp assumption.
- A case-insensitive scan of tools/ found no remaining personal absolute paths, machine-name references, or sibling-repo assumptions in maintained tools after that change. The pre-existing untracked discovery/rip-xref.py was inspected only, never edited.
- No tools/ script consumes state-names.csv or name-capture-states.mjs output. events-timeline.mjs generates raw state/projectile reports from events.tsv and hits.tsv; it does not need annotated state names.
- Existing .gitignore excludes local-data/, all *.tsv, *.pb and *.dmp, plus binaries and caches. Captures/client data are excluded when kept under local-data/. Arbitrary exported JSON/CSV or a client-data directory outside local-data/ is NOT universally ignored; keep those inputs/outputs under local-data/. No .gitignore edit was needed within this tools/docs-only task.
- Remaining squad-specific release review: attack-property-skill-map.json is intentionally retained as regression/fallback data; discovery/claude-hits-readable.cjs embeds squad-specific agent/skill/split labels and needs exclusion or regeneration for a public general-purpose surface; share-combat-results.py embeds capture-specific ACTORS entity numbers and needs exclusion or replacement with capture-derived names. events-timeline.mjs has squad names in explanatory comments, not a required name map. per-hit-log.mjs retains historical validation examples in comments. New naming tests contain explicit anchor examples, not production name tables.
- Full attribution of arbitrary non-animation damage is NOT established: unknown Agents' bypass-path hits still require a future generic source or verified fallback data. This change removes per-squad setup for identity-covered hits and public readable naming; it does not claim the uncovered bypass paths are solved.
  - 2026-09-28: bypass-path hits that carry an AttackProperty name are now covered by the client-config fallback below. Rows the game settles with no skill id at all (RemielleOrigin_UniqueSkill Luminize, Pheony_UniqueSkill, Sunna's Cat's Gaze detonations) get no id here. `readable-log.mjs` labels the Core Passive ones by their owner (below); where they are settled (an Anomaly bucket, the Agent's unitemized direct damage, or another Agent's skill-0 row) is decided against the settlement, which these readers do not do.

## Client-config fallback for projectile hits (2026-09-28)

Projectile/bullet hits never pass through TriggerAttackPattern, so they have no hits.tsv row for identity to join on. Before this change they fell to the hand map, or stayed unmapped for any Agent without one. Astra Yao's Tone Cluster bullets were an example: 344,759 damage, settlement-only, on a 2026-09-28 capture.

The client names the skill itself. Every ConfigEntityAnimEvent whose `ActiveDynamicProp.IsOverrideDynamicProp` is true carries the skill id in `OverrdieDynamicPropKey` (the client's spelling). `tools/attack-property-client-skills.json` holds that table for every Agent and Bangboo as `map` (name -> skill id, one entry per line, 367 KB). `OverrideDynamicPropKey2` is kept separately under `alt`, for reference only. `attribute()` uses the table last: identity first, then attack-property-skill-map.json, then this table (source `client`).

Regenerate after a client patch or hotfix from the decoded roster extract. List directories oldest first; a later directory's file replaces the same-named one, matching how the hotfix tree works:

```
node tools/generate-attack-property-skills.mjs "CNBetaWin3.3.4 + hotfix 19293654" <client-extract-3.3.4>/decoded <client-extract-19293654>/decoded
```

The current table maps 6,075 names from 142 files. 132 names exist both in an Agent's file and in its `_MusicBattleActivity` event copy (Aria, Summer) with different ids. The base file wins for that exact shape only; any other conflict is left out of the map and listed under `conflicts`.

Validation before adoption:

- It agrees with all 231 attack-property-skill-map.json entries.
- It agrees with all 126,197 identity/map-attributed rows across 67 private per-hit logs, with 0 disagreements. The only names it lacks are the enemy's (Monster_Cottus_*) and Velina_Attack_WindRegion_AttackProperty_02, which has no override.
- Settlement check, committed tools vs this change, same capture:
  - an Evelyn / Roxy / Astra Yao run (no hand entries): 38 -> 43 exact; settlement-only 348,750 -> 0.
  - phoenix-3837: 32 -> 35 exact; settlement-only 289,126 -> 0. The new rows are 1561020 Velina Fire field extra (247,256), 1581022 Remielle AirState_Back_Explode_01 (41,870) and 1641016 Pheony ParryAid_H (0 damage, Daze only).
  - Mismatches: 0 in both runs.
  - 24 private reference captures, regenerated into scratch copies:
    - Never worse on any run.
    - Every Phoenix run ends with 0 settlement-only damage (it was 262k–304k each).
    - The SNS runs go from 25–29 to 31–36 skills exact, with Norma's EX projectiles named.
    - What the SNS runs still leave is Sunna's Cat's Gaze, a skill-0 row under Severian (the
      triggering Agent), which has no skill id to find.

## In-game names in the readable log (2026-09-28)

`readable-log.mjs` writes the in-game action into `ability`, e.g. "Ultimate: Annihilating
Windstorm" rather than "Attack SwitchIn Attack Ex #06". The client's internal name moves to a new
`client_name` column. The names come from `tools/skill-display-names.json`: skill id -> [Agent,
action], plus each Agent's Core Passive title and codename -> name. That table is generated by the
KodieCalcs calculator's naming tools (not part of this repo) and holds names only. Without the table the log keeps the client names, as before.

Helpers live in `tools/display-names.mjs` and are tested by `tools/test-display-names.mjs`:

- **Attacker:** named by the skills that entity used, so a Bangboo missing from codenames.json
  still reads as its name ("Ultra Jake", not "Bangboo_Ultraboo"). An entity with no known skill
  (the enemy) keeps its codename.
- **Core Passive rows:** they carry no skill id. They read as the owner's Core Passive, naming the
  owner when the game credits another Agent. Sunna's Cat's Gaze burst lands as the triggering
  Agent's hit: "Sunna's Core Passive: Cuteness Is Justice".
- **Summon copies:** a summon's zero-damage copy of its Agent's hit is left out, by the run
  export's rule: same attack, same target, within 20 ms, matching resources. On a 2026-09-28
  Severian / Norma / Sunna run that removed 1,060 duplicate rows. Every remaining row has an
  in-game name except the enemy's own attacks.
