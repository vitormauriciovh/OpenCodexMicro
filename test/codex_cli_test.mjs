import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { CodexCliClient } from "../src/bridge-codex-cli/app-server-client.mjs";
function ready() {
  const client = new CodexCliClient({ now: () => 10000 });
  client.connected = client.transportConnected = true;
  client.selectedThreadId = "thread-a";
  client.subscribedThreads.add("thread-a");
  client.updateThread({ id: "thread-a", name: "Fixture", status: { type: "idle" } });
  return client;
}
test("snapshot never reads personal history or infers tokens", async () => {
  const client = new CodexCliClient({ codexHome: "/not-used" });
  const state = await client.snapshot();
  assert.equal(state.connected, false); assert.equal(state.activeTasks.length, 0); assert.equal(state.tokenUsage, null);
});
test("initialization precedes thread enumeration and consumes responses", async () => {
  class Socket extends EventEmitter {
    readyState = 1;
    writes = [];
    send(raw, callback) {
      const request = JSON.parse(raw); this.writes.push(request); callback();
      if (request.id) {
        const result = request.method === "thread/list" ? { data: [{ id: "a", name: "A", status: { type: "idle" } }] } : request.method === "thread/resume" ? { thread: { id: "a", name: "A", turns: [], status: { type: "idle" } } } : {};
        queueMicrotask(() => this.emit("message", Buffer.from(JSON.stringify({ id: request.id, result }))));
      }
    }
    terminate() { this.readyState = 3; }
  }
  const socket = new Socket();
  const client = new CodexCliClient({ createConnection: () => socket });
  client.start(); socket.emit("open");
  for (let i = 0; i < 20 && !client.connected; i++) await new Promise(resolve => setImmediate(resolve));
  assert.equal(client.connected, true);
  assert.deepEqual(socket.writes.map(m => m.method), ["initialize", "initialized", "thread/list", "thread/resume", "account/rateLimits/read", "thread/goal/get"]);
  assert.deepEqual(socket.writes.find(m => m.method === "thread/list").params.sourceKinds, ["cli", "appServer"]);
  assert.equal((await client.snapshot()).slots[0].title, "A"); client.stop();
});
test("current protocol updates per-thread turns, tokens, and completion", async () => {
  const client = ready();
  client.handleNotification({ method: "turn/started", params: { threadId: "thread-a", turn: { id: "turn-1", status: "inProgress" } } });
  assert.equal(client.turns.get("thread-a").id, "turn-1");
  client.handleNotification({ method: "thread/tokenUsage/updated", params: { threadId: "thread-a", tokenUsage: { total: { totalTokens: 5, inputTokens: 0, outputTokens: 5 } } } });
  assert.equal((await client.snapshot()).tokenUsage.inputTokens, 0);
  client.handleNotification({ method: "turn/completed", params: { threadId: "thread-a", turn: { id: "turn-1", status: "completed" } } });
  assert.equal((await client.snapshot()).agentStatus, "IDLE");
});
test("approval responses preserve schema and only act on selected thread", async () => {
  const client = ready(), sent = [];
  client.send = async message => sent.push(message);
  for (const [method, approved, expected] of [
    ["item/commandExecution/requestApproval", false, { decision: "decline" }],
    ["item/fileChange/requestApproval", true, { decision: "accept" }],
    ["item/permissions/requestApproval", true, { permissions: { network: { enabled: true } }, scope: "turn" }],
    ["execCommandApproval", false, { decision: "abort" }],
    ["applyPatchApproval", true, { decision: "approved" }]
  ]) {
    client.handleServerRequest({ id: 1, method, params: { threadId: "thread-a", permissions: { network: { enabled: true } } } });
    await client.respondApproval(approved);
    assert.deepEqual(sent.at(-1).result, expected);
  }
  client.handleServerRequest({ id: 2, method: "item/fileChange/requestApproval", params: { threadId: "other" } });
  await assert.rejects(client.approveLatest(), /No approval/);
  assert.equal(client.pendingApprovals.size, 1);
});
test("disconnected or failed delivery does not approve or delete the request", async () => {
  const client = ready();
  client.handleServerRequest({ id: 1, method: "item/fileChange/requestApproval", params: { threadId: "thread-a" } });
  client.send = async () => { throw new Error("write failed"); };
  await assert.rejects(client.approveLatest(), /write failed/);
  assert.equal(client.pendingApprovals.size, 1);
  client.connected = false;
  await assert.rejects(client.approveLatest(), /not ready/);
});
test("queue, selection, and stop target exact threads without terminal input", async () => {
  const client = ready(), requests = [];
  client.callRpc = async (method, params) => { requests.push({ method, params }); return { thread: { id: params.threadId, status: { type: "idle" } } }; };
  await client.queuePrompt("continue");
  assert.deepEqual(requests[0], { method: "turn/start", params: { threadId: "thread-a", input: [{ type: "text", text: "continue" }] } });
  client.turns.set("thread-a", { id: "turn-a" });
  await client.stopTurn();
  assert.deepEqual(requests[1], { method: "turn/interrupt", params: { threadId: "thread-a", turnId: "turn-a" } });
  client.updateThread({ id: "thread-b" }); await client.selectThread("thread-b");
  assert.equal(client.selectedThreadId, "thread-b");
  await assert.rejects(client.focusTerminal(), /unavailable/);
});
test('new and fork select acknowledged tasks without inheriting weaker approval policies', async () => {
  const client = ready(), calls = [];
  client.sessions.get('thread-a').cwd = '/fixture/project';
  client.callRpc = async (method, params) => {
    calls.push({ method, params });
    return { thread: { id: method === 'thread/start' ? 'new-task' : 'fork-task', status: { type: 'idle' } }, cwd: '/fixture/project', model: 'fixture-model' };
  };
  await client.newThread();
  assert.deepEqual(calls[0], { method: 'thread/start', params: { cwd: '/fixture/project' } });
  assert.equal(client.selectedThreadId, 'new-task');
  assert.equal((await client.snapshot()).lastTask.model, 'fixture-model');
  await client.forkThread('thread-a');
  assert.deepEqual(calls[1], { method: 'thread/fork', params: { threadId: 'thread-a' } });
  assert.equal(client.selectedThreadId, 'fork-task');
  client.callRpc = async () => { throw new Error('RPC refused'); };
  await assert.rejects(client.newThread(), /refused/);
  assert.equal(client.selectedThreadId, 'fork-task');
});
test('drafts are bound to their task and steering requires the exact active turn', async () => {
  const client = ready(), calls = [];
  client.updateThread({ id: 'thread-b' }); client.subscribedThreads.add('thread-b');
  client.setDraft('Draft A', 'thread-a'); client.setDraft('Draft B', 'thread-b');
  client.callRpc = async (method, params) => { calls.push({ method, params }); return {}; };
  await assert.rejects(client.submitDraft('thread-a', true), /No active turn/);
  assert.equal(client.drafts.get('thread-a'), 'Draft A');
  client.turns.set('thread-a', { id: 'turn-a' });
  await client.submitDraft('thread-a', true);
  assert.deepEqual(calls[0], { method: 'turn/steer', params: { threadId: 'thread-a', expectedTurnId: 'turn-a', input: [{ type: 'text', text: 'Draft A' }] } });
  assert.equal(client.drafts.has('thread-a'), false);
  assert.equal(client.drafts.get('thread-b'), 'Draft B');
  client.callRpc = async () => { throw new Error('rejected'); };
  await assert.rejects(client.submitDraft('thread-b'), /rejected/);
  assert.equal(client.drafts.get('thread-b'), 'Draft B');
});
test('a newer draft survives submission of the older draft', async () => {
  const client = ready(); client.setDraft('Older');
  client.callRpc = async () => { client.setDraft('Newer'); return {}; };
  await client.submitDraft();
  assert.equal(client.drafts.get('thread-a'), 'Newer');
});
test('stop and attention never approve requests implicitly', async () => {
  const client = ready(), calls = [];
  client.updateThread({ id: 'thread-b' });
  client.pendingApprovals.set(1, { threadId: 'thread-b' });
  client.callRpc = async (method, params) => { calls.push({ method, params }); return { thread: { id: params.threadId } }; };
  await client.selectAttention(); assert.equal(client.selectedThreadId, 'thread-b');
  client.turns.set('thread-b', { id: 'turn-b' });
  await client.stopTurn();
  assert.deepEqual(calls.at(-1), { method: 'turn/interrupt', params: { threadId: 'thread-b', turnId: 'turn-b' } });
  assert.equal(client.pendingApprovals.size, 1);
});
test('usage comes from matching account windows and becomes unknown on failure', async () => {
  const client = ready();
  client.callRpc = async () => ({ rateLimitsByLimitId: { codex: { primary: { usedPercent: 12, windowDurationMins: 300, resetsAt: 20000 }, secondary: { usedPercent: 0, windowDurationMins: 10080, resetsAt: null } } } });
  await client.refreshUsage();
  const state = await client.snapshot();
  assert.equal(state.usage.windows[0].remainingPercent, 88);
  assert.equal(state.usage.windows[1].remainingPercent, 100);
  client.callRpc = async () => { throw new Error('rate limit unavailable'); };
  await client.refreshUsage();
  assert.equal((await client.snapshot()).usage.windows[0].remainingPercent, null);
});
test('selected newly created task remains visible when history exceeds six slots', async () => {
  const client = ready();
  for (let i = 0; i < 10; i++) client.updateThread({ id: `history-${i}` });
  client.selectedThreadId = 'history-9';
  const state = await client.snapshot();
  assert.equal(state.slots.length, 6);
  assert.equal(state.lastTask.threadKey, 'history-9');
  assert.ok(state.slots.some(slot => slot.selected));
});
test('all prompt shortcuts and feature actions dispatch to the explicit task', async () => {
  const { dispatchCliAction, promptShortcuts } = await import('../src/bridge-codex-cli/actions.mjs');
  const client = ready(), calls = [];
  client.callRpc = async (method, params) => { calls.push({ method, params }); return {}; };
  for (const action of Object.keys(promptShortcuts)) {
    await dispatchCliAction(client, action, { threadId: 'thread-a' });
    assert.equal(calls.at(-1).method, 'turn/start');
    assert.equal(calls.at(-1).params.threadId, 'thread-a');
    assert.equal(calls.at(-1).params.input[0].text, promptShortcuts[action]);
  }
  await assert.rejects(dispatchCliAction(client, 'invalid'), /Unsupported/);
});

