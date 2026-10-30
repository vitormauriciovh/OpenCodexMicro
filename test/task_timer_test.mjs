import test from 'node:test';
import assert from 'node:assert/strict';
import { TaskTimers } from '../src/shared/task-timer.mjs';

test('duration includes attention, freezes at completion and resets for another execution', () => {
  const timers = new TaskTimers();
  assert.equal(timers.observe('a', { status: 'idle' }, 1000), null);
  assert.equal(timers.observe('a', { status: 'working' }, 2000), 0);
  assert.equal(timers.observe('a', { status: 'approval' }, 5000), 3000);
  assert.equal(timers.observe('a', { status: 'working' }, 8000), 6000);
  assert.equal(timers.observe('a', { status: 'completed' }, 10000), 8000);
  assert.equal(timers.observe('a', { status: 'completed' }, 20000), 8000);
  assert.equal(timers.observe('a', { status: 'working' }, 30000), 0);
  assert.equal(timers.observe('a', { status: 'stopped' }, 32000), 2000);
  assert.equal(timers.elapsed('a', 40000), 2000);
});

test('reported start and duration override observation and turn identity separates executions', () => {
  const timers = new TaskTimers();
  assert.equal(timers.observe('a', { status: 'working', startedAt: 1000, runId: 'first' }, 5000), 4000);
  assert.equal(timers.observe('a', { status: 'completed', elapsedSec: 6 }, 10000), 6000);
  assert.equal(timers.observe('a', { status: 'working', startedAt: 12000, runId: 'second' }, 14000), 2000);
  assert.equal(timers.observe('a', { status: 'working', startedAt: 15000, runId: 'third' }, 16000), 1000);
  timers.retain(new Set());
  assert.equal(timers.elapsed('a'), null);
});
