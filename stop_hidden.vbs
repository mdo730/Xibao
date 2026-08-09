' Stop the background WebUI process
Set objWMI = GetObject("winmgmts:\\.\root\cimv2")
Set colItems = objWMI.ExecQuery("SELECT ProcessId, CommandLine FROM Win32_Process WHERE Name = 'python.exe'")
Dim found
found = False
For Each objItem in colItems
    If InStr(objItem.CommandLine, "src.webui.app") > 0 Then
        objItem.Terminate()
        found = True
    End If
Next
If found Then
    MsgBox "WebUI stopped", 64, "Life Assistant"
Else
    MsgBox "No running WebUI process found", 48, "Life Assistant"
End If
