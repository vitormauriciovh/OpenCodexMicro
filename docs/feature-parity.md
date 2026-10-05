# Capabilities and acceptance limits

This reference describes the implemented adapters. Matching key names do not
establish equivalent behavior, and implemented controls do not establish live
application or physical-device acceptance. Use [AGENTS.md](../AGENTS.md) for
source routing and [setup and operations](setup-and-operations.md) for setup.

## Developer plugins

| Capability | Codex App | Codex CLI | Antigravity |
| --- | --- | --- | --- |
| Six task keys | Native task identity and selection | Paginated daemon tasks; dial navigation | Exact sidebar conversation selection |
| Status and model | Native application state | Selected daemon task, including ownership errors | Selected desktop task plus saved history |
| Task monitor | Rotate through active tasks; press to open the displayed task | Rotate through known active/attention tasks across pages; press to select the displayed task | Selected desktop task |
| Tokens and context | Reported metrics; unknown capacity stays unknown | Protocol metrics; cumulative tokens are not context usage | Transcript token estimates; missing capacity stays unknown |
| Five-hour and weekly usage | Application/account state | App-server quota windows | Only explicitly labeled, valid quota windows |
| New and Fork | Native task creation and Micro fork control | `thread/start` and `thread/fork` | Desktop controls; fork depends on the latest response and available workspace control |
| Approve and Reject | One native dispatch for the selected task | Method-specific, task-bound pending request | Unique enabled control in the selected conversation |
| Stop | Unique enabled native Stop control | Exact active `turn/interrupt` | Composer cancel or selected sidebar Stop execution |
| Attention navigation | Tasks requiring attention | Unique tasks with approvals, protocol-reported questions or errors | Conversations requiring feedback |
| Submit | Current application composer | Task-bound inspector draft, persisted across bridge restarts | Selected desktop composer |
| Steer | Native Steer action on the current composer | Task-bound draft and expected active turn ID | Promote one eligible message from the expanded selected-task queue using Send Now; preserve the composer |
| Test, review and commit-message prompts | Preserve existing draft | Typed turn request | Preserve draft and recheck selected conversation |
| Model and reasoning | Cycle native available options and confirm the selected task's value | Settings for the next prompt sent from the deck | Native model menu and supported reasoning choices |
| Fast | Native Micro control | Next deck prompt's service tier, when supported | No verified equivalent; Boost is unavailable |
| Pin | Native task control | No supported pin interface | Selected sidebar pin control |
| Encoder | Task-scoped native joystick/scroll | Task navigation; no terminal scroll or focus | Selected conversation viewport |
| Microphone | Native microphone control | Unavailable; no capture adapter | Native desktop microphone control |
| Plan and walkthrough | Open the selected task's existing native plan side panel; no dedicated walkthrough opener | Read-only inspector for saved native plan text and live checklist; no walkthrough opener | Open existing saved plan/walkthrough artifacts |
| Subagents | Native selected-task summary/open control, otherwise unknown | Exact parent-thread listing with bounded pagination | History/state summary |
| Goal | Pause/resume an existing goal | Explicit inspector objective creation and active/paused goal toggle | No verified equivalent |
| Grill-me | No dedicated action | No dedicated action | Unavailable |
| Inspector | Bridge installer/status | Ownership, errors, drafts, next-prompt settings, plans and goal input | Bridge/desktop connectivity and task errors |

## Behavioral boundaries

- Task identity and selection must remain exact. Refuse stale or ambiguous
  targets, preserve existing drafts, and do not replay a mutation after a timeout
  or uncertain response. Required native press/release pairs remain paired.
- Attention includes questions and errors; it is not proof of an approval.
  Codex App approval indicators describe the selected task. CLI approval requires
  one matching pending request; Reject must not fall back to Stop.
- Unknown metrics remain unknown and measured zero remains zero. Do not borrow
  another task's metadata, derive context usage from cumulative tokens, or infer
  quotas from activity. Antigravity's unlabeled quota data is not a five-hour window.
- CLI uses WebSocket framing over the managed app-server's Unix socket. A task
  owned by another writer remains read-only; the bridge does not take it over.
  Settings on the deck affect the next deck prompt, not an already running turn.
  Daemon terminal methods do not identify the user's terminal window or viewport.
