// AstraTTS Reader — offscreen document
// 负责：fetch API + 音频播放（Service Worker 缺少 Audio API）

let audio = null;
let audioCtx = null;
let gainNode = null;
let nextStartTime = 0;
let stopRequested = false;

// ── 消息入口 ──

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.action === 'play') {
    handlePlay(msg.settings, msg.text, msg.mode);
  } else if (msg.action === 'stop') {
    stopAll();
  }
});

// ── 主流程 ──

async function handlePlay(settings, text, mode) {
  stopRequested = false;
  
  if (mode === 'stream') {
    await playStreaming(settings, text);
  } else if (mode === 'download') {
    await downloadAudio(settings, text);
  } else {
    await playNormal(settings, text);
  }
}

// ── 标准播放 ──

async function playNormal(settings, text) {
  const { endpoint, payload, headers } = buildRequest(settings, text, 'wav');
  
  try {
    const resp = await fetch(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload)
    });
    
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    
    const blob = await resp.blob();
    const url = URL.createObjectURL(blob);
    
    await playAudioBlob(url, settings.outputVolume ?? 1.0);
    URL.revokeObjectURL(url);
    
    chrome.runtime.sendMessage({ action: 'chunk-done' });
  } catch (e) {
    if (!stopRequested) {
      console.error('Play error:', e);
      chrome.runtime.sendMessage({ action: 'play-error', error: e.message });
    }
  }
}

function playAudioBlob(url, volume) {
  return new Promise((resolve) => {
    if (audio) { audio.pause(); audio = null; }
    audio = new Audio(url);
    audio.volume = volume;
    audio.onended = () => { audio = null; resolve(); };
    audio.onerror = () => { audio = null; resolve(); };
    audio.play().catch(() => { audio = null; resolve(); });
  });
}

// ── 流式播放 ── [C1 fix] catch 块 return，不再发 chunk-done

async function playStreaming(settings, text) {
  const base = settings.apiUrl.replace(/\/+$/, '');
  
  try {
    if (settings.apiMode === 'astra') {
      const p = new URLSearchParams({ text, speed: settings.speechSpeed });
      if (settings.avatarId) p.set('avatarId', settings.avatarId);
      if (settings.referenceId) p.set('referenceId', settings.referenceId);
      const url = base + '/api/tts/predict-stream?' + p.toString();
      
      const resp = await fetch(url);
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const sampleRate = parseInt(resp.headers.get('X-Audio-Sample-Rate')) || 32000;
      await playFloat32PCM(resp, sampleRate, settings.outputVolume ?? 1.0);
    } else {
      const { endpoint, payload, headers } = buildRequest(settings, text, 'pcm');
      const resp = await fetch(endpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload)
      });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      await playInt16PCM(resp, 24000, settings.outputVolume ?? 1.0);
    }
  } catch (e) {
    if (!stopRequested) {
      console.error('Stream error:', e);
      chrome.runtime.sendMessage({ action: 'play-error', error: e.message });
    }
    return; // [C1] 错误时不发 chunk-done
  }
  
  if (!stopRequested) {
    chrome.runtime.sendMessage({ action: 'chunk-done' });
  }
}

async function playFloat32PCM(response, sampleRate, volume) {
  if (audioCtx && audioCtx.state !== 'closed') audioCtx.close(); // [I3 fix]
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

async function playInt16PCM(response, sampleRate, volume) {
  if (audioCtx && audioCtx.state !== 'closed') audioCtx.close(); // [I3 fix]
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

// ── 下载 ──

async function downloadAudio(settings, text) {
  const { endpoint, payload, headers } = buildRequest(settings, text, 'wav');
  try {
    const resp = await fetch(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload)
    });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const blob = await resp.blob();
    const url = URL.createObjectURL(blob);
    const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const ext = settings.apiMode === 'astra' ? 'wav' : 'mp3';
    chrome.downloads.download({
      url,
      filename: `tts-${ts}.${ext}`,
      saveAs: true
    }, () => URL.revokeObjectURL(url));
    if (!stopRequested) chrome.runtime.sendMessage({ action: 'chunk-done' });
  } catch (e) {
    if (!stopRequested) {
      console.error('Download error:', e);
      chrome.runtime.sendMessage({ action: 'play-error', error: e.message });
    }
  }
}

// ── 停止 ──

function stopAll() {
  stopRequested = true;
  if (audio) { audio.pause(); audio = null; }
  if (audioCtx && audioCtx.state !== 'closed') { audioCtx.close(); audioCtx = null; }
}

// ── 请求构建 ── [C3 fix] 唯一定义，不再与 background.js 重复

function buildRequest(settings, text, format) {
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
        model: settings.model || 'tts-1',
        input: text,
        voice: settings.voice || 'default',
        response_format: format,
        speed: settings.speechSpeed
      },
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${settings.apiKey || 'not-needed'}`
      }
    };
  }
}
