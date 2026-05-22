const desktop = window.voiceStreamDesktop;

const PRE_ROLL_MAX_BYTES = pcmBytesForMs(1500);
const MAX_PENDING_STREAM_BYTES = pcmBytesForMs(5000);
const BASE_RECONNECT_DELAY_MS = 500;
const MAX_RECONNECT_DELAY_MS = 10_000;
const MAX_RECONNECT_EXPONENT = 4;

const preRollBuffer = new PcmCaptureBuffer(PRE_ROLL_MAX_BYTES);
const pendingStreamBuffer = new PcmCaptureBuffer(MAX_PENDING_STREAM_BYTES);

const state = {
  config: null,
  dashboard: null,
  activeThreadId: null,
  stream: null,
  audioContext: null,
  processor: null,
  voiceSocket: null,
  voiceOutgoingReady: false,
  voiceReconnectAttempt: 0,
  voiceReconnecting: false,
  voiceReconnectTimer: null,
  voiceStreamEnding: false,
  wakeUsesVosk: false,
  controlSocket: null,
  voiceSessionId: null,
  voiceTarget: 'assistant',
  mode: 'off',
  voiceSettings: null,
  recognition: null,
  wakeStream: null,
  wakeAudioContext: null,
  wakeProcessor: null,
  wakeUnsubscribe: null,
  wakeStarting: false,
  lastRecognizedText: '',
  lastRecognizedAt: 0,
  approvalRecognizer: new ApprovalCodeRecognizer(),
  approvalFinalizeTimer: null,
  analyser: null,
  meterFrame: 0,
  compact: true,
};

const els = {
  connectionDot: document.querySelector('#connectionDot'),
  connectionLabel: document.querySelector('#connectionLabel'),
  deviceLabel: document.querySelector('#deviceLabel'),
  openWebButton: document.querySelector('#openWebButton'),
  signInButton: document.querySelector('#signInButton'),
  compactButton: document.querySelector('#compactButton'),
  closeButton: document.querySelector('#closeButton'),
  expandButton: document.querySelector('#expandButton'),
  saveButton: document.querySelector('#saveButton'),
  serverUrlInput: document.querySelector('#serverUrlInput'),
  deviceNameInput: document.querySelector('#deviceNameInput'),
  authStatus: document.querySelector('#authStatus'),
  pairingMessage: document.querySelector('#pairingMessage'),
  pairButton: document.querySelector('#pairButton'),
  primaryVoiceButton: document.querySelector('#primaryVoiceButton'),
  primaryVoiceMode: document.querySelector('#primaryVoiceMode'),
  primaryVoiceAction: document.querySelector('#primaryVoiceAction'),
  offButton: document.querySelector('#offButton'),
  micStatus: document.querySelector('#micStatus'),
  meterBar: document.querySelector('#meterBar'),
};

function trimSlash(value) {
  return String(value || '').replace(/\/+$/, '');
}

function deriveWebUrl(config) {
  if (config.webUrl) return trimSlash(config.webUrl);
  const serverUrl = trimSlash(config.serverUrl);
  if (!serverUrl) return '';
  try {
    const url = new URL(serverUrl);
    if (url.port === '3299') {
      url.port = '5185';
      return trimSlash(url.toString());
    }
  } catch {
    // Fall back to the server URL when it is not a valid absolute URL.
  }
  return serverUrl;
}

function authSessionFields(config) {
  const next = { ...config };
  if (next.authMode === 'bearer' && next.bearerToken) {
    next.authSavedAt = new Date().toISOString();
  }
  if (next.authMode !== 'bearer') {
    next.authSavedAt = '';
  }
  return next;
}

function updateAuthStatus(kind, message) {
  els.authStatus.className = `auth-status ${kind === 'ok' ? 'ok' : kind === 'error' ? 'error' : 'muted'}`;
  els.authStatus.textContent = message;
}

function authGuidance(config) {
  const webUrl = deriveWebUrl(config);
  return webUrl
    ? `Sign in at ${webUrl}, then reopen the desktop app.`
    : 'Sign in on the web dashboard, then reopen the desktop app.';
}

function showPairingMessage(message, kind = 'muted') {
  els.pairingMessage.textContent = message;
  els.pairingMessage.className = kind === 'error' ? 'error' : 'muted';
}

function readFormConfig() {
  return {
    ...state.config,
    serverUrl: trimSlash(els.serverUrlInput.value),
    deviceName: els.deviceNameInput.value.trim() || 'Desktop voice client',
  };
}

function applyConfig(config) {
  state.config = config;
  els.serverUrlInput.value = config.serverUrl;
  els.deviceNameInput.value = config.deviceName;
  updateConnection('idle', config.deviceId ? 'Desktop connected' : 'Ready', config.deviceId ? `${config.deviceName} · ${config.deviceId.slice(0, 12)}` : 'No device connected');
  if (config.authMode === 'bearer') {
    if (config.bearerToken) {
      updateAuthStatus('idle', config.authSavedAt ? `Signed in ${new Date(config.authSavedAt).toLocaleString()}.` : 'Signed in.');
    } else {
      updateAuthStatus('error', 'Sign in on the web dashboard to use this server.');
    }
  } else {
    updateAuthStatus('idle', 'Local development session.');
  }
}

