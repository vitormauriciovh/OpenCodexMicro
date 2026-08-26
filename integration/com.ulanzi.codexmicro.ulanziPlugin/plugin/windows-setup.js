import { execFile } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const TASK_NAME = "OpenCodexMicro Virtual Device";

const PROBE_SCRIPT = `
$ErrorActionPreference = 'Stop'
$roots = @(Get-PnpDevice -PresentOnly -ErrorAction SilentlyContinue | Where-Object InstanceId -Like 'ROOT\\OPENCODEXMICROUDE*')
$usbDevices = @(Get-PnpDevice -PresentOnly -ErrorAction SilentlyContinue | Where-Object InstanceId -Like 'USB\\VID_303A&PID_8360*')
$hidDevices = @(Get-PnpDevice -Class HIDClass -PresentOnly -ErrorAction SilentlyContinue | Where-Object InstanceId -Like 'HID\\VID_303A&PID_8360*')
$task = Get-ScheduledTask -TaskName 'OpenCodexMicro Virtual Device' -ErrorAction SilentlyContinue
$process = Get-Process -Name OpenCodexMicroVirtualDevice -ErrorAction SilentlyContinue | Select-Object -First 1
$secureBoot = $false
try { $secureBoot = [bool](Confirm-SecureBootUEFI) } catch {}
$boot = bcdedit.exe /enum '{current}' | Out-String
$configured = $boot -match '(?im)^testsigning\\s+(Yes|On|1)\\s*$'
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class OpenCodexMicroCodeIntegrityProbe {
  [StructLayout(LayoutKind.Sequential)] private struct Info { public uint Length; public uint Options; }
  [DllImport("ntdll.dll")] private static extern int NtQuerySystemInformation(int c, ref Info i, uint l, IntPtr r);
  public static bool Active() { Info i = new Info(); i.Length = (uint)Marshal.SizeOf(typeof(Info)); return NtQuerySystemInformation(103, ref i, i.Length, IntPtr.Zero) == 0 && (i.Options & 2) != 0; }
}
'@
[pscustomobject]@{
  build = [Environment]::OSVersion.Version.Build
  architecture = $env:PROCESSOR_ARCHITECTURE
  secureBoot = $secureBoot
  testSigningConfigured = $configured
  testSigningActive = [OpenCodexMicroCodeIntegrityProbe]::Active()
  rootReady = @($roots | Where-Object Status -EQ 'OK').Count -gt 0
  rootDeviceCount = $roots.Count
  rootErrorCount = @($roots | Where-Object Status -NE 'OK').Count
  usbReady = @($usbDevices | Where-Object Status -EQ 'OK').Count -gt 0
  hidReady = @($hidDevices | Where-Object Status -EQ 'OK').Count -gt 0
  taskInstalled = $null -ne $task
  runtimeRunning = $null -ne $process
} | ConvertTo-Json -Compress
`;

function encoded(script) {
  return Buffer.from(script, "utf16le").toString("base64");
}

async function runPowerShell(script, execute = execFileAsync) {
  const { stdout } = await execute("powershell.exe", [
    "-NoProfile", "-NonInteractive", "-EncodedCommand", encoded(script)
  ], { windowsHide: true, maxBuffer: 1024 * 1024 });
  return stdout.trim();
}

async function bridgeOnline(bridgeUrl) {
  try {
    const response = await fetch(`${bridgeUrl}/state`, { signal: AbortSignal.timeout(1200) });
    const payload = await response.json();
    return response.ok && payload.connected === true;
  } catch {
    return false;
  }
}

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8").replace(/^\uFEFF/, ""));
  } catch {
    return null;
  }
}

function actions() {
  return Object.fromEntries([
    "task1", "task2", "task3", "task4", "task5", "fast", "usage", "pin", "new",
    "navigate", "fork", "steer", "mic", "submit"
  ].map(action => [action, {
    available: true,
    experimental: ["pin", "new", "steer"].includes(action)
  }]));
}

function compareVersions(left, right) {
  const leftParts = String(left || "0").split(".").map(Number);
  const rightParts = String(right || "0").split(".").map(Number);
  const length = Math.max(leftParts.length, rightParts.length);
  for (let index = 0; index < length; index += 1) {
    const difference = (leftParts[index] || 0) - (rightParts[index] || 0);
    if (difference !== 0) return Math.sign(difference);
  }
  return 0;
}