function settingsFixture() {
  const client = ready(), calls = [];
  client.acceptThreadResponse({ thread: { id: 'thread-a' }, model: 'model-a', reasoningEffort: 'low', serviceTier: null });
  const models = [
    { model: 'model-a', defaultReasoningEffort: 'low', supportedReasoningEfforts: [{ reasoningEffort: 'low' }, { reasoningEffort: 'high' }], serviceTiers: [{ id: 'priority' }] },
    { model: 'model-b', defaultReasoningEffort: 'medium', supportedReasoningEfforts: [{ reasoningEffort: 'medium' }], serviceTiers: [] }
  ];
  client.callRpc = async (method, params) => { calls.push({ method, params }); return method === 'model/list' ? { data: models } : { turn: { id: 'next' } }; };
  return { client, calls, models };
}
test('model controls use catalog capabilities and bind pending choices to one task', async () => {
  const { client, calls } = settingsFixture();
  await client.cycleSetting('reasoning', 'thread-a'); await client.cycleSetting('fast', 'thread-a');
  let state = await client.snapshot();
  assert.deepEqual(state.nextPromptSettings, { model: 'model-a', effort: 'high', serviceTier: 'priority' });
  assert.equal(state.lastTask.reasoningEffort, 'low');
  client.updateThread({ id: 'thread-b', model: 'model-b' }); client.subscribedThreads.add('thread-b'); client.selectedThreadId = 'thread-b';
  assert.equal((await client.snapshot()).nextPromptSettings, null);
  await client.queuePrompt('Test', 'thread-a');
  assert.deepEqual(calls.at(-1).params, { threadId: 'thread-a', input: [{ type: 'text', text: 'Test' }], model: 'model-a', effort: 'high', serviceTier: 'priority' });
  assert.equal(client.promptSettings.has('thread-a'), false);
  await assert.rejects(client.cycleSetting('fast', 'thread-b'), /unavailable/);
});
test('failed starts preserve settings and active-turn steering never applies next-turn choices', async () => {
  const { client, calls } = settingsFixture();
  await client.cycleSetting('reasoning', 'thread-a');
  const rpc = client.callRpc;
  client.callRpc = async () => { throw new Error('Failed start'); };
  await assert.rejects(client.queuePrompt('Test', 'thread-a'), /Failed start/);
  assert.equal(client.promptSettings.get('thread-a').effort, 'high');
  client.callRpc = rpc; client.turns.set('thread-a', { id: 'running' });
  await assert.rejects(client.queuePrompt('Test', 'thread-a'), /new turn/);
  client.setDraft('Steer', 'thread-a'); await client.submitDraft('thread-a', true);
  assert.deepEqual(calls.at(-1).params, { threadId: 'thread-a', expectedTurnId: 'running', input: [{ type: 'text', text: 'Steer' }] });
  assert.equal(client.promptSettings.get('thread-a').effort, 'high');
});
test('model changes reset incompatible effort and speed; newer choices survive an in-flight prompt', async () => {
  const { client } = settingsFixture();
  await client.cycleSetting('fast', 'thread-a');
  let release; const rpc = client.callRpc;
  client.callRpc = (method, params) => method === 'turn/start' ? new Promise(resolve => { release = resolve; }) : rpc(method, params);
  const sending = client.queuePrompt('Test', 'thread-a');
  await client.cycleSetting('model', 'thread-a'); release({ turn: { id: 'next' } }); await sending;
  assert.deepEqual(client.promptSettings.get('thread-a'), { model: 'model-b', effort: 'medium', serviceTier: null });
  assert.equal(client.sessions.get('thread-a').model, 'model-a');
});
test('context uses last reported turn usage and model window, not cumulative token count', async () => {
  const client = ready();
  client.handleNotification({ method: 'thread/tokenUsage/updated', params: { threadId: 'thread-a', tokenUsage: { total: { totalTokens: 100000 }, last: { totalTokens: 250 }, modelContextWindow: 1000 } } });
  const { tokenUsage } = await client.snapshot();
  assert.equal(tokenUsage.totalTokens, 100000); assert.equal(tokenUsage.contextTokens, 250); assert.equal(tokenUsage.modelContextWindow, 1000);
});

