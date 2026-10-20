# RView

RView is a small image viewer with two launch modes:

- **Local desktop mode**: a PyWebView window backed by Python.
- **Browser mode**: a local Flask server that serves the same web UI.

It supports thumbnail browsing, fullscreen viewing, zoom and pan, auto-rotation for portrait/landscape mismatches, moving images to favorite folders, deleting images, opening adjacent folders, and keyboard shortcuts.

Image lists contain metadata only. The viewer retains decoded images up to 100
positions on either side, prioritizing immediate neighbours and the next 30.
A ready image replaces the displayed node immediately; on a cache miss the old
image stays visible until decoding completes. The cache reserves encoded copies
and decoded pixels against 1/8 of the browser-reported device memory (fallback
256 MiB, maximum 1 GiB). Half is reserved for display/decode transitions. The
nearest images fit first and distant entries are evicted. An individual image
that exceeds the allowance uses a 320-pixel preview instead of its original.
A single prefetch worker discards responses that are no longer wanted after
a jump or folder change. An evicted display keeps its pixels until replacement
is ready, then releases its source. Failed images do not reserve cache space,
so neighbouring images can still load and navigation can continue.
This is a conservative image allocation budget, not a limit on the entire OS
process. Thumbnail previews are loaded only near the visible thumbnail area. Folder changes discard unfinished responses from
the previous folder. The window title includes the current folder name.

Favorite slot 1 uses a sibling directory whose name is the selected image directory
plus `f`; slot 2 uses the same rule with `g`. For example, images in `sample`
are moved to `samplef` and `sampleg`. If an identical same-name file already
exists there, it is kept and the source is removed. Different content with the
same name receives a numbered suffix (`_1`, `_2`, ...).

## Requirements

- Python 3.12 or newer
- `uv`
- Windows is recommended for the desktop build. Browser mode also works on Linux and WSL.

## Setup

Install runtime dependencies from the repository root:

```bash
uv sync --locked --python 3.12
```

For Windows executable builds, install the build extra:

```bash
uv sync --locked --python 3.12 --extra build
```

## 作り直す

Install Git, `uv` and Python 3.12 (the version used for the rebuild check).
On Debian/Ubuntu, Chromium also needs system libraries such as `libnspr4` and
`libnss3`. `scripts/rebuild_check.sh` supplies those two from distribution
packages in its temporary directory if they are absent. Other missing browser
libraries must be installed for the host OS. No GPU is needed.

From a checkout, run the whole fresh-origin-clone check with a temporary parent
directory. The script creates and removes its own subdirectory; it does not
delete the parent. Allow about 400 MiB for Chromium and dependencies during
the check. It uses synthetic images only and never opens a browser window.

```bash
mkdir -p ~/akari-data/tmp/20261020-rview-rebuild
./scripts/rebuild_check.sh ~/akari-data/tmp/20261020-rview-rebuild
rmdir ~/akari-data/tmp/20261020-rview-rebuild
```

To rebuild manually from origin on Linux/WSL:

```bash
git clone <repository-url> rview
cd rview
uv sync --locked --python 3.12 --group test
uv pip check --python .venv/bin/python
.venv/bin/python cli.py --help
.venv/bin/python remote/server.py --help
```

`uv.lock` fixes all Python dependency versions, including the `test` group.
Install the matching headless browser and run the tests with a disposable
scratch directory outside any real image collection:

```bash
export RVIEW_SCRATCH='<temporary-directory>'
mkdir -p "$RVIEW_SCRATCH"
export TMPDIR="$RVIEW_SCRATCH"
export PLAYWRIGHT_BROWSERS_PATH="$RVIEW_SCRATCH/browsers"
.venv/bin/python -m playwright install chromium --only-shell
.venv/bin/python -m pytest -q -p no:cacheprovider test --basetemp "$RVIEW_SCRATCH/pytest"
```

Set `PLAYWRIGHT_BROWSERS_PATH` before browser installation and testing. If
Chromium reports missing libraries, install the prerequisites for your OS before
rerunning. A skipped browser test is not a complete rebuild check.

