> Moved from `sheet-webapp/docs/reference/damage-probe-howto.md` on 2026-09-13; source paths rewritten to this repo (`src/`, `tools/`, `tools/discovery/`). `local-data/…` paths are game data that is never committed — see README.

# Experimental damage-text input probe

Status: implementation for a first live capture, 2026-09-12. **Not yet a verified final-damage
logger.** This follows the shelved lead in `il2cpp-runtime-dump-attempt.md`. It does not change
calculator behavior or replace `hits.tsv`.

## What this build observes

One entry point: `UIInLevelDamageTextContainerChildWindowController::LJFFPFFICNK`, RVA
`0x1482C410` in the saved CNBetaWin3.3.0 GameAssembly. Existing disassembly shows this method
calls `QueryDamageTextInfo`; whether it covers all relevant damage, or receives combined display
events, requires a live test. An entry is a **UI method invocation**, not an established hit.

The probe records the immediate caller address/RVA, elapsed milliseconds, thread, four integer
argument registers, fourteen stack slots (including the presumed trailing MethodInfo), all six
volatile XMM registers, and a bounded 64-byte snapshot of the object referenced by RDX. Unknown
pointers are read with ReadProcessMemory, with actual byte counts recorded. No argument is yet
labeled damage, crit, owner, target or Anomaly type. It does not attempt an unreliable stack walk.

The assembly bridge saves/restores volatile integer and XMM registers, MXCSR and flags, leaves
the incoming stack unchanged, and jumps through the original prologue. No guessed target C
signature is needed. The caller's return address and original return convention survive.

## Version and installation contract

- Opt-in marker: `damage-probe-enable.txt` in the launch working directory. Without it, the new
  probe does nothing. Existing dumper/hit logger behavior is unchanged.
- Exact saved build gate: PE timestamp `0x6A99EBD2`, image size `0x2109C000`, and the first 64 bytes
  at the target. This is an identity check for the known candidate, not a general signature scan.
- Only the verified first twelve bytes (eight independent push instructions) are relocated.
- Install runs in the existing startup-patching path, before combat. No live attach/hot-patch UI.
- The stub becomes execute/read before activation and instruction caches are flushed. The original
  pointer is assigned before the detour is written. Do not unload the DLL while the hook is active.
- Console status: 0 disabled, 1 installed, 2 installed but protection restoration failed;
  -1 missing module, -2 wrong PE identity, -3 wrong code fingerprint, -4 allocation/protection
  failure, -5 output creation failure, -6 duplicate installation. Stop a test on status 2.

Output is `damage-probe-<UTC timestamp>-<pid>.tsv`, created without overwriting an earlier file.
Each event is written immediately; a skipped counter reports lock contention/write errors.
This first probe does synchronous bounded reads and writes, so capture timing itself must not be
treated as a performance benchmark. Original hit-log timestamps have a separate start epoch.

## User test after the native checks pass

Use the existing Wind team. No finished calculator, single-hit attack or Disorder is required.

1. Close the client. Back up the installed `thaumiel.dll` before replacing it with the probe build.
   Keep the existing launcher/server setup. Launch with the client directory as working directory.
2. Place the enable marker next to the launcher. Check console status is **1** and gameplay opens.
3. Record the screen: use one repeatable attack once, pause, then a short normal Wind-team sequence
   that triggers its Anomaly damage and lingering hits. Multi-hit attacks are desirable here.
4. Finish the fight for settlement. Before another launch, preserve `hits.tsv` (the existing logger
   overwrites it), the new damage-probe TSV, settlement/sidecar, console output and recording.
5. Remove the enable marker and restart to disable the new probe. Restore the backed-up DLL if
   needed. On failure, preserve console output and any crash dump instead of repeating the test.

First validation: identify a repeatable value corresponding to displayed damage, check whether
several displayed hits are merged, and establish whether the team's Wind damage follows this path.
Only after that evidence should we label fields or pursue upstream stat snapshots.

## Source, build and offline checks

Sources: `src/damage_probe.{c,S}`, with build/dynlib wiring in that checkout.
These remain local alongside the existing upstream-derived tooling. Packaged source copies and
integration patch live under `local-data/tools/damage-probe/`.

From the repo root, using the repo's Zig 0.16.0 executable:

```text
zig build -Doptimize=ReleaseFast --global-cache-dir .zig-global-cache
zig cc -O2 src/damage_probe_test.c src/damage_probe.S -o damage-probe-test.exe
zig cc -O2 src/damage_probe_record_test.c -o damage-probe-record-test.exe
```

Set `ZIG_GLOBAL_CACHE_DIR` to the workspace cache for the two C commands if the system cache is
unwritable. Run both executables. The bridge test exercises mixed integer/float arguments across
all 18 positions, a relocated eight-push prologue, and the original floating-point return, 10,000
times. The recorder test exercises actual file output, inaccessible-pointer handling, argument
capture, LastError preservation, and contention accounting. These cannot prove live coverage.

Read-only analysis:

```text
node tools/inspect-damage-probe.mjs <capture.tsv> [visible-number]
```

This reports invocation counts/caller RVAs, or candidate numeric interpretations near a supplied
screen number. Numeric coincidences are hypotheses, not field identification.

## Attempt record and handoff — 2026-09-12

### Evidence inspected; do not repeat discovery

- Read the existing `hitlog.zig`, `hit_hook.c`, `Interception.zig`, build/dynlib wiring and the
  saved `fn-1482c410.txt` / `fn-1482a530.txt` disassemblies. The candidate's first twelve bytes
  are eight independent pushes; subsequent instructions save XMM registers and use register and
  stack arguments. Calls to `QueryDamageTextInfo` are visible at `0x1482C729` and `0x1482C7AF`.
  This establishes a relationship to damage presentation, not complete per-hit coverage.
- Read the saved `local-data/crash-analysis/GameAssembly.dll` PE header and mapped the target RVA
  through its section table to the on-disk bytes. Extracted timestamp `6A99EBD2`, image size
  `2109C000`, and 96 target bytes; the first 64 are embedded as the probe fingerprint. This was
  offline inspection of the saved binary, not verification of the currently running client.
- Used a register-preserving assembly bridge instead of the historical proposed all-integer C
  detour. It preserves XMM inputs and the original return convention without requiring argument
  identification first. No arbitrary deeper return-address scan was implemented.
- Did not investigate new hook targets, re-run the offset scan/profiler, access the network client,
  install the DLL into the client, or collect gameplay in this session.

### Build/tooling issues and resolutions

- `python` on PATH could not execute (`The file cannot be accessed by the system`). No Python
  analysis ran. Used PowerShell `BinaryReader` for the small PE/fingerprint read instead.
- A Node `-e` command containing JavaScript quotes lost them through Windows PowerShell argument
  handling. It failed at parsing and produced no evidence. Prefer a `.mjs` file for future scripts.
- Initial `zig build` failed opening the system global cache with `AccessDenied`. The successful
  build used `--global-cache-dir .zig-global-cache` inside the repo root; C test builds
  used `ZIG_GLOBAL_CACHE_DIR` pointing to that same directory. The first cache population took
  several minutes with little output; subsequent C builds were quick. Do not mistake this known
  initial cache build for a client extraction scan.
- The first hand-written integration patch had inadequate hunk context and failed reverse-check.
  Corrected its line numbers/context; final `git apply --reverse --check` passes against the
  integrated checkout. Use the packaged final patch, not the earlier attempted hunk shape.

### Verification and packaged artifact

- Native DLL/launcher build: **passed** (`ReleaseFast`, bundled Zig 0.16.0).
- Bridge executable: **passed 10,000 calls** with mixed integer/float arguments, the relocated
  eight-push prologue and floating-point return. This is an offline synthetic target, not gameplay.
- Actual recorder executable: **passed** inaccessible-pointer handling, stack capture, file output,
  LastError preservation and lock-contention accounting.
- Node inspection test: **passed** float candidate decoding, unreadable-snapshot exclusion and
  truncated-row detection.
- Repository typecheck and app build: **passed**. Full suite: **1,295 passed, 4 failed**, the same
  three Remielle and one Rina cases already documented. No calculator source was edited; the
  pre-existing `battleState.ts` working-tree change was left alone.
- Package: `local-data/tools/damage-probe/build-20260912-033857.zip`. Contains the DLL, enable
  marker, instructions, new sources, tests, inspection script, integration patch and `BUILD.txt`.
- DLL SHA256: `E74568B117EF304CBE8919DEA239B4673CD0EA4D581A0B1DEBFBD69F1119D9A4`.
  The package README is a build-time copy; this repository document is the current handoff.

### Next evidence required; do not claim these are solved

Await the user's Wind-team capture using the instructions above. First check console installation
status and output row counts. If the version gate refuses installation, obtain the new binary/dump
and verify the candidate again; never bypass the fingerprint to make it install.

Then correlate repeatable screen numbers with raw arguments/object words and inspect caller RVAs.
Establish aggregation, direct-hit coverage and Wind Anomaly coverage independently. Raw integer or
float coincidences are not proof of a damage field. No damage/crit/owner/target labels, upstream
attacker-stat access, live stability or per-version portability have been established yet.

Append subsequent experiments here with the input/build identity, action taken, observed result,
artifact path, and conclusion (including failed approaches). Keep interpretation separate from
observation so an unsuccessful experiment is not repeated under a new assumption.

### Laptop staging — 2026-09-12

User requested direct installation on the laptop. Access required sandbox escalation; approved
access worked. Read the laptop GameAssembly header and target's 64 bytes through SMB: both match
the packaged probe's fingerprint. Backed up the current DLL and available hit/dumper captures in
`damage-probe-backup-<timestamp>` inside the client directory.

Replacing `thaumiel.dll` was blocked by an existing process holding the file. Exclusive open
failed before any write, so the installed DLL was not changed. Do not retry while the game runs.
Instead staged these beside `remielle.exe` in
`\\<laptop>\...\<client dir>` (the folder `remielle.exe` runs from):

- `damage-probe-ready.dll` (remote SHA256 matches the build recorded above).
- `Install-DamageProbe.ps1` (PowerShell syntax check passed).
- `START DAMAGE TEST.cmd` (runs that installer).

The user closes the game and double-clicks the CMD. The installer obtains exclusive DLL access,
backs it up and preserves hits.tsv, installs the staged build, enables the marker and launches
the existing remielle.exe from the correct working directory. It restores old bytes on a write
exception. This installer has been staged, not executed against the live client yet. Await
installation status and the Wind-team recording; live stability/coverage remain unverified.

### First live capture — 2026-09-12, 12:22:46 UTC launch

User completed the Wind-team test. Retrieved into
`local-data/damage-probe-captures/20260912-122246/`:
`damage-probe-20260912-122246-41548.tsv`, `hits.tsv`, `il2cpp-v7.tsv`, `il2cpp-v7.log`.
Laptop's installed DLL hash matches the packaged probe. The new TSV proves installation succeeded.

- **262 records**, no malformed/truncated rows, all skipped counters zero, all stack reads 112
  bytes and all RDX snapshots 64 bytes. Events span elapsed 65,688–274,329 ms. Existing hits.tsv
  has 2,304 data rows; this count is NOT directly comparable to damage invocations (animation
  triggers are not necessarily successful hits and the UI path may aggregate/update).
- **RDX is System.String**, established from the fresh dump's runtime class pointer
  `0x50001550358`, and independently from the target's `PARAM_TYPE 0 System.String`.
  Length is at object +0x10, UTF-16 data at +0x14. All 262 bounded snapshots decoded completely.
- **86 nonzero numeric strings** from caller return RVA `0x14830393`, belonging to
  `BGGJIEPIODP` at `0x14830170`. Examples: 503245 at 78,704 ms, 102662 at 80,125 ms,
  63733 and 1855883 both at 81,047 ms. These are captured UI input strings, not yet individually
  matched against the recording or settlement. Do not label them all Anomaly or all final hits.
- **176 strings equal "0"**, all from return RVA `0x148324B7`. Exact caller is
  `LNAKHNBDHDJ` at `0x14832350`, which loads a shared string reference at `0x1483243D`.
  Do not treat these as zero actual damage. The zero path is a presentation-item creation path.

Fresh v7 dump includes **METHOD_FLAGS / RETURN_TYPE / PARAM_TYPE**, unlike the older v6 listing.
Use it before inferring signatures. Target has 16 declared parameters, including String, damage
text category enum, Vector3, booleans, DamageElementType, entity, Vector2 and more. `arg6` low32
is the declared DamageElementType; other enum numeric values require actual enum constants,
not the FIELD_TYPE row ordinal. Return type is DamageTextItem.

**Upstream continuation now grounded in disassembly:** `DGAIFFKFHMO` (`0x14831910`) takes a
System.Single as its first declared argument (XMM1; stored at `0x14831948`). It calls the zero
creator at `0x14831E35`, converts its returned item through `0x1B103F90`, then passes the saved
float to `0x1B104120` at `0x14831E63`. Other branches also pass that float to the same method.
The fresh dump names this method `PNDODKIKGNA`, with parameters Single, IFMEFPGOMNF, Single.
This is a concrete next observation point for numeric updates/aggregation, not proof that it is
the combat calculator. The immediate zero-string caller itself has no float parameter; an early
progress message conflated it with this upstream routine. Exact call-site inspection corrected it.

Analysis artifacts/scripts:

- Capture directory: `summary.json`, `decoded-text.json`.
- `tools/{summarize-damage-probe,decode-damage-text}.mjs`.
  The decoder's class pointer is specific to this capture; never reuse it as a stable address.
- `tools/discovery/inspect-damage-callers.py` and `damage-probe-fn-*.txt` for exact
  entries 14832350, 14831910, 14830170, 1482F330 and 148284B0.
- Working Python: `~\.local\bin\python3.14.exe`; the Python312 directory has no
  executable. Installed Capstone 5.0.7 into `local-data/tools/python-libs` (network approval was
  needed). Set PYTHONPATH there. Installed package permissions required elevated offline execution;
  the misleading sandbox import error was a permissions issue, not missing Cs API functionality.

Pending: recording location requested from user; no video found in today's laptop Videos search,
and no settlement found in the client-root `logs` path. Do not ask the user to repeat gameplay
yet. Preserve this capture and identify numeric update behavior before preparing another probe.

### Recorded second run — 2026-09-12, video 08:54:02 local

The game stayed open; this run appended to the same PID 41548 TSV. Archived updated logs and the
user's video from the laptop into
`local-data/damage-probe-captures/20260912-085402-video/`. The previous archive remains intact.
Video: `2026-09-12 08-54-02.mp4`, 1280x720, 30 fps, 221 seconds, 463,452,781 bytes.
SHA256: `65C7C664E86268F83B6915475FA1CD3C317885EC86685F0909194E55AE3CAA34`.

Updated TSV has 494 records total. Second-run records 263–494: **232 events**, **67 nonzero
strings**, **165 zero placeholders**. All report zero skipped events, 112 stack bytes and 64
snapshot bytes. This is successful operation for the recorded sequence, not proof of complete
combat-event coverage.

**Video-confirmed exact values:**

| Probe sequence / elapsed ms | Visible label | Logged/displayed number | Video frame time |
|---|---|---:|---:|
| 278 / 1906079 | Windswept | 479367 | 30.8 s |
| 279 / 1906079 | Vortex | 1264425 | 30.8 s |
| 295 / 1916141 | Vortex | 2088757 | 41.7 s |
| 296 / 1916735 | Abloom | 55607 | 41.7 s |

Screenshots `frame-30.8.png` and `frame-41.7.png` are retained with the logs, along with
`visual-matches.json`. Times mark when a number is visible, not an exact log-to-video clock
calibration. The 31.4/31.9-second Abloom frames have overlapping numbers; use the clearly legible
41.7-second frame for the independent Abloom confirmation. `75688` is visible at 28.4 seconds,
but occurs twice in the log, so that frame alone does not uniquely identify its event.

**Negative control:** `frame-4.png` shows nonzero ordinary attack numbers including 3652, while
early second-run probe strings are zero. This confirms the placeholder branch cannot supply those
values from its String argument. No claim is made that arbitrary floating-point register contents
at the current hook recover that missing damage.

Conclusion: the existing probe has now captured **real, screen-confirmed Windswept, Vortex and
Abloom display values**, which the animation-event logger could not supply. It remains incomplete
for ordinary damage and does not establish raw unrounded results, attribution for every row, or
absence of presentation aggregation. The next implementation should observe the numeric update
path identified above while retaining this string probe for cross-checking. No additional replay
of the same test is needed before that implementation exists.

Tooling note: ffmpeg/ffprobe are available on PATH. The large SMB video copy held the local file
unreadable until it completed; an early ffprobe returned Permission denied. Waiting for the copy
fixed it. Do not interpret that error as a damaged recording or request a replacement video.

### Numeric-update probe — built, tested, staged 2026-09-12 (Claude, continuing Codex)

Codex's session ended after writing the second probe; this section records its state as found
and what was done to finish staging it. Nothing below is a live result yet.

**Target:** `PNDODKIKGNA` at `0x1B104120` — the method `DGAIFFKFHMO` (`0x14831910`) hands the
saved float to (call sites `0x14831CFA`, `0x14831E63`, `0x148321D6`). Independently re-read from
`local-data/crash-analysis/damage-probe-fn-1b104120.txt`:

- Prologue `push rsi; push rdi; sub rsp,0x58; movaps [rsp+0x40],xmm7; movaps [rsp+0x30],xmm6`
  is exactly 16 bytes with an instruction boundary at +16 and no RIP-relative operand before
  +0x1C. So a 16-byte relocation is correct, and the old 12-byte boundary would split an
  instruction — the source comment saying so is right.
- Arguments as used: `rcx` = this (the damage-text item), `xmm1` = input float, `r8d` = enum
  (`IFMEFPGOMNF`), `xmm3` = second float. Normal path:
  `[this+0x2C] = min(cap, min(cap, input) + [this+0x2C])` — an accumulator with an upper clamp,
  so the value on screen is the running sum and the per-call `input` is the per-update amount.
  The probe logs `input`, `aux`, the enum, and `prior` (`[this+0x2C]` **before** the add).

**Code state:** `damage_probe.c` has `damage_numeric_start()` / `damage_numeric_record()`;
`damage_probe.S` instantiates the same register-preserving bridge for it
(`damage_numeric_entry`); `dynlib.zig` calls `damage_numeric_start()` only when the string probe
returned status 1, and logs `damage numeric probe status N` (1 installed; -3 fingerprint mismatch;
-7 string probe not installed; -6 duplicate; -4/-5 allocation/output). Same
`damage-probe-enable.txt` gate. Output file `damage-numeric-<UTC>-<pid>.tsv`, header:
`sequence elapsed_ms thread skipped caller caller_rva item input_value input_bits category_raw
aux_value prior_accumulator object_bytes item_mem0..7`. `elapsed_ms` shares the string probe's
epoch, so the two files can be interleaved directly (and `hits.tsv` still has its own epoch).

**Verification (this session):** all three test executables pass —
`damage-probe-test` (10,000 string-bridge + 10,000 numeric-bridge calls, both relocated
prologues, FP returns), `damage-probe-record-test` (both recorders, input/prior distinction, no
mutation, unreadable pointers, LastError, contention), `damage-probe-install-test` (prerequisite
gate, wrong fingerprint leaves target untouched, 16-byte patch/stub, duplicate refusal).
`zig build -Doptimize=ReleaseFast --global-cache-dir .zig-global-cache` is a cache hit against
the current sources: the DLL is exactly what they produce. Both header strings
(`target_rva=0x1482c410`, `target_rva=0x1b104120`) are present in the binary.

**Deployed DLL:** SHA256 `B92300A1D5DA01087612E981B048338759221E2D78ABE7906B458D5F33BA9E47`,
copy in `local-data/tools/damage-probe/build-20260912-numeric/` with the sources and tests.

**Laptop staging:** on `\\<laptop>\...\<client dir>`, `damage-probe-ready.dll` replaced with
this build (remote hash verified equal); the previous string-only build kept beside it as
`damage-probe-ready-stringonly-E74568B1.dll`; `Install-DamageProbe.ps1` checksum updated to the
new hash. The installed `thaumiel.dll` was **not** touched — the user closes the game and runs
`START DAMAGE TEST.cmd`, which backs up the current DLL and `hits.tsv`, installs, and launches.
The existing `damage-probe-20260912-122246-41548.tsv` on the laptop is already archived locally
(byte-identical to `damage-probe-captures/20260912-085402-video/`); a new launch creates new
files, nothing is overwritten.

**What the next capture must establish, in order (none assumed):**

1. Console shows `damage probe status 1` **and** `damage numeric probe status 1`. Any other
   numeric status: record it, do not bypass the fingerprint.
2. Ordinary attacks now produce numeric rows whose `input_value` (or running `prior + input`)
   equals the on-screen number in the recording — the negative control that failed for the string
   probe (`frame-4.png`, 3652). If the enum distinguishes categories, label it from those matches.
3. Whether one visible number is one row or the sum of several rows (per-hit vs aggregated
   display) — compare row counts near a multi-hit action against `hits.tsv` trigger counts in
   the same window.
