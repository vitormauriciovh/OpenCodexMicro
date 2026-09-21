# Plugin code review — 21 September 2026

Reviewed Codex Micro, Antigravity, Spotify, Codex CLI, their three bridges, property inspectors, build/install/uninstall scripts, and existing tests. This includes the current uncommitted Codex CLI implementation. Application code was not changed, and installed applications, services, and plugins were not modified.

P1 means fix before release; P2 means a functional or reliability correction; P3 means a maintainability improvement. The findings below distinguish fixture-confirmed behavior from static analysis. This was a general code review, not an exhaustive security audit or a physical-device acceptance test. Component ownership remains as described in NOTICE.md.

1. **P1 — Spotify interpolates untrusted URI text into executable AppleScript.**

   [spotify-local.js:130](/Users/vitormauricio/Projects/Ulanzi/integration/com.ulanzi.spotify.ulanziPlugin/plugin/spotify-local.js:130), [HTTP entry point:521](/Users/vitormauricio/Projects/Ulanzi/integration/com.ulanzi.spotify.ulanziPlugin/plugin/app.js:521).

   `/play` passes a request-supplied URI directly into `playUri()`, which embeds it between AppleScript quotes. A quote in the input can escape the string and introduce AppleScript expressions. The HTTP server has no application authentication and explicitly permits arbitrary CORS origins. Local reachability and browser local-network restrictions affect remote-page exposure, but do not remove the input-to-code defect.

   **Evidence:** A mocked command runner captured a URI containing a quote and arithmetic expression in executable expression context. No AppleScript payload was executed.

   **Correction:** Strictly validate and normalize supported Spotify URI types and IDs; pass the URI as an `osascript` argument to a fixed script. Authenticate mutations and validate HTTP/WebSocket origins. Add rejection tests for quotes, newlines, invalid schemes, malformed IDs, and oversized bodies.

2. **P1 — Uninstalling Codex Bridge deletes sibling bridge runtimes.**

   [bridge-installer.js:357](/Users/vitormauricio/Projects/Ulanzi/integration/com.ulanzi.codexmicro.ulanziPlugin/plugin/bridge-installer.js:357), [uninstall.mjs:35](/Users/vitormauricio/Projects/Ulanzi/scripts/uninstall.mjs:35).

   Both uninstall paths recursively remove the shared `OpenCodexMicro` application-support directory. Antigravity and Codex CLI install their runtimes there too. Only the Codex Micro LaunchAgent is unloaded, leaving the sibling KeepAlive services registered with deleted executables.

   **Evidence:** Calling the bundled uninstaller against a temporary home with mocked process execution deleted both sibling runtime fixtures.

   **Correction:** Give each bridge its own directory and installation inventory. A component uninstaller must remove only its own files and service. Make an explicit uninstall-all path unload every owned service before deleting shared resources. Test coexistence and uninstall order.

