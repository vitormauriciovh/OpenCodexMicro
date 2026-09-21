import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { cliBridgeLauncher } from '../src/shared/cli-launcher.mjs';
const exec = promisify(execFile);

test('launcher uses literal paths and serves diagnostics even if daemon startup fails', async t => {
  const dir = await mkdtemp(join(tmpdir(), "ulanzi launcher ' "));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const codex = join(dir, 'codex');
  const bridge = join(dir, 'bridge $(false).mjs');
  const output = join(dir, 'result.json');
  await writeFile(codex, '#!/bin/sh\n[ "$1 $2 $3" = "app-server daemon start" ] || exit 1\nexit 4\n', { mode: 0o700 });
  await writeFile(bridge, `import {writeFileSync} from 'node:fs'; writeFileSync(${JSON.stringify(output)}, JSON.stringify({started:true}));`);
  const launcher = join(dir, 'start.sh');
  await writeFile(launcher, cliBridgeLauncher({ codexPath: codex, nodePath: process.execPath, bridgePath: bridge }));
  const { stderr } = await exec('/bin/sh', [launcher]);
  assert.match(stderr, /could not start/);
  assert.deepEqual(JSON.parse(await readFile(output)), { started: true });
});
