import { access, cp, mkdir, readFile, rename, rm, stat } from "node:fs/promises";
import { join, dirname, basename } from "node:path";
import { execFileSync } from "node:child_process";
import { homedir } from "node:os";
const locales = ["en", "zh_CN", "zh_HK", "ja_JP", "de_DE", "ko_KR", "pt_PT", "es_ES"];
async function exists(file) { try { await stat(file); return true; } catch (error) { if (error.code === "ENOENT") return false; throw error; } }
export async function preflightPlugin(source, name) {
  const manifest = JSON.parse(await readFile(join(source, "manifest.json"), "utf8"));
  if (manifest.UUID !== `com.ulanzi.ulanzistudio.${name}` || manifest.CodePath !== "dist/app.js") throw new Error("Unexpected plugin manifest");
  const files = ["manifest.json", ...locales.map(locale => `${locale}.json`), "assets/icons", "dist", "property-inspector"];
  await access(join(source, manifest.CodePath));
  for (const action of manifest.Actions || []) if (action.PropertyInspectorPath) await access(join(source, action.PropertyInspectorPath));
  for (const locale of locales) {
    const data = JSON.parse(await readFile(join(source, `${locale}.json`), "utf8"));
    for (const field of ["Name", "Description"]) if (!data[field]?.trim()) throw new Error(`${locale} is missing ${field}`);
  }
  if (name === "codexmicro") {
    files.push("installer");
    for (const file of ["bridge.mjs", "CodexBridge.png", "LICENSE", "NOTICE.md", "THIRD_PARTY_NOTICES.md"]) await access(join(source, "installer", file));
  } else await access(join(source, "property-inspector/inspector-api.js"));
  if (await exists(join(source, "assets/banners"))) files.push("assets/banners");
  for (const file of files) await access(join(source, file));
  return files;
}
export async function installPlugin(source, name, { home = homedir(), build = true, execute = execFileSync } = {}) {
  if (build) execute(process.execPath, ["build.mjs"], { cwd: source, stdio: "inherit" });
  const files = await preflightPlugin(source, name);
  const root = join(home, "Library/Application Support/Ulanzi/UlanziDeck/Plugins");
  const destination = join(root, basename(source));
  const staging = `${destination}.installing-${process.pid}`;
  const backup = join(home, "Library/Application Support/OpenCodexMicro/plugin-backups", `${basename(source)}-${Date.now()}-${process.pid}`);
  await mkdir(root, { recursive: true });
  await rm(staging, { recursive: true, force: true });
  if (await exists(backup)) throw new Error(`Previous backup needs inspection: ${backup}`);
  let moved = false;
  try {
    for (const file of files) {
      await mkdir(dirname(join(staging, file)), { recursive: true });
      await cp(join(source, file), join(staging, file), { recursive: true });
    }
    if (await exists(destination)) {
      await mkdir(dirname(backup), { recursive: true, mode: 0o700 });
      await rename(destination, backup); moved = true;
    }
    try { await rename(staging, destination); }
    catch (error) { if (moved) await rename(backup, destination); throw error; }
  } finally { await rm(staging, { recursive: true, force: true }); }
  // Retain the previous package outside Ulanzi's discovery directory so an
  // application-level regression can be rolled back after installation.
  return destination;
}
