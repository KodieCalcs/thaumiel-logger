# Builds thaumiel + the combat logger and installs it into a game folder.
#
#   install.cmd                        (double-click; asks for the game folder the first time)
#   powershell -File packaging\install.ps1 [-GameFolder <path>] [-SkipBuild] [-Staging]
#
# What it does, in order:
#   1. finds the game folder: -GameFolder, else the one saved in install-config.txt, else asks
#   2. gets Zig 0.16.0 (on PATH, or downloaded once into .cache\) and builds
#   3. gets Node.js (downloaded once into .cache\) for the battle summaries
#   4. copies remielle.exe + thaumiel.dll into the game folder and the logger's tools, with
#      Node, into "<game folder>\Combat Logs\.tools\" (hidden)
#   5. removes files an earlier version of this logger left in the game folder
#
# -Staging is for packaging/make-release.ps1: the "game folder" is the release folder being
# zipped, so it is not checked for the game or for a running game.
param(
    [string]$GameFolder,
    [switch]$SkipBuild,
    [switch]$Staging
)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue' # Invoke-WebRequest is very slow with its progress bar
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$repo = Split-Path -Parent $PSScriptRoot
$cache = Join-Path $repo '.cache'
$configFile = Join-Path $repo 'install-config.txt'
$zigVersion = '0.16.0'

function Say($text) { Write-Host $text }
function Fail($text) { Write-Host ''; Write-Host $text -ForegroundColor Red; exit 1 }

# --- 1. game folder --------------------------------------------------------------------------
if (-not $GameFolder -and (Test-Path $configFile)) { $GameFolder = (Get-Content $configFile -Raw).Trim() }
if (-not $GameFolder) {
    Add-Type -AssemblyName System.Windows.Forms
    $dialog = New-Object System.Windows.Forms.FolderBrowserDialog
    $dialog.Description = 'Select your game folder: the one with GameAssembly.dll in it (where remielle.exe goes).'
    $dialog.ShowNewFolderButton = $false
    if ($dialog.ShowDialog() -ne [System.Windows.Forms.DialogResult]::OK) { Fail 'No folder selected; nothing was installed.' }
    $GameFolder = $dialog.SelectedPath
}
if (-not $Staging) {
    if (-not (Test-Path (Join-Path $GameFolder 'GameAssembly.dll'))) {
        if (Test-Path $configFile) { Remove-Item $configFile } # ask again next time
        Fail "That doesn't look like the game folder (no GameAssembly.dll in $GameFolder).`nRun this again and pick the folder the game's .exe is in."
    }
    Set-Content -Path $configFile -Value $GameFolder -Encoding utf8
}
New-Item -ItemType Directory -Force $GameFolder | Out-Null
Say "Game folder: $GameFolder"

# --- 2. build ----------------------------------------------------------------------------------
New-Item -ItemType Directory -Force $cache | Out-Null
if (-not $SkipBuild) {
    $zig = $null
    $onPath = Get-Command zig -ErrorAction SilentlyContinue
    if ($onPath -and ((& $onPath.Source version) -eq $zigVersion)) { $zig = $onPath.Source }
    $cachedZig = Join-Path $cache "zig-x86_64-windows-$zigVersion\zig.exe"
    if (-not $zig -and (Test-Path $cachedZig)) { $zig = $cachedZig }
    if (-not $zig) {
        Say "Downloading Zig $zigVersion (one time, about 80 MB)..."
        $zip = Join-Path $cache 'zig.zip'
        Invoke-WebRequest "https://ziglang.org/download/$zigVersion/zig-x86_64-windows-$zigVersion.zip" -OutFile $zip
        Expand-Archive $zip -DestinationPath $cache -Force
        Remove-Item $zip
        $zig = $cachedZig
    }
    Say 'Building (the first build takes a minute or two)...'
    Push-Location $repo
    try {
        & $zig build -Doptimize=ReleaseFast
        if ($LASTEXITCODE -ne 0) { Fail 'The build failed (see the messages above).' }
    } finally { Pop-Location }
}

