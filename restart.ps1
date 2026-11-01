# Restarts this hub: stops it, its ssh tunnels and anything it started from this folder, then relaunches it hidden.
$here = [regex]::Escape($PSScriptRoot)
$hub = Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object { $_.CommandLine -match $here }
Get-CimInstance Win32_Process -Filter "Name='ssh.exe'" |
  Where-Object { $_.ParentProcessId -in $hub.ProcessId -and $_.CommandLine -match ' -N ' } |
  ForEach-Object { Stop-Process -Id $_.ProcessId -Force }
$hub | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }
Get-CimInstance Win32_Process -Filter "Name='caddy.exe'" |
  Where-Object { $_.ExecutablePath -match $here } |
  ForEach-Object { Stop-Process -Id $_.ProcessId -Force }
Start-Sleep 1
Start-Process wscript.exe -ArgumentList "`"$PSScriptRoot\start-hidden.vbs`""
