#!/bin/bash
set -euo pipefail
PWSH="${RVIEW_POWERSHELL:-/mnt/c/Windows/System32/WindowsPowerShell/v1.0/powershell.exe}"
APP_WIN_DIR="${RVIEW_WIN_DIR:-$(wslpath -w "$(cd "$(dirname "$0")" && pwd)")}"
"$PWSH" -NoProfile -ExecutionPolicy Bypass -File "$APP_WIN_DIR\build.ps1" "$@"
