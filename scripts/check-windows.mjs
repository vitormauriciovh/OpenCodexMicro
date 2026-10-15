import assert from "node:assert/strict";
import { readFile, access } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
const root = fileURLToPath(new URL("../", import.meta.url));
for (const file of ["scripts/windows.mjs", "scripts/build-windows.mjs", "scripts/smoke-windows.mjs"]) {
  execFileSync(process.execPath, ["--check", join(root, file)], { stdio: "inherit" });
}
for (const name of ["codexmicro", "antigravity", "codexcli"]) {
  const original = join(root, "integration", `com.ulanzi.${name}.ulanziPlugin`);
  const output = join(root, "dist/windows", `com.ulanzi.${name}.ulanziPlugin`);
  const source = JSON.parse(await readFile(join(original, "manifest.json")));
  const manifest = JSON.parse(await readFile(join(output, "manifest.json")));
  assert.deepEqual(source.OS, [{ Platform: "mac", MinimumVersion: "13.0" }]);
  assert.deepEqual(manifest.OS, [{ Platform: "win", MinimumVersion: "10.0" }]);
  assert.equal(manifest.UUID, source.UUID);
  assert.deepEqual(manifest.Actions, source.Actions);
  await access(join(output, manifest.CodePath));
  execFileSync(process.execPath, ["--check", join(output, manifest.CodePath)], { stdio: "inherit" });
  const html = await readFile(join(output, "property-inspector/setup.html"), "utf8");
  for (const match of html.matchAll(/<script>([\s\S]*?)<\/script>/g)) new Function(match[1]);
  for (const locale of ["en", "zh_CN", "zh_HK", "ja_JP", "de_DE", "ko_KR", "pt_PT", "es_ES"]) assert.ok(JSON.parse(await readFile(join(output, `${locale}.json`))).Description);
}
console.log("Windows packages validated; macOS manifests and action identities preserved.");
