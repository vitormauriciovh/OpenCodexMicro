import { execFile } from "node:child_process";
import { promisify } from "node:util";

export const exec = promisify(execFile);
export const psArgs = script => ["-NoProfile", "-NonInteractive", "-EncodedCommand", Buffer.from(script, "utf16le").toString("base64")];
export function powershell(script, { execute = exec, env = process.env, timeout = 10000 } = {}) {
  return execute("powershell.exe", psArgs("$ErrorActionPreference = 'Stop'\n" + script), {
    env, timeout, windowsHide: true, maxBuffer: 4 * 1024 * 1024
  });
}
