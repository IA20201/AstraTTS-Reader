// AstraTTS Reader — popup (Chrome MV3)

document.addEventListener('DOMContentLoaded', async () => {
  const el = {
    apiMode:  document.getElementById('apiMode'),
    apiUrl:   document.getElementById('apiUrl'),
    apiKey:   document.getElementById('apiKey'),
    voice:    document.getElementById('voice'),
    speed:    document.getElementById('speed'),
    volume:   document.getElementById('volume'),
    avatarId: document.getElementById('avatarId'),
    referenceId: document.getElementById('referenceId'),
    streamingMode: document.getElementById('streamingMode'),
    downloadMode:  document.getElementById('downloadMode'),
  };

  const modeBadge  = document.getElementById('modeBadge');
  const speedVal   = document.getElementById('speedVal');
  const volumeVal  = document.getElementById('volumeVal');
  const status     = document.getElementById('status');

  // 初始化表单
  await initForm(el);

  // 显示当前值
  speedVal.textContent  = el.speed.value;
  volumeVal.textContent = el.volume.value;
  updateBadge(el.apiMode.value);

  // 事件绑定
  el.speed.oninput  = () => { speedVal.textContent = el.speed.value; };
  el.volume.oninput = () => { volumeVal.textContent = el.volume.value; };

  el.apiMode.onchange = () => {
    const mode = el.apiMode.value;
    toggleModeFields(mode);
    updateBadge(mode);
    // 自动调整 URL
    if (mode === 'astra' && el.apiUrl.value.includes('/v1')) {
      el.apiUrl.value = el.apiUrl.value.replace(/\/v1\/?$/, '');
    } else if (mode === 'openai' && !el.apiUrl.value.includes('/v1')) {
      el.apiUrl.value = el.apiUrl.value.replace(/\/+$/, '') + '/v1';
    }
  };

  // 流式/下载互斥 + 自动保存
  el.streamingMode.onchange = async () => {
    if (el.streamingMode.checked) el.downloadMode.checked = false;
    await chrome.storage.local.set({ streamingMode: el.streamingMode.checked, downloadMode: el.downloadMode.checked });
  };
  el.downloadMode.onchange = async () => {
    if (el.downloadMode.checked) el.streamingMode.checked = false;
    await chrome.storage.local.set({ streamingMode: el.streamingMode.checked, downloadMode: el.downloadMode.checked });
  };

  // 保存
  document.getElementById('save').onclick = async () => {
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

  function updateBadge(mode) {
    modeBadge.textContent = mode === 'astra' ? 'AstraTTS' : 'OpenAI';
    modeBadge.className = 'badge ' + mode;
  }
});
