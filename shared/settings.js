/**
 * Shared settings management (Chrome MV3)
 */

const DEFAULT_SETTINGS = {
  apiMode: 'astra',
  apiUrl: 'http://localhost:5000',
  apiKey: 'not-needed',
  voice: 'default',
  speechSpeed: 1.0,
  model: 'tts-1',
  avatarId: '',
  referenceId: '',
  outputVolume: 1.0,
  // MiMo TTS 专用
  mimoVoice: '冰糖'
};

async function loadSettings() {
  return new Promise((resolve) => {
    chrome.storage.local.get(
      ['apiMode', 'apiUrl', 'apiKey', 'speechSpeed', 'voice', 'model', 'avatarId', 'referenceId', 'outputVolume', 'mimoVoice'],
      (data) => {
        if (!data.apiMode) {
          const oldUrl = data.apiUrl || '';
          data.apiMode = oldUrl.includes('/v1') ? 'openai' : 'astra';
          if (data.apiMode === 'astra') {
            data.apiUrl = oldUrl.replace(/\/v1\/?$/, '') || DEFAULT_SETTINGS.apiUrl;
          }
        }
        resolve({
          apiMode: data.apiMode || DEFAULT_SETTINGS.apiMode,
          apiUrl: data.apiUrl || DEFAULT_SETTINGS.apiUrl,
          apiKey: data.apiKey || DEFAULT_SETTINGS.apiKey,
          voice: data.voice || DEFAULT_SETTINGS.voice,
          speechSpeed: data.speechSpeed ?? DEFAULT_SETTINGS.speechSpeed,
          model: data.model || DEFAULT_SETTINGS.model,
          avatarId: data.avatarId || DEFAULT_SETTINGS.avatarId,
          referenceId: data.referenceId || DEFAULT_SETTINGS.referenceId,
          outputVolume: data.outputVolume ?? DEFAULT_SETTINGS.outputVolume,
          mimoVoice: data.mimoVoice || DEFAULT_SETTINGS.mimoVoice
        });
      }
    );
  });
}

async function saveSettings(settings) {
  return new Promise((resolve) => {
    chrome.storage.local.set(settings, resolve);
  });
}

/**
 * 初始化 UI 表单
 */
async function initForm(elements) {
  const s = await loadSettings();
  if (elements.apiMode)  elements.apiMode.value = s.apiMode;
  if (elements.apiUrl)   elements.apiUrl.value = s.apiUrl;
  if (elements.apiKey)   elements.apiKey.value = s.apiKey;
  if (elements.voice)    elements.voice.value = s.voice;
  if (elements.speed)    elements.speed.value = s.speechSpeed;
  if (elements.model)    elements.model.value = s.model;
  if (elements.avatarId) elements.avatarId.value = s.avatarId;
  if (elements.referenceId) elements.referenceId.value = s.referenceId;
  if (elements.volume)   elements.volume.value = s.outputVolume;
  if (elements.mimoVoice) elements.mimoVoice.value = s.mimoVoice;
  toggleModeFields(s.apiMode);
  return s;
}

/**
 * 根据模式显示/隐藏字段
 */
function toggleModeFields(mode) {
  document.querySelectorAll('.astra-field').forEach(el => {
    el.style.display = mode === 'astra' ? '' : 'none';
  });
  document.querySelectorAll('.openai-field').forEach(el => {
    el.style.display = mode === 'openai' ? '' : 'none';
  });
  document.querySelectorAll('.mimo-field').forEach(el => {
    el.style.display = mode === 'mimo' ? '' : 'none';
  });
}

/**
 * 从表单读取设置（只收集 UI 中实际存在的字段，避免覆盖其他页面的配置）
 */
function readForm(elements) {
  const result = {};
  const fieldMap = {
    apiMode:     el => el.value || 'astra',
    apiUrl:      el => el.value.trim(),
    apiKey:      el => el.value.trim(),
    speechSpeed: el => parseFloat(el.value || 1.0),
    voice:       el => el.value.trim(),
    model:       el => el.value.trim(),
    avatarId:    el => el.value.trim(),
    referenceId: el => el.value.trim(),
    outputVolume: el => parseFloat(el.value || 1.0),
    mimoVoice:   el => el.value.trim(),
  };
  const elMap = {
    apiMode: elements.apiMode,
    apiUrl: elements.apiUrl,
    apiKey: elements.apiKey,
    speechSpeed: elements.speed,
    voice: elements.voice,
    model: elements.model,
    avatarId: elements.avatarId,
    referenceId: elements.referenceId,
    outputVolume: elements.volume,
    mimoVoice: elements.mimoVoice,
  };
  for (const [key, fn] of Object.entries(fieldMap)) {
    if (elMap[key]) result[key] = fn(elMap[key]);
  }
  return result;
}
