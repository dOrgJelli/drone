const { app, BrowserWindow, ipcMain, shell } = require('electron');
const fs = require('node:fs');
const { createRequire } = require('node:module');
const path = require('node:path');

const sampleRate = 16_000;
const wakeGrammar = [
  'hey sebastian',
  'hay sebastian',
  'hey',
  'hay',
  'sebastian',
  'patch me in',
  'can you transcribe',
  'transcribe',
  'go to sleep',
  'go',
  'to',
  'sleep',
  'status',
  'state us',
  'state is',
  'status check',
  'check status',
  'approval',
  'code',
  'approval code',
  'zero',
  'oh',
  'one',
  'two',
  'three',
  'four',
  'five',
  'six',
  'seven',
  'eight',
  'nine',
  '[unk]',
];

const defaultConfig = {
  serverUrl: process.env.VOICE_STREAM_NEXT_SERVER_URL || 'http://127.0.0.1:3299',
  webUrl: process.env.VOICE_STREAM_NEXT_WEB_URL || '',
  authMode: 'dev',
  bearerToken: '',
  devEmail: 'desktop@example.local',
  devName: 'Desktop Operator',
  devAdmin: true,
  deviceId: '',
  deviceToken: '',
  deviceName: 'Desktop voice client',
};

const voskState = {
  vosk: null,
  model: null,
  recognizer: null,
  modelPath: '',
  error: '',
  lastText: '',
  lastTextAt: 0,
};

function configPath() {
  return path.join(app.getPath('userData'), 'voice-stream-next-desktop.json');
}

function readConfig() {
  try {
    return { ...defaultConfig, ...JSON.parse(fs.readFileSync(configPath(), 'utf8')) };
  } catch {
    return { ...defaultConfig };
  }
}

function writeConfig(nextConfig) {
  const config = { ...defaultConfig, ...nextConfig };
  fs.mkdirSync(path.dirname(configPath()), { recursive: true });
  fs.writeFileSync(configPath(), JSON.stringify(config, null, 2));
  return config;
}

function resolveVoskModelPath() {
  const candidates = [
    process.env.VOICE_STREAM_NEXT_VOSK_MODEL,
    path.join(process.resourcesPath || '', 'model-en-us'),
    path.join(process.resourcesPath || '', 'vosk-model-en-us'),
    path.resolve(__dirname, '../android/app/src/main/assets/model-en-us'),
    path.resolve(__dirname, '../../voice-stream/android/app/src/main/assets/model-en-us'),
  ].filter(Boolean);

  return candidates.find((candidate) => fs.existsSync(candidate)) || '';
}

function ensureVoskRecognizer() {
  if (voskState.recognizer) return statusForVosk(true);

  const modelPath = resolveVoskModelPath();
  if (!modelPath) {
    voskState.error = 'No Vosk model found. Set VOICE_STREAM_NEXT_VOSK_MODEL to a model directory.';
    return statusForVosk(false);
  }

  try {
    if (!voskState.vosk) {
      voskState.vosk = requireVosk();
      voskState.vosk.setLogLevel(-1);
    }
    voskState.model = new voskState.vosk.Model(modelPath);
    voskState.recognizer = new voskState.vosk.Recognizer({
      model: voskState.model,
      sampleRate,
      grammar: wakeGrammar,
    });
    voskState.modelPath = modelPath;
    voskState.error = '';
    return statusForVosk(true);
  } catch (error) {
    releaseVosk();
    voskState.error = error?.message || String(error);
    return statusForVosk(false);
  }
}

function requireVosk() {
  try {
    return require('vosk');
  } catch (error) {
    const resourcesNodeModules = path.join(process.resourcesPath || '', 'node_modules', 'vosk', 'package.json');
    if (!fs.existsSync(resourcesNodeModules)) throw error;
    return createRequire(resourcesNodeModules)('vosk');
  }
}

function statusForVosk(started = Boolean(voskState.recognizer)) {
  return {
    available: Boolean(started && voskState.recognizer),
    modelPath: voskState.modelPath || resolveVoskModelPath() || '',
    error: voskState.error,
  };
}

function releaseVosk() {
  try {
    voskState.recognizer?.free();
  } catch {
    // Ignore native cleanup errors while shutting down the local recognizer.
  }
  try {
    voskState.model?.free();
  } catch {
    // Ignore native cleanup errors while shutting down the local recognizer.
  }
  voskState.model = null;
  voskState.recognizer = null;
  voskState.lastText = '';
  voskState.lastTextAt = 0;
}

function resetVosk() {
  try {
    voskState.recognizer?.reset();
  } catch {
    releaseVosk();
  }
  voskState.lastText = '';
  voskState.lastTextAt = 0;
}

function textFromVoskResult(result) {
  if (!result || typeof result !== 'object') return '';
  return String(result.partial || result.text || '').trim();
}

function handleVoskFrame(sender, frame) {
  if (!voskState.recognizer) return;
  const buffer = Buffer.isBuffer(frame) ? frame : Buffer.from(frame);
  if (!buffer.length) return;

  try {
    const accepted = voskState.recognizer.acceptWaveform(buffer);
    const text = textFromVoskResult(accepted ? voskState.recognizer.result() : voskState.recognizer.partialResult());
    if (!text) return;

    const now = Date.now();
    if (text === voskState.lastText && now - voskState.lastTextAt < 900) return;
    voskState.lastText = text;
    voskState.lastTextAt = now;
    sender.send('vosk:text', { text, final: Boolean(accepted) });
  } catch (error) {
    voskState.error = error?.message || String(error);
    sender.send('vosk:status', statusForVosk(false));
    releaseVosk();
  }
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1180,
    height: 780,
    minWidth: 960,
    minHeight: 680,
    title: 'VoiceStream',
    backgroundColor: '#f6f3eb',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  win.removeMenu();
  const appUrl = process.env.VOICE_STREAM_NEXT_WEB_URL || process.env.VOICE_STREAM_NEXT_SERVER_URL || 'http://127.0.0.1:3299';
  win.loadURL(appUrl).catch(() => {
    win.loadFile(path.join(__dirname, 'index.html'));
  });
}

ipcMain.handle('config:read', () => readConfig());
ipcMain.handle('config:write', (_event, config) => writeConfig(config));
ipcMain.handle('app:openExternal', (_event, url) => shell.openExternal(url));
ipcMain.handle('vosk:status', () => statusForVosk());
ipcMain.handle('vosk:start', () => ensureVoskRecognizer());
ipcMain.handle('vosk:stop', () => {
  releaseVosk();
  return statusForVosk(false);
});
ipcMain.handle('vosk:reset', () => {
  resetVosk();
  return statusForVosk();
});
ipcMain.on('vosk:frame', (event, frame) => handleVoskFrame(event.sender, frame));

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

app.on('before-quit', () => {
  releaseVosk();
});
