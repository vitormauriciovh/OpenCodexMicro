import { textCard, usageCard } from "../../../src/shared/deck-cards.mjs";
import { encoderTicks, invalidateDisplays, reportActionError, bridgeFeed, inspectorReply } from "../../../src/shared/plugin-runtime.mjs";
import { localClient } from "../../../src/shared/local-api.mjs";
import WebSocket from "ws";
import { dirname, resolve } from "node:path";

const PLUGIN_UUID = "com.ulanzi.ulanzistudio.codexcli";
const BRIDGE_URL = process.env.CODEX_CLI_BRIDGE_URL || "http://127.0.0.1:17376";
const requestLocal = localClient("codex-cli", BRIDGE_URL);
const [address = "127.0.0.1", port = "3906"] = process.argv.slice(2);
const HOST_URL = `ws://${address}:${port}`;
const instances = new Map();

const ACTION_LABELS = Object.freeze({
  task1: "SESSION 1",
  task2: "SESSION 2",
  task3: "SESSION 3",
  task4: "SESSION 4",
  task5: "SESSION 5",
  task6: "SESSION 6", navigate: "TASKS", goal: "GOAL", subagents: "AGENTS", plan: "PLAN",
  approve: "APPROVE",
  reject: "REJECT",
  status: "STATUS",
  tokens: "TOKENS",
  queue: "CONTINUE",
  resume: "RESUME",
  new: "NEW TASK", fork: "FORK", stop: "STOP", attention: "ATTENTION",
  submit: "SUBMIT", steer: "STEER", taskmonitor: "MONITOR",
  prompt_test: "TEST", prompt_review: "REVIEW", prompt_commit: "COMMIT MSG",
  usage: "USAGE", usage5h: "5H USAGE", usageweekly: "WEEKLY",
  model: "MODEL", reasoning: "REASONING", fast: "FAST"
});

function escapeXml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function shortTitle(value) {
  const title = String(value || "Untitled").replace(/\s+/g, " ").trim();
  return title.length > 18 ? `${title.slice(0, 17)}…` : title;
}