test('native goals require an explicit objective and never overwrite an unfinished goal', async () => {
  const client = ready(), calls = [];
  let goal = null;
  client.callRpc = async (method, params) => {
    calls.push({ method, params });
    if (method === 'thread/goal/set') goal = { ...goal, ...params };
    return { goal };
  };
  await assert.rejects(client.createGoal('   ', 'thread-a'), /objective/);
  await assert.rejects(client.toggleGoal('thread-a'), /Create a goal/);
  await client.createGoal('Build the selected project', 'thread-a');
  assert.deepEqual(calls.at(-1), { method: 'thread/goal/set', params: { threadId: 'thread-a', objective: 'Build the selected project', status: 'active' } });
  await assert.rejects(client.createGoal('Overwrite', 'thread-a'), /unfinished/);
  await client.toggleGoal('thread-a');
  assert.deepEqual(calls.at(-1).params, { threadId: 'thread-a', status: 'paused' });
  assert.equal(goal.objective, 'Build the selected project');
  await client.toggleGoal('thread-a'); assert.equal(goal.status, 'active');
  goal.status = 'budgetLimited';
  await assert.rejects(client.toggleGoal('thread-a'), /Only active or paused/);
});
test('unavailable goal protocol leaves other controls ready and never synthesizes a goal', async () => {
  const client = ready();
  client.callRpc = async () => { throw new Error('Method unsupported'); };
  await client.refreshGoal('thread-a');
  await assert.rejects(client.createGoal('Work', 'thread-a'), /unsupported/);
  const state = await client.snapshot();
  assert.equal(state.connected, true); assert.equal(state.goal, null);
  assert.equal(state.capabilities.goal, false); assert.equal(state.goalError, 'Method unsupported');
  client.handleNotification({ method: 'thread/goal/updated', params: { threadId: 'thread-a', goal: { threadId: 'thread-a', status: 'paused', objective: 'A' } } });
  assert.equal((await client.snapshot()).goal.status, 'paused');
  client.handleNotification({ method: 'thread/goal/cleared', params: { threadId: 'thread-a' } });
  assert.equal((await client.snapshot()).goal, null);
});
test('navigation loads older tasks and selects one task without touching its prompt or approvals', async () => {
  const client = ready(), calls = [];
  for (let i = 1; i < 6; i++) client.updateThread({ id: `task-${i}` });
  client.selectedThreadId = 'task-5'; client.threadCursor = 'older';
  client.callRpc = async (method, params) => {
    calls.push({ method, params });
    if (method === 'thread/list') return { data: [{ id: 'older-task' }], nextCursor: null };
    if (method === 'thread/goal/get') return { goal: null };
    return { thread: { id: params.threadId } };
  };
  await client.navigate(1, 'task-5');
  assert.equal(client.selectedThreadId, 'older-task');
  assert.equal(calls[0].params.cursor, 'older');
  assert.deepEqual(calls[1], { method: 'thread/resume', params: { threadId: 'older-task' } });
  const state = await client.snapshot();
  assert.equal(state.navigation.offset, 6); assert.equal(state.slots[0].threadKey, 'older-task');
  await client.navigate(1, 'older-task'); assert.equal(client.selectedThreadId, 'thread-a');
  await assert.rejects(client.navigate(21), /1–20/);
});
test('out-of-order selection responses cannot switch back to an older task', async () => {
  const client = ready(); client.updateThread({ id: 'thread-b' });
  const pending = new Map();
  client.callRpc = (method, params) => method === 'thread/goal/get' ? Promise.resolve({ goal: null }) : new Promise(resolve => pending.set(params.threadId, resolve));
  const first = client.selectThread('thread-a'), second = client.selectThread('thread-b');
  pending.get('thread-b')({ thread: { id: 'thread-b' } }); await second;
  pending.get('thread-a')({ thread: { id: 'thread-a' } }); await first;
  assert.equal(client.selectedThreadId, 'thread-b');
});
test('settings notifications and selected approval counts reflect the selected task', async () => {
  const client = ready(); client.updateThread({ id: 'other' });
  client.pendingApprovals.set(1, { threadId: 'other' });
  client.handleNotification({ method: 'thread/settings/updated', params: { threadId: 'thread-a', threadSettings: { model: 'new-model', effort: 'high', serviceTier: 'priority' } } });
  const state = await client.snapshot();
  assert.equal(state.pendingAttentionCount, 1); assert.equal(state.lastTask.pendingApprovalCount, 0);
  assert.equal(state.lastTask.model, 'new-model'); assert.equal(state.lastTask.reasoningEffort, 'high');
});

