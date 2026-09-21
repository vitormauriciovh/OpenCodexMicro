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
|  |  (127.0.0.1:17373) |     | (127.0.0.1:17374/17375)|     | Direct Execution  |  |
+--+---------+----------+-----+-----------+------------+-----+---------+---------+--+
             |                            |                            |
+------------v----------------------------v----------------------------v------------+
|                            ULANZI STUDIO RUNTIME                                  |
|  +--------------------+     +------------------------+     +-------------------+  |
|  | Codex Micro Plugin |     |   Antigravity Plugin   |     |  Spotify Plugin   |  |
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
- Task activation, Fast, Fork, Submit, and Mic use Codex Micro events. Pin, New, Steer, Approve, Deny, and Reasoning Effort invoke the matching semantic renderer controls.
- Uncertain HTTP failures are never replayed to prevent double execution.

---

## 2. Antigravity Bridge (`src/bridge-antigravity/`)

- Runs as a lightweight local Node.js background service via LaunchAgent `io.openantigravitymicro.bridge` at `http://127.0.0.1:17374` with real-time WebSocket push notifications on port `17375`.
- Monitors active Antigravity sessions, subagents, token consumption, context limits, and artifact states (Implementation Plans & Walkthroughs).
- Dispatches agent commands (`proceed`, `cancel`, `/boost`, `/grill-me`, `/goal`) and handles artifact inspector activations in VS Code.

---

## 3. Spotify Music Picker (`integration/com.ulanzi.spotify.ulanziPlugin/`)

- Direct zero-latency macOS media integration combined with Spotify Web API catalog retrieval.
- Exposes playback status, track metadata, album artwork, and volume / playlist navigation dials.

---

## 4. Ulanzi Studio Plugins

All plugins are Node.js JavaScript plugins using protocol V3.0.0:
- Each plugin maintains action instances keyed by context.
- Updates LCD buttons dynamically with state badges, circular usage rings, and custom artwork.
- Forwards keydown, keyup, and rotary encoder actions to their respective local bridges.
- Distributed entry points are prebuilt CommonJS files (`dist/app.js`).

---

## 5. Installation Boundaries

- `scripts/install.mjs` installs the Codex Bridge sidecar and `~/Applications/Codex Bridge.app`.
- `scripts/install-antigravity.mjs` installs the Antigravity Bridge sidecar and LaunchAgent.
- `scripts/install-plugin.mjs`, `scripts/install-antigravity-plugin.mjs`, and `scripts/install-spotify-plugin.mjs` atomically copy prebuilt plugins into `~/Library/Application Support/Ulanzi/UlanziDeck/Plugins/`.
- `scripts/uninstall.mjs` safely stops and removes the installed LaunchAgents, bridge files, and plugin directories.

