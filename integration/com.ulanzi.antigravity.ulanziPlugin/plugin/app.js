import WebSocket from "ws";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const PLUGIN_UUID = "com.ulanzi.ulanzistudio.antigravity";
const BRIDGE_URL = process.env.ANTIGRAVITY_BRIDGE_URL || "http://127.0.0.1:17374";
const [address = "127.0.0.1", port = "3906"] = process.argv.slice(2);
const HOST_URL = `ws://${address}:${port}`;
const instances = new Map();
const PLUGIN_ROOT = resolve(dirname(resolve(process.argv[1])), "..");
const USAGE_BASE64 = readFileSync(
  resolve(PLUGIN_ROOT, "assets/icons/usage-base.png")
).toString("base64");

const ACTION_LABELS = Object.freeze({
  task1: "SESSION 1",
  task2: "SESSION 2",
  task3: "SESSION 3",
  task4: "SESSION 4",
  task5: "SESSION 5",
  proceed: "PROCEED",
  cancel: "CANCEL",
  attention: "ATTENTION",
  subagents: "SUBAGENTS",
  plan: "PLAN",
  walkthrough: "WALKTHROUGH",
  usage: "USAGE",
  new: "NEW",
  navigate: "LATEST",
  hud: "HUD",
  boost: "BOOST",
  grillme: "GRILL-ME",
  goal: "GOAL"
});

const TASK_ICON_PATHS = Object.freeze({
  idle: "assets/icons/task-idle.png",
  working: "assets/icons/task-working.png",
  complete: "assets/icons/task-complete.png",
  attention: "assets/icons/task-attention.png",
  error: "assets/icons/task-error.png"
});

function taskIconPath(status) {
  const value = String(status || "").toLowerCase();
  if (["working", "thinking", "running", "in_progress", "executing", "planning"].includes(value)) return TASK_ICON_PATHS.working;
  if (["unread", "complete", "completed", "done", "success"].includes(value)) return TASK_ICON_PATHS.complete;
  if (["attention", "notification", "input", "approval", "waiting_input", "needs_input", "waiting"].includes(value)) return TASK_ICON_PATHS.attention;
  if (["error", "failed", "failure"].includes(value)) return TASK_ICON_PATHS.error;
  return TASK_ICON_PATHS.idle;
}

function shortTitle(value) {
  const title = String(value || "Untitled").replace(/\s+/g, " ").trim();
  return title.length > 18 ? `${title.slice(0, 17)}…` : title;
}

let socket;
let reconnectTimer;
let pollTimer;
let pollInFlight = false;
let latestState = null;
const sessionStartTimes = new Map();

function updateSessionRunningTimes(slots, activeTasks) {
  const currentRunningKeys = new Set();
  const allItems = [...(slots || []), ...(activeTasks || [])];
  for (const item of allItems) {
    if (!item?.threadKey) continue;
    const isRunning = ["working", "running", "thinking", "in_progress"].includes(String(item.status || "").toLowerCase());
    if (isRunning) {
      currentRunningKeys.add(item.threadKey);
      if (!sessionStartTimes.has(item.threadKey)) {
        sessionStartTimes.set(item.threadKey, item.startedAt || Date.now());
      }
    }
  }
  for (const key of sessionStartTimes.keys()) {
    if (!currentRunningKeys.has(key)) {
      sessionStartTimes.delete(key);
    }
  }
}

function formatElapsed(ms) {
  if (!ms || ms < 0) return "";
  const sec = Math.floor(ms / 1000);
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  const remSec = sec % 60;
  if (min < 60) return `${min}m ${remSec}s`;
  const hr = Math.floor(min / 60);
  const remMin = min % 60;
  return `${hr}h ${remMin}m`;
}

function extractWindowUsage(usage, kind) {
  const windows = Array.isArray(usage?.windows) ? usage.windows : [];
  const window = windows.find((item) => item?.kind === kind);
  if (!window) return null;
  const remaining = Number(window.remainingPercent);
  return Number.isFinite(remaining)
    ? Math.max(0, Math.min(100, Math.round(remaining)))
    : null;
}

function usageRemaining(usage) {
  return {
    fiveHour: extractWindowUsage(usage, "five-hour") ?? extractWindowUsage(usage, "session") ?? extractWindowUsage(usage, "context"),
    weekly: extractWindowUsage(usage, "weekly")
  };
}

function formatResetCountdown(resetsAt) {
  if (!resetsAt || !Number.isFinite(resetsAt)) return null;
  const targetMs = resetsAt > 1e11 ? resetsAt : resetsAt * 1000;
  const diffMs = targetMs - Date.now();
  if (diffMs <= 0) return null;
  if (diffMs < 3600000) {
    const mins = Math.max(1, Math.ceil(diffMs / 60000));
    return `RESET ${mins}M`;
  }
  if (diffMs < 86400000) {
    const hrs = Math.floor(diffMs / 3600000);
    const mins = Math.floor((diffMs % 3600000) / 60000);
    return mins > 0 ? `RESET ${hrs}H ${mins}M` : `RESET ${hrs}H`;
  }
  const days = Math.floor(diffMs / 86400000);
  const hrs = Math.floor((diffMs % 86400000) / 3600000);
  return hrs > 0 ? `RESET ${days}D ${hrs}H` : `RESET ${days}D`;
}

