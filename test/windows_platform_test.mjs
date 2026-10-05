import './helpers/env.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { platformPaths, childPath } from '../src/platform/paths.mjs';
import { processCommands, focusDesktop, validateDebuggerEndpoint } from '../src/platform/desktop.mjs';
import { protectDirectory } from '../src/platform/windows/privacy.mjs';
import { powershell } from '../src/platform/windows/powershell.mjs';
import { createWindowsInstaller } from '../src/platform/windows/installer.mjs';
import { launchWindowsCodex } from '../src/platform/windows/codex-launcher.mjs';
import { EventEmitter, once } from 'node:events';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

test('macOS routing preserves its original paths and exact process/open commands', async () => {
  const home = join(tmpdir(), 'fixture-home');
  const mac = platformPaths({ platform: 'darwin', home, env: { LOCALAPPDATA: 'ignored', APPDATA: 'ignored' } });
  assert.equal(mac.data, join(home, 'Library/Application Support/OpenCodexMicro'));
  assert.equal(mac.plugins, join(home, 'Library/Application Support/Ulanzi/UlanziDeck/Plugins'));
  assert.equal(mac.antigravityPort, join(home, 'Library/Application Support/Antigravity/DevToolsActivePort'));
  const calls = [], execute = async (...args) => { calls.push(args); return { stdout: 'fixture' }; };
  assert.equal(await processCommands({ platform: 'darwin', execute }), 'fixture');
  await processCommands({ platform: 'darwin', execute, mode: 'aux' });
  await focusDesktop('codex', { platform: 'darwin', execute });
  await focusDesktop('Visual Studio Code', { platform: 'darwin', execute, file: 'a b.md' });
  assert.deepEqual(calls, [
    ['/bin/ps', ['-axo', 'command='], { timeout: 4000 }],
    ['/bin/ps', ['aux'], { timeout: 2000 }],
    ['/usr/bin/open', ['-b', 'com.openai.codex'], { timeout: 3000 }],
    ['/usr/bin/open', ['-a', 'Visual Studio Code', 'a b.md'], { timeout: 3000 }]
  ]);
});

test('Windows uses AppData overrides and refuses path traversal', () => {
  const home = join(tmpdir(), 'fixture-home');
  const win = platformPaths({ platform: 'win32', home, env: {} });
  assert.equal(win.data, join(home, 'AppData/Local/OpenCodexMicro'));
  assert.equal(win.antigravityPort, join(home, 'AppData/Roaming/Antigravity/DevToolsActivePort'));
  assert.throws(() => childPath(home, '..'), /inside/);
  assert.throws(() => childPath(home, '.'), /inside/);
  assert.equal(platformPaths({ platform: 'win32', home, env: { ULANZI_PLUGINS_DIR: 'custom' } }).plugins, 'custom');
});

test('Windows CDP cannot connect to a remote target or a different local port', () => {
  assert.equal(validateDebuggerEndpoint('ws://127.0.0.1:9222/devtools/page/fixture', 9222), 'ws://127.0.0.1:9222/devtools/page/fixture');
  for (const endpoint of ['ws://example.com:9222/devtools/page/x', 'ws://127.0.0.1:9223/devtools/page/x', 'ws://secret@127.0.0.1:9222/devtools/page/x']) assert.throws(() => validateDebuggerEndpoint(endpoint, 9222), /loopback/);
});

