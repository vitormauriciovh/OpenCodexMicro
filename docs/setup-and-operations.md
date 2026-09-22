# Setup and operations

OpenCodexMicro has four Ulanzi Studio plugins and three background bridges:

| Plugin | Application connection | Local endpoint |
| --- | --- | --- |
| Codex App | Codex Desktop through its bridge wrapper | 127.0.0.1:17373 |
| Antigravity | Antigravity Desktop controls plus saved history/artifacts | 127.0.0.1:17374 |
| Codex CLI | Managed app-server over its Unix WebSocket socket | 127.0.0.1:17376 |
| Spotify | macOS player and optional Spotify Web API | 127.0.0.1:17375 |

Requires macOS 13+, Node.js 20+, Ulanzi Studio 3.0.1+, and the applications used by your selected plugins. Antigravity Desktop is required for live task controls; VS Code history alone does not provide those controls.

## Install or update

Install the official standalone Codex CLI before setting up the CLI bridge. This project was verified against version 0.154.0. The npm-only CLI installation does not provide the managed daemon package. See the [official installer documentation](https://learn.chatgpt.com/docs/config-file/environment-variables#installation-variables).

Quit Ulanzi Studio, then run from the repository:

```bash
npm install
npm run check
npm run install:all
npm run setup:all
```

Reopen Ulanzi Studio afterward. Update plugins and bridges together: authenticated bridge versions require matching authenticated plugin clients. Updating only one side can leave the deck offline. The installer preserves each previous plugin under `~/Library/Application Support/OpenCodexMicro/plugin-backups/`, outside Ulanzi's plugin discovery directory.

For individual components:

| Component | Plugin installation | Bridge setup |
| --- | --- | --- |
| Codex App | `npm run install:plugin` | `npm run setup` |
| Antigravity | `npm run install:plugin:antigravity` | `npm run setup:antigravity` |
| Codex CLI | `npm run install:plugin:codexcli` | `npm run setup:codexcli` |
| Spotify | `npm run install:plugin:spotify` | Runs inside the plugin |

Before an agent quits Ulanzi Studio, it must have your permission. Setup restarts the bridge services; it does not launch the Codex Bridge wrapper or quit Codex Desktop.

## Starting applications

Launch Codex Desktop through `~/Applications/Codex Bridge.app` when its local debugging endpoint is not enabled. The wrapper quits and relaunches Codex, so save work before using it. Do not launch it merely to check installation.

Antigravity Desktop publishes its own loopback debugging endpoint. The bridge requires exactly one matching app page and rejects ambiguous targets.

The CLI bridge launcher runs the idempotent `codex app-server daemon start` before starting the bridge. To control the same CLI task from both a terminal and the deck, attach the terminal to that daemon:

```bash
~/.codex/packages/standalone/current/bin/codex --remote unix://
```

Use the explicit standalone path when an npm installation also provides `codex` on your PATH. Select the corresponding session on the deck after opening it. Recent CLI sessions refresh every three seconds without changing the selected task. A plain `codex` terminal uses a separate server; its prompts do not stream to this bridge. A task owned by that separate running process can appear in history but refuse writes with `already has an active writer`. Exit that terminal session normally before resuming the same task through the shared daemon; opening a new shared session does not require closing it.

The inspector explains access errors per task; daemon connectivity and other tasks remain usable. The Attention button counts approval requests, not running tasks, and displays `No pending approvals` at zero. Model, reasoning and Fast changes apply to the next prompt sent from the deck and are displayed as pending until submitted.

A CLI opened in VS Code can be reported with `source: vscode`, even with `--remote unix://`. The bridge therefore includes interactive tasks returned by the shared daemon's `thread/loaded/list`, alongside recent CLI history. The source label alone does not establish which process owns the task. At startup, the bridge prefers the most recently updated loaded task; subsequent discovery preserves the selected task.

## Diagnostics

```bash
node scripts/bridge-status.mjs codex health
node scripts/bridge-status.mjs antigravity health
node scripts/bridge-status.mjs codex-cli health
node scripts/bridge-status.mjs spotify health
```

Use `state` instead of `health` for detailed status. Diagnostics supply the private local credential automatically. Unauthenticated HTTP requests return 403; never place the token in a browser inspector or URL.

Runtime directories are component-specific:

```text
~/Library/Application Support/OpenCodexMicro/codex/
~/Library/Application Support/OpenCodexMicro/antigravity/
~/Library/Application Support/OpenCodexMicro/codex-cli/
```

Logs are `bridge.log` / `bridge-error.log`, `bridge-antigravity.log` / `bridge-antigravity-error.log`, and `bridge-codex-cli.log` / `bridge-codex-cli-error.log` in the corresponding directory. LaunchAgent labels are `io.opencodexmicro.bridge`, `io.openantigravitymicro.bridge`, and `io.opencodexmicro.codexcli.bridge`.

If the bridge is online but a control is unavailable, inspect application connectivity, selected task, and the reported action error. Empty quota/context values mean unknown. See [feature parity](feature-parity.md) for application-specific differences and validation limits.

## Removal

`npm run uninstall` removes Codex App and its bridge only. `npm run uninstall:all` explicitly removes all project components. The separate official Codex CLI installation is not removed.