function headers() {
  const config = readFormConfig();
  const next = { 'content-type': 'application/json' };
  if (config.authMode === 'bearer' && config.bearerToken) {
    next.authorization = `Bearer ${config.bearerToken}`;
  } else {
    next['x-voice-dev-user-email'] = config.devEmail || 'desktop@example.local';
    next['x-voice-dev-user-name'] = config.devName || 'Desktop Operator';
    next['x-voice-dev-admin'] = '0';
  }
  return next;
}

async function api(path, init = {}) {
  const config = readFormConfig();
  const response = await fetch(`${trimSlash(config.serverUrl)}${path}`, {
    ...init,
    headers: { ...headers(), ...(init.headers || {}) },
  });
  const text = await response.text();
  let body = null;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = { error: text };
    }
  }
  if (!response.ok) {
    const err = new Error(body?.error || `${response.status} ${response.statusText}`);
    err.statusCode = response.status;
    if (response.status === 401 || response.status === 403) {
      err.authFailure = true;
      updateAuthStatus('error', `Auth failed (${response.status}). ${authGuidance(config)}`);
    }
    throw err;
  }
  if (config.authMode === 'bearer' && config.bearerToken) {
    updateAuthStatus('ok', `Signed in${config.authSavedAt ? ` · ${new Date(config.authSavedAt).toLocaleString()}` : ''}.`);
  } else if (config.authMode === 'dev') {
    updateAuthStatus('ok', 'Connected to local development server.');
  }
  return body;
}

function updateConnection(kind, label, detail) {
  els.connectionDot.className = `dot ${kind}`;
  els.connectionLabel.textContent = label;
  els.deviceLabel.textContent = detail;
}

function showStatus(message) {
  els.micStatus.textContent = message;
}

function applyWindowState(windowState) {
  state.compact = Boolean(windowState?.compact);
  document.body.classList.toggle('is-compact', state.compact);
  els.compactButton.hidden = state.compact;
  els.expandButton.hidden = !state.compact;
}

function setMode(mode, status) {
  state.mode = mode;
  if (status) showStatus(status);
  updateVoiceButtons();
  void reportClientStatus(mode, status || els.micStatus.textContent || mode);
}

async function reportClientStatus(mode, status) {
  if (!state.config?.deviceId || !state.config?.deviceToken) return;
  if (state.controlSocket?.readyState === WebSocket.OPEN) {
    state.controlSocket.send(JSON.stringify({
      type: 'client_status',
      mode,
      status,
      microphone: 'Desktop microphone',
      protocolVersion: 1,
      appVersion: 'electron-fallback',
      reportedAt: new Date().toISOString(),
    }));
    return;
  }
  ensureControlSocket();
  await api(`/api/devices/${encodeURIComponent(state.config.deviceId)}/status`, {
    method: 'POST',
    body: JSON.stringify({
      token: state.config.deviceToken,
      mode,
      status,
      microphone: 'Desktop microphone',
      protocolVersion: 1,
      appVersion: 'electron-fallback',
    }),
  }).catch(() => undefined);
}

function ensureControlSocket() {
  if (!state.config?.deviceId || !state.config?.deviceToken) return;
  if (state.controlSocket && state.controlSocket.readyState <= WebSocket.OPEN) return;
  const url = new URL(`/api/devices/${encodeURIComponent(state.config.deviceId)}/control`, trimSlash(state.config.serverUrl));
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  url.searchParams.set('token', state.config.deviceToken);
  const socket = new WebSocket(url.toString());
  socket.onopen = () => {
    socket.send(JSON.stringify({
      type: 'client_status',
      mode: state.mode,
      status: els.micStatus.textContent || state.mode,
      microphone: 'Desktop microphone',
      protocolVersion: 1,
      appVersion: 'electron-fallback',
      reportedAt: new Date().toISOString(),
    }));
  };
  socket.onmessage = (event) => {
    if (typeof event.data !== 'string') return;
    const message = JSON.parse(event.data);
    if (message.type === 'server_ping') {
      socket.send(JSON.stringify({ type: 'client_ping', sentAt: new Date().toISOString() }));
      return;
    }
    if (message.type === 'server_command') {
      handleRemoteControlCommand(message, socket);
    }
  };
  socket.onclose = () => {
    if (state.controlSocket === socket) state.controlSocket = null;
  };
  socket.onerror = () => {
    if (state.controlSocket === socket) state.controlSocket = null;
  };
  state.controlSocket = socket;
}

