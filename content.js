let timeoutId = null;
let currentButton = null;
let currentPopup = null;
let shadowHost = null;
let buttonHideTimeout = null;
let currentRequestId = 0;
let currentAnchorRect = null;
let currentOriginalContext = '';
let currentLastAnswer = '';

// ==================== БЕЗОПАСНАЯ РАБОТА С CHROME STORAGE & RUNTIME ====================
function isExtensionValid() {
    try {
        return typeof chrome !== 'undefined' && Boolean(chrome?.runtime?.id);
    } catch (err) {
        return false;
    }
}

function isStorageSyncAvailable() {
    try {
        return isExtensionValid() && Boolean(chrome?.storage?.sync && typeof chrome.storage.sync.get === 'function');
    } catch (err) {
        return false;
    }
}

function safeGetStorageSync(keys, callback) {
    const fallback = {};
    return new Promise((resolve) => {
        const finish = (result) => {
            const data = (result && typeof result === 'object') ? result : fallback;
            if (typeof callback === 'function') {
                try {
                    callback(data);
                } catch (cbErr) {
                    console.error('[Gemini Assistant] Ошибка в callback storage.sync:', cbErr);
                }
            }
            resolve(data);
        };

        if (!isStorageSyncAvailable()) {
            finish(fallback);
            return;
        }

        try {
            chrome.storage.sync.get(keys, (items) => {
                const lastErr = chrome.runtime?.lastError;
                if (lastErr) {
                    if (!lastErr.message?.includes('context invalidated')) {
                        console.warn('[Gemini Assistant] Ошибка чтения chrome.storage.sync:', lastErr);
                    }
                    finish(fallback);
                    return;
                }
                finish(items || fallback);
            });
        } catch (err) {
            if (!err?.message?.includes('context invalidated')) {
                console.error('[Gemini Assistant] Ошибка вызова chrome.storage.sync.get:', err);
            }
            finish(fallback);
        }
    });
}

const safeStorageGet = safeGetStorageSync;

// ==================== ОЧИСТКА И ФОРМАТИРОВАНИЕ MATH / LATEX ====================
function formatMath(str) {
    if (!str) return "";
    return str
        // Убираем блочные $$ и строчные $ формулы
        .replace(/\$\$([\s\S]*?)\$\$/g, ' $1 ')
        .replace(/\$([^\$\n]+)\$/g, ' $1 ')
        // Заменяем популярные команды LaTeX на понятные символы
        .replace(/\\times\b/g, '×')
        .replace(/\\cdot\b/g, '·')
        .replace(/\\div\b/g, ':')
        .replace(/\\pm\b/g, '±')
        .replace(/\\approx\b/g, '≈')
        .replace(/\\neq\b/g, '≠')
        .replace(/\\leq?\b/g, '≤')
        .replace(/\\geq?\b/g, '≥')
        .replace(/\\degree\b/g, '°')
        .replace(/\\circ\b/g, '°')
        .replace(/\\infty\b/g, '∞')
        // Греческие символы
        .replace(/\\alpha\b/g, 'α')
        .replace(/\\beta\b/g, 'β')
        .replace(/\\gamma\b/g, 'γ')
        .replace(/\\pi\b/g, 'π')
        // Дроби и корни
        .replace(/\\sqrt\{([^}]+)\}/g, '√($1)')
        .replace(/\\frac\{([^}]+)\}\{([^}]+)\}/g, '($1/$2)')
        // Степени и индексы
        .replace(/\^2\b/g, '²')
        .replace(/\^3\b/g, '³')
        .replace(/_0\b/g, '₀')
        .replace(/_1\b/g, '₁')
        .replace(/_2\b/g, '₂')
        // Удаление лишних обратных слэшей
        .replace(/\\([a-zA-Z]+)/g, '$1')
        .replace(/ {2,}/g, ' ');
}

