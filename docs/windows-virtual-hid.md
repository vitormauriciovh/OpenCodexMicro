# Windows virtual Codex Micro prototype

This prototype exposes a vendor-defined virtual HID device with the Codex Micro
HID attributes. It does not modify the MSIX package and does not require CDP or
`NODE_OPTIONS` after the driver is installed.

The current Codex Windows native topology watcher also requires the HID
interface path to contain both a Codex vendor token and product token. Microsoft
VHF exposes the correct attributes but uses the generic
`HID#HID_DEVICE_SYSTEM_VHF` interface path, so this VHF prototype is not by
itself discoverable by Codex Desktop.

## Architecture

```text
Codex Desktop
  -> @worklouder/device-kit-oai
  -> HID VID 303A / PID 8360 / usage page FF00
  -> OpenCodexMicroVhf.sys (KMDF + Microsoft VHF)
  -> OpenCodexMicroVirtualDevice.exe
  -> loopback control API on 127.0.0.1:17374
```

The implementation follows Microsoft's
[Virtual HID Framework](https://learn.microsoft.com/en-us/windows-hardware/drivers/hid/virtual-hid-framework--vhf-)
model. VHF currently requires a kernel-mode HID source driver. The driver links
the WDK `VhfKm.lib` library and installs `vhf.sys` as its lower filter.

## Implemented protocol

- Vendor ID: `0x303A`
- Product ID: `0x8360`
- Usage page: `0xFF00`
- Report ID: `0x06`
- Input and output report size: 64 bytes
- RPC channel: `2`
- Payload size: 61 bytes per report
- Frame layout: `[0x06, channel, payloadLength, ...UTF-8 payload]`
- Host requests are accumulated until they form a complete JSON value.
- Device responses are JSON followed by `\n`, split into 61-byte chunks.

The user-mode emulator currently handles:

- `sys.version`
- `device.status`
- `lights.preview`
- `v.oai.thstatus`
- `v.oai.rgbcfg`
- `v.oai.hid` notifications
- `v.oai.rad` notifications

## Build

Requirements:

- Visual Studio 2022 C++ build tools
- Visual Studio component `Windows Driver Kit Build Tools`
- Windows Driver Kit 10.0.26100 or later
- Administrator PowerShell for signing and installation

Build the driver, catalog, and user-mode emulator:

```powershell
npm run build:virtual-hid
```

Run the user-mode protocol self-test without installing the driver:

```powershell
.\windows\virtual-hid\out\Debug\OpenCodexMicroVirtualDevice.exe --self-test
```

Artifacts are generated under:

```text
windows\virtual-hid\out\Debug
```

The build script uses the official `WindowsKernelModeDriver10.0` MSBuild
toolset. Install the WDK Build Tools component into the Visual Studio 2022
instance; installing only the standalone WDK files is not sufficient.

## Development signing and installation

This is not a production-signed driver. Development installation requires
Windows test-signing mode and normally adds a test-mode watermark.

Prepare and trust the local development certificate without installing:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File `
  .\windows\virtual-hid\Install-VirtualHid.ps1 -PrepareOnly
```

Enable test signing when Secure Boot is disabled:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File `
  .\windows\virtual-hid\Install-VirtualHid.ps1 -EnableTestSigning
```

### If Secure Boot blocks Test Signing

Secure Boot protects the Windows startup chain. Local-trust development drivers
require it to remain disabled while they are in use. Before changing firmware
settings, save your work and make sure your BitLocker recovery key is available;
Windows Recovery Environment or a firmware change may request it.

1. On Windows 11, open **Settings > System > Recovery**. On Windows 10, open
   **Settings > Update & Security > Recovery**.
2. Under **Advanced startup**, select **Restart now**.
3. Select **Troubleshoot > Advanced options > UEFI Firmware Settings > Restart**.
4. In UEFI/BIOS, find **Secure Boot**, commonly under **Security**, **Boot**, or
   **Authentication**, set it to **Disabled**, then **Save & Exit**. Firmware
   wording varies by manufacturer; consult the PC manufacturer's documentation
   if the setting is not visible.
5. After Windows starts, run **Install / Repair** again. The installer enables
   Test Signing and reports when another Windows restart is required.

Microsoft references:

- [Windows 11 and Secure Boot](https://support.microsoft.com/en-us/windows/security/devicesecurity/windows-11-and-secure-boot)
- [Windows Recovery Environment](https://support.microsoft.com/en-us/windows/windows-recovery-environment-0eb14733-6301-41cb-8d26-06a12b42770b)

To restore the stronger default boot policy later, uninstall the Windows
platform setup, disable Test Signing with `bcdedit.exe /set testsigning off`,
restart Windows, and re-enable Secure Boot in UEFI/BIOS.

Restart Windows. Then install and enumerate the virtual device:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File `
  .\windows\virtual-hid\Install-VirtualHid.ps1
```

Start the RPC emulator before opening Codex Desktop:

```powershell
.\windows\virtual-hid\out\Debug\OpenCodexMicroVirtualDevice.exe
```

Codex can then be started normally from the Start menu.

## Verification

Verify the source device and VHF child:

```powershell
$root = Get-PnpDevice -Class System -PresentOnly |
  Where-Object FriendlyName -EQ 'OpenCodexMicro Virtual Codex Micro'
$root

(Get-PnpDeviceProperty $root.InstanceId `
  -KeyName DEVPKEY_Device_Children).Data |
  ForEach-Object { Get-PnpDevice -InstanceId $_ }
```

Windows 10 VHF children use generic `VHF\HID_DEVICE_SYSTEM_VHF` and
`HID\HID_DEVICE_SYSTEM_VHF` instance IDs. The configured `VID=303A` and
`PID=8360` are exposed through the HID attributes API rather than the instance
ID string.

Inspect the exact fields used by the Codex native topology watcher:

```powershell
.\windows\virtual-hid\Get-VirtualHidDiagnostics.ps1
```

For the VHF prototype, `VendorId`, `ProductId`, `UsagePage`, and report lengths
match, and `ReadWriteOpen` is true. `CodexPathMatch` is false because the
interface path does not contain `vid_303a` and `pid_8360`.

Verify the user-mode emulator:

```powershell
Invoke-RestMethod http://127.0.0.1:17374/health
Invoke-RestMethod http://127.0.0.1:17374/state
```

On Windows, the Ulanzi Studio plugin automatically uses this HID Bridge at
`http://127.0.0.1:17374`. The plugin converts the compact thread-lighting state
into six task slots and sends task, Fast, Fork, Mic, and Submit actions back as
native Codex Micro HID reports. Pin, New, and Steer still require the CDP Bridge
because Codex does not expose physical HID key codes for those renderer-only
actions.

Send test notifications to Codex:

```powershell
Invoke-RestMethod -Method Post `
  'http://127.0.0.1:17374/notify/hid?key=AG00&act=1'

Invoke-RestMethod -Method Post `
  'http://127.0.0.1:17374/notify/joystick?angle=0.25&distance=1'
```

Codex recognizes these physical key identifiers:

- Agent keys: `AG00` through `AG05`; Codex derives slots 0 through 5.
- Configurable action keys: `ACT06` through `ACT12`.
- Encoder rotation: `ENC_CW` and `ENC_CC` with `act=2`.
- Other `ENC*` keys are treated as encoder press/release using `act=1`/`act=0`.

The generic notification endpoint accepts arbitrary key strings so additional
firmware identifiers can still be investigated.

## Uninstall and rollback

Remove the virtual device:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File `
  .\windows\virtual-hid\Uninstall-VirtualHid.ps1
```

Disable test signing when no other development driver needs it, then restart:

```powershell
bcdedit.exe /set testsigning off
```

## Current limitations

- The package uses a local development certificate, not a production driver
  signature.
- Codex Desktop's Windows topology watcher rejects the generic VHF interface
  path before reading its otherwise-correct HID attributes.
- The UdeCx replacement is in `windows/virtual-usb/`. Build and switch to it
  with `windows/virtual-usb/Install-VirtualUsb.ps1`; the installer removes the
  obsolete VHF root device first.
- After UdeCx installation, run `Get-VirtualHidDiagnostics.ps1` again. The new
  `HID#VID_303A&PID_8360...` interface should report `CodexPathMatch=True`.
- The UdeCx path has been validated against Codex Desktop's native
  `findCodexMicroInterfaces()` function. Codex also sends `v.oai.thstatus` and
  lighting RPC messages to the user-mode emulator, confirming bidirectional
  HID transport.
- The loopback API has not yet been wired into the Ulanzi Studio plugin.
- The root driver prototype currently targets x64 Windows only.

Remove the UdeCx device with:

```powershell
.\windows\virtual-usb\Uninstall-VirtualUsb.ps1
```