function handleRemoteControlCommand(message, socket) {
  const command = String(message?.command ?? '');
  const commandId = String(message?.commandId ?? '');
  const ack = (payload) => {
    if (socket.readyState !== WebSocket.OPEN) return;
    socket.send(JSON.stringify({ type: 'command_ack', commandId, command, ...payload }));
  };
  try {
    if (command === 'query_status') {
      ack({ ok: true, mode: state.mode, status: els.micStatus.textContent || state.mode });
      void reportClientStatus(state.mode, els.micStatus.textContent || state.mode);
      return;
    }
    if (command === 'sleep') {
      void enterSleep().then(() => ack({ ok: true, mode: 'sleeping', status: els.micStatus.textContent || 'Sleeping.' }));
      return;
    }
    if (command === 'off') {
      void turnOff().then(() => ack({ ok: true, mode: 'off', status: 'Off.' }));
      return;
    }
    if (command === 'awake') {
      enterAwake();
      ack({ ok: true, mode: 'awake', status: els.micStatus.textContent || 'Awake.' });
      return;
    }
    ack({ ok: false, error: 'unknown command' });
  } catch (err) {
    ack({ ok: false, error: err?.message ?? String(err) });
  }
}

function updateVoiceButtons() {
  const streaming = Boolean(state.voiceSocket || state.stream);
  const labels = {
    off: ['Off', 'Start voice'],
    awake: ['Awake', 'Sleep'],
    sleeping: ['Sleeping', 'Wake'],
    recording: ['Recording', 'Stop'],
    transcribing: ['Transcribing', 'Working'],
    error: ['Voice error', 'Retry'],
  };
  const [modeLabel, actionLabel] = labels[state.mode] || ['Voice', 'Toggle'];
  els.primaryVoiceMode.textContent = modeLabel;
  els.primaryVoiceAction.textContent = actionLabel;
  els.primaryVoiceButton.disabled = state.mode === 'transcribing';
  els.primaryVoiceButton.className = `voice-orb is-${state.mode}`;
  els.primaryVoiceButton.setAttribute('aria-label', `${actionLabel} desktop voice`);
  els.primaryVoiceButton.setAttribute('aria-pressed', String(streaming || state.mode === 'awake'));
  els.offButton.hidden = state.mode === 'off';
  els.offButton.disabled = state.mode === 'transcribing';
}

function clearVoiceReconnectTimer() {
  if (state.voiceReconnectTimer) {
    window.clearTimeout(state.voiceReconnectTimer);
    state.voiceReconnectTimer = null;
  }
  state.voiceReconnecting = false;
}

function flushPendingStreamFrames() {
  const socket = state.voiceSocket;
  if (!socket || socket.readyState !== WebSocket.OPEN) return;
  for (const frame of pendingStreamBuffer.drain()) {
    socket.send(frame);
  }
}

function sendOrBufferStreamFrame(pcmBuffer) {
  if (state.voiceOutgoingReady && state.voiceSocket?.readyState === WebSocket.OPEN) {
    flushPendingStreamFrames();
    state.voiceSocket.send(pcmBuffer);
    return;
  }
  if (state.mode === 'recording') {
    pendingStreamBuffer.push(pcmBuffer);
  }
}

function pushPreRollFrame(pcmBuffer) {
  if (state.mode === 'recording' || state.mode === 'off') return;
  preRollBuffer.push(pcmBuffer);
}

function handleWakeAudioFrame(pcmBuffer) {
  pushPreRollFrame(pcmBuffer);
  if (state.wakeUsesVosk && desktop.sendVoskFrame) {
    desktop.sendVoskFrame(pcmBuffer);
  }
}

function reconnectDelayLabel(delayMs) {
  return delayMs < 1000 ? `${delayMs}ms` : `${Math.round(delayMs / 1000)}s`;
}

function scheduleVoiceReconnect() {
  if (state.mode !== 'recording' || state.voiceStreamEnding || !state.voiceSessionId) return;
  if (state.voiceReconnecting) return;
  state.voiceReconnecting = true;
  const attempt = Math.min(state.voiceReconnectAttempt, MAX_RECONNECT_EXPONENT);
  state.voiceReconnectAttempt += 1;
  const delayMs = Math.min(MAX_RECONNECT_DELAY_MS, BASE_RECONNECT_DELAY_MS * (2 ** attempt));
  showStatus(`Reconnecting voice stream in ${reconnectDelayLabel(delayMs)}.`);
  state.voiceReconnectTimer = window.setTimeout(() => {
    state.voiceReconnectTimer = null;
    state.voiceReconnecting = false;
    if (state.mode !== 'recording' || state.voiceStreamEnding) return;
    state.voiceOutgoingReady = false;
    const previousSocket = state.voiceSocket;
    if (previousSocket) {
      previousSocket.onclose = null;
      previousSocket.onerror = null;
      previousSocket.onmessage = null;
      try {
        previousSocket.close();
      } catch {
        // Ignore stale socket cleanup errors during reconnect.
      }
    }
    state.voiceSocket = openVoiceSocket(state.voiceTarget);
  }, delayMs);
}

