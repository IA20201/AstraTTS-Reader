// AstraTTS Reader — offscreen document
// 负责：fetch 流式 API + PCM 音频播放（Service Worker 缺少 Audio API）

let audioCtx = null;
let gainNode = null;
let nextStartTime = 0;
let stopRequested = false;

// ── 消息入口 ──

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.action === 'play') {
    handlePlay(msg.settings, msg.text);
  } else if (msg.action === 'stop') {
    stopAll();
  }
});

// ── 主流程：流式播放 ──

async function handlePlay(settings, text) {
  stopRequested = false;
  const base = settings.apiUrl.replace(/\/+$/, '');
  const volume = settings.outputVolume ?? 1.0;

  try {
    if (settings.apiMode === 'astra') {
      // AstraTTS: GET 流式 Float32 PCM
      const params = new URLSearchParams({
        text,
        speed: settings.speechSpeed,
        ...(settings.avatarId && { avatarId: settings.avatarId }),
        ...(settings.referenceId && { referenceId: settings.referenceId })
      });
      const resp = await fetch(base + '/api/tts/predict-stream?' + params.toString());
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const sampleRate = parseInt(resp.headers.get('X-Audio-Sample-Rate')) || 32000;
      await playFloat32PCM(resp, sampleRate, volume);
    } else {
      // OpenAI: POST Int16 PCM
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
      await playInt16PCM(resp, 24000, volume);
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

// ── Float32 PCM 播放（AstraTTS） ──

async function playFloat32PCM(response, sampleRate, volume) {
  if (audioCtx && audioCtx.state !== 'closed') audioCtx.close();
  audioCtx = new AudioContext({ sampleRate });
  gainNode = audioCtx.createGain();
  gainNode.gain.value = volume;
  gainNode.connect(audioCtx.destination);

  nextStartTime = audioCtx.currentTime;
  const reader = response.body.getReader();
  let residual = new Uint8Array(0);

  while (!stopRequested) {
    const { value, done } = await reader.read();
    if (done) break;
    if (!value) continue;

    let combined = mergeBytes(residual, value);
    const alignedLen = combined.length - (combined.length % 4);
    residual = combined.slice(alignedLen);
    if (alignedLen === 0) continue;

    const sampleCount = alignedLen / 4;
    const floatData = new Float32Array(sampleCount);
    const view = new DataView(combined.buffer, combined.byteOffset, alignedLen);
    for (let i = 0; i < sampleCount; i++) {
      floatData[i] = view.getFloat32(i * 4, true);
    }
    scheduleBuffer(floatData, sampleRate);
  }

  await waitForPlaybackEnd();
}

// ── Int16 PCM 播放（OpenAI） ──

async function playInt16PCM(response, sampleRate, volume) {
  if (audioCtx && audioCtx.state !== 'closed') audioCtx.close();
  audioCtx = new AudioContext({ sampleRate });
  gainNode = audioCtx.createGain();
  gainNode.gain.value = volume;
  gainNode.connect(audioCtx.destination);

  nextStartTime = audioCtx.currentTime;
  const reader = response.body.getReader();
  let residual = new Uint8Array(0);

  while (!stopRequested) {
    const { value, done } = await reader.read();
    if (done) break;
    if (!value) continue;

    let combined = mergeBytes(residual, value);
    const alignedLen = combined.length - (combined.length % 2);
    residual = combined.slice(alignedLen);
    if (alignedLen === 0) continue;

    const sampleCount = alignedLen / 2;
    const floatData = new Float32Array(sampleCount);
    const view = new DataView(combined.buffer, combined.byteOffset, alignedLen);
    for (let i = 0; i < sampleCount; i++) {
      floatData[i] = view.getInt16(i * 2, true) / 32768;
    }
    scheduleBuffer(floatData, sampleRate);
  }

  await waitForPlaybackEnd();
}

// ── 工具函数 ──

function mergeBytes(a, b) {
  if (a.length === 0) return b;
  const c = new Uint8Array(a.length + b.length);
  c.set(a);
  c.set(b, a.length);
  return c;
}

function scheduleBuffer(floatData, sampleRate) {
  if (!audioCtx) return;
  const buf = audioCtx.createBuffer(1, floatData.length, sampleRate);
  buf.getChannelData(0).set(floatData);

  const src = audioCtx.createBufferSource();
  src.buffer = buf;
  src.connect(gainNode);

  const now = audioCtx.currentTime;
  if (nextStartTime < now) nextStartTime = now;
  src.start(nextStartTime);
  nextStartTime += buf.duration;
  src.onended = () => src.disconnect();
}

function waitForPlaybackEnd() {
  return new Promise(resolve => {
    const check = () => {
      if (stopRequested || !audioCtx || audioCtx.currentTime >= nextStartTime - 0.1) {
        resolve();
      } else {
        setTimeout(check, 100);
      }
    };
    check();
  });
}

function stopAll() {
  stopRequested = true;
  if (audioCtx && audioCtx.state !== 'closed') {
    audioCtx.close();
    audioCtx = null;
  }
}
