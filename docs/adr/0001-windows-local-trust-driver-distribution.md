# ADR 0001: Windows Local-Trust Driver Distribution

## Status

Accepted

## Context

Codex Desktop on Windows does not expose the CDP launch path used by the macOS Bridge. OpenCodexMicro therefore presents a compatible virtual HID device to Codex Desktop. Windows requires kernel drivers to be signed and trusted, while obtaining and maintaining a production Microsoft driver signature is outside the current release scope.

## Decision

The Windows plugin package uses **Windows Local-Trust Mode**:

- The `.ulanziPlugin` contains a prebuilt x64 driver, virtual-device runtime, native installer helper, public development certificate, and a hash manifest.
- A visible UAC-elevated PowerShell workflow verifies every bundled payload hash and the certificate thumbprint before changing the system.
- The user explicitly trusts the project development certificate in the local machine certificate stores.
- The installer enables Windows Test Signing when required and reports a required restart without initiating it.
- Secure Boot remains a manual user decision when it prevents Test Signing.
- The runtime starts through a limited, current-user scheduled task.
- Uninstall removes the runtime, task, driver package, device, and project certificate, but leaves Test Signing unchanged.
- Windows support initially targets Windows 10 22H2 x64 and Windows 11 x64. ARM64 and Windows Server are unsupported.

## Consequences

- Windows users receive a self-contained setup and repair path from the plugin configuration page.
- Installation changes machine trust and boot policy, requires administrator approval, and may require a restart or manual Secure Boot change.
- The package must regenerate and verify its payload manifest whenever a signed binary, driver, certificate, architecture, minimum build, or version changes.
- This mode is appropriate for explicit local installation and testing, not a claim of Microsoft production driver certification.
- A future production-signed driver can replace this distribution mode behind the same Platform Setup interface.
