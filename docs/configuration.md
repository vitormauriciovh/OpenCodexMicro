# Configuration

The OpenCodexMicro layout is configured entirely inside Ulanzi Studio. Open the **AI** category (for Codex Micro and Antigravity) or the **Music** category (for Spotify) and drag actions onto the desired keypad and encoder slots.

---

## 1. Codex Micro Actions (`com.ulanzi.ulanzistudio.codexmicro`)

| Action | Type | Behavior |
| --- | --- | --- |
| **Codex Task 1–5** | Keypad | Displays the matching Most Recent task title, model, and live status badge (`IDLE`, `WORKING`, `COMPLETED`, `ATTENTION`, `ERROR`). Press to switch to that exact task. |
| **Codex Fast** | Keypad | Toggle Fast mode for the active task. |
| **Codex Usage** | Keypad | Show remaining allowance gauge and reset countdown; press to focus Codex Desktop. |
| **Codex 5H Usage** | Keypad | Display remaining 5-hour Codex usage ring and live countdown to reset. |
| **Codex Weekly Usage** | Keypad | Display remaining weekly Codex usage ring and live countdown to reset. |
| **Codex Task Monitor** | Keypad | Show active task type and model. Cycles across tasks or mirrors the current task. |
| **Codex Token Monitor** | Keypad | Display session token usage and context window percentage. |
| **Codex Reasoning Effort** | Keypad | Display and cycle reasoning effort level (`Low` / `Med` / `High`). |
| **Codex Approve** | Keypad | One-touch approve pending command or tool confirmation in the active task. |
| **Codex Deny** | Keypad | One-touch reject or cancel pending tool execution in the active task. |
| **Codex Attention Alert** | Keypad | Displays the count of tasks requiring attention/intervention; press to jump directly to the pending task. |
| **Codex Stop Generation** | Keypad | Instantly cancel or stop the active generation turn. |
| **Pin Codex Task** | Keypad | Pin or unpin the active task. |
| **New Codex Task** | Keypad | Create a new Codex task. |
| **Fork Codex Task** | Keypad | Fork the active task into a new thread. |
| **Steer Codex** | Keypad | Send current composer text as steering instructions to a running task. |
| **Codex Microphone** | Keypad | Toggle the Codex microphone action. |
| **Submit to Codex** | Keypad | Submit or queue the current composer prompt. |
| **Codex Prompt: Test & Fix** | Keypad | One-tap prompt asking Codex to run tests and fix errors. |
| **Codex Prompt: Code Review** | Keypad | One-tap prompt asking Codex to review recent code changes for bugs and security risks. |
| **Codex Prompt: Commit Msg** | Keypad | One-tap prompt asking Codex to generate conventional git commit messages. |
| **Latest Task & Scroll** | Encoder | Press to open task 1; turn left to scroll up and right to scroll down. |

---

## 2. Antigravity AI Agent Actions (`com.ulanzi.ulanzistudio.antigravity`)