function formatElapsed(sec) {
  if (!sec || sec < 0) return "";
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m`;
  const hr = Math.floor(min / 60);
  return `${hr}h ${min % 60}m`;
}

function formatTokenCount(num) {
  if (num == null) return "—";
  if (!num || num <= 0) return "0";
  if (num >= 1_000_000) return `${(num / 1_000_000).toFixed(1)}M`;
  if (num >= 1_000) return `${(num / 1_000).toFixed(1)}k`;
  return String(num);
}

function sessionCardIconData({
  headerLeft = "CLI",
  headerRight = "Session",
  title = "Untitled",
  status = "idle",
  elapsed = "",
  model = "Codex CLI",
  connected = true,
  empty = false
}) {
  if (!connected) {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="196" height="196" viewBox="0 0 196 196">
      <rect width="196" height="196" rx="24" fill="#0f1115"/>
      <rect x="2" y="2" width="192" height="192" rx="22" fill="none" stroke="#22272e" stroke-width="2"/>
      <g transform="translate(18, 30)">
        <text x="0" y="0" font-family="-apple-system,BlinkMacSystemFont,Arial,sans-serif" font-size="12" font-weight="900" fill="#64748b" letter-spacing="1">${escapeXml(headerLeft)}</text>
        <text x="160" y="0" text-anchor="end" font-family="-apple-system,BlinkMacSystemFont,Arial,sans-serif" font-size="12" font-weight="700" fill="#475569">${escapeXml(headerRight)}</text>
      </g>
      <circle cx="98" cy="98" r="28" fill="#1e232a"/>
      <text x="98" y="106" text-anchor="middle" font-family="-apple-system,BlinkMacSystemFont,Arial,sans-serif" font-size="24" font-weight="900" fill="#64748b">—</text>
      <text x="98" y="162" text-anchor="middle" font-family="-apple-system,BlinkMacSystemFont,Arial,sans-serif" font-size="12" font-weight="800" fill="#ef4444" letter-spacing="0.8">OFFLINE</text>
    </svg>`;
    return `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
  }

  if (empty) {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="196" height="196" viewBox="0 0 196 196">
      <rect width="196" height="196" rx="24" fill="#0f1115"/>
      <rect x="2" y="2" width="192" height="192" rx="22" fill="none" stroke="#22272e" stroke-width="2"/>
      <g transform="translate(18, 30)">
        <text x="0" y="0" font-family="-apple-system,BlinkMacSystemFont,Arial,sans-serif" font-size="12" font-weight="900" fill="#38bdf8" letter-spacing="1">${escapeXml(headerLeft)}</text>
        <text x="160" y="0" text-anchor="end" font-family="-apple-system,BlinkMacSystemFont,Arial,sans-serif" font-size="12" font-weight="700" fill="#64748b">${escapeXml(headerRight)}</text>
      </g>
      <text x="98" y="106" text-anchor="middle" font-family="-apple-system,BlinkMacSystemFont,Arial,sans-serif" font-size="14" font-weight="700" fill="#475569">EMPTY SLOT</text>
    </svg>`;
    return `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
  }

  const st = String(status || "").toUpperCase();
  const isWorking = st === "WORKING" || st === "RUNNING";
  const isAttention = st === "ATTENTION" || st === "WAITING";
  
  let badgeColor = "#334155";
  let badgeBg = "#1e293b";
  let textColor = "#94a3b8";

  if (isWorking) {
    badgeColor = "#38bdf8";
    badgeBg = "#0c4a6e";
    textColor = "#38bdf8";
  } else if (isAttention) {
    badgeColor = "#f59e0b";
    badgeBg = "#451a03";
    textColor = "#f59e0b";
  } else if (st === "COMPLETED") {
    badgeColor = "#10b981";
    badgeBg = "#064e3b";
    textColor = "#34d49a";
  }

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="196" height="196" viewBox="0 0 196 196">
    <rect width="196" height="196" rx="24" fill="#0d1117"/>
    <rect x="2" y="2" width="192" height="192" rx="22" fill="none" stroke="${badgeColor}" stroke-width="2"/>
    <g transform="translate(18, 30)">
      <text x="0" y="0" font-family="-apple-system,BlinkMacSystemFont,Arial,sans-serif" font-size="12" font-weight="900" fill="#38bdf8" letter-spacing="1">${escapeXml(headerLeft)}</text>
      <text x="160" y="0" text-anchor="end" font-family="-apple-system,BlinkMacSystemFont,Arial,sans-serif" font-size="12" font-weight="700" fill="#94a3b8">${escapeXml(headerRight)}</text>
    </g>
    <!-- Status Pill -->
    <g transform="translate(18, 52)">
      <rect x="0" y="0" width="160" height="24" rx="12" fill="${badgeBg}"/>
      <text x="80" y="16" text-anchor="middle" font-family="-apple-system,BlinkMacSystemFont,Arial,sans-serif" font-size="11" font-weight="900" fill="${textColor}" letter-spacing="0.5">${st}${elapsed ? ` • ${elapsed}` : ""}</text>
    </g>
    <!-- Title -->
    <text x="18" y="112" font-family="-apple-system,BlinkMacSystemFont,Arial,sans-serif" font-size="15" font-weight="800" fill="#f1f5f9">${escapeXml(shortTitle(title))}</text>
    <!-- Model Tag -->
    <g transform="translate(18, 142)">
      <rect x="0" y="0" width="160" height="22" rx="6" fill="#161b22"/>
      <text x="80" y="15" text-anchor="middle" font-family="-apple-system,BlinkMacSystemFont,Arial,sans-serif" font-size="11" font-weight="700" fill="#64748b">${escapeXml(model)}</text>
    </g>
  </svg>`;
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
}

