const { app, BrowserWindow, session } = require('electron');
const path = require('path');

const APP_URL = 'https://github.io';

async function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    title: "MiniMarker Studio V4",
    autoHideMenuBar: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true
    }
  });

  await session.defaultSession.clearCache();

  // Jika offline atau gagal memuat URL live, langsung buka file lokal bawaan
  win.webContents.on('did-fail-load', () => {
    win.loadFile(path.join(__dirname, 'www', 'index.html'));
  });

  // Pastikan hanya membuka URL aplikasi (tidak membuka github.com)
  win.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith(APP_URL) && !url.startsWith('file://')) {
      event.preventDefault();
      win.loadURL(APP_URL);
    }
  });

  win.loadURL(APP_URL);
}

app.whenReady().then(createWindow);
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