async function fixture(t) {
  const home = await mkdtemp(join(tmpdir(), "ulanzi-windows ' $ fixture-"));
  t.after(() => rm(home, { recursive: true, force: true }));
  const payloadRoot = join(home, 'payload');
  await mkdir(payloadRoot);
  for (const file of ['bridge.mjs', 'windows-runner.mjs', 'LICENSE', 'NOTICE.md', 'THIRD_PARTY_NOTICES.md']) await writeFile(join(payloadRoot, file), `fixture ${file}`);
  const calls = [], state = { task: null, failRegister: false, failStart: false };
  const execute = async (program, args, options) => {
    if (args[0] === '--version') return { stdout: 'v22.23.2' };
    assert.equal(program, 'powershell.exe');
    assert.equal(options.windowsHide, true);
    const script = Buffer.from(args.at(-1), 'base64').toString('utf16le');
    calls.push({ script, env: options.env });
    if (script.includes('Export-ScheduledTask')) return { stdout: JSON.stringify(state.task) };
    if (script.includes('Register-ScheduledTask') && state.failRegister) throw new Error('Registration failed');
    if (script.includes('Start-ScheduledTask') && state.failStart) throw new Error('Start response unavailable');
    return { stdout: '' };
  };
  const options = { home, env: {}, component: 'codex', payloadRoot, version: 'test', execute, secure() {} };
  const data = join(platformPaths({ platform: 'win32', home, env: {} }).data, 'codex');
  return { home, data, options, calls, state };
}

test('Windows setup stages a self-contained release and does not start or close applications', async t => {
  const { options, data, calls } = await fixture(t);
  const result = await createWindowsInstaller(options).install();
  assert.equal(result.started, false);
  const metadata = JSON.parse(await readFile(join(data, 'windows-install.json')));
  assert.equal(await readFile(metadata.runtime, 'utf8'), 'fixture bridge.mjs');
  assert.equal(metadata.nodeVersion, 'v22.23.2');
  const registration = calls.find(c => c.script.includes('Register-ScheduledTask'));
  assert.match(registration.script, /-RunLevel Limited/);
  assert.match(registration.script, /-LogonType Interactive/);
  assert.match(registration.env.ULANZI_TASK_ARGUMENTS, /-WindowStyle Hidden/);
  const encoded = registration.env.ULANZI_TASK_ARGUMENTS.split(' ').at(-1);
  const command = Buffer.from(encoded, 'base64').toString('utf16le');
  assert.ok(command.includes(metadata.runner.replaceAll("'", "''")));
  assert.equal(calls.some(c => /Stop-Process|Stop-ScheduledTask|Start-ScheduledTask|bcdedit|RunAs/.test(c.script)), false);
});

test('failed registration preserves previous runtime metadata and sibling data', async t => {
  const { options, data, state } = await fixture(t);
  const installer = createWindowsInstaller(options);
  await installer.install();
  const before = await readFile(join(data, 'windows-install.json'), 'utf8');
  await writeFile(join(data, 'drafts-fixture.json'), 'keep draft');
  state.task = { state: 'Ready', xml: 'previous-task' }; state.failRegister = true;
  await assert.rejects(installer.install(), /Registration failed/);
  assert.deepEqual(JSON.parse(await readFile(join(data, 'windows-install.json'), 'utf8')), JSON.parse(before));
  assert.equal(await readFile(JSON.parse(before).runtime, 'utf8'), 'fixture bridge.mjs');
  assert.equal(await readFile(join(data, 'drafts-fixture.json'), 'utf8'), 'keep draft');
});

test('updating from Studio preserves configured application paths and rendering options', async t => {
  const { options, data } = await fixture(t);
  const configured = { CODEX_APP_EXE: join(data, 'ChatGPT.exe'), CODEX_WINDOWS_OCCLUSION_WORKAROUND: '1' };
  await createWindowsInstaller({ ...options, env: configured }).install();
  await createWindowsInstaller(options).install();
  const metadata = JSON.parse(await readFile(join(data, 'windows-install.json')));
  assert.deepEqual(JSON.parse(await readFile(metadata.configPath)).env, configured);
});

test('running and unmanaged scheduled tasks block installation before mutation', async t => {
  const { options, data, state, calls } = await fixture(t);
  const installer = createWindowsInstaller(options);
  state.task = { state: 'Ready' };
  await assert.rejects(installer.install(), /unmanaged/);
  state.task = null; await installer.install();
  state.task = { state: 'Running' }; calls.length = 0;
  const before = await readFile(join(data, 'windows-install.json'), 'utf8');
  await assert.rejects(installer.install(), /running/);
  assert.equal(await readFile(join(data, 'windows-install.json'), 'utf8'), before);
  assert.equal(calls.some(c => c.script.includes('Register-ScheduledTask')), false);
});

