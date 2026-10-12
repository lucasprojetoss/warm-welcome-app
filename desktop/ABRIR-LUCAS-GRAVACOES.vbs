Option Explicit
Dim shell, fso, base, bat
Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
base = fso.GetParentFolderName(WScript.ScriptFullName)
bat = Chr(34) & base & "\INICIAR-LUCAS-GRAVACOES.bat" & Chr(34)
shell.Run bat, 0, False
