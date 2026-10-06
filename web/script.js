// グローバル状態管理
const state = {
    images: [],
    imagePaths: new Set(),
    loadVersion: 0,
    directory: "",
    changingDirectory: false,
    watchingInFlight: false,
    ratingInFlight: false,
    favoriteInFlight: false,
    currentIndex: 0,
    isViewerMode: false,
    isMenuOpen: false,
    zoom: 1.0,
    displayScale: 1.0,  // 実際の表示倍率（元画像に対する）
    panX: 0,
    panY: 0,
    fitWidth: 0,
    fitHeight: 0,
    isDragging: false,
    dragStartX: 0,
    dragStartY: 0,
    dragOriginPanX: 0,
    dragOriginPanY: 0,
    dragMoved: false,
    suppressNextClick: false,
    autoRotate: true,
    isWatchingForNew: false,
    isLoading: false,
    loadedCount: 0,
    totalCount: 0,
    cursorHideTimer: null,
    isCursorHidden: false,
    toastTimer: null,
    isRemoteMode: false  // リモートモード判定
};

// DOM要素の取得
const elements = {
    thumbnailView: document.getElementById('thumbnail-view'),
    viewerMode: document.getElementById('viewer-mode'),
    thumbnailGrid: document.getElementById('thumbnail-grid'),
    mainImage: document.getElementById('main-image'),
    imageContainer: document.getElementById('image-container'),
    menu: document.getElementById('menu'),
    imageCount: document.getElementById('image-count'),
    currentFolderPath: document.getElementById('current-folder-path'),
    imageInfo: document.getElementById('image-info'),
    imageSlider: document.getElementById('image-slider'),
    sliderValue: document.getElementById('slider-value'),
    zoomLevel: document.getElementById('zoom-level'),
    toast: document.getElementById('toast'),
    prevBtn: document.getElementById('prev-btn'),
    nextBtn: document.getElementById('next-btn')
};

// 初期化
async function init() {
    console.log('Initializing RView...');

    // モード判定（PyWebViewがあるかどうか）
    state.isRemoteMode = await detectMode();
    console.log(`Running in ${state.isRemoteMode ? 'Remote' : 'Local'} mode`);

    await loadImagesProgressively();
    await updateCurrentFolderPath();
    setupEventListeners();
    setupDragAndDrop();

    if (state.images.length > 0) {
        openViewer(0);
    }

    // 新規画像の監視を開始
    startWatchingForNewImages();
}

// モード判定（PyWebViewの存在をチェック）
function detectMode() {
    return new Promise((resolve) => {
        // リモートモードかどうかを判定（URLパラメータまたはlocalhost以外からのアクセス）
        const urlParams = new URLSearchParams(window.location.search);
        if (urlParams.get('mode') === 'remote') {
            resolve(true);
            return;
        }

        // PyWebViewが存在するかチェック
        if (window.pywebview && window.pywebview.api) {
            resolve(false);
            return;
        }

        // 少し待ってから再チェック
        let attempts = 0;
        const checkInterval = setInterval(() => {
            attempts++;
            if (window.pywebview && window.pywebview.api) {
                clearInterval(checkInterval);
                resolve(false);
            } else if (attempts > 10) {
                // 1秒待ってもPyWebViewがなければリモートモード
                clearInterval(checkInterval);
                resolve(true);
            }
        }, 100);
    });
}

