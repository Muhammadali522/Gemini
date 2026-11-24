// ==================== CLEAN STEALTH BYPASS (MAIN WORLD) ====================
(function () {
    'use strict';

    let isEnabled = true;
    let activeFullscreenElement = null;

    window.addEventListener('message', (event) => {
        if (event.source === window && event.data && event.data.type === 'GEMINI_BYPASS_UPDATE') {
            isEnabled = event.data.enabled !== false;
        }
    });

    // Аккуратная подмена геттеров в прототипе через Proxy (без патча Function.prototype.toString)
    function patchProtoGetter(proto, prop, customGetter) {
        try {
            const desc = Object.getOwnPropertyDescriptor(proto, prop);
            if (!desc || !desc.get) return;

            const origGet = desc.get;
            const proxyGet = new Proxy(origGet, {
                apply(target, thisArg, args) {
                    if (!isEnabled) return Reflect.apply(target, thisArg, args);
                    return customGetter.call(thisArg, origGet);
                }
            });

            Object.defineProperty(proto, prop, {
                get: proxyGet,
                set: desc.set,
                enumerable: desc.enumerable,
                configurable: desc.configurable
            });
        } catch (e) { }
    }

    function patchMethod(obj, methodName, handler) {
        try {
            const orig = obj && obj[methodName];
            if (typeof orig !== 'function') return;

            obj[methodName] = new Proxy(orig, {
                apply(target, thisArg, args) {
                    if (!isEnabled) return Reflect.apply(target, thisArg, args);
                    return handler(target, thisArg, args);
                }
            });
        } catch (e) { }
    }

    // ==================== 1. FULLSCREEN ЭМУЛЯЦИЯ ====================
    function getEffectiveFullscreenElement(origGet) {
        const real = origGet.call(this);
        if (real) return real;
        return (activeFullscreenElement && activeFullscreenElement.isConnected)
            ? activeFullscreenElement
            : document.documentElement;
    }

    [
        'fullscreenElement',
        'webkitFullscreenElement',
        'mozFullScreenElement',
        'msFullscreenElement',
        'webkitCurrentFullScreenElement'
    ].forEach(prop => patchProtoGetter(Document.prototype, prop, getEffectiveFullscreenElement));

    [
        'fullscreenEnabled',
        'webkitFullscreenEnabled',
        'mozFullScreenEnabled',
        'msFullscreenEnabled'
    ].forEach(prop => patchProtoGetter(Document.prototype, prop, () => true));

    [
        'fullscreen',
        'webkitIsFullScreen',
        'mozFullScreen'
    ].forEach(prop => patchProtoGetter(Document.prototype, prop, () => true));

    function fakeRequestFullscreen(target, thisArg, args) {
        activeFullscreenElement = thisArg;
        return Reflect.apply(target, thisArg, args).catch(() => Promise.resolve());
    }

    patchMethod(Element.prototype, 'requestFullscreen', fakeRequestFullscreen);
    patchMethod(Element.prototype, 'webkitRequestFullscreen', fakeRequestFullscreen);
    patchMethod(Element.prototype, 'webkitRequestFullScreen', fakeRequestFullscreen);
    patchMethod(Element.prototype, 'mozRequestFullScreen', fakeRequestFullscreen);
    patchMethod(Element.prototype, 'msRequestFullscreen', fakeRequestFullscreen);

    patchMethod(Document.prototype, 'exitFullscreen', () => Promise.resolve());
    patchMethod(Document.prototype, 'webkitExitFullscreen', () => Promise.resolve());
    patchMethod(Document.prototype, 'webkitCancelFullScreen', () => Promise.resolve());
    patchMethod(Document.prototype, 'mozCancelFullScreen', () => Promise.resolve());
    patchMethod(Document.prototype, 'msExitFullscreen', () => Promise.resolve());

    const fullscreenEvents = [
        'fullscreenchange', 'webkitfullscreenchange', 'mozfullscreenchange', 'MSFullscreenChange',
        'fullscreenerror', 'webkitfullscreenerror', 'mozfullscreenerror', 'MSFullscreenError'
    ];

    fullscreenEvents.forEach(evName => {
        const blocker = (e) => {
            if (!isEnabled) return;
            if (!activeFullscreenElement) activeFullscreenElement = document.documentElement;
            e.stopImmediatePropagation();
        };
        window.addEventListener(evName, blocker, true);
        document.addEventListener(evName, blocker, true);
    });

    // ==================== 2. ВИДИМОСТЬ И ФОКУС ВКЛАДКИ ====================
    patchProtoGetter(Document.prototype, 'hidden', () => false);
    patchProtoGetter(Document.prototype, 'webkitHidden', () => false);
    patchProtoGetter(Document.prototype, 'visibilityState', () => 'visible');
    patchProtoGetter(Document.prototype, 'webkitVisibilityState', () => 'visible');

    patchMethod(Document.prototype, 'hasFocus', () => true);

    const proctorEvents = [
        'blur', 'focusout', 'focusin', 'focus',
        'visibilitychange', 'webkitvisibilitychange',
        'pagehide', 'pageshow', 'freeze', 'resume',
        'mouseleave', 'mouseout'
    ];

    proctorEvents.forEach(evName => {
        const handler = (e) => {
            if (!isEnabled) return;
            if (evName === 'mouseleave' || evName === 'mouseout') {
                if (e.target === document || e.target === window || !e.relatedTarget) {
                    e.stopImmediatePropagation();
                }
            } else if (evName === 'focus' || evName === 'focusin') {
                if (e.target === window || e.target === document) {
                    e.stopImmediatePropagation();
                }
            } else if (evName === 'blur' || evName === 'focusout') {
                if (e.target === window || e.target === document) {
                    e.stopImmediatePropagation();
                }
            } else if (evName === 'pagehide' || evName === 'freeze') {
                if (!e.persisted) {
                    e.stopImmediatePropagation();
                }
            } else {
                e.stopImmediatePropagation();
            }
        };
        window.addEventListener(evName, handler, true);
        document.addEventListener(evName, handler, true);
    });

    // ==================== 3. ЗАЩИТА ОТ КОНТРОЛЯ КЛАВИШ ====================
    ['keydown', 'keyup', 'keypress'].forEach(evName => {
        const keyGuard = (e) => {
            if (!isEnabled) return;

            const code = e.code || '';
            const key = (e.key || '').toLowerCase();

            const isSystemMod = e.altKey || e.metaKey ||
                key === 'alt' || key === 'tab' || key === 'meta' || key === 'os' || key === 'escape';

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

            const isInspectOrShot = e.key === 'F12' || e.key === 'PrintScreen' ||
                ((e.ctrlKey || e.metaKey) && e.shiftKey && ['KeyI', 'KeyJ', 'KeyC'].includes(code));

            if (isSystemMod || isBrowserNav || isInspectOrShot) {
                e.stopImmediatePropagation();
            }
        };
        window.addEventListener(evName, keyGuard, true);
        document.addEventListener(evName, keyGuard, true);
    });

    // ==================== 4. ЗАЩИТА ОТ CAPTURE, ПЕЧАТИ И ПРОВЕРКИ РАЗРЕШЕНИЙ ====================
    if (navigator.mediaDevices && navigator.mediaDevices.getDisplayMedia) {
        patchMethod(navigator.mediaDevices, 'getDisplayMedia', () => {
            const canvas = document.createElement('canvas');
            canvas.width = screen.width || 1920;
            canvas.height = screen.height || 1080;
            const ctx = canvas.getContext('2d');
            if (ctx) {
                ctx.fillStyle = '#ffffff';
                ctx.fillRect(0, 0, canvas.width, canvas.height);
            }
            return Promise.resolve(canvas.captureStream(5));
        });
    }

    if (window.MediaStreamTrack && MediaStreamTrack.prototype.getSettings) {
        patchMethod(MediaStreamTrack.prototype, 'getSettings', (target, thisArg, args) => {
            const settings = Reflect.apply(target, thisArg, args);
            if (settings && settings.displaySurface) {
                settings.displaySurface = 'monitor';
            }
            return settings;
        });
    }

    ['beforeprint', 'afterprint'].forEach(evName => {
        window.addEventListener(evName, (e) => {
            if (isEnabled) {
                e.stopImmediatePropagation();
            }
        }, true);
    });

    if (window.matchMedia) {
        patchMethod(window, 'matchMedia', (target, thisArg, args) => {
            const mediaQueryString = args[0];
            if (typeof mediaQueryString === 'string' && mediaQueryString.includes('print')) {
                return {
                    matches: false,
                    media: mediaQueryString,
                    onchange: null,
                    addListener: () => { },
                    removeListener: () => { },
                    addEventListener: () => { },
                    removeEventListener: () => { },
                    dispatchEvent: () => false
                };
            }
            return Reflect.apply(target, thisArg, args);
        });
    }

    if (navigator.permissions && navigator.permissions.query) {
        patchMethod(navigator.permissions, 'query', (target, thisArg, args) => {
            const queryObj = args[0];
            if (queryObj && ['camera', 'microphone', 'notifications', 'display-capture'].includes(queryObj.name)) {
                return Promise.resolve({
                    state: 'granted',
                    name: queryObj.name,
                    onchange: null
                });
            }
            return Reflect.apply(target, thisArg, args);
        });
    }

    // ==================== 5. НЕЙТРАЛИЗАЦИЯ ФУНКЦИЙ БЛОКИРОВКИ ЭКЗАМЕНА ====================
    const blockNames = [
        'block', 'onBlock', 'stopTest', 'pauseExam', 'lockScreen',
        'examViolation', 'reportCheating', 'proctorWarning', 'onViolation'
    ];
    blockNames.forEach(name => {
        if (typeof window[name] === 'function') {
            patchMethod(window, name, () => false);
        }
    });
})();