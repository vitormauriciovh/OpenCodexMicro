# OpenCodexMicro LLM Guide

This file is the repository entry point for LLMs and coding agents. It explains
what the project contains and how to route setup and verification work through the repository's
plugins, bridges, and skills.

## Project overview

OpenCodexMicro connects developer tools (Codex Desktop, Antigravity AI Agent) and media controls (Spotify) to an Ulanzi Studio plugin through loopback-only Bridges:

```text
Codex Desktop     -> Codex Bridge.app / sidecar (127.0.0.1:17373)       -> com.ulanzi.codexmicro.ulanziPlugin -> Ulanzi Deck
Antigravity Agent -> Antigravity Bridge sidecar (127.0.0.1:17374/17375) -> com.ulanzi.antigravity.ulanziPlugin  -> Ulanzi Deck
Spotify Desktop   -> macOS Local Player / Web API                      -> com.ulanzi.spotify.ulanziPlugin      -> Ulanzi Deck
```

The Ulanzi-maintained implementation scope is limited to
`integration/com.ulanzi.codexmicro.ulanziPlugin/`. The plugins consume state
and action interfaces exposed by the existing Bridges. Ulanzi did not design,
specify, develop, or maintain CDP or Codex's CDP implementation. Read
`NOTICE.md` before making attribution or responsibility claims.

## Required setup routing

When asked to install, configure, repair, or start OpenCodexMicro components, inspect the
installed Ulanzi Studio plugins before taking action. Do not infer plugin
installation simply from the presence of this repository.

1. Search under:

   ```text
   ~/Library/Application Support/Ulanzi/UlanziDeck/Plugins/
   ```

   Inspect plugin `manifest.json` files and check for the target plugin UUIDs:
   - **Codex App**: `com.ulanzi.ulanzistudio.codexmicro`
   - **Antigravity**: `com.ulanzi.ulanzistudio.antigravity`
   - **Spotify**: `com.ulanzi.ulanzistudio.spotify`
   - **Codex CLI**: `com.ulanzi.ulanzistudio.codexcli`

   Also verify that each manifest's `CodePath` exists in the corresponding plugin
   directory. Do not rely only on the directory name.

2. **Plugin Installation:**
   - To install all plugins: `npm run install:all`
   - For Codex App alone: use `$install-ulanzi-studio-plugin` from `skills/install-ulanzi-studio-plugin/SKILL.md` or run `npm run install:plugin`.
   - For Antigravity alone: run `npm run install:plugin:antigravity`.
   - For Spotify alone: run `npm run install:plugin:spotify`.
   - For Codex CLI alone: run `npm run install:plugin:codexcli`.

3. **Bridge Installation & Setup:**
   - To setup all bridges: `npm run setup:all`
   - For Codex Bridge: use `$setup-codex-bridge` from `skills/setup-codex-bridge/SKILL.md` or run `npm run setup`.
   - For Antigravity Bridge: run `npm run setup:antigravity`.
   - For Codex CLI Bridge: run `npm run setup:codexcli`.

4. Report plugin installation and Bridge verification results separately. Do not
   reinstall a valid plugin unless the user explicitly requests an update or
   repair.

Follow the authorization, application-shutdown, verification, and scope
boundaries in each selected `SKILL.md`. Do not restore or invoke the removed
Python/D200 standalone runtime.

## Key repository paths

- `integration/com.ulanzi.codexmicro.ulanziPlugin/`: Codex App Ulanzi Studio plugin.
- `integration/com.ulanzi.antigravity.ulanziPlugin/`: Antigravity AI Agent Ulanzi Studio plugin.
- `integration/com.ulanzi.spotify.ulanziPlugin/`: Spotify Music Picker Ulanzi Studio plugin.
- `integration/com.ulanzi.codexcli.ulanziPlugin/`: Codex CLI Ulanzi Studio plugin.
- `src/bridge/`: Codex loopback Bridge implementation.
- `src/bridge-antigravity/`: Antigravity loopback Bridge implementation.
- `src/bridge-codex-cli/`: Codex CLI loopback Bridge implementation.
- `scripts/install.mjs` / `scripts/install-antigravity.mjs` / `scripts/install-codex-cli.mjs`: Bridge installers.
- `scripts/install-plugin.mjs` / `scripts/install-antigravity-plugin.mjs` / `scripts/install-spotify-plugin.mjs` / `scripts/install-codex-cli-plugin.mjs`: atomic plugin installers.
- `LICENSE`, `NOTICE.md`, and `THIRD_PARTY_NOTICES.md`: centralized licensing,
  attribution, modification, and responsibility information.

