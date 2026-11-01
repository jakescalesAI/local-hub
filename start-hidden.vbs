' Starts the hub with no window. To start it at login, add this file to HKCU\Software\Microsoft\Windows\CurrentVersion\Run.
Set fso = CreateObject("Scripting.FileSystemObject")
here = fso.GetParentFolderName(WScript.ScriptFullName)
Set sh = CreateObject("WScript.Shell")
sh.CurrentDirectory = here
sh.Run "cmd /c node """ & here & "\server.mjs"" >> """ & here & "\hub.log"" 2>&1", 0, False
' Anything of your own that should start with the hub goes in config\on-start.cmd.
If fso.FileExists(here & "\config\on-start.cmd") Then sh.Run "cmd /c """ & here & "\config\on-start.cmd""", 0, False
