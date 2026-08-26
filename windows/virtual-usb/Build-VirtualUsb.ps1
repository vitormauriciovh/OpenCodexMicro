param(
    [ValidateSet('Debug', 'Release')]
    [string]$Configuration = 'Debug'
)

$ErrorActionPreference = 'Stop'
$projectRoot = $PSScriptRoot
$outputRoot = Join-Path $projectRoot "out\$Configuration"
$kitsRoot = (Get-ItemProperty 'HKLM:\SOFTWARE\Microsoft\Windows Kits\Installed Roots').KitsRoot10
$vswhere = 'C:\Program Files (x86)\Microsoft Visual Studio\Installer\vswhere.exe'
$visualStudio = & $vswhere -latest -version '[17.0,18.0)' -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath
if ([string]::IsNullOrWhiteSpace($visualStudio)) { throw 'Visual Studio C++ build tools were not found.' }

$msbuild = Join-Path $visualStudio 'MSBuild\Current\Bin\MSBuild.exe'
$csc = Join-Path $visualStudio 'MSBuild\Current\Bin\Roslyn\csc.exe'
$kitVersion = Get-ChildItem -LiteralPath (Join-Path $kitsRoot 'Include') -Directory |
    Where-Object { $_.Name -match '^\d+\.\d+\.\d+\.\d+$' } |
    Sort-Object { [version]$_.Name } -Descending |
    Where-Object { Test-Path -LiteralPath (Join-Path $_.FullName 'km\ude\1.1\UdeCx.h') } |
    Select-Object -First 1 -ExpandProperty Name
if (-not $kitVersion) { throw 'A Windows Driver Kit containing UdeCx 1.1 was not found.' }

New-Item -ItemType Directory -Path $outputRoot -Force | Out-Null
& $msbuild (Join-Path $projectRoot 'OpenCodexMicro.VirtualUsb.sln') /t:Build "/p:Configuration=$Configuration" /p:Platform=x64 "/p:WindowsTargetPlatformVersion=$kitVersion" /p:SpectreMitigation=false /p:SkipPackageVerification=true /p:EnableInf2cat=false /m /v:minimal | Out-Host
if ($LASTEXITCODE -ne 0) { throw "Driver build failed with exit code $LASTEXITCODE." }

$packagedInf = Join-Path $outputRoot 'OpenCodexMicroUde\OpenCodexMicroUde.inf'
Copy-Item -LiteralPath $packagedInf -Destination (Join-Path $outputRoot 'OpenCodexMicroUde.inf') -Force
Remove-Item -LiteralPath $packagedInf -Force
Remove-Item -LiteralPath (Split-Path -Parent $packagedInf) -Force

$servicePath = Join-Path $outputRoot 'OpenCodexMicroVirtualDevice.exe'
$serviceSource = Join-Path $projectRoot '..\virtual-hid\service\OpenCodexMicroVirtualDevice.cs'
$serviceTarget = if ($Configuration -eq 'Release') { 'winexe' } else { 'exe' }
& $csc /nologo "/target:$serviceTarget" /platform:x64 /optimize+ /out:$servicePath /reference:System.Web.Extensions.dll $serviceSource
if ($LASTEXITCODE -ne 0) { throw "Virtual device service compilation failed with exit code $LASTEXITCODE." }

$installerPath = Join-Path $outputRoot 'OpenCodexMicroDriverInstaller.exe'
$installerSource = Join-Path $projectRoot 'installer\OpenCodexMicroDriverInstaller.cs'
& $csc /nologo /target:exe /platform:x64 /optimize+ /out:$installerPath $installerSource
if ($LASTEXITCODE -ne 0) { throw "Driver installer compilation failed with exit code $LASTEXITCODE." }

$inf2Cat = Join-Path $kitsRoot "bin\$kitVersion\x86\Inf2Cat.exe"
if (Test-Path -LiteralPath $inf2Cat -PathType Leaf) {
    & $inf2Cat "/driver:$outputRoot" /os:10_X64 | Out-Host
    if ($LASTEXITCODE -ne 0) { throw "Inf2Cat failed with exit code $LASTEXITCODE." }
}
Write-Host "Virtual USB artifacts: $outputRoot"
