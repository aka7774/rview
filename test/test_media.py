import base64
import io
import json

import pytest
from PIL import Image

from local.rview import RViewAPI
from remote.server import RViewRemoteAPI
from remote import server


@pytest.fixture
def images(tmp_path):
    root = tmp_path / 'images'
    root.mkdir()
    Image.new('RGB', (1600, 900), 'purple').save(root / 'large.bmp')
    return root


def test_desktop_lists_metadata_and_loads_only_requested_media(images):
    api = RViewAPI(str(images))
    row = api.get_images_batch(0, 30)['images'][0]
    assert 'data' not in row
    assert len(json.dumps(row)) < 1000
    original = api.get_image_source(row['file_path'])
    assert base64.b64decode(original.split(',', 1)[1]) == (images / 'large.bmp').read_bytes()
    preview = base64.b64decode(api.get_image_source(row['file_path'], True).split(',', 1)[1])
    with Image.open(io.BytesIO(preview)) as image:
        assert image.size == (320, 180)
    assert len(preview) < 10000


def test_remote_media_identity_survives_list_reindexing(images, monkeypatch):
    api = RViewRemoteAPI(str(images))
    monkeypatch.setattr(server, 'api', api)
    client = server.app.test_client()
    selected = images / 'large.bmp'
    Image.new('RGB', (2, 2), 'blue').save(images / 'aaa.png')
    api.get_image_count()
    assert client.get('/api/media', query_string={'path': str(selected)}).data == selected.read_bytes()
    response = client.get('/api/media', query_string={'path': str(selected), 'thumbnail': 1})
    assert response.mimetype == 'image/webp'
    outside = images.parent / 'other'
    outside.mkdir()
    Image.new('RGB', (2, 2)).save(outside / 'next.png')
    assert api.change_directory(str(outside))
    assert client.get('/api/media', query_string={'path': str(selected)}).status_code == 404


@pytest.mark.parametrize('backend', [RViewAPI, RViewRemoteAPI])
def test_ratings_append_without_changing_images(images, backend):
    api = backend(str(images))
    path = images / 'large.bmp'
    before = path.read_bytes()
    for value in [2, -2, 1, -1]:
        assert api.rate_image(str(path), value)
    rows = [json.loads(line) for line in (images / 'rview-ratings.jsonl').read_text().splitlines()]
    assert [r['rating'] for r in rows] == [2, -2, 1, -1]
    assert {r['file'] for r in rows} == {'large.bmp'}
    assert path.read_bytes() == before
    with pytest.raises(ValueError):
        api.rate_image(str(path), 0)
    with pytest.raises(ValueError):
        api.rate_image(str(images.parent / 'elsewhere.png'), 2)
