// AstraTTS Reader — content script
// 选中文本后显示浮动朗读按钮

(function() {
  'use strict';

  let fab = null;
  let selectedText = '';
  let hideTimer = null;

  function createFAB() {
    if (fab) return;
    fab = document.createElement('div');
    fab.id = 'astra-tts-fab';
    fab.innerHTML = `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2">
      <path d="M11 5L6 9H2v6h4l5 4V5z"/>
      <path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07"/>
    </svg>`;
    fab.addEventListener('click', onFabClick);
    document.body.appendChild(fab);
  }

  function showFAB(x, y) {
    if (!fab) createFAB();
    const pad = 10;
    const maxX = window.innerWidth - 44 - pad;
    const maxY = window.innerHeight - 44 - pad;
    fab.style.left = Math.min(x, maxX) + 'px';
    fab.style.top = Math.max(pad, Math.min(y - 50, maxY)) + 'px';
    fab.classList.add('visible');
    clearTimeout(hideTimer);
    hideTimer = setTimeout(hideFAB, 5000);
  }

  function hideFAB() {
    if (fab) fab.classList.remove('visible');
  }

  function getSelectionRect() {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return null;
    return sel.getRangeAt(0).getBoundingClientRect();
  }

  document.addEventListener('mouseup', (e) => {
    if (e.target.closest('#astra-tts-fab')) return;
    setTimeout(() => {
      const sel = window.getSelection();
      const text = sel?.toString().trim() || '';
      if (text.length >= 3) {
        selectedText = text;
        const rect = getSelectionRect();
        if (rect) showFAB(rect.right, rect.top);
      } else {
        hideFAB();
        selectedText = '';
      }
    }, 10);
  });

  document.addEventListener('touchend', () => {
    setTimeout(() => {
      const sel = window.getSelection();
      const text = sel?.toString().trim() || '';
      if (text.length >= 3) {
        selectedText = text;
        const rect = getSelectionRect();
        if (rect) showFAB(rect.right, rect.top);
      }
    }, 100);
  });

  document.addEventListener('mousedown', (e) => {
    if (!e.target.closest('#astra-tts-fab')) hideFAB();
  });

  async function onFabClick() {
    if (!selectedText) return;
    hideFAB();
    fab.classList.add('clicked');
    setTimeout(() => fab?.classList.remove('clicked'), 300);
    try {
      await chrome.runtime.sendMessage({ action: 'tts-read', text: selectedText });
    } catch (e) {
      // SW 休眠时会被唤醒并处理，但首次连接可能失败，重试一次
      setTimeout(async () => {
        try {
          await chrome.runtime.sendMessage({ action: 'tts-read', text: selectedText });
        } catch (e2) {
          console.warn('AstraTTS: 无法连接，请重试');
        }
      }, 200);
    }
  }

})();
