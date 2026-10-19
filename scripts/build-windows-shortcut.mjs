import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { powershell } from "../src/platform/windows/powershell.mjs";

if (process.platform !== "win32") throw new Error("The GUI shortcut launcher builds only on Windows");
const root = new URL("../", import.meta.url);
const output = fileURLToPath(new URL("dist/windows/CodexUlanziLauncher.exe", root));
await mkdir(fileURLToPath(new URL("dist/windows/", root)), { recursive: true });
await powershell(`
$source = [IO.File]::ReadAllText($env:ULANZI_SHORTCUT_SOURCE)
if (Test-Path -LiteralPath $env:ULANZI_SHORTCUT_OUTPUT) { Remove-Item -LiteralPath $env:ULANZI_SHORTCUT_OUTPUT -Force }
Add-Type -TypeDefinition $source -OutputAssembly $env:ULANZI_SHORTCUT_OUTPUT -OutputType WindowsApplication -ReferencedAssemblies System.dll,System.Core.dll,System.Windows.Forms.dll
`, { env: { ...process.env, ULANZI_SHORTCUT_SOURCE: fileURLToPath(new URL("src/platform/windows/shortcut-launcher.cs", root)), ULANZI_SHORTCUT_OUTPUT: output }, timeout: 30000 });
console.log(`Built GUI shortcut launcher: ${output}`);
