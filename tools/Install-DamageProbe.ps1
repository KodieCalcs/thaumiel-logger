$ErrorActionPreference = 'Stop'
try {
    Set-Location -LiteralPath $PSScriptRoot
    $probePayload = [IO.File]::ReadAllBytes((Join-Path $PSScriptRoot 'damage-probe-ready.dll'))
    $probeHash = (Get-FileHash -LiteralPath (Join-Path $PSScriptRoot 'damage-probe-ready.dll') -Algorithm SHA256).Hash
    if ($probeHash -ne '092AC6B996CEFEDADD3868D3FA6F13EFB28D836E181C076FF9B2547F1C71F437') { throw 'Probe checksum mismatch.' }
    $probeTarget = Join-Path $PSScriptRoot 'thaumiel.dll'
    $probeStream = [IO.File]::Open($probeTarget,[IO.FileMode]::Open,[IO.FileAccess]::ReadWrite,[IO.FileShare]::None)
    try {
        $probeBackup = Join-Path $PSScriptRoot ('damage-probe-backup-' + (Get-Date -Format 'yyyyMMdd-HHmmss-fff'))
        New-Item -ItemType Directory -Path $probeBackup | Out-Null
        $probeOld = New-Object byte[] $probeStream.Length
        $probeRead = 0
        while ($probeRead -lt $probeOld.Length) {
            $probeCount = $probeStream.Read($probeOld,$probeRead,$probeOld.Length-$probeRead)
            if ($probeCount -eq 0) { throw 'Could not read original DLL for backup.' }
            $probeRead += $probeCount
        }
        [IO.File]::WriteAllBytes((Join-Path $probeBackup 'thaumiel.dll'),$probeOld)
        # Logs need no backup: every launch writes its own captures\<session>\ (capture.zig).
        try {
            $probeStream.Position = 0
            $probeStream.SetLength($probePayload.Length)
            $probeStream.Write($probePayload,0,$probePayload.Length)
            $probeStream.Flush($true)
        } catch {
            $probeStream.Position = 0
            $probeStream.SetLength($probeOld.Length)
            $probeStream.Write($probeOld,0,$probeOld.Length)
            $probeStream.Flush($true)
            throw
        }
    } finally { $probeStream.Dispose() }
    if ((Get-FileHash -LiteralPath $probeTarget -Algorithm SHA256).Hash -ne $probeHash) { throw 'Installed checksum mismatch.' }
    [IO.File]::WriteAllText((Join-Path $PSScriptRoot 'damage-probe-enable.txt'),'')
    Write-Host 'Damage probe installed. Starting your existing launcher.'
    Start-Process -FilePath (Join-Path $PSScriptRoot 'remielle.exe') -WorkingDirectory $PSScriptRoot
} catch {
    Write-Host $_.Exception.Message
    Write-Host 'If the DLL is in use, close the game and run this again.'
    Read-Host 'Press Enter to close'
    exit 1
}
