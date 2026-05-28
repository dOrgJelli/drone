const { app, BrowserWindow, ipcMain, screen, shell, Menu, Tray, nativeImage, clipboard, dialog } = require('electron');
const { fork } = require('node:child_process');
const { randomUUID } = require('node:crypto');
const fs = require('node:fs');
const { createRequire } = require('node:module');
const path = require('node:path');
const zlib = require('node:zlib');

const PROTOCOL = 'voicestream';
const pendingPairingPayloads = [];
let mainWindow = null;
let compactMode = true;
let normalWindowBounds = null;
let tray = null;
let isQuitting = false;
let trayStatus = { mode: 'off', status: 'Off.' };
let extensionBridge = { socket: null, reconnectTimer: null, stopped: false, reconnectDelayMs: 1000 };
const extensionHost = {
  loading: null,
  loaded: false,
  configKey: '',
  manifests: [],
  tools: new Map(),
  statuses: [],
  deactivators: [],
};

const fullWindow = {
  width: 1180,
  height: 780,
  minWidth: 960,
  minHeight: 680,
};
const compactWindow = {
  width: 268,
  height: 72,
  margin: 18,
};

const sampleRate = 16_000;
// Keep status grammar easy to restore, but do not detect spoken status commands locally.
const enableStatusWakeCommand = false;
const statusWakeGrammar = [
  'status',
  'state us',
  'state is',
  'status check',
  'check status',
];
const wakeGrammar = [
  'hey sebastian',
  'hey sebastien',
  'hay sebastian',
  'hay sebastien',
  'hey',
  'hay',
  'sebastian',
  'sebastien',
  'patch me in',
  'can you transcribe',
  'transcribe',
  'go to sleep',
  'go',
  'to',
  'sleep',
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
  ...(enableStatusWakeCommand ? statusWakeGrammar : []),
];

const defaultConfig = {
  serverUrl: process.env.VOICE_STREAM_NEXT_SERVER_URL || 'http://127.0.0.1:3299',
  webUrl: process.env.VOICE_STREAM_NEXT_WEB_URL || '',
  authMode: 'dev',
  bearerToken: '',
  devEmail: 'desktop@example.local',
  devName: 'Desktop Operator',
  devAdmin: false,
  installationId: '',
  deviceId: '',
  deviceToken: '',
  deviceName: 'Desktop voice client',
  inputDeviceId: '',
  outputDeviceId: '',
  extensionBridgeEnabled: true,
  extensions: [],
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

function createInstallationId() {
  return `desktop_${randomUUID().replace(/-/g, '')}`;
}

function normalizeConfig(nextConfig) {
  const config = { ...defaultConfig, ...nextConfig };
  if (!String(config.installationId || '').trim()) {
    config.installationId = createInstallationId();
  }
  return config;
}

function persistConfig(config) {
  fs.mkdirSync(path.dirname(configPath()), { recursive: true });
  fs.writeFileSync(configPath(), JSON.stringify(config, null, 2));
}

function readConfig() {
  try {
    const parsed = JSON.parse(fs.readFileSync(configPath(), 'utf8'));
    const config = normalizeConfig(parsed);
    if (!parsed.installationId) persistConfig(config);
    return config;
  } catch {
    const config = normalizeConfig({});
    persistConfig(config);
    return config;
  }
}

function writeConfig(nextConfig) {
  const config = normalizeConfig(nextConfig);
  persistConfig(config);
  return config;
}

function windowDebugLog(message, details = {}) {
  try {
    const file = path.join(app.getPath('userData'), 'voice-stream-next-window-debug.log');
    fs.appendFileSync(file, `${JSON.stringify({ at: new Date().toISOString(), pid: process.pid, message, ...details })}\n`);
  } catch {
    // Debug logging must never affect window behavior.
  }
}

function windowSnapshot(win) {
  if (!win || win.isDestroyed()) return null;
  return {
    bounds: win.getBounds(),
    minimumSize: win.getMinimumSize(),
    resizable: win.isResizable(),
    alwaysOnTop: win.isAlwaysOnTop(),
    compactMode,
    normalWindowBounds,
  };
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
  windowDebugLog('applyCompactMode:start', { snapshot: windowSnapshot(win) });
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
  windowDebugLog('applyCompactMode:end', { snapshot: windowSnapshot(win) });
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
  windowDebugLog('applyExpandedMode:start', { snapshot: windowSnapshot(win) });
  compactMode = false;
  win.setResizable(true);
  win.setMinimumSize(fullWindow.minWidth, fullWindow.minHeight);
  win.setAlwaysOnTop(false);
  win.setSkipTaskbar(false);
  const bounds = normalWindowBounds || centeredFullBounds(win);
  const tooSmallForFullMode = bounds.width < fullWindow.minWidth || bounds.height < fullWindow.minHeight;
  win.setBounds(tooSmallForFullMode ? centeredFullBounds(win) : bounds);
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
  sendWindowState(win);
  windowDebugLog('applyExpandedMode:end', { snapshot: windowSnapshot(win) });
  return windowStatePayload();
}

function applySignedOutMode(win) {
  windowDebugLog('applySignedOutMode:start', { snapshot: windowSnapshot(win) });
  normalWindowBounds = null;
  const result = applyExpandedMode(win);
  windowDebugLog('applySignedOutMode:end', { snapshot: windowSnapshot(win) });
  return result;
}

function shouldStartCompact() {
  const config = readConfig();
  return Boolean(config.deviceId && config.deviceToken);
}

function extensionBridgeUrl(config) {
  const url = new URL(`/api/devices/${encodeURIComponent(config.deviceId)}/extensions`, trimSlash(config.serverUrl));
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  url.searchParams.set('token', config.deviceToken);
  url.searchParams.set('clientVersion', '1');
  url.searchParams.set('protocolVersion', '1');
  return url.toString();
}

function trimSlash(value) {
  return String(value || '').replace(/\/+$/, '');
}

function extensionToolName(extensionId, toolName) {
  return `${safeExtensionToolSegment(extensionId).replace(/_/g, '-')}__${safeExtensionToolSegment(toolName)}`;
}

function safeExtensionToolSegment(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 64);
}

