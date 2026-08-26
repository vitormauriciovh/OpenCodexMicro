param(
    [ValidateSet('Debug', 'Release')]
    [string]$Configuration = 'Debug'
)

$ErrorActionPreference = 'Stop'
$projectRoot = $PSScriptRoot
$serviceRoot = Join-Path $projectRoot 'service'
$outputRoot = Join-Path $projectRoot "out\$Configuration"
$kitsRoot = (Get-ItemProperty 'HKLM:\SOFTWARE\Microsoft\Windows Kits\Installed Roots').KitsRoot10
$vswhere = 'C:\Program Files (x86)\Microsoft Visual Studio\Installer\vswhere.exe'

if (-not (Test-Path -LiteralPath $vswhere -PathType Leaf)) {
    throw 'Visual Studio Installer vswhere.exe was not found.'
}

$visualStudio = & $vswhere -latest -version '[17.0,18.0)' -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath
if ([string]::IsNullOrWhiteSpace($visualStudio)) {
    throw 'Visual Studio C++ build tools were not found.'
}

$msbuild = Join-Path $visualStudio 'MSBuild\Current\Bin\MSBuild.exe'
$csc = Join-Path $visualStudio 'MSBuild\Current\Bin\Roslyn\csc.exe'
$wdkToolset = Join-Path $visualStudio 'MSBuild\Microsoft\VC\v170\Platforms\x64\PlatformToolsets\WindowsKernelModeDriver10.0'
if (-not (Test-Path -LiteralPath $wdkToolset -PathType Container)) {
    throw 'Visual Studio 2022 is missing the Windows Driver Kit Build Tools component.'
}
$kitVersion = Get-ChildItem -LiteralPath (Join-Path $kitsRoot 'Include') -Directory |
    Where-Object { $_.Name -match '^\d+\.\d+\.\d+\.\d+$' } |
    Sort-Object { [version]$_.Name } -Descending |
    Where-Object {
        Test-Path -LiteralPath (Join-Path $_.FullName 'shared\vhf.h')
    } |
    Select-Object -First 1 -ExpandProperty Name

if (-not $kitVersion) {
    throw 'A Windows Driver Kit containing Vhf.h was not found.'
}

$kitBin = Join-Path $kitsRoot "bin\$kitVersion\x86"

New-Item -ItemType Directory -Path $outputRoot -Force | Out-Null
$servicePath = Join-Path $outputRoot 'OpenCodexMicroVirtualDevice.exe'

& $msbuild `
    (Join-Path $projectRoot 'OpenCodexMicro.VirtualHid.sln') `
    /t:Build `
    "/p:Configuration=$Configuration" `
    /p:Platform=x64 `
    /p:SpectreMitigation=false `
    /p:SkipPackageVerification=true `
    /p:EnableInf2cat=false `
    /m `
    /v:minimal | Out-Host
if ($LASTEXITCODE -ne 0) { throw "Driver build failed with exit code $LASTEXITCODE." }

$packagedInf = Join-Path $outputRoot 'OpenCodexMicroVhf\OpenCodexMicroVhf.inf'
Copy-Item -LiteralPath $packagedInf -Destination (Join-Path $outputRoot 'OpenCodexMicroVhf.inf') -Force
Remove-Item -LiteralPath $packagedInf -Force
Remove-Item -LiteralPath (Split-Path -Parent $packagedInf) -Force

$serviceTarget = if ($Configuration -eq 'Release') { 'winexe' } else { 'exe' }
& $csc /nologo "/target:$serviceTarget" /platform:x64 /optimize+ /out:$servicePath /reference:System.Web.Extensions.dll (Join-Path $serviceRoot 'OpenCodexMicroVirtualDevice.cs')
if ($LASTEXITCODE -ne 0) { throw "Virtual device service compilation failed with exit code $LASTEXITCODE." }

$inf2Cat = Join-Path $kitBin 'Inf2Cat.exe'
if (Test-Path -LiteralPath $inf2Cat -PathType Leaf) {
    & $inf2Cat "/driver:$outputRoot" /os:10_X64 | Out-Host
    if ($LASTEXITCODE -ne 0) { throw "Inf2Cat failed with exit code $LASTEXITCODE." }
}

Write-Host "Virtual HID artifacts: $outputRoot"
