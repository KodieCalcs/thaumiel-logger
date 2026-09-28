# Assembles the player zip from a finished build: the same files install.ps1 puts in a game
# folder, installed into dist\<name>\ and zipped.
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
& "$PSScriptRoot\install.ps1" -GameFolder $dir -SkipBuild -Staging

$zip = Join-Path $root "$Out\$name.zip"
if (Test-Path $zip) { Remove-Item -Force $zip }
# Compress-Archive skips hidden files and folders (.tools), so zip with .NET directly.
Add-Type -AssemblyName System.IO.Compression.FileSystem
[IO.Compression.ZipFile]::CreateFromDirectory($dir, $zip, [IO.Compression.CompressionLevel]::Optimal, $false)

# Read by the workflow (release title and notes).
$info = [ordered]@{ name = $name; zip = $zip; patchClient = $patchClient; loggerClient = $loggerClient; loggerOn = $loggerOn }
$info | ConvertTo-Json | Set-Content -Encoding utf8 (Join-Path $root "$Out\release-info.json")
$info | Format-List