Restore the image collection from its external data storage or backup. Keep
directory names and the sibling `f`/`g` favorite folders together, along with
each directory's `rview-ratings.jsonl`. Those names and files carry the existing
favorite and rating state. Keep collection data outside the source repository.
Optional duplicate-maintenance TSVs also belong in external data storage;
pass their restored location to `scripts/dedupe_favorites.py --ledger`, or
restore a local symlink if an existing invocation uses `maintenance/`.
No account, model, database or external generation service is required.

Start with an empty folder or disposable sample images, then open the displayed
loopback URL and check thumbnails, navigation and ratings:

```bash
.venv/bin/python remote/server.py <image-directory> --host 127.0.0.1 --port 5000 --no-browser
```

Use a different free port if 5000 is occupied. Stop this process with Ctrl+C
when done. Favorite and deletion checks should use disposable copies because
they change files. Use your restored collection only after the smoke check.

For native desktop mode, Windows is the recommended target: install the same
project into a Windows Python environment, then run `local/rview.py` with the
image directory. Linux desktop mode additionally needs a working display and
a pywebview GTK or Qt backend with its Python bindings; the base project install
alone does not supply those bindings. The local script treats its first argument
as a directory and does not implement `--help`.
For Windows packaging, install `.[build]` in the Windows environment and follow
the Windows EXE Build section and [WSL development notes](WSL_DEVELOPMENT.md).
Executable outputs are disposable builds, not collection backups.

### 1台の PC に寄せるとき

- Repo 外の必須データ: 画像コレクションと隣接する `f`/`g` フォルダ、各フォルダの `rview-ratings.jsonl`。実際の保存先は利用者が選ぶ。既存のコレクションが `C:\data\akari` にあればそこから移す。`~/akari-data` に固有の必須データはない。
- 任意のデータ: 重複整理の TSV と、それを指す `maintenance/` のリンク。使っている場合だけ移す。
- 秘密: API キーやトークンは不要。ほかの repo、モデル、外部サービスへの依存もない。
- 常駐・cron: この repo の必須のものはない。閲覧時に `remote/server.py` を起動するか、Windows EXE を開く。
- Linux/WSL で確認した範囲: 新規 clone、固定依存の導入、合成画像の試験。Windows の EXE 作成、デスクトップ画面、クリップボードとダイアログは Linux の試験では確認できない。Windows での確認には Windows Python 3.12、PowerShell、PyInstaller、画面環境が要る。

## Local Desktop Mode

```bash
./.venv/bin/python local/rview.py path/to/images
```

If no folder is provided, RView opens the current working directory.

Windows-only behavior:

- `Ctrl+C` copies the current image to the Windows clipboard.
- Folder drag and drop depends on the desktop webview backend.

## Browser Mode

```bash
./.venv/bin/python remote/server.py path/to/images --port 5000
```

By default, the server binds to `127.0.0.1`. To expose it to another machine on a trusted network, pass an explicit host:

```bash
./.venv/bin/python remote/server.py path/to/images --host 0.0.0.0 --port 5000 --no-browser
```

Browser mode has no authentication. Do not bind it to a public interface unless you add access control or place it behind a trusted gateway. File operations are intended for local use only.

## CLI Helpers

The CLI exercises backend file operations without the UI:

```bash
./.venv/bin/python cli.py count --dir path/to/images
./.venv/bin/python cli.py list --dir path/to/images
./.venv/bin/python cli.py favorite --image path/to/images/sample.png --slot 1
./.venv/bin/python cli.py step-dir --dir path/to/images --direction next
./.venv/bin/python cli.py copy-clipboard --image path/to/images/sample.png
```

`favorite` moves the image into the sibling folder suffixed with `f` (slot 1) or `g` (slot 2).
An identical same-name file is kept and the source is removed; different content is moved with a numbered suffix (`_1`, `_2`, ...). The viewer removes the moved image from its list and advances.

`copy-clipboard` only works on Windows.

### Cleaning up legacy favorite copies

For collections created before favorites became moves, compare date folders
with their sibling `f` and `g` folders:

```bash
python scripts/dedupe_favorites.py path/to/images --ledger maintenance/favorites.tsv
python scripts/dedupe_favorites.py path/to/images --ledger maintenance/favorites.tsv --apply
```

