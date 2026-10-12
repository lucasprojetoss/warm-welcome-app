const { app, BrowserWindow, ipcMain, powerSaveBlocker, shell, Menu, screen, dialog, Notification } = require('electron');
const path = require('path');
const fs = require('fs');
const http = require('http');

let loudness = null;
try { loudness = require('loudness'); } catch (_) {}

app.disableHardwareAcceleration();
app.commandLine.appendSwitch('disable-background-timer-throttling');
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
app.commandLine.appendSwitch('disable-renderer-backgrounding');

let mainWindow = null;
let miniWindow = null;
let blockerId = null;
let localServer = null;
let localBaseUrl = null;
let selectedMusicRoot = null;
let processingActive = false;
let popupMode = false;
let fitTimer = null;
let currentProgress = {
  version: '1.2.5',
  total: 0,
  previewReady: 0,
  finalized: 0,
  percent: 0,
  current: 'Aguardando processamento',
  completed: false
};

const LOCAL_PORT = 47831;
const appRoot = path.resolve(__dirname, '..');
const logFile = path.join(__dirname, 'desktop-runtime.log');

function log(...parts) {
  const line = '[' + new Date().toISOString() + '] ' + parts.map(x => {
    if (x instanceof Error) return x.stack || x.message;
    if (typeof x === 'object') {
      try { return JSON.stringify(x); } catch (_) { return String(x); }
    }
    return String(x);
  }).join(' ') + '\n';
  try { fs.appendFileSync(logFile, line, 'utf8'); } catch (_) {}
}

function dataRoot() {
  const dir = path.join(app.getPath('userData'), 'dados');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function profilesRoot() {
  const dir = path.join(dataRoot(), 'perfis');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function settingsPath() {
  return path.join(dataRoot(), 'configuracoes.json');
}

function batchStatePath() {
  return path.join(dataRoot(), 'lote-em-andamento.json');
}

function miniPositionPath() {
  return path.join(dataRoot(), 'posicao-popup.json');
}

function safeJsonRead(file, fallback = null) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (_) { return fallback; }
}

function safeJsonWrite(file, value) {
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2), 'utf8');
  if (fs.existsSync(file)) fs.unlinkSync(file);
  fs.renameSync(tmp, file);
}

function bufferToArrayBuffer(buf) {
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
}

