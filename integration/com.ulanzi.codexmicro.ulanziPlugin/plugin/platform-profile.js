import { createBridgeInstaller } from "./bridge-installer.js";
import { createWindowsSetup } from "./windows-setup.js";

const ACTIONS = [
  "task1", "task2", "task3", "task4", "task5",
  "fast", "usage", "pin", "new", "navigate", "fork", "steer", "mic", "submit"
];

function actionCapabilities(platform) {
  return Object.fromEntries(ACTIONS.map(action => [action, {
    available: true,
    experimental: platform === "windows" && ["pin", "new", "steer"].includes(action)
  }]));
}

function macProfile(status) {
  const ready = status.supported && status.installed && status.serviceOnline && status.cdpConnected && !status.needsUpdate;
  const phase = !status.supported ? "unsupported"
    : !status.installed ? "not-installed"
      : status.needsUpdate ? "update-available"
        : !status.serviceOnline ? "runtime-offline"
          : !status.cdpConnected ? "codex-offline"
            : "ready";
  return {
    platform: "macos",
    mode: "macos-cdp",
    supported: status.supported,
    ready,
    phase,
    setup: {
      installed: status.installed,
      needsUpdate: status.needsUpdate,
      installedVersion: status.installedVersion,
      bundledVersion: status.bundledVersion,
      canInstall: status.supported,
      canLaunch: status.installed && !status.cdpConnected,
      canUninstall: status.supported && status.installed,
      requiresRestart: false
    },
    checks: [
      { id: "payload", ready: status.installed, level: status.needsUpdate ? "warn" : null },
      { id: "runtime", ready: status.serviceOnline },
      { id: "codex", ready: status.cdpConnected }
    ],
    actions: actionCapabilities("macos"),
    runtime: {
      nodeSource: status.nodeSource,
      nodeVersion: status.nodeVersion
    },
    detail: status
  };
}

export function createPlatformSetup(options) {
  const platform = options.platform || process.platform;
  if (platform === "win32") return createWindowsSetup(options);
  const installer = createBridgeInstaller(options);
  return {
    async status() {
      return macProfile(await installer.status());
    },
    install: () => installer.install(),
    launch: () => installer.launch(),
    uninstall: () => installer.uninstall()
  };
}
