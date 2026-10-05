import { access, cp, lstat, mkdir, readFile, rename, rm } from "node:fs/promises";
import { basename, join } from "node:path";
import { randomUUID } from "node:crypto";
import { preflightPlugin } from "../../shared/plugin-installer.mjs";
import { platformPaths, childPath } from "../paths.mjs";

export async function installWindowsPlugin(source, name, { home, env = process.env } = {}) {
  if (!["codexmicro", "antigravity", "codexcli"].includes(name)) throw new Error("Unsupported Windows plugin");
  const files = await preflightPlugin(source, name);
  const manifest = JSON.parse(await readFile(join(source, "manifest.json"), "utf8"));
  if (!manifest.OS?.some(os => os.Platform === "win")) throw new Error("Build the Windows package before installing it");
  if (!files.includes("installer")) files.push("installer");
  files.push("WINDOWS.md");
  for (const file of files) await access(join(source, file));
  if (basename(source) !== `com.ulanzi.${name}.ulanziPlugin`) throw new Error("Invalid plugin directory");
  const paths = platformPaths({ platform: "win32", home, env });
  // Do not guess a new Ulanzi directory. The user can override an existing root.
  await access(paths.plugins);
  if ((await lstat(paths.plugins)).isSymbolicLink()) throw new Error("Plugin root must not be a junction or symbolic link");
  const destination = childPath(paths.plugins, basename(source));
  const backupRoot = childPath(paths.data, "plugin-backups");
  const staging = childPath(backupRoot, `staging-${randomUUID()}`);
  const backup = childPath(backupRoot, `${basename(source)}-${randomUUID()}`);
  let moved = false;
  await mkdir(staging, { recursive: true });
  try {
    for (const file of files) await cp(join(source, file), childPath(staging, file), { recursive: true });
    try {
      const existing = await lstat(destination);
      if (existing.isSymbolicLink()) throw new Error("Installed plugin must not be a junction or symbolic link");
      await rename(destination, backup); moved = true;
    } catch (error) { if (error.code !== "ENOENT") throw error; }
    try { await rename(staging, destination); }
    catch (error) { if (moved) await rename(backup, destination); throw error; }
  } finally { await rm(childPath(backupRoot, basename(staging)), { recursive: true, force: true }); }
  return { destination, backup: moved ? backup : null };
}
