const quote = value => `'${String(value).replaceAll("'", "'\\''")}'`;

export function cliBridgeLauncher({ codexPath, nodePath, bridgePath }) {
  // Daemon start is idempotent. Keep the bridge available for diagnostics if
  // the dependency needs repair, and let launchd supervise the bridge itself.
  return `#!/bin/sh
${quote(codexPath)} app-server daemon start || echo 'Codex CLI daemon could not start; inspect its installation.' >&2
exec ${quote(nodePath)} ${quote(bridgePath)}
`;
}
