// ==================== КОНФИГУРАЦИЯ МОДЕЛЕЙ ====================
const MODEL_CONFIG = {
    "gemini-3.8-flash": {
        id: "gemini-3.8-flash",
        displayName: "Gemini 3.8 Flash",
        shortName: "3.8 Flash",
        family: "flash"
    },
    "gemini-3.7-flash": {
        id: "gemini-3.7-flash",
        displayName: "Gemini 3.7 Flash",
        shortName: "3.7 Flash",
        family: "flash"
    },
    "gemini-3.6-flash": {
        id: "gemini-3.6-flash",
        displayName: "Gemini 3.6 Flash",
        shortName: "3.6 Flash",
        family: "flash"
    },
    "gemini-3.5-flash-lite": {
        id: "gemini-3.5-flash-lite",
        displayName: "Gemini 3.5 Flash Lite",
        shortName: "3.5 Lite",
        family: "lite"
    },
    "gemini-3.1-flash-lite": {
        id: "gemini-3.1-flash-lite",
        displayName: "Gemini 3.1 Flash Lite",
        shortName: "3.1 Lite",
        family: "lite"
    }
};

// Учебная personality Gemini для ученика 8 класса: обязательное решение без шаблонов и плейсхолдеров
const SYSTEM_INSTRUCTION_TEXT = "Ты — спокойный, точный учебный помощник для ученика 8 класса. Ты САМ решаешь задания и даешь готовые точные ответы. КАТЕГОРИЧЕСКИ ЗАПРЕЩЕНО давать шаблонные заготовки, плейсхолдеры в скобках вроде '[Укажи ответ]' или общие советы 'внимательно прочитай условие'. На первой строке напиши: **Ответ: [конкретный ответ или выбранный вариант]**, ниже — 1-2 строки понятного решения. Строго БЕЗ эмодзи. Без $ и LaTeX, используй: ×, :, √, ², ³, °, ->.";

function classifyError(status, serverMessage) {
    switch (status) {
        case 400:
            return { code: "BAD_REQUEST", message: "Некорректный запрос к Gemini API (код 400)." };
        case 401:
            return { code: "INVALID_KEY", message: "Неверный API-ключ Gemini. Проверьте ключ в настройках (код 401)." };
        case 403:
            return { code: "FORBIDDEN", message: "Доступ к модели запрещен. Проверьте настройки API-ключа (код 403)." };
        case 404:
            return { code: "NOT_FOUND", message: "Модель не найдена в Gemini API (код 404)." };
        case 429:
            return { code: "RATE_LIMIT", message: "Превышен лимит запросов к Gemini API (код 429)." };
        case 500:
            return { code: "SERVER_ERROR", message: "Внутренняя ошибка серверов Google Gemini (код 500)." };
        case 502:
        case 503:
        case 504:
            return { code: "SERVICE_UNAVAILABLE", message: `Сервер Gemini временно недоступен или перегружен (код ${status}).` };
        default:
            if (serverMessage === "TIMEOUT") {
                return { code: "TIMEOUT", message: "Превышено время ожидания ответа от сервера Gemini." };
            }
            if (serverMessage === "NETWORK_ERROR") {
                return { code: "NETWORK_ERROR", message: "Ошибка сети. Проверьте подключение к интернету." };
            }
            return { code: "API_ERROR", message: serverMessage || "Не удалось получить ответ от Gemini API. Проверьте соединение." };
    }
}

