// ==================== HARDENED ANTI-PROCTORING BYPASS (MAIN WORLD) ====================
(function () {
    'use strict';

    let isEnabled = true;
    let activeFullscreenElement = null;

    window.addEventListener('message', (event) => {
        if (event.source === window && event.data && event.data.type === 'GEMINI_BYPASS_UPDATE') {
            isEnabled = event.data.enabled !== false;
        }
    });

    // ==================== 0. МАСКИРОВКА ПОД NATIVE CODE (ЗАЩИТА ПУНКТА 4) ====================
    const nativeStrings = new WeakMap();
    const origFunctionToString = Function.prototype.toString;

    function maskAsNative(fn, nativeName) {
        if (typeof fn === 'function') {
            nativeStrings.set(fn, `function ${nativeName || fn.name || ''}() { [native code] }`);
        }
        return fn;
    }

    const patchedToString = function toString() {
        if (nativeStrings.has(this)) {
            return nativeStrings.get(this);
        }
        return origFunctionToString.call(this);
    };
    nativeStrings.set(patchedToString, 'function toString() { [native code] }');
    Function.prototype.toString = patchedToString;

    function defineNativeGetter(target, prop, getterFn) {
        try {
            maskAsNative(getterFn, `get ${prop}`);
            Object.defineProperty(target, prop, {
                get: getterFn,
                configurable: true
            });
        } catch (e) {}
    }

    // ==================== 1. FULLSCREEN ЭМУЛЯЦИЯ (ПУНКТ 1) ====================
    const origFullscreenElementDesc = Object.getOwnPropertyDescriptor(Document.prototype, 'fullscreenElement');

    function getEffectiveFullscreenElement() {
        if (!isEnabled) {
            return origFullscreenElementDesc && origFullscreenElementDesc.get
                ? origFullscreenElementDesc.get.call(document)
                : null;
        }
        if (activeFullscreenElement && activeFullscreenElement.isConnected) {
            return activeFullscreenElement;
        }
        return document.documentElement;
    }

    [
        'fullscreenElement',
        'webkitFullscreenElement',
        'mozFullScreenElement',
        'msFullscreenElement',
        'webkitCurrentFullScreenElement'
    ].forEach(prop => defineNativeGetter(document, prop, getEffectiveFullscreenElement));

    [
        'fullscreenEnabled',
        'webkitFullscreenEnabled',
        'mozFullScreenEnabled',
        'msFullscreenEnabled'
    ].forEach(prop => defineNativeGetter(document, prop, () => true));

    [
        'fullscreen',
        'webkitIsFullScreen',
        'mozFullScreen'
    ].forEach(prop => defineNativeGetter(document, prop, () => Boolean(isEnabled)));

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

    Element.prototype.requestFullscreen = maskAsNative(function requestFullscreen(...args) {
        return fakeRequestFullscreen(origRequestFullscreen, this, args);
    }, 'requestFullscreen');

    if (Element.prototype.webkitRequestFullscreen) {
        Element.prototype.webkitRequestFullscreen = maskAsNative(function webkitRequestFullscreen(...args) {
            return fakeRequestFullscreen(origWebkitRequestFullscreen, this, args);
        }, 'webkitRequestFullscreen');
    }
    if (Element.prototype.webkitRequestFullScreen) {
        Element.prototype.webkitRequestFullScreen = maskAsNative(function webkitRequestFullScreen(...args) {
            return fakeRequestFullscreen(origWebkitRequestFullscreen, this, args);
        }, 'webkitRequestFullScreen');
    }
    if (Element.prototype.mozRequestFullScreen) {
        Element.prototype.mozRequestFullScreen = maskAsNative(function mozRequestFullScreen(...args) {
            return fakeRequestFullscreen(origMozRequestFullScreen, this, args);
        }, 'mozRequestFullScreen');
    }
    if (Element.prototype.msRequestFullscreen) {
        Element.prototype.msRequestFullscreen = maskAsNative(function msRequestFullscreen(...args) {
            return fakeRequestFullscreen(origMsRequestFullscreen, this, args);
        }, 'msRequestFullscreen');
    }

    const origExitFullscreen = document.exitFullscreen;
    document.exitFullscreen = maskAsNative(function exitFullscreen(...args) {
        if (!isEnabled && origExitFullscreen) {
            return origExitFullscreen.apply(this, args);
        }
        return Promise.resolve();
    }, 'exitFullscreen');

    ['webkitExitFullscreen', 'webkitCancelFullScreen', 'mozCancelFullScreen', 'msExitFullscreen'].forEach(fn => {
        if (document[fn]) {
            document[fn] = maskAsNative(function () { return Promise.resolve(); }, fn);
        }
    });

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

    // ==================== 2. ВИДИМОСТЬ, ФОКУС И РАЗМЕРЫ ОКНА (ПУНКТ 1) ====================
    const origHiddenDesc = Object.getOwnPropertyDescriptor(Document.prototype, 'hidden');
    const origVisibilityDesc = Object.getOwnPropertyDescriptor(Document.prototype, 'visibilityState');
    const origHasFocus = document.hasFocus;

    defineNativeGetter(document, 'hidden', () => {
        if (!isEnabled && origHiddenDesc && origHiddenDesc.get) return origHiddenDesc.get.call(document);
        return false;
    });
    defineNativeGetter(document, 'webkitHidden', () => false);
    defineNativeGetter(document, 'visibilityState', () => {
        if (!isEnabled && origVisibilityDesc && origVisibilityDesc.get) return origVisibilityDesc.get.call(document);
        return 'visible';
    });
    defineNativeGetter(document, 'webkitVisibilityState', () => 'visible');

    if (origHasFocus) {
        document.hasFocus = maskAsNative(function hasFocus() {
            return isEnabled ? true : origHasFocus.call(document);
        }, 'hasFocus');
    }

    const origOuterWidthDesc = Object.getOwnPropertyDescriptor(window, 'outerWidth');
    const origOuterHeightDesc = Object.getOwnPropertyDescriptor(window, 'outerHeight');

    defineNativeGetter(window, 'outerWidth', () => {
        if (!isEnabled && origOuterWidthDesc && origOuterWidthDesc.get) return origOuterWidthDesc.get.call(window);
        return Math.max(window.innerWidth, screen.width);
    });
    defineNativeGetter(window, 'outerHeight', () => {
        if (!isEnabled && origOuterHeightDesc && origOuterHeightDesc.get) return origOuterHeightDesc.get.call(window);
        return Math.max(window.innerHeight, screen.height);
    });

    const proctorEvents = [
        'blur', 'focusout', 'focusin', 'focus',
        'visibilitychange', 'webkitvisibilitychange',
        'pagehide', 'pageshow', 'freeze', 'resume',
        'mouseleave', 'mouseout', 'resize'
    ];

    proctorEvents.forEach(evName => {
        const handler = (e) => {
            if (!isEnabled) return;
            if (evName === 'mouseleave' || evName === 'mouseout') {
                if (e.target === document || e.target === window || !e.relatedTarget) {
                    e.stopImmediatePropagation();
                    e.preventDefault();
                }
            } else if (evName === 'focus' || evName === 'focusin') {
                if (e.target === window || e.target === document) {
                    e.stopImmediatePropagation();
                }
            } else if (evName === 'pagehide' || evName === 'freeze') {
                if (!e.persisted) {
                    e.stopImmediatePropagation();
                }
            } else {
                e.stopImmediatePropagation();
                e.preventDefault();
            }
        };
        window.addEventListener(evName, handler, true);
        document.addEventListener(evName, handler, true);
    });

    ['onblur', 'onfocus', 'onvisibilitychange', 'onfullscreenchange', 'onwebkitfullscreenchange'].forEach(prop => {
        try {
            Object.defineProperty(window, prop, {
                get: () => null,
                set: () => {},
                configurable: true
            });
            Object.defineProperty(document, prop, {
                get: () => null,
                set: () => {},
                configurable: true
            });
        } catch (e) {}
    });

    // ==================== 3. ЗАЩИТА ОТ КОНТРОЛЯ КЛАВИШ И УХОДА НА ДРУГИЕ ВКЛАДКИ/ОКНА (ПУНКТ 3) ====================
    // Не вызываем preventDefault(), чтобы сам браузер и Windows нормально выполняли:
    // Win+D, Alt+Tab, Ctrl+Tab, Ctrl+Shift+Tab, Ctrl+T, Ctrl+Shift+T, Ctrl+N, Ctrl+Shift+N,
    // но останавливаем всплытие (stopImmediatePropagation), чтобы скрипт сайта не узнал о нажатии.
    ['keydown', 'keyup', 'keypress'].forEach(evName => {
        const keyGuard = (e) => {
            if (!isEnabled) return;

            const code = e.code || '';
            const key = (e.key || '').toLowerCase();

            // Системные модификаторы (Win / Meta, Alt, Tab, Escape)
            const isSystemMod = e.altKey || e.metaKey ||
                key === 'alt' || key === 'tab' || key === 'meta' || key === 'os' || key === 'escape';

            // Браузерные сочетания вкладок и окон:
            // Ctrl+Tab, Ctrl+Shift+Tab, Ctrl+T, Ctrl+Shift+T, Ctrl+W, Ctrl+N, Ctrl+Shift+N, Ctrl+1..9
            const isBrowserNav = (e.ctrlKey || e.metaKey) && (
                code === 'Tab' ||
                code === 'KeyT' ||
                code === 'KeyW' ||
                code === 'KeyN' ||
                code === 'PageUp' ||
                code === 'PageDown' ||
                /^Digit[1-9]$/.test(code) ||
                ['t', 'е', 'w', 'ц', 'n', 'т'].includes(key)
            );

            // DevTools и скриншот системы (F12, PrintScreen, Ctrl+Shift+I/J/C)
            const isInspectOrShot = e.key === 'F12' || e.key === 'PrintScreen' ||
                ((e.ctrlKey || e.metaKey) && e.shiftKey && ['KeyI', 'KeyJ', 'KeyC'].includes(code));

            if (isSystemMod || isBrowserNav || isInspectOrShot) {
                e.stopImmediatePropagation();
            }
        };
        window.addEventListener(evName, keyGuard, true);
        document.addEventListener(evName, keyGuard, true);
    });

    // ==================== 4. СКРЫТИЕ UI РАСШИРЕНИЯ ОТ MUTATION OBSERVER И DOM-СКАНЕРОВ (ПУНКТ 5) ====================
    const isExtNode = (node) => {
        return node && node.nodeType === 1 && typeof node.id === 'string' && node.id.startsWith('ui-ext-');
    };

    try {
        const origQuerySelectorAll = Document.prototype.querySelectorAll;
        Document.prototype.querySelectorAll = maskAsNative(function querySelectorAll(selector) {
            const list = origQuerySelectorAll.apply(this, arguments);
            if (!isEnabled) return list;
            return Array.from(list).filter(el => !isExtNode(el));
        }, 'querySelectorAll');

        const origGetElementById = Document.prototype.getElementById;
        Document.prototype.getElementById = maskAsNative(function getElementById(id) {
            if (isEnabled && typeof id === 'string' && id.startsWith('ui-ext-')) {
                return null;
            }
            return origGetElementById.apply(this, arguments);
        }, 'getElementById');

        if (window.MutationObserver) {
            const OrigMutationObserver = window.MutationObserver;
            window.MutationObserver = maskAsNative(function MutationObserver(callback) {
                const wrappedCallback = function (mutations, observer) {
                    if (!isEnabled) return callback(mutations, observer);
                    const filtered = [];
                    for (let i = 0; i < mutations.length; i++) {
                        const m = mutations[i];
                        if (isExtNode(m.target)) continue;
                        const added = Array.from(m.addedNodes || []).filter(n => !isExtNode(n));
                        const removed = Array.from(m.removedNodes || []).filter(n => !isExtNode(n));
                        if (m.type === 'childList' && added.length === 0 && removed.length === 0) {
                            continue;
                        }
                        filtered.push(m);
                    }
                    if (filtered.length > 0) {
                        callback(filtered, observer);
                    }
                };
                return new OrigMutationObserver(wrappedCallback);
            }, 'MutationObserver');
            window.MutationObserver.prototype = OrigMutationObserver.prototype;
        }
    } catch (e) {}

    // ==================== 5. КОМПЕНСАЦИЯ ПАУЗ В АНИМАЦИИ И ФОНОВОГО ТРОТТЛИНГА (ПУНКТ 6) ====================
    try {
        const origRAF = window.requestAnimationFrame.bind(window);
        let virtualTime = performance.now();
        let lastRealTime = virtualTime;

        window.requestAnimationFrame = maskAsNative(function requestAnimationFrame(callback) {
            return origRAF(function (realNow) {
                if (!isEnabled) {
                    lastRealTime = realNow;
                    virtualTime = realNow;
                    return callback(realNow);
                }
                const realDelta = realNow - lastRealTime;
                lastRealTime = realNow;
                const clampedDelta = (realDelta > 50) ? 16.67 : Math.max(0, realDelta);
                virtualTime += clampedDelta;
                return callback(virtualTime);
            });
        }, 'requestAnimationFrame');
    } catch (e) {}

    // ==================== 6. ЗАЩИТА ОТ CAPTURE, ПЕЧАТИ И ПРОВЕРКИ РАЗРЕШЕНИЙ ====================
    try {
        if (navigator.mediaDevices && navigator.mediaDevices.getDisplayMedia) {
            const origGetDisplayMedia = navigator.mediaDevices.getDisplayMedia.bind(navigator.mediaDevices);
            navigator.mediaDevices.getDisplayMedia = maskAsNative(function getDisplayMedia(constraints) {
                if (isEnabled) {
                    const canvas = document.createElement('canvas');
                    canvas.width = screen.width || 1920;
                    canvas.height = screen.height || 1080;
                    const ctx = canvas.getContext('2d');
                    if (ctx) {
                        ctx.fillStyle = '#ffffff';
                        ctx.fillRect(0, 0, canvas.width, canvas.height);
                    }
                    return Promise.resolve(canvas.captureStream(5));
                }
                return origGetDisplayMedia(constraints);
            }, 'getDisplayMedia');
        }

        if (window.MediaStreamTrack && MediaStreamTrack.prototype.getSettings) {
            const origGetSettings = MediaStreamTrack.prototype.getSettings;
            MediaStreamTrack.prototype.getSettings = maskAsNative(function getSettings() {
                const settings = origGetSettings.apply(this, arguments);
                if (isEnabled && settings && settings.displaySurface) {
                    settings.displaySurface = 'monitor';
                }
                return settings;
            }, 'getSettings');
        }
    } catch (e) {}

    ['beforeprint', 'afterprint'].forEach(evName => {
        window.addEventListener(evName, (e) => {
            if (isEnabled) {
                e.stopImmediatePropagation();
                e.preventDefault();
            }
        }, true);
    });

    try {
        const origMatchMedia = window.matchMedia;
        if (origMatchMedia) {
            window.matchMedia = maskAsNative(function matchMedia(mediaQueryString) {
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
            }, 'matchMedia');
        }
    } catch (e) {}

    try {
        if (navigator.permissions && navigator.permissions.query) {
            const origPermQuery = navigator.permissions.query;
            navigator.permissions.query = maskAsNative(function query(queryObj) {
                if (isEnabled && queryObj && ['camera', 'microphone', 'notifications', 'display-capture'].includes(queryObj.name)) {
                    return Promise.resolve({
                        state: 'granted',
                        name: queryObj.name,
                        onchange: null
                    });
                }
                return origPermQuery.apply(this, arguments);
            }, 'query');
        }
    } catch (e) {}

    // ==================== 7. НЕЙТРАЛИЗАЦИЯ ФУНКЦИЙ БЛОКИРОВКИ ЭКЗАМЕНА ====================
    const blockNames = [
        'block', 'onBlock', 'stopTest', 'pauseExam', 'lockScreen',
        'examViolation', 'reportCheating', 'proctorWarning', 'onViolation'
    ];
    blockNames.forEach(name => {
        if (typeof window[name] === 'function') {
            const originalFunc = window[name];
            window[name] = maskAsNative(function (...args) {
                if (isEnabled) return false;
                return originalFunc.apply(this, args);
            }, name);
        }
    });

    // ==================== 8. КОНТРОЛЬ СВОЙСТВ ====================
    setInterval(() => {
        if (!isEnabled) return;
        try {
            if (document.hidden !== false) {
                defineNativeGetter(document, 'hidden', () => false);
            }
            if (document.visibilityState !== 'visible') {
                defineNativeGetter(document, 'visibilityState', () => 'visible');
            }
            if (!document.fullscreenElement) {
                defineNativeGetter(document, 'fullscreenElement', getEffectiveFullscreenElement);
            }
        } catch (e) {}
    }, 150);
})();