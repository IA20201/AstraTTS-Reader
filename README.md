# AstraTTS Reader

Chrome 浏览器扩展，选中文本即可朗读。

## 安装

1. 打开 `chrome://extensions/`
2. 开启「开发者模式」
3. 点「加载已解压的扩展程序」→ 选择 `extension` 文件夹

## 使用

- **浮动按钮**：选中 ≥3 个字的文本，右上角出现 🔊 按钮，点击朗读
- **右键菜单**：选中文本 → 右键 → 「用 AstraTTS 朗读」
- **停止**：右键 → 「停止朗读」

## 设置

点击扩展图标打开设置面板：

| 设置 | 说明 |
|------|------|
| API 模式 | AstraTTS 原生 / OpenAI 兼容 |
| 服务地址 | 默认 `http://localhost:5000` |
| 音色 ID | 对应 config.yaml 中的 Avatar Id |
| 参考音频 ID | 对应 Avatar 下的 Reference Id |
| 语速 | 0.5 ~ 2.0 |
| 音量 | 0 ~ 1.0 |

## 技术架构

```
background.js    Service Worker — 右键菜单、设置管理、调度 offscreen
offscreen.js     音频播放 — fetch 流式 API + PCM 解码播放
content.js       浮动按钮 — 选中文本后注入 UI
shared/          共享配置和设置读写
```

- 流式播放：AstraTTS 返回 Float32 PCM 流，边接收边播放，低延迟
- Manifest V3，无持久后台页面

## 前置要求

运行中的 [AstraTTS](https://github.com/Blackwood416/AstraTTS) 服务（默认端口 5000）。