4. Whether `caller_rva` values lead outside the damage-text class; those are the way toward the
   obfuscated calculation and the attacker stat snapshot.
5. Whether anomaly rows also pass through here (they arrive as strings via the first probe; if
   they also hit the accumulator, de-duplicate by `item`).

Interpretation stays separate from observation: a float that equals a screen number is a
candidate until it repeats across several distinct hits.

### Second live capture — 2026-09-12, 13:19:49 UTC launch (PID 17188), numeric + string probes

Console statuses were not captured, but both output files exist, so both probes installed.
Archived in `local-data/damage-probe-captures/20260912-131949-numeric/` with a README and a
per-event `damage-text-events.csv`. Team Grace / Velina / Rina. **Two fights in one process,
user-confirmed:** elapsed 70–107 s with the in-game damage-number setting on **cumulative**
(then cancelled), elapsed 140–352 s on **separate** (full fight). The two settings take two
different code paths, which is the result of this capture.

**Separate setting (2,173 string rows, 0 numeric rows):** every ordinary hit arrives at
`LJFFPFFICNK` (`0x1482C410`) as its **final formatted damage string**, from return RVA
`0x14830393`. The `"0"` placeholder path is not used at all. Arguments, labelled by internal
consistency (video match still pending):

| Arg | Reading | Evidence |
|---|---|---|
| `arg1` (rdx) | `System.String` of the displayed number; `!!` suffix on crits | 1,937 rows shaped `#`, 236 shaped `#!!` |
| `arg2` | display category: **0 hit, 1 crit, 3 anomaly** | `arg2=1` on exactly the 236 `!!` rows; `arg2=3` on 66 rows whose values are 63,193–3,286,348 (the Windswept/Vortex/Shock/Abloom numbers) while `arg2=0` never exceeds 127,161 |
| `arg6` low32 | `DamageElementType` | 200 / 203 / 204 only — matches Grace's Physical basics, Electric, Velina's Wind; same codes as `hits.tsv` |
| `arg7` / `arg8` | constant 1 / 0 | unknown, not distinguishing anything here |
| `arg9` | target entity pointer | one value on 2,169 rows, three others on the rest |

Crit ratio sanity: same-timestamp groups such as `8811!! + 4406 ×3` and `11316!! ×3 + 5658`
are 2.00×, i.e. this build's CRIT DMG multiplier. Row counts are per hit, not aggregated:
multi-hit actions produce one string per hit at the same millisecond.

**Cumulative setting (258 numeric rows; string rows only `"0"` placeholders + anomaly):** the
item is created with `"0"` via `LNAKHNBDHDJ` and every hit is added through `PNDODKIKGNA`
(`0x1B104120`), return RVAs `0x1483291C` (239) / `0x14832B14` (18) / `0x14832E37` (1) — all in
`KDFGBFBPDHN` (`0x14832590`), not the `DGAIFFKFHMO` call sites predicted from disassembly.
`input_value` is the **unrounded per-hit damage as a float** (e.g. `1789.1106`, and a `3578.22119`
= 2.000× crit on the same item); `prior_accumulator` is the running on-screen total. `aux_value`
is a constant `1200` (probably a display duration in ms). `category_raw` is 0 on 230 rows and 1
on 28 and is **not** the crit flag (the 2× row has category 0); meaning unknown. Five distinct
`item` pointers over the 30 s = five on-screen counters.

**Anomaly numbers (Windswept / Vortex / Shock / Abloom) go through the string path with
`arg2=3` in both settings.** They never touch the accumulator.

**So the two settings are complementary, and both are direct-damage loggers:**

- *separate* → per-hit integer damage as displayed, crit flag, element, target. This is the
  Leifa-style row minus the attacker stat snapshot.
- *cumulative* → per-hit unrounded float damage, no crit flag. Better for checking a formula to
  the decimal; worse for attribution.

Both leave the AnimEvent hook (`hits.tsv`, own epoch) as the source of which action/skill id a
hit belongs to; joining the two is by time order, since the damage-text call has no skill id.

Interpretation still owed: frame-match a handful of `!!` and plain values against the
separate-run recording (user has recordings of both runs) to confirm `!!` is the crit style and
the values are exact. Numeric-probe `category_raw` meaning. `arg7`/`arg8`/`arg10`. Which
`element` code is which attribute beyond the three seen (200/203/204 ↔ Physical/Electric/Wind is
inference from team composition, consistent with `hits.tsv`).

### Video confirmation of the second capture — 2026-09-12

Recording of the separate-setting fight: laptop `Videos/Captures/绝区零Beta 2026-09-12 09-22-14.mp4`
(1920×1080, 59.94 fps, 222.6 s), archived beside the capture as
`separate-run-2026-09-12-09-22-14.mp4`. Alignment `elapsed_ms ≈ video_s × 1000 + 142 400`,
calibrated on the opening hits. Matches, with crops in `frames/` and `visual-matches.json`:

| Probe | String | `arg2` | `arg6` | On screen |
|---|---|---|---|---|
| 163703 | `8811!!` | 1 | 203 | large outlined blue **`8811!!`** — crit style |
| 163703 ×3 | `4406` | 0 | 203 | small plain blue `4406` stacked under it |
| 178109 | `587006` | 3 | 204 | **`WINDSWEPT!! 587006`** |
| 180406 | `1787798` | 3 | 203 | **`VORTEX!! 1787798`** |

So the labels in the previous section are now **confirmed, not inferred**: the string is displayed
verbatim (the `!!` is the crit style), `arg2` is 0 hit / 1 crit / 3 anomaly, `arg6` is the element
on ordinary hits. One open point: the Vortex row's `arg6` is 203 (Electric), so on anomaly rows it
may be the element of the anomaly that closed the vortex rather than a "vortex element" — do not
read `arg6` as the anomaly type; the type comes from the subclass that rendered it (not captured;
would need the `QueryDamageTextInfo` / special-text path, or simply the label from the video).

The cumulative-setting recording (`09-20-57.mp4`, cancelled run) was not needed and was not
copied.

### Daze, stun flag, buildup — anchors found, not hooked (2026-09-12)

The damage text has no reason to carry Daze, and doesn't. The same named-UI trick gives:

- **Daze bar:** `MoleMole.UIStunDamageWidgetController::UpdateStunDamageUI(Single, Int32, Single,
  Int32)` @ `0x1965B6A0`, with `SetEntity(EntityHandle)` @ `0x1965AE90` naming the enemy and an
  obfuscated same-signature sibling `NHFLNIGLCLJ` @ `0x1965C070`. `ShowStunDamageValue(bool)` is
  a debug toggle that renders the Daze number itself. Argument meaning (current / max / state?)
  is unknown until captured. `ManualUpdate` exists, so this may be polled per frame rather than
  per hit — per-hit Daze would then be the per-frame delta, which is still exact when hits are a
  frame apart.
- **Boss HUD view model:** `LevelBossHudWidgetViewModel` (global namespace):
  `SyncHpAndStunFlowSt()` @ `0x196064C0`, `TryRefreshStunStateByEntityState(UInt32)` @
  `0x196078D0`, `UnLockStunMaxViewAndRefreshStunValue()` @ `0x19607AD0`. Enemy HP and Daze in
  one place, if the fields it writes are identified.
- **Stun flag:** `OnStunResetStateChange(LHNLCBEDPNA)` is handled by four readable controllers
  (`UIInLevelMonsterHudWidgetChildWindowController` @ `0x13F7C7D0`, `UIInLevelMainPageController`
  @ `0x195A8640`, and two toolbar boss widgets). It is an event on stun-state change, so hooking
  one handler gives stun start/end timestamps; `LHNLCBEDPNA` is the (obfuscated) event payload.
- **Anomaly buildup gauge:** no readable method or field found by name (`Abnormal`/`Accum`/
  `Element` searches hit only material tint modifiers and unrelated code). Not exposed the easy
  way. What *is* already captured: the proc moments — every `arg2=3` row is an anomaly firing,
  i.e. the instant the gauge filled — and `hits.tsv` carries each hit's buildup share from
  config. Predicted fill time vs observed proc time is a valid end-to-end check on buildup
  without per-hit values.

None of these is hooked. The Daze widget is the obvious next probe: same bridge, 4 declared
arguments, readable name — a few lines in `damage_probe.c` once its prologue is read from the
saved binary.

### Joining `hits.tsv` (ability) to the damage text (result) — measured 2026-09-12

The two logs share a clock: both stamp `GetTickCount64()` minus a start set in the same
`initPatches()` a few ms apart. In the 131949 capture the offset is ~47 ms (text − trigger has a
hard floor of −47 across every skill), so `text_ms + 47 ≈ trigger_ms` on one timeline. The
earlier "separate epoch" caveat is only that offset.

Join rule tested: for each displayed ordinary hit, the nearest preceding `hits.tsv` trigger with
the same element within [−50, +1500] ms. Separate-setting window, 1,976 triggers vs 2,113
displayed ordinary hits, 59 displayed hits with no candidate.

- **Instant hits are deterministic:** Grace basics `1181001/2/3/4`, Rina EX `1211009`, Velina
  `1561006/9` — median delay 0, p75 ≤ 16 ms (one tick quantum), max ≤ 16–140 ms.
- **Delayed hits are ambiguous:** Grace `1181016/17/08/09` (grenade detonations) tail to
  1.1–1.3 s after the launching trigger; `1561007` cyclone and `1181011` QA to ~0.8 s;
  `1211026` to 1.4 s. With Grace and Rina both Electric, nearest-same-element can pick the wrong
  ability in these windows. More displayed hits than triggers = multi-target hits and
  sub-projectiles; 137 surplus here.

The damage-text entry carries no ability: its declared parameters (v7 dump, `LJFFPFFICNK`) are
String, category enum, Vector3, bool, bool, `DamageElementType`, `IGHLBPEDELJ`, UInt32,
**`MoleMole.Battle.Entity` (target)**, Vector2, `SpecialDamageTextType`, bool, **`CMCIBGLJJCO`**,
bool, bool, `LEIJMKINAHL&`. Read bools by low byte only — the rest of the slot is stale stack.
`SpecialDamageTextType` low32 is 0 on ordinary rows and 15 / 22 on anomaly rows; the enum's
member names are in the dump (`Wind`, `WindCatalyze`, `Thunderbolt`, `Disorder`, `Froze`,
`Refringe`, `Luminize`, …) but not their constants, so 15/22 are unmapped.

**Closing the gap, cheapest first:**

1. `p12` (`CMCIBGLJJCO`, 77 obfuscated fields, parent `OANDKEBLEIB`) takes only 4–5 distinct
   pointer values per fight with counts 1169 / 506 / 449 / 45 — proportional to per-agent hit
   counts. Snapshot it in the next probe; if it is attacker-side it resolves attribution.
2. From inside the hook, scan raw stack words for addresses in GameAssembly's `il2cpp` section
   to find the calc-side caller of the damage text; hook that. It holds attacker, AttackProperty
   (skill id), target and result together — the Leifa-style hit-result hook, and the route to
   the attacker stat snapshot and per-hit Daze.
3. The settlement `.pb` per-skill totals are ground truth for the time-join (`battle-report-
   packets.md`). Not captured on the laptop today — its Remielle is not the battlestats build
   (no `logs/` directory). Swapping that exe in makes every fight self-checking.

### Stack-scan build (schema 2) — built, tested, staged 2026-09-12

Purpose: find the calc-side caller of the damage text (option 2 above) and snapshot `p12`
(option 1), without adding a hook. Changes are confined to the string probe's recorder.

- `damage_probe.c`: `load_exec_ranges()` reads GameAssembly's executable sections from the PE
  section table at install. `looks_like_return(a)` accepts a word only if it lies in one of them
  **and** the bytes before it encode a call (`E8 rel32`, `FF 15`, `FF 9x`, `FF 5x`, `FF 1x`,
  `FF Dx`, and the `41` REX forms) — vtable/method-pointer data pointers into code fail this.
  `scan_returns()` tests the 512 words above the hook's entry stack pointer (no frame pointers
  assumed) and keeps up to 16 hits, shallowest first. Every read is `ReadProcessMemory`.
- Row schema 2 = schema 1 + `p12_bytes p12_mem0..15` (128-byte snapshot of declared parameter
  `CMCIBGLJJCO`, stack slot 9) + `ret_count ret0..15` (`stack_index:rva`). Header line says
  `schema=2`. Existing decoders parse by header name and still work; note that rows end in empty
  cells, so parsers must not `trim()` the whole file.
- Tests: `damage_probe_record_test.c` gained `test_return_scan()` — synthetic code page with each
  call encoding, a NOP-preceded pointer rejected, out-of-range rejected, scan index/rva/cap
  checked. All three executables pass. DLL SHA256
  `A6DD681ED490FD0B5A30B523C780209C225770434069651519B3DBE275118936`, copy with sources in
  `local-data/tools/damage-probe/build-20260912-stackscan/`.
- Laptop: staged as `damage-probe-ready.dll`; the numeric build kept beside it as
  `damage-probe-ready-numeric-B92300A1.dll`; installer checksum updated. Installed DLL untouched
  until `START DAMAGE TEST.cmd` is run.
- Analysis: `node tools/attribute-returns.mjs <capture.tsv>
  <il2cpp-v7.tsv>` maps each return RVA to the nearest preceding METHOD start in the dump
  (heuristic — no `.pdata`; >64 KB past a start is reported unattributed), prints the most
  common chains per display category, the first return outside the damage-text classes (the
  calc-side caller candidates), and `p12` cardinality. Verified on a synthetic capture.

Test needed: any short fight on the **separate** damage-number setting (the string path), a
few multi-hit actions and at least one anomaly proc. No recording required for this one — the
question is which function calls the UI, not what the numbers are.

### Stack-scan capture — 2026-09-12 13:54:24 UTC (PID 2248): the caller is an event, and the payload is the key

Archived in `local-data/damage-probe-captures/20260912-135424-stackscan/` with `attribution.json`.
172 hits, 30 distinct return addresses. Read with the caveat that a raw stack holds stale return
addresses from earlier calls at the same depth; only what is invariant across rows is trusted.

- Inside the damage-text container, invariant: hook ← `BGGJIEPIODP` ← `KNFPPHPGJBB` ←
  `GJKILDBKHFM(6)` ← **`HBIMAECOHPC(4)` @ `0x1482D830`**.
- Then `0x978D39`, in `.text` — the il2cpp **runtime**, not game code (the dump's nearest name,
  `CalculateJob::Execute`, is 700 KB away and meaningless). A runtime frame between game frames
  is a delegate invoke: `HBIMAECOHPC` is an **event handler**.
- Beyond it the words are stale: `PBPMMLJOCND::MHDNLDOMINJ(LogicButtonInputType,
  ButtonPressType, …)`, `GIKMKILEBIM::GKHNMCBDDFA(LogicButtonInputType)` and Unity InputSystem
  frames — **input polling** from earlier in the frame, not the firer. The addresses the dump
  cannot attribute (`0xB7CFE93`, `0xECE92E6`, `0xBE8CEC3`, …, >59 MB from any listed method)
  are unresolved; do not build on them. **The firer was not identified, and does not need to be.**
- `p12` was again exactly four objects (107 / 32 / 28 / 5) — three Agents and the Bangboo.

**The payload.** `HBIMAECOHPC(AGLNJHOEMAL&, MoleMole.Battle.Entity, HNNMFCJLDHF, Vector3)`:
the second parameter is the target entity, the third is its view object (renderers, colliders,
transforms — positioning only), and the first is the **damage-display event struct** the combat
engine hands the UI. From the v7 dump (`AGLNJHOEMAL`, 27 fields):

| dump offset | type | dump offset | type |
|---|---|---|---|
| 0x10 | UInt32 | 0x50 | `DamageElementType` |
| 0x14 | UInt32 | 0x54 | Boolean |
| 0x18 | `EntityHandle` (16 B) | 0x58 | `IGHLBPEDELJ` |
| 0x28 | `Config.EntityType` | 0x5C | Single |
| 0x2C | Vector3 | 0x60 | `SpecialDamageTextType` |
| 0x38 | Vector3 | 0x64–0x6C | 9 × Boolean |
| 0x44 | Single | 0x6D | `LEIJMKINAHL` |
| 0x48 | `OGDEPEKFALC` | 0x70 | Single |
| 0x4C | Boolean | 0x74 | Int32 · 0x78 Boolean |

The handler's own disassembly (`local-data/crash-analysis/damage-probe-fn-1482d830.txt`) reads
`[rdx+0x40]` as the element and `[rdx+0x50]` as the special-text type — dump offsets 0x50 and
0x60 — so **rdx points at the struct and dump offset = rdx offset + 0x10**. Two UInt32 ids, an
`EntityHandle` distinct from the target parameter, and three floats: a skill id, the attacker,
and an unrounded damage value would all fit; none is labelled until captured.

### Event-handler probe build — built, tested, staged 2026-09-12

Third hook, `damage_event_start()` on `HBIMAECOHPC` @ `0x1482D830`. Same eight-push prologue as
the string probe (12-byte relocation, 64-byte fingerprint from the saved binary), same bridge,
gated on the string probe's status 1. Output `damage-event-<UTC>-<pid>.tsv`, shared clock, one
row per displayed number: `this event_ptr target_entity arg3 event_bytes`, then a decoded view
named by dump offset (`u32_10 u32_14 handle_18 handle_20 u32_28 f32_44 u32_48 b_4c element_50
b_54 u32_58 f32_5c special_60 b_64..b_6d f32_70 i32_74 b_78`), then the 14 raw words and the
Vector3 pointer from stack slot 0. Console line: `damage event probe status N`.

Tests: bridge (10,000 calls through the eight-push relocation with five integer args, one on
the stack), recorder (synthetic struct → `1181004`, `4406.375`, `203`, crit bit decoded at the
right offsets; unreadable struct still yields a row with `event_bytes 0`), installer (12-byte
patch/stub, fingerprint refusal leaves the target untouched, duplicate refusal, prerequisite
gate). All pass. DLL SHA256 `0C7297BCB089ABDA2F6C7362E69019D429A4CF3BB6B1C095696D56EF0C68D814`,
copy with sources in `local-data/tools/damage-probe/build-20260912-event/`. Staged on the laptop
as `damage-probe-ready.dll` (stack-scan build kept as `damage-probe-ready-stackscan-A6DD681E.dll`),
installer checksum updated.

What the next capture must establish, in order: (1) `damage event probe status 1`; (2) one
event row per string-probe row, same millisecond; (3) whether `u32_10`/`u32_14` are skill ids —
compare against `hits.tsv` skill ids in the same window; (4) whether `handle_18` identifies the
attacker — four distinct values tracking `p12`; (5) which of `f32_44`/`f32_5c`/`f32_70` equals
the displayed number before rounding; (6) which `b_*` is the crit flag (must equal `arg2==1` on
the string row). A recording is not needed for (1)–(4); it helps for (5).

### Event-probe capture — 2026-09-12 14:44:27 UTC (PID 13656): attacker, unrounded damage, crit — not the ability

Archived in `local-data/damage-probe-captures/20260912-144427-event/` with a joined
`damage-events.csv`. Short fight, separate numbers. **185 event rows = 185 string rows**, paired
by sequence at most 15 ms apart; `event_bytes` 112 and `skipped` 0 on every row.

Labels established (each on all 185 rows unless stated):

| Field | Meaning | Evidence |
|---|---|---|
| `f32_44` | **final damage, unrounded** | displayed number == `ceil(f32_44)` on 185/185 (`530.0515` → 531, `1374.224` → 1375). Not round, not floor. |
| `u32_48` (`OGDEPEKFALC`) | **crit flag**: 2 = crit, 0 = not | equals the string probe's `arg2==1` on exactly the 16 crit rows |
| `element_50` | element | equals string `arg6` 185/185 |
| `special_60` | anomaly type when non-zero | 0 on ordinary hits; 23 on a 512k Wind row, 22 on a 1.47M Electric row (Vortex, cf. the earlier `VORTEX!! 1787798` also Electric), 15 on two ~60–105k Wind rows (Abloom-sized). Mapping to enum names still unproven. |
| `u32_14` + `handle_18/20` | **attacker entity** (index + handle) | four values (5 / 7 / 6 / 9) whose counts track the avatar ids below; anomaly rows carry the *owner* (Windswept/Vortex → Velina, the Electric tick → Grace) |
| `i32_74` | **attacker avatar-level id**, not the ability | `1181001` on every Grace row while `hits.tsv` shows her `1181002/3/4`, EX, assists in the same fight; `1211001` all Rina, `1561001` all Velina, `5400801` Bangboo, `0` on anomaly rows |
| `f32_70` | display duration ms | 1200 on hits, 0 on anomaly rows |
| `u32_10`, `u32_28`, `u32_58`, `f32_5c`, all `b_*` | constant this fight (32, 2, 1, 0, 0) | not distinguishing anything yet |
| `target_entity` | one enemy | single value |

