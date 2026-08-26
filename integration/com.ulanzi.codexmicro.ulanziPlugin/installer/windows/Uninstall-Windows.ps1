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
    [pscustomobject]@{ phase=$Phase; message=$Message; level=$Level; updatedAt=[DateTime]::UtcNow.ToString('o') } |
        ConvertTo-Json | Set-Content -LiteralPath $statusPath -Encoding UTF8
    Write-Host "[$Phase] $Message"
}
function Complete([int]$Code) {
    if ($Interactive) { Write-Host; Read-Host 'Press Enter to close this window' }
    exit $Code
}

try {
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = [Security.Principal.WindowsPrincipal]::new($identity)
    if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) { throw 'Administrator permission is required.' }
    Write-SetupStatus 'uninstalling' 'Removing the background task and virtual USB driver.'
    Stop-ScheduledTask -TaskName 'OpenCodexMicro Virtual Device' -ErrorAction SilentlyContinue
    Unregister-ScheduledTask -TaskName 'OpenCodexMicro Virtual Device' -Confirm:$false -ErrorAction SilentlyContinue
    Get-Process -Name OpenCodexMicroVirtualDevice -ErrorAction SilentlyContinue | Stop-Process -Force
    $driver = Get-CimInstance Win32_PnPSignedDriver -ErrorAction SilentlyContinue |
        Where-Object DeviceID -Like 'ROOT\OPENCODEXMICROUDE*' | Select-Object -First 1
    $installer = Join-Path $PayloadRoot 'OpenCodexMicroDriverInstaller.exe'
    if (Test-Path -LiteralPath $installer) {
        & $installer uninstall
        if ($LASTEXITCODE -ne 0) { throw "Driver removal failed with exit code $LASTEXITCODE." }
    }
    if ($driver.InfName) { & pnputil.exe /delete-driver $driver.InfName /uninstall /force | Out-Host }
    $manifest = Get-Content -LiteralPath (Join-Path $PayloadRoot 'payload.json') -Raw | ConvertFrom-Json
    foreach ($store in @('Cert:\LocalMachine\Root', 'Cert:\LocalMachine\TrustedPublisher')) {
        Get-ChildItem $store | Where-Object Thumbprint -EQ $manifest.certificateThumbprint | Remove-Item -Force
    }
    Remove-Item -LiteralPath (Join-Path $InstallRoot 'runtime') -Recurse -Force -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath (Join-Path $InstallRoot 'install.json') -Force -ErrorAction SilentlyContinue
    Write-SetupStatus 'not-installed' 'OpenCodexMicro Windows setup was removed. Test Signing was left unchanged.' 'success'
    Complete 0
} catch {
    Write-SetupStatus 'error' $_.Exception.Message 'error'
    Write-Error $_
    Complete 1
}