# --- 3. node -----------------------------------------------------------------------------------
$nodeDir = Join-Path $cache 'node'
if (-not (Test-Path (Join-Path $nodeDir 'node.exe'))) {
    Say 'Downloading Node.js for the battle summaries (one time, about 30 MB)...'
    $index = Invoke-RestMethod 'https://nodejs.org/dist/index.json'
    $lts = ($index | Where-Object { $_.lts } | Select-Object -First 1).version
    $zip = Join-Path $cache 'node.zip'
    Invoke-WebRequest "https://nodejs.org/dist/$lts/node-$lts-win-x64.zip" -OutFile $zip
    # Only node.exe and its license are needed, not npm.
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    New-Item -ItemType Directory -Force $nodeDir | Out-Null
    $archive = [IO.Compression.ZipFile]::OpenRead($zip)
    try {
        foreach ($entry in $archive.Entries) {
            if ($entry.Name -in 'node.exe', 'LICENSE') {
                [IO.Compression.ZipFileExtensions]::ExtractToFile($entry, (Join-Path $nodeDir $entry.Name), $true)
            }
        }
    } finally { $archive.Dispose() }
    Remove-Item $zip
}

# --- 4. install --------------------------------------------------------------------------------
if (-not $Staging) {
    foreach ($f in 'thaumiel.dll', 'remielle.exe') {
        $p = Join-Path $GameFolder $f
        if (-not (Test-Path $p)) { continue }
        try { $s = [IO.File]::Open($p, 'Open', 'ReadWrite', 'None'); $s.Dispose() }
        catch { Fail 'The game is running. Close it, then run this again.' }
    }
}
Copy-Item (Join-Path $repo 'zig-out\bin\remielle.exe'), (Join-Path $repo 'zig-out\bin\thaumiel.dll') $GameFolder -Force

$logs = Join-Path $GameFolder 'Combat Logs'
$tools = Join-Path $logs '.tools'
New-Item -ItemType Directory -Force (Join-Path $tools 'node') | Out-Null
# summarize.mjs, its workbook writer, and everything the two readers it runs import.
foreach ($f in 'summarize.mjs', 'per-hit-log.mjs', 'attribution.mjs', 'attack-property-skill-map.json', 'readable-log.mjs', 'log-csv.mjs', 'codename-labels.mjs', 'codenames.json', 'display-names.mjs', 'xlsx.mjs', 'enemy-state.mjs') {
    Copy-Item (Join-Path $repo "tools\$f") $tools -Force
}
# Tables the readers use when present (per-hit-log.mjs / display-names.mjs check for each).
foreach ($f in 'attack-property-client-skills.json', 'skill-display-names.json', 'skill-buildup.json') {
    $p = Join-Path $repo "tools\$f"
    if (Test-Path $p) { Copy-Item $p $tools -Force }
}
Copy-Item (Join-Path $nodeDir '*') (Join-Path $tools 'node') -Force
Copy-Item (Join-Path $repo 'LICENSE') $tools -Force
Copy-Item (Join-Path $repo 'packaging\READ ME.txt') $logs -Force
(Get-Item $tools -Force).Attributes = 'Directory, Hidden'

