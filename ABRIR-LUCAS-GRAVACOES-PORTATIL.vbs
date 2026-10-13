Option Explicit
Dim shell, fso, root, bat
Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
root = fso.GetParentFolderName(WScript.ScriptFullName)
bat = Chr(34) & fso.BuildPath(root, "desktop\INICIAR-LUCAS-PORTATIL.bat") & Chr(34)
shell.Run bat, 0, False