function getPrimaryResetText(usage) {
  const windows = Array.isArray(usage?.windows) ? usage.windows : [];
  const primary = windows.find((w) => w?.kind === "five-hour" && w?.resetsAt) ||
                  windows.find((w) => w?.kind === "session" && w?.resetsAt) ||
                  windows.find((w) => w?.resetsAt);
  return primary?.resetsAt ? formatResetCountdown(primary.resetsAt) : null;
}

function getUsageProgressColor(remaining) {
  if (remaining === null) return "#858c8f";
  if (remaining >= 50) return "#2fbd7f";
  if (remaining >= 20) return "#e89b2d";
  return "#e45861";
}

function usageIconData(usage) {
  const { fiveHour, weekly } = usageRemaining(usage);
  const col1 = getUsageProgressColor(fiveHour);
  const col2 = getUsageProgressColor(weekly);
  const resetLabel = getPrimaryResetText(usage);

  const r1 = 60;
  const r2 = 47;
  const c1 = 2 * Math.PI * r1;
  const c2 = 2 * Math.PI * r2;
  const filled1 = c1 * (fiveHour ?? 0) / 100;
  const filled2 = c2 * (weekly ?? 0) / 100;

  const val1 = fiveHour === null ? "—" : String(fiveHour);
  const pct1 = fiveHour === null ? "" : "%";
  const val2 = weekly === null ? "—" : String(weekly);
  const pct2 = weekly === null ? "" : "%";

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="196" height="196" viewBox="0 0 196 196">
    <defs>
      <filter id="glow" x="-30%" y="-30%" width="160%" height="160%">
        <feGaussianBlur stdDeviation="3.5" result="blur"/>
        <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
      </filter>
    </defs>
    <image width="196" height="196" href="data:image/png;base64,${USAGE_BASE64}" xlink:href="data:image/png;base64,${USAGE_BASE64}"/>
    <g fill="none" transform="rotate(-90 98 94)">
      <!-- Outer Track (5H) -->
      <circle cx="98" cy="94" r="${r1}" stroke="#5e6c68" stroke-opacity=".25" stroke-width="7"/>
      <circle cx="98" cy="94" r="${r1}" stroke="#a0aca9" stroke-opacity=".3" stroke-width="5"/>
      <!-- Inner Track (Weekly) -->
      <circle cx="98" cy="94" r="${r2}" stroke="#5e6c68" stroke-opacity=".25" stroke-width="7"/>
      <circle cx="98" cy="94" r="${r2}" stroke="#a0aca9" stroke-opacity=".3" stroke-width="5"/>
      <!-- Outer Progress (5H) -->
      ${fiveHour !== null ? `
        <circle cx="98" cy="94" r="${r1}" stroke="${col1}" stroke-opacity=".4" stroke-width="10" stroke-linecap="butt" stroke-dasharray="${filled1} ${c1 - filled1}" filter="url(#glow)"/>
        <circle cx="98" cy="94" r="${r1}" stroke="${col1}" stroke-width="6" stroke-linecap="butt" stroke-dasharray="${filled1} ${c1 - filled1}"/>
      ` : ""}
      <!-- Inner Progress (Weekly) -->
      ${weekly !== null ? `
        <circle cx="98" cy="94" r="${r2}" stroke="${col2}" stroke-opacity=".4" stroke-width="10" stroke-linecap="butt" stroke-dasharray="${filled2} ${c2 - filled2}" filter="url(#glow)"/>
        <circle cx="98" cy="94" r="${r2}" stroke="${col2}" stroke-width="6" stroke-linecap="butt" stroke-dasharray="${filled2} ${c2 - filled2}"/>
      ` : ""}
    </g>
    <!-- Center text: 5H and WK -->
    <text x="98" y="85" text-anchor="middle" font-family="-apple-system,BlinkMacSystemFont,Arial,sans-serif">
      <tspan font-size="11" font-weight="700" fill="#6b787c" letter-spacing="0.5">5H </tspan>
      <tspan font-size="17" font-weight="800" fill="#2d3335">${val1}${pct1 ? `<tspan dx="1" dy="-2" font-size="11" font-weight="700" fill="#6b787c">${pct1}</tspan>` : ""}</tspan>
    </text>
    <text x="98" y="108" text-anchor="middle" font-family="-apple-system,BlinkMacSystemFont,Arial,sans-serif">
      <tspan font-size="11" font-weight="700" fill="#6b787c" letter-spacing="0.5">WK </tspan>
      <tspan font-size="17" font-weight="800" fill="#2d3335">${val2}${pct2 ? `<tspan dx="1" dy="-2" font-size="11" font-weight="700" fill="#6b787c">${pct2}</tspan>` : ""}</tspan>
    </text>
    ${resetLabel ? `
      <text x="98" y="166" text-anchor="middle" font-family="-apple-system,BlinkMacSystemFont,Arial,sans-serif" font-size="9" font-weight="800" fill="#6b787c" letter-spacing="0.8">${resetLabel}</text>
    ` : ""}
  </svg>`;
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
}

function contextOf(message) {
  return String(message.actionid || `${message.uuid}___${message.key}`);
}

function taskSlot(uuid) {
  const match = String(uuid || "").match(/\.task([1-5])$/);
  return match ? Number(match[1]) - 1 : null;
}

function actionName(uuid) {
  const name = String(uuid || "").split(".").at(-1);
  return Object.hasOwn(ACTION_LABELS, name) ? name : null;
}

function escapeXml(str) {
  return String(str || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function sessionIconData({
  slot = 1,
  title = "Ready",
  status = "idle",
  elapsed = ""
}) {
  const isRunning = status === "working" || status === "running";
  const isAttention = status === "attention";
  const isError = status === "error";

  let statusText = "IDLE";
  let statusBg = "#334155";
  let statusBorder = "#475569";
  let statusColor = "#94a3b8";

  if (isRunning) {
    statusText = elapsed && elapsed !== "0s" ? `RUNNING ${elapsed}` : "RUNNING";
    statusBg = "#1e3a8a";
    statusBorder = "#3b82f6";
    statusColor = "#60a5fa";
  } else if (isAttention) {
    statusText = "FEEDBACK NEEDED";
    statusBg = "#78350f";
    statusBorder = "#f59e0b";
    statusColor = "#fbbf24";
  } else if (isError) {
    statusText = "ERROR";
    statusBg = "#7f1d1d";
    statusBorder = "#ef4444";
    statusColor = "#f87171";
  }

  const cleanTitle = escapeXml(title.slice(0, 22));

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="196" height="196" viewBox="0 0 196 196">
    <defs>
      <linearGradient id="bgGrad" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stop-color="#0f172a"/>
        <stop offset="100%" stop-color="#020617"/>
      </linearGradient>
      <linearGradient id="headerGrad" x1="0%" y1="0%" x2="100%" y2="0%">
        <stop offset="0%" stop-color="#8b5cf6"/>
        <stop offset="100%" stop-color="#6366f1"/>
      </linearGradient>
    </defs>
    <rect width="196" height="196" rx="24" fill="url(#bgGrad)"/>
    <rect x="2" y="2" width="192" height="192" rx="22" fill="none" stroke="${isRunning ? '#3b82f6' : isAttention ? '#f59e0b' : '#1e293b'}" stroke-width="2"/>
    
    <!-- Top badge: SESSION # -->
    <g transform="translate(98, 36)">
      <rect x="-46" y="-13" width="92" height="26" rx="13" fill="url(#headerGrad)"/>
      <text x="0" y="5" text-anchor="middle" font-family="-apple-system,BlinkMacSystemFont,Arial,sans-serif" font-size="11" font-weight="800" fill="#ffffff" letter-spacing="1">SESSION ${slot}</text>
    </g>

    <!-- Center Title -->
    <text x="98" y="98" text-anchor="middle" font-family="-apple-system,BlinkMacSystemFont,Arial,sans-serif" font-size="14" font-weight="700" fill="#f1f5f9" letter-spacing="0.3">${cleanTitle}</text>

    <!-- Status Pill -->
    <g transform="translate(98, 154)">
      <rect x="-68" y="-14" width="136" height="28" rx="14" fill="${statusBg}" stroke="${statusBorder}" stroke-width="1.2"/>
      <circle cx="-50" cy="0" r="4" fill="${statusColor}"/>
      <text x="4" y="4" text-anchor="middle" font-family="-apple-system,BlinkMacSystemFont,Arial,sans-serif" font-size="10" font-weight="800" fill="${statusColor}" letter-spacing="0.5">${statusText}</text>
    </g>
  </svg>`;
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
}

