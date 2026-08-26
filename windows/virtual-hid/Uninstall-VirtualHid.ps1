$ErrorActionPreference = 'Stop'
$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = [Security.Principal.WindowsPrincipal]::new($identity)
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw 'Run this uninstaller from an administrator PowerShell session.'
}

$kitsRoot = (Get-ItemProperty 'HKLM:\SOFTWARE\Microsoft\Windows Kits\Installed Roots').KitsRoot10
$kitVersion = Get-ChildItem -LiteralPath (Join-Path $kitsRoot 'Tools') -Directory |
    Where-Object { $_.Name -match '^\d+\.\d+\.\d+\.\d+$' } |
    Sort-Object { [version]$_.Name } -Descending |
    Select-Object -First 1 -ExpandProperty Name
$devcon = Join-Path $kitsRoot "Tools\$kitVersion\x64\devcon.exe"

& $devcon remove 'Root\OpenCodexMicroVhf' | Out-Host
if ($LASTEXITCODE -ne 0) { throw "DevCon removal failed with exit code $LASTEXITCODE." }

Write-Host 'OpenCodexMicro virtual HID source device removed.'