// APIラッパー関数（ローカル/リモート両対応）
const api = {
    async getImageSource(image, thumbnail = false) {
        if (state.isRemoteMode) {
            return `/api/media?path=${encodeURIComponent(image.file_path)}&thumbnail=${thumbnail ? 1 : 0}`;
        }
        return await window.pywebview.api.get_image_source(image.file_path, thumbnail);
    },

    async rateImage(filePath, rating) {
        if (!state.isRemoteMode) return await window.pywebview.api.rate_image(filePath, rating);
        const response = await fetch('/api/rating', {
            method: 'POST', headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({image_path: filePath, rating})
        });
        return response.ok && (await response.json()).success;
    },

    async getImageCount() {
        if (state.isRemoteMode) {
            const response = await fetch('/api/count');
            const data = await response.json();
            return data.count;
        } else {
            return await window.pywebview.api.get_image_count();
        }
    },

    async getImagesBatch(start, count) {
        if (state.isRemoteMode) {
            const response = await fetch(`/api/images?start=${start}&count=${count}`);
            return await response.json();
        } else {
            return await window.pywebview.api.get_images_batch(start, count);
        }
    },

    async addToFavorites(filePath) {
        if (state.isRemoteMode) {
            const response = await fetch('/api/favorites', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ image_path: filePath })
            });
            const data = await response.json();
            return data.success;
        } else {
            return await window.pywebview.api.add_to_favorites(filePath);
        }
    },

    async addToFavorites2(filePath) {
        if (state.isRemoteMode) {
            const response = await fetch('/api/favorites2', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ image_path: filePath })
            });
            const data = await response.json();
            return data.success;
        } else {
            return await window.pywebview.api.add_to_favorites2(filePath);
        }
    },

    async deleteImage(filePath) {
        if (state.isRemoteMode) {
            const response = await fetch('/api/delete', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ image_path: filePath })
            });
            const data = await response.json();
            return data.success;
        } else {
            return await window.pywebview.api.delete_image(filePath);
        }
    },

    async changeDirectory(path) {
        if (state.isRemoteMode) {
            const response = await fetch('/api/directory', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ directory: path })
            });
            const data = await response.json();
            return data.success;
        } else {
            return await window.pywebview.api.change_directory(path);
        }
    },

    async getCurrentDirectory() {
        if (state.isRemoteMode) {
            const response = await fetch('/api/current-directory');
            const data = await response.json();
            return data.directory || '';
        }
        return await window.pywebview.api.get_current_directory();
    },

    async stepDirectory(direction) {
        if (state.isRemoteMode) {
            const response = await fetch('/api/directory/step', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ direction })
            });
            return await response.json();
        }
        return await window.pywebview.api.step_directory(direction);
    },

    async selectDirectory() {
        if (state.isRemoteMode) {
            return null;
        }
        return await window.pywebview.api.select_directory();
    },

    async setWindowTitle(title) {
        if (state.isRemoteMode) {
            document.title = title;
            return true;
        } else {
            return await window.pywebview.api.set_window_title(title);
        }
    },

    async toggleFullscreen() {
        if (state.isRemoteMode) {
            if (document.fullscreenElement) {
                document.exitFullscreen();
            } else {
                document.documentElement.requestFullscreen();
            }
            return true;
        } else {
            return await window.pywebview.api.toggle_fullscreen();
        }
    },

    async saveAs(filePath, index) {
        if (state.isRemoteMode) {
            // リモートモード: ダウンロードリンクを使用
            const link = document.createElement('a');
            link.href = `/api/media?path=${encodeURIComponent(filePath)}&download=1`;
            link.click();
            return true;
        } else {
            return await window.pywebview.api.save_as(filePath);
        }
    },

    async copyImageToClipboard(filePath) {
        if (state.isRemoteMode) {
            if (!navigator.clipboard || !window.ClipboardItem) {
                return false;
            }

            const imageElement = elements.mainImage;
            if (!imageElement || !imageElement.complete || imageElement.naturalWidth === 0) {
                return false;
            }

            const canvas = document.createElement('canvas');
            canvas.width = imageElement.naturalWidth;
            canvas.height = imageElement.naturalHeight;
            const context = canvas.getContext('2d');
            if (!context) {
                return false;
            }
            context.drawImage(imageElement, 0, 0);

            const blob = await new Promise((resolve) => {
                canvas.toBlob(resolve, 'image/png');
            });
            if (!blob) {
                return false;
            }

            await navigator.clipboard.write([
                new ClipboardItem({ 'image/png': blob })
            ]);
            return true;
        }
        return await window.pywebview.api.copy_image_to_clipboard(filePath);
    },

    async quitApp() {
        if (state.isRemoteMode) {
            // リモートモードではウィンドウを閉じるだけ
            window.close();
            return true;
        } else {
            return await window.pywebview.api.quit_app();
        }
    }
};

// Listing carries metadata only. Old folder responses cannot append to a new listing.
async function loadImagesProgressively() {
    const version = ++state.loadVersion;
    state.isLoading = true;
    state.images = [];
    state.imagePaths.clear();
    state.loadedCount = state.totalCount = 0;
    clearMainImage();
    renderThumbnails();
    try {
        const directory = await api.getCurrentDirectory();
        if (version !== state.loadVersion) return;
        state.directory = directory;
        elements.currentFolderPath.textContent = directory || '-';
        elements.currentFolderPath.title = directory || '';
        showLoading();
        const total = await api.getImageCount();
        if (version !== state.loadVersion) return;
        state.totalCount = total;
        const batch = await api.getImagesBatch(0, 30);
        if (version !== state.loadVersion) return;
        appendImageBatch(batch);
        updateImageCount();
        if (state.loadedCount < total) {
            loadRemainingImages(version);
        } else {
            state.isLoading = false;
            hideLoading();
        }
    } catch (error) {
        if (version !== state.loadVersion) return;
        console.error('Failed to load images:', error);
        state.isLoading = false;
        hideLoading();
        showToast('画像一覧を読み込めませんでした', 'error');
    }
}

function appendImageBatch(batch) {
    const added = batch.images.filter(image => {
        if (state.imagePaths.has(image.file_path)) return false;
        state.imagePaths.add(image.file_path);
        return true;
    });
    const start = state.images.length;
    state.images.push(...added);
    pumpImageCache();
    state.loadedCount = batch.loaded;
    appendThumbnails(added, start);
    updateSlider();
}

async function loadRemainingImages(version) {
    try {
        while (version === state.loadVersion && state.loadedCount < state.totalCount) {
            const start = state.loadedCount;
            const batch = await api.getImagesBatch(start, 50);
            if (version !== state.loadVersion) return;
            if (batch.loaded <= start) break;
            appendImageBatch(batch);
            updateLoadingProgress();
            updateImageCount();
            await new Promise(resolve => setTimeout(resolve, 10));
        }
    } catch (error) {
        if (version === state.loadVersion) console.error('Failed to load batch:', error);
    } finally {
        if (version === state.loadVersion) {
            state.isLoading = false;
            hideLoading();
            updateImageCount();
        }
    }
}

// Only nearby previews are retained; at most two desktop decodes run at once.
const thumbnailQueue = new Set();
let thumbnailRequests = 0;
const thumbnailObserver = new IntersectionObserver(entries => {
    for (const entry of entries) {
        const img = entry.target;
        img.wanted = entry.isIntersecting;
        if (!img.wanted) {
            thumbnailQueue.delete(img);
            img.removeAttribute('src');
        } else if (!img.hasAttribute('src') && !img.loadingPreview) {
            thumbnailQueue.add(img);
        }
    }
    pumpThumbnails();
}, {root: elements.thumbnailView, rootMargin: '200px'});

