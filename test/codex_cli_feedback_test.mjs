import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, statSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CodexCliClient } from '../src/bridge-codex-cli/app-server-client.mjs';
import { CliDraftStore } from '../src/bridge-codex-cli/draft-store.mjs';
import { dispatchCliAction } from '../src/bridge-codex-cli/actions.mjs';

function ready(options = {}) {
  const client = new CodexCliClient({ now: () => 10000, ...options });
  client.connected = client.transportConnected = true;
  client.updateThread({ id: 'a', name: 'A', status: { type: 'idle' } });
  client.selectedThreadId = 'a'; client.subscribedThreads.add('a');
  return client;
}

test('slow history reads have a bounded longer deadline without extending or replaying mutations', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const client = ready(), sent = [];
  client.send = async request => { sent.push(request); };
  let historySettled = false;
  const history = client.callRpc('thread/list', { limit: 6 }).then(result => { historySettled = true; return result; });
  const mutation = assert.rejects(client.callRpc('turn/start', { threadId: 'a' }), /RPC timeout: turn\/start/);
  t.mock.timers.tick(8000);
  await mutation;
  assert.equal(historySettled, false);
  t.mock.timers.tick(7000);
  client.handleMessage({ id: sent[0].id, result: { data: [] } });
  assert.deepEqual(await history, { data: [] });
  const bounded = assert.rejects(client.callRpc('thread/list', { limit: 6 }), /RPC timeout: thread\/list/);
  t.mock.timers.tick(30000);
  await bounded;
  assert.equal(sent.length, 3, 'a timeout must not replay either request');
  assert.equal(client.pendingRpc.size, 0);
});

test('attention deduplicates approvals and includes questions and errors across pages', async () => {
  const client = ready(), calls = [];
  client.pendingApprovals.set(1, { id: 1, threadId: 'a' });
  client.pendingApprovals.set(2, { id: 2, threadId: 'a' });
  for (let i = 0; i < 6; i++) client.updateThread({ id: `idle-${i}` });
  client.updateThread({ id: 'question', status: { type: 'active', activeFlags: ['waitingOnUserInput'] } });
  client.updateThread({ id: 'failed', status: { type: 'systemError' } });
  client.updateThread({ id: 'approval-elsewhere', status: { type: 'active', activeFlags: ['waitingOnApproval'] } });
  client.callRpc = async (method, params) => {
    calls.push([method, params]);
    if (method === 'thread/goal/get') return { goal: null };
    return { thread: client.sessions.get(params.threadId) };
  };
  let state = await client.snapshot();
  assert.equal(state.pendingAttentionCount, 4);
  assert.equal(state.pendingApprovalCount, 2);
  assert.equal(state.lastTask.pendingApprovalCount, 2);
  assert.equal(state.monitorTasks.length, 4);
  await client.selectAttention();
  state = await client.snapshot();
  assert.equal(state.selectedThreadId, 'question');
  assert.equal(state.lastTask.attentionReason, 'question');
  assert.equal(state.lastTask.pendingApprovalCount, 0);
  assert.equal(state.lastTask.pendingApprovalId, null);
  assert.equal(state.navigation.offset, 6);
  await client.selectAttention(); assert.equal(client.selectedThreadId, 'failed');
  assert.ok(calls.every(([method]) => ['thread/resume', 'thread/goal/get'].includes(method)));
  client.connected = false;
  state = await client.snapshot();
  assert.equal(state.pendingAttentionCount, 0); assert.equal(state.pendingApprovalCount, 0);
  assert.deepEqual(state.monitorTasks, []);
});

test('task feedback preserves zero context and separates outcomes from idle and active turns', async () => {
  const client = ready();
  client.updateThread({ id: 'a', tokenUsage: { total: { totalTokens: 99000 }, last: { totalTokens: 0 }, modelContextWindow: 1000 } });
  client.updateThread({ id: 'b', tokenUsage: { total: { totalTokens: 99000 } } });
  let state = await client.snapshot();
  assert.equal(state.slots[0].contextPercent, 0); assert.equal(state.slots[1].threadKey, null);
  assert.equal(client.taskSnapshot(client.sessions.get("b")).contextPercent, null);
  const event = (method, turn) => client.handleNotification({ method, params: { threadId: 'a', turn } });
  event('turn/started', { id: 'one' }); event('turn/completed', { id: 'one', status: 'completed' });
  assert.equal((await client.snapshot()).lastTask.status, 'completed');
  event('turn/started', { id: 'two' }); event('turn/completed', { id: 'one', status: 'failed' });
  assert.equal((await client.snapshot()).lastTask.status, 'working', 'stale completion must not replace a newer turn');
  event('turn/completed', { id: 'two', status: 'interrupted' });
  assert.equal((await client.snapshot()).lastTask.status, 'stopped');
  event('turn/started', { id: 'three' }); event('turn/completed', { id: 'three', status: 'failed' });
  state = await client.snapshot();
  assert.equal(state.lastTask.status, 'error'); assert.equal(state.pendingAttentionCount, 1);
  event('turn/started', { id: 'four' });
  assert.equal((await client.snapshot()).pendingAttentionCount, 0);
  client.handleNotification({ method: 'thread/status/changed', params: { threadId: 'a', status: { type: 'notLoaded' } } });
  state = await client.snapshot();
  assert.equal(state.lastTask.status, 'unknown'); assert.equal(state.lastTask.activeTurnId, null);
  assert.equal(state.lastTask.controllable, false);
});

