@echo off
setlocal EnableExtensions
cd /d "%~dp0"
set "LOG=%~dp0launcher.log"

echo.>>"%LOG%"
echo ==========================================>>"%LOG%"
echo %date% %time% - Iniciando Lucas Gravacoes>>"%LOG%"

call :repair_shortcut

if exist "..\.git" (
  where git >nul 2>nul
  if not errorlevel 1 (
    git -C ".." pull --ff-only --quiet >>"%LOG%" 2>&1
    call :repair_shortcut
  )
) else (
  call "%~dp0INSTALAR-AUTO-ATUALIZACAO.bat"
  exit /b
)

where node >nul 2>nul
if errorlevel 1 (
  echo %date% %time% - ERRO: Node.js nao encontrado>>"%LOG%"
  exit /b 1
)

set "NEED_INSTALL=0"
if not exist "node_modules\electron\dist\electron.exe" set "NEED_INSTALL=1"
if not exist "node_modules\loudness\package.json" set "NEED_INSTALL=1"

if "%NEED_INSTALL%"=="0" (
  for /f "delims=" %%V in ('node -p "require('./package.json').devDependencies.electron"') do set "WANTED_ELECTRON=%%V"
  for /f "delims=" %%V in ('node -p "require('./node_modules/electron/package.json').version"') do set "INSTALLED_ELECTRON=%%V"
  if not "%WANTED_ELECTRON%"=="%INSTALLED_ELECTRON%" set "NEED_INSTALL=1"
)

if "%NEED_INSTALL%"=="1" (
  echo %date% %time% - Atualizando Electron>>"%LOG%"
  call npm install --no-audit --no-fund --prefer-offline >>"%LOG%" 2>&1
  if errorlevel 1 (
    echo %date% %time% - ERRO ao atualizar Electron>>"%LOG%"
    exit /b 1
  )
)

echo %date% %time% - Abrindo Electron>>"%LOG%"
call npm start >>"%LOG%" 2>&1
if errorlevel 1 echo %date% %time% - ERRO ao iniciar Electron>>"%LOG%"
exit /b

:repair_shortcut
if exist "%~dp0ATUALIZAR-ATALHO.vbs" (
  cscript //nologo "%~dp0ATUALIZAR-ATALHO.vbs" >>"%LOG%" 2>&1
)
exit /b 0