export function createWindowsSetup({
  pluginRoot,
  bridgeUrl,
  version,
  home = homedir(),
  execute = execFileAsync
}) {
  const windowsRoot = resolve(pluginRoot, "installer/windows");
  const payloadRoot = join(windowsRoot, "payload");
  const payloadManifestPath = join(payloadRoot, "payload.json");
  const installRoot = join(home, "AppData/Local/OpenCodexMicro");
  const metadataPath = join(installRoot, "install.json");
  const operationStatusPath = join(installRoot, "setup-status.json");
  const launcherPath = join(windowsRoot, "Launch-Elevated.ps1");

  async function status() {
    const payload = readJson(payloadManifestPath);
    const metadata = readJson(metadataPath);
    const operation = readJson(operationStatusPath);
    let probe = null;
    let probeError = null;
    try {
      probe = JSON.parse(await runPowerShell(PROBE_SCRIPT, execute));
    } catch (error) {
      probeError = error.message;
    }
    const minimumBuild = Number(payload?.minimumWindowsBuild || 19045);
    const supported = probe?.architecture === "AMD64" && payload?.architecture === "x64" && Number(probe?.build) >= minimumBuild;
    const transportOnline = await bridgeOnline(bridgeUrl);
    const payloadReady = Boolean(payload && existsSync(join(payloadRoot, "OpenCodexMicroUde.inf")));
    const installed = Boolean(probe?.rootReady && probe?.taskInstalled && metadata);
    const partialInstallation = Boolean(
      metadata || probe?.rootReady || probe?.taskInstalled || probe?.runtimeRunning ||
      ["secure-boot-blocked", "needs-restart", "error"].includes(operation?.phase)
    );
    const versionComparison = installed ? compareVersions(metadata?.version, payload?.version) : 0;
    const needsUpdate = Boolean(installed && versionComparison < 0);
    const downgradeBlocked = Boolean(installed && versionComparison > 0);
    const requiresRestart = Boolean(
      !probe?.testSigningActive && (probe?.testSigningConfigured || operation?.phase === "needs-restart")
    );
    const secureBootBlocked = Boolean(
      !probe?.testSigningActive && (probe?.secureBoot || operation?.phase === "secure-boot-blocked") && !installed
    );
    const ready = Boolean(supported && installed && !needsUpdate && !downgradeBlocked && probe?.hidReady && probe?.runtimeRunning && transportOnline);
    const phase = !supported ? "unsupported"
      : !payloadReady ? "payload-missing"
        : secureBootBlocked ? "secure-boot-blocked"
          : requiresRestart ? "needs-restart"
            : needsUpdate ? "update-available"
              : downgradeBlocked ? "newer-installed"
              : !installed ? "not-installed"
                : !probe?.hidReady ? "driver-error"
                  : !probe?.runtimeRunning ? "runtime-offline"
                    : !transportOnline ? "codex-offline"
                      : "ready";
    return {
      platform: "windows",
      mode: "windows-local-trust",
      supported,
      ready,
      phase,
      setup: {
        installed,
        needsUpdate,
        installedVersion: metadata?.version || null,
        bundledVersion: payload?.version || version,
        canInstall: supported && payloadReady && !downgradeBlocked,
        canLaunch: installed && !probe?.runtimeRunning,
        canUninstall: partialInstallation,
        requiresRestart,
        secureBootBlocked,
        downgradeBlocked
      },
      checks: [
        { id: "payload", ready: payloadReady, level: needsUpdate ? "warn" : null },
        { id: "driver", ready: Boolean(probe?.rootReady && probe?.hidReady) },
        { id: "runtime", ready: Boolean(probe?.runtimeRunning && probe?.taskInstalled) },
        { id: "codex", ready: transportOnline }
      ],
      actions: actions(),
      operation,
      detail: { ...probe, probeError, taskName: TASK_NAME }
    };
  }

  async function elevated(operation) {
    await execute("powershell.exe", [
      "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", launcherPath,
      "-Operation", operation,
      "-PayloadRoot", payloadRoot,
      "-InstallRoot", installRoot
    ], { windowsHide: true });
    return status();
  }

  return {
    status,
    install: () => elevated("install"),
    uninstall: () => elevated("uninstall"),
    async launch() {
      await execute("schtasks.exe", ["/Run", "/TN", TASK_NAME], { windowsHide: true });
      return status();
    }
  };
}
