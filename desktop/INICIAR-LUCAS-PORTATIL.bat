@echo off
setlocal EnableExtensions
cd /d "%~dp0"

for %%I in ("%~dp0..") do set "LUCAS_PORTABLE_ROOT=%%~fI"
set "LUCAS_PORTABLE_MODE=1"
set "DATA=%LUCAS_PORTABLE_ROOT%\LucasGravacoes-Dados"
if not exist "%DATA%" mkdir "%DATA%" >nul 2>nul
set "LOG=%DATA%\portable-launcher.log"
set "ELECTRON=%~dp0node_modules\electron\dist\electron.exe"

echo.>>"%LOG%"
echo ==========================================>>"%LOG%"
echo %date% %time% - Abrindo Lucas Gravacoes PORTATIL>>"%LOG%"
echo Raiz: %LUCAS_PORTABLE_ROOT%>>"%LOG%"

rem Atualizacao e opcional. Sem Git, o programa abre a versao que ja esta no HD.
if exist "%LUCAS_PORTABLE_ROOT%\.git" (
  where git >nul 2>nul
  if not errorlevel 1 (
    echo %date% %time% - Verificando atualizacao>>"%LOG%"
    git -C "%LUCAS_PORTABLE_ROOT%" pull --ff-only --quiet >>"%LOG%" 2>&1
  )
)

rem Depois de preparado, Node nao e necessario para abrir.
if not exist "%ELECTRON%" (
  echo %date% %time% - Runtime Electron ausente. Tentando preparar.>>"%LOG%"
  where node >nul 2>nul
  if errorlevel 1 goto :runtime_missing
  where npm >nul 2>nul
  if errorlevel 1 goto :runtime_missing

  call npm install --no-audit --no-fund --prefer-offline >>"%LOG%" 2>&1
  if errorlevel 1 goto :runtime_missing
)

if not exist "%ELECTRON%" goto :runtime_missing

echo %date% %time% - Iniciando Electron portatil>>"%LOG%"
start "" "%ELECTRON%" "%~dp0"
exit /b 0

:runtime_missing
echo %date% %time% - ERRO: Electron portatil nao esta preparado>>"%LOG%"
powershell -NoProfile -Command "Add-Type -AssemblyName PresentationFramework; [System.Windows.MessageBox]::Show('O Lucas Gravacoes Portatil ainda nao foi preparado neste HD. Conecte o HD ao computador onde o Node.js esta instalado e execute PREPARAR-LUCAS-GRAVACOES-PORTATIL.bat uma vez.','Lucas Gravacoes Portatil','OK','Error')" >nul 2>nul
exit /b 1