function resetVoiceStreamState() {
  clearVoiceReconnectTimer();
  state.voiceOutgoingReady = false;
  state.voiceReconnectAttempt = 0;
  state.voiceStreamEnding = false;
  pendingStreamBuffer.clear();
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' })[char]);
}

async function loadDashboard() {
  updateConnection('pending', 'Connecting', 'Loading dashboard');
  try {
    const dashboard = await api('/api/dashboard');
    state.dashboard = dashboard;
    state.voiceSettings = dashboard.settings;
    if (state.voiceSettings) {
      state.approvalRecognizer.configure({
        triggerPhrase: state.voiceSettings.triggerPhrase,
        minDigits: state.voiceSettings.minDigits,
        maxDigits: state.voiceSettings.maxDigits,
        stableMs: state.voiceSettings.stableMs,
        collectTimeoutMs: state.voiceSettings.collectTimeoutMs,
        duplicateCooldownMs: state.voiceSettings.duplicateCooldownMs,
        finalizeCheckIntervalMs: state.voiceSettings.finalizeCheckIntervalMs,
      });
    }
    updateConnection('ok', 'Connected', state.config.deviceId ? `${state.config.deviceName} · ${state.config.deviceId.slice(0, 12)}` : `${dashboard.user.displayName}`);
    showPairingMessage(state.config.deviceId ? 'Desktop connected.' : `Signed in as ${dashboard.user.displayName}. Connect this desktop before recording.`);
  } catch (err) {
    updateConnection('error', 'Connection failed', err?.message || 'Could not reach server');
    if (err?.authFailure) {
      showStatus(err.message);
    }
    throw err;
  }
}

async function applyPairingPayload(rawPayload) {
  const payload = String(rawPayload || '').trim();
  if (!payload) {
    showPairingMessage('Paste a pairing payload or ws:// server URL first.', 'error');
    return;
  }
  if (isUpdatePayload(payload)) {
    handleUpdatePayload(parseUpdatePayload(payload));
    return;
  }

  let config;
  try {
    config = parsePairingPayload(payload);
  } catch (err) {
    showPairingMessage(`Pairing failed: ${err.message}`, 'error');
    return;
  }

  if (!clientVersionSupported(config.minClientVersion)) {
    showPairingMessage(`This server requires desktop client version ${config.minClientVersion} or newer.`, 'error');
    return;
  }
  if (pairingPayloadExpired(config.expiresAt)) {
    showPairingMessage(`Pairing payload expired at ${config.expiresAt}. Generate a new payload from the dashboard.`, 'error');
    return;
  }

  const current = readFormConfig();
  const nextConfig = {
    ...current,
    serverUrl: config.serverUrl,
    deviceName: config.deviceName || current.deviceName,
  };

  if (!config.deviceId) {
    applyConfig(await desktop.writeConfig(nextConfig));
    showPairingMessage('Server URL saved from pairing payload. Pair this desktop or paste a full payload with device credentials.');
    showStatus('Server URL saved from pairing payload.');
    await loadDashboard().catch((err) => showStatus(err.message));
    return;
  }

  const paired = await desktop.writeConfig({
    ...nextConfig,
    deviceId: config.deviceId,
    deviceToken: config.token,
  });
  applyConfig(paired);
  ensureControlSocket();
  showPairingMessage(`Paired ${config.deviceId.slice(0, 14)} from pairing payload.`);
  showStatus(`Paired ${config.deviceId.slice(0, 14)} from pairing payload.`);
  await loadDashboard().catch((err) => showStatus(err.message));
}

function handleUpdatePayload(update) {
  showPairingMessage(`Update QR targets Android build ${update.versionCode}. Desktop updates are installed separately from the dashboard APK flow.`);
  if (update.apkUrl) {
    void desktop.openExternal(update.apkUrl);
  }
}

async function loadVoiceSettings() {
  if (state.voiceSettings) return state.voiceSettings;
  const data = await api('/api/settings/voice-approval');
  state.voiceSettings = data.settings;
  state.approvalRecognizer.configure({
    triggerPhrase: data.settings.triggerPhrase,
    minDigits: data.settings.minDigits,
    maxDigits: data.settings.maxDigits,
    stableMs: data.settings.stableMs,
    collectTimeoutMs: data.settings.collectTimeoutMs,
    duplicateCooldownMs: data.settings.duplicateCooldownMs,
    finalizeCheckIntervalMs: data.settings.finalizeCheckIntervalMs,
  });
  return state.voiceSettings;
}

async function pairDevice() {
  const config = readFormConfig();
  const data = await api('/api/devices', {
    method: 'POST',
    body: JSON.stringify({ deviceType: 'desktop', displayName: config.deviceName }),
  });
  applyConfig(await desktop.writeConfig({ ...config, deviceId: data.device.id, deviceToken: data.token }));
  ensureControlSocket();
  showPairingMessage('Desktop connected.');
  showStatus('Desktop connected.');
  await loadDashboard();
}