function approveIconData({ connected = true, hasAction = false }) {
  if (!connected) {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="196" height="196" viewBox="0 0 196 196">
      <rect width="196" height="196" rx="24" fill="#0f1115"/>
      <circle cx="98" cy="76" r="32" fill="#1e232a"/>
      <text x="98" y="142" text-anchor="middle" font-family="-apple-system,BlinkMacSystemFont,Arial,sans-serif" font-size="15" font-weight="900" fill="#64748b">APPROVE</text>
      <text x="98" y="162" text-anchor="middle" font-family="-apple-system,BlinkMacSystemFont,Arial,sans-serif" font-size="10" font-weight="700" fill="#ef4444">OFFLINE</text>
    </svg>`;
    return `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
  }

  const bgCol = hasAction ? "#064e3b" : "#0f172a";
  const strokeCol = hasAction ? "#10b981" : "#1e293b";
  const iconCol = hasAction ? "#34d399" : "#64748b";
  const subText = hasAction ? "READY" : "IDLE";
  const subColor = hasAction ? "#a7f3d0" : "#64748b";

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="196" height="196" viewBox="0 0 196 196">
    <rect width="196" height="196" rx="24" fill="${bgCol}"/>
    <rect x="2" y="2" width="192" height="192" rx="22" fill="none" stroke="${strokeCol}" stroke-width="2"/>
    <g transform="translate(98, 76)">
      <circle cx="0" cy="0" r="32" fill="${iconCol}"/>
      <path d="M-10 0 L-3 7 L10 -6" fill="none" stroke="#ffffff" stroke-width="4.5" stroke-linecap="round" stroke-linejoin="round"/>
    </g>
    <text x="98" y="142" text-anchor="middle" font-family="-apple-system,BlinkMacSystemFont,Arial,sans-serif" font-size="15" font-weight="900" fill="#ffffff" letter-spacing="1">APPROVE</text>
    <text x="98" y="162" text-anchor="middle" font-family="-apple-system,BlinkMacSystemFont,Arial,sans-serif" font-size="10" font-weight="800" fill="${subColor}" letter-spacing="0.8">${subText}</text>
  </svg>`;
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
}

function rejectIconData({ connected = true, isRunning = false }) {
  const bgCol = isRunning ? "#450a0a" : "#0f172a";
  const strokeCol = isRunning ? "#ef4444" : "#1e293b";
  const iconCol = isRunning ? "#ef4444" : "#475569";
  const subText = !connected ? "OFFLINE" : isRunning ? "READY" : "NO REQUEST";
  const subColor = isRunning ? "#fca5a5" : "#64748b";

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="196" height="196" viewBox="0 0 196 196">
    <rect width="196" height="196" rx="24" fill="${bgCol}"/>
    <rect x="2" y="2" width="192" height="192" rx="22" fill="none" stroke="${strokeCol}" stroke-width="2"/>
    <g transform="translate(98, 76)">
      <circle cx="0" cy="0" r="32" fill="${iconCol}"/>
      <path d="M-8 -8 L8 8 M8 -8 L-8 8" fill="none" stroke="#ffffff" stroke-width="4.5" stroke-linecap="round"/>
    </g>
    <text x="98" y="142" text-anchor="middle" font-family="-apple-system,BlinkMacSystemFont,Arial,sans-serif" font-size="15" font-weight="900" fill="#ffffff" letter-spacing="1">REJECT</text>
    <text x="98" y="162" text-anchor="middle" font-family="-apple-system,BlinkMacSystemFont,Arial,sans-serif" font-size="10" font-weight="800" fill="${subColor}" letter-spacing="0.8">${subText}</text>
  </svg>`;
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
}

function tokensIconData(tokenUsage, connected = true) {
  const total = tokenUsage?.totalTokens ?? null;
  const totalStr = formatTokenCount(total);
  const context = tokenUsage?.contextTokens;
  const window = tokenUsage?.modelContextWindow;
  const contextLabel = Number.isFinite(context) && Number.isFinite(window) && window > 0
    ? `${Math.min(100, Math.max(0, Math.round(context / window * 100)))}% CONTEXT` : "CONTEXT UNKNOWN";

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="196" height="196" viewBox="0 0 196 196">
    <rect width="196" height="196" rx="24" fill="#0d1117"/>
    <rect x="2" y="2" width="192" height="192" rx="22" fill="none" stroke="#21262d" stroke-width="2"/>
    <g transform="translate(98, 36)">
      <rect x="-44" y="-13" width="88" height="26" rx="13" fill="#1e293b" stroke="#334155" stroke-width="1.2"/>
      <text x="0" y="5" text-anchor="middle" font-family="-apple-system,BlinkMacSystemFont,Arial,sans-serif" font-size="11" font-weight="900" fill="#94a3b8" letter-spacing="1">CLI TOKENS</text>
    </g>
    <text x="98" y="105" text-anchor="middle" font-family="-apple-system,BlinkMacSystemFont,Arial,sans-serif" font-size="32" font-weight="900" fill="#f8fafc" letter-spacing="0.5">${totalStr}</text>
    <text x="98" y="126" text-anchor="middle" font-family="-apple-system,BlinkMacSystemFont,Arial,sans-serif" font-size="10" fill="#94a3b8">${contextLabel}</text>
    <text x="98" y="150" text-anchor="middle" font-family="-apple-system,BlinkMacSystemFont,Arial,sans-serif" font-size="12" font-weight="700" fill="#64748b">INPUT: ${formatTokenCount(tokenUsage?.inputTokens ?? null)}</text>
    <text x="98" y="168" text-anchor="middle" font-family="-apple-system,BlinkMacSystemFont,Arial,sans-serif" font-size="12" font-weight="700" fill="#64748b">OUTPUT: ${formatTokenCount(tokenUsage?.outputTokens ?? null)}</text>
  </svg>`;
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
}

function queueIconData() {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="196" height="196" viewBox="0 0 196 196">
    <rect width="196" height="196" rx="24" fill="#0f172a"/>
    <rect x="2" y="2" width="192" height="192" rx="22" fill="none" stroke="#3b82f6" stroke-width="2"/>
    <g transform="translate(98, 76)">
      <circle cx="0" cy="0" r="32" fill="#2563eb"/>
      <path d="M-6 -10 L10 0 L-6 10 Z" fill="#ffffff"/>
    </g>
    <text x="98" y="142" text-anchor="middle" font-family="-apple-system,BlinkMacSystemFont,Arial,sans-serif" font-size="15" font-weight="900" fill="#ffffff" letter-spacing="1">CONTINUE</text>
    <text x="98" y="162" text-anchor="middle" font-family="-apple-system,BlinkMacSystemFont,Arial,sans-serif" font-size="10" font-weight="800" fill="#93c5fd" letter-spacing="0.8">SEND PROMPT</text>
  </svg>`;
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
}

