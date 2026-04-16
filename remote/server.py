#!/usr/bin/env python3
"""
RView Remote Server
ブラウザからアクセス可能なリモート画像ビューワー
"""

import argparse
import shutil
from pathlib import Path
from typing import List, Dict, Optional
from flask import Flask, jsonify, request, send_file, send_from_directory
from PIL import Image
import threading
import webbrowser

app = Flask(__name__,
    static_folder='../web',
    template_folder='../web')


class RViewRemoteAPI:
    """RViewリモート版のバックエンドAPI"""

    def __init__(self, image_dir: str):
        self.image_dir = Path(image_dir)
        self.favorites_dir = self.image_dir.parent / "favorites"
        self.favorites2_dir = self.image_dir.parent / "favorites2"

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
        """画像の総数を取得"""
        self._update_image_files()
        return len(self._image_files)

    def get_images_batch(self, start: int, count: int) -> Dict:
        """画像を分割して取得"""
        images = []
        end = min(start + count, len(self._image_files))

        for i in range(start, end):
            file_path = self._image_files[i]
            try:
                img_data = self._load_single_image(file_path, i)
                if img_data:
                    images.append(img_data)
            except Exception as e:
                print(f"Error loading image {file_path}: {e}")

        return {
            "images": images,
            "total": len(self._image_files),
            "loaded": end
        }

    def _load_single_image(self, file_path: Path, index: int) -> Dict:
        """単一の画像を読み込む"""
        try:
            # 画像サイズを取得
            with Image.open(file_path) as img:
                width, height = img.size

            # リモート版ではURLを返す
            return {
                "data": f"/api/image/{index}",
                "name": file_path.name,
                "width": width,
                "height": height,
                "size": file_path.stat().st_size,
                "file_path": str(file_path),
                "index": index
            }
        except Exception as e:
            print(f"Error loading image {file_path}: {e}")
            return None

    def get_image_data(self, index: int) -> Optional[Path]:
        """指定インデックスの画像ファイルパスを返す"""
        if 0 <= index < len(self._image_files):
            return self._image_files[index]
        return None

    def add_to_favorites(self, image_path: str) -> bool:
        """画像をお気に入りフォルダにコピー"""
        try:
            source_path = self._resolve_managed_image_path(image_path)
            if not source_path:
                return False
            dest_path = self._get_unique_copy_path(self.favorites_dir, source_path)

            shutil.copy2(source_path, dest_path)
            print(f"Added to favorites: {source_path} -> {dest_path}")
            return True

        except Exception as e:
            print(f"Error adding to favorites: {e}")
            return False

    def add_to_favorites2(self, image_path: str) -> bool:
        """画像をお気に入り2フォルダにコピー"""
        try:
            source_path = self._resolve_managed_image_path(image_path)
            if not source_path:
                return False
            dest_path = self._get_unique_copy_path(self.favorites2_dir, source_path)

            shutil.copy2(source_path, dest_path)
            print(f"Added to favorites2: {source_path} -> {dest_path}")
            return True

        except Exception as e:
            print(f"Error adding to favorites2: {e}")
            return False

    def delete_image(self, image_path: str) -> bool:
        """画像を削除"""
        try:
            file_path = self._resolve_managed_image_path(image_path)
            if not file_path:
                return False
            if file_path.exists():
                file_path.unlink()
                self._update_image_files()
                print(f"Deleted: {file_path}")
                return True
            return False
        except Exception as e:
            print(f"Error deleting file: {e}")
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
                self.favorites_dir = new_path.parent / "favorites"
                self.favorites2_dir = new_path.parent / "favorites2"
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

    def _get_unique_copy_path(self, target_dir: Path, source_path: Path) -> Path:
        """コピー先フォルダを必要時に作成し、重複時は連番を振る"""
        target_dir.mkdir(parents=True, exist_ok=True)
        dest_path = target_dir / source_path.name
        if not dest_path.exists():
            return dest_path

        base_name = dest_path.stem
        ext = dest_path.suffix
        counter = 1
        while dest_path.exists():
            dest_path = target_dir / f"{base_name}_{counter}{ext}"
            counter += 1
        return dest_path

    def _has_supported_images(self, target_dir: Path) -> bool:
        """対象フォルダに対応画像が1枚以上あるか"""
        if not target_dir.exists() or not target_dir.is_dir():
            return False
        for file_path in target_dir.iterdir():
            if file_path.is_file() and file_path.suffix.lower() in self.supported_formats:
                return True
        return False

    def _resolve_managed_image_path(self, image_path: str) -> Optional[Path]:
        """現在の画像一覧に含まれる画像パスだけをファイル操作対象にする"""
        try:
            requested = Path(image_path).resolve()
        except Exception:
            return None
        self._update_image_files()
        for file_path in self._image_files:
            try:
                if file_path.resolve() == requested:
                    return file_path
            except Exception:
                continue
        return None


