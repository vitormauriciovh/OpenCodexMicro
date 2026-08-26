param(
    [switch]$EnableTestSigning,
    [switch]$PrepareOnly
)

$ErrorActionPreference = 'Stop'
$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = [Security.Principal.WindowsPrincipal]::new($identity)
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw 'Run this installer from an administrator PowerShell session.'
}

$projectRoot = $PSScriptRoot
$repositoryRoot = Split-Path -Parent (Split-Path -Parent $projectRoot)
$outputRoot = Join-Path $projectRoot 'out\Debug'
$infPath = Join-Path $outputRoot 'OpenCodexMicroUde.inf'
$sysPath = Join-Path $outputRoot 'OpenCodexMicroUde.sys'
$catPath = Join-Path $outputRoot 'OpenCodexMicroUde.cat'
$kitsRoot = (Get-ItemProperty 'HKLM:\SOFTWARE\Microsoft\Windows Kits\Installed Roots').KitsRoot10
$kitVersion = Get-ChildItem -LiteralPath (Join-Path $kitsRoot 'Tools') -Directory |
    Where-Object { $_.Name -match '^\d+\.\d+\.\d+\.\d+$' } |
    Sort-Object { [version]$_.Name } -Descending |
    Select-Object -First 1 -ExpandProperty Name
$devcon = Join-Path $kitsRoot "Tools\$kitVersion\x64\devcon.exe"
$signtool = Join-Path $kitsRoot "bin\$kitVersion\x64\signtool.exe"
$certificateSubject = 'CN=OpenCodexMicro Virtual USB Development'

