#!/bin/bash
set -euo pipefail

PWSH="/mnt/c/Program Files/PowerShell/7/pwsh.exe"
APP_WIN_DIR="${RVIEW_WIN_DIR:-}"

if [ -z "$APP_WIN_DIR" ]; then
  echo "Set RVIEW_WIN_DIR to the Windows path of this repository's local folder."
  echo "Example: RVIEW_WIN_DIR='<WINDOWS_REPO_PATH>\\local' ./build_from_wsl.sh"
  exit 1
fi

"$PWSH" -NoProfile -Command "
  \$env:PYTHONIOENCODING='utf-8';
  [Console]::OutputEncoding = [System.Text.Encoding]::UTF8;
  Set-Location '$APP_WIN_DIR';
  python -m PyInstaller --clean build_exe.spec;
  if (\$LASTEXITCODE -ne 0) { exit 1 }
  if (Test-Path '..\\dist\\RView.exe') { Remove-Item '..\\dist\\RView.exe' -Force }
  if (Test-Path 'dist\\RView.exe') { Move-Item 'dist\\RView.exe' '..\\dist\\' }
  if (Test-Path 'build') { Remove-Item 'build' -Recurse -Force }
  if (Test-Path 'dist') { Remove-Item 'dist' -Recurse -Force }
"
