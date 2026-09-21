# Feature parity — 21 September 2026

Codex Micro, Codex CLI and Antigravity now expose a broader common set of controls. The deployed adapters retain explicit capability limits; equal action names do not establish equal behavior. This inventory separates implementation and automated evidence from physical-device acceptance.

| Feature | Codex Micro | Codex CLI | Antigravity |
| --- | --- | --- | --- |
| Six task keys and selection | Present | Present; paginated listing and accumulated dial navigation | Exact sidebar conversation selection |
| Status/model/task monitor | Live application state | Selected daemon task, ownership diagnostics | Selected desktop task/model plus history |
| Tokens/context | Measured values only; unknown capacity stays unknown | Protocol metrics; no cumulative-to-context substitution | Transcript tokens explicitly estimated; missing capacity unknown |
| Five-hour and weekly usage | Application/account state | App-server quota read | Only explicitly labeled, valid quota windows; otherwise unknown |
| New task | Present | thread/start | Desktop new-conversation control |
| Fork | Native Micro control | thread/fork | Conditional current-workspace fork control; unavailable if absent |
| Approve / reject | Single native dispatch | Method-specific, task-bound pending approvals | Unique selected-conversation controls |
| Dedicated Stop | Exact enabled unique label; recording/dialog controls excluded | Exact turn/interrupt; Reject cannot fall back to Stop | Composer cancel or exact sidebar Stop execution |
| Attention navigation | Present | Pending approval tasks | Pending conversation selection |
| Submit prompt | Application composer | Task-bound inspector draft | Selected desktop composer |
| Steer | Existing composer control | Expected active turn ID and task-bound draft | Send Queued Message Now promotes one eligible message from the expanded selected-task queue; composer is preserved |
| Test / review / commit-message prompts | Preserve existing draft | Typed turn request | Preserve draft and recheck selected task |
| Model / reasoning | Model and Reasoning keys cycle native available models and supported effort levels, wrap, and confirm the selected task’s new value | Next deck prompt settings, pending until submitted | Model menu and supported reasoning choices |
| Fast | Native Micro control | Next deck prompt service tier when supported | No verified equivalent; Boost unavailable |
| Pin | Present | No verified pin interface | Selected sidebar pin |
| Dial/scroll | Task-scoped native joystick | Task navigation; no terminal scroll/focus interface | Selected conversation viewport |
| Microphone | Native Micro control | Deferred: experimental realtime has no atomic session ownership precondition for append/stop | Desktop microphone control |
| Plan/walkthrough artifacts | Native selected-task plan side panel when its unique control is available | Plan action and read-only inspector show native saved plan text/live checklist; no walkthrough artifact opener | Existing artifact views |
| Subagents | Visible selected-task summary/open control, otherwise unknown | Exact parentThreadId listing, bounded pagination | Existing history/state summary |
| Goal | Existing unique Pause/Resume goal control | Explicit objective in inspector; existing active/paused goal toggle | No verified equivalent |
| Grill-me | No dedicated action | No dedicated action | Unavailable |
| Inspector/diagnostics | Installer/status | Ownership, errors, drafts, next-prompt settings and explicit goal input | Bridge/desktop connectivity and selected task errors |

## Final installed verification

The latest integrated `npm run check` passed **98 tests**, seven builds, syntax checks and all four plugin smoke suites. Independent source review found no remaining blocker in the final additions. All three installed manifests, plugin entry points, inspector pages, eight locale files and bridge bundles match the checked builds: **Micro 31 actions, CLI 32, Antigravity 35**. Counts differ because some application-specific controls and aliases remain; counts alone are not evidence of feature equivalence.

Studio was reopened after installation. Deck Dock reported Connected; the new Model, Plan and Send Queued Message Now actions were found in Studio. The installed plugin processes had established connections to Studio and their own bridges, and the three bridge health checks reported connected. The Micro Plan installation blocker was resolved after the user manually closed Studio. Eight previous plugin directories are retained outside Studio discovery under `~/Library/Application Support/OpenCodexMicro/plugin-backups/`. The oldest backups predate API authentication; restoring those alone against the newer bridge is not a compatible rollback.

