# Runs a command in a Windows job, and records what everything in that job connects to, to answer one
# question: did this test run touch the Hub on this port? See net-audit-report.mjs for the answer.
#
# A job holds a process and all it starts, and it reports each new one, so the list of processes is complete
# however short-lived they are. Three records come out of it:
#   node.log       each outgoing connection from each Node process, from connect-log.cjs
#   net-*.json     each connection from Electron's own network process, from Chromium's net log
#   tcp.log        what the system's connection table shows for the port, every 10 ms, with the owner
#
# Example: powershell -File net-audit.ps1 -WatchPort 3100 -OutDir C:\temp\audit -Command 'node --test tests/e2e/x.test.mjs'
param(
  [Parameter(Mandatory)][int]$WatchPort,
  [Parameter(Mandatory)][string]$OutDir,
  [Parameter(Mandatory)][string]$Command
)
$ErrorActionPreference = 'Stop'

Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;

public static class NetAudit {
  [DllImport("kernel32.dll", CharSet = CharSet.Unicode)] static extern IntPtr CreateJobObject(IntPtr attributes, string name);
  [DllImport("kernel32.dll")] static extern bool AssignProcessToJobObject(IntPtr job, IntPtr process);
  [DllImport("kernel32.dll")] static extern bool SetInformationJobObject(IntPtr job, int infoClass, ref JobPort info, int size);
  [DllImport("kernel32.dll")] static extern IntPtr CreateIoCompletionPort(IntPtr file, IntPtr existing, IntPtr key, uint threads);
  [DllImport("kernel32.dll")] static extern bool GetQueuedCompletionStatus(IntPtr port, out uint message, out IntPtr key, out IntPtr value, uint timeoutMs);
  [DllImport("kernel32.dll")] static extern IntPtr GetCurrentProcess();
  [DllImport("kernel32.dll")] static extern IntPtr OpenProcess(uint access, bool inherit, uint pid);
  [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr handle);
  [DllImport("kernel32.dll")] static extern bool IsProcessInJob(IntPtr process, IntPtr job, out bool result);
  [DllImport("kernel32.dll", CharSet = CharSet.Unicode)] static extern bool QueryFullProcessImageName(IntPtr process, uint flags, StringBuilder name, ref uint size);
  [DllImport("ntdll.dll")] static extern int NtQueryInformationProcess(IntPtr process, int infoClass, IntPtr info, int size, out int written);
  [DllImport("iphlpapi.dll")] static extern uint GetExtendedTcpTable(IntPtr table, ref int size, bool sort, int family, int tableClass, uint reserved);

  [StructLayout(LayoutKind.Sequential)] struct JobPort { public IntPtr Key; public IntPtr Port; }

  const uint QUERY_LIMITED = 0x1000;
  const uint NEW_PROCESS = 6;
  const int ASSOCIATE_COMPLETION_PORT = 7;
  const int TIME_WAIT = 11;
  const int COMMAND_LINE = 60;

  static IntPtr job, port;
  static StreamWriter processes, tcp;
  static volatile bool running = true;
  static readonly HashSet<string> seenRows = new HashSet<string>();

  static string Stamp() { return DateTime.Now.ToString("HH:mm:ss.fff"); }

  static string Image(uint pid) {
    IntPtr handle = OpenProcess(QUERY_LIMITED, false, pid);
    if (handle == IntPtr.Zero) return "(gone)";
    try {
      StringBuilder name = new StringBuilder(1024);
      uint size = 1024;
      return QueryFullProcessImageName(handle, 0, name, ref size) ? name.ToString() : "(unknown)";
    } finally { CloseHandle(handle); }
  }

  static string InJob(uint pid) {
    IntPtr handle = OpenProcess(QUERY_LIMITED, false, pid);
    if (handle == IntPtr.Zero) return "unknown";
    try {
      bool inside;
      return IsProcessInJob(handle, job, out inside) ? (inside ? "in-job" : "outside") : "unknown";
    } finally { CloseHandle(handle); }
  }

  static string CommandLine(uint pid) {
    IntPtr handle = OpenProcess(QUERY_LIMITED, false, pid);
    if (handle == IntPtr.Zero) return "(gone)";
    int size = 65536;
    IntPtr buffer = Marshal.AllocHGlobal(size);
    try {
      int written;
      if (NtQueryInformationProcess(handle, COMMAND_LINE, buffer, size, out written) != 0) return "(unknown)";
      string line = Marshal.PtrToStringUni(Marshal.ReadIntPtr(buffer, IntPtr.Size), Marshal.ReadInt16(buffer) / 2);
      return line.Replace('\t', ' ').Replace('\n', ' ').Replace('\r', ' ');
    } finally {
      Marshal.FreeHGlobal(buffer);
      CloseHandle(handle);
    }
  }