test('an uncertain start preserves the complete installed release and does not retry', async t => {
  const { options, data, state, calls } = await fixture(t);
  state.failStart = true;
  await assert.rejects(createWindowsInstaller(options).install({ start: true }), /Start response unavailable/);
  const metadata = JSON.parse(await readFile(join(data, 'windows-install.json'), 'utf8'));
  assert.equal(await readFile(metadata.runtime, 'utf8'), 'fixture bridge.mjs');
  assert.equal(calls.filter(c => c.script.includes('Start-ScheduledTask')).length, 1);
  assert.equal(calls.some(c => c.script.includes('Unregister-ScheduledTask')), false);
});

test('Windows bridge status distinguishes a healthy service from a disconnected application', async t => {
  const { options } = await fixture(t);
  let healthUrl;
  const installer = createWindowsInstaller({ ...options, bridgeUrl: 'http://127.0.0.1:54321', fetchImpl: async (url, request) => {
    healthUrl = String(url);
    assert.match(request.headers.Authorization, /^Bearer [a-f0-9]{64}$/);
    assert.equal(request.redirect, 'error');
    return { ok: true, json: async () => ({ ok: true, codexConnected: false }) };
  } });
  const status = await installer.status();
  assert.equal(status.installed, false);
  assert.equal(status.serviceOnline, true);
  assert.equal(status.cdpConnected, false);
  assert.equal(healthUrl, 'http://127.0.0.1:54321/health');
});

test('uninstall removes only its runtime and retains drafts and sibling components', async t => {
  const { options, home, data } = await fixture(t);
  const installer = createWindowsInstaller(options);
  await installer.install();
  await writeFile(join(data, 'drafts-test.json'), 'keep');
  const sibling = join(platformPaths({ platform: 'win32', home, env: {} }).data, 'antigravity');
  await mkdir(sibling); await writeFile(join(sibling, 'bridge.mjs'), 'sibling');
  await installer.uninstall();
  assert.equal(await readFile(join(data, 'drafts-test.json'), 'utf8'), 'keep');
  assert.equal(await readFile(join(sibling, 'bridge.mjs'), 'utf8'), 'sibling');
  await assert.rejects(readFile(join(data, 'windows-install.json')), { code: 'ENOENT' });
});

test('Codex launcher never replaces or terminates an existing application', async t => {
  const { home } = await fixture(t);
  const executable = join(home, 'ChatGPT.exe'); await writeFile(executable, 'fixture');
  let spawned = false;
  await assert.rejects(launchWindowsCodex({ env: { CODEX_APP_EXE: executable }, run: async () => ({ stdout: '1' }), spawnImpl() { spawned = true; } }), /already running/);
  assert.equal(spawned, false);
});

test('Windows launcher opens visibly from the app directory; compositor workaround is opt-in', async t => {
  const { home } = await fixture(t);
  const executable = join(home, 'ChatGPT.exe'); await writeFile(executable, 'fixture');
  for (const workaround of [undefined, '1']) {
    let captured;
    await launchWindowsCodex({
      env: { CODEX_APP_EXE: executable, CODEX_WINDOWS_OCCLUSION_WORKAROUND: workaround },
      run: async () => ({ stdout: '0' }),
      spawnImpl(program, args, options) {
        captured = { program, args, options };
        const child = new EventEmitter(); child.unref = () => {};
        queueMicrotask(() => child.emit('spawn')); return child;
      }
    });
    assert.equal(captured.program, executable);
    assert.equal(captured.options.cwd, home);
    assert.equal(captured.options.windowsHide, false);
    assert.equal(captured.args.includes('--disable-features=CalculateNativeWinOcclusion'), workaround === '1');
  }
});

