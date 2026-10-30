import test from "node:test";
import assert from "node:assert/strict";
import { openWindowsCodex, codexOpenErrorMessage } from "../src/platform/windows/codex-open.mjs";

test("combined Codex opening starts the bridge before launching the app", async () => {
  const calls = [], env = { CODEX_APP_EXE: "C:\\Codex\\ChatGPT.exe" };
  const result = await openWindowsCodex({ env,
    startBridge: async () => calls.push("bridge"),
    run: async (_script, options) => { assert.equal(options.env, env); calls.push("check"); return { stdout: "0" }; },
    launch: async options => { assert.equal(options.env, env); calls.push("launch"); },
    focus: async () => assert.fail("No running app to focus")
  });
  assert.deepEqual(calls, ["bridge", "check", "launch"]);
  assert.equal(result.alreadyRunning, false);
});

test("combined opening focuses an existing Codex without restarting or duplicating it", async () => {
  const calls = [];
  const result = await openWindowsCodex({
    env: { CODEX_APP_EXE: "C:\\Codex\\ChatGPT.exe" },
    startBridge: async () => calls.push("bridge"),
    run: async () => ({ stdout: "3" }),
    launch: async () => assert.fail("An existing Codex must not be relaunched"),
    focus: async app => calls.push(app)
  });
  assert.deepEqual(calls, ["bridge", "codex"]);
  assert.equal(result.alreadyRunning, true);
});

test("a bridge start failure prevents app launch and is not retried", async () => {
  let attempts = 0;
  await assert.rejects(openWindowsCodex({
    env: { CODEX_APP_EXE: "C:\\Codex\\ChatGPT.exe" },
    startBridge: async () => { attempts++; throw new Error("Bridge start failed"); },
    run: async () => assert.fail("Do not proceed after a failed start"),
    launch: async () => assert.fail("Do not launch after a failed start")
  }), /Bridge start failed/);
  assert.equal(attempts, 1);
});

test("ambiguous process results never launch another Codex", async () => {
  await assert.rejects(openWindowsCodex({
    env: { CODEX_APP_EXE: "C:\\Codex\\ChatGPT.exe" },
    startBridge: async () => {},
    run: async () => ({ stdout: "unknown" }),
    launch: async () => assert.fail("Do not launch when process state is unknown")
  }), /Cannot determine/);
});

test("explicit restart closes first, starts the bridge and launches exactly once", async () => {
  const calls = [];
  const result = await openWindowsCodex({
    env: { CODEX_APP_EXE: "C:\\Codex\\ChatGPT.exe" }, restart: true,
    run: async () => ({ stdout: "3" }),
    close: async () => calls.push("close"),
    startBridge: async () => calls.push("bridge"),
    launch: async () => calls.push("launch"),
    focus: async () => assert.fail("Restart should not just focus the app")
  });
  assert.deepEqual(calls, ["close", "bridge", "launch"]);
  assert.equal(result.restarted, true);
});

test("an incomplete close prevents restart and never forces or retries", async () => {
  let closes = 0;
  await assert.rejects(openWindowsCodex({
    env: { CODEX_APP_EXE: "C:\\Codex\\ChatGPT.exe" }, restart: true,
    run: async () => ({ stdout: "1" }),
    close: async () => { closes++; throw new Error("Codex is still running"); },
    startBridge: async () => assert.fail("Do not proceed after an incomplete close"),
    launch: async () => assert.fail("Do not relaunch after an incomplete close")
  }), /still running/);
  assert.equal(closes, 1);
});

test("shortcut errors show the PowerShell error text without encoded commands or XML", () => {
  assert.equal(codexOpenErrorMessage({ message: "Command failed: powershell.exe -EncodedCommand ABC", stderr: '#< CLIXML\n<Objs><S S="Error">Codex &amp; janela_x000D__x000A_</S><S S="Error">At line:4</S></Objs>' }), "Codex & janela");
  assert.match(codexOpenErrorMessage({ killed: true }), /Nenhuma nova tentativa/);
});

test("process termination is passed only through an explicit restart option", async () => {
  await assert.rejects(openWindowsCodex({ env: { CODEX_APP_EXE: "fixture" }, force: true }), /explicitamente autorizado/);
  const calls = [];
  const result = await openWindowsCodex({
    env: { CODEX_APP_EXE: "fixture" }, restart: true, force: true,
    run: async () => ({ stdout: "1" }),
    close: async options => { assert.equal(options.force, true); calls.push("close"); return { forced: true }; },
    startBridge: async () => calls.push("bridge"), launch: async () => calls.push("launch")
  });
  assert.deepEqual(calls, ["close", "bridge", "launch"]);
  assert.equal(result.forced, true);
});
