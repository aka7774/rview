# WSL Development Notes

These notes describe how to edit RView from WSL and build the Windows executable with Windows tooling.

## Key Limitation

PyInstaller does not support cross-compiling Windows executables from Linux. Running PyInstaller inside WSL creates a Linux binary, not a Windows `.exe`.

```bash
# This creates a Linux binary when run inside WSL.
pyinstaller --onefile rview.py
```

## Recommended Build Path

Use Windows Python and Windows PyInstaller from PowerShell 7.

```bash
RVIEW_WIN_DIR='<WINDOWS_REPO_PATH>\local' ./local/build_from_wsl.sh
```

The helper sets UTF-8 output handling and runs:

```powershell
python -m PyInstaller --clean build_exe.spec
```

If you use a Windows virtual environment, make sure its `Scripts\python.exe` is the Python resolved by the command.

## Manual PowerShell Command

```bash
"/mnt/c/Program Files/PowerShell/7/pwsh.exe" -NoProfile -Command "
    \$env:PYTHONIOENCODING='utf-8';
    [Console]::OutputEncoding = [System.Text.Encoding]::UTF8;
    Set-Location '<WINDOWS_REPO_PATH>\local';
    python -m PyInstaller --clean build_exe.spec
"
```

## Notes

- PowerShell 7 is recommended because UTF-8 output is easier to control.
- `cmd.exe` can work, but Japanese output may be garbled.
- Building from files under `/mnt/c/` can be slower than building on a native Linux filesystem, but the final Windows `.exe` must be built by Windows Python.
- Install build dependencies with `uv pip install -e ".[build]"` or install `pyinstaller pywebview Pillow` in the Windows environment you use for the build.
