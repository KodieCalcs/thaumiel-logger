# Startup crash fix, 2026-09-20

The `D39DE5F8...` ReleaseFast build from commit `e16c335` introduced a 50 ms
readiness poll to replace a fixed 25 s wait. Runtime lookup of hitlog methods and
fields had already worked in the preceding Debug build `2C70860F...`; the new
readiness poll was not verified live before staging. Do not infer the API table's
semantics from stock IL2CPP slot ordering.

## Confirmed failure

CNBetaWin3.3.2 API slot 154, RVA `0x90a780`, is exactly
`48 89 0d e9 e4 d4 04 c3`: it stores RCX at `GameAssembly+0x5658c70` and returns.
It does not enumerate threads. Passing `&count` registered a pointer into the
worker's stack as a callback. SEH cannot undo this successful write.

Both game-machine crash dumps prove causality:

| PID | Exception RIP | Value at callback global |
| --- | --- | --- |
| 19192 | `0xf2684fd468` | `0xf2684fd468` |
| 28504 | `0x25cfffd0f8` | `0x25cfffd0f8` |

Both exceptions are `0xc0000005`; the return address is GameAssembly RVA
`0x97830d`. Dumps and the analysis helper are preserved in the sibling
sheet-webapp repo's `local-data/crash-analysis/20260920-startup/`.

## Corrected readiness check

`src/runtime_readiness.zig` performs only ReadProcessMemory reads. No API call,
exception-based polling, callback registration, or fixed startup delay occurs.
The worker retains its 50 ms poll interval and 180 s failure timeout.

The client binary supplies the ordering and offsets:

- Runtime::Init at `0x9620e0` is reached from API slot 0 at `0x908e10`.
- `0x966cec` calls Thread::Attach (`0x991f90`, also the verified slot-152 target).
  The following store publishes the returned main thread at `0x5659780`.
- Late in Init, `0x969a50..0x969a6b` initializes the domain context and publishes
  it at domain+0x10. `0x969a88` loads the current thread's internal object at +0x10;
  `0x969aa6` stores that context at internal+0x70.
- Wait for main thread, internal object, and context to be nonnull. This proves
  attachment and domain-context initialization, not that every later startup
  operation has finished. IL2CPP metadata lookups retain their normal locking.
- Validate all four code anchors after the existing PE/API table checks. Any
  changed anchor disables hitlog/dumping with `ReadinessCodeMismatch`, rather
  than reading assumed offsets. A patched client requires re-tracing these
  anchors as part of the bootstrap update.

## Validation and deployment

- Readiness tests pass in Debug and ReleaseFast: cold state, main-thread-only,
  internal-object-only, context-ready, unreadable memory, and code mismatch.
- `python tools/test-readiness-client.py <GameAssembly.dll>` verifies all anchors,
  the attachment target/publication address and the slot-154 negative control
  against the real saved CNBetaWin3.3.2 binary.
- ReleaseFast DLL build passes. All seven native probe test executables pass,
  including 10,000 calls through each of the eight assembly bridges.
- Corrected DLL SHA256:
  `9888510EACB84CC2220A9D000F60F69961D13AC5DCEC94256A9CB55667AC63F6`.

Live startup and a fight remain to be verified after the player runs
`START DAMAGE TEST.cmd`. Check the `il2cpp runtime ready ... ms` message, four
hitlog `hooked` messages, and hit rows. Do not call desktop tests a live-game pass.

## Follow-up: header-only hits in the 2075 run

Session `20260920-132400-20724` used `9888510E...` and produced only the 226-byte
hit header while other probes populated. The console was closed, so the exact
bootstrap/lookup failure is not yet known. Do not label the read-only gate as
live-verified. The hit logger remains wired in; its four hook addresses are
separate from the eventlog/damage probes. The full 2075 capture is preserved in
sheet-webapp `local-data/damage-probe-captures/20260920-baseline-2075/`.

A confirmed ordering flaw is corrected: `hitlog.start()` now opens the output
before `dumper.start()` starts the worker. Previously a ready worker could reach
`installFromWorker()` first and silently return on null output. Whether that race
caused this particular session is unconfirmed.

Bootstrap, hitlog and eventlog messages now persist to `hitlog-startup.log`, even
with `dumper-disable.txt`. Readiness snapshots appear every 5 seconds while waiting;
lookup errors and all four hook-install results are retained. The installer backs
up the log before the next launch. This is a diagnostic build, not a verified
resolution of the header-only capture. Next: launch to the hub and inspect the log
before requesting another scored run. Readiness and log-output tests pass, as do
the saved-client instruction checks and ReleaseFast build.

Diagnostic DLL SHA256: `00C3B7E83CAE5F77F89772D827BD9F03DCD5B7472D5A21ECAA9B7B11ACA6A432`.

### Live startup verified: PID 8056

The game machine launched the diagnostic/order-fix build `00C3B7E8...`. The persisted
log shows runtime readiness at **0 ms**, followed by all four resolved methods,
all 19 fields matching the known values, and all four hooks installed at **125 ms**.
The optional dump remained disabled. This demonstrates that the worker can proceed
immediately on this client, supporting the removed output-opening race as the earlier
failure mechanism (the failed run's console was not retained, so not proven directly).
The log is saved at sheet-webapp
`local-data/crash-analysis/20260920-startup/hitlog-startup-8056.log`.
At the initial hub check, `hits.tsv` was still the 226-byte header; actual attack
rows remain to be verified before calling end-to-end capture restored.

### Live attack capture verified: PID 8056

After the user performed test attacks, hits.tsv grew to 22,818 bytes at the
first check. The archived verification sample contains 64 hit rows; paths {'T': 32, 'H': 32}; skill IDs ['1181001', '1181002', '1181003', '1181004', '1181007', '1181016', '1181017'].
Both Trigger (T) and Handle (H) paths record nonzero split values. End-to-end
hit capture is restored on this launch; a complete scored rotation/import has
not been repeated. Sample: sheet-webapp
`local-data/crash-analysis/20260920-startup/hits-8056-verified.tsv`.
The current installed/staged build remains `00C3B7E83CAE5F77F89772D827BD9F03DCD5B7472D5A21ECAA9B7B11ACA6A432`.
