const desktop = window.voiceStreamDesktop;

const state = {
  config: null,
  dashboard: null,
  activeThreadId: null,
  stream: null,
  audioContext: null,
  processor: null,
  voiceSocket: null,
  voiceSessionId: null,
  voiceTarget: 'assistant',
  mode: 'off',
  voiceSettings: null,
  recognition: null,
  lastRecognizedText: '',
  lastRecognizedAt: 0,
  analyser: null,
  meterFrame: 0,
};

const els = {
  connectionDot: document.querySelector('#connectionDot'),
  connectionLabel: document.querySelector('#connectionLabel'),
  deviceLabel: document.querySelector('#deviceLabel'),
  openWebButton: document.querySelector('#openWebButton'),
  saveButton: document.querySelector('#saveButton'),
  serverUrlInput: document.querySelector('#serverUrlInput'),
  deviceNameInput: document.querySelector('#deviceNameInput'),
  authModeInput: document.querySelector('#authModeInput'),
  bearerTokenInput: document.querySelector('#bearerTokenInput'),
  devEmailInput: document.querySelector('#devEmailInput'),
  devNameInput: document.querySelector('#devNameInput'),
  devAdminInput: document.querySelector('#devAdminInput'),
  pairButton: document.querySelector('#pairButton'),
  awakeButton: document.querySelector('#awakeButton'),
  startMicButton: document.querySelector('#startMicButton'),
  sleepButton: document.querySelector('#sleepButton'),
  stopMicButton: document.querySelector('#stopMicButton'),
  offButton: document.querySelector('#offButton'),
  wakePhraseForm: document.querySelector('#wakePhraseForm'),
  wakePhraseInput: document.querySelector('#wakePhraseInput'),
  micStatus: document.querySelector('#micStatus'),
  meterBar: document.querySelector('#meterBar'),
  newThreadButton: document.querySelector('#newThreadButton'),
  messages: document.querySelector('#messages'),
  messageForm: document.querySelector('#messageForm'),
  messageInput: document.querySelector('#messageInput'),
  refreshButton: document.querySelector('#refreshButton'),
  logs: document.querySelector('#logs'),
};

function trimSlash(value) {
  return String(value || '').replace(/\/+$/, '');
}

function readFormConfig() {
  return {
    ...state.config,
    serverUrl: trimSlash(els.serverUrlInput.value),
    deviceName: els.deviceNameInput.value.trim() || 'Desktop voice client',
    authMode: els.authModeInput.value,
    bearerToken: els.bearerTokenInput.value.trim(),
    devEmail: els.devEmailInput.value.trim() || 'desktop@example.local',
    devName: els.devNameInput.value.trim() || 'Desktop Operator',
    devAdmin: els.devAdminInput.checked,
  };
}

function applyConfig(config) {
  state.config = config;
  els.serverUrlInput.value = config.serverUrl;
  els.deviceNameInput.value = config.deviceName;
  els.authModeInput.value = config.authMode;
  els.bearerTokenInput.value = config.bearerToken;
  els.devEmailInput.value = config.devEmail;
  els.devNameInput.value = config.devName;
  els.devAdminInput.checked = Boolean(config.devAdmin);
  updateConnection('idle', config.deviceId ? 'Device paired' : 'Ready', config.deviceId ? `${config.deviceName} · ${config.deviceId.slice(0, 12)}` : 'No device paired');
}

