# Windows distribution (experimental)

Windows packages are generated separately under `dist/windows/`. The source
macOS manifests, launchd installers, application wrapper and npm setup commands
remain in place. Windows commands refuse to run on macOS. This branch does not
install, stop or upgrade anything until an installation command is explicitly run.

Requires Windows 10/11, Node.js 20+, Ulanzi Studio 3.0.1+ and the desired apps.
Spotify remains macOS-only and is excluded from the Windows build.

## Application limits

- **Codex CLI:** a dedicated authenticated app-server on `127.0.0.1:17377`.
  Requires a `codex.exe` supporting `--ws-auth capability-token` and
  `--ws-token-file`; setup checks these flags. The bridge uses port 17376.
  Terminal sessions must explicitly connect to this server to share live state.
  This does not take ownership of sessions from other running CLI servers.
- **Antigravity:** bridge on port 17374. Saved history uses the existing
  `.gemini/antigravity/brain` path. Live controls require a compatible Desktop
  renderer with `DevToolsActivePort` under `%APPDATA%\Antigravity`; override with
  `ANTIGRAVITY_PORT_FILE` if necessary. A history connection alone is not proof
  that live controls work. Existing unavailable actions remain unavailable.
- **Codex App:** bridge on port 17373; experimental CDP connection on port 9222.
  Only builds exposing the local CDP renderer used by the integration can work.
  Microsoft Store builds may not expose it. Failure reports disconnected state;
  this package does not install virtual HID drivers, change Secure Boot, enable
  test signing, modify the app, or close a running Codex process. This is not a
  claim of feature parity on Store builds.

## Build and install

Run in PowerShell from the repository root:

```powershell
npm ci
npm run build:windows
npm run check:windows
```

Close Ulanzi Studio before replacing a plugin. The default existing plugin root
is `%APPDATA%\Ulanzi\UlanziDeck\Plugins`. If your installation uses another
directory, set `ULANZI_PLUGINS_DIR` to that **existing** directory. The installer
refuses to invent a missing installation path.

```powershell
$env:ULANZI_PLUGINS_DIR = 'C:\actual\Ulanzi\Plugins'
npm run windows:install-plugin -- codex
npm run windows:install-plugin -- antigravity
npm run windows:install-plugin -- codex-cli
```

Each complete package is staged and validated before replacement. The old package
is retained in `%LOCALAPPDATA%\OpenCodexMicro\plugin-backups`, outside Studio's
plugin discovery directory. Replacement/rollback is per plugin, not a transaction
covering all three plugins. A custom plugin root must be on the same volume as
the backups to allow an atomic rename.

Reopen Studio after installation. Use only the Windows packages on Windows;
the original `integration/` distribution continues to advertise macOS.

## Set up and start bridges

```powershell
$env:CODEX_CLI_EXE = 'C:\actual\codex.exe'
$env:CODEX_APP_EXE = 'C:\actual\ChatGPT.exe'
$env:ANTIGRAVITY_EDITOR_EXE = 'C:\actual\Antigravity.exe'
npm run windows:setup -- codex
npm run windows:setup -- antigravity
npm run windows:setup -- codex-cli
npm run windows:start -- codex
npm run windows:start -- antigravity
npm run windows:start -- codex-cli
```

Setup creates a limited, current-user scheduled task for each selected bridge.
It starts at next logon; setup does not start it immediately unless `--start` is
passed. Existing running bridges block updates until explicitly stopped with
`windows:stop`. Per-user data, logs and versioned runtimes live under
`%LOCALAPPDATA%\OpenCodexMicro\{codex,antigravity,codex-cli}`. Saved configuration
captures the app paths and relevant overrides from the setup environment.

Auth tokens retain the shared `.local/share/ulanzi-bridges` path (or
`ULANZI_AUTH_DIR`) so the plugin and bridge agree. Windows uses private directory
DACLs, not Unix permission bits. The app-server token is passed by file or child
environment variable; it is never rendered in the inspector or command line.

For a Codex App build that supports CDP, save work and close the app yourself,
then run `npm run windows:launch-codex` with `CODEX_APP_EXE` set. This command
does not start the bridge; use `windows:start` as well. If Codex is already
running the launcher refuses, without terminating it. The plugin's Windows
setup page can also install/start the bridge and launch Codex when configured.

For CLI sessions, use `npm run windows:terminal` from this repository. It reads
the installed endpoint credentials locally and invokes the configured CLI with
`--remote`. Plain `codex` terminals are separate writers and may be read-only
from the deck. Closing the bridge's managed task also stops its dedicated server;
save/finish tasks before explicitly stopping it.

## Diagnose, update, remove, roll back

```powershell
npm run windows:status -- codex-cli
npm run windows:stop -- codex-cli
npm run windows:setup -- codex-cli
npm run windows:start -- codex-cli
# Only when removal is wanted:
npm run windows:uninstall -- codex-cli
```

Status separates installed files, running HTTP bridge and application connection.
Current runners acknowledge a per-release stop request and stop their own child
processes before Task Scheduler is stopped. Older runners without this protocol
refuse an unsafe stop while running; do not assume stopping their PowerShell task
also stops the Node bridge. A disabled task is enabled by an explicit start.

For a blank Codex window, first verify normal launch without the bridge. The
Windows launcher now opens visibly from the executable's own directory. An
installation under `WindowsApps` is instead activated through its registered
application identity using Windows `IApplicationActivationManager`; failure does
not fall back to launching the Store executable without package identity. An
optional, per-launch compositor workaround can be enabled before setup with
`$env:CODEX_WINDOWS_OCCLUSION_WORKAROUND = '1'`. It adds only
`--disable-features=CalculateNativeWinOcclusion`; it does not modify shortcuts,
app data or security settings. A similar rendering issue was
[reported for earlier Windows builds](https://github.com/openai/codex/issues/42547);
this is a diagnostic option, not a verified fix for every build. Confirm the
window is usable before treating a CDP connection as a successful installation.

Logs: `windows-bridge.log` in the component directory. Removal affects only that
component's scheduled task and runtime releases; drafts, logs, tokens, plugins and
other components remain. To restore a plugin, close Studio, move the current
plugin aside, and restore its retained backup. Old runtime releases remain after
successful updates; failed registration restores the previous scheduled task and
installation metadata.

## Acceptance required before release

Automated tests exercise platform routing, authenticated WebSocket requests,
installer rollback, private Windows storage and macOS behavior with fixtures.
They cannot prove application compatibility, task scheduler lifecycle, reboot
persistence, physical deck controls or macOS runtime behavior. Verify these on
Windows and a real Mac using disposable sessions before merging/releasing.
The Windows setup page is currently English; existing action labels retain all
eight locale resources. Windows-specific package descriptions use English.