test('a task owned by another process is read-only without disconnecting the bridge or permitting mutations', async () => {
  const client = ready(), calls = [];
  client.updateThread({ id: 'other-process', source: 'appServer' });
  client.callRpc = async (method, params) => {
    calls.push({ method, params });
    if (method === 'thread/resume') throw new Error('thread already has an active writer');
    if (method === 'thread/goal/get') return { goal: null };
    if (method === 'thread/start') return { thread: { id: 'new-owned-task', source: 'appServer', status: { type: 'idle' } } };
    return {};
  };
  const result = await client.selectThread('other-process');
  assert.equal(result.readOnly, true);
  const state = await client.snapshot();
  assert.equal(state.connected, true); assert.equal(state.lastTask.status, 'unknown');
  assert.equal(state.lastTask.controllable, false); assert.equal(state.lastTask.source, 'appServer');
  assert.match(state.selectedTaskError, /active writer/);
  assert.equal(state.capabilities.queue, false); assert.equal(state.capabilities.new, true);
  await assert.rejects(client.queuePrompt('Do not send', 'other-process'), /active writer/);
  await assert.rejects(client.createGoal('Do not start', 'other-process'), /active writer/);
  assert.equal(calls.some(c => c.method === 'turn/start' || c.method === 'thread/goal/set'), false);
  await client.newThread('other-process'); assert.equal(client.selectedThreadId, 'new-owned-task');
  assert.equal((await client.snapshot()).lastTask.controllable, true);
});

