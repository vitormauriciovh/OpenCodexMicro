import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { powershell, exec } from "../src/platform/windows/powershell.mjs";
import { closeWindowsCodex } from "../src/platform/windows/codex-open.mjs";

test("GUI shortcut launches a controlled script with spaced paths and records its actual result", { skip: process.platform !== "win32", timeout: 30000 }, async t => {
  const fixture = await mkdtemp(join(tmpdir(), "ulanzi-shortcut-"));
  t.after(() => rm(fixture, { recursive: true, force: true }));
  const scriptRoot = join(fixture, "repository with spaces");
  await mkdir(scriptRoot);
  const executable = join(fixture, "CodexUlanziLauncher.exe");
  await powershell(`
Add-Type -TypeDefinition ([IO.File]::ReadAllText($env:SHORTCUT_SOURCE)) -OutputAssembly $env:SHORTCUT_EXE -OutputType WindowsApplication -ReferencedAssemblies System.dll,System.Core.dll,System.Windows.Forms.dll
`, { env: { ...process.env, SHORTCUT_SOURCE: fileURLToPath(new URL("../src/platform/windows/shortcut-launcher.cs", import.meta.url)), SHORTCUT_EXE: executable }, timeout: 30000 });
  const bytes = await readFile(executable);
  assert.equal(bytes.readUInt16LE(bytes.readInt32LE(0x3c) + 92), 2, "The shortcut executable must use the GUI subsystem");
  const marker = join(fixture, "invocation.json");
  const script = join(scriptRoot, "fixture.mjs");
  await writeFile(script, `import {writeFileSync} from 'node:fs'; writeFileSync(process.env.SHORTCUT_MARKER, JSON.stringify(process.argv.slice(2))); console.log('Controlled opening completed');`);
  for (const flags of [[], ["--restart"], ["--force-restart"]]) {
    const child = spawn(executable, [process.execPath, script, ...flags], { env: { ...process.env, LOCALAPPDATA: fixture, SHORTCUT_MARKER: marker }, windowsHide: true });
    t.after(() => { if (child.exitCode === null) child.kill(); });
    assert.deepEqual(await once(child, "exit"), [0, null]);
    assert.deepEqual(JSON.parse(await readFile(marker, "utf8")), ["open", "codex", ...flags]);
    const log = await readFile(join(fixture, "OpenCodexMicro/codex/shortcut-launch.log"), "utf8");
    assert.match(log, /Exit code: 0/);
    assert.match(log, /Controlled opening completed/);
  }
  await rm(marker);
  await writeFile(script, `import {appendFileSync} from 'node:fs'; appendFileSync(process.env.SHORTCUT_MARKER, 'run\\n'); await new Promise(resolve=>setTimeout(resolve,3000));`);
  const options = { env: { ...process.env, LOCALAPPDATA: fixture, SHORTCUT_MARKER: marker }, windowsHide: true };
  const first = spawn(executable, [process.execPath, script, "--restart"], options);
  const firstExited = once(first, "exit");
  t.after(() => { if (first.exitCode === null) first.kill(); });
  for (let i = 0; ; i++) {
    try { await readFile(marker); break; } catch (error) { if (error.code !== "ENOENT") throw error; }
    if (i > 100) throw new Error("First shortcut invocation did not start");
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  const duplicate = spawn(executable, [process.execPath, script, "--restart"], options);
  assert.deepEqual(await once(duplicate, "exit"), [0, null]);
  assert.deepEqual(await firstExited, [0, null]);
  assert.equal(await readFile(marker, "utf8"), "run\n", "Repeated clicks must not start a second operation");
});

test("shortcut close works in 32/64 bits and authorized termination preserves a different child executable", { skip: process.platform !== "win32", timeout: 45000 }, async t => {
  const fixture = await mkdtemp(join(tmpdir(), "ulanzi-close-"));
  let child, siblingPid;
  t.after(async () => {
    if (child && child.exitCode === null) {
      const ended = once(child, "exit"); child.kill(); await ended;
    }
    if (siblingPid) { try { process.kill(siblingPid); } catch {} }
    await rm(fixture, { recursive: true, force: true });
  });
  const executable = join(fixture, "ControlledWindow.exe"), ready = join(fixture, "ready");
  await powershell(`
Add-Type -OutputAssembly $env:SHORTCUT_EXE -OutputType WindowsApplication -ReferencedAssemblies System.dll,System.Windows.Forms.dll -TypeDefinition @'
using System;
using System.IO;
using System.Diagnostics;
using System.Windows.Forms;
class ControlledWindow {
  [STAThread] static void Main() {
    var form = new Form(); form.Opacity = 0;
    form.FormClosing += delegate(object sender, FormClosingEventArgs e) {
      if (Environment.GetEnvironmentVariable("SHORTCUT_KEEP_RUNNING") == "1") {
        e.Cancel = true; form.Hide();
        File.WriteAllText(Environment.GetEnvironmentVariable("SHORTCUT_READY") + ".closed", "closed");
      }
    };
    string node = Environment.GetEnvironmentVariable("SHORTCUT_NODE");
    if (!String.IsNullOrEmpty(node)) {
      var info = new ProcessStartInfo(node, ((char)34) + Environment.GetEnvironmentVariable("SHORTCUT_SIBLING_SCRIPT") + ((char)34));
      info.UseShellExecute = false; info.CreateNoWindow = true; Process.Start(info);
    }
    form.Shown += delegate { File.WriteAllText(Environment.GetEnvironmentVariable("SHORTCUT_READY"), "ready"); };
    Application.Run(form);
  }
}
'@
`, { env: { ...process.env, SHORTCUT_EXE: executable }, timeout: 30000 });
  // A transparent GUI window must be visible to Windows enumeration, even
  // though no content is painted. STARTF_USESHOWWINDOW would hide its handle.
  const siblingMarker = join(fixture, "sibling-pid"), siblingScript = join(fixture, "sibling.mjs");
  await writeFile(siblingScript, `import {writeFileSync} from 'node:fs'; writeFileSync(process.env.SHORTCUT_SIBLING_MARKER,String(process.pid)); setInterval(()=>{},1000);`);
  for (const mode of ["native", "32-bit", "force-resident"]) {
    await rm(ready, { force: true });
    const force = mode === "force-resident";
    child = spawn(executable, [], { env: { ...process.env, SHORTCUT_READY: ready,
      ...(force ? { SHORTCUT_KEEP_RUNNING: "1", SHORTCUT_NODE: process.execPath, SHORTCUT_SIBLING_SCRIPT: siblingScript, SHORTCUT_SIBLING_MARKER: siblingMarker } : {}) }, windowsHide: false });
    const exited = once(child, "exit");
    const deadline = Date.now() + 8000;
    while (true) {
      try { await readFile(ready); break; } catch (error) { if (error.code !== "ENOENT") throw error; }
      if (Date.now() > deadline) throw new Error("Controlled application did not become ready");
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    if (force) {
      while (!siblingPid) {
        try { siblingPid = Number(await readFile(siblingMarker, "utf8")); } catch (error) { if (error.code !== "ENOENT") throw error; }
        if (Date.now() > deadline) throw new Error("Controlled app-server child did not start");
        if (!siblingPid) await new Promise(resolve => setTimeout(resolve, 50));
      }
    }
    const run = mode === "native" ? powershell : (script, options) => powershell(script, { ...options,
      execute: (_program, args, execOptions) => exec(join(process.env.WINDIR, "SysWOW64/WindowsPowerShell/v1.0/powershell.exe"), args, execOptions) });
    const result = await closeWindowsCodex({ env: { ...process.env, CODEX_APP_EXE: executable }, run, force });
    const [code, signal] = await exited;
    assert.equal(signal, null);
    assert.equal(result.forced, force);
    if (force) {
      assert.notEqual(code, 0);
      assert.equal(await readFile(ready + ".closed", "utf8"), "closed", "Normal close must be attempted first");
      assert.doesNotThrow(() => process.kill(siblingPid, 0), "A child with a different executable must remain alive");
    } else assert.equal(code, 0, mode);
  }
});
