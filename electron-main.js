const { app, BrowserWindow, session } = require('electron');
const path = require('path');

const LIVE_URL = 'https://github.io';

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

  // Bersihkan cache HTTP agar selalu mengambil versi terbaru saat online
  await session.defaultSession.clearCache();

  // Jika gagal terhubung (PC sedang offline), otomatis muat versi offline bawaan
  win.webContents.on('did-fail-load', () => {
    win.loadFile(path.join(__dirname, 'www', 'index.html'));
  });

  win.loadURL(LIVE_URL + '?t=' + Date.now());
}

app.whenReady().then(createWindow);
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
