# Windows builds from WSL

Run `./local/build_from_wsl.sh` from a source checkout. It translates the source
path with `wslpath` and invokes Windows PowerShell and Windows Python. PyInstaller
does not cross-compile: Linux Python produces a Linux executable.

Install Windows build dependencies first:

```powershell
python -m pip install pyinstaller pywebview Pillow
```

Override `RVIEW_POWERSHELL` or `RVIEW_WIN_DIR` (the Windows path to the local
source directory) when necessary. Optional arguments are forwarded to
`local/build.ps1`, for example `-Python 'C:\Python\python.exe'`.

A successful build replaces `%LOCALAPPDATA%\Programs\RView\RView.exe` and
registers the current user's context menu. Use `-InstallDir` consistently if
choosing another location. The viewer is never launched by these scripts.
See [README](README.md#windows-exe-build) for registration and removal.
