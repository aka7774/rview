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
uv venv
uv pip install -e .
```

For Windows executable builds, install the build extra:

```bash
uv pip install -e ".[build]"
```

## 作り直す

These steps rebuild browser mode from source on Linux/WSL without reusing an
existing virtual environment. Use Python 3.12 or newer, Git and `uv`; Chromium
tests also need the OS libraries listed by Playwright's browser installer.
On Windows, use `.venv\Scripts\python.exe` instead of `.venv/bin/python`.

Clone this repository's Git remote into your chosen source directory, then
create a new environment:

```bash
git clone <repository-url> rview
cd rview
uv venv --python 3.12
uv pip install -e .
uv pip check
.venv/bin/python cli.py --help
.venv/bin/python remote/server.py --help
```

The runtime dependencies are declared in `pyproject.toml`. There is no dependency
lockfile: rebuilding resolves available versions subject to its lower bounds.
The isolated Linux check on 2026-10-02 used Python 3.12.3, Flask 3.1.3,
Pillow 12.3.0 and pywebview 6.2.1.

Install test dependencies and the browser, then run the existing tests against
synthetic images. `RVIEW_SCRATCH` must be a writable temporary directory outside
your real image collection; remove it after the checks finish.

```bash
uv pip install pytest playwright psutil
export RVIEW_SCRATCH='<temporary-directory>'
mkdir -p "$RVIEW_SCRATCH"
export TMPDIR="$RVIEW_SCRATCH"
export PLAYWRIGHT_BROWSERS_PATH="$RVIEW_SCRATCH/browsers"
.venv/bin/python -m playwright install chromium
.venv/bin/python -m pytest -q -p no:cacheprovider test --basetemp "$RVIEW_SCRATCH/pytest"
```

If Chromium reports missing system libraries, install the prerequisites for
your OS before rerunning. Without Playwright, the two browser tests are skipped;
that is only a backend check, not a complete browser verification.

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

The 2026-10-02 rebuild check covered a fresh Linux environment, backend tests,
headless Chromium tests and loopback server startup with synthetic data.
All 33 tests passed. Chromium's missing NSS/NSPR libraries were supplied from
distribution packages in a temporary directory for that check; a new machine
must provide these OS dependencies too.
Native desktop startup, Windows clipboard/dialogs and Windows EXE rebuilding
were not verified on that environment.

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
the executable and selected folder, including paths with spaces and Japanese.
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