function cleanExtensionConfigs(config = readConfig()) {
  const entries = Array.isArray(config.extensions) ? config.extensions : [];
  return entries
    .map((entry, index) => {
      const value = entry && typeof entry === 'object' ? entry : {};
      const id = safeExtensionToolSegment(value.id || path.basename(String(value.path || `extension_${index}`), path.extname(String(value.path || '')))).replace(/_/g, '-');
      const extensionPath = String(value.path || '').trim();
      if (!id || !extensionPath) return null;
      return {
        id,
        name: String(value.name || id).trim() || id,
        path: extensionPath,
        enabled: value.enabled !== false,
        config: value.config && typeof value.config === 'object' && !Array.isArray(value.config) ? value.config : {},
      };
    })
    .filter(Boolean);
}

function extensionConfigKey(configs) {
  return JSON.stringify(configs.map((item) => ({
    id: item.id,
    name: item.name,
    path: item.path,
    enabled: item.enabled,
    config: item.config,
  })));
}

function extensionStatePath() {
  return path.join(app.getPath('userData'), 'voice-stream-next-extension-state.json');
}

function readExtensionState() {
  try {
    return JSON.parse(fs.readFileSync(extensionStatePath(), 'utf8'));
  } catch {
    return {};
  }
}

function writeExtensionState(state) {
  fs.mkdirSync(path.dirname(extensionStatePath()), { recursive: true });
  fs.writeFileSync(extensionStatePath(), JSON.stringify(state, null, 2));
}

async function postAssistantThreadPromptFromExtension(extensionId, threadId, prompt, options = {}) {
  const config = readConfig();
  const cleanThreadId = String(threadId || '').trim();
  const cleanPrompt = String(prompt || '').trim();
  if (!config.deviceId || !config.deviceToken) throw new Error('desktop device is not paired with Drone');
  if (!cleanThreadId) throw new Error('threadId is required');
  if (!cleanPrompt) throw new Error('prompt is required');
  if (typeof fetch !== 'function') throw new Error('fetch is not available in this desktop runtime');

  const url = new URL(`/api/devices/${encodeURIComponent(config.deviceId)}/assistant/threads/${encodeURIComponent(cleanThreadId)}/prompt`, trimSlash(config.serverUrl));
  const body = {
    token: config.deviceToken,
    clientVersion: 1,
    source: 'extension',
    extensionId: String(extensionId || '').trim(),
    prompt: cleanPrompt,
    ...(options.provider ? { provider: String(options.provider) } : {}),
    ...(options.model ? { model: String(options.model) } : {}),
    ...(options.thinkingLevel ? { thinkingLevel: String(options.thinkingLevel) } : {}),
  };
  const response = await fetch(url.toString(), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }
  if (!response.ok) throw new Error(String(data?.error || text || `assistant prompt failed with ${response.status}`));
  return data;
}