function proceedIconData() {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="196" height="196" viewBox="0 0 196 196">
    <defs>
      <linearGradient id="bgProceed" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stop-color="#064e3b"/>
        <stop offset="100%" stop-color="#022c22"/>
      </linearGradient>
      <filter id="glowGreen" x="-30%" y="-30%" width="160%" height="160%">
        <feGaussianBlur stdDeviation="4" result="blur"/>
        <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
      </filter>
    </defs>
    <rect width="196" height="196" rx="24" fill="url(#bgProceed)"/>
    <rect x="2" y="2" width="192" height="192" rx="22" fill="none" stroke="#10b981" stroke-width="2"/>
    <g transform="translate(98, 76)">
      <circle cx="0" cy="0" r="32" fill="#10b981" filter="url(#glowGreen)"/>
      <path d="M-10 -2 L-3 6 L12 -8" fill="none" stroke="#ffffff" stroke-width="4.5" stroke-linecap="round" stroke-linejoin="round"/>
    </g>
    <text x="98" y="142" text-anchor="middle" font-family="-apple-system,BlinkMacSystemFont,Arial,sans-serif" font-size="15" font-weight="900" fill="#ffffff" letter-spacing="1">PROCEED</text>
    <text x="98" y="162" text-anchor="middle" font-family="-apple-system,BlinkMacSystemFont,Arial,sans-serif" font-size="10" font-weight="800" fill="#6ee7b7" letter-spacing="0.8">APPROVE PLAN</text>
  </svg>`;
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
}

function cancelIconData() {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="196" height="196" viewBox="0 0 196 196">
    <defs>
      <linearGradient id="bgCancel" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stop-color="#450a0a"/>
        <stop offset="100%" stop-color="#1c0404"/>
      </linearGradient>
      <filter id="glowRed" x="-30%" y="-30%" width="160%" height="160%">
        <feGaussianBlur stdDeviation="4" result="blur"/>
        <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
      </filter>
    </defs>
    <rect width="196" height="196" rx="24" fill="url(#bgCancel)"/>
    <rect x="2" y="2" width="192" height="192" rx="22" fill="none" stroke="#ef4444" stroke-width="2"/>
    <g transform="translate(98, 76)">
      <circle cx="0" cy="0" r="32" fill="#ef4444" filter="url(#glowRed)"/>
      <path d="M-8 -8 L8 8 M8 -8 L-8 8" fill="none" stroke="#ffffff" stroke-width="4.5" stroke-linecap="round"/>
    </g>
    <text x="98" y="142" text-anchor="middle" font-family="-apple-system,BlinkMacSystemFont,Arial,sans-serif" font-size="15" font-weight="900" fill="#ffffff" letter-spacing="1">STOP</text>
    <text x="98" y="162" text-anchor="middle" font-family="-apple-system,BlinkMacSystemFont,Arial,sans-serif" font-size="10" font-weight="800" fill="#fca5a5" letter-spacing="0.8">CANCEL TASK</text>
  </svg>`;
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
}

