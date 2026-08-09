' Start WebUI in background (no console window). Log -> work\webui.log
Set ws = CreateObject("Wscript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
dir = fso.GetParentFolderName(WScript.ScriptFullName)
cmd = "cmd.exe /c """ & dir & "\run_hidden.bat"""
ws.CurrentDirectory = dir
ws.Run cmd, 0, False
WScript.Sleep 2500
ws.Run "http://127.0.0.1:8788", 1, False
