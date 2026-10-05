# OpenCodexMicro — Codex operating guide

Repository instructions for coding, review, diagnostics and installation. Run
commands from the repository root. Load only the references relevant to the task.

## Start with the affected component

- Check `git status --short` and preserve existing work. Use `rg` to locate the
  relevant handler, its callers and its tests before expanding the search.
- Use source code, manifests and `package.json` to establish current behavior.
  Report any discrepancy with the documentation explicitly.
- Edit canonical sources, validate the affected behavior, and inspect the final
  diff. Report what changed, checks actually run and any unverified behavior.
- Parallelize independent investigation when useful. Keep overlapping edits,
  builds and operations on installed applications sequential.
- Documentation-only work needs path/link/command checks and `git diff --check`;
  it does not require installing components or rebuilding the application.

## Runtime map and source ownership

Windows additions live under `src/platform/`, `scripts/windows.mjs` and
`scripts/build-windows.mjs`. See [Windows setup](docs/windows.md). Windows
commands are opt-in and generate separate `dist/windows/` packages. Keep macOS
manifests and launchd scripts intact. Never install a virtual device driver or
change boot policy as a fallback for an incompatible Codex App CDP endpoint.
The Windows CLI transport is authenticated loopback WebSocket; macOS retains
WebSocket over its Unix socket. `npm run check:windows` covers Windows-specific
fixtures, package validation and generated-plugin smoke tests. The CI matrix
runs both checks on Windows and macOS; local Windows results do not certify Mac.

Ulanzi Studio owns the physical device. There are four plugins and three
background bridges. All HTTP endpoints below bind to `127.0.0.1` by default;
each developer bridge serves WebSocket `/events` on its own HTTP port.

| Component | Source and application connection | Local port | Plugin directory under `integration/` |
| --- | --- | --- | --- |
| Codex App | `src/bridge/`; Desktop renderer via CDP `127.0.0.1:9222` | `17373` | `com.ulanzi.codexmicro.ulanziPlugin/` |
| Antigravity | `src/bridge-antigravity/`; Desktop controls plus saved history/artifacts | `17374` | `com.ulanzi.antigravity.ulanziPlugin/` |
| Codex CLI | `src/bridge-codex-cli/`; managed app-server via Unix WebSocket | `17376` | `com.ulanzi.codexcli.ulanziPlugin/` |
| Spotify | Plugin-local macOS player and optional Spotify Web API | `17375` | `com.ulanzi.spotify.ulanziPlugin/` |

