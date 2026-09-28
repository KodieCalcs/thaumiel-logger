> Moved from `sheet-webapp/docs/reference/action-start-hook-plan.md` on 2026-09-13; source paths rewritten to this repo. `docs/TC_IMPLEMENTATION_PLAN.md` referenced below is a sheet-webapp document.

# Plan: an action-start hook

Handoff for whoever is next in this repo. Written 2026-09-12 while another session was
mid-flight on the damage probe, so nothing here has been implemented — this is the plan, the
evidence behind it, and the dead ends already ruled out.

**Coordinate before editing.** This repo is now under version control (branch `per-hit-logger`),
but two sessions editing the same working tree still clobber each other. Confirm nobody else is in
there first, and commit as you go.

## Why this is worth doing

`hits.tsv` records **damage**, not **inputs**. Every action boundary is therefore inferred, and that
inference is the single largest source of error in the timing work. Concretely, from 2026-09-12:

- Measuring how long an action takes requires knowing when the *next* one started. Inferring that
  from the next damage event produced per-transition offsets spanning **−62f to +40f**, where
  negatives are impossible for a genuine cancel. See `docs/TC_IMPLEMENTATION_PLAN.md` §8.10.
- Autonomous damage (Bangboo, Rina's dolls, Grace's assists, Velina's cyclone) fires *between*
  actions. Pairing adjacent damage events loses real sequences; skipping them can wrongly bridge a
  genuine pause. Both failure modes were observed.
- Actions that deal **no damage** never appear at all, so they cannot be imported into a rotation
  (a known Phase 3 limitation).

An action-start event would remove all three at once.

## Step 1 — find the dispatcher without any new hook

**Do this first. It is a few lines and needs no discovery work.**

`damage_probe.c` already reads return addresses off the stack and logs them as `caller` /
`caller_rva`. Apply the same trick to the hook that already exists:

- `src/hit_hook.c` — `hit_hook_trigger()` is the detour.
- `src/hitlog.zig` — `hitlog_record(self, a1, a2, a3)` at line ~117 is where a
  row is written.

Capture the detour's return address (the compiler intrinsic, or the same stack read
`damage_probe.c` uses) and add it to the row as an RVA — `addr - module_base`. Run once, then look
that RVA up in the dump.

**That gives you the immediate caller, which is a lead — not yet the dispatcher.** It could equally
be an attack-specific helper sitting between the real timeline walker and the hit. Before building
anything on it, verify:

1. **Identity.** Is it actually the per-frame walker, or a helper? Check its name in the dump, and
   whether its callers look like a frame loop. One caller RVA does not establish the role.
2. **Coverage.** Even a genuine pattern dispatcher only fires for states that *have* pattern
   entries. It cannot see an action that contains no events at all — which is precisely the
   non-damaging-action gap this plan exists to close. Test against known action starts, explicitly
   including a non-damaging one, before claiming coverage.

If it turns out to be attack-specific, walk one frame further up: the return address of *its* caller
is the same cheap trick applied again.

The reason it is still the best first move: it costs almost nothing, and if it *is* the dispatcher
it sees every pattern entry rather than only damaging ones — including the `AbilityName` entries
that launch projectiles, whose hits the frame data cannot place at all (`TC_IMPLEMENTATION_PLAN.md`
§8.11).

## Step 2 — hook the dispatcher

A normal detour, same shape as `hit_hook.c`. What to record per event: elapsed ms, the entry's
`frame`, the state it belongs to, and whichever of `AnimEventID` / `AbilityName` is set. That gives
an action-level timeline rather than a damage-level one.

## Candidate leads, ranked

| Lead | RVA (CNBetaWin3.3.0) | Assessment |
|---|---|---|
| Caller of `TriggerAttackPattern` | discover at runtime, step 1 | **Best first move** — no discovery cost. Coverage is unverified: if it is the pattern dispatcher it sees every pattern *entry* (including `AbilityName` ones), but an action with no entries at all is still invisible. Verify per step 1 |
| `StateMachineBehaviour.OnStateEnter` | `0x1F6D8CE0` | Unity's base virtual. Would fire on every animator state entry — literally "action started" — **if** ZZZ attaches behaviours. Cheap to test, may simply be unused |
| `ConfigEntityAnimEvent.GetPatternEvent` | `0x168A3A90` | Sibling of the existing hook; likely called while resolving an entry |

