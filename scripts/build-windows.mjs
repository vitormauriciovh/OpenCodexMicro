import { build } from "esbuild";
import { cp, mkdir, readFile, writeFile, access } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const root = fileURLToPath(new URL("../", import.meta.url));
const output = join(root, "dist", "windows");
const banner = { js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);" };
const bridges = { codexmicro: ["bridge", "bridge.mjs"], antigravity: ["bridge-antigravity", "bridge-antigravity.mjs"], codexcli: ["bridge-codex-cli", "bridge-codex-cli.mjs"] };
const locales = ["en", "zh_CN", "zh_HK", "ja_JP", "de_DE", "ko_KR", "pt_PT", "es_ES"];
for (const [plugin, [bridge, runtime]] of Object.entries(bridges)) {
  const source = join(root, "integration", `com.ulanzi.${plugin}.ulanziPlugin`);
  const target = join(output, `com.ulanzi.${plugin}.ulanziPlugin`);
  await mkdir(join(target, "dist"), { recursive: true });
  await mkdir(join(target, "installer"), { recursive: true });
  for (const folder of ["assets", "property-inspector"]) await cp(join(source, folder), join(target, folder), { recursive: true });
  const manifest = JSON.parse(await readFile(join(source, "manifest.json"), "utf8"));
  manifest.OS = [{ Platform: "win", MinimumVersion: "10.0" }];
  const description = plugin === "codexmicro"
    ? "Windows experimental integration. Requires a Codex desktop build exposing loopback CDP. Store builds may be incompatible. Setup never closes Codex or installs drivers. See WINDOWS.md."
    : plugin === "codexcli" ? "Windows integration with a dedicated, authenticated Codex app-server. Use the terminal command in WINDOWS.md to share sessions."
      : "Windows integration with Antigravity Desktop. Live controls require its local DevTools endpoint; saved history remains available separately. See WINDOWS.md.";
  manifest.Description = description;
  await writeFile(join(target, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
  for (const locale of locales) {
    const data = JSON.parse(await readFile(join(source, `${locale}.json`), "utf8"));
    data.Description = description;
    await writeFile(join(target, `${locale}.json`), JSON.stringify(data, null, 2) + "\n");
  }
  if (plugin === "codexmicro") await cp(join(root, "src/platform/windows/setup.html"), join(target, "property-inspector/setup.html"));
  else await cp(join(root, "src/shared/inspector-api.js"), join(target, "property-inspector/inspector-api.js"));
  if (plugin === "codexcli") {
    const inspector = join(target, "property-inspector/setup.html");
    const html = await readFile(inspector, "utf8");
    await writeFile(inspector, html.replace(/~\/\.codex\/packages\/standalone\/current\/bin\/codex --remote unix:\/\//g, "npm run windows:terminal (from the repository)")
      .replaceAll("--remote unix://", "the managed Windows endpoint"));
  }
  await build({ absWorkingDir: root, entryPoints: [join(source, "plugin/app.js")], outfile: join(target, "dist/app.js"), bundle: true, format: "cjs", platform: "node", target: "node20" });
  await writeFile(join(target, "dist/package.json"), '{"type":"commonjs"}\n');
  for (const [entry, filename] of [[`src/${bridge}/server.mjs`, runtime], ["src/platform/windows/runner.mjs", "windows-runner.mjs"]]) {
    await build({ absWorkingDir: root, entryPoints: [entry], outfile: join(target, "installer", filename), bundle: true, format: "esm", platform: "node", target: "node20", banner });
  }
  for (const notice of ["LICENSE", "NOTICE.md", "THIRD_PARTY_NOTICES.md"]) await cp(join(root, notice), join(target, "installer", notice));
  if (plugin === "codexmicro") await cp(join(root, "bridge/CodexBridge.png"), join(target, "installer/CodexBridge.png"));
  await cp(join(root, "docs/windows.md"), join(target, "WINDOWS.md"));
  for (const action of manifest.Actions) if (action.PropertyInspectorPath) await access(join(target, action.PropertyInspectorPath));
  console.log(`Built Windows plugin: ${target}`);
}