function Get-RootDeviceByHardwareId([string]$HardwareId) {
    Get-ChildItem -LiteralPath 'HKLM:\SYSTEM\CurrentControlSet\Enum\ROOT' -Recurse -Depth 2 -ErrorAction SilentlyContinue |
        Where-Object {
            (Get-ItemProperty -LiteralPath $_.PSPath -Name HardwareID -ErrorAction SilentlyContinue).HardwareID -contains $HardwareId
        } |
        ForEach-Object {
            $relativePath = $_.Name.Substring($_.Name.IndexOf('ROOT\'))
            Get-PnpDevice -InstanceId $relativePath -ErrorAction SilentlyContinue
        } |
        Select-Object -First 1
}

& (Join-Path $projectRoot 'Build-VirtualUsb.ps1') -Configuration Debug

$certificate = Get-ChildItem Cert:\LocalMachine\My |
    Where-Object Subject -EQ $certificateSubject |
    Where-Object NotAfter -GT (Get-Date).AddDays(30) |
    Sort-Object NotAfter -Descending |
    Select-Object -First 1
if (-not $certificate) {
    $certificate = New-SelfSignedCertificate -Type CodeSigningCert -Subject $certificateSubject -CertStoreLocation Cert:\LocalMachine\My -HashAlgorithm SHA256 -NotAfter (Get-Date).AddYears(3)
}

$certificatePath = Join-Path $outputRoot 'OpenCodexMicroVirtualUsb.cer'
Export-Certificate -Cert $certificate -FilePath $certificatePath -Force | Out-Null
Import-Certificate -FilePath $certificatePath -CertStoreLocation Cert:\LocalMachine\Root | Out-Null
Import-Certificate -FilePath $certificatePath -CertStoreLocation Cert:\LocalMachine\TrustedPublisher | Out-Null
foreach ($artifact in @($sysPath, $catPath)) {
    & $signtool sign /v /fd SHA256 /sm /s My /sha1 $certificate.Thumbprint $artifact | Out-Host
    if ($LASTEXITCODE -ne 0) { throw "Signing failed: $artifact" }
}

if ($PrepareOnly) {
    Write-Host "Signed driver package prepared: $outputRoot"
    exit 0
}

$bootConfiguration = (& bcdedit.exe /enum '{current}' | Out-String)
$testSigningEnabled = $bootConfiguration -match '(?im)^testsigning\s+(Yes|On|1)\s*$'
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class OpenCodexMicroUdeCodeIntegrity
{
    [StructLayout(LayoutKind.Sequential)] private struct SystemCodeIntegrityInformation { public uint Length; public uint Options; }
    [DllImport("ntdll.dll")] private static extern int NtQuerySystemInformation(int informationClass, ref SystemCodeIntegrityInformation information, uint informationLength, IntPtr returnLength);
    public static bool IsTestSigningActive()
    {
        SystemCodeIntegrityInformation information = new SystemCodeIntegrityInformation();
        information.Length = (uint)Marshal.SizeOf(typeof(SystemCodeIntegrityInformation));
        int status = NtQuerySystemInformation(103, ref information, information.Length, IntPtr.Zero);
        if (status != 0) throw new InvalidOperationException("NtQuerySystemInformation failed: 0x" + status.ToString("X8"));
        return (information.Options & 0x2) != 0;
    }
}
'@
$testSigningActive = [OpenCodexMicroUdeCodeIntegrity]::IsTestSigningActive()
if (-not $testSigningActive) {
    if (-not $testSigningEnabled -and $EnableTestSigning) {
        & bcdedit.exe /set testsigning on | Out-Host
        if ($LASTEXITCODE -ne 0) { throw 'Windows refused to enable test signing. Secure Boot may need to be disabled in firmware first.' }
    }
    if ($testSigningEnabled -or $EnableTestSigning) {
        Write-Host 'Test signing is configured but is not active in this kernel. Restart Windows, then run this installer again.'
        exit 0
    }
    throw 'Test signing is not enabled. Run this script with -EnableTestSigning, restart Windows, then run it again.'
}

Get-Process -Name OpenCodexMicroVirtualDevice -ErrorAction SilentlyContinue | Stop-Process -Force
$existingVhf = Get-RootDeviceByHardwareId 'Root\OpenCodexMicroVhf'
if ($existingVhf) {
    & $devcon remove "@$($existingVhf.InstanceId)" | Out-Host
    if ($LASTEXITCODE -ne 0) { throw 'Removing the obsolete VHF root device failed.' }
}

$existingUde = Get-RootDeviceByHardwareId 'Root\OpenCodexMicroUde'
if ($existingUde) {
    & $devcon update $infPath 'Root\OpenCodexMicroUde' | Out-Host
} else {
    & $devcon install $infPath 'Root\OpenCodexMicroUde' | Out-Host
}
if ($LASTEXITCODE -ne 0) { throw "DevCon installation failed with exit code $LASTEXITCODE." }

$rootDevice = Get-RootDeviceByHardwareId 'Root\OpenCodexMicroUde'
if (-not $rootDevice -or $rootDevice.Status -ne 'OK') {
    if ($rootDevice) {
        $problemCode = (Get-PnpDeviceProperty -InstanceId $rootDevice.InstanceId -KeyName 'DEVPKEY_Device_ProblemCode' -ErrorAction SilentlyContinue).Data
        $problemStatus = (Get-PnpDeviceProperty -InstanceId $rootDevice.InstanceId -KeyName 'DEVPKEY_Device_ProblemStatus' -ErrorAction SilentlyContinue).Data
        throw "The UdeCx root device did not start. InstanceId=$($rootDevice.InstanceId); Status=$($rootDevice.Status); ProblemCode=$problemCode; ProblemStatus=0x$('{0:X8}' -f [uint32]$problemStatus)."
    }
    throw 'The UdeCx root device was not enumerated.'
}

$deadline = (Get-Date).AddSeconds(15)
do {
    $usbDevice = Get-PnpDevice -PresentOnly -ErrorAction SilentlyContinue | Where-Object InstanceId -Like 'USB\VID_303A&PID_8360*' | Select-Object -First 1
    $hidDevice = Get-PnpDevice -Class HIDClass -PresentOnly -ErrorAction SilentlyContinue | Where-Object InstanceId -Like 'HID\VID_303A&PID_8360*' | Select-Object -First 1
    if ($usbDevice -and $usbDevice.Status -eq 'OK' -and $hidDevice -and $hidDevice.Status -eq 'OK') { break }
    Start-Sleep -Milliseconds 250
} while ((Get-Date) -lt $deadline)

if (-not $usbDevice -or $usbDevice.Status -ne 'OK') { throw 'UdeCx started, but the VID_303A/PID_8360 USB device was not enumerated.' }
if (-not $hidDevice -or $hidDevice.Status -ne 'OK') { throw 'The virtual USB device started, but its HID interface was not enumerated.' }

Write-Host "UdeCx root started: $($rootDevice.InstanceId)"
Write-Host "Virtual USB device started: $($usbDevice.InstanceId)"
Write-Host "Codex-compatible HID started: $($hidDevice.InstanceId)"
Write-Host "Run: $outputRoot\OpenCodexMicroVirtualDevice.exe"
Write-Host "Verify: $repositoryRoot\windows\virtual-hid\Get-VirtualHidDiagnostics.ps1"
