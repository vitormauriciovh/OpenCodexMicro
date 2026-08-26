param(
    [switch]$DryRun,
    [switch]$VerboseTrace,
    [switch]$AllowElevated,
    [switch]$ProbeLaunchContext,
    [string]$TraceLog
)

$ErrorActionPreference = 'Stop'
$hookPath = Join-Path $PSScriptRoot 'trace-codex-micro.cjs'
$restrictedLauncherPath = Join-Path $PSScriptRoot 'Start-RestrictedProcess.cs'

if (-not (Test-Path -LiteralPath $hookPath -PathType Leaf)) {
    throw "Trace preload hook not found: $hookPath"
}
if (-not (Test-Path -LiteralPath $restrictedLauncherPath -PathType Leaf)) {
    throw "Restricted process launcher not found: $restrictedLauncherPath"
}

$package = $null
try {
    $package = Get-AppxPackage -Name OpenAI.Codex -ErrorAction Stop |
        Sort-Object Version -Descending |
        Select-Object -First 1
} catch {}

if ($package) {
    $packageRoot = $package.InstallLocation
    $packageVersion = $package.Version.ToString()
} else {
    $packageRoot = Get-ChildItem -LiteralPath "$env:ProgramFiles\WindowsApps" -Directory -ErrorAction Stop |
        Where-Object Name -Like 'OpenAI.Codex_*__2p2nqsd0c76g0' |
        Sort-Object Name -Descending |
        Select-Object -First 1 -ExpandProperty FullName
    if (-not $packageRoot) {
        throw 'The OpenAI.Codex Microsoft Store package was not found.'
    }
    $packageVersion = if ((Split-Path $packageRoot -Leaf) -match '^OpenAI\.Codex_([^_]+)_') {
        $Matches[1]
    } else {
        'unknown'
    }
}

$executable = Join-Path $packageRoot 'app\ChatGPT.exe'
if (-not (Test-Path -LiteralPath $executable -PathType Leaf)) {
    throw "Codex executable was not found: $executable"
}

if ([string]::IsNullOrWhiteSpace($TraceLog)) {
    $timestamp = Get-Date -Format 'yyyyMMdd-HHmmss'
    $localAppData = $env:LOCALAPPDATA
    if ([string]::IsNullOrWhiteSpace($localAppData)) {
        $localAppData = "$env:USERPROFILE\AppData\Local"
    }
    $TraceLog = Join-Path (
        Join-Path $localAppData 'OpenCodexMicro\diagnostics'
    ) "codex-micro-trace-$timestamp.ndjson"
}

$traceDirectory = Split-Path -Parent $TraceLog
New-Item -ItemType Directory -Path $traceDirectory -Force | Out-Null
$running = @(Get-Process -Name ChatGPT -ErrorAction SilentlyContinue)
$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = [Security.Principal.WindowsPrincipal]::new($identity)
$isElevated = $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)

$summary = [pscustomobject]@{
    Status = if ($running.Count -gt 0) { 'CodexRunning' } elseif ($isElevated) { 'ElevatedShell' } else { 'Ready' }
    PackageVersion = $packageVersion
    Executable = $executable
    Hook = $hookPath
    TraceLog = $TraceLog
    CodexProcessCount = $running.Count
    Elevated = $isElevated
}

$summary | Format-List
if ($DryRun) {
    exit 0
}

if ($running.Count -gt 0 -and -not $ProbeLaunchContext) {
    throw 'Codex is already running. Fully quit it from the tray, then run this launcher again.'
}

