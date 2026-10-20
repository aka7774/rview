"""Small Flask smoke checks using only disposable, synthetic images."""

from PIL import Image

from remote import server


def test_remote_mode_page_serves_its_assets(tmp_path, monkeypatch):
    monkeypatch.setattr(server, 'api', server.RViewRemoteAPI(str(tmp_path)))
    client = server.app.test_client()

    page = client.get('/?mode=remote')
    assert page.status_code == 200
    assert page.mimetype == 'text/html'
    assert b'id="thumbnail-grid"' in page.data
    assert b'id="viewer-mode"' in page.data
    assert b'<script src="script.js"></script>' in page.data

    script = client.get('/script.js')
    assert script.status_code == 200
    assert b"urlParams.get('mode') === 'remote'" in script.data
    assert client.get('/style.css').status_code == 200


def test_remote_image_list_is_sorted_paged_and_metadata_only(tmp_path, monkeypatch):
    directory = tmp_path / 'images'
    directory.mkdir()
    for name, size in [('b.jpg', (9, 5)), ('a.png', (3, 7)), ('c.gif', (4, 6))]:
        Image.new('RGB', size, 'blue').save(directory / name)
    (directory / 'notes.txt').write_text('not an image')
    (directory / 'nested').mkdir()
    Image.new('RGB', (2, 2)).save(directory / 'nested' / 'hidden.png')

    monkeypatch.setattr(server, 'api', server.RViewRemoteAPI(str(directory)))
    client = server.app.test_client()
    assert client.get('/api/current-directory').json == {'directory': str(directory)}
    assert client.get('/api/count').json == {'count': 3}

    first = client.get('/api/images', query_string={'start': 0, 'count': 2})
    assert first.status_code == 200
    assert first.json['total'] == 3
    assert first.json['loaded'] == 2
    assert [(row['name'], row['index'], row['width'], row['height']) for row in first.json['images']] == [
        ('a.png', 0, 3, 7), ('b.jpg', 1, 9, 5),
    ]
    for row in first.json['images']:
        path = directory / row['name']
        assert row['file_path'] == str(path)
        assert row['size'] == path.stat().st_size
        assert 'data' not in row

    last = client.get('/api/images', query_string={'start': 2, 'count': 2}).json
    assert last['total'] == 3
    assert last['loaded'] == 3
    assert [row['name'] for row in last['images']] == ['c.gif']
    assert client.get('/api/images', query_string={'start': 3, 'count': 2}).json == {
        'images': [], 'total': 3, 'loaded': 3,
    }
