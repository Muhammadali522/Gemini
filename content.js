let timeoutId = null;
let currentButton = null;
let currentPopup = null;
let shadowHost = null;
let closedShadowRoot = null;
let buttonHideTimeout = null;
let currentRequestId = 0;
let currentAnchorRect = null;
let currentOriginalContext = '';
let currentLastAnswer = '';
let currentLastScreenshot = null;
let popupOpenedAt = 0;

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
                } catch (cbErr) {}
            }
            resolve(data);
        };

        if (!isStorageSyncAvailable()) {
            finish(fallback);
            return;
        }

        try {
            chrome.storage.sync.get(keys, (items) => {
                if (chrome.runtime?.lastError) {
                    finish(fallback);
                    return;
                }
                finish(items || fallback);
            });
        } catch (err) {
            finish(fallback);
        }
    });
}

// ==================== ОЧИСТКА И ФОРМАТИРОВАНИЕ MATH / LATEX ====================
function formatMath(str) {
    if (!str) return "";
    return str
        .replace(/\$\$([\s\S]*?)\$\$/g, ' $1 ')
        .replace(/\$([^\$\n]+)\$/g, ' $1 ')
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
        .replace(/\\alpha\b/g, 'α')
        .replace(/\\beta\b/g, 'β')
        .replace(/\\gamma\b/g, 'γ')
        .replace(/\\pi\b/g, 'π')
        .replace(/\\sqrt\{([^}]+)\}/g, '√($1)')
        .replace(/\\frac\{([^}]+)\}\{([^}]+)\}/g, '($1/$2)')
        .replace(/\^2\b/g, '²')
        .replace(/\^3\b/g, '³')
        .replace(/_0\b/g, '₀')
        .replace(/_1\b/g, '₁')
        .replace(/_2\b/g, '₂')
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

    const codeBlocks = [];
    text = text.replace(/```([a-zA-Z0-9_-]*)\n([\s\S]*?)```/g, (match, lang, code) => {
        const id = `__GEMINI_CODE_${codeBlocks.length}__`;
        const escapedCode = escapeHtml(code.trim());
        const langAttr = lang ? ` data-lang="${escapeHtml(lang)}"` : "";
        codeBlocks.push(`<pre class="gemini-code-block"${langAttr}><code>${escapedCode}</code></pre>`);
        return `\n\n${id}\n\n`;
    });

    text = formatMath(text);
    text = escapeHtml(text);

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

    text = text.replace(/(?:^|\n)((?:&gt;[^\n]+\r?\n?)+)/g, (match, quoteBlock) => {
        const lines = quoteBlock.trim().split("\n").map(l => l.replace(/^&gt;\s?/, ""));
        const content = lines.map(l => formatInlines(l)).join("<br>");
        return `\n\n<blockquote class="gemini-quote">${content}</blockquote>\n\n`;
    });

    text = text.replace(/^######\s+(.+)$/gm, '<h6 class="gemini-h6">$1</h6>');
    text = text.replace(/^#####\s+(.+)$/gm, '<h5 class="gemini-h5">$1</h5>');
    text = text.replace(/^####\s+(.+)$/gm, '<h4 class="gemini-h4">$1</h4>');
    text = text.replace(/^###\s+(.+)$/gm, '<h3 class="gemini-h3">$1</h3>');
    text = text.replace(/^##\s+(.+)$/gm, '<h3 class="gemini-h3">$1</h3>');
    text = text.replace(/^#\s+(.+)$/gm, '<h2 class="gemini-h2">$1</h2>');

    text = text.replace(/(?:^|\n)((?:[ \t]*[-*]\s+[^\n]+\r?\n?)+)/g, (match, listBlock) => {
        const items = listBlock.trim().split("\n").map(l => l.replace(/^[ \t]*[-*]\s+/, ""));
        return '\n\n<ul class="gemini-ul">' + items.map(i => `<li>${formatInlines(i)}</li>`).join("") + '</ul>\n\n';
    });

    text = text.replace(/(?:^|\n)((?:[ \t]*\d+\.\s+[^\n]+\r?\n?)+)/g, (match, listBlock) => {
        const items = listBlock.trim().split("\n").map(l => l.replace(/^[ \t]*\d+\.\s+/, ""));
        return '\n\n<ol class="gemini-ol">' + items.map(i => `<li>${formatInlines(i)}</li>`).join("") + '</ol>\n\n';
    });

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

    codeBlocks.forEach((cb, idx) => {
        result = result.replace(`__GEMINI_CODE_${idx}__`, cb);
    });

    return result;
}

// ==================== CLOSED SHADOW DOM ====================
function ensureShadowRoot() {
    if (!shadowHost || !shadowHost.parentNode) {
        shadowHost = document.createElement('div');
        shadowHost.id = 'ui-ext-' + Math.random().toString(36).substring(2, 9);
        shadowHost.style.cssText = 'position:fixed;top:0;left:0;width:0;height:0;z-index:2147483647;pointer-events:none;';
        (document.documentElement || document.body).appendChild(shadowHost);
        closedShadowRoot = shadowHost.attachShadow({ mode: 'closed' });
    }
    return closedShadowRoot;
}

function cleanupShadowHostIfIdle() {
    if (!currentButton && !currentPopup && shadowHost) {
        shadowHost.remove();
        shadowHost = null;
        closedShadowRoot = null;
    }
}

window.addEventListener("beforeunload", () => {
    if (shadowHost) {
        shadowHost.remove();
        shadowHost = null;
        closedShadowRoot = null;
    }
});

function removeCurrentButton(skipCleanup = false) {
    if (currentButton) {
        currentButton.remove();
        currentButton = null;
    }
    if (buttonHideTimeout) {
        clearTimeout(buttonHideTimeout);
        buttonHideTimeout = null;
    }
    if (!skipCleanup) {
        cleanupShadowHostIfIdle();
    }
}

function closeCurrentPopup() {
    if (currentPopup) {
        currentPopup.remove();
        currentPopup = null;
    }
    currentRequestId++;
    currentAnchorRect = null;
    currentOriginalContext = '';
    currentLastAnswer = '';
    currentLastScreenshot = null;
    cleanupShadowHostIfIdle();
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
    } catch (e) {}
    return true;
}

let activeBaseOpacity = 0.45;

function applyPopupStealthStyle(popup, savedOpacity, themeSetting) {
    if (!popup) return;

    let isLight = themeSetting === 'light';
    if (!themeSetting || themeSetting === 'auto') {
        isLight = isPageBackgroundLight();
    }

    const num = typeof savedOpacity === 'number' ? savedOpacity : 35;
    const clamped = Math.max(15, Math.min(95, num));
    activeBaseOpacity = (clamped / 100);

    popup.style.opacity = String(activeBaseOpacity);

    if (isLight) {
        popup.style.background = 'rgba(255, 255, 255, 0.72)';
        popup.style.color = '#1e293b';
        popup.style.border = '1px solid rgba(0, 0, 0, 0.12)';
        popup.style.boxShadow = '0 4px 16px rgba(0, 0, 0, 0.08)';
    } else {
        popup.style.background = 'rgba(16, 20, 26, 0.78)';
        popup.style.color = '#e2e8f0';
        popup.style.border = '1px solid rgba(255, 255, 255, 0.14)';
        popup.style.boxShadow = '0 4px 16px rgba(0, 0, 0, 0.25)';
    }

    popup.onmouseenter = () => {
        popup.style.opacity = String(Math.max(0.94, activeBaseOpacity));
    };
    popup.onmouseleave = () => {
        popup.style.opacity = String(activeBaseOpacity);
    };
}

// ==================== МАЛЕНЬКАЯ НЕЗАМЕТНАЯ КНОПКА ====================
function createGeminiButton() {
    const btn = document.createElement('div');
    btn.style.cssText = `
        position: fixed; 
        z-index: 2147483646; 
        pointer-events: auto;
        background: rgba(120, 130, 145, 0.28);
        color: rgba(230, 235, 245, 0.9); 
        width: 22px; 
        height: 22px; 
        border-radius: 7px; 
        display: flex;
        align-items: center; 
        justify-content: center; 
        cursor: pointer; 
        box-shadow: 0 2px 10px rgba(0, 0, 0, 0.12);
        backdrop-filter: blur(12px) saturate(130%);
        -webkit-backdrop-filter: blur(12px) saturate(130%);
        font-size: 11px; 
        user-select: none; 
        opacity: 0.55;
        border: 1px solid rgba(255, 255, 255, 0.2);
        transition: opacity 0.2s ease, transform 0.2s ease, background 0.2s ease;
    `;
    btn.innerText = '✦';
    btn.title = 'Помощник';
    btn.onmouseenter = () => { 
        btn.style.opacity = '0.98'; 
        btn.style.transform = 'scale(1.08)'; 
        btn.style.background = 'rgba(120, 130, 145, 0.45)';
    };
    btn.onmouseleave = () => { 
        btn.style.opacity = '0.55'; 
        btn.style.transform = 'scale(1.0)'; 
        btn.style.background = 'rgba(120, 130, 145, 0.28)';
    };
    return btn;
}

// ==================== РАСЧЕТ И КОРРЕКЦИЯ ПОЗИЦИИ POPUP ====================
function adjustPopupPosition(popup, anchorRect) {
    if (!popup) return;

    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const margin = 8;

    const popupWidth = Math.min(290, vw - margin * 2);
    popup.style.width = `${popupWidth}px`;
    popup.style.maxWidth = `${vw - margin * 2}px`;
    popup.style.maxHeight = `${Math.min(245, vh - margin * 2)}px`;

    const rect = popup.getBoundingClientRect();
    const width = rect.width || popupWidth;
    const height = rect.height || 180;

    let left = anchorRect ? anchorRect.left : (vw - width) / 2;
    if (left + width > vw - margin) {
        left = vw - width - margin;
    }
    if (left < margin) {
        left = margin;
    }

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

    top = Math.max(margin, Math.min(top, vh - height - margin));

    popup.style.left = `${Math.round(left)}px`;
    popup.style.top = `${Math.round(top)}px`;
}

// ==================== СОЗДАНИЕ POPUP (МГНОВЕННОЕ ОТКРЫТИЕ) ====================
function createResponsePopup(selectedText, rect, surroundingContext = '', useAutoScreenshot = true) {
    closeCurrentPopup();
    removeCurrentButton(true);

    popupOpenedAt = Date.now();
    currentAnchorRect = rect;
    currentOriginalContext = (surroundingContext && surroundingContext.length > selectedText.length) 
        ? surroundingContext 
        : (selectedText || '');
    currentLastScreenshot = null;
    const thisRequestId = ++currentRequestId;

    const shadow = ensureShadowRoot();

    const styleEl = document.createElement('style');
    styleEl.textContent = `
        @keyframes geminiStealthEntrance {
            0% { transform: translateY(5px) scale(0.98); }
            100% { transform: translateY(0) scale(1); }
        }
        .gemini-popup-root {
            position: fixed;
            z-index: 2147483647;
            pointer-events: auto;
            display: flex;
            flex-direction: column;
            box-sizing: border-box;
            border-radius: 9px;
            background: rgba(255, 255, 255, 0.85);
            color: #1e293b;
            border: 1px solid rgba(0, 0, 0, 0.12);
            box-shadow: 0 4px 16px rgba(0, 0, 0, 0.12);
            backdrop-filter: blur(16px) saturate(115%);
            -webkit-backdrop-filter: blur(16px) saturate(115%);
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
            font-size: 11px;
            line-height: 1.38;
            overflow: hidden;
            user-select: text;
            opacity: 0.75;
            animation: geminiStealthEntrance 0.18s cubic-bezier(0.16, 1, 0.3, 1);
            transition: opacity 0.22s ease, transform 0.18s ease, background 0.22s ease;
        }
        .gemini-popup-header {
            flex: 0 0 auto;
            display: flex;
            align-items: center;
            padding: 4px 8px;
            border-bottom: 1px solid rgba(128, 128, 140, 0.12);
            user-select: none;
            position: relative;
        }
        .gemini-title {
            font-weight: 500;
            font-size: 10.5px;
            opacity: 0.75;
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
            background: rgba(128, 128, 140, 0.1);
            color: inherit;
            opacity: 0.75;
            border: 1px solid rgba(128, 128, 140, 0.15);
            white-space: nowrap;
        }
        .gemini-close-btn {
            position: absolute;
            right: 5px;
            top: 4px;
            background: none;
            border: none;
            color: rgba(140, 145, 155, 0.65);
            font-size: 12px;
            cursor: pointer;
            width: 16px;
            height: 16px;
            display: flex;
            align-items: center;
            justify-content: center;
            border-radius: 4px;
        }
        .gemini-close-btn:hover {
            color: #ef4444;
            background: rgba(239, 68, 68, 0.1);
        }
        .gemini-popup-body {
            flex: 1 1 auto;
            min-height: 38px;
            max-height: 145px;
            overflow-y: auto;
            overflow-x: hidden;
            padding: 6px 9px;
            box-sizing: border-box;
            overscroll-behavior: contain;
        }
        .gemini-popup-body::-webkit-scrollbar { width: 2.5px; }
        .gemini-popup-body::-webkit-scrollbar-thumb {
            background: rgba(128, 128, 140, 0.25);
            border-radius: 3px;
        }
        .gemini-popup-footer {
            flex: 0 0 auto;
            padding: 4px 7px;
            border-top: 1px solid rgba(128, 128, 140, 0.12);
            display: flex;
            flex-direction: column;
            gap: 4px;
            background: rgba(128, 128, 140, 0.03);
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
            border: 1px solid rgba(128, 128, 140, 0.18);
            background: rgba(128, 128, 140, 0.06);
            color: inherit;
            font-size: 10.5px;
            outline: none;
            box-sizing: border-box;
        }
        .gemini-send-btn {
            flex: 0 0 auto;
            height: 22px;
            padding: 0 7px;
            background: rgba(128, 128, 140, 0.16);
            border: 1px solid rgba(128, 128, 140, 0.22);
            color: inherit;
            border-radius: 5px;
            cursor: pointer;
            font-size: 11px;
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
            border: 1px solid rgba(128, 128, 140, 0.16);
            background: rgba(128, 128, 140, 0.08);
            color: inherit;
            font-size: 10px;
            font-weight: 500;
            cursor: pointer;
            display: inline-flex;
            align-items: center;
            gap: 3px;
            user-select: none;
        }
        .gemini-check-compact {
            margin-top: 4px;
            padding: 4px 7px;
            border-radius: 5px;
            border: 1px solid rgba(128, 128, 140, 0.16);
            background: rgba(128, 128, 140, 0.05);
            font-size: 10.5px;
            font-weight: 500;
        }
        .gemini-check-sub {
            font-size: 8.5px;
            font-weight: normal;
            opacity: 0.5;
            margin-top: 2px;
        }
        .gemini-table-wrap { width: 100%; overflow-x: auto; margin: 6px 0; border-radius: 5px; border: 1px solid rgba(128, 128, 140, 0.18); }
        .gemini-table { width: 100%; border-collapse: collapse; font-size: 11px; text-align: left; }
        .gemini-table th, .gemini-table td { padding: 4px 6px; border: 1px solid rgba(128, 128, 140, 0.15); }
        .gemini-code-block { background: rgba(0, 0, 0, 0.2); padding: 6px 8px; border-radius: 6px; overflow-x: auto; font-family: ui-monospace, monospace; font-size: 11px; margin: 5px 0; }
        .gemini-inline-code { background: rgba(128, 128, 140, 0.14); padding: 1px 4px; border-radius: 3px; font-family: ui-monospace, monospace; }
        .gemini-quote { margin: 5px 0; padding: 4px 8px; border-left: 2px solid rgba(96, 165, 250, 0.5); background: rgba(96, 165, 250, 0.06); }
        .gemini-ul, .gemini-ol { margin: 4px 0; padding-left: 16px; }
        .gemini-p { margin: 3px 0; }
        .gemini-h2, .gemini-h3, .gemini-h4, .gemini-h5, .gemini-h6 { margin: 6px 0 3px 0; font-weight: 600; font-size: 12px; }
    `;

    const popup = document.createElement('div');
    popup.className = 'gemini-popup-root';
    currentPopup = popup;

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

    const body = document.createElement('div');
    body.className = 'gemini-popup-body';

    const responseContent = document.createElement('div');
    responseContent.className = 'gemini-response-content';
    responseContent.innerHTML = `<span style="opacity: 0.7;">Поиск задания на экране...</span>`;
    body.appendChild(responseContent);

    const verificationArea = document.createElement('div');
    verificationArea.className = 'gemini-verification-area';
    verificationArea.style.display = 'none';
    body.appendChild(verificationArea);

    popup.appendChild(body);

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

    if (!shadow.getElementById('gemini-popup-styles')) {
        styleEl.id = 'gemini-popup-styles';
        shadow.appendChild(styleEl);
    }
    shadow.appendChild(popup);

    adjustPopupPosition(popup, currentAnchorRect);

    safeGetStorageSync(['geminiApiKey', 'geminiApiKeys', 'groqApiKey', 'providerMode', 'theme', 'windowOpacity'], (data) => {
        if (thisRequestId !== currentRequestId || !currentPopup) return;

        const storedKeys = Array.isArray(data.geminiApiKeys) ? data.geminiApiKeys.filter(Boolean) : [];
        if (storedKeys.length === 0 && data.geminiApiKey) {
            storedKeys.push(data.geminiApiKey);
        }
        const groqKey = (data.groqApiKey || '').trim();
        const providerMode = data.providerMode || 'auto-hybrid';

        applyPopupStealthStyle(popup, data.windowOpacity, data.theme);

        if (storedKeys.length === 0 && !groqKey) {
            modelBadge.innerText = 'Ключ';
            responseContent.innerHTML = `<span style="opacity:0.85;">Укажите API-ключ Gemini или Groq в настройках.</span>`;
            return;
        }

        function executeAiRequest(promptText, imageBase64, reqId, isScreenshot = false) {
            if (reqId !== currentRequestId || !currentPopup) return;

            responseContent.innerHTML = `<span style="opacity: 0.7;">${isScreenshot ? 'Анализ скриншота...' : 'Поиск решения...'}</span>`;
            verificationArea.style.display = 'none';
            checkBtn.style.display = 'none';
            modelBadge.innerText = '...';
            adjustPopupPosition(popup, currentAnchorRect);

            try {
                chrome.runtime.sendMessage(
                    {
                        action: "askGemini",
                        apiKeys: storedKeys,
                        apiKey: storedKeys[0] || '',
                        groqApiKey: groqKey,
                        providerMode: providerMode,
                        prompt: promptText,
                        image: imageBase64
                    },
                    (response) => {
                        if (chrome.runtime?.lastError) {
                            if (reqId === currentRequestId) {
                                modelBadge.innerText = 'Ошибка';
                                responseContent.innerHTML = `<span style="opacity:0.8; font-size:10.5px;">Обновите страницу (F5).</span>`;
                            }
                            return;
                        }
                        if (reqId !== currentRequestId || !currentPopup) return;

                        if (response?.error) {
                            modelBadge.innerText = 'Ошибка';
                            responseContent.innerHTML = `<span style="opacity:0.8; font-size:10.5px;">${escapeHtml(response.message || 'Ошибка запроса')}</span>`;
                            adjustPopupPosition(popup, currentAnchorRect);
                        } else if (response?.answer) {
                            currentLastAnswer = response.answer;
                            if (response.modelDisplayName) {
                                modelBadge.innerText = response.modelDisplayName.replace("Gemini ", "");
                            } else if (response.model) {
                                modelBadge.innerText = response.model.replace("gemini-", "");
                            } else {
                                modelBadge.innerText = "OK";
                            }

                            responseContent.innerHTML = renderMarkdown(response.answer);
                            checkBtn.style.display = 'inline-flex';
                            checkBtn.disabled = false;
                            checkBtn.innerText = 'Проверить';

                            adjustPopupPosition(popup, currentAnchorRect);
                        }
                    }
                );
            } catch (err) {}
        }

        let taskContext = selectedText;
        if (currentOriginalContext && currentOriginalContext !== selectedText) {
            taskContext = `${selectedText}\nКонтекст со страницы: "${currentOriginalContext}"`;
        }

        // Усиленный промпт: объясняет модели, что на тестах вопрос может быть картинкой,
        // а выделенный текст — это просто кнопка ("Далее", "Назад", номер вопроса),
        // поэтому нужно НАЙТИ само задание на скриншоте и решить его!
        const buildPrompt = (withShot) => withShot
            ? `ВАЖНАЯ ОСОБЕННОСТЬ ТЕСТА:
На этой странице стоит защита от выделения текста, и сам вопрос/задание размещён ВНУТРИ КАРТИНКИ (изображения) на скриншоте!
Пользователь смог выделить мышкой только служебный элемент интерфейса рядом (например, кнопку "Далее", "Предыдущий", "Next", "Previous", номер вопроса или случайное слово):
"${taskContext}"

ТВОЯ ГЛАВНАЯ ЗАДАЧА:
1. НЕ пытайся отвечать на выделенное служебное слово вроде "Далее" или номер вопроса — это просто ориентир того, что пользователь запустил помощника на этом экране!
2. Внимательно осмотри ВЕСЬ прикреплённый скриншот: найди на нём картинку/блок с текстом самого задания, вопроса, предложения с пропуском, текста для чтения или схемы, а также все варианты ответа (A, B, C, D или поля ввода).
3. Если выделенный текст всё же является частью самого вопроса — учитывай и его, и картинку на скриншоте вместе.
4. Тщательно реши найденное на скриншоте задание и перепроверь ответ.
5. Если это тест с вариантами ответа — укажи ТОЧНУЮ букву/номер и текст верного варианта.
6. КАТЕГОРИЧЕСКИ ЗАПРЕЩЕНО писать шаблоны в скобках [ ], плейсхолдеры вроде "[Укажи ответ]" или советы "внимательно прочитай условие".
7. На первой строке напиши: **Ответ: [точный ответ или верный вариант]**.
8. Ниже напиши 1-2 строки краткого понятного объяснения.
9. Строго БЕЗ эмодзи. Без $ и LaTeX, используй символы: ×, :, √, ², ³, °, ->.`
            : `Задание:
"${taskContext}"

ОБЯЗАТЕЛЬНЫЕ ТРЕБОВАНИЯ:
1. Ты обязан САМ РЕШИТЬ задачу, тщательно перепроверить решение и дать готовый точный результат.
2. КАТЕГОРИЧЕСКИ ЗАПРЕЩЕНО писать шаблоны в скобках [ ], плейсхолдеры вроде "[Укажи ответ]" или давать общие советы вроде "внимательно прочитай условие задачи".
3. СРАЗУ на первой строке напиши готовый найденный ответ: **Ответ: [конкретный ответ или выбранный вариант]** (вместо слов в скобках пиши сам найденный ответ).
4. Ниже напиши 1-2 строки понятного решения.
5. Строго БЕЗ эмодзи. Без $ и LaTeX, используй символы: ×, :, √, ², ³, °, ->.`;

        // Даём 800 мс на захват скриншота экрана, чтобы вопрос-картинка гарантированно попал в запрос
        if (useAutoScreenshot) {
            let started = false;
            const startOnce = (shot) => {
                if (started || thisRequestId !== currentRequestId) return;
                started = true;
                currentLastScreenshot = shot;
                executeAiRequest(buildPrompt(Boolean(shot)), shot, thisRequestId, Boolean(shot));
            };

            const fallbackTimer = setTimeout(() => startOnce(null), 800);

            try {
                chrome.runtime.sendMessage({ action: "captureTab" }, (res) => {
                    clearTimeout(fallbackTimer);
                    if (chrome.runtime?.lastError || res?.error || !res?.image) {
                        startOnce(null);
                    } else {
                        startOnce(res.image);
                    }
                });
            } catch (e) {
                clearTimeout(fallbackTimer);
                startOnce(null);
            }
        } else {
            executeAiRequest(buildPrompt(false), null, thisRequestId, false);
        }

        function handleUserSubmit() {
            const userQ = queryInput.value.trim();
            if (!userQ) return;

            const nextReqId = ++currentRequestId;
            sendBtn.disabled = true;
            sendBtn.innerText = '...';

            let fullPrompt = `Ученик задает уточняющий вопрос по заданию со скриншота.\n`;
            if (currentOriginalContext) {
                fullPrompt += `Выделенный ориентир: "${currentOriginalContext}"\n`;
            }
            if (currentLastAnswer) {
                fullPrompt += `Предыдущий ответ помощника: "${currentLastAnswer}"\n`;
            }
            fullPrompt += `Вопрос пользователя: "${userQ}"\n`;
            fullPrompt += `Дай точный, понятный и краткий ответ без лишней воды и без LaTeX/$.`;

            // Передаём также сохранённый скриншот, если вопрос касается картинки на экране
            executeAiRequest(fullPrompt, currentLastScreenshot, nextReqId, Boolean(currentLastScreenshot));

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

        screenshotBtn.onclick = (e) => {
            e.stopPropagation();
            if (!currentPopup) return;

            const nextReqId = ++currentRequestId;
            const typedText = queryInput.value.trim();

            currentPopup.style.display = 'none';

            requestAnimationFrame(() => {
                setTimeout(() => {
                    try {
                        chrome.runtime.sendMessage({ action: "captureTab" }, (res) => {
                            if (!currentPopup) return;
                            currentPopup.style.display = 'flex';
                            adjustPopupPosition(currentPopup, currentAnchorRect);

                            if (nextReqId !== currentRequestId) return;

                            if (chrome.runtime?.lastError || res?.error || !res?.image) {
                                responseContent.innerHTML = `<span style="opacity:0.8; font-size:10.5px;">${escapeHtml(res?.message || 'Снимок экрана не удался.')}</span>`;
                                adjustPopupPosition(popup, currentAnchorRect);
                                return;
                            }

                            let prompt = `На скриншоте изображён тест, где вопрос может быть оформлен в виде картинки.\n`;
                            if (currentOriginalContext) {
                                prompt += `Выделенный ориентир на странице: "${currentOriginalContext}"\n`;
                            }
                            if (typedText) {
                                prompt += `Вопрос пользователя: "${typedText}"\n`;
                            } else {
                                prompt += `Найди активное задание/вопрос на скриншоте (в том числе текст внутри картинки), реши его и напиши на первой строке: **Ответ: [точный ответ или верный вариант]**, затем 1-2 строки краткого объяснения. Без шаблонов в скобках.`;
                            }

                            currentLastScreenshot = res.image;
                            executeAiRequest(prompt, res.image, nextReqId, true);
                            queryInput.value = '';
                        });
                    } catch (err) {
                        if (currentPopup) currentPopup.style.display = 'flex';
                    }
                }, 80);
            });
        };

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

            const verifyPrompt = `Проверь ответ к заданию на скриншоте (учитывай, что сам вопрос может быть внутри картинки на скриншоте).
Выделенный ориентир: "${currentOriginalContext || 'Задание со скриншота'}".
Проверяемый ответ: "${currentLastAnswer}".
Напиши ТОЛЬКО краткий итоговый вердикт (максимум 1-2 строки):
Верно. Ответ: [ответ]
или
Ошибка. Правильный ответ: [ответ]
Строго БЕЗ эмодзи.`;

            try {
                chrome.runtime.sendMessage(
                    {
                        action: "askGemini",
                        apiKeys: storedKeys,
                        apiKey: storedKeys[0] || '',
                        groqApiKey: groqKey,
                        providerMode: providerMode,
                        prompt: verifyPrompt,
                        image: currentLastScreenshot,
                        isVerification: true
                    },
                    (res) => {
                        if (chrome.runtime?.lastError) return;
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
                                    <div class="gemini-check-sub">Проверка (${escapeHtml(res.modelDisplayName || 'ИИ')})</div>
                                </div>
                            `;
                        }
                        body.scrollTop = body.scrollHeight;
                        adjustPopupPosition(popup, currentAnchorRect);
                    }
                );
            } catch (err) {}
        };
    });
}

// ==================== УПРАВЛЕНИЕ ЖИЗНЕННЫМ ЦИКЛОМ СОБЫТИЙ ====================
if (typeof chrome !== 'undefined' && chrome?.storage?.onChanged?.addListener) {
    try {
        chrome.storage.onChanged.addListener((changes, area) => {
            if (area === 'sync' && currentPopup) {
                safeGetStorageSync(['theme', 'windowOpacity'], (data) => {
                    applyPopupStealthStyle(currentPopup, data.windowOpacity, data.theme);
                });
            }
        });
    } catch (err) {}
}

window.addEventListener('resize', () => {
    if (currentPopup) {
        adjustPopupPosition(currentPopup, currentAnchorRect);
    }
});

// Закрытие при клике вне popup/кнопки
document.addEventListener('pointerdown', (e) => {
    const path = e.composedPath ? e.composedPath() : [];
    if (shadowHost && path.includes(shadowHost)) return;
    if (currentPopup && path.includes(currentPopup)) return;
    if (currentButton && path.includes(currentButton)) return;

    if (currentPopup && (Date.now() - popupOpenedAt > 250)) {
        closeCurrentPopup();
    }

    if (currentButton) {
        removeCurrentButton();
    }
}, true);

// Быстрое скрытие ТОЛЬКО по Alt+Q
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

// Появление кнопки при выделении текста
document.addEventListener('mouseup', (e) => {
    if (!isExtensionValid()) return;

    const path = e.composedPath ? e.composedPath() : [];
    if (shadowHost && path.includes(shadowHost)) return;
    if (currentPopup && path.includes(currentPopup)) return;

    safeGetStorageSync(['assistantEnabled', 'isEnabled'], (data) => {
        const isAssistantActive = data.assistantEnabled !== undefined ? data.assistantEnabled : (data.isEnabled !== false);
        if (!isAssistantActive) return;

        if (timeoutId) clearTimeout(timeoutId);

        timeoutId = setTimeout(() => {
            const selection = window.getSelection();
            const selectedText = selection ? selection.toString().trim() : '';
            if (!selectedText || selectedText.length < 1) return;

            removeCurrentButton(true);

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
                ensureShadowRoot().appendChild(currentButton);

                const btnLeft = Math.min(window.innerWidth - 30, Math.max(6, (rect.right || e.clientX) + 4));
                const btnTop = (rect.top > 30) ? (rect.top - 26) : Math.min(window.innerHeight - 30, Math.max(6, (rect.bottom || e.clientY) + 6));
                currentButton.style.left = `${Math.round(btnLeft)}px`;
                currentButton.style.top = `${Math.round(btnTop)}px`;

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
                } catch (e) {}

                const openHandler = (ev) => {
                    ev.preventDefault();
                    ev.stopPropagation();
                    createResponsePopup(selectedText, rect, surroundingText, true);
                };

                currentButton.onpointerdown = openHandler;
                currentButton.onclick = openHandler;

                buttonHideTimeout = setTimeout(() => {
                    removeCurrentButton();
                }, 10000);
            } catch (err) {}
        }, 120);
    });
});