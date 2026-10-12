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

set "NEED_INSTALL=0"
if not exist "node_modules\electron\dist\electron.exe" set "NEED_INSTALL=1"

if "%NEED_INSTALL%"=="0" (
  for /f "delims=" %%V in ('node -p "require('./package.json').devDependencies.electron"') do set "WANTED_ELECTRON=%%V"
  for /f "delims=" %%V in ('node -p "require('./node_modules/electron/package.json').version"') do set "INSTALLED_ELECTRON=%%V"
  if not "%WANTED_ELECTRON%"=="%INSTALLED_ELECTRON%" set "NEED_INSTALL=1"
)

if "%NEED_INSTALL%"=="1" (
  echo Atualizando o motor Electron...
  call npm install --no-audit --no-fund --prefer-offline
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
