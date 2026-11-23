// ==================== КОНФИГУРАЦИЯ GEMINI И GROQ МОДЕЛЕЙ ====================
const GEMINI_MODEL_CONFIG = {
    "gemini-4-hydrogen": {
        id: "gemini-4-hydrogen",
        shortName: "4 Hydrogen",
        useThinking: true
    },
    "gemini-3.8-flash": {
        id: "gemini-3.8-flash",
        shortName: "3.8 Flash",
        useThinking: true
    },
    "gemini-3.6-flash": {
        id: "gemini-3.6-flash",
        shortName: "3.6 Flash",
        useThinking: true
    },
    "gemini-3.5-flash-lite": {
        id: "gemini-3.5-flash-lite",
        shortName: "3.5 Lite",
        useThinking: false
    },
    "gemini-3.1-flash-lite": {
        id: "gemini-3.1-flash-lite",
        shortName: "3.1 Lite",
        useThinking: false
    }
};

const GEMINI_PRIORITY_CHAIN = [
    "gemini-4-hydrogen",
    "gemini-3.8-flash",
    "gemini-3.6-flash",
    "gemini-3.5-flash-lite",
    "gemini-3.1-flash-lite"
];

// Модели Groq Console (мультимодальные для скриншотов и текстовые)
const GROQ_VISION_MODELS = [
    { id: "meta-llama/llama-4-scout-17b-16e-instruct", shortName: "Groq Llama4 Vision" },
    { id: "meta-llama/llama-4-maverick-17b-128e-instruct", shortName: "Groq Maverick" }
];

const GROQ_TEXT_MODELS = [
    { id: "openai/gpt-oss-120b", shortName: "Groq GPT-OSS 120B" },
    { id: "llama-3.3-70b-versatile", shortName: "Groq Llama 70B" },
    { id: "openai/gpt-oss-20b", shortName: "Groq GPT-OSS 20B" }
];

const SYSTEM_INSTRUCTION_TEXT = "Ты — максимально точный учебный помощник. Внимательно анализируй текст и изображение экрана целиком (вопросы в виде картинок, графики, схемы, формулы и варианты ответов в тестах). Тщательно перепроверяй вычисления и логику перед ответом. КАТЕГОРИЧЕСКИ ЗАПРЕЩЕНО давать шаблонные заготовки, плейсхолдеры вроде '[Укажи ответ]' или советы 'внимательно прочитай условие'. На первой строке напиши: **Ответ: [точный ответ и/или буква/номер верного варианта]**, ниже — 1-2 строки краткого понятного объяснения. Строго БЕЗ эмодзи. Без $ и LaTeX, используй: ×, :, √, ², ³, °, ->.";

function classifyError(status, serverMessage) {
    switch (status) {
        case 400:
            return { code: "BAD_REQUEST", message: serverMessage || "Некорректный запрос к API (код 400)." };
        case 401:
            return { code: "INVALID_KEY", message: "Неверный API-ключ. Проверьте ключ в настройках (код 401)." };
        case 403:
            return { code: "FORBIDDEN", message: "Доступ запрещен (код 403)." };
        case 404:
            return { code: "NOT_FOUND", message: "Модель не найдена (код 404)." };
        case 429:
            return { code: "RATE_LIMIT", message: "Превышен лимит запросов (код 429)." };
        case 500:
        case 502:
        case 503:
        case 504:
            return { code: "SERVICE_UNAVAILABLE", message: `Сервер перегружен или недоступен (код ${status}).` };
        default:
            if (serverMessage === "TIMEOUT") {
                return { code: "TIMEOUT", message: "Сервер не ответил вовремя (таймаут)." };
            }
            if (serverMessage === "NETWORK_ERROR") {
                return { code: "NETWORK_ERROR", message: "Ошибка сети. Проверьте интернет." };
            }
            return { code: "API_ERROR", message: serverMessage || "Ошибка API." };
    }
}

