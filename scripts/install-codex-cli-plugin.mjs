import { fileURLToPath } from "node:url";
import { installPlugin } from "../src/shared/plugin-installer.mjs";
const source = fileURLToPath(new URL("../integration/com.ulanzi.codexcli.ulanziPlugin", import.meta.url));
const destination = await installPlugin(source, "codexcli", { build: process.env.ULANZI_PREBUILT !== "1" });
console.log(`Ulanzi Studio plugin installed at: ${destination}`);
console.log("Restart Ulanzi Studio to load the plugin.");