  // Every process in the job, as it joins. These have to be read at once, as some last only moments.
  static void WatchJob() {
    while (running) {
      uint message; IntPtr key, value;
      if (!GetQueuedCompletionStatus(port, out message, out key, out value, 500) || message != NEW_PROCESS) continue;
      uint pid = (uint)value.ToInt64();
      processes.WriteLine(Stamp() + "\tnew\t" + pid + "\t" + Image(pid));
      processes.WriteLine(Stamp() + "\tcmd\t" + pid + "\t" + CommandLine(pid));
    }
  }

  static int NetPort(byte[] row, int at) { return (row[at] << 8) | row[at + 1]; }

  static void Note(int watchPort, uint pid, int localPort, int remotePort, int state) {
    if (remotePort != watchPort || state == TIME_WAIT) return;
    if (!seenRows.Add(pid + ":" + localPort)) return;
    tcp.WriteLine(Stamp() + "\t" + pid + "\t" + localPort + "\t" + state + "\t" + InJob(pid) + "\t" + Image(pid));
  }

  static void ReadTable(int family, int rowSize, int watchPort) {
    int size = 0;
    GetExtendedTcpTable(IntPtr.Zero, ref size, false, family, 5, 0);
    size += 4096;
    IntPtr buffer = Marshal.AllocHGlobal(size);
    try {
      if (GetExtendedTcpTable(buffer, ref size, false, family, 5, 0) != 0) return;
      int count = Marshal.ReadInt32(buffer);
      byte[] row = new byte[rowSize];
      for (int i = 0; i < count; i++) {
        Marshal.Copy(IntPtr.Add(buffer, 4 + i * rowSize), row, 0, rowSize);
        if (family == 2) Note(watchPort, BitConverter.ToUInt32(row, 20), NetPort(row, 8), NetPort(row, 16), BitConverter.ToInt32(row, 0));
        else Note(watchPort, BitConverter.ToUInt32(row, 52), NetPort(row, 20), NetPort(row, 44), BitConverter.ToInt32(row, 48));
      }
    } finally { Marshal.FreeHGlobal(buffer); }
  }

  static void WatchTable(object watchPort) {
    while (running) {
      ReadTable(2, 24, (int)watchPort);
      ReadTable(23, 56, (int)watchPort);
      Thread.Sleep(10);
    }
  }

  // The audit joins the job first, so nothing the command starts can be outside it.
  public static int Run(string command, int watchPort, string outDir) {
    processes = new StreamWriter(Path.Combine(outDir, "processes.log")) { AutoFlush = true };
    tcp = new StreamWriter(Path.Combine(outDir, "tcp.log")) { AutoFlush = true };
    job = CreateJobObject(IntPtr.Zero, null);
    port = CreateIoCompletionPort(new IntPtr(-1), IntPtr.Zero, IntPtr.Zero, 1);
    JobPort info = new JobPort { Key = job, Port = port };
    if (!SetInformationJobObject(job, ASSOCIATE_COMPLETION_PORT, ref info, Marshal.SizeOf(info))) throw new Exception("could not watch the job");
    if (!AssignProcessToJobObject(job, GetCurrentProcess())) throw new Exception("could not join the job");
    Thread[] threads = { new Thread(WatchJob), new Thread(WatchTable) };
    foreach (Thread thread in threads) thread.IsBackground = true;
    threads[0].Start();
    threads[1].Start(watchPort);
    ProcessStartInfo start = new ProcessStartInfo("cmd.exe", "/d /s /c \"" + command + "\"") { UseShellExecute = false };
    using (Process child = Process.Start(start)) {
      child.WaitForExit();
      int code = child.ExitCode;
      Thread.Sleep(1500);
      running = false;
      foreach (Thread thread in threads) thread.Join(5000);
      processes.Close();
      tcp.Close();
      return code;
    }
  }
}
'@

New-Item -ItemType Directory -Force $OutDir | Out-Null
# A backslash in NODE_OPTIONS is an escape.
$hook = (Join-Path $PSScriptRoot 'connect-log.cjs') -replace '\\', '/'
$env:LH_NET_AUDIT_NODE_LOG = Join-Path $OutDir 'node.log'
$env:LH_NET_LOG_DIR = $OutDir
$env:NODE_OPTIONS = (("$env:NODE_OPTIONS --require `"$hook`"").Trim())
Set-Content -Path (Join-Path $OutDir 'watch-port.txt') -Value $WatchPort -Encoding ascii
$code = [NetAudit]::Run($Command, $WatchPort, (Resolve-Path $OutDir).Path)
Set-Content -Path (Join-Path $OutDir 'exit-code.txt') -Value $code -Encoding ascii
exit $code