async function executeApiCall(modelName, apiKey, prompt, imageBase64, isImageRequest) {
    const timeoutMs = isImageRequest ? 45000 : 30000;
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

    const payload = JSON.stringify({
        systemInstruction: {
            parts: [{ text: SYSTEM_INSTRUCTION_TEXT }]
        },
        contents: [{ parts }],
        generationConfig: {
            temperature: 0.2,
            maxOutputTokens: 1024
        }
    });

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${apiKey}`;

    try {
        if (isImageRequest) {
            console.log(`[Gemini] Запрос с изображением начат для модели ${modelName}`);
        }

        const response = await fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: payload,
            signal: controller.signal
        });

        clearTimeout(timeoutTimer);

        if (!response.ok) {
            const status = response.status;
            let errorData = null;
            try {
                errorData = await response.json();
            } catch (e) {}

            const serverMsg = errorData?.error?.message;
            const classified = classifyError(status, serverMsg);
            const err = new Error(classified.message);
            err.status = status;
            err.code = classified.code;
            err.serverMessage = serverMsg;
            throw err;
        }

        const data = await response.json();
        return { data, modelName };
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

function extractText(data) {
    if (data?.promptFeedback?.blockReason) {
        return `Запрос заблокирован фильтром безопасности Gemini (${data.promptFeedback.blockReason}).`;
    }
    const candidate = data?.candidates?.[0];
    if (!candidate) {
        return "Модель не вернула ответ.";
    }
    if (candidate.finishReason === "SAFETY") {
        return "Ответ заблокирован фильтром безопасности.";
    }
    const text = candidate.content?.parts?.map(p => p.text).filter(Boolean).join("\n");
    return text || "Модель вернула пустой ответ.";
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "askGemini") {
        const apiKey = request.apiKey;
        if (!apiKey) {
            sendResponse({ error: true, code: "MISSING_KEY", message: "API-ключ Gemini не указан в настройках." });
            return false;
        }

        let mode = request.modelMode || "auto-flash";
        if (mode === "auto") {
            mode = "auto-flash";
        }

        const prompt = request.prompt;
        const image = request.image;
        const isImage = !!image;

        // Построение цепочки моделей в строгом соответствии с требованиями:
        // Auto Flash: 3.8 → 3.7 → 3.6 → снова 3.8
        // Auto Flash Lite: 3.5 Lite → 3.1 Lite → снова 3.5 Lite
        // Ручные режимы: ровно одна выбранная модель без каскада
        let chain = [];
        let isAuto = false;

        if (request.isVerification || mode === "smart-verify") {
            // Для сверки/проверки ответов: самая умная модель в бесплатном тарифе Gemini API (Gemini 3.8 Flash)
            // с каскадным переключением на 3.7 Flash и 3.6 Flash при исчерпании лимитов
            chain = ["gemini-3.8-flash", "gemini-3.7-flash", "gemini-3.6-flash"];
            isAuto = true;
        } else if (mode === "auto-flash") {
            chain = ["gemini-3.8-flash", "gemini-3.7-flash", "gemini-3.6-flash", "gemini-3.8-flash"];
            isAuto = true;
        } else if (mode === "auto-flash-lite") {
            chain = ["gemini-3.5-flash-lite", "gemini-3.1-flash-lite", "gemini-3.5-flash-lite"];
            isAuto = true;
        } else if (MODEL_CONFIG[mode]) {
            chain = [mode];
            isAuto = false;
        } else {
            // Режим по умолчанию, если значение неизвестно
            chain = ["gemini-3.8-flash", "gemini-3.7-flash", "gemini-3.6-flash", "gemini-3.8-flash"];
            isAuto = true;
        }

        (async () => {
            let lastError = null;

            for (let i = 0; i < chain.length; i++) {
                const currentModel = chain[i];
                const modelInfo = MODEL_CONFIG[currentModel] || { displayName: currentModel, shortName: currentModel };

                try {
                    console.log(`[Gemini] Запрос (${i + 1}/${chain.length}): ${currentModel}`);
                    const res = await executeApiCall(currentModel, apiKey, prompt, image, isImage);
                    const answer = extractText(res.data);

                    // Формируем понятное имя модели для интерфейса
                    let displayBadge = modelInfo.displayName;
                    if (isAuto) {
                        displayBadge = i === 0 ? `${modelInfo.shortName} (Auto)` : `${modelInfo.shortName} (Каскад)`;
                    }

                    sendResponse({
                        success: true,
                        answer: answer,
                        model: currentModel,
                        modelDisplayName: displayBadge,
                        wasFallback: isAuto && i > 0
                    });
                    return; // После успешного ответа останавливаемся!
                } catch (err) {
                    lastError = err;
                    console.warn(`[Gemini] Ошибка модели ${currentModel} (попытка ${i + 1}/${chain.length}):`, err.status || err.code, err.message);

                    // Для ручного выбора — сразу возвращаем ошибку без fallback
                    if (!isAuto) {
                        sendResponse({
                            error: true,
                            status: err.status,
                            code: err.code || "API_ERROR",
                            message: err.message
                        });
                        return;
                    }

                    // Фатальные ошибки конфигурации пользователя (неверный ключ, запрет доступа, ошибка синтаксиса)
                    const isFatal = (err.status === 400 || err.status === 401 || err.status === 403);
                    if (isFatal) {
                        sendResponse({
                            error: true,
                            status: err.status,
                            code: err.code || "FATAL_ERROR",
                            message: err.message
                        });
                        return;
                    }

                    // При quota (429) / rate-limit / временной ошибке (500, 502, 503, 504, timeout, network, 404)
                    // переходим к следующей модели в цепочке. Цикл не бесконечен (ровно chain.length попыток).
                }
            }

            // Если все попытки в цепочке завершились ошибкой
            sendResponse({
                error: true,
                status: lastError?.status,
                code: lastError?.code || "CHAIN_EXHAUSTED",
                message: lastError?.message || "Все модели в цепочке временно недоступны. Попробуйте позже."
            });
        })();

        return true; // Асинхронный ответ
    }

    if (request.action === "captureTab") {
        const winId = (sender && sender.tab && sender.tab.windowId) ? sender.tab.windowId : null;
        chrome.tabs.captureVisibleTab(winId, { format: "jpeg", quality: 75 }, (dataUrl) => {
            if (chrome.runtime.lastError) {
                // Если с winId возникла ошибка, пробуем с текущим активным окном (null)
                if (winId !== null) {
                    chrome.tabs.captureVisibleTab(null, { format: "jpeg", quality: 75 }, (dataUrlFallback) => {
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