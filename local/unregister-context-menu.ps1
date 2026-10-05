$ErrorActionPreference = 'Stop'
foreach ($kind in @('Directory', 'Directory\Background')) {
    $key = "HKCU:\Software\Classes\$kind\shell\RView"
    if (Test-Path -LiteralPath $key) { Remove-Item -LiteralPath $key -Recurse -Force }
}
