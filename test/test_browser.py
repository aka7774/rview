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
    # 3,500 distinct paths to a 24 MiB bitmap; no private production images.
    original = first / '0000.bmp'
    Image.new('RGB', (4096, 2048), 'teal').save(original)
    for index in range(1, 3500):
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
            page.wait_for_function('state.images.length === 3500 && !state.isLoading')
            page.wait_for_function('elements.mainImage.naturalWidth === 4096')
            assert 1 <= len(originals) <= 4
            assert page.evaluate('state.images.every(image => !image.data)')
            assert 'a_many' in page.title()
            # Read large originals through repeated jumps; measure browser RSS as well
            # as the cache's reservations (JS heap alone excludes decoded pixels).
            import psutil
            peak_rss = 0
            for index in range(100, 1100, 25):
                page.evaluate('(i) => showImage(i)', index)
                page.wait_for_function('!cacheWorker && displayedPath === state.images[state.currentIndex].file_path')
                assert page.evaluate('cacheBytes <= cacheBudget / 2 && imageCache.size <= 4')
                rss = sum(p.memory_info().rss for p in psutil.Process().children(recursive=True)
                          if p.is_running())
                peak_rss = max(peak_rss, rss)
            assert peak_rss < 2 * 1024**3
            print({'large_original_peak_browser_rss_bytes': peak_rss})
            page.evaluate('showImage(0)')
            page.wait_for_function('!cacheWorker')
            # Thumbnail scrolling loads only small previews near the viewport.
            page.keyboard.press('Escape')
            page.wait_for_function('document.querySelectorAll(".thumbnail-item img[src]").length > 0')
            page.locator('#thumbnail-view').evaluate('(el) => el.scrollTop = el.scrollHeight')
            page.wait_for_timeout(500)
            loaded = page.locator('.thumbnail-item img[src]').count()
            assert 0 < loaded < 60
            page.wait_for_function('Array.from(document.querySelectorAll(".thumbnail-item img[src]")).every(i => i.complete && i.naturalWidth <= 320)')
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
            print(json.dumps({'large_images': 3500, 'original_bytes_each': original.stat().st_size,
                              'original_requests': len(originals), 'visible_previews_after_scroll': loaded,
                              'rating_values': ratings, 'stale_batch_discarded': True, 'page_errors': errors}))
            browser.close()
    finally:
        http.shutdown()
        thread.join(timeout=5)


def test_favorites_remove_current_and_advance(tmp_path, monkeypatch):
    playwright = pytest.importorskip('playwright.sync_api')
    directory = tmp_path / '2026-09-29'
    directory.mkdir()
    for index in range(65):
        Image.new('RGB', (10, 10), 'red').save(directory / f'{index:03d}.png')
    monkeypatch.setattr(server, 'api', server.RViewRemoteAPI(str(directory)))
    http = make_server('127.0.0.1', 0, server.app, threaded=True)
    thread = threading.Thread(target=http.serve_forever, daemon=True)
    thread.start()
    try:
        with playwright.sync_playwright() as pw:
            browser = pw.chromium.launch(headless=True)
            page = browser.new_page()
            page.goto(f'http://127.0.0.1:{http.server_port}/?mode=remote')
            page.wait_for_function('state.images.length === 65 && !state.isLoading')
            # An old batch must not restore a moved image or skip an offset.
            page.evaluate('''() => {
                const original = api.getImagesBatch.bind(api);
                window.batchWaiting = false;
                window.batchReturned = false;
                api.getImagesBatch = async (start, count) => {
                    const result = await original(start, count);
                    if (start === 30 && !window.batchWaiting) {
                        window.batchWaiting = true;
                        await new Promise(resolve => setTimeout(resolve, 800));
                        window.batchReturned = true;
                    }
                    return result;
                };
                loadImagesProgressively();
            }''')
            page.wait_for_function('window.batchWaiting')
            page.keyboard.press('Insert')
            page.wait_for_function('!state.favoriteInFlight && !state.isLoading && state.images.length === 64')
            page.wait_for_function('window.batchReturned')
            assert not (directory / '000.png').exists()
            assert (tmp_path / '2026-09-29f' / '000.png').exists()
            assert page.evaluate('state.images[state.currentIndex].name') == '001.png'
            assert page.evaluate('state.images.map(i => i.name)') == [f'{i:03d}.png' for i in range(1, 65)]
            page.keyboard.press('Shift+Insert')
            page.wait_for_function('!state.favoriteInFlight && state.images.length === 63')
            assert (tmp_path / '2026-09-29g' / '001.png').exists()
            assert not (directory / '001.png').exists()
            assert page.evaluate('state.images[state.currentIndex].name') == '002.png'
            # A backend failure must keep the selected image.
            page.evaluate('api.addToFavorites = async () => false')
            page.keyboard.press('Insert')
            page.wait_for_function('!state.favoriteInFlight')
            assert page.evaluate('state.images.length') == 63
            assert (directory / '002.png').exists()
            # Last and only image: clear the stale original and leave viewer mode.
            for path in directory.iterdir():
                if path.name != '002.png':
                    path.unlink()
            page.evaluate('loadImagesProgressively()')
            page.wait_for_function('state.images.length === 1 && !state.isLoading')
            page.keyboard.press('Shift+Insert')
            page.wait_for_function('!state.favoriteInFlight && state.images.length === 0')
            assert page.evaluate('!state.isViewerMode && state.totalCount === 0 && state.loadedCount === 0')
            assert list(directory.iterdir()) == []
            browser.close()
    finally:
        http.shutdown()
        thread.join(timeout=5)


