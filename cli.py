#!/usr/bin/env python3
"""RView CLI helper for exercising backend actions without the WebUI."""

from __future__ import annotations

import argparse
import json
import os
import shutil
import io
import time
import ctypes
from pathlib import Path
from typing import Any, Dict, List

from PIL import Image
from rview_media import move_to_favorites

SUPPORTED_FORMATS = {".png", ".jpg", ".jpeg", ".webp", ".bmp", ".gif"}


def _print_json(payload: Any) -> None:
    print(json.dumps(payload, ensure_ascii=False, indent=2))


def _list_images(image_dir: Path) -> List[Path]:
    if not image_dir.exists():
        return []
    return [
        path
        for path in sorted(image_dir.iterdir())
        if path.suffix.lower() in SUPPORTED_FORMATS
    ]


def _image_meta(path: Path) -> Dict[str, Any]:
    with Image.open(path) as img:
        width, height = img.size
    return {
        "name": path.name,
        "path": str(path),
        "width": width,
        "height": height,
        "size": path.stat().st_size,
    }


def _favorites_dir(image_dir: Path, slot: int) -> Path:
    suffix = "g" if slot == 2 else "f"
    target = image_dir.with_name(f"{image_dir.name}{suffix}")
    target.mkdir(parents=True, exist_ok=True)
    return target


def _step_directory(current_dir: Path, direction: str) -> Dict[str, Any]:
    def has_supported_images(target_dir: Path) -> bool:
        return any(
            path.is_file() and path.suffix.lower() in SUPPORTED_FORMATS
            for path in target_dir.iterdir()
        )

    parent = current_dir.parent
    siblings = sorted(
        [path for path in parent.iterdir() if path.is_dir()],
        key=lambda p: p.name.lower(),
    )
    if not siblings:
        return {"success": False}

    current_resolved = current_dir.resolve()
    current_index = next(
        (idx for idx, path in enumerate(siblings) if path.resolve() == current_resolved),
        -1,
    )
    if current_index < 0:
        return {"success": False}

    if direction == "prev":
        index_range = range(current_index - 1, -1, -1)
    elif direction == "next":
        index_range = range(current_index + 1, len(siblings))
    else:
        return {"success": False, "error": "invalid direction"}

    for target_index in index_range:
        target = siblings[target_index]
        if has_supported_images(target):
            return {"success": True, "directory": str(target)}

    return {"success": False}


def _copy_image_to_clipboard(image_path: Path) -> Dict[str, Any]:
    if os.name != "nt":
        return {"success": False, "error": "clipboard copy is only supported on Windows"}

    if not image_path.exists():
        return {"success": False, "error": "image not found"}

    try:
        with Image.open(image_path) as image:
            output = io.BytesIO()
            image.convert("RGB").save(output, format="BMP")
        dib_data = output.getvalue()[14:]
    except Exception as exc:
        return {"success": False, "error": str(exc)}

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
        return {"success": False, "error": "clipboard is busy"}

    global_mem = None
    try:
        if not user32.EmptyClipboard():
            return {"success": False, "error": "failed to empty clipboard"}

        size = len(dib_data)
        global_mem = kernel32.GlobalAlloc(GMEM_MOVEABLE, size)
        if not global_mem:
            return {"success": False, "error": "GlobalAlloc failed"}

        locked_mem = kernel32.GlobalLock(global_mem)
        if not locked_mem:
            kernel32.GlobalFree(global_mem)
            return {"success": False, "error": "GlobalLock failed"}

        ctypes.memmove(locked_mem, dib_data, size)
        kernel32.GlobalUnlock(global_mem)

        if not user32.SetClipboardData(CF_DIB, global_mem):
            kernel32.GlobalFree(global_mem)
            return {"success": False, "error": "SetClipboardData failed"}

        global_mem = None
        return {"success": True}
    finally:
        user32.CloseClipboard()


def main() -> None:
    parser = argparse.ArgumentParser(description="RView CLI")
    subparsers = parser.add_subparsers(dest="command", required=True)

    count_cmd = subparsers.add_parser("count")
    count_cmd.add_argument("--dir", default=str(Path.cwd()))

    list_cmd = subparsers.add_parser("list")
    list_cmd.add_argument("--dir", default=str(Path.cwd()))
    list_cmd.add_argument("--start", type=int, default=0)
    list_cmd.add_argument("--count", type=int, default=50)

    fav_cmd = subparsers.add_parser("favorite")
    fav_cmd.add_argument("--image", required=True)
    fav_cmd.add_argument("--slot", type=int, choices=[1, 2], default=1)

    delete_cmd = subparsers.add_parser("delete")
    delete_cmd.add_argument("--image", required=True)

    save_cmd = subparsers.add_parser("save-as")
    save_cmd.add_argument("--image", required=True)
    save_cmd.add_argument("--output", required=True)

    step_dir_cmd = subparsers.add_parser("step-dir")
    step_dir_cmd.add_argument("--dir", required=True)
    step_dir_cmd.add_argument("--direction", choices=["prev", "next"], required=True)

    clipboard_cmd = subparsers.add_parser("copy-clipboard")
    clipboard_cmd.add_argument("--image", required=True)

    args = parser.parse_args()

    if args.command == "count":
        image_dir = Path(args.dir)
        _print_json({"count": len(_list_images(image_dir))})
        return

    if args.command == "list":
        image_dir = Path(args.dir)
        images = _list_images(image_dir)
        start = max(args.start, 0)
        end = min(start + max(args.count, 0), len(images))
        payload = {
            "images": [_image_meta(path) for path in images[start:end]],
            "total": len(images),
            "loaded": end,
        }
        _print_json(payload)
        return

    if args.command == "favorite":
        image_path = Path(args.image)
        if not image_path.exists():
            _print_json({"success": False, "error": "image not found"})
            return
        dest_dir = _favorites_dir(image_path.parent, args.slot)
        dest = move_to_favorites(image_path, dest_dir)
        _print_json({"success": True, "path": str(dest), "moved": True})
        return

    if args.command == "delete":
        image_path = Path(args.image)
        if not image_path.exists():
            _print_json({"success": False, "error": "image not found"})
            return
        image_path.unlink()
        _print_json({"success": True})
        return

    if args.command == "save-as":
        image_path = Path(args.image)
        if not image_path.exists():
            _print_json({"success": False, "error": "image not found"})
            return
        output = Path(args.output)
        output.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(image_path, output)
        _print_json({"success": True, "path": str(output)})
        return

    if args.command == "step-dir":
        current_dir = Path(args.dir)
        if not current_dir.exists() or not current_dir.is_dir():
            _print_json({"success": False, "error": "folder not found"})
            return
        _print_json(_step_directory(current_dir, args.direction))
        return

    if args.command == "copy-clipboard":
        image_path = Path(args.image)
        _print_json(_copy_image_to_clipboard(image_path))
        return


if __name__ == "__main__":
    main()
