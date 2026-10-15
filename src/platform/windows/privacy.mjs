import { execFileSync } from "node:child_process";
import { realpathSync } from "node:fs";
import { psArgs } from "./powershell.mjs";

const secured = new Set();
export function protectDirectory(directory) {
  const target = realpathSync(directory);
  if (secured.has(target)) return;
  execFileSync("powershell.exe", psArgs(`
$ErrorActionPreference = 'Stop'
$identity = [System.Security.Principal.WindowsIdentity]::GetCurrent().User
$directory = New-Object System.IO.DirectoryInfo($env:ULANZI_PRIVATE_DIRECTORY)
$acl = $directory.GetAccessControl([System.Security.AccessControl.AccessControlSections]::Access)
$acl.SetAccessRuleProtection($true, $false)
foreach ($existing in @($acl.Access)) { $acl.RemoveAccessRuleSpecific($existing) }
$rule = New-Object System.Security.AccessControl.FileSystemAccessRule($identity, 'FullControl', 'ContainerInherit,ObjectInherit', 'None', 'Allow')
$acl.AddAccessRule($rule)
$directory.SetAccessControl($acl)
`), { env: { ...process.env, ULANZI_PRIVATE_DIRECTORY: target }, windowsHide: true, timeout: 10000, stdio: "pipe" });
  secured.add(target);
}
