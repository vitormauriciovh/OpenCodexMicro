import { powershell } from "./powershell.mjs";

// Activate a registered Store application through Windows so it retains its
// package identity. Never edit/re-register the package or fall back to its exe.
export async function launchPackagedCodex(executable, args, { env = process.env, run = powershell } = {}) {
  const { stdout } = await run(`
$matches = @(Get-AppxPackage -Name OpenAI.Codex | ForEach-Object {
  $package = $_
  $manifest = Get-AppxPackageManifest $package
  foreach ($application in $manifest.Package.Applications.Application) {
    if ((Join-Path $package.InstallLocation $application.Executable) -eq $env:ULANZI_PACKAGED_EXE) {
      $package.PackageFamilyName + '!' + $application.Id
    }
  }
})
if ($matches.Count -ne 1) { throw 'Cannot identify exactly one registered Codex application for this executable' }
$matches[0]
`, { env: { ...env, ULANZI_PACKAGED_EXE: executable } });
  const appId = stdout.trim();
  if (!/^OpenAI\.Codex_[a-z0-9]+![A-Za-z0-9.]+$/.test(appId)) throw new Error("Invalid registered Codex application identity");
  await run(`
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
namespace OpenCodexMicro {
  [ComImport, Guid("2e941141-7f97-4756-ba1d-9decde894a3d"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IActivation {
    [PreserveSig] int ActivateApplication([MarshalAs(UnmanagedType.LPWStr)] string app, [MarshalAs(UnmanagedType.LPWStr)] string arguments, uint options, out uint processId);
    [PreserveSig] int ActivateForFile([MarshalAs(UnmanagedType.LPWStr)] string app, IntPtr items, [MarshalAs(UnmanagedType.LPWStr)] string verb, out uint processId);
    [PreserveSig] int ActivateForProtocol([MarshalAs(UnmanagedType.LPWStr)] string app, IntPtr items, out uint processId);
  }
  [ComImport, Guid("45BA127D-10A8-46EA-8AB7-56EA9078943C")]
  class ActivationManager { }
  public static class StoreLaunch {
    public static uint Launch(string app, string arguments) {
      var manager = (IActivation)new ActivationManager();
      try {
        uint processId;
        int result = manager.ActivateApplication(app, arguments, 0, out processId);
        Marshal.ThrowExceptionForHR(result);
        if (processId == 0) throw new InvalidOperationException("Windows did not return an application process");
        return processId;
      } finally { Marshal.ReleaseComObject(manager); }
    }
  }
}
'@
[OpenCodexMicro.StoreLaunch]::Launch($env:ULANZI_CODEX_AUMID, $env:ULANZI_CODEX_ARGUMENTS) | Out-Null
`, { env: { ...env, ULANZI_CODEX_AUMID: appId, ULANZI_CODEX_ARGUMENTS: args.join(" ") } });
}