function headers() {
  const config = readFormConfig();
  const next = { 'content-type': 'application/json' };
  if (config.authMode === 'bearer' && config.bearerToken) {
    next.authorization = `Bearer ${config.bearerToken}`;
  } else {
    next['x-voice-dev-user-email'] = config.devEmail;
    next['x-voice-dev-user-name'] = config.devName;
    next['x-voice-dev-admin'] = config.devAdmin ? '1' : '0';
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
  const body = text ? JSON.parse(text) : null;
  if (!response.ok) throw new Error(body?.error || `${response.status} ${response.statusText}`);
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

function setMode(mode, status) {
  state.mode = mode;
  if (status) showStatus(status);
  updateVoiceButtons();
}

function updateVoiceButtons() {
  const streaming = Boolean(state.voiceSocket || state.stream);
  els.startMicButton.disabled = streaming || state.mode === 'sleeping';
  els.stopMicButton.disabled = !streaming;
  els.awakeButton.disabled = streaming && state.mode === 'recording';
  els.sleepButton.disabled = state.mode === 'off' && !streaming;
}

function renderMessages(messages) {
  els.messages.innerHTML = '';
  if (!messages.length) {
    els.messages.innerHTML = '<div class="empty">No messages in this thread yet.</div>';
    return;
  }
  for (const message of messages) {
    const item = document.createElement('div');
    item.className = `message ${message.role}`;
    item.textContent = message.content;
    els.messages.appendChild(item);
  }
  els.messages.scrollTop = els.messages.scrollHeight;
}

function renderLogs(logs) {
  els.logs.innerHTML = '';
  if (!logs.length) {
    els.logs.innerHTML = '<div class="empty">No client logs yet.</div>';
    return;
  }
  for (const log of logs.slice(0, 40)) {
    const item = document.createElement('div');
    item.className = 'log-row';
    item.innerHTML = `<strong>${escapeHtml(log.level)}</strong><span>${escapeHtml(log.source)}</span><p>${escapeHtml(log.message)}</p>`;
    els.logs.appendChild(item);
  }
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' })[char]);
}

async function loadDashboard() {
  updateConnection('pending', 'Connecting', 'Loading dashboard');
  const dashboard = await api('/api/dashboard');
  state.dashboard = dashboard;
  state.voiceSettings = dashboard.settings;
  state.activeThreadId = state.activeThreadId || dashboard.threads[0]?.id || null;
  renderLogs(dashboard.logs);
  updateConnection('ok', 'Connected', state.config.deviceId ? `${state.config.deviceName} · ${state.config.deviceId.slice(0, 12)}` : `${dashboard.user.displayName}`);
  if (state.activeThreadId) await loadMessages();
}

async function loadVoiceSettings() {
  if (state.voiceSettings) return state.voiceSettings;
  const data = await api('/api/settings/voice-approval');
  state.voiceSettings = {
    unlockCode: data.settings.unlockCode,
    lockCode: data.settings.lockCode,
    offCode: data.settings.lockedOffCode,
  };
  return state.voiceSettings;
}

async function loadMessages() {
  if (!state.activeThreadId) {
    renderMessages([]);
    return;
  }
  const data = await api(`/api/assistant/threads/${encodeURIComponent(state.activeThreadId)}/messages`);
  renderMessages(data.messages);
}

async function pairDevice() {
  const config = readFormConfig();
  const data = await api('/api/devices', {
    method: 'POST',
    body: JSON.stringify({ deviceType: 'desktop', displayName: config.deviceName }),
  });
  applyConfig(await desktop.writeConfig({ ...config, deviceId: data.device.id, deviceToken: data.token }));
  showStatus('Desktop device paired.');
  await loadDashboard();
}

async function createThread() {
  const data = await api('/api/assistant/threads', {
    method: 'POST',
    body: JSON.stringify({ title: 'Desktop voice thread' }),
  });
  state.activeThreadId = data.thread.id;
  await loadDashboard();
}

async function sendMessage(event) {
  event.preventDefault();
  const content = els.messageInput.value.trim();
  if (!content) return;
  if (!state.activeThreadId) await createThread();
  els.messageInput.value = '';
  const data = await api(`/api/assistant/threads/${encodeURIComponent(state.activeThreadId)}/messages`, {
    method: 'POST',
    body: JSON.stringify({ content }),
  });
  renderMessages([...(document.querySelectorAll('.message').length ? [] : []), ...data.messages]);
  await loadMessages();
}

async function startMic(target = 'assistant') {
  stopWakeListener();
  if (!state.config.deviceId) await pairDevice();
  const session = await api('/api/voice/sessions', {
    method: 'POST',
    body: JSON.stringify({ deviceId: state.config.deviceId, mode: target }),
  });
  state.voiceSessionId = session.session.id;
  state.voiceTarget = cleanVoiceTarget(target);
  state.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  const context = new AudioContext({ sampleRate: 16000 });
  state.audioContext = context;
  const source = context.createMediaStreamSource(state.stream);
  state.analyser = context.createAnalyser();
  state.analyser.fftSize = 256;
  state.processor = context.createScriptProcessor(4096, 1, 1);
  state.voiceSocket = openVoiceSocket(state.voiceTarget);
  state.processor.onaudioprocess = (event) => {
    if (!state.voiceSocket || state.voiceSocket.readyState !== WebSocket.OPEN) return;
    const input = event.inputBuffer.getChannelData(0);
    state.voiceSocket.send(floatToPcm16(input));
  };
  source.connect(state.analyser);
  source.connect(state.processor);
  state.processor.connect(context.destination);
  setMode('recording', recordingStatus(state.voiceTarget));
  await api('/api/logs', { method: 'POST', body: JSON.stringify({ source: 'desktop', level: 'info', message: 'Desktop microphone capture started' }) });
  renderMeter();
}

async function stopMic(nextMode = 'awake') {
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
  cancelAnimationFrame(state.meterFrame);
  els.meterBar.style.width = '0%';
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
    socket.send(JSON.stringify({ type: 'client_hello', protocolVersion: 1, client: 'electron-fallback', mode: target }));
    showStatus('Voice stream connected.');
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
        setMode('awake');
      }
      if (message.type === 'transcript_result') {
        showStatus(message.status || 'Transcript patched into chat.');
        setMode('awake');
      }
      if (message.type === 'sleep') {
        if (target === 'clipboard') {
          const copied = await copyText(message.transcriptText || '');
          showStatus(copied ? 'Copied voice transcription.' : 'No voice transcription detected.');
        } else {
          showStatus('Awake. Waiting for wake phrase.');
        }
        setMode('awake');
      }
      if (message.type === 'assistant_error') {
        showStatus(message.error || 'Voice runtime failed.');
        setMode('awake');
      }
    } catch {
      // Ignore non-protocol text frames in the fallback desktop shell.
    }
  };
  socket.onclose = () => showStatus('Voice stream closed.');
  socket.onerror = () => showStatus('Voice stream error.');
  return socket;
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

