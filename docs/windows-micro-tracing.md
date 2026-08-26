# Windows Codex Micro tracing

This diagnostic launcher observes the Codex Micro integration bundled with the
Microsoft Store Codex app. It does not modify the MSIX package, replace the
Work Louder implementation, emulate a device, or persist environment variables.

## What it records

The preload hook wraps the real modules and records newline-delimited JSON for:

- Codex Micro HID topology discovery and topology-change notifications;
- Work Louder device discovery, connection, and disconnection;
- HID and joystick notifications;
- JSON-RPC requests and responses;
- device status, thread lighting, and ambient/key lighting calls.

Device paths are redacted by default. Pass `-VerboseTrace` only when full local
device descriptors are required for diagnosis. Trace files stay under the
current user's `%LOCALAPPDATA%\OpenCodexMicro\diagnostics` directory unless an
explicit `-TraceLog` path is supplied.

## Run

First validate the detected package and launcher without starting Codex:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File `
  .\scripts\windows\Launch-Codex-Micro-Trace.ps1 -DryRun
```

Then fully quit Codex, including its tray process, and run from a normal,
non-administrator Windows PowerShell session:

```powershell
.\scripts\windows\Launch-Codex-Micro-Trace.cmd
```

On an Administrator-only Windows session, the launcher creates a restricted
Windows token, disables the Administrators group for access checks, lowers the
token to Medium integrity, and verifies it before launching Codex. Verify that
path without restarting Codex:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File `
  .\scripts\windows\Launch-Codex-Micro-Trace.ps1 -ProbeLaunchContext
```

Use Codex normally and, if available, connect or disconnect the target hardware.
Quit Codex before reading or sharing the completed trace.

If this machine only exposes an elevated Administrator session, startup tracing
can be forced explicitly:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File `
  .\scripts\windows\Launch-Codex-Micro-Trace.ps1 -AllowElevated
```

An elevated Codex process may report that projects are inaccessible. The trace
can still establish whether the Micro native modules loaded and whether device
discovery ran, but use a non-administrator launch for normal project work.

## Safety boundaries

- Do not take ownership of or edit `C:\Program Files\WindowsApps`.
- Do not set `NODE_OPTIONS` globally with `setx`.
- Do not use `-AllowElevated` for normal project work.
- Do not distribute files extracted from the proprietary Work Louder package.
- Review a trace before sharing it; verbose traces may contain hardware paths.

## Expected milestones

Without supported hardware, the trace should show the topology module loading
and `findCodexMicroInterfaces` returning an empty list. With supported hardware,
it should then show connection events, lighting calls, and subscriptions for
`v.oai.hid` and `v.oai.rad` notifications.

The next prototype can replace the traced topology and device API with a
loopback-only virtual device backed by the OpenCodexMicro Bridge. Keep that
separate from this trace-only hook so diagnostics remain behavior-preserving.
