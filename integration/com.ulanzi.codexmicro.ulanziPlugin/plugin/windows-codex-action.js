import { spawn } from "node:child_process";

const ACTION_SCRIPT = `
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
$processName = if ($env:CODEX_WINDOWS_PROCESS_NAME) {
  $env:CODEX_WINDOWS_PROCESS_NAME
} else {
  'ChatGPT'
}
$process = Get-Process -Name $processName -ErrorAction SilentlyContinue |
  Where-Object { $_.MainWindowHandle -ne 0 } |
  Select-Object -First 1
if (-not $process) { exit 2 }
$root = [System.Windows.Automation.AutomationElement]::FromHandle($process.MainWindowHandle)
$buttonCondition = [System.Windows.Automation.PropertyCondition]::new(
  [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
  [System.Windows.Automation.ControlType]::Button
)
$target = $null
if ($env:OPEN_CODEX_MICRO_ACTION -eq 'pin') {
  $buttons = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, $buttonCondition)
  $active = $null
  for ($index = 0; $index -lt $buttons.Count; $index++) {
    $candidate = $buttons.Item($index)
    if ($candidate.Current.ClassName -match '(^|\\s)bg-primary-ghost-hover(\\s|$)') {
      $active = $candidate
      break
    }
  }
  if ($active) {
    $labels = @('Pin chat', 'Unpin chat', '置顶聊天', '取消置顶聊天', '釘選聊天', '取消釘選聊天')
    $children = $active.FindAll([System.Windows.Automation.TreeScope]::Descendants, $buttonCondition)
    for ($index = 0; $index -lt $children.Count; $index++) {
      $candidate = $children.Item($index)
      if (-not $candidate.Current.IsOffscreen -and $labels -contains $candidate.Current.Name) {
        $target = $candidate
        break
      }
    }
  }
} elseif ($env:OPEN_CODEX_MICRO_ACTION -eq 'new') {
  $labels = @('New task', 'New chat', 'New conversation', '新对话', '新對話', '新建任务', '新建聊天', '新增任務', '新增聊天')
  $buttons = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, $buttonCondition)
  for ($index = 0; $index -lt $buttons.Count; $index++) {
    $candidate = $buttons.Item($index)
    if (
      -not $candidate.Current.IsOffscreen -and
      $labels -contains $candidate.Current.Name -and
      $candidate.Current.ClassName -match '(^|\\s)sidebar-item(\\s|$)'
    ) {
      $target = $candidate
      break
    }
  }
} elseif ($env:OPEN_CODEX_MICRO_ACTION -eq 'steer') {
  $labels = @('Steer', '调整方向', '調整方向', '引導')
  $buttons = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, $buttonCondition)
  for ($index = 0; $index -lt $buttons.Count; $index++) {
    $candidate = $buttons.Item($index)
    if (
      -not $candidate.Current.IsOffscreen -and
      $candidate.Current.IsEnabled -and
      $labels -contains $candidate.Current.Name
    ) {
      $target = $candidate
      break
    }
  }
} else {
  exit 3
}
if (-not $target) { exit 4 }
if ($env:CODEX_WINDOWS_ACTION_DRY_RUN -eq '1') { exit 0 }
$invoke = $null
if (-not $target.TryGetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern, [ref]$invoke)) {
  exit 5
}
$invoke.Invoke()
`;

export function invokeWindowsCodexAction(action, { env = process.env } = {}) {
  return new Promise((resolve, reject) => {
    const encoded = Buffer.from(ACTION_SCRIPT, "utf16le").toString("base64");
    const child = spawn("powershell.exe", [
      "-NoProfile",
      "-NonInteractive",
      "-WindowStyle",
      "Hidden",
      "-EncodedCommand",
      encoded
    ], {
      env: { ...env, OPEN_CODEX_MICRO_ACTION: action },
      windowsHide: true,
      stdio: "ignore"
    });
    child.on("error", reject);
    child.on("exit", code => {
      if (code === 0) resolve({ ok: true });
      else {
        const error = new Error(`Codex ${action} action is unavailable (PowerShell exit ${code})`);
        error.exitCode = code;
        reject(error);
      }
    });
  });
}