$oldNodeOptions = $env:NODE_OPTIONS
$oldTraceLog = $env:CODEX_MICRO_TRACE_LOG
$oldVerbose = $env:CODEX_MICRO_TRACE_VERBOSE
$oldCodexVersion = $env:CODEX_MICRO_CODEX_VERSION
$preloadOption = "--require=`"$hookPath`""
$nodeOptions = if ([string]::IsNullOrWhiteSpace($oldNodeOptions)) {
    $preloadOption
} else {
    "$preloadOption $oldNodeOptions"
}

if ($isElevated -and -not $AllowElevated) {
    $probeResultPath = $null
    try {
        Add-Type -Path $restrictedLauncherPath
        if ($ProbeLaunchContext) {
            $probeExecutable = Join-Path $PSHOME 'powershell.exe'
            $probeResultPath = Join-Path $traceDirectory "restricted-token-probe-$PID.txt"
            $probeCommand = "& `"$env:SystemRoot\System32\whoami.exe`" /groups | Set-Content -LiteralPath `"$probeResultPath`" -Encoding UTF8"
            $encodedProbe = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($probeCommand))
            [RestrictedProcessLauncher]::Start(
                $probeExecutable,
                "-NoProfile -NonInteractive -EncodedCommand $encodedProbe",
                $PSScriptRoot
            ) | Out-Null
            $probeDeadline = (Get-Date).AddSeconds(10)
            while (-not (Test-Path -LiteralPath $probeResultPath) -and (Get-Date) -lt $probeDeadline) {
                Start-Sleep -Milliseconds 100
            }
            if (-not (Test-Path -LiteralPath $probeResultPath)) {
                throw 'Restricted token launched, but its child-process probe did not complete.'
            }
            $probeOutput = Get-Content -LiteralPath $probeResultPath -Raw
            if ($probeOutput -notmatch 'S-1-16-8192') {
                throw 'Restricted token child process did not report Medium integrity.'
            }
            Write-Host 'Limited launch context and child-process creation verified (integrity RID 8192).'
        } else {
            $env:NODE_OPTIONS = $nodeOptions
            $env:CODEX_MICRO_TRACE_LOG = $TraceLog
            $env:CODEX_MICRO_TRACE_VERBOSE = if ($VerboseTrace) { '1' } else { '0' }
            $env:CODEX_MICRO_CODEX_VERSION = $packageVersion
            [RestrictedProcessLauncher]::Start(
                $executable,
                '',
                $env:USERPROFILE
            ) | Out-Null
            Write-Host "Codex launched with Micro tracing through a restricted token. Log: $TraceLog"
        }
    } finally {
        if ($null -eq $oldNodeOptions) { Remove-Item Env:NODE_OPTIONS -ErrorAction SilentlyContinue } else { $env:NODE_OPTIONS = $oldNodeOptions }
        if ($null -eq $oldTraceLog) { Remove-Item Env:CODEX_MICRO_TRACE_LOG -ErrorAction SilentlyContinue } else { $env:CODEX_MICRO_TRACE_LOG = $oldTraceLog }
        if ($null -eq $oldVerbose) { Remove-Item Env:CODEX_MICRO_TRACE_VERBOSE -ErrorAction SilentlyContinue } else { $env:CODEX_MICRO_TRACE_VERBOSE = $oldVerbose }
        if ($null -eq $oldCodexVersion) { Remove-Item Env:CODEX_MICRO_CODEX_VERSION -ErrorAction SilentlyContinue } else { $env:CODEX_MICRO_CODEX_VERSION = $oldCodexVersion }
        if ($probeResultPath) { Remove-Item -LiteralPath $probeResultPath -Force -ErrorAction SilentlyContinue }
    }
    exit 0
}

if ($ProbeLaunchContext) {
    Write-Host 'Current launch context is already non-elevated.'
    exit 0
}
if ($isElevated) {
    Write-Warning 'Launching Codex elevated may prevent project access. This run is suitable only for startup tracing.'
}

try {
    $env:NODE_OPTIONS = $nodeOptions
    $env:CODEX_MICRO_TRACE_LOG = $TraceLog
    $env:CODEX_MICRO_TRACE_VERBOSE = if ($VerboseTrace) { '1' } else { '0' }
    $env:CODEX_MICRO_CODEX_VERSION = $packageVersion
    Start-Process -FilePath $executable -WorkingDirectory (Split-Path -Parent $executable) | Out-Null
} finally {
    if ($null -eq $oldNodeOptions) { Remove-Item Env:NODE_OPTIONS -ErrorAction SilentlyContinue } else { $env:NODE_OPTIONS = $oldNodeOptions }
    if ($null -eq $oldTraceLog) { Remove-Item Env:CODEX_MICRO_TRACE_LOG -ErrorAction SilentlyContinue } else { $env:CODEX_MICRO_TRACE_LOG = $oldTraceLog }
    if ($null -eq $oldVerbose) { Remove-Item Env:CODEX_MICRO_TRACE_VERBOSE -ErrorAction SilentlyContinue } else { $env:CODEX_MICRO_TRACE_VERBOSE = $oldVerbose }
    if ($null -eq $oldCodexVersion) { Remove-Item Env:CODEX_MICRO_CODEX_VERSION -ErrorAction SilentlyContinue } else { $env:CODEX_MICRO_CODEX_VERSION = $oldCodexVersion }
}

Write-Host "Codex launched with Micro tracing. Log: $TraceLog"
