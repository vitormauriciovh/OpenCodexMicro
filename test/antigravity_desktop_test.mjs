import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { EventEmitter } from 'node:events';
import { desktopOperation, AntigravityDesktopClient } from '../src/bridge-antigravity/desktop-client.mjs';
import { mergeDesktopState } from '../src/bridge-antigravity/desktop-state.mjs';
const a = '11111111-1111-4111-8111-111111111111', b = '22222222-2222-4222-8222-222222222222';
class Element {
  constructor(tag, attrs = {}, text = '', children = []) { this.tag = tag; this.attrs = attrs; this.textContent = this.innerText = text; this.children = children; for (const child of children) child.parentElement = this; this.clicks = 0; this.disabled = false; }
  getAttribute(key) { return this.attrs[key] ?? null; }
  getClientRects() { return this.hidden ? [] : [{}]; }
  click() { this.clicks++; this.onClick?.(); }
  focus() { this.focused = true; }
  closest(selector) { return this.matches(selector) ? this : this.parentElement?.closest(selector) || null; }
  dispatchEvent(event) { this.onEvent?.(event); return true; }
  scrollBy(options) { this.scroll = options; }
  matches(selector) {
    const tag = selector.match(/^[a-z]+/i)?.[0];
    if (tag && tag !== this.tag) return false;
    return [...selector.matchAll(/\[([^=\]^]+)(\^?=)?(?:"([^"]*)")?\]/g)].every(([, key, op, value]) => op === '^=' ? this.attrs[key]?.startsWith(value) : op === '=' ? this.attrs[key] === value : key in this.attrs);
  }
  querySelectorAll(selectors) {
    const children = this.children.flatMap(child => [child, ...child.querySelectorAll('*')]);
    return children.filter(child => selectors.split(',').some(selector => child.matches(selector)));
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
}
function fixture() {
  const editor = new Element('div', { contenteditable: 'true', 'aria-label': 'Message input' });
  const send = new Element('button', { 'data-testid': 'send-button' });
  const stop = new Element('button', { 'data-tooltip-id': 'input-send-button-cancel-tooltip' });
  const model = new Element('button', { 'data-testid': 'model-selector-trigger' }, 'Fixture Model');
  const composer = new Element('div', { 'data-testid': 'agent-input-box' }, '', [editor, send, stop, model]);
  const viewport = new Element('div', { 'data-testid': 'autoscroll-viewport' });
  const accept = new Element('button', {}, 'Accept'), reject = new Element('button', {}, 'Reject');
  const view = new Element('div', { 'data-testid': 'conversation-view' }, '', [accept, reject, viewport, composer]);
  const makeRow = id => new Element('div', { 'data-testid': 'conversation-row-sidebar', 'data-cascade-id': id, 'data-pinned': 'false' }, '', [new Element('a', { href: `/c/${id}`, 'aria-label': id === a ? 'Task A' : 'Task B' }), new Element('button', { 'data-testid': 'conversation-pin-button' })]);
  const rows = [makeRow(b), makeRow(a)];
  const unrelated = new Element('button', { 'data-tooltip-id': 'input-send-button-cancel-tooltip' }, 'Accept');
  const document = new Element('document', {}, '', [...rows, unrelated, view]);
  document.execCommand = (command, _unused, text) => { assert.equal(command, 'insertText'); editor.textContent = text; return true; };
  const location = { pathname: `/c/${a}`, href: `https://127.0.0.1:1234/c/${a}`, origin: 'https://127.0.0.1:1234' };
  return { document, location, editor, send, stop, model, composer, viewport, accept, reject, rows, unrelated };
}
test('desktop snapshot identifies the selected task and measured active controls', async () => {
  const f = fixture();
  const state = await desktopOperation({ action: 'snapshot' }, f);
  assert.equal(state.activeThreadKey, a); assert.equal(state.tasks[1].selected, true);
  assert.equal(state.tasks[0].selected, false); assert.equal(state.model, 'Fixture Model');
  assert.equal(state.pendingApprovalCount, 1); assert.equal(state.activeStatus, 'attention');
});
test('approval and stop are scoped to the selected conversation, never unrelated controls', async () => {
  const f = fixture();
  await desktopOperation({ action: 'approve', threadId: a }, f);
  await desktopOperation({ action: 'reject', threadId: a }, f);
  await desktopOperation({ action: 'stop', threadId: a }, f);
  assert.equal(f.accept.clicks, 1); assert.equal(f.reject.clicks, 1); assert.equal(f.stop.clicks, 1);
  assert.equal(f.unrelated.clicks, 0);
  f.document.querySelector('[data-testid="conversation-view"]').children.push(new Element('button', {}, 'Accept'));
  await assert.rejects(desktopOperation({ action: 'approve', threadId: a }, f), /Multiple/);
  assert.equal(f.accept.clicks, 1);
});
test('stale task IDs reject every mutation before clicking or inserting text', async () => {
  const f = fixture();
  f.document.execCommand = () => { throw new Error('must not insert'); };
  for (const action of ['approve', 'reject', 'stop', 'pin', 'new', 'mic', 'model', 'reasoning', 'fork', 'steer', 'scroll', 'submit', 'prompt']) {
    await assert.rejects(desktopOperation({ action, threadId: b, text: 'test', ticks: 1 }, f), /task changed/);
  }
  assert.equal(f.accept.clicks + f.stop.clicks + f.send.clicks, 0);
});
test('selection clicks the exact row link and pin affects only the active row', async () => {
  const f = fixture();
  await desktopOperation({ action: 'select', threadId: b }, f);
  assert.equal(f.rows[0].children[0].clicks, 1); assert.equal(f.rows[0].children[1].clicks, 0);
  await desktopOperation({ action: 'pin', threadId: a }, f);
  assert.equal(f.rows[1].children[1].clicks, 1);
  assert.equal(f.rows[0].children[1].clicks, 0);
});
test('prompt shortcuts preserve existing drafts and check task identity again before Send', async () => {
  const f = fixture(); f.editor.textContent = 'User draft';
  await assert.rejects(desktopOperation({ action: 'prompt', threadId: a, text: 'test' }, f), /already contains/);
  assert.equal(f.editor.textContent, 'User draft'); assert.equal(f.send.clicks, 0);
  f.editor.textContent = '';
  await desktopOperation({ action: 'prompt', threadId: a, text: 'Test "quoted" prompt' }, f);
  assert.equal(f.editor.textContent, 'Test "quoted" prompt'); assert.equal(f.send.clicks, 1);
  f.editor.textContent = '';
  f.document.execCommand = (_command, _unused, text) => { f.editor.textContent = text; f.location.pathname = `/c/${b}`; return true; };
  await assert.rejects(desktopOperation({ action: 'prompt', threadId: a, text: 'Later' }, f), /Task changed/);
  assert.equal(f.send.clicks, 1);
});
test('scroll uses the conversation viewport and rejects invalid deltas', async () => {
  const f = fixture();
  await desktopOperation({ action: 'scroll', threadId: a, ticks: -2 }, f);
  assert.deepEqual(f.viewport.scroll, { top: -720, behavior: 'auto' });
  for (const ticks of [0, 1000, NaN]) await assert.rejects(desktopOperation({ action: 'scroll', threadId: a, ticks }, f), /Invalid/);
});
test('live selection overrides latest history and offline state never invents a selected task', () => {
  const history = { connected: true, activeTasks: [{ threadKey: a, title: 'Old title', status: 'unknown', tokenUsage: { estimated: true } }, { threadKey: b, title: 'Latest history', status: 'idle' }] };
  const state = mergeDesktopState(history, { connected: true, activeThreadKey: a, activeStatus: 'working', model: 'Live model', tasks: [{ threadKey: a, title: 'Live title' }] });
  assert.equal(state.lastTask.threadKey, a); assert.equal(state.slots[0].model, 'Live model');
  assert.equal(state.slots[0].status, 'working'); assert.equal(state.capabilities.stop, true);
  const pending = mergeDesktopState(history, { connected: true, activeThreadKey: a, activeStatus: 'attention', pendingApprovalCount: 2, tasks: [{ threadKey: a }] });
  assert.equal(pending.pendingAttentionCount, 1);
  assert.equal(state.pendingAttentionCount, 0);
  const offline = mergeDesktopState(history, null, 'App closed');
  assert.equal(offline.selectedThreadId, null); assert.equal(offline.capabilities.stop, false);
  assert.equal(offline.lastTask, null);
});
test('desktop transport isolates requests and rejects remote debugging endpoints', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'agy-desktop-test-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const portFile = path.join(dir, 'DevToolsActivePort'); await fs.writeFile(portFile, '1234\n/path');
  class Socket extends EventEmitter {
    readyState = 0;
    constructor() { super(); queueMicrotask(() => { this.readyState = 1; this.emit('open'); }); }
    send(raw, callback) { const msg = JSON.parse(raw); callback(); queueMicrotask(() => this.emit('message', JSON.stringify({ id: msg.id, result: { result: { value: { id: msg.id, ok: true } } } }))); }
    close() { this.readyState = 3; this.emit('close'); }
  }
  const target = { type: 'page', url: `https://127.0.0.1:5555/c/${a}`, webSocketDebuggerUrl: 'ws://127.0.0.1:1234/devtools/page/a' };
  const client = new AntigravityDesktopClient({ portFile, fetchImpl: async () => ({ ok: true, json: async () => [target] }), socketFactory: () => new Socket() });
  const [first, second] = await Promise.all([client.snapshot(), client.snapshot()]);
  assert.notEqual(first.id, second.id); client.close();
  target.webSocketDebuggerUrl = 'ws://evil.invalid:1234/devtools/page/a';
  await assert.rejects(client.snapshot(), /Invalid Antigravity desktop endpoint/);
});

test('reasoning cycles only the current model supported radio choices and preserves concurrent changes', async () => {
  const f = fixture(); f.model.textContent = 'Fixture Model Medium';
  const low = new Element('div', { role: 'menuitemradio', 'aria-checked': 'false' }, '', [new Element('span', { 'data-testid': 'model-selector-effort-option', 'data-effort': 'low' })]);
  const medium = new Element('div', { role: 'menuitemradio', 'aria-checked': 'true' }, '', [new Element('span', { 'data-testid': 'model-selector-effort-option', 'data-effort': 'medium' })]);
  const high = new Element('div', { role: 'menuitemradio', 'aria-checked': 'false' }, '', [new Element('span', { 'data-testid': 'model-selector-effort-option', 'data-effort': 'high' })]);
  const group = new Element('div', { role: 'menuitem' }, '', [new Element('span', { 'data-testid': 'model-selector-effort-group', 'data-model-base': 'Fixture Model' })]);
  f.document.children.push(group);
  group.onEvent = event => { assert.equal(event.key, 'ArrowRight'); f.document.children.push(low, medium, high); };
  f.KeyboardEvent = class { constructor(type, options) { this.type = type; Object.assign(this, options); } };
  await desktopOperation({ action: 'reasoning', threadId: a }, f);
  assert.equal(low.clicks, 0); assert.equal(medium.clicks, 0); assert.equal(high.clicks, 1);
  group.onEvent = () => { f.location.pathname = `/c/${b}`; };
  await assert.rejects(desktopOperation({ action: 'reasoning', threadId: a }, f), /task changed/);
  assert.equal(high.clicks, 1);
});
test('fork uses only the latest response and current workspace target, refusing drafts and active turns', async () => {
  const f = fixture(); f.stop.hidden = true;
  const first = new Element('button', { 'aria-label': 'Fork Conversation' });
  const latest = new Element('button', { 'aria-label': 'Fork Conversation' });
  f.document.querySelector('[data-testid="conversation-view"]').children.push(
    new Element('div', { 'data-testid': 'cascade-system-message-toolbar' }, '', [first]),
    new Element('div', { 'data-testid': 'cascade-system-message-toolbar' }, '', [latest]));
  const current = new Element('button', {}, '', [new Element('span', { 'data-testid': 'fork-target-option' }, 'Create fork in current workspace')]);
  const shared = new Element('button', {}, '', [new Element('span', { 'data-testid': 'fork-target-option' }, 'Create fork in shared workspace')]);
  latest.onClick = () => { f.document.children.push(current, shared); };
  f.editor.textContent = 'My draft';
  await assert.rejects(desktopOperation({ action: 'fork', threadId: a }, f), /draft/);
  assert.equal(latest.clicks, 0);
  f.editor.textContent = ''; f.stop.hidden = false;
  await assert.rejects(desktopOperation({ action: 'fork', threadId: a }, f), /Wait for/);
  f.stop.hidden = true;
  await desktopOperation({ action: 'fork', threadId: a }, f);
  assert.equal(first.clicks, 0); assert.equal(latest.clicks, 1); assert.equal(current.clicks, 1); assert.equal(shared.clicks, 0);
});
test('sidebar Stop keeps status accurate when a composer draft replaces its Stop control', async () => {
  const f = fixture(); f.stop.hidden = true; f.accept.hidden = true;
  const stop = new Element('button', { 'aria-label': 'Stop execution' }); f.rows[1].children.push(stop);
  const state = await desktopOperation({ action: 'snapshot' }, f);
  assert.equal(state.activeStatus, 'working'); assert.equal(state.tasks[1].running, true);
  await desktopOperation({ action: 'stop', threadId: a }, f); assert.equal(stop.clicks, 1);
});

function addQueue(f, labels) {
  const buttons = labels.map(label => new Element('button', { 'aria-label': label }));
  const expand = new Element('button', { 'data-testid': 'queued-messages-expand-button', 'aria-expanded': 'true' });
  const card = new Element('div', { 'data-testid': 'queued-messages-card' }, '', [expand, ...buttons.map(button => new Element('div', { 'data-testid': 'queued-decorators' }, '', [button]))]);
  f.document.querySelector('[data-testid="conversation-view"]').children.push(card);
  return { buttons, expand, card };
}
test('queued steering promotes only one selected-task message and preserves the composer draft', async () => {
  const f = fixture(); f.editor.textContent = 'Unsent personal draft';
  assert.equal((await desktopOperation({ action: 'snapshot' }, f)).controls.steer, false);
  await assert.rejects(desktopOperation({ action: 'steer', threadId: a }, f), /unavailable/);
  const queue = addQueue(f, ['Send now: Follow-up']);
  const unrelated = new Element('button', { 'aria-label': 'Send now: Other task' });
  f.document.children.push(new Element('div', { 'data-testid': 'queued-decorators' }, '', [unrelated]));
  assert.equal((await desktopOperation({ action: 'snapshot' }, f)).controls.steer, true);
  await assert.rejects(desktopOperation({ action: 'steer', threadId: b }, f), /task changed/);
  assert.equal(queue.buttons[0].clicks, 0);
  await desktopOperation({ action: 'steer', threadId: a }, f);
  assert.equal(queue.buttons[0].clicks, 1); assert.equal(unrelated.clicks, 0);
  assert.equal(f.editor.textContent, 'Unsent personal draft'); assert.equal(f.send.clicks, 0);
});
test('queued steering rejects ambiguous, disabled, collapsed or hidden queues', async () => {
  const f = fixture(); const queue = addQueue(f, ['Send now: First', 'Send now: Second']);
  assert.equal((await desktopOperation({ action: 'snapshot' }, f)).controls.steer, false);
  await assert.rejects(desktopOperation({ action: 'steer', threadId: a }, f), /Multiple/);
  queue.buttons[1].hidden = true; queue.buttons[0].disabled = true;
  await assert.rejects(desktopOperation({ action: 'steer', threadId: a }, f), /unavailable/);
  queue.buttons[0].disabled = false; queue.expand.attrs['aria-expanded'] = 'false';
  await assert.rejects(desktopOperation({ action: 'steer', threadId: a }, f), /unavailable/);
  queue.expand.attrs['aria-expanded'] = 'true'; queue.card.hidden = true;
  await assert.rejects(desktopOperation({ action: 'steer', threadId: a }, f), /unavailable/);
  assert.equal(queue.buttons[0].clicks + queue.buttons[1].clicks, 0);
});
