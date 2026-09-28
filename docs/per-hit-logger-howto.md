> Moved from `sheet-webapp/docs/reference/per-hit-logger-howto.md` on 2026-09-13; source paths rewritten to this repo. `local-data/…` paths are game data that is never committed — see README.

# Per-hit logger — how it was obtained, in order

Status: reference procedure. Written 2026-09-12 as the step-ordered account of work done on
2026-09-11. This is the document to read for **how the per-hit log was produced and how to
reproduce it on a new client build**. The chronological attempt log, with every dead end, is
`il2cpp-runtime-dump-attempt.md`; the results and what they confirmed are in
`hit-split-frame-data.md`; the packet-side findings are in `battle-report-packets.md`.

Source and tooling live in this repo (an AGPL-3.0 fork of upstream thaumiel). Captures, dumps,
client binaries and other game data live under `local-data/` (gitignored; see README). Paths
below are relative to the repo root.

## 0. Setup that everything else assumes

| Item | Value |
|---|---|
| Client | **CNBetaWin3.3.2** since 2026-09-13 (was 3.3.0; the walkthrough below was written against 3.3.0 and its addresses are that build's — see `client-update-playbook.md` for the 3.3.2 re-derivation), on a separate laptop reached over an SMB share. Its client folder still carries the 3.1.2 name. |
| Server | Remielle (private server emulator), `local-data/remielle-battlestats/`. |
| Client patch | thaumiel at `0e669bc` (this repo, branch `per-hit-logger`). Zig **0.16.0** (`local-data/tools/zig-x86_64-windows-0.16.0`). |
| Build | `zig build -Doptimize=ReleaseFast` (ReleaseSmall makes `std.mem.indexOf` crawl). |
| Deploy | copy `zig-out/bin/remielle.exe` and `zig-out/bin/thaumiel.dll` into the client folder; launch `remielle.exe`, **not** the game exe. thaumiel opens a console; our modules log as `info(dumper)` / `info(hitlog)`. |
| Anti-cheat | Not a factor. thaumiel's `isLoadMhyBaseReplacement` returns `false`, so `mhypbase` / `HoYoKProtect.sys` never initialise (`src/dynlib.zig`). |

Everything version-specific (RVAs, table offset, API indices, prologue bytes) is for 3.3.0 and
**moves every client patch**. Steps 3–5 are what you redo for a new build; steps 1–2 and 6 carry
over.

## 1. Prove the wire carries nothing per-hit (packet route)

Patch Remielle's unhandled-command branch to write the decrypted body of every message it does not
recognise to `logs/unhandled/<seq>_cmd<id>_pkt<packet>_t<ms>.bin`:

- Patch: `tools/remielle-dump-unhandled.patch` (applies to
  `gamesv/src/messaging/handlers.zig`; already applied in `local-data/remielle-battlestats/`).
- Decoder: `tools/pbwalk.mjs` — schema-less protobuf walker: parse
  tags, recurse into length-delimited fields that parse cleanly, decode packed varints. No
  `.proto` needed; Remielle's generated names are obfuscated anyway.
- Dumps from the reference fight: `local-data/packet-dumps/2026-09-11-fight1/`.

Finding: during combat the client sends keep-alives, a periodic `{stat_id, count}` counter, and
one settlement (`EndBattleCsReq`) with per-skill totals at whole-second resolution. **No per-hit
data ever leaves the client.** Field-by-field decode of the settlement is in
`battle-report-packets.md`. The same doc establishes that the theorycrafter's per-hit `log.txt`
came from a modded client, i.e. an in-process hook. That is the only route.

## 2. Injection vehicle: thaumiel

thaumiel is already inside the game process (loaded by `remielle.exe`) and already patches
functions by 12-byte prologue overwrite (`src/Interception.zig`, `replace()`). We add our modules
to it rather than writing a separate injector. Our additions are wired in `src/dynlib.zig`
`initPatches()` and built via `build.zig`; the exact diff against upstream is
`tools/thaumiel-wiring.patch` (24 lines). New files:

| File | Role |
|---|---|
| `src/dumper.zig`, `src/dumper-rvas.zon`, `src/dumper_guard.c` | Runtime metadata dump (step 4) |
| `src/hitlog.zig`, `src/hit_hook.c` | The per-hit hook (steps 5–6) |
| `src/sampler.zig` | Sampling profiler — wrong instrument for this, kept for profiling questions, disabled with `if (false)` |

`build.zig` additions: `.unwind_tables = .sync` (the SEH bridge in `dumper_guard.c` needs it),
the two C files with `-fms-extensions`, `link_libc = true`.

## 3. Get a way to call the il2cpp API (the blocker)

`GameAssembly.dll` exports only `DllCanUnloadNow`, `DllGetActivationFactory` and
`il2cpp_get_api_table`; the per-function `il2cpp_*` exports are stripped, and
`global-metadata.dat` is an encrypted non-stock container (`MHY\0` header). Il2CppDumper and
every offline approach are out. Sequence that worked:

1. **Go/no-go: are identifiers plaintext at runtime?** Scan the live process with
   `ReadProcessMemory` for `BreakStunRatio`, `ConfigEntityAnimEvent`, `MoleMole`. Hundreds of
   hits. Yes — so a runtime dump is possible. (dumper v3.)
2. **Do not call `il2cpp_get_api_table`.** It is VM-protected (`.upx0`) and calling it with a
   function-name string crashed the client. The Windows minidumps
   (`local-data/crash-analysis/*.dmp`) showed the fault was a **write** to the address of the
   read-only name literal we passed — the assumed signature is wrong and the real one is unknown.
   (dumper v4/v5.)
3. **Use the table Unity already built.** Unity calls that export once at startup and keeps the
   result — a 194-entry array of function pointers — in `UnityPlayer.dll`'s data section. Find it
   in the crash dump: enumerate the dump's memory ranges inside UnityPlayer's image, and look for
   runs of ≥ 8 consecutive 8-byte values that all point into GameAssembly's `.text` range (the
   13 MB libil2cpp runtime — API functions live there, not in the 422 MB `il2cpp` section). The
   194-entry run is the table. Script: `tools/find-table.cjs` (reads
   the minidump's module list and memory-range streams directly; ~15 lines; the GameAssembly
   base/range constants inside it are for the 15728 dump and must be re-read per run). Result
   for 3.3.0: **`UnityPlayer.dll + 0x1F96648`**, 194 entries. The GameAssembly RVAs of every entry are
   pinned in `src/dumper-rvas.zon` and re-verified at startup so a different build fails closed.
