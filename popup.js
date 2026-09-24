const themeToggleBtn = document.getElementById('theme-toggle');
const assistantCheckbox = document.getElementById('assistant-active');
const bypassCheckbox = document.getElementById('bypass-active');
const opacitySlider = document.getElementById('opacity-slider');
const opacityVal = document.getElementById('opacity-val');
const modelModeSelect = document.getElementById('model-mode');
const saveBtn = document.getElementById('save');
const apiKeyInput = document.getElementById('apiKey');
const statusDiv = document.getElementById('status');

function updateThemeUI(isLight) {
    if (isLight) {
        document.documentElement.classList.add('light');
        themeToggleBtn.innerText = '☀️';
    } else {
        document.documentElement.classList.remove('light');
        themeToggleBtn.innerText = '🌙';
    }
}

// Обновление индикатора слайдера прозрачности с мгновенным сохранением в storage
if (opacitySlider && opacityVal) {
    const handleOpacityChange = () => {
        const val = parseInt(opacitySlider.value, 10);
        opacityVal.innerText = `${val}%`;
        chrome.storage.sync.set({ windowOpacity: val });
    };
    opacitySlider.addEventListener('input', handleOpacityChange);
    opacitySlider.addEventListener('change', handleOpacityChange);
}

chrome.storage.sync.get(['geminiApiKey', 'theme', 'assistantEnabled', 'bypassEnabled', 'isEnabled', 'modelMode', 'windowOpacity'], (data) => {
    if (data.geminiApiKey) {
        apiKeyInput.value = data.geminiApiKey;
    }

    // Независимые режимы (с обратной совместимостью для старых версий)
    assistantCheckbox.checked = data.assistantEnabled !== undefined ? data.assistantEnabled : (data.isEnabled !== false);
    bypassCheckbox.checked = data.bypassEnabled !== undefined ? data.bypassEnabled : (data.isEnabled !== false);

    // Уровень прозрачности (по умолчанию 25% — оптимум для невидимости со стороны)
    const savedOpacity = data.windowOpacity !== undefined ? data.windowOpacity : 25;
    if (opacitySlider && opacityVal) {
        opacitySlider.value = savedOpacity;
        opacityVal.innerText = `${savedOpacity}%`;
    }

    // Нормализация выбора модели (7 вариантов: 5 ручных моделей + 2 Auto режима)
    const validModes = [
        "gemini-3.8-flash",
        "gemini-3.7-flash",
        "gemini-3.6-flash",
        "gemini-3.5-flash-lite",
        "gemini-3.1-flash-lite",
        "auto-flash",
        "auto-flash-lite"
    ];
    let mode = data.modelMode || "gemini-3.8-flash";
    if (mode === "auto") {
        mode = "auto-flash";
    }
    if (!validModes.includes(mode)) {
        mode = "auto-flash";
    }
    modelModeSelect.value = mode;

    const isLight = data.theme === 'light';
    updateThemeUI(isLight);
});

themeToggleBtn.addEventListener('click', () => {
    const isCurrentLight = document.documentElement.classList.contains('light');
    const newTheme = isCurrentLight ? 'dark' : 'light';
    chrome.storage.sync.set({ theme: newTheme }, () => {
        updateThemeUI(newTheme === 'light');
    });
});

saveBtn.addEventListener('click', () => {
    const key = apiKeyInput.value.trim();
    const assistantEnabled = assistantCheckbox.checked;
    const bypassEnabled = bypassCheckbox.checked;
    const modelMode = modelModeSelect.value;
    const windowOpacity = opacitySlider ? parseInt(opacitySlider.value, 10) : 25;

    chrome.storage.sync.set({
        geminiApiKey: key,
        assistantEnabled: assistantEnabled,
        bypassEnabled: bypassEnabled,
        isEnabled: bypassEnabled, // обратная совместимость
        modelMode: modelMode,
        windowOpacity: windowOpacity
    }, () => {
        statusDiv.innerText = 'Настройки применены!';
        setTimeout(() => { statusDiv.innerText = ''; window.close(); }, 800);
    });
});