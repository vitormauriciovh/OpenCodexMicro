import {
  chmod,
  access,
  cp,
  mkdir,
  readFile,
  writeFile
} from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { constants } from "node:fs";
import { cliBridgeLauncher } from "../src/shared/cli-launcher.mjs";

const home = homedir();
const uid = process.getuid();
const packageMetadata = JSON.parse(await readFile(resolve("package.json"), "utf8"));
const appRoot = join(home, "Library", "Application Support", "OpenCodexMicro", "codex-cli");
const agentsRoot = join(home, "Library", "LaunchAgents");
const bridgeAgent = join(agentsRoot, "io.opencodexmicro.codexcli.bridge.plist");
const launcherPath = join(appRoot, "start-bridge.sh");
const candidates = [join(home, ".codex/packages/standalone/current/bin/codex"), join(home, ".codex/packages/standalone/current/codex")];
let codexPath = null;
for (const candidate of candidates) {
  try { await access(candidate, constants.X_OK); codexPath = candidate; break; } catch {}
}
if (!codexPath) {
  throw new Error("Codex CLI requires the official standalone installation. Install it from https://chatgpt.com/codex/install.sh, then run npm run setup:codexcli again.");
}

const xml = (value) => String(value)
  .replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;")
  .replaceAll("'", "&apos;");

await mkdir(appRoot, { recursive: true, mode: 0o700 });
await chmod(appRoot, 0o700);
await mkdir(agentsRoot, { recursive: true });

execFileSync(process.execPath, [resolve("scripts/build-codex-cli-bridge.mjs")], {
  stdio: "inherit"
});
await cp(resolve("dist/bridge-codex-cli.mjs"), join(appRoot, "bridge-codex-cli.mjs"));
await writeFile(launcherPath, cliBridgeLauncher({ codexPath, nodePath: process.execPath, bridgePath: join(appRoot, "bridge-codex-cli.mjs") }), { mode: 0o700 });
await chmod(launcherPath, 0o700);

const bridgePlist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>io.opencodexmicro.codexcli.bridge</string>
  <key>ProgramArguments</key><array>
    <string>/bin/sh</string>
    <string>${xml(launcherPath)}</string>
  </array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ProcessType</key><string>Background</string>
  <key>ThrottleInterval</key><integer>2</integer>
  <key>StandardOutPath</key><string>${xml(join(appRoot, "bridge-codex-cli.log"))}</string>
  <key>StandardErrorPath</key><string>${xml(join(appRoot, "bridge-codex-cli-error.log"))}</string>
</dict></plist>
`;
await writeFile(bridgeAgent, bridgePlist, { mode: 0o644 });

try {
  execFileSync("/bin/launchctl", ["bootout", `gui/${uid}`, bridgeAgent], {
    stdio: "ignore"
  });
} catch {
  // Service may not be loaded yet
}

execFileSync("/bin/launchctl", ["bootstrap", `gui/${uid}`, bridgeAgent]);
console.log("Codex CLI Bridge service installed and started on http://127.0.0.1:17376");