def test_prefetch_window_no_blank_and_memory_bound(tmp_path, monkeypatch):
    playwright = pytest.importorskip('playwright.sync_api')
    directory = tmp_path / 'synthetic'
    directory.mkdir()
    original = directory / '0000.png'
    Image.new('RGB', (320, 240), 'teal').save(original)
    for index in range(1, 3500):
        os.link(original, directory / f'{index:04d}.png')
    monkeypatch.setattr(server, 'api', server.RViewRemoteAPI(str(directory)))
    http = make_server('127.0.0.1', 0, server.app, threaded=True)
    thread = threading.Thread(target=http.serve_forever, daemon=True)
    thread.start()
    try:
        with playwright.sync_playwright() as pw:
            browser = pw.chromium.launch(headless=True)
            page = browser.new_page()
            errors = []
            page.on('pageerror', lambda error: errors.append(str(error)))
            page.goto(f'http://127.0.0.1:{http.server_port}/?mode=remote')
            page.wait_for_function('state.images.length === 3500 && !state.isLoading && !cacheWorker')
            assert page.evaluate('imageCache.size') == 101
            page.evaluate('showImage(150)')
            page.wait_for_function('!cacheWorker && imageCache.size === 201')
            # Cache hits replace the decoded node synchronously, without another request.
            assert page.evaluate('''() => {
                for (const index of [151, 150, 149, 150]) {
                    showImage(index);
                    if (displayedPath !== state.images[index].file_path ||
                        !elements.mainImage.complete || !elements.mainImage.naturalWidth) return false;
                }
                return true;
            }''')
            # On a miss keep the previous image until the delayed decode has completed.
            page.evaluate('''() => {
                window.previousNode = elements.mainImage;
                const original = api.getImageSource.bind(api);
                api.getImageSource = async (...args) => {
                    await new Promise(resolve => setTimeout(resolve, 15));
                    return original(...args);
                };
                showImage(3200);
            }''')
            assert page.evaluate('elements.mainImage === window.previousNode && elements.mainImage.naturalWidth > 0')
            page.wait_for_function('displayedPath === state.images[3200].file_path')
            # Repeated distant jumps cannot accumulate decoded images or old responses.
            for index in range(100, 3400, 150):
                page.evaluate('(i) => showImage(i)', index)
                page.wait_for_function('displayedPath === state.images[state.currentIndex].file_path')
                assert page.evaluate('cacheBytes <= cacheBudget / 2 && imageCache.size <= 201')
            page.wait_for_function('!cacheWorker')
            assert page.evaluate('''[...imageCache.keys()].every(path =>
                Math.abs(state.images.findIndex(i => i.file_path === path) - state.currentIndex) <= 100)''')
            assert not errors
            browser.close()
    finally:
        http.shutdown()
        thread.join(timeout=5)
