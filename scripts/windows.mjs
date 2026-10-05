import { readFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { createWindowsInstaller, components } from "../src/platform/windows/installer.mjs";
import { installWindowsPlugin } from "../src/platform/windows/plugin-installer.mjs";
import { platformPaths } from "../src/platform/paths.mjs";
import { localHeaders } from "../src/shared/local-api.mjs";
import { WINDOWS_CLI_URL } from "../src/platform/cli-transport.mjs";
import { launchWindowsCodex } from "../src/platform/windows/codex-launcher.mjs";
import { powershell } from "../src/platform/windows/powershell.mjs";

if (process.platform !== "win32") throw new Error("Windows commands cannot modify a macOS installation");
const [action, component = "codex"] = process.argv.slice(2);
const spec = components[component];
if (!spec) throw new Error("Choose codex, antigravity or codex-cli");
const root = fileURLToPath(new URL("../", import.meta.url));
const version = JSON.parse(await readFile(join(root, "package.json"), "utf8")).version;
const pluginRoot = join(root, "dist/windows", `com.ulanzi.${spec.plugin}.ulanziPlugin`);
const installer = createWindowsInstaller({ component, payloadRoot: join(pluginRoot, "installer"), version });
if (action === "install-plugin") {
  const { stdout } = await powershell("@(Get-Process -Name Ulanzi,UlanziDeck,'Ulanzi Studio',UlanziStudio -ErrorAction SilentlyContinue).Count");
  if (Number(stdout.trim()) > 0) throw new Error("Close Ulanzi Studio before replacing a plugin");
  console.log(await installWindowsPlugin(pluginRoot, spec.plugin));
} else if (action === "setup") console.log(await installer.install({ start: process.argv.includes("--start") }));
else if (action === "start") { await installer.launch(); console.log("Bridge start requested. Use windows:status to check the application connection."); }
else if (action === "stop") await installer.stop();
else if (action === "uninstall") { await installer.uninstall(); console.log("Bridge runtime removed; drafts, logs, credentials and plugins retained."); }
else if (action === "status") console.log(JSON.stringify(await installer.status(), null, 2));
else if (action === "launch-app") await launchWindowsCodex({ env: await installer.launchEnvironment() });
else if (action === "terminal") {
  const metadata = JSON.parse(await readFile(join(platformPaths().data, "codex-cli/windows-install.json"), "utf8"));
  const config = JSON.parse(await readFile(metadata.configPath, "utf8"));
  Object.assign(process.env, config.env);
  const token = localHeaders("codex-cli-server").Authorization.slice("Bearer ".length);
  const child = spawn(config.cliExecutable, ["--remote", WINDOWS_CLI_URL, "--remote-auth-token-env", "ULANZI_CODEX_REMOTE_TOKEN"], { stdio: "inherit", env: { ...process.env, ULANZI_CODEX_REMOTE_TOKEN: token } });
  child.on("error", error => { console.error(error.message); process.exitCode = 1; });
  child.on("exit", code => { process.exitCode = code || 0; });
} else throw new Error("Choose install-plugin, setup, start, stop, status, uninstall, launch-app or terminal");
