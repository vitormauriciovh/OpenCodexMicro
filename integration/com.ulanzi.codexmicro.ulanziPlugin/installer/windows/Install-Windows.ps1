param(
    [Parameter(Mandatory = $true)][string]$PayloadRoot,
    [Parameter(Mandatory = $true)][string]$InstallRoot,
    [Parameter(Mandatory = $true)][string]$UserId,
    [switch]$Interactive
)

$ErrorActionPreference = 'Stop'
$statusPath = Join-Path $InstallRoot 'setup-status.json'

function Write-SetupStatus([string]$Phase, [string]$Message, [string]$Level = 'info') {
    New-Item -ItemType Directory -Path $InstallRoot -Force | Out-Null
    $temporary = "$statusPath.tmp"
    [pscustomobject]@{
        phase = $Phase
        message = $Message
        level = $Level
        updatedAt = [DateTime]::UtcNow.ToString('o')
    } | ConvertTo-Json | Set-Content -LiteralPath $temporary -Encoding UTF8
    Move-Item -LiteralPath $temporary -Destination $statusPath -Force
    Write-Host "[$Phase] $Message"
}

function Complete([int]$Code) {
    if ($Interactive) {
        Write-Host
        Read-Host 'Press Enter to close this window'
    }
    exit $Code
}

try {
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = [Security.Principal.WindowsPrincipal]::new($identity)
    if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
        throw 'Administrator permission is required.'
    }
    Write-SetupStatus 'verifying' 'Verifying bundled driver payload.'
    $manifestPath = Join-Path $PayloadRoot 'payload.json'
    $manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
    if (-not [Environment]::Is64BitOperatingSystem -or $env:PROCESSOR_ARCHITECTURE -ne 'AMD64' -or $manifest.architecture -ne 'x64') {
        throw 'This payload supports Windows x64 only.'
    }
    if ([Environment]::OSVersion.Version.Build -lt [int]$manifest.minimumWindowsBuild) {
        throw "Windows build $($manifest.minimumWindowsBuild) or later is required."
    }
    $installedMetadataPath = Join-Path $InstallRoot 'install.json'
    if (Test-Path -LiteralPath $installedMetadataPath) {
        $installedMetadata = Get-Content -LiteralPath $installedMetadataPath -Raw | ConvertFrom-Json
        if ([version]$installedMetadata.version -gt [version]$manifest.version) {
            throw "A newer OpenCodexMicro setup ($($installedMetadata.version)) is installed; automatic downgrade is blocked."
        }
    }
    foreach ($file in $manifest.files.PSObject.Properties) {
        $path = Join-Path $PayloadRoot $file.Name
        if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { throw "Missing payload file: $($file.Name)" }
        $actual = (Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash.ToLowerInvariant()
        if ($actual -ne [string]$file.Value) { throw "Payload hash mismatch: $($file.Name)" }
    }

    $certificatePath = Join-Path $PayloadRoot 'OpenCodexMicroVirtualUsb.cer'
    $certificate = New-Object Security.Cryptography.X509Certificates.X509Certificate2($certificatePath)
    if ($certificate.Thumbprint -ne $manifest.certificateThumbprint) {
        throw 'Payload certificate fingerprint does not match the manifest.'
    }
    Write-SetupStatus 'trusting' 'Trusting the OpenCodexMicro development certificate.'
    Import-Certificate -FilePath $certificatePath -CertStoreLocation Cert:\LocalMachine\Root | Out-Null
    Import-Certificate -FilePath $certificatePath -CertStoreLocation Cert:\LocalMachine\TrustedPublisher | Out-Null

    $secureBoot = $false
    try { $secureBoot = [bool](Confirm-SecureBootUEFI) } catch {}
    Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class OpenCodexMicroSetupCodeIntegrity {
  [StructLayout(LayoutKind.Sequential)] private struct Info { public uint Length; public uint Options; }
  [DllImport("ntdll.dll")] private static extern int NtQuerySystemInformation(int c, ref Info i, uint l, IntPtr r);
  public static bool Active() { Info i = new Info(); i.Length = (uint)Marshal.SizeOf(typeof(Info)); return NtQuerySystemInformation(103, ref i, i.Length, IntPtr.Zero) == 0 && (i.Options & 2) != 0; }
}
'@
    $active = [OpenCodexMicroSetupCodeIntegrity]::Active()
    if (-not $active) {
        if ($secureBoot) {
            Write-SetupStatus 'secure-boot-blocked' 'Secure Boot must be disabled before Windows can enable Test Signing.' 'warning'
            Complete 0
        }
        Write-SetupStatus 'configuring-test-signing' 'Enabling Windows Test Signing.'
        & bcdedit.exe /set testsigning on
        if ($LASTEXITCODE -ne 0) { throw 'Windows refused to enable Test Signing.' }
        Write-SetupStatus 'needs-restart' 'Restart Windows, then choose Install / Continue again.' 'warning'
        Complete 0
    }

    Write-SetupStatus 'installing' 'Installing the OpenCodexMicro virtual USB driver.'
    $driverInstaller = Join-Path $PayloadRoot 'OpenCodexMicroDriverInstaller.exe'
    $infPath = Join-Path $PayloadRoot 'OpenCodexMicroUde.inf'
    & $driverInstaller install $infPath
    if ($LASTEXITCODE -notin @(0, 3010)) { throw "Driver installation failed with exit code $LASTEXITCODE." }

    Write-SetupStatus 'registering-runtime' 'Registering the current-user background task.'
    Stop-ScheduledTask -TaskName 'OpenCodexMicro Virtual Device' -ErrorAction SilentlyContinue
    Get-Process -Name OpenCodexMicroVirtualDevice -ErrorAction SilentlyContinue | Stop-Process -Force
    Start-Sleep -Milliseconds 300
    $runtimeRoot = Join-Path $InstallRoot 'runtime'
    New-Item -ItemType Directory -Path $runtimeRoot -Force | Out-Null
    Copy-Item -LiteralPath (Join-Path $PayloadRoot 'OpenCodexMicroVirtualDevice.exe') -Destination $runtimeRoot -Force
    Copy-Item -LiteralPath $driverInstaller -Destination $runtimeRoot -Force
    $runtimePath = Join-Path $runtimeRoot 'OpenCodexMicroVirtualDevice.exe'
    $action = New-ScheduledTaskAction -Execute $runtimePath
    $trigger = New-ScheduledTaskTrigger -AtLogOn -User $UserId
    $settings = New-ScheduledTaskSettingsSet -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit ([TimeSpan]::Zero)
    $taskPrincipal = New-ScheduledTaskPrincipal -UserId $UserId -LogonType Interactive -RunLevel Limited
    Register-ScheduledTask -TaskName 'OpenCodexMicro Virtual Device' -Action $action -Trigger $trigger -Settings $settings -Principal $taskPrincipal -Force | Out-Null
    Start-ScheduledTask -TaskName 'OpenCodexMicro Virtual Device'

    [pscustomobject]@{
        version = $manifest.version
        certificateThumbprint = $manifest.certificateThumbprint
        userId = $UserId
        installedAt = [DateTime]::UtcNow.ToString('o')
    } | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $InstallRoot 'install.json') -Encoding UTF8
    Write-SetupStatus 'ready' 'Windows virtual HID setup completed.' 'success'
    Complete 0
} catch {
    Write-SetupStatus 'error' $_.Exception.Message 'error'
    Write-Error $_
    Complete 1
}
