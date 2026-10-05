import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { EventEmitter } from 'node:events';
import vm from 'node:vm';
import * as runtime from '../../src/shared/plugin-runtime.mjs';
import { textCard, usageCard } from '../../src/shared/deck-cards.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const settle = async () => { for (let i = 0; i < 15; i++) await Promise.resolve(); };
export async function pluginSmoke(name) {
  const sourcePath = resolve(root, `integration/com.ulanzi.${name}.ulanziPlugin/plugin/app.js`);
  const manifest = JSON.parse(readFileSync(resolve(dirname(sourcePath), '../manifest.json')));
  const calls = [], sockets = [], timers = [], sent = [];
  let failAction = false;
  const state = { capabilities: { queue: true }, connected: true, selectedThreadId: 'thread-2', slots: Array.from({ length: 6 }, (_, id) => ({ id, threadKey: `thread-${id}`, title: `Task ${id}`, status: 'idle' })), activeTasks: [], usage: { windows: [] } };
  if (name === 'codexcli') state.lastTask = { ...state.slots[2], controllable: true, activeTurnId: 'turn-2', pendingApprovalCount: 1, pendingApprovalId: 'approval-2' };
  const music = { isRunning: true, playerState: 'playing', soundVolume: 40, track: { name: 'A & B', spotifyUrl: 'spotify:track:0123456789abcdefghijkl' } };
  const catalog = Array.from({ length: 10 }, (_, i) => ({ title: `List ${i}`, uri: 'spotify:playlist:0123456789abcdefghijkl' }));
  const record = async (operation, ...args) => { calls.push([operation, ...args]); if (failAction) throw new Error('Fixture action failed'); };
  class Socket extends EventEmitter {
    static OPEN = 1;
    constructor() { super(); this.readyState = 0; sockets.push(this); }
    send(raw) { assert.equal(this.readyState, 1); sent.push(JSON.parse(raw)); }
    close() { this.readyState = 3; this.emit('close'); }
    open() { this.readyState = 1; this.emit('open'); }
    message(message) { this.emit('message', JSON.stringify(message)); }
  }
  const timer = (fn, ms) => { const value = { fn, ms, unref() {} }; timers.push(value); return value; };
  const sandbox = {
    ...runtime, textCard, usageCard, Buffer, URL, AbortSignal, console, WebSocket: Socket, dirname, resolve, readFileSync,
    process: { argv: ['node', sourcePath], env: {}, on() {}, exit() {} },
    setTimeout: timer, setInterval: timer, clearTimeout() {}, clearInterval() {},
    bridgeFeed: () => ({ start() {}, stop() {} }),
    localClient: () => async (path, options) => {
      if (path === '/state') return state;
      await record(path, options); return { ok: true };
    },
    secureHandler: (_component, _port, handler) => handler,
    createServer: () => ({ on() {}, listen() {}, close() {} }),
    SpotifyLocalController: class {
      async getState() { return music; }
      playPause() { return record('playPause'); }
      next() { return record('next'); }
      previous() { return record('previous'); }
      toggleShuffle() { return record('shuffle'); }
      toggleRepeat() { return record('repeat'); }
      playUri(uri) { return record('playUri', uri); }
      changeVolume(delta) { return record('volume', delta); }
    },
    SpotifyApiClient: class {
      async loadResolvedPlaylists() { return catalog; }
      async getCoverBase64() { return null; }
      saveTrack(uri) { return record('like', uri); }
    }
  };
  const context = vm.createContext(sandbox);
  // Execute the complete entry point with injected platform dependencies; no real
  // applications, network connections, personal history or timers are accessed.
  vm.runInContext(readFileSync(sourcePath, 'utf8').replace(/^import .*;\n/gm, ''), context, { filename: sourcePath });
  sockets[0].open(); await settle();
  const message = (action, cmd, extra = {}) => ({ cmd, uuid: `${manifest.UUID}.${action}`, actionid: action, key: action, ...extra });
  for (const action of manifest.Actions) sockets[0].message(message(action.UUID.split('.').pop(), 'add'));
  await settle();
  for (const action of manifest.Actions) assert.ok(sent.some(m => m.cmd === 'state' && m.param.statelist.some(s => s.uuid === action.UUID)), `${name}: no rendering for ${action.UUID}`);
  sent.length = 0;
  sockets[0].close(); timers.findLast(t => t.ms === 1000 && t.fn.name === 'connect').fn();
  sockets[1].open(); await settle();
  for (const action of manifest.Actions) assert.ok(sent.some(m => m.cmd === 'state' && m.param.statelist.some(s => s.uuid === action.UUID)), `${name}: unchanged display not replayed for ${action.UUID}`);
  const host = sockets[1];
  if (name === 'codexcli') {
    // Attention counts tasks; approval readiness still belongs to the selected task.
    const renderAttention = count => {
      sent.length = 0;
      state.pendingAttentionCount = count;
      vm.runInContext('renderAll()', context);
      const display = sent.flatMap(m => m.param?.statelist || []).find(s => s.uuid.endsWith('.attention') && s.type === 1);
      assert.ok(display, 'approval count change must update the deck');
      return Buffer.from(display.data.split(',')[1], 'base64').toString();
    };
    assert.match(renderAttention(1), /Select pending task/);
    const idle = renderAttention(0);
    assert.match(idle, /No tasks need attention/);
    assert.doesNotMatch(idle, /Select pending task/);

    const selected = state.lastTask;
    state.monitorTasks = [
      { threadKey: 'running-a', title: 'Running A', status: 'working', contextPercent: 0 },
      { threadKey: 'running-b', title: 'Running B', status: 'attention', attentionReason: 'question', contextPercent: 25 }
    ];
    vm.runInContext('renderAll()', context);
    host.message(message('taskmonitor', 'add', { actionid: 'second-monitor', key: 'second-monitor' }));
    vm.runInContext('instances.get("taskmonitor").monitorRotatedAt = Date.now() - 3000; renderAll()', context);
    assert.equal(vm.runInContext('instances.get("taskmonitor").displayedThreadId', context), 'running-b');
    assert.equal(vm.runInContext('instances.get("second-monitor").displayedThreadId', context), 'running-a');
    calls.length = 0;
    host.message(message('taskmonitor', 'keydown')); await settle();
    host.message(message('taskmonitor', 'keyup')); await settle();
    assert.equal(calls.length, 1);
    assert.equal(calls[0][0], '/action/select');
    assert.equal(JSON.parse(calls[0][1].body).threadId, 'running-b', 'monitor selects its displayed task, not the globally selected task');
    host.message(message('taskmonitor', 'keydown', { actionid: 'second-monitor', key: 'second-monitor' })); await settle();
    assert.equal(JSON.parse(calls[1][1].body).threadId, 'running-a');
    const svg = expression => Buffer.from(vm.runInContext(expression, context).split(',')[1], 'base64').toString();
    assert.match(svg('queueIconData(true)'), /#3b82f6/);
    assert.doesNotMatch(svg('queueIconData(false)'), /#3b82f6|#2563eb/);
    state.capabilities.queue = false;
    calls.length = 0;
    host.message(message('queue', 'keydown')); await settle();
    assert.equal(calls.length, 0, 'unavailable Continue must not send a prompt');
    state.capabilities.queue = true;
    assert.match(svg('sessionCardIconData({contextPercent: 0})'), /ctx 0%/);
    assert.match(svg('sessionCardIconData({})'), /ctx —/);
    assert.match(svg('sessionCardIconData({status: "attention", attentionReason: "question"})'), /question/);
    assert.match(svg('sessionCardIconData({status: "error"})'), /#ef4444/);
    for (const selected of [false, true]) {
      const working = svg(`sessionCardIconData({status: "working", selected: ${selected}})`);
      assert.match(working, /fill="#22c55e"/);
      assert.match(working, /stroke="#16a34a"/);
      const attention = svg(`sessionCardIconData({status: "attention", selected: ${selected}})`);
      assert.match(attention, /fill="#f59e0b"/);
      assert.match(attention, /stroke="#d97706"/);
      const done = svg(`sessionCardIconData({status: "completed", selected: ${selected}})`);
      assert.match(done, /fill="#3b82f6"/);
      assert.match(done, /stroke="#262c36"/);
    }
    state.lastTask = { ...selected, pendingApprovalCount: 0, pendingApprovalId: null, attentionReason: 'question' };
    calls.length = 0;
    host.message(message('approve', 'keydown')); await settle();
    assert.equal(calls.length, 0, 'questions must never dispatch approval responses');
    state.lastTask = selected;
    host.message(message('approve', 'keydown')); await settle();
    assert.deepEqual(JSON.parse(calls[0][1].body), { threadId: 'thread-2', requestId: 'approval-2' });
    calls.length = 0;
    host.message(message('stop', 'keydown')); await settle();
    assert.deepEqual(JSON.parse(calls[0][1].body), { threadId: 'thread-2', expectedTurnId: 'turn-2' });
    state.monitorTasks = [];
    vm.runInContext('renderAll()', context);
  }
  if (name === 'spotify') {
    const expected = { nowplaying: 'playPause', playpause: 'playPause', next: 'next', prev: 'previous', like: 'like', shuffle: 'shuffle', repeat: 'repeat' };
    for (const action of manifest.Actions) {
      const key = action.UUID.split('.').pop();
      if (key.startsWith('item')) expected[key] = 'playUri';
      if (!expected[key]) continue; // Encoder controls are exercised separately.
      calls.length = 0; host.message(message(key, 'keydown')); await settle();
      assert.equal(calls[0]?.[0], expected[key], `Spotify ${key} dispatch`);
      host.message(message(key, 'keyup')); await settle(); assert.equal(calls.length, 1);
    }
    calls.length = 0;
    host.message(message('volume', 'dialrotate', { rotateEvent: 'left' })); await settle();
    host.message(message('volume', 'dialrotate', { rotateEvent: 'right' })); await settle();
    assert.deepEqual(calls, [['volume', -4], ['volume', 4]]);
    for (let i = 0; i < 30; i++) host.message(message('scroll', 'dialrotate', { rotateEvent: 'right' }));
    assert.equal(vm.runInContext('playlistOffset', context), 9);
    const svg = vm.runInContext('renderPlaylistItemSvg({title:"&&&&&&&&&&&&&&&&&&&&"})', context);
    assert.match(Buffer.from(svg.split(',')[1], 'base64').toString(), /(?:&amp;){15}…/);
  } else {
    for (const action of manifest.Actions) {
      const key = action.UUID.split('.').pop();
      calls.length = 0; host.message(message(key, 'keydown')); await settle();
      const slot = /^task([1-6])$/.exec(key);
      const expected = slot ? `/task/${Number(slot[1]) - 1}/click` : name === 'codexcli' ? (['tokens', 'status', 'usage', 'usage5h', 'usageweekly'].includes(key) ? null : `/action/${key === 'taskmonitor' ? 'select' : key}`) : ['usage', 'usage5h', 'usageweekly', 'tokens', 'hud', 'subagents'].includes(key) ? '/focus' : key === 'navigate' ? '/task/0/click' : `/action/${key}`;
      assert.equal(calls[0]?.[0] || null, expected, `${name} ${key} dispatch`);
      if (slot) assert.equal(JSON.parse(calls[0][1].body).threadId, `thread-${Number(slot[1]) - 1}`);
      const count = calls.length; host.message(message(key, 'keyup')); await settle(); assert.equal(calls.length, count);
    }
    if (name === 'antigravity') {
      calls.length = 0; host.message(message('navigate', 'dialrotate', { rotateEvent: 'left' })); await settle();
      assert.equal(calls[0][0], '/scroll/up');
      const image = vm.runInContext('singleUsageIconData({remaining:null,connected:true})', context);
      assert.doesNotMatch(Buffer.from(image.split(',')[1], 'base64').toString(), /RESET [57][HD]/);
    }
  }
  failAction = true; sent.length = 0;
  host.message(message(name === 'spotify' ? 'next' : name === 'antigravity' ? 'proceed' : 'approve', 'keydown')); await settle();
  assert.ok(sent.some(m => m.cmd === 'showAlert'), `${name}: failure not surfaced`);
  const count = calls.length; sockets[0].message(message('next', 'keydown')); await settle();
  assert.equal(calls.length, count, 'obsolete host must not dispatch actions');
  console.log(`${name}: manifest actions, reconnect, errors and controls passed`);
}
