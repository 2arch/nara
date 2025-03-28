const { app, BrowserWindow, ipcMain, protocol } = require('electron');
const path = require('path');
const fs = require('fs');
const url = require('url');

let mainWindow;

// Register protocol handler to intercept file requests
function registerProtocolHandlers() {
  protocol.interceptFileProtocol('file', (request, callback) => {
    let urlPath = request.url.substring(7); // remove 'file://'
    
    // On Windows, drive letters might have a '/' prefix
    if (process.platform === 'win32' && urlPath.startsWith('/') && urlPath[2] === ':') {
      urlPath = urlPath.substring(1);
    }
    
    // Handle font requests by checking if they contain IBM-Plex-Mono or Apercu-Pro
    if (urlPath.includes('IBM-Plex-Mono') || urlPath.includes('Apercu-Pro')) {
      console.log('Font requested:', urlPath);
      
      // Try to locate the font in several possible locations
      const possiblePaths = [
        urlPath,  // Original path
        path.join(app.getAppPath(), 'public', 'fonts', path.basename(urlPath)),  // From app public/fonts
        path.join(app.getAppPath(), 'out', '_next', 'static', 'media', path.basename(urlPath)),  // From Next.js output
      ];
      
      // If the filename has a hash, try the original filenames too
      if (urlPath.includes('.')) {
        const baseName = path.basename(urlPath).split('.').pop();
        possiblePaths.push(path.join(app.getAppPath(), 'public', 'fonts', 'IBM-Plex-Mono.ttf'));
        possiblePaths.push(path.join(app.getAppPath(), 'public', 'fonts', 'Apercu-Pro.ttf'));
      }
      
      // Try each path
      for (const testPath of possiblePaths) {
        console.log('Checking path:', testPath);
        if (fs.existsSync(testPath)) {
          console.log('Font found at:', testPath);
          return callback({ path: testPath });
        }
      }
      
      // If we get here, we couldn't find the font
      console.error('Could not find font file');
      return callback({ error: -6 }); // FILE_NOT_FOUND
    }
    
    // Pass through for all other requests
    callback({ path: urlPath });
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js')
    }
  });

  const isDevMode = process.env.ELECTRON_START_URL !== undefined;
  
  let startURL;
  if (isDevMode) {
    startURL = process.env.ELECTRON_START_URL;
    console.log('Loading from dev server:', startURL);
  } else {
    const indexPath = path.join(__dirname, '../out/index.html');
    console.log('Looking for index file at:', indexPath);
    
    if (fs.existsSync(indexPath)) {
      console.log('Found index.html file');
      startURL = url.format({
        pathname: indexPath,
        protocol: 'file:',
        slashes: true
      });
    } else {
      console.error('index.html file not found at path:', indexPath);
      app.quit();
      return;
    }
  }

  mainWindow.loadURL(startURL);

  // Only open DevTools in development mode
  if (isDevMode) {
    mainWindow.webContents.openDevTools();
  }

  // Log any load errors
  mainWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription) => {
    console.error('Failed to load:', errorCode, errorDescription);
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(() => {
  registerProtocolHandlers();
  createWindow();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (mainWindow === null) {
    createWindow();
  }
});