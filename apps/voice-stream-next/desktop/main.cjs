const { app, BrowserWindow, ipcMain, screen, shell } = require('electron');
const { fork } = require('node:child_process');
const fs = require('node:fs');
const { createRequire } = require('node:module');
const path = require('node:path');

const PROTOCOL = 'voicestream';
const pendingPairingPayloads = [];
let mainWindow = null;
let compactMode = true;
let normalWindowBounds = null;

const fullWindow = {
  width: 1180,
  height: 780,
  minWidth: 960,
  minHeight: 680,
};
const compactWindow = {
  width: 172,
  height: 224,
  margin: 18,
};

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
  devAdmin: false,
  deviceId: '',
  deviceToken: '',
  deviceName: 'Desktop voice client',
  authSavedAt: '',
};

const voskState = {
  vosk: null,
  model: null,
  recognizer: null,
  worker: null,
  workerReady: false,
  workerStarting: null,
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

  return candidates.find((candidate) => hasRequiredVoskModelFiles(candidate)) || '';
}

function hasRequiredVoskModelFiles(modelDir) {
  return fs.existsSync(path.join(modelDir, 'am', 'final.mdl')) &&
    fs.existsSync(path.join(modelDir, 'graph', 'HCLr.fst')) &&
    fs.existsSync(path.join(modelDir, 'graph', 'Gr.fst')) &&
    fs.existsSync(path.join(modelDir, 'conf', 'model.conf'));
}

async function ensureVoskRecognizer() {
  if (voskState.recognizer) return statusForVosk(true);
  if (voskState.workerReady) return statusForVosk(true);
  if (voskState.workerStarting) return voskState.workerStarting;

  const modelPath = resolveVoskModelPath();
  if (!modelPath) {
    voskState.error = 'No Vosk model found. Set VOICE_STREAM_NEXT_VOSK_MODEL to an Android-style Vosk model directory.';
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
    return startVoskWorker(modelPath, error);
  }
}