async function startMic(target = 'assistant', options = {}) {
  stopWakeListener();
  if (!state.config.deviceId) await pairDevice();
  const session = await api('/api/voice/sessions', {
    method: 'POST',
    body: JSON.stringify({ deviceId: state.config.deviceId, mode: target }),
  });
  state.voiceSessionId = session.session.id;
  state.voiceTarget = cleanVoiceTarget(target);
  resetVoiceStreamState();
  pendingStreamBuffer.pushAll(preRollBuffer.drain());
  if (options.cue) playLocalVoiceCue(options.cue);
  state.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  const context = new AudioContext({ sampleRate: 16000 });
  state.audioContext = context;
  const source = context.createMediaStreamSource(state.stream);
  state.analyser = context.createAnalyser();
  state.analyser.fftSize = 256;
  state.processor = context.createScriptProcessor(4096, 1, 1);
  state.voiceSocket = openVoiceSocket(state.voiceTarget);
  state.processor.onaudioprocess = (event) => {
    sendOrBufferStreamFrame(floatToPcm16(event.inputBuffer.getChannelData(0)));
  };
  source.connect(state.analyser);
  source.connect(state.processor);
  state.processor.connect(context.destination);
  setMode('recording', recordingStatus(state.voiceTarget));
  await api('/api/logs', { method: 'POST', body: JSON.stringify({ source: 'desktop', level: 'info', message: 'Desktop microphone capture started' }) });
  renderMeter();
}

async function stopMic(nextMode = 'awake', options = {}) {
  state.voiceStreamEnding = true;
  clearVoiceReconnectTimer();
  const localSocket = state.voiceSocket;
  if (localSocket) {
    localSocket.send(JSON.stringify({ type: 'end' }));
    setTimeout(() => localSocket.close(), 1200);
  }
  if (state.processor) {
    state.processor.disconnect();
  }
  if (state.audioContext) {
    await state.audioContext.close().catch(() => {});
  }
  if (state.stream) {
    state.stream.getTracks().forEach((track) => track.stop());
  }
  state.stream = null;
  state.audioContext = null;
  state.processor = null;
  state.voiceSocket = null;
  state.voiceSessionId = null;
  resetVoiceStreamState();
  cancelAnimationFrame(state.meterFrame);
  els.meterBar.style.width = '0%';
  if (options.cue !== null) {
    playLocalVoiceCue(options.cue ?? 'stop_button');
  }
  setMode(nextMode, 'Capture stopped.');
  if (nextMode !== 'off') startWakeListener();
  await api('/api/logs', { method: 'POST', body: JSON.stringify({ source: 'desktop', level: 'info', message: 'Desktop microphone capture stopped' }) });
  await loadDashboard();
}

function openVoiceSocket(target) {
  const config = readFormConfig();
  const url = new URL('/api/voice/stream', trimSlash(config.serverUrl));
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  url.searchParams.set('deviceId', state.config.deviceId);
  url.searchParams.set('token', state.config.deviceToken);
  if (state.voiceSessionId) url.searchParams.set('sessionId', state.voiceSessionId);
  url.searchParams.set('mode', target);
  const socket = new WebSocket(url.toString());
  socket.binaryType = 'arraybuffer';
  socket.onopen = () => {
    state.voiceReconnectAttempt = 0;
    state.voiceOutgoingReady = true;
    socket.send(JSON.stringify({ type: 'client_hello', protocolVersion: 1, client: 'electron-fallback', mode: target }));
    flushPendingStreamFrames();
    showStatus(recordingStatus(target));
  };
  socket.onmessage = async (event) => {
    if (typeof event.data !== 'string') {
      playWav(event.data);
      return;
    }
    try {
      const message = JSON.parse(event.data);
      if (message.type === 'server_ping') {
        socket.send(JSON.stringify({ type: 'client_ping', sentAt: new Date().toISOString() }));
      }
      if (message.type === 'assistant_result') {
        showStatus(`Transcript: ${message.transcript || 'empty'} / Reply: ${message.assistantText || 'empty'}`);
        await finishMicFromServer();
      }
      if (message.type === 'transcript_result') {
        showStatus(message.status || 'Transcript patched into chat.');
        await finishMicFromServer();
      }
      if (message.type === 'sleep') {
        if (target === 'clipboard') {
          const copied = await copyText(message.transcriptText || '');
          showStatus(copied ? 'Copied voice transcription.' : 'No voice transcription detected.');
        } else {
          showStatus('Awake. Waiting for voice command.');
        }
        await finishMicFromServer();
      }
      if (message.type === 'assistant_error') {
        showStatus(message.error || 'Voice runtime failed.');
        await finishMicFromServer();
      }
    } catch {
      // Ignore non-protocol text frames in the fallback desktop shell.
    }
  };
  socket.onclose = () => {
    state.voiceOutgoingReady = false;
    if (state.mode === 'recording' && !state.voiceStreamEnding) {
      showStatus('Voice stream disconnected.');
      scheduleVoiceReconnect();
      return;
    }
    if (!state.voiceStreamEnding) {
      showStatus('Voice stream closed.');
    }
  };
  socket.onerror = () => {
    state.voiceOutgoingReady = false;
    if (state.mode === 'recording' && !state.voiceStreamEnding) {
      showStatus('Voice stream error.');
      scheduleVoiceReconnect();
    }
  };
  return socket;
}