function sanitizeFileName(name, fallback = 'arquivo') {
  const clean = String(name || fallback).replace(/[<>:"/\\|?*\x00-\x1F]/g, '_').trim();
  return clean || fallback;
}

function profileId(name) {
  const base = String(name || 'perfil')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return base || 'perfil';
}

function isInside(root, target) {
  if (!root || !target) return false;
  const r = path.resolve(root);
  const t = path.resolve(target);
  const rel = path.relative(r, t);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

function mimeFor(file) {
  const ext = path.extname(file).toLowerCase();
  return ({
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.mjs': 'text/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.webmanifest': 'application/manifest+json; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon',
    '.mp3': 'audio/mpeg',
    '.wav': 'audio/wav'
  })[ext] || 'application/octet-stream';
}

function startLocalServer() {
  if (localServer && localBaseUrl) return Promise.resolve(localBaseUrl);

  return new Promise((resolve, reject) => {
    localServer = http.createServer((req, res) => {
      try {
        const requestUrl = new URL(req.url, 'http://127.0.0.1');
        let rel = decodeURIComponent(requestUrl.pathname);
        if (rel === '/') rel = '/index.html';

        const requested = path.resolve(appRoot, '.' + rel);
        if (requested !== appRoot && !requested.startsWith(appRoot + path.sep)) {
          res.writeHead(403);
          res.end('Forbidden');
          return;
        }

        fs.stat(requested, (statErr, stat) => {
          if (statErr || !stat.isFile()) {
            res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
            res.end('Arquivo nao encontrado');
            return;
          }

          res.writeHead(200, {
            'Content-Type': mimeFor(requested),
            'Cache-Control': 'no-store'
          });
          fs.createReadStream(requested).pipe(res);
        });
      } catch (error) {
        log('Servidor local:', error);
        res.writeHead(500);
        res.end('Erro interno');
      }
    });

    localServer.on('error', error => {
      log('Falha no servidor local:', error);
      reject(error);
    });

    localServer.listen(LOCAL_PORT, '127.0.0.1', () => {
      localBaseUrl = 'http://127.0.0.1:' + LOCAL_PORT;
      log('Servidor local iniciado em', localBaseUrl);
      resolve(localBaseUrl);
    });
  });
}

function setProcessingProtection(active) {
  processingActive = Boolean(active);
  if (processingActive) {
    if (blockerId === null || !powerSaveBlocker.isStarted(blockerId)) {
      blockerId = powerSaveBlocker.start('prevent-app-suspension');
      log('Protecao contra suspensao ativada:', blockerId);
    }
    return;
  }
  if (blockerId !== null && powerSaveBlocker.isStarted(blockerId)) {
    powerSaveBlocker.stop(blockerId);
  }
  blockerId = null;
  if (miniWindow && !miniWindow.isDestroyed() && !popupMode) miniWindow.hide();
  log('Protecao contra suspensao desativada');
}

function getTargetDisplay() {
  if (mainWindow) {
    try { return screen.getDisplayMatching(mainWindow.getBounds()); } catch (_) {}
  }
  return screen.getPrimaryDisplay();
}

function fitWindowToDisplay(forceBounds = false) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const display = getTargetDisplay();
  const area = display.workArea;
  const width = Math.max(640, Math.floor(area.width * 0.96));
  const height = Math.max(480, Math.floor(area.height * 0.94));

  if (forceBounds) {
    const x = area.x + Math.floor((area.width - width) / 2);
    const y = area.y + Math.floor((area.height - height) / 2);
    mainWindow.setBounds({ x, y, width, height }, false);
  }

  const [contentWidth, contentHeight] = mainWindow.getContentSize();
  const baseW = 1440;
  const baseH = 900;
  const zoom = Math.max(0.72, Math.min(1.08, Math.min(contentWidth / baseW, contentHeight / baseH)));
  mainWindow.webContents.setZoomFactor(zoom);
  log('Ajuste de tela:', { monitor: area, contentWidth, contentHeight, zoom: Number(zoom.toFixed(3)) });
}

function scheduleFit() {
  clearTimeout(fitTimer);
  fitTimer = setTimeout(() => fitWindowToDisplay(false), 120);
}

function positionMiniWindow(useSaved = true) {
  if (!miniWindow || miniWindow.isDestroyed()) return;
  const [w, h] = miniWindow.getSize();

  if (useSaved) {
    const saved = safeJsonRead(miniPositionPath(), null);
    if (saved && Number.isFinite(saved.x) && Number.isFinite(saved.y)) {
      const displays = screen.getAllDisplays();
      const visible = displays.some(d => {
        const a = d.workArea;
        return saved.x < a.x + a.width - 40 &&
               saved.x + w > a.x + 40 &&
               saved.y < a.y + a.height - 30 &&
               saved.y + h > a.y + 30;
      });
      if (visible) {
        miniWindow.setPosition(Math.round(saved.x), Math.round(saved.y), false);
        return;
      }
    }
  }

  const display = getTargetDisplay();
  const area = display.workArea;
  miniWindow.setPosition(area.x + area.width - w - 18, area.y + area.height - h - 18, false);
}

function saveMiniPosition() {
  if (!miniWindow || miniWindow.isDestroyed() || !miniWindow.isVisible()) return;
  const [x, y] = miniWindow.getPosition();
  try { safeJsonWrite(miniPositionPath(), { x, y }); } catch (error) { log('Posicao do popup:', error); }
}

async function createMiniWindow() {
  if (miniWindow && !miniWindow.isDestroyed()) return miniWindow;
  miniWindow = new BrowserWindow({
    width: 340,
    height: 188,
    frame: false,
    resizable: false,
    maximizable: false,
    minimizable: false,
    show: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    transparent: false,
    opacity: 0.94,
    hasShadow: true,
    movable: true,
    backgroundColor: '#101613',
    webPreferences: {
      preload: path.join(__dirname, 'mini-preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false
    }
  });
  miniWindow.setAlwaysOnTop(true, 'floating');
  await miniWindow.loadFile(path.join(__dirname, 'mini.html'));
  miniWindow.on('moved', saveMiniPosition);
  miniWindow.on('closed', () => { miniWindow = null; });
  positionMiniWindow(true);
  return miniWindow;
}

async function ensureMiniPanelVisible() {
  if (!mainWindow || mainWindow.isDestroyed()) throw new Error('Janela principal indisponível.');
  const win = await createMiniWindow();
  positionMiniWindow(true);
  win.webContents.send('mini:status', currentProgress);
  win.showInactive();
  await new Promise(resolve => setTimeout(resolve, 80));
  if (!win.isVisible()) {
    win.show();
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  if (!win.isVisible()) throw new Error('O Windows não exibiu o painel flutuante.');
  return win;
}

async function showMiniPanel() {
  if (!popupMode) return;
  await ensureMiniPanelVisible();
}

async function enterPopupMode() {
  if (!mainWindow || mainWindow.isDestroyed() || popupMode) return;
  try {
    const win = await ensureMiniPanelVisible();
    popupMode = true;
    mainWindow.setSkipTaskbar(true);
    mainWindow.hide();
    win.webContents.send('mini:status', currentProgress);
    log('Modo popup ativado com sucesso');
  } catch (error) {
    popupMode = false;
    log('Falha ao ativar modo popup:', error);
    try {
      mainWindow.setSkipTaskbar(false);
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    } catch (_) {}
  }
}

function restoreMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  popupMode = false;
  mainWindow.setSkipTaskbar(false);
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
  if (miniWindow && !miniWindow.isDestroyed()) miniWindow.hide();
  log('Janela principal restaurada a partir do popup');
}

function updateProgress(payload = {}) {
  currentProgress = {
    ...currentProgress,
    ...payload,
    version: app.getVersion()
  };
  if (miniWindow && !miniWindow.isDestroyed()) {
    miniWindow.webContents.send('mini:status', currentProgress);
  }
}

async function completionSignal() {
  let originalVolume = null;
  try {
    if (process.platform === 'win32' && loudness) {
      originalVolume = await loudness.getVolume();
      const ducked = Math.max(8, Math.min(originalVolume, Math.round(originalVolume * 0.4)));
      if (ducked < originalVolume) await loudness.setVolume(ducked);
    }
  } catch (error) {
    log('Falha ao reduzir volume do Windows:', error);
    originalVolume = null;
  }

  try {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('desktop:completion-chime');
    }
    if (Notification.isSupported()) {
      new Notification({
        title: 'Lucas Gravações',
        body: 'Lote finalizado. Todas as músicas estão prontas.'
      }).show();
    }
  } catch (error) {
    log('Falha no aviso de conclusão:', error);
  }

  setTimeout(async () => {
    if (originalVolume !== null && loudness) {
      try { await loudness.setVolume(originalVolume); }
      catch (error) { log('Falha ao restaurar volume do Windows:', error); }
    }
  }, 950);
}

function recoverInterruptedReplacements(folder) {
  try {
    const entries = fs.readdirSync(folder, { withFileTypes: true }).filter(e => e.isFile()).map(e => e.name);
    for (const name of entries) {
      if (name.endsWith('.lucas-temp')) {
        try { fs.unlinkSync(path.join(folder, name)); } catch (_) {}
      } else if (name.endsWith('.lucas-backup')) {
        const backup = path.join(folder, name);
        const original = backup.slice(0, -'.lucas-backup'.length);
        try {
          if (!fs.existsSync(original)) fs.renameSync(backup, original);
          else fs.unlinkSync(backup);
        } catch (error) { log('Recuperacao de backup:', error); }
      }
    }
  } catch (error) { log('Falha ao verificar temporarios:', error); }
}

function listMp3Files(folder) {
  recoverInterruptedReplacements(folder);
  const names = fs.readdirSync(folder, { withFileTypes: true })
    .filter(entry => entry.isFile() && /\.mp3$/i.test(entry.name) && !/_LucasGravacoes\.mp3$/i.test(entry.name))
    .map(entry => entry.name)
    .sort((a, b) => a.localeCompare(b, 'pt-BR', { numeric: true, sensitivity: 'base' }));

  return names.slice(0, 100).map(name => {
    const filePath = path.join(folder, name);
    const st = fs.statSync(filePath);
    return { name, path: filePath, size: st.size, mtimeMs: st.mtimeMs, type: 'audio/mpeg' };
  });
}

function readMusicFile(filePath, start, end) {
  if (!selectedMusicRoot || !isInside(selectedMusicRoot, filePath)) {
    throw new Error('Arquivo fora da pasta de músicas selecionada.');
  }
  const st = fs.statSync(filePath);
  const from = Math.max(0, Number(start) || 0);
  const to = Math.max(from, Math.min(st.size, Number.isFinite(Number(end)) ? Number(end) : st.size));
  const len = to - from;
  const fd = fs.openSync(filePath, 'r');
  try {
    const buf = Buffer.allocUnsafe(len);
    fs.readSync(fd, buf, 0, len, from);
    return bufferToArrayBuffer(buf);
  } finally {
    fs.closeSync(fd);
  }
}

function sleepSync(ms) {
  const waitBuffer = new Int32Array(new SharedArrayBuffer(4));
  Atomics.wait(waitBuffer, 0, 0, ms);
}

function retryFileOperation(operation, label, attempts = 6) {
  let lastError = null;
  for (let i = 0; i < attempts; i++) {
    try {
      return operation();
    } catch (error) {
      lastError = error;
      if (!['EPERM', 'EACCES', 'EBUSY'].includes(error && error.code)) throw error;
      log(label + ' tentativa ' + (i + 1) + '/' + attempts + ':', error.code);
      sleepSync(80 + i * 60);
    }
  }
  throw lastError;
}

function replaceMusicFileSafely(filePath, bytes) {
  if (!selectedMusicRoot || !isInside(selectedMusicRoot, filePath)) {
    throw new Error('Destino fora da pasta de músicas selecionada.');
  }

  const data = Buffer.from(bytes);
  if (data.length < 1024) throw new Error('MP3 final inválido ou muito pequeno.');
  const hasId3 = data.subarray(0, 3).toString('ascii') === 'ID3';
  const hasFrame = data[0] === 0xff && (data[1] & 0xe0) === 0xe0;
  if (!hasId3 && !hasFrame) throw new Error('Arquivo final não parece ser um MP3 válido.');

  const temp = filePath + '.lucas-temp';
  const backup = filePath + '.lucas-backup';

  try {
    if (fs.existsSync(temp)) fs.unlinkSync(temp);
    if (fs.existsSync(backup)) fs.unlinkSync(backup);

    fs.writeFileSync(temp, data);
    const written = fs.statSync(temp);
    if (written.size !== data.length) throw new Error('Falha ao confirmar o MP3 temporário.');

    if (!fs.existsSync(filePath)) throw new Error('Arquivo original não foi encontrado.');
    retryFileOperation(() => fs.renameSync(filePath, backup), 'Backup do original');

    try {
      retryFileOperation(() => fs.renameSync(temp, filePath), 'Substituição pelo MP3 final');
    } catch (error) {
      if (!fs.existsSync(filePath) && fs.existsSync(backup)) {
        try { retryFileOperation(() => fs.renameSync(backup, filePath), 'Restauração do original'); } catch (_) {}
      }
      throw error;
    }

    try {
      if (fs.existsSync(backup)) retryFileOperation(() => fs.unlinkSync(backup), 'Limpeza do backup');
    } catch (error) {
      log('Backup temporário será limpo depois:', error.code || error.message);
    }

    return { ok: true, path: filePath, size: data.length };
  } finally {
    try { if (fs.existsSync(temp)) fs.unlinkSync(temp); } catch (_) {}
    try {
      if (fs.existsSync(backup) && fs.existsSync(filePath)) fs.unlinkSync(backup);
    } catch (_) {}
  }
}

function saveMusicCopy(filePath, bytes) {
  if (!selectedMusicRoot || !isInside(selectedMusicRoot, filePath)) {
    throw new Error('Destino fora da pasta de músicas selecionada.');
  }
  const data = Buffer.from(bytes);
  if (data.length < 1024) throw new Error('MP3 final inválido ou muito pequeno.');
  const ext = path.extname(filePath) || '.mp3';
  const base = filePath.slice(0, -ext.length);
  const dest = base + '_LucasGravacoes.mp3';
  const temp = dest + '.lucas-temp';
  try {
    if (fs.existsSync(temp)) fs.unlinkSync(temp);
    fs.writeFileSync(temp, data);
    const written = fs.statSync(temp);
    if (written.size !== data.length) throw new Error('Falha ao confirmar o MP3 temporário.');
    if (fs.existsSync(dest)) retryFileOperation(() => fs.unlinkSync(dest), 'Remoção da cópia anterior');
    retryFileOperation(() => fs.renameSync(temp, dest), 'Gravação da cópia final');
    return { ok: true, path: dest, size: data.length };
  } finally {
    try { if (fs.existsSync(temp)) fs.unlinkSync(temp); } catch (_) {}
  }
}

function attachmentFromFile(filePath, type) {
  if (!filePath || !fs.existsSync(filePath)) return null;
  const data = fs.readFileSync(filePath);
  return {
    name: path.basename(filePath),
    type,
    bytes: bufferToArrayBuffer(data)
  };
}

function saveDefaults(payload = {}) {
  const root = dataRoot();
  const old = safeJsonRead(settingsPath(), {}) || {};
  const next = {
    ...old,
    version: 1,
    insertionMode: payload.insertionMode ?? old.insertionMode ?? 'auto',
    manualInsertTime: Number.isFinite(payload.manualInsertTime) ? payload.manualInsertTime : (old.manualInsertTime ?? 30),
    manualDuckDb: Number.isFinite(payload.manualDuckDb) ? payload.manualDuckDb : (old.manualDuckDb ?? -4),
    replaceOriginals: payload.replaceOriginals !== false,
    metadata: {
      artist: payload.metadata?.artist ?? old.metadata?.artist ?? '',
      composer: payload.metadata?.composer ?? old.metadata?.composer ?? '',
      album: payload.metadata?.album ?? old.metadata?.album ?? ''
    },
    jingle: old.jingle || null,
    cover: old.cover || null
  };

  if (payload.removeJingle) {
    if (next.jingle?.path) { try { fs.unlinkSync(next.jingle.path); } catch (_) {} }
    next.jingle = null;
  } else if (payload.jingle?.bytes) {
    const ext = path.extname(payload.jingle.name || '') || '.mp3';
    const dest = path.join(root, 'vinheta-padrao' + ext.toLowerCase());
    fs.writeFileSync(dest, Buffer.from(payload.jingle.bytes));
    next.jingle = { path: dest, name: payload.jingle.name || path.basename(dest), type: payload.jingle.type || 'audio/mpeg' };
  }

  if (payload.removeCover) {
    if (next.cover?.path) { try { fs.unlinkSync(next.cover.path); } catch (_) {} }
    next.cover = null;
  } else if (payload.cover?.bytes) {
    const ext = /png/i.test(payload.cover.type || '') ? '.png' : '.jpg';
    const dest = path.join(root, 'capa-padrao' + ext);
    fs.writeFileSync(dest, Buffer.from(payload.cover.bytes));
    next.cover = { path: dest, name: payload.cover.name || path.basename(dest), type: payload.cover.type || (ext === '.png' ? 'image/png' : 'image/jpeg') };
  }

  safeJsonWrite(settingsPath(), next);
  return next;
}

function loadDefaults() {
  const config = safeJsonRead(settingsPath(), {}) || {};
  return {
    ...config,
    jingleData: config.jingle ? attachmentFromFile(config.jingle.path, config.jingle.type || 'audio/mpeg') : null,
    coverData: config.cover ? attachmentFromFile(config.cover.path, config.cover.type || 'image/jpeg') : null
  };
}

function saveProfile(payload = {}) {
  const name = String(payload.name || '').trim();
  if (!name) throw new Error('Informe um nome para o perfil.');
  const id = profileId(name);
  const dir = path.join(profilesRoot(), id);
  fs.mkdirSync(dir, { recursive: true });

  const config = {
    id,
    name,
    createdAt: new Date().toISOString(),
    insertionMode: payload.config?.insertionMode || 'auto',
    manualInsertTime: Number(payload.config?.manualInsertTime ?? 30),
    manualDuckDb: Number(payload.config?.manualDuckDb ?? -4),
    replaceOriginals: payload.config?.replaceOriginals !== false,
    metadata: payload.config?.metadata || { artist: '', composer: '', album: '' },
    jingle: null,
    cover: null
  };

  if (payload.jingle?.bytes) {
    const ext = path.extname(payload.jingle.name || '') || '.mp3';
    const dest = path.join(dir, 'vinheta' + ext.toLowerCase());
    fs.writeFileSync(dest, Buffer.from(payload.jingle.bytes));
    config.jingle = { path: dest, name: payload.jingle.name || path.basename(dest), type: payload.jingle.type || 'audio/mpeg' };
  }

  if (payload.cover?.bytes) {
    const ext = /png/i.test(payload.cover.type || '') ? '.png' : '.jpg';
    const dest = path.join(dir, 'capa' + ext);
    fs.writeFileSync(dest, Buffer.from(payload.cover.bytes));
    config.cover = { path: dest, name: payload.cover.name || path.basename(dest), type: payload.cover.type || 'image/jpeg' };
  }

  safeJsonWrite(path.join(dir, 'perfil.json'), config);
  return { id, name };
}

function listProfiles() {
  const root = profilesRoot();
  return fs.readdirSync(root, { withFileTypes: true })
    .filter(e => e.isDirectory())
    .map(e => safeJsonRead(path.join(root, e.name, 'perfil.json'), null))
    .filter(Boolean)
    .map(p => ({ id: p.id, name: p.name }))
    .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
}

function loadProfile(id) {
  const dir = path.join(profilesRoot(), profileId(id));
  const config = safeJsonRead(path.join(dir, 'perfil.json'), null);
  if (!config) throw new Error('Perfil não encontrado.');
  return {
    ...config,
    jingleData: config.jingle ? attachmentFromFile(config.jingle.path, config.jingle.type || 'audio/mpeg') : null,
    coverData: config.cover ? attachmentFromFile(config.cover.path, config.cover.type || 'image/jpeg') : null
  };
}

function getDiagnostics() {
  const display = getTargetDisplay();
  let logTail = '';
  try {
    const txt = fs.readFileSync(logFile, 'utf8');
    logTail = txt.slice(-5000);
  } catch (_) {}

  return {
    version: app.getVersion(),
    electron: process.versions.electron,
    node: process.versions.node,
    platform: process.platform,
    monitor: display ? {
      width: display.workArea.width,
      height: display.workArea.height,
      scaleFactor: display.scaleFactor
    } : null,
    zoomFactor: mainWindow && !mainWindow.isDestroyed() ? mainWindow.webContents.getZoomFactor() : 1,
    processingProtected: blockerId !== null && powerSaveBlocker.isStarted(blockerId),
    miniPanel: Boolean(miniWindow && !miniWindow.isDestroyed() && miniWindow.isVisible()),
    selectedFolder: selectedMusicRoot,
    dataFolder: dataRoot(),
    systemAudioDuck: Boolean(loudness && process.platform === 'win32'),
    memory: process.memoryUsage(),
    logTail
  };
}

async function createWindow() {
  const baseUrl = await startLocalServer();
  const display = screen.getPrimaryDisplay();
  const initialArea = display.workArea;
  const initialWidth = Math.max(640, Math.floor(initialArea.width * 0.96));
  const initialHeight = Math.max(480, Math.floor(initialArea.height * 0.94));

  mainWindow = new BrowserWindow({
    width: initialWidth,
    height: initialHeight,
    x: initialArea.x + Math.floor((initialArea.width - initialWidth) / 2),
    y: initialArea.y + Math.floor((initialArea.height - initialHeight) / 2),
    minWidth: 640,
    minHeight: 480,
    show: false,
    backgroundColor: '#111514',
    title: 'Lucas Gravações',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false
    }
  });

  Menu.setApplicationMenu(null);

  mainWindow.webContents.on('did-finish-load', () => {
    log('Interface carregada com sucesso');
    fitWindowToDisplay(false);
  });

  mainWindow.webContents.on('did-fail-load', (_event, code, description, url) => {
    log('did-fail-load:', code, description, url);
  });

  mainWindow.webContents.on('render-process-gone', (_event, details) => {
    log('Renderer encerrado:', details);
  });

  mainWindow.webContents.on('console-message', (_event, level, message, line, sourceId) => {
    log('Interface console:', level, message, sourceId + ':' + line);
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url) && !url.startsWith(baseUrl)) shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith(baseUrl)) event.preventDefault();
  });

  mainWindow.once('ready-to-show', () => mainWindow.show());

  try {
    await mainWindow.loadURL(baseUrl + '/index.html');
  } catch (error) {
    log('Falha ao carregar interface:', error);
  }

  setTimeout(() => {
    if (mainWindow && !mainWindow.isVisible()) mainWindow.show();
  }, 1200);

  mainWindow.on('resize', scheduleFit);
  mainWindow.on('move', scheduleFit);
  mainWindow.on('minimize', event => {
    event.preventDefault();
    enterPopupMode().catch(error => {
      log('Erro inesperado ao minimizar:', error);
      restoreMainWindow();
    });
  });
  mainWindow.on('restore', () => {
    if (!popupMode && miniWindow && !miniWindow.isDestroyed()) miniWindow.hide();
  });
  mainWindow.on('show', () => {
    if (!popupMode && miniWindow && !miniWindow.isDestroyed()) miniWindow.hide();
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
    setProcessingProtection(false);
  });
}