test('monitor selection and stop dispatch keep the displayed identity and expected turn', async () => {
  const client = ready(), calls = [];
  client.updateThread({ id: 'shown' });
  client.callRpc = async (method, params) => { calls.push([method, params]); return method === 'thread/goal/get' ? { goal: null } : { thread: { id: params.threadId } }; };
  await dispatchCliAction(client, 'select', { threadId: 'shown' });
  assert.equal(client.selectedThreadId, 'shown');
  client.turns.set('shown', { id: 'replacement' });
  await assert.rejects(dispatchCliAction(client, 'stop', { threadId: 'shown', expectedTurnId: 'old' }), /displayed turn has changed/);
  assert.equal(calls.some(([method]) => method === 'turn/interrupt'), false);
  await dispatchCliAction(client, 'stop', { threadId: 'shown', expectedTurnId: 'replacement' });
  assert.deepEqual(calls.at(-1), ['turn/interrupt', { threadId: 'shown', turnId: 'replacement' }]);
});

function storage(t) {
  const dir = mkdtempSync(join(tmpdir(), 'ulanzi-cli-drafts-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const file = join(dir, 'private', 'drafts.json');
  return { file, store: new CliDraftStore(file) };
}

test('private drafts survive restart, stay task-bound and clear only after acknowledged delivery', async t => {
  const { file, store } = storage(t);
  const client = ready({ draftStore: store });
  client.updateThread({ id: 'b' });
  client.setDraft('For A', 'a'); client.setDraft('For B', 'b');
  if (process.platform !== 'win32') {
    assert.equal(statSync(file).mode & 0o777, 0o600);
    assert.equal(statSync(join(file, '..')).mode & 0o777, 0o700);
  } // Windows privacy uses DACLs; see windows_platform_test.mjs.
  const restarted = ready({ draftStore: new CliDraftStore(file) });
  assert.equal((await restarted.snapshot()).draft, 'For A');
  restarted.callRpc = async () => ({});
  await restarted.submitDraft('a');
  const next = ready({ draftStore: new CliDraftStore(file) });
  assert.equal(next.drafts.has('a'), false); assert.equal(next.drafts.get('b'), 'For B');
});

test('uncertain delivery survives restart and cannot be replayed without an explicit save', async t => {
  const { file, store } = storage(t), client = ready({ draftStore: store });
  client.setDraft('Possibly sent');
  let sends = 0;
  client.callRpc = async () => { sends++; throw new Error('RPC timeout'); };
  await assert.rejects(client.submitDraft('a'), /timeout/);
  const restarted = ready({ draftStore: new CliDraftStore(file) });
  restarted.callRpc = async () => { sends++; return {}; };
  assert.equal((await restarted.snapshot()).draftDeliveryUncertain, true);
  await assert.rejects(restarted.submitDraft('a'), /may already have been sent/);
  assert.equal(sends, 1);
  restarted.setDraft('Checked conversation; retry'); await restarted.submitDraft('a');
  assert.equal(sends, 2);
});

test('storage failures never send an unprotected draft or re-arm an acknowledged prompt', async t => {
  const { store, file } = storage(t), client = ready({ draftStore: store });
  client.setDraft('Keep me');
  const save = store.save.bind(store); let sends = 0;
  store.save = () => { throw new Error('Disk full'); };
  client.callRpc = async () => { sends++; return {}; };
  await assert.rejects(client.submitDraft('a'), /Disk full/); assert.equal(sends, 0);
  assert.throws(() => client.setDraft('Replacement'), /Disk full/);
  assert.equal(client.drafts.get('a'), 'Keep me');
  store.save = save;
  client.callRpc = async () => { sends++; store.save = () => { throw new Error('Disk full'); }; return {}; };
  await client.submitDraft('a'); assert.equal(sends, 1);
  assert.equal(client.drafts.has('a'), false);
  assert.match((await client.snapshot()).draftStorageError, /Prompt sent/);
  const restarted = ready({ draftStore: new CliDraftStore(file) });
  assert.equal((await restarted.snapshot()).draftDeliveryUncertain, true);
});

test('an in-flight send preserves a newer saved revision, even with the same text', async t => {
  const { store, file } = storage(t), client = ready({ draftStore: store });
  client.setDraft('Same text');
  client.callRpc = async () => { client.setDraft('Same text'); return {}; };
  await client.submitDraft('a');
  const restarted = ready({ draftStore: new CliDraftStore(file) });
  assert.equal((await restarted.snapshot()).draft, 'Same text');
  assert.equal((await restarted.snapshot()).draftDeliveryUncertain, false);
});

test('invalid draft storage is preserved and bounded storage refuses to evict unsent work', t => {
  const { store, file } = storage(t);
  store.save(new Map([['a', 'Original']]), new Set());
  writeFileSync(file, 'invalid JSON');
  const client = ready({ draftStore: store });
  assert.throws(() => client.setDraft('Replacement'), /could not be read/);
  assert.equal(readFileSync(file, 'utf8'), 'invalid JSON');
  const drafts = new Map(Array.from({ length: 101 }, (_, i) => [`task-${i}`, 'Unsent']));
  assert.throws(() => store.save(drafts, new Set()), /100 saved drafts/);
  assert.equal(readFileSync(file, 'utf8'), 'invalid JSON');
});


test('CLI execution duration uses reported start, includes attention and freezes between turns', async () => {
  let now = 10000;
  const client = ready({ now: () => now });
  client.handleNotification({ method: 'turn/started', params: { threadId: 'a', turn: { id: 'one', startedAt: 5 } } });
  assert.equal((await client.snapshot()).lastTask.elapsedSec, 5);
  now = 15000;
  client.handleNotification({ method: 'thread/status/changed', params: { threadId: 'a', status: { type: 'active', activeFlags: ['waitingOnUserInput'] } } });
  assert.equal((await client.snapshot()).lastTask.elapsedSec, 10);
  now = 20000;
  client.handleNotification({ method: 'turn/completed', params: { threadId: 'a', turn: { id: 'one', status: 'completed' } } });
  now = 30000;
  assert.equal((await client.snapshot()).lastTask.elapsedSec, 15);
  client.handleNotification({ method: 'turn/started', params: { threadId: 'a', turn: { id: 'two' } } });
  now = 33000;
  client.handleNotification({ method: 'turn/completed', params: { threadId: 'a', turn: { id: 'two', status: 'interrupted' } } });
  now = 40000;
  assert.equal((await client.snapshot()).lastTask.elapsedSec, 3);
});


test('async questions require attention without approvals and clear on user input without relatching', async () => {
  const client = ready();
  const event = (method, item, threadId = 'a', turnId = 'turn') => client.handleNotification({ method, params: { threadId, turnId, item } });
  client.handleNotification({ method: 'turn/started', params: { threadId: 'a', turn: { id: 'turn' } } });
  const question = { type: 'agentMessage', id: 'q1', delivery: 'async', questions: [{ title: 'Which color?' }] };
  event('item/completed', { type: 'agentMessage', id: 'plain', text: 'A question?' });
  assert.equal((await client.snapshot()).lastTask.status, 'working');
  event('item/completed', question, 'other');
  event('item/completed', question, 'a', 'old-turn');
  assert.equal((await client.snapshot()).lastTask.status, 'working');
  event('item/started', question);
  let state = await client.snapshot();
  assert.equal(state.lastTask.status, 'attention');
  assert.equal(state.lastTask.attentionReason, 'question');
  assert.equal(state.pendingAttentionCount, 1);
  assert.equal(state.pendingApprovalCount, 0);
  assert.equal(state.capabilities.queue, false);
  event('item/started', { type: 'userMessage', id: 'answer' });
  event('item/completed', question);
  assert.equal((await client.snapshot()).lastTask.status, 'working');
  event('item/completed', { ...question, id: 'q2' });
  event('item/completed', { type: 'userMessage', id: 'answer' });
  assert.equal((await client.snapshot()).lastTask.status, 'attention', 'duplicate user event must not clear a newer question');
  event('item/completed', { type: 'userMessage', id: 'answer2' });
  assert.equal((await client.snapshot()).lastTask.status, 'working');
});
