---
name: install-ulanzi-studio-plugin
description: Install, update, verify, or diagnose the repository's prebuilt Codex App .ulanziPlugin directory in Ulanzi Studio on macOS. Use for local Ulanzi Studio plugin installation, not plugin development or Codex Bridge.app setup.
---

# Install the Ulanzi Studio Plugin

Resolve the project root as two directories above this file. Require
`integration/com.ulanzi.codexmicro.ulanziPlugin/manifest.json` and
`scripts/install-plugin.mjs`; otherwise ask for the OpenCodexMicro checkout.

## Workflow

1. Inspect `git status --short` and the source and installed plugin manifests.
   Preserve unrelated worktree changes.
   Under `~/Library/Application Support/Ulanzi/UlanziDeck/Plugins/`, identify the
   installed plugin by UUID `com.ulanzi.ulanzistudio.codexmicro` and verify its
   `CodePath` exists. A checkout alone does not establish installation. Do not
   replace a valid installation unless the user requests an update or repair.
2. Verify macOS, Node.js 20+, and `/Applications/Ulanzi Studio.app`.
3. From the project root, verify the source UUID and `CodePath: dist/app.js`,
   `dist/package.json`, and the complete prebuilt package:

   ```bash
   node --input-type=module -e 'import { preflightPlugin } from "./src/shared/plugin-installer.mjs"; await preflightPlugin("integration/com.ulanzi.codexmicro.ulanziPlugin", "codexmicro");'
   test -f integration/com.ulanzi.codexmicro.ulanziPlugin/dist/package.json
   ```

   The preflight checks the entry point, action inspectors, icons directory,
   all eight locales, and bundled Bridge resources including notices. If resources are
   missing or stale relative to requested changes, report that the prebuilt
   package needs rebuilding; do not build as part of this installation skill.
4. If Ulanzi Studio is running, have the user quit it before replacing the loaded
   plugin. Do not terminate it without permission; honor existing authorization.
   Install from the project root:

   ```bash
   ULANZI_PREBUILT=1 npm run install:plugin
   ```

   The flag skips the default rebuild. Without it, `npm run install:plugin`
   builds from source and rewrites generated files. The installer validates and
   stages the package before replacing the installed directory, retaining the previous
   package under `~/Library/Application Support/OpenCodexMicro/plugin-backups/`.
5. Verify the installed manifest UUID, its `CodePath`, and the complete package:

   ```bash
   node --input-type=module -e 'import { homedir } from "node:os"; import { join } from "node:path"; import { preflightPlugin } from "./src/shared/plugin-installer.mjs"; await preflightPlugin(join(homedir(), "Library/Application Support/Ulanzi/UlanziDeck/Plugins/com.ulanzi.codexmicro.ulanziPlugin"), "codexmicro");'
   test -f "$HOME/Library/Application Support/Ulanzi/UlanziDeck/Plugins/com.ulanzi.codexmicro.ulanziPlugin/dist/package.json"
   ```

6. Ask the user to reopen Ulanzi Studio and confirm that the **Codex App**
   category and actions appear. If actions show offline, verify the Bridge with
   `node scripts/bridge-status.mjs codex health` and
   `node scripts/bridge-status.mjs codex state`. These helpers use local Bearer
   credentials and can initialize their token files; never print those tokens.
   Report plugin installation separately from Bridge availability and Codex
   connection. Use [setup-codex-bridge](../setup-codex-bridge/SKILL.md) if Bridge
   repair is requested.

## Boundaries

- Install only `com.ulanzi.codexmicro.ulanziPlugin`; do not alter other Ulanzi
  Studio plugins.
- Preserve the previous installed directory until the replacement is ready.
- Do not publish or submit the plugin to a marketplace as part of local
  installation.