ipcMain.on('processing:set', (_event, active) => setProcessingProtection(Boolean(active)));

ipcMain.on('processing:progress', (_event, payload) => {
  updateProgress(payload || {});
});

ipcMain.on('processing:complete', async (_event, payload) => {
  updateProgress({ ...(payload || {}), completed: true, percent: 100 });
  if (popupMode) await showMiniPanel();
  await completionSignal();
});

ipcMain.on('mini:restore', restoreMainWindow);

ipcMain.handle('desktop:status', () => {
  const display = getTargetDisplay();
  return {
    electron: true,
    version: app.getVersion(),
    processingProtected: blockerId !== null && powerSaveBlocker.isStarted(blockerId),
    localServer: Boolean(localBaseUrl),
    monitor: {
      width: display.workArea.width,
      height: display.workArea.height,
      scaleFactor: display.scaleFactor
    },
    zoomFactor: mainWindow && !mainWindow.isDestroyed() ? mainWindow.webContents.getZoomFactor() : 1
  };
});

ipcMain.handle('music:select-folder', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Selecionar pasta de músicas',
    properties: ['openDirectory']
  });
  if (result.canceled || !result.filePaths[0]) return null;
  selectedMusicRoot = path.resolve(result.filePaths[0]);
  return { folder: selectedMusicRoot, files: listMp3Files(selectedMusicRoot) };
});