async function finishMicFromServer() {
  state.voiceStreamEnding = true;
  clearVoiceReconnectTimer();
  if (state.processor) state.processor.disconnect();
  if (state.audioContext) await state.audioContext.close().catch(() => {});
  if (state.stream) state.stream.getTracks().forEach((track) => track.stop());
  if (state.voiceSocket) state.voiceSocket.close();
  state.stream = null;
  state.audioContext = null;
  state.processor = null;
  state.voiceSocket = null;
  state.voiceSessionId = null;
  resetVoiceStreamState();
  cancelAnimationFrame(state.meterFrame);
  els.meterBar.style.width = '0%';
  setMode('awake', els.micStatus.textContent || 'Awake. Waiting for voice command.');
  startWakeListener();
  await loadDashboard().catch(() => {});
}

function floatToPcm16(input) {
  const output = new Int16Array(input.length);
  for (let index = 0; index < input.length; index += 1) {
    const sample = Math.max(-1, Math.min(1, input[index]));
    output[index] = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
  }
  return output.buffer;
}

function cleanVoiceTarget(target) {
  return target === 'patch' || target === 'clipboard' ? target : 'assistant';
}

function recordingStatus(target) {
  if (target === 'patch') return 'Patching voice transcript into chat.';
  if (target === 'clipboard') return 'Recording clipboard transcription.';
  return 'Streaming microphone frames to the VoiceStream service.';
}

async function copyText(text) {
  const trimmed = String(text || '').trim();
  if (!trimmed) return false;
  if (desktop.writeClipboard) {
    desktop.writeClipboard(trimmed);
    return true;
  }
  if (!navigator.clipboard) return false;
  try {
    await navigator.clipboard.writeText(trimmed);
    return true;
  } catch {
    return false;
  }
}

function playWav(data) {
  const audio = new Audio(URL.createObjectURL(new Blob([data], { type: 'audio/wav' })));
  void audio.play().catch(() => undefined);
}

function resetApprovalCollection() {
  if (state.approvalFinalizeTimer) {
    window.clearTimeout(state.approvalFinalizeTimer);
    state.approvalFinalizeTimer = null;
  }
  state.approvalRecognizer.reset();
}

function scheduleApprovalFinalize() {
  if (state.approvalFinalizeTimer) window.clearTimeout(state.approvalFinalizeTimer);
  state.approvalFinalizeTimer = window.setTimeout(() => {
    state.approvalFinalizeTimer = null;
    handleApprovalUpdate(state.approvalRecognizer.flush(Date.now()));
    if (state.approvalRecognizer.isCollecting && state.mode !== 'off') {
      scheduleApprovalFinalize();
    }
  }, state.approvalRecognizer.finalizeCheckIntervalMs());
}

function showCollectingStatus(partialCode) {
  const nextStatus = partialCode
    ? (state.mode === 'sleeping' ? `Unlock: ${partialCode}` : `Approval: ${partialCode}`)
    : (state.mode === 'sleeping' ? 'Unlock code...' : 'Approval code...');
  showStatus(nextStatus);
}

function handleApprovalUpdate(update) {
  if (update.type === 'none') return false;
  if (update.type === 'collecting') {
    showCollectingStatus(update.partialCode);
    return true;
  }
  if (update.type === 'cancelled') {
    showStatus('Approval cancelled.');
    return true;
  }
  void processApprovalCode(update.code);
  return true;
}

function acceptApprovalText(text, finalizeNow = false) {
  const now = Date.now();
  let update = state.approvalRecognizer.accept(text, now);
  if (state.approvalRecognizer.isCollecting) {
    if (finalizeNow) {
      update = state.approvalRecognizer.flush(now + (state.voiceSettings?.stableMs ?? 900));
    } else {
      scheduleApprovalFinalize();
    }
  }
  if (update.type === 'none') {
    return state.approvalRecognizer.isCollecting;
  }
  return handleApprovalUpdate(update);
}

function wakePhraseMatch(text) {
  const words = String(text || '').toLowerCase().split(/[^a-z]+/).filter(Boolean);
  const compact = words.join('');
  if (words.some((word, index) => word === 'go' && words[index + 1] === 'to' && words[index + 2] === 'sleep')) return 'sleep';
  if (words.some((word, index) => (word === 'hey' || word === 'hay') && words[index + 1] === 'sebastian')) return 'start';
  if (words.some((word, index) => word === 'patch' && words[index + 1] === 'me' && words[index + 2] === 'in')) return 'patch';
  if (words.includes('transcribe')) return 'clipboard';
  if (words.includes('status') || compact === 'stateus' || compact === 'checkstatus') return 'status';
  return null;
}

