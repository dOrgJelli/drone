const { app, BrowserWindow, ipcMain, shell } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

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

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
