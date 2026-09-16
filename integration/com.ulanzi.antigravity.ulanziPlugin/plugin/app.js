import WebSocket from "ws";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const PLUGIN_UUID = "com.ulanzi.ulanzistudio.antigravity";
const BRIDGE_URL = process.env.ANTIGRAVITY_BRIDGE_URL || "http://127.0.0.1:17374";
const [address = "127.0.0.1", port = "3906"] = process.argv.slice(2);
const HOST_URL = `ws://${address}:${port}`;
const instances = new Map();
const PLUGIN_ROOT = resolve(dirname(resolve(process.argv[1])), "..");

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
  new: "NEW",
  navigate: "LATEST"
});

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
        }
      ]
    }
  });
}

function updateDisplays() {
  const slots = latestState?.slots || [];
  const activeTasks = latestState?.activeTasks || [];
  updateSessionRunningTimes(slots, activeTasks);

  for (const instance of instances.values()) {
    if (!instance.active) continue;
    const slot = taskSlot(instance.uuid);
    if (slot !== null) {
      const task = activeTasks[slot] || slots[slot] || { title: "Empty", status: "idle" };
      const startTime = sessionStartTimes.get(task.threadKey);
      const elapsed = startTime ? formatElapsed(Date.now() - startTime) : "";
      sendSvgState(instance, sessionIconData({
        slot: slot + 1,
        title: task.title || `Session ${slot + 1}`,
        status: task.status || "idle",
        elapsed
      }));
      continue;
    }

    const name = actionName(instance.uuid);
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
    } else if (name === "new") {
      sendSvgState(instance, newSessionIconData());
    } else if (name === "navigate") {
      const latestTask = activeTasks[0] || slots[0] || { title: "Latest", status: "idle" };
      const startTime = sessionStartTimes.get(latestTask.threadKey);
      const elapsed = startTime ? formatElapsed(Date.now() - startTime) : "";
      sendSvgState(instance, sessionIconData({
        slot: 1,
        title: latestTask.title || "Latest Session",
        status: latestTask.status || "idle",
        elapsed
      }));
    }
  }
}

async function pollBridgeState() {
  if (pollInFlight) return;
  pollInFlight = true;
  try {
    const res = await fetch(`${BRIDGE_URL}/state`);
    if (res.ok) {
      latestState = await res.json();
    }
  } catch {}
  pollInFlight = false;
  updateDisplays();
}

async function invokeAction(name, param) {
  try {
    await fetch(`${BRIDGE_URL}/action/${name}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(param || {})
    });
  } catch {}
}

async function handleMessage(raw) {
  let message;
  try {
    message = JSON.parse(raw);
  } catch {
    return;
  }

  const contextKey = contextOf(message);
  let instance = instances.get(contextKey);
  if (!instance && message.uuid) {
    instance = {
      uuid: message.uuid,
      actionid: message.actionid,
      key: message.key,
      active: true,
      lastDisplay: null
    };
    instances.set(contextKey, instance);
  }

  if (message.cmd === "init") {
    ack(message);
    return;
  }

  if (message.cmd === "active") {
    if (instance) instance.active = true;
    ack(message);
    updateDisplays();
    return;
  }

  if (message.cmd === "inactive") {
    if (instance) instance.active = false;
    ack(message);
    return;
  }

  if (message.cmd === "key_down" || message.cmd === "push") {
    ack(message);
    const slot = taskSlot(message.uuid);
    if (slot !== null) {
      await fetch(`${BRIDGE_URL}/task/${slot}/click`, { method: "POST" }).catch(() => {});
      return;
    }

    const name = actionName(message.uuid);
    if (name === "proceed") {
      await invokeAction("proceed");
    } else if (name === "cancel") {
      await invokeAction("cancel");
    } else if (name === "attention") {
      await invokeAction("attention");
    } else if (name === "plan") {
      await invokeAction("plan");
    } else if (name === "walkthrough") {
      await invokeAction("walkthrough");
    } else if (name === "new") {
      await fetch(`${BRIDGE_URL}/focus`, { method: "POST" }).catch(() => {});
    } else if (name === "navigate") {
      await fetch(`${BRIDGE_URL}/task/0/click`, { method: "POST" }).catch(() => {});
    }
    return;
  }

  if (message.cmd === "key_up") {
    ack(message);
    return;
  }

  if (message.cmd === "rotate") {
    ack(message);
    // Encoder rotation scrolls VS Code
    return;
  }
}

function connect() {
  clearTimeout(reconnectTimer);
  socket = new WebSocket(HOST_URL);

  socket.on("open", () => {
    send({ cmd: "register", uuid: PLUGIN_UUID });
    clearInterval(pollTimer);
    pollTimer = setInterval(pollBridgeState, 500);
    pollBridgeState();
  });

  socket.on("message", (data) => {
    handleMessage(data.toString());
  });

  socket.on("close", () => {
    clearInterval(pollTimer);
    reconnectTimer = setTimeout(connect, 2000);
  });

  socket.on("error", () => {
    socket.close();
  });
}

connect();