// ==================== ЗАПРОС К GOOGLE GEMINI ====================
async function executeGeminiCall(modelName, apiKey, prompt, imageBase64, isImageRequest, forceNoThinking = false) {
    const timeoutMs = isImageRequest ? 14000 : 10000;
    const controller = new AbortController();
    const timeoutTimer = setTimeout(() => controller.abort(), timeoutMs);

    const parts = [{ text: prompt }];
    if (imageBase64) {
        const cleanBase64 = imageBase64.includes(",") ? imageBase64.split(",")[1] : imageBase64;
        let mimeType = "image/jpeg";
        if (imageBase64.startsWith("data:")) {
            const match = imageBase64.match(/^data:([^;]+);base64,/);
            if (match) mimeType = match[1];
        }
        parts.push({
            inlineData: {
                mimeType: mimeType,
                data: cleanBase64
            }
        });
    }

    const modelInfo = GEMINI_MODEL_CONFIG[modelName];
    const generationConfig = {
        maxOutputTokens: 4096
    };

    if (!forceNoThinking && modelInfo?.useThinking) {
        generationConfig.thinkingConfig = {
            thinkingLevel: "LOW"
        };
    }

    const payload = JSON.stringify({
        systemInstruction: {
            parts: [{ text: SYSTEM_INSTRUCTION_TEXT }]
        },
        contents: [{ parts }],
        generationConfig
    });

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent`;

    try {
        const response = await fetch(url, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "x-goog-api-key": apiKey
            },
            body: payload,
            signal: controller.signal
        });

        clearTimeout(timeoutTimer);

        if (!response.ok) {
            const status = response.status;
            let errorData = null;
            try { errorData = await response.json(); } catch (e) { }
            const serverMsg = errorData?.error?.message;
            const classified = classifyError(status, serverMsg);
            const err = new Error(classified.message);
            err.status = status;
            err.code = classified.code;
            throw err;
        }

        const data = await response.json();
        const candidate = data?.candidates?.[0];
        const text = candidate?.content?.parts
            ?.filter(p => p.text && !p.thought)
            .map(p => p.text)
            .join("\n")
            .trim();

        if (!text) {
            const emptyErr = new Error("Пустой ответ от модели Gemini");
            emptyErr.status = 502;
            throw emptyErr;
        }

        return text;
    } catch (err) {
        clearTimeout(timeoutTimer);
        if (err.name === 'AbortError') {
            const classified = classifyError(0, "TIMEOUT");
            const timeoutErr = new Error(classified.message);
            timeoutErr.status = 408;
            timeoutErr.code = classified.code;
            throw timeoutErr;
        }
        if (!err.status && (err instanceof TypeError || (err.message && err.message.includes('fetch')))) {
            const classified = classifyError(0, "NETWORK_ERROR");
            const netErr = new Error(classified.message);
            netErr.status = 0;
            netErr.code = classified.code;
            throw netErr;
        }
        throw err;
    }
}

// ==================== ЗАПРОС К GROQ CONSOLE API ====================
async function executeGroqCall(modelId, groqApiKey, prompt, imageBase64) {
    const timeoutMs = imageBase64 ? 15000 : 12000;
    const controller = new AbortController();
    const timeoutTimer = setTimeout(() => controller.abort(), timeoutMs);

    const userContent = imageBase64
        ? [
            { type: "text", text: prompt },
            { type: "image_url", image_url: { url: imageBase64 } }
        ]
        : prompt;

    const payload = JSON.stringify({
        model: modelId,
        messages: [
            { role: "system", content: SYSTEM_INSTRUCTION_TEXT },
            { role: "user", content: userContent }
        ],
        temperature: 0.2,
        max_tokens: 2048
    });

    try {
        const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${groqApiKey}`
            },
            body: payload,
            signal: controller.signal
        });

        clearTimeout(timeoutTimer);

        if (!response.ok) {
            const status = response.status;
            let errorData = null;
            try { errorData = await response.json(); } catch (e) { }
            const serverMsg = errorData?.error?.message;
            const classified = classifyError(status, serverMsg);
            const err = new Error(classified.message);
            err.status = status;
            err.code = classified.code;
            throw err;
        }

        const data = await response.json();
        const text = data?.choices?.[0]?.message?.content?.trim();
        if (!text) {
            const emptyErr = new Error("Пустой ответ от Groq");
            emptyErr.status = 502;
            throw emptyErr;
        }
        return text;
    } catch (err) {
        clearTimeout(timeoutTimer);
        if (err.name === 'AbortError') {
            const classified = classifyError(0, "TIMEOUT");
            const timeoutErr = new Error(classified.message);
            timeoutErr.status = 408;
            timeoutErr.code = classified.code;
            throw timeoutErr;
        }
        throw err;
    }
}