4. **Identify which index is which API function.** The libil2cpp runtime (`.text`, 13 MB) is
   *not* virtualised, so disassemble each table target (capstone,
   `tools/discovery/disassemble.py` + `check-*.py`) and match against the stock
   `il2cpp-api-functions.h` order and the known shape of each function. The order is close to
   stock but not identical — e.g. the slot that should be `method_get_name` (116) returns the
   invoker pointer at `MethodInfo+0x10` — so every index used is individually verified.
   Verified 3.3.0 indices: `assembly_get_image=22`, `class_get_fields=31`,
   `class_get_methods=35`, `class_get_name=37`, `class_get_namespace=39`, `domain_get=63`,
   `domain_get_assemblies=65`, `field_get_name=73`, `field_get_offset=75`,
   `method_get_name=115`, `method_get_param_count=121`, `thread_attach=152`,
   `thread_detach=153`, `image_get_class_count=167`, `image_get_class=168`. Native method
   pointer is at `MethodInfo+0`, confirmed from the `runtime_invoke` implementation at RVA
   `0x8FCCA0`.

## 4. Dump classes, field offsets and method RVAs

`src/dumper.zig` (v7): a worker validates the API table and startup code anchors, then
polls the main thread's domain context using read-only memory access (50 ms interval,
no fixed delay). See [startup crash fix](startup-crash-20260920.md); never poll API slot
154, which is a callback setter. It installs hitlog (`installFromWorker`),
`thread_attach`es itself, then walks `domain_get_assemblies → assembly_get_image →
image_get_class → class_get_fields / class_get_methods` and writes `il2cpp-v7.tsv` beside
`remielle.exe`: `CLASS` rows with `FIELD` (name, offset, type) and `METHOD` (name, param
count, RVA) rows under them. `dumper_guard.c` wraps the walk in an SEH handler that records the
stage and fault address on a native exception, so a partial dump is still usable. Progress goes
to `il2cpp-v7.log`; wait for `COMPLETE`. To disable, create an empty `dumper-disable.txt`
beside `remielle.exe`. Result for 3.3.0: 95,783 classes, 491,600 fields, 844,103 methods,
~50 MB — the saved copy is `local-data/crash-analysis/il2cpp-v6.tsv` (+ `.log`); it was
produced by the v6 build, and the current source (v7, same enumeration, table read unchanged)
names its output `il2cpp-v7.*`. `local-data/crash-analysis/dumper-v6.zig` is the exact source
that produced the saved file.

