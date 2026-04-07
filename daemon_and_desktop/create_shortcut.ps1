$ws = New-Object -ComObject WScript.Shell
$desktopPath = Join-Path $env:USERPROFILE "OneDrive\Desktop"
$lnkPath = Join-Path $desktopPath "Sovereign Bridge.lnk"
$lnk = $ws.CreateShortcut($lnkPath)
$lnk.TargetPath = "pythonw.exe"
$lnk.Arguments = "bridge_daemon.py"
$lnk.WorkingDirectory = "$PSScriptRoot"
$lnk.IconLocation = "$PSScriptRoot\sovereign_bridge.ico,0"
$lnk.Description = "Sovereign Bridge"
$lnk.Save()
Write-Host "Shortcut created at: $lnkPath"
