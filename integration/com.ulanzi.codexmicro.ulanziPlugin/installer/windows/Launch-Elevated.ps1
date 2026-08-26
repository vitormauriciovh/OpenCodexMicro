param(
    [ValidateSet('install', 'uninstall')]
    [string]$Operation,
    [string]$PayloadRoot,
    [string]$InstallRoot
)

$ErrorActionPreference = 'Stop'
$userId = [Security.Principal.WindowsIdentity]::GetCurrent().Name
$scriptPath = Join-Path $PSScriptRoot ($(if ($Operation -eq 'install') { 'Install-Windows.ps1' } else { 'Uninstall-Windows.ps1' }))
$arguments = @(
    '-NoProfile',
    '-ExecutionPolicy', 'Bypass',
    '-File', "`"$scriptPath`"",
    '-PayloadRoot', "`"$PayloadRoot`"",
    '-InstallRoot', "`"$InstallRoot`"",
    '-UserId', "`"$userId`"",
    '-Interactive'
) -join ' '
$process = Start-Process powershell.exe -Verb RunAs -ArgumentList $arguments -Wait -PassThru
if ($process.ExitCode -ne 0) {
    throw "Windows setup exited with code $($process.ExitCode)."
}
