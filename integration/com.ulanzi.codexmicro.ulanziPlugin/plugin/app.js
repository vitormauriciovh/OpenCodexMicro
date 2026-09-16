import WebSocket from "ws";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { createBridgeInstaller } from "./bridge-installer.js";

const PLUGIN_UUID = "com.ulanzi.ulanzistudio.codexmicro";
const BRIDGE_URL = process.env.CODEX_BRIDGE_URL || "http://127.0.0.1:17373";
const [address = "127.0.0.1", port = "3906"] = process.argv.slice(2);
const HOST_URL = `ws://${address}:${port}`;
const instances = new Map();
const PLUGIN_ROOT = resolve(dirname(resolve(process.argv[1])), "..");
const MANIFEST = JSON.parse(readFileSync(resolve(PLUGIN_ROOT, "manifest.json"), "utf8"));
const bridgeSetup = createBridgeInstaller({
  pluginRoot: PLUGIN_ROOT,
  bridgeUrl: BRIDGE_URL,
  version: MANIFEST.Version
});
const USAGE_BASE64 = readFileSync(
  resolve(PLUGIN_ROOT, "assets/icons/usage-base.png")
).toString("base64");
const ACTION_LABELS = Object.freeze({
  fast: "FAST",
  usage: "USAGE",
  pin: "PIN",
  new: "NEW",
  navigate: "LATEST",
  fork: "FORK",
  steer: "STEER",
  mic: "MIC",
  submit: "SUBMIT",
  taskmonitor: "MONITOR",
  approve: "APPROVE",
  reject: "DENY",
  attention: "ATTENTION",
  stop: "STOP",
  tokens: "TOKENS",
  reasoning: "THINK",
  prompt_test: "TEST",
  prompt_review: "REVIEW",
  prompt_commit: "COMMIT"
});
const TASK_ICON_PATHS = Object.freeze({
  idle: "assets/icons/task-idle.png",
  working: "assets/icons/task-working.png",
  complete: "assets/icons/task-complete.png",
  attention: "assets/icons/task-attention.png",
  error: "assets/icons/task-error.png"
});

let socket;
let reconnectTimer;
let pollTimer;
let pollInFlight = false;
let latestState = null;
let setupOperation = null;
let taskMonitorIndex = 0;
let lastTaskMonitorRotation = Date.now();
let lastKnownTask = null;
let currentDisplayedTask = null;
let selectedDialSlot = 0;
const taskStartTimes = new Map();

