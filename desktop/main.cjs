const { app, BrowserWindow, ipcMain, powerSaveBlocker, shell, Menu, screen, dialog, Notification } = require('electron');
const path = require('path');
const fs = require('fs');
const http = require('http');
const https = require('https');
const { spawn } = require('child_process');

const portableMode = process.env.LUCAS_PORTABLE_MODE === '1';
const portableRoot = portableMode
  ? path.resolve(process.env.LUCAS_PORTABLE_ROOT || path.resolve(__dirname, '..'))
  : null;
const portableDriveRoot = portableMode ? path.parse(portableRoot).root : null;
if (portableMode) {
  const portableUserData = path.join(portableRoot, 'LucasGravacoes-Dados');
  fs.mkdirSync(portableUserData, { recursive: true });
  app.setPath('userData', portableUserData);
}

let loudness = null;
try { loudness = require('loudness'); } catch (_) {}

app.disableHardwareAcceleration();
app.commandLine.appendSwitch('disable-background-timer-throttling');
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
app.commandLine.appendSwitch('disable-renderer-backgrounding');

let mainWindow = null;
let blockerId = null;
let localServer = null;
let localBaseUrl = null;
let selectedMusicRoot = null;
let processingActive = false;
let fitTimer = null;
let currentProgress = {
  version: '1.5.6',
  total: 0,
  previewReady: 0,
  finalized: 0,
  percent: 0,
  current: 'Aguardando processamento',
  completed: false
};

const LOCAL_PORT = 47831;
const PORTABLE_RELEASE_API = 'https://api.github.com/repos/lucasprojetoss/warm-welcome-app/releases/tags/portable-latest';
const PORTABLE_RELEASE_URL = 'https://github.com/lucasprojetoss/warm-welcome-app/releases/download/portable-latest/LucasGravacoes-Portable.zip';
let portableUpdateActive = false;
const appRoot = path.resolve(__dirname, '..');
const logFile = portableMode
  ? path.join(app.getPath('userData'), 'desktop-runtime.log')
  : path.join(__dirname, 'desktop-runtime.log');

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

