// AstraTTS Reader — content script
// 选中文本后显示浮动朗读按钮

(function() {
  'use strict';

  let fab = null;
  let selectedText = '';
  let hideTimer = null;

  // 创建浮动按钮
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

  // 显示按钮在选区附近
  function showFAB(x, y) {
    if (!fab) createFAB();
    // 限制在视口内
    const pad = 10;
    const maxX = window.innerWidth - 44 - pad;
    const maxY = window.innerHeight - 44 - pad;
    fab.style.left = Math.min(x, maxX) + 'px';
    fab.style.top = Math.max(pad, Math.min(y - 50, maxY)) + 'px';
    fab.classList.add('visible');
    clearTimeout(hideTimer);
    // 5秒后自动隐藏
    hideTimer = setTimeout(hideFAB, 5000);
  }

  function hideFAB() {
    if (fab) fab.classList.remove('visible');
  }

  // 获取选区位置
  function getSelectionRect() {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return null;
    const range = sel.getRangeAt(0);
    const rect = range.getBoundingClientRect();
    return rect;
  }

  // 监听选中文本
  document.addEventListener('mouseup', (e) => {
    // 忽略按钮自身的点击
    if (e.target.closest('#astra-tts-fab')) return;
    
    setTimeout(() => {
      const sel = window.getSelection();
      const text = sel?.toString().trim() || '';
      
      if (text.length >= 3) {
        selectedText = text;
        const rect = getSelectionRect();
        if (rect) {
          // 按钮显示在选区右上方
          showFAB(rect.right + window.scrollX, rect.top + window.scrollY);
        }
      } else {
        hideFAB();
        selectedText = '';
      }
    }, 10);
  });

  // 触摸设备支持
  document.addEventListener('touchend', (e) => {
    setTimeout(() => {
      const sel = window.getSelection();
      const text = sel?.toString().trim() || '';
      if (text.length >= 3) {
        selectedText = text;
        const rect = getSelectionRect();
        if (rect) showFAB(rect.right, rect.top + window.scrollY);
      }
    }, 100);
  });

  // 点击页面其他区域隐藏
  document.addEventListener('mousedown', (e) => {
    if (!e.target.closest('#astra-tts-fab') && !e.target.closest('#astra-tts-fab *')) {
      hideFAB();
    }
  });

  // 点击浮动按钮 → 发送消息给 background
  function onFabClick() {
    if (!selectedText) return;
    hideFAB();
    
    // 添加点击动画
    fab.classList.add('clicked');
    setTimeout(() => fab?.classList.remove('clicked'), 300);
    
    chrome.runtime.sendMessage({
      action: 'tts-read',
      text: selectedText
    });
  }

  // 接收 background 的状态更新（可选）
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.action === 'tts-status') {
      // 可以在此更新 UI 状态
    }
  });

})();
