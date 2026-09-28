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
battle folders. Only `Combat Logs\logger status.txt` is written, saying the logger is off and how to
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

Follow [client-update-playbook.md](client-update-playbook.md). It covers re-finding every pin. Two
things specific to this build:

- **Set the gate first.** Put the new build's `client_name`, `client_timestamp` and
  `client_size_of_image` (read from the new `GameAssembly.dll`'s PE header offline) into
  `src/logger_client.zig` before the first test launch: on an unknown client the gate starts no
  logger module at all, including the dumper the playbook's first run relies on.
- **The dump is opt-in.** Create `dumper-enable.txt` beside the launcher for the launches that
  should write `il2cpp-v7.tsv` (into `Combat Logs\.diagnostics\<launch>\`).

Then `zig build test`, install on the game machine (`packaging\install.ps1 -GameFolder <dir>`),
and check in game: `Combat Logs\logger status.txt` says ON and "Summaries: ON", and a battle
that settles produces `Combat Logs\<day>\Battle N\` (N = the server's `endbattle_N.pb`) with `combat-log.xlsx` and `combat-log.json` a few
seconds after it ends. Push to `main`; players get it with `update.cmd` (or the new release zip).

## What a player's game folder gets

`packaging/install.ps1` (run by `install.cmd`, `update.cmd`, and `make-release.ps1` for the zip):

```text
remielle.exe, thaumiel.dll          the build
Combat Logs\READ ME.txt             the player explanation
Combat Logs\.tools\                 hidden: summarize.mjs, the readers it runs, LICENSE,
                                    node\node.exe + its LICENSE (current Node LTS, fetched once
                                    into the repository's .cache\)
```

It also removes the files the first public build (2026-09-28) put beside the launcher. If
`summarize.mjs` or a reader gains an import, add the file to the list in `install.ps1`.