function resumeIconData() {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="196" height="196" viewBox="0 0 196 196">
    <rect width="196" height="196" rx="24" fill="#0f172a"/>
    <rect x="2" y="2" width="192" height="192" rx="22" fill="none" stroke="#8b5cf6" stroke-width="2"/>
    <g transform="translate(98, 76)">
      <circle cx="0" cy="0" r="32" fill="#7c3aed"/>
      <path d="M-10 -10 L2 0 L-10 10 M0 -10 L12 0 L0 10" fill="none" stroke="#ffffff" stroke-width="3" stroke-linecap="round"/>
    </g>
    <text x="98" y="142" text-anchor="middle" font-family="-apple-system,BlinkMacSystemFont,Arial,sans-serif" font-size="15" font-weight="900" fill="#ffffff" letter-spacing="1">RESUME</text>
    <text x="98" y="162" text-anchor="middle" font-family="-apple-system,BlinkMacSystemFont,Arial,sans-serif" font-size="10" font-weight="800" fill="#c4b5fd" letter-spacing="0.8">LAST SESSION</text>
  </svg>`;
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
}

let socket;
let reconnectTimer;
let pollTimer;
let pollInFlight = false;
let latestState = null;

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

function contextOf(message) {
  return String(message.actionid || `${message.uuid}___${message.key}`);
}

function sendSvgState(instance, dataUrl) {
  if (!socket || socket.readyState !== WebSocket.OPEN) return;
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

function taskSlot(uuid) {
  const match = String(uuid || "").match(/\.task([1-6])$/);
  return match ? Number(match[1]) - 1 : null;
}

function actionName(uuid) {
  const name = String(uuid || "").split(".").at(-1);
  return Object.hasOwn(ACTION_LABELS, name) ? name : null;
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

function renderInstance(instance) {
  if (!socket || socket.readyState !== WebSocket.OPEN) return;
  if (!instance.active) return;
  const slot = taskSlot(instance.uuid);
  const slots = latestState?.slots || [];
  const activeTasks = latestState?.activeTasks || [];

  if (slot !== null) {
    if (!latestState?.connected) {
      sendSvgState(instance, sessionCardIconData({
        headerLeft: "CLI",
        headerRight: `Session ${slot + 1}`,
        connected: false
      }));
      return;
    }
    const task = activeTasks[slot] || slots[slot];
    if (!task?.threadKey) {
      sendSvgState(instance, sessionCardIconData({
        headerLeft: "CLI",
        headerRight: `Session ${slot + 1}`,
        connected: true,
        empty: true
      }));
      return;
    }
    const elapsed = task.elapsedSec ? formatElapsed(task.elapsedSec) : "";
    sendSvgState(instance, sessionCardIconData({
      headerLeft: "CLI",
      headerRight: `Session ${slot + 1}`,
      title: task.title || "CLI Session",
      status: task.status || "IDLE",
      elapsed,
      model: task.model || "Codex CLI",
      connected: true,
      empty: false
    }));
    return;
  }

  const name = actionName(instance.uuid);
  if (!name) return;

  if (name === "approve") {
    sendSvgState(instance, approveIconData({
      connected: Boolean(latestState?.connected),
      hasAction: (latestState?.lastTask?.pendingApprovalCount || 0) === 1
    }));
  } else if (name === "reject") {
    sendSvgState(instance, rejectIconData({
      connected: Boolean(latestState?.connected),
      isRunning: (latestState?.lastTask?.pendingApprovalCount || 0) === 1
    }));
  } else if (name === "tokens" && !latestState?.connected) {
    sendSvgState(instance, textCard("CLI TOKENS", "Offline", "Waiting for app-server", false));
  } else if (name === "tokens") {
    sendSvgState(instance, tokensIconData(latestState?.tokenUsage, Boolean(latestState?.connected)));
  } else if (name === "queue") {
    sendSvgState(instance, queueIconData());
  } else if (name === "resume") {
    sendSvgState(instance, resumeIconData());
  } else if (["usage", "usage5h", "usageweekly"].includes(name)) {
    sendSvgState(instance, usageCard(latestState?.usage, name === "usage5h" ? "five-hour" : name === "usageweekly" ? "weekly" : null, Boolean(latestState?.connected)));
  } else if (name === "attention") {
    sendSvgState(instance, textCard("ATTENTION", latestState?.pendingAttentionCount || 0, "Select pending task", Boolean(latestState?.connected)));
  } else if (name === "plan") {
    const plan = latestState?.plan;
    const steps = plan?.checklist?.steps;
    const summary = plan?.error ? "Read failed" : steps ? `${steps.filter(step => step.status === "completed").length}/${steps.length} steps` : plan?.document ? "Saved plan" : plan?.historyStatus === "complete" ? "No saved plan" : "Load plan";
    sendSvgState(instance, textCard("PLAN", summary, "View in plugin inspector", Boolean(latestState?.connected)));
  } else if (name === "subagents") {
    const agents = latestState?.subagents;
    sendSvgState(instance, textCard("CHILD TASKS", agents?.count ?? "Unknown", agents?.error ? "Refresh failed" : agents ? "Press to refresh" : "Press to load", Boolean(latestState?.connected)));
  } else if (name === "goal") {
    const goal = latestState?.goal;
    sendSvgState(instance, textCard("GOAL", goal?.status || (latestState?.goalError ? "Unavailable" : "No goal"), goal?.status === "active" ? "Press to pause" : goal?.status === "paused" ? "Press to resume" : "Configure in inspector", Boolean(latestState?.connected)));
  } else if (name === "navigate") {
    sendSvgState(instance, textCard("TASKS", latestState?.lastTask?.title || "No task", "Rotate or press to select", Boolean(latestState?.connected)));
  } else if (["model", "reasoning", "fast"].includes(name)) {
    const pending = latestState?.nextPromptSettings;
    const current = latestState?.lastTask;
    const value = name === "model" ? (pending?.model || current?.model) : name === "reasoning" ? (pending?.effort || current?.reasoningEffort) : ((pending ? pending.serviceTier : current?.serviceTier) === "priority" ? "Fast" : "Standard");
    sendSvgState(instance, textCard(ACTION_LABELS[name], value || "Unknown", pending ? "Next deck prompt" : "Press to change", Boolean(latestState?.connected)));
  } else if (["new", "fork", "stop", "submit", "steer", "prompt_test", "prompt_review", "prompt_commit"].includes(name)) {
    sendSvgState(instance, textCard("CODEX CLI", ACTION_LABELS[name], name === "submit" || name === "steer" ? (latestState?.draft ? "Saved prompt ready" : "Set prompt in inspector") : "Selected task", Boolean(latestState?.connected)));
  } else if (name === "status" || name === "taskmonitor") {
    const last = latestState?.lastTask;
    sendSvgState(instance, sessionCardIconData({
      headerLeft: "CLI",
      headerRight: "STATUS",
      title: latestState?.selectedTaskError ? "TASK READ-ONLY" : last?.title || "Codex CLI",
      status: latestState?.agentStatus || "IDLE",
      elapsed: last?.elapsedSec ? formatElapsed(last.elapsedSec) : "",
      model: last?.model || "Codex CLI",
      connected: Boolean(latestState?.connected),
      empty: !latestState?.connected
    }));
  }
}

function renderAll() {
  for (const instance of instances.values()) {
    renderInstance(instance);
  }
}

const feed = bridgeFeed({ component: "codex-cli", url: BRIDGE_URL, poll: pollBridgeState, onState: state => { latestState = state;  renderAll(); } });
function connectBridgeWs() { feed.start(); }

async function pollBridgeState() {
  if (pollInFlight) return;
  pollInFlight = true;
  try {
    latestState = await requestLocal("/state");
  } catch (err) {
    latestState = { connected: false, error: err.message, slots: [] };
  } finally {
    pollInFlight = false;
    renderAll();
  }
}

async function clickSlot(slot) {
  const threadId = latestState?.slots?.[slot]?.threadKey;
  if (!threadId) throw new Error("No session in this slot");
  return requestLocal(`/task/${slot}/click`, { method: "POST", body: JSON.stringify({ threadId }) });
}
async function invokeAction(name, param = {}) {
  return requestLocal(`/action/${name}`, { method: "POST", body: JSON.stringify({ threadId: latestState?.selectedThreadId, ...param }) });
}
async function invoke(instance, pressed) {
  if (!pressed) return;
  const slot = taskSlot(instance.uuid);
  if (slot !== null) return clickSlot(slot);
  const name = actionName(instance.uuid);
  if (["tokens", "status", "taskmonitor", "usage", "usage5h", "usageweekly"].includes(name)) return;
  if (name) await invokeAction(name);
}

async function handleInspector(message) {
  try {
    const { path, method = "GET", body } = message.payload;
    if (typeof path !== "string" || !path.startsWith("/") || path.startsWith("//") || typeof body === "string" && body.length > 65536) throw new Error("Invalid inspector request");
    const target = new URL(path, "http://localhost");
    const allowed = ["GET /state", "POST /draft", "POST /goal", "POST /action/plan"];
    if (!allowed.includes(`${method} ${target.pathname}`)) throw new Error("Unsupported inspector operation");
    const data = await requestLocal(target.pathname + target.search, { method, body, signal: AbortSignal.timeout(110000) });
    inspectorReply(send, message, { data });
  } catch (error) { inspectorReply(send, message, { error: error.message }); }
}

function handleMessage(raw) {
  let message;
  try {
    message = JSON.parse(String(raw));
  } catch {
    return;
  }

  if (message.cmd === "sendToPlugin" && message.payload?.type === "localApi") {
    ack(message); void handleInspector(message); return;
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
    if (actionName(instance.uuid) === "navigate") {
      if (message.cmd === "dialrotate") {
        const ticks = encoderTicks(message);
        if (ticks) void invokeAction("navigate", { ticks }).catch(error => reportActionError(send, instance, error));
      } else if (message.cmd === "dialdown") void invoke(instance, true).catch(error => reportActionError(send, instance, error));
    } else if (actionName(instance.uuid) === "resume") {
      if (message.cmd === "dialdown") void invoke(instance, true).catch(error => reportActionError(send, instance, error));
    }
    ack(message);
    return;
  }

  if (["keydown", "keyup"].includes(message.cmd)) {
    const instance = instances.get(contextOf(message)) || addInstance(message);
    void invoke(instance, message.cmd !== "keyup").catch(error => reportActionError(send, instance, error));
    ack(message);
  }
}

function connect() {
  clearTimeout(reconnectTimer);
  const hostSocket = new WebSocket(HOST_URL);
  socket = hostSocket;

  hostSocket.on("open", () => {
    if (socket !== hostSocket) return;
    send({ code: 0, cmd: "connected", uuid: PLUGIN_UUID });
    invalidateDisplays(instances);
    renderAll();
    connectBridgeWs();
    void pollBridgeState();
  });

  hostSocket.on("message", raw => { if (socket === hostSocket) handleMessage(raw); });

  hostSocket.on("close", () => {
    if (socket !== hostSocket) return;
    feed.stop();
    reconnectTimer = setTimeout(connect, 1000);
    reconnectTimer.unref();
  });

  hostSocket.on("error", (err) => {
    console.error("WS error:", err);
    hostSocket.close();
  });
}

const renderTimer = setInterval(renderAll, 1000);
renderTimer.unref();

connect();

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    clearTimeout(reconnectTimer);
    clearInterval(renderTimer);
    feed.stop();
    socket?.close();
    process.exit(0);
  });
}
