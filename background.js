// AstraTTS Reader — background service worker (Chrome MV3)
// 职责：右键菜单、文本拆段、设置管理、调度 offscreen 播放

// ── 文本拆段 ──

const PRIMARY_SEP = /[。！？\n]+/;
const SECONDARY_SEP = /[；：，,;]+/;
const CHUNK_MAX = 200;
const CHUNK_MIN = 10;

function splitText(text) {
  text = text.trim();
  if (!text) return [];
  const parts = text.split(PRIMARY_SEP).filter(s => s.trim());
  const result = [];
  for (const part of parts) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    if (trimmed.length <= CHUNK_MAX) {
      if (trimmed.length >= CHUNK_MIN) result.push(trimmed);
    } else {
      const subs = trimmed.split(SECONDARY_SEP).filter(s => s.trim());
      let buf = '';
      for (const sub of subs) {
        const s = sub.trim();
        if (!s) continue;
        if (buf && (buf.length + s.length + 1) > CHUNK_MAX) {
          if (buf.length >= CHUNK_MIN) result.push(buf);
          if (s.length > CHUNK_MAX) {
            for (let i = 0; i < s.length; i += CHUNK_MAX) {
              const piece = s.slice(i, i + CHUNK_MAX);
              if (piece.length >= CHUNK_MIN) result.push(piece);
            }
            buf = '';
          } else {
            buf = s;
          }
        } else {
          buf = buf ? buf + s : s;
        }
      }
      if (buf) {
        if (buf.length > CHUNK_MAX) {
          for (let i = 0; i < buf.length; i += CHUNK_MAX) {
            const piece = buf.slice(i, i + CHUNK_MAX);
            if (piece.length >= CHUNK_MIN) result.push(piece);
          }
        } else if (buf.length >= CHUNK_MIN) {
          result.push(buf);
        }
      }
    }
  }
  return result;
}

// ── Badge ──

function setBadge(text, color, tooltip) {
  chrome.action.setBadgeText({ text: text || '' });
  if (color) chrome.action.setBadgeBackgroundColor({ color });
  if (tooltip) chrome.action.setTitle({ title: tooltip });
}

// ── 右键菜单 ──

function createMenus() {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: 'tts-read',
      title: '用 AstraTTS 朗读',
      contexts: ['selection']
    });
    chrome.contextMenus.create({
      id: 'tts-stop',
      title: '停止朗读',
      contexts: ['all'],
      visible: false
    });
  });
}

chrome.runtime.onInstalled.addListener(createMenus);

chrome.contextMenus.onClicked.addListener((info) => {
  if (info.menuItemId === 'tts-read' && info.selectionText) {
    startPlayback(info.selectionText);
  } else if (info.menuItemId === 'tts-stop') {
    stopPlayback();
  }
});

// ── 设置读取 ──

async function getSettings() {
  return new Promise((resolve) => {
    chrome.storage.local.get(
      ['apiMode', 'apiUrl', 'apiKey', 'speechSpeed', 'voice', 'model', 'avatarId', 'referenceId', 'streamingMode', 'downloadMode', 'outputVolume'],
      (data) => {
        if (!data.apiMode) {
          const oldUrl = data.apiUrl || '';
          data.apiMode = oldUrl.includes('/v1') ? 'openai' : 'astra';
          if (data.apiMode === 'astra') data.apiUrl = oldUrl.replace(/\/v1\/?$/, '');
        }
        resolve({
          apiMode:     data.apiMode || 'astra',
          apiUrl:      data.apiUrl || 'http://localhost:5000',
          apiKey:      data.apiKey || 'not-needed',
          speechSpeed: data.speechSpeed ?? 1.0,
          voice:       data.voice || 'default',
          model:       data.model || 'tts-1',
          avatarId:    data.avatarId || '',
          referenceId: data.referenceId || '',
          streamingMode: data.streamingMode ?? false,
          downloadMode:  data.downloadMode ?? false,
          outputVolume:  data.outputVolume ?? 1.0
        });
      }
    );
  });
}

// ── Offscreen 管理 ──

let offscreenCreated = false;

async function ensureOffscreen() {
  if (offscreenCreated) return;
  try {
    await chrome.offscreen.createDocument({
      url: 'offscreen.html',
      reasons: ['AUDIO_PLAYBACK'],
      justification: 'Play TTS audio'
    });
    offscreenCreated = true;
  } catch (e) {
    if (e.message?.includes('already exists')) {
      offscreenCreated = true;
    } else {
      throw e;
    }
  }
}

// ── 播放控制 ──
// [I1 fix] 使用 chrome.storage.session 持久化状态，SW 重启后可恢复

