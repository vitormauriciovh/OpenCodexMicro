import { mkdir, rm, writeFile, cp } from "node:fs/promises";
import { build } from "esbuild";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const distDir = path.resolve(__dirname, "dist");
await mkdir(distDir, { recursive: true });

await build({
  bundle: true,
  entryPoints: [path.resolve(__dirname, "plugin/app.js")],
  format: "cjs",
  outfile: path.resolve(distDir, "app.js"),
  platform: "node",
  target: "node20"
});

await writeFile(path.resolve(distDir, "package.json"), '{\n  "type": "commonjs"\n}\n');
await rm(path.resolve(distDir, "licenses"), { recursive: true, force: true });


await (await import("node:fs/promises")).copyFile(path.resolve(__dirname, "../../src/shared/inspector-api.js"), path.resolve(__dirname, "property-inspector/inspector-api.js"));
