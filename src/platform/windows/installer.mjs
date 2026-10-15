import { access, cp, lstat, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { join, isAbsolute } from "node:path";
import { platformPaths, childPath } from "../paths.mjs";
import { powershell, exec, psArgs } from "./powershell.mjs";
import { protectDirectory } from "./privacy.mjs";
import { localHeaders } from "../../shared/local-api.mjs";
import { atomicJson } from "../../shared/storage.mjs";

export const components = {
  codex: { plugin: "codexmicro", port: 17373, runtime: "bridge.mjs" },
  antigravity: { plugin: "antigravity", port: 17374, runtime: "bridge-antigravity.mjs" },
  "codex-cli": { plugin: "codexcli", port: 17376, runtime: "bridge-codex-cli.mjs" }
};
const literal = value => "'" + String(value).replaceAll("'", "''") + "'";
const exists = async file => { try { await access(file); return true; } catch (e) { if (e.code === "ENOENT") return false; throw e; } };

export async function resolveCliExecutable({ env = process.env, execute = exec } = {}) {
  const candidates = [env.CODEX_CLI_EXE];
  if (!env.CODEX_CLI_EXE) {
    try { candidates.push(...(await execute("where.exe", ["codex.exe"], { windowsHide: true })).stdout.trim().split(/\r?\n/)); } catch {}
  }
  for (const candidate of candidates.filter(Boolean)) {
    if (isAbsolute(candidate) && /\.exe$/i.test(candidate) && await exists(candidate)) return candidate;
  }
  throw new Error("Set CODEX_CLI_EXE to the full path of a compatible codex.exe (not a .cmd shim)");
}

export function createWindowsInstaller({ component = "codex", payloadRoot, version, home, env = process.env, bridgeUrl,
  nodeExecutable = process.execPath, execute = exec, secure = protectDirectory, fetchImpl = fetch } = {}) {
  const spec = components[component];
  if (!spec) throw new Error("Unknown Windows bridge component");
  const endpoint = new URL(bridgeUrl || `http://127.0.0.1:${spec.port}`);
  if (endpoint.protocol !== "http:" || !["127.0.0.1", "localhost", "[::1]"].includes(endpoint.hostname) || endpoint.username || endpoint.password) throw new Error("Bridge URL must use HTTP loopback");
  const paths = platformPaths({ platform: "win32", home, env });
  const root = childPath(paths.data, component);
  const metadataFile = childPath(root, "windows-install.json");
  const taskName = `OpenCodexMicro ${component} Bridge`;
  async function checkDirectories() {
    for (const directory of [paths.data, root, childPath(root, "releases")]) {
      try { if ((await lstat(directory)).isSymbolicLink()) throw new Error("Bridge directories must not be junctions or symbolic links"); }
      catch (error) { if (error.code !== "ENOENT") throw error; }
    }
  }
  const taskEnv = extra => ({ ...env, ULANZI_TASK_NAME: taskName, ...extra });
  const run = (script, extra) => powershell(script, { execute, env: taskEnv(extra) });
  async function metadata() { try { return JSON.parse(await readFile(metadataFile, "utf8")); } catch (e) { if (e.code === "ENOENT") return null; throw e; } }
  async function task() {
    const { stdout } = await run(`
$task = Get-ScheduledTask -TaskName $env:ULANZI_TASK_NAME -ErrorAction SilentlyContinue
if ($task) { [pscustomobject]@{ state = [string]$task.State; xml = (Export-ScheduledTask -TaskName $env:ULANZI_TASK_NAME) } | ConvertTo-Json -Compress }
else { 'null' }
`);
    return JSON.parse(stdout.trim() || "null");
  }
  async function status() {
    const stored = await metadata();
    let current = null, serviceError = null, serviceOnline = false, connected = false;
    try { current = await task(); } catch (e) { serviceError = e.message; }
    try {
      const response = await fetchImpl(new URL("/health", endpoint), { headers: localHeaders(component), signal: AbortSignal.timeout(1500), redirect: "error" });
      const data = await response.json();
      serviceOnline = response.ok && data.ok === true;
      connected = Boolean(data.codexConnected || data.antigravityConnected || data.daemonConnected);
    } catch (e) { serviceError ||= e.message; }
    const installed = Boolean(stored && current && await exists(stored.runtime));
    return { platform: "win32", supported: true, installed, appInstalled: installed, serviceInstalled: installed,
      serviceOnline, cdpConnected: connected, serviceError, installedVersion: stored?.version || null,
      bundledVersion: version, needsUpdate: !installed || stored.version !== version,
      appPath: root, nodeExecutable: stored?.nodeExecutable || null, nodeVersion: stored?.nodeVersion || null, nodeSource: "system" };
  }
  async function install({ start = false } = {}) {
    await checkDirectories();
    // All validation precedes registration. A running bridge is never replaced.
    const previous = await task(), previousMetadata = await metadata();
    if (previous && !previousMetadata) throw new Error(`An unmanaged task named ${taskName} already exists`);
    if (previous?.state === "Running") throw new Error("Bridge is running. Stop this component explicitly before installing an update");
    const previousConfig = previousMetadata ? JSON.parse(await readFile(previousMetadata.configPath, "utf8")) : null;
    const installEnv = { ...previousConfig?.env, ...env };
    const nodeVersion = (await execute(nodeExecutable, ["--version"], { windowsHide: true })).stdout.trim();
    if (Number(nodeVersion.match(/^v(\d+)/)?.[1]) < 20 || !/^v\d+\./.test(nodeVersion)) throw new Error("Node.js 20+ is required");
    let cliExecutable;
    if (component === "codex-cli") {
      cliExecutable = await resolveCliExecutable({ env: { CODEX_CLI_EXE: previousConfig?.cliExecutable, ...installEnv }, execute });
      const help = (await execute(cliExecutable, ["app-server", "--help"], { windowsHide: true })).stdout;
      if (!help.includes("--ws-token-file") || !help.includes("--ws-auth")) throw new Error("Update Codex CLI: authenticated app-server WebSocket support is required");
    }
    for (const file of [spec.runtime, "windows-runner.mjs", "LICENSE", "NOTICE.md", "THIRD_PARTY_NOTICES.md"]) await access(join(payloadRoot, file));
    await mkdir(root, { recursive: true });
    secure(root);
    const release = childPath(root, "releases", randomUUID());
    await mkdir(release, { recursive: true });
    const runtime = childPath(release, spec.runtime), runner = childPath(release, "windows-runner.mjs");
    let registered = false;
    try {
      for (const file of [spec.runtime, "windows-runner.mjs", "LICENSE", "NOTICE.md", "THIRD_PARTY_NOTICES.md"]) await cp(join(payloadRoot, file), childPath(release, file));
      const config = { component, runtime, cliExecutable, env: Object.fromEntries([
        "CODEX_APP_EXE", "CODEX_WINDOWS_PROCESS_NAME", "CODEX_WINDOWS_OCCLUSION_WORKAROUND", "ANTIGRAVITY_EDITOR_EXE", "ANTIGRAVITY_EDITOR_APP",
        "ANTIGRAVITY_PORT_FILE", "ANTIGRAVITY_BRAIN_DIR", "ULANZI_AUTH_DIR", "CODEX_HOME"
      ].filter(key => installEnv[key]).map(key => [key, installEnv[key]])) };
      const configPath = childPath(release, "config.json");
      await writeFile(configPath, JSON.stringify(config));
      const command = `$ErrorActionPreference = 'Stop'\n& ${literal(nodeExecutable)} ${literal(runner)} ${literal(configPath)}\nexit $LASTEXITCODE`;
      const args = ["-WindowStyle", "Hidden", ...psArgs(command)].join(" ");
      await run(`
$identity = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
$action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument $env:ULANZI_TASK_ARGUMENTS
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $identity
$principal = New-ScheduledTaskPrincipal -UserId $identity -LogonType Interactive -RunLevel Limited
$settings = New-ScheduledTaskSettingsSet -ExecutionTimeLimit ([TimeSpan]::Zero) -MultipleInstances IgnoreNew -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
Register-ScheduledTask -TaskName $env:ULANZI_TASK_NAME -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Force | Out-Null
`, { ULANZI_TASK_ARGUMENTS: args });
      registered = true;
      await atomicJson(metadataFile, { version, runtime, runner, configPath, release, nodeExecutable, nodeVersion, taskName, stopProtocol: 1 });
    } catch (error) {
      if (registered) {
        if (previous) await run("Register-ScheduledTask -TaskName $env:ULANZI_TASK_NAME -Xml $env:ULANZI_TASK_XML -Force | Out-Null", { ULANZI_TASK_XML: previous.xml });
        else await run("Unregister-ScheduledTask -TaskName $env:ULANZI_TASK_NAME -Confirm:$false");
      }
      if (previousMetadata) await atomicJson(metadataFile, previousMetadata);
      else await rm(metadataFile, { force: true });
      await rm(childPath(root, "releases", release.split(/[\\/]/).at(-1)), { recursive: true, force: true });
      throw error;
    }
    // A failed/uncertain start must leave the fully installed runtime available.
    if (start) await launch();
    return { installed: true, taskName, root, started: start };
  }
  async function launch() {
    if (!await metadata()) throw new Error("Install the Windows bridge first");
    if ((await task())?.state === "Disabled") await run("Enable-ScheduledTask -TaskName $env:ULANZI_TASK_NAME | Out-Null");
    await run("Start-ScheduledTask -TaskName $env:ULANZI_TASK_NAME");
  }
  async function launchEnvironment() {
    const stored = await metadata();
    if (!stored) throw new Error("Install the Windows bridge first");
    const config = JSON.parse(await readFile(stored.configPath, "utf8"));
    return { ...env, ...config.env };
  }
  async function stop() {
    const stored = await metadata();
    if (!stored) throw new Error("This component has no managed Windows installation");
    if (stored.stopProtocol === 1 && (await task())?.state === "Running") {
      await writeFile(`${stored.configPath}.stop`, "stop\n");
      const deadline = Date.now() + 5000;
      while ((await task())?.state === "Running") {
        if (Date.now() >= deadline) throw new Error("Bridge did not acknowledge stop; runtime retained. Do not reinstall while it is running");
        await new Promise(resolve => setTimeout(resolve, 250));
      }
    } else if (stored.stopProtocol !== 1 && (await task())?.state === "Running") {
      throw new Error("This older runner cannot stop its children reliably. Close its managed bridge processes before updating; other Codex sessions must remain open");
    }
    await run("Stop-ScheduledTask -TaskName $env:ULANZI_TASK_NAME");
  }
  async function uninstall() {
    await checkDirectories();
    if (!await metadata()) throw new Error("This component has no managed Windows installation");
    await stop();
    await run("Unregister-ScheduledTask -TaskName $env:ULANZI_TASK_NAME -Confirm:$false");
    await rm(childPath(root, "releases"), { recursive: true, force: true });
    await rm(metadataFile, { force: true });
    // Keep drafts, logs, credentials and sibling components.
  }
  return { status, install, launch, stop, uninstall, launchEnvironment };
}
