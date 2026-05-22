const { clipboard, contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('voiceStreamDesktop', {
  isDesktop: true,
  readConfig: () => ipcRenderer.invoke('config:read'),
  writeConfig: (config) => ipcRenderer.invoke('config:write', config),
  openExternal: (url) => ipcRenderer.invoke('app:openExternal', url),
  writeClipboard: (text) => clipboard.writeText(String(text || '')),
  windowState: () => ipcRenderer.invoke('window:state'),
  compactWindow: () => ipcRenderer.invoke('window:compact'),
  expandWindow: () => ipcRenderer.invoke('window:expand'),
  closeWindow: () => ipcRenderer.invoke('window:close'),
  onWindowState: (callback) => {
    const listener = (_event, status) => callback(status);
    ipcRenderer.on('window:state', listener);
    return () => ipcRenderer.removeListener('window:state', listener);
  },
  voskStatus: () => ipcRenderer.invoke('vosk:status'),
  startVosk: () => ipcRenderer.invoke('vosk:start'),
  stopVosk: () => ipcRenderer.invoke('vosk:stop'),
  resetVosk: () => ipcRenderer.invoke('vosk:reset'),
  sendVoskFrame: (frame) => ipcRenderer.send('vosk:frame', frame),
  onVoskStatus: (callback) => {
    const listener = (_event, status) => callback(status);
    ipcRenderer.on('vosk:status', listener);
    return () => ipcRenderer.removeListener('vosk:status', listener);
  },
  onVoskText: (callback) => {
    const listener = (_event, result) => callback(result);
    ipcRenderer.on('vosk:text', listener);
    return () => ipcRenderer.removeListener('vosk:text', listener);
  },
  onPairingPayload: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('pairing:payload', listener);
    void ipcRenderer.invoke('pairing:takePending').then((pending) => {
      for (const payload of pending || []) callback(payload);
    });
    return () => ipcRenderer.removeListener('pairing:payload', listener);
  },
});
