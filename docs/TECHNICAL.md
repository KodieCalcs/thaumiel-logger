# Technical reference

For people building, verifying or updating the combat logger. Players only need the
[README](../README.md).

This fork adds **in-process observation hooks** to [thaumiel](https://git.xeondev.com/remielle/thaumiel)
(upstream's own README is kept as [README.upstream.md](../README.upstream.md)): a per-hit log, a
runtime il2cpp metadata dump, and damage probes that record what the game's own damage code
computed for every hit. Nothing here changes gameplay or the numbers the game produces; every hook
is read-only and writes TSV files into the battle folders described under "Capture layout".

Every hook is pinned to one client build. `src/logger_client.zig` holds that build's identity and
is checked before any logger module starts: on any other client the logger starts nothing and the
DLL behaves exactly like upstream thaumiel (this is what lets `.github/workflows/follow-upstream.yml`
ship upstream's patch for a new client before the logger is updated; see
[MAINTAINING.md](MAINTAINING.md)). The per-module pins below remain as a second line of defence.

**`assets/offsets.zon` is what redirects the client to the private server** (login, SDK, RSA keys,
crypto strings). It comes from upstream and is client-version-pinned like everything else: a build
carrying the previous version's offsets loads but cannot connect. When the client patches, merge
upstream *first*.

## What it captures

| Module | Output (in the battle folder; `il2cpp-v7.*` in the session folder) | Hook | What you get |
|---|---|---|---|
| `src/hitlog.zig`, `src/hit_hook.c` | `hits.tsv` | `ConfigEntityAnimEvent::TriggerAttackPattern` + the three leaf handlers that bypass it | one row per **animation-driven hit**: elapsed ms, skill id, per-hit damage/Daze/buildup/Energy split fractions, element, hit type, `causeStun`/`heavy` flags |
| `src/dumper.zig`, `src/dumper-rvas.zon`, `src/dumper_guard.c` | `il2cpp-v7.tsv`, `il2cpp-v7.log` | none — walks the il2cpp API 25 s after launch | every class, field offset and method RVA the runtime knows (~95 k classes, ~50 MB). The map everything else is found with |
| `src/damage_probe.{c,S}` (string, numeric, event, enqueue probes) | `damage-probe-*.tsv`, `damage-numeric-*.tsv`, `damage-event-*.tsv`, `damage-enqueue-*.tsv` | the damage-text UI path | the discovery trail that led to the result converter; still built, rarely needed now |
| `src/damage_result.c` (schema 5) | `damage-result-*.tsv` | the hit-result converter `0x1823a830` | **per hit: final damage, crit, Daze applied to the target's gauge (and the pre-clamp requested Daze), attacker/target, target state (3 = Stunned), ATK/Impact/AM/AP at the hit, the named-modifier dictionary, ability and AttackProperty name**. Reconciles exactly against the settlement's per-skill totals |
| `src/damage_snapshot.c` (schema 1) | `damage-snapshot-*.tsv` | the hit-result factory `0x16fa7460` | the attacker stat snapshot for the **bullet/summon path** only (CRIT Rate, CRIT DMG, DMG bonus, …) |
| `src/damage_anomaly.c` (schema 1) | `damage-anomaly-*.tsv` | the target's per-element anomaly gauge receiving a hit `0x19235b40` | the **Anomaly Buildup gauge** at every hit: cur and max per element, joined to the result row by result pointer (248/248 verified on 2026-09-18; requested/applied buildup are `result+0xf8`/`+0x150`, already in the result probe: `per-hit-log.csv` `buildup_requested` / `buildup_applied`); gauge max per element and its growth per trigger fall out (`anomaly-log.csv`) |
| `src/damage_daze.c` (schema 1) | `damage-daze-*.tsv` | the target's stun-component be-hit handler `0x1a4f76a0` | the **Daze gauge** at every hit: CurStun before the hit and the requested new value, joined to the result row by result pointer (2068/2068 verified on 2026-09-18); MaxStun falls out at each stun onset (`daze-log.csv`, matches the settlement's enemy field 11) and the per-hit **distance attenuation** factor falls out of the pair (`per-hit-log.csv` `attenuation_curve` / `attenuation`) |
| `src/eventlog.zig`, `src/event_hook.c` | `events.tsv` | the anim-event system's per-frame queue drain | every `AnimatorEvent` fired on every entity, with the state-entered tag; joins `hits.tsv` on `owner` = `arg2` (`tools/events-timeline.mjs`) |
| `src/capture.zig`, `src/battle_hook.c` | the folders themselves | `MoleMole.BattleStatsSubsystem::OnAwake` / `::OnDestroy` (named, resolved at runtime) | one folder per battle and a clock that starts at the battle's awake; see "Capture layout" |
| `src/sampler.zig` | `sampler.csv` | none — sampling profiler | disabled (`if (false)`); wrong instrument for hit discovery, kept for profiling questions |

The result probe is the production path: `node tools/per-hit-log.mjs <capture-dir>` joins it to
the settlement `.pb`, names every hit through `tools/attack-property-skill-map.json`, and writes
`per-hit-log.csv` + `settlement-check.json`; `node tools/readable-log.mjs <capture-dir>` makes a
shareable CSV.

Not captured: the attacker snapshot for anim-event hits (they go through a sibling factory that
reads properties through an accessor — traced, not hooked). Daze per hit *is* captured — it was in
the result all along (`per-hit-log.csv` columns `daze` / `daze_requested`, formerly mislabelled
`buildup_est`; see `docs/damage-probe-howto.md`, "Per-hit Daze"). The stun-widget hook that was
tried earlier is recorded there as a ruled-out lead.

The damage probes are **on by default** (since 2026-09-28; they were opt-in before) and
`damage-probe-disable.txt` in the launch directory turns them off. The hit log always runs. The
il2cpp dump is **opt-in**: it is written only when `dumper-enable.txt` exists in the launch
directory (the name lookups the hooks need run either way). `logger-disable.txt` in the launch
directory turns the whole logger off, exactly as an unsupported client does (`logger_client.zig`),
so the game can be compared with and without it on the same DLL.
Each probe writes its install status to `damage-probe-status.txt` (`string numeric event enqueue
result snapshot daze anomaly`): 0 disabled, 1 installed, 2 installed but protection restoration failed (stop the
test); -1 missing module, -2 wrong PE identity, -3 wrong code fingerprint, -4 allocation/protection
failure, -5 output creation failure, -6 duplicate installation, -7 prerequisite (string probe) not
installed. Everything after `string` is only attempted when `string` is 1.

## Capture layout

```text
Combat Logs\                               beside the launcher (names: src/capture_names.zig)
  logger status.txt                        logger ON/OFF for this client, summaries on/off, in plain words
  READ ME.txt                              the player explanation (packaging/READ ME.txt)
  2026-09-28\                              one folder per day (local time)
    Battle 7\                              SETTLED battles, named after the server's endbattle_7.pb
      combat-log.xlsx, combat-log.json     tools/summarize.mjs (workbook: tools/xlsx.mjs), run by the DLL when the battle ends
      hits.tsv events.tsv state.tsv timescale.tsv damage-*-<stamp>-<pid>.tsv    HIDDEN (attribute)
  .diagnostics\                            hidden
    <launch date time>\                    hitlog-startup.log, damage-probe-status.txt, il2cpp-v7.*
      lobby\                               launch -> first battle (lobby; header-only files, usually)
      battle <k>\                          the k-th battle of the launch until the summarizer finds
                                           its settlement; stays here (no-settlement.txt) if the
                                           server wrote none (pruned 7 days after its last write)
      after battle <k>\                    result screen and lobby after battle k
    summarize.log                          one line per summarized battle
  .tools\                                  hidden: summarize.mjs, the readers, node\node.exe, LICENSE
```

The raw files are hidden rather than moved so every reader keeps taking a battle folder by path
(hidden files read normally). Captures made before 2026-09-28 use
`captures\<UTC stamp>-<pid>\battle-<n>\`; the readers do not care which.

`src/capture.zig` hooks `MoleMole.BattleStatsSubsystem::OnAwake` and `::OnDestroy` — the per-game
subsystem (a `GameSubsystemBase`, created with the level and destroyed with it) that collects the
settlement report. Both are resolved by name through the il2cpp metadata like the hit hooks. On
awake every log rotates into `.diagnostics\<launch>\battle <k>\` and the shared `elapsed_ms`
origin resets (so every file in a folder reads as time since that battle awoke; the first hit lands
~1.7 s in). On destroy every log rotates on into `after battle <k>\`, which closes the battle's
files, hides them, writes `battle.txt` (the battle's start and end, Unix ms, and its hit count), and
`Combat Logs\.tools\summarize.mjs --pending` starts in the background (bundled `node.exe`, else
`node` on PATH; no window, below-normal priority), one run at a time (`.tools\summarize.lock`).
It looks in the server's logs folder (`.tools\server-logs.txt`, set by install.ps1, relative to
the game folder) for the settlement the battlestats Remielle wrote while the battle ran
(`endbattle_<n>.pb` with an mtime between start - 2 s and end + 20 s, waiting up to 20 s for it).
Found: the battle moves to `Combat Logs\<day>\Battle <n>\` (`Battle <n> (2)` if a server restart
reused the number that day), the settlement and `endbattle_<n>_loadout.json` are copied in
(hidden), and it is summarized from a temporary copy of the raw files, so the readers'
intermediate files never land in the battle folder; `combat-log.json` and the workbook's
Breakdown tab carry the settlement cross-check. Not found: `no-settlement.txt`, and it stays in diagnostics. With no server folder
configured every battle with a hit is published, numbered through the day. The server's counter
is in memory, so a server restart starts again at `endbattle_1` and overwrites the old file;
matching by time and copying the file in at once is what keeps each battle's settlement. A battle
folder holds exactly awake -> destroy; the result screen and lobby rows are in
`after battle <k>\`. If the hooks do not install (logged as
`capture` in `hitlog-startup.log`), everything stays in the diagnostics `lobby\` folder.

To archive a battle: copy its battle folder (hidden files included) as the capture directory, drop
the server's `endbattle_<N>.pb` + loadout into it (match by time), and run the readers on it as
they are: `node tools/per-hit-log.mjs <dir>`, `node tools/readable-log.mjs <dir>`, or
`node tools/summarize.mjs <dir>`.

## Version contract — one client build

The restored state/event/time-scale hooks are ready for a live test; see
[the current evidence and test gate](hooks-333-validation.md). Historical numeric/event/
enqueue discovery probes remain disabled. The earlier capture tables above retain historical
addresses; this version contract and the source pins are current.

Everything address-shaped is pinned to one client build and **fails closed** on any other:

| Pin | Where | Check at startup |
|---|---|---|
| Client `CNBetaWin3.3.3`: `GameAssembly.dll` PE timestamp **`0x6AAC386A`** + `SizeOfImage` `0x21591000` | `src/damage_probe.c` (both), `src/hitlog.zig` (both), `src/dumper.zig` (`SizeOfImage`) | exact match or refuse |
| il2cpp API table at `UnityPlayer.dll + 0x1F9A6C8`, 194 entries | `src/dumper.zig`, `src/dumper-rvas.zon` | every entry's RVA re-verified (all mismatches reported before refusing), plus seven code-byte checks |
| `TriggerAttackPattern` and leaf handlers resolved by name | `src/hitlog.zig` | verified dumper API table and prologue checks |
| result `0x1a495bf0`, snapshot `0x1b64a750`, Daze `0x136ae770`, Anomaly `0x1962ec60`, UI string `0x149c6e90` | `src/damage_*.c` | 64-byte fingerprint + prologue compare before any byte is written |

When the client patches, read `docs/client-update-playbook.md` first: it lists what moves, the order
to re-find it in, which checks are guards rather than guarantees, and — from the 3.3.0 → 3.3.2
update — the procedure and tooling (`tools/update/`) that re-derives every pin. Note that the client
shuffles **every class layout** per build, so every field offset in `hitlog.zig`, `damage_*.c` and
`tools/per-hit-log.mjs` moves too, not just the addresses.

## Build and test

Requirements: Zig **0.16.0** (upstream's requirement; `zig-x86_64-windows-0.16.0`), Node ≥ 18 for
the readers, Python 3.12 + `capstone` for the discovery scripts.

```text
zig build -Doptimize=ReleaseFast --global-cache-dir .zig-global-cache
zig build test                                   # version gate + folder names, no game needed
powershell -File packaging\make-release.ps1      # the player zip, in dist\ (what CI publishes)
```

`ReleaseFast`, not upstream's `ReleaseSmall` — `ReleaseSmall` makes the dumper's `std.mem.indexOf`
crawl. Output: `zig-out/bin/remielle.exe` (launcher) and `zig-out/bin/thaumiel.dll`.

Native tests (standalone executables, no game needed; set `ZIG_GLOBAL_CACHE_DIR` to
`.zig-global-cache` if the system cache is unwritable):

```text
zig cc -O2 src/damage_probe_test.c src/damage_probe.S -o damage-probe-test.exe
zig cc -O2 src/damage_probe_record_test.c  -o damage-probe-record-test.exe
zig cc -O2 src/damage_probe_install_test.c -o damage-probe-install-test.exe
zig cc -O2 src/damage_probe_rotate_test.c  -o damage-probe-rotate-test.exe
zig cc -O2 src/damage_result_test.c        -o damage-result-test.exe
zig cc -O2 src/damage_snapshot_test.c      -o damage-snapshot-test.exe
zig cc -O2 src/damage_daze_test.c          -o damage-daze-test.exe
zig cc -O2 src/damage_anomaly_test.c       -o damage-anomaly-test.exe
```

The state log's installer has a Zig test instead (it patches real functions built in RWX memory,
so no game is needed either):

```text
zig test src/detour_test.zig
```

Run all seven; each prints `PASS …`. They exercise the assembly bridge (10,000 calls through each of
the eight bridges with mixed integer/float arguments and relocated prologues), the recorders (real
file output, unreadable pointers, LastError preservation, lock contention) and the installers
(identity gates, wrong-fingerprint refusal leaves the target untouched, duplicate refusal).

Then confirm the DLL carries the expected header strings and nothing stale — Zig's cache does
**not** track the `#include "damage_*.c"` files, so after editing one of them touch the include
line in `src/damage_probe.c` and check the DLL, not just the build log:

```text
grep -c -a "schema=5 client=CNBetaWin3.3.2 target_rva=0x1ace5c70" zig-out/bin/thaumiel.dll   # 1
grep -c -a "schema=1 client=CNBetaWin3.3.2 target_rva=0x133c7bf0" zig-out/bin/thaumiel.dll   # 1
grep -c -a "schema=1 client=CNBetaWin3.3.2 target_rva=0x1a4f76a0" zig-out/bin/thaumiel.dll   # 1
grep -c -a "schema=1 client=CNBetaWin3.3.2 target_rva=0x19235b40" zig-out/bin/thaumiel.dll   # 1
grep -c -a "UIStunDamageWidgetController" zig-out/bin/thaumiel.dll                            # 0
```

Offline tool tests: `node tools/test-inspect-damage-probe.mjs`, `python tools/test-export-result-properties.py`.

Current build (2026-09-18, Anomaly Buildup gauge probe added): `thaumiel.dll` SHA256
`0BFEA958781416E81C49B2DD01D03787DF224A37F1A172E1870D619E46F2F3D2` (1,083,904 bytes), staged on the laptop as
`thaumiel.dll` 2026-09-18 (hash verified over the share; the Daze build it replaced is kept beside it as
`thaumiel-daze-6ab92fae.dll`), run and verified the same day (capture `20260918-233801-anomaly`,
howto's last section). Archive: `local-data/tools/damage-probe/build-20260918-anomaly/`.
Previous build `6AB92F…` (Daze gauge probe, verified on capture `20260918-181913-daze`) is
archived at `local-data/tools/damage-probe/build-20260918-daze/`. Since the capture-layout build
(2026-09-20) nothing is recreated on launch: each launch writes its own `captures\<session>\`.

## Deploying a test build to a game machine (maintainers)

`packaging\install.ps1 -GameFolder <client dir> [-SkipBuild]` (what `install.cmd` runs) works on
a network path too: it refuses while the game has `thaumiel.dll` open, copies the build, and
installs the tools and Node into `Combat Logs\.tools\`. Verify with the DLL's SHA256 over the share
if in doubt. After a fight, `Combat Logs\.diagnostics\<launch>\damage-probe-status.txt` shows the
probe statuses and the battle folder is the capture directory.

The older staging routine (`damage-probe-ready.dll` + `tools/Install-DamageProbe.ps1` +
`tools/START DAMAGE TEST.cmd`) still works but overwrites `thaumiel.dll` with whatever DLL was
staged beside it, and leaves a backup folder per run; prefer `install.ps1`.

## Bring your own client and il2cpp dump

This repo contains **no game data**. The tools expect it under a gitignored `local-data/` directory
(a junction to wherever you keep it is fine), laid out as the scripts were written against:

| Path (relative to the repo root) | What |
|---|---|
| `local-data/client-binaries-CNBetaWin3.3.2/GameAssembly.dll` (and `-3.3.0/`, the previous build, needed by `tools/update/` as the old side) | the saved client binary the fingerprints were taken from (used by `tools/discovery/callers.mjs`, `scan-writers2.mjs`, `disasm.py`, `tools/unwind-event-stack.mjs`) |
| `local-data/crash-analysis/GameAssembly.dll`, `UnityPlayer.dll`, `*.dmp` | binaries + minidumps used by `tools/discovery/native.py`, `disassemble.py`, `read-*.cjs`, `scan-unity.cjs` and `tools/find-table.cjs` |
| `local-data/crash-analysis/il2cpp-v6.tsv` | the runtime dump the dumper produced (v6/v7 are the same enumeration) — `native.py`, `claude-analysis.cjs`, `combat-*.cjs`, `find-hit-results.cjs` |
| `local-data/damage-probe-captures/<stamp>/` | one directory per capture: `hits.tsv`, `damage-*.tsv`, `endbattle_*.pb`, loadout |

To bootstrap on a fresh client: run the dumper first (it is the only thing that has to be re-found
by hand — the table offset inside `UnityPlayer.dll`), then every other hook is a grep in the new
dump plus a constant edit, as the playbook describes. `docs/per-hit-logger-howto.md` is the
step-ordered account of how each piece was found; `tools/discovery/` holds the scripts it names.

## What must never be committed

`.gitignore` blocks most of it, but the rule is the point:

- **Captures** — `hits.tsv`, `damage-*.tsv`, `il2cpp-*.tsv`, `sampler.csv`, `per-hit-log.csv`,
  `endbattle_*.pb`, packet dumps. They carry account ids and are large.
- **Loadouts** and any other player/account data from the server or the client.
- **il2cpp dumps, disassembly traces and minidumps** (`*.dmp`, `fn-*.txt`, `*-disassembly.txt`).
- **Client binaries** — `GameAssembly.dll`, `UnityPlayer.dll`, the game exe, hdiff patches, and
  any slice of them (`GameAssembly-first14MB.dll`).
- **Built artifacts** — `*.dll`, `*.exe`, `*.pdb`, `zig-out/`, caches.
- **Keys** — nothing under `assets/` beyond what upstream ships (`server_public_key.xml`,
  `sdk_public_key.xml` are upstream's own); never a private key, never a key for a server you
  do not operate.

If a script needs one of these, it reads it from `local-data/` at run time.

## Layout

```text
src/             upstream launcher/patcher + the modules above (see the table); capture.zig owns
                 the Combat Logs\<launch>\Battle <n>\ layout and the battle hooks
tools/           offline readers, review scripts, installer, launcher .cmd, skill map, patches
tools/discovery/ disassembly / xref / dump-query scripts used to find the hooks (need local-data/)
docs/            damage-probe-howto (chronological attempt record), per-hit-logger-howto
                 (step-ordered procedure), client-update-playbook, action-start-hook-plan
DUMPER-V6.md     dumper operating notes and verified API indices
```

## License

Upstream thaumiel is licensed under the **GNU Affero General Public License v3** (`LICENSE`), and so
is this fork as a whole. The modified upstream files (`build.zig`, `src/dynlib.zig`) carry a
modification notice as AGPL §5(a) requires; the added files are original work released under the
same license. Anyone who receives a built `thaumiel.dll` from this repo is entitled to this source.
No warranty, expressed or implied.
