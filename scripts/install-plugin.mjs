import { fileURLToPath } from "node:url";
import { installPlugin } from "../src/shared/plugin-installer.mjs";
const source = fileURLToPath(new URL("../integration/com.ulanzi.codexmicro.ulanziPlugin", import.meta.url));
const destination = await installPlugin(source, "codexmicro", { build: process.env.ULANZI_PREBUILT !== "1" });
console.log(`Ulanzi Studio plugin installed at: ${destination}`);
console.log("Restart Ulanzi Studio to load the plugin.");
