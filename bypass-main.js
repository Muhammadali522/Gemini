// ==================== UNIVERSAL FULLSCREEN & PROCTORING BYPASS (MAIN WORLD) ====================
// Выполняется напрямую в контексте веб-страницы (MAIN world) на этапе document_start.
// Перехватывает методы проверки полноэкранного режима, фокуса, жизненного цикла и печати.
// При этом НЕ нарушает работу самого экзамена (таймеры, WebSocket, камера, сеть и хранилище остаются нативными).

(function () {
    'use strict';

    let isEnabled = true;
    let activeFullscreenElement = null;

    // Слушаем изменение настроек от расширения
    window.addEventListener('message', (event) => {
        if (event.data && event.data.type === 'GEMINI_BYPASS_UPDATE') {
            isEnabled = event.data.enabled !== false;
        }
    });

    // ==================== 1. ОБХОД FULLSCREEN ELEMENT & ВЕНДОРНЫХ СВОЙСТВ ====================
    const origFullscreenElement = Object.getOwnPropertyDescriptor(Document.prototype, 'fullscreenElement');
    const origWebkitFullscreenElement = Object.getOwnPropertyDescriptor(Document.prototype, 'webkitFullscreenElement');
    const origMozFullScreenElement = Object.getOwnPropertyDescriptor(Document.prototype, 'mozFullScreenElement');
    const origMsFullscreenElement = Object.getOwnPropertyDescriptor(Document.prototype, 'msFullscreenElement');

    function getEffectiveFullscreenElement() {
        if (!isEnabled) {
            return origFullscreenElement ? origFullscreenElement.get.call(document) : null;
        }
        if (activeFullscreenElement && activeFullscreenElement.isConnected) {
            return activeFullscreenElement;
        }
        return document.documentElement;
    }

    try {
        Object.defineProperty(document, 'fullscreenElement', {
            get: getEffectiveFullscreenElement,
            configurable: true
        });
        Object.defineProperty(document, 'webkitFullscreenElement', {
            get: getEffectiveFullscreenElement,
            configurable: true
        });
        Object.defineProperty(document, 'mozFullScreenElement', {
            get: getEffectiveFullscreenElement,
            configurable: true
        });
        Object.defineProperty(document, 'msFullscreenElement', {
            get: getEffectiveFullscreenElement,
            configurable: true
        });
        Object.defineProperty(document, 'webkitCurrentFullScreenElement', {
            get: getEffectiveFullscreenElement,
            configurable: true
        });
    } catch (e) {}

    // Флаги полноэкранного режима
    try {
        Object.defineProperty(document, 'fullscreenEnabled', { get: () => true, configurable: true });
        Object.defineProperty(document, 'webkitFullscreenEnabled', { get: () => true, configurable: true });
        Object.defineProperty(document, 'mozFullScreenEnabled', { get: () => true, configurable: true });
        Object.defineProperty(document, 'msFullscreenEnabled', { get: () => true, configurable: true });
        Object.defineProperty(document, 'fullscreen', { get: () => isEnabled ? true : false, configurable: true });
        Object.defineProperty(document, 'webkitIsFullScreen', { get: () => isEnabled ? true : false, configurable: true });
        Object.defineProperty(document, 'mozFullScreen', { get: () => isEnabled ? true : false, configurable: true });
    } catch (e) {}

    // ==================== 2. ОБХОД Element.requestFullscreen ====================
    const origRequestFullscreen = Element.prototype.requestFullscreen;
    const origWebkitRequestFullscreen = Element.prototype.webkitRequestFullscreen || Element.prototype.webkitRequestFullScreen;
    const origMozRequestFullScreen = Element.prototype.mozRequestFullScreen;
    const origMsRequestFullscreen = Element.prototype.msRequestFullscreen;

    function fakeRequestFullscreen(origMethod, self, args) {
        activeFullscreenElement = self;
        if (!isEnabled && origMethod) {
            return origMethod.apply(self, args);
        }
        if (origMethod) {
            return origMethod.apply(self, args).catch(() => Promise.resolve());
        }
        return Promise.resolve();
    }

    Element.prototype.requestFullscreen = function (...args) {
        return fakeRequestFullscreen(origRequestFullscreen, this, args);
    };
    if (Element.prototype.webkitRequestFullscreen) {
        Element.prototype.webkitRequestFullscreen = function (...args) {
            return fakeRequestFullscreen(origWebkitRequestFullscreen, this, args);
        };
    }
    if (Element.prototype.webkitRequestFullScreen) {
        Element.prototype.webkitRequestFullScreen = function (...args) {
            return fakeRequestFullscreen(origWebkitRequestFullscreen, this, args);
        };
    }
    if (Element.prototype.mozRequestFullScreen) {
        Element.prototype.mozRequestFullScreen = function (...args) {
            return fakeRequestFullscreen(origMozRequestFullScreen, this, args);
        };
    }
    if (Element.prototype.msRequestFullscreen) {
        Element.prototype.msRequestFullscreen = function (...args) {
            return fakeRequestFullscreen(origMsRequestFullscreen, this, args);
        };
    }

    // ==================== 3. БЕЗОПАСНЫЙ exitFullscreen ====================
    const origExitFullscreen = document.exitFullscreen;
    document.exitFullscreen = function (...args) {
        if (!isEnabled && origExitFullscreen) {
            return origExitFullscreen.apply(this, args);
        }
        return Promise.resolve();
    };
    if (document.webkitExitFullscreen) {
        document.webkitExitFullscreen = function () { return Promise.resolve(); };
    }
    if (document.webkitCancelFullScreen) {
        document.webkitCancelFullScreen = function () { return Promise.resolve(); };
    }
    if (document.mozCancelFullScreen) {
        document.mozCancelFullScreen = function () { return Promise.resolve(); };
    }
    if (document.msExitFullscreen) {
        document.msExitFullscreen = function () { return Promise.resolve(); };
    }

    // ==================== 4. ПОДАВЛЕНИЕ СОБЫТИЙ FULLSCREENCHANGE ====================
    const fullscreenEvents = [
        'fullscreenchange', 'webkitfullscreenchange', 'mozfullscreenchange', 'MSFullscreenChange',
        'fullscreenerror', 'webkitfullscreenerror', 'mozfullscreenerror', 'MSFullscreenError'
    ];

    fullscreenEvents.forEach(evName => {
        const blocker = (e) => {
            if (isEnabled) {
                if (!activeFullscreenElement) activeFullscreenElement = document.documentElement;
                e.stopImmediatePropagation();
                e.preventDefault();
            }
        };
        window.addEventListener(evName, blocker, true);
        document.addEventListener(evName, blocker, true);
    });

    // ==================== 5. ОБХОД РАЗМЕРОВ ОКНА (outerWidth/Height vs screen) ====================
    try {
        const origOuterWidth = Object.getOwnPropertyDescriptor(window, 'outerWidth');
        const origOuterHeight = Object.getOwnPropertyDescriptor(window, 'outerHeight');

        Object.defineProperty(window, 'outerWidth', {
            get: () => isEnabled ? Math.max(window.innerWidth, screen.width) : (origOuterWidth ? origOuterWidth.get.call(window) : window.innerWidth),
            configurable: true
        });
        Object.defineProperty(window, 'outerHeight', {
            get: () => isEnabled ? Math.max(window.innerHeight, screen.height) : (origOuterHeight ? origOuterHeight.get.call(window) : window.innerHeight),
            configurable: true
        });
    } catch (e) {}

    // ==================== 6. ОБХОД ВИДИМОСТИ И ФОКУСА (hidden, visibilityState, hasFocus) ====================
    const origHidden = Object.getOwnPropertyDescriptor(Document.prototype, 'hidden');
    const origVisibilityState = Object.getOwnPropertyDescriptor(Document.prototype, 'visibilityState');
    const origHasFocus = document.hasFocus;

    try {
        Object.defineProperty(document, 'hidden', {
            get: () => isEnabled ? false : (origHidden ? origHidden.get.call(document) : false),
            configurable: true
        });
        Object.defineProperty(document, 'visibilityState', {
            get: () => isEnabled ? 'visible' : (origVisibilityState ? origVisibilityState.get.call(document) : 'visible'),
            configurable: true
        });
        if (origHasFocus) {
            document.hasFocus = () => isEnabled ? true : origHasFocus.call(document);
        }
    } catch (e) {}

    // ==================== 7. PAGE LIFECYCLE, ФОКУС И МЫШЬ ====================
    // Перехватываем только следящие события ухода/заморозки, НЕ затрагивая submit и нормальную навигацию
    const proctorEvents = [
        'blur', 'focusout', 'focusin', 'visibilitychange', 'webkitvisibilitychange',
        'pagehide', 'freeze', 'resume', 'mouseleave', 'mouseout'
    ];

    proctorEvents.forEach(evName => {
        const handler = (e) => {
            if (isEnabled) {
                if (evName === 'mouseleave' || evName === 'mouseout') {
                    if (e.target === document || e.target === window || !e.relatedTarget) {
                        e.stopImmediatePropagation();
                        e.preventDefault();
                    }
                } else if (evName === 'pagehide' || evName === 'freeze') {
                    // Глушим искусственные события ухода при переключении фокуса
                    if (!e.persisted) {
                        e.stopImmediatePropagation();
                    }
                } else {
                    e.stopImmediatePropagation();
                    e.preventDefault();
                }
            }
        };
        window.addEventListener(evName, handler, true);
        document.addEventListener(evName, handler, true);
    });

    // ==================== 8. PRINT DETECTION BYPASS ====================
    // Блокируем детектирование печати (beforeprint, afterprint, matchMedia('print'))
    window.addEventListener('beforeprint', (e) => {
        if (isEnabled) {
            e.stopImmediatePropagation();
            e.preventDefault();
        }
    }, true);
    window.addEventListener('afterprint', (e) => {
        if (isEnabled) {
            e.stopImmediatePropagation();
            e.preventDefault();
        }
    }, true);

    try {
        const origMatchMedia = window.matchMedia;
        if (origMatchMedia) {
            window.matchMedia = function (mediaQueryString) {
                if (isEnabled && typeof mediaQueryString === 'string' && mediaQueryString.includes('print')) {
                    return {
                        matches: false,
                        media: mediaQueryString,
                        onchange: null,
                        addListener: () => {},
                        removeListener: () => {},
                        addEventListener: () => {},
                        removeEventListener: () => {},
                        dispatchEvent: () => false
                    };
                }
                return origMatchMedia.apply(this, arguments);
            };
        }
    } catch (e) {}

    // ==================== 9. PERMISSION STATE CHECKS ====================
    // Защита от проверок разрешений камеры/микрофона
    try {
        if (navigator.permissions && navigator.permissions.query) {
            const origPermQuery = navigator.permissions.query;
            navigator.permissions.query = function (queryObj) {
                if (isEnabled && queryObj && (queryObj.name === 'camera' || queryObj.name === 'microphone' || queryObj.name === 'notifications')) {
                    return Promise.resolve({
                        state: 'granted',
                        name: queryObj.name,
                        onchange: null
                    });
                }
                return origPermQuery.apply(this, arguments);
            };
        }
    } catch (e) {}

    // ==================== 10. НЕЙТРАЛИЗАЦИЯ ФУНКЦИЙ БЛОКИРОВКИ ЭКЗАМЕНА ====================
    const blockNames = ['block', 'onBlock', 'stopTest', 'pauseExam', 'lockScreen', 'examViolation', 'reportCheating', 'proctorWarning'];
    blockNames.forEach(name => {
        if (typeof window[name] === 'function') {
            const originalFunc = window[name];
            window[name] = function (...args) {
                if (isEnabled) {
                    console.log(`[Bypass] Функция ${name}() нейтрализована`);
                    return false;
                }
                return originalFunc.apply(this, args);
            };
        }
    });

    // ==================== 11. ПЕРИОДИЧЕСКИЙ КОНТРОЛЬ СВОЙСТВ ====================
    setInterval(() => {
        if (!isEnabled) return;
        try {
            if (document.hidden !== false) {
                Object.defineProperty(document, 'hidden', { value: false, writable: true, configurable: true });
            }
            if (document.visibilityState !== 'visible') {
                Object.defineProperty(document, 'visibilityState', { value: 'visible', writable: true, configurable: true });
            }
            if (!document.fullscreenElement) {
                Object.defineProperty(document, 'fullscreenElement', {
                    value: activeFullscreenElement || document.documentElement,
                    writable: true,
                    configurable: true
                });
            }
        } catch (e) {}
    }, 150);
})();
