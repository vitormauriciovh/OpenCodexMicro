# OpenCodexMicro

OpenCodexMicro connects Codex Desktop actions and state to an Ulanzi control surface across supported desktop platforms.

## Language

**Platform Capability Profile**:
The current platform's authoritative description of setup readiness, connection health, and Action availability.
_Avoid_: Bridge status, CDP status

**Windows Local-Trust Mode**:
A Windows distribution mode in which the project supplies a development-signed virtual-device driver and each user explicitly trusts its public certificate and accepts the associated system security requirements.
_Avoid_: Local signing, production signing, official driver signing

**Platform Setup**:
The platform-specific prerequisites and recovery workflow required before Actions are available.
_Avoid_: Bridge installation

**Experimental UI Automation Action**:
A Windows Action whose availability depends on Codex exposing a matching accessible control in the current desktop session.
_Avoid_: Native Action, fully supported Action