function startVoskWorker(modelPath, originalError) {
  if (voskState.workerStarting) return voskState.workerStarting;
  const workerPath = path.join(__dirname, 'vosk-worker.cjs');
  const nodeExecutable = process.env.VOICE_STREAM_NEXT_NODE || 'node';
  voskState.workerStarting = new Promise((resolve) => {
    let settled = false;
    let worker;
    const finish = (status) => {
      if (settled) return;
      settled = true;
      voskState.workerStarting = null;
      resolve(status);
    };
    try {
      worker = fork(workerPath, {
        cwd: path.resolve(__dirname, '../..', '..'),
        execPath: nodeExecutable,
        serialization: 'advanced',
        stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
      });
    } catch (error) {
      voskState.error = [
        `Vosk failed in Electron: ${originalError?.message || String(originalError)}`,
        `Node worker failed: ${error?.message || String(error)}`,
      ].join(' ');
      finish(statusForVosk(false));
      return;
    }
    voskState.worker = worker;
    voskState.workerReady = false;
    worker.stderr?.on('data', (chunk) => {
      const text = String(chunk || '').trim();
      if (text) console.warn(`[voice-stream-vosk-worker] ${text}`);
    });
    worker.on('message', (message) => {
      if (!message || typeof message !== 'object') return;
      if (message.type === 'status') {
        voskState.workerReady = Boolean(message.available);
        voskState.modelPath = String(message.modelPath || modelPath);
        voskState.error = String(message.error || '');
        finish(statusForVosk(Boolean(message.available)));
      }
      if (message.type === 'text' && mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('vosk:text', {
          text: String(message.text || ''),
          final: Boolean(message.final),
        });
      }
    });
    worker.on('exit', () => {
      if (voskState.worker === worker) {
        voskState.worker = null;
        voskState.workerReady = false;
      }
      if (!settled) {
        voskState.error = `Vosk failed in Electron: ${originalError?.message || String(originalError)} Node worker exited before startup.`;
        finish(statusForVosk(false));
      }
    });
    worker.on('error', (error) => {
      if (voskState.worker === worker) {
        voskState.worker = null;
        voskState.workerReady = false;
      }
      voskState.error = [
        `Vosk failed in Electron: ${originalError?.message || String(originalError)}`,
        `Node worker failed: ${error?.message || String(error)}`,
      ].join(' ');
      finish(statusForVosk(false));
    });
    worker.send({
      type: 'start',
      modelPath,
      sampleRate,
      grammar: wakeGrammar,
    });
  });
  return voskState.workerStarting;
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

function statusForVosk(started = Boolean(voskState.recognizer || voskState.workerReady)) {
  return {
    available: Boolean(started && (voskState.recognizer || voskState.workerReady)),
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
  if (voskState.worker) {
    try {
      voskState.worker.send({ type: 'stop' });
    } catch {
      // Ignore stale worker shutdown errors.
    }
    try {
      voskState.worker.kill();
    } catch {
      // Ignore stale worker shutdown errors.
    }
  }
  voskState.worker = null;
  voskState.workerReady = false;
  voskState.workerStarting = null;
  voskState.lastText = '';
  voskState.lastTextAt = 0;
}

function resetVosk() {
  if (voskState.workerReady && voskState.worker) {
    try {
      voskState.worker.send({ type: 'reset' });
    } catch {
      releaseVosk();
    }
    return;
  }
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
  if (voskState.workerReady && voskState.worker) {
    const buffer = Buffer.isBuffer(frame) ? frame : Buffer.from(frame);
    try {
      voskState.worker.send({ type: 'frame', frame: buffer });
    } catch (error) {
      voskState.error = error?.message || String(error);
      sender.send('vosk:status', statusForVosk(false));
      releaseVosk();
    }
    return;
  }
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

function extractPairingPayloadFromArgv(argv) {
  return argv.find((entry) => /^voicestream:\/\//i.test(String(entry || '').trim())) || null;
}

function queuePairingPayload(payload) {
  const trimmed = String(payload || '').trim();
  if (!trimmed) return;
  pendingPairingPayloads.push(trimmed);
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('pairing:payload', trimmed);
  }
}

function registerProtocolClient() {
  if (process.defaultApp) {
    if (process.argv.length >= 2) {
      app.setAsDefaultProtocolClient(PROTOCOL, process.execPath, [path.resolve(process.argv[1])]);
      return;
    }
  }
  app.setAsDefaultProtocolClient(PROTOCOL);
}

function displayForWindow(win) {
  return screen.getDisplayMatching(win.getBounds());
}

function compactBoundsForWindow(win) {
  const { workArea } = displayForWindow(win);
  return {
    x: workArea.x + workArea.width - compactWindow.width - compactWindow.margin,
    y: workArea.y + workArea.height - compactWindow.height - compactWindow.margin,
    width: compactWindow.width,
    height: compactWindow.height,
  };
}

function windowStatePayload() {
  return { compact: compactMode };
}

function sendWindowState(win) {
  if (!win || win.isDestroyed()) return;
  win.webContents.send('window:state', windowStatePayload());
}

function applyCompactMode(win) {
  if (!win || win.isDestroyed()) return windowStatePayload();
  if (!compactMode) normalWindowBounds = win.getBounds();
  compactMode = true;
  win.setMinimumSize(compactWindow.width, compactWindow.height);
  win.setResizable(false);
  win.setAlwaysOnTop(true, 'floating');
  win.setSkipTaskbar(true);
  win.setBounds(compactBoundsForWindow(win));
  if (win.isMinimized()) win.restore();
  win.show();
  sendWindowState(win);
  return windowStatePayload();
}

function centeredFullBounds(win) {
  const display = win && !win.isDestroyed() ? displayForWindow(win) : screen.getPrimaryDisplay();
  const { workArea } = display;
  return {
    x: Math.round(workArea.x + (workArea.width - fullWindow.width) / 2),
    y: Math.round(workArea.y + (workArea.height - fullWindow.height) / 2),
    width: fullWindow.width,
    height: fullWindow.height,
  };
}

function applyExpandedMode(win) {
  if (!win || win.isDestroyed()) return windowStatePayload();
  compactMode = false;
  win.setResizable(true);
  win.setMinimumSize(fullWindow.minWidth, fullWindow.minHeight);
  win.setAlwaysOnTop(false);
  win.setSkipTaskbar(false);
  win.setBounds(normalWindowBounds || centeredFullBounds(win));
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
  sendWindowState(win);
  return windowStatePayload();
}

function windowFromEvent(event) {
  return BrowserWindow.fromWebContents(event.sender) || mainWindow;
}

function createWindow() {
  const win = new BrowserWindow({
    width: compactWindow.width,
    height: compactWindow.height,
    minWidth: compactWindow.width,
    minHeight: compactWindow.height,
    title: 'VoiceStream',
    backgroundColor: '#101216',
    frame: false,
    resizable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  win.removeMenu();
  win.loadFile(path.join(__dirname, 'index.html'));
  mainWindow = win;
  win.once('ready-to-show', () => {
    applyCompactMode(win);
  });
  win.webContents.once('did-finish-load', () => {
    sendWindowState(win);
  });
  win.on('move', () => {
    if (compactMode) return;
    normalWindowBounds = win.getBounds();
  });
  win.on('resize', () => {
    if (compactMode) return;
    normalWindowBounds = win.getBounds();
  });
  win.on('closed', () => {
    if (mainWindow === win) mainWindow = null;
  });
}

const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', (_event, argv) => {
    const payload = extractPairingPayloadFromArgv(argv);
    if (payload) queuePairingPayload(payload);
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.on('open-url', (event, url) => {
    event.preventDefault();
    queuePairingPayload(url);
  });

  registerProtocolClient();

  ipcMain.handle('config:read', () => readConfig());
  ipcMain.handle('pairing:takePending', () => pendingPairingPayloads.splice(0));
  ipcMain.handle('config:write', (_event, config) => writeConfig(config));
  ipcMain.handle('app:openExternal', (_event, url) => shell.openExternal(url));
  ipcMain.handle('window:state', () => windowStatePayload());
  ipcMain.handle('window:compact', (event) => applyCompactMode(windowFromEvent(event)));
  ipcMain.handle('window:expand', (event) => applyExpandedMode(windowFromEvent(event)));
  ipcMain.handle('window:close', (event) => {
    const win = windowFromEvent(event);
    if (win && !win.isDestroyed()) win.close();
  });
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

  app.whenReady().then(() => {
    const launchPayload = extractPairingPayloadFromArgv(process.argv);
    if (launchPayload) queuePairingPayload(launchPayload);
    createWindow();
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });

  app.on('before-quit', () => {
    releaseVosk();
  });
}
