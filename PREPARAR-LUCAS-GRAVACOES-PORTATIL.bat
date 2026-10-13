@echo off
setlocal EnableExtensions EnableDelayedExpansion
title Lucas Gravacoes - Preparar Modo Portatil

set "REPO=https://github.com/lucasprojetoss/warm-welcome-app.git"
for %%I in ("%~dp0.") do set "SOURCE=%%~fI"

echo.
echo ==================================================
echo      LUCAS GRAVACOES - MODO PORTATIL
echo ==================================================
echo.
echo Escolha a pasta do seu HD externo ou pendrive.
echo O preparador criara dentro dela:
echo.
echo   LucasGravacoes-Portable
echo.
echo Depois, para abrir, use:
echo   ABRIR-LUCAS-GRAVACOES-PORTATIL.vbs
echo.

set "DESTBASE="
for /f "usebackq delims=" %%D in ('powershell -NoProfile -STA -Command "$s=New-Object -ComObject Shell.Application; $f=$s.BrowseForFolder(0,'Escolha o HD, pendrive ou pasta onde deseja criar o Lucas Gravacoes Portatil',0,0); if($f){$f.Self.Path}"') do set "DESTBASE=%%D"

if not defined DESTBASE (
  echo.
  echo Operacao cancelada.
  pause
  exit /b 1
)

set "TARGET=%DESTBASE%\LucasGravacoes-Portable"

echo.
echo Destino:
echo %TARGET%
echo.

if exist "%TARGET%\desktop\package.json" (
  echo Uma versao portatil ja existe neste local.
  choice /C SN /N /M "Deseja atualizar/preparar novamente? [S/N] "
  if errorlevel 2 exit /b 0
)

set "GITEXE="
where git >nul 2>nul
if not errorlevel 1 set "GITEXE=git"
if not defined GITEXE if exist "%ProgramFiles%\Git\cmd\git.exe" set "GITEXE=%ProgramFiles%\Git\cmd\git.exe"
if not defined GITEXE if exist "%LocalAppData%\Programs\Git\cmd\git.exe" set "GITEXE=%LocalAppData%\Programs\Git\cmd\git.exe"

if defined GITEXE (
  if exist "%TARGET%\.git" (
    echo Atualizando codigo no HD...
    "%GITEXE%" -C "%TARGET%" pull --ff-only
    if errorlevel 1 goto :copy_fallback
  ) else (
    if exist "%TARGET%" rmdir /s /q "%TARGET%"
    echo Baixando Lucas Gravacoes para o HD...
    "%GITEXE%" clone "%REPO%" "%TARGET%"
    if errorlevel 1 goto :copy_fallback
  )
  goto :prepare_runtime
)

:copy_fallback
echo.
echo Git indisponivel ou falhou. Copiando a versao atual...
if not exist "%TARGET%" mkdir "%TARGET%"
robocopy "%SOURCE%" "%TARGET%" /E /R:2 /W:1 /XD "%SOURCE%\.git" "%SOURCE%\desktop\node_modules" "%SOURCE%\LucasGravacoes-Dados" /XF "desktop-runtime.log" >nul
if errorlevel 8 (
  echo.
  echo Nao foi possivel copiar os arquivos para o HD.
  pause
  exit /b 1
)

:prepare_runtime
echo.
echo Preparando o motor Electron dentro do HD...
where node >nul 2>nul
if errorlevel 1 goto :node_missing
where npm >nul 2>nul
if errorlevel 1 goto :node_missing

cd /d "%TARGET%\desktop"
call npm install --include=dev --no-audit --no-fund
if errorlevel 1 (
  echo.
  echo Falha ao preparar o Electron no HD.
  pause
  exit /b 1
)

if not exist "%TARGET%\LucasGravacoes-Dados" mkdir "%TARGET%\LucasGravacoes-Dados"

echo.
echo ==================================================
echo          MODO PORTATIL PRONTO
echo ==================================================
echo.
echo Pasta:
echo %TARGET%
echo.
echo A partir de agora, abra pelo arquivo:
echo ABRIR-LUCAS-GRAVACOES-PORTATIL.vbs
echo.
echo O Node.js nao sera necessario para ABRIR esta copia
echo em outro computador Windows depois que ela estiver preparada.
echo.
echo Vinheta, perfis, fila e configuracoes ficarao em:
echo LucasGravacoes-Dados
echo.
start "" wscript.exe "%TARGET%\ABRIR-LUCAS-GRAVACOES-PORTATIL.vbs"
pause
exit /b 0

:node_missing
echo.
echo Para PREPARAR o HD pela primeira vez, este computador precisa
echo ter Node.js e npm instalados. Depois de preparado, a copia
echo portatil abre diretamente pelo Electron que fica no proprio HD.
echo.
pause
exit /b 1
