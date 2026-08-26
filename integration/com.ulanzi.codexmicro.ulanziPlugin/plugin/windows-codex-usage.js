import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

const DEFAULT_REFRESH_MS = 60_000;
const DEFAULT_TIMEOUT_MS = 8_000;

function windowKind(minutes) {
  if (Number.isFinite(minutes) && Math.abs(minutes - 300) <= 1) return "five-hour";
  if (Number.isFinite(minutes) && Math.abs(minutes - 10080) <= 1) return "weekly";
  return "other";
}

function normalizeWindow(window, role) {
  if (!window || typeof window !== "object") return null;
  const usedPercent = Number(window.usedPercent);
  if (!Number.isFinite(usedPercent)) return null;
  const minutes = Number(window.windowDurationMins);
  const kind = windowKind(minutes);
  const used = Math.min(100, Math.max(0, usedPercent));
  return {
    id: kind === "other" ? role : kind,
    kind,
    usedPercent: used,
    remainingPercent: 100 - used,
    resetsAt: Number(window.resetsAt) || null
  };
}

export function normalizeCodexRateLimits(result, observedAt = Date.now()) {
  const snapshot = result?.rateLimitsByLimitId?.codex ?? result?.rateLimits;
  if (!snapshot || typeof snapshot !== "object") return null;
  const windows = [
    normalizeWindow(snapshot.primary, "primary"),
    normalizeWindow(snapshot.secondary, "secondary")
  ].filter(Boolean);
  return windows.length > 0 ? { windows, observedAt } : null;
}

function codexExecutable(env) {
  if (env.CODEX_CLI_PATH) return env.CODEX_CLI_PATH;
  const architecture = process.arch === "arm64" ? "aarch64" : "x86_64";
  const packageArchitecture = process.arch === "arm64" ? "arm64" : "x64";
  const bundled = env.APPDATA && join(
    env.APPDATA,
    "npm",
    "node_modules",
    "@openai",
    "codex",
    "node_modules",
    "@openai",
    `codex-win32-${packageArchitecture}`,
    "vendor",
    `${architecture}-pc-windows-msvc`,
    "bin",
    "codex.exe"
  );
  return bundled && existsSync(bundled) ? bundled : "codex.exe";
}

function readRateLimits({ env, timeoutMs }) {
  return new Promise((resolve, reject) => {
    const child = spawn(codexExecutable(env), ["app-server", "--stdio"], {
      env,
      windowsHide: true,
      stdio: ["pipe", "pipe", "ignore"]
    });
    let buffer = "";
    let settled = false;

    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      child.stdin.end();
      child.kill();
      if (error) reject(error);
      else resolve(value);
    };
    const timeout = setTimeout(
      () => finish(new Error("Codex usage request timed out")),
      timeoutMs
    );
    timeout.unref();

    child.on("error", error => finish(error));
    child.on("exit", code => {
      if (!settled) finish(new Error(`Codex app-server exited with code ${code}`));
    });
    child.stdout.on("data", chunk => {
      buffer += chunk.toString();
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() || "";
      for (const line of lines) {
        if (!line.trim()) continue;
        let message;
        try {
          message = JSON.parse(line);
        } catch {
          continue;
        }
        if (message.id === 1 && message.result) {
          child.stdin.write(`${JSON.stringify({
            id: 2,
            method: "account/rateLimits/read",
            params: null
          })}\n`);
        }
        if (message.id === 2) {
          if (message.error) {
            finish(new Error(message.error.message || "Codex usage request failed"));
          } else {
            finish(null, normalizeCodexRateLimits(message.result));
          }
        }
      }
    });

    child.stdin.write(`${JSON.stringify({
      id: 1,
      method: "initialize",
      params: {
        clientInfo: {
          name: "open-codex-micro",
          title: "OpenCodexMicro",
          version: "0.4.0"
        }
      }
    })}\n`);
  });
}

export function createWindowsCodexUsageProvider({
  env = process.env,
  refreshMs = DEFAULT_REFRESH_MS,
  timeoutMs = DEFAULT_TIMEOUT_MS
} = {}) {
  let cached = null;
  let lastAttempt = 0;
  let pending = null;

  async function getUsage({ force = false } = {}) {
    const now = Date.now();
    if (!force && now - lastAttempt < refreshMs) return cached;
    if (pending) return pending;
    lastAttempt = now;
    pending = readRateLimits({ env, timeoutMs })
      .then(usage => {
        if (usage) cached = usage;
        return cached;
      })
      .catch(() => cached)
      .finally(() => {
        pending = null;
      });
    return pending;
  }

  return {
    getCachedUsage: () => cached,
    getUsage
  };
}