function updateTaskRunningTimes(slots, activeTasks) {
  const currentRunningKeys = new Set();
  const allItems = [...(slots || []), ...(activeTasks || [])];
  for (const item of allItems) {
    if (!item?.threadKey) continue;
    const isRunning = ["working", "thinking", "running", "in_progress"].includes(String(item.status || "").toLowerCase());
    if (isRunning) {
      currentRunningKeys.add(item.threadKey);
      if (!taskStartTimes.has(item.threadKey)) {
        taskStartTimes.set(item.threadKey, Date.now());
      }
    }
  }
  for (const key of taskStartTimes.keys()) {
    if (!currentRunningKeys.has(key)) {
      taskStartTimes.delete(key);
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
    fiveHour: extractWindowUsage(usage, "five-hour"),
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

function sendToInspector(message, payload) {
  send({
    cmd: "sendToPropertyInspector",
    uuid: message.uuid,
    actionid: message.actionid,
    key: message.key,
    payload
  });
}

async function sendBridgeSetupStatus(message, extra = {}) {
  const status = await bridgeSetup.status();
  sendToInspector(message, {
    type: "bridgeSetupStatus",
    status,
    busy: Boolean(setupOperation),
    operation: setupOperation,
    ...extra
  });
}

async function handleBridgeSetupMessage(message) {
  const action = message.payload?.action;
  if (action === "openGuide") {
    send({
      cmd: "openurl",
      url: "https://github.com/UlanziTechnology/OpenCodexMicro#1-llm--agent-installation",
      local: false
    });
    await sendBridgeSetupStatus(message);
    return;
  }
  if (action === "status" || !action) {
    await sendBridgeSetupStatus(message);
    return;
  }
  if (!["install", "launch", "uninstall"].includes(action)) {
    await sendBridgeSetupStatus(message, { error: `Unknown setup action: ${action}` });
    return;
  }
  if (setupOperation) {
    await sendBridgeSetupStatus(message);
    return;
  }

  setupOperation = action;
  await sendBridgeSetupStatus(message);
  let result = null;
  let failure = null;
  try {
    if (action === "install") await bridgeSetup.install();
    if (action === "launch") await bridgeSetup.launch();
    if (action === "uninstall") await bridgeSetup.uninstall();
    result = action;
  } catch (error) {
    failure = error.message;
    send({
      cmd: "logMessage",
      uuid: message.uuid,
      actionid: message.actionid,
      key: message.key,
      level: "error",
      message: `Codex Bridge ${action} failed: ${error.message}`
    });
  } finally {
    setupOperation = null;
  }
  await sendBridgeSetupStatus(message, { result, error: failure });
}

function taskIconPath(status) {
  const value = String(status || "").toLowerCase();
  if (["working", "thinking", "running", "in_progress"].includes(value)) return TASK_ICON_PATHS.working;
  if (["unread", "complete", "completed", "done", "success"].includes(value)) return TASK_ICON_PATHS.complete;
  if (["attention", "notification", "input", "approval", "waiting_input", "needs_input"].includes(value)) return TASK_ICON_PATHS.attention;
  if (["error", "failed", "failure"].includes(value)) return TASK_ICON_PATHS.error;
  return TASK_ICON_PATHS.idle;
}

function shortTitle(value) {
  const title = String(value || "Untitled").replace(/\s+/g, " ").trim();
  return title.length > 18 ? `${title.slice(0, 17)}…` : title;
}

function setDisplay(instance, state, text) {
  const digest = `${state}:${text}`;
  if (!instance.active || instance.lastDisplay === digest) return;
  instance.lastDisplay = digest;
  send({
    cmd: "state",
    param: {
      statelist: [{
        uuid: instance.uuid,
        actionid: instance.actionid,
        key: instance.key,
        type: 0,
        state,
        showtext: true,
        textdata: text
      }]
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

function setUsageDisplay(instance, usage) {
  const { fiveHour, weekly } = usageRemaining(usage);
  const digest = `usage:${fiveHour ?? "none"}:${weekly ?? "none"}`;
  if (!instance.active || instance.lastDisplay === digest) return;
  instance.lastDisplay = digest;
  send({
    cmd: "state",
    param: {
      statelist: [
        {
          uuid: instance.uuid,
          actionid: instance.actionid,
          key: instance.key,
          type: 1,
          data: usageIconData(usage),
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

function taskMonitorIconData({
  connected = true,
  taskType = "WORK",
  model = "DEFAULT",
  status = "idle",
  currentIndex = 0,
  totalRunning = 0,
  elapsed = ""
}) {
  if (!connected) {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="196" height="196" viewBox="0 0 196 196">
      <defs>
        <linearGradient id="bgOff" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stop-color="#181c20"/>
          <stop offset="100%" stop-color="#0c0e10"/>
        </linearGradient>
      </defs>
      <rect width="196" height="196" rx="22" fill="url(#bgOff)"/>
      <rect x="2" y="2" width="192" height="192" rx="20" fill="none" stroke="#2c333a" stroke-width="2"/>
      <g transform="translate(98, 40)">
        <rect x="-40" y="-13" width="80" height="26" rx="13" fill="#262c33" stroke="#3b444f" stroke-width="1.5"/>
        <text x="0" y="5" text-anchor="middle" font-family="-apple-system,BlinkMacSystemFont,Arial,sans-serif" font-size="11" font-weight="800" fill="#8a96a3" letter-spacing="1.2">BRIDGE</text>
      </g>
      <text x="98" y="104" text-anchor="middle" font-family="-apple-system,BlinkMacSystemFont,Arial,sans-serif" font-size="20" font-weight="800" fill="#606d7b" letter-spacing="0.8">OFFLINE</text>
      <g transform="translate(98, 154)">
        <circle cx="-38" cy="-4" r="4" fill="#ef4444"/>
        <text x="-26" y="0" font-family="-apple-system,BlinkMacSystemFont,Arial,sans-serif" font-size="12" font-weight="700" fill="#ef4444" letter-spacing="0.8">DISCONNECTED</text>
      </g>
    </svg>`;
    return `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
  }

  const isWork = taskType === "WORK";
  const typeBg = isWork ? "#0284c7" : "#6366f1";
  const typeBorder = isWork ? "#38bdf8" : "#818cf8";
  const isRunning = status === "running" || status === "working" || status === "thinking";
  const hasMultiple = totalRunning > 1;

  const modelStr = String(model || "DEFAULT");
  const modelFontSize = modelStr.length > 10 ? "17" : modelStr.length > 8 ? "19" : "22";
  const runningText = elapsed && elapsed !== "0s" ? `RUNNING ${elapsed}` : "RUNNING";

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="196" height="196" viewBox="0 0 196 196">
    <defs>
      <linearGradient id="cardBg" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stop-color="#161b22"/>
        <stop offset="100%" stop-color="#0a0d10"/>
      </linearGradient>
      <filter id="glowGreen" x="-40%" y="-40%" width="180%" height="180%">
        <feGaussianBlur stdDeviation="3" result="blur"/>
        <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
      </filter>
    </defs>
    <rect width="196" height="196" rx="22" fill="url(#cardBg)"/>
    <rect x="2" y="2" width="192" height="192" rx="20" fill="none" stroke="${isRunning ? (isWork ? '#0369a1' : '#4f46e5') : '#21262d'}" stroke-width="2"/>

    <g transform="translate(${hasMultiple ? '66' : '98'}, 38)">
      <rect x="-42" y="-14" width="84" height="28" rx="14" fill="${typeBg}" stroke="${typeBorder}" stroke-width="1.5"/>
      <text x="0" y="5" text-anchor="middle" font-family="-apple-system,BlinkMacSystemFont,Arial,sans-serif" font-size="12" font-weight="900" fill="#ffffff" letter-spacing="1.2">${taskType}</text>
    </g>
    ${hasMultiple ? `
      <g transform="translate(148, 38)">
        <rect x="-24" y="-12" width="48" height="24" rx="12" fill="#1e293b" stroke="#334155" stroke-width="1.2"/>
        <text x="0" y="4" text-anchor="middle" font-family="-apple-system,BlinkMacSystemFont,Arial,sans-serif" font-size="11" font-weight="800" fill="#94a3b8" letter-spacing="0.5">${currentIndex + 1}/${totalRunning}</text>
      </g>
    ` : ""}

    <text x="98" y="80" text-anchor="middle" font-family="-apple-system,BlinkMacSystemFont,Arial,sans-serif" font-size="9" font-weight="800" fill="#64748b" letter-spacing="1.8">AI MODEL</text>
    <text x="98" y="108" text-anchor="middle" font-family="-apple-system,BlinkMacSystemFont,Arial,sans-serif" font-size="${modelFontSize}" font-weight="900" fill="#f8fafc" letter-spacing="0.5">${modelStr}</text>

    <line x1="38" y1="126" x2="158" y2="126" stroke="#21262d" stroke-width="1.2" stroke-dasharray="3 3"/>

    ${isRunning ? `
      <g transform="translate(98, 156)">
        <circle cx="-38" cy="-4" r="5" fill="#22c55e" filter="url(#glowGreen)"/>
        <circle cx="-38" cy="-4" r="3.5" fill="#ffffff"/>
        <text x="-24" y="1" font-family="-apple-system,BlinkMacSystemFont,Arial,sans-serif" font-size="12" font-weight="900" fill="#22c55e" letter-spacing="0.8">${runningText}</text>
      </g>
    ` : `
      <g transform="translate(98, 156)">
        <circle cx="-28" cy="-4" r="3.5" fill="#64748b"/>
        <text x="-16" y="0" font-family="-apple-system,BlinkMacSystemFont,Arial,sans-serif" font-size="11" font-weight="700" fill="#94a3b8" letter-spacing="1">LAST TASK</text>
      </g>
    `}
  </svg>`;
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
}

function setTaskMonitorDisplay(instance) {
  if (!latestState?.connected) {
    const digest = "monitor:offline";
    if (!instance.active || instance.lastDisplay === digest) return;
    instance.lastDisplay = digest;
    currentDisplayedTask = null;
    send({
      cmd: "state",
      param: {
        statelist: [
          {
            uuid: instance.uuid,
            actionid: instance.actionid,
            key: instance.key,
            type: 1,
            data: taskMonitorIconData({ connected: false }),
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
    return;
  }

  const activeTasks = Array.isArray(latestState.activeTasks) ? latestState.activeTasks : [];
  let taskType = "CODEX";
  let model = "DEFAULT";
  let status = "idle";
  let currentIndex = 0;
  let totalRunning = activeTasks.length;
  let targetTask = null;

  if (totalRunning > 0) {
    status = "running";
    if (totalRunning > 1) {
      const now = Date.now();
      if (now - lastTaskMonitorRotation >= 2500) {
        taskMonitorIndex = (taskMonitorIndex + 1) % totalRunning;
        lastTaskMonitorRotation = now;
      }
      currentIndex = taskMonitorIndex % totalRunning;
    } else {
      taskMonitorIndex = 0;
      currentIndex = 0;
    }
    targetTask = activeTasks[currentIndex] || activeTasks[0];
    lastKnownTask = targetTask;
  } else {
    status = "idle";
    taskMonitorIndex = 0;
    currentIndex = 0;
    if (!lastKnownTask) {
      lastKnownTask = latestState.lastTask || latestState.slots?.[0] || null;
    }
    targetTask = lastKnownTask;
  }

  currentDisplayedTask = targetTask;
  taskType = targetTask?.taskType || "CODEX";
  model = targetTask?.model || "DEFAULT";

  const elapsed = targetTask?.threadKey ? formatElapsed(Date.now() - (taskStartTimes.get(targetTask.threadKey) || Date.now())) : "";

  const digest = `monitor:true:${taskType}:${model}:${status}:${currentIndex}:${totalRunning}:${elapsed}`;
  if (!instance.active || instance.lastDisplay === digest) return;
  instance.lastDisplay = digest;

  send({
    cmd: "state",
    param: {
      statelist: [
        {
          uuid: instance.uuid,
          actionid: instance.actionid,
          key: instance.key,
          type: 1,
          data: taskMonitorIconData({
            connected: true,
            taskType,
            model,
            status,
            currentIndex,
            totalRunning,
            elapsed
          }),
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

function getPendingAttentionTasks(slots, activeTasks) {
  const pending = [];
  const seenKeys = new Set();
  const checkItem = (item, slotIndex) => {
    if (!item?.threadKey || seenKeys.has(item.threadKey)) return;
    const st = String(item.status || "").toLowerCase();
    const isAttention = ["attention", "notification", "input", "approval", "waiting_input", "needs_input"].includes(st);
    const isError = ["error", "failed", "failure"].includes(st);
    if (isAttention || isError) {
      seenKeys.add(item.threadKey);
      pending.push({ ...item, slot: slotIndex, isError, isAttention });
    }
  };
  if (Array.isArray(slots)) {
    slots.forEach((s, idx) => checkItem(s, idx));
  }
  if (Array.isArray(activeTasks)) {
    activeTasks.forEach((t) => checkItem(t, t.slot ?? null));
  }
  return pending;
}

function attentionBadgeIconData({ count = 0, hasError = false, connected = true }) {
  if (!connected) {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="196" height="196" viewBox="0 0 196 196">
      <defs>
        <linearGradient id="bgOff" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stop-color="#181c20"/>
          <stop offset="100%" stop-color="#0c0e10"/>
        </linearGradient>
      </defs>
      <rect width="196" height="196" rx="22" fill="url(#bgOff)"/>
      <rect x="2" y="2" width="192" height="192" rx="20" fill="none" stroke="#2c333a" stroke-width="2"/>
      <text x="98" y="90" text-anchor="middle" font-family="-apple-system,BlinkMacSystemFont,Arial,sans-serif" font-size="14" font-weight="800" fill="#8a96a3" letter-spacing="1">ATTENTION</text>
      <text x="98" y="118" text-anchor="middle" font-family="-apple-system,BlinkMacSystemFont,Arial,sans-serif" font-size="12" font-weight="700" fill="#ef4444" letter-spacing="0.8">OFFLINE</text>
    </svg>`;
    return `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
  }

  if (count === 0) {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="196" height="196" viewBox="0 0 196 196">
      <defs>
        <linearGradient id="bgClear" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stop-color="#161b22"/>
          <stop offset="100%" stop-color="#0a0d10"/>
        </linearGradient>
      </defs>
      <rect width="196" height="196" rx="22" fill="url(#bgClear)"/>
      <rect x="2" y="2" width="192" height="192" rx="20" fill="none" stroke="#21262d" stroke-width="2"/>
      <circle cx="98" cy="80" r="32" fill="#0d1117" stroke="#238636" stroke-width="3"/>
      <path d="M86 80l8 8 16-16" fill="none" stroke="#2ea043" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>
      <text x="98" y="136" text-anchor="middle" font-family="-apple-system,BlinkMacSystemFont,Arial,sans-serif" font-size="13" font-weight="800" fill="#3fb950" letter-spacing="1.2">ALL CLEAR</text>
      <text x="98" y="156" text-anchor="middle" font-family="-apple-system,BlinkMacSystemFont,Arial,sans-serif" font-size="10" font-weight="700" fill="#8b949e" letter-spacing="0.8">0 PENDING</text>
    </svg>`;
    return `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
  }

  const primaryColor = hasError ? "#ef4444" : "#f59e0b";
  const labelText = hasError ? "NEEDS ERROR FIX" : "NEEDS INPUT";
  const badgeText = String(count);

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="196" height="196" viewBox="0 0 196 196">
    <defs>
      <linearGradient id="bgAlert" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stop-color="#1c1917"/>
        <stop offset="100%" stop-color="#0c0a09"/>
      </linearGradient>
      <filter id="glowAlert" x="-40%" y="-40%" width="180%" height="180%">
        <feGaussianBlur stdDeviation="4" result="blur"/>
        <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
      </filter>
    </defs>
    <rect width="196" height="196" rx="22" fill="url(#bgAlert)"/>
    <rect x="2" y="2" width="192" height="192" rx="20" fill="none" stroke="${primaryColor}" stroke-width="2.5" filter="url(#glowAlert)"/>
    <circle cx="98" cy="74" r="34" fill="#292524" stroke="${primaryColor}" stroke-width="3.5" filter="url(#glowAlert)"/>
    <text x="98" y="85" text-anchor="middle" font-family="-apple-system,BlinkMacSystemFont,Arial,sans-serif" font-size="30" font-weight="900" fill="${primaryColor}">${badgeText}</text>
    <text x="98" y="134" text-anchor="middle" font-family="-apple-system,BlinkMacSystemFont,Arial,sans-serif" font-size="12" font-weight="900" fill="${primaryColor}" letter-spacing="1">${labelText}</text>
    <text x="98" y="156" text-anchor="middle" font-family="-apple-system,BlinkMacSystemFont,Arial,sans-serif" font-size="10" font-weight="700" fill="#a8a29e" letter-spacing="0.6">PRESS TO JUMP</text>
  </svg>`;
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
}

function setAttentionDisplay(instance) {
  if (!latestState?.connected) {
    const digest = "attention:offline";
    if (!instance.active || instance.lastDisplay === digest) return;
    instance.lastDisplay = digest;
    send({
      cmd: "state",
      param: {
        statelist: [{
          uuid: instance.uuid,
          actionid: instance.actionid,
          key: instance.key,
          type: 1,
          data: attentionBadgeIconData({ connected: false }),
          showtext: false,
          textdata: ""
        }, {
          uuid: instance.uuid,
          actionid: instance.actionid,
          key: instance.key,
          type: 0,
          state: 0,
          showtext: false,
          textdata: ""
        }]
      }
    });
    return;
  }
  const pending = getPendingAttentionTasks(latestState.slots, latestState.activeTasks);
  const count = pending.length;
  const hasError = pending.some((p) => p.isError);
  const digest = `attention:${count}:${hasError}`;
  if (!instance.active || instance.lastDisplay === digest) return;
  instance.lastDisplay = digest;

  send({
    cmd: "state",
    param: {
      statelist: [{
        uuid: instance.uuid,
        actionid: instance.actionid,
        key: instance.key,
        type: 1,
        data: attentionBadgeIconData({ count, hasError, connected: true }),
        showtext: false,
        textdata: ""
      }, {
        uuid: instance.uuid,
        actionid: instance.actionid,
        key: instance.key,
        type: 0,
        state: 0,
        showtext: false,
        textdata: ""
      }]
    }
  });
}

function approveIconData({ connected = true }) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="196" height="196" viewBox="0 0 196 196">
    <defs>
      <linearGradient id="bgApprove" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stop-color="#14532d"/>
        <stop offset="100%" stop-color="#052e16"/>
      </linearGradient>
      <filter id="glowGreen" x="-40%" y="-40%" width="180%" height="180%">
        <feGaussianBlur stdDeviation="3.5" result="blur"/>
        <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
      </filter>
    </defs>
    <rect width="196" height="196" rx="22" fill="url(#bgApprove)"/>
    <rect x="2" y="2" width="192" height="192" rx="20" fill="none" stroke="#22c55e" stroke-width="2"/>
    <circle cx="98" cy="74" r="32" fill="#166534" stroke="#4ade80" stroke-width="3" filter="url(#glowGreen)"/>
    <path d="M84 74l10 10 20-20" fill="none" stroke="#ffffff" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/>
    <text x="98" y="136" text-anchor="middle" font-family="-apple-system,BlinkMacSystemFont,Arial,sans-serif" font-size="15" font-weight="900" fill="#4ade80" letter-spacing="1.5">APPROVE</text>
    <text x="98" y="156" text-anchor="middle" font-family="-apple-system,BlinkMacSystemFont,Arial,sans-serif" font-size="10" font-weight="700" fill="#86efac" letter-spacing="0.8">EXECUTE / RUN</text>
  </svg>`;
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
}

function rejectIconData({ connected = true }) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="196" height="196" viewBox="0 0 196 196">
    <defs>
      <linearGradient id="bgReject" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stop-color="#7f1d1d"/>
        <stop offset="100%" stop-color="#450a0a"/>
      </linearGradient>
      <filter id="glowRed" x="-40%" y="-40%" width="180%" height="180%">
        <feGaussianBlur stdDeviation="3.5" result="blur"/>
        <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
      </filter>
    </defs>
    <rect width="196" height="196" rx="22" fill="url(#bgReject)"/>
    <rect x="2" y="2" width="192" height="192" rx="20" fill="none" stroke="#ef4444" stroke-width="2"/>
    <circle cx="98" cy="74" r="32" fill="#991b1b" stroke="#f87171" stroke-width="3" filter="url(#glowRed)"/>
    <path d="M86 62l24 24M110 62l-24 24" fill="none" stroke="#ffffff" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/>
    <text x="98" y="136" text-anchor="middle" font-family="-apple-system,BlinkMacSystemFont,Arial,sans-serif" font-size="15" font-weight="900" fill="#f87171" letter-spacing="1.5">DENY</text>
    <text x="98" y="156" text-anchor="middle" font-family="-apple-system,BlinkMacSystemFont,Arial,sans-serif" font-size="10" font-weight="700" fill="#fca5a5" letter-spacing="0.8">CANCEL / REJECT</text>
  </svg>`;
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
}

function setApproveDisplay(instance) {
  const digest = `approve:${latestState?.connected}`;
  if (!instance.active || instance.lastDisplay === digest) return;
  instance.lastDisplay = digest;
  send({
    cmd: "state",
    param: {
      statelist: [{
        uuid: instance.uuid,
        actionid: instance.actionid,
        key: instance.key,
        type: 1,
        data: approveIconData({ connected: Boolean(latestState?.connected) }),
        showtext: false,
        textdata: ""
      }, {
        uuid: instance.uuid,
        actionid: instance.actionid,
        key: instance.key,
        type: 0,
        state: 0,
        showtext: false,
        textdata: ""
      }]
    }
  });
}

function setRejectDisplay(instance) {
  const digest = `reject:${latestState?.connected}`;
  if (!instance.active || instance.lastDisplay === digest) return;
  instance.lastDisplay = digest;
  send({
    cmd: "state",
    param: {
      statelist: [{
        uuid: instance.uuid,
        actionid: instance.actionid,
        key: instance.key,
        type: 1,
        data: rejectIconData({ connected: Boolean(latestState?.connected) }),
        showtext: false,
        textdata: ""
      }, {
        uuid: instance.uuid,
        actionid: instance.actionid,
        key: instance.key,
        type: 0,
        state: 0,
        showtext: false,
        textdata: ""
      }]
    }
  });
}

function formatTokenCount(num) {
  if (num === null || num === undefined || !Number.isFinite(num)) return "0";
  if (num >= 1000000) {
    return `${(num / 1000000).toFixed(2)}M`;
  }
  if (num >= 10000) {
    return `${Math.round(num / 1000)}k`;
  }
  if (num >= 1000) {
    return `${(num / 1000).toFixed(1)}k`;
  }
  return String(num);
}

function tokensIconData(tokenUsage, connected = true) {
  if (!connected) {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="196" height="196" viewBox="0 0 196 196">
      <defs>
        <linearGradient id="bgOff" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stop-color="#181c20"/>
          <stop offset="100%" stop-color="#0c0e10"/>
        </linearGradient>
      </defs>
      <rect width="196" height="196" rx="22" fill="url(#bgOff)"/>
      <rect x="2" y="2" width="192" height="192" rx="20" fill="none" stroke="#2c333a" stroke-width="2"/>
      <text x="98" y="90" text-anchor="middle" font-family="-apple-system,BlinkMacSystemFont,Arial,sans-serif" font-size="14" font-weight="800" fill="#8a96a3" letter-spacing="1">TOKENS</text>
      <text x="98" y="118" text-anchor="middle" font-family="-apple-system,BlinkMacSystemFont,Arial,sans-serif" font-size="12" font-weight="700" fill="#ef4444" letter-spacing="0.8">OFFLINE</text>
    </svg>`;
    return `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
  }

  const total = tokenUsage?.total?.totalTokens ?? 0;
  const last = tokenUsage?.last?.totalTokens ?? 0;
  const contextWindow = tokenUsage?.modelContextWindow || 200000;
  const pct = Math.min(100, Math.round((total / contextWindow) * 100));

  const totalStr = formatTokenCount(total);
  const lastStr = last > 0 ? `+${formatTokenCount(last)}` : "—";
  const pctColor = pct > 80 ? "#ef4444" : pct > 50 ? "#f59e0b" : "#3b82f6";
  const barWidth = Math.max(4, Math.round((pct / 100) * 128));

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="196" height="196" viewBox="0 0 196 196">
    <defs>
      <linearGradient id="bgTokens" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stop-color="#161b22"/>
        <stop offset="100%" stop-color="#0a0d10"/>
      </linearGradient>
    </defs>
    <rect width="196" height="196" rx="22" fill="url(#bgTokens)"/>
    <rect x="2" y="2" width="192" height="192" rx="20" fill="none" stroke="#21262d" stroke-width="2"/>

    <g transform="translate(98, 36)">
      <rect x="-38" y="-13" width="76" height="26" rx="13" fill="#1e293b" stroke="#334155" stroke-width="1.2"/>
      <text x="0" y="5" text-anchor="middle" font-family="-apple-system,BlinkMacSystemFont,Arial,sans-serif" font-size="11" font-weight="800" fill="#94a3b8" letter-spacing="1">TOKENS</text>
    </g>

    <text x="98" y="96" text-anchor="middle" font-family="-apple-system,BlinkMacSystemFont,Arial,sans-serif" font-size="30" font-weight="900" fill="#f8fafc" letter-spacing="0.5">${totalStr}</text>
    <text x="98" y="122" text-anchor="middle" font-family="-apple-system,BlinkMacSystemFont,Arial,sans-serif" font-size="12" font-weight="700" fill="#64748b" letter-spacing="0.8">LAST: <tspan fill="#38bdf8" font-weight="800">${lastStr}</tspan></text>

    <!-- Context Window Bar -->
    <g transform="translate(34, 142)">
      <rect x="0" y="0" width="128" height="8" rx="4" fill="#21262d"/>
      <rect x="0" y="0" width="${barWidth}" height="8" rx="4" fill="${pctColor}"/>
    </g>
    <text x="98" y="168" text-anchor="middle" font-family="-apple-system,BlinkMacSystemFont,Arial,sans-serif" font-size="11" font-weight="800" fill="${pctColor}" letter-spacing="0.6">${pct}% CONTEXT</text>
  </svg>`;
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
}

function reasoningIconData(effort, connected = true) {
  if (!connected) {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="196" height="196" viewBox="0 0 196 196">
      <defs>
        <linearGradient id="bgOff" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stop-color="#181c20"/>
          <stop offset="100%" stop-color="#0c0e10"/>
        </linearGradient>
      </defs>
      <rect width="196" height="196" rx="22" fill="url(#bgOff)"/>
      <rect x="2" y="2" width="192" height="192" rx="20" fill="none" stroke="#2c333a" stroke-width="2"/>
      <text x="98" y="90" text-anchor="middle" font-family="-apple-system,BlinkMacSystemFont,Arial,sans-serif" font-size="14" font-weight="800" fill="#8a96a3" letter-spacing="1">THINK</text>
      <text x="98" y="118" text-anchor="middle" font-family="-apple-system,BlinkMacSystemFont,Arial,sans-serif" font-size="12" font-weight="700" fill="#ef4444" letter-spacing="0.8">OFFLINE</text>
    </svg>`;
    return `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
  }

  const effortStr = String(effort || "medium").toLowerCase();
  const isHigh = effortStr === "high";
  const isMed = effortStr === "medium" || effortStr === "med";
  const isLow = effortStr === "low";

  const levelText = isHigh ? "HIGH" : isLow ? "LOW" : "MEDIUM";
  const activeCol = isHigh ? "#ec4899" : isLow ? "#06b6d4" : "#8b5cf6";
  const activeLevel = isHigh ? 3 : isLow ? 1 : 2;

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="196" height="196" viewBox="0 0 196 196">
    <defs>
      <linearGradient id="bgThink" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stop-color="#161b22"/>
        <stop offset="100%" stop-color="#0a0d10"/>
      </linearGradient>
      <filter id="glowEffort" x="-30%" y="-30%" width="160%" height="160%">
        <feGaussianBlur stdDeviation="3" result="blur"/>
        <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
      </filter>
    </defs>
    <rect width="196" height="196" rx="22" fill="url(#bgThink)"/>
    <rect x="2" y="2" width="192" height="192" rx="20" fill="none" stroke="#21262d" stroke-width="2"/>

    <g transform="translate(98, 36)">
      <rect x="-42" y="-13" width="84" height="26" rx="13" fill="#1e1b4b" stroke="#3730a3" stroke-width="1.2"/>
      <text x="0" y="5" text-anchor="middle" font-family="-apple-system,BlinkMacSystemFont,Arial,sans-serif" font-size="11" font-weight="800" fill="#a5b4fc" letter-spacing="1.2">THINKING</text>
    </g>

    <!-- 3 Level Indicator Bars -->
    <g transform="translate(68, 62)">
      <rect x="0" y="${28 - 10}" width="16" height="10" rx="3" fill="${activeLevel >= 1 ? '#06b6d4' : '#1e293b'}" ${activeLevel >= 1 ? 'filter="url(#glowEffort)"' : ''}/>
      <rect x="22" y="${28 - 18}" width="16" height="18" rx="3" fill="${activeLevel >= 2 ? '#8b5cf6' : '#1e293b'}" ${activeLevel >= 2 ? 'filter="url(#glowEffort)"' : ''}/>
      <rect x="44" y="${28 - 28}" width="16" height="28" rx="3" fill="${activeLevel >= 3 ? '#ec4899' : '#1e293b'}" ${activeLevel >= 3 ? 'filter="url(#glowEffort)"' : ''}/>
    </g>

    <text x="98" y="126" text-anchor="middle" font-family="-apple-system,BlinkMacSystemFont,Arial,sans-serif" font-size="22" font-weight="900" fill="${activeCol}" letter-spacing="1">${levelText}</text>
    <text x="98" y="156" text-anchor="middle" font-family="-apple-system,BlinkMacSystemFont,Arial,sans-serif" font-size="10" font-weight="700" fill="#64748b" letter-spacing="0.8">PRESS TO CYCLE</text>
  </svg>`;
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
}

function stopIconData({ connected = true, isRunning = false }) {
  if (!connected) {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="196" height="196" viewBox="0 0 196 196">
      <defs>
        <linearGradient id="bgOff" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stop-color="#181c20"/>
          <stop offset="100%" stop-color="#0c0e10"/>
        </linearGradient>
      </defs>
      <rect width="196" height="196" rx="22" fill="url(#bgOff)"/>
      <rect x="2" y="2" width="192" height="192" rx="20" fill="none" stroke="#2c333a" stroke-width="2"/>
      <text x="98" y="90" text-anchor="middle" font-family="-apple-system,BlinkMacSystemFont,Arial,sans-serif" font-size="14" font-weight="800" fill="#8a96a3" letter-spacing="1">STOP</text>
      <text x="98" y="118" text-anchor="middle" font-family="-apple-system,BlinkMacSystemFont,Arial,sans-serif" font-size="12" font-weight="700" fill="#ef4444" letter-spacing="0.8">OFFLINE</text>
    </svg>`;
    return `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
  }

  const borderCol = isRunning ? "#ef4444" : "#450a0a";
  const btnCol = isRunning ? "#dc2626" : "#7f1d1d";
  const subText = isRunning ? "CANCEL TURN" : "READY";
  const subCol = isRunning ? "#fca5a5" : "#78716c";

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="196" height="196" viewBox="0 0 196 196">
    <defs>
      <linearGradient id="bgStop" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stop-color="${isRunning ? '#450a0a' : '#1c1917'}"/>
        <stop offset="100%" stop-color="#0c0a09"/>
      </linearGradient>
      <filter id="glowStop" x="-40%" y="-40%" width="180%" height="180%">
        <feGaussianBlur stdDeviation="${isRunning ? 4 : 2}" result="blur"/>
        <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
      </filter>
    </defs>
    <rect width="196" height="196" rx="22" fill="url(#bgStop)"/>
    <rect x="2" y="2" width="192" height="192" rx="20" fill="none" stroke="${borderCol}" stroke-width="${isRunning ? 3 : 2}" ${isRunning ? 'filter="url(#glowStop)"' : ''}/>

    <!-- Stop Button Circle with Center Square -->
    <circle cx="98" cy="74" r="32" fill="${btnCol}" stroke="#f87171" stroke-width="3" filter="url(#glowStop)"/>
    <rect x="84" y="60" width="28" height="28" rx="5" fill="#ffffff"/>

    <text x="98" y="136" text-anchor="middle" font-family="-apple-system,BlinkMacSystemFont,Arial,sans-serif" font-size="18" font-weight="900" fill="#ffffff" letter-spacing="2">STOP</text>
    <text x="98" y="158" text-anchor="middle" font-family="-apple-system,BlinkMacSystemFont,Arial,sans-serif" font-size="10" font-weight="800" fill="${subCol}" letter-spacing="0.8">${subText}</text>
  </svg>`;
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
}

function promptIconData(type, connected = true) {
  if (!connected) {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="196" height="196" viewBox="0 0 196 196">
      <defs>
        <linearGradient id="bgOff" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stop-color="#181c20"/>
          <stop offset="100%" stop-color="#0c0e10"/>
        </linearGradient>
      </defs>
      <rect width="196" height="196" rx="22" fill="url(#bgOff)"/>
      <rect x="2" y="2" width="192" height="192" rx="20" fill="none" stroke="#2c333a" stroke-width="2"/>
      <text x="98" y="90" text-anchor="middle" font-family="-apple-system,BlinkMacSystemFont,Arial,sans-serif" font-size="14" font-weight="800" fill="#8a96a3" letter-spacing="1">PROMPT</text>
      <text x="98" y="118" text-anchor="middle" font-family="-apple-system,BlinkMacSystemFont,Arial,sans-serif" font-size="12" font-weight="700" fill="#ef4444" letter-spacing="0.8">OFFLINE</text>
    </svg>`;
    return `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
  }

  let title = "PROMPT";
  let sub = "1-TOUCH";
  let col = "#10b981";
  let iconPath = "";

  if (type === "prompt_test") {
    title = "TEST & FIX";
    sub = "AUTO TEST";
    col = "#10b981";
    iconPath = `<path d="M90 60h16M98 60v12l-14 20h28l-14-20" fill="none" stroke="${col}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>
                <path d="M88 84l6 6 14-14" fill="none" stroke="#ffffff" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"/>`;
  } else if (type === "prompt_review") {
    title = "REVIEW";
    sub = "CODE & BUGS";
    col = "#a855f7";
    iconPath = `<circle cx="94" cy="74" r="14" fill="none" stroke="${col}" stroke-width="3.5"/>
                <path d="M104 84l12 12" stroke="${col}" stroke-width="3.5" stroke-linecap="round"/>
                <path d="M90 74h8M94 70v8" stroke="#ffffff" stroke-width="2.5" stroke-linecap="round"/>`;
  } else if (type === "prompt_commit") {
    title = "COMMIT";
    sub = "SEMANTIC MSG";
    col = "#0ea5e9";
    iconPath = `<circle cx="98" cy="74" r="10" fill="${col}" stroke="#ffffff" stroke-width="3"/>
                <line x1="72" y1="74" x2="88" y2="74" stroke="${col}" stroke-width="3.5" stroke-linecap="round"/>
                <line x1="108" y1="74" x2="124" y2="74" stroke="${col}" stroke-width="3.5" stroke-linecap="round"/>`;
  }

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="196" height="196" viewBox="0 0 196 196">
    <defs>
      <linearGradient id="bgPrompt" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stop-color="#161b22"/>
        <stop offset="100%" stop-color="#0a0d10"/>
      </linearGradient>
      <filter id="glowCol" x="-30%" y="-30%" width="160%" height="160%">
        <feGaussianBlur stdDeviation="3" result="blur"/>
        <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
      </filter>
    </defs>
    <rect width="196" height="196" rx="22" fill="url(#bgPrompt)"/>
    <rect x="2" y="2" width="192" height="192" rx="20" fill="none" stroke="#21262d" stroke-width="2"/>

    <g transform="translate(98, 36)">
      <rect x="-42" y="-13" width="84" height="26" rx="13" fill="#1e293b" stroke="${col}" stroke-width="1.2"/>
      <text x="0" y="5" text-anchor="middle" font-family="-apple-system,BlinkMacSystemFont,Arial,sans-serif" font-size="11" font-weight="900" fill="${col}" letter-spacing="1.2">QUICK</text>
    </g>

    <g filter="url(#glowCol)">
      ${iconPath}
    </g>

    <text x="98" y="136" text-anchor="middle" font-family="-apple-system,BlinkMacSystemFont,Arial,sans-serif" font-size="16" font-weight="900" fill="#ffffff" letter-spacing="1">${title}</text>
    <text x="98" y="158" text-anchor="middle" font-family="-apple-system,BlinkMacSystemFont,Arial,sans-serif" font-size="10" font-weight="800" fill="#94a3b8" letter-spacing="0.8">${sub}</text>
  </svg>`;
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
}

function setTokensDisplay(instance) {
  const connected = Boolean(latestState?.connected);
  const tokenUsage = latestState?.tokenUsage || null;
  const total = tokenUsage?.total?.totalTokens ?? 0;
  const last = tokenUsage?.last?.totalTokens ?? 0;
  const digest = `tokens:${connected}:${total}:${last}`;
  if (!instance.active || instance.lastDisplay === digest) return;
  instance.lastDisplay = digest;
  send({
    cmd: "state",
    param: {
      statelist: [
        {
          uuid: instance.uuid,
          actionid: instance.actionid,
          key: instance.key,
          type: 1,
          data: tokensIconData(tokenUsage, connected),
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

function setReasoningDisplay(instance) {
  const connected = Boolean(latestState?.connected);
  const effort = latestState?.reasoningEffort || null;
  const digest = `reasoning:${connected}:${effort}`;
  if (!instance.active || instance.lastDisplay === digest) return;
  instance.lastDisplay = digest;
  send({
    cmd: "state",
    param: {
      statelist: [
        {
          uuid: instance.uuid,
          actionid: instance.actionid,
          key: instance.key,
          type: 1,
          data: reasoningIconData(effort, connected),
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

function setStopDisplay(instance) {
  const connected = Boolean(latestState?.connected);
  const isRunning = (latestState?.activeTasks || []).length > 0;
  const digest = `stop:${connected}:${isRunning}`;
  if (!instance.active || instance.lastDisplay === digest) return;
  instance.lastDisplay = digest;
  send({
    cmd: "state",
    param: {
      statelist: [
        {
          uuid: instance.uuid,
          actionid: instance.actionid,
          key: instance.key,
          type: 1,
          data: stopIconData({ connected, isRunning }),
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

function setPromptDisplay(instance, type) {
  const connected = Boolean(latestState?.connected);
  const digest = `prompt:${type}:${connected}`;
  if (!instance.active || instance.lastDisplay === digest) return;
  instance.lastDisplay = digest;
  send({
    cmd: "state",
    param: {
      statelist: [
        {
          uuid: instance.uuid,
          actionid: instance.actionid,
          key: instance.key,
          type: 1,
          data: promptIconData(type, connected),
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

function renderInstance(instance) {
  const slot = taskSlot(instance.uuid);
  if (slot === null) {
    const action = actionName(instance.uuid);
    if (action === "usage") {
      setUsageDisplay(instance, latestState?.connected ? latestState.usage : null);
      return;
    }
    if (action === "taskmonitor") {
      setTaskMonitorDisplay(instance);
      return;
    }
    if (action === "attention") {
      setAttentionDisplay(instance);
      return;
    }
    if (action === "approve") {
      setApproveDisplay(instance);
      return;
    }
    if (action === "reject") {
      setRejectDisplay(instance);
      return;
    }
    if (action === "tokens") {
      setTokensDisplay(instance);
      return;
    }
    if (action === "reasoning") {
      setReasoningDisplay(instance);
      return;
    }
    if (action === "stop") {
      setStopDisplay(instance);
      return;
    }
    if (action === "prompt_test" || action === "prompt_review" || action === "prompt_commit") {
      setPromptDisplay(instance, action);
      return;
    }
    if (!latestState?.connected) {
      if (action === "navigate") {
        setTaskDisplay(instance, TASK_ICON_PATHS.idle, "Bridge Offline");
      } else {
        setDisplay(instance, 0, "Bridge Offline");
      }
      return;
    }
    if (action === "navigate") {
      const task = latestState.slots?.[0];
      if (!task?.threadKey) {
        setTaskDisplay(instance, TASK_ICON_PATHS.idle, "Latest Task");
        return;
      }
      setTaskDisplay(instance, taskIconPath(task.status), shortTitle(task.title));
      return;
    }
    setDisplay(instance, 0, ACTION_LABELS[action] || "CODEX");
    return;
  }
  if (!latestState?.connected) {
    setTaskDisplay(instance, TASK_ICON_PATHS.idle, "Bridge Offline");
    return;
  }
  const task = latestState.slots?.[slot];
  if (!task?.threadKey) {
    setTaskDisplay(instance, TASK_ICON_PATHS.idle, `Task ${slot + 1}`);
    return;
  }
  setTaskDisplay(instance, taskIconPath(task.status), shortTitle(task.title));
}

function renderAll() {
  for (const instance of instances.values()) renderInstance(instance);
}

async function bridgeRequest(path, method = "GET", body = null) {
  const options = {
    method,
    signal: AbortSignal.timeout(1200)
  };
  if (body) {
    options.headers = { "Content-Type": "application/json" };
    options.body = JSON.stringify(body);
  }
  const response = await fetch(`${BRIDGE_URL}${path}`, options);
  const payload = await response.json();
  if (!response.ok || payload.ok === false) {
    throw new Error(payload.error || `Bridge HTTP ${response.status}`);
  }
  return payload;
}

async function openTaskSlot(slot) {
  const task = latestState?.slots?.[slot];
  if (!task?.threadKey) throw new Error(`Codex task slot ${slot + 1} is empty`);
  await bridgeRequest(`/thread/${encodeURIComponent(task.threadKey)}/click?slot=${slot}`, "POST");
}

async function pollBridge() {
  if (pollInFlight) return;
  pollInFlight = true;
  try {
    latestState = await bridgeRequest("/state");
    updateTaskRunningTimes(latestState?.slots, latestState?.activeTasks);
  } catch (error) {
    latestState = { connected: false, error: error.message, slots: [] };
  } finally {
    pollInFlight = false;
    renderAll();
  }
}

async function invoke(instance, pressed) {
  const slot = taskSlot(instance.uuid);
  try {
    if (slot !== null) {
      if (!pressed) return;
      await openTaskSlot(slot);
      return;
    }
    const action = actionName(instance.uuid);
    if (!action) throw new Error(`Unknown Codex action: ${instance.uuid}`);
    if (action === "usage") {
      if (pressed) await bridgeRequest("/focus", "POST");
      return;
    }
    if (action === "tokens") {
      if (pressed) await bridgeRequest("/focus", "POST");
      return;
    }
    if (action === "reasoning") {
      if (pressed) {
        await bridgeRequest("/action/reasoning/down", "POST");
        await bridgeRequest("/focus", "POST").catch(() => {});
      }
      return;
    }
    if (action === "stop") {
      if (pressed) {
        await bridgeRequest("/action/stop/down", "POST");
        await bridgeRequest("/focus", "POST").catch(() => {});
      }
      return;
    }
    if (action === "prompt_test") {
      if (pressed) {
        await bridgeRequest("/prompt", "POST", {
          text: "Execute os testes do projeto e corrija qualquer erro ou falha encontrada."
        });
      }
      return;
    }
    if (action === "prompt_review") {
      if (pressed) {
        await bridgeRequest("/prompt", "POST", {
          text: "Analise as alterações recentes (git diff), aponte possíveis bugs, vulnerabilidades de segurança e melhorias de performance."
        });
      }
      return;
    }
    if (action === "prompt_commit") {
      if (pressed) {
        await bridgeRequest("/prompt", "POST", {
          text: "Gere uma mensagem de commit semântica e profissional (Conventional Commits) para as alterações pendentes."
        });
      }
      return;
    }
    if (action === "taskmonitor") {
      if (!pressed) return;
      const targetThreadKey = currentDisplayedTask?.threadKey || latestState?.activeThreadKey;
      if (targetThreadKey) {
        await Promise.all([
          bridgeRequest(`/thread/${encodeURIComponent(targetThreadKey)}/click?slot=0`, "POST"),
          bridgeRequest("/focus", "POST")
        ]);
      } else {
        await bridgeRequest("/focus", "POST");
      }
      return;
    }
    if (action === "attention") {
      if (!pressed) return;
      const pending = getPendingAttentionTasks(latestState?.slots, latestState?.activeTasks);
      if (pending.length > 0) {
        const target = pending[0];
        if (target.threadKey) {
          await bridgeRequest(`/thread/${encodeURIComponent(target.threadKey)}/click?slot=${target.slot ?? 0}`, "POST");
        }
      }
      await bridgeRequest("/focus", "POST");
      return;
    }
    if (action === "approve" || action === "reject") {
      await bridgeRequest(`/action/${action}/${pressed ? "down" : "up"}`, "POST");
      if (pressed) {
        await bridgeRequest("/focus", "POST").catch(() => {});
      }
      return;
    }
    await bridgeRequest(`/action/${action}/${pressed ? "down" : "up"}`, "POST");
  } catch (error) {
    send({ cmd: "logMessage", uuid: instance.uuid, actionid: instance.actionid, key: instance.key, level: "error", message: error.message });
    send({ cmd: "showAlert", uuid: instance.uuid, actionid: instance.actionid, key: instance.key });
  }
}

async function invokeEncoder(instance, message) {
  try {
    if (message.cmd === "dialdown") {
      await openTaskSlot(0);
      return;
    }
    if (message.cmd !== "dialrotate") return;
    const keylist = {
      left: "SCROLL UP",
      "hold-left": "SCROLL UP",
      right: "SCROLL DOWN",
      "hold-right": "SCROLL DOWN"
    }[message.rotateEvent];
    if (keylist) send({ cmd: "hotkey", keylist });
  } catch (error) {
    send({ cmd: "logMessage", uuid: instance.uuid, actionid: instance.actionid, key: instance.key, level: "error", message: error.message });
    send({ cmd: "showAlert", uuid: instance.uuid, actionid: instance.actionid, key: instance.key });
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
    for (const item of message.param || []) instances.delete(contextOf(item));
    ack(message);
    return;
  }
  if (message.cmd === "sendToPlugin") {
    ack(message);
    if (message.payload?.type === "bridgeSetup") {
      void handleBridgeSetupMessage(message);
    }
    return;
  }
  if (message.cmd === "run") {
    ack(message);
    return;
  }
  if (["dialdown", "dialup", "dialrotate"].includes(message.cmd)) {
    const instance = instances.get(contextOf(message)) || addInstance(message);
    if (actionName(instance.uuid) === "navigate") void invokeEncoder(instance, message);
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
    pollTimer = setInterval(() => void pollBridge(), 500);
    pollTimer.unref();
    void pollBridge();
  });
  socket.on("message", handleMessage);
  socket.on("close", () => {
    clearInterval(pollTimer);
    reconnectTimer = setTimeout(connect, 1000);
    reconnectTimer.unref();
  });
  socket.on("error", (err) => { console.error("WS error:", err); socket.close(); });
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
