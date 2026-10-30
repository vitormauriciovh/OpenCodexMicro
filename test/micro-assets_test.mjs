import assert from 'node:assert/strict';
import test from 'node:test';
import { discoverMicroAssets, initializeMicroSignals } from '../src/bridge/codex-cdp.mjs';

test('discovers lazy signals after startup resources have been evicted', async () => {
  const base = 'app://-/assets/';
  const files = {
    'index-abc.js': 'import("./app-main-def.js")',
    'app-main-def.js': 'import("./app-runtime-ghi.js")',
    'app-runtime-ghi.js': 'import("./app-primary-jkl.js")',
    'app-primary-jkl.js': 'import("./codex-micro-bridge-mno.js"); import("./codex-micro-slot-signals-pqr.js")'
  };
  const reads = [];
  const urls = await discoverMicroAssets([base + 'index-abc.js'], async (url) => {
    reads.push(url);
    assert.ok(url.startsWith(base));
    return files[url.slice(base.length)];
  });
  assert.ok(urls.includes(base + 'codex-micro-slot-signals-pqr.js'));
  assert.equal(reads.length, 4);
});

test('bounds discovery and tolerates unavailable entry chunks', async () => {
  let reads = 0;
  const urls = Array.from({ length: 30 }, (_, i) => `app://-/assets/app-main-${i}.js`);
  await discoverMicroAssets(urls, async () => { reads++; throw new Error('missing'); });
  assert.equal(reads, 16);
});

test('initializes live resolver exports without calling exported actions', () => {
  let resolver;
  let actions = 0;
  const lazy = (initialize) => () => { initialize(); };
  function initialize() {
    return (initialize = lazy((() => {
      resolver = { resolve() {}, createSubscriberAtom() {} };
    })))();
  }
  const signals = { initialize, action() { actions++; }, get resolver() { return resolver; } };
  initializeMicroSignals(signals);
  assert.equal(typeof resolver.resolve, 'function');
  initializeMicroSignals(signals);
  assert.equal(actions, 0);
});
