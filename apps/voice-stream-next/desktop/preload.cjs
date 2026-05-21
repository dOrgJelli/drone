const { clipboard, contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('voiceStreamDesktop', {
  isDesktop: true,
  readConfig: () => ipcRenderer.invoke('config:read'),
  writeConfig: (config) => ipcRenderer.invoke('config:write', config),
  openExternal: (url) => ipcRenderer.invoke('app:openExternal', url),
  writeClipboard: (text) => clipboard.writeText(String(text || '')),
});