async function enterAwake() {
  resetApprovalCollection();
  await loadVoiceSettings().catch(() => null);
  setMode('awake', 'Awake. Say "hey Sebastian" to start recording.');
  startWakeListener();
}

async function enterSleep() {
  if (state.voiceSocket || state.stream) await stopMic('sleeping', { cue: null });
  resetApprovalCollection();
  playLocalVoiceCue('sleep');
  const settings = await loadVoiceSettings().catch(() => null);
  setMode('sleeping', settings ? `Sleep: ${settings.unlockCode} awake, ${settings.lockedOffCode} off.` : 'Sleeping.');
  startWakeListener();
}

async function turnOff(options = {}) {
  if (state.voiceSocket || state.stream) await stopMic('off', { cue: null });
  stopWakeListener();
  resetApprovalCollection();
  preRollBuffer.clear();
  playLocalVoiceCue(options.cue || 'stop_button');
  setMode('off', 'Off.');
}

async function processApprovalCode(code) {
  const settings = await loadVoiceSettings();
  if (state.mode === 'sleeping' && code === settings.unlockCode) {
    playLocalVoiceCue('unlock');
    setMode('awake', 'Unlocked.');
    return;
  }
  if (code === settings.lockedOffCode) {
    await turnOff({ cue: 'sleeping_off' });
    return;
  }
  if (state.mode !== 'sleeping' && code === settings.lockCode) {
    await enterSleep();
    return;
  }
  if (state.mode === 'sleeping') {
    showStatus(`Sleep: ${settings.unlockCode} awake, ${settings.lockedOffCode} off.`);
    return;
  }
  playLocalVoiceCue('status');
  await api('/api/voice/approval-codes', { method: 'POST', body: JSON.stringify({ code, source: 'desktop' }) });
  showStatus(`Approval sent: ${code}.`);
  await loadDashboard();
}

async function processPhraseText(text, finalizeNow = false) {
  if (acceptApprovalText(text, finalizeNow)) return;
  if (state.mode === 'recording') {
    showStatus('Recording. Wake commands are ignored until capture stops.');
    return;
  }
  const match = wakePhraseMatch(text);
  if (!match) {
    const heard = String(text || '').trim();
    showStatus(heard ? `Heard "${heard}". No voice command matched.` : 'No voice command matched.');
    return;
  }
  if (match === 'sleep') {
    await enterSleep();
    return;
  }
  if (match === 'status') {
    playLocalVoiceCue('status');
    showStatus(`Mode: ${state.mode}. Device: ${state.config?.deviceId ? state.config.deviceId.slice(0, 12) : 'unpaired'}.`);
    return;
  }
  if (state.mode === 'sleeping') {
    showStatus('Sleeping. Press Wake or say the unlock code.');
    return;
  }
  if (state.mode === 'off') enterAwake();
  await startMic(match === 'patch' || match === 'clipboard' ? match : 'assistant', { cue: 'wake' });
}

async function startWakeAudioCapture() {
  const media = await navigator.mediaDevices.getUserMedia({ audio: true });
  const context = new AudioContext({ sampleRate: 16000 });
  const source = context.createMediaStreamSource(media);
  const processor = context.createScriptProcessor(4096, 1, 1);
  processor.onaudioprocess = (event) => {
    handleWakeAudioFrame(floatToPcm16(event.inputBuffer.getChannelData(0)));
  };
  source.connect(processor);
  processor.connect(context.destination);
  state.wakeStream = media;
  state.wakeAudioContext = context;
  state.wakeProcessor = processor;
  return true;
}

function startWakeListener() {
  if (state.wakeStarting || state.wakeStream || state.recognition) {
    showStatus('Awake. Listening for voice commands.');
    return;
  }
  if (desktop.startVosk && desktop.sendVoskFrame && desktop.onVoskText) {
    startVoskWakeListener().then((started) => {
      if (!started) startSpeechWakeListener();
    });
    return;
  }
  startSpeechWakeListener();
}

async function startVoskWakeListener() {
  state.wakeStarting = true;
  try {
    const status = await desktop.startVosk();
    if (!status.available) {
      showStatus(status.error ? `Vosk unavailable: ${status.error}` : 'Wake listener unavailable.');
      return false;
    }

    state.wakeUsesVosk = true;
    const unsubscribe = desktop.onVoskText((result) => {
      const text = String(result?.text || '').trim();
      if (!text) return;
      const now = Date.now();
      if (text === state.lastRecognizedText && now - state.lastRecognizedAt < 1500) return;
      state.lastRecognizedText = text;
      state.lastRecognizedAt = now;
      void processPhraseText(text).catch((err) => showStatus(err.message));
    });

    await startWakeAudioCapture();
    state.wakeUnsubscribe = unsubscribe;
    showStatus('Awake. Listening with Vosk.');
    return true;
  } catch (err) {
    stopVoskWakeListener();
    showStatus(err?.message ? `Vosk listener failed: ${err.message}` : 'Vosk listener failed.');
    return false;
  } finally {
    state.wakeStarting = false;
  }
}

