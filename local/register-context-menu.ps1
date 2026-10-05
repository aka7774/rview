param(
    [string]$ExePath = (Join-Path $env:LOCALAPPDATA 'Programs\RView\RView.exe'),
    [switch]$DryRun
)
$ErrorActionPreference = 'Stop'
if ($DryRun) {
    $ExePath = [IO.Path]::GetFullPath($ExePath)
} else {
    $ExePath = (Resolve-Path -LiteralPath $ExePath).Path
    if (-not (Test-Path -LiteralPath $ExePath -PathType Leaf)) { throw 'Executable must be a file.' }
}
if ($ExePath.Contains('"')) { throw 'Executable path cannot contain a double quote.' }
foreach ($kind in @('Directory', 'Directory\Background')) {
    $key = "HKCU:\Software\Classes\$kind\shell\RView"
    $argument = if ($kind -eq 'Directory') { '%1' } else { '%V' }
    # Appending \. preserves roots/trailing separators under Windows argv parsing.
    $command = '"' + $ExePath + '" "' + $argument + '\."'
    if ($DryRun) {
        Write-Output "$key : $command"
        continue
    }
    New-Item -Path "$key\command" -Force | Out-Null
    # Unicode escapes keep this script compatible with Windows PowerShell 5.1.
    $label = 'RView ' + [char]0x3067 + [char]0x958b + [char]0x304f
    Set-Item -LiteralPath $key -Value $label
    New-ItemProperty -LiteralPath $key -Name Icon -Value ('"' + $ExePath + '",0') -Force | Out-Null
    Set-Item -LiteralPath "$key\command" -Value $command
}
if (-not $DryRun) { Write-Output "Registered for current user: $ExePath" }
