# Maintaining releases

How this fork stays current with upstream thaumiel, and what to do when the game patches.

## The two moving parts

| Part | Who updates it | Where it lives |
|---|---|---|
| Client patch (login redirect, keys, offsets) | upstream thaumiel, usually within days of a client update | `assets/offsets.zon`, upstream's `README.md` |
| Combat logger (hooks, probe offsets, readers) | this fork, by hand | `src/logger_client.zig`, the per-module pins (see [TECHNICAL.md](TECHNICAL.md) "Version contract"), `tools/per-hit-log.mjs` layouts |

`src/logger_client.zig` is the switch between them. At startup, after upstream's patches are
applied, `dynlib.zig` compares the running `GameAssembly.dll` (PE timestamp + SizeOfImage) with the
build the logger targets. On a mismatch, no logger module starts: no hooks, no threads, no
`Combat Logs` folder. Only `logger-status.txt` is written, saying the logger is off and where to
get an update. That makes a build with a newer upstream patch and an older logger safe to ship.

## What happens automatically

`.github/workflows/follow-upstream.yml` runs every 6 hours (and on demand from the Actions tab):

1. Fetches `https://git.xeondev.com/remielle/thaumiel` `master`. If there's nothing new, it
   stops.
2. Merges it into `main`. Upstream's client updates only touch `README.md` and
   `assets/offsets.zon`. This fork never edits `offsets.zon`, and `README.md` is kept as ours by
   the `merge=ours` rule in `.gitattributes`, so these merges are clean.
3. Copies upstream's README to `README.upstream.md`. That's where the release step reads the
   client version the patch targets.
4. Pushes, then runs `release.yml`.

`.github/workflows/release.yml` (also runs on any push to `main` that changes something shipped):
runs `zig build test`, builds, packages with `packaging/make-release.ps1`, and publishes a GitHub
Release tagged `<client version>-<commit>`. The title says **"game patch + combat logger"** when
`logger_client.zig`'s `client_name` equals upstream's version, and **"game patch only (logger off
until updated)"** otherwise.

If a merge conflicts, nothing is pushed or released, and the workflow opens an issue named
"Upstream thaumiel update needs a manual merge" with the conflicting files. The likely cause is
upstream changing `src/dynlib.zig` or `build.zig`, which this fork also modifies. Fix it on a
local clone:

```text
git remote add upstream https://git.xeondev.com/remielle/thaumiel.git   # once
git fetch upstream
git merge upstream/master        # resolve; keep upstream's patch code and this fork's logger block
git show upstream/master:README.md > README.upstream.md
git commit -am "Merge upstream thaumiel" && git push
```

The push triggers `release.yml`.

## Moving the logger to a new client version

Follow [client-update-playbook.md](client-update-playbook.md). It covers re-finding every pin. Then:

1. Set `client_name`, `client_timestamp` and `client_size_of_image` in `src/logger_client.zig` to
   the new build (the same values the per-module pins use).
2. `zig build test`, then build and test in game: `logger-status.txt` should say ON, and a battle
   should produce a `Battle 1 - …` folder that `node tools/share.mjs --latest` turns into a `Share`
   folder.
3. Push to `main`. `release.yml` publishes a "game patch + combat logger" release, and players
   install it over the patch-only one.

## Release contents

`packaging/make-release.ps1` builds `dist/thaumiel-logger-<client>/` and its zip:

```text
remielle.exe, thaumiel.dll          the build
Make shareable log.cmd              runs logger-tools\share.mjs (asks for Node.js if missing)
logger-tools\                       share.mjs and every reader file it needs
damage-probe-enable.txt             turns the damage probes on (they are opt-in in the DLL)
dumper-disable.txt                  skips the ~50 MB il2cpp dump on every launch
READ ME FIRST.txt                   the player instructions
LICENSE
```

If `share.mjs` or a reader gains an import, add the file to the list in `make-release.ps1`.
