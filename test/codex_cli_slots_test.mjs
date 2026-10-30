import test from 'node:test';
import assert from 'node:assert/strict';
import { SessionSlots } from '../src/bridge-codex-cli/session-slots.mjs';
const task = (id, active = false) => ({ threadKey: id, isRunning: active, needsAttention: false });
const ids = slots => slots.map(s => s.threadKey);
test('active work takes the lowest slots without filling keys with history', () => {
  const slots = new SessionSlots();
  const tasks = [task('old1'), task('old2'), task('current', true)];
  assert.deepEqual(ids(slots.update(tasks, 'current', 0, 0)), ['current', null, null, null, null, null]);
});
test('completed slots expire after 30 seconds, active slots stay stable, and holes are reused', () => {
  const slots = new SessionSlots();
  slots.update([task('a', true), task('b', true)], 'a', 0, 0);
  const tasks = [task('a'), task('b', true)];
  assert.deepEqual(ids(slots.update(tasks, 'a', 0, 1000)).slice(0, 2), ['a', 'b']);
  assert.equal(slots.update(tasks, 'a', 0, 30999)[0].threadKey, 'a');
  assert.deepEqual(ids(slots.update(tasks, 'a', 0, 31000)).slice(0, 2), [null, 'b']);
  assert.equal(slots.update(tasks, 'a', 0, 60000)[0].threadKey, null, 'selected completed task must not reappear automatically');
  tasks.push(task('c', true));
  assert.deepEqual(ids(slots.update(tasks, 'a', 0, 61000)).slice(0, 2), ['c', 'b']);
});
test('attention holds a slot and history navigation never moves active tasks', () => {
  const slots = new SessionSlots();
  const tasks = [task('a', true), { ...task('question'), needsAttention: true }, task('old1'), task('old2')];
  slots.update(tasks, 'a', 0, 0);
  assert.deepEqual(ids(slots.update(tasks, 'old1', 1, 1000)).slice(0, 3), ['a', 'question', 'old1']);
  assert.deepEqual(ids(slots.update(tasks, 'old2', 2, 2000)).slice(0, 3), ['a', 'question', 'old2']);
  assert.equal(slots.update(tasks, 'old2', 2, 32000)[1].threadKey, 'question');
});
test('overflow waits for a free key and selected history never displaces active work', () => {
  const slots = new SessionSlots();
  const tasks = Array.from({ length: 7 }, (_, i) => task(String(i), true));
  slots.update(tasks, '0', 0, 0);
  assert.deepEqual(ids(slots.update([...tasks, task('history')], 'history', 1, 1000)), ['0', '1', '2', '3', '4', '5']);
  tasks[1].isRunning = false;
  assert.deepEqual(ids(slots.update(tasks, '0', 2, 2000)), ['0', '6', '2', '3', '4', '5']);
});