function createExtensionApi(extensionConfig, manifest, tools) {
  return {
    id: extensionConfig.id,
    name: extensionConfig.name,
    config: { ...extensionConfig.config },
    log(message, details = {}) {
      windowDebugLog('extension:log', { extensionId: extensionConfig.id, message: String(message || ''), details });
    },
    registerTool(tool) {
      const value = tool && typeof tool === 'object' ? tool : {};
      const localName = safeExtensionToolSegment(value.name);
      if (!localName) throw new Error(`extension ${extensionConfig.id} registered a tool without a name`);
      if (typeof value.execute !== 'function') throw new Error(`extension ${extensionConfig.id}.${localName} is missing execute(args, context)`);
      const fullName = extensionToolName(extensionConfig.id, localName);
      if (tools.has(fullName)) throw new Error(`duplicate extension tool: ${fullName}`);
      const approvalEvaluator = typeof value.approval === 'function' ? value.approval : null;
      const toolManifest = {
        name: localName,
        label: String(value.label || localName.replace(/_/g, ' ')).trim(),
        description: String(value.description || `${localName} extension tool`).trim(),
        inputSchema: normalizeExtensionInputSchema(value.inputSchema),
        approval: approvalEvaluator ? 'dynamic' : cleanExtensionApproval(value.approval),
        supportedTargets: cleanExtensionTargets(value.supportedTargets || value.targets),
        defaultTarget: cleanExtensionTarget(value.defaultTarget, 'device'),
      };
      if (!toolManifest.supportedTargets.includes(toolManifest.defaultTarget)) {
        toolManifest.defaultTarget = toolManifest.supportedTargets[0] || 'device';
      }
      manifest.tools.push(toolManifest);
      tools.set(fullName, {
        extensionId: extensionConfig.id,
        name: localName,
        fullName,
        execute: value.execute,
        approval: approvalEvaluator,
      });
    },
    assistant: {
      async promptThread(threadId, prompt, options = {}) {
        return postAssistantThreadPromptFromExtension(extensionConfig.id, threadId, prompt, options);
      },
    },
    state: {
      async get(key, fallback = null) {
        const state = readExtensionState();
        const bucket = state[extensionConfig.id] && typeof state[extensionConfig.id] === 'object' ? state[extensionConfig.id] : {};
        return Object.prototype.hasOwnProperty.call(bucket, key) ? bucket[key] : fallback;
      },
      async set(key, value) {
        const state = readExtensionState();
        const bucket = state[extensionConfig.id] && typeof state[extensionConfig.id] === 'object' ? state[extensionConfig.id] : {};
        bucket[String(key)] = value;
        state[extensionConfig.id] = bucket;
        writeExtensionState(state);
      },
    },
  };
}

function normalizeExtensionInputSchema(schema) {
  const value = schema && typeof schema === 'object' && !Array.isArray(schema) ? schema : {};
  return {
    type: 'object',
    properties: value.properties && typeof value.properties === 'object' && !Array.isArray(value.properties) ? value.properties : {},
    required: Array.isArray(value.required) ? value.required.map((item) => String(item)).filter(Boolean) : [],
    additionalProperties: value.additionalProperties === true,
  };
}

function cleanExtensionApproval(value) {
  const approval = String(value || '').trim();
  return approval === 'never' || approval === 'normal_threads' || approval === 'always' || approval === 'dynamic' ? approval : 'always';
}

function cleanExtensionTarget(value, fallback = 'device') {
  const target = String(value || '').trim();
  return target === 'server' || target === 'device' || target === 'any_device' ? target : fallback;
}

function cleanExtensionTargets(value) {
  const values = Array.isArray(value) ? value : [value];
  const targets = values.map((item) => cleanExtensionTarget(item, '')).filter(Boolean);
  return targets.length > 0 ? [...new Set(targets)] : ['device'];
}

