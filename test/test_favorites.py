import json
import sys
from pathlib import Path

import pytest
from PIL import Image

from cli import _favorites_dir, main
from local.rview import RViewAPI
from remote.server import RViewRemoteAPI
from rview_media import move_to_favorites


@pytest.mark.parametrize('backend', ['cli', RViewAPI, RViewRemoteAPI])
@pytest.mark.parametrize('slot', [1, 2])
@pytest.mark.parametrize('collision', ['none', 'identical', 'different', 'same_size'])
def test_favorite_moves_and_preserves_collisions(tmp_path, monkeypatch, capsys, backend, slot, collision):
    directory = tmp_path / '2026-09-29'
    directory.mkdir()
    source = directory / 'image.bmp'
    Image.new('RGB', (2, 2), 'red').save(source)
    Image.new('RGB', (2, 2), 'green').save(directory / 'next.bmp')
    content = source.read_bytes()
    target = _favorites_dir(directory, slot)
    destination = target / source.name
    previous = None
    if collision != 'none':
        previous = content if collision == 'identical' else (b'x' * len(content) if collision == 'same_size' else b'other')
        destination.write_bytes(previous)
        timestamp = destination.stat().st_mtime_ns
    if collision in ('different', 'same_size'):
        (target / 'image_1.bmp').write_bytes(b'occupied')
    if backend == 'cli':
        monkeypatch.setattr(sys, 'argv', ['cli', 'favorite', '--image', str(source), '--slot', str(slot)])
        main()
        assert json.loads(capsys.readouterr().out)['moved'] is True
    else:
        api = backend(str(directory))
        action = api.add_to_favorites2 if slot == 2 else api.add_to_favorites
        assert action(str(source))
        assert [p.name for p in api._image_files] == ['next.bmp']
        assert api.get_images_batch(0, 30)['total'] == 1
        assert not action(str(source))
    assert not source.exists()
    assert (directory / 'next.bmp').exists()
    assert target.name == ('2026-09-29g' if slot == 2 else '2026-09-29f')
    if previous is not None:
        assert destination.read_bytes() == previous
        assert destination.stat().st_mtime_ns == timestamp
    if collision in ('different', 'same_size'):
        assert (target / 'image_2.bmp').read_bytes() == content
        assert (target / 'image_1.bmp').read_bytes() == b'occupied'
    else:
        assert destination.read_bytes() == content
        assert list(target.iterdir()) == [destination]


def test_same_prefix_different_tail_is_not_deleted(tmp_path):
    source = tmp_path / 'large.png'
    content = b'x' * (1024 * 1024) + b'a'
    source.write_bytes(content)
    target = tmp_path / 'favorites'
    target.mkdir()
    (target / source.name).write_bytes(content[:-1] + b'b')
    destination = move_to_favorites(source, target)
    assert destination.name == 'large_1.png'
    assert destination.read_bytes() == content
    assert not source.exists()


@pytest.mark.parametrize('backend', [RViewAPI, RViewRemoteAPI])
def test_failed_move_keeps_source_and_list(tmp_path, monkeypatch, backend):
    import rview_media
    source = tmp_path / 'image.png'
    Image.new('RGB', (2, 2)).save(source)
    api = backend(str(tmp_path))
    def fail(*args):
        raise OSError('move failed')
    monkeypatch.setattr(rview_media.shutil, 'move', fail)
    assert not api.add_to_favorites(str(source))
    assert source.exists()
    assert api._image_files == [source]
