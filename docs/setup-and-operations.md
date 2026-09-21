# Setup and Operations

OpenCodexMicro supports three Ulanzi Studio plugins and two local loopback bridges:

```text
Codex Desktop     <-> Codex Bridge sidecar (127.0.0.1:17373)       <-> Codex Micro Plugin     <-> Ulanzi D200
Antigravity Agent <-> Antigravity Bridge sidecar (127.0.0.1:17374) <-> Antigravity Plugin    <-> Ulanzi D200
Spotify Desktop   <-> Local Player / Spotify Web API               <-> Spotify Picker Plugin  <-> Ulanzi D200
```

---

## System Requirements

- macOS 13 (Ventura) or later;
- Codex Desktop and/or Antigravity (VS Code);
- Ulanzi Studio 3.0.1 or later with an Ulanzi D200 Series keypad;
- Node.js 20 or newer.

---

## 1. Quick Installation (All Components)

From the repository root:

```bash
npm install
npm run install:all
npm run setup:all
```

> **Important:** Quit Ulanzi Studio before running `npm run install:all`.

---

## 2. Selective Plugin & Bridge Setup

### A. Codex Micro
```bash
# Atomically install the Codex Micro plugin
npm run install:plugin

# Build and register the Codex Bridge sidecar and ~/Applications/Codex Bridge.app
npm run setup
```

### B. Antigravity Agent
```bash
# Atomically install the Antigravity plugin
npm run install:plugin:antigravity

# Build and register the Antigravity Bridge LaunchAgent
npm run setup:antigravity
```

### C. Spotify Music Picker
```bash
# Atomically install the Spotify plugin
npm run install:plugin:spotify
```

---

## 3. Starting the Applications

### Codex Desktop
Always open Codex through its bridge wrapper so the remote debugging port is enabled:

```bash
open ~/Applications/Codex\ Bridge.app
```

The wrapper launches the desktop application with:
```text
--remote-debugging-address=127.0.0.1
--remote-debugging-port=9222
--remote-allow-origins=http://127.0.0.1:9222
```

### Antigravity Bridge
The Antigravity Bridge runs automatically in the background via LaunchAgent `io.openantigravitymicro.bridge` and serves HTTP on port `17374` and WebSocket updates on port `17375`.

---

## 4. Installed Files & LaunchAgents

```text
# Applications
~/Applications/Codex Bridge.app

# Bridges and logs
~/Library/Application Support/OpenCodexMicro/bridge.mjs
~/Library/Application Support/OpenCodexMicro/bridge.log
~/Library/Application Support/OpenCodexMicro/bridge-error.log
~/Library/Application Support/OpenCodexMicro/bridge-antigravity.mjs
~/Library/Application Support/OpenCodexMicro/bridge-antigravity.log
~/Library/Application Support/OpenCodexMicro/bridge-antigravity-error.log

# LaunchAgents
~/Library/LaunchAgents/io.opencodexmicro.bridge.plist
~/Library/LaunchAgents/io.openantigravitymicro.bridge.plist

# Ulanzi Studio Plugins
~/Library/Application Support/Ulanzi/UlanziDeck/Plugins/com.ulanzi.codexmicro.ulanziPlugin
~/Library/Application Support/Ulanzi/UlanziDeck/Plugins/com.ulanzi.antigravity.ulanziPlugin
~/Library/Application Support/Ulanzi/UlanziDeck/Plugins/com.ulanzi.spotify.ulanziPlugin
```

---

## 5. Service Management & Health Checks

### Check Bridge Services
```bash
# Codex Bridge Service
launchctl print "gui/$(id -u)/io.opencodexmicro.bridge"
launchctl kickstart -k "gui/$(id -u)/io.opencodexmicro.bridge"

# Antigravity Bridge Service
launchctl print "gui/$(id -u)/io.openantigravitymicro.bridge"
launchctl kickstart -k "gui/$(id -u)/io.openantigravitymicro.bridge"
```

### Check Diagnostic Endpoints
```bash
# Codex Bridge
curl http://127.0.0.1:17373/health
curl http://127.0.0.1:17373/state

# Antigravity Bridge
curl http://127.0.0.1:17374/health
curl http://127.0.0.1:17374/state
```

### Inspect Logs
```bash
# Codex Bridge logs
tail -f "$HOME/Library/Application Support/OpenCodexMicro/bridge.log"
tail -f "$HOME/Library/Application Support/OpenCodexMicro/bridge-error.log"

# Antigravity Bridge logs
tail -f "$HOME/Library/Application Support/OpenCodexMicro/bridge-antigravity.log"
tail -f "$HOME/Library/Application Support/OpenCodexMicro/bridge-antigravity-error.log"
```

---

## 6. Troubleshooting

| Symptom | Cause / Check | Solution |
| --- | --- | --- |
| **Plugin category is missing in Ulanzi Studio** | Manifest or entry point was missing during startup. | Verify `manifest.json` and `dist/app.js` in the plugin directory, then restart Ulanzi Studio. |
| **Codex keys show offline** | Codex Desktop was not opened via the bridge wrapper or CDP is unavailable. | Launch `~/Applications/Codex Bridge.app` and test `curl http://127.0.0.1:17373/health`. |
| **Antigravity keys show offline** | Antigravity Bridge background service is stopped. | Run `launchctl kickstart -k gui/$(id -u)/io.openantigravitymicro.bridge` and test port `17374`. |
| **Encoder rotation does not scroll** | Accessibility permission is missing on macOS. | Allow Ulanzi Studio under **System Settings > Privacy & Security > Accessibility**. |
| **Spotify actions show no metadata** | Spotify is not running or track is paused/unsupported. | Launch the Spotify desktop app and play a track. |

---

## 7. Updates & Development

### Update Installed Components
```bash
git pull
npm install
npm run check
npm run setup:all
npm run install:all
```
Restart Ulanzi Studio after updating plugins.

### Build and Smoke Tests
```bash
# Run all linters, unit tests, and smoke tests
npm run check

# Build specific components
npm run build:all
npm run build:bridge
npm run build:antigravity:bridge
npm run build:plugin
npm run build:antigravity:plugin
npm run build:spotify:plugin
```

---

## 8. Uninstallation

```bash
npm run uninstall
```

Stops and unloads all LaunchAgents, and removes Bridge binaries, logs, and installed plugins.

