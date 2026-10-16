#!/usr/bin/env node
/** Disposable Windows Edge CDP for a WSL Playwright harness.
 * Run under the project's .tmp/dk-heavy.lock. No app/profile/system settings
 * change. The CLI prints one readiness JSON line; pass its endpoint to
 * chromium.connectOverCDP(). SIGINT/SIGTERM cleans only this launch's processes
 * and TEMP profile. The Windows loopback connection crosses WSL via binary
 * stdin/stdout pipes, without a Windows Node install or firewall rule.
 */
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import net from 'node:net';
import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';

const execute = promisify(execFile);
const POWERSHELL = 'powershell.exe';
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const psLiteral = value => `'${String(value).replaceAll("'", "''")}'`;
const encodedCommand = script => Buffer.from(script, 'utf16le').toString('base64');
const psArgs = script => ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encodedCommand(script)];
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

async function powershell(script, timeout = 45000) {
  const { stdout } = await execute(POWERSHELL, psArgs(`$ErrorActionPreference='Stop'; $ProgressPreference='SilentlyContinue'; ${script}`), {
    timeout, maxBuffer: 1024 * 1024, windowsHide: true,
  });
  return JSON.parse(stdout.replace(/^\uFEFF/, '').trim());
}

// A Windows child can keep inherited interop handles open after PowerShell has
// printed its result. Resolve launch readiness from the JSON line, rather than
// waiting for every Edge descendant to close those handles.
function launchPowershell(script, children) {
  return new Promise((resolve, reject) => {
    const child = spawn(POWERSHELL, psArgs(`$ErrorActionPreference='Stop'; $ProgressPreference='SilentlyContinue'; ${script}`), { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    children.add(child);
    let output = '', errorOutput = '', settled = false;
    const timer = setTimeout(() => { if (!settled) { settled = true; reject(new Error(`Windows Edge startup timed out: ${errorOutput}`)); } }, 45000);
    child.stdout.on('data', chunk => {
      output += chunk.toString();
      const line = output.trim();
      if (!settled && line.startsWith('{') && line.endsWith('}')) {
        try { const result = JSON.parse(line); settled = true; clearTimeout(timer); resolve(result); } catch {}
      }
    });
    child.stderr.on('data', chunk => { errorOutput = (errorOutput + chunk.toString()).slice(-4096); });
    child.on('error', error => { if (!settled) { settled = true; clearTimeout(timer); reject(error); } });
    child.on('close', code => {
      children.delete(child);
      if (!settled) { settled = true; clearTimeout(timer); reject(new Error(`Windows Edge launcher exited ${code}: ${errorOutput}`)); }
    });
  });
}

function checkedPort(value, label, allowZero = false) {
  if (!Number.isInteger(value) || value < (allowZero ? 0 : 1) || value > 65535) throw new Error(`Invalid ${label}`);
  return value;
}

/** Each accepted TCP stream gets a Windows-loopback byte relay. No text APIs
 * touch CDP traffic, including fragmented/binary WebSocket frames. */
function relayScript(port) {
  return `$ErrorActionPreference='Stop';
    $client=New-Object System.Net.Sockets.TcpClient;
    try {
      $client.NoDelay=$true;
      $client.Connect('127.0.0.1',${port});
      $network=$client.GetStream();
      $incoming=$network.CopyToAsync([Console]::OpenStandardOutput());
      $outgoing=([Console]::OpenStandardInput()).CopyToAsync($network);
      [void][Threading.Tasks.Task]::WaitAny([Threading.Tasks.Task[]]@($incoming,$outgoing));
    } finally { $client.Close() }`;
}

function cleanupScript(profile) {
  // The randomly named profile is both the ownership marker and deletion scope.
  return `$profile=${psLiteral(profile)};
    $all=@(Get-CimInstance Win32_Process -Filter "Name='msedge.exe'");
    $roots=@($all | Where-Object { $_.ExecutablePath -eq ${psLiteral(EDGE)} -and $_.CommandLine -and $_.CommandLine.Contains($profile) });
    $owned=New-Object 'System.Collections.Generic.HashSet[uint32]';
    foreach($root in $roots) { [void]$owned.Add([uint32]$root.ProcessId) };
    do {
      $added=$false;
      foreach($process in $all) {
        if($owned.Contains([uint32]$process.ParentProcessId) -and $owned.Add([uint32]$process.ProcessId)) { $added=$true }
      }
    } while($added);
    foreach($process in $all) {
      if($owned.Contains([uint32]$process.ProcessId)) {
        # Recheck creation time to avoid killing a reused PID.
        $current=Get-CimInstance Win32_Process -Filter ('ProcessId='+$process.ProcessId) -ErrorAction SilentlyContinue;
        if($current -and $current.CreationDate -eq $process.CreationDate) {
          Stop-Process -Id $process.ProcessId -Force -ErrorAction SilentlyContinue
        }
      }
    };
    for($attempt=0;$attempt -lt 30 -and (Test-Path -LiteralPath $profile);$attempt++) {
      Remove-Item -LiteralPath $profile -Recurse -Force -ErrorAction SilentlyContinue;
      if(Test-Path -LiteralPath $profile) { Start-Sleep -Milliseconds 100 }
    };
    @{profile=$profile;profileRemoved=!(Test-Path -LiteralPath $profile);ownedProcessIds=@($owned)} | ConvertTo-Json -Compress`;
}

export async function launchWindowsEdgeCdp({ windowsPort = 9223, bridgePort = 9224 } = {}) {
  checkedPort(windowsPort, 'Windows port');
  checkedPort(bridgePort, 'bridge port', true);
  const marker = `platform-fighter-edge-cdp-${randomUUID()}`;
  const profile = await powershell(`Join-Path $env:TEMP ${psLiteral(marker)} | ConvertTo-Json -Compress`);
  const relays = new Set();
  const launchers = new Set();
  const sockets = new Set();
  let stopped = false;
  let cleanupPromise;
  let browserStarted = false;
  let relayError = null;
  const server = net.createServer(socket => {
    sockets.add(socket);
    socket.setNoDelay(true);
    const child = spawn(POWERSHELL, psArgs(relayScript(windowsPort)), { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    relays.add(child);
    let errorText = '';
    child.stderr.on('data', chunk => { errorText = (errorText + chunk.toString()).slice(-4096); });
    child.on('error', error => { relayError = error.message; socket.destroy(error); });
    child.on('close', code => {
      relays.delete(child);
      if (code && !stopped) relayError = errorText || `Relay exited ${code}`;
      socket.end();
    });
    socket.on('error', () => {});
    child.stdin.on('error', () => {});
    child.stdout.on('error', () => {});
    socket.on('close', () => { sockets.delete(socket); child.kill(); });
    socket.pipe(child.stdin);
    child.stdout.pipe(socket);
  });
  const close = () => cleanupPromise ??= (async () => {
    stopped = true;
    for (const socket of sockets) socket.destroy();
    for (const child of relays) child.kill();
    if (server.listening) await new Promise(resolve => server.close(resolve));
    try {
      return browserStarted ? await powershell(cleanupScript(profile)) : { profile, profileRemoved: true, ownedProcessIds: [] };
    } finally { for (const child of launchers) child.kill(); }
  })();

  try {
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(bridgePort, '127.0.0.1', resolve);
    });
    // Reject an occupied Windows port before launching; never attach to a
    // pre-existing debug browser. Its version response supplies the browser UUID.
    browserStarted = true; // Ensures cleanup also runs if startup partially fails.
    const launch = await launchPowershell(`
      $exe=${psLiteral(EDGE)}; $profile=${psLiteral(profile)};
      if(!(Test-Path -LiteralPath $exe)) { throw 'Windows Edge executable missing' };
      $listener=New-Object System.Net.Sockets.TcpListener([Net.IPAddress]::Loopback,${windowsPort});
      $listener.Server.ExclusiveAddressUse=$true;
      try { $listener.Start() } finally { $listener.Stop() };
      New-Item -ItemType Directory -Path $profile -ErrorAction Stop | Out-Null;
      $browserArgs=@('--headless=new','--no-first-run','--no-default-browser-check',
        '--remote-debugging-address=127.0.0.1','--remote-debugging-port=${windowsPort}',
        ('--user-data-dir="'+$profile+'"'),'--window-size=1280,720','about:blank');
      $process=Start-Process -FilePath $exe -ArgumentList $browserArgs -PassThru -WindowStyle Hidden -RedirectStandardOutput (Join-Path $profile 'edge-stdout.log') -RedirectStandardError (Join-Path $profile 'edge-stderr.log');
      $versionUrl='http://127.0.0.1:${windowsPort}/json/version';
      $version=$null;
      for($attempt=0;$attempt -lt 100;$attempt++) {
        try { $version=Invoke-RestMethod -Uri $versionUrl -TimeoutSec 1; break } catch { Start-Sleep -Milliseconds 100 }
      };
      if(!$version) { throw 'Edge CDP did not become ready' };
      # Confirm the listening endpoint belongs to this unique profile.
      $owners=@(Get-CimInstance Win32_Process -Filter "Name='msedge.exe'" |
        Where-Object { $_.ExecutablePath -eq $exe -and $_.CommandLine -and $_.CommandLine.Contains($profile) });
      if($owners.Count -eq 0) { throw 'No Edge process owns the disposable profile' };
      @{executable=$exe;installedVersion=(Get-Item -LiteralPath $exe).VersionInfo.ProductVersion;
        profile=$profile;pid=$process.Id;ownedRootIds=@($owners | ForEach-Object {$_.ProcessId});
        arguments=$browserArgs;windowsPort=${windowsPort};version=$version} | ConvertTo-Json -Depth 8 -Compress
    `, launchers);
    const actualPort = server.address().port;
    const websocket = new URL(launch.version.webSocketDebuggerUrl);
    if (!['127.0.0.1', 'localhost'].includes(websocket.hostname) || Number(websocket.port) !== windowsPort) throw new Error('Unexpected Windows CDP endpoint');
    websocket.hostname = '127.0.0.1';
    websocket.port = String(actualPort);
    // Exercise the byte relay, not merely Windows-local CDP availability.
    let version;
    let lastError;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const response = await fetch(`http://127.0.0.1:${actualPort}/json/version`, { signal: AbortSignal.timeout(12000) });
        if (!response.ok) throw new Error(`CDP version HTTP ${response.status}`);
        version = await response.json();
        break;
      } catch (error) { lastError = error; if (attempt < 2) await pause(200); }
    }
    if (!version) throw new Error(`Binary relay failed: ${relayError ?? lastError?.message}`);
    // Chromium echoes the HTTP Host header into its WebSocket URL, so the
    // forwarded port may differ. The browser UUID/path must remain identical.
    if (new URL(version.webSocketDebuggerUrl).pathname !== new URL(launch.version.webSocketDebuggerUrl).pathname || version.Browser !== launch.version.Browser) throw new Error('CDP browser identity changed across relay');
    return { endpoint: websocket.href, launch, bridge: { address: '127.0.0.1', port: actualPort, transport: 'per-connection Windows PowerShell TcpClient binary stdio' }, close };
  } catch (error) {
    try { await close(); } catch (cleanupError) { error.message += `; cleanup failed: ${cleanupError.message}`; }
    throw error;
  }
}

