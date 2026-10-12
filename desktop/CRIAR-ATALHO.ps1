$ErrorActionPreference = "SilentlyContinue"
$desktop = [Environment]::GetFolderPath("Desktop")
$linkPath = Join-Path $desktop "Lucas Gravacoes.lnk"
$base = Split-Path -Parent $MyInvocation.MyCommand.Path
$vbs = Join-Path $base "ABRIR-LUCAS-GRAVACOES.vbs"

$w = New-Object -ComObject WScript.Shell
$s = $w.CreateShortcut($linkPath)
$s.TargetPath = "$env:SystemRoot\System32\wscript.exe"
$s.Arguments = '"' + $vbs + '"'
$s.WorkingDirectory = $base
$s.IconLocation = "$env:SystemRoot\System32\shell32.dll,137"
$s.Save()
