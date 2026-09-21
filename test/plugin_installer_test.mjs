import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { installPlugin, preflightPlugin } from '../src/shared/plugin-installer.mjs';

async function fixture(t) {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'plugin-install-'));
  t.after(() => fs.rm(home, { recursive: true, force: true }));
  const source = path.join(home, 'source/com.ulanzi.spotify.ulanziPlugin');
  for (const folder of ['assets/icons', 'dist', 'property-inspector']) await fs.mkdir(path.join(source, folder), { recursive: true });
  await fs.writeFile(path.join(source, 'manifest.json'), JSON.stringify({ UUID: 'com.ulanzi.ulanzistudio.spotify', CodePath: 'dist/app.js', Actions: [{ PropertyInspectorPath: 'property-inspector/setup.html' }] }));
  for (const locale of ['en', 'zh_CN', 'zh_HK', 'ja_JP', 'de_DE', 'ko_KR', 'pt_PT', 'es_ES']) await fs.writeFile(path.join(source, locale + '.json'), JSON.stringify({ Name: 'Fixture', Description: 'Fixture plugin' }));
  for (const file of ['property-inspector/setup.html', 'property-inspector/inspector-api.js']) await fs.writeFile(path.join(source, file), 'fixture');
  const destination = path.join(home, 'Library/Application Support/Ulanzi/UlanziDeck/Plugins', path.basename(source));
  await fs.mkdir(destination, { recursive: true });
  await fs.writeFile(path.join(destination, 'old.txt'), 'last good install');
  return { home, source, destination };
}
test('plugin installation builds missing dist before preflight and replaces complete package', async t => {
  const { home, source, destination } = await fixture(t);
  let built = false;
  const installed = await installPlugin(source, 'spotify', { home, execute(_program, args, options) {
    assert.deepEqual(args, ['build.mjs']); assert.equal(options.cwd, source); built = true;
    writeFileSync(path.join(source, 'dist/app.js'), 'new bundle');
  } });
  assert.equal(built, true); assert.equal(installed, destination);
  assert.equal(await fs.readFile(path.join(destination, 'dist/app.js'), 'utf8'), 'new bundle');
  await assert.rejects(fs.access(path.join(destination, 'old.txt')), { code: 'ENOENT' });
  assert.deepEqual(await fs.readdir(path.dirname(destination)), [path.basename(destination)]);
  const backups = path.join(home, 'Library/Application Support/OpenCodexMicro/plugin-backups');
  const entries = await fs.readdir(backups);
  assert.equal(entries.length, 1);
  assert.equal(await fs.readFile(path.join(backups, entries[0], 'old.txt'), 'utf8'), 'last good install');
});
test('missing artifacts or failed build preserve the installed plugin', async t => {
  const { home, source, destination } = await fixture(t);
  await assert.rejects(installPlugin(source, 'spotify', { home, build: false }), { code: 'ENOENT' });
  await assert.rejects(installPlugin(source, 'spotify', { home, execute() { throw new Error('Build failed'); } }), /Build failed/);
  assert.equal(await fs.readFile(path.join(destination, 'old.txt'), 'utf8'), 'last good install');
  await fs.writeFile(path.join(source, 'dist/app.js'), 'bundle');
  await fs.rm(path.join(source, 'property-inspector/inspector-api.js'));
  await assert.rejects(preflightPlugin(source, 'spotify'), { code: 'ENOENT' });
  assert.equal(await fs.readFile(path.join(destination, 'old.txt'), 'utf8'), 'last good install');
});