// ==================== ЗАПУСК ЦЕПОЧКИ GEMINI ====================
async function runGeminiChain(apiKeys, prompt, image) {
    const isImage = !!image;
    const invalidKeys = new Set();
    let lastError = null;

    for (let mIdx = 0; mIdx < GEMINI_PRIORITY_CHAIN.length; mIdx++) {
        const currentModel = GEMINI_PRIORITY_CHAIN[mIdx];
        const modelInfo = GEMINI_MODEL_CONFIG[currentModel];

        for (let kIdx = 0; kIdx < apiKeys.length; kIdx++) {
            if (invalidKeys.has(kIdx)) continue;
            const currentKey = apiKeys[kIdx];

            try {
                console.log(`[Gemini] Пробуем ${currentModel} (Ключ #${kIdx + 1})`);
                let answer;
                try {
                    answer = await executeGeminiCall(currentModel, currentKey, prompt, image, isImage, false);
                } catch (firstErr) {
                    if (firstErr.status === 400 && modelInfo.useThinking) {
                        answer = await executeGeminiCall(currentModel, currentKey, prompt, image, isImage, true);
                    } else {
                        throw firstErr;
                    }
                }

                const keyTag = apiKeys.length > 1 ? ` · K${kIdx + 1}` : "";
                return {
                    success: true,
                    answer,
                    model: currentModel,
                    modelDisplayName: `${modelInfo.shortName}${keyTag}`
                };
            } catch (err) {
                lastError = err;
                console.warn(`[Gemini] Ошибка ${currentModel} K${kIdx + 1}:`, err.status, err.message);
                if (err.status === 401) {
                    invalidKeys.add(kIdx);
                }
            }
        }

        if (invalidKeys.size === apiKeys.length) break;
    }

    throw lastError || new Error("Все модели Gemini недоступны.");
}

// ==================== ЗАПУСК ЦЕПОЧКИ GROQ ====================
async function runGroqChain(groqKey, prompt, image) {
    let lastError = null;

    // 1. Если есть скриншот — пробуем Vision-модели Groq (они реально видят картинку)
    if (image) {
        for (const vm of GROQ_VISION_MODELS) {
            try {
                console.log(`[Groq Vision] Пробуем ${vm.id}`);
                const answer = await executeGroqCall(vm.id, groqKey, prompt, image);
                return {
                    success: true,
                    answer,
                    model: vm.id,
                    modelDisplayName: vm.shortName
                };
            } catch (err) {
                lastError = err;
                console.warn(`[Groq Vision] Ошибка ${vm.id}:`, err.status, err.message);
                if (err.status === 401) throw err;
            }
        }
    }

    // 2. Текстовые модели Groq (если Vision не сработал — убираем требование смотреть картинку,
    // чтобы GPT-OSS 120B решила задачу по выделенному тексту и контексту со страницы)
    const textOnlyPrompt = image
        ? prompt
            .replace(/Проанализируй прикрепленный скриншот экрана и выделенный пользователем фрагмент\./g, 'Реши текстовое задание ниже.')
            .replace(/1\.\s*Внимательно изучи ВЕСЬ скриншот:[^\n]+\n?/g, '')
        : prompt;

    for (const tm of GROQ_TEXT_MODELS) {
        try {
            console.log(`[Groq Text] Пробуем ${tm.id}`);
            const answer = await executeGroqCall(tm.id, groqKey, textOnlyPrompt, null);
            return {
                success: true,
                answer,
                model: tm.id,
                modelDisplayName: tm.shortName
            };
        } catch (err) {
            lastError = err;
            console.warn(`[Groq Text] Ошибка ${tm.id}:`, err.status, err.message);
            if (err.status === 401) throw err;
        }
    }

    throw lastError || new Error("Все модели Groq недоступны.");
}