let isPlaying = false;

async function startPlayback(text) {
  const settings = await getSettings();
  const mode = settings.streamingMode ? 'stream' : settings.downloadMode ? 'download' : 'normal';

  await ensureOffscreen();

  if (mode === 'stream' || mode === 'download') {
    isPlaying = true;
    await saveState({ isPlaying: true, mode, stopRequested: false, currentIndex: 0, chunks: [] });
    setBadge('...', '#4CAF50', '朗读中');
    chrome.contextMenus.update('tts-read', { visible: false });
    chrome.contextMenus.update('tts-stop', { visible: true });

    chrome.runtime.sendMessage({
      action: 'play',
      settings,
      text,
      mode
    });
  } else {
    const chunks = splitText(text);
    if (chunks.length === 0) return;
    isPlaying = true;
    await saveState({ isPlaying: true, mode: 'normal', stopRequested: false, currentIndex: 0, chunks });
    setBadge('1/' + chunks.length, '#4CAF50', '朗读中');
    chrome.contextMenus.update('tts-read', { visible: false });
    chrome.contextMenus.update('tts-stop', { visible: true });

    playChunk(settings, chunks, 0);
  }
}

function playChunk(settings, chunks, index) {
  const state = { isPlaying: true, stopRequested: false };
  
  // 检查是否停止或完成
  if (index >= chunks.length) {
    cleanup();
    return;
  }
  
  setBadge(`${index + 1}/${chunks.length}`, '#4CAF50', '朗读中');
  saveState({ ...state, currentIndex: index, chunks });

  chrome.runtime.sendMessage({
    action: 'play',
    settings,
    text: chunks[index],
    mode: 'normal'
  });
}

// [I2 fix] 异步停止，等 offscreen 收到消息后再 cleanup
async function stopPlayback() {
  await saveState({ stopRequested: true });
  chrome.runtime.sendMessage({ action: 'stop' });
  // 给 offscreen 时间处理 stop 消息
  await new Promise(r => setTimeout(r, 300));
  cleanup();
}

function cleanup() {
  isPlaying = false;
  setBadge('', '', 'AstraTTS Reader');
  chrome.contextMenus.update('tts-read', { visible: true });
  chrome.contextMenus.update('tts-stop', { visible: false });
  chrome.storage.session.remove(['playState']).catch(() => {});
  // 关闭 offscreen 释放资源
  if (offscreenCreated) {
    chrome.offscreen.closeDocument().catch(() => {});
    offscreenCreated = false;
  }
}

// ── 状态持久化（SW 重启恢复） ──

async function saveState(state) {
  try {
    await chrome.storage.session.set({ playState: state });
  } catch (e) {
    // session storage 可能不可用，忽略
  }
}

async function loadState() {
  return new Promise((resolve) => {
    chrome.storage.session.get(['playState'], (data) => {
      resolve(data.playState || null);
    });
  });
}

// SW 启动时检查是否有未完成的播放
chrome.runtime.onStartup.addListener(async () => {
  const state = await loadState();
  if (state?.isPlaying && !state.stopRequested) {
    // 恢复播放
    const settings = await getSettings();
    if (state.mode === 'normal' && state.chunks?.length > 0) {
      await ensureOffscreen();
      isPlaying = true;
      setBadge(`${state.currentIndex + 1}/${state.chunks.length}`, '#4CAF50', '朗读中');
      chrome.contextMenus.update('tts-read', { visible: false });
      chrome.contextMenus.update('tts-stop', { visible: true });
      playChunk(settings, state.chunks, state.currentIndex);
    }
  }
});

// ── 来自 content script 和 offscreen 的消息 ──

chrome.runtime.onMessage.addListener((msg, sender) => {
  if (msg.action === 'tts-read' && msg.text) {
    // 来自浮动按钮的朗读请求
    startPlayback(msg.text);
  } else if (msg.action === 'chunk-done') {
    if (isPlaying) {
      loadState().then(async (state) => {
        if (state?.stopRequested || !state?.isPlaying) {
          cleanup();
          return;
        }
        const settings = await getSettings();
        const nextIndex = (state.currentIndex ?? 0) + 1;
        if (state.chunks && nextIndex < state.chunks.length) {
          playChunk(settings, state.chunks, nextIndex);
        } else {
          cleanup();
        }
      });
    } else {
      cleanup();
    }
  } else if (msg.action === 'play-error') {
    setBadge('!', '#F44336', '播放失败');
    cleanup();
  } else if (msg.action === 'stop') {
    stopPlayback();
  }
});