ipcMain.handle('music:load-folder', (_event, folder) => {
  const resolved = path.resolve(String(folder || ''));
  if (!fs.existsSync(resolved) || !fs.statSync(resolved).isDirectory()) throw new Error('Pasta não encontrada.');
  selectedMusicRoot = resolved;
  return { folder: selectedMusicRoot, files: listMp3Files(selectedMusicRoot) };
});

ipcMain.handle('music:read', (_event, filePath, start, end) => {
  return readMusicFile(String(filePath), start, end);
});

ipcMain.handle('music:replace', (_event, filePath, bytes) => {
  return replaceMusicFileSafely(String(filePath), bytes);
});
ipcMain.handle('music:save-copy', (_event, filePath, bytes) => {
  return saveMusicCopy(String(filePath), bytes);
});

ipcMain.handle('defaults:load', () => loadDefaults());
ipcMain.handle('defaults:save', (_event, payload) => saveDefaults(payload || {}));

ipcMain.handle('profiles:list', () => listProfiles());
ipcMain.handle('profiles:save', (_event, payload) => saveProfile(payload || {}));
ipcMain.handle('profiles:load', (_event, id) => loadProfile(String(id || '')));

ipcMain.handle('batch:load', () => safeJsonRead(batchStatePath(), null));
ipcMain.handle('batch:save', (_event, state) => {
  safeJsonWrite(batchStatePath(), state || {});
  return true;
});
ipcMain.handle('batch:clear', () => {
  try { if (fs.existsSync(batchStatePath())) fs.unlinkSync(batchStatePath()); } catch (_) {}
  return true;
});

ipcMain.handle('diagnostics:get', () => getDiagnostics());

const gotSingleInstanceLock = app.requestSingleInstanceLock();

if (!gotSingleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) restoreMainWindow();
  });

  app.whenReady().then(() => {
    log('Electron iniciado. Hardware acceleration: desativada');
    screen.on('display-metrics-changed', scheduleFit);
    createWindow().catch(error => log('createWindow:', error));
  });
}

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow().catch(error => log('createWindow activate:', error));
  }
});

app.on('window-all-closed', () => {
  setProcessingProtection(false);
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  if (localServer) {
    try { localServer.close(); } catch (_) {}
    localServer = null;
    localBaseUrl = null;
  }
});
