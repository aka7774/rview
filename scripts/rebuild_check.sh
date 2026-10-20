#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 1 || ! -d "$1" ]]; then
  echo "Usage: $0 <existing empty-or-shared temporary parent directory>" >&2
  exit 2
fi

command -v git >/dev/null
command -v uv >/dev/null
command -v python3.12 >/dev/null
command -v mktemp >/dev/null

repo_root=$(git -C "$(dirname "$0")" rev-parse --show-toplevel)
origin=$(git -C "$repo_root" remote get-url origin)
scratch=$(mktemp -d "$1/rview-rebuild.XXXXXXXX")
trap 'rm -rf -- "$scratch"' EXIT
export UV_CACHE_DIR="$scratch/uv-cache"
export UV_PYTHON_DOWNLOADS=never
export PLAYWRIGHT_BROWSERS_PATH="$scratch/browsers"
export TMPDIR="$scratch/tmp"
mkdir -p "$TMPDIR"

git clone --quiet "$origin" "$scratch/rview"
cd "$scratch/rview"
uv sync --locked --python 3.12 --group test
uv pip check --python .venv/bin/python
.venv/bin/python cli.py --help >/dev/null
.venv/bin/python remote/server.py --help >/dev/null
.venv/bin/python -m playwright install chromium --only-shell

# On Debian/Ubuntu without administrator access, unpack the missing Chromium
# libraries inside the disposable scratch directory.
browser=$(find "$PLAYWRIGHT_BROWSERS_PATH" -name chrome-headless-shell -type f -print -quit)
if [[ -n "$browser" ]] && ldd "$browser" | grep -qE 'lib(nspr4|nss3|nssutil3)\.so => not found'; then
  command -v apt-get >/dev/null || { echo "Install libnspr4 and libnss3 for Chromium" >&2; exit 1; }
  command -v dpkg-deb >/dev/null
  mkdir -p "$scratch/debs" "$scratch/os-libs"
  (cd "$scratch/debs" && apt-get download libnspr4 libnss3)
  for package in "$scratch"/debs/*.deb; do
    dpkg-deb -x "$package" "$scratch/os-libs"
  done
  export LD_LIBRARY_PATH="$scratch/os-libs/usr/lib/x86_64-linux-gnu${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
fi

.venv/bin/python -m pytest -q -p no:cacheprovider test --basetemp "$scratch/pytest"
echo "Rebuild passed; temporary clone and downloads will be removed."
