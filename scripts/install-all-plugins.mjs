import { preflightPlugin } from "../src/shared/plugin-installer.mjs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("../", import.meta.url));
const components = [ ["codexmicro", "install-plugin.mjs"], ["antigravity", "install-antigravity-plugin.mjs"], ["spotify", "install-spotify-plugin.mjs"], ["codexcli", "install-codex-cli-plugin.mjs"] ];
// Finish every build and preflight before replacing the first installed plugin.
for (const [name] of components) {
  const cwd = `${root}integration/com.ulanzi.${name}.ulanziPlugin`;
  execFileSync(process.execPath, ["build.mjs"], { cwd, stdio: "inherit" });
  await preflightPlugin(cwd, name);
}
for (const [, script] of components) execFileSync(process.execPath, [`${root}scripts/${script}`], { cwd: root, stdio: "inherit", env: { ...process.env, ULANZI_PREBUILT: "1" } });
