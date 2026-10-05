param([switch]$DryRun)
$ErrorActionPreference = 'Stop'
foreach ($kind in @('Directory', 'Directory\Background')) {
    $key = "HKCU:\Software\Classes\$kind\shell\RView"
    if ($DryRun) { Write-Output "Remove if present: $key"; continue }
    if (Test-Path -LiteralPath $key) { Remove-Item -LiteralPath $key -Recurse -Force }
}
