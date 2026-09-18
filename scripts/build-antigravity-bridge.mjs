import { mkdir } from "node:fs/promises";
import { build } from "esbuild";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, "..");
const srcDir = path.join(root, "src/bridge-antigravity");
const distDir = path.join(root, "dist");
const outFile = path.join(distDir, "bridge-antigravity.mjs");

async function main() {
  await mkdir(distDir, { recursive: true });
  await build({
    bundle: true,
    entryPoints: [path.join(srcDir, "server.mjs")],
    format: "esm",
    outfile: outFile,
    platform: "node",
    target: "node20",
    minify: false,
    banner: {
      js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);"
    }
  });
  console.log(`Built Antigravity bridge: ${outFile}`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
