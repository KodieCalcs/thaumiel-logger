# thaumiel + combat logger

[thaumiel](https://git.xeondev.com/remielle/thaumiel) is the Zenless Zone Zero client patch for
the [Remielle](https://git.xeondev.com/remielle/remielle) private server. This fork is the same
patch with a **combat logger** built in: it records every hit in your battles (damage, crits,
Daze, Anomaly buildup, and the stats each hit used) and turns a battle into a spreadsheet you can
read or share.

It replaces normal thaumiel. You don't need both.

> You need to already be set up to play on a Remielle server. This project doesn't cover setting
> up the server or getting the game client.

## Download and install

1. Go to **[Releases](../../releases/latest)** and download the `.zip` file.
2. Close the game. Unzip the file and copy **everything inside** into your game folder (where
   you put `remielle.exe` and `thaumiel.dll` before). Replace the old files when asked.
3. Start the game with `remielle.exe`, as usual.

To check that it's working, open **`logger-status.txt`** in your game folder after the game starts:

| It says | Meaning |
|---|---|
| `Combat logger: ON` | Everything is working. |
| `Combat logger: OFF` | Your game version is newer than the logger. The game still works normally; only logging is paused. See [Updates](#updates). |

## Your battles

Each battle gets its own folder:

```text
Game folder\
  Combat Logs\
    2026-09-28 14.03.26\          one folder each time you start the game (date and time)
      Battle 1 - 14.05.12\        one folder per battle (the time it started)
      Battle 2 - 14.09.40\
      Before first battle\        menus and lobby before your first battle (usually empty)
```

The files inside a battle folder are raw data for tools to read. To get files you can read
yourself or share, see the next section.

## Sharing a battle

Double-click **`Make shareable log.cmd`** in your game folder. It lists your recent battles. Press
Enter for the newest, or type a number. You can also drag a `Battle N` folder onto the file.

It creates a **`Share`** folder inside that battle and opens it. The folder has two files:

| File | What's in it |
|---|---|
| `combat-log.csv` | Every hit, one row each: time, character, skill, damage, crit, Daze, Energy, the character's ATK / Impact / Anomaly stats at that moment, and active buffs. Opens in Excel or Google Sheets. |
| `summary.json` | Damage per character and per skill, battle length, hit count, crit rate, and the game version. |

**Send those two files, not the whole battle folder.** The raw files can contain account
identifiers; the `Share` files don't.

The first time you run it, it may ask you to install **Node.js**, a free program that runs the log
reader. Get the "LTS" version from [nodejs.org](https://nodejs.org), install it with the default
options, then double-click the `.cmd` again.

## Updates

When the game updates, two things need updating: the client patch (so the game can connect at
all) and the combat logger (so it can find the numbers in the new version). The patch usually
comes out first, so this project handles the two separately:

1. **As soon as upstream thaumiel supports a new game version**, a release for it appears here
   automatically, marked **"game patch only (logger off until updated)"**. Install it the same
   way and keep playing. The logger switches itself off on that version, and the game is
   unaffected.
2. **When the logger has been updated** for that version, a new release appears with the logger
   on. Install that one the same way.

In both cases you only ever need this one download. Your old `Combat Logs` are never touched by an
update.

## Troubleshooting

| Problem | Try this |
|---|---|
| `logger-status.txt` doesn't appear | The game wasn't started through `remielle.exe` from this download, or the files went into the wrong folder. |
| "No battles with damage data were found" | Make sure `damage-probe-enable.txt` is in the game folder, the status file says ON, and you finished a battle after starting the game with `remielle.exe`. |
| A battle folder exists but has almost nothing in it | That is usually `Before first battle`. Battles appear as `Battle 1`, `Battle 2`, … |
| Something else | Open an issue and attach `logger-status.txt` and the `hitlog-startup.log` from that launch's folder (not the battle files). |

**Turning logging off:** delete `damage-probe-enable.txt`. Leave `dumper-disable.txt` where it is;
it stops a large developer-only file from being written on every launch.

## For developers

- [docs/TECHNICAL.md](docs/TECHNICAL.md): what each hook captures, the file formats, building
  and testing, and the version pins.
- [docs/MAINTAINING.md](docs/MAINTAINING.md): how releases and the automatic upstream updates
  work, and what to do when the game patches.
- [docs/client-update-playbook.md](docs/client-update-playbook.md): moving the logger to a new
  game version, step by step.

Build: [Zig 0.16.0](https://ziglang.org/download/), then
`zig build -Doptimize=ReleaseFast` (output in `zig-out/bin/`) and `zig build test`.

## License

GNU Affero General Public License v3 ([LICENSE](LICENSE)), the same as upstream thaumiel. The
upstream files this fork changes (`build.zig`, `src/dynlib.zig`) carry a modification notice
(AGPL §5a). No warranty of any kind. Upstream's own README is kept as
[README.upstream.md](README.upstream.md).