test('subagent counts belong only to the selected parent and incomplete pages never become a total', async () => {
  const client = ready(); let page = 0;
  client.callRpc = async (method, params) => {
    assert.equal(method, 'thread/list'); assert.ok(params.sourceKinds.includes('subAgentThreadSpawn')); assert.ok(params.sourceKinds.includes('subAgent'));
    page++;
    return page === 1 ? { data: [{ id: 'child-a', parentThreadId: 'thread-a', agentNickname: 'A', status: { type: 'active' } }, { id: 'other-child', parentThreadId: 'other' }], nextCursor: 'next' }
      : { data: [{ id: 'child-a', parentThreadId: 'thread-a' }, { id: 'child-b', parentThreadId: 'thread-a', status: { type: 'idle' } }], nextCursor: null };
  };
  await client.refreshSubagents('thread-a');
  const state = await client.snapshot(); assert.equal(state.subagents.count, 2); assert.equal(state.subagents.complete, true);
  assert.ok(state.subagents.agents.every(a => a.threadKey !== 'other-child'));
  page = 0; client.callRpc = async () => ({ data: [], nextCursor: `page-${++page}` });
  await client.refreshSubagents('thread-a');
  assert.equal(page, 10); assert.equal((await client.snapshot()).subagents.count, null);
  client.callRpc = async () => { throw new Error('Unavailable'); };
  await assert.rejects(client.refreshSubagents('thread-a'), /Unavailable/);
  assert.equal((await client.snapshot()).subagents.source, 'unavailable');
});

