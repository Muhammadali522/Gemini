// ==================== UNIVERSAL BYPASS BRIDGE (ISOLATED WORLD) ====================
// Управляет состоянием обхода из хранилища Chrome без модификации DOM-атрибутов страницы.

(function () {
    'use strict';

    let isEnabled = true;

    function syncState(active) {
        isEnabled = active;
        try {
            window.postMessage({ type: 'GEMINI_BYPASS_UPDATE', enabled: active }, '*');
        } catch (e) {}
    }

    chrome.storage.sync.get(['bypassEnabled', 'isEnabled'], (data) => {
        const active = data.bypassEnabled !== undefined ? data.bypassEnabled : (data.isEnabled !== false);
        syncState(active);
    });

    chrome.storage.onChanged.addListener((changes) => {
        if (changes.bypassEnabled || changes.isEnabled) {
            const active = changes.bypassEnabled ? changes.bypassEnabled.newValue : changes.isEnabled?.newValue;
            syncState(active !== false);
        }
    });

    const events = [
        'blur', 'focusout', 'focusin', 'visibilitychange',
        'webkitvisibilitychange', 'fullscreenchange', 'webkitfullscreenchange',
        'pagehide', 'freeze', 'resume'
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