test('Windows runner stop request terminates its real child without stopping a sibling process', { skip: process.platform !== 'win32' }, async t => {
  const { home } = await fixture(t);
  const runtime = join(home, 'fixture-bridge.mjs'), configPath = join(home, 'config.json'), ready = join(home, 'ready.json');
  await writeFile(runtime, `import {writeFileSync} from 'node:fs'; writeFileSync(${JSON.stringify(ready)}, String(process.pid)); setInterval(()=>{}, 1000);`);
  await writeFile(configPath, JSON.stringify({ component: 'codex', runtime, env: { LOCALAPPDATA: home } }));
  const sibling = spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { windowsHide: true, stdio: 'ignore' });
  const runner = spawn(process.execPath, [fileURLToPath(new URL('../src/platform/windows/runner.mjs', import.meta.url)), configPath], { windowsHide: true, stdio: 'ignore' });
  const ended = once(runner, 'exit');
  let bridgePid;
  t.after(() => { sibling.kill(); runner.kill(); if (bridgePid) { try { process.kill(bridgePid); } catch {} } });
  const deadline = Date.now() + 10000;
  while (!bridgePid) {
    try { bridgePid = Number(await readFile(ready, 'utf8')); } catch (e) { if (e.code !== 'ENOENT') throw e; }
    if (Date.now() > deadline) throw new Error('Fixture bridge did not start');
    if (!bridgePid) await new Promise(resolve => setTimeout(resolve, 50));
  }
  await writeFile(`${configPath}.stop`, 'stop');
  assert.deepEqual(await Promise.race([ended, new Promise((_, reject) => { const timer = setTimeout(() => reject(new Error('Runner did not stop')), 5000); timer.unref(); })]), [0, null]);
  assert.throws(() => process.kill(bridgePid, 0), { code: 'ESRCH' });
  bridgePid = null;
  assert.doesNotThrow(() => process.kill(sibling.pid, 0));
});

test('Store launcher uses the matching package identity and never falls back to direct execution', async t => {
  const { home } = await fixture(t);
  const folder = join(home, 'WindowsApps', 'OpenAI.Codex_fixture', 'app');
  await mkdir(folder, { recursive: true });
  const executable = join(folder, 'ChatGPT.exe'); await writeFile(executable, 'fixture');
  const calls = [];
  const run = async (script, options) => {
    calls.push({ script, options });
    if (script.includes('Get-CimInstance')) return { stdout: '0' };
    if (script.includes('Get-AppxPackage')) return { stdout: 'OpenAI.Codex_2p2nqsd0c76g0!App' };
    return { stdout: '' };
  };
  const options = { env: { CODEX_APP_EXE: executable, CODEX_WINDOWS_OCCLUSION_WORKAROUND: '1' }, run, spawnImpl() { assert.fail('Store executable must not be spawned directly'); } };
  await launchWindowsCodex(options);
  assert.equal(calls.at(-1).options.env.ULANZI_CODEX_AUMID, 'OpenAI.Codex_2p2nqsd0c76g0!App');
  assert.match(calls.at(-1).options.env.ULANZI_CODEX_ARGUMENTS, /CalculateNativeWinOcclusion/);
  await assert.rejects(launchWindowsCodex({ ...options, run: async script => {
    if (script.includes('Get-CimInstance')) return { stdout: '0' };
    throw new Error('Package activation unavailable');
  } }), /Package activation unavailable/);
});

test('Windows private directory DACL allows only the current user and is inherited by data', { skip: process.platform !== 'win32' }, async t => {
  const { home } = await fixture(t);
  const directory = join(home, 'private'); await mkdir(directory);
  protectDirectory(directory);
  await writeFile(join(directory, 'token'), 'fixture-not-a-real-token');
  const { stdout } = await powershell(`
$acl = Get-Acl -LiteralPath $env:ULANZI_TEST_PATH
$sid = [System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value
$rules = @($acl.GetAccessRules($true, $true, [System.Security.Principal.SecurityIdentifier]))
[pscustomobject]@{ protected = $acl.AreAccessRulesProtected; others = @($rules | Where-Object { $_.IdentityReference.Value -ne $sid }).Count; user = @($rules | Where-Object { $_.IdentityReference.Value -eq $sid }).Count } | ConvertTo-Json -Compress
`, { env: { ...process.env, ULANZI_TEST_PATH: directory } });
  assert.deepEqual(JSON.parse(stdout), { protected: true, others: 0, user: 1 });
});