function attentionIconData(count = 0) {
  const hasAlert = count > 0;
  const countStr = count > 9 ? "9+" : String(count);
  const color = hasAlert ? "#f59e0b" : "#64748b";
  const bgGradStart = hasAlert ? "#451a03" : "#0f172a";
  const bgGradEnd = hasAlert ? "#1c0b02" : "#020617";

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="196" height="196" viewBox="0 0 196 196">
    <defs>
      <linearGradient id="bgAttn" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stop-color="${bgGradStart}"/>
        <stop offset="100%" stop-color="${bgGradEnd}"/>
      </linearGradient>
      ${hasAlert ? `
      <filter id="glowOrange" x="-30%" y="-30%" width="160%" height="160%">
        <feGaussianBlur stdDeviation="4" result="blur"/>
        <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
      </filter>` : ""}
    </defs>
    <rect width="196" height="196" rx="24" fill="url(#bgAttn)"/>
    <rect x="2" y="2" width="192" height="192" rx="22" fill="none" stroke="${color}" stroke-width="2"/>
    <g transform="translate(98, 76)">
      <circle cx="0" cy="0" r="32" fill="${color}" ${hasAlert ? 'filter="url(#glowOrange)"' : ""}/>
      <text x="0" y="9" text-anchor="middle" font-family="-apple-system,BlinkMacSystemFont,Arial,sans-serif" font-size="28" font-weight="900" fill="#ffffff">!</text>
    </g>
    <text x="98" y="142" text-anchor="middle" font-family="-apple-system,BlinkMacSystemFont,Arial,sans-serif" font-size="15" font-weight="900" fill="#ffffff" letter-spacing="1">${hasAlert ? `${countStr} PENDING` : 'ALL CLEAR'}</text>
    <text x="98" y="162" text-anchor="middle" font-family="-apple-system,BlinkMacSystemFont,Arial,sans-serif" font-size="10" font-weight="800" fill="${hasAlert ? '#fcd34d' : '#94a3b8'}" letter-spacing="0.8">ATTENTION</text>
  </svg>`;
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
}

function subagentsIconData(count = 0) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="196" height="196" viewBox="0 0 196 196">
    <defs>
      <linearGradient id="bgSub" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stop-color="#0c4a6e"/>
        <stop offset="100%" stop-color="#082f49"/>
      </linearGradient>
    </defs>
    <rect width="196" height="196" rx="24" fill="url(#bgSub)"/>
    <rect x="2" y="2" width="192" height="192" rx="22" fill="none" stroke="#0284c7" stroke-width="2"/>
    <g transform="translate(98, 72)">
      <rect x="-30" y="-18" width="60" height="36" rx="18" fill="#0284c7"/>
      <text x="0" y="8" text-anchor="middle" font-family="-apple-system,BlinkMacSystemFont,Arial,sans-serif" font-size="22" font-weight="900" fill="#ffffff">${count}</text>
    </g>
    <text x="98" y="140" text-anchor="middle" font-family="-apple-system,BlinkMacSystemFont,Arial,sans-serif" font-size="13" font-weight="900" fill="#ffffff" letter-spacing="1">SUBAGENTS</text>
    <text x="98" y="160" text-anchor="middle" font-family="-apple-system,BlinkMacSystemFont,Arial,sans-serif" font-size="10" font-weight="800" fill="#7dd3fc" letter-spacing="0.8">ACTIVE WORKERS</text>
  </svg>`;
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
}

