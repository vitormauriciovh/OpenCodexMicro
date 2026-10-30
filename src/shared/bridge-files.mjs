import { rm, rmdir } from "node:fs/promises";
import { join } from "node:path";
export const bridgeComponents = {
  codex: { agent: "io.opencodexmicro.bridge.plist", files: ["bridge.mjs", "install.json", "bridge.log", "bridge-error.log", "CodexBridge.iconset", "LICENSE", "NOTICE.md", "THIRD_PARTY_NOTICES.md"] },
  antigravity: { agent: "io.openantigravitymicro.bridge.plist", files: ["bridge-antigravity.mjs", "bridge-antigravity.log", "bridge-antigravity-error.log"] },
  "codex-cli": { agent: "io.opencodexmicro.codexcli.bridge.plist", files: ["bridge-codex-cli.mjs", "bridge-codex-cli.log", "bridge-codex-cli-error.log"] }
};
export async function removeBridgeFiles(home, component) {
  const spec = bridgeComponents[component];
  if (!spec) throw new Error("Unknown bridge component");
  const root = join(home, "Library/Application Support/OpenCodexMicro");
  await rm(join(root, component), { recursive: true, force: true });
  // Upgrade compatibility: remove only files owned by this legacy component.
  for (const name of spec.files) await rm(join(root, name), { recursive: true, force: true });
  try { await rmdir(root); } catch (error) { if (!["ENOENT", "ENOTEMPTY", "EEXIST"].includes(error.code)) throw error; }
}
