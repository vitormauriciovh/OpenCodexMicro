import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { WebSocketServer } from 'ws';
import { CodexCliClient } from '../src/bridge-codex-cli/app-server-client.mjs';

test('CLI speaks uncompressed WebSocket over a Unix socket, including server approval requests', { timeout: 10000 }, async () => {
  const dir = await mkdtemp('/private/tmp/ulanzi-cli-ws-');
  const server = createServer();
  const wss = new WebSocketServer({ noServer: true });
  const messages = [];
  let peer;
  server.on('upgrade', (request, socket, head) => {
    assert.equal(request.headers['sec-websocket-extensions'], undefined, 'Rust control socket rejects compression negotiation');
    wss.handleUpgrade(request, socket, head, ws => wss.emit('connection', ws));
  });
  wss.on('connection', ws => {
    peer = ws;
    ws.on('message', raw => {
      const req = JSON.parse(String(raw)); messages.push(req);
      if (!req.method || req.id === undefined) return;
      const result = req.method === 'thread/list' ? { data: [{ id: 'fixture', name: 'Only test data', status: { type: 'idle' } }] }
        : req.method === 'thread/resume' ? { thread: { id: 'fixture', turns: [], status: { type: 'idle' } }, model: 'fixture-model' }
        : req.method === 'thread/goal/get' ? { goal: null } : {};
      ws.send(JSON.stringify({ id: req.id, result }));
    });
  });
  const socketPath = `${dir}/control.sock`;
  const client = new CodexCliClient({ socketPath });
  try {
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(socketPath, resolve); });
    client.start();
    for (let i = 0; i < 100 && !client.connected; i++) await new Promise(r => setTimeout(r, 10));
    assert.equal(client.connected, true, client.error || 'initialization did not finish');
    assert.equal((await client.snapshot()).lastTask.model, 'fixture-model');
    peer.send(JSON.stringify({ id: 'approval-1', method: 'item/fileChange/requestApproval', params: { threadId: 'fixture' } }));
    for (let i = 0; i < 100 && !client.pendingApprovals.size; i++) await new Promise(r => setTimeout(r, 10));
    await client.approveLatest('fixture');
    for (let i = 0; i < 100 && !messages.some(m => m.id === 'approval-1'); i++) await new Promise(r => setTimeout(r, 10));
    assert.deepEqual(messages.find(m => m.id === 'approval-1'), { id: 'approval-1', result: { decision: 'accept' } });
    peer.terminate();
    for (let i = 0; i < 100 && client.connected; i++) await new Promise(r => setTimeout(r, 10));
    assert.equal(client.connected, false);
  } finally {
    client.stop();
    for (const socket of wss.clients) socket.terminate();
    await new Promise(resolve => wss.close(resolve));
    await new Promise(resolve => server.close(resolve));
    await rm(dir, { recursive: true, force: true });
  }
});