async function main() {
  if (process.argv.includes('--help')) {
    console.log('Usage: node tools/windows-edge-cdp.mjs [--windows-port=9223] [--bridge-port=9224]\nRun under .tmp/dk-heavy.lock. Read endpoint from readiness JSON. SIGINT/SIGTERM removes this disposable launch.');
    return;
  }
  const allowed = /^--(windows-port|bridge-port)=\d+$/;
  for (const argument of process.argv.slice(2)) if (!allowed.test(argument)) throw new Error(`Unknown argument: ${argument}`);
  const port = (name, fallback) => Number(process.argv.find(arg => arg.startsWith(`--${name}=`))?.split('=')[1] ?? fallback);
  let session;
  let interrupted = false;
  let finishing = false;
  const finish = async () => {
    interrupted = true;
    if (!session || finishing) return;
    finishing = true;
    try { console.log(JSON.stringify({ event: 'closed', cleanup: await session.close() })); }
    catch (error) { console.error(error); process.exitCode = 1; }
  };
  process.on('SIGINT', finish);
  process.on('SIGTERM', finish);
  session = await launchWindowsEdgeCdp({ windowsPort: port('windows-port', 9223), bridgePort: port('bridge-port', 9224) });
  if (interrupted) { await finish(); return; }
  const { close, ...record } = session;
  console.log(JSON.stringify({ event: 'ready', ...record }));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => { console.error(error); process.exitCode = 1; });
}
