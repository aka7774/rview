"""Small, shared operations for on-demand previews and human ratings."""
import hashlib
import shutil
import base64
import io
import json
import mimetypes
from datetime import datetime, timezone
from pathlib import Path
from threading import Lock

from PIL import Image

_rating_lock = Lock()


def managed_image(directory, image_path, formats):
    path = Path(image_path).resolve()
    if path.parent != Path(directory).resolve() or path.suffix.lower() not in formats or not path.is_file():
        raise ValueError("Image is not in the current directory")
    return path


def thumbnail_bytes(path):
    with Image.open(path) as image:
        image.thumbnail((320, 320))
        output = io.BytesIO()
        image.convert("RGBA" if "A" in image.getbands() else "RGB").save(output, "WEBP", quality=75)
        return output.getvalue()


def image_data_url(path, thumbnail=False):
    data = thumbnail_bytes(path) if thumbnail else Path(path).read_bytes()
    mime = "image/webp" if thumbnail else (mimetypes.guess_type(str(path))[0] or "image/png")
    return f"data:{mime};base64," + base64.b64encode(data).decode("ascii")


def record_rating(directory, path, rating):
    if type(rating) is not int or rating not in (-2, -1, 1, 2):
        raise ValueError("Rating must be -2, -1, 1 or 2")
    record = {"file": Path(path).name, "rating": rating,
              "at": datetime.now(timezone.utc).isoformat()}
    with _rating_lock:
        with (Path(directory) / "rview-ratings.jsonl").open("a", encoding="utf-8") as stream:
            stream.write(json.dumps(record, ensure_ascii=False) + "\n")
    return True


_move_lock = Lock()


def _same_contents(source, destination):
    """Compare size, then the first MiB, then stream the remaining content."""
    if not destination.is_file() or source.stat().st_size != destination.stat().st_size:
        return False
    with source.open("rb") as left, destination.open("rb") as right:
        if hashlib.sha256(left.read(1024 * 1024)).digest() != hashlib.sha256(right.read(1024 * 1024)).digest():
            return False
        while True:
            chunk = left.read(1024 * 1024)
            if chunk != right.read(1024 * 1024):
                return False
            if not chunk:
                return True


def move_to_favorites(source: Path, target_dir: Path) -> Path:
    """Move without overwriting a collision; discard only an identical source."""
    with _move_lock:
        if not source.is_file():
            raise FileNotFoundError(source)
        target_dir.mkdir(parents=True, exist_ok=True)
        destination = target_dir / source.name
        number = 0
        while destination.exists():
            if source.resolve() == destination.resolve():
                raise ValueError("Source and destination must differ")
            if _same_contents(source, destination):
                source.unlink()
                return destination
            number += 1
            destination = target_dir / f"{source.stem}_{number}{source.suffix}"
        shutil.move(str(source), str(destination))
        return destination
