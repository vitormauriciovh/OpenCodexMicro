import '../test/helpers/env.mjs';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { WebSocketServer } from 'ws';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { localHeaders } from '../src/shared/local-api.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
for (const [name, component, variable] of [['codexmicro', 'codex', 'CODEX_BRIDGE_URL'], ['antigravity', 'antigravity', 'ANTIGRAVITY_BRIDGE_URL'], ['codexcli', 'codex-cli', 'CODEX_CLI_BRIDGE_URL']]) {
  const calls = [], messages = [], authorization = localHeaders(component).Authorization;
  const state = { connected: true, daemonConnected: true, applicationConnected: true, slots: [], activeTasks: [], capabilities: {}, usage: { windows: [] }, updatedAt: Date.now() };
  const bridge = createServer((request, response) => {
    calls.push({ url: request.url, auth: request.headers.authorization });
    response.setHeader('Content-Type', 'application/json');
    response.end(JSON.stringify(request.url === '/state' ? state : { ok: true, ...state }));
  });
  bridge.on('upgrade', (_request, socket) => socket.destroy());
  await new Promise(resolve => bridge.listen(0, '127.0.0.1', resolve));
  const host = new WebSocketServer({ host: '127.0.0.1', port: 0 });
  await new Promise(resolve => host.once('listening', resolve));
  let stderr = '';
  const child = spawn(process.execPath, ['dist/app.js', '127.0.0.1', String(host.address().port), 'en-US', '3.0.0'], {
    cwd: join(root, 'dist/windows', `com.ulanzi.${name}.ulanziPlugin`),
    env: { ...process.env, [variable]: `http://127.0.0.1:${bridge.address().port}` }, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true
  });
  child.stderr.on('data', bytes => { stderr += bytes; });
  const until = async predicate => { for (let i = 0; i < 200 && !predicate(); i++) await new Promise(resolve => setTimeout(resolve, 25)); assert.ok(predicate(), stderr || `${name}: expected plugin event missing`); };
  let peer;
  host.on('connection', ws => { peer = ws; ws.on('message', raw => messages.push(JSON.parse(String(raw)))); });
  try {
    await until(() => messages.some(message => message.cmd === 'connected'));
    const uuid = `com.ulanzi.ulanzistudio.${name}.task1`;
    peer.send(JSON.stringify({ cmd: 'add', uuid, actionid: 'fixture', key: '0_0', param: {} }));
    await until(() => calls.some(call => call.url === '/state') && messages.some(message => message.cmd === 'state'));
    if (name === 'codexmicro') {
      // Exercise the distributed Windows bundle: source-only tests cannot catch
      // an old package that resets its live image to the manifest placeholder.
      const usageUuid = `com.ulanzi.ulanzistudio.${name}.usageweekly`;
      peer.send(JSON.stringify({ cmd: 'add', uuid: usageUuid, actionid: 'usage-fixture', key: '0_1', param: {} }));
      await until(() => messages.some(message => message.param?.statelist?.some(item => item.uuid === usageUuid)));
      for (const action of [uuid, usageUuid]) {
        const batches = messages.filter(message => message.cmd === 'state' && message.param?.statelist?.some(item => item.uuid === action));
        assert.ok(batches.length > 0, `${action}: expected a rendered card`);
        for (const batch of batches) {
          const updates = batch.param.statelist.filter(item => item.uuid === action);
          const displayed = updates.at(-1);
          assert.equal(displayed.type, 1, 'A manifest reset must not overwrite the live Windows card');
          assert.match(displayed.data, /^data:image\/svg\+xml;base64,/);
          assert.equal(displayed.showtext, false);
          assert.equal(displayed.textData, '', 'Studio requires the case-sensitive textData field');
          assert.ok(updates.every(item => !Object.hasOwn(item, 'textdata')));
        }
      }
    }
    assert.ok(calls.every(call => call.auth === authorization), 'Every local request must be authenticated');
    assert.equal(child.exitCode, null);
    console.log(`Windows ${name} bundle starts, authenticates and renders through a fixture Ulanzi host.`);
  } finally {
    if (child.exitCode === null && child.signalCode === null) { const exited = new Promise(resolve => child.once('exit', resolve)); child.kill(); await exited; }
    for (const ws of host.clients) ws.terminate();
    await new Promise(resolve => host.close(resolve));
    await new Promise(resolve => bridge.close(resolve));
  }
}