Query helpers over the TSV: `tools/discovery/claude-analysis.cjs`
(`enum <Class>`, `ns`, `classes <re>`, `methods <re>`, `fieldset`).

## 5. Choose the hook target

The runtime combat engine is fully obfuscated: every readable class is UI, `MoleMole.Config`,
Unity, or BCL. Name search for damage/hit/calc finds nothing (exhausted — don't repeat). Two
other approaches were tried and are dead ends (details in the attempt log): a sampling profiler
(the target fires ~5×/s for microseconds — ~2 expected samples per session) and a scan for code
referencing `ConfigEntityAttackProperty` field offsets (consecutive 4-byte offsets match any
struct walker; output is noise).

What worked: **start from a class we already knew.** The asset-file decode
(`hit-split-frame-data.md`) had shown that hit splits, element, and heavy/causeStun flags live in
`MoleMole.Config.ConfigEntityAnimEvent` — the animation-event container that fires an
`AttackProperty` at a given frame. That class is *not* obfuscated. Searching the dump for it
gives its methods:

| Method | Params | RVA (3.3.0) |
|---|---:|---|
| **`TriggerAttackPattern`** | 12 | **`0x168A12A0`** |
| `HandleAttackPattern` | 12 | `0x168A1570` |
| `HandleAttackPatternList` | 11 | `0x168A1B10` |
| `HandleAttackPatternListWithOverrideParam` | 10 | `0x168A3950` |
| `HandleContinuousAttackPatternList` | 7 | `0x168A2B90` |

`TriggerAttackPattern` is the entry point where an animation frame fires a hit. It is the only
class in the binary with attack-pattern trigger methods, so it captures every animation-driven
hit. For a new build: search the new dump for `ConfigEntityAnimEvent`, take the new RVA, and
read the new first 12 bytes.

## 6. Hook it

`src/hitlog.zig` + `src/hit_hook.c`. Design points, all deliberate:

- **Prologue check before patching.** The function begins
  `41 57 41 56 41 55 41 54 56 57 55 53` (push r15/r14/r13/r12/rsi/rdi/rbp/rbx) — eight
  position-independent pushes, exactly 12 bytes. `install()` compares these bytes first and
  refuses to patch on mismatch, so a version change fails with a log line instead of corrupting
  an unrelated function. **Keep this check when updating the RVA.**
- **Trampoline.** thaumiel's `Interception.replace` is destructive (no call-through), so we build
  the stub ourselves: copy the 12 prologue bytes into `VirtualAlloc`'d RWX memory, append
  `ff 25 00 00 00 00` (`jmp [rip+0]`) and the 8-byte absolute address of `target+12`. Because
  the prologue is all pushes, no instruction-length decoding or relocation fix-up is needed.
  Then `Interception.replace(target, hit_hook_trigger)` overwrites the entry.
- **Detour in C, same arity.** il2cpp instance methods are
  `ret f(void* this, params..., MethodInfo*)` → 14 parameters. `hit_hook_trigger` declares all
  14 as `uint64_t`; in the Win64 ABI every stack argument occupies an 8-byte slot regardless of
  declared type, so pass-through is exact and no naked asm is needed. It calls `hitlog_record`
  then tail-calls the stub (returning instead of jumping if the stub is null — lose one event,
  don't crash).
- **What to read.** The 12 arguments were never decoded and are not needed: `this` *is* the
  `ConfigEntityAnimEvent`. Offsets from the dump:

  | Object | Offset | Field |
  |---|---|---|
  | `ConfigEntityAnimEvent` | `0x20` | → `ConfigAttackActiveFrameDynamicProp` |
  | | `0x38` | → `ConfigEntityAttackProperty` |
  | | `0x78` | `AttackPatternType` (i32) |
  | `ConfigAttackActiveFrameDynamicProp` | `0x24` | `OverrdieDynamicPropKey` (i32, the skill id; the game's own spelling) |
  | | `0x34` / `0x3C` / `0x44` / `0x38` / `0x20` | damage / Daze / buildup / Energy / custom split fractions (f32) |
  | | `0x30` | Ether purify (f32) |
  | `ConfigEntityAttackProperty` | `0x140` / `0x144` / `0x148` | `DamageElement` / `DamageHitType` / `HitType` (i32) |
  | | `0x174` / `0x182` | `IsCauseStun` / `IsHeavyAttack` (u8) |

  Reads are plain dereferences (we are on the game thread, mid-call, on the game's own live
  object); null-checked only.
- **Output.** `hits.tsv` beside `remielle.exe`, header row then one row per hit:
  `elapsed_ms self arg1 arg2 arg3 patternType skillId dmgPct dazePct buildupPct epPct customPct
  element hitType hitStren causeStun heavy dyn prop attackEffect groundHitEffect downHitEffect
  skyHitEffect via caller callerRva stack`. `caller` is the detour's return address (the game function
  that called the hooked method — for a `T` row the caller of `TriggerAttackPattern`, for a leaf
  row usually `TriggerAttackPattern` itself) and `callerRva` its RVA in GameAssembly (0 when the
  return lands outside the module), added 2026-09-18 for `action-start-hook-plan.md` step 1.
  `stack` (same day) is the frames above that caller from `RtlCaptureStackBackTrace`, up to twelve,
  `;`-joined GameAssembly RVAs (`*0x…` for an address outside the module).
  Buffered, flushed every 16 hits so a later crash does not lose what was seen.
- **`events.tsv`** (since 2026-09-18, `src/eventlog.zig`): every `AnimatorEvent` the anim-event
  system fires, of every subclass, one row per event: `elapsed_ms component owner queued index
  event klass className f0 f1 f2 trigger`. `owner` equals hits.tsv `arg2` (the entity);
  `f0`→`f1` normalized-time window, `f2` state length (s); `trigger` 1 = state entered, 2 =
  forced at state end, 3 = transition out. Class names via the dumper's verified API table
  (validated lazily on the first event). See `action-start-hook-plan.md`, 2026-09-18 updates. `tools/discovery/claude-hits-readable.cjs` resolves
  agent/action/element names into a shareable CSV.

## 6b. Where the files go (2026-09-20)

`src/capture.zig`: `captures\<UTC stamp>-<pid>\` per launch, `battle-<n>\` per battle inside it,
with `hits.tsv`, `events.tsv` and the `damage-*.tsv` probes in the battle folder and the startup
log, probe statuses and dump in the session folder. The battle boundary is
`MoleMole.BattleStatsSubsystem::OnAwake` (rotate + zero the shared `elapsed_ms` origin) and
`::OnDestroy` (flush), found in the 3.3.2 dump as the only `GameSubsystemBase` whose name says
what it is for, and hooked by name like §6's targets (prologue shapes in the module comment).
Before this, one `hits.tsv` / `events.tsv` per launch accumulated every battle of an 8-hour
session and each capture had to be trimmed by `elapsed_ms` window by hand (the
`hits-session.tsv` / "stream-trimmed" notes in the capture READMEs up to `20260920-baseline-2035`).
The readers take a battle folder unchanged. Not yet verified on a live client at the time of
writing — the first launch should show `hooked BattleStatsSubsystem::OnAwake` in
`hitlog-startup.log` and a `battle-1` folder after the first fight.

## 6c. Global time scale (2026-09-21)

`src/timescalelog.zig` + `src/timescale_hook.c`: one row per change of the scale the game applies
to the whole level, so a reader can turn `elapsed_ms` (wall) into game seconds without guessing
at the Chain wheel, cinematics or slow-mo.

**What is hooked.** The game never sets `UnityEngine.Time.timeScale` — the icall thunk
(3.3.2 `0x1FA0C670`) has no callers outside one BehaviorDesigner task, and `Time.deltaTime` stays
real. The global scale lives in the level's time manager, 3.3.2 `LOLPDHOFIHG` (a
`Foundation.SingletonDisposable<>`; obfuscated, renamed every build), whose per-frame
`Update(float dt)` at `0x136C9610` is the one place it is applied:

```text
+0x7c  frame += 1
DNLBFPFCHPN(dt)                       advance the TimeSlow key stack -> +0xbc (raw)
scale  = +0xec ? 1.0 : +0xbc * +0xc4  (+0xec = "run unscaled"; the constant is 1.0, not a pause)
+0xf4  = scale * dt
+0xd0 += scale * dt                   the game's own accumulated world time
Nap.NapECS.EcsWorld::InnerStepTimeCenter(&dt, &scale); EcsSystemGroup::Update()
+0xc8                                 pause counter (also zeroes FAOKGCLLACJ::get_DeltaTime)
```

Named anchors for re-finding it: `MoleMole.Utils.CameraSequence.PlayTimeSlowUtils::
InvokeTimeSlowKey/3` tail-`jmp`s into this class (the tail target names the class in any build —
3.3.0's was `GNCGBEDJJJE`, with a different layout), and `MoleMole.PinballSubsystem::
ResolvePinballWorldTimeScale/0` reads exactly `+0xec ? 1.0 : +0xbc * +0xc4`. The hook is a
**post-call** detour (the original runs, then the record reads what it just applied); the
12-byte prologue `56 57 53 48 83 EC 50 0F 29 7C 24 40` is position independent and relocated
verbatim. Class, `Update/1` and seven field offsets are resolved by name through the dumper and
checked against the pins; a mismatch installs nothing and logs `error(timescale)` in
`hitlog-startup.log` (success: `info(timescale): hooked LOLPDHOFIHG::Update`). Per-entity
scales — hitstop, the Witch slow-down zone (`AnimatorZoneWitchSlowDownKeyOverride` ->
`CBDNNLPIJPB::BGKPJAFDPPP` on the entity's slot component) — are deliberately not logged;
`events.tsv`'s `f2` already carries them.

**Row format** (`timescale.tsv` in the battle folder, same `elapsed_ms` origin as `hits.tsv` /
`events.tsv`, change-only):

```text
elapsed_ms  scale  source  world_s  frame  raw  mult  unscaled  pause  dt
```

`scale` is the multiplier the step applied to `dt` (the formula above, mirrored 1:1); `source` is
`awake` (the row written when the folder opens, repeating the last state — `1.0` before any
step), `update` (a step whose scale / unscaled / pause differs from the previous one, or the
first step after awake), or `gap` (no step for > 100 ms: written at the LAST step's time, before
the `update` row of the step that resumed). `world_s` is `+0xd0` — the game's own integral of
scale·dt, so the reader need not integrate at all: inside a segment it is linear in wall time.
`raw`/`mult`/`unscaled`/`pause` are the fields; `dt` is the step's argument (the game clamps it
to 0.1 s on load hitches). A new level is a new instance (`world_s` restarts at 0.1, `frame` at
1), which is how the result screen shows up at the end of a battle file.

**Verified on `local-data/damage-probe-captures/20260921-123309-timescale-test/battle-1`**
(Grace/Velina/Rina, quest 6900404, `endbattle_20.pb`; `tools/timescale-check.mjs` prints all of
this from the folder):

| Feature | What the game does |
|---|---|
| Ultimate cinematic (3 of them) | `scale = 0` exactly, from the owner's `SwitchIn_Attack_Ex_Start` entry (+0 / +16 ms) to its `SwitchIn_Attack_Ex` entry (+0 / +16 ms); 0 hits of any owner inside; world time inside 0.000–0.017 s. `dt` keeps flowing (steps continue), the scale is what stops. |
| Chain wheel | plateau **0.015** exactly, reached by an ease from 1.0 over ~350 ms (22 frames: 0.95, 0.87, 0.82, … 0.017, 0.015); held until the pick (125 ms, 375 ms and 2.08 s in this run). |
| Chain start | on the pick the scale returns to 1.0 at the attacker's `SwitchIn_Attack` entry, then dips to a **0.10** plateau: ease down ~250 ms, hold ~100 ms, ease up ~250 ms, back at 1.0 ≈ 500 ms after the entry (seen on Grace, Plugboo and Rina; the second pick of a wheel, Velina, eased straight from 0.015 up to 1.0 over 375 ms with no separate dip). Not ~0.6. |
| Integral | first hit -> last hit: wall 79.39 s, Σ scale·dt **65.02 s**, game `world_s` delta 65.08 s (the 55 ms difference is `GetTickCount64` granularity — prefer `world_s`); the settlement says **67** (integer; the level clock had run 7.3 s before the first hit, and 75.0 s in total). Not tuned. |
| Also seen, not interpreted | a one-frame `scale = 0` easing back to 1.0 over 200 ms right after a Velina hit (skill 1561006, 15.6 s); `mult` (+0xc4) at 0.05 for 156 ms after Velina's heavy hit 1561007 (60.4 s); `pause` (+0xc8) = 1 for one step at the end of the battle. |

`dt` is unchanged by all of the above; `Update` keeps running through cinematics, so there are
no `gap` rows inside a battle — they appear only on load hitches (battle-0, the result screen).

## 6d. Buff, property and Stun state (2026-09-22)

`src/statelog.zig` + `src/state_hook.c`: `state.tsv` per battle folder, one row per change of
something the hit log cannot see -- a modifier (buff) going on or off with its name, stacking
mode and configured duration; every write to an entity's property table (the funnel 173 call
sites use, so Energy and Decibels arrive here too, as property type ids to be identified by
value); and the stun mixin's own enter / refresh / end, which is the Stun window the engine
actually ran rather than the span of hits that landed inside it. Read it with
`node tools/state-check.mjs <battle folder>`. Built and unit-tested; **not yet captured** --
`damage-probe-howto.md`, "Buff, property and Stun state", lists what the first run must show.
The hooks install through `src/detour.zig` (shared prologue relocator, tested by
`src/detour_test.zig`) and write through `src/logfile.zig`.

## 7. What it gives and what it does not

Gives: the observed hit timeline — timestamp, action, per-hit split fraction, element,
heavy/causeStun — for every animation-driven hit. This confirmed the anim-frame + hitstop model
to within 8 ms (`hit-split-frame-data.md`).

Does not give: final damage, crit, target state, attacker stat snapshot (all computed downstream
of this call, in the obfuscated runtime), and anomaly/DoT ticks (buff-sourced, not
animation-driven — confirmed absent across 320 captured rows including deliberate procs). The
settlement `.pb` still provides per-skill totals including anomaly for an end-to-end check.

## Artifacts index

| What | Where |
|---|---|
| Remielle dump patch, protobuf walker, table finder, thaumiel wiring diff | `tools/` |
| Hook + dumper source | `src/{hitlog.zig,hit_hook.c,dumper.zig,dumper-rvas.zon,dumper_guard.c}` |
| Capture layout + battle hooks | `src/{capture.zig,battle_hook.c}` |
| Global time-scale log + checker | `src/{timescalelog.zig,timescale_hook.c}`, `tools/timescale-check.mjs` |
| Dumper operating notes | `DUMPER-V6.md` |
| Disassembly/analysis scripts | `tools/discovery/` |
| Crash dumps, the 3.3.0 dump TSV, disassembly traces, captures | `local-data/crash-analysis/` (not in the repo) |
| Captures | `local-data/crash-analysis/hits.tsv` (64 hits), `hits2.tsv` (256 hits) |
| Packet dumps | `local-data/packet-dumps/2026-09-11-fight1/` |