The Ulanzi-maintained implementation scope is limited to
`integration/com.ulanzi.codexmicro.ulanziPlugin/`. The plugins consume state
and action interfaces exposed by the existing Bridges. Ulanzi did not design,
specify, develop, or maintain CDP or Codex's CDP implementation. Read
[NOTICE.md](NOTICE.md) before making attribution or responsibility claims.
Preserve [LICENSE](LICENSE) and [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
Do not restore or invoke the removed Python/D200 standalone runtime. Files under
`poc/` are unsupported experiments, outside the build and installation workflow.

| Task | Start here |
| --- | --- |
| Codex task discovery, routing or actions | `src/bridge/codex-cdp.mjs`, `server.mjs`, `thread-key.mjs` |
| Codex attention, approval indicators or model selection | `src/bridge/task-attention.mjs`, `model-picker.mjs`; Codex plugin `plugin/approval-state.js` |
| Antigravity live controls vs. saved history | `src/bridge-antigravity/desktop-client.mjs`, `desktop-state.mjs`, `state-reader.mjs`, `server.mjs` |
| CLI protocol, ownership, drafts or goals | `src/bridge-codex-cli/app-server-client.mjs`, `actions.mjs`, `server.mjs`; `src/shared/cli-launcher.mjs` |
| Spotify playback, catalog or credentials | Spotify plugin `plugin/spotify-local.js`, `spotify-api.js`, `app.js`; `src/shared/spotify-uri.mjs`, `storage.mjs` |
| Keys, encoders, display or settings | Affected plugin's `plugin/app.js`, `manifest.json`, `property-inspector/setup.html` and locale JSON files |
| Shared lifecycle, rendering or authentication | `src/shared/plugin-runtime.mjs`, `deck-cards.mjs`, `token-metrics.mjs`, `local-api.mjs`, `inspector-api.js`, `prompt-shortcuts.mjs` |
| Installation or removal | `scripts/install*.mjs`, `scripts/uninstall.mjs`, `src/shared/plugin-installer.mjs`, `bridge-files.mjs`; Codex plugin `plugin/bridge-installer.js` |

### Generated files

Edit `src/`, plugin `plugin/` sources and build scripts; do not patch bundles.
Bridge builds write root `dist/*.mjs`. Plugin builds write CommonJS
`dist/app.js` and `dist/package.json` despite the source packages using ESM.

The Codex App plugin build also generates `installer/bridge.mjs` and copies the
icon and root legal notices into `installer/`. The other three plugin builds
copy `src/shared/inspector-api.js` into `property-inspector/inspector-api.js`.
These copies, the Codex plugin bundle and its installer assets are tracked;
root bridge outputs and other plugins' `dist/` directories are ignored.
Build only the affected components during iteration and inspect generated
diffs before delivery. Regenerate tracked outputs when their sources change.

## Behavioral invariants

- **Exact task identity:** keep renderer task order, host assignment and
  `client-new-thread:<uuid>` aliases until promotion. Actions target the displayed
  task and expected turn; recheck selection before mutations. Preserve drafts.
- **Attention is not approval:** user questions and errors can require attention.
  Codex Approve/Reject indicators use `hasSelectedApproval` for the selected task;
  a global attention count is insufficient. Reject and Stop remain distinct.
- **No duplicate actions:** preserve required down/up pairs and never replay a
  mutation after a timeout or uncertain response. Unavailable or ambiguous
  controls must fail explicitly rather than target the foreground application.
- **State and rendering:** serve cached `/state`; do not trigger renderer
  discovery or polling from `/state` requests. Preserve context-keyed action
  instances, replay displays on reconnect, bound caches and prevent stale async renders.
- **Metrics:** unknown stays unknown; measured zero stays zero. Do not infer
  quotas from activity or substitute cumulative tokens for context usage.
- **Platform limits:** CLI uses WebSocket framing over its Unix socket, not raw
  JSONL. Respect tasks owned by another writer. Antigravity Boost/Grill-me/Goal
  are explicitly unavailable; do not invent slash-command fallbacks.
- **Local API:** retain loopback binding, private bearer credentials, Host/Origin
  validation and bounded input. Inspector requests use the native plugin relay;
  never expose credentials in HTML, URLs or logs. Preserve Spotify URI validation,
  fixed-script arguments and last-good catalog on failed refreshes.
- **Distribution:** keep manifest UUIDs, CodePath, assets, inspectors and all eight
  locales consistent: `en`, `zh_CN`, `zh_HK`, `ja_JP`, `de_DE`, `ko_KR`, `pt_PT`, `es_ES`.

## Development and proportional verification

Use Node.js 20+ and npm. When dependencies need installation, use the root
lockfile with `npm ci`; do not reinstall dependencies on every task. This is
JavaScript ESM with Node's test runner and esbuild; no lint/typecheck script is
provided. `.github/workflows/platform-checks.yml` checks Windows and macOS.

For source changes, start with the relevant tests below (`node --test` followed
by the listed paths), then build/check the affected plugin. Build its bridge
when bridge sources change. Shared changes require coverage of their consumers.

| Area | Targeted test paths | Plugin build, then validation |
| --- | --- | --- |
| Codex App / bridge | `test/bridge_test.mjs test/model_picker_test.mjs test/task_attention_test.mjs` | `npm run build:plugin` then `npm run check:plugin` |
| Antigravity | `test/antigravity_bridge_test.mjs test/antigravity_desktop_test.mjs` | `npm run build:antigravity:plugin` then `npm run check:antigravity:plugin` |
| Codex CLI | `test/codex_cli*_test.mjs test/cli_launcher_test.mjs` | `npm run build:codexcli:plugin` then `npm run check:codexcli:plugin` |
| Spotify | `test/spotify_test.mjs` | `npm run build:spotify:plugin` then `npm run check:spotify:plugin` |
| Shared API/runtime | `test/shared_runtime_test.mjs` plus affected component tests | Relevant plugin builds/checks above |
| Installers/removal | `test/plugin_installer_test.mjs test/bridge-installer_test.mjs test/cli_launcher_test.mjs` | Affected build/check; no real installation required |

Bridge build commands are `npm run build:bridge`, `npm run build:antigravity:bridge`
and `npm run build:codexcli:bridge`. The Codex plugin smoke suite reads its
distributed bundle, so build it before relying on that smoke result.

- `npm test` runs all root `test/*_test.mjs` files.
- `npm run check:node` checks a fixed subset; use `node --check path/to/changed.js`
  (or `.mjs`) for changed source files outside that list.
- `npm run check` is the full gate: root tests, syntax, seven builds and all four
  plugin checks/smokes. Use it for cross-component changes and release validation,
  not every small iteration. **It writes generated files.**
- Fixtures use temporary storage, mocks and local servers; some tests need
  loopback/Unix-socket access. Report sandbox restrictions separately from failures.
  Passing fixtures do not prove live app or physical deck behavior.
- Do not import runtime entrypoints to inspect them: importing
  `src/bridge/server.mjs` starts a server. Read the source or use syntax checks.

## Required setup routing

This section applies when asked to install, configure, repair or start components,
not to ordinary code or documentation review. Runtime setup requires macOS 13+,
Node.js 20+, Ulanzi Studio 3.0.1+ and the relevant application.

1. Inspect installed `manifest.json` files under
   `~/Library/Application Support/Ulanzi/UlanziDeck/Plugins/`. Check the target
   UUID below and verify its `CodePath` exists inside that plugin directory.
   A repository checkout or matching directory name does not prove installation.
2. For Codex plugin installation read
   [install-ulanzi-studio-plugin](skills/install-ulanzi-studio-plugin/SKILL.md);
   for Codex bridge setup read
   [setup-codex-bridge](skills/setup-codex-bridge/SKILL.md). Preserve their scope,
   application-shutdown and authorization boundaries.
3. Do not reinstall a valid plugin unless the user requests update or repair.
   If Studio is running, obtain permission before quitting it or ask the user to
   quit it. Reopen it after replacement to load the new plugin.

| Component | Manifest UUID | Plugin installation | Bridge setup |
| --- | --- | --- | --- |
| Codex App | `com.ulanzi.ulanzistudio.codexmicro` | `npm run install:plugin` | `npm run setup` |
| Antigravity | `com.ulanzi.ulanzistudio.antigravity` | `npm run install:plugin:antigravity` | `npm run setup:antigravity` |
| Spotify | `com.ulanzi.ulanzistudio.spotify` | `npm run install:plugin:spotify` | Runs inside the plugin |
| Codex CLI | `com.ulanzi.ulanzistudio.codexcli` | `npm run install:plugin:codexcli` | `npm run setup:codexcli` |

Use `npm run install:all` for all four plugins and `npm run setup:all` for all
three bridges only when that scope is requested. Installer scripts build before
preflight/replacement by default. `install:all` completes all builds/preflights
before the first replacement; rollback/backups are per plugin, not a global
transaction. Backups live outside Studio discovery in
`~/Library/Application Support/OpenCodexMicro/plugin-backups/`.

The Codex plugin installation skill uses the prebuilt-only path: verify the
bundle and installer assets, then use `ULANZI_PREBUILT=1 npm run install:plugin`.
Do not use this flag to install stale outputs after source changes.

Setup writes application/LaunchAgent files and normally restarts bridge services.
It does not launch the Codex wrapper. `npm run bridge:start` opens
`~/Applications/Codex Bridge.app`, which quits and relaunches Codex; launch only
when requested and after the user has had a chance to save work. Do not launch
it merely to verify installation. Use `npm run setup -- --no-start` only when
the user wants the Codex sidecar installed but stopped.

For CLI setup, verify the standalone managed daemon installation using
`src/shared/cli-launcher.mjs` and [setup and operations](docs/setup-and-operations.md).
A plain terminal `codex` process is not necessarily attached to the shared daemon.

### Diagnostics and completion

Use `node scripts/bridge-status.mjs <component> health` or `state`, with
`codex`, `antigravity`, `codex-cli` or `spotify`. This supplies authentication;
old bare `curl` examples return 403. Spotify diagnostics use `/status` internally.
The helper may create a missing local token and adjust private file permissions;
do not run it for a strictly static review or print credential files.

Report separately: plugin manifest/files, bridge/service health, application
connection, and any observed Studio/device behavior. Inspect component logs under
`~/Library/Application Support/OpenCodexMicro/{codex,antigravity,codex-cli}/`.
For authentication changes, update matching plugin and bridge versions together.
Do not use personal tasks for live Approve/Reject/Stop/Submit, goals or microphone
tests; use deliberately selected disposable tasks within the authorized scope.
See [capabilities and acceptance](docs/feature-parity.md) for remaining live checks.

Run removal only when explicitly requested: `npm run uninstall` removes Codex App
and its bridge; `npm run uninstall:all` removes all project components. Preserve
sibling runtimes, backups and unrelated files during component work.

## Documentation routing

- Project overview: [README](README.md), with a [Chinese summary](README_zh.md).
- Installation, configuration and diagnostics:
  [setup and operations](docs/setup-and-operations.md).
- Capabilities, platform limits and live acceptance:
  [feature parity](docs/feature-parity.md).
- Keep instructions in this guide and operational details in the linked
  references. Update them when contracts change; avoid parallel copies of the
  same guidance. Preserve legal notices and their required distribution copies.