function approvalCodeFromText(text) {
  const words = String(text || '').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  const start = words.findIndex((word, index) => word === 'approval' && words[index + 1] === 'code');
  if (start < 0) return null;
  const digitMap = { zero: '0', oh: '0', o: '0', one: '1', won: '1', two: '2', too: '2', to: '2', three: '3', tree: '3', four: '4', for: '4', five: '5', six: '6', seven: '7', eight: '8', ate: '8', nine: '9', niner: '9' };
  const digits = words.slice(start + 2).map((word) => digitMap[word] || (/^\d$/.test(word) ? word : '')).join('').slice(0, 8);
  return digits.length >= 4 ? digits : null;
}

function enterAwake() {
  setMode('awake', 'Awake. Say or enter "hey sebastian" to start recording.');
  startWakeListener();
}

async function enterSleep() {
  if (state.voiceSocket || state.stream) await stopMic('sleeping');
  const settings = await loadVoiceSettings().catch(() => null);
  setMode('sleeping', settings ? `Sleep: ${settings.unlockCode} awake, ${settings.offCode} off.` : 'Sleeping.');
  startWakeListener();
}

async function turnOff() {
  if (state.voiceSocket || state.stream) await stopMic('off');
  stopWakeListener();
  setMode('off', 'Off.');
}

async function processApprovalCode(code) {
  const settings = await loadVoiceSettings();
  if (state.mode === 'sleeping' && code === settings.unlockCode) {
    setMode('awake', 'Unlocked.');
    return;
  }
  if (code === settings.offCode) {
    await turnOff();
    return;
  }
  if (state.mode !== 'sleeping' && code === settings.lockCode) {
    await enterSleep();
    return;
  }
  if (state.mode === 'sleeping') {
    showStatus(`Sleep: ${settings.unlockCode} awake, ${settings.offCode} off.`);
    return;
  }
  await api('/api/voice/approval-codes', { method: 'POST', body: JSON.stringify({ code, source: 'desktop' }) });
  showStatus(`Approval sent: ${code}.`);
  await loadDashboard();
}

