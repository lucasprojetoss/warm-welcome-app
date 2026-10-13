param(
  [Parameter(Mandatory=$true)][string]$Zip,
  [Parameter(Mandatory=$true)][string]$Root,
  [Parameter(Mandatory=$true)][string]$Token,
  [Parameter(Mandatory=$true)][int]$AppPid
)

$ErrorActionPreference = 'Stop'
$dataDir = Join-Path $Root 'LucasGravacoes-Dados'
New-Item -ItemType Directory -Path $dataDir -Force | Out-Null
$log = Join-Path $dataDir 'atualizacao-portatil.log'
$parent = Split-Path -Parent $Root
$name = Split-Path -Leaf $Root
$stage = Join-Path $parent ($name + '.__update_' + $Token)

function Write-Log([string]$Text) {
  Add-Content -LiteralPath $log -Value ((Get-Date -Format 'yyyy-MM-dd HH:mm:ss') + ' - ' + $Text) -Encoding UTF8
}

function Show-UpdateMessage([string]$Text, [string]$Kind='Information') {
  try {
    Add-Type -AssemblyName PresentationFramework
    [System.Windows.MessageBox]::Show($Text, 'Lucas Gravacoes - Atualizacao', 'OK', $Kind) | Out-Null
  } catch {}
}

try {
  Write-Log ('INICIO token=' + $Token + ' root=' + $Root + ' pid=' + $AppPid)

  Write-Log 'Aguardando o Lucas Gravacoes fechar completamente.'
  try { Wait-Process -Id $AppPid -Timeout 60 -ErrorAction SilentlyContinue } catch {}
  Start-Sleep -Seconds 3

  if (Get-Process -Id $AppPid -ErrorAction SilentlyContinue) {
    throw 'O processo principal do Lucas Gravacoes nao fechou a tempo.'
  }

  if (Test-Path -LiteralPath $stage) {
    Remove-Item -LiteralPath $stage -Recurse -Force
  }
  New-Item -ItemType Directory -Path $stage -Force | Out-Null

  Write-Log 'Extraindo pacote baixado.'
  Expand-Archive -LiteralPath $Zip -DestinationPath $stage -Force

  $source = Join-Path $stage 'LucasGravacoes-Portable'
  if (!(Test-Path -LiteralPath $source)) {
    $dirs = @(Get-ChildItem -LiteralPath $stage -Directory)
    if ($dirs.Count -eq 1) { $source = $dirs[0].FullName }
  }

  $package = Join-Path $source 'desktop\package.json'
  $electron = Join-Path $source 'desktop\node_modules\electron\dist\electron.exe'
  $main = Join-Path $source 'desktop\main.cjs'
  $index = Join-Path $source 'index.html'
  $openerSource = Join-Path $source 'ABRIR-LUCAS-GRAVACOES-PORTATIL.vbs'

  foreach ($required in @($package,$electron,$main,$index,$openerSource)) {
    if (!(Test-Path -LiteralPath $required)) {
      throw ('Pacote incompleto. Arquivo ausente: ' + $required)
    }
  }

  $newVersion = [string](Get-Content -LiteralPath $package -Raw | ConvertFrom-Json).version
  Write-Log ('Versao recebida: ' + $newVersion)

  Write-Log 'Copiando arquivos para a pasta atual, sem tocar em LucasGravacoes-Dados.'
  & robocopy.exe $source $Root /E /R:5 /W:2 /XD 'LucasGravacoes-Dados' /XF 'desktop-runtime.log' 'atualizacao-portatil.log' | Out-Null
  $rc = $LASTEXITCODE
  Write-Log ('Robocopy codigo=' + $rc)
  if ($rc -ge 8) {
    throw ('Falha ao copiar os arquivos. Codigo Robocopy ' + $rc)
  }

  $installedPackage = Join-Path $Root 'desktop\package.json'
  $installedVersion = [string](Get-Content -LiteralPath $installedPackage -Raw | ConvertFrom-Json).version
  Write-Log ('Versao instalada depois da copia: ' + $installedVersion)

  if ($installedVersion -ne $newVersion) {
    throw ('Versao nao confere. Esperado ' + $newVersion + ', encontrado ' + $installedVersion)
  }

  $flag = Join-Path $dataDir ('update-ok-' + $Token + '.flag')
  if (Test-Path -LiteralPath $flag) { Remove-Item -LiteralPath $flag -Force }

  $env:LUCAS_PORTABLE_UPDATE_TOKEN = $Token
  $opener = Join-Path $Root 'ABRIR-LUCAS-GRAVACOES-PORTATIL.vbs'
  Write-Log ('Abrindo v' + $installedVersion + ' por ' + $opener)
  Start-Process -FilePath 'wscript.exe' -ArgumentList ('"' + $opener + '"')

  $confirmed = $false
  for ($i = 0; $i -lt 120; $i++) {
    if (Test-Path -LiteralPath $flag) {
      $confirmed = $true
      break
    }
    Start-Sleep -Milliseconds 500
  }

  if ($confirmed) {
    Write-Log ('SUCESSO: v' + $installedVersion + ' iniciou e confirmou a atualizacao.')
    try { Remove-Item -LiteralPath $flag -Force } catch {}
  } else {
    Write-Log ('AVISO: v' + $installedVersion + ' foi copiada, mas nao confirmou a abertura.')
    Show-UpdateMessage ('A versao ' + $installedVersion + ' foi copiada. Se o programa nao abriu sozinho, abra pelo ABRIR-LUCAS-GRAVACOES-PORTATIL.') 'Warning'
  }

  try { Remove-Item -LiteralPath $stage -Recurse -Force } catch {}
  try { Remove-Item -LiteralPath $Zip -Force } catch {}
}
catch {
  Write-Log ('ERRO: ' + $_.Exception.Message)
  Show-UpdateMessage ('Nao foi possivel concluir a atualizacao.' + [Environment]::NewLine + [Environment]::NewLine + $_.Exception.Message + [Environment]::NewLine + [Environment]::NewLine + 'Veja LucasGravacoes-Dados\atualizacao-portatil.log') 'Error'
}

try { Remove-Item -LiteralPath $MyInvocation.MyCommand.Path -Force } catch {}
