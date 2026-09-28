# Assembles the player-facing release folder and zip from a finished build.
#   powershell -File packaging\make-release.ps1 [-Out dist]
# Run from the repository root after `zig build -Doptimize=ReleaseFast`. Used by
# .github/workflows/release.yml and works the same locally.
param([string]$Out = 'dist')
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot

# The client the logger supports (src/logger_client.zig) and the one the client patch targets
# (upstream's README, mirrored in README.upstream.md).
$loggerClient = [regex]::Match((Get-Content -Raw "$root\src\logger_client.zig"), 'client_name = "([^"]+)"').Groups[1].Value
$patchClient = [regex]::Match((Get-Content -Raw "$root\README.upstream.md"), 'supported client version: `([^`]+)`').Groups[1].Value
if (-not $loggerClient -or -not $patchClient) { throw 'Could not read the client versions.' }
$loggerOn = $loggerClient -eq $patchClient

$name = "thaumiel-logger-$patchClient"
$dir = Join-Path $root "$Out\$name"
if (Test-Path $dir) { Remove-Item -Recurse -Force $dir }
New-Item -ItemType Directory -Force "$dir\logger-tools" | Out-Null

Copy-Item "$root\zig-out\bin\remielle.exe", "$root\zig-out\bin\thaumiel.dll" $dir
Copy-Item "$root\packaging\Make shareable log.cmd", "$root\packaging\READ ME FIRST.txt", "$root\packaging\damage-probe-enable.txt", "$root\packaging\dumper-disable.txt" $dir
Copy-Item "$root\LICENSE" $dir
# share.mjs and everything the two readers it runs import.
foreach ($f in 'share.mjs', 'per-hit-log.mjs', 'attribution.mjs', 'attack-property-skill-map.json', 'readable-log.mjs', 'log-csv.mjs', 'codename-labels.mjs', 'codenames.json') {
    Copy-Item "$root\tools\$f" "$dir\logger-tools\"
}

$zip = Join-Path $root "$Out\$name.zip"
if (Test-Path $zip) { Remove-Item -Force $zip }
Compress-Archive -Path $dir -DestinationPath $zip

# Read by the workflow (release title and notes).
$info = [ordered]@{ name = $name; zip = $zip; patchClient = $patchClient; loggerClient = $loggerClient; loggerOn = $loggerOn }
$info | ConvertTo-Json | Set-Content -Encoding utf8 (Join-Path $root "$Out\release-info.json")
$info | Format-List