# The server's logs folder, where it writes each settlement (endbattle_<n>.pb): a battle gets a
# "Battle <n>" folder only when its settlement is found there (tools/summarize.mjs). Kept across
# installs; otherwise found beside the game folder, inside it, or as the game folder itself (a
# folder with gamesv\ in it), else asked.
$serverConfig = Join-Path $tools 'server-logs.txt'
function Test-Settlements($logsDir) { [bool](Get-ChildItem $logsDir -Filter 'endbattle_*.pb' -ErrorAction SilentlyContinue | Select-Object -First 1) }
if (-not $Staging) {
    $current = if (Test-Path $serverConfig) { (Get-Content $serverConfig -Raw).Trim() } else { '' }
    $currentOk = $current -and (Test-Path (Join-Path $GameFolder $current)) -or ($current -and [IO.Path]::IsPathRooted($current) -and (Test-Path $current))
    if (-not $currentOk) {
        $game = (Get-Item $GameFolder).FullName.TrimEnd('\')
        $parent = Split-Path -Parent $game
        # Several servers side by side (an old plain Remielle next to the battlestats one): prefer the
        # one that has written settlements, then one named battlestats. The summarizer checks every
        # server folder here anyway; this is only what server-logs.txt records.
        $server = @(Get-Item $game) + @(Get-ChildItem $game, $parent -Directory -ErrorAction SilentlyContinue) |
            Where-Object { Test-Path (Join-Path $_.FullName 'gamesv') } |
            Sort-Object @{ Expression = { Test-Settlements (Join-Path $_.FullName 'logs') }; Descending = $true },
                        @{ Expression = { $_.Name -match 'battlestats' }; Descending = $true } |
            Select-Object -First 1
        $serverDir = if ($server) { $server.FullName.TrimEnd('\') } else { $null }
        if (-not $serverDir) {
            Add-Type -AssemblyName System.Windows.Forms
            $dialog = New-Object System.Windows.Forms.FolderBrowserDialog
            $dialog.Description = 'Select your Remielle server folder (the one with gamesv and logs in it). Battles are saved when the server settles them.'
            $dialog.ShowNewFolderButton = $false
            while ($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) {
                $picked = $dialog.SelectedPath.TrimEnd('\')
                # Picking the server's own gamesv\ or logs\ folder means the server folder above it.
                if (-not (Test-Path (Join-Path $picked 'gamesv')) -and (Split-Path -Leaf $picked) -in 'gamesv', 'logs') { $picked = Split-Path -Parent $picked }
                if (Test-Path (Join-Path $picked 'gamesv')) { $serverDir = $picked; break }
                Say "$picked is not a Remielle server folder (it has no gamesv folder in it). Pick the one that does, or Cancel."
            }
        }
        if ($serverDir) {
            # Relative to the game folder when the server is in it or beside it, so the path works on
            # the game machine however this installer reached it (e.g. over the network).
            $value = if ($serverDir -eq $game) { 'logs' }
                elseif ((Split-Path -Parent $serverDir) -eq $game) { (Split-Path -Leaf $serverDir) + '\logs' }
                elseif ((Split-Path -Parent $serverDir) -eq $parent) { '..\' + (Split-Path -Leaf $serverDir) + '\logs' }
                else { Join-Path $serverDir 'logs' }
            Set-Content -Path $serverConfig -Value $value -Encoding ascii
            Say "Server settlements: $value"
        } else {
            Say 'No server folder chosen: every battle with a hit will be saved, settled or not. Run install.cmd again to set it.'
        }
    }
    # Only the battlestats Remielle writes settlements, so a server that never has may be the wrong one.
    $recorded = if (Test-Path $serverConfig) { (Get-Content $serverConfig -Raw).Trim() } else { '' }
    if ($recorded) {
        $recordedDir = [IO.Path]::GetFullPath($(if ([IO.Path]::IsPathRooted($recorded)) { $recorded } else { Join-Path $GameFolder $recorded }))
        if (-not (Test-Settlements $recordedDir)) {
            Say "Note: this server has not saved a battle yet (no endbattle_*.pb in $recordedDir). Only the battlestats Remielle saves them. If you have already finished a battle on it, this is the wrong server folder: delete Combat Logs\.tools\server-logs.txt and run install.cmd again."
        }
    }
}

# --- 5. tidy up older layouts --------------------------------------------------------------------
# Files the first public build (2026-09-28) put beside the launcher; the logger no longer reads them.
foreach ($f in 'logger-status.txt', 'Make shareable log.cmd', 'READ ME FIRST.txt', 'damage-probe-enable.txt', 'dumper-disable.txt') {
    $p = Join-Path $GameFolder $f
    if (Test-Path $p) { Remove-Item $p -Force }
}
$oldTools = Join-Path $GameFolder 'logger-tools'
if (Test-Path (Join-Path $oldTools 'share.mjs')) { Remove-Item $oldTools -Recurse -Force }
$oldLicense = Join-Path $GameFolder 'LICENSE'
if ((Test-Path $oldLicense) -and ((Get-Content $oldLicense -TotalCount 1) -match 'GNU AFFERO')) { Remove-Item $oldLicense -Force }

Say ''
Say 'Installed. Start the game with remielle.exe as usual.'
Say "Battles will appear in: $logs"
