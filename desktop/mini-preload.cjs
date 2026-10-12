const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('miniDesktop', {
  onStatus(callback) {
    ipcRenderer.on('mini:status', (_event, status) => callback(status));
  },
  restore() {
    ipcRenderer.send('mini:restore');
  }
});