- CLI cards show reported context per task, selection and distinct completed,
  stopped and error outcomes. Unknown context remains unknown. The monitor rotates
  through known active/attention tasks without changing selection; pressing it selects
  that instance's displayed task. Stop carries the displayed turn ID, and approval
  buttons carry the selected pending request ID. Questions are answered in the CLI.
- CLI saves up to 100 task-bound drafts in private local storage. A draft with
  uncertain delivery is retained but cannot be sent again until explicitly saved
  after checking the conversation. A disk failure before sending prevents submission;
  a cleanup failure after sending does not replay the prompt.
- CLI microphone remains unavailable: thread-only realtime append/stop methods
  do not provide the session ownership precondition needed to avoid affecting
  another client's replacement session. Protocol method presence alone does not
  establish safe capture or account voice availability.
- Codex App Goal controls an existing goal; create objectives in Codex itself.
  Antigravity Goal, Boost and Grill-me have no supported equivalent. Permission
  modes and invented slash commands are not substitutes.
- Antigravity Steer promotes an existing queued message. It does not send a new
  composer draft immediately. Missing, collapsed or ambiguous queue controls are
  unavailable. Fork likewise remains conditional and preserves drafts.
- Plan viewing is specific to each adapter. Codex App requires its unique enabled
  native plan control; CLI displays task-bound saved text/live steps and reports
  incomplete/error states. Delayed history must not replace newer live content.
  Opening a Codex native plan may cause the application to materialize its Markdown
  file; it does not choose Implement or submit a prompt.

## Spotify

The Spotify plugin controls local playback, track navigation, shuffle, repeat and
Spotify volume through macOS automation. Its keys display playback metadata and
artwork, and its picker opens saved Spotify links. Optional OAuth connects the
Web API for playlist/library catalog synchronization and saving the current track.
Manual links remain separate from imported catalog entries; failed synchronization
must preserve the last usable catalog. Spotify has its own local API inside the
plugin and does not use the developer bridges.

## Live acceptance still required

This documentation review did not run tests, install components, operate live
applications or exercise a physical deck. Fixtures, installed files and service
connectivity alone do not prove the observations below. Previously reported
deployments do not establish the current machine's state.

| Area | Required controlled observation |
| --- | --- |
| Physical keys and encoders | The intended task opens and the correct viewport or task list moves on actual hardware. |
| Approve, Reject and Stop | Only the intended request or turn in a disposable task changes, once. |
| Drafts, Submit and Steer | Existing drafts survive and sent/promoted content belongs to the intended task; verify each adapter's distinct steering behavior. |
| New and Fork | One new/forked task appears in the intended workspace; unavailable controls fail explicitly. |
| Model, reasoning and Fast | The correct task or next deck prompt reflects the chosen supported settings. |
| Plans and subagents | The selected task's available native view or read-only content appears; missing/incomplete data is identified. |
| Goals | Explicit creation or a supported toggle affects only the intended task; platform limits remain enforced. |
| Microphone | Deliberate initiation, permission, recording indication, task binding and stop behave correctly on supported applications. CLI remains unavailable. |
| Spotify | Playback, picker, volume and optional authenticated catalog/Like actions affect the intended player/account; unavailable playback/authentication is reported. |
| Reconnect and restart | Matching installed versions reconnect and restore displays after application/service restart; reboot persistence requires a separate observation. |

Use deliberately selected disposable tasks within the authorized scope. Do not
approve, reject or stop unrelated work, submit fabricated objectives, or record
audio merely to satisfy this checklist. Record the installed versions, observed
result and remaining gaps when live acceptance is actually performed.

CLI token monitoring follows a running task independently of the task selected for deck actions. It prefers the selected task when running, otherwise the most recently started running task (falling back to its update time). Counts are cumulative for that task, not combined across tasks or reset per turn. With no running task the display shows “No running task”; missing usage shows “Waiting for usage”, never another task’s count.

Codex App and CLI session cards show a selection dot and execution wall-clock duration, including approval/question waits. Duration freezes after completion/interruption and resets on the next observed execution. CLI uses reported turn start times when available; otherwise timing starts at detection. App timing is observed locally; a restart or a task leaving the tracked list can lose that timing history.