# グローバルAPIインスタンス
api: Optional[RViewRemoteAPI] = None


# ==================== Flask Routes ====================

@app.route('/')
def index():
    """メインページ"""
    return send_from_directory(app.static_folder, 'index.html')

@app.route('/<path:filename>')
def static_files(filename):
    """静的ファイル配信"""
    return send_from_directory(app.static_folder, filename)

@app.route('/api/count')
def get_count():
    """画像数を取得"""
    return jsonify({"count": api.get_image_count()})

@app.route('/api/current-directory')
def get_current_directory():
    """現在のフォルダを取得"""
    return jsonify({"directory": api.get_current_directory()})

@app.route('/api/images')
def get_images():
    """画像リストを取得（バッチ対応）"""
    start = request.args.get('start', 0, type=int)
    count = request.args.get('count', 30, type=int)
    return jsonify(api.get_images_batch(start, count))

@app.route('/api/image/<int:index>')
def get_image(index):
    """画像データを返す"""
    file_path = api.get_image_data(index)
    if file_path and file_path.exists():
        return send_file(file_path)
    return jsonify({"error": "Image not found"}), 404

@app.route('/api/download/<int:index>')
def download_image(index):
    """画像をダウンロード（名前をつけて保存用）"""
    file_path = api.get_image_data(index)
    if file_path and file_path.exists():
        return send_file(file_path, as_attachment=True, download_name=file_path.name)
    return jsonify({"error": "Image not found"}), 404

@app.route('/api/favorites', methods=['POST'])
def add_to_favorites():
    """お気に入りに追加"""
    data = request.json
    image_path = data.get('image_path')
    if image_path and api.add_to_favorites(image_path):
        return jsonify({"success": True})
    return jsonify({"success": False}), 400

@app.route('/api/favorites2', methods=['POST'])
def add_to_favorites2():
    """お気に入り2に追加"""
    data = request.json
    image_path = data.get('image_path')
    if image_path and api.add_to_favorites2(image_path):
        return jsonify({"success": True})
    return jsonify({"success": False}), 400

@app.route('/api/delete', methods=['POST'])
def delete_image():
    """画像を削除"""
    data = request.json
    image_path = data.get('image_path')
    if image_path and api.delete_image(image_path):
        return jsonify({"success": True})
    return jsonify({"success": False}), 400

@app.route('/api/directory', methods=['POST'])
def change_directory():
    """フォルダを変更"""
    data = request.json
    new_dir = data.get('directory')
    if new_dir and api.change_directory(new_dir):
        return jsonify({"success": True})
    return jsonify({"success": False}), 400

@app.route('/api/directory/step', methods=['POST'])
def step_directory():
    """親フォルダ配下の前後フォルダに移動"""
    data = request.json or {}
    direction = data.get('direction')
    result = api.step_directory(direction)
    if result.get("success"):
        return jsonify(result)
    return jsonify({"success": False}), 400


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="RView Remote Server")
    parser.add_argument("image_dir", nargs="?", default=str(Path.cwd()), help="Image directory")
    parser.add_argument("--port", type=int, default=5000, help="Bind port (default: 5000)")
    parser.add_argument("--host", default="127.0.0.1", help="Bind host (default: 127.0.0.1)")
    parser.add_argument("--no-browser", action="store_true", help="Do not open browser")
    return parser.parse_args()


def main() -> None:
    """メイン関数"""
    global api

    args = _parse_args()
    image_dir = Path(args.image_dir)

    print("RView Remote Server")
    print(f"Image directory: {image_dir}")
    print(f"Host: {args.host}")
    print(f"Port: {args.port}")
    print(f"{'=' * 60}")

    # APIインスタンスを作成
    api = RViewRemoteAPI(str(image_dir))

    # ローカルURLを表示
    local_url = f"http://{args.host}:{args.port}"
    print(f"Local URL: {local_url}")

    # ブラウザを開く
    if not args.no_browser:
        threading.Timer(1.0, lambda: webbrowser.open(local_url)).start()

    # Flaskサーバー起動
    app.run(host=args.host, port=args.port, debug=False, threaded=True)


if __name__ == "__main__":
    main()
