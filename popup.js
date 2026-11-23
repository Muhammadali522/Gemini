const themeToggleBtn = document.getElementById('theme-toggle');
const assistantCheckbox = document.getElementById('assistant-active');
const bypassCheckbox = document.getElementById('bypass-active');
const opacitySlider = document.getElementById('opacity-slider');
const opacityVal = document.getElementById('opacity-val');
const providerModeSelect = document.getElementById('provider-mode');
const saveBtn = document.getElementById('save');

const groqApiKeyInput = document.getElementById('groqApiKey');
const apiKeyInput1 = document.getElementById('apiKey1');
const apiKeyInput2 = document.getElementById('apiKey2');
const apiKeyInput3 = document.getElementById('apiKey3');
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

if (opacitySlider && opacityVal) {
    const handleOpacityChange = () => {
        const val = parseInt(opacitySlider.value, 10);
        opacityVal.innerText = `${val}%`;
        chrome.storage.sync.set({ windowOpacity: val });
    };
    opacitySlider.addEventListener('input', handleOpacityChange);
    opacitySlider.addEventListener('change', handleOpacityChange);
}

chrome.storage.sync.get(
    ['geminiApiKey', 'geminiApiKeys', 'groqApiKey', 'providerMode', 'theme', 'assistantEnabled', 'bypassEnabled', 'isEnabled', 'windowOpacity'],
    (data) => {
        const keys = Array.isArray(data.geminiApiKeys) ? data.geminiApiKeys : [];
        apiKeyInput1.value = keys[0] || data.geminiApiKey || '';
        apiKeyInput2.value = keys[1] || '';
        apiKeyInput3.value = keys[2] || '';
        groqApiKeyInput.value = data.groqApiKey || '';

        if (providerModeSelect) {
            providerModeSelect.value = data.providerMode || 'auto-hybrid';
        }

        assistantCheckbox.checked = data.assistantEnabled !== undefined ? data.assistantEnabled : (data.isEnabled !== false);
        bypassCheckbox.checked = data.bypassEnabled !== undefined ? data.bypassEnabled : (data.isEnabled !== false);

        const savedOpacity = data.windowOpacity !== undefined ? data.windowOpacity : 25;
        if (opacitySlider && opacityVal) {
            opacitySlider.value = savedOpacity;
            opacityVal.innerText = `${savedOpacity}%`;
        }

        const isLight = data.theme === 'light';
        updateThemeUI(isLight);
    }
);

themeToggleBtn.addEventListener('click', () => {
    const isCurrentLight = document.documentElement.classList.contains('light');
    const newTheme = isCurrentLight ? 'dark' : 'light';
    chrome.storage.sync.set({ theme: newTheme }, () => {
        updateThemeUI(newTheme === 'light');
    });
});

[apiKeyInput1, groqApiKeyInput].forEach(el => {
    el.addEventListener('input', () => el.classList.remove('input-error'));
});

saveBtn.addEventListener('click', () => {
    const k1 = apiKeyInput1.value.trim();
    const k2 = apiKeyInput2.value.trim();
    const k3 = apiKeyInput3.value.trim();
    const groqKey = groqApiKeyInput.value.trim();
    const providerMode = providerModeSelect ? providerModeSelect.value : 'auto-hybrid';

    if (!k1 && !groqKey) {
        apiKeyInput1.classList.add('input-error');
        groqApiKeyInput.classList.add('input-error');
        statusDiv.style.color = '#ef4444';
        statusDiv.innerText = 'Укажите хотя бы ключ Gemini #1 или Groq!';
        return;
    }

    const assistantEnabled = assistantCheckbox.checked;
    const bypassEnabled = bypassCheckbox.checked;
    const windowOpacity = opacitySlider ? parseInt(opacitySlider.value, 10) : 25;

    const validGeminiKeys = [k1, k2, k3].filter((k, idx, arr) => k && arr.indexOf(k) === idx);

    chrome.storage.sync.set({
        geminiApiKey: k1,
        geminiApiKeys: validGeminiKeys,
        groqApiKey: groqKey,
        providerMode: providerMode,
        assistantEnabled: assistantEnabled,
        bypassEnabled: bypassEnabled,
        isEnabled: bypassEnabled,
        windowOpacity: windowOpacity
    }, () => {
        statusDiv.style.color = '#34a853';
        statusDiv.innerText = 'Настройки сохранены!';
        setTimeout(() => {
            statusDiv.innerText = '';
            window.close();
        }, 700);
    });
});