function pumpThumbnails() {
    while (thumbnailRequests < 2 && thumbnailQueue.size) {
        const img = thumbnailQueue.values().next().value;
        thumbnailQueue.delete(img);
        if (!img.isConnected || !img.wanted) continue;
        const version = state.loadVersion;
        img.loadingPreview = true;
        thumbnailRequests++;
        api.getImageSource(img.imageRecord, true).then(src => {
            if (img.isConnected && img.wanted && version === state.loadVersion) img.src = src;
        }).catch(error => console.error('Preview unavailable:', error)).finally(() => {
            img.loadingPreview = false;
            thumbnailRequests--;
            pumpThumbnails();
        });
    }
}

// Decoded nodes are swapped only when ready. Reserve encoded and decoded memory.
const imageCache = new Map();
const cacheBudget = Math.min(1024, Math.max(64, (navigator.deviceMemory || 2) * 128)) * 1024 * 1024;
let cacheBytes = 0;
let cacheWorker = false;
let cacheGeneration = 0;
let displayedPath = null;
const failedImages = new Set();
function clearMainImage() {
    cacheGeneration++;
    for (const entry of imageCache.values()) {
        if (entry.node !== elements.mainImage) entry.node.removeAttribute('src');
    }
    imageCache.clear();
    failedImages.clear();
    cacheBytes = 0;
    displayedPath = null;
    elements.mainImage.removeAttribute('src');
}
function imageCost(image) {
    return image.width * image.height * 8 + image.size * 4;
}
function cacheOrder() {
    const center = state.currentIndex;
    const order = [center, center + 1, center - 1];
    for (let n = 2; n <= 30; n++) order.push(center + n);
    for (let n = 2; n <= 100; n++) {
        order.push(center - n);
        if (n > 30) order.push(center + n);
    }
    return order.filter(i => i >= 0 && i < state.images.length);
}
function trimImageCache(wanted) {
    for (const [path, entry] of imageCache) {
        if (!wanted.has(path)) {
            imageCache.delete(path);
            cacheBytes -= entry.cost;
            if (entry.node !== elements.mainImage) entry.node.removeAttribute('src');
        }
    }
}
function presentImage(entry, image) {
    if (displayedPath === image.file_path) return;
    const previous = elements.mainImage;
    const previousPath = displayedPath;
    entry.node.id = 'main-image';
    previous.replaceWith(entry.node);
    previous.removeAttribute('id');
    elements.mainImage = entry.node;
    // A cache miss keeps the old display alive only until its replacement is ready.
    if (imageCache.get(previousPath)?.node !== previous) previous.removeAttribute('src');
    displayedPath = image.file_path;
    resetZoom();
    checkAndRotate(image);
}
function wantedImages() {
    const wanted = new Map();
    let reserved = 0;
    // Half remains available for the old visible image and decoder transition.
    for (const index of cacheOrder().sort((a, b) => Math.abs(a - state.currentIndex) - Math.abs(b - state.currentIndex))) {
        const image = state.images[index];
        if (failedImages.has(image.file_path)) continue;
        const cost = Math.min(imageCost(image), cacheBudget / 2);
        if (reserved + cost > cacheBudget / 2) continue;
        wanted.set(image.file_path, {image, cost});
        reserved += cost;
    }
    return wanted;
}
async function pumpImageCache() {
    if (!state.isViewerMode || !state.images[state.currentIndex]) return;
    const wanted = wantedImages();
    trimImageCache(wanted);
    const current = state.images[state.currentIndex];
    const ready = imageCache.get(current.file_path);
    if (ready) presentImage(ready, current);
    if (cacheWorker) return;
    const next = cacheOrder().map(i => wanted.get(state.images[i].file_path)).find(entry =>
        entry && !imageCache.has(entry.image.file_path) && !failedImages.has(entry.image.file_path));
    if (!next) return;
    cacheWorker = true;
    const generation = cacheGeneration;
    const node = new Image();
    node.decoding = 'async';
    try {
        const stillWanted = () => generation === cacheGeneration && state.isViewerMode &&
            wantedImages().has(next.image.file_path);
        const src = await api.getImageSource(next.image, imageCost(next.image) > cacheBudget / 2);
        // A desktop response can arrive after a jump or a folder change.
        if (!stillWanted()) return;
        node.src = src;
        await node.decode();
        if (stillWanted()) {
            imageCache.set(next.image.file_path, {node, cost: next.cost});
            cacheBytes += next.cost;
        } else node.removeAttribute('src');
    } catch (error) {
        node.removeAttribute('src');
        if (generation === cacheGeneration) {
            failedImages.add(next.image.file_path);
            if (state.images[state.currentIndex]?.file_path === next.image.file_path)
                showToast('画像を読み込めませんでした', 'error');
        }
    } finally {
        cacheWorker = false;
        pumpImageCache();
    }
}

// ローディング表示（タイトルバーに表示）
function showLoading() {
    updateWindowTitle('RView - 読み込み中...');
}

function hideLoading() {
    if (state.isViewerMode && state.images[state.currentIndex]) updateWindowTitleForImage();
    else updateWindowTitle('RView');
}

function updateLoadingProgress() {
    const percent = state.totalCount > 0 ? Math.round((state.loadedCount / state.totalCount) * 100) : 0;
    updateWindowTitle(`RView - 読み込み中... ${state.loadedCount}/${state.totalCount} (${percent}%)`);
}

// サムネイル一覧の描画
function renderThumbnails() {
    thumbnailObserver.disconnect();
    thumbnailQueue.clear();
    elements.thumbnailGrid.replaceChildren();

    state.images.forEach((image, index) => {
        const item = createThumbnailItem(image, index);
        elements.thumbnailGrid.appendChild(item);
    });
}