async function processWakePhrase(event) {
  event.preventDefault();
  const text = els.wakePhraseInput.value.trim();
  els.wakePhraseInput.value = '';
  await processPhraseText(text);
}

async function processPhraseText(text) {
  const approvalCode = approvalCodeFromText(text);
  if (approvalCode) {
    await processApprovalCode(approvalCode);
    return;
  }
  const match = wakePhraseMatch(text);
  if (!match) {
    showStatus('No wake command matched.');
    return;
  }
  if (match === 'sleep') {
    await enterSleep();
    return;
  }
  if (match === 'status') {
    showStatus(`Mode: ${state.mode}. Device: ${state.config?.deviceId ? state.config.deviceId.slice(0, 12) : 'unpaired'}.`);
    return;
  }
  if (state.mode === 'sleeping') {
    showStatus('Sleeping. Use the unlock code or Awake first.');
    return;
  }
  if (state.mode === 'off') enterAwake();
  await startMic(match === 'patch' || match === 'clipboard' ? match : 'assistant');
}

function startWakeListener() {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) {
    showStatus('Awake. Type a wake phrase for this desktop runtime.');
    return;
  }
  if (state.recognition) {
    showStatus('Awake. Listening for wake phrases.');
    return;
  }
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
  recognition.onerror = () => showStatus('Wake listener paused. Type a wake phrase if needed.');
  recognition.onend = () => {
    state.recognition = null;
    if (state.mode !== 'off' && !state.stream) {
      window.setTimeout(() => startWakeListener(), 350);
    }
  };
  state.recognition = recognition;
  try {
    recognition.start();
    showStatus('Awake. Listening for wake phrases.');
  } catch {
    state.recognition = null;
    showStatus('Awake. Type a wake phrase for this desktop runtime.');
  }
}

function stopWakeListener() {
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

function renderMeter() {
  if (!state.analyser || !state.stream) return;
  const data = new Uint8Array(state.analyser.frequencyBinCount);
  state.analyser.getByteFrequencyData(data);
  const average = data.reduce((sum, value) => sum + value, 0) / data.length;
  els.meterBar.style.width = `${Math.min(100, Math.round(average))}%`;
  state.meterFrame = requestAnimationFrame(renderMeter);
}

els.saveButton.addEventListener('click', async () => {
  applyConfig(await desktop.writeConfig(readFormConfig()));
  await loadDashboard().catch((err) => showStatus(err.message));
});
els.pairButton.addEventListener('click', () => pairDevice().catch((err) => showStatus(err.message)));
els.refreshButton.addEventListener('click', () => loadDashboard().catch((err) => showStatus(err.message)));
els.newThreadButton.addEventListener('click', () => createThread().catch((err) => showStatus(err.message)));
els.messageForm.addEventListener('submit', (event) => sendMessage(event).catch((err) => showStatus(err.message)));
els.startMicButton.addEventListener('click', () => startMic().catch((err) => showStatus(err.message)));
els.stopMicButton.addEventListener('click', () => stopMic().catch((err) => showStatus(err.message)));
els.awakeButton.addEventListener('click', () => enterAwake());
els.sleepButton.addEventListener('click', () => enterSleep().catch((err) => showStatus(err.message)));
els.offButton.addEventListener('click', () => turnOff().catch((err) => showStatus(err.message)));
els.wakePhraseForm.addEventListener('submit', (event) => processWakePhrase(event).catch((err) => showStatus(err.message)));
els.openWebButton.addEventListener('click', () => {
  const config = readFormConfig();
  void desktop.openExternal(config.webUrl || config.serverUrl);
});

desktop.readConfig().then((config) => {
  applyConfig(config);
  updateVoiceButtons();
  return loadDashboard();
}).catch((err) => showStatus(err.message));
