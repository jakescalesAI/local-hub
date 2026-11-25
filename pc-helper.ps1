# What this PC is playing, its volume and screen brightness, and its installed apps, for music.mjs and desk.mjs.
# Reads one JSON command per line and answers each with one JSON line. Uses only what Windows offers every app.
$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = [Console]::OutputEncoding = New-Object System.Text.UTF8Encoding $false
Add-Type -AssemblyName System.Runtime.WindowsRuntime, System.Drawing
$asTask = ([System.WindowsRuntimeSystemExtensions].GetMethods() | ? { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1' })[0]
function Wait-Op($op, $type) { $t = $asTask.MakeGenericMethod($type).Invoke($null, @($op)); if (-not $t.Wait(3000)) { throw 'timed out' }; $t.Result }
$null = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager, Windows.Media.Control, ContentType = WindowsRuntime]
$null = [Windows.Storage.Streams.DataReader, Windows.Storage.Streams, ContentType = WindowsRuntime]
$mgr = Wait-Op ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager]::RequestAsync()) ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager])
$hasAudio = $false
try {
  Add-Type -TypeDefinition @'
using System; using System.Runtime.InteropServices;
[Guid("5CDF2C82-841E-4546-9722-0CF74078229A"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IAudioEndpointVolume { int a(); int b(); int c(); int d(); int SetMasterVolumeLevelScalar(float f, Guid g); int e(); int GetMasterVolumeLevelScalar(out float f); }
[Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IMMDevice { int Activate(ref Guid id, int ctx, IntPtr p, [MarshalAs(UnmanagedType.IUnknown)] out object o); }
[Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IMMDeviceEnumerator { int f(); int GetDefaultAudioEndpoint(int flow, int role, out IMMDevice d); }
[ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")] class MMDeviceEnumerator { }
public class HubVolume {
  static IAudioEndpointVolume V() { IMMDevice d; Marshal.ThrowExceptionForHR(((IMMDeviceEnumerator)new MMDeviceEnumerator()).GetDefaultAudioEndpoint(0, 1, out d)); Guid g = typeof(IAudioEndpointVolume).GUID; object o; Marshal.ThrowExceptionForHR(d.Activate(ref g, 23, IntPtr.Zero, out o)); return (IAudioEndpointVolume)o; }
  public static int Get() { float f; Marshal.ThrowExceptionForHR(V().GetMasterVolumeLevelScalar(out f)); return (int)Math.Round(f * 100); }
  public static void Set(int p) { Marshal.ThrowExceptionForHR(V().SetMasterVolumeLevelScalar(Math.Max(0, Math.Min(100, p)) / 100f, Guid.Empty)); }
}
'@
  $hasAudio = $true
} catch {}
$hasOutputs = $false
try {
  Add-Type -TypeDefinition @'
using System; using System.Collections.Generic; using System.Runtime.InteropServices;
[StructLayout(LayoutKind.Sequential)] public struct HubKey { public Guid g; public int n; }
[StructLayout(LayoutKind.Explicit)] public struct HubVar { [FieldOffset(0)] public ushort t; [FieldOffset(8)] public IntPtr p; }
[Guid("886d8eeb-8cf2-4446-8d02-cdba1dbdcf99"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IHubProps { int a(out int n); int b(int i, out HubKey k); [PreserveSig] int GetValue(ref HubKey k, out HubVar v); }
[Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IHubOut { int a(ref Guid id, int ctx, IntPtr p, [MarshalAs(UnmanagedType.IUnknown)] out object o); int OpenPropertyStore(int m, out IHubProps p); int GetId([MarshalAs(UnmanagedType.LPWStr)] out string id); }
[Guid("0BD7A1BE-7A1A-44DB-8397-CC5392387B5E"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IHubOuts { int GetCount(out int n); int Item(int i, out IHubOut d); }
[Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IHubOutEnum { int EnumAudioEndpoints(int flow, int state, out IHubOuts c); int GetDefaultAudioEndpoint(int flow, int role, out IHubOut d); }
[Guid("f8679f50-850a-41cf-9c72-430f290290c8"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IHubPolicy { int a(); int b(); int c(); int d(); int e(); int f(); int g(); int h(); int i(); int j(); [PreserveSig] int SetDefaultEndpoint([MarshalAs(UnmanagedType.LPWStr)] string id, int role); }
[ComImport, Guid("870af99c-171d-4f9e-af0d-e63df40c2bc9")] class HubPolicy { }
public class HubOutputs {
  public static string[] List() {
    IHubOutEnum en = (IHubOutEnum)Activator.CreateInstance(Type.GetTypeFromCLSID(new Guid("BCDE0395-E52F-467C-8E3D-C4579291692E"))); IHubOut d; string def = ""; try { en.GetDefaultAudioEndpoint(0, 1, out d); d.GetId(out def); } catch {}
    IHubOuts c; en.EnumAudioEndpoints(0, 1, out c); int n; c.GetCount(out n); List<string> o = new List<string>();
    for (int i = 0; i < n; i++) { c.Item(i, out d); string id; d.GetId(out id); IHubProps p; d.OpenPropertyStore(0, out p); HubKey k = new HubKey(); k.g = new Guid("a45c254e-df1c-4efd-8020-67d146a850e0"); k.n = 14; HubVar v; string name = ""; if (p.GetValue(ref k, out v) == 0 && v.t == 31) { name = Marshal.PtrToStringUni(v.p); Marshal.FreeCoTaskMem(v.p); } o.Add(id + "\t" + (id == def ? 1 : 0) + "\t" + name); }
    return o.ToArray();
  }
  public static bool Use(string id) { IHubPolicy p = (IHubPolicy)new HubPolicy(); bool ok = true; for (int r = 0; r < 3; r++) if (p.SetDefaultEndpoint(id, r) != 0) ok = false; return ok; }
}
'@
  $hasOutputs = $true
} catch {}
$hasMonitors = $false
try {
  Add-Type -TypeDefinition @'
using System; using System.Collections.Generic; using System.Runtime.InteropServices;
// Every screen in use. An outside monitor takes brightness over its own cable (DDC/CI); one that doesn't is dimmed by the graphics card.
public class HubMonitors {
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)] struct MI { public int cb, l, t, r, b, l2, t2, r2, b2, f; [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 32)] public string dev; }
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)] struct DD { public int cb; [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 32)] public string name; [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 128)] public string str; public int flags; [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 128)] public string id; [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 128)] public string key; }
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)] struct PM { public IntPtr h; [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 128)] public string d; }
  delegate bool Cb(IntPtr m, IntPtr dc, IntPtr r, IntPtr p);
  delegate void Go(string key, string dev, PM[] a, int i);
  [DllImport("user32")] static extern bool EnumDisplayMonitors(IntPtr dc, IntPtr clip, Cb cb, IntPtr p);
  [DllImport("user32", CharSet = CharSet.Unicode)] static extern bool GetMonitorInfoW(IntPtr m, ref MI mi);
  [DllImport("user32", CharSet = CharSet.Unicode)] static extern bool EnumDisplayDevicesW(string dev, int i, ref DD d, int flags);
  [DllImport("dxva2")] static extern bool GetNumberOfPhysicalMonitorsFromHMONITOR(IntPtr m, out int n);
  [DllImport("dxva2", CharSet = CharSet.Unicode)] static extern bool GetPhysicalMonitorsFromHMONITOR(IntPtr m, int n, [Out] PM[] a);
  [DllImport("dxva2")] static extern bool GetVCPFeatureAndVCPFeatureReply(IntPtr h, byte c, IntPtr t, out int cur, out int max);
  [DllImport("dxva2")] static extern bool SetVCPFeature(IntPtr h, byte c, int v);
  [DllImport("dxva2")] static extern bool DestroyPhysicalMonitor(IntPtr h);
  [DllImport("gdi32", CharSet = CharSet.Unicode)] static extern IntPtr CreateDCW(string d, string n, string o, IntPtr p);
  [DllImport("gdi32")] static extern bool SetDeviceGammaRamp(IntPtr dc, ushort[] r);
  [DllImport("gdi32")] static extern bool DeleteDC(IntPtr dc);
  static Dictionary<string, int> soft = new Dictionary<string, int>();
  static string Key(string id) { string[] p = id.Split('#'); return p.Length > 2 ? p[1] + "#" + p[2] : ""; }
  static void Each(Go go) {
    List<IntPtr> all = new List<IntPtr>();
    Cb cb = delegate(IntPtr m, IntPtr a, IntPtr b, IntPtr c) { all.Add(m); return true; };
    EnumDisplayMonitors(IntPtr.Zero, IntPtr.Zero, cb, IntPtr.Zero);
    GC.KeepAlive(cb);
    foreach (IntPtr m in all) {
      MI mi = new MI(); mi.cb = Marshal.SizeOf(typeof(MI)); if (!GetMonitorInfoW(m, ref mi)) continue;
      List<string> ids = new List<string>();
      for (int i = 0; i < 16; i++) { DD d = new DD(); d.cb = Marshal.SizeOf(typeof(DD)); if (!EnumDisplayDevicesW(mi.dev, i, ref d, 1)) break; if ((d.flags & 1) != 0) ids.Add(Key(d.id)); }
      int n; PM[] pm = null;
      if (GetNumberOfPhysicalMonitorsFromHMONITOR(m, out n) && n > 0) { pm = new PM[n]; if (!GetPhysicalMonitorsFromHMONITOR(m, n, pm)) pm = null; }
      for (int i = 0; i < ids.Count; i++) go(ids[i], mi.dev, pm, i);
      if (pm != null) foreach (PM p in pm) DestroyPhysicalMonitor(p.h);
    }
  }
  // The first ask of a monitor that has been quiet often goes unanswered.
  static bool Ask(PM[] a, int i, out int cur, out int max) { cur = max = 0; if (a == null || i >= a.Length) return false; for (int k = 0; k < 2; k++) if (GetVCPFeatureAndVCPFeatureReply(a[i].h, 0x10, IntPtr.Zero, out cur, out max) && max > 0) return true; return false; }
  static bool Dim(string dev, int p) { ushort[] r = new ushort[768]; double k = .5 + p / 200.0; for (int j = 0; j < 768; j++) r[j] = (ushort)((j % 256) * 257 * k); IntPtr dc = CreateDCW(dev, dev, null, IntPtr.Zero); try { return SetDeviceGammaRamp(dc, r); } finally { DeleteDC(dc); } }
  public static string[] List() { List<string> o = new List<string>(); Each(delegate(string id, string dev, PM[] a, int i) { int c, m; bool ok = Ask(a, i, out c, out m); o.Add(id + "|" + (ok ? (int)Math.Round(100.0 * c / m) : soft.ContainsKey(id) ? soft[id] : 100) + "|" + (ok ? "ddc" : "soft")); }); return o.ToArray(); }
  public static bool Set(string key, int p) { bool done = false; Each(delegate(string id, string dev, PM[] a, int i) { if (id != key) return; int c, m; if (Ask(a, i, out c, out m)) done = SetVCPFeature(a[i].h, 0x10, (int)Math.Round(m * p / 100.0)); else { done = Dim(dev, p); if (done) soft[id] = p; } }); return done; }
}
'@
  $hasMonitors = $true
} catch {}
# The built-in screen is Windows' own; the rest are asked one by one.
function Get-Key($n) { $p = "$n" -split '\\'; if ($p.Count -gt 2) { $p[1] + '#' + ($p[2] -replace '_\d+$', '') } else { '' } }
$names = @{}
function Get-Monitors {
  $inner = @{}
  try { Get-CimInstance -Namespace root/WMI -ClassName WmiMonitorBrightness -ErrorAction Stop | % { $inner[(Get-Key $_.InstanceName)] = [int]$_.CurrentBrightness } } catch {}
  $list = @(if ($hasMonitors) { [HubMonitors]::List() })
  if (@($list | ? { -not $names.ContainsKey(($_ -split '\|')[0]) }).Count) { try { Get-CimInstance -Namespace root/WMI -ClassName WmiMonitorID -ErrorAction Stop | % { $names[(Get-Key $_.InstanceName)] = (-join ($_.UserFriendlyName | ? { $_ } | % { [char]$_ })).Trim() } } catch {} }
  $seen = @{}
  $out = @(foreach ($x in $list) {
    $p = $x -split '\|'; if ($seen[$p[0]]) { continue }; $seen[$p[0]] = 1
    $in = $inner.ContainsKey($p[0])
    @{ id = $p[0]; name = $(if ($in) { 'Built-in display' } elseif ($names[$p[0]]) { $names[$p[0]] } else { 'Display' }); level = $(if ($in) { $inner[$p[0]] } else { [int]$p[1] }); kind = $(if ($in) { 'inner' } else { $p[2] }) }
  })
  if (-not $out.Count) { $out = @(foreach ($k in $inner.Keys) { @{ id = $k; name = 'Built-in display'; level = $inner[$k]; kind = 'inner' } }) }
  , $out
}
function Set-Monitor($m, $v) {
  if ($m.kind -eq 'inner') {
    $mm = Get-CimInstance -Namespace root/WMI -ClassName WmiMonitorBrightnessMethods -ErrorAction Stop | ? { (Get-Key $_.InstanceName) -eq $m.id } | Select-Object -First 1
    $null = Invoke-CimMethod -InputObject $mm -MethodName WmiSetBrightness -Arguments @{ Timeout = [uint32]0; Brightness = [byte]$v }
  } elseif (-not [HubMonitors]::Set($m.id, $v)) { return $false }
  $m.level = $v
  $true
}
$hasIcons = $false
try {
  Add-Type -ReferencedAssemblies System.Drawing -TypeDefinition @'
using System; using System.IO; using System.Drawing; using System.Drawing.Imaging; using System.Runtime.InteropServices;
[StructLayout(LayoutKind.Sequential)] public struct HubSize { public int cx, cy; }
[StructLayout(LayoutKind.Sequential)] public struct HubBitmap { public int type, w, h, wb; public short planes, bpp; public IntPtr bits; }
[Guid("bcc18b79-ba16-442f-80c4-8a59c30c463b"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
public interface IShellItemImageFactory { [PreserveSig] int GetImage(HubSize s, int flags, out IntPtr hbm); }
public class HubIcon {
  [DllImport("shell32", CharSet = CharSet.Unicode, PreserveSig = false)] static extern void SHCreateItemFromParsingName(string p, IntPtr b, ref Guid g, [MarshalAs(UnmanagedType.Interface)] out IShellItemImageFactory f);
  [DllImport("gdi32")] static extern int GetObject(IntPtr h, int n, out HubBitmap b);
  [DllImport("gdi32")] static extern bool DeleteObject(IntPtr h);
  public static string Get(string id) {
    Guid g = typeof(IShellItemImageFactory).GUID; IShellItemImageFactory f; SHCreateItemFromParsingName("shell:AppsFolder\\" + id, IntPtr.Zero, ref g, out f);
    HubSize s; s.cx = s.cy = 192; IntPtr h; Marshal.ThrowExceptionForHR(f.GetImage(s, 4, out h));
    try { HubBitmap b; GetObject(h, Marshal.SizeOf(typeof(HubBitmap)), out b);
      using (Bitmap o = new Bitmap(b.w, b.h, PixelFormat.Format32bppArgb)) {
        BitmapData d = o.LockBits(new Rectangle(0, 0, b.w, b.h), ImageLockMode.WriteOnly, PixelFormat.Format32bppPArgb); byte[] row = new byte[b.wb];
        for (int y = 0; y < b.h; y++) { Marshal.Copy((IntPtr)(b.bits.ToInt64() + (long)(b.h - 1 - y) * b.wb), row, 0, b.wb); Marshal.Copy(row, 0, (IntPtr)(d.Scan0.ToInt64() + (long)y * d.Stride), b.w * 4); }
        o.UnlockBits(d); MemoryStream m = new MemoryStream(); o.Save(m, ImageFormat.Png); return Convert.ToBase64String(m.ToArray()); } } finally { DeleteObject(h); }
  }
}
'@
  $hasIcons = $true
} catch {}
$lastApp = ''; $artKey = ''; $artData = ''; $artTries = 0
function Get-Media {
  $s = $mgr.GetCurrentSession()
  # The one that's playing, if another app holds the current place.
  $all = @($mgr.GetSessions())
  $live = $all | ? { "$($_.GetPlaybackInfo().PlaybackStatus)" -eq 'Playing' } | Select-Object -First 1
  # Paused, it stays the one that was playing.
  if ($live) { $s = $live } else { $last = $all | ? { $_.SourceAppUserModelId -eq $script:lastApp } | Select-Object -First 1; if ($last) { $s = $last } }
  if (-not $s) { return @{ on = $false } }
  $script:lastApp = $s.SourceAppUserModelId
  $p = Wait-Op ($s.TryGetMediaPropertiesAsync()) ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties])
  $key = "$($s.SourceAppUserModelId)|$($p.Title)|$($p.Artist)"
  # A player often sends the picture a moment after the title: ask a few times.
  if ($key -ne $script:artKey) { $script:artKey = $key; $script:artData = ''; $script:artTries = 6 }
  if (-not $script:artData -and $script:artTries -gt 0) {
    $script:artTries--
    try {
      if ($p.Thumbnail) {
        $st = Wait-Op ($p.Thumbnail.OpenReadAsync()) ([Windows.Storage.Streams.IRandomAccessStreamWithContentType])
        # Windows hands back a bare COM object here; reflection asks it for the stream it is.
        $net = [System.IO.WindowsRuntimeStreamExtensions].GetMethod('AsStreamForRead', [Type[]]@([Windows.Storage.Streams.IInputStream])).Invoke($null, @($st))
        $ms = New-Object IO.MemoryStream; $net.CopyTo($ms); $net.Dispose()
        if ($ms.Length -gt 0 -and $ms.Length -lt 8000000) {
          # 600 across is plenty, and small enough to send about.
          $ms.Position = 0
          $img = [System.Drawing.Image]::FromStream($ms)
          $k = [Math]::Min(1.0, 600 / [Math]::Max($img.Width, $img.Height))
          $w = [Math]::Max(1, [int]($img.Width * $k)); $h = [Math]::Max(1, [int]($img.Height * $k))
          $bmp = New-Object System.Drawing.Bitmap $w, $h
          $g = [System.Drawing.Graphics]::FromImage($bmp); $g.InterpolationMode = 'HighQualityBicubic'; $g.DrawImage($img, 0, 0, $w, $h); $g.Dispose()
          $o = New-Object IO.MemoryStream; $bmp.Save($o, [System.Drawing.Imaging.ImageFormat]::Jpeg); $bmp.Dispose(); $img.Dispose()
          $script:artData = [Convert]::ToBase64String($o.ToArray())
        }
      }
    } catch {}
  }
  $i = $s.GetPlaybackInfo(); $playing = "$($i.PlaybackStatus)" -eq 'Playing'
  $pos = $null; $dur = $null; $seek = $false; $raw = $null; $upd = $null; $rate = 1
  # A song in a browser: which site, from that browser's window title.
  if ($script:siteKey -ne $key) { $script:siteKey = $key; $script:site = ''; if ($s.SourceAppUserModelId -match 'chrome|msedge|firefox|brave|opera|vivaldi') { try { $tt = (Get-Process | ? { $_.MainWindowTitle } | % { $_.MainWindowTitle }) -join [char]10; foreach ($n in 'YouTube Music', 'SoundCloud', 'Spotify', 'Apple Music', 'Amazon Music', 'TIDAL', 'Deezer', 'Bandcamp', 'YouTube') { if ($tt -match [regex]::Escape($n)) { $script:site = $n; break } } } catch {} } }
  try {
    $t = $s.GetTimelineProperties()
    $dur = ($t.EndTime - $t.StartTime).TotalSeconds
    $pos = ($t.Position - $t.StartTime).TotalSeconds
    $raw = $pos; if ($t.LastUpdatedTime.Year -gt 2000) { $upd = $t.LastUpdatedTime.ToUnixTimeMilliseconds() }; if ($i.PlaybackRate) { $rate = [double]$i.PlaybackRate }
    # The player says where it was, and when: the rest is the clock's.
    if ($playing -and $t.LastUpdatedTime.Year -gt 2000) { $pos += ([DateTimeOffset]::Now - $t.LastUpdatedTime).TotalSeconds * $(if ($i.PlaybackRate) { [double]$i.PlaybackRate } else { 1 }) }
    if ($dur -gt 0) { $pos = [Math]::Max(0, [Math]::Min($dur, $pos)); $seek = [bool]$i.Controls.IsPlaybackPositionEnabled } else { $dur = $null; $pos = $null }
  } catch {}
  @{ on = $true; raw = $raw; upd = $upd; rate = $rate; site = $script:site; pos = $pos; dur = $dur; seek = $seek; album = "$($p.AlbumTitle)"; app = "$($s.SourceAppUserModelId)"; title = "$($p.Title)"; artist = "$($p.Artist)"; playing = $playing; art = $script:artData; session = $s }
}
$mons = @(); $monsAt = [DateTime]::MinValue
while ($null -ne ($line = [Console]::In.ReadLine())) {
  $c = $null
  try {
    $c = $line | ConvertFrom-Json
    $r = @{}
    switch ($c.cmd) {
      'state' {
        $m = Get-Media; $m.Remove('session')
        if (((Get-Date) - $monsAt).TotalSeconds -gt 25) { try { $mons = Get-Monitors } catch {}; $monsAt = Get-Date }
        $v = $null; if ($hasAudio) { try { $v = [HubVolume]::Get() } catch {} }
        $o = @(); if ($hasOutputs) { try { $o = @([HubOutputs]::List() | % { $q = $_ -split "`t"; @{ id = $q[0]; on = ($q[1] -eq '1'); name = $q[2] } }) } catch {} }
        $r = @{ outputs = $o; media = $m; volume = $v; monitors = @($mons) }
      }
      'media' {
        $m = Get-Media
        if ($m.on -and "$($c.arg)" -like 'seek:*') {
          $r = @{ ok = (Wait-Op ($m.session.TryChangePlaybackPositionAsync([long]([double]::Parse("$($c.arg)".Substring(5), [Globalization.CultureInfo]::InvariantCulture) * 10000000))) ([bool])) }
        } elseif ($m.on) {
          $op = switch ($c.arg) { 'toggle' { $m.session.TryTogglePlayPauseAsync() } 'next' { $m.session.TrySkipNextAsync() } 'prev' { $m.session.TrySkipPreviousAsync() } }
          $r = @{ ok = (Wait-Op $op ([bool])) }
        } else { $r = @{ ok = $false } }
      }
      'volume' { [HubVolume]::Set([int]$c.arg); $r = @{ ok = $true } }
      'brightness' {
        if (-not $mons.Count) { $mons = Get-Monitors; $monsAt = Get-Date }
        $n = 0; $bad = @()
        foreach ($m in $mons) { if (@($c.arg.ids) -contains $m.id) { $ok = $false; try { $ok = Set-Monitor $m ([int]$c.arg.value) } catch {}; if ($ok) { $n++ } else { $bad += $m.name } } }
        $r = @{ ok = ($n -gt 0); bad = $bad }
      }
      'output' { $r = @{ ok = [HubOutputs]::Use([string]$c.arg) } }
      'icon' { $r = @{ png = $(if ($hasIcons) { [HubIcon]::Get([string]$c.arg) } else { '' }) } }
      'apps' { $r = @{ apps = @(Get-StartApps | % { @{ name = $_.Name; id = $_.AppID } }) } }
    }
    $r.n = $c.n
    [Console]::Out.WriteLine(($r | ConvertTo-Json -Compress -Depth 5))
  } catch { [Console]::Out.WriteLine((@{ n = $c.n; error = "$($_.Exception.Message)" } | ConvertTo-Json -Compress)) }
  [Console]::Out.Flush()
}