function queueRoot() {
  const dir = path.join(dataRoot(), 'fila-lotes');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function settingsPath() {
  return path.join(dataRoot(), 'configuracoes.json');
}

function batchStatePath() {
  return path.join(dataRoot(), 'lote-em-andamento.json');
}

function lastMusicFolderPath() {
  return path.join(dataRoot(), 'ultima-pasta-musicas.json');
}

function loadLastMusicFolder() {
  const saved = safeJsonRead(lastMusicFolderPath(), null);
  const folder = saved && typeof saved.folder === 'string' ? saved.folder : '';
  if (!folder) return null;
  try {
    const resolved = path.resolve(folder);
    if (fs.existsSync(resolved) && fs.statSync(resolved).isDirectory()) return resolved;
  } catch (_) {}
  return null;
}

function saveLastMusicFolder(folder) {
  try {
    const resolved = path.resolve(String(folder || ''));
    if (fs.existsSync(resolved) && fs.statSync(resolved).isDirectory()) {
      safeJsonWrite(lastMusicFolderPath(), { folder: resolved, updatedAt: new Date().toISOString() });
    }
  } catch (error) {
    log('Nao foi possivel salvar a ultima pasta de musicas:', error);
  }
}

function safeJsonRead(file, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (_) {
    const backup = file + '.bak';
    try {
      const recovered = JSON.parse(fs.readFileSync(backup, 'utf8'));
      try {
        if (fs.existsSync(file)) retryFileOperation(() => fs.unlinkSync(file), 'Remoção de JSON corrompido');
        fs.copyFileSync(backup, file);
      } catch (_) {}
      return recovered;
    } catch (_) {
      return fallback;
    }
  }
}

function safeJsonWrite(file, value) {
  const tmp = file + '.tmp';
  const backup = file + '.bak';
  const content = JSON.stringify(value, null, 2);

  fs.writeFileSync(tmp, content, 'utf8');
  const verify = JSON.parse(fs.readFileSync(tmp, 'utf8'));
  if (!verify || typeof verify !== 'object') throw new Error('Falha ao validar arquivo de configuração.');

  try {
    if (fs.existsSync(backup)) retryFileOperation(() => fs.unlinkSync(backup), 'Limpeza de backup JSON');
    if (fs.existsSync(file)) retryFileOperation(() => fs.renameSync(file, backup), 'Backup de configuração');
    retryFileOperation(() => fs.renameSync(tmp, file), 'Gravação de configuração');
  } catch (error) {
    try {
      if (!fs.existsSync(file) && fs.existsSync(backup)) retryFileOperation(() => fs.renameSync(backup, file), 'Restauração de configuração');
    } catch (_) {}
    throw error;
  } finally {
    try { if (fs.existsSync(tmp)) fs.unlinkSync(tmp); } catch (_) {}
  }
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

const PORTABLE_DRIVE_PREFIX = 'portable-drive://';

function toStoredPath(value) {
  if (!value) return value;
  const resolved = path.resolve(String(value));
  if (!portableMode || !portableDriveRoot) return resolved;
  const drive = path.parse(resolved).root;
  if (drive.toLowerCase() !== portableDriveRoot.toLowerCase()) return resolved;
  const rel = path.relative(portableDriveRoot, resolved).replace(/\\/g, '/');
  return PORTABLE_DRIVE_PREFIX + rel;
}

function fromStoredPath(value) {
  if (!value) return value;
  const raw = String(value);

  if (portableMode && raw.startsWith(PORTABLE_DRIVE_PREFIX)) {
    const rel = raw.slice(PORTABLE_DRIVE_PREFIX.length).replace(/\//g, path.sep);
    const resolved = path.resolve(portableDriveRoot, rel);
    if (!isInside(portableDriveRoot, resolved)) throw new Error('Caminho portátil inválido.');
    return resolved;
  }

  const resolved = path.resolve(raw);
  if (portableMode && /^[a-zA-Z]:[\\/]/.test(raw) && !fs.existsSync(resolved)) {
    const oldRoot = path.parse(resolved).root;
    const rel = path.relative(oldRoot, resolved);
    const rebased = path.resolve(portableDriveRoot, rel);
    if (fs.existsSync(rebased)) return rebased;
  }
  return resolved;
}

function storedPathList(values) {
  return Array.isArray(values) ? values.map(toStoredPath) : [];
}

function resolvedPathList(values) {
  return Array.isArray(values) ? values.map(fromStoredPath) : [];
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

function handleLocalRequest(req, res) {
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
      fs.createReadStream(requested).on('error', error => {
        log('Leitura do servidor local:', error);
        if (!res.headersSent) res.writeHead(500);
        res.end();
      }).pipe(res);
    });
  } catch (error) {
    log('Servidor local:', error);
    if (!res.headersSent) res.writeHead(500);
    res.end('Erro interno');
  }
}

function listenLocalPort(port) {
  return new Promise((resolve, reject) => {
    const server = http.createServer(handleLocalRequest);
    const onError = error => {
      try { server.close(); } catch (_) {}
      reject(error);
    };
    server.once('error', onError);
    server.listen(port, '127.0.0.1', () => {
      server.removeListener('error', onError);
      const address = server.address();
      localServer = server;
      localBaseUrl = 'http://127.0.0.1:' + address.port;
      log('Servidor local iniciado em', localBaseUrl);
      resolve(localBaseUrl);
    });
  });
}

async function startLocalServer() {
  if (localServer && localBaseUrl) return localBaseUrl;

  let lastError = null;
  for (const port of [LOCAL_PORT, LOCAL_PORT + 1, LOCAL_PORT + 2, LOCAL_PORT + 3, 0]) {
    try {
      return await listenLocalPort(port);
    } catch (error) {
      lastError = error;
      if (error && error.code === 'EADDRINUSE') {
        log('Porta local ocupada, tentando outra:', port);
        continue;
      }
      throw error;
    }
  }

  throw lastError || new Error('Não foi possível iniciar o servidor local.');
}


function httpsGetBuffer(url, redirects = 6) {
  return new Promise((resolve, reject) => {
    if (redirects < 0) return reject(new Error('Redirecionamentos demais ao consultar atualização.'));
    const req = https.get(url, {
      headers: {
        'User-Agent': 'Lucas-Gravacoes-Portable-Updater',
        'Accept': 'application/octet-stream, application/json;q=0.9, */*;q=0.8'
      }
    }, response => {
      if ([301, 302, 303, 307, 308].includes(response.statusCode) && response.headers.location) {
        response.resume();
        const next = new URL(response.headers.location, url).toString();
        httpsGetBuffer(next, redirects - 1).then(resolve, reject);
        return;
      }
      if (response.statusCode !== 200) {
        response.resume();
        reject(new Error('Servidor de atualização respondeu HTTP ' + response.statusCode + '.'));
        return;
      }
      const chunks = [];
      response.on('data', chunk => chunks.push(chunk));
      response.on('end', () => resolve(Buffer.concat(chunks)));
      response.on('error', reject);
    });
    req.setTimeout(30000, () => req.destroy(new Error('Tempo esgotado ao consultar atualização.')));
    req.on('error', reject);
  });
}

function downloadHttpsFile(url, dest, onProgress, redirects = 8) {
  return new Promise((resolve, reject) => {
    if (redirects < 0) return reject(new Error('Redirecionamentos demais ao baixar atualização.'));
    const req = https.get(url, {
      headers: {
        'User-Agent': 'Lucas-Gravacoes-Portable-Updater',
        'Accept': 'application/octet-stream'
      }
    }, response => {
      if ([301, 302, 303, 307, 308].includes(response.statusCode) && response.headers.location) {
        response.resume();
        const next = new URL(response.headers.location, url).toString();
        downloadHttpsFile(next, dest, onProgress, redirects - 1).then(resolve, reject);
        return;
      }
      if (response.statusCode !== 200) {
        response.resume();
        reject(new Error(response.statusCode === 404
          ? 'O pacote portátil ainda não está disponível no GitHub. Aguarde alguns minutos e tente novamente.'
          : 'Falha ao baixar atualização: HTTP ' + response.statusCode + '.'));
        return;
      }

      const total = Number(response.headers['content-length']) || 0;
      let received = 0;
      const temp = dest + '.part';
      try {
        if (fs.existsSync(temp)) fs.unlinkSync(temp);
        if (fs.existsSync(dest)) fs.unlinkSync(dest);
      } catch (_) {}

      const output = fs.createWriteStream(temp);
      response.on('data', chunk => {
        received += chunk.length;
        if (typeof onProgress === 'function') {
          const percent = total ? Math.max(0, Math.min(100, Math.round(received / total * 100))) : null;
          onProgress({ received, total, percent });
        }
      });
      response.pipe(output);

      output.on('finish', () => {
        output.close(() => {
          try {
            const st = fs.statSync(temp);
            if (st.size < 1024 * 1024) throw new Error('O pacote baixado é pequeno demais e parece inválido.');
            fs.renameSync(temp, dest);
            resolve({ path: dest, size: st.size });
          } catch (error) {
            try { if (fs.existsSync(temp)) fs.unlinkSync(temp); } catch (_) {}
            reject(error);
          }
        });
      });

      output.on('error', error => {
        try { output.destroy(); } catch (_) {}
        try { if (fs.existsSync(temp)) fs.unlinkSync(temp); } catch (_) {}
        reject(error);
      });
      response.on('error', error => {
        try { output.destroy(); } catch (_) {}
        try { if (fs.existsSync(temp)) fs.unlinkSync(temp); } catch (_) {}
        reject(error);
      });
    });

    req.setTimeout(60000, () => req.destroy(new Error('Tempo esgotado durante o download da atualização.')));
    req.on('error', reject);
  });
}

function versionParts(value) {
  return String(value || '0').replace(/^v/i, '').split('.').map(x => {
    const n = parseInt(x, 10);
    return Number.isFinite(n) ? n : 0;
  });
}

function compareVersions(a, b) {
  const aa = versionParts(a);
  const bb = versionParts(b);
  for (let i = 0; i < Math.max(aa.length, bb.length, 3); i++) {
    const av = aa[i] || 0;
    const bv = bb[i] || 0;
    if (av > bv) return 1;
    if (av < bv) return -1;
  }
  return 0;
}

async function checkPortableUpdate() {
  if (!portableMode) return { portable: false, currentVersion: app.getVersion(), updateAvailable: false };
  const buffer = await httpsGetBuffer(PORTABLE_RELEASE_API);
  const release = JSON.parse(buffer.toString('utf8'));
  const match = String(release.body || '').match(/version=([0-9]+(?:\.[0-9]+){1,3})/i);
  if (!match) throw new Error('O pacote portátil ainda está sendo preparado no GitHub.');
  const remoteVersion = match[1];
  const currentVersion = app.getVersion();
  return {
    portable: true,
    currentVersion,
    remoteVersion,
    updateAvailable: compareVersions(remoteVersion, currentVersion) > 0
  };
}

function portableUpdaterScript() {
  return "param(\n  [Parameter(Mandatory=$true)][string]$Zip,\n  [Parameter(Mandatory=$true)][string]$Root,\n  [Parameter(Mandatory=$true)][string]$Token,\n  [Parameter(Mandatory=$true)][int]$AppPid\n)\n\n$ErrorActionPreference = 'Stop'\n$dataDir = Join-Path $Root 'LucasGravacoes-Dados'\nNew-Item -ItemType Directory -Path $dataDir -Force | Out-Null\n$log = Join-Path $dataDir 'atualizacao-portatil.log'\n$parent = Split-Path -Parent $Root\n$name = Split-Path -Leaf $Root\n$stage = Join-Path $parent ($name + '.__update_' + $Token)\n\nfunction Write-Log([string]$Text) {\n  Add-Content -LiteralPath $log -Value ((Get-Date -Format 'yyyy-MM-dd HH:mm:ss') + ' - ' + $Text) -Encoding UTF8\n}\n\nfunction Show-UpdateMessage([string]$Text, [string]$Kind='Information') {\n  try {\n    Add-Type -AssemblyName PresentationFramework\n    [System.Windows.MessageBox]::Show($Text, 'Lucas Gravacoes - Atualizacao', 'OK', $Kind) | Out-Null\n  } catch {}\n}\n\ntry {\n  Write-Log ('INICIO token=' + $Token + ' root=' + $Root + ' pid=' + $AppPid)\n\n  try {\n    Write-Log 'Aguardando processo principal encerrar.'\n    Wait-Process -Id $AppPid -Timeout 40 -ErrorAction SilentlyContinue\n  } catch {}\n\n  # Aguarda também processos Electron que ainda estejam usando esta instalação.\n  for ($round = 0; $round -lt 30; $round++) {\n    $usingRoot = @(Get-Process electron -ErrorAction SilentlyContinue | Where-Object {\n      try { $_.Path -and $_.Path.StartsWith((Join-Path $Root 'desktop'), [System.StringComparison]::OrdinalIgnoreCase) } catch { $false }\n    })\n    if ($usingRoot.Count -eq 0) { break }\n    Write-Log ('Ainda existem ' + $usingRoot.Count + ' processo(s) Electron usando a pasta. Aguardando...')\n    Start-Sleep -Seconds 1\n  }\n\n  $stillUsing = @(Get-Process electron -ErrorAction SilentlyContinue | Where-Object {\n    try { $_.Path -and $_.Path.StartsWith((Join-Path $Root 'desktop'), [System.StringComparison]::OrdinalIgnoreCase) } catch { $false }\n  })\n  if ($stillUsing.Count -gt 0) {\n    throw 'O Lucas Gravacoes ainda estava aberto e bloqueando os arquivos da atualizacao.'\n  }\n\n  if (Test-Path -LiteralPath $stage) { Remove-Item -LiteralPath $stage -Recurse -Force }\n  New-Item -ItemType Directory -Path $stage -Force | Out-Null\n\n  Write-Log 'Extraindo pacote novo.'\n  Expand-Archive -LiteralPath $Zip -DestinationPath $stage -Force\n\n  $source = Join-Path $stage 'LucasGravacoes-Portable'\n  if (!(Test-Path -LiteralPath $source)) {\n    $dirs = @(Get-ChildItem -LiteralPath $stage -Directory)\n    if ($dirs.Count -eq 1) { $source = $dirs[0].FullName }\n  }\n\n  $package = Join-Path $source 'desktop\\package.json'\n  $electron = Join-Path $source 'desktop\\node_modules\\electron\\dist\\electron.exe'\n  $main = Join-Path $source 'desktop\\main.cjs'\n  $index = Join-Path $source 'index.html'\n  if (!(Test-Path -LiteralPath $package) -or !(Test-Path -LiteralPath $electron) -or !(Test-Path -LiteralPath $main) -or !(Test-Path -LiteralPath $index)) {\n    throw 'O pacote baixado esta incompleto.'\n  }\n\n  $newVersion = [string](Get-Content -LiteralPath $package -Raw | ConvertFrom-Json).version\n  Write-Log ('Versao recebida: ' + $newVersion)\n\n  Write-Log 'Copiando arquivos para a mesma pasta raiz.'\n  & robocopy.exe $source $Root /MIR /R:4 /W:2 /XD (Join-Path $source 'LucasGravacoes-Dados') (Join-Path $Root 'LucasGravacoes-Dados') /XF 'desktop-runtime.log' 'atualizacao-portatil.log' | Out-Null\n  $rc = $LASTEXITCODE\n  Write-Log ('Robocopy codigo=' + $rc)\n  if ($rc -ge 8) { throw ('Falha ao copiar arquivos. Codigo Robocopy ' + $rc) }\n\n  $installedPackage = Join-Path $Root 'desktop\\package.json'\n  $installedVersion = [string](Get-Content -LiteralPath $installedPackage -Raw | ConvertFrom-Json).version\n  Write-Log ('Versao instalada apos copia: ' + $installedVersion)\n  if ($installedVersion -ne $newVersion) {\n    throw ('Versao instalada nao confere. Nova=' + $newVersion + ' instalada=' + $installedVersion)\n  }\n\n  $flag = Join-Path $dataDir ('update-ok-' + $Token + '.flag')\n  if (Test-Path -LiteralPath $flag) { Remove-Item -LiteralPath $flag -Force }\n  $env:LUCAS_PORTABLE_UPDATE_TOKEN = $Token\n\n  $opener = Join-Path $Root 'ABRIR-LUCAS-GRAVACOES-PORTATIL.vbs'\n  Write-Log ('Abrindo: ' + $opener)\n  Start-Process -FilePath 'wscript.exe' -ArgumentList ('\"' + $opener + '\"')\n\n  $confirmed = $false\n  for ($i = 0; $i -lt 120; $i++) {\n    if (Test-Path -LiteralPath $flag) { $confirmed = $true; break }\n    Start-Sleep -Milliseconds 500\n  }\n\n  if ($confirmed) {\n    Write-Log ('SUCESSO: v' + $installedVersion + ' abriu e confirmou inicializacao.')\n    try { Remove-Item -LiteralPath $flag -Force } catch {}\n  } else {\n    Write-Log ('AVISO: v' + $installedVersion + ' foi instalada, mas nao confirmou abertura.')\n    Show-UpdateMessage ('A versao ' + $installedVersion + ' foi instalada, mas nao consegui confirmar a abertura automatica. Abra novamente pelo ABRIR-LUCAS-GRAVACOES-PORTATIL.') 'Warning'\n  }\n\n  try { Remove-Item -LiteralPath $stage -Recurse -Force } catch {}\n  try { Remove-Item -LiteralPath $Zip -Force } catch {}\n} catch {\n  Write-Log ('ERRO: ' + $_.Exception.Message)\n  Show-UpdateMessage ('Nao foi possivel concluir a atualizacao.' + [Environment]::NewLine + [Environment]::NewLine + $_.Exception.Message + [Environment]::NewLine + [Environment]::NewLine + 'Veja LucasGravacoes-Dados\\atualizacao-portatil.log') 'Error'\n}\n\ntry { Remove-Item -LiteralPath $MyInvocation.MyCommand.Path -Force } catch {}\n";
}

async function beginPortableUpdate(event) {
  if (!portableMode) throw new Error('Esta opção só existe no modo portátil.');
  if (portableUpdateActive) throw new Error('Já existe uma atualização em andamento.');
  if (processingActive) throw new Error('Espere o lote atual terminar antes de atualizar.');

  portableUpdateActive = true;
  const tempRoot = path.join(app.getPath('temp'), 'LucasGravacoes-Portable-Updater');
  fs.mkdirSync(tempRoot, { recursive: true });
  const token = Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
  const zipPath = path.join(tempRoot, 'LucasGravacoes-Portable-' + token + '.zip');
  const scriptPath = path.join(tempRoot, 'aplicar-' + token + '.ps1');

  try {
    const check = await checkPortableUpdate();
    if (!check.updateAvailable) return { ok: true, upToDate: true, ...check };

    event.sender.send('portable:update-progress', {
      phase: 'download',
      percent: 0,
      message: 'Baixando v' + check.remoteVersion + '...'
    });

    const downloaded = await downloadHttpsFile(PORTABLE_RELEASE_URL, zipPath, progress => {
      event.sender.send('portable:update-progress', {
        phase: 'download',
        ...progress,
        message: progress.percent === null
          ? 'Baixando atualização...'
          : 'Baixando atualização... ' + progress.percent + '%'
      });
    });

    const updaterSource = path.join(__dirname, 'portable-updater.cmd');
    if (!fs.existsSync(updaterSource)) throw new Error('Atualizador portatil CMD nao foi encontrado.');
    const cmdPath = scriptPath.replace(/\.ps1$/i, '.cmd');
    fs.copyFileSync(updaterSource, cmdPath);

    event.sender.send('portable:update-progress', {
      phase: 'ready',
      percent: 100,
      message: 'Download concluído. Reiniciando para aplicar...'
    });

    const child = spawn('cmd.exe', [
      '/d',
      '/s',
      '/c',
      '"' + cmdPath + '"',
      downloaded.path,
      portableRoot,
      token,
      String(process.pid)
    ], {
      cwd: app.getPath('temp'),
      detached: true,
      windowsHide: true,
      stdio: 'ignore',
      env: { ...process.env }
    });
    child.unref();

    setTimeout(() => app.quit(), 900);
    return { ok: true, restarting: true, remoteVersion: check.remoteVersion };
  } catch (error) {
    try { if (fs.existsSync(zipPath)) fs.unlinkSync(zipPath); } catch (_) {}
    try { if (fs.existsSync(zipPath + '.part')) fs.unlinkSync(zipPath + '.part'); } catch (_) {}
    try { if (fs.existsSync(scriptPath)) fs.unlinkSync(scriptPath); } catch (_) {}
    try {
      const cmdPath = scriptPath.replace(/\.ps1$/i, '.cmd');
      if (fs.existsSync(cmdPath)) fs.unlinkSync(cmdPath);
    } catch (_) {}
    throw error;
  } finally {
    portableUpdateActive = false;
  }
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

function updateProgress(payload = {}) {
  currentProgress = {
    ...currentProgress,
    ...payload,
    version: app.getVersion()
  };
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
    if (fs.existsSync(temp)) retryFileOperation(() => fs.unlinkSync(temp), 'Limpeza do MP3 temporário');
    if (fs.existsSync(backup)) retryFileOperation(() => fs.unlinkSync(backup), 'Limpeza do backup antigo do MP3');

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

function incomingFileBuffer(item) {
  if (!item) return null;
  if (typeof item.base64 === 'string' && item.base64) return Buffer.from(item.base64, 'base64');
  if (item.bytes) return Buffer.from(item.bytes);
  return null;
}

function writePersistentFile(dest, data, label) {
  if (!Buffer.isBuffer(data)) data = Buffer.from(data);
  if (!data.length) throw new Error(label + ' vazio.');

  const temp = dest + '.tmp';
  const backup = dest + '.bak';

  try {
    if (fs.existsSync(temp)) retryFileOperation(() => fs.unlinkSync(temp), 'Limpeza de temporário de ' + label);
    if (fs.existsSync(backup)) retryFileOperation(() => fs.unlinkSync(backup), 'Limpeza de backup antigo de ' + label);

    fs.writeFileSync(temp, data);
    const written = fs.statSync(temp);
    if (written.size !== data.length) throw new Error(label + ' não foi gravado completamente.');

    if (fs.existsSync(dest)) retryFileOperation(() => fs.renameSync(dest, backup), 'Backup de ' + label);
    try {
      retryFileOperation(() => fs.renameSync(temp, dest), 'Gravação de ' + label);
    } catch (error) {
      if (!fs.existsSync(dest) && fs.existsSync(backup)) {
        try { retryFileOperation(() => fs.renameSync(backup, dest), 'Restauração de ' + label); } catch (_) {}
      }
      throw error;
    }

    return fs.statSync(dest);
  } finally {
    try { if (fs.existsSync(temp)) fs.unlinkSync(temp); } catch (_) {}
  }
}

function recoverPersistentFile(filePath, minSize) {
  if (!filePath) return false;
  try {
    if (fs.existsSync(filePath) && fs.statSync(filePath).isFile() && fs.statSync(filePath).size >= minSize) return true;
  } catch (_) {}

  const backup = filePath + '.bak';
  try {
    if (!fs.existsSync(backup) || fs.statSync(backup).size < minSize) return false;
    if (fs.existsSync(filePath)) retryFileOperation(() => fs.unlinkSync(filePath), 'Remoção de arquivo persistente inválido');
    fs.copyFileSync(backup, filePath);
    return fs.statSync(filePath).size >= minSize;
  } catch (_) {
    return false;
  }
}

function discoverDefaultCover() {
  const root = dataRoot();
  try {
    const name = fs.readdirSync(root).find(file => /^capa-padrao\.(jpg|jpeg|png)$/i.test(file));
    if (!name) return null;
    const filePath = path.join(root, name);
    const st = fs.statSync(filePath);
    if (!st.isFile() || st.size < 32) return null;
    const type = /\.png$/i.test(name) ? 'image/png' : 'image/jpeg';
    return { path: filePath, name, type, size: st.size, updatedAt: st.mtimeMs };
  } catch (_) {
    return null;
  }
}

function discoverDefaultJingle() {
  const root = dataRoot();
  try {
    const name = fs.readdirSync(root).find(file => /^vinheta-padrao\.(mp3|wav|m4a|aac|ogg)$/i.test(file));
    if (!name) return null;
    const filePath = path.join(root, name);
    const st = fs.statSync(filePath);
    if (!st.isFile() || st.size < 128) return null;
    const ext = path.extname(name).toLowerCase();
    const type = ext === '.wav' ? 'audio/wav' : ext === '.m4a' ? 'audio/mp4' : ext === '.aac' ? 'audio/aac' : ext === '.ogg' ? 'audio/ogg' : 'audio/mpeg';
    return { path: filePath, name, type, size: st.size, updatedAt: st.mtimeMs };
  } catch (_) {
    return null;
  }
}

function attachmentFromFile(filePath, type, preferredName) {
  if (!filePath || !fs.existsSync(filePath)) return null;
  const data = fs.readFileSync(filePath);
  if (!data.length) return null;
  return {
    name: preferredName || path.basename(filePath),
    type,
    size: data.length,
    base64: data.toString('base64')
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
    const candidates = fs.readdirSync(root).filter(name => /^vinheta-padrao\./i.test(name));
    for (const name of candidates) {
      const target = path.join(root, name);
      retryFileOperation(() => fs.unlinkSync(target), 'Remoção da vinheta padrão');
    }
    next.jingle = null;
  } else if (payload.jingle) {
    const data = incomingFileBuffer(payload.jingle);
    if (data && data.length) {
      const ext = (path.extname(payload.jingle.name || '') || '.mp3').toLowerCase();
      const dest = path.join(root, 'vinheta-padrao' + ext);
      if (data.length < 128) throw new Error('A vinheta padrão está vazia ou inválida.');
      const finalStat = writePersistentFile(dest, data, 'vinheta padrão');

      for (const name of fs.readdirSync(root).filter(name => /^vinheta-padrao\./i.test(name) && path.join(root, name) !== dest && path.join(root, name) !== dest + '.bak')) {
        const stale = path.join(root, name);
        try { retryFileOperation(() => fs.unlinkSync(stale), 'Limpeza de vinheta padrão antiga'); } catch (error) { log('Vinheta antiga não pôde ser removida:', stale, error.code || error.message); }
      }
      next.jingle = {
        path: toStoredPath(dest),
        name: payload.jingle.name || path.basename(dest),
        type: payload.jingle.type || 'audio/mpeg',
        size: finalStat.size,
        updatedAt: Date.now()
      };
    }
  }

  if (payload.removeCover) {
    const covers = fs.readdirSync(root).filter(name => /^capa-padrao\./i.test(name));
    for (const name of covers) {
      const target = path.join(root, name);
      retryFileOperation(() => fs.unlinkSync(target), 'Remoção da capa padrão');
    }
    next.cover = null;
  } else if (payload.cover) {
    const data = incomingFileBuffer(payload.cover);
    if (data && data.length) {
      const ext = /png/i.test(payload.cover.type || '') ? '.png' : '.jpg';
      const dest = path.join(root, 'capa-padrao' + ext);
      if (data.length < 32) throw new Error('A capa padrão está vazia ou inválida.');
      const finalStat = writePersistentFile(dest, data, 'capa padrão');

      for (const name of fs.readdirSync(root).filter(name => /^capa-padrao\./i.test(name) && path.join(root, name) !== dest && path.join(root, name) !== dest + '.bak')) {
        const stale = path.join(root, name);
        try { retryFileOperation(() => fs.unlinkSync(stale), 'Limpeza de capa padrão antiga'); } catch (error) { log('Capa antiga não pôde ser removida:', stale, error.code || error.message); }
      }

      next.cover = {
        path: toStoredPath(dest),
        name: payload.cover.name || path.basename(dest),
        type: payload.cover.type || (ext === '.png' ? 'image/png' : 'image/jpeg'),
        size: finalStat.size,
        updatedAt: Date.now()
      };
    }
  }

  safeJsonWrite(settingsPath(), next);
  return next;
}

function loadDefaults() {
  const config = safeJsonRead(settingsPath(), {}) || {};
  let jingle = config.jingle || null;
  let cover = config.cover || null;
  let repaired = false;

  if (jingle?.path) {
    try { jingle = { ...jingle, path: fromStoredPath(jingle.path) }; } catch (_) { jingle = null; }
  }
  if (cover?.path) {
    try { cover = { ...cover, path: fromStoredPath(cover.path) }; } catch (_) { cover = null; }
  }

  try {
    if (!jingle || !jingle.path || !recoverPersistentFile(jingle.path, 128)) {
      jingle = discoverDefaultJingle();
      repaired = true;
    }
  } catch (_) {
    jingle = discoverDefaultJingle();
    repaired = true;
  }

  try {
    if (!cover || !cover.path || !recoverPersistentFile(cover.path, 32)) {
      cover = discoverDefaultCover();
      repaired = true;
    }
  } catch (_) {
    cover = discoverDefaultCover();
    repaired = true;
  }

  if (repaired || portableMode) {
    config.jingle = jingle ? { ...jingle, path: toStoredPath(jingle.path) } : null;
    config.cover = cover ? { ...cover, path: toStoredPath(cover.path) } : null;
    try { safeJsonWrite(settingsPath(), config); } catch (_) {}
  }

  return {
    ...config,
    jingle: jingle ? { ...jingle, path: jingle.path } : null,
    cover: cover ? { ...cover, path: cover.path } : null,
    jingleData: jingle ? attachmentFromFile(jingle.path, jingle.type || 'audio/mpeg', jingle.name) : null,
    coverData: cover ? attachmentFromFile(cover.path, cover.type || 'image/jpeg', cover.name) : null
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

  if (payload.jingle) {
    const data = incomingFileBuffer(payload.jingle);
    if (data && data.length) {
      const ext = path.extname(payload.jingle.name || '') || '.mp3';
      const dest = path.join(dir, 'vinheta' + ext.toLowerCase());
      writePersistentFile(dest, data, 'vinheta do perfil');
      config.jingle = { path: toStoredPath(dest), name: payload.jingle.name || path.basename(dest), type: payload.jingle.type || 'audio/mpeg' };
    }
  }

  if (payload.cover) {
    const data = incomingFileBuffer(payload.cover);
    if (data && data.length) {
      const ext = /png/i.test(payload.cover.type || '') ? '.png' : '.jpg';
      const dest = path.join(dir, 'capa' + ext);
      writePersistentFile(dest, data, 'capa do perfil');
      config.cover = { path: toStoredPath(dest), name: payload.cover.name || path.basename(dest), type: payload.cover.type || 'image/jpeg' };
    }
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

function findAssetInDir(dir, meta, pattern) {
  let candidate = null;
  if (meta?.path) {
    try { candidate = fromStoredPath(meta.path); } catch (_) {}
  }
  if (candidate && fs.existsSync(candidate)) return candidate;
  try {
    const name = fs.readdirSync(dir).find(file => pattern.test(file));
    return name ? path.join(dir, name) : null;
  } catch (_) {
    return null;
  }
}

function loadProfile(id) {
  const dir = path.join(profilesRoot(), profileId(id));
  const file = path.join(dir, 'perfil.json');
  const config = safeJsonRead(file, null);
  if (!config) throw new Error('Perfil não encontrado.');

  const jinglePath = findAssetInDir(dir, config.jingle, /^vinheta\./i);
  const coverPath = findAssetInDir(dir, config.cover, /^capa\.(jpg|jpeg|png)$/i);

  if (portableMode) {
    if (config.jingle && jinglePath) config.jingle.path = toStoredPath(jinglePath);
    if (config.cover && coverPath) config.cover.path = toStoredPath(coverPath);
    try { safeJsonWrite(file, config); } catch (_) {}
  }

  return {
    ...config,
    jingleData: jinglePath ? attachmentFromFile(jinglePath, config.jingle?.type || 'audio/mpeg', config.jingle?.name) : null,
    coverData: coverPath ? attachmentFromFile(coverPath, config.cover?.type || 'image/jpeg', config.cover?.name) : null
  };
}

let queueRecoveredThisSession = false;

function queueLotDir(id) {
  const safe = String(id || '').replace(/[^a-zA-Z0-9_-]/g, '');
  if (!safe) throw new Error('Lote inválido.');
  const dir = path.join(queueRoot(), safe);
  if (!isInside(queueRoot(), dir)) throw new Error('Lote fora da fila.');
  return dir;
}

function readQueueLotConfig(id) {
  const dir = queueLotDir(id);
  const config = safeJsonRead(path.join(dir, 'lote.json'), null);
  if (!config) throw new Error('Lote não encontrado.');
  return config;
}

function queueLotSummary(config) {
  return {
    id: config.id,
    name: config.name,
    folder: fromStoredPath(config.folder),
    fileCount: Array.isArray(config.files) ? config.files.length : Number(config.fileCount || 0),
    status: config.status || 'waiting',
    progress: Number(config.progress || 0),
    completedCount: Array.isArray(config.completedFiles) ? config.completedFiles.length : Number(config.completedCount || 0),
    error: config.error || '',
    createdAt: config.createdAt,
    updatedAt: config.updatedAt
  };
}

function listQueueLots() {
  const root = queueRoot();
  const configs = fs.readdirSync(root, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => {
      const file = path.join(root, entry.name, 'lote.json');
      const config = safeJsonRead(file, null);
      if (!config) return null;

      if (!queueRecoveredThisSession && config.status === 'processing') {
        config.status = 'waiting';
        config.progress = Number(config.progress || 0);
        config.error = 'Processamento anterior foi interrompido; lote voltou para a fila.';
        config.updatedAt = new Date().toISOString();
        try { safeJsonWrite(file, config); } catch (_) {}
      }
      return config;
    })
    .filter(Boolean)
    .sort((a, b) => String(a.createdAt || '').localeCompare(String(b.createdAt || '')));

  queueRecoveredThisSession = true;
  return configs.map(queueLotSummary);
}

function saveQueueLot(payload = {}) {
  const current = listQueueLots();
  if (current.length >= 30) throw new Error('A fila aceita até 30 lotes por vez.');

  const folder = path.resolve(String(payload.folder || ''));
  if (!fs.existsSync(folder) || !fs.statSync(folder).isDirectory()) throw new Error('Pasta do lote não encontrada.');

  const activeDuplicate = current.find(item =>
    ['waiting', 'processing'].includes(item.status) &&
    path.resolve(item.folder) === folder
  );
  if (activeDuplicate) throw new Error('Esta pasta já está aguardando ou processando na fila.');

  const files = listMp3Files(folder).map(file => file.path);
  const storedFolder = toStoredPath(folder);
  const storedFiles = storedPathList(files);
  if (!files.length) throw new Error('Nenhum MP3 encontrado nesta pasta.');

  const jingleData = incomingFileBuffer(payload.jingle);
  if (!jingleData || jingleData.length < 128) throw new Error('Escolha uma vinheta válida para este lote.');

  const id = 'lote-' + Date.now() + '-' + Math.floor(Math.random() * 100000);
  const dir = queueLotDir(id);
  fs.mkdirSync(dir, { recursive: true });

  const jingleExt = (path.extname(payload.jingle?.name || '') || '.mp3').toLowerCase();
  const jinglePath = path.join(dir, 'vinheta' + jingleExt);
  writePersistentFile(jinglePath, jingleData, 'vinheta do lote');

  let cover = null;
  if (payload.cover) {
    const coverData = incomingFileBuffer(payload.cover);
    if (coverData && coverData.length >= 32) {
      const ext = /png/i.test(payload.cover.type || '') ? '.png' : '.jpg';
      const coverPath = path.join(dir, 'capa' + ext);
      writePersistentFile(coverPath, coverData, 'capa do lote');
      cover = {
        path: toStoredPath(coverPath),
        name: payload.cover.name || path.basename(coverPath),
        type: payload.cover.type || (ext === '.png' ? 'image/png' : 'image/jpeg')
      };
    }
  }

  const number = current.length + 1;
  const config = {
    version: 1,
    id,
    name: String(payload.name || '').trim() || ('Lote ' + number),
    folder: storedFolder,
    files: storedFiles,
    fileCount: storedFiles.length,
    status: 'waiting',
    progress: 0,
    completedCount: 0,
    completedFiles: [],
    error: '',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    settings: {
      insertionMode: payload.settings?.insertionMode === 'manual' ? 'manual' : 'auto',
      manualInsertTime: Number(payload.settings?.manualInsertTime ?? 30),
      manualDuckDb: Number(payload.settings?.manualDuckDb ?? -4),
      replaceOriginals: payload.settings?.replaceOriginals !== false,
      metadata: {
        artist: String(payload.settings?.metadata?.artist || ''),
        composer: String(payload.settings?.metadata?.composer || ''),
        album: String(payload.settings?.metadata?.album || '')
      }
    },
    jingle: {
      path: toStoredPath(jinglePath),
      name: payload.jingle?.name || path.basename(jinglePath),
      type: payload.jingle?.type || 'audio/mpeg'
    },
    cover
  };

  safeJsonWrite(path.join(dir, 'lote.json'), config);
  return queueLotSummary(config);
}

function loadQueueLot(id) {
  const dir = queueLotDir(id);
  const file = path.join(dir, 'lote.json');
  const config = readQueueLotConfig(id);

  const folder = fromStoredPath(config.folder);
  const files = resolvedPathList(config.files);
  const completedFiles = resolvedPathList(config.completedFiles);

  const jinglePath = findAssetInDir(dir, config.jingle, /^vinheta\./i);
  const coverPath = findAssetInDir(dir, config.cover, /^capa\.(jpg|jpeg|png)$/i);

  if (portableMode) {
    config.folder = toStoredPath(folder);
    config.files = storedPathList(files);
    config.completedFiles = storedPathList(completedFiles);
    if (config.jingle && jinglePath) config.jingle.path = toStoredPath(jinglePath);
    if (config.cover && coverPath) config.cover.path = toStoredPath(coverPath);
    try { safeJsonWrite(file, config); } catch (_) {}
  }

  return {
    ...config,
    folder,
    files,
    completedFiles,
    jingleData: jinglePath ? attachmentFromFile(jinglePath, config.jingle?.type || 'audio/mpeg', config.jingle?.name) : null,
    coverData: coverPath ? attachmentFromFile(coverPath, config.cover?.type || 'image/jpeg', config.cover?.name) : null
  };
}

function updateQueueLot(id, patch = {}) {
  const dir = queueLotDir(id);
  const file = path.join(dir, 'lote.json');
  const config = safeJsonRead(file, null);
  if (!config) throw new Error('Lote não encontrado.');

  const allowedStatus = ['waiting', 'processing', 'completed', 'error', 'cancelled'];
  if (patch.status && allowedStatus.includes(patch.status)) config.status = patch.status;
  if (Number.isFinite(patch.progress)) config.progress = Math.max(0, Math.min(100, Number(patch.progress)));
  if (Array.isArray(patch.completedFiles)) {
    const allowed = new Set(Array.isArray(config.files) ? config.files : []);
    const storedCompleted = patch.completedFiles.map(toStoredPath);
    config.completedFiles = [...new Set(storedCompleted.filter(file => allowed.has(file)))];
    config.completedCount = config.completedFiles.length;
  } else if (Number.isFinite(patch.completedCount)) {
    config.completedCount = Math.max(0, Number(patch.completedCount));
  }
  if (typeof patch.error === 'string') config.error = patch.error.slice(0, 1000);
  config.updatedAt = new Date().toISOString();

  safeJsonWrite(file, config);
  return queueLotSummary(config);
}

function removeQueueLot(id) {
  const config = readQueueLotConfig(id);
  if (config.status === 'processing') throw new Error('Não é possível remover o lote que está processando.');
  const dir = queueLotDir(id);
  fs.rmSync(dir, { recursive: true, force: true });
  return true;
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
    portableMode,
    portableRoot,
    monitor: display ? {
      width: display.workArea.width,
      height: display.workArea.height,
      scaleFactor: display.scaleFactor
    } : null,
    zoomFactor: mainWindow && !mainWindow.isDestroyed() ? mainWindow.webContents.getZoomFactor() : 1,
    processingProtected: blockerId !== null && powerSaveBlocker.isStarted(blockerId),
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
    if (portableMode && process.env.LUCAS_PORTABLE_UPDATE_TOKEN) {
      const token = String(process.env.LUCAS_PORTABLE_UPDATE_TOKEN).replace(/[^a-zA-Z0-9_-]/g, '');
      if (token) {
        try {
          const flagDir = path.join(portableRoot, 'LucasGravacoes-Dados');
          fs.mkdirSync(flagDir, { recursive: true });
          fs.writeFileSync(path.join(flagDir, 'update-ok-' + token + '.flag'), new Date().toISOString(), 'utf8');
          log('Atualização portátil confirmou inicialização:', token);
        } catch (error) {
          log('Falha ao confirmar atualização portátil:', error);
        }
      }
    }
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
  await completionSignal();
});

ipcMain.handle('desktop:status', () => {
  const display = getTargetDisplay();
  return {
    electron: true,
    version: app.getVersion(),
    processingProtected: blockerId !== null && powerSaveBlocker.isStarted(blockerId),
    localServer: Boolean(localBaseUrl),
    portableMode,
    portableRoot,
    monitor: {
      width: display.workArea.width,
      height: display.workArea.height,
      scaleFactor: display.scaleFactor
    },
    zoomFactor: mainWindow && !mainWindow.isDestroyed() ? mainWindow.webContents.getZoomFactor() : 1
  };
});

ipcMain.handle('music:select-folder', async () => {
  const rememberedFolder = selectedMusicRoot || loadLastMusicFolder();
  const options = {
    title: 'Selecionar pasta de músicas',
    properties: ['openDirectory']
  };
  if (rememberedFolder) options.defaultPath = rememberedFolder;

  const result = await dialog.showOpenDialog(mainWindow, options);
  if (result.canceled || !result.filePaths[0]) return null;

  selectedMusicRoot = path.resolve(result.filePaths[0]);
  saveLastMusicFolder(selectedMusicRoot);
  return { folder: selectedMusicRoot, files: listMp3Files(selectedMusicRoot) };
});

ipcMain.handle('music:load-folder', (_event, folder) => {
  const resolved = path.resolve(String(folder || ''));
  if (!fs.existsSync(resolved) || !fs.statSync(resolved).isDirectory()) throw new Error('Pasta não encontrada.');
  selectedMusicRoot = resolved;
  saveLastMusicFolder(selectedMusicRoot);
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

function encodeBatchState(state = {}) {
  return {
    ...state,
    folder: state.folder ? toStoredPath(state.folder) : state.folder,
    files: storedPathList(state.files),
    completed: storedPathList(state.completed)
  };
}

function decodeBatchState(state) {
  if (!state || typeof state !== 'object') return state;
  return {
    ...state,
    folder: state.folder ? fromStoredPath(state.folder) : state.folder,
    files: resolvedPathList(state.files),
    completed: resolvedPathList(state.completed)
  };
}

ipcMain.handle('batch:load', () => decodeBatchState(safeJsonRead(batchStatePath(), null)));
ipcMain.handle('batch:save', (_event, state) => {
  safeJsonWrite(batchStatePath(), encodeBatchState(state || {}));
  return true;
});
ipcMain.handle('batch:clear', () => {
  const file = batchStatePath();
  for (const target of [file, file + '.bak', file + '.tmp']) {
    try { if (fs.existsSync(target)) retryFileOperation(() => fs.unlinkSync(target), 'Limpeza do checkpoint'); } catch (error) { log('Checkpoint não pôde ser removido:', target, error); }
  }
  return true;
});

ipcMain.handle('queue:list', () => listQueueLots());
ipcMain.handle('queue:add', (_event, payload) => saveQueueLot(payload || {}));
ipcMain.handle('queue:load', (_event, id) => loadQueueLot(String(id || '')));
ipcMain.handle('queue:update', (_event, id, patch) => updateQueueLot(String(id || ''), patch || {}));
ipcMain.handle('queue:remove', (_event, id) => removeQueueLot(String(id || '')));

ipcMain.handle('diagnostics:get', () => getDiagnostics());
ipcMain.handle('portable:update-check', () => checkPortableUpdate());
ipcMain.handle('portable:update-install', event => beginPortableUpdate(event));

const gotSingleInstanceLock = app.requestSingleInstanceLock();

if (!gotSingleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      mainWindow.setSkipTaskbar(false);
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
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
