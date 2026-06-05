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
  streamingMode: false,
  downloadMode: false,
  outputVolume: 1.0
};

async function loadSettings() {
  return new Promise((resolve) => {
    chrome.storage.local.get(
      ['apiMode', 'apiUrl', 'apiKey', 'speechSpeed', 'voice', 'model', 'avatarId', 'referenceId', 'streamingMode', 'downloadMode', 'outputVolume'],
      (data) => {
        // 迁移旧配置
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
          streamingMode: data.streamingMode ?? DEFAULT_SETTINGS.streamingMode,
          downloadMode: data.downloadMode ?? DEFAULT_SETTINGS.downloadMode,
          outputVolume: data.outputVolume ?? DEFAULT_SETTINGS.outputVolume
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
 * 根据 API 模式构建请求参数
 */
function buildRequest(settings, text, format = 'wav') {
  const base = settings.apiUrl.replace(/\/+$/, '');
  if (settings.apiMode === 'astra') {
    return {
      endpoint: base + '/api/tts/predict',
      payload: {
        text,
        speed: settings.speechSpeed,
        ...(settings.avatarId && { avatarId: settings.avatarId }),
        ...(settings.referenceId && { referenceId: settings.referenceId })
      },
      headers: { 'Content-Type': 'application/json' }
    };
  } else {
    return {
      endpoint: base + '/audio/speech',
      payload: {
        model: settings.model,
        input: text,
        voice: settings.voice,
        response_format: format,
        speed: settings.speechSpeed
      },
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${settings.apiKey}`
      }
    };
  }
}

/**
 * 构建流式请求 (AstraTTS 用 GET+query，OpenAI 用 POST)
 */
function buildStreamRequest(settings, text) {
  const base = settings.apiUrl.replace(/\/+$/, '');
  if (settings.apiMode === 'astra') {
    const p = new URLSearchParams({ text, speed: settings.speechSpeed });
    if (settings.avatarId) p.set('avatarId', settings.avatarId);
    if (settings.referenceId) p.set('referenceId', settings.referenceId);
    return {
      endpoint: base + '/api/tts/predict-stream?' + p.toString(),
      method: 'GET',
      payload: null,
      headers: {}
    };
  } else {
    return {
      endpoint: base + '/audio/speech',
      method: 'POST',
      payload: {
        model: settings.model,
        input: text,
        voice: settings.voice,
        response_format: 'pcm',
        speed: settings.speechSpeed
      },
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${settings.apiKey}`
      }
    };
  }
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
  if (elements.streamingMode) elements.streamingMode.checked = s.streamingMode;
  if (elements.downloadMode)  elements.downloadMode.checked = s.downloadMode;
  if (elements.volume)   elements.volume.value = s.outputVolume;
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
}

/**
 * 从表单读取设置
 */
function readForm(elements) {
  return {
    apiMode:    elements.apiMode?.value || 'astra',
    apiUrl:     (elements.apiUrl?.value || '').trim(),
    apiKey:     (elements.apiKey?.value || '').trim(),
    speechSpeed: parseFloat(elements.speed?.value || 1.0),
    voice:      (elements.voice?.value || '').trim(),
    model:      (elements.model?.value || '').trim(),
    avatarId:   (elements.avatarId?.value || '').trim(),
    referenceId:(elements.referenceId?.value || '').trim(),
    streamingMode: elements.streamingMode?.checked || false,
    downloadMode:  elements.downloadMode?.checked || false,
    outputVolume:  parseFloat(elements.volume?.value || 1.0)
  };
}