The fixtures cover task/turn guards, draft preservation, ambiguous/disabled controls, stale approvals, Unix WebSocket transport, ownership failures, quota unknown/zero behavior, reconnection, localization, plan history races and installer backups. Selected-task model/token cards never borrow another recent task's metadata. Context capacity remains unknown unless measured; zero remains zero. No personal prompt, approval, Stop or goal action was executed for validation, and no audio was recorded.

## Native behavior and remaining differences

CLI uses the official standalone 0.154.0 app-server daemon through WebSocket over its Unix socket. Real read-only queries verified task listing, quota methods and saved-plan history. The bridge launcher starts the daemon when its LaunchAgent starts. A task with another active writer remains read-only; the bridge does not take over ownership. Model/reasoning/Fast options apply to the next prompt sent from the deck. The inspector preserves task-bound drafts and displays ownership errors. A terminal intended to share daemon tasks can use `codex --remote unix://`.

CLI Plan reads native `plan` items through descending `thread/items/list` pages and shows live `turn/plan/updated` steps. Task/turn IDs, bounded pagination, incomplete/error states and plain-text rendering prevent wrong-task or misleading content. Delayed history cannot overwrite a newer live document. The live read-only query found ten items and no saved plan in that particular task. This is an inspector viewer, distinct from Antigravity's artifact window.

Micro Plan activates the installed desktop's exact localized Open plan in side panel control. It opens an existing native plan and does not choose Implement or submit a prompt. The app may materialize its own plan Markdown file while opening it. Missing, hidden, disabled, inert, modal or ambiguous targets remain unavailable. The key and its rendering are covered by fixtures and installed-source evidence; live activation remains unverified.

Antigravity uses the observed selected conversation and refuses stale targets. New/fork, approval/rejection/Stop, pin, model/reasoning, microphone and scrolling use application controls. Fork availability depends on the task and latest response. Send Queued Message Now follows the installed 2.15.1 frontend's native NEXT_INVOCATION handler: one eligible message in the expanded selected-task queue is promoted, without altering the composer or delivery preferences. It is not equivalent to sending a new composer draft immediately. Unlabeled GetUserStatus data is never treated as a five-hour quota.

## Confirmed capability boundaries

- **CLI pin:** the inspected contract exposes opaque custom-section IDs without a canonical pinned role or pin method. The live section response contains id, name and appearance; the name does not establish a native pin target. No local-bookmark substitute was added.
- **CLI microphone:** the experimental protocol has realtime methods, and a read-only listVoices call succeeded. However, start replaces a previous session, and append/stop accept only a thread ID without an expected session precondition. A local capture nonce cannot prevent automatic cleanup from stopping another client's replacement session. The incomplete adapter was withdrawn before installation. A safe implementation needs atomic start-if-absent and expected-session guards, or an independently owned transport with conditional closure. Method presence does not prove account voice availability.
- **CLI terminal controls:** command/exec and background-terminal methods refer to daemon processes; they do not identify the user's terminal window or viewport. Generic foreground keystrokes are not an equivalent task-scoped interface.
- **Micro goal creation:** the verified UI entry is the native `/goal` composer flow, which changes composer mode and opens the objective editor. No exact Create/Add goal button was verified without manipulating a draft. The deck key pauses/resumes an existing goal; creation remains in Codex itself.
- **Antigravity Goal, Boost and Grill-me:** no verified equivalent was found in the installed frontend. Autonomous Mode changes permission behavior and is not a goal equivalent. Unavailable keys never send invented slash commands.
- **Walkthrough:** Antigravity exposes its saved artifact; no equivalent dedicated native walkthrough contract was verified for Micro or CLI. Native plans are supported as described above.

## Completion status

Implementation, builds and installation of the supported additions are complete. Full live acceptance is still unproven: physical task keys/encoder, selected-task effects, approvals/Stop, drafts/submission, new/fork, settings, goals, microphone and plan activation need controlled observations. Service connectivity and passing fixtures do not prove every live UI effect. Machine reboot persistence is configured but has not been verified by rebooting. The detailed evidence and remaining observations are in `parity-acceptance.md`; the goal must not be marked achieved on installation evidence alone.