**Correction to the interim reading:** the first rows happened to be basic-attack openers, so
`i32_74 == 1181001` looked like a skill id. It is the attacker's id in skill-id form. The event
struct does **not** carry the ability.

**Where the ability lives.** `NMDONLEGPIN(AGLNJHOEMAL)` @ `0x1482D390` calls `HBIMAECOHPC`
directly (`call 0x1482D830` at `+0x21C`, disassembly `fn-1482d390.txt`), after checking an
`SGF.SEvent.DelegateEx` for null: it is the container's **subscriber** to an SGF event whose
payload is the struct. The earlier "runtime frame between game frames" was stale (NMDONLEGPIN's
own callees at the same depth). The publisher is the combat engine, behind a generic
`DelegateEx<…>.Invoke` — generic instantiations are exactly what the dump has no addresses for,
which is why the unattributable return addresses (`0xB7CFE93`, `0xECE92E6`, …) exist. That
publisher has the hit result and hence the ability, but it is unnamed and unhooked.

**Net state of the ability↔damage join:** the attacker is now exact per damage instance, so the
time-join to `hits.tsv` becomes per-agent (nearest preceding trigger *by the same attacker*),
which removes the Grace-vs-Rina failure mode. What remains ambiguous is same-agent overlap of a
delayed projectile with a later attack (Grace's grenades). Closing that requires the publisher:
hook `NMDONLEGPIN` and log `entry_stack[0]` (its exact caller, the generic invoke) and the next
few call-preceded words (the publisher's return address), then read that publisher's prologue
from the saved binary and hook it. Two discovery rounds; not started.

### Plan to a complete per-hit log (decided 2026-09-12) and the raw-stack build

Goal restated by the user: a Leifa-grade log of a whole fight, for other people and for checking
the calculator against real numbers directly — not just what the calculator needs.

**Approach.** Every remaining column (ability, Daze dealt, buildup dealt, Energy/Decibels,
attacker stats, tags) was read by Leifa's hook from one hit-result object inside the calc. The
damage-display event is downstream of it and carries only what the UI needs. So the next hook is
on the function that produces or consumes the hit result, not on more UI widgets. It is reached
by unwinding from `NMDONLEGPIN` (the SGF-event subscriber) to the publisher and its callers.

**Why the earlier scan could not find it.** Raw stack words mix live return addresses with stale
ones; only a frame-by-frame unwind separates them. `.pdata` is mangled, so the unwind is done
offline from prologues: il2cpp pads between functions with `CC` plus an alignment NOP
(`0F 1F 40 00`, `66 90`), so a function's start is found by scanning back from a return address
to that padding; its prologue (`mov [rsp+d],reg` stores, pushes, optional `mov/lea rbp`, `sub rsp,
imm`) gives the frame size; the caller's return-address slot is `slot + 8 + frame`. Each step is
verified (the word must sit in an executable section and follow a call encoding), so a wrong
frame size stops the walk instead of inventing a caller.

- Tool: `tools/unwind-event-stack.mjs <damage-event.tsv>
  <GameAssembly.dll> <il2cpp-v7.tsv> [rows]`. `--selftest <GameAssembly.dll>` checks it against
  known functions: HBIMAECOHPC = 8 pushes + `sub 0x158`, NMDONLEGPIN start `0x1482D390` recovered
  from its return site `0x1482D5B1`, BGGJIEPIODP start recovered from `0x14830393`. Passes.
- Probe: event probe schema 2 appends `rsp_entry` and 384 raw stack words (`raw0..383`, 3 KB)
  to every row. Nothing is classified in-process. Row ≈ 8.5 KB; a full fight ≈ 15–20 MB.
  Tests updated and passing (recorder asserts `rsp_entry` equals the entry stack pointer).
- DLL SHA256 `106BD37ABB52E81B82E505C0F99165E5AFE96B2A9CF55A577CB49EE7BB2B3519`, sources in
  `local-data/tools/damage-probe/build-20260912-rawstack/`; staged on the laptop, installer
  checksum updated, previous build kept as `damage-probe-ready-event-0C7297BC.dll`.

**Sequence from here.**
1. Short fight with this build → unwind ~20 rows → the chain above `NMDONLEGPIN`: the generic
   `DelegateEx.Invoke`, the publisher, and its callers. Name them via the dump where possible
   (obfuscated names still come with parameter types; a method taking `(Entity, Entity,
   Struct&)` whose struct has dozens of float/enum fields is the hit result).
2. Read that function's prologue from the saved binary, hook it with the same bridge, snapshot
   the hit-result object → one row per hit with ability, damage, crit, Daze, buildup, Energy,
   and (if the attacker's property map is reachable from it) the stat snapshot.
3. Deploy the battlestats Remielle so every fight's settlement gives per-skill totals to check
   the log against itself.

Client updates: each hook is a name lookup in a fresh dump plus a new 64-byte fingerprint; the
dump itself (and re-finding the API table offset in `UnityPlayer.dll`) is the real cost.

### Raw-stack capture — 2026-09-12 17:26:39 UTC (PID 33636): the events are queued; settlement check passes exactly

Archived in `local-data/damage-probe-captures/20260912-172639-rawstack/` with the fight's
settlement (`endbattle_1.pb` + `_loadout.json`, copied from
`<remielle-battlestats>/logs/` on the laptop). 181 event rows.

**Unwind result (identical on every row):**

```
[0] NMDONLEGPIN                                  the SGF-event subscriber (frame 5*8+0x130)
[1] 0xBE8CDF0 (unnamed; 8*8+0x368)               dispatch — invokes the subscriber
[2] FHJJBJLAPCN::CMJCANIMGJN(Action<AGLNJHOEMAL>) drains a Queue<AGLNJHOEMAL>
[3] UIInLevelDamageTextContainerChildWindowController::OnUpdateText
[4] UIInLevelMainPageController::AFGDAMHIEAP     (main-page update)
```

So damage-display events are **queued at hit time and drained in the UI update**. The publisher
is not on the UI stack and can never be found from it. `FHJJBJLAPCN` is a static holder whose
only state is `Queue<AGLNJHOEMAL>`; its methods are `JJDHHPGOMMD(AGLNJHOEMAL&)` @ `0x142ACFF0`
(**enqueue** — copies 0x70 bytes from `rcx` into the queue, confirming the struct size),
`CMJCANIMGJN(Action<…>)` (drain), and three no-arg housekeeping methods. Hooking the enqueue gives
the publisher as its exact return address and the combat stack at hit time.

**Settlement self-check (first end-to-end proof of the damage log).** Settlement layout in this
build: top `8 → 6 → 7[]` per avatar; per avatar `7` total, `25` direct, `14[]` = `{1 skill,
2 damage, 4 uses, 10 hits}`, `29[]` = `{1 anomaly type, 2 count, 3 damage}`. Event probe, direct
rows (`special_60 == 0`), summed after `ceil`:

| Avatar | settlement `25` | event probe | anomaly |
|---|---:|---:|---|
| 1181 Grace | 267,707 | **267,707** | settlement 54,805 (type 27 ×1) = event 54,804.97 → ceil |
| 1211 Rina | 55,789 | **55,789** | — |
| 1561 Velina | 83,623 | **83,623** | settlement 660,511 (type 39 ×3) + 1,416,379 (type 40 ×1); event per-attacker total 2,160,497.8 vs `7` = 2,160,513 (33 rows of ceil) |

Exact on all three. The log captures every displayed damage instance with no gaps or doubles,
and the per-skill entries are the reference for checking ability attribution.

Hazard: Remielle's `endbattle_N` counter restarts at 1 on server restart and **overwrites**
earlier files (today's `endbattle_1.pb` replaced an older one). Copy settlements out promptly.

### Enqueue probe build — built, tested, staged 2026-09-12

Fourth hook, `damage_enqueue_start()` on `FHJJBJLAPCN::JJDHHPGOMMD` @ `0x142ACFF0`. Prologue
`push rsi; sub rsp,0x90; mov rsi,rcx` (11 bytes) then `cmp byte ptr [rip+disp32], 0` (7 bytes):
18 bytes relocated, the `cmp`'s disp32 re-based so the stub addresses the same absolute byte;
patch is the 12-byte absolute jump + 6 NOPs. Records the same row layout as the event probe
(shared writer; struct at `rcx`), output `damage-enqueue-<UTC>-<pid>.tsv`, console `damage
enqueue probe status N`. Tests: bridge (10,000 calls through the 18-byte relocation with a
RIP-relative instruction inside it), recorder (rcx-sourced struct decodes identically), installer
(patch + NOP tail, instruction after the region intact, re-based displacement resolves to the
original target, duplicate/fingerprint/prerequisite refusals). All pass. DLL SHA256
`940B1CF91E4DAB0AAB5661102F688140F95990DE6D5174816B879EBC18FBA473`, sources in
`local-data/tools/damage-probe/build-20260912-enqueue/`; staged on the laptop, installer checksum
updated, previous build kept as `damage-probe-ready-rawstack-106BD37A.dll`.

Next capture: unwind `damage-enqueue-*.tsv` (same tool; `caller_rva` is the publisher, frames
above it are the calc). Then hook the function that holds the hit result.

### Enqueue probe, first attempt — 2026-09-12 17:46:34 UTC (PID 32552): refused, cause found

String, numeric and event probes wrote files; no `damage-enqueue-*.tsv`. The fingerprint matches
the saved binary byte for byte, so the refusal was the installer's ±2 GB check: the stub was
`VirtualAlloc(NULL, …)`, which in the game lands far below the module (`0x7FFF…`), and the
relocated `cmp [rip+disp32]` cannot be re-based across more than ±2 GB. The test process had
placed the synthetic image and the stub near each other, so the test could not see this. The
other three hooks relocate no RIP-relative bytes and were never affected.

Fixes (DLL SHA256 `1493CD03A9A6D31A106CB73B2CE5148872A3B3ED99EC6510B89661A84FCB3D96`, staged):

- `alloc_near(target, size)`: walk outward from the target in 64 KB steps until `VirtualAlloc`
  at a fixed address succeeds, so the stub is always within reach; the re-base overflow now
  returns a distinct `-8`. Install test asserts the stub is within ±2 GB of the target.
- `damage_probe_note_status(name, status)`: every probe's install status is appended to
  `damage-probe-status.txt` beside the launcher (`<UTC> pid <n>\t<probe>\t<status>`), so a
  refusal is visible after the console is gone. Read this file first when a capture is missing.

This run's other captures and its settlement (`endbattle_1.pb`, 13:47:46 — note the counter
had already reset once today) are in `local-data/damage-probe-captures/20260912-174634-enqueue-attempt/`.

### Enqueue capture — 2026-09-12 17:52:57 UTC (PID 32836): combat publisher found

Archived immediately with settlement, loadout, hits and install statuses in
`local-data/damage-probe-captures/20260912-175257-enqueue/`. All four install statuses are 1.
`capture-review.json` records the reproducible checks from
`tools/review-enqueue-capture.py`:

- 252 enqueue rows, all 112-byte snapshots, skipped 0; **all have caller RVA `0x134ED786`**.
- All 175 UI event payloads occur in the enqueue payload multiset, including multiplicities.
  The 77 additional enqueue records all have zero damage. Do not demand equal row counts.
- Per-row ceiling of direct damage matches settlement field 25 exactly again:
  Grace 264,247 (102 rows), Rina 51,752 (34), Velina 86,437 (29).

**Publisher:** `CGMHCDLDPOH::ACNDFFDOPMB(KFANJOAHIOH, Entity)` at `0x134E33E0`.
Contiguous disassembly confirms `call 0x142ACFF0` at `0x134ED781`; this is not merely nearest-RVA
ownership. Its frame is eight pushes plus `sub rsp,0x298` = `0x2D8`.

**Unwinder limitation discovered and recorded:** the return site is over 32 KB from entry, beyond
the original search window. Increasing the window to 64 KB found a false prologue at
`0x134E504A` inside an instruction. That experiment was reverted. The unwinder now has a
disassembly-verified mapping for this exact return site, with an assertion in `--selftest`.
The resulting next return is `0xC77491B`; later walking stops on an inconsistent frame. Do not
claim that the entire upstream chain is verified or loosen checks until something prints.
Disassemblies and extracted typed metadata are saved under `local-data/crash-analysis/`:
`enqueue-publisher-134e33e0.txt`, `enqueue-publisher-134ed680.txt`,
`enqueue-publisher-1823a830.txt`, `enqueue-publisher-metadata.tsv`, `hit-types.tsv`.
Scripts `inspect-enqueue-publisher.py` and `extract-hit-types.py` preserve the extraction steps.

**Typed result boundary found without another discovery run:** immediately before enqueue,
the publisher calls `AGLNJHOEMAL::GPIPDCGLLNG` at `0x1823A830` (return `0x134ED761`).
The static signature is `(CJPACFEILFL, Entity, Entity, LBCELJNJAIK, KLHIEGCFDIE, AGLNJHOEMAL&)`.
`LBCELJNJAIK` is the rich hit-data/result object, with fields through `0x28F`, attack-related
strings, property dictionaries, many numeric values and flags. Disassembly establishes:

- `r9` is this result; `rcx` the attack context, `rdx`/`r8` entities; entry stack `[5]` is
  the component and `[6]` is the output event pointer. Context's `+0x30` also references the result.
- Result `float +0x138` is loaded into XMM10 and copied to output event raw `+0x34`
  (dump `f32_44`, the already verified unrounded damage).
- Result `uint32 +0x200` is copied to event raw `+0x38` (dump `u32_48`, verified crit enum).
- Ability identity, Daze, buildup, Energy, Decibels and stat meanings are **not yet validated**.
  Having numeric fields is not proof of their meanings.

### Result probe — next live test

Added `src/damage_result.c`, included by `damage_probe.c`, plus a fifth
assembly bridge and startup status `result`. It hooks the typed conversion at `0x1823A830`,
before conversion, with an exact 64-byte fingerprint. The first 12 bytes are eight complete,
position-independent pushes; no near allocation or RIP rebase is required for this hook.

Output `damage-result-<UTC>-<PID>.tsv` captures the whole `0x290` result, `0x50` context,
two `0x80` entity prefixes, `0x160` component prefix, output-event pointer, and strings referenced
at result `+0x10/+0x40/+0x58/+0x70/+0xA0/+0xC0`. Strings are bounded to 192 UTF-16 units,
stored as hex with original length and bytes-read so truncation/unreadability are explicit.
Snapshots use the OS reader; the callback calls no game method and changes no game object.
It preserves LastError, records lock contention, and bounds each output row below 12 KB.

Native checks: all five bridges exercised 10,000 times each, including the result hook's
different push order and stack arguments; actual result installer tested for prerequisite,
fingerprint and duplicate refusals, relocation and continuation. Recorder tests cover real
file output, unmapped pointers, long-string truncation, unchanged input bytes, LastError,
and contention. Existing four-probe recorder and installer tests also pass.

Next capture must first show `result 1`, then complete result snapshots. Join conversion rows
to enqueue on thread, output-event pointer and order (pointers can be reused), checking
`float +0x138` and crit `+0x200` against the event. Inspect strings and numeric ids against
`hits.tsv` and per-skill settlement totals before assigning ability labels. A short fight with
the existing Wind team, basic strings and EX attacks, ending in a settlement, is sufficient;
no Disorder setup or recording is required for this discovery capture.

Built and staged on the laptop as `damage-probe-ready.dll`, with matching installer checksum;
SHA256 **`3943E8EDA9FF25573CEE6B15335A65F6E6F97CDF4A5CA3638AA6ED6788314B8C`**.
The previous staged DLL is retained as `damage-probe-ready-enqueue-1493CD03.dll`.
The running game's DLL was not replaced. Close the game and use the existing
`START DAMAGE TEST.cmd` to install and launch. Source snapshot, DLL, installer and hash manifest:
`local-data/tools/damage-probe/build-20260912-result/`.

Validation limits: native ReleaseFast build and all four native test executables pass;
`npm run typecheck` passes. The full app suite reports 1,295 passing and four failing tests
(Rina Potential integration and three Remielle Luminize assertions), plus a suite-load failure
in `tools/rva-signature-match.test.mjs` from `process.exit(0)`. These paths were not edited by
this capture-tool task; `battleState.ts` and the signature-matching files were already dirty
at handoff. Output is archived as `repo-tests.txt`. The first sandboxed test invocation could
not traverse the existing Capstone installation (EPERM); the reported full-suite result is
from the subsequent elevated run. No claim that the app suite is green or that the new live
result probe has been validated yet.

### Result capture — 2026-09-12 18:10:46 UTC (PID 23180): live damage/crit mapping passes

Archived as `local-data/damage-probe-captures/20260912-181046-result/`, including
`endbattle_2.pb` and loadout. All five hooks installed (status 1).
`review-result-capture.py` pairs by thread + output-event pointer + occurrence order, then
checks time and float32/crit equality. **270 result rows = 270 enqueue rows; all pair correctly,
all at the same elapsed millisecond, all 656-byte result snapshots, skipped 0.** Result
`+0x138` damage and `+0x200` crit are now live-validated on every row, not just disassembled.
The join is saved as `result-event-join.csv` and its checks as `result-review.json`.

182 UI events all occur in the enqueue multiset; the 88 other records have zero damage.
Direct per-row ceiling again matches settlement exactly: Grace 263,276 (102 rows), Rina
63,865 (39), Velina 85,914 (29). `capture-review.json` records these checks. The review script
now accepts the archive's sole `endbattle_*.pb` instead of assuming counter 1.

**What did not work:** result strings at `+0x10/+0x40/+0x58/+0x70/+0xC0` are empty in this
capture. `+0xA0` is empty or a distance attenuation curve name (`DistanceAttenuation_Lisa`,
`DistanceAttenuation_Curve_01`), not an ability. Searching aligned uint32 fields in captured
result/context/component prefixes for this fight's nonzero trigger skill ids found only result
`+0x284`, which is again an avatar-level display id, not changing attack attribution. Do not
repeat this as an unexplored string/flat-skill-id route or label that field the skill.

**Next evidence source, verified offline:** result `+0x60` is a populated
`Dictionary<string,float>` on all 270 rows; result `+0xB0` is also populated and points to
`LBCELJNJAIK.DCPILLEHKDK` (geometry plus a uint32 at `+0x18`, still unnamed semantically).
Result `+0x18` and base-property dictionary `+0x78` are null throughout this capture.
`AKAPJICNCKE` at `0x167953E0` reads the string dictionary and its numeric values. Its lookup
at `0x129833F0` confirms dictionary entries pointer `+0x18`, array length `+0x18`, payload
`+0x20`, 24-byte entries: hash `+0`, key pointer `+8`, float value `+16`.
Generic-definition metadata offsets are all zero and cannot be used as actual layouts.
Disassembly and type excerpts saved as `result-accessor-*.txt`, `dictionary-layout.tsv`,
`result-nested-types.tsv` under `local-data/crash-analysis/`.

Schema 2 of the same result hook now snapshots that dictionary header, up to 128 raw entries,
their bounded UTF-16 keys, and the 0x78-byte geometry prefix. It preserves raw inactive slots
and records array capacity/bytes read so truncation is visible; null keys and negative-hash
entries have no key-string snapshot. All existing columns remain. A lock-owned static 128 KB
buffer avoids adding a large buffer to the game thread's stack. No additional hook is installed.
Test covers 129 entries (128 captured), the last captured key, omission of inactive and beyond-cap
keys, and long-string truncation. Result test, all five bridges and existing recorder/install
tests pass; ReleaseFast build succeeds. Remaining numeric-field semantics and exact ability
attribution are still pending evidence; matching damage alone does not validate Daze or buildup.

Dictionary build SHA256 `80F4D62D69E51B3326FD6C49AA43DB8AC9A564004E568875D9D437C1D01A5C52`,
staged on the laptop with matching installer; previous staged result DLL retained as
`damage-probe-ready-result-3943E8ED.dll`. Source/DLL/installer/manifest archive:
`local-data/tools/damage-probe/build-20260912-result-dictionary/`. Typecheck passes.
Next test: close game, use `START DAMAGE TEST.cmd`, short fight through settlement with the
same team. No recording needed. First inspect schema 2, readable dictionary/entry sizes and
key names; re-run the result/event and settlement checks before interpreting new fields.

### Dictionary capture — 2026-09-12 18:19:24 UTC (PID 15692): named modifiers recovered

Archived with `endbattle_3.pb`, loadout, hits and statuses in
`local-data/damage-probe-captures/20260912-181924-dictionary/`. All five statuses 1.
220 result/enqueue pairs, complete 656-byte result snapshots, skipped 0, **damage and crit
equal on all 220 pairs**. Largest conversion-to-enqueue timestamp gap 16 ms. All 171 UI
payloads occur in the enqueue multiset; the 49 extra enqueue records have zero damage.
Direct damage per-row ceilings equal settlement again: Grace 251,867 (106 rows), Rina
55,692 (26), Velina 78,318 (29). Checks saved as `result-review.json`, `capture-review.json`.

**Dictionary capture succeeds:** entries array capacity 89 on every row, below the 128-slot
cap. Offline decoder verifies complete entry bytes, active-slot/key coverage, readable complete
key strings, unique keys and finite values. No dictionary truncation in this fixture.
22 distinct raw names recovered, including:

- `Actor_CriticalDelta`, `Actor_CriticalDamageRatioDelta` on all 220 rows.
- `Actor_AddedDamageRatio` on 196 rows (0.08–0.732),
  `Actor_AddedDamageRatio_Elec` on 41 (0.3 or 0.4).
- `Actor_ElementAbnormalPowerDelta` on 55 (84), `Actor_ElementMysteryDelta` on 186 (60–135).
- `Actor_AddedElementAccumulationRatio` on 29 (0.15 or 1.3),
  `Actor_AddedBreakStunRatio` on 11 (0.3).
- `Actor_IsCauseStun` on eight (-1 or 1), `Actor_IsHeavyAttack` on one (1),
  `Actor_Backstab` on 51 and `Actor_CanTriggerElementAbnormal` on 20.
- Several Buff/Disorder/Catalyze/FinalDamage keys on five rows, mostly zero. Their presence
  does not prove a Disorder proc, and no Disorder-specific test was requested.

**Interpretation boundary:** these are named per-hit modifiers, not a full attacker stat
snapshot or measured Daze/buildup amounts. Do not relabel deltas as final stats or infer missing
values as zero. No skill-id key was found. Geometry `+0x18` varies through small integers
(24–323, some repeated), not the seven-digit trigger skill ids; its semantics remain unknown.
These routes have now been tested; another identical run is not needed to rediscover them.

Readable export: `combat-results.csv` (220 rows, verified damage/crit/attacker/element/special,
raw geometry id, the 22 named columns). `ability_id` remains blank explicitly. It includes
zero-damage enqueue records; it is not restricted to the 171 displayed numbers.
`properties-review.json` gives counts/ranges for every key. Reproduce after running the join
review with `tools/export-result-properties.py <archive>`.
Five standalone tests in `test-export-result-properties.py` pass: active/inactive slots,
missing key, partial array, truncated key and duplicate slot. No native changes or laptop
deployment were needed after processing this capture; the dictionary build remains current.

Next useful work is offline tracing of result-field writers and attack provenance against
the saved binary and these fixtures. Do not request another playtest until a specific missing
pointer/value or discriminating scenario has been identified. Exact ability attribution,
actual Daze/buildup and full stat snapshots remain unfinished.

Sharing export requested after this capture: `combat-log-share.csv` in the same archive uses
Agent names, readable Attributes, Yes/No crit, seconds since first hit, integer damage and
compact named modifiers (ratios as percentages). All 220 rows and integer damage sum 2,545,711
are retained; raw/internal identifiers are omitted. Unresolved attack/effect names and summon
identity remain explicitly unknown. Zero modifier values are omitted only from this presentation.
`combat-log-column-guide.csv` maps modifier labels to raw keys; `combat-log-share-notes.txt`
records formatting and interpretation limits. Reproduce with `share-combat-results.py`.

### Offline labelling of the result object from the dictionary capture (Claude, 2026-09-12)

Two identity results from the same fixture (`20260912-181924-dictionary`), no new run:

- **`result+0x20` is the trigger's `arg2` = the attacking entity**, matched on all 220 rows
  (Grace `…4E35BA0`, Velina `…AB8D0C0`, Rina's summon `…59EAAE0`). `result+0x90` is the target.
  This distinguishes summons from their owner, which the UI event's avatar id does not.
- `result+0xA8` is a pooled per-hit object (its pointer recurs across different skills and
  agents in `hits.tsv`'s `arg1`); `arg1` itself is the attack component of the entity, pooled
  for projectiles. Neither identifies the ability. **No qword in the snapshotted result/context/
  component prefixes is a function of the skill** (tested with the entity join at |dt| ≤ 40 ms
  as ground truth, 144 rows, 17 skills), so the attack config is at least one pointer hop away —
  `+0xA8` is the candidate to dereference next; logging `self+0x38` (AttackProperty) and
  `self+0x20` (dynamic prop) in `hits.tsv` would let it be matched by identity.

Float fields, each divided by the hit's split fraction and compared with `src/data/actions.json`
for the same skill (values are per whole action):

| Field | Label | Evidence |
|---|---|---|
| `+0x144` | Decibels gained (`IndividualFeverRecover`) | 4.703, 18.755, 31.185, 77.550, 32.092, 10.642, 114.592 vs table 4.7025, 18.755, 31.185, 77.55, 32.0925, 10.6425, 114.5925 |
| `+0x168` | damage MV × split (`DamagePercentage`) | Velina exact (8.816, 4.334, 1.034); Grace/Rina **2.0×** the table |
| `+0x164` | Daze MV × split (`BreakStunPercentage`) | Velina exact (4.543, 2.758, 0.357); Grace/Rina **1.5×** the table |
| `+0x280` | split fraction (`HitSplitData`) | equals `hits.tsv` `dmgPct` |
| `+0x288` | ATK × damage MV × split (pre-mitigation base) | `+0x288` ÷ `+0x168` is constant per agent: Grace 3370, Velina 3339, Rina 2918 = **ATK at the hit** |
| `+0x134` = `+0x184` | probably anomaly buildup dealt | scales with split, 0 on Rina's EX, ratio to Daze MV constant for Velina (86.0) but not for Grace; unverified |
| `+0xF8` | unknown | scales with split; matches no table column |

Not found among the split-proportional fields: Daze *dealt* in absolute terms and Energy.

**Data flag for the calculator (not a probe issue):** the game's multipliers for every Grace and
Rina action in this fight are 2.0× (damage) and 1.5× (Daze) the repo's `actions.json`, while
all Velina actions match exactly. **Open question — no accepted explanation.** A talent-level
mismatch was the first guess; the user does not see how that could be the case (both agents are
entered at the same level as Velina), and the numbers argue against it too: the factors are
exactly 2.0 and 1.5 on *every* action of both agents, and a level curve would not give round
per-agent constants. Candidates not yet checked: a per-agent convention in how `actions.json`
was entered for Electric agents, a mechanic that scales the game's `DamagePercentage` field
itself (the field is what the game *applied*, since damage reconciles to the settlement), or
the `dyn`-side split × property interaction. Nothing was changed; do not edit `actions.json`
over this until the cause is identified against Nanoka data for the same actions.

### Attribution build (hop-1) — built, tested, staged 2026-09-12 (Claude, taking over from Codex)

Goal: put the ability into the hit-result row by identity. Two changes, no new hook:

- `hitlog.zig` schema 2: two trailing columns `dyn` (`self+0x20`, the
  `ConfigAttackActiveFrameDynamicProp` whose `+0x24` is the skill id) and `prop` (`self+0x38`,
  the `ConfigEntityAttackProperty`). Existing columns unchanged.
- Result probe schema 3: a trailing `hop1` cell — for every heap-looking qword in the result
  (0x290) and context (0x50), the first 0x40 bytes of the object it addresses, as
  `r+0xOFF:ptr:bytes:hex|…` / `c+0xOFF:…`, at most 64 objects per row. 0x40 bytes covers the
  il2cpp class pointer and the first fields, so the dynamic prop is recognisable by its class and
  by the skill id at `+0x24` even without `hits.tsv`, and the AttackProperty by identity with it.
  Reads are `ReadProcessMemory`; unreadable targets record `:0:`.

Tests: result test extended (a heap-range object with a skill id at `+0x24` appears in `hop1`
with its bytes; a reserved-only target yields 0 bytes; header not repeated in rows). All five
executables pass. DLL SHA256 `1B61C10AB2BDEA345064727F5061B050D0BFDD3982F132C0141649B3248E3448`,
sources in `local-data/tools/damage-probe/build-20260912-hop1/`; staged as
`damage-probe-ready.dll`, installer checksum updated, Codex's dictionary build kept beside it as
`damage-probe-ready-dictionary-80F4D62D.dll`.

Offline after the capture: for each result row, look in `hop1` for (a) a pointer equal to the
`dyn`/`prop` of a `hits.tsv` trigger, (b) an object whose `+0x24` is a seven-digit skill id.
Either closes attribution; both together confirm it. Then re-run the settlement check per skill
(`14[]` entries) — that is the proof the join is right.

### Hop-1 capture — 2026-09-12 22:28:22 UTC (PID 10112): the join key is the effect config

Archived in `local-data/damage-probe-captures/20260912-222822-hop1/` with `endbattle_4.pb`. All
five statuses 1; 213 result rows; `hits.tsv` schema 2 (128 triggers, 41 distinct `dyn`/`prop`).

Neither `dyn` nor `prop` appears one hop from the result or context (0 of 213), so the attack
config is not referenced directly. But the hop-1 class pointers resolve in the dump, and two of
the per-attack objects are **config types**:

| result field | class | distinct in fight |
|---|---|---:|
| `+0x20`, `+0x90` | `MoleMole.Battle.Entity` (attacker, target) | 7 / 1 |
| `+0x48`, `+0xB8` | **`MoleMole.Config.ConfigHitEffect`** | 55 |
| `+0x68` | **`MoleMole.Config.ConfigEntityAttackEffect`** | 53 |
| `+0x88` | unnamed (per hit) | 211 |
| `+0xA8` | `HPGPGOBHHFK` (pooled) | 11 |
| `+0xB0` | `DCPILLEHKDK` (geometry) | 8 |
| `c+0x30` | `LBCELJNJAIK` (the result itself) | — |

And on the trigger side, `ConfigEntityAnimEvent` (the hooked `self`) has `AttackEffect` at
`+0x48` (`ConfigEntityAttackEffect`), and its `AttackProperty` has `DownHitEffect +0x70`,
`SkyHitEffect +0x90`, `GroundHitEffect +0xD0` (`ConfigHitEffect`). Config objects are shared per
animation event, so **`hits.tsv.attackEffect == result+0x68`** (and a hit-effect pointer ==
`result+0x48`) is a join by identity to the exact anim event and its skill id.

Also noted: `+0xA0` is the string `DistanceAttenuation_<agent>` — a UTF-16 string, not a number;
a naive "seven-digit int at +0x24" test misreads it (58 false positives). Don't repeat.

**Effect-pointer build:** `hitlog.zig` schema 3 appends `attackEffect groundHitEffect
downHitEffect skyHitEffect` (four `readPtr`s on objects the hook already dereferences). No other
change. DLL SHA256 `702B1854211AFA9CEAB4A5E93E9C5EA06DF6F48C6378BB3218D2B2A265BAE2EB`, sources in
`local-data/tools/damage-probe/build-20260912-effectptrs/`; staged, installer checksum updated,
previous build kept as `damage-probe-ready-hop1-1B61C10A.dll`. Next capture: join
`result+0x68` to `hits.tsv.attackEffect`, then check per-skill sums against the settlement `14[]`.

### Effect-pointer capture — 2026-09-12 22:41:35 UTC (PID 34676): **ability attribution proven against the settlement**

Archived in `local-data/damage-probe-captures/20260912-224135-effectptrs/` with `endbattle_5.pb`,
`attribution.json` and `per-hit-log.csv`. All five statuses 1; 258 result rows; 160 triggers.

**Join:** `result+0x68` (`ConfigEntityAttackEffect`) == `hits.tsv.attackEffect`, and
`result+0x48` (`ConfigHitEffect`) == one of `groundHitEffect/downHitEffect/skyHitEffect`. In this
fight 67 distinct AttackEffect pointers and 131 hit-effect pointers, **none mapping to more than
one skill**. 213 of 258 rows attributed; on all 213 both keys were available and agreed.

**Proof:** per-skill `ceil` sums of `+0x138` vs the settlement's `14[]` `{skill, damage, hits}`:

| skill | settlement | log | | skill | settlement | log |
|---|---:|---:|---|---|---:|---:|
| 1181001 | 11,631 | 11,631 | | 1211009 | 44,315 | 44,315 |
| 1181002 | 13,646 | 13,646 | | 1211011 | 6,508 | 6,508 |
| 1181003 | 37,597 | 37,597 | | 1211023 | 3,309 | 3,309 |
| 1181004 | 23,154 | 23,154 | | 1561001 | 2,092 | 2,092 |
| 1181007 | 3,806 | 3,806 | | 1561006 | 9,814 | 9,814 |
| 1181008 | 29,276 | 29,276 | | 1561007 | 25,261 | 25,261 |
| 1181011 | 11,028 | 11,028 | | 1561009 | 25,274 | 25,274 |
| 1181016 | 13,030 | 13,030 | | 1211024 | 3,353 | 2,395 (−958) |
| 1181017 | 93,858 | 93,858 | | | | |

18 of 19 exact, hit counts equal where the log has one row per hit (multi-hit summons/cyclone
have a second zero-damage row per hit; damage still matches). The accounting closes: the
unattributed rows' damage (2,023,085) minus the four anomaly procs (1,991,876) is **31,209** =
the three settlement-only skills (`1181020` 23,553 + `1561020` 3,258 + `1561021` 3,440) plus the
`1211024` gap (958). Those three skills **never reach `TriggerAttackPattern`** (absent from
`hits.tsv`), so they fire through a sibling path — `HandleAttackPattern` / `HandleAttackPatternList`
/ `HandleContinuousAttackPatternList` on the same class (RVAs in `il2cpp-runtime-dump-attempt.md`)
— or from bullet entities. Hooking the sibling(s) into the same `hits.tsv` is the remaining step
for 100 % coverage; it is bounded and the join key is already known.

**`per-hit-log.csv`** is the Leifa-grade row: time, attacker index + entity, skill id + name,
split, unrounded damage, ceil, crit, MV%, Daze%, Decibels, ATK estimate, buildup estimate, and
the modifier dictionary. Self-check in the first rows: crit `480.41 = 301.01 × (1 + 0.596)` with
`Actor_CriticalDamageRatioDelta = 0.596` on the same row. Element column is left blank there
(the result's element offset was not confirmed; take it from the event row by sequence).

Still open, in order: sibling-path hooks for the three uncovered skills; Daze dealt and Energy
per hit (not among the split-proportional floats — likely computed on the target side or in the
property table); the attacker property table (ATK, PEN Ratio, CRIT…, where stat-type buffs
live) — `result+0x20` is the entity, so its layout is the next thing to read from the dump.

### Leaf-handler build — hooks for the attacks that bypass TriggerAttackPattern (2026-09-12)

From the saved binary: `TriggerAttackPattern` is a dispatcher that calls exactly one of
`HandleAttackPattern` @ `0x168A1570` (12 params), `HandleAttackPatternList` @ `0x168A1B10` (11),
or `HandleContinuousAttackPatternList` @ `0x168A2B90` (7); `HandleAttackPatternListWithOverrideParam`
@ `0x168A3950` is a second way into the list handler. None of the leaves calls another. All four
entry points begin with the same eight pushes, so the existing 12-byte relocation applies.

`hitlog.zig` schema 4 hooks all four (`installOne` per target; every prologue is verified before
any patch is written) and appends a `via` column: `T` dispatcher, `H`/`L`/`C` leaves. Ordinary
hits therefore produce a `T` row and a leaf row with the same `self` and timestamp; attacks that
bypass Trigger produce only a leaf row. **Readers should use leaf rows as canonical** and treat
`T` rows as a cross-check. `hit_hook.c` gains three pass-through detours of the matching arities.

Built (`ReleaseFast`), existing test executables pass (they do not cover hitlog, which has no
tests; the detours are pure pass-through). DLL SHA256
`CC284699C524C6B185E0503AA4AA542F5A9CEF7D87C2E2A81214D1100997BD9A`, sources in
`local-data/tools/damage-probe/build-20260912-leafhooks/`; staged, installer checksum updated,
previous build kept as `damage-probe-ready-effectptrs-702B1854.dll`.

Next capture must show: leaf rows for `1181020` / `1561020` / `1561021` (which leaf tells us the
path), every `T` row paired with a leaf row, and — after the identity join on leaf rows — all
settlement skills matching, including those three.

## 2026-09-12 — Grace/Rina MV discrepancy audit (analysis only)

### Observation: provenance and storage conventions

The claimed **exact, universal 2.0 damage / 1.5 Daze factor is not reproduced** by
`20260912-224135-effectptrs/per-hit-log.csv`. Comparing `dmgBase` alone also compares different
skill ranks across this repository's storage conventions.

- Initial commit `02b3960` (2026-08-23) already contains Grace Basic 1 with `dmgBase: 0.551`,
  `dmgGrowth: 0.051`, `dazeBase: 0.18`, `dazeGrowth: 0.009`: Lv.1 plus per-level growth.
  This equals the freshly fetched Nanoka raw data divided by 10000. The initial commit describes
  a Sheets port, but does not establish the precise original fetch/version or whether these
  particular values passed through the sheet. Numerical identity is not proof of that lineage.
- Rina initially stored resolved Lv.12 values (Basic 1: 0.88 / 0.377). Commit `43e6ad1`
  (2026-09-09) rebased her rows to Lv.1 plus growth: 0.44 + 11*0.04 = 0.88;
  0.245 + 11*0.012 = 0.377. The accompanying source contracts in `rina.ts` and `grace.ts`
  explicitly identify Nanoka **3.1** for M3/M5 and raw skill data.
- Velina initially stored Lv.12 values (Basic 1: 1.034 / 0.357). Commit `b3aef31`
  (2026-09-10) adds `dmgLevel12` / `dazeLevel12` overrides and growth without rebasing those
  base fields. `actions-json-recovery-2026-09-10.md` documents recovery from the Gachabase
  release blob and exact transcript verification of those 21 action edits. It does not prove
  the original pre-initial-commit importer/version.
- `remielle-release-data.md` explicitly distinguishes Lv.1-plus-growth storage from resolved
  Lv.12 storage. Its Grace resource comparison validates the /10000 resource divisor, not a
  claim that Grace's `dmgBase` is Lv.12. Its release endpoint is documented as 3.2.0, despite
  earlier 3.1 naming.
- `src/engine/data/actionScaling.ts` already resolves `dmgLevel12 ?? dmgBase + 11*dmgGrowth`
  (and the Daze equivalent). Comparing the hit object directly to `dmgBase` bypasses this.

### Observation: fresh Nanoka comparison

Fetched on 2026-09-12 from these public endpoints (the working version path is **3.2**, not
`3.2.0`; the latter returned 404):

- https://static.nanoka.cc/zzz/3.2/en/character/1181.json
- https://static.nanoka.cc/zzz/3.2/en/character/1211.json
- https://static.nanoka.cc/zzz/3.2/en/character/1561.json

Grace's `3.1` endpoint also returned JSON. Browser-tool requests failed; PowerShell HTTP fetches
succeeded using the version aliases above. Responses were downloaded to temporary files only.
Traversed `skill` recursively for numeric parameter records keyed by skill ID, using
`damage_percentage`, `damage_percentage_growth`, `stun_ratio`, `stun_ratio_growth`.
Do not use `skill_list` IDs as an interchangeable parameter-ID namespace.

All values below are whole-action fractions. Game values are `dmg_mv / hit_split` and
`daze_mv / hit_split` from the first corresponding CSV row, hence approximate: both CSV fields
are rounded to four decimal places.

| Skill | Nanoka raw damage main/growth | Raw Daze main/growth | Repo base damage / Daze | Nanoka Lv.12 damage / Daze | Game damage / Daze |
|---|---|---|---|---|---|
| Grace 1181001 Basic 1 | 5510 / 510 | 1800 / 90 | .551 / .180 | 1.112 / .279 | 1.11221 / .27903 |
| Grace 1181002 Basic 2 | 5970 / 550 | 3470 / 160 | .597 / .347 | 1.202 / .523 | 1.20222 / .52295 |
| Grace 1181003 Basic 3 | 12480 / 1140 | 7160 / 330 | 1.248 / .716 | 2.502 / 1.079 | 2.50250 / 1.07875 |
| Grace 1181004 Basic 4 | 18630 / 1700 | 10720 / 490 | 1.863 / 1.072 | 3.733 / 1.611 | 3.73280 / 1.61120 |
| Grace 1181011 Quick Assist | 4550 / 420 | 4550 / 210 | .455 / .455 | .917 / .686 | .91719 / .68617 |
| Rina 1211009 EX | 54600 / 4970 | 44450 / 2030 | 5.460 / 4.445 | 10.927 / 6.678 | 10.92640 / 6.67840 |
| Rina 1211011 Dash parameter | 10500 / 960 | 5250 / 240 | 1.050 / .525 | 2.106 / .789 | 2.10600 / .78900 |
| Rina 1211023 Cleanup | 5250 / 480 | 0 / 0 | .525 / 0 | 1.053 / 0 | 1.05311 / 0 |
| Velina 1561001 Basic 1 | 5170 / 470 | 2360 / 110 | 1.034 / .357 | 1.034 / .357 | 1.03400 / .35700 |
| Velina 1561009 Purifying Rise | 44050 / 4010 | 30250 / 1380 | 8.816 / 4.543 | 8.816 / 4.543 | 8.81600 / 4.54300 |

Decode each raw pair as `(main + 11*growth)/10000`. For example, Grace Basic 1's actual
Lv.12/base ratios are **2.01814882 damage and 1.55 Daze**, whereas Basic 2 gives
**2.01340034 and 1.50720461**. Even the stated Daze constant fails on Basic 1 by .009 before
splitting, far beyond CSV rounding. Ordinary growth is approximately base/11 for damage and
base/22 for Daze, so eleven steps naturally resemble doubling and a 50% increase, with
per-action rounding differences. Equal in-game skill levels are entirely consistent with this.

Reproduction across the entire supplied CSV: join numeric IDs to Nanoka parameter records,
compute Lv.12 values, multiply by the CSV split, and compare each MV field with tolerance
`0.000051 + abs(whole_action_mv)*0.000051` (rounding allowances for MV and split separately).
**169 matched-ID hit rows pass both fields; zero fail.** This includes all four captured Velina
IDs (1561001/6/7/9), Grace 1181001/2/3/4/7/8/11, and Rina 1211009/11/23/24.
Excluded explicitly: 45 blank-ID rows, two ID-0 rows, five Bangboo rows, Grace 1181016 (4 rows)
and 1181017 (12), Rina 1211010 (1) and 1211012 (20), which have no corresponding parameter
record in these blobs. This does not certify unjoined skills or all possible actions.

There is a separate naming/attribution issue: the CSV calls 1181007 "Moving Shot" and 1181008
"Grace EX", but Nanoka assigns their numeric parameters to Dash Attack and Dodge Counter.
Their observed values match those numeric IDs' Lv.12 parameters (.674/.255 and 3.292/2.264),
not the CSV names' repo actions. Grace 1181016/17 numerically resemble Nanoka 1181005/6
(.850/.641 and 3.341/2.013), but numerical resemblance alone is not proof of an ID alias.
Do not silently relabel these or use them to certify the join. Decibel agreement and settlement
reconciliation validate useful parts of the capture; neither proves every human-readable name
nor a uniform ratio to the repo's raw base fields.

### Interpretation: mechanic hypothesis and limits

The ordinary skill parameters already account for every directly matched row, leaving no
residual 2x/1.5x effect to explain. This is a **comparison of incompatible storage conventions**,
not evidence that Grace/Rina were played at lower levels than Velina. The earlier open-question
paragraph's exact-factor premise is superseded by the numeric checks above.

No special Electric mechanic is established by this audit. Nanoka's kit text provides candidates
that do not fit the claimed scope/numbers: Grace M6 doubles grenade damage only after consuming
full Zap, without a blanket 1.5 Daze clause; M3/M5 add skill ranks; her core changes buildup and
Shock, and her Potential Electric DMG bonuses reach 30%. Rina M2 is a timed 15% self damage
bonus, M6 a timed 15% squad Electric bonus, core grants PEN Ratio, and Potential grants PEN and
ATK/DEF. None explains universal 2x damage plus 1.5x Daze. Grace's Physical Basic 1 already
provides a useful wrong-Attribute counterexample to an Electric-damage-only explanation.
These are source-text scope checks, not a new client-ability implementation audit or proof of
where every buff is applied inside the native damage pipeline.

No action data, engine code, capture files, or thaumiel sources were edited.
No new mechanic was implemented. Validation was the read-only history/source comparison and
169-row numeric check; app tests were not run for this documentation-only append. Outstanding:
exact pre-initial-commit import lineage and the excluded/renamed skill attribution, not an
unexplained universal Electric MV multiplier.

### Leaf-hook capture — 2026-09-12 22:57:22 UTC (PID 10820): the three skills are not anim events at all

Archived in `local-data/damage-probe-captures/20260912-225722-leafhooks/` with `endbattle_6.pb`
(M2 Grace this fight). All hooks installed; `hits.tsv` rows by entry point: `T` 216 = `H` 210 +
`L` 3 + `C` 3 — every dispatcher call paired with exactly one leaf call, and **no leaf-only
rows**. The identity join on leaf rows matches the settlement on all 24 skills present in both
(list in `unattributed.json` / the comparison script). `1181020`, `1561020`, `1561021` still do
not appear: they never pass through `ConfigEntityAnimEvent` by any entry point. Note also that
Grace's EX id here (`1181008`) is the same as at lower Mindscape; the user reports a different id
exists at M6 — not observed yet.

Unwinding the enqueue-side stacks for those rows gives the same three frames as every other row
(`CGMHCDLDPOH::ACNDFFDOPMB` ← `0xC7748A0` ← `NPGEMMJLIJK::ALKLHKDAGME(1)`) and then stops;
the hit results themselves are produced asynchronously to this stack too. Stack walking will not
find the producer of these hits; the attack config has to be found by content.

**Hop-2 build (result probe schema 4):** hop-1 objects are now snapshotted at 0x100 bytes, and
every heap-looking qword inside them is followed one more hop (0x40 bytes; `System.String`
objects — class `0x50001550358` — are decoded as UTF-16, ≤ 64 units). Cells `hop1` and `hop2`
(`h2:<src>@0x<off>:ptr:bytes:hex|`, `h2s:…:len:utf16hex|`). Budget 64 hop-1 + 160 hop-2 objects
per row. Offline recognisers: `ConfigAttackActiveFrameDynamicProp` class `0x50002379AE0` (skill id
at `+0x24`), `ConfigEntityAttackProperty` `0x50002339870`; a `ConfigHitEffect`'s `hitEffectType`
and curve-key strings identify a bullet's config by content if no skill id is reachable.
Test extended (hop-2 object recorded at `h2:r+0x1a8@0x30`). DLL SHA256
`E08EED561B1A006DA05C67653083C0A4A365831EFE571AA9DB608B15E480F92D`, sources in
`local-data/tools/damage-probe/build-20260912-hop2/`; staged, installer updated, previous build
kept as `damage-probe-ready-leafhooks-CC284699.dll`.

**Build gotcha, recorded so it is not repeated:** `damage_result.c` is `#include`d by
`damage_probe.c`, and `zig build` does not track that include — editing only `damage_result.c`
yields a cache hit and the old DLL (caught by the unchanged SHA256 and a missing header string).
Touch `damage_probe.c` (the include line carries a note) after editing the result probe, and
always verify the new schema string is present in the DLL before staging.

### Hop-2 capture — 2026-09-12 23:09:10 UTC (PID 14992): **every hit named; the stragglers reconcile**

Archived in `local-data/damage-probe-captures/20260912-230910-hop2/` with `endbattle_7.pb` and
`per-hit-log.csv`. 257 result rows; `hits.tsv` schema 4 (leaf rows canonical).

Class-pointer route within two hops: `ConfigAttackActiveFrameDynamicProp` is never reached;
`ConfigEntityAttackProperty` appears only under `c+0x20@0x40/0x70` on 18 rows and is the same
pointer across rows of different skills — shared "current attack" state, not a key. Dead end.

Content route: the pooled per-hit object at **`result+0xA8`** (`HPGPGOBHHFK`) carries two
`System.String` fields, recovered on every row where the hop-2 budget reached it:

- **`+0x10` ability name** — `Lisa_Normal`, `Lisa_Rush`, `Velina_ExSp`,
  `Rina_Anastacia_Attack_Branch_02_BulletType_01`, `Bangboo_Plugboo_Skill`,
  `Lisa_Upgrade_AttachBullet_01/02`, `Velina_SmallWind_Bullet`, `Player_ElementAbnormalBuff`
  (the anomaly procs), `Velina_WindRegion_Controller` (zero-damage region rows)…
- **`+0x20` AttackProperty name** — `Lisa_Attack_Normal_04_AttackProperty_01`,
  `Lisa_Attack_Branch_03_AttachBullet_AttackProperty_02`,
  `Velina_Attack_SmallWind_AttackProperty_01`… — the same identifiers as the client's asset
  data (`hit-split-frame-data.md`), per hit.

Reconciliation of the abilities that never touch `ConfigEntityAnimEvent`:

| ability name | rows | log (ceil) | settlement |
|---|---:|---:|---|
| `Lisa_Upgrade_AttachBullet_01` + `_02` | 2 + 14 | **27,496** | `1181020` 27,496, 16 hits |
| `Velina_SmallWind_Bullet` | 7 | **2,943** | `1561021` 2,943 |

Exact. So `1181020` is Grace's attach-bullet upgrade (M2 in this fight) and `1561021` is Velina's
small-wind bullet; `1561020` did not occur. With the identity join for animation-driven hits
(24/24 skills exact in the previous capture) and names for everything else, **every damage
instance in a fight now has an ability, and the per-skill sums equal the settlement**.
`per-hit-log.csv`: 218 rows by identity, 28 by name, 11 zero-damage rows without either (hop-2
budget exhausted before `+0xA8`); `skill_id_source` says which.

Notes: the ability→id map for non-anim-event abilities (`Lisa_Upgrade_AttachBullet_* → 1181020`,
`Velina_SmallWind_Bullet → 1561021`) is established by settlement reconciliation; the asset
data's `OverrdieDynamicPropKey` for those AttackProperty names can confirm it independently.
`Player_ElementAbnormalBuff` is the name on anomaly damage — the Leifa `["Buff",…]` tag.

**Production cleanup — done below (schema 5):** hop-2 costs ~40 KB and ~200 `ReadProcessMemory` calls per
hit (10 MB per short fight). A lean build should read only `result+0xA8 → +0x10 / +0x20` strings
(two hops, two strings) and drop the generic hop-1/hop-2 cells now that the layout is known.

### Grace/Rina multiplier question — resolved (Codex, 2026-09-12)

Codex traced the 2.0× (damage) / 1.5× (Daze) factors to the repo data, not the game: the Grace
and Rina rows in `src/data/actions.json` are stored at **talent level 1**, while Velina's are
hard-coded at **level 12**. The probe's `+0x168` / `+0x164` fields are the multipliers at the
played level (12), so the comparison was Lv.1 vs Lv.12 for two agents and Lv.12 vs Lv.12 for the
third. Consequences: the field labels stand; the per-hit log is a direct source of Lv.12
multipliers for any action it sees; and `actions.json` needs a consistent level convention (the
user's intent: all at Lv.1, with scaling applied by the calculator) — a data task for the
calculator side, tracked there, not here. Codex's own write-up is the reference for the details.

### Lean result build (schema 5) + Daze widget probe — built, tested, staged 2026-09-12 (Claude)

**Result probe schema 5.** `hop1`/`hop2` are gone. In their place, five reads per hit:
`result+0xA8` → the pooled `HPGPGOBHHFK` object (first 0x50 bytes as `a8_hex`; its fields end at
`+0x49`) and its three `System.String` slots, `a8s10` (ability name), `a8s18` (a third string
slot, empty on every row so far), `a8s20` (AttackProperty name). All schema-4 columns through
`keys60` are unchanged, so `review-result-capture.py` / `export-result-properties.py` still apply.
Row size drops from ~40 KB to ~9 KB and the per-hit `ReadProcessMemory` count from ~200 to ~20.

**The skill key is the AttackProperty name, not the ability name.** From the hop-2 capture:
`Lisa_Normal` (`+0x10`) covers `1181001`–`1181004` and `Velina_ExSp` covers `1561006` and
`1561009`, so the ability name identifies the *ability*, not the settlement skill. The
AttackProperty name (`+0x20`) → skill id is unique: 66 names in that fight, 0 conflicts, and it
agrees with the client asset profiles (`local-data/*-profiles.json`, `animEventId` → `skillId`)
on all 46 names both have. `tools/attack-property-skill-map.json`
merges the asset map (191 anim-event names) with the 20 capture-only names (bullets, summons,
`1181020`/`1561021` from settlement reconciliation) — 213 entries. `Player_ElementAbnormalBuff`
(anomaly ticks) has no AttackProperty; a new name shows up as `unmapped` with its damage sum for
reconciliation against the settlement leftovers.

**Reader:** `node tools/per-hit-log.mjs <archive-dir>` (Node; Python
3.12 has been removed from this machine — only its `site-packages` remain, the `.venv` is broken
and Capstone is gone, so the `.py` tools and the disassembly scripts do not run here until it is
reinstalled). It writes `per-hit-log.csv`, `settlement-check.json` and, when a stun capture is
present, `stun-log.csv`. Verified by converting the hop-2 capture to schema-5 form offline: 19
skills exact, 0 mismatched, unattributed 0 (the two settlement-only entries are zero-damage;
`5400801` is the Bangboo, which the avatar `14[]` list does not carry).

**Result fields labelled from the hop-2 fixture** (257 rows; per-skill constancy of `field ÷
split` and per-attacker constancy elsewhere; `actions.json` values for comparison):

| Field | Label | Evidence |
|---|---|---|
| `+0x1b8` | **Energy × split** (`EpRecovery`) | ÷ split per skill: `1181007` 0.5711, `1181001` 0.6151, `1181002` 1.189, `1181003` 2.454, `1181004` 4.081, `1561001` 0.696, `1181011` 1.560 — all equal to `actions.json` `energy`; 0 on every EX Special and on summon/bullet hits. Config value at Lv.12 (Energy does not scale). |
| `+0x180` | **ATK at the hit** (float) | Grace 3370.4 (96 rows) / 2794.4 (10), Velina 3339 / 2763, Rina 2918, Plugboo 8057; matches the earlier `+0x288 ÷ +0x168` estimate. The 2794.4→3370.4 step is +576 on both Grace and Velina at the same moment — a shared flat ATK buff, not yet named. |
| `+0x1bc` | **Impact** | Grace 83, Rina 83, Velina 86, Plugboo 99 — per-attacker constants at base-Impact magnitudes. |
| `+0x238` | **Anomaly Mastery** | Grace 196, Rina 93, Velina 112, Plugboo 132. |
| `+0x25c` | **Anomaly Proficiency** | Grace 364 (449.9 on one row), Rina 310, Velina 383 (492.1 on three), Plugboo 0. |
| `+0x1b4` | level (int) | 60 on every row. |
| `+0x118` | **1 + DMG bonus** | equals `1 + Actor_AddedDamageRatio (+ _Elec/_Wind)` from the same row's dictionary on 252/257 rows; the 5 anomaly-proc rows carry an extra term. |
| `+0x11c` | unknown per-attacker stat | Grace 1339 / 871, Velina 1352 / 884, Rina 1339, Plugboo 723; steps by +468 exactly when ATK steps by +576. Not DEF-shaped for these builds; not labelled. |
| `+0x174` | unknown per-attacker ratio | Grace 0.95 / 0.86 / 0.56, Rina 0.72, Velina 0.63 / 0.54 / 0.24, Plugboo 0.09. **Not** CRIT DMG: crit rows are `× 1.596` with `Actor_CriticalDamageRatioDelta = 0.596`. Not labelled. |
| `+0xf8` | per-skill config value × split | constant per skill (Grace basics: exactly 0.278 × Energy; Velina EX 0.833 / 1.667 with Energy 0), so a fifth skill property — candidate `SpRecovery` from the `ESkillPropertyType` enum (`RpRecovery, DamageRate, EpRecovery, StunRatio, SpRecovery`). Not labelled. |
| `+0x19c` = `+0x1ac` = `+0x1dc` | unknown | neither ∝ damage nor ∝ Impact × Daze MV (ratios vary 0.05–0.6 by skill); small (3.8 on a dash hit); possibly the hit distance behind the `DistanceAttenuation_*` curve at `+0xA0`. |

**Daze dealt is not in the result.** Every split-proportional float is accounted for above or
already labelled; no field is a per-attacker-constant multiple of `Impact × Daze MV`. The
attacker's ATK / Impact values also occur **nowhere within two hops of `result+0x20`** (searched
every hop-1/hop-2 object of the hop-2 capture as float and double), so the entity's property
table is at least three pointers away or not stored as plain floats; reaching it needs the
disassembly route (`OnCreateProperty` @ `0x12AD49C0` on `MoleMole.Battle.Entity`), which is
blocked here until Python/Capstone is back. Where stats appear per hit, they appear in the
result snapshot above — which is what the game applied, so it is the usable attacker snapshot.

**Daze widget probe (`damage_stun.c`, schema 1).** Two new bridges hook
`MoleMole.UIStunDamageWidgetController::UpdateStunDamageUI(Single, Int32, Single, Int32)`
@ `0x1965B6A0` (`hook=U`) and its obfuscated same-signature sibling `NHFLNIGLCLJ` @ `0x1965C070`
(`hook=N`). Both begin `56 57 53 48 83 ec 50 0f 29 7c 24 40` (push rsi/rdi/rbx; sub rsp,0x50;
movaps [rsp+0x40],xmm7) — 12 position-independent bytes, relocated whole; both 64-byte
fingerprints are checked before either target is written, and the laptop's GameAssembly matches
both. Rows: `elapsed_ms thread hook caller_rva this arg1_f32 arg2_i32 arg3_f32 arg4_i32` plus the
raw `xmm1/r8/xmm3/stack5/MethodInfo/rdx/r9` words and 0x40 bytes of `this`. Output
`damage-stun-<UTC>-<PID>.tsv`; status line `stun` in `damage-probe-status.txt` (same codes;
`-3` = either fingerprint wrong). **Argument semantics are unlabelled** until the capture:
current/max/delta/state are all possible, and `ManualUpdate` on the class means it may be polled
per frame rather than called per hit — per-hit Daze is then the delta between successive rows
for the same `this`, which `stun-log.csv` pairs with the nearest result row in [−50, +200] ms.

Tests: bridge test extended to seven bridges (stun prologue round-trip, 10,000 calls each);
new `damage_stun_test.c` (prerequisite gate, either-fingerprint refusal leaves both targets
untouched, relocation/continuation on both, duplicate refusal, float/int argument decode from
xmm1/r8/xmm3/stack, unreadable `this`, lock skip, LastError); result test rewritten for the a8
cells (raw bytes, 192-unit truncation, null string slot, null a8 pointer still writes a row, no
hop cells). All five executables pass; `zig build -Doptimize=ReleaseFast` succeeds; both header
strings verified present in the DLL and the schema-4 `hop1=` string absent (the include-cache
gotcha above). DLL SHA256 **`B563067C803F39C4D142C7288EF12D8C0FC933518F47AE81828F216C415E01A0`**,
sources + installer in `local-data/tools/damage-probe/build-20260912-lean-stun/`; staged on
the laptop as `damage-probe-ready.dll` with the installer checksum updated (the packaged copy in
`tools/per-hit-logger/` was stale at the dictionary hash and is now synced); previous build kept
as `damage-probe-ready-hop2-E08EED56.dll`. The running game's DLL was not replaced.

**Next capture** (close the game, `START DAMAGE TEST.cmd`, short Wind-team fight through the
settlement, no recording needed): `damage-probe-status.txt` must show `result 1` and `stun 1`.
Then `node tools/per-hit-log.mjs <archive>` and check, in order:
(1) `settlement-check.json` — every settlement skill exact, `unattributed 0`, any `unmapped`
names reconciled and added to the map; (2) the stun rows — whether `U`/`N` fire per hit or per
frame, which argument moves with hits and by how much, and whether `arg1 − previous arg1` for the
same `this` equals a per-attacker-constant multiple of `Impact × Daze MV × split` (the
`Actor_AddedBreakStunRatio` rows are the natural check for the Daze-bonus term). Only after (2)
should any stun argument be labelled.

### Attacker snapshot probe — the hit-result factory found; added to the same build (2026-09-12, Claude)

Python 3.12 + Capstone were reinstalled (Codex), so the disassembly route reopened before the
playtest. Scanning the saved GameAssembly's `il2cpp` section for stores to the result's stat
offsets (`+0x180/+0x1bc/+0x238/+0x25c`) in one function finds exactly one real cluster (the other
candidates are data or UI classes): **`JJNCFKMGDDP::PCLAJDPJJMN` @ `0x16FA7460`** (static, 7
params) is the **hit-result factory**. It obtains the pooled result (`call 0x167968B0`, the
result class's own method), then copies from its **first argument** (`rcx`, kept in `rdi`):

| `rcx` field | → result | meaning (from the result's labels) |
|---|---|---|
| `+0x130` | `+0x180` | ATK |
| `+0x68` | `+0x1bc` | Impact (common branch; `+0x120` when `rcx+0x134 == 0x26`) |
| `+0x164` | `+0x25c` | Anomaly Proficiency |
| `+0x180` | `+0x238` | Anomaly Mastery |
| `+0xb8` | `+0x164` | Daze MV × split |
| `+0x1b0` | `+0x1b4` | level |
| `+0x1c0` | `+0x11c` | the unlabelled per-attacker stat |
| `+0x128` | `+0x174` | the unlabelled per-attacker ratio |
| `+0xc8`, `+0x78`, `+0x1d0`, `+0x198`, `+0x168`, `+0xac`, `+0x108`, `+0xf0`, `+0x88`, `+0x1ac`, `+0x16c`, `+0x1dc`, `+0x104`, `+0x58`, `+0x7c` … | `+0x15c`, `+0x1d4`, `+0x1cc`, `+0x114`, `+0x23c`, `+0x1a0`, `+0x208`, `+0x218`, `+0x1c4`, `+0x154`, `+0x234`, … | further plain copies |
| `+0x90`, `+0x118`, `+0x1b8` / `+0x14c`, `+0x84`, `+0x11c` | dictionary | fed to `LBCELJNJAIK::KEOAKNJKFPL` @ `0x16795C50` with a static key string — the named-modifier entries |
| `+0x10`, `+0x48` | `+0xc0`, `+0x70` | the two (empty) result strings |

Other arguments: `r9` (a per-attack object read at `+0x144/+0x164/+0x168/+0x174/+0x182/+0xb8`),
`[rsp+0x28]` = the `HPGPGOBHHFK` that becomes `result+0xA8` (via `0x15D341C0`), `[rsp+0x30]` →
`result+0xDC`. The first argument's class is **`KJFAPLPNFON`** (`0x500059EE3A8`): the dump's only
class whose field table contains all 30 offsets the factory reads (dense fields `+0x10`…`+0x1e4`,
~115 of them). **This is the per-hit attacker snapshot** the user asked for — and the result
does not keep a pointer to it (checked: no store of `rdi` into the result; the class pointer
appears in no hop-1/hop-2 object of the hop-2 capture), so it has to be read at factory entry.
Disassembly saved as `local-data/crash-analysis/result-factory-16fa7460.txt`.

**Probe (`damage_snapshot.c`, schema 1, one more bridge):** hooks `0x16FA7460` — the same
eight-push prologue the string probe relocates (`41 57 41 56 41 55 41 54 56 57 55 53`), 64-byte
fingerprint verified against the laptop's GameAssembly. Records the first 0x200 bytes of `rcx`
(`snapshot_hex`), 0x190 bytes of `r9` (`arg4_hex`), the integer args, the three stack params and
the MethodInfo. Output `damage-snapshot-<UTC>-<PID>.tsv`; status line `snapshot`. Join to the
result rows: same thread, same order (the factory builds the result the converter receives
next), verified per pair by `snapshot+0x130 == result+0x180` and `snapshot+0xb8 == result+0x164`
— `per-hit-log.mjs` does this and writes `snapshot-log.csv` with every 4-byte cell of the
snapshot as float-or-int (`f000`…`f1fc`), tagged with the paired hit's AttackProperty, so the
remaining ~100 fields can be labelled offline by their per-attacker / per-skill behaviour (CRIT
Rate, CRIT DMG, PEN, PEN Ratio, DMG bonuses, Energy Regen… are all candidates; **none is
labelled yet**). Synthetic pairing check passes (257/257 verified).

Tests: `damage_snapshot_test.c` (gates, relocation, duplicate, 0x200/0x190 snapshots, stack
params, unreadable `r9`, unchanged input, lock skip, LastError); bridge test now eight bridges.
All six executables pass; ReleaseFast build; all three new header strings verified in the DLL.
DLL SHA256 **`01624724FF30FD4CF58D55ECC19C2192726C3F4C7D728E738C8536A4459C2CDB`** replaces the
never-run `B563067C…` build in `build-20260912-lean-stun/` and on the laptop (`damage-probe-
ready.dll`, installer checksum updated). The installed `thaumiel.dll` is still the hop-2 build.

**Next capture, amended:** status must show `result 1`, `stun 1`, `snapshot 1`. After the
settlement check, confirm every snapshot row pairs and verifies (`pair_check = ok`), then label
snapshot fields from `snapshot-log.csv` — first the ones that should be constant per attacker
and equal to the known build (CRIT Rate / CRIT DMG from the loadout, PEN Ratio from Rina's
passive), then the per-hit ones.

### Capture 2026-09-13 03:52:06 UTC (PID 39784): schema 5 reconciles; snapshot hook is the bullet path; stun widget idle

Archived in `local-data/damage-probe-captures/20260913-035206-leanstunsnap/` with `endbattle_8.pb`
(from `remielle-battlestats/logs/`), loadout, `hits.tsv`, `per-hit-log.csv`, `settlement-check.json`,
`snapshot-log.csv`. All seven statuses 1 (`string numeric event enqueue result stun snapshot`).
No enemy was stunned in this fight (user).

**Result probe schema 5 — production-ready.** 260 rows, `per-hit-log.mjs`: **20 settlement
skills exact, 0 mismatched, unattributed 0**. One new AttackProperty name appeared,
`Velina_Attack_WindRegion_ExtraDamage_AttackProperty_01_Elec` (1 hit, 1,711), and the
settlement's only unmatched entry was `1561020` = 1,711 — added to the map (214 entries). The
`Velina_WindRegion_Controller` rows without damage remain unmapped by design (0 damage).

**Snapshot hook (`0x16FA7460`) fires only for the bullet path.** 29 rows, all at **dt = 0** from a
result row on the same thread, and exactly the hits that never pass `ConfigEntityAnimEvent`:
`Lisa_Attack_Branch_03_AttachBullet_*` (caller `HLPJNAANJOP::NGCFNMOPPHP+0x2d1`),
`Velina_Attack_SmallWind_*` (same caller) and the wind-region ticks (caller
`NGCACAKHFKM::MJDKHDBPNBH+0x3e8`). 28/29 pair by same-ms + ATK equality (`per-hit-log.mjs`
now pairs this way; the "same thread, same order" rule in the previous section was wrong). The
anim-event hits go through the sibling factory **`JJNCFKMGDDP::EGCKAHENCFJ` @ `0x16F9CB30`**
(5 params; `r8` = the `HPGPGOBHHFK` per-hit object, `r9` a config object; same eight-push
prologue; disassembly in `crash-analysis/result-factory-16f9cb30.txt`) — it does not take a
`KJFAPLPNFON` snapshot; it builds the result through the buff/property path below. All 18 callers
of the pooled-result getter `0x167968B0` are listed in that trace (`ShootingGroundSubsystem::
ProcessEntityBeHit`, `INIDFLBMKKE::AKOANBNAFGA`, `CJHBEFFHECH::POFFGDAFFEP`, …); only the two
`JJNCFKMGDDP` ones matter for the Wind team.

**`KJFAPLPNFON` snapshot fields labelled from the 29 rows** (Grace attach-bullet vs Velina
small-wind; the result-side twin in brackets):

| offset | value G / V | label |
|---|---|---|
| `+0x68` | 83 / 86 | Impact [`+0x1bc`] |
| `+0x74` | 0.08 / 0.53 | DMG bonus (`+0x104` = 1 + this = [`+0x118`]) |
| `+0xa8` | 0 / 84 | `Actor_ElementAbnormalPowerDelta` (AP delta) |
| `+0xb8` | 0 / 0.2068 | Daze MV × split [`+0x164`] |
| `+0xc8` | 54 / 54 | [`+0x15c`] — property type `0x16` ÷ scale + buff (see below) |
| `+0xcc` | 0.596 / 0.596 | **CRIT DMG** (= `Actor_CriticalDamageRatioDelta`; the crit multiplier is 1 + this) |
| `+0xe4` | 85 / 130 | unknown (per attacker) |
| `+0x128` | 0.95 / 0.54 | [`+0x174`] — property type `0x15` ÷ scale + buff |
| `+0x12c` | 0.2194 / 0.0655 | damage MV × split [`+0x168`] |
| `+0x130` | 3370.4 / 3339 | ATK [`+0x180`] |
| `+0x148` | 1.45 / 1.45 | unknown constant |
| `+0x164` | 364 / 383 | Anomaly Proficiency [`+0x25c`] |
| `+0x17c` | 0.125 / 0.1 | split [`+0x280`] |
| `+0x180` | 196 / 112 | Anomaly Mastery [`+0x238`] |
| `+0x1a4` | 0.098 / 0.098 | **CRIT Rate** (= `Actor_CriticalDelta`) |
| `+0x1b0` | 60 | level |
| `+0x1c0` | 1339 / 1352 | [`+0x11c`] |
| `+0x60`, `+0x1d0`, `+0x1dc`, `+0x1e0` | 203/204, 4/3, 2, 65536 | ints, unlabelled (`+0x60` may be the element id) |

Both agents share CRIT 0.098 / 0.596 because the test account's discs carry identical substats
(loadout) — not a probe artefact.

**Stun widget: 0 rows.** `UpdateStunDamageUI` never ran in a fight with no stun, so it is the
*damage-dealt-during-stun* tally, not the Daze bar. **Kept in the build on purpose** — the user
wants damage during stun — but it is not the Daze route. The Daze-bar route is still open.

**Where the attacker's stats actually live (traced, not yet hooked).** `JJNCFKMGDDP::DPDHFHJLGAC
(result, X)` @ `0x16FA33B0` (`crash-analysis/fn-16fa33b0.txt`) fills the result's stat fields
in place: `result+0x174 = Property(0x15) ÷ Scale(0x15) + NamedBuff(key)`, `result+0x15c =
Property(0x16) ÷ Scale(0x16) + NamedBuff(key)`, `ATK = (1 + a) · ATK · (1 + b) + c` and
`+0x11c = (1 + d) · +0x11c + e` with `a…e` named-buff lookups (`INIDFLBMKKE::NNKCNOHIFDN`
@ `0x133CA890` on the buff dictionary from `NGCACAKHFKM::LFGONPCGOFO` @ `0x162563F0`, the entity's
component 9), then AP and AM the same way. `Property(type)` is
**`GEIEAAJJJDC::HNIBECLNDNL(component, &out, type, key)` @ `0x19105110`**: the component is
`[[X+0x80]+0x50]`, and for `type != 0xA` it is a **`Dictionary<int, Value>` at `component+0x40`**
(entries array at dict`+0x18`, count at array`+0x18`, payload `+0x20`, **stride 0x4C**: hash `+0`,
next `+4`, int key `+8`, 0x40-byte value `+0xC`); `type == 0xA` uses a string-keyed dictionary at
`component+0x58` (stride 0x50, value at `+0x30`). The 0x40-byte value is converted to a float by
`0x15E3AF20` and divided by `GFHLOOGNAMI::EABGHHJIFAE(type)` @ `0x14C451D0` (a per-type scale).
The int keys are `Share.EPropertyType` (`0x5000A2D3DC8`; members include `Atk_Battle`,
`BreakStun_Battle`, `ElementMystery_Battle`, `ElementAbnormalPower_Battle`, `CritBase`,
`CritDmgDelta`, `PenRatio_Battle`, `PenValue`, `AddedDamageRatio_*`, `EpGetRatio`, `SpRecover`…)
but the dump has no constants, so type numbers must be matched to names by value (ATK 3370.4,
Impact 83, …). This is why ATK never appeared within two hops as a float: it is a 0x40-byte
struct behind an accessor. `DPDHFHJLGAC` has no direct `call` sites (invoked indirectly).

**Next build (proposed, not built): hook `0x19105110`.** Prologue `41 56 56 57 53 48 83 EC 28
4C 89 CB` — 12 position-independent bytes. Record `(component, type, key, caller_rva)` and, for
`type != 0xA`, walk the int dictionary at entry (standard .NET buckets/entries chain) and dump
the 0x40-byte value; filter by caller RVA inside the damage functions (`0x16FA33B0`–`0x16FA4900`
first) and keep a total-call counter and a caller histogram so the firehose outside combat stays
unlogged. That yields, per hit and for both paths, every property the damage code read, keyed by
type id — the full attacker table.

### Fight 2, same launch (PID 39784, settlement `endbattle_9`): Cottus, one stun — target state found, widget hook dead

The game was not relaunched, so the probes appended to the 03:52:06 files; rows with `sequence >
260` (result) / `> 29` (snapshot) are fight 2, split into
`local-data/damage-probe-captures/20260913-035206-fight2-stun/` with `endbattle_9.pb`.
1,341 result rows, a real boss (Cottus), one stun.

**Attribution scales:** ten new AttackProperty names, all reconciled exactly against the
settlement leftovers by their sums and added to the map (227 entries): `Lisa_Attack_Counter_*` =
`1181008` (179,519 / 21 hits — so `1181008` is the Dodge Counter, and the earlier note calling it
"Grace's EX id" was a mislabel), `Lisa_SwitchIn_Attack_*` = `1181009`, `Lisa_SwitchIn_Attack_Ex_*`
= `1181010`, `Lisa_Attack_Branch_03_Extra_*` = `1181019`, `Velina_Attack_Normal_05_AttackProperty_
02_*` = `1561005` (the bullet half of the 5th hit: 4,018 + 8,695 = 12,713). After that: **30 skills
exact, 0 mismatched**; the 3,497 still unattributed is `Monster_Cottus_ATK05_*` — **the boss's
hits on the agents also land in the log** (attacker = the monster entity), which the avatar
settlement naturally does not list. Snapshot rows 148, 136 paired.

**`result+0x130` is the target's state, and 3 means Stunned.** It reads 3 on every row from
1551.0 s to 1570.2 s on the boss (392 rows), 5 or 6 everywhere else on the boss, 0/1 on the two
other targets; and only the state-3 rows carry the ×1.5 stun multiplier (non-crit effective
ratios 0.941 → 1.412, 1.194 → 1.79). 5 vs 6 alternate in multi-second runs on the same target
(not labelled — plausibly hit-reaction / anomaly states). `per-hit-log.mjs` now emits
`target_state` and a `stunWindows` summary in `settlement-check.json` (window = first state-3
row on a target until its next non-3 row). This fight: one window, 19.2 s, 392 rows, direct
1,231,491 + anomaly 7,054,639 — **damage dealt during stun is available from the result probe
alone**, per hit and per skill.

**`UpdateStunDamageUI` hook: 0 rows again, with a stun.** Whatever that widget is, it is not
driven by this fight's stun or Daze. The two stun bridges are dead weight; drop them in the next
rebuild (they cost nothing at runtime — the targets are never called — but they are a false
promise in the status file). The Daze-dealt route is still open; the target state above at least
gives stun start/end per hit.

**Buildup check on fight 1 (inconclusive):** sums of `+0x134` between anomaly procs are 2,848 /
700 / 573 / 0 / 275 — not a gauge value — and per-skill `+0x134 ÷ split` is not a constant factor
of `actions.json` buildup (Velina 1st hit ×1.80, Grace 3rd hit ×1.39). `+0x134` stays an estimate.

### Stun widget probe removed; repo split out (2026-09-13, Claude)

`damage_stun.c` / `damage_stun_test.c` are gone from the build: the two `UpdateStunDamageUI` bridges
produced **0 rows in two fights, one with a 19.2 s stun** (previous two sections), so whatever that
widget shows, it is not driven by Daze or by this stun. The sections above stay as the ruled-out
lead — do not re-hook `0x1965B6A0` / `0x1965C070` expecting Daze. Stun start/end per hit is
already available from `result+0x130 == 3` in the result probe; Daze *dealt* is still open (the
property accessor route, previous section).

Removal: the `#include "damage_stun.c"` line, the two `PROBE_BRIDGE damage_stun*` lines in
`damage_probe.S`, `damage_stun_start()` in `dynlib.zig` (so `damage-probe-status.txt` no longer
has a `stun` line — expect `string numeric event enqueue result snapshot`), and the stun round-trip
in the bridge test (now six bridges). `per-hit-log.mjs` still reads a `damage-stun-*.tsv` if one is
present, for the archived captures.

Verification: ReleaseFast build; all five test executables pass (`damage-probe-test`,
`damage-probe-record-test`, `damage-probe-install-test`, `damage-result-test`,
`damage-snapshot-test`); DLL strings checked — the six remaining probe headers present once each,
`UIStunDamageWidgetController` / `targets=U:0x1965b6a0` / `hop1=` absent. DLL SHA256
**`E4127469E69A7085C5D536593068AED15EC78CCE82F92401D480FF0E6F441A79`** (732,672 bytes), installer
checksum in `tools/Install-DamageProbe.ps1` updated to match. **Not staged on the laptop** — a client
update is imminent, and the laptop still holds the `01624724…` lean-stun build as
`damage-probe-ready.dll`, whose installer expects that hash. Archive of this build:
`local-data/tools/damage-probe/build-20260913-nostun/`.

The source now lives in this repo (branch `per-hit-logger`, forked from upstream `0e669bc`) instead
of an unversioned `local-data/thaumiel/` checkout; the offline tooling is under `tools/`.

### First CNBetaWin3.3.2 capture — 2026-09-13 13:25:56 UTC (PID 27436): re-pointed probes reconcile

Archived in `local-data/damage-probe-captures/20260913-132556-first-332/` with `endbattle_10.pb`,
loadout, `hits.tsv`, `per-hit-log.csv`, `settlement-check.json`, `snapshot-log.csv`. All seven
statuses 1 on the 3.3.2 client after the re-pointing described in `client-update-playbook.md`.
1405 result rows; `per-hit-log.mjs` (3.3.2 layout): **31 settlement skills exact, 0 mismatched**,
anomaly 19,000,981, unattributed 1,457 (one enemy-on-player row), one settlement-only zero-damage
entry and one log-only `54xxxxx` summon id, as in 3.3.0 captures. Snapshot pairing by ATK equality:
123/143. Stun window from `target_state == 3`: 127.0–147.4 s, 420 rows. The capture's result
columns are still named `a8s10/a8s18/a8s20` (bytes from `+0x10/+0x20/+0x28`); later captures say
`a8s10/a8s20/a8s28`. The decoder uses slot order, so both decode.

### Per-hit Daze — found in the result, plus a gauge probe (2026-09-18, Claude; built, tested, not yet captured)

**Daze per hit was in the result all along.** The column the decoder had been calling `buildup_est`
(schema 5, 3.3.0 `+0x134`, 3.3.2 `+0x18c`) is the Daze the target's gauge received from the hit,
and its "unnamed near-twin" (3.3.0 `+0x184`, 3.3.2 `+0x250`) is the requested Daze before the
MaxStun clamp. Both are now code-anchored; `tools/per-hit-log.mjs` writes them as `daze` and
`daze_requested`. The stun-widget hook ruled out on 2026-09-13 was the wrong instrument: the widget
is a UI consumer, and the value it displays is produced two calls earlier, on the target.

**Trace (3.3.2 dump + saved binary, `tools/discovery/disfn.py` / `disp-xref.py` / `cooccur.py` /
`callsite-imm.py` / `disclass.py` / `sig.py`, all new under `tools/discovery/`).** Started from
"who stores to `result+0x18c`" (`disp-xref.py 3.3.2 0x18c store`), which is the target's stun
component `GILABPBBMJH` (3.3.0 `PHIPMJHEJBH`, 99.7 % aligned):

| step | 3.3.2 | 3.3.0 | what it does |
|---|---|---|---|
| Daze computer `IKECLMLAAON` | `0x1A4F63E0` | — (not re-traced) | computes the hit's Daze from the result (Impact × (1 + bonus) × Daze MV …), reads the target's CurStun (`BaseProperty` 0xB, found with `callsite-imm.py … edx 0xB`), stores CurStun at `this+0xD4` and CurStun + Daze at `this+0xB0` (3.3.0 `+0xE8` / `+0xC8`) |
| be-hit handler `JKAJPLNGPEK(PDOGBEADLIE)` | `0x1A4F76A0` | `GOBDAKFLFKI` `0x1B1B7BD0` | loads `this+0xB0`, calls the applier, then stores `CurStun_after − this+0xD4` to `result+0x18C` — the **applied, post-clamp** Daze |
| applier `JCELMPFPFBH` | `0x1A4F1430` | `DNMNLFKJJPC` `0x1B1AD6F0` | applies the value to the CurStun property (take-ratio multiplier, clamp at MaxStun) and stores the **pre-clamp requested delta** to `result+0x250` (3.3.0 `+0x184`) |

All three run before the result converter (`0x1823a830`, the schema 5 hook), so the result probe's
snapshot already carries both values for the same hit. Re-verified this session from the 3.3.2
binary: `JKAJPLNGPEK` at `1a4f78dc movss xmm6,[rsi+0xb0]` … `1a4f793e call JCELMPFPFBH` …
`1a4f7958 subss xmm0,[rsi+0xd4]; movss [r14+0x18c],xmm0`; `JCELMPFPFBH` at `1a4f160c movss
[rax+0x250],xmm6`; `IKECLMLAAON` zeroes then stores `[rdi+0xd4]` / `[rdi+0xb0]` at `1a4f6a82` /
`1a4f6a90`. MaxStun is not a plain field (a property lookup, `BaseProperty` 0xC), which is why the
gauge probe below records the gauge and lets MaxStun fall out at each stun onset.

**Decoder check against the archived 3.3.2 capture (`20260913-132556-first-332`, PID 27436):** the
relabel is value-identical — new `daze` equals the committed decoder's `buildup_est` on all 1405
rows; settlement still 31 exact / 0 mismatched. All 420 rows with `target_state == 3` have
`daze == daze_requested == 0` (a stunned target takes no Daze). Of the 578 un-stunned rows with
Daze, 577 have `daze_requested == daze`; the **one** clamped row — `138.596` applied of `138.967`
requested, `Velina_Attack_WindRegion_AttackProperty_01` at 126.375 s — is the last Daze hit before
the stun window opens at 127.0 s. That is the MaxStun clamp, seen once, exactly where it must be.
The decoder now prints this per stun window (`daze before … over … hits (last hit clamped: …)`)
and records `dazeBefore` / `dazeBeforeByAttacker` / `lastDazeHit` in `settlement-check.json`.
The "daze before" sum (17,582.7 over 551 hits here) is the Daze the result probe *saw* since the
capture began, not the gauge: recovery, resets and Daze from sources the result probe does not
see (assists, parries) are invisible to it — that is what the gauge probe is for.

**Gauge probe (`src/damage_daze.c`, schema 1, `damage-daze-*.tsv`).** Hooks `JKAJPLNGPEK` at
entry (same eight-push prologue as the snapshot probe, 12 bytes, position independent; 64-byte
fingerprint gate). Per call: `cur_before = this+0xd4`, `target_value = this+0xb0` (CurStun +
requested Daze, before the take-ratio multiplier and the clamp), `result_ptr = ctx+0x30`,
`entity_ptr = this+0xa0`, two result floats copied for the join check (Daze MV `result+0x144`,
Impact `result+0x1ac`), plus `0x100` bytes of `this` and `0x50` of `ctx` as hex. No game calls, no
writes to game objects; every read goes through the OS reader (`-1` marks an unreadable float,
impossible for a gauge value). Status line `daze` appended to `damage-probe-status.txt`
(`string numeric event enqueue result snapshot daze`).

`per-hit-log.mjs` joins it to the result rows: same `result_ptr`, same thread, first result row at
or after the daze row within 200 ms (pooled result objects are reused, hence the time bound),
verified by the two copied floats (`pair_check` = `ok` / `pointer-only` / `unpaired`). Output
`daze-log.csv`: `cur_before`, `target_value`, `requested_pre_ratio` (= target − before),
`daze_requested`, `daze`, `gauge_after` (= before + applied), `unlogged_delta` (= before − previous
paired hit's `gauge_after` on the same target: recovery, resets and unseen Daze sources show up
here, nowhere else). `settlement-check.json` gains `maxStunFromGauge` per stun window — the
`gauge_after` of the last paired hit before the window opened.

**Build and tests.** `src/damage_daze_test.c` (new, `PASS daze: install gates/relocation,
duplicate refusal, this/ctx snapshots, result pointer and floats, unreadable ctx, null this/ctx,
unchanged input, lock skip, last error`); seventh bridge in `damage_probe.S` and the bridge test;
`dynlib.zig` calls `damage_daze_start()` after the snapshot probe. ReleaseFast DLL SHA256
`6AB92FAED379519A9B3447BE74C2789CCEE18A3A34228D113A15F99CF88A60B0` (1,075,712 bytes), installer
checksum updated. Header string `schema=1 client=CNBetaWin3.3.2 target_rva=0x1a4f76a0` present once.

**Open — what the next capture must show** (header says `semantics=traced_not_yet_captured`):
`pair_check == ok` for nearly every daze row; `gauge_after` at each stun onset equal across
windows on the same target (MaxStun); `cur_before` rising by exactly `daze` between consecutive
paired hits while the target is not recovering (`unlogged_delta == 0`), and dropping between
windows (recovery); Daze rows during a stun with `daze == 0`. If `target_value − cur_before`
does not equal `daze_requested`, the take-ratio multiplier sits between them — record its value.

### Capture 2026-09-18 18:19:13 UTC (PID 26004): Daze gauge probe verified; MaxStun; distance attenuation

Archived in `local-data/damage-probe-captures/20260918-181913-daze/` with `endbattle_7.pb` (from
`<server folder>\logs\`), loadout, `hits.tsv`,
`events.tsv`, result/snapshot/daze TSVs, `per-hit-log.csv`, `daze-log.csv`, `settlement-check.json`.
Build `6AB92F…`; all seven statuses 1 (`… result snapshot daze`). 148 s fight against Cottus P1
(`MainStoryBoss`, `Large`, Ether), one target entity, two stuns, a deliberate pause, one Assist
Follow-Up. Grace / Rina / Velina + Plugboo.

**Settlement.** 2659 result rows; **36 skills exact, 0 mismatched, unattributed 0** after four map
entries (`Lisa_Attack_AssaultAid_AttackProperty_Bullet_01/02` → 1181012, the Assist Follow-Up's
bullets, 22,236 of its 58,903; `Lisa_Attack_Branch_01_AttackProperty_01/02` → 1181005, 7,443).
Both names were first seen here because the assist was used on request.

**Gauge probe.** 2068 daze rows, **2068 paired by result pointer, 2068 verified by the two copied
floats, 0 unpaired**, after one decoder fix: two Rina-drone hits in the same millisecond had paired
crosswise by time alone (the floats now break same-ms ties; before the fix one of them looked like
an unlogged 7.055 Daze — it was that hit's own Daze under the wrong result). Every `cur_before`
equals the previous row's `gauge_after` on the target except at the two stun onsets, where it is 0:
**the gauge resets to 0 when the stun begins**, and the reset precedes the first
`target_state == 3` row (a state-4 row at 209.515 s already read 0, window 2 opens 209.9 s), so the
decoder now takes MaxStun as the highest `gauge_after` between windows rather than the last row.
All 483 rows with `target_state == 3` have `cur_before == 0` and `daze == 0`.

**MaxStun = 17,582.7 for Cottus P1**, four ways: gauge at onset 1 = 17582.699, at onset 2 =
17582.699; Daze summed from the result probe between windows = 17582.703 / 17582.700; and the
archived 2026-09-13 capture's sum was 17582.706. The settlement's enemy record carries it too:
field `11` = **17582** in both packets (`10` = 3912 and `12` = 48680828 are unlabelled; the latter
is HP-sized). Clamp rows: seq 757 requested 37.03, applied 22.95 → 17582.699; seq 758 same ms
requested 37.03, applied 0; seq 1773 requested 215.34, applied 127.83 → 17582.699.

**The take-ratio is distance attenuation — and it applies to damage too.** `daze_requested ÷
(target_value − cur_before)` is 1.000 on 1017 of 1034 measurable hits, but 0.70 on Grace's first
12 hits (69.97–71.30 s), 0.907 on the next two, 1.0 from 71.66 s on — same AttackProperty, same
pre-value — and 0.75 on Rina's *Drusilla* drone at ~103 s while *Anastacia*'s are 1.0. The applier
computes it as `HEGDGDNNAGM::NKNMBBMLGGE(string, attacker Entity, target Entity, result)`
(3.3.2 `0x181B8EF0`, called at `1a4f15e4`, `mulss xmm6, xmm0` right after), the string being
`result+0xb8` — the result's fifth string slot (probe column `sa0`; 3.3.0 `+0xa0`, noted on
2026-09-12 as `DistanceAttenuation_<agent>` and left unmeasured). Here: `DistanceAttenuation_Lisa`
on every Grace hit that attenuated, `DistanceAttenuation_Curve_01` on the Drusilla hits, empty on
Velina's field ticks, Anastacia, Plugboo and Grace's Chain — and **no hit without a curve name ever
read below 1.0**. Grace's opening is her Dash Attack → Basic chain closing on the boss; the drone
sits farther out than its twin. Damage carries the same factor: her `Normal_01_AttackProperty_01`
did 874.51 at ratio 0.70 and 1349.24 at 1.0 with `Actor_AddedDamageRatio=0.08` (`dmg_mult` 1.08)
on the later hit — 874.51 ÷ (1349.24 ÷ 1.08) = **0.7003**; the 0.907 row gives 611.80 ÷ (729 ÷
1.08) = **0.9066**. The evaluator has eight callers: the Daze applier, two in the bullet/summon
hit-result construction region (`0x133c2d40`, `0x133ca140`) and five in the component the applier
calls next for HP (`0x1a73e0d0`–`0x1a762d20`), consistent with one factor applied on both paths.
The distance itself is not in the result snapshot (none of the unnamed floats tracks the ratio).

`per-hit-log.csv` now carries `attenuation_curve` (the slot string, every row) and `attenuation`
(the measured factor, when a daze log is present and the hit had Daze). The calculator's stance
stands (plan §8.11: assume close range) — this is a logger accuracy item: a captured hit at
`attenuation < 1` is a hit landed out of range, not a multiplier error.

Not changed in this build: the daze TSV header still says `semantics=traced_not_yet_captured`; the
next rebuild should drop that. Open: the enemy record's fields `10` / `12`; whether Anomaly ticks
(no curve) are ever attenuated (none were); the curve shapes themselves (asset `DistanceAttenuation_*`).

### Per-hit Anomaly Buildup — in the result too, plus a gauge probe (2026-09-18, Claude; built, tested, not yet captured)

**Both numbers were in the result all along.** `result+0xf8` (3.3.2) is the hit's requested Anomaly
Buildup and `result+0x150` the amount the target's gauge actually took; `per-hit-log.mjs` now writes
them as `buildup_requested` / `buildup_applied` (3.3.2 only — the 3.3.0 offsets were not traced; the
3.3.0 column once called `buildup_est` was Daze, see "Per-hit Daze"). The decoder's old `f0f8`
column is the 3.3.0 name for a *different* field (3.3.2 `+0x19c`, 0.2778 × Energy on Grace) — the
naming collision is historical, not a relabel.

**Trace.** Dead ends first, so they are not repeated: `Share.EPropertyType` (237 members, readable)
has `Stun` / `StunMax` / `BreakStun` (Impact) / `ElementAbnormalPower` (AM) / `ElementMystery` (AP)
but **no per-element accumulation property**, so the Daze route (property getter with a fixed id)
does not exist for buildup; the `ChangeElementAbnormalAccumulation` UI event (`IGNKDCJPJGH`) has no
direct callers (raised generically); `JIDDJOHMOLF::HHCJHCGFOHO(Entity, PDOGBEADLIE)` /
`DCGKEDBCEMF` is a *single* elementless gauge (`DCIOOCECMLB`, cur `+0x1c`, max `+0x18`) fed from
`result+0x1bc`, which is 0 on every hit here — some other accumulation. The way in was the ability
data: `ByHitDataValue` predicates use `HitDataType.ElementAbnormalAccumulation`; the enum is
`KDIFDACDDDO` {Damage 0, Stun 1, ElementAbnormalAccumulation 2}, its only field lives on the
predicate class `BMPBPGPFLCA` (`+0x50`), and the predicate's implementation
`HOMPBKLPCAC::MCGKLLJKGEF` @ `0x14772560` switches on it: case 1 reads `result+0x250`
(`daze_requested`, ratio ÷ MaxStun), case 2 reads **`result+0xf8`**, ratio ÷ `[gauge+0x8c]` where the
gauge comes from target entity → `[+0x38]` component lookup → `FCMJEGFPIDI` → `+0x78`
`DoubleKeyDictionary<DamageElementType, EVariantElement, PNNLDJHFOAO>`. Then `disp-xref.py 3.3.2
0xf8 load|store`: written by the hit-result factories (`GOOCOICILAJ::KAFEKGEDAAI` — the hooked
snapshot factory — and `MOHIFABJHDA`, an attenuation caller), read by
**`PNNLDJHFOAO::BAIEOPOHGNL(HKMPLIFFNHO)` @ `0x19235B40`**, the per-element gauge receiving a hit
event (`evt+0x20` = `PDOGBEADLIE` ctx, `ctx+0x30` = result):

```text
if result.element != this+0x70 (DamageElementType)      -> return (every gauge sees every hit)
if result+0xf8 <= 0                                      -> return
if !JIDDJOHMOLF::ODJNEPMDHLA(component, element, variant) -> return   (refused: locked / anomaly state)
before = this+0x6c; after = clamp(before + result+0xf8, 0, this+0x8c); BPLINNDONMO(after)
result+0x150 = this+0x6c - before                        (applied)
if filled: PNNLDJHFOAO::IPEBMFFAMNL(ctx, applied, ...)   (trigger: reads ATK/AP/... from the result for the anomaly snapshot)
```

Gauge object `PNNLDJHFOAO`: `+0x48` entity, `+0x6c` cur, `+0x70` element, `+0x7c`/`+0x84`
variant, `+0x8c` max (backing field), `+0x68` unlabelled float. Component `FCMJEGFPIDI` (per
entity), system `JIDDJOHMOLF` (ECS, 62 methods; `Update`, `CreateFilters`).

**What the archived capture (`20260918-181913-daze`) already shows from the two result fields.**
1211 rows with `requested > 0`: 724 `applied == requested`, 20 clamped at a fill, **467 with
`applied == 0`** (refused by `ODJNEPMDHLA` or no matching gauge — same target entity as everything
else, so not a second target). Grace's Physical basics 1/2/4 request 0; her Electric hits 7–137 per
hit; Plugboo 90 per hit; the anomaly ticks themselves 0. The requested value moves under a buff not in
the modifier dictionary (×1.129 / ×1.184 / ×1.313 at different times, the same factors on Grace and
Rina's drone; AM stays 196) — a team-wide Anomaly Buildup Rate bonus; not yet attributed. Summing
`applied` between fills (a fill = a row with `0 < applied < requested`) gives the gauge max at each
fill: Wind 1875 → 3375 → 3901.3 → 3978.8 → 4057.5 → 4137.5, Electric 3825 → 3901.3 → 3978.8 →
4057.5 → 4220 → 4388.8 → 4476.3 → 4476.3 → 4476.3. That is **Leifa's Boss-tier table × 1.25 exactly**
(`docs/reference/dmg-formula-anomaly-disorder-vortex.md` in sheet-webapp, "Enemy Anomaly Buildup
Curves": non-Wind 3000, 3060, 3121, 3183, 3246, 3310, 3376, 3443, 3511, 3581 cap; Wind 1500, 2700
then the same curve): 3183 × 1.25 = 3978.75, 3246 × 1.25 = 4057.5, 3310 × 1.25 = 4137.5, 3376 × 1.25
= 4220, 3511 × 1.25 = 4388.75, 3581 × 1.25 = 4476.25 — the three consecutive 4476.3 are the 10th+
cap. So: the trigger counter is **per attribute** (the doc's "number of times that Attribute Anomaly
has been triggered"; Wind and Electric merely pass through the same values), Wind's low linear start
is real (1875 = 1500 × 1.25, 3375 = 2700 × 1.25), and the game's numbers are the *integer* table
(floor-iterated 2 % steps on the base-3000 tier value) scaled by a per-enemy 1.25 afterwards, not
floor-iterated on 3750 — `buildupCap(3750, n)` in sheet-webapp would give 3979 / 4058 / 4139 / 4221
instead of 3978.75 / 4057.5 / 4137.5 / 4220 (≤ 0.04 %, but a different shape; flagged to the user,
not changed). What the 1.25 is (level, difficulty, this enemy) is open. A few sums do not fit
(Electric 3298.6 first — the 1st fill should be 3750, so the sum missed hits or a fill; 3686.1 at the
130.9 s stun; 4024.8 ×3) — that is what the gauge probe is for. Also visible: the refused rows cluster right after fills of their own
element (0–5 s: 169 of 363 Electric) but are not confined to them (34 rows > 20 s after) — the
refusal rule is not simply "anomaly active"; the probe's `cur_before` sequence should settle it.

**Gauge probe (`src/damage_anomaly.c`, schema 1, `damage-anomaly-*.tsv`).** Hooks `BAIEOPOHGNL` at
entry (six pushes + `sub rsp,0x78` = 12 bytes, position independent; 64-byte fingerprint gate). Per
call: `cur_before`, `max`, `element`, `variant`, `variant2`, `f68`, entity pointer, `evt`/`ctx`/
`result_ptr`, the result's `+0xf8` and `+0x144` copied for the join check, `0xa0` bytes of the gauge
and `0x50` of ctx as hex. Rows = hits × gauges on the target. Status line `anomaly` appended
(`string numeric event enqueue result snapshot daze anomaly`). `per-hit-log.mjs` joins it (same
result pointer, thread, nearest later result row within 200 ms, floats verified; several anomaly rows
per result row by design), decides which gauge *took* the hit by its state advancing (next row's
`cur_before == cur_before + applied`, or a fill followed by a reset), and writes `anomaly-log.csv`
(`cur_before`, `max`, `requested`, `applied`, `took`, `gauge_after`, `unlogged_delta`, `fill`) plus a
per-gauge summary in `settlement-check.json` (`anomalyGauges`: fills with the max at each, distinct
max values, attackers, unlogged changes).

**Build and tests.** `src/damage_anomaly_test.c` (new, `PASS anomaly: …`); eighth bridge in
`damage_probe.S` and the bridge test (six-push prologue relocated as one 12-byte block);
`dynlib.zig` calls `damage_anomaly_start()` after the Daze probe. The Daze header now says
`semantics=verified_capture_20260918-181913`. ReleaseFast DLL SHA256
`0BFEA958781416E81C49B2DD01D03787DF224A37F1A172E1870D619E46F2F3D2` (1,083,904 bytes), installer
checksum updated; header strings `target_rva=0x19235b40` and `target_rva=0x1a4f76a0` present once each.

**Open — what the next capture must show:** every anomaly row paired (`pair_check == ok`); exactly one
gauge advancing per hit with `applied > 0`; `max` on each Cottus gauge equal to Leifa's Boss table × 1.25
for that attribute's own trigger count (Wind 1875, 3375, 3901.25…; Electric 3750, 3825, 3901.25…)
stepping only when its own element triggers; `cur_before` back
to 0 right after a fill (trigger consumes the gauge) — or not; `unlogged_delta == 0` between hits
(the user's observation is that the anomaly gauge does not decay — the log should show that as a
negative control, not assume it); what the refused rows look like on the gauge (`cur_before`
unchanged, and whether the gauge is at max, at 0, or mid-way when refusing — which tells the rule);
the element ids (expect the gauge Grace's hits advance to be Electric, Velina's Wind); what `f68` is;
and the gauges across a stun (user's observation: a stun neither resets nor freezes the anomaly
gauge — expect `cur_before` carried through and hits during the stun still accumulating).

### Capture 2026-09-18 23:38:01 UTC (PID 23336): Anomaly Buildup gauge probe verified; caps, resets, what gets refused

Archived in `local-data/damage-probe-captures/20260918-233801-anomaly/` with `endbattle_1.pb` (server
counter restarted), loadout, `hits.tsv`, `events.tsv`, result/snapshot/daze/anomaly TSVs,
`per-hit-log.csv`, `daze-log.csv`, `anomaly-log.csv`, `settlement-check.json`. Build `0BFEA958…`; all
eight statuses 1. 51 s against Cottus P1 (one target entity, no stun), Grace / Rina / Velina +
Plugboo; 7 anomaly triggers (5 Electric, 2 Wind). Settlement **29 skills exact, 0 mismatched,
unattributed 0**; daze rows 687/687 paired and verified, no unlogged gauge changes.

**Gauge probe: 248 rows, 248 paired by result pointer, 248 verified, 0 unpaired; 2 gauges** —
element **203 = Electric** (Grace 113 hits, Rina 32, Plugboo 9) and **204 = Wind** (Velina 92);
`hits.tsv` uses the same codes (Grace's Physical hits are 200). `variant`/`variant2` 0 throughout,
`f68` = 1 throughout (unlabelled; a multiplier slot, probably). Exactly one gauge advanced per
accepted hit; `unlogged_delta` is 0 (±0.001 float) on every row except the resets below.

**Caps, read from the gauge's own `max` field:** Electric 3750 → 3825 → 3901.25 → 3978.75 → 4057.5
→ 4137.5 (after the 5th trigger), Wind 1875 → 3375 → 3901.25 (after the 2nd). Leifa's Boss-tier
table × 1.25 exactly, **per-attribute trigger counters** (the Wind gauge stepped only on Wind
triggers, the Electric one only on Electric), Wind's low linear start (1500/2700 × 1.25) confirmed.
`buildupCap(3750, n)` in sheet-webapp floors on 3750 and gives 3979/4058/4139 for the 4th–6th values
(3978.75/4057.5/4137.5 measured) — flagged, see the previous section.

**Fill → trigger → reset.** The filling hit is clamped (e.g. 268.187 s: cur 3751.2, requested 430.1,
applied 227.6 → 3978.75), the trigger fires, and the gauge is **reset to 0 with the next max** — in
the same millisecond for 5 of the 7 fills, 78 ms and 219 ms for the other two (Grace's Ultimate,
hits every ~100 ms). The only refusals of real hits *inside* a gauge in the whole run are the two
Ultimate hits that landed in that 219 ms gap (`cur_before` 3978.8 = max, `applied` 0; 2 × 107.5 lost).
There is **no accumulation cooldown after a trigger** (the next hit 31 ms after a reset was taken in
full) and **no decay** (user's observation, confirmed: `cur_before` equals the previous `gauge_after`
on every non-reset row over 51 s). The Doc-1 "3-second cooldown per enemy per attribute" is
therefore not an accumulation rule; whatever it governs, the gauge keeps filling.

**What "requested > 0, applied = 0" actually is** (130 of 376 buildup rows here; 467 of 1211 in the
2026-09-18 18:19 capture): (a) **phantom result rows with damage 0** — Rina's drone and Velina's
Wind Region each emit a second result row in the same millisecond as the real hit, with 0 damage
and a slightly different requested value (100.55 vs 115.63 for the region tick); these are not
hits and reconcile to nothing in the settlement (32 + 30 rows here); (b) **buildup of an attribute
that is not the attacker's own** — the rule, stated by the user (2026-09-18): only a Physical Agent
can apply Physical buildup, and in general an Agent's hits only accumulate their own attribute. It
is enforced in the dispatcher `JIDDJOHMOLF::LGKPIJIIPJG(Entity, EVariantElement, HKMPLIFFNHO)` @
`0x160949D0` (the only path to `BAIEOPOHGNL`; creates a gauge lazily for a new (element, variant)
key), whose first step looks the hit's element up in a table (`16094ad8`; negative index → return
before any gauge is touched). Every dropped real hit in both captures fits: Grace's (Electric)
Basic-3 hits 01/02 are **Physical** (element 200) and carry 0.08 shares of the skill's buildup
(7.09–10.13 requested, 480–811 damage — 0/46 taken here, 0/135 in the earlier capture), and
Velina's (Wind) `WindRegion_ExtraDamage_…_Elec` hits are Electric (62–72 requested, real damage —
0/20 and 0/82). The requested value is still computed and stored at `result+0xf8` for such hits;
`buildup_applied` is the column to use. (c) the two in-gauge refusals during the fill→reset gap
above.

**Requested-buildup buffs (sources named by the user, 2026-09-18; values from the ability data via
`extract-ability-facts.mjs`):** Velina's Additional Ability `Velina_MathSkill`
`AS_AddedAccumulationRatio = 0.15` on Wind-Region hits — **confirmed exactly**: every region tick's
real row is ×1.15 of its phantom twin (88.20 → 101.43, 100.55 → 115.63). Freedom Blues 4pc
(Grace, set 313, `Suit_Ability_50431300`) is an *enemy-side* `AbnormalResistDelta` per attribute for
8 s after the equipper's EX hits, so its effect on requested buildup is `(1 − RES + δ) / (1 − RES)`,
not a round factor. Grace's core `Lisa_UniqueSkill` `AS_Actor_AddedElementAccumulationRatio = 1.3`
applies to her Enhance-tagged EX hits only. Velina `Velina_Talent_04`
`AS_AddedElementAccumulationRatio_Wind = 0.2` while the target has the Wind buff group. The
overlapping factors seen on Grace's and Rina's hits (×1.109 / 1.163 / 1.184 / 1.313 / 1.429 at
different moments) are these with their uptimes; attributing each moment is a buff-uptime audit for
the calculator side (the log has `buildup_requested`, times and the EX/region rows to do it), not a
logger gap. Correction: attacker-side buildup modifiers DO appear in the result's modifier
dictionary when active — Grace's EX rows carry `Actor_AddedElementAccumulationRatio=1.3` (her core)
— so per-hit attribution of the attacker-side part is available; the enemy-side Freedom Blues RES
delta is not a per-hit modifier. AM stays 196 in the result throughout.

**Decoder:** `anomaly-log.csv` and the `anomalyGauges` summary behaved as designed; the join needed
no changes. One reading note: a fill and its reset can share a millisecond, so "latency" must be
measured from rows at or after the fill's timestamp, not strictly after.

### Capture 2026-09-19 17:02:00 UTC (PID 29396): Remielle Bangboo skill-level fix verified

Archived in `sheet-webapp/local-data/damage-probe-captures/20260919-170200-bangboo/` with
`endbattle_2.pb` (the 1-minute `endbattle_1` is parked in `fight1/`), loadout, `hits.tsv`,
`events.tsv`, all eight probe TSVs (statuses 1), `per-hit-log.csv`, `settlement-check.json`.
Cottus P1, Grace / Rina / Velina + Plugboo, 512 result rows.

**Why.** Every earlier capture had Plugboo's Active Skill at level 1 (`dmg_mv` 1.024 / `daze_mv`
0.374 per hit) while its ATK 8057 / Impact 99 were Lv.60 — Remielle's `packDungeonPackageInfo()`
built `buddy_list` but never attached it, so the dungeon got the Bangboo id without its
`skill_type_level` records (patch: `remielle-bangboo-fix.patch` in sheet-webapp's root; also
derives levels from `rank + star − 1`, max 10).

**Result.** All 10 Plugboo rows (2 uses × 5 hits): `dmg_mv` **1.536**, `daze_mv` **0.561**,
`daze` 55.54 — level 6 for a Lv.60 1★ Plugboo, matching Nanoka's per-level growth (0.512 / 0.187
per use). Settlement: 25 skills exact, 0 mismatched; `5400801` log-only as in every capture (the
`.pb` carries no Bangboo per-skill row). Additional Ability level not exercised — unverified.

### Energy gauge is not in any dumped buffer — offline scan, negative (2026-09-22, Claude)

Question: does the live Energy balance sit in something the probes already dump, so it could be
read from existing captures without a hook? Method: on `20260920-173500-run-2115`, every Grace row
of the result probe (1,438 rows: `context`, `entity1`, `entity2`, `result`, `component`, `a8`,
`geometryb0`) and of the snapshot factory (161 grenade rows: `snapshot` 0x200, `arg4` 0x190) was
scanned at every aligned float32 offset for a series in 0–140 with ≥ 30 range whose only decreases
are ≈ 40 (an EX spend). Result: none. The only candidates the filter returned are already named —
`result+0x174` (PEN Ratio, drops of 1–3 %) and `result+0x18c` / `+0x250` (Daze). `snapshot+0x1d4`
steps 85 → 110 → 135 → 85 in a 25 pattern (unlabelled, not Energy). The per-hit `energy`
(`result+0x100`) is the grant only. **Reading the balance needs a hook on the avatar's Energy
component** (the daze gauge probe's pattern: hook the recover/consume handler and read the field
before/after) — not built; decide against the buff-state and enemy Stun-state hooks first.

### Buff, property and Stun state — the three gaps the hit log never covered (2026-09-22, Claude; built, tested, NOT yet captured)

The per-hit log answers "what did this hit do". Three things it structurally cannot answer were
the open items before a rerun of the 2115 baseline: **when a buff went on and off**, **what the
entity's own stat table held at that moment** (the Energy/Decibel balance included), and **when a
Stun really started and ended** (the log can only see "hits landed while `target_state == 3`", so
an idle tail is invisible and a Reset is never tagged). All three are now hooked, in one module:
`src/statelog.zig` + `src/state_hook.c`, writing `state.tsv` per battle folder.

**Trace (3.3.2 dump + saved binary; `dumpq.py`, `disfn.py`, `callers.py`).**

| What | 3.3.2 | How it was found |
|---|---|---|
| Property write | `FNNLNAIBANN::DMIOODAONDK(type, key, mode, double)` `0x18106F70` | The Daze applier `JCELMPFPFBH` writes CurStun through it (`mov edx, 0xB` — `BaseProperty.CurStun` — at `1a4f17d2`). `callers.py`: **173 call sites**, i.e. this is the funnel every stat change passes. Its 3-site inner `IOJOOIAFPDM` `0x18107260` is where the branch to the two writer paths happens; the outer is hooked so nothing is missed. Returns the new value in xmm0 (both paths), so the detour records requested → applied. |
| Property broadcast | `MGBLBALKPKM::BGOHPIKJCFB(type, key, double)` `0x17BD6F60` | Called right after the write when listeners must see it (`1a4f1811`, same `edx = 0xB`). Walks the listener list at `this+0x50`. The stun mixin's `OnFighter_PropertyValueChanged` is one listener, so a `notify` row is the instant a CurStun/MaxStun/ATK change became visible engine-wide. |
| Modifier (buff) instance | `BALGGDCFODF` | Found from the config class: `dumpq` field-type search for `MoleMole.Config.ModifierStacking` gives exactly one game class, `GBCCPCMJCGE` (`+0x98c`), the modifier **config**; the runtime instances that hold one are `BALGGDCFODF` (`+0x1f8`). Its `ToString` (`0x146F94E0`) prints `[cfg+0x800]` — the modifier's **name** — plus `+0x224`, so both are code-anchored, not guessed. |
| — init | `AFNFONFKKBH(ability, owner, config, x)` `0x146FB120` | Sets `+0x210`, `+0x1e0`, `+0x1f8` (config), `+0x1d0`, zeroes `+0x218`/`+0x21c`, and `+0x220 = -1` (unattached). |
| — attach | `JELANNGODEG()` `0x146FC4F0` | Sets `+0x21c` from a call, then `+0x220 = slot`. |
| — detach | `CEIMOJLFNFD()` `0x146FDBC0` | The only method that calls `BNJEDAFGHGB::MNLJMGPABBL` and the ability-system removers. Hooked **pre-call**, so stacks and slot are still readable. |
| Stun enter | `GILABPBBMJH::KFJONGLHNPM()` `0x1A4FB4D0` | The one method that sets `+0xca`/`+0xcb` to 1 and copies the config's two floats (`cfg+0x4cc` → `+0xd0`, `cfg+0x4d0` → `+0xe0`) plus CurStun at entry (`KCOPHPCOPJL` → `+0xbc`). Same component the Daze probe already reads. |
| Stun tick | `GILABPBBMJH::KDOLAAIANGF(float dt)` `0x1A4F4DE0` | `+0xe0 -= dt` while `+0xcb`, clearing `+0xcb` at zero — so `+0xe0` is the Stun's **remaining time** and `+0xcb` is "is stunned". Logged only on transitions, not per frame. |

**Build.** `src/detour.zig` is a new shared prologue relocator (the third copy of that logic was
the cue): `.plain` copies N position-independent bytes, `.cmp_rip` additionally re-encodes the
il2cpp class-initialised `cmp byte ptr [rip+disp32], 0` through rax, as `capture.installAwake`
already did by hand. `src/logfile.zig` is the open/rotate/flush lifecycle the per-battle logs
share. Every RVA, prologue and **18 field offsets** are checked by name through the dumper before
the first patch is written; any mismatch installs nothing and logs `error(statelog)`.

**Tests.** `src/detour_test.zig` (`zig test src/detour_test.zig`, 5/5 pass) builds real functions
in RWX memory and patches them: the call-through returns the original's value, the relocated
`cmp` reads the live flag byte (flip it, the branch flips), a one-byte prologue change is refused
with the target left executable and unchanged, and a too-short prologue is refused. Full DLL
builds clean at ReleaseFast.

**NOT yet captured — what the first run must show.** Nothing below is confirmed against a live
client; this is at the same stage the Daze and Anomaly gauge probes were at before their
captures. On the next launch check `hitlog-startup.log` for seven `hooked …` lines, then run
`node tools/state-check.mjs <battle folder>`:

1. Stun windows that **contain** the hit-log windows (`state-check` prints both). The engine's
   own start/end is the number `stun-windows.md` has been inferring; expect the real window to
   start slightly earlier and end later than the first/last stunned hit.
2. A `stun+` on an already-open window is a **Reset**; the count per window is the thing the
   contract's 3-Reset cap was inferred from and has never been read directly.
3. Buff names that match the kit (Tech Support, Rina's field, Grace's core passive) with
   on/off counts and measured on-time against the config duration, and whether the timers run
   during an Ultimate cinematic — the plan's §Phase 2 "open check" that the hit log cannot answer.
ReleaseFast DLL SHA256 `4893B7A5FBC4E7CC7229F6E81C67F3EE3219D29A725DC1DE0D3F1A644F6450F9`
(1,451,008 bytes), built from `d3f1199`. Deploy as always: copy `zig-out/bin/thaumiel.dll` and
`remielle.exe` into the client folder and launch `remielle.exe`.

4. **Energy and Decibels are expected to arrive as ordinary `prop` rows** (they are properties:
   `CurEp` / `CurIndividualFever` in `BaseProperty`), but the dump has no enum constants, so the
   type ids must be identified by value: `state-check --prop <id>` prints one id's series, and
   the Energy id is the one that rises by the per-hit `energy` grants and drops ~40 at each EX.
   Until that series is seen, **the Energy gauge is hooked but not proven**.

#### First launch, 2026-09-22 14:17:24 UTC (PID 6124): nothing installed — one mistyped offset, and the refusal was invisible

Capture `captures\20260922-141724-6124`, one 101 s battle. `state.tsv` was created and rotated
into `battle-1` correctly but contained **only its header**; no `info(statelog)` and no
`error(statelog)` appeared in `hitlog-startup.log`. Two separate faults, both now fixed:

1. **The pin was wrong.** `s_entered` was pinned to `GILABPBBMJH.NOMHMIPMPHM` at `+0xca`; that
   field is at `+0xc9` and `+0xca` is `IDODHIIDDGL` (the one `KFJONGLHNPM` actually writes, per
   its own disassembly — the offset was right, the *name* was read one line up in the dump).
   `checkFields()` therefore returned `error.FieldOffsetMismatch` and `installFromWorker` gave
   up **before patching anything**, which is the designed behaviour: the client ran completely
   untouched and every other log in that capture is valid.
2. **The refusal never reached the log.** `debugging.zig`'s `logFn` routes to
   `startup_log.zig` by a *scope allowlist*, and `.statelog` was not in it, so the error went to
   the console only and the file showed an unexplained gap between the timescale hook and
   `v7 disabled by dumper-disable.txt`. `.statelog` is now in the allowlist. **Any new hook
   module must be added there or its failures are silent.**

**`tools/update/check_pins.py` (new) makes this a one-second offline check.** It parses the
`Target` and `Field` literals straight out of `statelog.zig` and validates each against the
dump: class resolves uniquely, method resolves uniquely at that arity and sits at the pinned RVA,
the prologue bytes are really the bytes at that RVA, and each field name occurs exactly once in
the class + parent chain at the pinned offset. Run it before every deploy:

```text
py tools/update/check_pins.py 3.3.2      # "checked 25 pins ... all pins match"
```

Re-introducing the bug reproduces the exact diagnosis, which is how the tool was verified:
`s_entered: GILABPBBMJH.NOMHMIPMPHM is at +0xC9, pinned +0xCA -- the field actually at +0xCA is
IDODHIIDDGL`.

Rebuilt DLL SHA256 `1F6DD5C8C229CF8B782BE27229D3E2999E746CA77A3467F9791ADBF694780576`
(1,481,728 bytes). Still not captured.

#### Second launch, 2026-09-22 14:27:06 UTC (PID 35508): all seven hooks live; three findings

Capture `captures\20260922-142706-35508\battle-1` (88 s, Grace/Velina/Remielle vs Cottus),
copied to `local-data/damage-probe-captures/20260922-142706-statelog-first/`. All seven
`info(statelog): hooked ...` lines present. `state.tsv` 3.2 MB / 42,880 rows for 88 s — about
8× `hits.tsv`, so a 180 s run lands near 7 MB. Rows: `prop` 22,275, `notify` 19,454, `modA` 813,
`mod+` 336.

**1. Buff names come through, and they are the kit.** 147 distinct modifiers, named exactly as
the ability data names them: `Velina_WindRegion_ResistDown_Wind` (33 attaches),
`Lisa_EXQTE_BuffCount_Modifer` (25), `Weapon_14156_ElementMysteryDelta_Team` (21, 3 owners),
`StunResetControl` (18), `RemielleOrigin_PersistentWings_Modifier`, `Suit_50433900_
ElementMysteryBuff`. The two-hop read (instance `+0x1f8` → config `+0x800` → System.String) works.

**2. `modD` never fired — the detach hook was on the wrong method, now fixed.** 813 attaches,
0 detaches, 324 "still attached" at the end. `CEIMOJLFNFD` (`0x146FDBC0`, reached from
`BNJEDAFGHGB::DEHFFAHAAAC`) is *a* removal notification, not the lifecycle end. The unambiguous
marker is the attachment slot `+0x220`: `JELANNGODEG` sets it on attach, and the **only** method
that clears it to -1 is `BMBPABPKGCH` (`0x146FE180`), whose only caller is
**`BALGGDCFODF::EJGEIOCDOML` `0x146FCBA0`**. That is now the detach hook. Unverified until the
next capture.

**3. The two `GILABPBBMJH` hooks are NOT the Stun — and the Stun needs no hook at all.**
Ground truth from the same capture: `per-hit-log.mjs` reports the stun window (`target_state`
3) as **61.9–85.9 s**. The `stun+` row fired once, at 78.0 s, *inside* that window, and the
`+0xcb` flag read 0 at 62.9 s while the enemy was stunned. Reading `KDOLAAIANGF` again shows what
`+0xcb` really gates: while it is set the per-frame Daze **decay** term is forced to zero. So the
pair is the "recently hit, meter does not drain" grace, and the rows are relabelled `grace+` /
`grace~` / `grace-`. (A spurious row was also emitted on the first observation of a component;
`seen_update` now suppresses it.)

**The Stun window was in the `prop` rows the whole time.** CurStun is **property type 11**: the
capture shows the write at **61.875 s** requesting 17,607.84 and applying 17,582.70 — the
MaxStun clamp, which `per-hit-log.mjs` independently reports as 17,582.699 from the Daze gauge —
then a drain to 0 at **85.91 s**. `state-check.mjs` now derives the window that way: start = the
write clamped at the cap, end = the write reaching 0, a re-fill to the cap in between = a Reset.
It prints **61.88 → 85.91 s, 24.03 s, no Reset** against the hit log's 61.9–85.9 s, i.e. the two
agree to ~30 ms and the meter version also covers the idle head and tail the hit log cannot see.

**Property type ids identified by value (the open question from the first entry):**

| Type | What | Evidence in this capture |
|---|---|---|
| 10 | keyed resource slot; the `name` column carries the key | keys seen: **`CurrentEnergy`**, `CurrentFlyEnergy`, `MaxLumenBullet`, `AmplifyRatio_01`. `in` is the delta and `out` the new total (`CurrentFlyEnergy` -0.05 → 119.95) |
| 59 | **Decibels** | starts at exactly **1000** (three owners, the sheet's `STARTING_DECIBELS`), rises by 7.7378 per grant, range 0..3000 = the cap |
| 11 | **CurStun** (Daze meter) | 0..17,582.70, clamp = the gauge's MaxStun |
| 7 | unlabelled, 15,389 writes, 1.69..100 | the firehose; not identified |
| 0, 33, 572, 577 | unlabelled | 701 / 5 / 151 / 114 writes |

So **Energy and Decibel balances are confirmed captured**, Energy by its own key string rather
than by inference. The Energy series can now be checked against `resourceMath.ts` directly
(`state-check.mjs --prop 10`).

#### Third launch, 2026-09-22 14:38:35 UTC (PID 11816): detach confirmed, and the first directly observed Stun Resets

Capture `captures\20260922-143835-11816\battle-1` (105 s), copied to
`local-data/damage-probe-captures/20260922-143835-statelog-detach/`. 50,933 rows / 3.9 MB.

**Detach works.** `modA` 927 / `modD` 876, and the per-modifier counts now balance exactly where
the buff ended before the battle did: `Velina_WindRegion_ResistDown_Wind` 45/45,
`Lisa_EXQTE_BuffCount_Modifer` 25/25, `StunResetControl` 20/20, `QTECloseModifier` 20/20. The
unbalanced ones are the ones still live at the end (`__DEFAULT_MODIFIER` 110/79,
`Weapon_14156_ElementMysteryDelta_Team` 21/20, `Suit_50433900_ElementMysteryBuff` 8/6), which is
what "still attached when the battle ended" should look like. Measured on-times are plausible
throughout: the weapon's team buff 13.24 s, the disc set's 14.40 s, Grace's EX counter 4.17 s.

**The Stun window and its Resets, both measured.** `64.78 -> 96.45 s, 31.67 s, with two refills
at the cap (64.95 s, 71.14 s)`. Those two refills are **Stun Resets observed directly** — the
first time this project has seen one rather than inferring the count from the window's length
(`stun-windows.md` §5). A 31.67 s window with 2 Resets is consistent with the contract's model
(a base window extended by capped Resets), and is now a measurement rather than a derivation.

**Still unidentified: the config's duration field.** The float pinned as `c_duration`
(`GBCCPCMJCGE+0x994`) reads 0 on every modifier, so it is not the duration; `state-check.mjs` no
longer prints it. The MEASURED attach->detach time is the ground truth and is unaffected. The
duration probably sits in one of the config's `DynamicFloat`/`DynamicInt` structs
(`+0x78`, `+0x640`, `+0x7e8`), which are structs rather than plain floats. Not chased.

**Label correction.** The three `GILABPBBMJH` rows are emitted as `grace+` / `grace~` / `grace-`
from this build on; the two captures above label them `stun+` / `stun~` / `stun-` and
`state-check.mjs` accepts both. They are the Daze no-decay grace either way.

Deployed DLL for captures 2 and 3: SHA256
`D2135649135B601538E6563184A2F9943966C81B9A7942D067B34C71ACEA3F7A`. The build carrying the
`grace+` labels, deployed 2026-09-22 for the baseline rerun, is SHA256
`F263BAC815FBD69356A77ECDE8E0818F610E7AD7E5A19EA0EAE9951F8FDF3B49` (1,481,728 bytes) — the
only difference from the capture-3 build is those three row labels.
