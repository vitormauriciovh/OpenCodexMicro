# Parity acceptance record

This record distinguishes verified software behavior from outstanding live acceptance. It accompanies `feature-parity.md`; it does not narrow the objective to matching button lists.

## Verified installation and software checks

- Three installed developer plugins connected to Ulanzi Studio and their own authenticated loopback bridge.
- Studio found the newly installed Micro Model/Plan, CLI Plan and Antigravity Send Queued Message Now actions; the Deck Dock reported Connected.
- Installed manifests, entry points, inspector pages, eight locales and three bridge bundles matched the checked builds.
- The final combined gate passed 98 tests, seven builds and all four plugin smoke suites.
- CLI plan-history reads worked against the real daemon without task mutation. Antigravity selectors and Micro Plan labels have installed-source evidence.

## Outstanding live acceptance

| Area | Required observation | Current evidence |
| --- | --- | --- |
| Physical task keys and encoder | The intended task opens and the relevant viewport/task list moves on actual hardware | Studio recognizes the device; physical action result not reported |
| Approve, Reject, Stop | Only the intended request/turn in a disposable task changes | Task/turn guards and race fixtures; no personal approval or turn changed |
| Drafts, Submit and steering | Existing drafts survive; submitted or promoted content belongs to the intended task | Fixtures, native/protocol source; no personal prompt sent |
| New and Fork | A new or forked task appears once, in the intended workspace | Typed contracts and control fixtures; live end-to-end not exercised |
| Model, reasoning and Fast | Chosen settings are reflected in the correct task or next deck prompt | Typed parameters, exact controls and state fixtures |
| Plan viewing | Available native plan or saved text opens for the selected task | CLI real history read; Micro native source and fixtures |
| Goals | Explicit objective creation/toggle affects the intended task, respecting limited states | CLI protocol fixtures and Micro native controls; no goal changed for testing |
| Microphone/voice | Permission, recording indicator, selected-task binding and stop behave correctly | Existing native controls; CLI capture deferred because thread-only realtime lifecycle cannot guarantee session ownership |
| Reconnect/restart | The same installed versions reconnect after app/service restart | Studio/bridge restart verified; machine reboot not performed |

Do not test Stop or Reject on unrelated ongoing work, submit fabricated objectives, or record audio merely to turn this table green. Use an explicitly chosen disposable task and deliberate microphone initiation for live acceptance. Unavailable capabilities retain their documented platform-specific limits.

## Current follow-up status

The Micro native Plan action passed a combined 98-test gate and independent source review. After the user manually closed Studio, the 31-action Micro build and its bridge were installed, their files verified, and Studio reopened. The Deck Dock reported Connected, Codex View Plan appeared in the action search, and the bridge and plugin connections were verified. Installation is complete; the live acceptance items above remain unverified. CLI voice investigation was concluded without installing any capture code; method availability was confirmed by a read-only listVoices call, but the protocol lacks safe session-specific lifecycle preconditions.
