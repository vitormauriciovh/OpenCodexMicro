import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

function fixture() {
  const elements = new Map();
  const getElementById = id => {
    if (!elements.has(id)) elements.set(id, { value: '', textContent: '', innerText: '', className: '', disabled: false, addEventListener(name, fn) { this[name] = fn; } });
    return elements.get(id);
  };
  let state = { connected: true, daemonConnected: true, selectedThreadId: 'a', lastTask: { title: 'Task A' }, draft: 'Saved A' };
  const calls = [];
  const context = vm.createContext({ setInterval() {}, document: { getElementById }, localFetch: async (url, options) => {
    if (options) { calls.push({ path: new URL(url).pathname, body: JSON.parse(options.body) }); return { ok: true }; }
    return { ok: true, json: async () => state };
  } });
  const html = readFileSync(new URL('../integration/com.ulanzi.codexcli.ulanziPlugin/property-inspector/setup.html', import.meta.url), 'utf8');
  const code = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)][0][1];
  vm.runInContext(code.replace(/\s+checkStatus\(\);\s*$/, ''), context);
  return { context, elements, calls, getElementById, setState: value => { state = value; } };
}
test('CLI inspector preserves unsaved text and its task binding across refresh and task switches', async () => {
  const f = fixture(); await vm.runInContext('checkStatus()', f.context);
  const prompt = f.getElementById('prompt'); assert.equal(prompt.value, 'Saved A');
  prompt.value = 'Unsaved A'; prompt.input();
  f.setState({ connected: true, daemonConnected: true, selectedThreadId: 'b', lastTask: { title: 'Task B' }, draft: 'Saved B' });
  await vm.runInContext('checkStatus()', f.context);
  assert.equal(prompt.value, 'Unsaved A'); assert.equal(f.getElementById('draftTask').textContent, 'Task A');
  await vm.runInContext('saveDraft()', f.context);
  assert.deepEqual(f.calls.at(-1), { path: '/draft', body: { threadId: 'a', text: 'Unsaved A' } });
  await vm.runInContext('checkStatus()', f.context); assert.equal(prompt.value, 'Saved B');
});
test('CLI inspector creates goals only from an explicit nonempty objective and displays pending settings', async () => {
  const f = fixture();
  f.setState({ connected: true, daemonConnected: true, selectedThreadId: 'a', lastTask: { title: 'Task A' }, nextPromptSettings: { model: 'fixture', effort: 'high', serviceTier: 'priority' } });
  await vm.runInContext('checkStatus()', f.context);
  assert.match(f.getElementById('settings').textContent, /Next deck prompt: fixture, high, Fast/);
  await vm.runInContext('createGoal()', f.context); assert.equal(f.calls.length, 0);
  f.getElementById('objective').value = 'Finish tests';
  await vm.runInContext('createGoal()', f.context);
  assert.deepEqual(f.calls.at(-1), { path: '/goal', body: { threadId: 'a', objective: 'Finish tests' } });
});

test('CLI plan viewer renders text literally and clears content when the selected task changes', async () => {
  const f = fixture();
  f.setState({ connected: true, daemonConnected: true, selectedThreadId: 'a', lastTask: { title: 'Task A' }, plan: { historyStatus: 'complete', document: { turnId: 'turn-a', text: '<script>not HTML</script>' }, checklist: { turnId: 'turn-a', steps: [{ step: 'Run tests', status: 'inProgress' }] } } });
  await vm.runInContext('checkStatus()', f.context);
  assert.match(f.getElementById('planText').textContent, /\[→\] Run tests/);
  assert.match(f.getElementById('planText').textContent, /<script>not HTML<\/script>/);
  await vm.runInContext('loadPlan()', f.context);
  assert.deepEqual(f.calls.at(-1), { path: '/action/plan', body: { threadId: 'a' } });
  f.setState({ connected: true, selectedThreadId: 'b', plan: null });
  await vm.runInContext('refreshPlanDisplay()', f.context);
  assert.equal(f.getElementById('planText').textContent, '');
  assert.match(f.getElementById('planStatus').textContent, /selection changed/);
  assert.equal(f.getElementById('loadPlanBtn').disabled, true);
});