## Already ruled out — do not repeat

- **`ConfigEntityAnimEvent`'s other methods.** All 18 were listed; every one is attack-pattern
  handling (`HandleAttackPattern`, `CheckAttackPatternShow`, `BeginContinuousAttackPatternListDraw`,
  …). No state-entry method exists on that class. Its `TriggerAttackPattern` is at `0x168A12A0`,
  matching `hitlog.zig`, which also confirms the v7 dump is current.
- **`EnterState` / `OnStateEnter` across the dump.** 119 matches, almost entirely StateTree and
  behaviour-tree AI tasks for NPCs (`MoveToTask`, `LookAtIKTask`, `PathFollowMoveTask`, and their
  `VirtualProxy_` / `VirtualFunctionExtensions_` wrappers). Not the player action path.
- **`MoleMole.*AnimEvent*` runtime classes.** Only one exists,
  `MoleMole.FlowCanvas.Nodes.LDTriggerAnimEventNode` — cutscene/level-design plumbing, not combat.

## Note for the damage-hook work too

The caller-RVA trick generalises: **any hook that logs its return address turns "find the function
that does X" into "grep the dump"**. Worth reaching for before disassembly on the remaining damage
targets.

## Timing

Build this **before** the client update, not after. The update cost of an extra hook is only its RVA
constant (see `docs/reference/client-update-playbook.md`), so deferring saves nothing — and a new
hook can only be *tested* on a client where the dumper and existing hooks already work. Building it
afterwards means debugging a fresh hook and a broken bootstrap at the same time.

## Update 2026-09-13 — Step 1 done offline; there is no single dispatcher

Scanning the saved GameAssembly for `call 0x168A12A0` (Capstone/Node, no playtest) finds **eleven**
direct callers of `TriggerAttackPattern`, all obfuscated, in seven classes:

| caller | method | note |
|---|---|---|
| `0x1534F9C4`, `0x1A3067E1`, `0x1B0EF491`, `0x1B9678E0` | `NGEPOAIJNAL()` on `OBHLMCNDHPF`, `JIHNKPPNIGJ`, `CHMCPCOKEMP`, `BPIBGPANAGG` | same name, no params, four classes: a virtual override, most likely the per-frame update of the anim-event track player for different entity kinds |
| `0x13348925`, `0x13394254`, `0x133A5435` | `INIDFLBMKKE::FPHCCCNEJFO(6)`, `::LLAMKBEMPEJ(5)`, `::LKNPKOKNKHP(6)` | `INIDFLBMKKE` is the entity's ability/buff component (its `NNKCNOHIFDN` is the named-buff lookup used by the damage code) |
| `0x192AFC4D`, `0x192BA96E` | `ACMONJGAGOA::LLFNACHKABM(7)`, `::MNEFBHEGOOJ(4)` | |
| `0x1A2983A6` | `HIJILFFNJHP::EHKBIJCKEDH(7)` | |
| `0x1BA455B0` | `CJPPGEKNCEO::ACMCHFPDAGN(6)` | |

`GetPatternEvent` (`0x168A3A90`) has exactly one caller, `0x168A26D0`, inside
`ConfigEntityAnimEvent` itself — not a lead.

Consequence: Step 1's runtime return-address column is still the right next move (it says which of
the eleven fire in play — probably one or two), but even the right one is a per-frame walker of
pattern *entries*, so it fires per entry, not per action start. The remaining discovery is the
point in that walker where a new state begins (state entry / frame-counter reset), then a verify
fight that includes a **non-damaging** action. Budget an evening and two fights, not a few lines.
The per-hit object at `result+0xA8` (`HPGPGOBHHFK`) was checked for frame counters: its `+0x30` is
a per-attacker id (229 Grace, 296 Velina), not a frame. Do not repeat.

## Update 2026-09-18 — Step 1 run: one live caller, and it is an adapter

`hits.tsv` now carries `caller`/`callerRva` (fork commit 2ae28b9; capture
`local-data/damage-probe-captures/20260918-retaddr/`, 1328 rows, CNBetaWin3.3.2). Result:

