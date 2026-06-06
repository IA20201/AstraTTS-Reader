// AstraTTS Reader — offscreen document
// 负责：fetch 流式 API + PCM 音频播放（Service Worker 缺少 Audio API）

let audioCtx = null;
let gainNode = null;
let nextStartTime = 0;
let stopRequested = false;
let isFirstBuffer = true;

// ── 消息入口 ──

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.action === 'play') {
    handlePlay(msg.settings, msg.text);
  } else if (msg.action === 'stop') {
    stopAll();
  }
});

// ── AudioContext 管理 ──

async function closeAudioCtx() {
  if (audioCtx && audioCtx.state !== 'closed') {
    try { await audioCtx.close(); } catch (e) { /* ignore */ }
  }
  audioCtx = null;
  gainNode = null;
}

function createAudioCtx(sampleRate, volume) {
  audioCtx = new AudioContext({ sampleRate });
  gainNode = audioCtx.createGain();
  gainNode.gain.value = volume;
  gainNode.connect(audioCtx.destination);
  nextStartTime = audioCtx.currentTime + 0.15;
  isFirstBuffer = true;
}

// ── 主流程 ──

async function handlePlay(settings, text) {
  stopRequested = false;
  const base = settings.apiUrl.replace(/\/+$/, '');
  const volume = settings.outputVolume ?? 1.0;

  try {
    if (settings.apiMode === 'astra') {
      const params = new URLSearchParams({
        text,
        speed: settings.speechSpeed,
        ...(settings.avatarId && { avatarId: settings.avatarId }),
        ...(settings.referenceId && { referenceId: settings.referenceId })
      });
      const resp = await fetch(base + '/api/tts/predict-stream?' + params.toString());
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const sampleRate = parseInt(resp.headers.get('X-Audio-Sample-Rate')) || 32000;
      chrome.runtime.sendMessage({
        action: 'runtime-status',
        data: {
          apiMode: 'astra',
          avatarId: settings.avatarId || '(default)',
          referenceId: settings.referenceId || '(default)',
          speed: settings.speechSpeed,
          volume, sampleRate,
          textLength: text.length
        }
      });
      await playPCM(resp, sampleRate, volume, true);
    } else {
      const resp = await fetch(base + '/audio/speech', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${settings.apiKey || 'not-needed'}`
        },
        body: JSON.stringify({
          model: settings.model || 'tts-1',
          input: text,
          voice: settings.voice || 'default',
          response_format: 'pcm',
          speed: settings.speechSpeed
        })
      });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      await playPCM(resp, 24000, volume, false);
    }
  } catch (e) {
    if (!stopRequested) {
      console.error('Stream error:', e);
      chrome.runtime.sendMessage({ action: 'play-error', error: e.message });
    }
    return;
  }

  if (!stopRequested) {
    chrome.runtime.sendMessage({ action: 'chunk-done' });
  }
}

// ── 通用 PCM 流式播放 ──

async function playPCM(response, sampleRate, volume, isFloat32) {
  await closeAudioCtx();
  createAudioCtx(sampleRate, volume);

  const bytesPerSample = isFloat32 ? 4 : 2;
  const minBytes = sampleRate * bytesPerSample * 0.3;
  const reader = response.body.getReader();
  let residual = new Uint8Array(0);

  while (!stopRequested) {
    const { value, done } = await reader.read();
    if (done) break;
    if (!value) continue;

    residual = mergeBytes(residual, value);
    if (residual.length < minBytes) continue;

    const alignedLen = residual.length - (residual.length % bytesPerSample);
    if (alignedLen === 0) continue;

    const chunk = new Uint8Array(residual.buffer, residual.byteOffset, alignedLen);
    residual = residual.slice(alignedLen);

    scheduleSamples(chunk, sampleRate, isFloat32);
  }

  // 处理剩余
  if (!stopRequested && residual.length >= bytesPerSample) {
    const alignedLen = residual.length - (residual.length % bytesPerSample);
    if (alignedLen > 0) {
      const chunk = new Uint8Array(residual.buffer, residual.byteOffset, alignedLen);
      scheduleSamples(chunk, sampleRate, isFloat32);
    }
  }

  await waitForPlaybackEnd();
}

function scheduleSamples(chunk, sampleRate, isFloat32) {
  const bytesPerSample = isFloat32 ? 4 : 2;
  const sampleCount = chunk.length / bytesPerSample;
  const floatData = new Float32Array(sampleCount);
  const view = new DataView(chunk.buffer, chunk.byteOffset, chunk.length);

  if (isFloat32) {
    for (let i = 0; i < sampleCount; i++) floatData[i] = view.getFloat32(i * 4, true);
  } else {
    for (let i = 0; i < sampleCount; i++) floatData[i] = view.getInt16(i * 2, true) / 32768;
  }

  scheduleBuffer(floatData, sampleRate);
}

// ── Buffer 调度 ──

function scheduleBuffer(floatData, sampleRate) {
  if (!audioCtx || stopRequested) return;

  const buf = audioCtx.createBuffer(1, floatData.length, sampleRate);
  const channelData = buf.getChannelData(0);
  channelData.set(floatData);

  if (isFirstBuffer) {
    const fadeSamples = Math.min(Math.floor(sampleRate * 0.01), floatData.length);
    for (let i = 0; i < fadeSamples; i++) {
      channelData[i] *= i / fadeSamples;
    }
    isFirstBuffer = false;
  }

  const src = audioCtx.createBufferSource();
  src.buffer = buf;
  src.connect(gainNode);

  const now = audioCtx.currentTime;
  if (nextStartTime < now) nextStartTime = now;
  src.start(nextStartTime);
  nextStartTime += buf.duration;
  src.onended = () => src.disconnect();
}

// ── 等待播放结束 ──

function waitForPlaybackEnd() {
  return new Promise(resolve => {
    const check = () => {
      if (stopRequested || !audioCtx || audioCtx.currentTime >= nextStartTime) {
        resolve();
      } else {
        setTimeout(check, 50);
      }
    };
    check();
  });
}

// ── 停止播放（带淡出） ──

function stopAll() {
  stopRequested = true;
  if (gainNode && audioCtx && audioCtx.state !== 'closed') {
    try {
      gainNode.gain.linearRampToValueAtTime(0, audioCtx.currentTime + 0.05);
    } catch (e) { /* ignore */ }
    const ctx = audioCtx;
    setTimeout(() => { ctx.close().catch(() => {}); }, 60);
    audioCtx = null;
    gainNode = null;
  }
}

// ── 工具 ──

function mergeBytes(a, b) {
  if (a.length === 0) return b;
  if (b.length === 0) return a;
  const c = new Uint8Array(a.length + b.length);
  c.set(a);
  c.set(b, a.length);
  return c;
}
