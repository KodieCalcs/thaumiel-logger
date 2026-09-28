> Moved from `sheet-webapp/docs/reference/client-update-playbook.md` on 2026-09-13; source paths rewritten to this repo. `tools/rva-signature-match.mjs` and `tools/extract-kit/` referenced below are sheet-webapp tools, not part of this repo.

# Client update playbook

What breaks when the ZZZ beta client patches, and the order to fix it in. Written 2026-09-12 with
CNBetaWin3.3.0 working and an update pending; **exercised for real on 2026-09-13 (3.3.0 → 3.3.2)** —
see "What the 3.3.0 → 3.3.2 update actually took" below for what held up and what did not. The
pin values in the tables are the 3.3.0 ones this document was written against; the current pins
live in the sources and in README.md's version contract.

**Asset extraction is unaffected.** `tools/extract-kit/` works against any client version and
auto-detects the install folder. Only the *live capture* is version-pinned. If you only need a new
Agent's hit splits, frames and cancel windows, update freely and ignore everything below.

## Updating with rederive.py (since 2026-09-28)

Every client pin now lives in one manifest per build, `tools/update/pins/<client>.json`, keyed by
**stable names** (`ModifierInstance.attach`, `DamageResult.crit`, ...). `tools/update/rederive.py emit`
writes it into `src/pins.zig`, `src/pins.h` and `src/dumper-rvas.zon`, which every hook and probe
reads. **Never hand-edit those three files**: change the manifest and emit again
(`rederive.py check <client>` fails if they drift). The sections further down are the history of how
each piece was found by hand; the tool now does all of it.

Set `THAUMIEL_LOCAL_DATA` to the folder holding `client-binaries-<client>/` (archive GameAssembly.dll
and UnityPlayer.dll there first) and `il2cpp-dump/`. Then, per update:

1. **`py tools/update/rederive.py prepare <old> <new>`**, before launch 1. It finds Unity's API table
   without anchors, pins a bootstrap table (only unique, block-consistent matches, plus a guess for
   every slot the DLL calls, so each is either verified or reported), re-traces the readiness
   anchors, and builds a launch-1 DLL. In that DLL only the dumper accepts the new client; every hook
   keeps the old identity and refuses, as launch 1 always did.
2. **Launch 1** (user): the dumper writes the new dump and `hitlog-startup.log`, then fails closed on
   the table by design.
3. **`py tools/update/rederive.py finish <old> <new> --report <hitlog-startup.log>`**. This applies the
   report, re-reads and classifies the seven code checks, and matches every class, method, field and
   return site. It writes `pins/<new>.json`, emits, builds, runs the gates (8 probe tests, detour,
   readiness), adds the decoder's `LAYOUTS` entry and prints the sheet-webapp `BUILD_CONSTANTS` line.
   **Read its STOP and REVIEW list.** A STOP is a pin the tool would not guess. If a module needs
   it, the build fails: settle it in `pins/<new>.json` and run `emit` again.
4. **Launch 2** (user): one battle with a Stun and an Ultimate (live-validation list below).
5. **`py tools/update/rederive.py measure <new> <battle folder> --apply`**. This reads
   `daze_requested`, the effect fields and the name-object roles off that capture and writes them
   into the manifest, the `LAYOUTS` entry and `tools/attribution.mjs`.

Replayed on both past updates from their archived binaries and launch reports. `finish 3.3.3 3.3.4`
builds a DLL byte-identical to the committed 3.3.4 one (`tools/update/same_dll.py`: every section but
`.buildid`), and so does `prepare`, then a simulated launch-1 report, then `finish`. On 3.3.2 -> 3.3.3
it stops where that update needed a person: `modifier_init` at shape 0.546, which was settled by an
argument-flow trace. Still manual: the two launches, anything the tool STOPs on, the sheet-webapp
line, and the public line (`thaumiel-release`).
The rederive commits' messages carry the design and the full replay record.

## What is pinned, and where

