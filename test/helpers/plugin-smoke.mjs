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
  const state = { connected: true, selectedThreadId: 'thread-2', slots: Array.from({ length: 6 }, (_, id) => ({ id, threadKey: `thread-${id}`, title: `Task ${id}`, status: 'idle' })), activeTasks: [], usage: { windows: [] } };
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
    // Inspect rendered messages, covering both zero and nonzero approval counts.
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
    assert.match(idle, /No pending approvals/);
    assert.doesNotMatch(idle, /Select pending task/);
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
      const expected = slot ? `/task/${Number(slot[1]) - 1}/click` : name === 'codexcli' ? (['tokens', 'status', 'taskmonitor', 'usage', 'usage5h', 'usageweekly'].includes(key) ? null : `/action/${key}`) : ['usage', 'usage5h', 'usageweekly', 'tokens', 'hud', 'subagents'].includes(key) ? '/focus' : key === 'navigate' ? '/task/0/click' : `/action/${key}`;
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