The first command records matches without deleting files. Comparison uses file
sizes, the first 1 MiB, then full SHA-256 hashes. The second command rechecks
each match and removes only the date-folder copy; both favorite folders remain
intact. Renamed identical images also match. Changed files and symlinks are kept.
The same TSV records deletion results with Japan-time timestamps. Maintenance
TSVs are ignored by Git because image filenames can be private.

## Windows EXE Build

From Windows:

```bat
cd local
build.bat
```

Each successful build installs the only executable at
`%LOCALAPPDATA%\Programs\RView\RView.exe` and registers folder and folder-background
context menus for the current Windows user. No administrator rights are needed.
The build fails without replacing the installed version if compilation fails;
close RView yourself before rebuilding if Windows reports that it is in use.
There is no viewer launch during building or registration.

From WSL (uses Windows Python/PyInstaller, including a WSL source checkout):

```bash
./local/build_from_wsl.sh
```

Preview the build/install/registration without compiling or changing files or
registry values: `./local/build_from_wsl.sh -DryRun`. To verify compilation
without updating an existing installation, run `./local/build_from_wsl.sh -BuildOnly`;
the resulting executable stays at `local/dist/RView.exe`. A normal build still
updates the established installation and removes the intermediate executable.
Registration and removal scripts also accept `-DryRun` (registration permits a
not-yet-built executable path in this mode).

Headless Windows script checks (no viewer is launched):

```powershell
python -m unittest discover -s test -p test_windows_packaging.py -v
```

Optional Windows build arguments: `-InstallDir 'D:\Apps\RView' -Python 'path\python.exe'`.
Use the same installation directory on every rebuild. The intermediate executable
is removed after installation. Build dependencies: `python -m pip install pyinstaller pywebview Pillow`.

Register an existing installation or remove only RView's two menu entries:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File local\register-context-menu.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File local\unregister-context-menu.ps1
```

Registration accepts `-ExePath` for a custom location. Both scripts touch only
`HKCU\Software\Classes\Directory[\Background]\shell\RView`. The command quotes
the executable and selected folder, including paths with spaces, Japanese,
apostrophes and brackets. A `\.` suffix protects roots and folders ending in a
backslash from Windows command-line quote escaping. Literal double quotes are
not valid Windows folder-name characters; enclosing command-line quotes are
handled by Windows before Python receives the argument.
Windows 11 shows these classic shell verbs under **Show more options**. A native
first-menu extension requires a separate packaged shell extension; this build
uses the simpler per-user registration.

If keeping Send To, use a shortcut pointing at the installed executable instead
of another executable copy. Remove old copies only after identifying their
embedded web assets against this repository's history. Do not delete unknown
executables merely because their filename matches.

## Keyboard Shortcuts

| Key | Action |
| --- | --- |
| A / Left / Numpad 4 | Previous image |
| D / Right / Numpad 6 | Next image |
| W / Up / Numpad 5 | Good (+2), then next image |
| S / Down / Numpad 2 | Bad (-2), then next image |
| Ctrl+Up / Ctrl+Numpad 5 | Slightly good (+1), then next image |
| Ctrl+Down / Ctrl+Numpad 2 | Slightly bad (-1), then next image |
| Insert | Move to favorites |
| Shift+Insert | Move to favorites 2 |
| Ctrl+S | Save as |
| Ctrl+C | Copy image to clipboard |
| `[` | Open previous folder |
| `]` | Open next folder |
| Enter | Toggle menu |
| Delete | Delete image |
| Escape | Close menu / return to thumbnails |
| F11 | Toggle fullscreen |

Ratings append to `rview-ratings.jsonl` in the image directory, with the filename,
rating and UTC time. Rating does not move or modify the image. The last record
for a filename is its current rating; earlier judgments remain available.
Saving must succeed before advancing, and the last image stays selected.
Ctrl+S retains Save As; Ctrl+W is reserved by browsers. Use Ctrl+arrows or
Ctrl+numpad for the weaker ratings. Numpad mappings use physical keys with
either Num Lock setting.

Clicking outside an open menu closes it. A click immediately after regaining
window focus is ignored for menu opening; native focus behavior can vary by
desktop webview backend.

## Supported Image Formats

- PNG
- JPG / JPEG
- WebP
- BMP
- GIF
