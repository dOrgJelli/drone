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
  startMicButton: document.querySelector('#startMicButton'),
  stopMicButton: document.querySelector('#stopMicButton'),
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
  state.activeThreadId = state.activeThreadId || dashboard.threads[0]?.id || null;
  renderLogs(dashboard.logs);
  updateConnection('ok', 'Connected', state.config.deviceId ? `${state.config.deviceName} · ${state.config.deviceId.slice(0, 12)}` : `${dashboard.user.displayName}`);
  if (state.activeThreadId) await loadMessages();
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

async function startMic() {
  if (!state.config.deviceId) await pairDevice();
  const session = await api('/api/voice/sessions', {
    method: 'POST',
    body: JSON.stringify({ deviceId: state.config.deviceId }),
  });
  state.voiceSessionId = session.session.id;
  state.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  const context = new AudioContext({ sampleRate: 16000 });
  state.audioContext = context;
  const source = context.createMediaStreamSource(state.stream);
  state.analyser = context.createAnalyser();
  state.analyser.fftSize = 256;
  state.processor = context.createScriptProcessor(4096, 1, 1);
  state.voiceSocket = openVoiceSocket();
  state.processor.onaudioprocess = (event) => {
    if (!state.voiceSocket || state.voiceSocket.readyState !== WebSocket.OPEN) return;
    const input = event.inputBuffer.getChannelData(0);
    state.voiceSocket.send(floatToPcm16(input));
  };
  source.connect(state.analyser);
  source.connect(state.processor);
  state.processor.connect(context.destination);
  els.startMicButton.disabled = true;
  els.stopMicButton.disabled = false;
  showStatus('Streaming microphone frames to the VoiceStream service.');
  await api('/api/logs', { method: 'POST', body: JSON.stringify({ source: 'desktop', level: 'info', message: 'Desktop microphone capture started' }) });
  renderMeter();
}

async function stopMic() {
  if (state.voiceSocket) {
    state.voiceSocket.send(JSON.stringify({ type: 'end' }));
    state.voiceSocket.close();
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
  els.startMicButton.disabled = false;
  els.stopMicButton.disabled = true;
  showStatus('Capture stopped.');
  await api('/api/logs', { method: 'POST', body: JSON.stringify({ source: 'desktop', level: 'info', message: 'Desktop microphone capture stopped' }) });
  await loadDashboard();
}

function openVoiceSocket() {
  const config = readFormConfig();
  const url = new URL('/api/voice/stream', trimSlash(config.serverUrl));
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  url.searchParams.set('deviceId', state.config.deviceId);
  url.searchParams.set('token', state.config.deviceToken);
  if (state.voiceSessionId) url.searchParams.set('sessionId', state.voiceSessionId);
  const socket = new WebSocket(url.toString());
  socket.binaryType = 'arraybuffer';
  socket.onopen = () => {
    socket.send(JSON.stringify({ type: 'client_hello', protocolVersion: 1, client: 'electron-fallback' }));
    showStatus('Voice stream connected.');
  };
  socket.onmessage = (event) => {
    if (typeof event.data !== 'string') return;
    try {
      const message = JSON.parse(event.data);
      if (message.type === 'server_ping') {
        socket.send(JSON.stringify({ type: 'client_ping', sentAt: new Date().toISOString() }));
      }
      if (message.type === 'assistant_result') {
        showStatus(`Transcript: ${message.transcript || 'empty'} / Reply: ${message.assistantText || 'empty'}`);
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
els.openWebButton.addEventListener('click', () => {
  const config = readFormConfig();
  void desktop.openExternal(config.webUrl || config.serverUrl);
});

desktop.readConfig().then((config) => {
  applyConfig(config);
  return loadDashboard();
}).catch((err) => showStatus(err.message));