function planIconData() {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="196" height="196" viewBox="0 0 196 196">
    <defs>
      <linearGradient id="bgPlan" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stop-color="#312e81"/>
        <stop offset="100%" stop-color="#1e1b4b"/>
      </linearGradient>
    </defs>
    <rect width="196" height="196" rx="24" fill="url(#bgPlan)"/>
    <rect x="2" y="2" width="192" height="192" rx="22" fill="none" stroke="#6366f1" stroke-width="2"/>
    <g transform="translate(98, 70)">
      <rect x="-24" y="-30" width="48" height="60" rx="8" fill="#4338ca" stroke="#818cf8" stroke-width="2"/>
      <line x1="-14" y1="-15" x2="14" y2="-15" stroke="#c7d2fe" stroke-width="3" stroke-linecap="round"/>
      <line x1="-14" y1="-3" x2="14" y2="-3" stroke="#c7d2fe" stroke-width="3" stroke-linecap="round"/>
      <line x1="-14" y1="9" x2="6" y2="9" stroke="#c7d2fe" stroke-width="3" stroke-linecap="round"/>
    </g>
    <text x="98" y="145" text-anchor="middle" font-family="-apple-system,BlinkMacSystemFont,Arial,sans-serif" font-size="14" font-weight="900" fill="#ffffff" letter-spacing="1">VIEW PLAN</text>
    <text x="98" y="165" text-anchor="middle" font-family="-apple-system,BlinkMacSystemFont,Arial,sans-serif" font-size="10" font-weight="800" fill="#a5b4fc" letter-spacing="0.8">OPEN IN VS CODE</text>
  </svg>`;
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
}

function walkthroughIconData() {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="196" height="196" viewBox="0 0 196 196">
    <defs>
      <linearGradient id="bgWalk" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stop-color="#4c1d95"/>
        <stop offset="100%" stop-color="#2e1065"/>
      </linearGradient>
    </defs>
    <rect width="196" height="196" rx="24" fill="url(#bgWalk)"/>
    <rect x="2" y="2" width="192" height="192" rx="22" fill="none" stroke="#8b5cf6" stroke-width="2"/>
    <g transform="translate(98, 70)">
      <circle cx="0" cy="0" r="28" fill="#6d28d9" stroke="#a78bfa" stroke-width="2"/>
      <path d="M-8 -2 L-2 4 L10 -6" fill="none" stroke="#ffffff" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"/>
    </g>
    <text x="98" y="145" text-anchor="middle" font-family="-apple-system,BlinkMacSystemFont,Arial,sans-serif" font-size="14" font-weight="900" fill="#ffffff" letter-spacing="1">SUMMARY</text>
    <text x="98" y="165" text-anchor="middle" font-family="-apple-system,BlinkMacSystemFont,Arial,sans-serif" font-size="10" font-weight="800" fill="#c4b5fd" letter-spacing="0.8">WALKTHROUGH</text>
  </svg>`;
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
}

