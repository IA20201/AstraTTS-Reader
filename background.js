// AstraTTS Reader — background service worker (Chrome MV3)
// 职责：右键菜单、设置管理、调度 offscreen 流式播放

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
      ['apiMode', 'apiUrl', 'apiKey', 'speechSpeed', 'voice', 'model', 'avatarId', 'referenceId', 'outputVolume'],
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
          outputVolume: data.outputVolume ?? 1.0
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

let isPlaying = false;
let runtimeStatus = {};

async function startPlayback(text) {
  const settings = await getSettings();
  runtimeStatus = {}; // 重置运行状态

  try {
    await ensureOffscreen();
  } catch (e) {
    console.error('Failed to create offscreen:', e);
    setBadge('!', '#F44336', '初始化失败');
    return;
  }

  isPlaying = true;
  setBadge('▶', '#4CAF50', '流式朗读中');
  chrome.contextMenus.update('tts-read', { visible: false });
  chrome.contextMenus.update('tts-stop', { visible: true });

  chrome.runtime.sendMessage({
    action: 'play',
    settings,
    text,
    mode: 'stream'
  });
}

async function stopPlayback() {
  isPlaying = false;
  chrome.runtime.sendMessage({ action: 'stop' });
  await new Promise(r => setTimeout(r, 300));
  cleanup();
}

function cleanup() {
  isPlaying = false;
  setBadge('', '', 'AstraTTS Reader');
  chrome.contextMenus.update('tts-read', { visible: true });
  chrome.contextMenus.update('tts-stop', { visible: false });
  if (offscreenCreated) {
    chrome.offscreen.closeDocument().catch(() => {});
    offscreenCreated = false;
  }
}

// ── 消息处理 ──

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.action === 'tts-read' && msg.text) {
    startPlayback(msg.text);
  } else if (msg.action === 'chunk-done' || msg.action === 'stream-ended') {
    cleanup();
  } else if (msg.action === 'play-error') {
    setBadge('!', '#F44336', '播放失败');
    cleanup();
  } else if (msg.action === 'stop') {
    stopPlayback();
  } else if (msg.action === 'runtime-status') {
    runtimeStatus = { ...runtimeStatus, ...msg.data };
  } else if (msg.action === 'get-runtime-status') {
    sendResponse({ data: runtimeStatus });
    return true;
  }
});
