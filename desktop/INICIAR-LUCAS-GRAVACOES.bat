@echo off
setlocal
title Lucas Gravacoes
cd /d "%~dp0"

echo.
echo ==========================================
echo        LUCAS GRAVACOES - DESKTOP
echo ==========================================
echo.

if exist "..\.git" (
  where git >nul 2>nul
  if not errorlevel 1 (
    echo Verificando atualizacoes...
    git -C ".." pull --ff-only --quiet
    if errorlevel 1 (
      echo Nao foi possivel verificar a atualizacao agora.
      echo Abrindo a versao instalada...
    ) else (
      echo Sistema atualizado.
    )
  )
) else (
  echo Esta copia veio de ZIP e ainda nao possui atualizacao automatica.
  echo Iniciando configuracao automatica...
  call "%~dp0INSTALAR-AUTO-ATUALIZACAO.bat"
  exit /b
)

where node >nul 2>nul
if errorlevel 1 (
  echo ERRO: Node.js nao foi encontrado.
  echo Instale o Node.js e abra novamente.
  pause
  exit /b 1
)

if not exist "node_modules\electron\dist\electron.exe" (
  echo Instalando o motor Electron. Isso acontece apenas uma vez...
  call npm install --no-audit --no-fund
  if errorlevel 1 (
    echo.
    echo ERRO durante a instalacao do Electron.
    pause
    exit /b 1
  )
)

echo Abrindo Lucas Gravacoes...
call npm start
if errorlevel 1 (
  echo.
  echo O programa encontrou um erro ao iniciar.
  pause
)