- Every leaf row (`H`/`L`/`C`) returns into `TriggerAttackPattern` itself (`0x16A013D1`,
  `0x16A0149E`, `0x16A01452`), and every `T` row is followed by exactly one leaf row: in this
  fight nothing bypassed the dispatcher.
- `T` rows have **two** callers: `0x13CF59C6` for 654/664 rows and `0x1AFD9A68` for the 10
  rows with skill 0 / dmgPct 0. The 3.3.2 binary still has eleven direct callers
  (`0x13CF59C1 0x13CFA1F0 0x14FB6CF7 0x150404A5 0x1504AE64 0x150D94D3 0x16820B66 0x16FD3726
  0x18BD7206 0x1A80F828 0x1AFD9A63`); the other nine did not fire.
- Names are re-randomised per build, so identities were matched by class shape (method count,
  field count, param histogram, named methods):
  - `0x13CF59C6` -> `EGMKKHDDOGE::LPJIFGJMMCL(4)` at `0x13CF5880`, = 3.3.0
    `ACMONJGAGOA::MNEFBHEGOOJ(4)`. `EGMKKHDDOGE` is an ECS system (271 methods, `FixedUpdate`,
    `AfterAnimatorFixedUpdate`, `WaitForFixedUpdate`, `EndOfFixedUpdate`) — the anim-event /
    attack-pattern system.
  - `0x1AFD9A68` -> `AHJIOGJFJLP::FAOIMKBDEPB(6)`, = 3.3.0 `CJPPGEKNCEO::ACMCHFPDAGN(6)`, an
    `AnimatorEvent` config subclass (10 methods, 3 fields): the config-event path, only for the
    ten no-property rows.
- **`LPJIFGJMMCL` is an adapter, not the walker** (disassembly at `0x13CF5880`): args
  `(this=system, rdx=entity-ish, r8, r9=ptr to a 16-byte struct)`; it looks the
  `ConfigEntityAnimEvent` up in a dictionary at `this+0xB0` keyed by `[rdx+0x28]`
  (`call 0x19CEF550`), fills a stack block of defaults, and calls `TriggerAttackPattern` once.
  Its own frame is `sub rsp,0xB8` + six pushes = `0xE8`, so from `TriggerAttackPattern`'s entry
  its return address sits at `[rsp+0xE8]`.
- `LPJIFGJMMCL` has **six** callers (`tools/discovery/callers.mjs` logic re-run on 3.3.2):
  `HOMPBKLPCAC::AHHOCGNHJIC(6)` and `::HLFMOACJGBG(5)` (the ability system, 1332 methods, =
  3.3.0 `INIDFLBMKKE`), `LBCOJNHEAFI::LDLFHFGKJAH(2)` (79-method system with
  `Update/FixedUpdate/LateUpdate`), `GCPCDFKMNKG::BENMMBKIGDM(2)` and `::CJJOBLFEGPH(2)`
  (64-method system with `Update`), and `PGFCLHOPNKO::FAOIMKBDEPB(6)` (another `AnimatorEvent`
  subclass). The per-frame walker is one of the 2-param ones on `LBCOJNHEAFI`/`GCPCDFKMNKG`;
  which one fires in play is the next runtime question.

Next: log a short backtrace per row instead of one frame (`RtlCaptureStackBackTrace`, frames
above the immediate caller), so one more run reaches the `Update`/`FixedUpdate` that drives the
walker. Coverage for non-damaging actions is still unproven — the hook only sees pattern entries.

Caller scan: `python tools/discovery/callers.py <version> <rva...>` is the mmap version of
`callers.mjs` (5 s for the whole il2cpp section; the JS one did not finish in 15 min on 3.3.2).

## Update 2026-09-18 (later) — `stack` column, run 2: four paths, the anim-event driver is `AfterAnimatorFixedUpdate`

Capture `local-data/damage-probe-captures/20260918-stack/` (992 rows, fork `29baf18`). Every `T`
row carries six frames; the first two are the detour and the already-logged caller (skip count
off by one — fixed in the next build), so four new frames each. Above the adapter
`EGMKKHDDOGE::LPJIFGJMMCL`, the `T` rows split into four call paths (all 3.3.2 RVAs):

