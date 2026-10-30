import { powershell } from "./powershell.mjs";
import { launchWindowsCodex } from "./codex-launcher.mjs";
import { focusDesktop } from "../desktop.mjs";

// Explicit shortcut action: start the installed bridge, then open/focus Codex.
// Restart is opt-in for a deliberate shortcut click; never schedule a launch.
export async function openWindowsCodex({ startBridge, env = process.env, run = powershell,
  launch = launchWindowsCodex, focus = focusDesktop, restart = false, force = false, close = closeWindowsCodex } = {}) {
  if (!env.CODEX_APP_EXE) throw new Error("Configure CODEX_APP_EXE before opening Codex with the bridge");
  if (force && !restart) throw new Error("A finalizacao do processo exige um reinicio explicitamente autorizado.");
  let forced = false;
  if (!restart) await startBridge();
  const { stdout } = await run("@(Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -eq $env:CODEX_APP_EXE }).Count", { env });
  const count = Number(stdout.trim());
  if (!stdout.trim() || !Number.isInteger(count) || count < 0) throw new Error("Cannot determine whether Codex is already running");
  if (count > 0) {
    if (!restart) {
      await focus("codex", { env });
      return { alreadyRunning: true };
    }
    const closed = await close({ env, run, force });
    forced = Boolean(closed?.forced);
  }
  if (restart) await startBridge();
  await launch({ env, run });
  return { alreadyRunning: false, ...(restart ? { restarted: count > 0 } : {}), ...(force ? { forced } : {}) };
}

export async function closeWindowsCodex({ env = process.env, run = powershell, force = false } = {}) {
  if (!env.CODEX_APP_EXE) throw new Error("Configure CODEX_APP_EXE antes de fechar o Codex.");
  const result = await run(`
# CIM can identify a 64-bit app even when this PowerShell is 32-bit.
$candidates = @(Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -eq $env:CODEX_APP_EXE })
$windows = @($candidates | ForEach-Object { Get-Process -Id $_.ProcessId -ErrorAction SilentlyContinue } | Where-Object { $_.MainWindowHandle -ne 0 })
if ($windows.Count -gt 1) { throw 'Ha mais de uma janela do Codex. Feche as outras antes de reiniciar pelo atalho.' }
if ($windows.Count -eq 1 -and -not $windows[0].CloseMainWindow()) { throw 'O Codex nao aceitou o fechamento. Salve o trabalho e feche o aplicativo manualmente.' }
$allowForce = $env:ULANZI_CODEX_FORCE_RESTART -eq '1'
$forced = $false
$deadline = [DateTime]::UtcNow.AddSeconds($(if ($allowForce) { 2 } else { 20 }))
do {
  $remaining = @(Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -eq $env:CODEX_APP_EXE })
  if ($remaining.Count -eq 0) { break }
  if ([DateTime]::UtcNow -ge $deadline) {
    if (-not $allowForce) { throw 'O Codex continua em execucao. Use Sair/Quit na bandeja; nenhum encerramento foi forcado.' }
    # Only original processes of this exact app executable are eligible. Never
    # use a process-tree kill: app-server/CLI processes have different binaries.
    foreach ($current in $remaining) {
      $original = @($candidates | Where-Object { $_.ProcessId -eq $current.ProcessId -and $_.CreationDate -eq $current.CreationDate })
      if ($original.Count -ne 1) { throw 'Uma nova instancia do Codex apareceu durante o reinicio. Nenhuma finalizacao foi feita.' }
    }
    foreach ($current in ($remaining | Sort-Object @{Expression={ if ($_.CommandLine -match '--type=') { 1 } else { 0 } }})) {
      $confirmed = Get-CimInstance Win32_Process -Filter ("ProcessId=" + $current.ProcessId)
      if ($confirmed -and $confirmed.ExecutablePath -eq $env:CODEX_APP_EXE -and $confirmed.CreationDate -eq $current.CreationDate) {
        Stop-Process -Id $confirmed.ProcessId -Force -ErrorAction SilentlyContinue
        $forced = $true
      }
    }
    $forceDeadline = [DateTime]::UtcNow.AddSeconds(5)
    do {
      $remaining = @(Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -eq $env:CODEX_APP_EXE })
      if ($remaining.Count -eq 0) { break }
      if ([DateTime]::UtcNow -ge $forceDeadline) { throw 'O Codex nao encerrou. Nenhuma nova tentativa de abertura foi feita.' }
      Start-Sleep -Milliseconds 250
    } while ($true)
    break
  }
  Start-Sleep -Milliseconds 250
} while ($true)
[pscustomobject]@{ forced = $forced } | ConvertTo-Json -Compress
`, { env: { ...env, ULANZI_CODEX_FORCE_RESTART: force ? "1" : "0" }, timeout: 30000 });
  return JSON.parse(result.stdout.trim());
}

export function codexOpenErrorMessage(error) {
  const stderr = String(error.stderr || "");
  const xmlError = stderr.match(/<S S="Error">([\s\S]*?)<\/S>/)?.[1];
  if (xmlError) return xmlError.replace(/_x([0-9a-f]{4})_/gi, (_, code) => String.fromCharCode(parseInt(code, 16)))
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&").trim();
  if (error.killed || error.code === "ETIMEDOUT") return "O Windows demorou demais para responder. Nenhuma nova tentativa de abertura foi feita.";
  return stderr.trim() || error.message || "Nao foi possivel abrir o Codex.";
}