| # | Where | Pin | Re-find cost |
|---|---|---|---|
| 1 | `dumper.zig` | Unity il2cpp API table offset `+0x1f96648` | **Expensive** — the hard part |
| 2 | `dumper-rvas.zon` | expected il2cpp API RVAs, used to validate that table | **Expensive** — coupled to 1 |
| 3 | `src/hitlog.zig` + public lookups in `src/dumper.zig` | **No method/field pins:** exact class/field names and method arity resolved at runtime; four 12-byte prologue checks remain | No manual re-pointing after the bootstrap is updated; every resolved RVA and field offset is in the thaumiel log under `hitlog` |
| 3b | `src/capture.zig` | `MoleMole.BattleStatsSubsystem::OnAwake` / `::OnDestroy` resolved by name; prologue checks: OnDestroy 12 verbatim bytes, OnAwake 10 verbatim bytes + `80 3D disp32 00` (re-encoded through rax in the stub) | Cheap — named; if a prologue changes, `disfn.py <ver> <rva>` and re-derive the relocation (comment at the top of `capture.zig`); a failure only costs the per-battle folders (everything lands in `battle-0`), logged under `capture` |
| 3c | `src/timescalelog.zig` | 3.3.2 class `LOLPDHOFIHG` (obfuscated, renamed every build), `::Update/1` RVA `0x136C9610`, seven field offsets (+0x7c, +0xbc, +0xc4, +0xc8, +0xd0, +0xec, +0xf4) and a 12-byte prologue, all checked at install | Cheap but manual: the class is the tail-`jmp` target of the **named** `PlayTimeSlowUtils::InvokeTimeSlowKey/3` (`disfn.py <ver> <its rva>`); `disfn.py <ver> <Update rva>` gives the offsets from the `movss/mulss/addss` lines (the layout shifted between 3.3.0 and 3.3.2); `PinballSubsystem::ResolvePinballWorldTimeScale/0` cross-checks the scale/unscaled offsets. A failure costs only `timescale.tsv`, logged under `timescale` |
| 4 | `damage_probe.c` | `target_rva = 0x1b104120` and `0x1482c410`, a 16-byte prologue and a 64-byte fingerprint | Cheap — anchored to a named function, see below |
| 5 | `damage_result.c`, `damage_stun.c`, `damage_snapshot.c` | result converter `0x1823a830` (obfuscated; found via the enqueue publisher), result factory `0x16fa7460` (obfuscated; found by scanning for the stores to the result's stat offsets, see the howto), Daze widget `0x1965b6a0` + `0x1965c070` (**named**: `UIStunDamageWidgetController::UpdateStunDamageUI` and its sibling); each with a 64-byte fingerprint and a 12-byte prologue | Named ones cheap; the result converter needs the howto's trace re-run |

**Adding more hooks does not make an update meaningfully harder.** The cost is dominated by items 1
and 2. Once the dumper runs it emits every class and method with names and RVAs (the current build's
dump is 135 MB), so re-pointing a hook on a *named* method is a grep plus a constant edit.

The distinction that matters: a hook on a **named il2cpp method** is trivially re-findable, because
the dump carries names. Item 3 targets `ConfigEntityAnimEvent::TriggerAttackPattern` directly.

**Item 4 is in better shape than a bare address suggests** — `docs/reference/damage-probe-howto.md`
records the discovery under "Evidence inspected; do not repeat discovery", and the target is
anchored two ways that both survive a rebuild:

- It is identified by its **calls to `QueryDamageTextInfo`** (visible at `0x1482C729` and
  `0x1482C7AF`), which is a *named* function. Find that in the new dump, then find its callers.
- The probe carries a **64-byte fingerprint** taken from the target's own bytes, plus a 16-byte
  position-independent prologue check. That is the reference-diff technique already implemented.

So re-pointing the damage probe is a search, not an investigation. The thing genuinely worth
preserving is that howto: a hook whose discovery method is undocumented is the expensive case, and
that case does not currently exist in this repo.

## Order of operations

**1. Before updating — already done for 3.3.0.**
`local-data/client-binaries-CNBetaWin3.3.0/` holds `GameAssembly.dll`, `UnityPlayer.dll` and the exe
for which all four pins above are known-good. Do this again before any future update; it is the
difference between diffing and starting over.

**2. After updating, try the existing offsets first.**
A content patch changes GameAssembly but may leave the Unity API table layout alone, since that is
set by the il2cpp/Unity version rather than game content. Run the dumper unchanged. If it validates,
items 1 and 2 survived and you are straight to step 4.

**3. If the dumper fails — know that the matcher solves ONE of four gates.**

`loadTable()` in `dumper.zig` has four independent gates, and a signature match over GameAssembly
addresses only the third:

| Gate | What it pins | Does the matcher help? |
|---|---|---|
| `game_size != 0x2109c000` | GameAssembly's `SizeOfImage` | **No.** Any patch changes it; read the new value from the PE header |
| `peek(unity + 0x1f96648, &table)` | the API table's offset inside **UnityPlayer.dll** | **No.** The matcher searches GameAssembly. Needs its own work |
| `table[i] != game + rva` | the ~194 il2cpp API RVAs | **Yes** — this is the batch job |
| 7 code-byte checks on `table[...]` | literal instruction bytes at API entries | **Partly.** Two contain relocation-sensitive operands |

That last row matters. Check 65 is `48 8b 0d e9 ed ce 04` — `mov rcx,[rip+0x4ceede9]`, a RIP-relative
displacement. Check 152 is `e9 5b 79 08 00` — a relative `jmp`. **Both change when anything moves,
even if the function is otherwise untouched**, so they must be re-read from the new binary rather
than matched.

So the honest sequence is: re-read `SizeOfImage` from the new PE header; re-locate the Unity table
(the genuinely hard part, unaddressed by any tooling here); batch-match the 194 RVAs; then refresh
the seven code checks from the new binary. Only step three is automated.

**Running the matcher.**
`tools/rva-signature-match.mjs` automates this. A content patch moves code without rewriting it, so
a function's *body* is a stable signature even when its address is not. The tool takes each known
RVA, extracts bytes at that address in the old binary, finds them in the new one, and reports the
new RVA.

```
node tools/rva-signature-match.mjs <old GameAssembly.dll> <new GameAssembly.dll>
node tools/rva-signature-match.mjs <old> <new> --zon src/dumper-rvas.zon
```

The second form re-matches **all ~194 il2cpp API RVAs at once**, which is what turns row 2 of the
table above from expensive into a batch job.

It grows the signature until it is unique — 32 bytes, then 64, then 128 — because short prologues
are worthless as identifiers. `hitlog`'s own 12-byte check
(`41 57 41 56 41 55 41 54 56 57 55 53`) is eight generic pushes occurring in thousands of functions,
and in the self-test one real target needed 128 bytes before it was unique.

Statuses: `OK` with the new RVA and its delta. Everything else needs manual re-derivation:
`NOT_FOUND` / `DIVERGED` (the signature bytes are not present) — note this does **not** prove the
body was edited, because relative calls and RIP-relative displacements are encoded in the
instruction bytes, so a function that merely *moved* can fail to match; `AMBIGUOUS` (even 256 bytes
were not unique, usually a thunk or shared stub); `UNMAPPED_HIT` (the bytes exist in the file but
not as a contiguous run inside one section, so they are not an address); `NOT_CODE` / `BAD_RVA`
(the supplied RVA is not in an executable section, or not file-backed at all).

**Honest limit:** the self-test matches the old binary against itself (194/194), which proves the PE
parsing and the uniqueness logic but *not* the cross-build hit rate. How many survive a real patch
depends on how much the patch rewrote. Expect most engine and runtime code to match and some
gameplay code not to.

### Keeping the patch files — additional evidence, not proof (untested)

The launcher updates via **hdiff** patches (`hpack.exe` sits alongside the client). An hdiff encodes
*"copy old bytes [a,b) to new offset c, then insert these literal bytes"*, which is **useful
matching evidence but not an authoritative function mapping.** A delta describes how to reconstruct
the new file cheaply; it says nothing about meaning:

- A copy may source bytes from **anywhere** in the old file, including an unrelated function that
  happens to share a byte run. A copy therefore does not establish that the old region *is* the same
  function as the new one.
- HDiffPatch applies **corrections to copied old data**, so a covered region can still differ from
  the source it was copied from.

Where it does help: it may cover functions whose bodies changed slightly, which byte-search reports
as `DIVERGED` and abandons. But any mapping it suggests still needs function boundaries and identity
validated independently.

An earlier revision of this document called the hdiff route "strictly better" with "no ambiguity".
Both claims were wrong (Codex review, 2026-09-12) and are withdrawn.

Two practical obstacles regardless: the launcher normally **deletes patch files after applying**, so
they must be captured during the update; and hdiff payloads are compressed, so reading one needs the
HDiffPatch format or `hpack.exe`.

**Recommendation:** grab the `.hdiff` files if it is easy — they cost nothing to keep and are extra
evidence. Do not block the update on it, and do not treat what they imply as settled.

**Resolved 2026-09-12: skip the pre-apply scan.** The reason to pull `GameAssembly.dll.hdiff` out of
the archive *before* updating was to produce the new binary without committing to the patch. That is
moot — the old binaries are already preserved in `local-data/client-binaries-CNBetaWin3.3.0/`
(GameAssembly 519 MB, UnityPlayer, exe), so applying the update destroys nothing the matcher needs.
Apply with `hpack apply <client dir> <hdiff file>` (`-b` adds its own backup) and run the matcher
afterwards: old snapshot vs. freshly-patched binary.
`tools/extract-kit/extract-hdiff-gameassembly.ps1` is kept for the case where the old binary is
*not* already preserved.

**4. Re-point the remaining pinned hooks from the fresh dump.**
Hitlog resolves its named methods and fields automatically after bootstrap validation; see the
completed permanent fix below. The stale-RVA warning below applies to manually pinned targets
(and describes why the former hitlog constants were removed).
Run the dumper, then for each hook grep the output for its method name, take the RVA, update the
constant, and refresh the prologue bytes from the new binary. Rebuild. Each hook verifies its own
prologue and refuses to patch on mismatch.

**That check is a guard, not a guarantee — do not rely on it.** `hitlog`'s prologue is twelve bytes
of eight generic pushes (`41 57 41 56 41 55 41 54 56 57 55 53`), which this same document notes
occurs in thousands of functions. A stale RVA that happens to land on any of them **passes the check
and gets patched**, detouring the wrong function with the wrong signature. That is a crash or silent
corruption, not a clean refusal.

The mismatch case is safe. The *coincidental match* case is not. Treat a stale constant as dangerous
and verify the address against a fresh dump before running, rather than trusting the guard to catch
it (Codex review, 2026-09-12 — the earlier text claimed a stale value "cannot crash the game").

## What the 3.3.0 → 3.3.2 update actually took (2026-09-13)

Done in one session. Everything below is reproducible with `tools/update/`; the honest cost was the
result-object field map, not the addresses.

**What moved.** Everything. GameAssembly `SizeOfImage` `0x2109C000 → 0x21396000`, PE timestamp
`0x6A99EBD2 → 0x6AA31B73`; UnityPlayer changed too (+10 KB), so the API table moved. The client
also **shuffles class layouts per build**: every field offset in every class we read moved,
including il2cpp's own `MethodInfo` (flags `+0x2c → +0x30`, invoker `+0x10 → +0x18`), `MoleMole.Config`
classes, and even `System.Version` in mscorlib (`System.String` / `System.Exception` happened to
stay). Obfuscated class and method names are re-randomised (`JJNCFKMGDDP` became `GOOCOICILAJ`);
named ones persist. Method order inside a class is shuffled; field declaration order is shuffled.
So **no offset and no obfuscated name survives an update** — only structure and code shape do.

**Sequence that worked, with cost:**

1. *Dumper* (`src/dumper.zig`, `dumper-rvas.zon`) — ~1 hour.
   - SizeOfImage: read from the PE header.
   - Unity table offset: `node tools/update/find_unity_table.mjs <old UnityPlayer> <new> 1f96648`.
     Two code sites that reference the table (`mov rax,[rip+..]` → `table[0]`, `table[2]`) are
     masked-searched in the new build; both agreed on `0x1F9A6C8`, and the number of
     `call [rip+..]` sites landing inside the candidate matched the old build (18 distinct slots).
     The naive ".data moved by +0x4000" guess would have been wrong by 0x80.
   - The 194 RVAs: `tools/rva-signature-match.mjs` (exact bytes) got 33/194 — relative operands
     defeat it, as predicted. `tools/update/masked_match.py` (rel32 / RIP-relative operands masked
     with capstone) found the il2cpp API block moved as a unit by **+0xD7A0**: 127/194 verified
     byte-for-byte modulo relocations, the rest sat in the same slot with per-build obfuscation
     changes (`movabs` keys, bitfield masks, struct offsets). Runtime helpers outside the block
     matched by exact signature. Seven trivial shared stubs (`mov eax,[rcx+0x10]; ret`) could not
     be pinned statically: pinned to 0 (= "must land in GameAssembly, log the actual RVA") and
     filled in from run 1. Run 1 also caught one look-alike match (`[45]`) and two slots that
     **swapped** between builds (`[118]`/`[119]`) — the validator now reports every mismatch
     before failing closed, so that costs one launch, not one launch per index.
   - Seven code-byte checks: re-read at the new RVAs.
   - `MethodInfo.flags` offset: read from `runtime_invoke` (`test byte [rdi+0x30], 0x10`).
2. *Hitlog* — 10 minutes once the dump existed. Named methods, unique, same arity, same prologues;
   19 config field offsets re-read from the dump's `FIELD` records by name (every one moved).
   Verified by a live fight: 9k rows, same value distributions as a 3.3.0 capture.
3. *Damage probes* — the bulk of the work; see the procedure below.

**Procedure for the probes (obfuscated targets and object offsets).**

- *Find the class:* `py tools/update/classmatch.py <OldName>` matches by namespace, field count,
  method-arity multiset, named parent and surviving named methods. All eight classes we hook or
  read mapped uniquely. When it fails (the damage calculator gained one method), rank by arity
  histogram distance instead (see the sweep in the 2026-09-13 session log).
- *Find the method:* same arity inside the matched class, then `py tools/update/align.py
  <oldRVA> <newRVA>` — instruction-shape alignment (difflib over mnemonic+operand shapes with
  displacements/immediates abstracted). Compiler output is stable: the six probe targets aligned
  at 0.945–1.000 and every wrong candidate scored < 0.6. The string probe's masked fingerprint hit
  (`masked_match.py ... il2cpp`) agreed with the class+arity route.
- *Relocation prefixes:* verify each new target's first 12/16/18 bytes are still a clean
  instruction boundary with no RIP-relative operand (except the enqueue `cmp` the code re-bases) —
  `tools/update/disasm_pair.py`. All six were the same shape as 3.3.0.
- *Object field offsets* — three sources, in order of trust:
  1. **Alignment of a function that reads/writes the field**, reading the displacement pair off
     the aligned instruction. The hit-result factory (99.5 % aligned) gave every stat it copies
     (ATK, AP, AM, Impact, MVs, level, …) and the snapshot's offsets; the result converter gave
     damage, crit and the attacker entity. It reproduced the dump-derived config offsets exactly,
     which is the check that the method is sound.
  2. **Field types** from the dump (`FIELD_TYPE` records): unique types pin a field outright
     (the `Dictionary<string,float>`, the nested geometry type), and a type shared by two fields
     with one already known pins the other (the two `EntityHandle`s → target entity).
  3. **The class's own tiny getters/setters** (`movss [rcx+d], xmm1; ret`): the set of displacements
     they touch in old vs new confirms 1 and 2 (damage, geometry, dictionary all re-appeared).
  Traps: a register named `rbp` is usually a **frame pointer** in big functions — its
  "displacements" are stack slots that never move, and they will look like a perfect identity
  mapping; always check a candidate register agrees with ≥ 2 already-known field offsets and
  contradicts none. A reset/clear method stores in **declaration order**, which is shuffled, and
  merges adjacent fields into wider stores — its alignment is garbage for scalars (4 agree / 9
  disagree here) even at 0.90 similarity. Fields that were only ever labelled empirically
  (`target_state`) have no code anchor by construction; re-label them from the first capture
  rather than spending hours on writer scans (the byte-pattern scans of the il2cpp section drown
  in Unity behaviour classes with the same float offsets — `tools/discovery/disp-xref.py`, which
  bounds each candidate by the dump's method RVAs, is what finally made a writer scan cheap: it
  anchored `daze` / `daze_requested`, formerly `buildup_est`, to the stun component in 2026-09-18's
  "Per-hit Daze" section of the howto).
- *Dictionary internals* (`entries +0x18`, stride 24, hash/next/key/value at `+0/+4/+8/+16`) were
  re-read from the modifier lookup (`FindEntry`) and were unchanged — but check, `System.*`
  layouts are not exempt from the shuffle.
- *Decoder:* `tools/per-hit-log.mjs` selects a layout by the capture's `client=` header; the
  3.3.0 table is frozen and regression-checked byte-for-byte against an archived capture.

**Order of validation runs:** run 1 = dumper only (hitlog and probes refuse on the PE gate) →
pin the reported entries → run 2 = full dump → re-point hitlog → fight → re-point probes → fight
with `per-hit-log.mjs` settlement check. Drop a `dumper-disable.txt` beside the launcher once the
dump exists; it costs a minute of stutter per launch otherwise.

**Closed by the first 3.3.2 capture (20260913-132556, 1405 rows, 31/31 skills exact against
`endbattle_10.pb`):** target state is `result+0x174` (value set {1,3,5,6} in the 3.3.0
proportions, 3 = stunned, one 20 s window); the buildup estimate is `+0x18C` (3.3.0's zero fraction
and per-attacker ratio-to-Daze-MV fingerprint; its near-twin `+0x184` became `+0x250`, told apart by
which side carries the `...450683594` rounding). Name object: `+0x20` ability, `+0x28`
AttackProperty, `+0x10` the formerly-empty slot — now the *triggering* AttackProperty on anomaly
ticks, which is new information. The settlement `.pb`'s battle-result container moved from
top-level field 8 to 12; the layout inside did not change. Two probe-side bugs were found only by
this capture: a stale TSV column header (`a8s18` for bytes read at `+0x20`) and the decoder
mapping anomaly ticks to the triggering skill — both fixed. **Still open:** the roles of the six
string-typed result fields (dumped by offset order, unused downstream).

## The permanent fix: implemented for hitlog

`src/hitlog.zig` now resolves all four named `ConfigEntityAnimEvent` methods by name and
arity (12/12/11/7), plus all 19 config fields, through the verified il2cpp table in
`src/dumper.zig`. Classes must be unique across images; methods must be unique by name/arity;
fields must be unique across the full parent chain. Strings use RPM. Native method pointers
must lie inside GameAssembly. Any failed lookup leaves all hooks uninstalled, and all four
eight-push prologues are checked before writing any patch. The TSV schema and C detours are unchanged.

The dumper worker polls (50 ms) using read-only access to the main thread's domain
context, after validating the API table and the startup instruction anchors. It never
calls slot 154: that slot is a callback setter and caused the 2026-09-20 startup crashes.
See [startup crash fix](startup-crash-20260920.md) for binary evidence, the readiness
contract and the additional bootstrap pins. It then installs hitlog with a
temporary il2cpp thread attachment **before** checking `dumper-disable.txt` or opening dump
files. The disable file still suppresses only the dump. `hits.tsv` and its header are created
immediately by `hitlog.start()`. A validation/lookup failure is logged and leaves capture disabled;
there is no fallback to old addresses. The worker uses its own `nt.Syscall`.

Every method RVA and field offset is logged individually in the thaumiel log under `hitlog`.
The PE timestamp and actual SizeOfImage are logged too; the latter bounds caller/stack RVAs.
`known_3_3_2` preserves the old values solely for warnings when that PE identity is detected.
Differences emit `CNBetaWin3.3.2 CROSS-CHECK MISMATCH`; they do not gate installation.

What remains pinned:

- Dumper bootstrap: Unity table offset, expected API RVAs, code-byte checks and PE SizeOfImage
  check. The il2cpp API is not exported by name, so name lookup depends on updating this first.
- Hitlog's method names/arity, field names, native pointer at MethodInfo+0 and eight-push
  relocation contract. A renamed or changed kit/runtime ABI still requires investigation.
- `src/eventlog.zig` and the C damage probes: obfuscated names change each build, so their
  target addresses, object layouts and fingerprints still require the existing update procedure.
  This change does **not** remove item 4 or the probe work.
- `src/capture.zig` (2026-09-20): the two `BattleStatsSubsystem` methods are named and resolved
  the same way as hitlog's; only their prologue shapes are pinned (item 3b). Verify on the first
  launch of a new build that `hitlog-startup.log` shows `hooked BattleStatsSubsystem::OnAwake` /
  `::OnDestroy` and that a fight produced a `battle-1` folder whose first hit is ~1–2 s in.

### First-launch verification (no live client available during implementation)

On CNBetaWin3.3.2, check the thaumiel log before the first fight:

- Four resolved RVAs, in Trigger/Handle/List/Continuous order: `0x16A012B0`, `0x16A01590`,
  `0x16A01B30`, `0x16A02BB0`. Confirm all four `hooked` lines and no lookup/prologue failures.
- All 19 field offsets must match `known_3_3_2.values` in `src/hitlog.zig`; no cross-check warnings.
- Confirm the logged timestamp `0x6AA31B73` and SizeOfImage `0x21396000`.
- Launch with `dumper-disable.txt`: header exists immediately, hooks still install after the
  wait, and no dump is created. Also launch without it: hitlog installs before the normal dump.
- Capture a fight and compare `hits.tsv` column order and value distributions with an archived
  3.3.2 capture (skill IDs, split percentages, elements, hit types, causeStun/heavy, T/H/L/C
  coverage and config pointers); check caller/stack RVAs lie within the logged image size.

Runtime behavior remains unverified until these launches and capture comparisons succeed.

## CNBetaWin3.3.2 -> 3.3.3 (2026-09-22) -- bootstrap done offline, dump pending

The client patched to **CNBetaWin3.3.3** (`version_info`). The offline half of the update is done
and committed on branch `3.3.3`; the rest needs one launch of the patched client.

**What moved.**

| | 3.3.2 | 3.3.3 |
|---|---|---|
| GameAssembly timestamp / SizeOfImage | `0x6AA31B73` / `0x21396000` | `0x6AAC386A` / `0x21591000` |
| UnityPlayer timestamp / SizeOfImage | `0x6AA258FA` / `0x25D6000` | `0x6AAA82C5` / `0x25D4000` |
| il2cpp API table offset in UnityPlayer | `0x1F9A6C8` | **`0x1F9A6C8` -- unchanged** |

**The Unity table did not move, and that is the expensive item.** UnityPlayer shrank by 0x2000 but
the table offset held. Verified three ways: both masked anchor sites (`mov rax,[rip+..] -> table[0]`
and `-> table[2]`) resolve to the same address, and the reference count is identical to 3.3.2 --
24434 `call [rip+..]` sites into 18 distinct slots. `find_unity_table.mjs`'s own phase-2 anchors are
stale (they are the 3.3.0 byte contexts) and reported a bogus candidate; the anchors were re-derived
from the 3.3.2 OLD-line output instead, which is what the tool's own header says to do.

**The 194 RVAs: 112 pinned offline, 82 left to the dump.** `masked_match.py` with a `0x9c90` block
delta gives 77 `DELTA_OK` + 35 `SEARCH_OK`; the remaining 37 `NOT_FOUND` + 45 `AMBIGUOUS` are almost
all 1-8 byte stubs (`ret`, `xor/ret`, `mov/ret`, bare `jmp`) that no byte signature can disambiguate.
Rather than guess them, those 82 slots are set to `0` in `dumper-rvas.zon`, which `validateTable()`
already treats as "must land inside GameAssembly" and *reports the real RVA for*. So the first 3.3.3
run prints all 82 and they can be pinned properly afterwards.

Reading the table straight out of GameAssembly's static data does **not** work -- it is not stored
as a plain relocated qword run -- so the runtime report is the route.

**Code checks: 3 of 7 kept.** Slots 73/75/115/167 sit at still-unpinned slots, so their addresses
are unknown; 73 and 167 also embed per-build obfuscation constants (a `movabs` key and an `xor` key)
and would need re-reading regardless. Of the three kept: 63 is position-independent and survived
verbatim; **65 (RIP-relative) and 152 (rel32) both changed**, exactly as this document predicts.
Restore all seven after the first run.

**`runtime_readiness.zig` re-traced structurally, not by byte-matching.** This is the part the
2026-09-20 startup crash came from, so it was done by structure:

- Thread::Attach is slot 152's `jmp` target: `0x991F90` -> `0x99B9B0`.
- Both builds contain exactly **two** `call Thread::Attach; mov [rip+d],rax` sites, in the same
  order. The second is Runtime::Init's, which publishes the main thread. That gives anchor 1
  (`0x966CEC` -> `0x97094D`) and, from its disp32, `main_thread_rva` (`0x5659780` -> `0x5698000`).
- Anchors 2-4 live in one function that moved by **+0x9C80** (`0x969A50` -> `0x9736D0`), located by
  its 12-byte position-independent core, unique in both builds. Anchor 1 did *not* move by that
  delta, which is why it is found through Thread::Attach rather than a delta guess.
- Anchor 2's only byte change is its stack displacement: `mov rcx,[rbp+0x280]` -> `[rbp+0x1f0]`.
  Same instruction, same semantics, different frame layout. Anchors 3 and 4 are byte-identical.

A caution for the next update: a whole-`.text` byte-similarity comparison at a fixed shift reads
about 7-10% and means nothing, because functions move by *different* amounts. It is not evidence
that the runtime was rebuilt. Match per function, with relative operands masked.

**Everything that cannot self-locate fails closed, deliberately.** `eventlog.zig` keeps its 3.3.2
timestamp/SizeOfImage gate; `timescalelog.zig` and `statelog.zig` pin obfuscated class names that
are re-randomised every build, so their lookups fail; `damage_probe.c` keeps its own PE gate. None
of their version constants were touched, because raising a gate while the target RVAs are stale is
exactly the coincidental-prologue-match hazard described above. They stay off until the dump lands.

**Verified offline:** all 112 pinned RVAs fall inside the image and in `.text`; the three retained
code checks match the 3.3.3 bytes exactly; `zig build -Doptimize=ReleaseFast` succeeds and
`zig test src/runtime_readiness.zig` passes both tests. Note there is no `zig build test` step in
this repo -- tests are per-file.

**Not verified, and cannot be without the client:** that the table validates at runtime, that
hitlog and capture resolve on 3.3.3, and that a fight produces a sane `hits.tsv`.

### Next steps, in order

1. Launch the patched client with this build. `dumper-disable.txt` must be ABSENT -- the dump is
   the point of this run. Expect `Validated CNBetaWin3.3.3` in the thaumiel log.
2. Read the 82 `API[n] unpinned; actual RVA 0x...` notes out of the log and pin them in
   `dumper-rvas.zon`; restore code checks 73/75/115/167 from the new dump.
3. From the new `il2cpp-v7.tsv`: re-derive `timescalelog`'s obfuscated class (tail-`jmp` target of
   the named `PlayTimeSlowUtils::InvokeTimeSlowKey/3`), `statelog`'s pins (`check_pins.py 3.3.3`),
   `eventlog`'s targets, and the four `damage_*` targets and their field offsets. Per the 3.3.2
   update, **every field offset moves** -- this is the slow part, not the addresses.
