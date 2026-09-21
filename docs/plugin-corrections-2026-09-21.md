# Plugin corrections — 21 September 2026

All 14 findings in `plugin-review-2026-09-21.md` have code corrections. That document records the original review; its line references and baseline test results describe the pre-fix code. Component attribution remains as documented in NOTICE.md.

| Review finding | Applied correction |
| --- | --- |
| 1. Spotify URI execution and exposed local APIs | Strict URI validation at ingestion, cache load and execution; fixed AppleScript with positional arguments; private bearer credentials, Host/Origin checks for HTTP and WebSocket upgrades, bounded JSON input. Inspector requests use the native plugin relay. OAuth callback retains expiring single-use state validation. |
| 2. Sibling deletion | Per-component runtime directories and explicit legacy ownership inventory; component uninstall preserves siblings; explicit uninstall-all unloads every owned service. |
| 3–4. CLI protocol and approvals | Initialize/initialized, typed thread listing/resume, per-thread lifecycle tracking, method-specific approvals, exact thread selection, typed turn/start and turn/interrupt; failed writes retain pending approvals. |
| 5. Unsafe UI fallbacks | Removed generic terminal/editor keystrokes. Antigravity actions now use exact selected-conversation desktop controls; absent controls fail explicitly. Unsupported slash-command actions show unavailable. CLI terminal focus is disabled. |
| 6. Catalog loss | Checked API responses, complete pagination before atomic replacement, preserved last-good catalog, empty selections supported, separate manual/imported storage. Legacy selections migrate to editable manual storage, with the original file retained. |
| 7. Encoder events | Shared named/numeric direction normalization, bounded deltas and Spotify library offsets. |
| 8. Reconnect display loss | Cache only while the host is open, invalidate on reconnect and ignore obsolete socket events. |
| 9. Incomplete broadcasts | Digest covers visible state except sampling timestamps; timed display refresh for elapsed/countdown values. |
| 10. Fabricated metrics | Missing quota remains unknown. CLI activity and tokens come from protocol events. Antigravity transcript estimates are marked as estimates, and old unfinished activity remains unknown. |
| 11. Incomplete controls | Spotify Like saves the current track. CLI session keys select the specified thread; Continue sends a typed turn request. Antigravity session/attention keys select exact conversations; plan/walkthrough retain their artifact actions. |
| 12. Hidden failures | Checked HTTP/action results and propagated automation errors, deck alerts, consistent bounded requests without automatic action retries. |
| 13. Test gaps | Hermetic protocol/filesystem/network fixtures; behavioral action, reconnect and error smoke tests for Spotify, CLI and Antigravity; all four plugins in the root check gate. |
| 14. Missing build artifacts | Installers build and preflight; install-all finishes all builds/preflights before replacement. Shared staged replacement with rollback. |

Additional improvements include bounded/deduplicated artwork caching, stale asynchronous render protection, private atomic credential files, serialized refresh/sync, transcript caching and a slower quota refresh cadence.

Initial correction validation: `npm run check` passed: **47 tests**, all seven bridge/plugin builds, syntax checks, and all four plugin smoke suites. The exploit regression rejects malicious URI inputs before invoking any process; legitimate track/playlist inputs use fixed-script arguments. Authenticated fixture requests succeed and browser/unauthenticated requests are rejected before side effects. Independent read-only security candidate review found the legacy playlist migration issue, now covered by a passing regression test. Security finding status: **fixed** for the reviewed injection/authentication paths.

The fixture suite does not establish physical deck behavior, macOS automation permissions, live Spotify account behavior, or compatibility of a running CLI daemon with the pinned 0.154.0 schema. Antigravity controls without a reliable target-specific API remain explicitly unavailable.

## Updating and diagnostics

Update both plugins and bridges together: the new API authentication requires matching versions. Quit Ulanzi Studio, run `npm run install:all` and `npm run setup:all`, then reopen Ulanzi Studio. Setup restarts bridge services but does not launch the Codex Bridge wrapper or quit Codex.

Run `node scripts/bridge-status.mjs codex`, `antigravity`, `codex-cli`, or `spotify` from this checkout for an authenticated health check. Add `state` for full state. Plain unauthenticated curl requests now return 403. Credentials remain in private local files and are never passed to browser inspectors. The Spotify Like operation uses the [current Save Items to Library endpoint](https://developer.spotify.com/documentation/web-api/reference/save-library-items).

## Completed local deployment

On 21 September 2026, final integrated validation passed **91 tests**, seven builds and all four plugin smoke suites. A subsequent Micro Reject label adjustment was rebuilt and its smoke/syntax checks passed. See `feature-parity.md` for the final controls and remaining live acceptance limits.

The official standalone Codex CLI 0.154.0 was installed alongside the existing npm installation. Its daemon was started successfully; the bridge launcher starts it on service startup. The daemon's Unix WebSocket transport now connects successfully.

After explicit permission, Ulanzi Studio was closed, `npm run install:all` and `npm run setup:all` completed, and Studio was reopened. All four installed plugin manifests, entry points and eight locales match the source builds. The new actions are visible in Studio. Codex Micro, CLI and Antigravity bridges report connected without errors, and the actual installed plugin processes have established Studio and bridge connections. Spotify's local service responds; Spotify itself was not running. Unauthenticated reads return 403 on all four ports.

Four previous plugin directories were retained under `~/Library/Application Support/OpenCodexMicro/plugin-backups/`. They are outside plugin discovery. The old plugins lack the new authentication and must not be restored alone against the new bridges. Physical deck and live account/action acceptance remains outstanding; no personal tasks were submitted, stopped or approved for validation.

A subsequent parity update passed **97 tests** plus all builds/smoke suites, and was installed with Studio closed/reopened. It adds Micro model selection, CLI plan viewing and Antigravity queued-message Send Now, and fixes Micro selected-task metric fallback. The new actions were found in the reopened Studio, the Deck Dock reported Connected, and bridge checks passed. Full capability and acceptance limits are recorded in `feature-parity.md`.

The final Micro Plan follow-up passed the 98-test integrated gate and was installed after manual Studio shutdown. Micro now has 31 actions; its files and bridge match the validated builds. Studio was reopened and Codex View Plan visually confirmed. Physical button activation remains a separate acceptance check.
