import { access } from "node:fs/promises";
import { spawn } from "node:child_process";
import { isAbsolute, dirname } from "node:path";
import { powershell } from "./powershell.mjs";
import { launchPackagedCodex } from "./packaged-app.mjs";

export async function launchWindowsCodex({ env = process.env, run = powershell, spawnImpl = spawn } = {}) {
  const executable = env.CODEX_APP_EXE;
  if (!executable || !isAbsolute(executable) || !/\.exe$/i.test(executable)) throw new Error("Set CODEX_APP_EXE to the full Codex desktop executable path. CDP-capable builds only; Store builds may not support this integration");
  await access(executable);
  const { stdout } = await run("@(Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -eq $env:CODEX_APP_EXE }).Count", { env });
  if (Number(stdout.trim()) !== 0) throw new Error("Codex is already running. Save your work and close it yourself before using this launcher");
  const args = ["--remote-debugging-address=127.0.0.1", "--remote-debugging-port=9222", "--remote-allow-origins=http://127.0.0.1:9222"];
  // Optional compositor workaround; never change the user's global shortcuts.
  if (env.CODEX_WINDOWS_OCCLUSION_WORKAROUND === "1") args.push("--disable-features=CalculateNativeWinOcclusion");
  if (/[\\/]WindowsApps[\\/]/i.test(executable)) {
    await launchPackagedCodex(executable, args, { env, run });
    return;
  }
  const child = spawnImpl(executable, args, { cwd: dirname(executable), windowsHide: false, detached: true, stdio: "ignore", env });
  await new Promise((resolve, reject) => { child.once("spawn", resolve); child.once("error", reject); });
  child.unref();
}
