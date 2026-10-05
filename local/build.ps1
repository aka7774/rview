param(
    [string]$InstallDir = (Join-Path $env:LOCALAPPDATA 'Programs\RView'),
    [string]$Python = 'python',
    [switch]$DryRun,
    [switch]$BuildOnly
)
$ErrorActionPreference = 'Stop'
if ($DryRun) {
    Write-Output "Build: $Python -m PyInstaller --clean --noconfirm build_exe.spec"
    if ($BuildOnly) {
        Write-Output "Keep build: $(Join-Path $PSScriptRoot 'dist\RView.exe')"
    } else {
        & (Join-Path $PSScriptRoot 'register-context-menu.ps1') -ExePath (Join-Path $InstallDir 'RView.exe') -DryRun
        Write-Output "Install verified build: $(Join-Path $InstallDir 'RView.exe')"
    }
    return
}
# Keep PyInstaller's --clean away from other checkouts' shared cache.
$previousCache = $env:PYINSTALLER_CONFIG_DIR
$env:PYINSTALLER_CONFIG_DIR = Join-Path $PSScriptRoot 'build\pyinstaller-cache'
$env:PYTHONIOENCODING = 'utf-8'
Push-Location $PSScriptRoot
try {
    & $Python -m PyInstaller --clean --noconfirm build_exe.spec
    if ($LASTEXITCODE -ne 0) { throw 'PyInstaller failed; installed executable was not changed.' }
    if ($BuildOnly) {
        Write-Output "Built without installation: $(Join-Path $PSScriptRoot 'dist\RView.exe')"
        return
    }
    New-Item -ItemType Directory -Path $InstallDir -Force | Out-Null
    $source = Join-Path $PSScriptRoot 'dist\RView.exe'
    $target = Join-Path $InstallDir 'RView.exe'
    Copy-Item -LiteralPath $source -Destination "$target.new" -Force
    if ((Get-FileHash -LiteralPath $source).Hash -ne (Get-FileHash -LiteralPath "$target.new").Hash) { throw 'Copy verification failed' }
    # A running executable makes this fail without stopping the user's viewer.
    Move-Item -LiteralPath "$target.new" -Destination $target -Force
    & (Join-Path $PSScriptRoot 'register-context-menu.ps1') -ExePath $target
    Remove-Item -LiteralPath $source
    Write-Output "Installed: $target"
} finally {
    Pop-Location
    $env:PYINSTALLER_CONFIG_DIR = $previousCache
}
