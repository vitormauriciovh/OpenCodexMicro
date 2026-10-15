import { spawn } from "node:child_process";
import { readFile, mkdir, open, rm, access } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { platformPaths } from "../paths.mjs";
import { localHeaders } from "../../shared/local-api.mjs";
import { WINDOWS_CLI_URL } from "../cli-transport.mjs";

if (process.platform !== "win32") throw new Error("This launcher is for Windows only");
const config = JSON.parse(await readFile(process.argv[2], "utf8"));
const stopFile = `${process.argv[2]}.stop`;
await rm(stopFile, { force: true });
Object.assign(process.env, config.env);
const root = join(platformPaths().data, config.component);
await mkdir(root, { recursive: true });
const log = await open(join(root, "windows-bridge.log"), "a");
const children = new Set();
let stopping = false;
function shutdown(code) {
  if (stopping) return;
  stopping = true;
  for (const child of children) child.kill();
  setTimeout(() => process.exit(code), 250).unref();
}
function start(executable, args, env = process.env) {
  const child = spawn(executable, args, { env, windowsHide: true, stdio: ["ignore", log.fd, log.fd] });
  children.add(child);
  child.on("error", error => { console.error(error.message); shutdown(1); });
  child.on("exit", code => { children.delete(child); shutdown(code || 1); });
  return child;
}
if (config.component === "codex-cli") {
  // A dedicated, authenticated server. Never attach to or terminate another CLI process.
  localHeaders("codex-cli-server");
  const tokenFile = join(process.env.ULANZI_AUTH_DIR || join(homedir(), ".local/share/ulanzi-bridges"), "codex-cli-server.token");
  start(config.cliExecutable, ["app-server", "--listen", WINDOWS_CLI_URL, "--ws-auth", "capability-token", "--ws-token-file", tokenFile]);
}
start(process.execPath, [config.runtime], { ...process.env, CODEX_APP_SERVER_URL: WINDOWS_CLI_URL });
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => shutdown(0));
// Task Scheduler can terminate the PowerShell parent without delivering a
// signal to Node. A per-release request lets this runner stop its own children.
const stopPoll = setInterval(async () => {
  try { await access(stopFile); clearInterval(stopPoll); shutdown(0); }
  catch (error) { if (error.code !== "ENOENT") shutdown(1); }
}, 250);
stopPoll.unref();