// サムネイルを追加（バックグラウンド読み込み用）
function appendThumbnails(images, startIndex) {
    images.forEach((image, i) => {
        const item = createThumbnailItem(image, startIndex + i);
        elements.thumbnailGrid.appendChild(item);
    });
}

// サムネイルアイテムを作成
function createThumbnailItem(image, index) {
    const item = document.createElement('div');
    item.className = 'thumbnail-item';
    const img = document.createElement('img');
    img.alt = image.name;
    img.decoding = 'async';
    img.imageRecord = image;
    const info = document.createElement('div');
    info.className = 'thumbnail-info';
    const filename = document.createElement('div');
    filename.className = 'filename';
    filename.textContent = image.name;
    const dimensions = document.createElement('div');
    dimensions.textContent = `${image.width} x ${image.height}`;
    info.append(filename, dimensions);
    item.append(img, info);
    thumbnailObserver.observe(img);
    item.addEventListener('click', () => openViewer(index));
    return item;
}

// ビューワーを開く
function openViewer(index) {
    state.currentIndex = index;
    state.isViewerMode = true;
    elements.thumbnailView.classList.remove('active');
    elements.viewerMode.classList.add('active');

    showImage(index);
    updateSlider();
    updateWatchingState();
}

// ビューワーを閉じる（サムネイル一覧に戻る）
function closeViewer() {
    state.isViewerMode = false;
    clearMainImage();
    updateWatchingState();
    elements.viewerMode.classList.remove('active');
    elements.thumbnailView.classList.add('active');
    closeMenu();

    // タイトルをリセット
    updateWindowTitle('RView');

    // カーソルを表示してタイマーをクリア
    document.body.classList.remove('cursor-hidden');
    state.isCursorHidden = false;
    if (state.cursorHideTimer) {
        clearTimeout(state.cursorHideTimer);
        state.cursorHideTimer = null;
    }
}

// アプリケーションを終了
async function exitApp() {
    try {
        await api.quitApp();
    } catch (error) {
        console.error('Failed to exit app:', error);
    }
}

// 画像を表示
function showImage(index) {
    if (index < 0 || index >= state.images.length) return;

    const image = state.images[index];
    state.currentIndex = index;

    // トーストを即座に消す
    hideToast();

    // Keep the previous image visible until decoding completes.
    pumpImageCache();

    // 情報を更新
    updateImageInfo();



    // スライダーを更新
    updateSlider();

    // タイトルバーを更新
    updateWindowTitleForImage();
    updateWatchingState();
}

// 自動回転の判定と適用
function checkAndRotate(image) {
    const container = elements.imageContainer;
    const containerWidth = container.clientWidth;
    const containerHeight = container.clientHeight;
    const screenAspect = containerWidth / containerHeight;
    const imageAspect = image.width / image.height;

    if (!state.autoRotate) {
        elements.mainImage.classList.remove('rotated');
        applyFitToScreen(image.width, image.height, containerWidth, containerHeight, false);
        return;
    }

    // モニタが横長(>1)で画像が縦長(<1)、またはその逆の場合に回転
    const shouldRotate = (screenAspect > 1 && imageAspect < 1) ||
                         (screenAspect < 1 && imageAspect > 1);

    if (shouldRotate) {
        elements.mainImage.classList.add('rotated');
        // 回転時は幅と高さが入れ替わる
        applyFitToScreen(image.height, image.width, containerWidth, containerHeight, true);
    } else {
        elements.mainImage.classList.remove('rotated');
        applyFitToScreen(image.width, image.height, containerWidth, containerHeight, false);
    }
}

// 画面にフィットさせる（見切れなし、最大限大きく）
function applyFitToScreen(imgWidth, imgHeight, containerWidth, containerHeight, isRotated) {
    const imgAspect = imgWidth / imgHeight;
    const containerAspect = containerWidth / containerHeight;

    let displayWidth, displayHeight;

    if (imgAspect > containerAspect) {
        // 画像が横長 → 幅を合わせる
        displayWidth = containerWidth;
        displayHeight = containerWidth / imgAspect;
    } else {
        // 画像が縦長 → 高さを合わせる
        displayHeight = containerHeight;
        displayWidth = containerHeight * imgAspect;
    }

    // 実際の表示倍率を計算（元画像に対する表示サイズの比率）
    const image = state.images[state.currentIndex];
    if (image) {
        state.displayScale = displayWidth / imgWidth;
    }
    state.fitWidth = displayWidth;
    state.fitHeight = displayHeight;

    // 回転時の調整
    if (isRotated) {
        elements.mainImage.style.width = `${displayHeight}px`;
        elements.mainImage.style.height = `${displayWidth}px`;
        elements.mainImage.style.maxWidth = 'none';
        elements.mainImage.style.maxHeight = 'none';
    } else {
        elements.mainImage.style.width = `${displayWidth}px`;
        elements.mainImage.style.height = `${displayHeight}px`;
        elements.mainImage.style.maxWidth = 'none';
        elements.mainImage.style.maxHeight = 'none';
    }

    applyZoom();
}

// 画像情報の更新
function updateImageInfo() {
    const image = state.images[state.currentIndex];
    elements.imageInfo.textContent = `${state.currentIndex + 1} / ${state.images.length}`;
    elements.sliderValue.textContent = `${state.currentIndex + 1} / ${state.images.length}`;
}

// ウィンドウタイトルを更新
function updateWindowTitle(title) {
    const folder = state.directory.split(/[\\/]/).filter(Boolean).pop();
    title = folder ? `${folder} — ${title}` : title;
    document.title = title;
    try {
        Promise.resolve(api.setWindowTitle(title)).catch(console.error);
    } catch (error) {
        console.error('Failed to set window title:', error);
    }
}

