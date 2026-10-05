import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { readNativeModelPicker, cycleNativeModelPicker } from '../src/bridge/model-picker.mjs';
import { CodexCdpClient, rendererActionExpression } from '../src/bridge/codex-cdp.mjs';

const threadId = 'f6805b8a-332a-43a0-a118-52d3e59542f6';
const model = (id, efforts, defaultEffort = efforts[0]) => ({
  model: id, defaultReasoningEffort: defaultEffort,
  supportedReasoningEfforts: efforts.map(reasoningEffort => ({ reasoningEffort }))
});

function fixture() {
  const calls = [];
  const models = [model('a', ['low', 'high', 'ultra']), model('b', ['low', 'high']), model('c', ['medium', 'high'])];
  const props = {
    models, modelOptions: models.map(model => ({ model, disabledReason: null })),
    model: 'a', reasoningEffort: 'high',
    onSelectModel(id, effort) { calls.push(['model', id, effort]); props.model = id; props.reasoningEffort = effort; },
    onSelectReasoningEffort(effort) { calls.push(['reasoning', effort]); props.reasoningEffort = effort; },
    onSelectModelOption() { calls.push(['explicit-model']); }
  };
  const trigger = { offsetParent: {}, closest: () => null, getAttribute: () => null };
  const root = { stateNode: {} };
  const component = { return: root, memoizedProps: props };
  const mounted = { return: component, stateNode: trigger };
  root.stateNode.current = root; root.child = component; component.child = mounted;
  trigger.__reactFiber$test = mounted;
  let activeThread = threadId;
  const document = {
    querySelectorAll: () => [trigger],
    querySelector: () => ({ getAttribute: () => activeThread })
  };
  return { props, trigger, document, calls, root, mounted, setThread: value => { activeThread = value; } };
}

test('model cycles in native order, skips blocked models and wraps, preserving supported effort', () => {
  const f = fixture();
  f.props.modelOptions[1].disabledReason = 'unavailable';
  cycleNativeModelPicker(f, 'model');
  assert.equal(f.props.model, 'c');
  assert.equal(f.props.reasoningEffort, 'high');
  cycleNativeModelPicker(f, 'model');
  assert.equal(f.props.model, 'a');
  assert.deepEqual(f.calls, [['model', 'c', 'high'], ['explicit-model'], ['model', 'a', 'high'], ['explicit-model']]);
});

test('changing model falls back to its native default when the previous effort is unsupported', () => {
  const f = fixture(); f.props.reasoningEffort = 'ultra';
  cycleNativeModelPicker(f, 'model');
  assert.deepEqual(f.calls[0], ['model', 'b', 'low']);
});

test('effort cycles only the current model levels, wraps and never changes model', () => {
  const f = fixture();
  cycleNativeModelPicker(f, 'reasoning');
  cycleNativeModelPicker(f, 'reasoning');
  assert.deepEqual(f.calls, [['reasoning', 'ultra'], ['reasoning', 'low']]);
  f.props.model = 'c'; f.props.reasoningEffort = 'high';
  cycleNativeModelPicker(f, 'reasoning');
  assert.deepEqual(f.calls.at(-1), ['reasoning', 'medium']);
  assert.equal(f.props.model, 'c');
});

test('disabled controls, saving state, locks and native rejection prevent selection', () => {
  for (const override of [
    { disabled: true }, { daybreak: { isSaving: true } }, { daybreak: { disabled: true } },
    { modelOptionsDisabled: true }, { modelLabelOnly: true }, { onBeforeSelectModel: () => false }
  ]) {
    const f = fixture(); Object.assign(f.props, override);
    assert.throws(() => cycleNativeModelPicker(f, 'model'));
    assert.equal(f.calls.length, 0);
  }
  for (const override of [{ reasoningEffortDisabled: true }, { showReasoningEffortControls: false }]) {
    const f = fixture(); Object.assign(f.props, override);
    assert.throws(() => cycleNativeModelPicker(f, 'reasoning'));
    assert.equal(f.calls.length, 0);
  }
  const f = fixture(); f.trigger.disabled = true;
  assert.throws(() => cycleNativeModelPicker(f, 'reasoning'));
  assert.equal(f.calls.length, 0);
});