| Action | Type | Behavior |
| --- | --- | --- |
| **Antigravity Session 1–5** | Keypad | Show active Antigravity session status, title, elapsed execution time, and model. Press to focus the session in VS Code. |
| **Agent HUD** | Keypad | Real-time status HUD (`PLANNING`, `EXECUTING`, `WAITING`, `IDLE`) with session title and live timer. |
| **Antigravity Proceed** | Keypad | One-touch approval for Implementation Plans, permission prompts, and tool calls. |
| **Antigravity Cancel** | Keypad | Stop execution or cancel the pending action immediately. |
| **Antigravity Attention** | Keypad | Show count of sessions needing user feedback and switch directly to the active session. |
| **Antigravity Subagents** | Keypad | Display the count of active subagents executing in the background. |
| **Antigravity Tokens** | Keypad | Display session token usage, last turn consumption, and context window gauge. |
| **Antigravity Usage** | Keypad | Display remaining Antigravity context window and session allowance with reset countdown. |
| **Antigravity 5H Usage** | Keypad | Circular gauge for 5-hour allowance and reset countdown. |
| **Antigravity Weekly Usage** | Keypad | Circular gauge for weekly allowance and reset countdown. |
| **Antigravity /boost** | Keypad | Inject `/boost` slash command for deep reasoning and rigorous planning. |
| **Antigravity /grill-me** | Keypad | Inject `/grill-me` slash command for interactive architectural interview. |
| **Antigravity /goal** | Keypad | Inject `/goal` slash command for long-running autonomous execution. |
| **Antigravity View Plan** | Keypad | Focus and open the active `implementation_plan.md` artifact in VS Code. |
| **Antigravity Walkthrough**| Keypad | Focus and open the `walkthrough.md` artifact in VS Code. |
| **Antigravity New Session**| Keypad | Focus VS Code to start a new Antigravity session. |
| **Antigravity Latest & Scroll** | Encoder | Press to focus latest session; turn left/right to scroll VS Code editor. |

---

## 3. Spotify Music Picker Actions (`com.ulanzi.ulanzistudio.spotify`)

| Action | Type | Behavior |
| --- | --- | --- |
| **Spotify Now Playing** | Keypad | Wide-screen HUD showing current track, artist, cover art, and progress bar. |
| **Music Picker Slot 1–10** | Keypad | Quick-tap slots for playlists, albums, daily mixes, and top tracks with active indicator. |
| **Spotify Play / Pause** | Keypad | Toggle playback. |
| **Spotify Next Track** | Keypad | Skip to the next track. |
| **Spotify Previous Track**| Keypad | Return to previous track. |
| **Spotify Like** | Keypad | Save / Like current track in your Spotify library. |
| **Spotify Shuffle** | Keypad | Toggle shuffle mode. |
| **Spotify Repeat** | Keypad | Toggle repeat mode. |
| **Spotify Volume Dial** | Encoder | Rotate to adjust system/Spotify volume; press to play/pause. |
| **Playlist Scroll Dial** | Encoder | Rotate to scroll through playlists. |

---

## Recommended Keypad Layouts

### Layout A: AI Agent Pair Programming
- **Row 1**: `Codex Task 1` | `Codex Task 2` | `Codex Task 3` | `Codex Task 4` | `Codex Task 5`
- **Row 2**: `Agent HUD` | `Antigravity Proceed` | `Antigravity Cancel` | `Antigravity Attention` | `Antigravity Tokens`
- **Row 3**: `Antigravity /boost` | `Antigravity /grill-me` | `Antigravity /goal` | `Antigravity View Plan` | `Antigravity Walkthrough`
- **Encoder 1**: `Latest Task & Scroll` (Codex / Antigravity)
- **Encoder 2**: `Spotify Volume Dial`

### Layout B: Coding + Media Control
- **Row 1**: `Codex Task 1` | `Codex Task 2` | `Codex Approve` | `Codex Deny` | `Codex 5H Usage`
- **Row 2**: `Spotify Now Playing` | `Spotify Play/Pause` | `Spotify Next` | `Music Slot 1` | `Music Slot 2`
- **Row 3**: `Music Slot 3` | `Music Slot 4` | `Music Slot 5` | `Spotify Like` | `Spotify Shuffle`
- **Encoder 1**: `Latest Task & Scroll`
- **Encoder 2**: `Spotify Volume Dial`

---

## Runtime Requirements

- **Codex Desktop**: Start via `~/Applications/Codex Bridge.app`. Keep the bridge sidecar running on port `17373`.
- **Antigravity**: Ensure the LaunchAgent `io.openantigravitymicro.bridge` is running on port `17374`.
- **macOS Accessibility**: Grant permission to Ulanzi Studio in **System Settings > Privacy & Security > Accessibility** for rotary encoder scroll emulation.
- **Restarting Ulanzi Studio**: Restart Ulanzi Studio whenever new plugins are copied or updated.

