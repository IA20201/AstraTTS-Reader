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
  };

  const modeBadge = document.getElementById('modeBadge');
  const speedVal  = document.getElementById('speedVal');
  const volumeVal = document.getElementById('volumeVal');
  const status    = document.getElementById('status');

  await initForm(el);
  speedVal.textContent  = el.speed.value;
  volumeVal.textContent = el.volume.value;
  updateBadge(el.apiMode.value);

  el.speed.oninput  = () => { speedVal.textContent = el.speed.value; };
  el.volume.oninput = () => { volumeVal.textContent = el.volume.value; };

  el.apiMode.onchange = () => {
    const mode = el.apiMode.value;
    toggleModeFields(mode);
    updateBadge(mode);
    if (mode === 'astra' && el.apiUrl.value.includes('/v1')) {
      el.apiUrl.value = el.apiUrl.value.replace(/\/v1\/?$/, '');
    } else if (mode === 'openai' && !el.apiUrl.value.includes('/v1')) {
      el.apiUrl.value = el.apiUrl.value.replace(/\/+$/, '') + '/v1';
    }
  };

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

  // ── 运行状态显示 ──
  const runtimeSection = document.getElementById('runtimeSection');
  const runtimeInfo = document.getElementById('runtimeInfo');

  function updateRuntime() {
    chrome.runtime.sendMessage({ action: 'get-runtime-status' }, (resp) => {
      if (chrome.runtime.lastError || !resp || !resp.data) {
        runtimeSection.style.display = 'none';
        return;
      }
      const d = resp.data;
      runtimeSection.style.display = '';
      runtimeInfo.innerHTML = [
        d.avatarId && `音色: <b>${d.avatarId}</b> / ${d.referenceId}`,
        d.speed && `语速: ${d.speed}x`,
        d.textLength && `字数: ${d.textLength}`,
        d.sampleRate && `采样率: ${d.sampleRate} Hz`,
      ].filter(Boolean).join('<br>');
    });
  }

  // 打开时刷新一次，之后每秒刷新
  updateRuntime();
  setInterval(updateRuntime, 1000);

  function updateBadge(mode) {
    modeBadge.textContent = mode === 'astra' ? 'AstraTTS' : 'OpenAI';
    modeBadge.className = 'badge ' + mode;
  }
});
