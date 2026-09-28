# thaumiel + combat logger

[thaumiel](https://git.xeondev.com/remielle/thaumiel) is the Zenless Zone Zero client patch for
the [Remielle](https://git.xeondev.com/remielle/remielle) private server. This fork is the same
patch with a **combat logger** built in. It records every hit in your battles (damage, crits,
Daze, Anomaly buildup, and the stats each hit used), and after each battle it writes a
spreadsheet you can read or share: damage and Daze per character and ability, and every hit.

It replaces normal thaumiel. You don't need both.

> You need to already be set up to play on a Remielle server. This project doesn't cover setting
> up the server or getting the game client.

## Install

The same way as thaumiel: keep this repository in its own folder and install from it.

```text
git clone https://github.com/KodieCalcs/thaumiel-logger.git
```

Then double-click **`install.cmd`** in that folder. The first time, it:

1. asks you to pick your game folder (the one with `GameAssembly.dll` in it) and remembers it;
2. finds your Remielle (battlestats) server folder next to the game folder, or asks for it:
   battles are saved when the server writes their settlement;
3. downloads Zig (to build) and Node.js (for the summaries) into the repository's `.cache`
   folder. Nothing is installed on your system;
4. builds, and copies `remielle.exe` and `thaumiel.dll` into your game folder, plus a
   `Combat Logs` folder.

Start the game with `remielle.exe`, as usual.

**Don't want to build?** Download the zip from [Releases](../../releases/latest) and copy
everything in it into your game folder instead. To update, download the new zip and copy it in again.
The logger finds your server by itself if its folder (the one with `gamesv` in it) is next to the
game folder; if it's somewhere else, use `install.cmd` instead, which asks for it.

## Update

Double-click **`update.cmd`**. It runs `git pull` and then `install.cmd`. (If you prefer to type:
`git pull`, then `install.cmd`.) Close the game first.

When the game updates, the client patch (so the game can connect) and the combat logger (so it can
find the numbers in the new version) are updated separately:

1. **As soon as upstream thaumiel supports a new game version**, it's merged here automatically,
   so `update.cmd` gets you playing again right away. The logger switches itself off on a version
   it doesn't know yet, and the game is unaffected.
2. **When the logger has been updated** for that version, run `update.cmd` again and it's back on.

## Your battles

Everything the logger writes goes in one folder in your game folder:

```text
Combat Logs\
  logger status.txt        is the logger ON for your game version?
  2026-09-28\              one folder per day
    Battle 7\              one folder per settled battle: Battle 7 = the server's endbattle_7.pb
      combat-log.xlsx
      combat-log.json
```

Only battles the server settles get a folder, named after the settlement file the server
writes (`endbattle_7.pb` → `Battle 7`); retried or quit battles are skipped. The settlement and
its loadout are copied into the folder. A few seconds after a battle ends, its folder gets:

| File | What's in it |
|---|---|
| `combat-log.xlsx` | A workbook with two tabs. **Breakdown**: damage and Daze per character and per ability, each with its share of the team's total and of the character's own. **Every hit**: one row per hit: time, character, skill (its in-game name, e.g. "Ultimate: Annihilating Windstorm"; the game's internal name is in `client_name`, and the game's own tags, such as the attack type or which Anomaly, in `attack_tags`), damage, Daze, crit, Energy, the character's ATK / Impact / Anomaly stats at that moment, and active buffs. Opens in Excel or Google Sheets. |
| `combat-log.json` | Every hit, as data for programs and AI tools: the same rows as the Every hit tab (numbers as numbers), plus the game version, the battle length, how many skills match the server's settlement exactly, and what each field means. |

Daze is what the enemy's Stun gauge actually took, so hits that land while it is Stunned count 0;
`during_stun` says which hits those are.

**Share those two files, not whole folders.** Each battle folder also holds the raw data the two
files are made from. It's hidden, because it can contain account details (File Explorer: View >
Show > Hidden items to see it).

`logger status.txt` says **ON** or **OFF**. OFF means your game version is newer than the logger;
the game still works, and the next update turns it back on.

## Troubleshooting

| Problem | Try this |
|---|---|
| No `Combat Logs\logger status.txt` after starting the game | The game wasn't started with this `remielle.exe`, or it went into the wrong folder. Run `install.cmd` again. |
| A battle you finished has no folder | The server must be the battlestats Remielle, and `install.cmd` must know its folder: run it again (delete `Combat Logs\.tools\server-logs.txt` first to pick the folder again). |
| Battle folders but no `combat-log.xlsx` | Check the "Summaries" line in `logger status.txt`. Running `install.cmd` again fixes a missing tool or Node.js. |
| `install.cmd` says the game is running | Close the game, then run it again. |
| Wrong game folder | Delete `install-config.txt` in this folder and run `install.cmd` again. |
| Something else | Open an issue and attach `logger status.txt` and `Combat Logs\.diagnostics\summarize.log` (not the battle files). |

**Turning damage logging off:** put an empty file named `damage-probe-disable.txt` next to
`remielle.exe`. Delete it to turn logging back on.

## For developers

- [docs/TECHNICAL.md](docs/TECHNICAL.md): what each hook captures, the file formats, building
  and testing, and the version pins.
- [docs/MAINTAINING.md](docs/MAINTAINING.md): how releases and the automatic upstream updates
  work, and what to do when the game patches.
- [docs/client-update-playbook.md](docs/client-update-playbook.md): moving the logger to a new
  game version, step by step.

Build by hand: [Zig 0.16.0](https://ziglang.org/download/), `zig build -Doptimize=ReleaseFast`
(output in `zig-out/bin/`), `zig build test`. Builds target baseline x86-64, so they run on any
64-bit CPU, not just the one that built them.

## License

GNU Affero General Public License v3 ([LICENSE](LICENSE)), the same as upstream thaumiel. The
upstream files this fork changes (`build.zig`, `src/dynlib.zig`) carry a modification notice
(AGPL §5a). No warranty of any kind. Upstream's own README is kept as
[README.upstream.md](README.upstream.md).
