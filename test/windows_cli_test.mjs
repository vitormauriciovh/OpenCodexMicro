import './helpers/env.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { WebSocketServer } from 'ws';
import { CodexCliClient } from '../src/bridge-codex-cli/app-server-client.mjs';
import { validateCliUrl } from '../src/platform/cli-transport.mjs';
import { localHeaders } from '../src/shared/local-api.mjs';

test('Windows CLI rejects non-loopback, credential-bearing and redirected endpoint forms', () => {
  for (const url of ['ws://example.com:17377', 'ws://0.0.0.0:17377', 'ws://127.0.0.1:17377/?token=abc', 'ws://secret@127.0.0.1:17377', 'http://127.0.0.1:17377']) assert.throws(() => validateCliUrl(url));
  assert.equal(validateCliUrl('ws://127.0.0.1:17377'), 'ws://127.0.0.1:17377/');
});

test('Windows CLI authenticates its WebSocket, receives selected-task approvals and disconnects safely', { timeout: 15000 }, async () => {
  const server = createServer(), wss = new WebSocketServer({ noServer: true });
  let peer; const messages = [];
  const auth = localHeaders('codex-cli-server');
  server.on('upgrade', (request, socket, head) => {
    assert.equal(request.headers.authorization, auth.Authorization);
    assert.equal(request.headers['sec-websocket-extensions'], undefined);
    wss.handleUpgrade(request, socket, head, ws => wss.emit('connection', ws));
  });
  wss.on('connection', ws => {
    peer = ws;
    ws.on('message', raw => {
      const request = JSON.parse(String(raw)); messages.push(request);
      if (!request.method || request.id === undefined) return;
      const result = request.method === 'thread/list' ? { data: [{ id: 'fixture', name: 'Test task', status: { type: 'idle' } }] }
        : request.method === 'thread/loaded/list' ? { data: [] }
        : request.method === 'thread/resume' ? { thread: { id: 'fixture', turns: [], status: { type: 'idle' } }, model: 'fixture-model' }
        : request.method === 'thread/goal/get' ? { goal: null } : {};
      ws.send(JSON.stringify({ id: request.id, result }));
    });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const client = new CodexCliClient({ platform: 'win32', endpoint: `ws://127.0.0.1:${server.address().port}` });
  const until = async predicate => { for (let i = 0; i < 200 && !predicate(); i++) await new Promise(resolve => setTimeout(resolve, 10)); assert.ok(predicate(), client.error || 'Timed out'); };
  try {
    client.start(); await until(() => client.connected);
    assert.equal((await client.snapshot()).lastTask.model, 'fixture-model');
    peer.send(JSON.stringify({ id: 'approval', method: 'item/fileChange/requestApproval', params: { threadId: 'fixture' } }));
    await until(() => client.pendingApprovals.size === 1);
    await client.approveLatest('fixture');
    await until(() => messages.some(message => message.id === 'approval'));
    assert.deepEqual(messages.find(message => message.id === 'approval'), { id: 'approval', result: { decision: 'accept' } });
    peer.terminate(); await until(() => !client.connected);
    assert.equal(client.pendingApprovals.size, 0);
  } finally {
    client.stop(); for (const socket of wss.clients) socket.terminate();
    await new Promise(resolve => wss.close(resolve)); await new Promise(resolve => server.close(resolve));
  }
});
