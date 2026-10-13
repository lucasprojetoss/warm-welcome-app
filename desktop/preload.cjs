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

  saveMusicCopy(filePath, bytes) {
    return ipcRenderer.invoke('music:save-copy', filePath, bytes);
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

  listQueueLots() {
    return ipcRenderer.invoke('queue:list');
  },

  addQueueLot(payload) {
    return ipcRenderer.invoke('queue:add', payload || {});
  },

  loadQueueLot(id) {
    return ipcRenderer.invoke('queue:load', id);
  },

  updateQueueLot(id, patch) {
    return ipcRenderer.invoke('queue:update', id, patch || {});
  },

  removeQueueLot(id) {
    return ipcRenderer.invoke('queue:remove', id);
  },

  checkPortableUpdate() {
    return ipcRenderer.invoke('portable:update-check');
  },

  installPortableUpdate() {
    return ipcRenderer.invoke('portable:update-install');
  },

  onPortableUpdateProgress(callback) {
    ipcRenderer.removeAllListeners('portable:update-progress');
    ipcRenderer.on('portable:update-progress', (_event, payload) => callback(payload || {}));
  },

  getDiagnostics() {
    return ipcRenderer.invoke('diagnostics:get');
  }
});
