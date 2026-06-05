// AstraTTS Reader — 共享配置常量
// popup.html 和 options.html 通过 <script src> 引入

const DEFAULT_SETTINGS = {
  apiMode: 'astra',
  apiUrl: 'http://localhost:5000',
  apiKey: 'not-needed',
  voice: 'default',
  speechSpeed: 1.0,
  model: 'tts-1',
  avatarId: '',
  referenceId: '',
  streamingMode: false,
  downloadMode: false,
  outputVolume: 1.0
};
