import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readTaskProgress, readNativeTaskData } from '../src/bridge/task-progress.mjs';
import { taskProgressMarkup } from '../src/shared/task-progress.mjs';
const todo = (plan) => ({ type: 'todo-list', plan });
const plan = [{ step: 'Inspect', status: 'completed' }, { step: 'Test <&>', status: 'inProgress' }];
const turn = (id, items) => ({ turnId: id, items });
const conversation = (turns) => ({ id: 'task', hostId: 'local', turns });
test('latest update of latest turn determines counts; pending and zero remain measured', () => {
  const c = conversation([turn('one', [todo(plan), todo([{ step: 'New plan', status: 'pending' }])])]);
  assert.deepEqual(readTaskProgress(c), { turnId: 'one', completed: 0, total: 1, currentStep: 'New plan' });
  c.turns.push(turn('two', []));
  assert.equal(readTaskProgress(c), null);
  c.turns[1].items = [todo(plan)];
  assert.equal(readTaskProgress(c).completed, 1);
});
test('canonical history must include the newest boundary and never falls back to old plans', () => {
  const c = { turnHistory: { kind: 'canonical', history: { entitiesByKey: { a: turn('a', [todo(plan)]), b: turn('b', []) }, islands: [{ entries: [{ value: 'a' }, { value: 'b' }], newerBoundary: { status: 'exhausted' } }] } } };
  assert.equal(readTaskProgress(c), null);
  c.turnHistory.history.islands[0].entries.pop();
  assert.equal(readTaskProgress(c).total, 2);
  c.turnHistory.history.islands[0].newerBoundary.status = 'unknown';
  assert.equal(readTaskProgress(c), null);
});
test('invalid, empty, absent and oversized plans remain unknown', () => {
  for (const p of [[], null, [{ step: 'x', status: 'unknown' }], Array(201).fill(plan[0])]) {
    assert.equal(readTaskProgress(conversation([turn('a', [todo(p)])])), null);
  }
  assert.equal(readTaskProgress(null), null);
});
test('native reader scopes data by local host and exact conversation identity; serialization works', () => {
  const client = { hostId: 'local', getConversation: id => id === 'task' ? conversation([turn('a', [todo(plan)])]) : null };
  const node = { familyBindings: new Map([['client', new Map([['local', { value: { get: () => client } }]])]]) };
  const source = { node, contextMap: new Map() };
  const tasks = [{ threadId: 'task', threadKey: 'local:task' }, { threadId: 'task', threadKey: 'remote:task' }, { threadId: 'other', threadKey: 'local:other' }];
  const result = vm.runInNewContext(`(${readNativeTaskData})(source, tasks, ${readTaskProgress})`, { source, tasks, Map, Set });
  assert.equal(result.size, 1);
  assert.equal(result.get('local:task').completed, 1);
  client.hostId = 'remote';
  assert.equal(readNativeTaskData(source, tasks, readTaskProgress).size, 0);
});
test('card shows exact step counts, escapes labels, animates only unknown active work', () => {
  const p = readTaskProgress(conversation([turn('a', [todo(plan)])]));
  const svg = taskProgressMarkup(p);
  assert.match(svg, />1\/2</);
  assert.match(svg, /Test &lt;&amp;&gt;/);
  assert.match(svg, /width="86"/);
  assert.notEqual(taskProgressMarkup(null, { running: true, now: 0 }), taskProgressMarkup(null, { running: true, now: 1000 }));
  assert.equal(taskProgressMarkup(null, { now: 0 }), taskProgressMarkup(null, { now: 1000 }));
  assert.doesNotMatch(taskProgressMarkup(null), /%/);
});

test('native metadata preserves zero and missing usage without leaking task settings', async () => {
  const { taskMetadata } = await import('../src/bridge/task-progress.mjs');
  const usage = { total: { totalTokens: 0 }, last: { totalTokens: 0 }, modelContextWindow: 100 };
  const c = { id: 'task', latestModel: 'gpt-6-astra', latestTokenUsageInfo: usage,
    latestThreadSettings: { model: 'gpt-6-astra', privateSetting: 'must not copy' } };
  const meta = taskMetadata(c);
  assert.equal(meta.latestTokenUsageInfo, usage);
  assert.deepEqual(meta.latestThreadSettings, { model: 'gpt-6-astra' });
  assert.equal(taskMetadata({ id: 'other' }).latestTokenUsageInfo, null);
  const serialized = vm.runInNewContext(`(${taskMetadata})(c)`, { c });
  assert.equal(serialized.latestModel, 'gpt-6-astra');
});
