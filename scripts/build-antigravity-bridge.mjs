import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, "..");
const srcDir = path.join(root, "src/bridge-antigravity");
const distDir = path.join(root, "dist");
const outFile = path.join(distDir, "bridge-antigravity.mjs");

async function main() {
  await fs.mkdir(distDir, { recursive: true });
  const stateReaderSrc = await fs.readFile(path.join(srcDir, "state-reader.mjs"), "utf-8");
  const serverSrc = await fs.readFile(path.join(srcDir, "server.mjs"), "utf-8");

  // Remove import from serverSrc
  const cleanedServerSrc = serverSrc.replace(
    /import\s+\{\s*AntigravityStateReader\s*\}\s+from\s+["']\.\/state-reader\.mjs["'];?/,
    ""
  );

  const bundled = `${stateReaderSrc}\n\n${cleanedServerSrc}`;
  await fs.writeFile(outFile, bundled, "utf-8");
  console.log(`Built Antigravity bridge: ${outFile}`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});

