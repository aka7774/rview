from pathlib import Path

from PIL import Image

from cli import _copy_if_missing, _favorites_dir
from local.rview import RViewAPI
from remote.server import RViewRemoteAPI


def _create_image(path: Path, color: str = "red") -> None:
    Image.new("RGB", (2, 2), color=color).save(path)


def test_cli_favorite_directories_are_siblings_with_slot_suffix(tmp_path: Path) -> None:
    image_dir = tmp_path / "sample"
    image_dir.mkdir()

    assert _favorites_dir(image_dir, 1) == tmp_path / "samplef"
    assert _favorites_dir(image_dir, 2) == tmp_path / "sampleg"


def test_cli_duplicate_copy_is_noop(tmp_path: Path) -> None:
    image_dir = tmp_path / "sample"
    image_dir.mkdir()
    source = image_dir / "image.png"
    _create_image(source)
    target_dir = _favorites_dir(image_dir, 1)

    destination, copied = _copy_if_missing(source, target_dir)
    assert copied is True
    first_mtime = destination.stat().st_mtime_ns

    destination_again, copied_again = _copy_if_missing(source, target_dir)
    assert destination_again == destination
    assert copied_again is False
    assert destination.stat().st_mtime_ns == first_mtime
    assert list(target_dir.iterdir()) == [destination]


def test_desktop_api_uses_new_names_and_does_not_duplicate(tmp_path: Path) -> None:
    image_dir = tmp_path / "sample"
    image_dir.mkdir()
    source = image_dir / "image.png"
    _create_image(source)
    api = RViewAPI(str(image_dir))

    assert api.favorites_dir == tmp_path / "samplef"
    assert api.favorites2_dir == tmp_path / "sampleg"
    assert api.add_to_favorites(str(source)) is True
    assert api.add_to_favorites(str(source)) is True
    assert [path.name for path in api.favorites_dir.iterdir()] == ["image.png"]


def test_remote_api_matches_desktop_favorite_behavior(tmp_path: Path) -> None:
    image_dir = tmp_path / "sample"
    image_dir.mkdir()
    source = image_dir / "image.png"
    _create_image(source)
    api = RViewRemoteAPI(str(image_dir))

    assert api.favorites_dir == tmp_path / "samplef"
    assert api.favorites2_dir == tmp_path / "sampleg"
    assert api.add_to_favorites2(str(source)) is True
    assert api.add_to_favorites2(str(source)) is True
    assert [path.name for path in api.favorites2_dir.iterdir()] == ["image.png"]
