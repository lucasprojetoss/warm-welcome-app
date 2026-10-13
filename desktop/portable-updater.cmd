@echo off
setlocal EnableExtensions EnableDelayedExpansion

set "ZIP=%~1"
set "ROOT=%~2"
set "TOKEN=%~3"
set "APPPID=%~4"
set "DATA=%ROOT%\LucasGravacoes-Dados"
if not exist "%DATA%" mkdir "%DATA%" >nul 2>nul
set "LOG=%DATA%\atualizacao-portatil.log"
set "PARENT=%ROOT%\.."
set "STAGE=%PARENT%\LucasGravacoes-Portable.__update_%TOKEN%"

call :log INICIO token=%TOKEN% root=%ROOT% pid=%APPPID%

call :log Aguardando o Lucas Gravacoes fechar completamente.
set /a WAIT=0
:wait_app
tasklist /FI "PID eq %APPPID%" 2>nul | find "%APPPID%" >nul
if errorlevel 1 goto app_closed
set /a WAIT+=1
if %WAIT% GEQ 60 (
  call :fail O processo principal nao fechou a tempo.
  goto end
)
ping 127.0.0.1 -n 2 >nul
goto wait_app

:app_closed
ping 127.0.0.1 -n 3 >nul
call :log Processo principal encerrado.

if exist "%STAGE%" rmdir /s /q "%STAGE%"
mkdir "%STAGE%" >nul 2>nul
if errorlevel 1 (
  call :fail Nao foi possivel criar a pasta temporaria.
  goto end
)

call :log Extraindo pacote.
where tar.exe >nul 2>nul
if errorlevel 1 (
  call :fail O Windows nao encontrou tar.exe para extrair o pacote.
  goto end
)

tar.exe -xf "%ZIP%" -C "%STAGE%" >>"%LOG%" 2>&1
if errorlevel 1 (
  call :fail Falha ao extrair o ZIP.
  goto end
)

set "SOURCE=%STAGE%\LucasGravacoes-Portable"
if not exist "%SOURCE%\desktop\package.json" (
  for /d %%D in ("%STAGE%\*") do (
    if exist "%%~fD\desktop\package.json" set "SOURCE=%%~fD"
  )
)

if not exist "%SOURCE%\desktop\package.json" (
  call :fail Pacote extraido sem desktop\package.json.
  goto end
)
if not exist "%SOURCE%\desktop\node_modules\electron\dist\electron.exe" (
  call :fail Pacote extraido sem Electron.
  goto end
)

for /f "tokens=2 delims=:, " %%V in ('findstr /i /c:"\"version\"" "%SOURCE%\desktop\package.json"') do (
  set "NEWVER=%%~V"
  goto got_newver
)
:got_newver
if not defined NEWVER set "NEWVER=desconhecida"
call :log Versao recebida: %NEWVER%

call :log Copiando arquivos para a mesma pasta.
robocopy "%SOURCE%" "%ROOT%" /E /R:5 /W:2 /XD "LucasGravacoes-Dados" /XF "desktop-runtime.log" "atualizacao-portatil.log" >>"%LOG%" 2>&1
set "RC=%ERRORLEVEL%"
call :log Robocopy codigo=%RC%
if %RC% GEQ 8 (
  call :fail Falha ao copiar os arquivos. Codigo Robocopy %RC%.
  goto end
)

for /f "tokens=2 delims=:, " %%V in ('findstr /i /c:"\"version\"" "%ROOT%\desktop\package.json"') do (
  set "INSTVER=%%~V"
  goto got_instver
)
:got_instver
if not defined INSTVER set "INSTVER=desconhecida"
call :log Versao instalada: %INSTVER%

set "FLAG=%DATA%\update-ok-%TOKEN%.flag"
if exist "%FLAG%" del /q "%FLAG%" >nul 2>nul

set "LUCAS_PORTABLE_UPDATE_TOKEN=%TOKEN%"
call :log Abrindo versao atualizada.
start "" wscript.exe "%ROOT%\ABRIR-LUCAS-GRAVACOES-PORTATIL.vbs"

set /a CONFIRM=0
:wait_confirm
if exist "%FLAG%" goto confirmed
set /a CONFIRM+=1
if %CONFIRM% GEQ 120 goto not_confirmed
ping 127.0.0.1 -n 2 >nul
goto wait_confirm

:confirmed
call :log SUCESSO: versao %INSTVER% confirmou inicializacao.
del /q "%FLAG%" >nul 2>nul
goto cleanup

:not_confirmed
call :log AVISO: versao %INSTVER% foi copiada mas nao confirmou inicializacao.
goto cleanup

:cleanup
if exist "%STAGE%" rmdir /s /q "%STAGE%" >nul 2>nul
if exist "%ZIP%" del /q "%ZIP%" >nul 2>nul
goto end

:fail
call :log ERRO: %*
goto end

:log
>>"%LOG%" echo [%date% %time%] %*
exit /b 0

:end
endlocal
del "%~f0" >nul 2>nul
