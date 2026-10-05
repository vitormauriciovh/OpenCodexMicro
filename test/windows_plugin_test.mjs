import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, readdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, basename } from 'node:path';
import { installWindowsPlugin } from '../src/platform/windows/plugin-installer.mjs';
import { platformPaths } from '../src/platform/paths.mjs';

test('Windows plugin install preserves the old package, copies its runtime and rejects incomplete updates', async t => {
  const home = await mkdtemp(join(tmpdir(), 'ulanzi-windows-package-'));
  t.after(() => rm(home, { recursive: true, force: true }));
  const source = join(home, 'source/com.ulanzi.codexcli.ulanziPlugin');
  for (const directory of ['assets/icons', 'dist', 'property-inspector', 'installer']) await mkdir(join(source, directory), { recursive: true });
  const manifest = { UUID: 'com.ulanzi.ulanzistudio.codexcli', CodePath: 'dist/app.js', OS: [{ Platform: 'win', MinimumVersion: '10.0' }], Actions: [{ PropertyInspectorPath: 'property-inspector/setup.html' }] };
  await writeFile(join(source, 'manifest.json'), JSON.stringify(manifest));
  for (const locale of ['en', 'zh_CN', 'zh_HK', 'ja_JP', 'de_DE', 'ko_KR', 'pt_PT', 'es_ES']) await writeFile(join(source, `${locale}.json`), JSON.stringify({ Name: 'fixture', Description: 'fixture' }));
  for (const file of ['dist/app.js', 'property-inspector/setup.html', 'property-inspector/inspector-api.js', 'installer/bridge-codex-cli.mjs', 'WINDOWS.md']) await writeFile(join(source, file), 'fixture');
  const paths = platformPaths({ platform: 'win32', home, env: {} });
  const destination = join(paths.plugins, basename(source));
  await mkdir(destination, { recursive: true }); await writeFile(join(destination, 'old.txt'), 'old package');
  const result = await installWindowsPlugin(source, 'codexcli', { home, env: {} });
  assert.equal(result.destination, destination);
  assert.equal(await readFile(join(result.backup, 'old.txt'), 'utf8'), 'old package');
  assert.equal(await readFile(join(destination, 'installer/bridge-codex-cli.mjs'), 'utf8'), 'fixture');
  assert.deepEqual(await readdir(paths.plugins), [basename(source)]);
  await rm(join(source, 'dist/app.js'));
  await assert.rejects(installWindowsPlugin(source, 'codexcli', { home, env: {} }), { code: 'ENOENT' });
  assert.equal(await readFile(join(destination, 'dist/app.js'), 'utf8'), 'fixture');
});