4. Only then re-enable the probes and re-stage with `Install-DamageProbe.ps1`.

### The four `damage_*` targets on 3.3.3 (2026-09-22)

All four located, each by two independent methods. **Byte matching does not work on these** — they
live in the `il2cpp` section (generated code), which is re-emitted per build rather than relocated;
`masked_match.py` found 1 of 4. What works is *instruction shape*: the mnemonic sequence survives
re-emission, which is the same technique the 3.3.2 update used on the hit-result factory ("same
shape, 1410 vs 1409 instructions, 99.5%"). `scratchpad/shapematch.py` ranks candidates by
`difflib` ratio over mnemonics.

| Probe | 3.3.2 | 3.3.3 | Evidence |
|---|---|---|---|
| result converter (`damage_result.c`) | `0x1ace5c70` `PLPNKFLOLON::FFDOPOENLNO` | **`0x1a495bf0`** `NJCELHGICGI::EBFKHCOHMDO` | only method in the WHOLE dump with signature `Boolean(#OBF, Entity, Entity, #OBF, #OBF, #OBF&)`, plus 100% shape over 324 instructions |
| result factory (`damage_snapshot.c`) | `0x133c7bf0` `GOOCOICILAJ::KAFEKGEDAAI` | **`0x1b64a750`** in `GFNGNPNAJHE` | class matched structurally, 99.83% shape over 1196 instructions, AND independently found by `masked_match.py` |
| Daze gauge (`damage_daze.c`) | `0x1a4f76a0` `GILABPBBMJH::JKAJPLNGPEK` | **`0x136ae770`** in `CDANMPBMFIJ` | class matched, 100% shape over 501 instructions, 56-point gap to runner-up |
| Anomaly gauge (`damage_anomaly.c`) | `0x19235b40` `PNNLDJHFOAO::BAIEOPOHGNL` | **`0x1962ec60`** `GJCMIEECHCL::KHCLFLDGFJL` | class matched, 100% shape over 52 instructions, 49-point gap |

**Method-level pitfalls, both hit for real:**

- `classmatch.py` matches the CLASS; it does not tell you which method. Filtering candidate methods
  by `(arity, return type, param types)` **failed on the Daze target** and produced a best match of
  33% with a 0.3-point gap — i.e. confidently wrong-looking. Shape-matching against **every** method
  of the matched class instead found it at 100%. Prefer the unfiltered sweep; the classes are small
  enough (42-101 methods) that it costs nothing.
- `METHOD_FLAGS` is **`0x0` for every method in the first 3.3.3 dump** — a real bug, now fixed:
  `MethodInfo.flags` moved `+0x30` -> `+0x2c` (back to the 3.3.0 offset). Re-derive it per build by
  disassembling `runtime_invoke` (API slot 138; 3.3.3 `0x9140E0`, 3.3.2 `0x90A440`), which is
  byte-identical up to its `test byte ptr [rdi+disp], 0x10`. A wrong value here is **silent** — every
  flags row reads 0 instead of failing, so do not use flags from a dump taken before this fix.
- `dumpq.py rva` names the class correctly, but the 3.3.2 comment in `damage_result.c` calls the
  converter's class `AGLNJHOEMAL`, which is a stale 3.3.0 name. The 3.3.2 class is `PLPNKFLOLON` —
  and it is not a "converter host" at all, it is the RESULT STRUCT itself (27 fields, a 27-arity
  constructor, and this static converter that takes it as a byref out-param). That is why a
  structural class match for it found nothing useful, and why the global signature search is the
  right tool for this one.

**Field offsets.** `scratchpad/offsetdiff.py` pairs two shape-identical functions instruction by
instruction; since the mnemonics align 1:1, any changed memory displacement is a moved field, and
everything else (rip-relative data refs, call targets, jump targets) is relocation noise. On the
anomaly gauge it isolates exactly one real change:

- `ctx+0x30` (result pointer) -> **`ctx+0x20`**.

The remaining per-probe offsets (`this+0x6c` cur, `this+0x70` element, `this+0x8c` max for anomaly;
the Daze pair; and the whole `damage_result` field map) are read by the PROBE rather than by the
hooked function, so they do not appear in this diff and must come from the class layouts. That is
the bulk of the remaining work, and it is the part the 3.3.2 retrospective called the real cost.

### 3.3.3 field offsets for the damage probes — confirmed, and what is not

**Method.** `findref.py` (which 3.3.2 methods of a class touch a given displacement) ->
`shapematch.py` (locate that method in 3.3.3) -> `offsetdiff2.py` (align the two by mnemonic
sequence with difflib and report displacement changes inside EQUAL blocks only). A change found
this way is code evidence, not inference.

**Do not infer these from class layouts.** The result object has **156 fields, 53 of them
`System.Single`**, and by-index type agreement between builds is 26/156. For the one offset where
ground truth exists (`0x18c`, proven `-> 0xd4` by a 100%-aligned function diff), layout alignment
guessed `0x18e, System.Boolean` — wrong type, wrong field. Positional and type-based inference are
both useless on this class.

#### Confirmed (witness functions aligned 100%, change observed in code)

| Probe | Field | 3.3.2 | 3.3.3 |
|---|---|---|---|
| anomaly | `cur_before` (this+) | `0x6c` | **`0x7c`** |
| anomaly | `max` (this+) | `0x8c` | **`0x80`** |
| anomaly | `element` (this+) | `0x70` | **`0x68`** |
| daze | `cur_before` (this+) | `0xd4` | **`0xb0`** |
| daze | `target_value` (this+) | `0xb0` | **`0xb8`** |
| daze | `applied_daze` (result+) | `0x18c` | **`0xd4`** |
| both | `result_ptr` (ctx+) | `0x30` | **`0x20`** |

`element` is confirmed twice over: the code diff, and being the only `DamageElementType` field in
the 3.3.3 class. `result_ptr` is confirmed twice: once from each probe's own witness.

**A trap in the daze pair.** `0xb0` exists in both builds and means different things — `target_value`
in 3.3.2, `cur_before` in 3.3.3. Carrying the old constant over reads the wrong gauge and never
errors. This is the concrete reason field offsets must come from code rather than from "the offset
still exists, so it is probably still right".

#### NOT confirmed — do not pin these yet

- `result+0x174` (attacker PEN Ratio) -> possibly `0x1c4`, from a witness that aligned only **57%**
  (240 vs 249 instructions). The witness looks like an initializer full of `mov [rsi+X], 0`, where an
  equal-mnemonic run can pair unrelated field writes. Needs a second, better-aligned witness.
- `result+0xf8` (buildup requested), `result+0x150` (buildup applied), `result+0x11c` (DEF),
  `result+0x144` and `result+0x23c` (the snapshot join pair): no witness found yet whose alignment is
  good enough to trust. These are the remaining bulk of `damage_result.c`'s map.

#### Tooling bug found and fixed (2026-09-22)

`findref.py` originally ran to the first `ret`, but an il2cpp function commonly ends in a tail `jmp`
followed by `int3` padding. It therefore ran on into the NEXT function(s) and attributed THEIR field
references to the method being examined -- one candidate "276-instruction" method is really 35
instructions, and its apparent `0xf8`/`0x150` references belonged to a neighbour. Both readers now
stop at `int3` after >8 instructions, as `shapematch.py` already did. The disagreement between the
two tools' instruction counts is what exposed it; keep them cross-checking each other.

## CNBetaWin3.3.3 -> 3.3.4 (2026-09-25) -- bootstrap done offline, dump pending

The client patched to **CNBetaWin3.3.4** (`version_info`; hdiff files preserved on the game machine as
`zzz_3.3.3_3.3.4_hdiff.tar`). Same method as the 3.3.3 update above; work is on branch `3.3.4`
(created from `3.3.3`, with upstream's `Update resources to version CNBetaWin3.3.4` merged FIRST,
per the standing rule -- the login/redirect `assets/offsets.zon` must match the client or it loads
but never connects).

**What moved.**

| | 3.3.3 | 3.3.4 |
|---|---|---|
| GameAssembly timestamp / SizeOfImage | `0x6AAC386A` / `0x21591000` | `0x6AB435F6` / `0x21714000` |
| UnityPlayer timestamp / SizeOfImage | `0x6AAA82C5` / `0x25D4000` | `0x6AB23074` / `0x25DF000` |
| il2cpp API table offset in UnityPlayer | `0x1F9A6C8` | **`0x1F9B6C8` -- moved +0x1000** |
| MethodInfo.flags | `+0x2c` | **`+0x2e`** |
| runtime_invoke (API slot 138) | `0x9140E0` | `0x927B30` |

**The Unity table MOVED this time** (first move since 3.3.2). `find_unity_table.mjs`'s phase-2
anchors were re-derived from the 3.3.3 OLD-line output and updated IN THE TOOL this time (the
mov's own address = the printed disp@ address minus 3). Both anchors agree on `0x1F9B6C8` and the
reference count is identical to 3.3.3: 24434 `call [rip+..]` sites into 18 distinct slots.

**The 194 RVAs: 106 pinned offline, 88 left to the dump.** `masked_match.py` twice: block delta
`0x13a60` (52 DELTA_OK + 40 SEARCH_OK) plus a delta-0 pass whose 13 extra matches are the CRT
stubs that did not move at all. Outputs in
`sheet-webapp/local-data/client-update-334-rva-match{,-d0}.tsv`. The rest are `0` in
`dumper-rvas.zon` for `validateTable()` to report on the first run, exactly as before. Slot 138
was NOT matched by the batch job but was pinned separately (see next).

**MethodInfo.flags moved again, `+0x2c` -> `+0x2e` -- caught OFFLINE this time.** The 3.3.3 trap
list says a wrong value here reads all-zero flags silently. runtime_invoke was found by masked
prefix match (its first 0x44 bytes up to the flags `test`, rel32/RIP operands wildcarded --
NOT byte-identical across builds this time, 5 bytes differ): unique hit at `0x927B30`, and the
test instruction there reads `f6 47 2e 10`. Do not trust a plain byte search for this function
on future builds.

**Code checks: 3 of 7 kept** (63 verbatim -- position-independent; 65 RIP-relative and 152 rel32
re-read from the 3.3.4 binary at their matched RVAs). 73/75/115/167 sit at unpinned slots and are
dropped until the first run reports them. Restore all seven afterwards.

**`runtime_readiness.zig` re-traced structurally, self-checked against 3.3.3 first** (the method
reproduced every known 3.3.3 value from the archived binary before being trusted on 3.3.4):
Thread::Attach = slot 152's jmp target (`0x99B9B0` -> `0x9AF460`); two `call Attach; mov
[rip+d],rax` sites in the same order, the second (Runtime::Init) at `0x98442C` giving
`main_thread_rva 0x56DCBC0`; anchors 2-4 at `0x987180`/`+0x38`/`+0x56`, with anchor 2's rbp
displacement `0x1f0` -> `0x280` (back to the 3.3.2 frame layout) and 3/4 byte-identical.

**Everything that cannot self-locate fails closed, untouched:** `eventlog` (PE gate ->
ClientMismatch), `statelog`/`timescalelog` (obfuscated class names + RVA pin equality + prologue,
all three gates), `damage_probe.c` (PE gate -> status -2). Their 3.3.3 pins are stale by design
until the new dump lands.

**Verified offline:** all 106 pins fall inside 3.3.4's `.text`; ReleaseFast builds;
`runtime_readiness` (2/2) and `detour_test` (5/5) pass. Deployed to the game machine 2026-09-25 as
`thaumiel.dll` SHA256 `783be3b3...` (previous 3.3.3 DLL kept as `thaumiel-333-full-092ac6b9.dll`);
`dumper-disable.txt` absent so the first launch writes the dump.

### Next steps, in order (mirror of the 3.3.3 list)

1. Launch the patched client. Expect `Validated CNBetaWin3.3.4` (or a full mismatch report).
2. Pin the 88 `API[n] unpinned; actual RVA 0x...` notes (and any corrections) in
   `dumper-rvas.zon`; restore code checks 73/75/115/167 from the new binary's bytes.
3. From the new `il2cpp-v7.tsv`: re-derive statelog/eventlog/timescalelog pins and the four
   `damage_*` targets + field offsets (shapematch, not byte match, for il2cpp-section targets;
   every field offset moves -- that is the slow part).
4. Only then re-enable the probes' PE gates and re-stage.

### 3.3.4 hooks and probes re-pointed offline (2026-09-25, same session)

After the first launch's table report was pinned, the ENTIRE hook/probe re-derivation ran
offline against the fresh dump, adapting `client-update-333/trace-hooks.py` (now in
`client-update-334/`). Every class matched structurally with ONE candidate; every method
shape-matched 0.997-1.0 with a large gap; `property_set`'s identical 54-instruction sibling was
disambiguated by caller count (173 vs 9, the same split as 3.3.3) plus the stun-mixin-caller
witness. Field offsets came only from same-width rows on the correct object register, or from
type-unique class matches -- the register-blind and zero-store-block pairings were each caught
producing wrong answers again this build (config-name row masquerading as flags; a daze-handler
rdx row masquerading as the mixin entity).

Notables: MethodInfo.flags moved AGAIN (+0x2c -> +0x2e, caught offline); the result object
grew (last instance field +0x284 -> +0x2a0, raw dump now 0x2b0); the a8 name object moved
result+0x50 -> +0x80 and its first string slot 0x10 -> 0x18; the attenuation string is now the
THIRD sorted string slot (decoder reads it via the new per-layout `attn_col`); duration and
stacking swapped places in the modifier config; the converter, factory and string-probe
fingerprints are all byte-identical to 3.3.3.

Honest nulls in the 3.3.4 decoder layout, to be measured from the first capture exactly as
3.3.3 did: `daze_requested`, `target_state`, and the a8 slot-semantics check. The ctx
attacker-id slot (+0x48 in 3.3.3) is also unverified.

Offline gates all pass: build, 8 native C probe tests, detour (5), readiness (2), decoder-333
regression, attribution, inspect-probe. Live completion gate: one battle with a Stun and an
Ultimate; then all five probe statuses 1, nonempty state/event/timescale logs, gauge join
checks, StunBuffModifier windows, and a settlement comparison.

### 3.3.4 live validation (2026-09-25, capture 20260925-192126, battle-1)

One battle (Severian/Azural/Summer + Luckyboo, ~4 min, two Stuns, Ultimates): all five probes
install (`string/result/snapshot/daze/anomaly = 1`), all seven state hooks + animator-event +
time-scale hooks install, and every log fills. Daze joins 2002/2002 and anomaly 1540/1540, all
float-verified; snapshots 548/611 paired on ATK equality (the usual ratio); `stun-log` prints
two complete windows with Starts/Resets/Ends and skill attribution; the time-scale integral
matches the game's own world_s delta to 0.4 s over 237 s.

Post-capture measurements (scripts in `client-update-334/`): `daze_requested = 0x17c` (840/840,
MaxStun-clamp ordering vs applied 0x240); the a8 slot mapping confirmed by decoded kit names;
`EFFECT_OFFSETS["CNBetaWin3.3.4"] = [0x18, 0x40]` (each resolves 1098 rows, all unique -- 0x38
like 0x30/0x10 is a shared-pointer poison field, 0x58 nets ambiguity). `target_state` does NOT
exist in the 3.3.4 result dump (value-agnostic byte/int sweep vs the StunBuffModifier windows
found nothing above 0.9 precision / 0.8 recall); it stays null, which only affects pre-2026-09-22
legacy window derivation -- state.tsv is the authoritative source.

Settlement check vs endbattle_1.pb: **34 exact skill totals**, three within 5 damage on
multi-million totals (the 3.3.3-class rounding residue), one mismatch = the Bangboo (53002,
288k), whose hits stay in the skill-0 residual (4.69M) -- the known attribution limitation.
The 3.3.4 update is COMPLETE.
