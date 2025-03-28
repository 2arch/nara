const { contextBridge, ipcRenderer } = require('electron');

// Expose safe IPC API to renderer process
contextBridge.exposeInMainWorld('electronAPI', {
  // Add methods here if needed
});