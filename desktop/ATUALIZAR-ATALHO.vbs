Option Explicit
Dim shell, fso, base, desktop, shortcutPath, target, sc
Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
base = fso.GetParentFolderName(WScript.ScriptFullName)
desktop = shell.SpecialFolders("Desktop")
shortcutPath = fso.BuildPath(desktop, "Lucas Gravacoes.lnk")
target = fso.BuildPath(base, "ABRIR-LUCAS-GRAVACOES.vbs")
Set sc = shell.CreateShortcut(shortcutPath)
sc.TargetPath = target
sc.WorkingDirectory = base
sc.IconLocation = shell.ExpandEnvironmentStrings("%SystemRoot%\System32\shell32.dll") & ",137"
sc.Save
WScript.Echo "Atalho Lucas Gravacoes atualizado. Agora ele abre sem CMD."