function newSessionIconData() {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="196" height="196" viewBox="0 0 196 196">
    <defs>
      <linearGradient id="bgNew" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stop-color="#0f172a"/>
        <stop offset="100%" stop-color="#020617"/>
      </linearGradient>
      <linearGradient id="iconNew" x1="0%" y1="0%" x2="100%" y2="0%">
        <stop offset="0%" stop-color="#a855f7"/>
        <stop offset="100%" stop-color="#6366f1"/>
      </linearGradient>
    </defs>
    <rect width="196" height="196" rx="24" fill="url(#bgNew)"/>
    <rect x="2" y="2" width="192" height="192" rx="22" fill="none" stroke="#334155" stroke-width="2"/>
    <g transform="translate(98, 74)">
      <circle cx="0" cy="0" r="30" fill="url(#iconNew)"/>
      <path d="M0 -12 L0 12 M-12 0 L12 0" fill="none" stroke="#ffffff" stroke-width="4.5" stroke-linecap="round"/>
    </g>
    <text x="98" y="145" text-anchor="middle" font-family="-apple-system,BlinkMacSystemFont,Arial,sans-serif" font-size="14" font-weight="900" fill="#ffffff" letter-spacing="1">NEW SESSION</text>
    <text x="98" y="165" text-anchor="middle" font-family="-apple-system,BlinkMacSystemFont,Arial,sans-serif" font-size="10" font-weight="800" fill="#cbd5e1" letter-spacing="0.8">START CHAT</text>
  </svg>`;
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
}

function hudIconData({
  status = "idle",
  title = "Ready",
  elapsed = "",
  connected = true
}) {
  if (!connected) {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="196" height="196" viewBox="0 0 196 196">
      <defs>
        <linearGradient id="bgHudOff" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stop-color="#0f172a"/>
          <stop offset="100%" stop-color="#020617"/>
        </linearGradient>
      </defs>
      <rect width="196" height="196" rx="24" fill="url(#bgHudOff)"/>
      <rect x="2" y="2" width="192" height="192" rx="22" fill="none" stroke="#334155" stroke-width="2"/>
      <g transform="translate(98, 42)">
        <rect x="-40" y="-13" width="80" height="26" rx="13" fill="#1e293b"/>
        <text x="0" y="5" text-anchor="middle" font-family="-apple-system,BlinkMacSystemFont,Arial,sans-serif" font-size="11" font-weight="900" fill="#94a3b8" letter-spacing="1.2">HUD</text>
      </g>
      <text x="98" y="105" text-anchor="middle" font-family="-apple-system,BlinkMacSystemFont,Arial,sans-serif" font-size="18" font-weight="900" fill="#64748b" letter-spacing="0.5">OFFLINE</text>
      <text x="98" y="156" text-anchor="middle" font-family="-apple-system,BlinkMacSystemFont,Arial,sans-serif" font-size="11" font-weight="700" fill="#ef4444" letter-spacing="0.8">BRIDGE OFF</text>
    </svg>`;
    return `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
  }

  const st = String(status || "").toUpperCase();
  let pillText = "IDLE";
  let pillBg = "#1e293b";
  let pillBorder = "#334155";
  let pillCol = "#94a3b8";
  let strokeCol = "#1e293b";

  if (st === "PLANNING") {
    pillText = "PLANNING";
    pillBg = "#312e81";
    pillBorder = "#6366f1";
    pillCol = "#c7d2fe";
    strokeCol = "#6366f1";
  } else if (st === "EXECUTING" || st === "WORKING" || st === "RUNNING") {
    pillText = "EXECUTING";
    pillBg = "#0369a1";
    pillBorder = "#0284c7";
    pillCol = "#bae6fd";
    strokeCol = "#0ea5e9";
  } else if (st === "WAITING" || st === "ATTENTION") {
    pillText = "WAITING";
    pillBg = "#78350f";
    pillBorder = "#d97706";
    pillCol = "#fde68a";
    strokeCol = "#f59e0b";
  } else if (st === "ERROR") {
    pillText = "ERROR";
    pillBg = "#7f1d1d";
    pillBorder = "#dc2626";
    pillCol = "#fecaca";
    strokeCol = "#ef4444";
  }

  const isWorking = pillText === "PLANNING" || pillText === "EXECUTING";
  const timerText = elapsed && elapsed !== "0s" ? elapsed : (isWorking ? "ACTIVE" : "STANDBY");
  const cleanTitle = escapeXml(title.length > 20 ? `${title.slice(0, 19)}…` : title);

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="196" height="196" viewBox="0 0 196 196">
    <defs>
      <linearGradient id="bgHud" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stop-color="#0f172a"/>
        <stop offset="100%" stop-color="#020617"/>
      </linearGradient>
      <filter id="glowHud" x="-30%" y="-30%" width="160%" height="160%">
        <feGaussianBlur stdDeviation="3.5" result="blur"/>
        <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
      </filter>
    </defs>
    <rect width="196" height="196" rx="24" fill="url(#bgHud)"/>
    <rect x="2" y="2" width="192" height="192" rx="22" fill="none" stroke="${strokeCol}" stroke-width="${isWorking ? 2.5 : 2}" ${isWorking ? 'filter="url(#glowHud)"' : ''}/>

    <!-- Status Pill -->
    <g transform="translate(98, 40)">
      <rect x="-56" y="-14" width="112" height="28" rx="14" fill="${pillBg}" stroke="${pillBorder}" stroke-width="1.5"/>
      <circle cx="-40" cy="0" r="4" fill="${pillCol}"/>
      <text x="6" y="4" text-anchor="middle" font-family="-apple-system,BlinkMacSystemFont,Arial,sans-serif" font-size="11" font-weight="900" fill="${pillCol}" letter-spacing="1">${pillText}</text>
    </g>

    <!-- Center Session Title -->
    <text x="98" y="96" text-anchor="middle" font-family="-apple-system,BlinkMacSystemFont,Arial,sans-serif" font-size="13" font-weight="800" fill="#f8fafc" letter-spacing="0.3">${cleanTitle}</text>

    <!-- Bottom Timer / Standby -->
    <g transform="translate(98, 154)">
      <rect x="-52" y="-13" width="104" height="26" rx="13" fill="#1e293b" stroke="#334155" stroke-width="1.2"/>
      <text x="0" y="4" text-anchor="middle" font-family="-apple-system,BlinkMacSystemFont,Arial,sans-serif" font-size="11" font-weight="800" fill="#94a3b8" letter-spacing="0.8">${timerText}</text>
    </g>
  </svg>`;
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
}

