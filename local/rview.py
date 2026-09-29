#!/usr/bin/env python3
"""
RView - Local Image Viewer
高機能な画像ビューワー（PyWebView + HTML/CSS/JS）
"""

import os
import sys
import shutil
import base64
import io
import time
import ctypes
from pathlib import Path
from typing import Dict, List, Optional
import webview
from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from rview_media import move_to_favorites, image_data_url, managed_image, record_rating


def get_resource_path(relative_path: str) -> Path:
    """PyInstallerでパッケージした場合のリソースパスを取得"""
    if hasattr(sys, '_MEIPASS'):
        # PyInstallerの一時展開ディレクトリ
        return Path(sys._MEIPASS) / relative_path
    # 通常のPython実行時（../webから読み込む）
    return Path(__file__).parent.parent / "web" / relative_path


class RViewAPI:
    """RViewのバックエンドAPI"""

    def __init__(self, image_dir: str):
        self.image_dir = Path(image_dir)
        self._update_favorite_directories()

        # サポートする画像形式
        self.supported_formats = {'.png', '.jpg', '.jpeg', '.webp', '.bmp', '.gif'}

        # 画像ファイルリストのキャッシュ
        self._image_files = []
        self._update_image_files()

    def _update_image_files(self):
        """画像ファイルリストを更新"""
        self._image_files = []
        if self.image_dir.exists():
            for file_path in sorted(self.image_dir.iterdir()):
                if file_path.is_file() and file_path.suffix.lower() in self.supported_formats:
                    self._image_files.append(file_path)

    def get_image_count(self) -> int:
        """画像の総数を取得（高速）"""
        self._update_image_files()
        return len(self._image_files)

    def get_images_batch(self, start: int, count: int) -> Dict:
        """
        画像を分割して取得（段階的読み込み用）
        Args:
            start: 開始インデックス
            count: 取得する画像数
        Returns:
            {"images": [...], "total": 総数, "loaded": 読み込み済み数}
        """
        images = []
        end = min(start + count, len(self._image_files))

        for i in range(start, end):
            file_path = self._image_files[i]
            try:
                img_data = self._load_single_image(file_path)
                if img_data:
                    images.append(img_data)
            except Exception as e:
                print(f"Error loading image {file_path}: {e}")

        return {
            "images": images,
            "total": len(self._image_files),
            "loaded": end
        }

    def _load_single_image(self, file_path: Path) -> Dict:
        """単一の画像を読み込む"""
        try:
            # 画像サイズを取得
            with Image.open(file_path) as img:
                width, height = img.size

            return {
                "name": file_path.name,
                "width": width,
                "height": height,
                "size": file_path.stat().st_size,
                "file_path": str(file_path)
            }
        except Exception as e:
            print(f"Error loading image {file_path}: {e}")
            return None

    def get_image_source(self, image_path: str, thumbnail: bool = False) -> str:
        path = managed_image(self.image_dir, image_path, self.supported_formats)
        return image_data_url(path, thumbnail=thumbnail)

    def rate_image(self, image_path: str, rating: int) -> bool:
        path = managed_image(self.image_dir, image_path, self.supported_formats)
        return record_rating(self.image_dir, path, rating)

    def get_images(self) -> List[Dict]:
        """
        画像ディレクトリから画像リストを取得（互換性用）
        """
        self._update_image_files()
        images = []

        for file_path in self._image_files:
            img_data = self._load_single_image(file_path)
            if img_data:
                images.append(img_data)

        print(f"Found {len(images)} images in {self.image_dir}")
        return images

    def save_as(self, image_path: str) -> bool:
        """画像を名前をつけて保存"""
        try:
            source_path = Path(image_path)

            # ファイルダイアログを表示
            result = webview.windows[0].create_file_dialog(
                webview.SAVE_DIALOG,
                save_filename=source_path.name,
                file_types=('画像ファイル (*.png;*.jpg;*.jpeg)', 'すべてのファイル (*.*)')
            )

            if result:
                dest_path = Path(result)
                shutil.copy2(source_path, dest_path)
                print(f"Saved: {source_path} -> {dest_path}")
                return True

            return False

        except Exception as e:
            print(f"Error saving file: {e}")
            return False

    def add_to_favorites(self, image_path: str) -> bool:
        """画像をお気に入りフォルダに移動"""
        try:
            source_path = managed_image(self.image_dir, image_path, self.supported_formats)
            dest_path = move_to_favorites(source_path, self.favorites_dir)
            self._update_image_files()
            print(f"Added to favorites: {source_path} -> {dest_path}")
            return True

        except Exception as e:
            print(f"Error adding to favorites: {e}")
            return False

    def add_to_favorites2(self, image_path: str) -> bool:
        """画像をお気に入り2フォルダに移動"""
        try:
            source_path = managed_image(self.image_dir, image_path, self.supported_formats)
            dest_path = move_to_favorites(source_path, self.favorites2_dir)
            self._update_image_files()
            print(f"Added to favorites2: {source_path} -> {dest_path}")
            return True

        except Exception as e:
            print(f"Error adding to favorites2: {e}")
            return False

    def change_directory(self, new_dir: str) -> bool:
        """画像フォルダを変更"""
        try:
            new_path = Path(new_dir)
            if (
                new_path.exists()
                and new_path.is_dir()
                and self._has_supported_images(new_path)
            ):
                self.image_dir = new_path
                self._update_favorite_directories()
                self._update_image_files()
                print(f"Changed folder to: {new_path}")
                return True
            return False
        except Exception as e:
            print(f"Error changing folder: {e}")
            return False

    def step_directory(self, direction: str) -> Dict:
        """親フォルダ配下の前後フォルダへ移動（空フォルダはスキップ）"""
        try:
            parent = self.image_dir.parent
            siblings = sorted(
                [path for path in parent.iterdir() if path.is_dir()],
                key=lambda p: p.name.lower()
            )
            if not siblings:
                return {"success": False}

            current_resolved = self.image_dir.resolve()
            current_index = next(
                (
                    index for index, path in enumerate(siblings)
                    if path.resolve() == current_resolved
                ),
                -1
            )
            if current_index < 0:
                return {"success": False}

            if direction == "prev":
                index_range = range(current_index - 1, -1, -1)
            elif direction == "next":
                index_range = range(current_index + 1, len(siblings))
            else:
                return {"success": False}

            for target_index in index_range:
                target_dir = siblings[target_index]
                if not self._has_supported_images(target_dir):
                    continue
                if self.change_directory(str(target_dir)):
                    return {"success": True, "directory": str(target_dir)}

            return {"success": False}
        except Exception as e:
            print(f"Error stepping folder: {e}")
            return {"success": False}

    def get_current_directory(self) -> str:
        """現在の画像フォルダを返す"""
        return str(self.image_dir)

    def select_directory(self) -> str:
        """フォルダ選択ダイアログを開く"""
        try:
            if not webview.windows:
                return ""
            result = webview.windows[0].create_file_dialog(webview.FOLDER_DIALOG)
            if not result:
                return ""
            if isinstance(result, (list, tuple)):
                return str(result[0]) if result else ""
            return str(result)
        except Exception as e:
            print(f"Error selecting folder: {e}")
            return ""

    def copy_image_to_clipboard(self, image_path: str) -> bool:
        """Windowsクリップボードへ画像をコピー"""
        try:
            source_path = Path(image_path)
            if not source_path.exists() or not source_path.is_file():
                return False

            if os.name != "nt":
                print("Clipboard copy is only supported on Windows.")
                return False

            with Image.open(source_path) as image:
                output = io.BytesIO()
                image.convert("RGB").save(output, format="BMP")
            dib_data = output.getvalue()[14:]

            return self._set_windows_clipboard_dib(dib_data)
        except Exception as e:
            print(f"Error copying image to clipboard: {e}")
            return False

    def _update_favorite_directories(self) -> None:
        """画像フォルダ名の末尾へ f/g を付けた隣接フォルダを設定する。"""
        self.favorites_dir = self.image_dir.with_name(f"{self.image_dir.name}f")
        self.favorites2_dir = self.image_dir.with_name(f"{self.image_dir.name}g")

    def _has_supported_images(self, target_dir: Path) -> bool:
        """対象フォルダに対応画像が1枚以上あるか"""
        if not target_dir.exists() or not target_dir.is_dir():
            return False
        for file_path in target_dir.iterdir():
            if file_path.is_file() and file_path.suffix.lower() in self.supported_formats:
                return True
        return False

    def _set_windows_clipboard_dib(self, dib_data: bytes) -> bool:
        """CF_DIB形式でクリップボードへ画像を書き込む"""
        CF_DIB = 8
        GMEM_MOVEABLE = 0x0002

        user32 = ctypes.windll.user32
        kernel32 = ctypes.windll.kernel32

        kernel32.GlobalAlloc.argtypes = [ctypes.c_uint, ctypes.c_size_t]
        kernel32.GlobalAlloc.restype = ctypes.c_void_p
        kernel32.GlobalLock.argtypes = [ctypes.c_void_p]
        kernel32.GlobalLock.restype = ctypes.c_void_p
        kernel32.GlobalUnlock.argtypes = [ctypes.c_void_p]
        kernel32.GlobalFree.argtypes = [ctypes.c_void_p]
        user32.OpenClipboard.argtypes = [ctypes.c_void_p]
        user32.OpenClipboard.restype = ctypes.c_int
        user32.EmptyClipboard.restype = ctypes.c_int
        user32.SetClipboardData.argtypes = [ctypes.c_uint, ctypes.c_void_p]
        user32.SetClipboardData.restype = ctypes.c_void_p
        user32.CloseClipboard.restype = ctypes.c_int

        for _ in range(20):
            if user32.OpenClipboard(None):
                break
            time.sleep(0.05)
        else:
            print("Error copying image to clipboard: clipboard is busy")
            return False

        global_mem = None
        try:
            if not user32.EmptyClipboard():
                return False

            size = len(dib_data)
            global_mem = kernel32.GlobalAlloc(GMEM_MOVEABLE, size)
            if not global_mem:
                return False

            locked_mem = kernel32.GlobalLock(global_mem)
            if not locked_mem:
                kernel32.GlobalFree(global_mem)
                return False

            ctypes.memmove(locked_mem, dib_data, size)
            kernel32.GlobalUnlock(global_mem)

            if not user32.SetClipboardData(CF_DIB, global_mem):
                kernel32.GlobalFree(global_mem)
                return False

            global_mem = None  # クリップボードへ所有権移譲
            return True
        finally:
            user32.CloseClipboard()

    def set_window_title(self, title: str) -> bool:
        """ウィンドウタイトルを設定"""
        try:
            if webview.windows:
                webview.windows[0].set_title(title)
            return True
        except Exception as e:
            print(f"Error setting title: {e}")
            return False

    def delete_image(self, image_path: str) -> bool:
        """画像を削除"""
        try:
            file_path = Path(image_path)

            if file_path.exists():
                file_path.unlink()
                print(f"Deleted: {file_path}")
                return True

            return False

        except Exception as e:
            print(f"Error deleting file: {e}")
            return False

    def toggle_fullscreen(self) -> bool:
        """全画面モードを切り替え"""
        try:
            webview.windows[0].toggle_fullscreen()
            return True
        except Exception as e:
            print(f"Error toggling fullscreen: {e}")
            return False

    def quit_app(self) -> bool:
        """アプリケーションを終了"""
        try:
            webview.windows[0].destroy()
            return True
        except Exception as e:
            print(f"Error quitting app: {e}")
            return False


def main():
    """メイン関数"""
    # デフォルトの画像ディレクトリ
    if len(sys.argv) > 1:
        image_dir = Path(sys.argv[1])
    else:
        # デフォルト: カレントディレクトリ
        image_dir = Path.cwd()

    print(f"RView - Local Image Viewer")
    print(f"Image directory: {image_dir}")
    print(f"=" * 60)

    # APIインスタンスを作成
    api = RViewAPI(str(image_dir))

    # HTMLファイルのパス（PyInstaller対応）
    html_path = get_resource_path("index.html")

    # WebViewウィンドウを作成
    window = webview.create_window(
        title='RView',
        url=str(html_path),
        js_api=api,
        width=1280,
        height=720,
        resizable=True,
        fullscreen=False,
        background_color='#1a1a1a'
    )

    # アプリケーション起動
    webview.start(debug=False)


if __name__ == "__main__":
    main()
