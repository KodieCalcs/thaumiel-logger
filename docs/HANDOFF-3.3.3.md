# Handoff: CNBetaWin3.3.3 client update

> Latest update 2026-09-23: read [hooks-333-validation.md](hooks-333-validation.md).
> Energy and all remaining active probe join-check fields are recovered. State, animator-event
> and time-scale hooks are re-pinned, the DLL builds, and offline pin/native/app tests pass.
> **Live verification passed** in session 20260923-035932-12828, including a settlement with
> 32 exact skill totals and zero mismatches. No further hook-restoration test is needed. The sections below are
> historical. Crit at 0xe4 is confirmed; its old rejection and unresolved-field list are superseded.



Written 2026-09-22/23 for an agent picking this up cold. The client patched 3.3.2 -> 3.3.3 and the
capture stack has been re-pointed. **Most of it works.** What remains is a short list of decoder-side
field offsets, derived by measurement against a capture, needing no rebuild and no client launch.

Read `docs/client-update-playbook.md` (its 3.3.3 sections, at the end) for the full method and
evidence. This file is the state, the next steps, and the traps.

---

## 1. Where everything is

| Thing | Location |
|---|---|
| This repo, working branch | `~/thaumiel`, branch **`3.3.3`** (NOT `per-hit-logger`, which is the 3.3.2 line) |
| Commits, oldest first | `eaee0cb` bootstrap, `89ea5d1` upstream merge, `97271b4` RVA table, `99ecd58` damage targets, `ffd8159` field offsets, `b2221f3` probe re-point, `f3a3ef9` + `a25b1e6` + `33f6f39` decoder |
| Client (runs on a separate machine over SMB) | `\\<game machine>\<client folder>\` (the folder `remielle.exe` runs from) |
| DLL deployed there now | `thaumiel.dll`, SHA256 `e125502d3b02d75f24ecd25bdf818b4c11aa5820e3c7f893c368ecff0a96ff77` |
| Client binaries snapshot | `sheet-webapp/local-data/client-binaries-CNBetaWin3.3.3/` (and `-3.3.2/` as the diff base) |
| il2cpp dump | `sheet-webapp/local-data/il2cpp-dump/CNBetaWin3.3.3/` (140 MB tsv + `index.pkl`) |
| **The 3.3.3 capture to work from** | `sheet-webapp/local-data/damage-probe-captures/20260923-024209-333-first/` — result/daze/anomaly/snapshot TSVs, `endbattle_1.pb` + loadout, `per-hit-log.csv`, and the derivation scripts as `derivation-*.py` |
| Settlement archive | `sheet-webapp/local-data/settlements/` (86 `.pb` + loadouts) |

**Toolchain gotcha:** `tools/update/*.py` and `tools/discovery/disfn.py` resolve `local-data`
relative to THIS repo, which has none. Every invocation needs:

```
export THAUMIEL_LOCAL_DATA=<path to your local-data folder>
```

zig is not on PATH: `sheet-webapp/local-data/tools/zig-x86_64-windows-0.16.0/zig.exe`.
Build with `zig build -Doptimize=ReleaseFast --global-cache-dir .zig-global-cache`.
There is **no `zig build test` step** — tests are per file (`zig test src/runtime_readiness.zig`).

## 2. What works

Verified live on capture `20260923-024209-28536`:

- `Validated CNBetaWin3.3.3` — all 194 API RVAs and all 7 code checks pass.
- `hitlog` and `capture` hook cleanly. They self-locate by name through the dumper, so they needed
  **no manual re-pointing at all** — that design paid off.
- All five damage probes install: `string 1 result 1 snapshot 1 daze 1 anomaly 1`.
- The decoder pairs **1046/1046** daze rows and **397/397** anomaly rows to result pointers, none
  unpaired. Stun windows, gauge caps and attribution all resolve.

`numeric -3`, `event -3`, `enqueue -3` are **expected**: those are historical discovery probes,
deliberately not re-pointed. Only `string` matters, because all four data probes return `-7` unless
`damage_probe_original` is set.

## 3. What is left — the actual task

`tools/per-hit-log.mjs`, the `"CNBetaWin3.3.3"` entry in `LAYOUTS`. These are `null` and render as
blank columns:

`crit`, `atk`, `impact`, `anomaly_mastery`, `anomaly_proficiency`, `hit_split`, `dmg_mv`,
`daze_mv`, `energy`, `decibels`, `level`, `display_skill_id`, `attacker_entity`, `target_entity`,
`dmg_mult`, `f11c`, `f174`, `f0f8`, `snapshot_atk`.

`judge-capture.mjs` cannot run end to end without at least `atk` and `crit`.

**This is all JavaScript.** The C probe dumps the first **0x290 bytes of the result object raw**, so
every one of these lives in data you already have. No rebuild, no client launch.

### The method that works

1. Get ground truth for the field from somewhere independent.
2. Scan all offsets in `result_hex` for the one matching it per hit.
3. Join per hit: `result_ptr` AND `elapsed_ms` within 50 ms. Joining on the pointer alone is wrong —
   pointers are reused across the battle.

Ground truth already used successfully:

- **damage** → the settlement's per-avatar totals. `endbattle_1.pb` sums to 23,448,044; offset
  `0x12c` sums to 23,718,802 (+1.15%, the difference being the Bangboo, absent from avatar totals).
  Next best candidate was off by 81%.
- **daze / daze_requested** → the daze probe logs `cur_before` and `target_value`, so applied is
  `target - cur`. Both `0xd4` and `0x1a0` match 92% of rows; they are equal on 532 of 533 non-zero
  rows and diverge exactly once at the MaxStun clamp, which orders them.
- **target_state** → time clustering. Its value-3 rows fall in 2 windows; the other six candidates
  scattered over 7-17. A Stun is a window.

For what remains, the natural ground truth is the **resolved build stats** (ATK, Impact, Anomaly
Mastery, Anomaly Proficiency). `endbattle_1_loadout.json` has the raw Drive Disc properties but NOT
computed totals — resolving those is what `sheet-webapp/src/engine/build/` does. Easiest path: get the
numbers from the user or from sheet-webapp's resolver, then scan for offsets constant per attacker and
equal to them.

`derivation-*.py` in the capture folder are the working scripts — adapt rather than rewrite.

## 4. Traps. Please read this section

Each of these cost real time or produced a wrong answer that looked right.

1. **Byte matching does not work on the damage targets.** They live in the `il2cpp` section
   (generated code, re-emitted per build rather than relocated). `masked_match.py` resolved 1 of 4.
   Use `tools/update/shapematch.py` — the *mnemonic sequence* survives re-emission. It gave 100%
   matches with 49-56 point gaps.

2. **Never infer a field offset from class layout.** The result object has 156 fields, 53 of them
   `System.Single`, and by-index type agreement between builds is 26/156. For the one offset with
   independent ground truth (`0x18c -> 0xd4`), layout alignment guessed `0x18e` as a `Boolean` —
   wrong type, wrong field. Field declaration order is shuffled every build, so positional
   comparison is meaningless.

3. **A whole-`.text` byte-similarity check at a fixed shift means nothing.** It reads ~7-10% because
   functions move by *different* amounts. I briefly concluded the il2cpp runtime had been rebuilt
   from this. It had not.

4. **Same trap in class form:** I reported that the timescale class had been restructured
   (`Single` -> `Double`) from a positional field comparison. It has not. Its type *multiset* is
   identical between builds — 17 Singles, 8 Doubles, 5 Booleans — and only the obfuscated type
   *names* were re-randomised.

5. **`findref.py` had a function-boundary bug** (fixed, but understand it): il2cpp functions often end
   in a tail `jmp` followed by `int3` padding. Running to the first `ret` walks into the NEXT function
   and attributes its field references to yours. One "276-instruction" method is really 35. Both
   readers now stop at `int3` after >8 instructions. **What caught it was two tools disagreeing on an
   instruction count** — keep them cross-checking.

6. **Filtering candidate methods by `(arity, return type, param types)` silently failed** on the daze
   target: best match 33% with a 0.3-point gap, which reads as an answer rather than a failure.
   Sweeping *every* method of the matched class found it at 100%. Classes here are 42-101 methods;
   the unfiltered sweep costs nothing. Prefer it.

7. **`0x12c..0x12f` must be excluded from every offset search.** They are the damage float's own
   bytes and correlate with magnitude by construction. `0x12f` presents as a tidy 1.69x "crit flag"
   for exactly that reason.

8. **`0xe4` is NOT crit — already chased, rejected.** It passes three strong-looking tests: zero on
   all 31 Anomaly rows (Anomaly cannot crit), a consistent 1.530x within-AttackProperty damage split
   across 9 groups, and a 1.530x/11.6% pair coherent for a low-crit build. But over all damage rows,
   flagged rows average 6,922 vs 28,298 — ratio **0.245**, inverted. Simpson's paradox; the flag sits
   on low-damage attack types. Also `{0,2}`, never explained. A bit-level sweep of the whole object
   under the same constraints found only candidates straddling 1.0.
   **Settling crit needs a capture on a HIGH-CRIT-RATE build** — a real crit flag's rate must track
   CRIT Rate *across builds*, which no single capture can demonstrate. Do not try to force it from
   this one.

9. **`MethodInfo.flags` moved `+0x30 -> +0x2c`** (back to the 3.3.0 value), fixed in `dumper.zig`.
   The failure was silent: every `METHOD_FLAGS` row read `0x0`. **The dump in `local-data` was taken
   before that fix**, so its flags column is all zeros — do not use flags from it for matching.
   Re-derive per build from `runtime_invoke` (API slot 138), byte-identical up to its
   `test byte ptr [rdi+disp], 0x10`.

10. **Bash heredocs in this environment mangle `\x` escapes.** Write Python/Zig containing byte
    escapes to a file with a real write tool, then run it. Do not inline it in a heredoc.

## 5. Two things deliberately left undone

- **Join-check fields** (`anomaly 0xf8/0x144`, `daze 0x144/0x1ac`, snapshot's join pair) are set to
  `0` = "not read", and the read sites test the offset as well as the pointer so a 0 cannot be
  mistaken for "read at +0" and emit a plausible float. They are cross-validation columns; the real
  values come from the raw result dump. Expect `-1` in those columns. That is correct, not a fault.
- **`timescalelog` and `statelog` still refuse** (`ClassNotFound`, obfuscated class names re-randomise
  every build), and **`eventlog` refuses** (`ClientMismatch`, still gated to 3.3.2). So no
  `events.tsv`, `state.tsv` or `timescale.tsv` on 3.3.3. `timescalelog`'s class IS already found:
  **`PGHCHDNHLNH`** (was `LOLPDHOFIHG`), the tail-`jmp` target of the named
  `PlayTimeSlowUtils::InvokeTimeSlowKey/3` @ `0x181EEF70`, method `BJIKPMJPJBE/1` @ `0x155321E0`.
  Its 7 field offsets still need deriving from code (see trap 4 — not from the layout).

## 6. Order I would work in

1. `atk` — needed by `judge-capture.mjs`, and ground truth is obtainable (ask the user for resolved
   ATK, or run sheet-webapp's build resolver on `endbattle_1_loadout.json`).
2. `impact`, `anomaly_mastery`, `anomaly_proficiency` — same ground truth, same scan.
3. `hit_split`, `dmg_mv`, `daze_mv`, `energy`, `decibels` — cross-check against
   `sheet-webapp/src/data/actions.json` per-hit values for a known action.
4. `statelog` (Stun windows are high value for the calculator), then `eventlog`.
5. `crit` and `timescalelog` last — crit needs a different build, timescale is the least useful
   output.

Nothing in `sheet-webapp/src/` was changed this session. Its only changes are inside gitignored
`local-data/`: the pruned capture archive, `local-data/settlements/`, and the 3.3.3 dump.