function startSpeechWakeListener() {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) {
    showStatus('Awake. Wake phrase recognition is unavailable in this runtime.');
    return;
  }
  if (state.recognition) {
    showStatus('Awake. Listening for voice commands.');
    return;
  }
  state.wakeUsesVosk = false;
  void startWakeAudioCapture().catch((err) => showStatus(err?.message || 'Wake audio capture failed.'));
  const recognition = new SpeechRecognition();
  recognition.continuous = true;
  recognition.interimResults = true;
  recognition.lang = 'en-US';
  recognition.onresult = (event) => {
    const result = event.results[event.results.length - 1];
    const text = result?.[0]?.transcript?.trim();
    if (!text) return;
    const now = Date.now();
    if (text === state.lastRecognizedText && now - state.lastRecognizedAt < 1500) return;
    state.lastRecognizedText = text;
    state.lastRecognizedAt = now;
    void processPhraseText(text).catch((err) => showStatus(err.message));
  };
  recognition.onerror = () => showStatus('Wake listener paused.');
  recognition.onend = () => {
    state.recognition = null;
    if (state.mode !== 'off' && !state.stream) {
      window.setTimeout(() => startWakeListener(), 350);
    }
  };
  state.recognition = recognition;
  try {
    recognition.start();
    showStatus('Awake. Listening for voice commands.');
  } catch {
    state.recognition = null;
    showStatus('Awake. Wake phrase recognition is unavailable in this runtime.');
  }
}

function stopWakeListener() {
  stopVoskWakeListener();
  const recognition = state.recognition;
  if (!recognition) return;
  recognition.onend = null;
  state.recognition = null;
  try {
    recognition.stop();
  } catch {
    // Ignore already-ended SpeechRecognition sessions.
  }
}

function stopVoskWakeListener() {
  if (state.wakeUnsubscribe) state.wakeUnsubscribe();
  state.wakeUnsubscribe = null;
  state.wakeUsesVosk = false;
  if (state.wakeProcessor) state.wakeProcessor.disconnect();
  state.wakeProcessor = null;
  if (state.wakeStream) state.wakeStream.getTracks().forEach((track) => track.stop());
  state.wakeStream = null;
  if (state.wakeAudioContext) void state.wakeAudioContext.close().catch(() => {});
  state.wakeAudioContext = null;
  state.wakeStarting = false;
  if (desktop.stopVosk) void desktop.stopVosk();
}

function renderMeter() {
  if (!state.analyser || !state.stream) return;
  const data = new Uint8Array(state.analyser.frequencyBinCount);
  state.analyser.getByteFrequencyData(data);
  const average = data.reduce((sum, value) => sum + value, 0) / data.length;
  els.meterBar.style.width = `${Math.min(100, Math.round(average))}%`;
  state.meterFrame = requestAnimationFrame(renderMeter);
}

async function togglePrimaryVoice() {
  if (state.mode === 'recording' || state.mode === 'transcribing') {
    await stopMic('awake');
    return;
  }
  if (state.mode === 'awake') {
    await enterSleep();
    return;
  }
  await enterAwake();
}

els.saveButton.addEventListener('click', async () => {
  applyConfig(await desktop.writeConfig(authSessionFields(readFormConfig())));
  await loadDashboard().catch((err) => showStatus(err.message));
});
els.pairButton.addEventListener('click', () => pairDevice().catch((err) => showStatus(err.message)));
els.primaryVoiceButton.addEventListener('click', () => togglePrimaryVoice().catch((err) => showStatus(err.message)));
els.offButton.addEventListener('click', () => turnOff().catch((err) => showStatus(err.message)));
els.compactButton.addEventListener('click', () => {
  if (desktop.compactWindow) void desktop.compactWindow().then(applyWindowState);
});
els.expandButton.addEventListener('click', () => {
  if (desktop.expandWindow) void desktop.expandWindow().then(applyWindowState);
});
els.closeButton.addEventListener('click', () => {
  if (desktop.closeWindow) void desktop.closeWindow();
});
els.openWebButton.addEventListener('click', () => {
  const config = readFormConfig();
  void desktop.openExternal(deriveWebUrl(config) || config.serverUrl);
});
els.signInButton.addEventListener('click', () => {
  const config = readFormConfig();
  void desktop.openExternal(deriveWebUrl(config) || config.serverUrl);
  updateAuthStatus('idle', 'Opened the web dashboard for sign in.');
});

if (desktop.onPairingPayload) {
  desktop.onPairingPayload((payload) => {
    void applyPairingPayload(payload).catch((err) => showPairingMessage(err.message, 'error'));
  });
}

if (desktop.onWindowState) {
  desktop.onWindowState(applyWindowState);
}

if (desktop.windowState) {
  desktop.windowState().then(applyWindowState).catch(() => applyWindowState({ compact: true }));
}

desktop.readConfig().then((config) => {
  applyConfig(config);
  ensureControlSocket();
  updateVoiceButtons();
  return loadDashboard();
}).catch((err) => showStatus(err.message));
