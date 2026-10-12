const { app, BrowserWindow, ipcMain, powerSaveBlocker, shell, Menu } = require('electron');
const path = require('path');
const fs = require('fs');
const http = require('http');

app.disableHardwareAcceleration();
app.commandLine.appendSwitch('disable-background-timer-throttling');
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
app.commandLine.appendSwitch('disable-renderer-backgrounding');

let mainWindow = null;
let blockerId = null;
let localServer = null;
let localBaseUrl = null;

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

    localServer.listen(0, '127.0.0.1', () => {
      const address = localServer.address();
      localBaseUrl = 'http://127.0.0.1:' + address.port;
      log('Servidor local iniciado em', localBaseUrl);
      resolve(localBaseUrl);
    });
  });
}

function setProcessingProtection(active) {
  if (active) {
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
  log('Protecao contra suspensao desativada');
}

async function createWindow() {
  const baseUrl = await startLocalServer();

  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 980,
    minHeight: 650,
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

  try {
    await mainWindow.loadURL(baseUrl + '/index.html');
  } catch (error) {
    log('Falha ao carregar interface:', error);
  }

  mainWindow.once('ready-to-show', () => mainWindow.show());

  setTimeout(() => {
    if (mainWindow && !mainWindow.isVisible()) mainWindow.show();
  }, 1200);

  mainWindow.on('closed', () => {
    mainWindow = null;
    setProcessingProtection(false);
  });
}

ipcMain.on('processing:set', (_event, active) => setProcessingProtection(Boolean(active)));

ipcMain.handle('desktop:status', () => ({
  electron: true,
  processingProtected: blockerId !== null && powerSaveBlocker.isStarted(blockerId),
  localServer: Boolean(localBaseUrl)
}));

app.whenReady().then(() => {
  log('Electron iniciado. Hardware acceleration: desativada');
  createWindow().catch(error => log('createWindow:', error));
});

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
