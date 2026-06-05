// AstraTTS Reader — options page (Chrome MV3)

document.addEventListener('DOMContentLoaded', async () => {
  const el = {
    apiMode:  document.getElementById('apiMode'),
    apiUrl:   document.getElementById('apiUrl'),
    apiKey:   document.getElementById('apiKey'),
    voice:    document.getElementById('voice'),
    model:    document.getElementById('model'),
    speed:    document.getElementById('speed'),
    volume:   document.getElementById('volume'),
    avatarId: document.getElementById('avatarId'),
    referenceId: document.getElementById('referenceId'),
    streamingMode: document.getElementById('streamingMode'),
    downloadMode:  document.getElementById('downloadMode'),
  };

  const speedVal  = document.getElementById('speedVal');
  const volumeVal = document.getElementById('volumeVal');
  const status    = document.getElementById('status');
  const modeHint  = document.getElementById('modeHint');

  // 初始化
  await initForm(el);
  speedVal.textContent  = el.speed.value;
  volumeVal.textContent = el.volume.value;
  updateHint(el.apiMode.value);

  // 事件
  el.speed.oninput  = () => { speedVal.textContent = el.speed.value; };
  el.volume.oninput = () => { volumeVal.textContent = el.volume.value; };

  el.apiMode.onchange = () => {
    const mode = el.apiMode.value;
    toggleModeFields(mode);
    updateHint(mode);
    if (mode === 'astra' && el.apiUrl.value.includes('/v1')) {
      el.apiUrl.value = el.apiUrl.value.replace(/\/v1\/?$/, '');
    } else if (mode === 'openai' && !el.apiUrl.value.includes('/v1')) {
      el.apiUrl.value = el.apiUrl.value.replace(/\/+$/, '') + '/v1';
    }
  };

  el.streamingMode.onchange = async () => {
    if (el.streamingMode.checked) el.downloadMode.checked = false;
    await chrome.storage.local.set({ streamingMode: el.streamingMode.checked, downloadMode: el.downloadMode.checked });
  };
  el.downloadMode.onchange = async () => {
    if (el.downloadMode.checked) el.streamingMode.checked = false;
    await chrome.storage.local.set({ streamingMode: el.streamingMode.checked, downloadMode: el.downloadMode.checked });
  };

  document.getElementById('saveBtn').onclick = async () => {
    const settings = readForm(el);
    if (!settings.apiUrl) {
      status.textContent = '请输入服务地址';
      status.style.color = '#f38ba8';
      return;
    }
    await saveSettings(settings);
    status.textContent = '已保存 ✓';
    status.style.color = '#a6e3a1';
    setTimeout(() => { status.textContent = ''; }, 2000);
  };

  document.getElementById('stopBtn').onclick = () => {
    chrome.runtime.sendMessage({ action: 'stop' });
    status.textContent = '已停止';
    status.style.color = '#f9e2af';
    setTimeout(() => { status.textContent = ''; }, 1500);
  };

  function updateHint(mode) {
    modeHint.textContent = mode === 'astra'
      ? '使用 /api/tts/predict，支持音色选择'
      : '使用 /audio/speech，兼容 OpenAI 格式';
  }
});