// 画像表示時のタイトル更新
function updateWindowTitleForImage() {
    const image = state.images[state.currentIndex];
    // 実際の表示倍率 = 基本表示倍率 × ズーム倍率
    const actualScale = state.displayScale * state.zoom;
    const scalePercent = Math.round(actualScale * 100);
    const title = `${image.name} - ${image.width}x${image.height} - ${state.currentIndex + 1}/${state.images.length} - ${scalePercent}% - RView`;
    updateWindowTitle(title);
}

// 画像数の更新
function updateImageCount() {
    if (state.isLoading && state.loadedCount < state.totalCount) {
        elements.imageCount.textContent = `${state.loadedCount} / ${state.totalCount} images (読み込み中...)`;
    } else {
        elements.imageCount.textContent = `${state.images.length} images`;
    }
}

async function updateCurrentFolderPath() {
    try {
        const directory = await api.getCurrentDirectory();
        if (directory) {
            state.directory = directory;
            elements.currentFolderPath.textContent = directory;
            elements.currentFolderPath.title = directory;
            return;
        }
    } catch (error) {
        console.error('Failed to get current folder:', error);
    }

    elements.currentFolderPath.textContent = '-';
    elements.currentFolderPath.title = '';
}

// スライダーの更新
function updateSlider() {
    elements.imageSlider.max = Math.max(0, state.images.length - 1);
    elements.imageSlider.value = state.currentIndex;
}

function updateWatchingState() {
    state.isWatchingForNew = (
        state.isViewerMode &&
        state.images.length > 0 &&
        state.currentIndex === state.images.length - 1
    );
}

// メニューの開閉
function toggleMenu() {
    state.isMenuOpen = !state.isMenuOpen;
    if (state.isMenuOpen) {
        elements.menu.classList.add('active');
    } else {
        elements.menu.classList.remove('active');
    }
}

function closeMenu() {
    state.isMenuOpen = false;
    elements.menu.classList.remove('active');
}

// ズーム機能
function zoomIn() {
    state.zoom = Math.min(state.zoom + 0.2, 5.0);
    applyZoom();
    updateWindowTitleForImage();
}

function zoomOut() {
    state.zoom = Math.max(state.zoom - 0.2, 0.5);
    applyZoom();
    updateWindowTitleForImage();
}

function resetZoom() {
    state.zoom = 1.0;
    state.panX = 0;
    state.panY = 0;
    applyZoom();
}

function clampPan() {
    if (state.zoom <= 1.0) {
        state.panX = 0;
        state.panY = 0;
        return;
    }

    const containerWidth = elements.imageContainer.clientWidth;
    const containerHeight = elements.imageContainer.clientHeight;
    const scaledWidth = state.fitWidth * state.zoom;
    const scaledHeight = state.fitHeight * state.zoom;

    const maxPanX = Math.max(0, (scaledWidth - containerWidth) / 2);
    const maxPanY = Math.max(0, (scaledHeight - containerHeight) / 2);

    state.panX = Math.max(-maxPanX, Math.min(maxPanX, state.panX));
    state.panY = Math.max(-maxPanY, Math.min(maxPanY, state.panY));
}

function applyZoom() {
    clampPan();
    const rotation = elements.mainImage.classList.contains('rotated') ? 'rotate(90deg)' : '';
    const transform = `translate(${state.panX}px, ${state.panY}px) ${rotation} scale(${state.zoom})`;
    elements.mainImage.style.transform = transform;

    // 実際の表示倍率を表示
    const actualScale = state.displayScale * state.zoom;
    elements.zoomLevel.textContent = `${Math.round(actualScale * 100)}%`;
}

// ドラッグ機能（ズーム時の移動）
function startDrag(e) {
    if (e.button !== 0 || state.zoom <= 1.0) return;
    state.isDragging = true;
    state.dragStartX = e.clientX;
    state.dragStartY = e.clientY;
    state.dragOriginPanX = state.panX;
    state.dragOriginPanY = state.panY;
    state.dragMoved = false;
    elements.mainImage.classList.add('dragging');
    e.preventDefault();
}

function drag(e) {
    if (!state.isDragging) return;
    const deltaX = e.clientX - state.dragStartX;
    const deltaY = e.clientY - state.dragStartY;
    if (Math.abs(deltaX) > 2 || Math.abs(deltaY) > 2) {
        state.dragMoved = true;
    }
    state.panX = state.dragOriginPanX + deltaX;
    state.panY = state.dragOriginPanY + deltaY;
    applyZoom();
    e.preventDefault();
}

function endDrag() {
    if (state.isDragging && state.dragMoved) {
        state.suppressNextClick = true;
    }
    state.isDragging = false;
    state.dragMoved = false;
    elements.mainImage.classList.remove('dragging');
}

// 次の画像へ
function nextImage() {
    if (state.currentIndex < state.images.length - 1) {
        showImage(state.currentIndex + 1);
    }
}

// 前の画像へ
function prevImage() {
    if (state.currentIndex > 0) {
        showImage(state.currentIndex - 1);
    }
}

