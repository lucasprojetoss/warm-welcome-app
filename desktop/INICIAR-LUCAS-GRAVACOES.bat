@echo off
title Lucas Gravacoes - Preparando
cd /d "%~dp0"

echo.
echo ==========================================
echo        LUCAS GRAVACOES - DESKTOP
echo ==========================================
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo ERRO: Node.js nao foi encontrado.
  echo Instale o Node.js e abra este arquivo novamente.
  pause
  exit /b 1
)

if not exist "node_modules\electron\dist\electron.exe" (
  echo Primeira execucao: instalando somente o Electron...
  echo Aguarde. Isso acontece apenas uma vez.
  call npm install --no-audit --no-fund
  if errorlevel 1 (
    echo.
    echo ERRO durante a instalacao.
    pause
    exit /b 1
  )
)

echo.
echo Abrindo Lucas Gravacoes...
call npm start
if errorlevel 1 (
  echo.
  echo O programa encontrou um erro ao iniciar.
  pause
)
