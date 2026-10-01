# RView

RView is a small image viewer with two launch modes:

- **Local desktop mode**: a PyWebView window backed by Python.
- **Browser mode**: a local Flask server that serves the same web UI.

It supports thumbnail browsing, fullscreen viewing, zoom and pan, auto-rotation for portrait/landscape mismatches, moving images to favorite folders, deleting images, opening adjacent folders, and keyboard shortcuts.

Image lists contain metadata only. RView loads the displayed original on demand,
and uses previews of at most 320 pixels near the visible thumbnail area. Images
outside that area are released. Folder changes discard unfinished responses from
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

## Windows EXE Build

From Windows:

```bat
cd local
build.bat
```

The executable is written to `dist\RView.exe`. Build outputs are ignored by Git.

From WSL, call Windows PowerShell 7 and Windows Python/PyInstaller through the helper:

```bash
RVIEW_WIN_DIR='<WINDOWS_REPO_PATH>\local' ./local/build_from_wsl.sh
```

PyInstaller does not cross-compile Windows executables from Linux. If you run PyInstaller inside WSL directly, it will create a Linux binary instead of a Windows `.exe`.

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
