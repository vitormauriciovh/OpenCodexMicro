---
name: setup-codex-bridge
description: Install, update, verify, diagnose, or remove OpenCodexMicro's Codex Bridge.app and loopback sidecar on macOS. Use when the request concerns Bridge setup or its local LaunchAgent, not Ulanzi Studio plugin installation.
---

# Setup Codex Bridge

Resolve the project root as two directories above this file. Require
`package.json`, `scripts/install.mjs`, and `src/bridge/`; otherwise ask for the
OpenCodexMicro checkout.

## Workflow

1. Inspect `git status --short`, `package.json`, and the current Bridge state.
   Preserve unrelated worktree changes. First inspect installed Ulanzi Studio
   plugin manifests under `~/Library/Application Support/Ulanzi/UlanziDeck/Plugins/`:
   identify Codex App by UUID `com.ulanzi.ulanzistudio.codexmicro` and verify its
   `CodePath` exists. Report missing or invalid plugins separately; plugin
   installation belongs to [install-ulanzi-studio-plugin](../install-ulanzi-studio-plugin/SKILL.md).
2. Verify macOS, Node.js 20+, and
   `/Applications/ChatGPT.app/Contents/MacOS/ChatGPT`.
3. For an authorized installation or update, install root dependencies if needed
   (`npm ci` with the repository lockfile), then run from the project root:

   ```bash
   npm run setup
   ```

   Setup builds and copies the Bridge, replaces `~/Applications/Codex Bridge.app`,
   and installs/restarts the user LaunchAgent. It does not open the wrapper app.
   Use `npm run setup -- --no-start` only when the user explicitly wants the
   sidecar installed but stopped; this still writes artifacts and unloads any
   existing Bridge service. For diagnosis alone, proceed to verification without
   running setup.
4. Verify the installed artifacts and service:

   ```bash
   test -x "$HOME/Applications/Codex Bridge.app/Contents/MacOS/Codex Bridge"
   launchctl print "gui/$(id -u)/io.opencodexmicro.bridge"
   node scripts/bridge-status.mjs codex health
   node scripts/bridge-status.mjs codex state
   ```

   The status helpers supply required local Bearer credentials and can initialize
   token files; never print those tokens. A deliberately stopped service will
   not pass the running-service checks. Distinguish installed artifacts, a
   reachable sidecar, and an actual Codex connection in the report.
5. Do not launch `Codex Bridge.app` merely to verify installation. Launching it
   attempts to quit a running Codex instance; do so only when the user asks and
   has had a chance to save current work.
6. After an authorized launch, rerun the state helper and report whether
   `connected` is true. If false, inspect
   `~/Library/Application Support/OpenCodexMicro/codex/bridge-error.log` and
   confirm Codex was opened through the wrapper app.

## Boundaries

- Keep CDP at `127.0.0.1:9222` and the sidecar at `127.0.0.1:17373`.
- Do not modify Codex shortcuts or Ulanzi Studio plugins in this skill.
- Run `npm run uninstall` only when the user explicitly requests removal; it
  also removes the installed Codex App plugin.