test('locked model is skipped without opening access options', () => {
  const f = fixture(); f.props.lockedModelSlug = 'b';
  cycleNativeModelPicker(f, 'model');
  assert.equal(f.props.model, 'c');
});

test('unknown current selection or only one available option fails without guessing', () => {
  for (const action of ['model', 'reasoning']) {
    const f = fixture();
    if (action === 'model') f.props.model = 'missing';
    else f.props.reasoningEffort = 'missing';
    assert.throws(() => cycleNativeModelPicker(f, action));
    assert.equal(f.calls.length, 0);
  }
  const f = fixture(); f.props.modelOptions = [f.props.modelOptions[0]];
  assert.throws(() => cycleNativeModelPicker(f, 'model'), /No other/);
  f.props.models[0].supportedReasoningEfforts = [{ reasoningEffort: 'high' }];
  assert.throws(() => cycleNativeModelPicker(f, 'reasoning'), /No other/);
  assert.equal(f.calls.length, 0);
});

test('picker discovery uses committed props instead of stale DOM fiber props', () => {
  const f = fixture();
  f.trigger.__reactFiber$test = { return: { stateNode: f.root.stateNode }, memoizedProps: { ...f.props, model: 'stale' } };
  assert.equal(readNativeModelPicker(f.document).props.model, 'a');
  f.document.querySelectorAll = () => [f.trigger, { ...f.trigger }];
  assert.throws(() => readNativeModelPicker(f.document), /unique/);
  f.document.querySelectorAll = () => [{ ...f.trigger, closest: () => ({}) }];
  assert.throws(() => readNativeModelPicker(f.document), /unique/);
});

test('serialized actions confirm the new value, guard the task and never click the picker', async () => {
  for (const action of ['model', 'reasoning']) {
    const f = fixture();
    f.trigger.click = () => { throw new Error('Must not open menu'); };
    const context = { document: f.document, setTimeout: callback => callback() };
    assert.equal(await vm.runInNewContext(rendererActionExpression(action, threadId), context), true);
    assert.equal(f.calls.filter(call => call[0] === action).length, 1);
    f.setThread('another-task');
    const count = f.calls.length;
    await assert.rejects(vm.runInNewContext(rendererActionExpression(action, threadId), context), /task changed/);
    assert.equal(f.calls.length, count);
  }
});

test('unconfirmed settings or a task switch during confirmation reports failure without retrying the mutation', async () => {
  const f = fixture(); let writes = 0;
  f.props.onSelectModel = () => { writes++; };
  const context = { document: f.document, setTimeout: callback => callback() };
  await assert.rejects(vm.runInNewContext(rendererActionExpression('model', threadId), context), /did not confirm/);
  assert.equal(writes, 1);
  f.props.onSelectModel = () => { f.setThread('other-task'); };
  await assert.rejects(vm.runInNewContext(rendererActionExpression('model', threadId), context), /task changed/);
});

test('rapid model and effort presses serialize and releases do nothing', async () => {
  const client = new CodexCdpClient(); const order = [];
  let unblock;
  client.dispatchRendererAction = async action => {
    order.push(`start:${action}`);
    if (action === 'model') await new Promise(resolve => { unblock = resolve; });
    order.push(`end:${action}`);
  };
  const first = client.dispatchNamedAction('model', true, threadId);
  const second = client.dispatchNamedAction('reasoning', true, threadId);
  await client.dispatchNamedAction('model', false, threadId);
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(order, ['start:model']);
  unblock(); await Promise.all([first, second]);
  assert.deepEqual(order, ['start:model', 'end:model', 'start:reasoning', 'end:reasoning']);
});
