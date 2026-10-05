import { homedir } from "node:os";
import { join, resolve, relative, isAbsolute } from "node:path";

export function platformPaths({ platform = process.platform, home = homedir(), env = process.env } = {}) {
  if (platform === "win32") {
    const local = env.LOCALAPPDATA || join(home, "AppData", "Local");
    const roaming = env.APPDATA || join(home, "AppData", "Roaming");
    return {
      data: join(local, "OpenCodexMicro"),
      plugins: env.ULANZI_PLUGINS_DIR || join(roaming, "Ulanzi", "UlanziDeck", "Plugins"),
      antigravityPort: env.ANTIGRAVITY_PORT_FILE || join(roaming, "Antigravity", "DevToolsActivePort")
    };
  }
  return {
    data: join(home, "Library", "Application Support", "OpenCodexMicro"),
    plugins: join(home, "Library", "Application Support", "Ulanzi", "UlanziDeck", "Plugins"),
    antigravityPort: join(home, "Library", "Application Support", "Antigravity", "DevToolsActivePort")
  };
}

// Validate before every Windows installation/removal operation.
export function childPath(root, ...segments) {
  const base = resolve(root), target = resolve(base, ...segments), rel = relative(base, target);
  if (!rel || rel === ".." || rel.startsWith("..\\") || rel.startsWith("../") || isAbsolute(rel)) {
    throw new Error("Path must stay inside the component directory");
  }
  return target;
}
