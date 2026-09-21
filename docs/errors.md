# Engineering Notes

## Codex Bridge & State

- The renderer Micro store is the single source of truth for task order, status, selection, and host assignment.
- Refresh the sidecar cache on its own interval (500 ms); `/state` must only read the cache and must not trigger a renderer scan per request.
- Cache discovered Micro and React references for the renderer lifecycle and rediscover them only after invalidation.
- Preserve `client-new-thread:<uuid>` keys until Codex promotes them to formal thread UUIDs.
- Bridge navigation must use the displayed slot's exact thread key and let Codex resolve the stored project and host assignment.
- Steer must invoke the renderer's real Steer action. Do not substitute an Enter variant that could submit or queue instead.
- Preserve both keydown and keyup for Micro actions that use press/release semantics.
- Never replay an action after a timeout or uncertain HTTP response to avoid double execution.

## Antigravity Bridge & State Reader

- Asynchronously poll Antigravity session directories, task transcripts, and status caches without blocking the bridge event loop.
- Push state changes via local WebSocket (`127.0.0.1:17375`) while maintaining HTTP `/state` polling (`127.0.0.1:17374`) compatibility.
- Gracefully handle file lock contention or partially written transcript files during active agent turns.
- Provide safe fallbacks for missing or completed sessions without crashing the monitoring loop.

## Spotify Integration

- Prefer native macOS ScriptingBridge / AppleScript for zero-latency local playback controls.
- Fallback gracefully when Spotify is closed or in an idle/ad-playback state.
- Cache fetched album art and playlist metadata to minimize remote network requests.

## Security & Lifecycle

- All CDP, WebSocket, and HTTP Bridge APIs must strictly bind only to loopback addresses (`127.0.0.1`).
- The Bridge launchers must allow slow cold starts and fail early only if the underlying application process exits.
- Long-lived Bridge and plugin dispatch loops must isolate individual request failures so one transient error cannot stop subsequent actions.
- Plugin `add`, `setactive`, and `clear` events must maintain action instances by context; switching pages must not be treated as instance deletion.

## Plugin Display & Rendering

- Keep the last usable display during routine refreshes; use offline artwork only when the Bridge or application is genuinely unavailable.
- Task updates use relative-path icons and must not send a state index when the manifest disables automatic states.
- Usage and token gauge refreshes must be rendered non-blockingly without delaying user keypress inputs.
- All runtime assets referenced by the manifests or plugin code must exist in the respective installed `.ulanziPlugin` directory.

