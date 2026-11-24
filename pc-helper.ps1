# What this PC is playing, its volume and screen brightness, and its installed apps, for music.mjs and desk.mjs.
# Reads one JSON command per line and answers each with one JSON line. Uses only what Windows offers every app.
$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = [Console]::OutputEncoding = New-Object System.Text.UTF8Encoding $false
Add-Type -AssemblyName System.Runtime.WindowsRuntime
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
$artKey = ''; $artData = ''
function Get-Media {
  $s = $mgr.GetCurrentSession()
  # The one that's playing, if another app holds the current place.
  foreach ($x in $mgr.GetSessions()) { if ("$($x.GetPlaybackInfo().PlaybackStatus)" -eq 'Playing') { $s = $x; break } }
  if (-not $s) { return @{ on = $false } }
  $p = Wait-Op ($s.TryGetMediaPropertiesAsync()) ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties])
  $key = "$($s.SourceAppUserModelId)|$($p.Title)|$($p.Artist)"
  if ($key -ne $script:artKey) {
    $script:artKey = $key; $script:artData = ''
    try {
      if ($p.Thumbnail) {
        $st = Wait-Op ($p.Thumbnail.OpenReadAsync()) ([Windows.Storage.Streams.IRandomAccessStreamWithContentType])
        if ($st.Size -gt 0 -and $st.Size -lt 1500000) {
          $net = [System.IO.WindowsRuntimeStreamExtensions]::AsStreamForRead($st)
          $ms = New-Object IO.MemoryStream; $net.CopyTo($ms)
          $script:artData = "data:$(if ($st.ContentType) { $st.ContentType } else { 'image/jpeg' });base64," + [Convert]::ToBase64String($ms.ToArray())
        }
      }
    } catch {}
  }
  @{ on = $true; app = "$($s.SourceAppUserModelId)"; title = "$($p.Title)"; artist = "$($p.Artist)"; playing = ("$($s.GetPlaybackInfo().PlaybackStatus)" -eq 'Playing'); art = $script:artData; session = $s }
}
function Get-Brightness { try { [int](Get-CimInstance -Namespace root/WMI -ClassName WmiMonitorBrightness -ErrorAction Stop | Select-Object -First 1).CurrentBrightness } catch { $null } }
$bright = Get-Brightness; $brightAt = Get-Date
while ($null -ne ($line = [Console]::In.ReadLine())) {
  $c = $null
  try {
    $c = $line | ConvertFrom-Json
    $r = @{}
    switch ($c.cmd) {
      'state' {
        $m = Get-Media; $m.Remove('session')
        if (((Get-Date) - $brightAt).TotalSeconds -gt 20) { $bright = Get-Brightness; $brightAt = Get-Date }
        $v = $null; if ($hasAudio) { try { $v = [HubVolume]::Get() } catch {} }
        $r = @{ media = $m; volume = $v; brightness = $bright }
      }
      'media' {
        $m = Get-Media
        if ($m.on) {
          $op = switch ($c.arg) { 'toggle' { $m.session.TryTogglePlayPauseAsync() } 'next' { $m.session.TrySkipNextAsync() } 'prev' { $m.session.TrySkipPreviousAsync() } }
          $r = @{ ok = (Wait-Op $op ([bool])) }
        } else { $r = @{ ok = $false } }
      }
      'volume' { [HubVolume]::Set([int]$c.arg); $r = @{ ok = $true } }
      'brightness' { $mm = Get-CimInstance -Namespace root/WMI -ClassName WmiMonitorBrightnessMethods -ErrorAction Stop | Select-Object -First 1; $null = Invoke-CimMethod -InputObject $mm -MethodName WmiSetBrightness -Arguments @{ Timeout = [uint32]0; Brightness = [byte][int]$c.arg }; $bright = [int]$c.arg; $r = @{ ok = $true } }
      'icon' { $r = @{ png = $(if ($hasIcons) { [HubIcon]::Get([string]$c.arg) } else { '' }) } }
      'apps' { $r = @{ apps = @(Get-StartApps | % { @{ name = $_.Name; id = $_.AppID } }) } }
    }
    $r.n = $c.n
    [Console]::Out.WriteLine(($r | ConvertTo-Json -Compress -Depth 5))
  } catch { [Console]::Out.WriteLine((@{ n = $c.n; error = "$($_.Exception.Message)" } | ConvertTo-Json -Compress)) }
  [Console]::Out.Flush()
}
