import { spawn } from "node:child_process";

const FOCUS_SCRIPT = `
$ErrorActionPreference = 'Stop'
$appId = $env:CODEX_WINDOWS_AUMID
if (-not $appId) {
  $app = Get-StartApps |
    Where-Object { $_.AppID -like 'OpenAI.Codex_*!App' } |
    Select-Object -First 1
  if (-not $app) {
    $app = Get-StartApps |
      Where-Object { $_.Name -match '^(Codex|ChatGPT)$' -and $_.AppID -like '*!App' } |
      Select-Object -First 1
  }
  $appId = $app.AppID
}
$processName = if ($env:CODEX_WINDOWS_PROCESS_NAME) {
  $env:CODEX_WINDOWS_PROCESS_NAME
} else {
  'ChatGPT'
}
$process = Get-Process -Name $processName -ErrorAction SilentlyContinue |
  Where-Object { $_.MainWindowHandle -ne 0 } |
  Select-Object -First 1
if ($process) {
  $shell = New-Object -ComObject WScript.Shell
  foreach ($attempt in 1..3) {
    if ($shell.AppActivate($process.Id)) { exit 0 }
    Start-Sleep -Milliseconds 100
  }
}
if (-not $appId) { exit 2 }
Start-Process explorer.exe "shell:AppsFolder\\$appId"
`;

export function focusWindowsCodex({ env = process.env } = {}) {
  return new Promise((resolve, reject) => {
    const encoded = Buffer.from(FOCUS_SCRIPT, "utf16le").toString("base64");
    const child = spawn("powershell.exe", [
      "-NoProfile",
      "-NonInteractive",
      "-WindowStyle",
      "Hidden",
      "-EncodedCommand",
      encoded
    ], {
      env,
      windowsHide: true,
      stdio: "ignore"
    });
    child.on("error", reject);
    child.on("exit", code => {
      if (code === 0) resolve({ ok: true });
      else reject(new Error(`Could not focus Codex (PowerShell exit ${code})`));
    });
  });
}
