"""Real browser regression: large directory, navigation, races, and ratings."""
import json
import os
import threading
import time

import pytest
from PIL import Image
from werkzeug.serving import make_server

from remote import server


def test_large_directory_and_human_review_controls(tmp_path, monkeypatch):
    playwright = pytest.importorskip('playwright.sync_api')
    first = tmp_path / 'a_many'
    second = tmp_path / 'b_next'
    first.mkdir()
    second.mkdir()
    # 1,205 distinct paths to a 24 MiB bitmap; no private production images.
    original = first / '0000.bmp'
    Image.new('RGB', (4096, 2048), 'teal').save(original)
    for index in range(1, 1205):
        os.link(original, first / f'{index:04d}.bmp')
    for index in range(3):
        Image.new('RGB', (100, 80), 'purple').save(second / f'{index}.png')
    monkeypatch.setattr(server, 'api', server.RViewRemoteAPI(str(first)))
    http = make_server('127.0.0.1', 0, server.app, threaded=True)
    thread = threading.Thread(target=http.serve_forever, daemon=True)
    thread.start()
    try:
        with playwright.sync_playwright() as pw:
            browser = pw.chromium.launch(headless=True)
            page = browser.new_page(viewport={'width': 1280, 'height': 900})
            errors, originals = [], []
            page.on('pageerror', lambda error: errors.append(str(error)))
            page.on('request', lambda request: originals.append(request.url)
                    if '/api/media?' in request.url and 'thumbnail=0' in request.url else None)
            page.goto(f'http://127.0.0.1:{http.server_port}/?mode=remote')
            page.wait_for_function('state.images.length === 1205 && !state.isLoading')
            page.wait_for_function('elements.mainImage.naturalWidth === 4096')
            assert len(originals) == 1
            assert page.evaluate('state.images.every(image => !image.data)')
            assert 'a_many' in page.title()
            # Thumbnail scrolling loads only small previews near the viewport.
            page.keyboard.press('Escape')
            page.wait_for_function('document.querySelectorAll(".thumbnail-item img[src]").length > 0')
            page.locator('#thumbnail-view').evaluate('(el) => el.scrollTop = el.scrollHeight')
            page.wait_for_timeout(500)
            loaded = page.locator('.thumbnail-item img[src]').count()
            assert 0 < loaded < 60
            page.wait_for_function('Array.from(document.querySelectorAll(".thumbnail-item img[src]")).every(i => i.complete && i.naturalWidth <= 320)')
            assert len(originals) == 1
            page.evaluate('openViewer(0)')
            for key in ['w', 'Numpad2', 'Control+ArrowUp', 'Control+Numpad2']:
                page.keyboard.press(key)
                page.wait_for_function('!state.ratingInFlight')
            ratings = [json.loads(line)['rating'] for line in (first / 'rview-ratings.jsonl').read_text().splitlines()]
            assert ratings == [2, -2, 1, -1]
            assert page.evaluate('state.currentIndex') == 4
            for key, expected in [('a', 3), ('Numpad4', 2), ('d', 3), ('Numpad6', 4)]:
                page.keyboard.press(key)
                assert page.evaluate('state.currentIndex') == expected
            # Opening click and outside click; a focus-restoring click is ignored.
            page.locator('#image-container').click(position={'x': 25, 'y': 200})
            assert page.evaluate('state.isMenuOpen')
            page.locator('#image-container').click(position={'x': 25, 'y': 200})
            assert not page.evaluate('state.isMenuOpen')
            page.evaluate('window.dispatchEvent(new Event("blur"))')
            page.locator('#image-container').click(position={'x': 25, 'y': 200})
            assert not page.evaluate('state.isMenuOpen')
            # Hold an old-folder batch until after ] has completed.
            page.evaluate('''() => {
                const original = api.getImagesBatch.bind(api);
                let delayed = false;
                window.oldBatchReturned = false;
                api.getImagesBatch = async (start, count) => {
                    const result = await original(start, count);
                    if (start === 30 && !delayed) {
                        delayed = true;
                        window.oldBatchWaiting = true;
                        await new Promise(resolve => setTimeout(resolve, 1000));
                        window.oldBatchReturned = true;
                    }
                    return result;
                };
                loadImagesProgressively();
            }''')
            page.wait_for_function('window.oldBatchWaiting === true')
            page.keyboard.press(']')
            page.wait_for_function('state.directory.endsWith("b_next") && state.images.length === 3 && !state.isLoading')
            page.wait_for_function('window.oldBatchReturned === true')
            assert page.evaluate('state.images.length === 3 && new Set(state.images.map(i => i.file_path)).size === 3')
            assert 'b_next' in page.title()
            assert page.evaluate('state.images.every(i => i.file_path.includes("b_next"))')
            page.evaluate('showImage(2)')
            page.keyboard.press(']')
            page.wait_for_function('!state.changingDirectory')
            assert page.evaluate('state.currentIndex') == 2
            assert not errors
            print(json.dumps({'large_images': 1205, 'original_bytes_each': original.stat().st_size,
                              'initial_original_requests': 1, 'visible_previews_after_scroll': loaded,
                              'rating_values': ratings, 'stale_batch_discarded': True, 'page_errors': errors}))
            browser.close()
    finally:
        http.shutdown()
        thread.join(timeout=5)
