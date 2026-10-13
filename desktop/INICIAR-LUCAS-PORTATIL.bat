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

if not exist "%ELECTRON%" goto :runtime_missing

rem O modo portatil nao atualiza por Git.
rem Use o botao "Atualizar portatil" dentro do programa.
echo %date% %time% - Iniciando Electron portatil>>"%LOG%"
start "" "%ELECTRON%" "%~dp0"
exit /b 0

:runtime_missing
echo %date% %time% - ERRO: Electron portatil nao esta preparado>>"%LOG%"
powershell -NoProfile -Command "Add-Type -AssemblyName PresentationFramework; [System.Windows.MessageBox]::Show('O Lucas Gravacoes Portatil ainda nao foi preparado neste HD. Execute PREPARAR-LUCAS-GRAVACOES-PORTATIL.bat em um computador com Node.js e internet.','Lucas Gravacoes Portatil','OK','Error')" >nul 2>nul
exit /b 1
