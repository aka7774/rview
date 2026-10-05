param([string]$ExePath = (Join-Path $env:LOCALAPPDATA 'Programs\RView\RView.exe'))
$ErrorActionPreference = 'Stop'
$ExePath = (Resolve-Path -LiteralPath $ExePath).Path
foreach ($kind in @('Directory', 'Directory\Background')) {
    $key = "HKCU:\Software\Classes\$kind\shell\RView"
    New-Item -Path "$key\command" -Force | Out-Null
    # Unicode escapes keep this script compatible with Windows PowerShell 5.1.
    $label = 'RView ' + [char]0x3067 + [char]0x958b + [char]0x304f
    Set-Item -LiteralPath $key -Value $label
    New-ItemProperty -LiteralPath $key -Name Icon -Value ('"' + $ExePath + '",0') -Force | Out-Null
    $argument = if ($kind -eq 'Directory') { '%1' } else { '%V' }
    Set-Item -LiteralPath "$key\command" -Value ('"' + $ExePath + '" "' + $argument + '"')
}
Write-Output "Registered for current user: $ExePath"
