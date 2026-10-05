import { rm } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { homedir } from "node:os";
import { join } from "node:path";
import { bridgeComponents, removeBridgeFiles } from "../src/shared/bridge-files.mjs";
const home = homedir();
const all = process.argv.includes("--all");
const components = all ? Object.keys(bridgeComponents) : ["codex"];
const plugins = all ? ["codexmicro", "antigravity", "codexcli", "spotify"] : ["codexmicro"];
for (const component of components) {
  const agent = join(home, "Library/LaunchAgents", bridgeComponents[component].agent);
  try { execFileSync("/bin/launchctl", ["bootout", `gui/${process.getuid()}`, agent], { stdio: "ignore" }); } catch {}
  await rm(agent, { force: true });
  await removeBridgeFiles(home, component);
}
await rm(join(home, "Applications/Codex Bridge.app"), { recursive: true, force: true });
for (const plugin of plugins) await rm(join(home, "Library/Application Support/Ulanzi/UlanziDeck/Plugins", `com.ulanzi.${plugin}.ulanziPlugin`), { recursive: true, force: true });
console.log(all ? "All Ulanzi plugins and bridges removed. Spotify preferences and credentials were retained." : "Codex App and its bridge removed. Other plugins and bridges were retained.");
