# 前後100枚の先読みを再現する

2026-10-06（日本時間）。既存の先読み実装を使用し、実装の重複追加はしていない。

`web/script.js` は現在画像を含む前後各100枚を候補にする。画像の幅×高さ×8と
ファイルサイズ×4を予約量として、デコード後の画素とエンコード済みデータを
保守的に計上する。ブラウザの deviceMemory の1/8相当（未提供なら256MiB、
最大1GiB）が画像予算で、半分をキャッシュ、半分を表示切替とデコードに残す。
近い候補から予算に収め、1枚でキャッシュ予算を超える画像は320pxプレビューを
使う。この予算はOSプロセス全体のRSSの上限ではない。

## ヘッドレス試験

READMEの手順でPython環境、pytest、playwright、psutil、Chromiumを準備する。
合成画像だけを使用し、既存の画像コレクションを指定しない。
以下のSCRATCHには、その作業専用の一時ディレクトリを指定する。

```bash
export SCRATCH='<task-temporary-directory>'
mkdir -p "$SCRATCH"
export TMPDIR="$SCRATCH"
.venv/bin/python -m pytest -q -p no:cacheprovider test \
  --basetemp "$SCRATCH/pytest"
```

ChromiumにNSS/NSPRが不足している環境では、システムを変更せず一時領域に展開できる。

```bash
mkdir -p "$SCRATCH/browser-libs"
cd "$SCRATCH/browser-libs"
apt-get download libnspr4 libnss3
for package in ./*.deb; do dpkg-deb -x "$package" root; done
export LD_LIBRARY_PATH="$SCRATCH/browser-libs/root/usr/lib/x86_64-linux-gnu${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
cd '<source-checkout>'
```

キャッシュの確認対象は `test/test_browser.py` の次の3試験。

- `test_prefetch_window_no_blank_and_memory_bound`: 3500枚の小画像で中央の201枚
  （現在＋左右各100枚）を保持する。前後のキャッシュヒットは同期表示し、
  ミスでも以前の画像を保持する。離れた場所への反復移動後も半予算と範囲を守る。
- `test_large_directory_and_human_review_controls`: 4096×2048 BMPの反復移動で
  キャッシュ予約量を半予算以下に保ち、試験プロセスの子プロセス群のRSSも測る。
  フォルダ変更後に古い一覧応答が混入しないことも確認する。
- `test_oversized_preview_and_stale_sources`（今回追加）: deviceMemoryを2に固定する。
  6000×6000 PNGが256MiB予算で320px表示になることを確認する。取得済みの
  画像ソース応答を明示的に保留し、方向反転後とフォルダ変更後に解放する。
  表示関数の呼出し対象が常に選択画像であること、新フォルダの120px画像だけが
  最終表示・キャッシュに残ること、予約量とJavaScriptエラーの有無を検査する。

## Windows EXEのビルドと内容確認

Windows Pythonに既存のPyInstaller、pywebview、Pillowが必要。
WSLのソースチェックアウトから次を実行する。画面起動・登録・配布は行わない。

```bash
./local/build_from_wsl.sh -BuildOnly
```

成果物はチェックアウト内の `local/dist/RView.exe`（Gitのignore対象）。
今回のビルドはWindows Python 3.11.9、PyInstaller 6.22.3で成功し、
EXEは34,720,867 bytes。Python要件に沿ったソース試験はLinux Python 3.12で行った。
EXEは起動せず、内包するWeb資源がソースと一致することを次で確認した。
PyInstallerのarchive readerを使えるPython環境で実行する。

```bash
.venv/bin/python - <<'PY'
from pathlib import Path
from PyInstaller.archive.readers import CArchiveReader
archive = CArchiveReader('local/dist/RView.exe')
for name in ('script.js', 'style.css', 'index.html'):
    assert archive.extract(name) == Path('web', name).read_bytes(), name
print('embedded web assets match source')
PY
```

全体試験は35件成功、Windows専用の3件はLinuxではスキップされた。
続いて既存のWindows Pythonで次を実行し、3件すべて成功した。

```bash
python.exe -m unittest discover -s test -p test_windows_packaging.py -v
```
CLIとサーバの`--help`による読込確認も成功した。
Windows GUIでの表示・WebView2の実メモリ測定はこの試験に含まない。
作業用worktree内のEXEは引き継ぎのため残す。worktree削除前に、必要なビルド成果を
保持し、commitのoriginへのpushを済ませる。
