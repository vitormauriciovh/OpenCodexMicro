import {
  chmod,
  cp,
  mkdir,
  readFile,
  writeFile
} from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

const home = homedir();
const uid = process.getuid();
const packageMetadata = JSON.parse(await readFile(resolve("package.json"), "utf8"));
const releaseVersion = String(packageMetadata.version);
const appRoot = join(home, "Library", "Application Support", "OpenCodexMicro", "antigravity");
const agentsRoot = join(home, "Library", "LaunchAgents");
const bridgeAgent = join(agentsRoot, "io.openantigravitymicro.bridge.plist");

const xml = (value) => String(value)
  .replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;")
  .replaceAll("'", "&apos;");

await mkdir(appRoot, { recursive: true, mode: 0o700 });
await chmod(appRoot, 0o700);
await mkdir(agentsRoot, { recursive: true });

execFileSync(process.execPath, [resolve("scripts/build-antigravity-bridge.mjs")], {
  stdio: "inherit"
});
await cp(resolve("dist/bridge-antigravity.mjs"), join(appRoot, "bridge-antigravity.mjs"));

const bridgePlist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>io.openantigravitymicro.bridge</string>
  <key>ProgramArguments</key><array>
    <string>${xml(process.execPath)}</string>
    <string>${xml(join(appRoot, "bridge-antigravity.mjs"))}</string>
  </array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ProcessType</key><string>Background</string>
  <key>ThrottleInterval</key><integer>2</integer>
  <key>StandardOutPath</key><string>${xml(join(appRoot, "bridge-antigravity.log"))}</string>
  <key>StandardErrorPath</key><string>${xml(join(appRoot, "bridge-antigravity-error.log"))}</string>
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
console.log("Antigravity Bridge service installed and started on http://127.0.0.1:17374");

