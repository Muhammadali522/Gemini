// ==================== UNIVERSAL BYPASS BRIDGE (ISOLATED WORLD) ====================
// Управляет состоянием обхода из хранилища Chrome и передает его в MAIN world.

(function () {
    'use strict';

    let isEnabled = true;

    function syncState(active) {
        isEnabled = active;
        window.postMessage({ type: 'GEMINI_BYPASS_UPDATE', enabled: active }, '*');
        if (document.documentElement) {
            document.documentElement.setAttribute('data-gemini-bypass', active ? 'true' : 'false');
        }
    }

    // Инициализация состояния
    chrome.storage.sync.get(['bypassEnabled', 'isEnabled'], (data) => {
        const active = data.bypassEnabled !== undefined ? data.bypassEnabled : (data.isEnabled !== false);
        syncState(active);
    });

    // Реакция на изменение настроек пользователем
    chrome.storage.onChanged.addListener((changes) => {
        if (changes.bypassEnabled || changes.isEnabled) {
            const active = changes.bypassEnabled ? changes.bypassEnabled.newValue : changes.isEnabled?.newValue;
            syncState(active !== false);
        }
    });

    // Подавление событий в изолированном контексте
    const events = [
        'blur', 'focusout', 'focusin', 'visibilitychange',
        'webkitvisibilitychange', 'fullscreenchange', 'webkitfullscreenchange'
    ];

    events.forEach(ev => {
        window.addEventListener(ev, e => {
            if (isEnabled) {
                e.stopImmediatePropagation();
            }
        }, true);
        document.addEventListener(ev, e => {
            if (isEnabled) {
                e.stopImmediatePropagation();
            }
        }, true);
    });
})();