// 新規画像の監視
function startWatchingForNewImages() {
    setInterval(async () => {
        if (!state.isViewerMode || !state.isWatchingForNew || state.isLoading || state.changingDirectory || state.watchingInFlight || state.favoriteInFlight) return;
        const version = state.loadVersion;
        state.watchingInFlight = true;

        try {
            const newCount = await api.getImageCount();
            if (version !== state.loadVersion) return;
            if (newCount > state.loadedCount) {
                // 新しい画像を取得
                const batch = await api.getImagesBatch(state.loadedCount, Math.min(50, newCount - state.loadedCount));
                if (version !== state.loadVersion) return;
                if (batch.images.length > 0) {
                    console.log(`New image detected! (${batch.images.length} new)`);
                    appendImageBatch(batch);
                    state.totalCount = newCount;
                    updateImageCount();

                    // 最後を見ている時だけ、新しい最新画像へ自動追従
                    showImage(state.images.length - 1);
                }
            }
        } catch (error) {
            console.error('Failed to check for new images:', error);
        } finally { state.watchingInFlight = false; }
    }, 1000); // 1秒ごとにチェック
}

// ファイル操作
async function saveAs() {
    try {
        const image = state.images[state.currentIndex];
        const result = await api.saveAs(image.file_path, state.currentIndex);
        if (result) {
            showToast('保存しました', 'success', 1000);
        }
    } catch (error) {
        console.error('Failed to save:', error);
        showToast('保存に失敗しました', 'error');
    }
}

async function addToFavorites() {
    await moveCurrentToFavorites(1);
}

async function addToFavorites2() {
    await moveCurrentToFavorites(2);
}

async function moveCurrentToFavorites(slot) {
    const image = state.images[state.currentIndex];
    if (!image || state.favoriteInFlight || state.changingDirectory) return;
    state.favoriteInFlight = true;
    // Cancel batches using pre-move offsets, then resume at the adjusted offset.
    const version = ++state.loadVersion;
    try {
        const success = slot === 2
            ? await api.addToFavorites2(image.file_path)
            : await api.addToFavorites(image.file_path);
        if (!success) throw new Error('Move failed');
        if (version !== state.loadVersion) return;
        const index = state.images.indexOf(image);
        if (index >= 0) {
            state.images.splice(index, 1);
            state.imagePaths.delete(image.file_path);
            state.loadedCount--;
            state.totalCount--;
            if (index < state.currentIndex) state.currentIndex--;
            renderThumbnails();
            updateImageCount();
            if (state.images.length) {
                showImage(Math.min(state.currentIndex, state.images.length - 1));
            } else {
                closeViewer();
            }
        }
        showToast(`お気に入り${slot === 2 ? '2' : ''}に追加: ${image.name}`, 'success', 1000);
    } catch (error) {
        console.error('Failed to move to favorites:', error);
        showToast('お気に入りへの追加に失敗しました', 'error');
    } finally {
        state.favoriteInFlight = false;
        if (version === state.loadVersion) {
            state.isLoading = state.loadedCount < state.totalCount;
            if (state.isLoading) loadRemainingImages(version);
            else hideLoading();
        }
    }
}

async function rateCurrentImage(rating) {
    if (state.ratingInFlight || !state.isViewerMode || !state.images.length || state.changingDirectory) return;
    const image = state.images[state.currentIndex];
    const version = state.loadVersion;
    state.ratingInFlight = true;
    try {
        if (!await api.rateImage(image.file_path, rating)) throw new Error('Rating not saved');
        if (version !== state.loadVersion || state.images[state.currentIndex] !== image) return;
        nextImage();
        const labels = {2: '良い', 1: 'やや良い', '-1': 'やや悪い', '-2': '悪い'};
        showToast(`${labels[rating]}を記録しました`, 'success', 900);
    } catch (error) {
        showToast('評価を保存できませんでした', 'error');
    } finally { state.ratingInFlight = false; }
}

async function copyCurrentImageToClipboard() {
    try {
        const image = state.images[state.currentIndex];
        const success = await api.copyImageToClipboard(image.file_path);
        if (success) {
            showToast('クリップボードにコピーしました', 'success', 1000);
            return;
        }
        showToast('この環境では画像コピーに対応していません', 'error');
    } catch (error) {
        console.error('Failed to copy image:', error);
        showToast('クリップボードへのコピーに失敗しました', 'error');
    }
}

async function deleteImage() {
    const image = state.images[state.currentIndex];
    const confirmed = confirm(`本当に削除しますか？\n${image.name}`);

    if (!confirmed) return;

    try {
        await api.deleteImage(image.file_path);

        // リストから削除
        state.images.splice(state.currentIndex, 1);
        state.imagePaths.delete(image.file_path);
        renderThumbnails();
        state.totalCount--;
        state.loadedCount--;
        updateImageCount();

        // 次の画像を表示（または前の画像）
        if (state.images.length === 0) {
            closeViewer();
        } else if (state.currentIndex >= state.images.length) {
            showImage(state.images.length - 1);
        } else {
            showImage(state.currentIndex);
        }

        showToast('削除しました', 'success');
    } catch (error) {
        console.error('Failed to delete:', error);
        showToast('削除に失敗しました', 'error');
    }
}

async function openAdjacentDirectory(direction) {
    if (state.changingDirectory) return;
    state.changingDirectory = true;
    state.loadVersion++;
    const wasViewerMode = state.isViewerMode;
    try {
        const result = await api.stepDirectory(direction);
        if (!result || !result.success) {
            state.isLoading = state.loadedCount < state.totalCount;
            if (state.isLoading) loadRemainingImages(state.loadVersion);
            showToast('移動できるフォルダがありません', 'info');
            return;
        }
        await reloadWithNewDirectory();
        if (wasViewerMode && state.images.length > 0) {
            openViewer(0);
        }
    } catch (error) {
        console.error('Failed to open adjacent folder:', error);
        await reloadWithNewDirectory(false);
        if (wasViewerMode && state.images.length) openViewer(0);
        showToast('フォルダ移動に失敗しました', 'error');
    } finally { state.changingDirectory = false; }
}