function slashIconData(command) {
  let title = "/CMD";
  let sub = "COMMAND";
  let col = "#38bdf8";
  let bgStart = "#0c4a6e";
  let bgEnd = "#082f49";
  let icon = "";

  if (command === "boost") {
    title = "/BOOST";
    sub = "DEEP THINKING";
    col = "#a855f7";
    bgStart = "#3b0764";
    bgEnd = "#1e053a";
    icon = `<path d="M102 54 L86 78 L98 78 L94 98 L110 74 L98 74 Z" fill="${col}" stroke="#ffffff" stroke-width="1.5" stroke-linejoin="round"/>`;
  } else if (command === "grillme") {
    title = "/GRILL-ME";
    sub = "ALIGN PLAN";
    col = "#f59e0b";
    bgStart = "#451a03";
    bgEnd = "#1c0b02";
    icon = `<path d="M84 62 h28 a10 10 0 0 1 10 10 v12 a10 10 0 0 1 -10 10 h-16 l-8 8 v-8 h-4 a10 10 0 0 1 -10 -10 v-12 a10 10 0 0 1 10 -10 z" fill="none" stroke="${col}" stroke-width="3" stroke-linejoin="round"/>
            <circle cx="92" cy="74" r="2" fill="#ffffff"/>
            <circle cx="98" cy="74" r="2" fill="#ffffff"/>
            <circle cx="104" cy="74" r="2" fill="#ffffff"/>`;
  } else if (command === "goal") {
    title = "/GOAL";
    sub = "AUTONOMOUS";
    col = "#10b981";
    bgStart = "#064e3b";
    bgEnd = "#022c22";
    icon = `<circle cx="98" cy="74" r="18" fill="none" stroke="${col}" stroke-width="3"/>
            <circle cx="98" cy="74" r="10" fill="none" stroke="#34d399" stroke-width="2.5"/>
            <circle cx="98" cy="74" r="4" fill="#ffffff"/>`;
  }

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="196" height="196" viewBox="0 0 196 196">
    <defs>
      <linearGradient id="bgSlash_${command}" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stop-color="${bgStart}"/>
        <stop offset="100%" stop-color="${bgEnd}"/>
      </linearGradient>
      <filter id="glowSlash_${command}" x="-30%" y="-30%" width="160%" height="160%">
        <feGaussianBlur stdDeviation="3.5" result="blur"/>
        <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
      </filter>
    </defs>
    <rect width="196" height="196" rx="24" fill="url(#bgSlash_${command})"/>
    <rect x="2" y="2" width="192" height="192" rx="22" fill="none" stroke="${col}" stroke-width="2"/>

    <g transform="translate(98, 36)">
      <rect x="-38" y="-12" width="76" height="24" rx="12" fill="#0f172a" stroke="${col}" stroke-width="1.2"/>
      <text x="0" y="4" text-anchor="middle" font-family="-apple-system,BlinkMacSystemFont,Arial,sans-serif" font-size="10" font-weight="900" fill="${col}" letter-spacing="1">SLASH</text>
    </g>

    <g filter="url(#glowSlash_${command})">
      ${icon}
    </g>

    <text x="98" y="136" text-anchor="middle" font-family="-apple-system,BlinkMacSystemFont,Arial,sans-serif" font-size="16" font-weight="900" fill="#ffffff" letter-spacing="1">${title}</text>
    <text x="98" y="158" text-anchor="middle" font-family="-apple-system,BlinkMacSystemFont,Arial,sans-serif" font-size="10" font-weight="800" fill="#94a3b8" letter-spacing="0.8">${sub}</text>
  </svg>`;
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
}

function send(message) {
  if (socket?.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify(message));
  }
}

function ack(message) {
  send({
    code: 0,
    cmd: message.cmd,
    uuid: message.uuid,
    actionid: message.actionid,
    key: message.key,
    active: message.active,
    param: message.param || {}
  });
}

function sendSvgState(instance, dataUrl) {
  if (!instance.active || instance.lastDisplay === dataUrl) return;
  instance.lastDisplay = dataUrl;
  send({
    cmd: "state",
    param: {
      statelist: [
        {
          uuid: instance.uuid,
          actionid: instance.actionid,
          key: instance.key,
          type: 1,
          data: dataUrl,
          showtext: false,
          textdata: ""
        },
        {
          uuid: instance.uuid,
          actionid: instance.actionid,
          key: instance.key,
          type: 0,
          state: 0,
          showtext: false,
          textdata: ""
        }
      ]
    }
  });
}

function setTaskDisplay(instance, path, text) {
  const digest = `path:${path}:${text}`;
  if (!instance.active || instance.lastDisplay === digest) return;
  instance.lastDisplay = digest;
  send({
    cmd: "state",
    param: {
      statelist: [{
        uuid: instance.uuid,
        actionid: instance.actionid,
        key: instance.key,
        type: 2,
        path,
        showtext: true,
        textdata: text
      }]
    }
  });
}

function renderInstance(instance) {
  if (!instance.active) return;
  const slot = taskSlot(instance.uuid);
  const slots = latestState?.slots || [];
  const activeTasks = latestState?.activeTasks || [];

  if (slot !== null) {
    if (!latestState?.connected) {
      setTaskDisplay(instance, TASK_ICON_PATHS.idle, "Bridge Offline");
      return;
    }
    const task = activeTasks[slot] || slots[slot];
    if (!task?.threadKey) {
      setTaskDisplay(instance, TASK_ICON_PATHS.idle, `Session ${slot + 1}`);
      return;
    }
    const displayStatus = task.status || task.agentStatus || "idle";
    setTaskDisplay(instance, taskIconPath(displayStatus), shortTitle(task.title));
    return;
  }

  const name = actionName(instance.uuid);
  if (!name) return;

  if (name === "proceed") {
    sendSvgState(instance, proceedIconData());
  } else if (name === "cancel") {
    sendSvgState(instance, cancelIconData());
  } else if (name === "attention") {
    sendSvgState(instance, attentionIconData(latestState?.pendingAttentionCount || 0));
  } else if (name === "subagents") {
    sendSvgState(instance, subagentsIconData(latestState?.subagentsCount || 0));
  } else if (name === "plan") {
    sendSvgState(instance, planIconData());
  } else if (name === "walkthrough") {
    sendSvgState(instance, walkthroughIconData());
  } else if (name === "usage") {
    sendSvgState(instance, usageIconData(latestState?.usage));
  } else if (name === "new") {
    sendSvgState(instance, newSessionIconData());
  } else if (name === "navigate") {
    if (!latestState?.connected) {
      setTaskDisplay(instance, TASK_ICON_PATHS.idle, "Bridge Offline");
      return;
    }
    const latestTask = activeTasks[0] || slots[0];
    if (!latestTask?.threadKey) {
      setTaskDisplay(instance, TASK_ICON_PATHS.idle, "Latest Session");
      return;
    }
    const displayStatus = latestTask.status || latestTask.agentStatus || "idle";
    setTaskDisplay(instance, taskIconPath(displayStatus), shortTitle(latestTask.title));
  } else if (name === "hud") {
    const latestTask = activeTasks[0] || slots[0] || null;
    const startTime = latestTask?.threadKey ? sessionStartTimes.get(latestTask.threadKey) : null;
    const elapsed = startTime ? formatElapsed(Date.now() - startTime) : "";
    sendSvgState(instance, hudIconData({
      status: latestTask?.agentStatus || latestTask?.status || "idle",
      title: latestTask?.title || "Ready",
      elapsed,
      connected: Boolean(latestState?.connected)
    }));
  } else if (name === "boost") {
    sendSvgState(instance, slashIconData("boost"));
  } else if (name === "grillme") {
    sendSvgState(instance, slashIconData("grillme"));
  } else if (name === "goal") {
    sendSvgState(instance, slashIconData("goal"));
  }
}

function renderAll() {
  const slots = latestState?.slots || [];
  const activeTasks = latestState?.activeTasks || [];
  updateSessionRunningTimes(slots, activeTasks);
  for (const instance of instances.values()) {
    renderInstance(instance);
  }
}

async function pollBridgeState() {
  if (pollInFlight) return;
  pollInFlight = true;
  try {
    const res = await fetch(`${BRIDGE_URL}/state`, { signal: AbortSignal.timeout(1200) });
    if (res.ok) {
      latestState = await res.json();
    }
  } catch (err) {
    latestState = { connected: false, error: err.message, slots: [] };
  } finally {
    pollInFlight = false;
    renderAll();
  }
}

async function invokeAction(name, param) {
  try {
    await fetch(`${BRIDGE_URL}/action/${name}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(param || {}),
      signal: AbortSignal.timeout(1500)
    });
  } catch {}
}

