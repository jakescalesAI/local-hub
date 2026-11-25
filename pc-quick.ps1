# The Sidebar's Windows controls, for pc.mjs: Wi-Fi's name, Bluetooth, the microphone, each app's own volume, dark mode, staying
# awake, locking, turning the screens off. Reads one JSON command per line and answers each with one JSON line.
$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = [Console]::OutputEncoding = New-Object System.Text.UTF8Encoding $false
Add-Type -AssemblyName System.Runtime.WindowsRuntime, System.Drawing, System.Windows.Forms
$asTask = [System.WindowsRuntimeSystemExtensions].GetMethods() | ? { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1' } | Select-Object -First 1
function Wait-Op($op, $type) { $t = $asTask.MakeGenericMethod($type).Invoke($null, @($op)); if (-not $t.Wait(3000)) { throw 'timed out' }; $t.Result }
$null = [Windows.Devices.Radios.Radio, Windows.System.Devices, ContentType = WindowsRuntime]
$null = [Windows.Networking.Connectivity.NetworkInformation, Windows.Networking.Connectivity, ContentType = WindowsRuntime]
$null = [Windows.Devices.Enumeration.DeviceInformation, Windows.Devices.Enumeration, ContentType = WindowsRuntime]
$hasMix = $false
try {
  Add-Type -TypeDefinition @'
using System; using System.Collections.Generic; using System.Runtime.InteropServices;
[Guid("5CDF2C82-841E-4546-9722-0CF74078229A"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IQEnd { int a(IntPtr p); int b(IntPtr p); int c(out int n); int d(float f, IntPtr g); int SetVol(float f, IntPtr g); int e(out float f); int GetVol(out float f); int h(int i, float f, IntPtr g); int j(int i, float f, IntPtr g); int k(int i, out float f); int l(int i, out float f); int SetMute([MarshalAs(UnmanagedType.Bool)] bool m, IntPtr g); int GetMute([MarshalAs(UnmanagedType.Bool)] out bool m); }
[Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IQDev { int Activate(ref Guid id, int ctx, IntPtr p, [MarshalAs(UnmanagedType.IUnknown)] out object o); }
[Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IQEnum { int f(); [PreserveSig] int GetDefaultAudioEndpoint(int flow, int role, out IQDev d); }
[Guid("77AA99A0-1BD6-484F-8BC7-2C654C9A9B6F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IQMan { int a(IntPtr g, int f, IntPtr o); int b(IntPtr g, int f, IntPtr o); int GetSessionEnumerator(out IQSess s); }
[Guid("E2F5BB11-0570-40CA-ACDD-3AA01277DEE8"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IQSess { int GetCount(out int n); int GetSession(int i, [MarshalAs(UnmanagedType.IUnknown)] out object o); }
[Guid("bfb7ff88-7239-4fc9-8fa2-07c950be9c6d"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IQCtl { int GetState(out int s); int b(out IntPtr s); int c(IntPtr s, IntPtr g); int d(out IntPtr s); int e(IntPtr s, IntPtr g); int f(out Guid g); int h(ref Guid g, IntPtr c); int i(IntPtr p); int j(IntPtr p); int k(out IntPtr s); int l(out IntPtr s); [PreserveSig] int GetProcessId(out int p); [PreserveSig] int IsSystem(); }
[Guid("87CE5498-68D6-44E5-9215-6DA47EF883D8"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IQVol { int SetVol(float f, IntPtr g); int GetVol(out float f); int SetMute([MarshalAs(UnmanagedType.Bool)] bool m, IntPtr g); int GetMute([MarshalAs(UnmanagedType.Bool)] out bool m); }
public class HubQuick {
  static object On(int flow, string iid) { IQEnum e = (IQEnum)Activator.CreateInstance(Type.GetTypeFromCLSID(new Guid("BCDE0395-E52F-467C-8E3D-C4579291692E"))); IQDev d; if (e.GetDefaultAudioEndpoint(flow, 1, out d) != 0) return null; Guid g = new Guid(iid); object o; d.Activate(ref g, 23, IntPtr.Zero, out o); return o; }
  static IQEnd End(int flow) { return (IQEnd)On(flow, "5CDF2C82-841E-4546-9722-0CF74078229A"); }
  /// 0 is what plays, 1 is the microphone. -1: there isn't one.
  public static int Muted(int flow) { IQEnd e = End(flow); if (e == null) return -1; bool m; e.GetMute(out m); return m ? 1 : 0; }
  public static void Mute(int flow, bool m) { IQEnd e = End(flow); if (e != null) e.SetMute(m, IntPtr.Zero); }
  delegate void Each(int pid, int state, bool sys, IQVol v);
  static void All(Each f) { IQMan m = (IQMan)On(0, "77AA99A0-1BD6-484F-8BC7-2C654C9A9B6F"); if (m == null) return; IQSess s; m.GetSessionEnumerator(out s); int n; s.GetCount(out n); for (int i = 0; i < n; i++) { object o; s.GetSession(i, out o); IQCtl c = (IQCtl)o; int st, pid; c.GetState(out st); c.GetProcessId(out pid); if (st != 2) f(pid, st, c.IsSystem() == 0, (IQVol)o); } }
  public static string[] Mix() { List<string> l = new List<string>(); All(delegate(int pid, int st, bool sys, IQVol v) { float f; bool m; v.GetVol(out f); v.GetMute(out m); l.Add((sys ? 0 : pid) + "|" + st + "|" + (int)Math.Round(f * 100) + "|" + (m ? 1 : 0)); }); return l.ToArray(); }
  public static bool SetMix(int[] pids, int vol, int mute) { bool done = false; All(delegate(int pid, int st, bool sys, IQVol v) { if (Array.IndexOf(pids, sys ? 0 : pid) < 0) return; if (vol >= 0) v.SetVol(Math.Min(100, vol) / 100f, IntPtr.Zero); if (mute >= 0) v.SetMute(mute == 1, IntPtr.Zero); done = true; }); return done; }
  [DllImport("user32")] public static extern bool LockWorkStation();
  [DllImport("user32", CharSet = CharSet.Unicode)] static extern IntPtr SendMessageTimeoutW(IntPtr h, int m, IntPtr w, string l, int f, int t, out IntPtr r);
  [DllImport("user32")] static extern bool PostMessageW(IntPtr h, int m, IntPtr w, IntPtr l);
  [DllImport("kernel32")] static extern uint SetThreadExecutionState(uint f);
  public static void ScreensOff() { PostMessageW(new IntPtr(0xffff), 0x112, new IntPtr(0xF170), new IntPtr(2)); }
  public static void Themed() { IntPtr r; SendMessageTimeoutW(new IntPtr(0xffff), 0x1a, IntPtr.Zero, "ImmersiveColorSet", 2, 400, out r); }
  public static void Awake(bool on) { SetThreadExecutionState(on ? 0x80000003u : 0x80000000u); }
}
'@
  $hasMix = $true
} catch {}
$theme = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Themes\Personalize'
$names = @{}; $paths = @{}; $awake = $false; $btAt = [DateTime]::MinValue; $btList = @()
function Get-Radio { @(Wait-Op ([Windows.Devices.Radios.Radio]::GetRadiosAsync()) ([System.Collections.Generic.IReadOnlyList[Windows.Devices.Radios.Radio]])) | ? { "$($_.Kind)" -eq 'Bluetooth' } | Select-Object -First 1 }
function Get-Mix {
  if (-not $hasMix) { return }
  $by = [ordered]@{}
  foreach ($x in [HubQuick]::Mix()) {
    $q = $x -split '\|'; $id = [int]$q[0]
    if ($id -eq 0) { $key = 'system'; $label = 'System sounds' }
    else {
      if (-not $names.ContainsKey($id)) { try { $p = Get-Process -Id $id; $label = ''; try { $label = $p.MainModule.FileVersionInfo.FileDescription; $paths[$p.ProcessName.ToLower()] = $p.MainModule.FileName } catch {}; $names[$id] = @($p.ProcessName.ToLower(), $(if ($label) { $label } else { $p.ProcessName })) } catch { $names[$id] = $null } }
      if (-not $names[$id]) { continue }
      $key = $names[$id][0]; $label = $names[$id][1]
      # Apple Music's sound comes from a helper of its own.
      if ($key -eq 'amplibraryagent') { $key = 'applemusic'; $label = 'Apple Music' }
    }
    if (-not $by.Contains($key)) { $by[$key] = @{ id = $key; name = $label; pids = @(); level = [int]$q[2]; muted = $q[3] -eq '1'; playing = $false } }
    $by[$key].pids += $id
    if ($q[1] -eq '1') { $by[$key].playing = $true }
  }
  $by.Values
}
while ($null -ne ($line = [Console]::In.ReadLine())) {
  $c = $null
  try {
    $c = $line | ConvertFrom-Json
    $r = @{}
    switch ($c.cmd) {
      'state' {
        $r.mix = @(Get-Mix)
        if ($hasMix) { try { $r.mic = [HubQuick]::Muted(1) } catch { $r.mic = -1 }; try { $r.muted = [HubQuick]::Muted(0) -eq 1 } catch {} }
        try { $b = Get-Radio; if ($b) { $r.bt = @{ on = "$($b.State)" -eq 'On' } } } catch {}
        if ($r.bt -and $r.bt.on) {
          if (((Get-Date) - $btAt).TotalSeconds -gt 12) { $btAt = Get-Date; try { $sel = '(System.Devices.Aep.ProtocolId:="{e0cbf06c-cd8b-4647-bb8a-263b43f0f974}" OR System.Devices.Aep.ProtocolId:="{bb7bb05e-5972-42b5-94fc-76eaa7084d49}") AND System.Devices.Aep.IsConnected:=System.StructuredQueryType.Boolean#True'; $btList = @(Wait-Op ([Windows.Devices.Enumeration.DeviceInformation]::FindAllAsync($sel, [string[]]@(), [Windows.Devices.Enumeration.DeviceInformationKind]::AssociationEndpoint)) ([Windows.Devices.Enumeration.DeviceInformationCollection]) | % { "$($_.Name)" } | ? { $_ } | Select-Object -Unique -First 6) } catch { $btList = @() } }
          $r.bt.devices = @($btList)
        }
        try { $p = [Windows.Networking.Connectivity.NetworkInformation]::GetInternetConnectionProfile(); if ($p) { $r.net = @{ name = "$($p.ProfileName)"; wifi = [bool]$p.IsWlanConnectionProfile; bars = $(try { [int]$p.GetSignalBars() } catch { 0 }) } } } catch {}
        try { $r.dark = (Get-ItemProperty $theme -ErrorAction Stop).AppsUseLightTheme -eq 0 } catch {}
        $w = [System.Windows.Forms.SystemInformation]::PowerStatus
        if ("$($w.BatteryChargeStatus)" -notmatch 'NoSystemBattery') { $r.battery = @{ level = [int][Math]::Round($w.BatteryLifePercent * 100); plugged = "$($w.PowerLineStatus)" -eq 'Online' } }
        $r.awake = $awake
      }
      'mix' { $want = @(Get-Mix | ? { $_.id -eq $c.arg.id }); $r.ok = [bool]($want.Count -and [HubQuick]::SetMix([int[]]$want[0].pids, [int]$c.arg.level, [int]$c.arg.mute)) }
      'mic' { [HubQuick]::Mute(1, -not [bool]$c.arg); $r.ok = $true }
      'mute' { [HubQuick]::Mute(0, [bool]$c.arg); $r.ok = $true }
      'bt' { $b = Get-Radio; $null = Wait-Op ([Windows.Devices.Radios.Radio]::RequestAccessAsync()) ([Windows.Devices.Radios.RadioAccessStatus]); $r.ok = "$(Wait-Op ($b.SetStateAsync($(if ($c.arg) { 'On' } else { 'Off' }))) ([Windows.Devices.Radios.RadioAccessStatus]))" -eq 'Allowed'; $btAt = [DateTime]::MinValue }
      'dark' { $v = [int](-not [bool]$c.arg); Set-ItemProperty $theme AppsUseLightTheme $v -Type DWord; Set-ItemProperty $theme SystemUsesLightTheme $v -Type DWord; [HubQuick]::Themed(); $r.ok = $true }
      'awake' { $awake = [bool]$c.arg; [HubQuick]::Awake($awake); $r.ok = $true }
      'lock' { $r.ok = [HubQuick]::LockWorkStation() }
      'screens' { [HubQuick]::ScreensOff(); $r.ok = $true }
      'icon' {
        $f = $paths["$($c.arg)"]; $r.png = ''
        if ($f) { $i = [System.Drawing.Icon]::ExtractAssociatedIcon($f); $m = New-Object IO.MemoryStream; $i.ToBitmap().Save($m, [System.Drawing.Imaging.ImageFormat]::Png); $r.png = [Convert]::ToBase64String($m.ToArray()) }
      }
    }
    $r.n = $c.n
    [Console]::Out.WriteLine(($r | ConvertTo-Json -Compress -Depth 6))
  } catch {
    [Console]::Out.WriteLine((@{ n = $(if ($c) { $c.n } else { 0 }); error = "$($_.Exception.Message)" } | ConvertTo-Json -Compress))
  }
}
