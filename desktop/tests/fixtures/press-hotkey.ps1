# Presses a key combination system-wide, so the real RegisterHotKey path fires.
# Keys is a comma-separated string: -File hands PowerShell plain text, and it would read "17,18" as 1718.
param([Parameter(Mandatory)][string]$Keys)
$ErrorActionPreference = 'Stop'
[byte[]]$codes = $Keys -split ',' | ForEach-Object { [byte]$_ }
Add-Type -Namespace QzTest -Name Keys -MemberDefinition '[DllImport("user32.dll")] public static extern void keybd_event(byte vk, byte scan, uint flags, System.UIntPtr extra);'
foreach ($code in $codes) { [QzTest.Keys]::keybd_event($code, 0, 0, [UIntPtr]::Zero) }
[array]::Reverse($codes)
foreach ($code in $codes) { [QzTest.Keys]::keybd_event($code, 0, 2, [UIntPtr]::Zero) }
