import { localClient } from '../src/shared/local-api.mjs';
const ports = { codex: 17373, antigravity: 17374, 'codex-cli': 17376, spotify: 17375 };
const [component = 'codex', mode = 'health'] = process.argv.slice(2);
if (!(component in ports) || !['health', 'state'].includes(mode)) {
  console.error('Usage: node scripts/bridge-status.mjs [codex|antigravity|codex-cli|spotify] [health|state]');
  process.exitCode = 1;
} else {
  try {
    const request = localClient(component, `http://127.0.0.1:${ports[component]}`);
    const result = await request(component === 'spotify' ? '/status' : `/${mode}`);
    console.log(JSON.stringify(component === 'spotify' && mode === 'health' ? { ok: true, applicationRunning: result.state?.isRunning ?? null, catalogItems: result.playlists?.length ?? 0 } : result, null, 2));
  } catch (error) { console.error(`${component}: ${error.message}`); process.exitCode = 1; }
}