// ==================== БЕЗОПАСНЫЙ MARKDOWN RENDERER ====================
function escapeHtml(str) {
    if (!str) return "";
    return str
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

function stripEmojis(str) {
    if (!str) return "";
    return str.replace(/[\u{1F300}-\u{1F9FF}\u{2600}-\u{27BF}\u{1F1E0}-\u{1F1FF}\u{1F600}-\u{1F64F}\u{1F680}-\u{1F6FF}\u{2B50}\u{2705}\u{274C}\u{2714}\u{2716}]/gu, '').trim();
}

function formatInlines(str) {
    if (!str) return "";
    return str
        .replace(/`([^`]+)`/g, '<code class="gemini-inline-code">$1</code>')
        .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
        .replace(/__([^_]+)__/g, '<strong>$1</strong>')
        .replace(/(?<!\*)\*([^*]+)\*(?!\*)/g, '<em>$1</em>')
        .replace(/(?<!_)_([^_]+)_(?!_)/g, '<em>$1</em>');
}

function renderMarkdown(md) {
    if (!md) return "";

    let text = stripEmojis(md).replace(/\r\n/g, "\n");

    // 1. Извлекаем блоки кода с синтаксисом ```lang ... ```
    const codeBlocks = [];
    text = text.replace(/```([a-zA-Z0-9_-]*)\n([\s\S]*?)```/g, (match, lang, code) => {
        const id = `__GEMINI_CODE_${codeBlocks.length}__`;
        const escapedCode = escapeHtml(code.trim());
        const langAttr = lang ? ` data-lang="${escapeHtml(lang)}"` : "";
        codeBlocks.push(`<pre class="gemini-code-block"${langAttr}><code>${escapedCode}</code></pre>`);
        return `\n\n${id}\n\n`;
    });

    // 2. Обрабатываем математические выражения ($...$, \times и т.д.)
    text = formatMath(text);

    // 3. Безопасное экранирование всех HTML тегов для защиты от XSS
    text = escapeHtml(text);

    // 4. Таблицы Markdown
    text = text.replace(/(?:^|\n)((?:\|[^\n]+\|\r?\n?)+)/g, (match, tableBlock) => {
        const lines = tableBlock.trim().split("\n").map(l => l.trim()).filter(Boolean);
        if (lines.length < 2) return match;

        const isSep = /^\|(?:\s*:?-+:?\s*\|)+$/.test(lines[1]);
        if (!isSep) return match;

        const headers = lines[0].split("|").slice(1, -1).map(h => h.trim());
        const rows = lines.slice(2).map(r => r.split("|").slice(1, -1).map(c => c.trim()));

        let html = '<div class="gemini-table-wrap"><table class="gemini-table"><thead><tr>';
        headers.forEach(h => {
            html += `<th>${formatInlines(h)}</th>`;
        });
        html += '</tr></thead><tbody>';
        rows.forEach(row => {
            html += '<tr>';
            row.forEach(c => {
                html += `<td>${formatInlines(c)}</td>`;
            });
            html += '</tr>';
        });
        html += '</tbody></table></div>';
        return `\n\n${html}\n\n`;
    });

    // 5. Цитаты (> ...)
    text = text.replace(/(?:^|\n)((?:&gt;[^\n]+\r?\n?)+)/g, (match, quoteBlock) => {
        const lines = quoteBlock.trim().split("\n").map(l => l.replace(/^&gt;\s?/, ""));
        const content = lines.map(l => formatInlines(l)).join("<br>");
        return `\n\n<blockquote class="gemini-quote">${content}</blockquote>\n\n`;
    });

    // 6. Заголовки
    text = text.replace(/^######\s+(.+)$/gm, '<h6 class="gemini-h6">$1</h6>');
    text = text.replace(/^#####\s+(.+)$/gm, '<h5 class="gemini-h5">$1</h5>');
    text = text.replace(/^####\s+(.+)$/gm, '<h4 class="gemini-h4">$1</h4>');
    text = text.replace(/^###\s+(.+)$/gm, '<h3 class="gemini-h3">$1</h3>');
    text = text.replace(/^##\s+(.+)$/gm, '<h3 class="gemini-h3">$1</h3>');
    text = text.replace(/^#\s+(.+)$/gm, '<h2 class="gemini-h2">$1</h2>');

    // 7. Списки
    text = text.replace(/(?:^|\n)((?:[ \t]*[-*]\s+[^\n]+\r?\n?)+)/g, (match, listBlock) => {
        const items = listBlock.trim().split("\n").map(l => l.replace(/^[ \t]*[-*]\s+/, ""));
        return '\n\n<ul class="gemini-ul">' + items.map(i => `<li>${formatInlines(i)}</li>`).join("") + '</ul>\n\n';
    });

    text = text.replace(/(?:^|\n)((?:[ \t]*\d+\.\s+[^\n]+\r?\n?)+)/g, (match, listBlock) => {
        const items = listBlock.trim().split("\n").map(l => l.replace(/^[ \t]*\d+\.\s+/, ""));
        return '\n\n<ol class="gemini-ol">' + items.map(i => `<li>${formatInlines(i)}</li>`).join("") + '</ol>\n\n';
    });

    // 8. Параграфы и переносы
    const rawBlocks = text.split(/\n{2,}/);
    const processed = rawBlocks.map(block => {
        const trimmed = block.trim();
        if (!trimmed) return "";
        if (/^<(?:div|table|blockquote|h[1-6]|ul|ol|pre)/.test(trimmed) || trimmed.startsWith("__GEMINI_CODE_")) {
            return trimmed;
        }
        return `<p class="gemini-p">${formatInlines(trimmed).replace(/\n/g, "<br>")}</p>`;
    });

    let result = processed.filter(Boolean).join("\n");

    // 9. Возвращаем блоки кода
    codeBlocks.forEach((cb, idx) => {
        result = result.replace(`__GEMINI_CODE_${idx}__`, cb);
    });

    return result;
}

// ==================== SHADOW DOM И ИНИЦИАЛИЗАЦИЯ ====================
function getShadowContainer() {
    if (!shadowHost || !shadowHost.parentNode) {
        shadowHost = document.createElement('div');
        shadowHost.id = 'ui-ext-' + Math.random().toString(36).substring(2, 9);
        document.body.appendChild(shadowHost);
    }
    return shadowHost.shadowRoot || shadowHost.attachShadow({ mode: 'open' });
}

window.addEventListener("beforeunload", () => {
    if (shadowHost) {
        shadowHost.remove();
        shadowHost = null;
    }
});

function removeCurrentButton() {
    if (currentButton) {
        currentButton.remove();
        currentButton = null;
    }
    if (buttonHideTimeout) {
        clearTimeout(buttonHideTimeout);
        buttonHideTimeout = null;
    }
}

function closeCurrentPopup() {
    if (currentPopup) {
        currentPopup.remove();
        currentPopup = null;
    }
    window.__geminiPopupOpen = false;
    currentRequestId++; // Отменяем ожидающие ответы
    currentAnchorRect = null;
    currentOriginalContext = '';
    currentLastAnswer = '';
}

// ==================== АДАПТИВНАЯ МАСКИРОВКА И ПРОЗРАЧНОСТЬ ====================
function isPageBackgroundLight() {
    try {
        const bodyBg = window.getComputedStyle(document.body).backgroundColor;
        const htmlBg = window.getComputedStyle(document.documentElement).backgroundColor;
        const color = (bodyBg && bodyBg !== 'transparent' && bodyBg !== 'rgba(0, 0, 0, 0)') ? bodyBg : htmlBg;
        const rgb = color && color.match(/\d+/g);
        if (rgb && rgb.length >= 3) {
            const r = parseInt(rgb[0], 10);
            const g = parseInt(rgb[1], 10);
            const b = parseInt(rgb[2], 10);
            return (r * 299 + g * 587 + b * 114) / 1000 > 128;
        }
    } catch (e) {
        console.debug('[Gemini Assistant] Не удалось определить цвет фона страницы:', e);
    }
    return true; // Большинство экзаменационных платформ имеют светлый фон
}

let activeBaseOpacity = 0.35;

function applyPopupStealthStyle(popup, savedOpacity, themeSetting) {
    if (!popup) return;

    let isLight = themeSetting === 'light';
    if (!themeSetting || themeSetting === 'auto') {
        isLight = isPageBackgroundLight();
    }

    const num = typeof savedOpacity === 'number' ? savedOpacity : 35;
    const clamped = Math.max(10, Math.min(95, num));
    activeBaseOpacity = (clamped / 100);

    // Управляем реальной прозрачностью контейнера
    popup.style.opacity = activeBaseOpacity;

    if (isLight) {
        popup.style.background = 'rgba(255, 255, 255, 0.48)';
        popup.style.color = '#1e293b';
        popup.style.border = '1px solid rgba(0, 0, 0, 0.08)';
        popup.style.boxShadow = '0 4px 16px rgba(0, 0, 0, 0.04)';
    } else {
        popup.style.background = 'rgba(16, 20, 26, 0.58)';
        popup.style.color = '#e2e8f0';
        popup.style.border = '1px solid rgba(255, 255, 255, 0.10)';
        popup.style.boxShadow = '0 4px 16px rgba(0, 0, 0, 0.18)';
    }

    // При наведении курсора — плавное проявление для чтения; при отводе — возврат в маскировку
    popup.onmouseenter = () => {
        popup.style.opacity = Math.max(0.92, activeBaseOpacity);
    };
    popup.onmouseleave = () => {
        popup.style.opacity = activeBaseOpacity;
    };
}

// ==================== МАЛЕНЬКАЯ НЕЗАМЕТНАЯ КНОПКА ====================
function createGeminiButton() {
    const btn = document.createElement('div');
    btn.style.cssText = `
        position: fixed; 
        z-index: 2147483646; 
        background: rgba(120, 130, 145, 0.22);
        color: rgba(230, 235, 245, 0.85); 
        width: 22px; 
        height: 22px; 
        border-radius: 7px; 
        display: flex;
        align-items: center; 
        justify-content: center; 
        cursor: pointer; 
        box-shadow: 0 2px 10px rgba(0, 0, 0, 0.08);
        backdrop-filter: blur(12px) saturate(130%);
        -webkit-backdrop-filter: blur(12px) saturate(130%);
        font-size: 11px; 
        user-select: none; 
        opacity: 0.38;
        border: 1px solid rgba(255, 255, 255, 0.16);
        transition: opacity 0.22s ease, transform 0.2s ease, background 0.2s ease;
    `;
    btn.innerText = '✦';
    btn.title = 'Помощник';
    btn.onmouseenter = () => { 
        btn.style.opacity = '0.95'; 
        btn.style.transform = 'scale(1.08)'; 
        btn.style.background = 'rgba(120, 130, 145, 0.4)';
    };
    btn.onmouseleave = () => { 
        btn.style.opacity = '0.38'; 
        btn.style.transform = 'scale(1.0)'; 
        btn.style.background = 'rgba(120, 130, 145, 0.22)';
    };
    return btn;
}

// ==================== РАСЧЕТ И КОРРЕКЦИЯ ПОЗИЦИИ POPUP ====================
function adjustPopupPosition(popup, anchorRect) {
    if (!popup) return;

    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const margin = 8;

    // Маленькое компактное поле (ширина ~285px, чтобы не привлекать внимание)
    const popupWidth = Math.min(285, vw - margin * 2);
    popup.style.width = `${popupWidth}px`;
    popup.style.maxWidth = `${vw - margin * 2}px`;
    popup.style.maxHeight = `${Math.min(240, vh - margin * 2)}px`;

    const rect = popup.getBoundingClientRect();
    const width = rect.width || popupWidth;
    const height = rect.height || 180;

    // Горизонтальное выравнивание
    let left = anchorRect ? anchorRect.left : (vw - width) / 2;
    if (left + width > vw - margin) {
        left = vw - width - margin;
    }
    if (left < margin) {
        left = margin;
    }

    // Вертикальное выравнивание с приоритетом снизу/сверху
    let top;
    if (anchorRect) {
        const spaceBelow = vh - anchorRect.bottom - margin;
        const spaceAbove = anchorRect.top - margin;

        if (spaceBelow >= height + 6 || spaceBelow >= spaceAbove) {
            top = anchorRect.bottom + 6;
            if (top + height > vh - margin) {
                top = vh - height - margin;
            }
        } else {
            top = anchorRect.top - height - 6;
            if (top < margin) {
                top = margin;
            }
        }
    } else {
        top = (vh - height) / 2;
    }

    // Жесткое ограничение в границах viewport
    top = Math.max(margin, Math.min(top, vh - height - margin));

    popup.style.left = `${Math.round(left)}px`;
    popup.style.top = `${Math.round(top)}px`;
}

// ==================== СОЗДАНИЕ POPUP ====================
function createResponsePopup(selectedText, rect, surroundingContext = '') {
    closeCurrentPopup();
    removeCurrentButton();

    currentAnchorRect = rect;
    currentOriginalContext = (surroundingContext && surroundingContext.length > selectedText.length) 
        ? surroundingContext 
        : (selectedText || '');
    const thisRequestId = ++currentRequestId;

    const shadow = getShadowContainer();

    // Стили компонента внутри Shadow DOM (компактное, неброское окно со скроллом)
    const styleEl = document.createElement('style');
    styleEl.textContent = `
        @keyframes geminiStealthEntrance {
            0% {
                transform: translateY(5px) scale(0.98);
            }
            100% {
                transform: translateY(0) scale(1);
            }
        }

        .gemini-popup-root {
            position: fixed;
            z-index: 2147483647;
            display: flex;
            flex-direction: column;
            box-sizing: border-box;
            border-radius: 9px;
            backdrop-filter: blur(16px) saturate(115%);
            -webkit-backdrop-filter: blur(16px) saturate(115%);
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
            font-size: 11px;
            line-height: 1.38;
            overflow: hidden;
            user-select: text;
            animation: geminiStealthEntrance 0.18s cubic-bezier(0.16, 1, 0.3, 1) ease-out;
            transition: opacity 0.22s ease, transform 0.18s ease, background 0.22s ease;
        }

        .gemini-popup-header {
            flex: 0 0 auto;
            display: flex;
            align-items: center;
            padding: 4px 8px;
            border-bottom: 1px solid rgba(128, 128, 140, 0.08);
            user-select: none;
            position: relative;
        }

        .gemini-title {
            font-weight: 500;
            font-size: 10.5px;
            opacity: 0.65;
            display: flex;
            align-items: center;
            letter-spacing: 0.2px;
        }

        .gemini-model-badge {
            font-size: 8.5px;
            font-weight: 500;
            padding: 1px 6px;
            border-radius: 6px;
            margin-left: auto;
            margin-right: 20px;
            background: rgba(128, 128, 140, 0.08);
            color: inherit;
            opacity: 0.65;
            border: 1px solid rgba(128, 128, 140, 0.12);
            white-space: nowrap;
        }

        .gemini-close-btn {
            position: absolute;
            right: 5px;
            top: 4px;
            background: none;
            border: none;
            color: rgba(140, 145, 155, 0.45);
            font-size: 11px;
            cursor: pointer;
            width: 16px;
            height: 16px;
            display: flex;
            align-items: center;
            justify-content: center;
            border-radius: 4px;
            transition: color 0.15s, background 0.15s;
        }

        .gemini-close-btn:hover {
            color: #ef4444;
            background: rgba(239, 68, 68, 0.08);
        }

        .gemini-popup-body {
            flex: 1 1 auto;
            min-height: 38px;
            max-height: 140px;
            overflow-y: auto;
            overflow-x: hidden;
            padding: 6px 9px;
            box-sizing: border-box;
            overscroll-behavior: contain;
            opacity: 0.92;
        }

        .gemini-popup-body::-webkit-scrollbar {
            width: 2.5px;
        }
        .gemini-popup-body::-webkit-scrollbar-thumb {
            background: rgba(128, 128, 140, 0.18);
            border-radius: 3px;
        }
        .gemini-popup-body::-webkit-scrollbar-thumb:hover {
            background: rgba(128, 128, 140, 0.35);
        }

        .gemini-popup-footer {
            flex: 0 0 auto;
            padding: 4px 7px;
            border-top: 1px solid rgba(128, 128, 140, 0.08);
            display: flex;
            flex-direction: column;
            gap: 4px;
            background: rgba(128, 128, 140, 0.02);
        }

        .gemini-input-row {
            display: flex;
            align-items: center;
            gap: 4px;
        }

        .gemini-query-input {
            flex: 1 1 auto;
            height: 22px;
            padding: 1px 6px;
            border-radius: 5px;
            border: 1px solid rgba(128, 128, 140, 0.14);
            background: rgba(128, 128, 140, 0.05);
            color: inherit;
            font-size: 10.5px;
            outline: none;
            box-sizing: border-box;
            transition: border-color 0.15s, background 0.15s;
        }

        .gemini-query-input:focus {
            border-color: rgba(128, 128, 140, 0.35);
            background: rgba(128, 128, 140, 0.08);
        }

        .gemini-send-btn {
            flex: 0 0 auto;
            height: 22px;
            padding: 0 7px;
            background: rgba(128, 128, 140, 0.14);
            border: 1px solid rgba(128, 128, 140, 0.18);
            color: inherit;
            border-radius: 5px;
            cursor: pointer;
            font-size: 11px;
            display: flex;
            align-items: center;
            justify-content: center;
            transition: background 0.15s, border-color 0.15s;
        }

        .gemini-send-btn:hover {
            background: rgba(128, 128, 140, 0.24);
            border-color: rgba(128, 128, 140, 0.3);
        }

        .gemini-actions-row {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 5px;
        }

        .gemini-action-btn {
            height: 20px;
            padding: 0 6px;
            border-radius: 5px;
            border: 1px solid rgba(128, 128, 140, 0.12);
            background: rgba(128, 128, 140, 0.06);
            color: inherit;
            font-size: 10px;
            font-weight: 500;
            cursor: pointer;
            display: inline-flex;
            align-items: center;
            gap: 3px;
            user-select: none;
            transition: all 0.15s;
        }

        .gemini-action-btn:hover {
            background: rgba(128, 128, 140, 0.14);
            border-color: rgba(128, 128, 140, 0.22);
        }

        /* Компактный итоговый вердикт проверки (без эмодзи и ярких пятен) */
        .gemini-check-compact {
            margin-top: 4px;
            padding: 4px 7px;
            border-radius: 5px;
            border: 1px solid rgba(128, 128, 140, 0.14);
            background: rgba(128, 128, 140, 0.04);
            font-size: 10.5px;
            font-weight: 500;
        }

        .gemini-check-compact.error {
            border-color: rgba(128, 128, 140, 0.20);
            background: rgba(128, 128, 140, 0.06);
        }

        .gemini-check-sub {
            font-size: 8.5px;
            font-weight: normal;
            opacity: 0.45;
            margin-top: 2px;
        }

        /* Таблицы Markdown */
        .gemini-table-wrap {
            width: 100%;
            overflow-x: auto;
            margin: 6px 0;
            border-radius: 5px;
            border: 1px solid rgba(128, 128, 140, 0.18);
        }
        .gemini-table {
            width: 100%;
            border-collapse: collapse;
            font-size: 11px;
            text-align: left;
        }
        .gemini-table th, .gemini-table td {
            padding: 4px 6px;
            border: 1px solid rgba(128, 128, 140, 0.15);
        }
        .gemini-table th {
            background: rgba(128, 128, 140, 0.08);
            font-weight: 600;
        }

        /* Блоки кода */
        .gemini-code-block {
            background: rgba(0, 0, 0, 0.2);
            padding: 6px 8px;
            border-radius: 6px;
            overflow-x: auto;
            font-family: ui-monospace, monospace;
            font-size: 11px;
            line-height: 1.35;
            margin: 5px 0;
            border: 1px solid rgba(128, 128, 140, 0.16);
        }
        .gemini-inline-code {
            background: rgba(128, 128, 140, 0.14);
            padding: 1px 4px;
            border-radius: 3px;
            font-family: ui-monospace, monospace;
            font-size: 11px;
        }

        .gemini-quote {
            margin: 5px 0;
            padding: 4px 8px;
            border-left: 2px solid rgba(96, 165, 250, 0.5);
            background: rgba(96, 165, 250, 0.06);
            border-radius: 0 4px 4px 0;
        }

        .gemini-ul, .gemini-ol {
            margin: 4px 0;
            padding-left: 16px;
        }
        .gemini-ul li, .gemini-ol li {
            margin-bottom: 2px;
        }
        .gemini-p {
            margin: 3px 0;
        }
        .gemini-h2, .gemini-h3, .gemini-h4, .gemini-h5, .gemini-h6 {
            margin: 6px 0 3px 0;
            font-weight: 600;
            font-size: 12px;
        }
    `;

    const popup = document.createElement('div');
    popup.className = 'gemini-popup-root';
    currentPopup = popup;

    window.__geminiPopupOpen = true;

    // Header
    const header = document.createElement('div');
    header.className = 'gemini-popup-header';

    const titleSpan = document.createElement('span');
    titleSpan.className = 'gemini-title';
    titleSpan.innerText = 'Помощник';

    const modelBadge = document.createElement('span');
    modelBadge.className = 'gemini-model-badge';
    modelBadge.innerText = '...';

    const closeBtn = document.createElement('button');
    closeBtn.className = 'gemini-close-btn';
    closeBtn.innerText = '×';
    closeBtn.title = 'Закрыть';
    closeBtn.onclick = (e) => {
        e.stopPropagation();
        closeCurrentPopup();
    };

    header.appendChild(titleSpan);
    header.appendChild(modelBadge);
    header.appendChild(closeBtn);
    popup.appendChild(header);

    // Body
    const body = document.createElement('div');
    body.className = 'gemini-popup-body';

    const responseContent = document.createElement('div');
    responseContent.className = 'gemini-response-content';
    responseContent.innerHTML = `<span style="opacity: 0.65;">Поиск решения...</span>`;
    body.appendChild(responseContent);

    const verificationArea = document.createElement('div');
    verificationArea.className = 'gemini-verification-area';
    verificationArea.style.display = 'none';
    body.appendChild(verificationArea);

    popup.appendChild(body);

    // Footer
    const footer = document.createElement('div');
    footer.className = 'gemini-popup-footer';

    const inputRow = document.createElement('div');
    inputRow.className = 'gemini-input-row';

    const queryInput = document.createElement('input');
    queryInput.type = 'text';
    queryInput.className = 'gemini-query-input';
    queryInput.placeholder = 'Вопрос...';

    const sendBtn = document.createElement('button');
    sendBtn.className = 'gemini-send-btn';
    sendBtn.innerText = '→';

    inputRow.appendChild(queryInput);
    inputRow.appendChild(sendBtn);
    footer.appendChild(inputRow);

    const actionsRow = document.createElement('div');
    actionsRow.className = 'gemini-actions-row';

    const screenshotBtn = document.createElement('button');
    screenshotBtn.className = 'gemini-action-btn';
    screenshotBtn.innerText = 'Снимок';
    screenshotBtn.title = 'Решить со скриншота';

    const checkBtn = document.createElement('button');
    checkBtn.className = 'gemini-action-btn';
    checkBtn.innerText = 'Проверить';
    checkBtn.title = 'Проверить правильность ответа';
    checkBtn.style.display = 'none';

    actionsRow.appendChild(screenshotBtn);
    actionsRow.appendChild(checkBtn);
    footer.appendChild(actionsRow);

    popup.appendChild(footer);

    shadow.appendChild(styleEl);
    shadow.appendChild(popup);

    // Первичное позиционирование
    adjustPopupPosition(popup, currentAnchorRect);

    // ==================== ВЫПОЛНЕНИЕ ЗАПРОСОВ ====================
    safeGetStorageSync(['geminiApiKey', 'theme', 'modelMode', 'windowOpacity'], (data) => {
        const apiKey = data.geminiApiKey;
        let modelMode = data.modelMode || 'auto-flash';
        if (modelMode === 'auto') modelMode = 'auto-flash';

        // Применяем маскировку и прозрачность
        applyPopupStealthStyle(popup, data.windowOpacity, data.theme);

        if (!apiKey) {
            modelBadge.innerText = 'Ключ';
            responseContent.innerHTML = `<span style="opacity:0.8;">Укажите API-ключ в настройках.</span>`;
            return;
        }

        function executeAiRequest(promptText, imageBase64, reqId, isScreenshot = false) {
            if (reqId !== currentRequestId) return;

            responseContent.innerHTML = `<span style="opacity: 0.65;">${isScreenshot ? 'Анализ снимка...' : 'Поиск решения...'}</span>`;
            verificationArea.style.display = 'none';
            checkBtn.style.display = 'none';
            modelBadge.innerText = '...';
            adjustPopupPosition(popup, currentAnchorRect);

            try {
                chrome.runtime.sendMessage(
                    {
                        action: "askGemini",
                        apiKey: apiKey,
                        prompt: promptText,
                        image: imageBase64,
                        modelMode: modelMode
                    },
                    (response) => {
                        if (chrome.runtime?.lastError) {
                            const lastErr = chrome.runtime.lastError;
                            if (!lastErr.message?.includes('context invalidated')) {
                                console.warn('[Gemini Assistant] Ошибка sendMessage (askGemini):', lastErr);
                            }
                            return;
                        }

                        // Защита от устаревших ответов
                        if (reqId !== currentRequestId) {
                            return;
                        }

                        if (response?.error) {
                            modelBadge.innerText = 'Ошибка';
                            responseContent.innerHTML = `<span style="opacity:0.75; font-size:10.5px;">${escapeHtml(response.message || 'Ошибка запроса')}</span>`;
                            adjustPopupPosition(popup, currentAnchorRect);
                        } else if (response?.answer) {
                            currentLastAnswer = response.answer;
                            if (response.modelDisplayName) {
                                modelBadge.innerText = response.modelDisplayName.replace("Gemini ", "");
                            } else if (response.model) {
                                modelBadge.innerText = response.model.replace("gemini-", "");
                            } else {
                                modelBadge.innerText = "Flash";
                            }

                            responseContent.innerHTML = renderMarkdown(response.answer);
                            checkBtn.style.display = 'inline-flex';
                            checkBtn.disabled = false;
                            checkBtn.innerText = 'Проверить';

                            adjustPopupPosition(popup, currentAnchorRect);
                        }
                    }
                );
            } catch (err) {
                if (!err?.message?.includes('context invalidated')) {
                    console.error('[Gemini Assistant] Исключение при отправке askGemini:', err);
                }
            }
        }

        // Инструкция для решения задания ученику 8 класса
        let taskContext = selectedText;
        if (currentOriginalContext && currentOriginalContext !== selectedText) {
            taskContext = `${selectedText}\nКонтекст со страницы: "${currentOriginalContext}"`;
        }

        const studentInstruction = `Задание для ученика 8 класса:
"${taskContext}"

ОБЯЗАТЕЛЬНЫЕ ТРЕБОВАНИЯ:
1. Ты обязан САМ РЕШИТЬ задачу и дать готовый результат.
2. КАТЕГОРИЧЕСКИ ЗАПРЕЩЕНО писать шаблоны в скобках [ ], плейсхолдеры вроде "[Укажи ответ]" или давать общие советы вроде "внимательно прочитай условие задачи".
3. СРАЗУ на первой строке напиши готовый найденный ответ: **Ответ: [конкретный ответ или выбранный вариант]** (вместо слов в скобках пиши сам найденный ответ).
4. Ниже напиши 1-2 строки понятного решения.
5. Строго БЕЗ эмодзи. Без $ и LaTeX, используй символы: ×, :, √, ², ³, °, ->.`;
        executeAiRequest(studentInstruction, null, thisRequestId);

        // Обработка отправки уточняющего вопроса
        function handleUserSubmit() {
            const userQ = queryInput.value.trim();
            if (!userQ) return;

            const nextReqId = ++currentRequestId;
            sendBtn.disabled = true;
            sendBtn.innerText = '...';

            let fullPrompt = `Ученик 8 класса задает вопрос.\n`;
            if (currentOriginalContext) {
                fullPrompt += `Предыдущий контекст задания: "${currentOriginalContext}"\n`;
            }
            if (currentLastAnswer) {
                fullPrompt += `Предыдущий ответ помощника: "${currentLastAnswer}"\n`;
            }
            fullPrompt += `Последний вопрос ученика: "${userQ}"\n`;
            fullPrompt += `Дай спокойный, понятный и краткий ответ для ученика 8 класса без лишней воды и без LaTeX/$.`;

            executeAiRequest(fullPrompt, null, nextReqId);

            queryInput.value = '';
            sendBtn.disabled = false;
            sendBtn.innerText = '→';
        }

        sendBtn.onclick = (e) => {
            e.stopPropagation();
            handleUserSubmit();
        };

        queryInput.onkeydown = (e) => {
            if (e.key === 'Enter') {
                e.stopPropagation();
                handleUserSubmit();
            }
        };

        // Обработка скриншота (Flow: кнопка Снимок -> скрыть popup -> captureVisibleTab -> вернуть popup -> отправить изображение Gemini -> получить ответ)
        screenshotBtn.onclick = (e) => {
            e.stopPropagation();
            if (!currentPopup) return;

            const nextReqId = ++currentRequestId;
            const typedText = queryInput.value.trim();

            // 1. Скрыть popup
            currentPopup.style.display = 'none';

            // 2. Подождать перерисовки экрана и захватить вкладку
            requestAnimationFrame(() => {
                setTimeout(() => {
                    try {
                        chrome.runtime.sendMessage({ action: "captureTab" }, (res) => {
                            if (chrome.runtime?.lastError) {
                                const lastErr = chrome.runtime.lastError;
                                if (!lastErr.message?.includes('context invalidated')) {
                                    console.warn('[Gemini Assistant] Ошибка captureTab:', lastErr);
                                }
                                return;
                            }

                            // 3. Вернуть popup
                            if (!currentPopup) return;
                            currentPopup.style.display = 'flex';
                            adjustPopupPosition(currentPopup, currentAnchorRect);

                            if (nextReqId !== currentRequestId) return;

                            if (res?.error || !res?.image) {
                                responseContent.innerHTML = `<span style="opacity:0.75; font-size:10.5px;">${escapeHtml(res?.message || 'Снимок экрана не удался.')}</span>`;
                                adjustPopupPosition(currentPopup, currentAnchorRect);
                                return;
                            }

                            // 4. Отправить изображение Gemini одновременно с последним вопросом и контекстом
                            let prompt = `Задание со скриншота для ученика 8 класса.\n`;
                            if (currentOriginalContext) {
                                prompt += `Предыдущий контекст задания: "${currentOriginalContext}"\n`;
                            }
                            if (currentLastAnswer) {
                                prompt += `Предыдущий ответ: "${currentLastAnswer}"\n`;
                            }
                            if (typedText) {
                                prompt += `Последний вопрос ученика: "${typedText}"\n`;
                            } else {
                                prompt += `Последний вопрос ученика: "Реши задание на скриншоте. Ты обязан сам дать готовый точный ответ. На первой строке напиши: **Ответ: [готовый ответ]**, затем дай 1-2 строки краткого хода решения. Запрещено писать шаблоны в скобках или общие советы вроде 'прочитай условие'."\n`;
                            }
                            prompt += `Ответь спокойно и понятно для ученика 8 класса, без лишней воды и без LaTeX/$.`;

                            executeAiRequest(prompt, res.image, nextReqId, true);
                            queryInput.value = '';
                        });
                    } catch (err) {
                        if (!err?.message?.includes('context invalidated')) {
                            console.error('[Gemini Assistant] Исключение при отправке captureTab:', err);
                        }
                    }
                }, 80);
            });
        };

        // Обработка кнопки "Проверить ответ" (ТОЛЬКО краткий итоговый вердикт и верный ответ без эмодзи)
        checkBtn.onclick = (e) => {
            e.stopPropagation();
            if (!currentLastAnswer) return;

            const checkReqId = currentRequestId;
            checkBtn.disabled = true;
            checkBtn.innerText = '...';

            verificationArea.style.display = 'block';
            verificationArea.innerHTML = `
                <div class="gemini-check-compact">
                    <span style="opacity: 0.7;">Сверка ответа...</span>
                </div>
            `;
            body.scrollTop = body.scrollHeight;
            adjustPopupPosition(popup, currentAnchorRect);

            const verifyPrompt = `Ученик 8 класса просит проверить ответ к заданию.
Контекст задания: "${currentOriginalContext || 'Задание со скриншота'}".
Проверяемый ответ: "${currentLastAnswer}".
Вопрос: Правильно ли решено задание?
Напиши ТОЛЬКО краткий итоговый вердикт (максимум 1-2 строки):
Верно. Ответ: [ответ]
или
Ошибка. Правильный ответ: [ответ]
Строго БЕЗ каких-либо эмодзи, галочек и крестиков. Спокойно, без лишней воды.`;

            try {
                chrome.runtime.sendMessage(
                    {
                        action: "askGemini",
                        apiKey: apiKey,
                        prompt: verifyPrompt,
                        modelMode: "smart-verify",
                        isVerification: true
                    },
                    (res) => {
                        if (chrome.runtime?.lastError) {
                            const lastErr = chrome.runtime.lastError;
                            if (!lastErr.message?.includes('context invalidated')) {
                                console.warn('[Gemini Assistant] Ошибка sendMessage (verify):', lastErr);
                            }
                            return;
                        }

                        if (checkReqId !== currentRequestId) return;
                        checkBtn.disabled = false;
                        checkBtn.innerText = 'Сверено';

                        if (res?.error) {
                            verificationArea.innerHTML = `
                                <div class="gemini-check-compact error">
                                    <div>${escapeHtml(res.message || 'Ошибка проверки')}</div>
                                </div>
                            `;
                        } else if (res?.answer) {
                            const isError = res.answer.toLowerCase().includes('ошибк') || res.answer.toLowerCase().includes('неверн');
                            verificationArea.innerHTML = `
                                <div class="gemini-check-compact ${isError ? 'error' : ''}">
                                    <div>${renderMarkdown(res.answer)}</div>
                                    <div class="gemini-check-sub">ИИ-проверка (без 100% гарантии)</div>
                                </div>
                            `;
                        }
                        body.scrollTop = body.scrollHeight;
                        adjustPopupPosition(popup, currentAnchorRect);
                    }
                );
            } catch (err) {
                if (!err?.message?.includes('context invalidated')) {
                    console.error('[Gemini Assistant] Исключение при отправке askGemini (verify):', err);
                }
            }
        };
    });
}

// ==================== УПРАВЛЕНИЕ ЖИЗНЕННЫМ ЦИКЛОМ СОБЫТИЙ ====================
// Мгновенное применение прозрачности и темы к открытому окну при изменении в меню
if (typeof chrome !== 'undefined' && chrome?.storage?.onChanged?.addListener) {
    try {
        chrome.storage.onChanged.addListener((changes, area) => {
            if (area === 'sync' && currentPopup) {
                safeGetStorageSync(['theme', 'windowOpacity'], (data) => {
                    applyPopupStealthStyle(currentPopup, data.windowOpacity, data.theme);
                });
            }
        });
    } catch (err) {
        if (!err?.message?.includes('context invalidated')) {
            console.error('[Gemini Assistant] Ошибка регистрации storage.onChanged:', err);
        }
    }
}

// Перерасчет позиции при изменении размера окна
window.addEventListener('resize', () => {
    if (currentPopup) {
        adjustPopupPosition(currentPopup, currentAnchorRect);
    }
});

// ЕДИНСТВЕННЫЙ обработчик кликов для закрытия при клике вне popup (Requirement 5)
document.addEventListener('pointerdown', (e) => {
    const path = e.composedPath ? e.composedPath() : [];

    // Клик внутри popup НЕ закрывает его (текст, скроллбар, кнопки, ввод, скриншот, проверка)
    if (currentPopup && path.includes(currentPopup)) {
        return;
    }

    // Если popup открыт и клик произошел вне его — сразу закрыть
    if (currentPopup) {
        closeCurrentPopup();
    }

    // Закрытие кнопки выделения при клике вне её
    if (currentButton && !path.includes(currentButton)) {
        removeCurrentButton();
    }
}, true);

// Быстрое скрытие ТОЛЬКО по Alt+Q (режим мгновенной скрытности)
document.addEventListener('keydown', (e) => {
    if (e.altKey && (e.code === 'KeyQ' || e.key === 'q' || e.key === 'Q' || e.key === 'й' || e.key === 'Й')) {
        if (currentPopup) {
            e.stopPropagation();
            closeCurrentPopup();
        }
        removeCurrentButton();
    }
}, true);

window.addEventListener('message', (e) => {
    if (e.data && e.data.type === 'GEMINI_CLOSE_POPUP') {
        closeCurrentPopup();
        removeCurrentButton();
    }
});

// Появление кнопки при выделении текста (проверяем assistantEnabled)
document.addEventListener('mouseup', (e) => {
    if (!isExtensionValid()) return;

    safeGetStorageSync(['assistantEnabled', 'isEnabled'], (data) => {
        const isAssistantActive = data.assistantEnabled !== undefined ? data.assistantEnabled : (data.isEnabled !== false);
        if (!isAssistantActive) return;

        const path = e.composedPath ? e.composedPath() : [];
        if (currentPopup && path.includes(currentPopup)) return;

        if (timeoutId) clearTimeout(timeoutId);

        timeoutId = setTimeout(() => {
            const selection = window.getSelection();
            const selectedText = selection ? selection.toString().trim() : '';
            if (!selectedText || selectedText.length < 1) return;

            removeCurrentButton();

            try {
                if (!selection.rangeCount) return;
                const range = selection.getRangeAt(0);
                let rect = range.getBoundingClientRect();
                if (!rect || (rect.width === 0 && rect.height === 0)) {
                    const clientRects = range.getClientRects();
                    if (clientRects.length > 0) {
                        rect = clientRects[0];
                    }
                }

                currentButton = createGeminiButton();
                getShadowContainer().appendChild(currentButton);

                // Позиционируем кнопку рядом с выделением (надежно даже для 1-2 символов)
                const btnLeft = Math.min(window.innerWidth - 30, Math.max(6, (rect.right || e.clientX) + 4));
                const btnTop = (rect.top > 30) ? (rect.top - 26) : Math.min(window.innerHeight - 30, Math.max(6, (rect.bottom || e.clientY) + 6));
                currentButton.style.left = `${Math.round(btnLeft)}px`;
                currentButton.style.top = `${Math.round(btnTop)}px`;

                // Если выделен короткий фрагмент (например, 1-2 слова или номер), извлекаем родительский блок для контекста задачи
                let surroundingText = '';
                try {
                    const container = range.commonAncestorContainer;
                    const parent = (container.nodeType === 1) ? container : container.parentElement;
                    if (parent && parent.innerText) {
                        const pText = parent.innerText.trim();
                        if (pText.length > selectedText.length && pText.length <= 1500) {
                            surroundingText = pText;
                        }
                    }
                } catch (e) {
                    console.debug('[Gemini Assistant] Не удалось получить окружающий контекст:', e);
                }

                currentButton.onclick = (ev) => {
                    ev.stopPropagation();
                    createResponsePopup(selectedText, rect, surroundingText);
                    removeCurrentButton();
                };

                buttonHideTimeout = setTimeout(() => {
                    removeCurrentButton();
                }, 10000);
            } catch (err) {
                console.error('[Gemini Assistant] Ошибка отображения кнопки помощника:', err);
            }
        }, 150);
    });
});
