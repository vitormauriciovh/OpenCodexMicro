param(
    [string]$Version = '0.4.0'
)

$ErrorActionPreference = 'Stop'
$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = [Security.Principal.WindowsPrincipal]::new($identity)
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw 'Run this payload preparation script from an administrator PowerShell session.'
}

$projectRoot = $PSScriptRoot
$repositoryRoot = Split-Path -Parent (Split-Path -Parent $projectRoot)
$outputRoot = Join-Path $projectRoot 'out\Release'
$payloadRoot = Join-Path $repositoryRoot 'integration\com.ulanzi.codexmicro.ulanziPlugin\installer\windows\payload'
$certificateSubject = 'CN=OpenCodexMicro Virtual USB Development'
$kitsRoot = (Get-ItemProperty 'HKLM:\SOFTWARE\Microsoft\Windows Kits\Installed Roots').KitsRoot10
$kitVersion = Get-ChildItem -LiteralPath (Join-Path $kitsRoot 'bin') -Directory |
    Where-Object Name -Match '^\d+\.\d+\.\d+\.\d+$' |
    Sort-Object { [version]$_.Name } -Descending |
    Select-Object -First 1 -ExpandProperty Name
$signtool = Join-Path $kitsRoot "bin\$kitVersion\x64\signtool.exe"

& (Join-Path $projectRoot 'Build-VirtualUsb.ps1') -Configuration Release
if ($LASTEXITCODE -ne 0) { throw 'Release driver build failed.' }

$certificate = Get-ChildItem Cert:\LocalMachine\My |
    Where-Object Subject -EQ $certificateSubject |
    Where-Object NotAfter -GT (Get-Date).AddDays(30) |
    Sort-Object NotAfter -Descending |
    Select-Object -First 1
if (-not $certificate) {
    $certificate = New-SelfSignedCertificate -Type CodeSigningCert -Subject $certificateSubject -CertStoreLocation Cert:\LocalMachine\My -HashAlgorithm SHA256 -NotAfter (Get-Date).AddYears(3)
}

foreach ($artifact in @(
    'OpenCodexMicroUde.sys',
    'OpenCodexMicroUde.cat',
    'OpenCodexMicroVirtualDevice.exe',
    'OpenCodexMicroDriverInstaller.exe'
)) {
    & $signtool sign /v /fd SHA256 /sm /s My /sha1 $certificate.Thumbprint (Join-Path $outputRoot $artifact) | Out-Host
    if ($LASTEXITCODE -ne 0) { throw "Signing failed: $artifact" }
}

New-Item -ItemType Directory -Path $payloadRoot -Force | Out-Null
foreach ($artifact in @(
    'OpenCodexMicroUde.inf',
    'OpenCodexMicroUde.sys',
    'OpenCodexMicroUde.cat',
    'OpenCodexMicroVirtualDevice.exe',
    'OpenCodexMicroDriverInstaller.exe'
)) {
    Copy-Item -LiteralPath (Join-Path $outputRoot $artifact) -Destination $payloadRoot -Force
}
$certificatePath = Join-Path $payloadRoot 'OpenCodexMicroVirtualUsb.cer'
Export-Certificate -Cert $certificate -FilePath $certificatePath -Force | Out-Null

$files = [ordered]@{}
Get-ChildItem -LiteralPath $payloadRoot -File |
    Where-Object Name -NE 'payload.json' |
    Sort-Object Name |
    ForEach-Object { $files[$_.Name] = (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash.ToLowerInvariant() }
[ordered]@{
    version = $Version
    architecture = 'x64'
    minimumWindowsBuild = 19045
    certificateThumbprint = $certificate.Thumbprint
    files = $files
} | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath (Join-Path $payloadRoot 'payload.json') -Encoding UTF8

Write-Host "Plugin Windows payload prepared: $payloadRoot"
