// グローバル状態管理
const state = {
    images: [],
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
            link.href = `/api/download/${index}`;
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

// 段階的な画像読み込み
async function loadImagesProgressively() {
    try {
        state.isLoading = true;
        showLoading();

        // まず総数を取得
        const totalCount = await api.getImageCount();
        state.totalCount = totalCount;
        state.images = [];
        state.loadedCount = 0;

        if (totalCount === 0) {
            hideLoading();
            updateImageCount();
            renderThumbnails();
            state.isLoading = false;
            return;
        }

        // 最初の30枚を読み込んで即座に表示
        const INITIAL_BATCH = 30;
        const firstBatch = await api.getImagesBatch(0, INITIAL_BATCH);
        state.images = firstBatch.images;
        state.loadedCount = firstBatch.loaded;

        updateLoadingProgress();
        updateImageCount();
        renderThumbnails();

        // 残りをバックグラウンドで読み込む
        if (state.loadedCount < totalCount) {
            loadRemainingImages();
        } else {
            hideLoading();
            state.isLoading = false;
        }

    } catch (error) {
        console.error('Failed to load images:', error);
        hideLoading();
        state.isLoading = false;
        state.images = [];
    }
}

// 残りの画像をバックグラウンドで読み込む
async function loadRemainingImages() {
    const BATCH_SIZE = 50;

    while (state.loadedCount < state.totalCount) {
        try {
            const batch = await api.getImagesBatch(state.loadedCount, BATCH_SIZE);
            state.images = state.images.concat(batch.images);
            state.loadedCount = batch.loaded;

            updateLoadingProgress();
            updateImageCount();
            appendThumbnails(batch.images, state.images.length - batch.images.length);

            // UIの応答性を維持するための小さな遅延
            await new Promise(resolve => setTimeout(resolve, 10));
        } catch (error) {
            console.error('Failed to load batch:', error);
            break;
        }
    }

    hideLoading();
    state.isLoading = false;
    console.log(`Loaded all ${state.images.length} images`);
}

// ローディング表示（タイトルバーに表示）
function showLoading() {
    updateWindowTitle('RView - 読み込み中...');
}

function hideLoading() {
    updateWindowTitle('RView');
}

function updateLoadingProgress() {
    const percent = state.totalCount > 0 ? Math.round((state.loadedCount / state.totalCount) * 100) : 0;
    updateWindowTitle(`RView - 読み込み中... ${state.loadedCount}/${state.totalCount} (${percent}%)`);
}

// サムネイル一覧の描画
function renderThumbnails() {
    elements.thumbnailGrid.innerHTML = '';

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
    item.innerHTML = `
        <img src="${image.data}" alt="${image.name}">
        <div class="thumbnail-info">
            <div class="filename">${image.name}</div>
            <div>${image.width} x ${image.height}</div>
        </div>
    `;
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

    // 画像データを設定
    elements.mainImage.src = image.data;

    // 情報を更新
    updateImageInfo();

    // ズームをリセット
    resetZoom();

    // 自動回転の判定
    checkAndRotate(image);

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
    try {
        api.setWindowTitle(title);
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
        if (!state.isViewerMode || !state.isWatchingForNew) return;

        try {
            const newCount = await api.getImageCount();
            if (newCount > state.images.length) {
                // 新しい画像を取得
                const batch = await api.getImagesBatch(state.images.length, newCount - state.images.length);
                if (batch.images.length > 0) {
                    console.log(`New image detected! (${batch.images.length} new)`);
                    state.images = state.images.concat(batch.images);
                    state.totalCount = newCount;
                    state.loadedCount = newCount;
                    updateImageCount();

                    // 最後を見ている時だけ、新しい最新画像へ自動追従
                    showImage(state.images.length - 1);
                }
            }
        } catch (error) {
            console.error('Failed to check for new images:', error);
        }
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
    try {
        const image = state.images[state.currentIndex];
        await api.addToFavorites(image.file_path);
        showToast(`お気に入りに追加: ${image.name}`, 'success', 1000);
    } catch (error) {
        console.error('Failed to add to favorites:', error);
        showToast('お気に入りへの追加に失敗しました', 'error');
    }
}

async function addToFavorites2() {
    try {
        const image = state.images[state.currentIndex];
        await api.addToFavorites2(image.file_path);
        showToast(`お気に入り2に追加: ${image.name}`, 'success', 1000);
    } catch (error) {
        console.error('Failed to add to favorites2:', error);
        showToast('お気に入り2への追加に失敗しました', 'error');
    }
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
    const wasViewerMode = state.isViewerMode;
    try {
        const result = await api.stepDirectory(direction);
        if (!result || !result.success) {
            showToast('移動できるフォルダがありません', 'info');
            return;
        }
        await reloadWithNewDirectory();
        if (wasViewerMode && state.images.length > 0) {
            openViewer(0);
        }
    } catch (error) {
        console.error('Failed to open adjacent folder:', error);
        showToast('フォルダ移動に失敗しました', 'error');
    }
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
                    const success = await api.changeDirectory(path);
                    if (success) {
                        await reloadWithNewDirectory();
                    }
                }
            }
        }
    });
}

// フォルダ変更
async function changeDirectory(path) {
    try {
        const success = await api.changeDirectory(path);
        if (success) {
            await reloadWithNewDirectory();
            return;
        }
        showToast('画像があるフォルダのみ開けます', 'error');
    } catch (error) {
        console.error('Failed to change folder:', error);
        showToast('フォルダ変更に失敗しました', 'error');
    }
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
async function reloadWithNewDirectory() {
    if (state.isViewerMode) {
        closeViewer();
    }

    await loadImagesProgressively();
    renderThumbnails();
    await updateCurrentFolderPath();
    showToast('フォルダを変更しました', 'info');
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
        renderThumbnails();
        await updateCurrentFolderPath();
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

    // 画像クリックでメニュー表示
    elements.imageContainer.addEventListener('click', (e) => {
        if (!state.isViewerMode || state.isMenuOpen) {
            return;
        }
        if (state.suppressNextClick) {
            state.suppressNextClick = false;
            return;
        }
        toggleMenu();
    });

    // ドラッグ機能
    elements.mainImage.addEventListener('mousedown', startDrag);
    document.addEventListener('mousemove', drag);
    document.addEventListener('mouseup', endDrag);

    // キーボード操作
    document.addEventListener('keydown', (e) => {
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

        switch (e.key) {
            case 'ArrowLeft':
                prevImage();
                break;
            case 'ArrowRight':
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