async function openPreviousDirectory() {
    await openAdjacentDirectory('prev');
}

async function openNextDirectory() {
    await openAdjacentDirectory('next');
}

// 全画面モード切り替え
async function toggleFullscreen() {
    try {
        await api.toggleFullscreen();
        // フルスクリーン切り替え後に画像サイズを再計算
        setTimeout(() => {
            if (state.isViewerMode && state.images.length > 0) {
                checkAndRotate(state.images[state.currentIndex]);
            }
        }, 100);
    } catch (error) {
        console.error('Failed to toggle fullscreen:', error);
    }
}

// トースト通知を表示
function showToast(message, type = 'info', duration = 2000) {
    // 既存のタイマーをクリア
    if (state.toastTimer) {
        clearTimeout(state.toastTimer);
        state.toastTimer = null;
    }

    // 既存のトーストをクリア
    elements.toast.className = 'toast';
    elements.toast.textContent = message;

    // タイプに応じたクラスを追加
    if (type) {
        elements.toast.classList.add(type);
    }

    // 表示
    setTimeout(() => {
        elements.toast.classList.add('show');
    }, 10);

    // 自動で非表示
    state.toastTimer = setTimeout(() => {
        elements.toast.classList.remove('show');
        state.toastTimer = null;
    }, duration);
}

// トーストを即座に非表示
function hideToast() {
    if (state.toastTimer) {
        clearTimeout(state.toastTimer);
        state.toastTimer = null;
    }
    elements.toast.classList.remove('show');
}

// フォルダドロップのセットアップ
function setupDragAndDrop() {
    document.body.addEventListener('dragover', (e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
    });

    document.body.addEventListener('drop', async (e) => {
        e.preventDefault();

        const items = e.dataTransfer.items;
        if (items && items.length > 0) {
            for (let i = 0; i < items.length; i++) {
                const item = items[i];
                if (item.kind === 'file') {
                    const entry = item.webkitGetAsEntry ? item.webkitGetAsEntry() : null;
                    if (entry && entry.isDirectory) {
                        const file = item.getAsFile();
                        if (file && file.path) {
                            await changeDirectory(file.path);
                            return;
                        }
                    }
                }
            }

            const files = e.dataTransfer.files;
            if (files.length > 0) {
                const path = files[0].path;
                if (path) {
                    await changeDirectory(path);
                }
            }
        }
    });
}

// フォルダ変更
async function changeDirectory(path) {
    if (state.changingDirectory) return;
    state.changingDirectory = true;
    state.loadVersion++;
    try {
        const success = await api.changeDirectory(path);
        if (success) {
            await reloadWithNewDirectory();
            return;
        }
        await reloadWithNewDirectory(false);
        showToast('画像があるフォルダのみ開けます', 'error');
    } catch (error) {
        console.error('Failed to change folder:', error);
        await reloadWithNewDirectory(false);
        showToast('フォルダ変更に失敗しました', 'error');
    } finally { state.changingDirectory = false; }
}

async function changeDirectoryFromButton() {
    try {
        let path = null;
        if (state.isRemoteMode) {
            path = window.prompt('開きたいフォルダのパスを入力してください');
        } else {
            path = await api.selectDirectory();
        }

        if (!path || typeof path !== 'string' || path.trim() === '') {
            return;
        }
        await changeDirectory(path.trim());
    } catch (error) {
        console.error('Failed to select folder:', error);
        showToast('フォルダ変更に失敗しました', 'error');
    }
}

// 新しいフォルダで再読み込み
async function reloadWithNewDirectory(notify = true) {
    if (state.isViewerMode) {
        closeViewer();
    }

    await loadImagesProgressively();
    if (notify) showToast('フォルダを変更しました', 'info');
}

// 矢印ボタンの表示制御
function setupArrowVisibility() {
    const threshold = 150;

    document.addEventListener('mousemove', (e) => {
        if (!state.isViewerMode) return;

        const leftArrow = elements.prevBtn;
        const rightArrow = elements.nextBtn;

        if (e.clientX < threshold) {
            leftArrow.classList.add('visible');
        } else {
            leftArrow.classList.remove('visible');
        }

        if (window.innerWidth - e.clientX < threshold) {
            rightArrow.classList.add('visible');
        } else {
            rightArrow.classList.remove('visible');
        }
    });
}

// マウスカーソル自動非表示（ビューワーモードで3秒間動かさないと非表示）
function setupCursorAutoHide() {
    document.addEventListener('mousemove', () => {
        showCursor();
        resetCursorHideTimer();
    });

    document.addEventListener('mousedown', () => {
        showCursor();
        resetCursorHideTimer();
    });
}

function showCursor() {
    if (state.isCursorHidden) {
        document.body.classList.remove('cursor-hidden');
        state.isCursorHidden = false;
    }
}

function hideCursor() {
    if (state.isViewerMode && !state.isMenuOpen) {
        document.body.classList.add('cursor-hidden');
        state.isCursorHidden = true;
    }
}

function resetCursorHideTimer() {
    if (state.cursorHideTimer) {
        clearTimeout(state.cursorHideTimer);
    }
    if (state.isViewerMode) {
        state.cursorHideTimer = setTimeout(hideCursor, 3000);
    }
}