function titleFromExtensionId(id) {
  return String(id || 'extension')
    .split(/[-_]+/g)
    .filter(Boolean)
    .map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`)
    .join(' ') || 'Extension';
}

function extensionIdFromFilePath(filePath) {
  const baseName = path.basename(String(filePath || ''), path.extname(String(filePath || '')));
  return safeExtensionToolSegment(baseName.replace(/[-_]?extension$/i, '')).replace(/_/g, '-') || 'extension';
}

function assertLoadableExtensionPath(filePath) {
  const rawPath = String(filePath || '').trim();
  if (!rawPath) throw new Error('Extension file path is required.');
  const resolved = path.resolve(rawPath);
  const stat = fs.existsSync(resolved) ? fs.statSync(resolved) : null;
  if (!stat?.isFile()) throw new Error('Extension file does not exist.');
  const ext = path.extname(resolved).toLowerCase();
  if (ext !== '.cjs' && ext !== '.js') throw new Error('Extension file must be a .cjs or .js file.');
  return resolved;
}

async function reloadExtensionsAfterConfigSave(savedConfig) {
  extensionHost.loaded = false;
  extensionHost.configKey = '';
  await loadDesktopExtensions({ force: true });
  restartExtensionBridge();
  return { ok: true, config: savedConfig, statuses: extensionHost.statuses, manifests: extensionHost.manifests };
}

async function addExtensionFileToConfig(filePath) {
  const resolved = assertLoadableExtensionPath(filePath);
  const config = readConfig();
  const extensions = Array.isArray(config.extensions) ? [...config.extensions] : [];
  const id = extensionIdFromFilePath(resolved);
  const existingIndex = extensions.findIndex((entry) => String(entry?.id || '') === id);
  const existing = existingIndex >= 0 && extensions[existingIndex] && typeof extensions[existingIndex] === 'object'
    ? extensions[existingIndex]
    : {};
  const entry = {
    id,
    name: String(existing.name || titleFromExtensionId(id)).trim() || titleFromExtensionId(id),
    path: resolved,
    enabled: true,
    config: existing.config && typeof existing.config === 'object' && !Array.isArray(existing.config) ? existing.config : {},
  };
  if (existingIndex >= 0) {
    extensions[existingIndex] = entry;
  } else {
    extensions.push(entry);
  }
  const savedConfig = writeConfig({ ...config, extensions });
  return { entry, ...(await reloadExtensionsAfterConfigSave(savedConfig)) };
}

async function deactivateDesktopExtensions() {
  const deactivators = extensionHost.deactivators.splice(0);
  for (const entry of deactivators) {
    try {
      await entry.deactivate();
    } catch (error) {
      windowDebugLog('extension:deactivateFailed', { extensionId: entry.extensionId, error: error?.message || String(error) });
    }
  }
}

async function loadDesktopExtensions(options = {}) {
  const configs = cleanExtensionConfigs();
  const configKey = extensionConfigKey(configs);
  if (!options.force && extensionHost.loaded && extensionHost.configKey === configKey) return extensionHost;
  if (extensionHost.loading) return extensionHost.loading;
  extensionHost.loading = (async () => {
    await deactivateDesktopExtensions();
    const manifests = [];
    const tools = new Map();
    const statuses = [];
    const extensionIds = new Set();
    for (const extensionConfig of configs) {
      if (!extensionConfig.enabled) {
        statuses.push({ id: extensionConfig.id, name: extensionConfig.name, enabled: false, ok: true, toolCount: 0 });
        continue;
      }
      const manifest = {
        id: extensionConfig.id,
        name: extensionConfig.name,
        version: '0.0.0',
        tools: [],
      };
      const existingToolNames = new Set(tools.keys());
      try {
        if (extensionIds.has(extensionConfig.id)) throw new Error(`duplicate extension id: ${extensionConfig.id}`);
        extensionIds.add(extensionConfig.id);
        if (!path.isAbsolute(extensionConfig.path)) throw new Error('extension path must be absolute');
        const modulePath = extensionConfig.path;
        delete require.cache[require.resolve(modulePath)];
        const extensionModule = require(modulePath);
        const activate = extensionModule?.activate || extensionModule?.default?.activate;
        const deactivate = extensionModule?.deactivate || extensionModule?.default?.deactivate;
        if (typeof activate !== 'function') throw new Error('extension must export activate(api)');
        await activate(createExtensionApi(extensionConfig, manifest, tools));
        if (manifest.tools.length === 0) throw new Error('extension did not register any tools');
        if (typeof deactivate === 'function') {
          extensionHost.deactivators.push({ extensionId: extensionConfig.id, deactivate });
        }
        manifests.push(manifest);
        statuses.push({ id: extensionConfig.id, name: extensionConfig.name, enabled: true, ok: true, toolCount: manifest.tools.length });
      } catch (error) {
        for (const toolName of tools.keys()) {
          if (!existingToolNames.has(toolName)) tools.delete(toolName);
        }
        statuses.push({ id: extensionConfig.id, name: extensionConfig.name, enabled: true, ok: false, error: error?.message || String(error), toolCount: 0 });
        windowDebugLog('extension:loadFailed', { extensionId: extensionConfig.id, path: extensionConfig.path, error: error?.message || String(error) });
      }
    }
    extensionHost.manifests = manifests;
    extensionHost.tools = tools;
    extensionHost.statuses = statuses;
    extensionHost.loaded = true;
    extensionHost.configKey = configKey;
    return extensionHost;
  })();
  try {
    return await extensionHost.loading;
  } finally {
    extensionHost.loading = null;
  }
}

function desktopExtensionManifests() {
  return extensionHost.manifests;
}

async function executeDesktopExtensionTool(toolName, args, context = {}) {
  const loaded = await loadDesktopExtensions();
  const tool = loaded.tools.get(toolName);
  if (!tool) throw new Error(`unknown desktop extension tool: ${toolName}`);
  return tool.execute(args || {}, {
    ...context,
    toolName,
    extensionId: tool.extensionId,
    localToolName: tool.name,
  });
}

function normalizeExtensionApprovalDecision(value) {
  if (value === false || value === 'never') return false;
  if (value && typeof value === 'object' && Object.prototype.hasOwnProperty.call(value, 'approvalRequired')) {
    return value.approvalRequired !== false;
  }
  if (value && typeof value === 'object' && Object.prototype.hasOwnProperty.call(value, 'required')) {
    return value.required !== false;
  }
  return true;
}

async function evaluateDesktopExtensionApproval(toolName, args, context = {}) {
  const loaded = await loadDesktopExtensions();
  const tool = loaded.tools.get(toolName);
  if (!tool) throw new Error(`unknown desktop extension tool: ${toolName}`);
  if (typeof tool.approval !== 'function') return true;
  const decision = await tool.approval(args || {}, {
    ...context,
    toolName,
    extensionId: tool.extensionId,
    localToolName: tool.name,
  });
  return normalizeExtensionApprovalDecision(decision);
}

function stopExtensionBridge() {
  extensionBridge.stopped = true;
  if (extensionBridge.reconnectTimer) {
    clearTimeout(extensionBridge.reconnectTimer);
    extensionBridge.reconnectTimer = null;
  }
  if (extensionBridge.socket) {
    try {
      extensionBridge.socket.close(1000, 'desktop bridge stopped');
    } catch {
      // Closing the bridge is best-effort during app shutdown.
    }
    extensionBridge.socket = null;
  }
}

function scheduleExtensionBridgeReconnect() {
  if (extensionBridge.stopped || extensionBridge.reconnectTimer) return;
  const delay = extensionBridge.reconnectDelayMs;
  extensionBridge.reconnectDelayMs = Math.min(30_000, Math.round(delay * 1.8));
  extensionBridge.reconnectTimer = setTimeout(() => {
    extensionBridge.reconnectTimer = null;
    void startExtensionBridge();
  }, delay);
}

async function startExtensionBridge() {
  const config = readConfig();
  if (!config.extensionBridgeEnabled || !config.deviceId || !config.deviceToken) return;
  await loadDesktopExtensions();
  let WebSocketCtor = globalThis.WebSocket;
  if (typeof WebSocketCtor !== 'function') {
    try {
      WebSocketCtor = require('ws');
    } catch {
      WebSocketCtor = null;
    }
  }
  if (typeof WebSocketCtor !== 'function') {
    windowDebugLog('extensionBridge:unavailable', { reason: 'WebSocket is not available in Electron main' });
    return;
  }
  if (extensionBridge.socket && [0, 1].includes(extensionBridge.socket.readyState)) return;
  extensionBridge.stopped = false;
  let socket;
  try {
    socket = new WebSocketCtor(extensionBridgeUrl(config));
  } catch (error) {
    windowDebugLog('extensionBridge:connectFailed', { error: error?.message || String(error) });
    scheduleExtensionBridgeReconnect();
    return;
  }
  extensionBridge.socket = socket;
  socket.addEventListener('open', () => {
    extensionBridge.reconnectDelayMs = 1000;
    socket.send(JSON.stringify({
      type: 'extension_hello',
      manifests: desktopExtensionManifests(),
      sentAt: new Date().toISOString(),
    }));
    windowDebugLog('extensionBridge:open', { deviceId: config.deviceId ? `${config.deviceId.slice(0, 12)}...` : '' });
  });
  socket.addEventListener('message', async (event) => {
    let message;
    try {
      message = JSON.parse(String(event.data));
    } catch {
      return;
    }
    if (message.type === 'server_ping') {
      socket.send(JSON.stringify({ type: 'client_ping', sentAt: new Date().toISOString(), serverSentAt: message.sentAt }));
      return;
    }
    if (message.type === 'extension_tool_request') {
      const requestId = String(message.requestId || '');
      const toolName = String(message.toolName || '');
      try {
        const result = await executeDesktopExtensionTool(toolName, message.args, {
          requestId,
          threadId: message.threadId || null,
          runId: message.runId || null,
          toolCallId: message.toolCallId || null,
        });
        socket.send(JSON.stringify({ type: 'extension_tool_result', requestId, ok: true, result }));
      } catch (error) {
        socket.send(JSON.stringify({
          type: 'extension_tool_result',
          requestId,
          ok: false,
          error: error?.message || String(error),
        }));
      }
    }
    if (message.type === 'extension_approval_request') {
      const requestId = String(message.requestId || '');
      const toolName = String(message.toolName || '');
      try {
        const approvalRequired = await evaluateDesktopExtensionApproval(toolName, message.args, {
          requestId,
          threadId: message.threadId || null,
        });
        socket.send(JSON.stringify({ type: 'extension_approval_result', requestId, ok: true, approvalRequired }));
      } catch (error) {
        socket.send(JSON.stringify({
          type: 'extension_approval_result',
          requestId,
          ok: false,
          error: error?.message || String(error),
        }));
      }
    }
  });
  socket.addEventListener('close', (event) => {
    if (extensionBridge.socket === socket) extensionBridge.socket = null;
    windowDebugLog('extensionBridge:closed', { code: event.code, reason: event.reason });
    if (!extensionBridge.stopped) scheduleExtensionBridgeReconnect();
  });
  socket.addEventListener('error', () => {
    windowDebugLog('extensionBridge:error');
  });
}

function restartExtensionBridge() {
  stopExtensionBridge();
  extensionBridge.stopped = false;
  void startExtensionBridge();
}

function windowFromEvent(event) {
  return BrowserWindow.fromWebContents(event.sender) || mainWindow;
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const typeBuffer = Buffer.from(type, 'ascii');
  const length = Buffer.alloc(4);
  const crc = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 0);
  return Buffer.concat([length, typeBuffer, data, crc]);
}

function trayModeLabel(mode) {
  const labels = {
    off: 'Off',
    awake: 'Awake',
    sleeping: 'Asleep',
    recording: 'Recording',
    transcribing: 'Working',
    error: 'Error',
  };
  return labels[mode] || 'Voice';
}

function normalizeTrayMode(mode) {
  const value = String(mode || '').trim().toLowerCase();
  if (value === 'asleep' || value === 'sleep') return 'sleeping';
  if (['off', 'awake', 'sleeping', 'recording', 'transcribing', 'error'].includes(value)) return value;
  return 'off';
}

function trayModeColor(mode) {
  const colors = {
    off: [118, 124, 135],
    awake: [36, 181, 116],
    sleeping: [245, 158, 11],
    recording: [239, 68, 68],
    transcribing: [56, 137, 255],
    error: [220, 38, 38],
  };
  return colors[normalizeTrayMode(mode)] || colors.off;
}

function trayStatusTooltip() {
  const label = trayModeLabel(trayStatus.mode);
  const detail = String(trayStatus.status || '').trim();
  return detail && detail !== label ? `Drone: ${label}\n${detail}` : `Drone: ${label}`;
}

function trayStatusMenuTemplate() {
  return [
    { label: `Status: ${trayModeLabel(trayStatus.mode)}`, enabled: false },
    { type: 'separator' },
    { label: 'Show Drone', click: showMainWindow },
    { type: 'separator' },
    {
      label: 'Quit',
      click: () => {
        isQuitting = true;
        app.quit();
      },
    },
  ];
}

function applyTrayStatus() {
  if (!tray) return;
  tray.setImage(trayIconImage(trayStatus.mode));
  tray.setToolTip(trayStatusTooltip());
  tray.setContextMenu(Menu.buildFromTemplate(trayStatusMenuTemplate()));
}

function updateTrayStatus(mode, status) {
  trayStatus = {
    mode: normalizeTrayMode(mode),
    status: String(status || trayModeLabel(normalizeTrayMode(mode))),
  };
  applyTrayStatus();
  return trayStatus;
}

function trayIconPngBuffer(mode = trayStatus.mode) {
  const size = 32;
  const raw = Buffer.alloc(size * (1 + size * 4));
  const [baseR, baseG, baseB] = trayModeColor(mode);

  function setPixel(x, y, r, g, b, a) {
    const offset = y * (1 + size * 4) + 1 + x * 4;
    raw[offset] = r;
    raw[offset + 1] = g;
    raw[offset + 2] = b;
    raw[offset + 3] = a;
  }

  for (let y = 0; y < size; y += 1) {
    raw[y * (1 + size * 4)] = 0;
    for (let x = 0; x < size; x += 1) {
      const dx = x + 0.5 - 16;
      const dy = y + 0.5 - 16;
      const distance = Math.sqrt(dx * dx + dy * dy);
      if (distance <= 15) {
        const alpha = distance < 14 ? 255 : Math.round((15 - distance) * 255);
        setPixel(x, y, baseR, baseG, baseB, alpha);
      }
    }
  }

  for (let y = 8; y <= 18; y += 1) {
    for (let x = 13; x <= 18; x += 1) {
      const roundedTop = y < 11 && (x < 14 || x > 17);
      const roundedBottom = y > 15 && (x < 14 || x > 17);
      if (!roundedTop && !roundedBottom) setPixel(x, y, 255, 255, 255, 255);
    }
  }
  for (let y = 19; y <= 23; y += 1) {
    for (let x = 15; x <= 16; x += 1) setPixel(x, y, 255, 255, 255, 255);
  }
  for (let y = 24; y <= 25; y += 1) {
    for (let x = 11; x <= 20; x += 1) setPixel(x, y, 255, 255, 255, 255);
  }

  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8;
  header[9] = 6;
  header[10] = 0;
  header[11] = 0;
  header[12] = 0;

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', header),
    pngChunk('IDAT', zlib.deflateSync(raw)),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

function trayIconImage(mode = trayStatus.mode) {
  const image = nativeImage.createFromBuffer(trayIconPngBuffer(mode));
  if (process.platform === 'darwin') image.setTemplateImage(false);
  return image;
}

function showMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    createWindow();
    return;
  }
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
  sendWindowState(mainWindow);
  mainWindow.webContents.invalidate?.();
  windowDebugLog('showMainWindow', { snapshot: windowSnapshot(mainWindow) });
}

function ensureTray() {
  if (tray) return tray;
  tray = new Tray(trayIconImage());
  applyTrayStatus();
  tray.on('click', showMainWindow);
  tray.on('double-click', showMainWindow);
  return tray;
}

function hideToTray(win) {
  if (!win || win.isDestroyed()) return;
  ensureTray();
  win.hide();
  windowDebugLog('hideToTray', { snapshot: windowSnapshot(win) });
}

function createWindow() {
  const initialBounds = centeredFullBounds(null);
  windowDebugLog('createWindow:start', {
    initialBounds,
    shouldStartCompact: shouldStartCompact(),
    config: (() => {
      const config = readConfig();
      return {
        serverUrl: config.serverUrl,
        webUrl: config.webUrl,
        deviceId: config.deviceId ? `${config.deviceId.slice(0, 12)}...` : '',
        hasDeviceToken: Boolean(config.deviceToken),
      };
    })(),
  });
  const win = new BrowserWindow({
    ...initialBounds,
    minWidth: fullWindow.minWidth,
    minHeight: fullWindow.minHeight,
    title: 'Drone',
    backgroundColor: '#101216',
    frame: false,
    resizable: true,
    alwaysOnTop: false,
    skipTaskbar: false,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
    },
  });

  win.removeMenu();
  win.loadFile(path.join(__dirname, 'index.html'));
  mainWindow = win;
  win.once('ready-to-show', () => {
    windowDebugLog('ready-to-show', { snapshot: windowSnapshot(win), shouldStartCompact: shouldStartCompact() });
    if (shouldStartCompact()) {
      applyCompactMode(win);
    } else {
      applySignedOutMode(win);
    }
  });
  win.webContents.once('did-finish-load', () => {
    windowDebugLog('did-finish-load', { snapshot: windowSnapshot(win) });
    sendWindowState(win);
  });
  win.on('close', (event) => {
    if (isQuitting) return;
    event.preventDefault();
    hideToTray(win);
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
    showMainWindow();
  });

  app.on('open-url', (event, url) => {
    event.preventDefault();
    queuePairingPayload(url);
  });

  registerProtocolClient();

  ipcMain.handle('config:read', () => readConfig());
  ipcMain.handle('pairing:takePending', () => pendingPairingPayloads.splice(0));
  ipcMain.handle('config:write', (_event, config) => {
    const saved = writeConfig(config);
    restartExtensionBridge();
    return saved;
  });
  ipcMain.handle('extensions:reload', async () => {
    extensionHost.loaded = false;
    extensionHost.configKey = '';
    await loadDesktopExtensions({ force: true });
    restartExtensionBridge();
    return { ok: true, statuses: extensionHost.statuses, manifests: extensionHost.manifests };
  });
  ipcMain.handle('extensions:status', async () => {
    await loadDesktopExtensions();
    return { ok: true, statuses: extensionHost.statuses, manifests: extensionHost.manifests };
  });
  ipcMain.handle('extensions:addFile', async (_event, filePath) => addExtensionFileToConfig(filePath));
  ipcMain.handle('extensions:chooseFile', async (event) => {
    const owner = BrowserWindow.fromWebContents(event.sender) || mainWindow;
    const result = await dialog.showOpenDialog(owner, {
      title: 'Add local extension',
      properties: ['openFile'],
      filters: [
        { name: 'Extension files', extensions: ['cjs', 'js'] },
        { name: 'All files', extensions: ['*'] },
      ],
    });
    if (result.canceled || !result.filePaths[0]) return { ok: false, canceled: true };
    return addExtensionFileToConfig(result.filePaths[0]);
  });
  ipcMain.handle('app:openExternal', (_event, url) => shell.openExternal(url));
  ipcMain.handle('clipboard:writeText', (_event, text) => {
    clipboard.writeText(String(text || ''));
    return { ok: true };
  });
  ipcMain.handle('debug:window', (_event, message, details) => {
    windowDebugLog(String(message || 'renderer'), { renderer: details || {}, snapshot: windowSnapshot(mainWindow) });
    return { ok: true };
  });
  ipcMain.handle('window:state', () => windowStatePayload());
  ipcMain.handle('window:compact', (event) => applyCompactMode(windowFromEvent(event)));
  ipcMain.handle('window:expand', (event) => applyExpandedMode(windowFromEvent(event)));
  ipcMain.handle('window:signedOut', (event) => applySignedOutMode(windowFromEvent(event)));
  ipcMain.handle('window:close', (event) => {
    const win = windowFromEvent(event);
    hideToTray(win);
  });
  ipcMain.handle('tray:status', (_event, payload) => updateTrayStatus(payload?.mode, payload?.status));
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
    ensureTray();
    createWindow();
    void startExtensionBridge();
  });

  app.on('window-all-closed', () => {
    if (isQuitting && process.platform !== 'darwin') app.quit();
  });

  app.on('activate', () => {
    showMainWindow();
  });

  app.on('before-quit', () => {
    isQuitting = true;
    stopExtensionBridge();
    void deactivateDesktopExtensions();
    releaseVosk();
  });
}
