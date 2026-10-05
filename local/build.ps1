param(
    [string]$InstallDir = (Join-Path $env:LOCALAPPDATA 'Programs\RView'),
    [string]$Python = 'python'
)
$ErrorActionPreference = 'Stop'
$env:PYTHONIOENCODING = 'utf-8'
Push-Location $PSScriptRoot
try {
    & $Python -m PyInstaller --clean --noconfirm build_exe.spec
    if ($LASTEXITCODE -ne 0) { throw 'PyInstaller failed; installed executable was not changed.' }
    New-Item -ItemType Directory -Path $InstallDir -Force | Out-Null
    $source = Join-Path $PSScriptRoot 'dist\RView.exe'
    $target = Join-Path $InstallDir 'RView.exe'
    Copy-Item -LiteralPath $source -Destination "$target.new" -Force
    if ((Get-FileHash $source).Hash -ne (Get-FileHash "$target.new").Hash) { throw 'Copy verification failed' }
    # A running executable makes this fail without stopping the user's viewer.
    Move-Item -LiteralPath "$target.new" -Destination $target -Force
    & (Join-Path $PSScriptRoot 'register-context-menu.ps1') -ExePath $target
    Remove-Item -LiteralPath $source
    Write-Output "Installed: $target"
} finally { Pop-Location }
