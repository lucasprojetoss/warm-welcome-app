const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('lucasDesktop', {
  isElectron: true,

  setProcessing(active) {
    ipcRenderer.send('processing:set', Boolean(active));
  },

  updateProgress(status) {
    ipcRenderer.send('processing:progress', status || {});
  },

  notifyComplete(status) {
    ipcRenderer.send('processing:complete', status || {});
  },

  onCompletionChime(callback) {
    ipcRenderer.on('desktop:completion-chime', () => callback());
  },

  getStatus() {
    return ipcRenderer.invoke('desktop:status');
  },

  selectMusicFolder() {
    return ipcRenderer.invoke('music:select-folder');
  },

  loadMusicFolder(folder) {
    return ipcRenderer.invoke('music:load-folder', folder);
  },

  readMusicFile(filePath, start, end) {
    return ipcRenderer.invoke('music:read', filePath, start, end);
  },

  replaceMusicFile(filePath, bytes) {
    return ipcRenderer.invoke('music:replace', filePath, bytes);
  },

  loadDefaults() {
    return ipcRenderer.invoke('defaults:load');
  },

  saveDefaults(payload) {
    return ipcRenderer.invoke('defaults:save', payload || {});
  },

  listProfiles() {
    return ipcRenderer.invoke('profiles:list');
  },

  saveProfile(payload) {
    return ipcRenderer.invoke('profiles:save', payload || {});
  },

  loadProfile(id) {
    return ipcRenderer.invoke('profiles:load', id);
  },

  loadBatchState() {
    return ipcRenderer.invoke('batch:load');
  },

  saveBatchState(state) {
    return ipcRenderer.invoke('batch:save', state || {});
  },

  clearBatchState() {
    return ipcRenderer.invoke('batch:clear');
  },

  getDiagnostics() {
    return ipcRenderer.invoke('diagnostics:get');
  }
});
