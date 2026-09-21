# Architecture

OpenCodexMicro uses Ulanzi Studio as the sole physical device owner, interfacing through native plugins and loopback bridges.

```text
+-----------------------------------------------------------------------------------+
|                                 DEVELOPER APPS                                    |
|  +--------------------+     +------------------------+     +-------------------+  |
|  |   Codex Desktop    |     |  Antigravity (VS Code) |     |  Spotify Desktop  |  |
|  |  (CDP 127.0.0.1)   |     | (Transcripts & Tasks)  |     |  (macOS / Web)    |  |
+--+---------+----------+-----+-----------+------------+-----+---------+---------+--+
             |                            |                            |
+------------v----------------------------v----------------------------v------------+
|                                LOCAL BRIDGES                                      |
|  +--------------------+     +------------------------+     +-------------------+  |
|  |    Codex Bridge    |     |   Antigravity Bridge   |     | Local / Web API   |  |
|  |  (127.0.0.1:17373) |     | (127.0.0.1:17374       )|     | Direct Execution  |  |
+--+---------+----------+-----+-----------+------------+-----+---------+---------+--+
             |                            |                            |
+------------v----------------------------v----------------------------v------------+
|                            ULANZI STUDIO RUNTIME                                  |
|  +--------------------+     +------------------------+     +-------------------+  |
|  | Codex App Plugin   |     |   Antigravity Plugin   |     |  Spotify Plugin   |  |
|  | (.codexmicro)      |     |   (.antigravity)       |     |  (.spotify)       |  |
+--+--------------------+-----+------------------------+-----+-------------------+--+
                                          |
+-----------------------------------------v-----------------------------------------+
|                              PHYSICAL HARDWARE                                    |
|                           Ulanzi D200 Series Deck                                 |
+-----------------------------------------------------------------------------------+
```

---

## 1. Codex Bridge (`src/bridge/`)

- `Codex Bridge.app` launches the real Codex Desktop executable with Chrome DevTools Protocol (CDP) restricted to `127.0.0.1:9222`.
- The sidecar keeps a persistent renderer connection and refreshes an in-memory snapshot every 500 ms.
- `/state` reads that in-memory cache directly rather than triggering a fresh renderer scan for every plugin poll.
- The initial discovery locates Codex's Micro store, event bus, resolver, context map, and usage query clients. Those references are cached for the renderer lifecycle and rediscovered only when invalidated.
- Task activation, Fast, Fork, Submit, Mic, Approve, Reject and scrolling use Codex Micro events. Pin, New, Steer, Stop, existing goals and subagent navigation use semantic renderer controls. Model and Reasoning Effort cycle through native picker options using its committed callbacks, preserving disabled states and confirming the selected values. Mutations verify the selected task; prompts preserve existing drafts; native approvals are dispatched only once.
- Uncertain HTTP failures are never replayed to prevent double execution.

---

## 2. Antigravity Bridge (`src/bridge-antigravity/`)

- Runs as a lightweight local Node.js background service via LaunchAgent `io.openantigravitymicro.bridge` at `http://127.0.0.1:17374` with real-time WebSocket push notifications at `/events` on the same port.
- Monitors active Antigravity sessions, subagents, token consumption, context limits, and artifact states (Implementation Plans & Walkthroughs).
- Uses the observed Antigravity Desktop conversation ID and scoped controls for selection, approvals, Stop, new tasks, pinning, prompts, microphone, scrolling, fork, reasoning and promotion of one queued message through its native Send Now control. Missing or ambiguous controls fail explicitly. Legacy Boost, Grill-me and Goal controls have no verified equivalent in this installed app; they never send invented slash commands. Saved plan/walkthrough artifacts can open in the configured editor.

---

## 3. Codex CLI Bridge (`src/bridge-codex-cli/`)

- Lightweight local Node.js background service via LaunchAgent `io.opencodexmicro.codexcli.bridge` at `http://127.0.0.1:17376` with WebSocket push at `/events` on the same port.
- Connects directly to the `codex app-server` control socket (`~/.codex/app-server-control/app-server-control.sock`) using JSON-RPC messages inside WebSocket frames, including the HTTP Upgrade handshake. Raw JSONL is used only by the app-server stdio transport.
- Intercepts tool execution and patch approval requests (`item/commandExecution/requestApproval`, `applyPatchApproval`) and maps them to one-touch Approve and Reject actions.
- Captures reported token usage and task states, preserves unknown metrics, supports next-prompt model settings, and uses native goal APIs. Tasks owned by a different process remain individually read-only without disconnecting the whole bridge. The launcher starts the managed daemon before the bridge.

---

## 4. Spotify Music Picker (`integration/com.ulanzi.spotify.ulanziPlugin/`)

- Direct zero-latency macOS media integration combined with Spotify Web API catalog retrieval.
- Exposes playback status, track metadata, album artwork, and volume / playlist navigation dials.

---

## 5. Ulanzi Studio Plugins

All plugins are Node.js JavaScript plugins using protocol V3.0.0:
- Each plugin maintains action instances keyed by context.
- Updates LCD buttons dynamically with state badges, circular usage rings, and custom artwork.
- Forwards keydown, keyup, and rotary encoder actions to their respective local bridges.
- Distributed entry points are prebuilt CommonJS files (`dist/app.js`).

---

## 6. Installation Boundaries

- `scripts/install.mjs` installs the Codex Bridge sidecar and `~/Applications/Codex Bridge.app`.
- `scripts/install-antigravity.mjs` installs the Antigravity Bridge sidecar and LaunchAgent.
- `scripts/install-codex-cli.mjs` installs the Codex CLI Bridge sidecar and LaunchAgent.
- `scripts/install-plugin.mjs`, `scripts/install-antigravity-plugin.mjs`, `scripts/install-spotify-plugin.mjs`, and `scripts/install-codex-cli-plugin.mjs` atomically copy prebuilt plugins into `~/Library/Application Support/Ulanzi/UlanziDeck/Plugins/`.
- `scripts/uninstall.mjs` safely stops and removes the installed LaunchAgents, bridge files, and plugin directories.