// イベントリスナーの設定
function setupEventListeners() {
    // リフレッシュボタン
    document.getElementById('refresh-btn').addEventListener('click', async () => {
        await loadImagesProgressively();

    });
    document.getElementById('change-folder-btn').addEventListener('click', changeDirectoryFromButton);

    // ビューワーモードのボタン
    document.getElementById('close-menu-btn').addEventListener('click', closeMenu);
    document.getElementById('zoom-in-btn').addEventListener('click', zoomIn);
    document.getElementById('zoom-out-btn').addEventListener('click', zoomOut);
    document.getElementById('zoom-reset-btn').addEventListener('click', resetZoom);
    document.getElementById('save-as-btn').addEventListener('click', saveAs);
    document.getElementById('favorite-btn').addEventListener('click', addToFavorites);
    document.getElementById('favorite2-btn').addEventListener('click', addToFavorites2);
    document.getElementById('clipboard-btn').addEventListener('click', copyCurrentImageToClipboard);
    document.getElementById('delete-btn').addEventListener('click', deleteImage);
    document.querySelectorAll('[data-rating]').forEach(button => {
        button.addEventListener('click', () => rateCurrentImage(Number(button.dataset.rating)));
    });
    document.getElementById('prev-dir-btn').addEventListener('click', openPreviousDirectory);
    document.getElementById('next-dir-btn').addEventListener('click', openNextDirectory);
    document.getElementById('fullscreen-btn').addEventListener('click', toggleFullscreen);
    document.getElementById('thumbnail-btn').addEventListener('click', closeViewer);
    document.getElementById('exit-viewer-btn').addEventListener('click', exitApp);

    // ナビゲーション矢印
    elements.prevBtn.addEventListener('click', prevImage);
    elements.nextBtn.addEventListener('click', nextImage);

    // スライダー
    elements.imageSlider.addEventListener('input', (e) => {
        showImage(parseInt(e.target.value));
    });

    // A click used to focus the window must not also open its menu.
    let pointerStartedUnfocused = false;
    window.addEventListener('blur', () => { pointerStartedUnfocused = true; });
    window.addEventListener('focus', () => { setTimeout(() => { pointerStartedUnfocused = false; }, 200); });
    document.addEventListener('pointerdown', () => {
        if (!document.hasFocus()) pointerStartedUnfocused = true;
    }, true);
    document.addEventListener('click', (event) => {
        pointerStartedUnfocused = false;
        if (state.isMenuOpen && !elements.menu.contains(event.target) && !elements.imageContainer.contains(event.target)) closeMenu();
    });

    // Image/background clicks toggle the menu; its own controls stay open.
    elements.imageContainer.addEventListener('click', (e) => {
        if (!state.isViewerMode || pointerStartedUnfocused) {
            return;
        }
        if (state.suppressNextClick) {
            state.suppressNextClick = false;
            return;
        }
        toggleMenu();
    });

    // ドラッグ機能
    elements.imageContainer.addEventListener('mousedown', startDrag);
    document.addEventListener('mousemove', drag);
    document.addEventListener('mouseup', endDrag);

    // キーボード操作
    document.addEventListener('keydown', (e) => {
        if (e.target.closest('input, textarea, select, [contenteditable="true"]')) return;
        // F11キーは常に有効（全画面切り替え）
        if (e.key === 'F11') {
            e.preventDefault();
            toggleFullscreen();
            return;
        }

        const withModifier = e.ctrlKey || e.metaKey;
        if (withModifier && e.key.toLowerCase() === 's' && state.isViewerMode) {
            e.preventDefault();
            saveAs();
            return;
        }

        if (withModifier && e.key.toLowerCase() === 'c' && state.isViewerMode) {
            e.preventDefault();
            copyCurrentImageToClipboard();
            return;
        }

        if (e.code === 'BracketLeft' || e.key === '[') {
            e.preventDefault();
            openPreviousDirectory();
            return;
        }

        if (e.code === 'BracketRight' || e.key === ']') {
            e.preventDefault();
            openNextDirectory();
            return;
        }

        if (!state.isViewerMode) return;

        const up = ['ArrowUp', 'Numpad5'].includes(e.code) || (e.code === 'KeyW' && !withModifier);
        const down = ['ArrowDown', 'Numpad2'].includes(e.code) || (e.code === 'KeyS' && !withModifier);
        if ((up || down) && !e.altKey && !e.metaKey) {
            e.preventDefault();
            if (!e.repeat) rateCurrentImage((up ? 1 : -1) * (e.ctrlKey ? 1 : 2));
            return;
        }
        if (!withModifier && !e.altKey && ['KeyA', 'Numpad4', 'KeyD', 'Numpad6'].includes(e.code)) {
            e.preventDefault();
            if (['KeyA', 'Numpad4'].includes(e.code)) prevImage(); else nextImage();
            return;
        }

        switch (e.key) {
            case 'ArrowLeft':
                e.preventDefault();
                prevImage();
                break;
            case 'ArrowRight':
                e.preventDefault();
                nextImage();
                break;
            case 'Insert':
                e.preventDefault();
                if (e.shiftKey) {
                    addToFavorites2();
                } else {
                    addToFavorites();
                }
                break;
            case 'Delete':
                deleteImage();
                break;
            case 'Enter':
                e.preventDefault();
                toggleMenu();
                break;
            case 'Escape':
                if (state.isMenuOpen) {
                    closeMenu();
                } else {
                    closeViewer();
                }
                break;
        }
    });

    // ウィンドウリサイズ時の自動回転再判定
    window.addEventListener('resize', () => {
        if (state.isViewerMode && state.images.length > 0) {
            checkAndRotate(state.images[state.currentIndex]);
        }
    });

    // 矢印ボタンの表示制御
    setupArrowVisibility();

    // マウスカーソル自動非表示
    setupCursorAutoHide();
}

// ページ読み込み時に初期化
window.addEventListener('DOMContentLoaded', init);
