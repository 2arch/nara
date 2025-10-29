const { app, BrowserWindow } = require('electron');
const path = require('path');
const isDev = process.env.ELECTRON_START_URL;

// Set app name and version for About panel
app.setName('Nara');
app.setAboutPanelOptions({
  applicationName: 'Nara',
  applicationVersion: '0.0.1',
  version: '0.0.1',
  copyright: 'Copyright © 2025'
});

function createWindow() {
  const mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js')
    },
    icon: path.join(__dirname, '../public/icon.icns')
  });

  const startUrl = isDev
    ? process.env.ELECTRON_START_URL
    : `file://${path.join(__dirname, '../out/index.html')}`;

  mainWindow.loadURL(startUrl);

  if (isDev) {
    mainWindow.webContents.openDevTools();
  }
}

app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
