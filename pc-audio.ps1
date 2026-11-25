# This PC's sound as it plays (Windows' own loopback), to standard output: 48 kHz, 16-bit, stereo, little-endian, for tv-audio.mjs.
# Lines on standard input: "mute 1" silences this PC's own speakers while it goes on, "mute 0" gives them back. The end of
# input ends it, and the speakers are put back as they were whatever happens.
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System; using System.IO; using System.Threading; using System.Runtime.InteropServices;
[StructLayout(LayoutKind.Sequential, Pack = 1)] public struct HubWave { public ushort tag, ch; public uint rate, bps; public ushort align, bits, ext; }
[Guid("1CB9AD4C-DBFA-4c32-B178-C2F568A703B2"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IHubClient { [PreserveSig] int Initialize(int mode, uint flags, long dur, long per, IntPtr f, IntPtr g); int a(); int b(); int c(); int d(); int e(); int f(); int Start(); int Stop(); int Reset(); int SetEventHandle(IntPtr h); int GetService(ref Guid id, [MarshalAs(UnmanagedType.IUnknown)] out object o); }
[Guid("C8ADBD64-E71E-48a0-A4DE-185C395CD317"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IHubCapture { [PreserveSig] int GetBuffer(out IntPtr d, out uint n, out uint flags, out ulong p, out ulong q); [PreserveSig] int ReleaseBuffer(uint n); [PreserveSig] int GetNextPacketSize(out uint n); }
[Guid("5CDF2C82-841E-4546-9722-0CF74078229A"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IHubVolume { int a(); int b(); int c(); int d(); int e(); int f(); int g(); int h(); int i(); int j(); int k(); int SetMute([MarshalAs(UnmanagedType.Bool)] bool m, Guid g); int GetMute([MarshalAs(UnmanagedType.Bool)] out bool m); }
[Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IHubDevice { int Activate(ref Guid id, int ctx, IntPtr p, [MarshalAs(UnmanagedType.IUnknown)] out object o); int b(); int GetId([MarshalAs(UnmanagedType.LPWStr)] out string id); }
[Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IHubDevices { int f(); int GetDefaultAudioEndpoint(int flow, int role, out IHubDevice d); }
[ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")] class HubDevices { }
public class HubLoop {
  static volatile bool ended, mute;
  static IHubDevice Default() { IHubDevice d; ((IHubDevices)new HubDevices()).GetDefaultAudioEndpoint(0, 0, out d); return d; }
  public static void Run() {
    Thread t = new Thread(delegate() { string l; while ((l = Console.In.ReadLine()) != null) mute = l.Trim() == "mute 1"; ended = true; }); t.IsBackground = true; t.Start();
    Stream o = Console.OpenStandardOutput();
    HubWave w = new HubWave(); w.tag = 1; w.ch = 2; w.rate = 48000; w.bits = 16; w.align = 4; w.bps = 192000;
    IntPtr f = Marshal.AllocHGlobal(Marshal.SizeOf(typeof(HubWave))); Marshal.StructureToPtr(w, f, false);
    // Headphones plugged in, or another output chosen: starts again on that one.
    while (!ended) {
      IHubDevice d = Default(); string id; d.GetId(out id);
      Guid g = typeof(IHubClient).GUID; object x; d.Activate(ref g, 23, IntPtr.Zero, out x); IHubClient c = (IHubClient)x;
      g = typeof(IHubVolume).GUID; d.Activate(ref g, 23, IntPtr.Zero, out x); IHubVolume v = (IHubVolume)x;
      bool was, quiet = false; v.GetMute(out was);
      try {
        int hr = c.Initialize(0, 0x88020000u, 1000000, 0, f, IntPtr.Zero); if (hr != 0) throw new Exception("audio " + hr.ToString("x"));
        g = typeof(IHubCapture).GUID; c.GetService(ref g, out x); IHubCapture cc = (IHubCapture)x; c.Start();
        DateTime look = DateTime.Now; byte[] buf = new byte[0];
        while (!ended) {
          if (mute != quiet) { quiet = mute; v.SetMute(quiet || was, Guid.Empty); }
          uint s; if (cc.GetNextPacketSize(out s) != 0) break;
          if (s == 0) { Thread.Sleep(4); if ((DateTime.Now - look).TotalSeconds > 2) { look = DateTime.Now; string now; Default().GetId(out now); if (now != id) break; } continue; }
          IntPtr p; uint n, fl; ulong a, b; if (cc.GetBuffer(out p, out n, out fl, out a, out b) != 0) break;
          int len = (int)n * 4; if (buf.Length < len) buf = new byte[len];
          if ((fl & 2) != 0) Array.Clear(buf, 0, len); else Marshal.Copy(p, buf, 0, len);
          cc.ReleaseBuffer(n);
          try { o.Write(buf, 0, len); o.Flush(); } catch { ended = true; }
        }
        c.Stop();
      } finally { if (quiet) v.SetMute(was, Guid.Empty); }
      if (!ended) Thread.Sleep(300);
    }
  }
}
'@
try { [HubLoop]::Run() } catch { [Console]::Error.WriteLine("$($_.Exception.Message)"); exit 1 }
