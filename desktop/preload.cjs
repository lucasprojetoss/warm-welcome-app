const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('lucasDesktop', {
  isElectron: true,
  setProcessing(active) {
    ipcRenderer.send('processing:set', Boolean(active));
  },
  getStatus() {
    return ipcRenderer.invoke('desktop:status');
  }
});