test('rapid encoder navigation accumulates steps instead of repeatedly selecting the same task', async () => {
  const client = ready(); client.updateThread({ id: 'b' }); client.updateThread({ id: 'c' });
  client.callRpc = async (method, params) => method === 'thread/goal/get' ? { goal: null } : { thread: { id: params.threadId } };
  await Promise.all([client.navigate(1, 'thread-a'), client.navigate(1, 'thread-a')]);
  assert.equal(client.selectedThreadId, 'c');
});

test('Reject cannot interrupt an active turn when an approval is absent or already resolved', async () => {
  const { dispatchCliAction } = await import('../src/bridge-codex-cli/actions.mjs');
  const client = ready(), requests = [], replies = [];
  client.turns.set('thread-a', { id: 'active-turn' });
  client.callRpc = async (method, params) => { requests.push({ method, params }); return {}; };
  client.send = async message => replies.push(message);
  await assert.rejects(dispatchCliAction(client, 'reject', { threadId: 'thread-a' }), /No approval pending/);
  client.handleServerRequest({ id: 'resolved-request', method: 'item/fileChange/requestApproval', params: { threadId: 'thread-a' } });
  client.handleNotification({ method: 'serverRequest/resolved', params: { requestId: 'resolved-request' } });
  await assert.rejects(dispatchCliAction(client, 'reject', { threadId: 'thread-a', requestId: 'resolved-request' }), /No approval pending/);
  // A legacy cancel explicitly bound to a stale request must not become Stop either.
  await assert.rejects(dispatchCliAction(client, 'cancel', { threadId: 'thread-a', requestId: 'resolved-request' }), /No approval pending/);
  assert.deepEqual(requests, []); assert.deepEqual(replies, []);
  client.handleServerRequest({ id: 'pending-request', method: 'item/fileChange/requestApproval', params: { threadId: 'thread-a' } });
  await dispatchCliAction(client, 'reject', { threadId: 'thread-a', requestId: 'pending-request' });
  assert.deepEqual(replies, [{ id: 'pending-request', result: { decision: 'decline' } }]);
  assert.deepEqual(requests, []);
  // Only the legacy unbound Cancel endpoint retains its documented stop fallback.
  await dispatchCliAction(client, 'cancel', { threadId: 'thread-a' });
  assert.deepEqual(requests, [{ method: 'turn/interrupt', params: { threadId: 'thread-a', turnId: 'active-turn' } }]);
});