| path | rows | frames above the adapter | skills seen |
|---|---|---|---|
| A anim-event | 334 | `PGFCLHOPNKO::FAOIMKBDEPB(6)` (`AnimatorEvent` subclass) ← `EGMKKHDDOGE::AOGPOONJNGI(1)` ← `0xC89889E`, `0x8FF34B2` (libil2cpp runtime `.text`: delegate-invoke thunks, the dump's "`DelegateEx +0x49…`" attribution is meaningless) — **driver not reached in 6 frames** | Basic chains `1181001-4`, `1211011/12/24/27`, `1561014`, Bangboo `5400801`, `1181007` |
| B projectile? | 120 | `LBCOJNHEAFI::LDLFHFGKJAH(2)` ← `::EIJLCOKIIIG(4)` ← `<>c::NDJJLHBPDGM(4)` (a lambda) ← runtime thunk `0xA590989` | `1211009`, `1181016/17`, `1181008/10/11/19`, and `1181003` (also in A) — consistent with the `AbilityName`/bullet entries |
| C ability | 27 | `HOMPBKLPCAC::HLFMOACJGBG(5)` ← `PMHKAADKDBF::FANFMCMPEME(7)` (a config, `FromBinary/FromFlx`) ← `HOMPBKLPCAC::FPOKOPCNCCJ(7)` ← `::OAKPEKKCFLB(7)` | `1561007` only |
| D config-event | 15 | `EGMKKHDDOGE::OJJFIINEKCI(1)` ← **`EGMKKHDDOGE::AfterAnimatorFixedUpdate`** ← `EcsSystemGroup::AfterAnimatorFixedUpdate` ← `GameEngine::NHPNPPNHIAK(0)` | skill 0 only (2 further rows: path A's `PGFCLHOPNKO` fired from `OJJFIINEKCI` too) |

So the anim-event system's per-frame entry is `AfterAnimatorFixedUpdate` → `OJJFIINEKCI(1)`,
proven for the config-event path. Path A — the one that carries ordinary attacks — passes through
delegate thunks and needs more depth to show whether it lands in the same walker
(`OJJFIINEKCI`) or a Unity animation-event callback. Next build: skip 2, capture 12 frames.

## Update 2026-09-18 (run 3, 12 frames) — Step 1 closed: the dispatcher is `EGMKKHDDOGE::AOGPOONJNGI(1)`

Capture `local-data/damage-probe-captures/20260918-stack12/` (880 rows, fork `9db0e1a`; the
`stack` column still repeats `callerRva` as its first entry — `RtlCaptureStackBackTrace`'s skip
counts from a different frame than assumed; harmless). Full drivers of all four paths (3.3.2):

| path | driver chain (outermost first) |
|---|---|
| A anim-event (294) | `SetupCoroutine::InvokeMoveNext` → `EEOGMHHDAAC::MoveNext` → `JHDHGCPIJCH::KONGCPMOMNN(1)` (singleton) → `EcsSystemGroup::WaitForFixedUpdate` → **`EGMKKHDDOGE::WaitForFixedUpdate`** `+0xD8` → delegate thunks (`0x8FF34B2`, `0xC89889E`) → **`EGMKKHDDOGE::AOGPOONJNGI(1)` at `0x13CE2D40`** → `PGFCLHOPNKO::FAOIMKBDEPB(6)` → adapter → `TriggerAttackPattern` |
| B projectile (108) | `GameEngine::FixedUpdate` → `LOLPDHOFIHG::KHEINBHPBNN(1)` → `EcsSystemGroup::FixedUpdate` → `LBCOJNHEAFI::FixedUpdate` → thunks → `<>c::NDJJLHBPDGM(4)` lambda → `LBCOJNHEAFI::EIJLCOKIIIG(4)` → `::LDLFHFGKJAH(2)` → adapter |
| C ability (22+3) | `HOMPBKLPCAC::DJNFECJMFAB(0)` → thunks → `::DIPGPFGOHDB(2)` → `::BBMMKGDMAOH(3)` → `::OJBKAKEGBGL(4)` → `::OAKPEKKCFLB(6)` → `::OAKPEKKCFLB(7)` → `::FPOKOPCNCCJ(7)` → `PMHKAADKDBF::FANFMCMPEME(7)` → `::HLFMOACJGBG(5)` → adapter |
| D config-event (12) | `GameEngine::NHPNPPNHIAK(0)` → `EcsSystemGroup::AfterAnimatorFixedUpdate` → `EGMKKHDDOGE::AfterAnimatorFixedUpdate` → `::OJJFIINEKCI(1)` → `AHJIOGJFJLP::FAOIMKBDEPB(6)` → adapter |

**`AOGPOONJNGI(1)` (`0x13CE2D40`) is the per-frame animator-event dispatcher** (disassembly):
it walks a `List<>` at `[rcx+0xA0]` of 24-byte entries `{ AnimatorEvent* ev; f32 a; f32 b;
f32 c; i32 d }`, calls a filter `0x14914D30(ev, ctx)`, and for each survivor calls
`ev->vtable[0x100/8]` (slot 32) with `(ev, [ctx+0x38], a, b, c, d, MethodInfo=0)` — the
`Execute` virtual every one of the 132 `MoleMole.Config.AnimatorEvent` subclasses overrides
(`PGFCLHOPNKO::FAOIMKBDEPB(6)` is the attack-pattern one). So it sees **every** animation-frame
event — sound, effect, camera, attack — not only attack patterns; an action with any frame event
at all is visible there, which is exactly the coverage `TriggerAttackPattern` lacks.

Step 2 (hook the dispatcher) therefore means a hook on `0x13CE2D40` (or on the virtual-call site
at `0x13CE2E47`) logging, per event: the event object's class name (il2cpp `class_get_name`,
API index 37 — the dumper already loads the table), `a/b/c/d`, and the ctx/entity. The
non-damaging-action coverage test (dodge, attack-less switch) is then a real test, not a hope.
Frame-0 "state entered" events are not guaranteed to exist per action; if they don't, the fallback
is the animator state change itself, one level up in `WaitForFixedUpdate`.

## Update 2026-09-18 (evening) — Step 2 built and verified: `events.tsv`

Fork `b78ee79`: `src/eventlog.zig` + `src/event_hook.c` detour the drain
`EGMKKHDDOGE::AOGPOONJNGI` (`0x13CE2D40`, 15-byte prologue relocated whole) and dump the
component's queue `CEODKDLMABB+0xA0` (`List<AOGAEAMAHJG>`) before it executes and clears it.
Capture `local-data/damage-probe-captures/20260918-eventlog/` (2384 event rows, 1104 hit rows,
41 event classes, 9 components / 12 entities). First run, no crash, no visible stutter.

Row: `elapsed_ms component owner queued index event klass className f0 f1 f2 trigger`
(clock shared with hits.tsv). Read as:

- `owner` (= `[component+0x38]`) is the entity and **equals `hits.tsv`'s `arg2`** — the join key.
- `f0`→`f1` is the normalized-time window of the animator state covered by this frame; `f2` is
  the state length in seconds; time-in-state = `f1 × f2`.
- `trigger`: 0 normal, **1 `ForceTriggerOnTransitionIn` = state entered** (`f1 = 0`), 2
  `ForceTrigger` (fires at `f1 = 1.0` when a state runs out or is left), 3
  `ForceTriggerOnTransitionOut`.
- `PGFCLHOPNKO` is the attack-pattern event; its `hits.tsv` row lands in the same millisecond
  (e.g. entity `…13D20`, state entered 85985 ms, length 1.0 s, eight `1181004` hits at 0.125
  ~47 ms apart). `AnimatorEventEffect`, `AnimatorEventMaterialPropertyModifier` and
  `AnimatorEventRemoveMaterialPropertyModifier` keep their real names; the other 38 are
  obfuscated (`LFMNGPGMJMD` is the most frequent, per-frame).

**Coverage result:** 159 state entries (`trigger=1` groups), 99 followed by hits, **60 with no
hit at all** — dodges, switches, idles, enemy states. Grace's entity shows four entries of a
0.833 s state (`IN FEEPDKABFPG` only) with no hit, matching the dodges in the test fight. The
non-damaging-action gap is closed at the observation level.

**Still missing: the state's name.** A state is currently identified only by its length and its
`IN` class signature. Two routes, in preference order: (1) offline — match (length, event
classes, normalized times) against the extracted animator configs the frame data already came
from (`hit-split-frame-data.md`); (2) runtime — read the state name/hash from the component or
its animator, one more field lookup in the dump. Do (1) first; it needs no new hook.

Reader: none yet — `tools/per-hit-log.mjs` does not know events.tsv. The three checks above were
ad-hoc scripts; a `tools/events-timeline.mjs` (join on `owner = arg2`, group `trigger=1` rows
into state entries, list hitless states) is the next tool to write.

**Projectiles (same capture).** Path-B hits are credited to the Agent entity (`arg2`) and only
3/149 coincide with an animator event — the impact is the bullet system's. The *launch* is an
animator event on the Agent: Grace `1181016` hits follow a `CCBIMDEMPKF`+`MKMGIIEKIFK` pair by
31–391 ms (median 125, n=18); `1181003/08/11` follow `IJIGCMCCGNF` by 31–250 ms. Exception:
Rina `1211009` (48 hits, her autonomous summons) has no animator event on her entity within
seconds — persistent summon attacks are not launched by the Agent's animation and need the
summon entity's own events, if it has any. Which obfuscated class is the literal bullet spawn is
the same naming job as the states.

**Reader (2026-09-18, later):** `node tools/events-timeline.mjs <capture-dir>` joins the two logs
(`owner = arg2`, shared clock) and writes `state-timeline.csv` (one row per state entry:
length, `IN` signature, hits with offsets, delivery path), `projectile-pairs.csv` (one row per
projectile **launch**: state, launch offset, first-impact flight time, hit count, last impact,
damage total) and `events-summary.json` (hitless signatures, per-skill launch class with
coverage/precision and runners-up). The launch class per skill is chosen by coverage x
precision, precision ≥ 80 % — precision against *any* bullet hit, since one spawn class serves
several skills and the per-frame housekeeping event (`LFMNGPGMJMD`) would otherwise win.
On the 20260918-eventlog capture: `MKMGIIEKIFK` spawns Grace's `1181005/16/17/19`,
`IJIGCMCCGNF` her `1181003/08/11`; grenade `1181016` = throw at ~150 ms into a 0.95 s state,
first impact 31–172 ms later (flight, range-dependent), 2 hits per throw summing to 1.0. Not
resolved: `1181010` (a lingering field, 11 ticks over 0.7 s from one launch — no class clears
80 %) and `1211009` (autonomous summon, no launch on the Agent).

**Fields and summons (same day):** the two unresolved skills were one-spawn-many-ticks sources,
which per-hit pairing cannot see. `events-timeline.mjs` now groups a bullet-path skill's hits
into bursts (gap > 1 s) and takes the deploy as the nearest preceding spawn-class event on the
owner (`persistent-sources.csv`); spawn classes are global config event types, and the deploy
may be the state-entry occurrence itself. Results: Grace `1181010` = deploy at entry of a
0.917 s state (`MKMGIIEKIFK`), first tick +188 ms, 11 ticks over 734 ms (one cast — confirm with
more). Rina `1211009` = three identical deploys at the entry of a 4.2 s state (`IJIGCMCCGNF`),
first hit +125–156 ms, **16 ticks at ~109 ms over 1.74 s**, ~23 s apart while she is off field —
a periodic off-field ability, each firing traceable to her action. Nothing needs a new hook;
these are deploy + tick pattern, not throw + impact.

**Names (same day):** `sheet-webapp/tools/name-capture-states.mjs` matches a capture's state
entries against the decoded `AnimatorEventPattern` assets (60 fps confirmed; length, skills, hit
frames, event frames) — 129/200 entries named on the first capture, and `event-class-map.json`
resolves the obfuscated event classes: `PGFCLHOPNKO` = AnimEventHandler, `IJIGCMCCGNF` =
TriggerAbility (the spawn), `BHINLLEMHFE` = ActiveDodgeDummy, `LFMNGPGMJMD` = AudioEffect. See
`sheet-webapp/docs/reference/hit-split-frame-data.md`, "Naming captured states".