3. **P1 — Codex CLI uses incompatible initialization and event schemas.**

   [app-server-client.mjs:104](/Users/vitormauricio/Projects/Ulanzi/src/bridge-codex-cli/app-server-client.mjs:104), [notification parsing:164](/Users/vitormauricio/Projects/Ulanzi/src/bridge-codex-cli/app-server-client.mjs:164).

   The “handshake” sends `session/list`, skips initialization, and discards its response. Event handling expects `sessionId` and a top-level `turnId`; the installed CLI 0.154.0 schema uses `threadId` and `turn.id`. A transport connection is therefore reported as daemon connectivity without establishing protocol readiness.

   **Evidence:** Generated protocol types from the installed CLI confirm the mismatch. Feeding a current-schema `turn/started` fixture leaves `activeTurn.id` undefined and creates no session. Official documentation also requires `initialize` followed by `initialized` before other requests. [Codex App Server documentation](https://learn.chatgpt.com/docs/app-server).

   **Correction:** Use generated versioned protocol types, implement initialization and thread enumeration/subscription, consume the list response, and track turns per thread. Set readiness only after successful initialization. Reject outstanding RPCs on disconnect and reconcile state on reconnect.

4. **P1 — CLI Queue and approval responses do not satisfy the protocol.**

   [queuePrompt:301](/Users/vitormauricio/Projects/Ulanzi/src/bridge-codex-cli/app-server-client.mjs:301), [approval handling:216](/Users/vitormauricio/Projects/Ulanzi/src/bridge-codex-cli/app-server-client.mjs:216).

   Queue sends `turn/start` with only `{message}`; it needs a destination thread and structured input. The CLI fallback supplies `--message` but omits the installed CLI's required `--thread`. Rejection sends `decision: "reject"`, while the installed command/file approval schemas accept `decline` or `cancel`. Permissions approvals receive `{approved: boolean}` instead of the required permissions/scope response. Requests are deleted from the local pending map before delivery, including when disconnected.

   **Evidence:** Installed CLI help and generated types confirm the contracts; a mocked outgoing-message test captured the invalid rejection value. The outer bridge route can still return `ok: true` around a failed queue result.

   **Correction:** Bind each action to a specific thread/request ID, implement method-specific responses, preserve undelivered requests, and propagate failures. Use `codex queue --thread <id> --message <text>` when queue semantics are intended, or the appropriate typed app-server operation. Add fixtures for each approval method and disconnected delivery.

5. **P1 — Approval/stop fallbacks can send input to an unrelated terminal or editor control.**

   [CLI terminal targeting:267](/Users/vitormauricio/Projects/Ulanzi/src/bridge-codex-cli/app-server-client.mjs:267), [CLI resume:321](/Users/vitormauricio/Projects/Ulanzi/src/bridge-codex-cli/app-server-client.mjs:321), [Antigravity approval:184](/Users/vitormauricio/Projects/Ulanzi/src/bridge-antigravity/server.mjs:184).

   CLI approval falls back to Enter when no request exists. Terminal selection picks the first running application from a fixed list, without identifying a window, tab, process, or Codex session. Resume types a shell command into whichever control receives focus. Antigravity similarly sends generic Enter/Escape without locating the intended approval dialog or running task, and swallows automation failures.

   **Correction:** Prefer thread-specific protocol actions. When unavailable, disable the action and show an actionable error. Any retained UI fallback must verify the exact target and control before sending input. Test unrelated foreground windows, multiple terminals, absent prompts, and denied macOS automation permissions.

6. **P2 — Spotify API failures overwrite the saved catalog.**

   [spotify-api.js:188](/Users/vitormauricio/Projects/Ulanzi/integration/com.ulanzi.spotify.ulanziPlugin/plugin/spotify-api.js:188), [empty-list handling:266](/Users/vitormauricio/Projects/Ulanzi/integration/com.ulanzi.spotify.ulanziPlugin/plugin/spotify-api.js:266).

   Sync parses JSON without checking HTTP status and converts network failures into empty objects. Those results produce an empty or partial catalog that replaces the saved file. An empty saved array is subsequently replaced by five hard-coded defaults, so users cannot reliably clear their selection either.

   **Evidence:** Mocking HTTP 429 responses changed a saved nonempty catalog to `[]` and returned an empty success result. Reloading that file produced the five defaults.

   **Correction:** Preserve the last good catalog on errors; validate responses before writing, report partial failures, and save atomically. Treat a valid empty array as an intentional empty collection. Separate manually curated items from account imports. Add pagination, bounded requests, and explicit rate-limit handling.

7. **P2 — Spotify and Antigravity ignore the encoder direction used by the existing host test.**

   [Spotify app.js:448](/Users/vitormauricio/Projects/Ulanzi/integration/com.ulanzi.spotify.ulanziPlugin/plugin/app.js:448), [Antigravity app.js:1257](/Users/vitormauricio/Projects/Ulanzi/integration/com.ulanzi.antigravity.ulanziPlugin/plugin/app.js:1257), [reference host events:253](/Users/vitormauricio/Projects/Ulanzi/integration/com.ulanzi.codexmicro.ulanziPlugin/test/smoke.mjs:253).

   Codex Micro handles `rotateEvent: "left" | "right"`. Spotify reads numeric rotation fields and defaults to +1; Antigravity defaults to 0. Under the same host event shape, both Spotify directions increase volume and both Antigravity directions scroll up.

   **Evidence:** Running the source handlers with the existing smoke-test event shape produced Spotify deltas `[4, 4]` and Antigravity routes `[/scroll/up, /scroll/up]`.

   **Correction:** Share a direction normalizer that supports the host's documented variants, hold events, and numeric ticks. Ignore zero/invalid movement. Clamp playlist offsets to the available catalog. Verify the normalization on hardware after unit tests.

8. **P2 — Every plugin can suppress a required display update after reconnect.**

   [Codex Micro:365](/Users/vitormauricio/Projects/Ulanzi/integration/com.ulanzi.codexmicro.ulanziPlugin/plugin/app.js:365), [Antigravity:903](/Users/vitormauricio/Projects/Ulanzi/integration/com.ulanzi.antigravity.ulanziPlugin/plugin/app.js:903), [Spotify:271](/Users/vitormauricio/Projects/Ulanzi/integration/com.ulanzi.spotify.ulanziPlugin/plugin/app.js:271), [CLI:261](/Users/vitormauricio/Projects/Ulanzi/integration/com.ulanzi.codexcli.ulanziPlugin/plugin/app.js:261).

   Rendering records `lastDisplay` before `send()` checks whether the host WebSocket is open. An update produced while disconnected is cached even though it was never sent. Reconnection does not invalidate all instance display caches, and re-adding an existing instance preserves its cache. An identical image can therefore remain suppressed until some other state change or activation event forces a repaint.

   **Evidence:** For all four source implementations, an offline render followed by the same online render sent zero messages.

   **Correction:** Cache only successful sends, reset display caches on each host connection, and force a complete repaint. Add a reconnect test with unchanged task/music state. Give each connection a generation ID so delayed callbacks from an older socket cannot mutate the current connection.

9. **P2 — All three bridges omit meaningful fields from change detection.**

   [Codex server:34](/Users/vitormauricio/Projects/Ulanzi/src/bridge/server.mjs:34), [Antigravity server:33](/Users/vitormauricio/Projects/Ulanzi/src/bridge-antigravity/server.mjs:33), [CLI server:32](/Users/vitormauricio/Projects/Ulanzi/src/bridge-codex-cli/server.mjs:32).

   Broadcast digests omit task identity and title, plus other visible fields such as model/context information and some usage windows. A different task occupying the same slot with the same status can be silently omitted from WebSocket updates. Five-second fallback polling eventually repairs the display, but creates a window where the deck shows an old task or value. Timers and monitor rotation are also tied to these sparse render opportunities.

   **Evidence:** Changing only a slot's `threadKey` and title produced no second broadcast in any bridge fixture.

   **Correction:** Compare a normalized public-state object containing every meaningful field, excluding volatile sampling timestamps; alternatively publish a semantic revision. Use a separate lightweight UI timer for elapsed time/countdowns. Test identity-only, title-only, token-only, model-only, and weekly-quota-only changes.

10. **P2 — Antigravity quota and CLI activity/token displays present heuristics as measured state.**

    [Antigravity quota:548](/Users/vitormauricio/Projects/Ulanzi/src/bridge-antigravity/state-reader.mjs:548), [CLI activity:436](/Users/vitormauricio/Projects/Ulanzi/src/bridge-codex-cli/app-server-client.mjs:436), [CLI token split:528](/Users/vitormauricio/Projects/Ulanzi/src/bridge-codex-cli/app-server-client.mjs:528).

    Without live quota, Antigravity assumes 50 turns per five hours and 200 per week, invents reset times, and clamps remaining capacity to at least 1%. With no history it reports 99% weekly remaining. CLI treats the presence of a process as active work and marks the latest database thread working even when that thread is unrelated. It fabricates an 80/20 input/output token split when details are unavailable; some elapsed times restart on each snapshot.

    **Evidence:** The empty-history/offline quota fixture returned 99% weekly remaining without any estimate marker. The other behaviors follow directly from the snapshot branches.

    **Correction:** Represent unknown values explicitly and attach source, observed time, and estimation flags. Separate service availability, process presence, and thread activity. Use actual per-thread lifecycle events and durable turn start times; do not infer token categories from a fixed ratio.

11. **P2 — Several advertised controls have incomplete behavior.**

    [Spotify Like manifest:72](/Users/vitormauricio/Projects/Ulanzi/integration/com.ulanzi.spotify.ulanziPlugin/manifest.json:72), [Spotify dispatch:388](/Users/vitormauricio/Projects/Ulanzi/integration/com.ulanzi.spotify.ulanziPlugin/plugin/app.js:388), [Antigravity attention:233](/Users/vitormauricio/Projects/Ulanzi/src/bridge-antigravity/server.mjs:233), [CLI task click:172](/Users/vitormauricio/Projects/Ulanzi/src/bridge-codex-cli/server.mjs:172).

    Spotify renders and advertises Like but has no Like branch in its key handler. Antigravity advertises jumping to sessions needing attention, but its attention endpoint only focuses VS Code; task clicks open a plan file rather than navigating a conversation. Every CLI session-card click ignores the requested slot and focuses the same terminal application.

    **Correction:** Implement the promised thread/track-specific operation or rename/disable the control to reflect its actual capability. The Antigravity New Session tooltip already describes focus-only behavior, so making it create a session is a product improvement rather than a confirmed contract violation. Add a table-driven test mapping every manifest action to its implemented behavior.

12. **P2 — Failure results are frequently swallowed or wrapped as success.**

    [Spotify play endpoint:521](/Users/vitormauricio/Projects/Ulanzi/integration/com.ulanzi.spotify.ulanziPlugin/plugin/app.js:521), [Antigravity invocation:1169](/Users/vitormauricio/Projects/Ulanzi/integration/com.ulanzi.antigravity.ulanziPlugin/plugin/app.js:1169), [CLI invocation:453](/Users/vitormauricio/Projects/Ulanzi/integration/com.ulanzi.codexcli.ulanziPlugin/plugin/app.js:453).

    Spotify ignores `{ok:false}` returned by `playUri()` and sends HTTP success. Antigravity catches failed automation internally and returns success; its plugin and the CLI plugin ignore response statuses and bodies. Action timeouts in plugins are also shorter than several bridge operations, so the caller can abandon a request before its effect is known.

    **Correction:** Standardize action responses and errors, distinguish accepted work from completed work, align timeouts, and show a brief deck alert with diagnostics in the inspector. Avoid retrying non-idempotent actions when their outcome is unknown. Test HTTP failures, unavailable applications, denied automation, and slow actions.

13. **P2 — The test gate misses important behavior and depends on personal state.**

    [CLI test:15](/Users/vitormauricio/Projects/Ulanzi/test/codex_cli_test.mjs:15), [root checks:25](/Users/vitormauricio/Projects/Ulanzi/package.json:25), [Antigravity smoke test:1](/Users/vitormauricio/Projects/Ulanzi/integration/com.ulanzi.antigravity.ulanziPlugin/test/smoke.mjs:1).

    The CLI test changes only the socket path, so snapshots still read the real Codex home and process list. It expects one task but saw five on this machine. Root `check` does not invoke Antigravity's check/smoke commands; CLI has no runtime smoke test. Spotify smoke verifies a few manifest fields and Antigravity smoke largely searches source strings, allowing broken action behavior to pass.

    **Correction:** Inject home, filesystem, process, clock, HTTP, and socket dependencies. Test against temporary fixtures and generated protocol messages. Run every plugin's behavioral smoke suite from one root command. Include the confirmed failure cases above rather than assertions that merely mirror source text.

14. **P2 — The documented install-all route depends on untracked build output.**

    [package.json:34](/Users/vitormauricio/Projects/Ulanzi/package.json:34), [CLI installer validation:68](/Users/vitormauricio/Projects/Ulanzi/scripts/install-codex-cli-plugin.mjs:68), [.gitignore:2](/Users/vitormauricio/Projects/Ulanzi/.gitignore:2).

    Plugin installers validate and copy `dist/app.js` without building it. Only Codex Micro's dist is tracked; the other plugin dist directories are ignored. Their files happen to exist in this working directory, but a clean checkout following `npm run install:all` has no guarantee of usable artifacts and may install Micro before failing on the next plugin.

    **Correction:** Provide an explicit build-and-install workflow with all artifacts preflighted before installation, or publish complete versioned plugin packages. Verify the documented route from a clean checkout. Compare source and artifact versions so old local bundles cannot silently be installed.

**Further improvements, after the corrections**

- **Shared runtime:** Extract host WebSocket lifecycle, instance registration, encoder normalization, action errors, display caching, and bridge request handling into a tested internal module. Keep bridge-specific behavior behind small adapters. These duplicated functions already share the same bugs.
- **Explicit contracts:** Define versioned state/action schemas and capabilities. Validate incoming frames and HTTP bodies. Keep availability, history, activity, attention, and estimation as separate fields.
- **Antigravity performance:** `snapshot()` repeatedly reads recent transcripts, then `calculateRollingUsage()` rereads every conversation transcript on the 500 ms refresh path. Cache by modification time, incrementally parse appended records, and refresh quota/history aggregates less frequently. Long-running tools should not become idle simply because the transcript has not changed for 15 seconds.
- **Spotify rendering:** Use a bounded artwork cache and deduplicate in-flight downloads. Guard asynchronous renders with a track/revision ID so an old artwork fetch cannot repaint over a newer track. Decouple catalog loading from the initial host connection.
- **Local API boundary:** Apply authentication, origin/host validation, body size limits, schema validation, and consistent errors to all bridges. Codex Micro's response CORS header alone does not reject a request; the WebSocket upgrade paths also lack origin checks. Keep OAuth callback validation distinct from mutation authentication.
- **Credential storage:** Store Spotify refresh tokens in the OS credential store, or at minimum use a private directory and explicit 0600 files with atomic replacement. Serialize refresh attempts, bound network waits, and expire pending OAuth state.
- **Packaging and diagnostics:** Share atomic installer logic, include health checks and rollback, preflight Node/macOS requirements, and make port conflicts visible. Add bounded structured logs and a diagnostics view that distinguishes bridge, application, permission, and protocol failures.
- **Localization and configuration:** Use the existing locale files for runtime labels and inspectors; make prompt shortcuts configurable. Reduce copied Codex branding/assets in other plugins. Provide configurable application paths and selected terminal/session targets.

**Verification performed**

- Existing root tests: **20 passed, 1 failed**. The remaining failure is `test/codex_cli_test.mjs:30`, expected 1 task, received 5. An initial sandbox-only loopback failure disappeared when the mock-server tests were rerun with loopback access.
- Root Node syntax checks passed. Syntax checks passed for all four plugins.
- Codex Micro's existing smoke suite passed against its checked-in dist bundle. Spotify's manifest smoke and Antigravity's 42 structural assertions passed.
- All four plugin source entry points and all three bridge source entry points bundled successfully in memory with esbuild and the Node 20 target. Existing generated bundles were not overwritten; the full packaging/install pipeline was not executed.
- Temporary-fixture/source-handler checks confirmed: sibling runtime deletion, Spotify error-driven catalog replacement, empty-list fallback, CLI event/rejection schema mismatch, inaccurate quota fallback, encoder direction loss, reconnect display suppression, and omitted task-identity broadcasts.
- CLI protocol was checked against locally generated types from **codex-cli 0.154.0**, local command help, and [official app-server documentation](https://learn.chatgpt.com/docs/app-server).
- No physical Ulanzi device, live approval, live playlist modification, real uninstall, or arbitrary AppleScript execution was used for validation. Hardware, macOS permissions, and application-version compatibility still require acceptance testing.

Recommended implementation order: close the URI execution path and isolate uninstall ownership; repair CLI protocol and action targeting; fix catalog preservation and encoder behavior; correct state propagation and error reporting; then consolidate shared code and expand the test gate.