test('plan viewing reads only native plan items for the requested task and preserves task selection', async () => {
  const client = ready(); client.updateThread({ id: 'thread-b' });
  const calls = [];
  client.callRpc = async (method, params) => {
    calls.push({ method, params });
    return params.cursor ? { data: [{ turnId: 'turn-plan', item: { id: 'plan-1', type: 'plan', text: '# Actual saved plan' } }, { turnId: 'older', item: { id: 'old-plan', type: 'plan', text: 'Older plan' } }], nextCursor: 'older-page' }
      : { data: [{ turnId: 'recent-turn', item: { type: 'agentMessage', text: 'This message mentions a plan but is not one.' } }], nextCursor: 'next' };
  };
  const result = await client.refreshPlan('thread-b');
  assert.equal(result.plan.document.text, '# Actual saved plan');
  assert.equal(result.plan.document.turnId, 'turn-plan');
  assert.equal(client.selectedThreadId, 'thread-a'); assert.equal((await client.snapshot()).plan, null);
  assert.ok(calls.every(c => c.method === 'thread/items/list' && c.params.threadId === 'thread-b' && c.params.sortDirection === 'desc'));
  await assert.rejects(client.refreshPlan('unknown-task'), /Select a Codex CLI session/);
});
test('live plan updates are task and turn bound, and a delayed history read cannot replace a newer plan', async () => {
  const client = ready(); client.turns.set('thread-a', { id: 'running' });
  client.handleNotification({ method: 'turn/plan/updated', params: { threadId: 'thread-a', turnId: 'old-turn', plan: [{ step: 'Stale', status: 'pending' }] } });
  assert.equal((await client.snapshot()).plan, null);
  client.handleNotification({ method: 'turn/plan/updated', params: { threadId: 'thread-a', turnId: 'running', explanation: 'Working plan', plan: [{ step: 'Test', status: 'inProgress' }] } });
  assert.equal((await client.snapshot()).plan.checklist.steps[0].step, 'Test');
  let release;
  client.callRpc = () => new Promise(resolve => { release = resolve; });
  const reading = client.refreshPlan('thread-a');
  client.handleNotification({ method: 'item/completed', params: { threadId: 'thread-a', turnId: 'running', item: { id: 'new-plan', type: 'plan', text: 'New plan' } } });
  release({ data: [{ turnId: 'old-turn', item: { id: 'old-plan', type: 'plan', text: 'Old plan' } }], nextCursor: null });
  await reading;
  assert.equal((await client.snapshot()).plan.document.text, 'New plan');
  client.handleNotification({ method: 'turn/started', params: { threadId: 'thread-a', turn: { id: 'next-turn' } } });
  assert.equal((await client.snapshot()).plan.checklist, null);
});
test('plan history absence, incomplete search, and failure remain distinguishable', async () => {
  const client = ready(); let page = 0;
  client.callRpc = async () => ({ data: [], nextCursor: `page-${++page}` });
  await client.refreshPlan('thread-a');
  assert.equal(page, 10); assert.equal((await client.snapshot()).plan.historyStatus, 'partial');
  client.callRpc = async () => ({ data: [], nextCursor: null });
  await client.refreshPlan('thread-a');
  assert.equal((await client.snapshot()).plan.historyStatus, 'complete');
  assert.equal((await client.snapshot()).plan.document, null);
  client.callRpc = async () => { throw new Error('History unavailable'); };
  await assert.rejects(client.refreshPlan('thread-a'), /History unavailable/);
  assert.equal((await client.snapshot()).plan.historyStatus, 'error');
});
