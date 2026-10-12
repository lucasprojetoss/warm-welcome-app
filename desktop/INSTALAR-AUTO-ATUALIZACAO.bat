@echo off
setlocal EnableExtensions
title Lucas Gravacoes - Configuracao de Atualizacao Automatica

set "REPO=https://github.com/lucasprojetoss/warm-welcome-app.git"
set "TARGET=%LOCALAPPDATA%\LucasGravacoes"
set "GITEXE="

echo.
echo ==================================================
echo   LUCAS GRAVACOES - ATUALIZACAO AUTOMATICA
echo ==================================================
echo.
echo O sistema sera instalado em:
echo %TARGET%
echo.
echo Depois disso, as atualizacoes serao buscadas
echo automaticamente sempre que o programa for aberto.
echo.

where git >nul 2>nul
if not errorlevel 1 set "GITEXE=git"

if not defined GITEXE if exist "%ProgramFiles%\Git\cmd\git.exe" set "GITEXE=%ProgramFiles%\Git\cmd\git.exe"
if not defined GITEXE if exist "%LocalAppData%\Programs\Git\cmd\git.exe" set "GITEXE=%LocalAppData%\Programs\Git\cmd\git.exe"

if not defined GITEXE (
  echo Git nao foi encontrado. Tentando instalar automaticamente...
  where winget >nul 2>nul
  if errorlevel 1 (
    echo.
    echo Nao consegui instalar o Git automaticamente.
    echo Instale "Git for Windows" e execute este arquivo novamente.
    pause
    exit /b 1
  )
  winget install --id Git.Git -e --source winget --accept-package-agreements --accept-source-agreements
  if exist "%ProgramFiles%\Git\cmd\git.exe" set "GITEXE=%ProgramFiles%\Git\cmd\git.exe"
  if not defined GITEXE (
    echo.
    echo O Git foi instalado, mas o Windows ainda nao atualizou o caminho.
    echo Feche esta janela e execute o arquivo novamente.
    pause
    exit /b 1
  )
)

if exist "%TARGET%\.git" (
  echo Instalacao encontrada. Atualizando...
  "%GITEXE%" -C "%TARGET%" pull --ff-only
  if errorlevel 1 goto :giterror
) else (
  if exist "%TARGET%" (
    echo Removendo instalacao incompleta anterior...
    rmdir /s /q "%TARGET%"
  )
  echo.
  echo Conectando ao seu GitHub...
  echo Como o repositorio e privado, o GitHub pode abrir
  echo uma janela de login. Entre na sua conta apenas uma vez.
  echo.
  "%GITEXE%" clone "%REPO%" "%TARGET%"
  if errorlevel 1 goto :giterror
)

echo.
echo Criando atalho na Area de Trabalho...
powershell -NoProfile -ExecutionPolicy Bypass -Command "$W=New-Object -ComObject WScript.Shell; $S=$W.CreateShortcut([Environment]::GetFolderPath('Desktop')+'\Lucas Gravacoes.lnk'); $S.TargetPath='%TARGET%\desktop\INICIAR-LUCAS-GRAVACOES.bat'; $S.WorkingDirectory='%TARGET%\desktop'; $S.IconLocation='%SystemRoot%\System32\shell32.dll,137'; $S.Save()" >nul 2>nul

echo.
echo Configuracao concluida.
echo A partir de agora use o atalho "Lucas Gravacoes".
echo Ele verifica atualizacoes antes de abrir.
echo.
start "" "%TARGET%\desktop\INICIAR-LUCAS-GRAVACOES.bat"
exit /b 0

:giterror
echo.
echo Nao foi possivel conectar ao repositorio privado.
echo Confirme o login do GitHub e tente novamente.
pause
exit /b 1