// ==================== ОБРАБОТЧИК СООБЩЕНИЙ ====================
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "askGemini") {
        let geminiKeys = [];
        if (Array.isArray(request.apiKeys) && request.apiKeys.length > 0) {
            geminiKeys = request.apiKeys.map(k => (k || "").trim()).filter(Boolean);
        } else if (request.apiKey) {
            geminiKeys = [request.apiKey.trim()];
        }

        const groqKey = (request.groqApiKey || "").trim();
        const providerMode = request.providerMode || "auto-hybrid";

        if (geminiKeys.length === 0 && !groqKey) {
            sendResponse({ error: true, code: "MISSING_KEY", message: "Укажите ключ Gemini или Groq в настройках." });
            return false;
        }

        const prompt = request.prompt;
        const image = request.image;

        (async () => {
            try {
                // Режим 1: Только Groq
                if (providerMode === "groq-only") {
                    if (!groqKey) throw new Error("Не указан API-ключ Groq (gsk_...) в настройках.");
                    const res = await runGroqChain(groqKey, prompt, image);
                    sendResponse(res);
                    return;
                }

                // Режим 2: Только Gemini
                if (providerMode === "gemini-only") {
                    if (geminiKeys.length === 0) throw new Error("Не указан API-ключ Gemini в настройках.");
                    const res = await runGeminiChain(geminiKeys, prompt, image);
                    sendResponse(res);
                    return;
                }

                // Режим 3: Сначала Groq -> потом Gemini
                if (providerMode === "groq-first") {
                    if (groqKey) {
                        try {
                            const res = await runGroqChain(groqKey, prompt, image);
                            sendResponse(res);
                            return;
                        } catch (groqErr) {
                            console.warn("[Router] Groq упал, переключаемся на Gemini:", groqErr.message);
                            if (geminiKeys.length === 0) throw groqErr;
                        }
                    }
                    const res = await runGeminiChain(geminiKeys, prompt, image);
                    sendResponse(res);
                    return;
                }

                // Режим 4 (по умолчанию): Авто — сначала Gemini (умные), при 503/429 мгновенно Groq
                if (geminiKeys.length > 0) {
                    try {
                        const res = await runGeminiChain(geminiKeys, prompt, image);
                        sendResponse(res);
                        return;
                    } catch (geminiErr) {
                        console.warn("[Router] Gemini перегружен/ошибка, переключаемся на Groq:", geminiErr.message);
                        if (!groqKey) throw geminiErr;
                    }
                }

                const res = await runGroqChain(groqKey, prompt, image);
                sendResponse(res);
            } catch (finalErr) {
                sendResponse({
                    error: true,
                    status: finalErr?.status,
                    code: finalErr?.code || "ALL_FAILED",
                    message: finalErr?.message || "Не удалось получить ответ ни от одной модели."
                });
            }
        })();

        return true;
    }

    if (request.action === "captureTab") {
        const winId = (sender && sender.tab && sender.tab.windowId) ? sender.tab.windowId : null;
        chrome.tabs.captureVisibleTab(winId, { format: "jpeg", quality: 82 }, (dataUrl) => {
            if (chrome.runtime.lastError) {
                if (winId !== null) {
                    chrome.tabs.captureVisibleTab(null, { format: "jpeg", quality: 82 }, (dataUrlFallback) => {
                        if (chrome.runtime.lastError || !dataUrlFallback) {
                            sendResponse({
                                error: true,
                                message: "Не удалось сделать снимок экрана: " + (chrome.runtime.lastError?.message || "вкладка недоступна")
                            });
                        } else {
                            sendResponse({ image: dataUrlFallback });
                        }
                    });
                    return;
                }
                sendResponse({
                    error: true,
                    message: "Не удалось сделать снимок экрана: " + chrome.runtime.lastError.message
                });
            } else if (!dataUrl) {
                sendResponse({
                    error: true,
                    message: "Снимок экрана пуст или не поддерживается на данной странице."
                });
            } else {
                sendResponse({ image: dataUrl });
            }
        });
        return true;
    }
});