async function invoke(instance, pressed) {
  if (!pressed) return;
  const slot = taskSlot(instance.uuid);
  if (slot !== null) {
    await fetch(`${BRIDGE_URL}/task/${slot}/click`, { method: "POST", signal: AbortSignal.timeout(1500) }).catch(() => {});
    return;
  }
  const name = actionName(instance.uuid);
  if (!name) return;

  if (name === "usage" || name === "new" || name === "hud") {
    await fetch(`${BRIDGE_URL}/focus`, { method: "POST", signal: AbortSignal.timeout(1500) }).catch(() => {});
    return;
  }
  if (name === "navigate") {
    await fetch(`${BRIDGE_URL}/task/0/click`, { method: "POST", signal: AbortSignal.timeout(1500) }).catch(() => {});
    return;
  }
  if (["proceed", "cancel", "attention", "plan", "walkthrough", "boost", "grillme", "goal"].includes(name)) {
    await invokeAction(name);
  }
}

function addInstance(message) {
  const context = contextOf(message);
  const existing = instances.get(context);
  const instance = existing || {
    uuid: message.uuid,
    actionid: message.actionid,
    key: message.key,
    active: true,
    lastDisplay: null
  };
  instance.active = true;
  instances.set(context, instance);
  renderInstance(instance);
  return instance;
}

function handleMessage(raw) {
  let message;
  try {
    message = JSON.parse(String(raw));
  } catch {
    return;
  }

  if (message.cmd === "add" || message.cmd === "paramfromapp") {
    addInstance(message);
    ack(message);
    return;
  }

  if (message.cmd === "setactive") {
    const instance = instances.get(contextOf(message)) || addInstance(message);
    instance.active = Boolean(message.active);
    if (instance.active) {
      instance.lastDisplay = null;
      renderInstance(instance);
    }
    ack(message);
    return;
  }

  if (message.cmd === "clear") {
    for (const item of message.param || []) {
      instances.delete(contextOf(item));
    }
    ack(message);
    return;
  }

  if (message.cmd === "run") {
    ack(message);
    return;
  }

  if (["dialdown", "dialup", "dialrotate"].includes(message.cmd)) {
    const instance = instances.get(contextOf(message)) || addInstance(message);
    if (actionName(instance.uuid) === "navigate" && message.cmd === "dialdown") {
      void fetch(`${BRIDGE_URL}/task/0/click`, { method: "POST" }).catch(() => {});
    }
    ack(message);
    return;
  }

  if (["keydown", "keyup"].includes(message.cmd)) {
    const instance = instances.get(contextOf(message)) || addInstance(message);
    void invoke(instance, message.cmd !== "keyup");
    ack(message);
  }
}

function connect() {
  clearTimeout(reconnectTimer);
  socket = new WebSocket(HOST_URL);

  socket.on("open", () => {
    send({ code: 0, cmd: "connected", uuid: PLUGIN_UUID });
    clearInterval(pollTimer);
    pollTimer = setInterval(() => void pollBridgeState(), 500);
    pollTimer.unref();
    void pollBridgeState();
  });

  socket.on("message", handleMessage);

  socket.on("close", () => {
    clearInterval(pollTimer);
    reconnectTimer = setTimeout(connect, 1000);
    reconnectTimer.unref();
  });

  socket.on("error", (err) => {
    console.error("WS error:", err);
    socket.close();
  });
}

connect();

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    clearTimeout(reconnectTimer);
    clearInterval(pollTimer);
    socket?.close();
    process.exit(0);
  });
}
