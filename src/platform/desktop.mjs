import { exec, powershell } from "./windows/powershell.mjs";
import { access } from "node:fs/promises";
import { isAbsolute } from "node:path";

export function validateDebuggerEndpoint(endpoint, port) {
  const url = new URL(endpoint);
  if (url.protocol !== "ws:" || url.hostname !== "127.0.0.1" || Number(url.port) !== port || url.username || url.password) {
    throw new Error("Codex debugger must stay on its discovered loopback endpoint");
  }
  return url.href;
}

export async function processCommands({ platform = process.platform, execute = exec, mode = "command", env = process.env } = {}) {
  if (platform !== "win32") {
    return (await execute("/bin/ps", mode === "aux" ? ["aux"] : ["-axo", "command="], { timeout: mode === "aux" ? 2000 : 4000 })).stdout;
  }
  const filter = mode === "aux" ? "Get-CimInstance Win32_Process | Where-Object { $_.Name -match '^(agy|antigravity).*' }" :
    "Get-CimInstance Win32_Process | Where-Object { $_.Name -eq $env:ULANZI_CODEX_PROCESS -or $_.Name -eq 'Codex.exe' }";
  const { stdout } = await powershell(`${filter} | ForEach-Object { $_.CommandLine }`, { execute, env: { ...env, ULANZI_CODEX_PROCESS: `${env.CODEX_WINDOWS_PROCESS_NAME || 'ChatGPT'}.exe` } });
  return stdout;
}

export async function focusDesktop(application, { platform = process.platform, execute = exec, file, env = process.env } = {}) {
  if (platform !== "win32") {
    const args = application === "codex" ? ["-b", "com.openai.codex"] : ["-a", application];
    if (file) args.push(file);
    return execute("/usr/bin/open", args, { timeout: 3000 });
  }
  if (file) {
    const executable = env.ANTIGRAVITY_EDITOR_EXE;
    if (!executable || !isAbsolute(executable) || !/\.exe$/i.test(executable)) throw new Error("Set ANTIGRAVITY_EDITOR_EXE to the editor executable to open artifacts");
    await access(executable);
    // Never interpolate artifact paths into a shell command.
    return execute(executable, [file], { timeout: 5000, windowsHide: true });
  }
  const name = application === "codex" ? (env.CODEX_WINDOWS_PROCESS_NAME || "ChatGPT") :
    application === "Visual Studio Code" ? "Code" : "Antigravity";
  return powershell(`
$windows = @(Get-Process -Name $env:ULANZI_FOCUS_PROCESS -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 })
if ($windows.Count -ne 1) { throw 'Open exactly one application window before using this action' }
$shell = New-Object -ComObject WScript.Shell
if (-not $shell.AppActivate($windows[0].Id)) { throw 'Windows did not allow the application to receive focus' }
`, { execute, env: { ...env, ULANZI_FOCUS_PROCESS: name } });
}
