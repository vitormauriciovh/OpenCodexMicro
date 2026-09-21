import WebSocket from "ws";
import { dirname, resolve } from "node:path";

const PLUGIN_UUID = "com.ulanzi.ulanzistudio.codexcli";
const BRIDGE_URL = process.env.CODEX_CLI_BRIDGE_URL || "http://127.0.0.1:17376";
const [address = "127.0.0.1", port = "3906"] = process.argv.slice(2);
const HOST_URL = `ws://${address}:${port}`;
const instances = new Map();

const ACTION_LABELS = Object.freeze({
  task1: "SESSION 1",
  task2: "SESSION 2",
  task3: "SESSION 3",
  task4: "SESSION 4",
  task5: "SESSION 5",
  approve: "APPROVE",
  reject: "REJECT",
  status: "STATUS",
  tokens: "TOKENS",
  queue: "QUEUE",
  resume: "RESUME"
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
  const subText = isRunning ? "CANCEL" : "STOP";
  const subColor = isRunning ? "#fca5a5" : "#64748b";

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="196" height="196" viewBox="0 0 196 196">
    <rect width="196" height="196" rx="24" fill="${bgCol}"/>
    <rect x="2" y="2" width="192" height="192" rx="22" fill="none" stroke="${strokeCol}" stroke-width="2"/>
    <g transform="translate(98, 76)">
      <circle cx="0" cy="0" r="32" fill="${iconCol}"/>
      <path d="M-8 -8 L8 8 M8 -8 L-8 8" fill="none" stroke="#ffffff" stroke-width="4.5" stroke-linecap="round"/>
    </g>
    <text x="98" y="142" text-anchor="middle" font-family="-apple-system,BlinkMacSystemFont,Arial,sans-serif" font-size="15" font-weight="900" fill="#ffffff" letter-spacing="1">CANCEL</text>
    <text x="98" y="162" text-anchor="middle" font-family="-apple-system,BlinkMacSystemFont,Arial,sans-serif" font-size="10" font-weight="800" fill="${subColor}" letter-spacing="0.8">${subText}</text>
  </svg>`;
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
}

function tokensIconData(tokenUsage, connected = true) {
  const total = tokenUsage?.totalTokens || 0;
  const totalStr = formatTokenCount(total);

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="196" height="196" viewBox="0 0 196 196">
    <rect width="196" height="196" rx="24" fill="#0d1117"/>
    <rect x="2" y="2" width="192" height="192" rx="22" fill="none" stroke="#21262d" stroke-width="2"/>
    <g transform="translate(98, 36)">
      <rect x="-44" y="-13" width="88" height="26" rx="13" fill="#1e293b" stroke="#334155" stroke-width="1.2"/>
      <text x="0" y="5" text-anchor="middle" font-family="-apple-system,BlinkMacSystemFont,Arial,sans-serif" font-size="11" font-weight="900" fill="#94a3b8" letter-spacing="1">CLI TOKENS</text>
    </g>
    <text x="98" y="105" text-anchor="middle" font-family="-apple-system,BlinkMacSystemFont,Arial,sans-serif" font-size="32" font-weight="900" fill="#f8fafc" letter-spacing="0.5">${totalStr}</text>
    <text x="98" y="150" text-anchor="middle" font-family="-apple-system,BlinkMacSystemFont,Arial,sans-serif" font-size="12" font-weight="700" fill="#64748b">INPUT: ${formatTokenCount(tokenUsage?.inputTokens || 0)}</text>
    <text x="98" y="168" text-anchor="middle" font-family="-apple-system,BlinkMacSystemFont,Arial,sans-serif" font-size="12" font-weight="700" fill="#64748b">OUTPUT: ${formatTokenCount(tokenUsage?.outputTokens || 0)}</text>
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
    <text x="98" y="142" text-anchor="middle" font-family="-apple-system,BlinkMacSystemFont,Arial,sans-serif" font-size="15" font-weight="900" fill="#ffffff" letter-spacing="1">QUEUE</text>
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
  const match = String(uuid || "").match(/\.task([1-5])$/);
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
      hasAction: (latestState?.pendingAttentionCount || 0) > 0
    }));
  } else if (name === "reject") {
    sendSvgState(instance, rejectIconData({
      connected: Boolean(latestState?.connected),
      isRunning: latestState?.agentStatus === "WORKING"
    }));
  } else if (name === "tokens") {
    sendSvgState(instance, tokensIconData(latestState?.tokenUsage, Boolean(latestState?.connected)));
  } else if (name === "queue") {
    sendSvgState(instance, queueIconData());
  } else if (name === "resume") {
    sendSvgState(instance, resumeIconData());
  } else if (name === "status") {
    const last = latestState?.lastTask;
    sendSvgState(instance, sessionCardIconData({
      headerLeft: "CLI",
      headerRight: "STATUS",
      title: last?.title || "Codex CLI",
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

let bridgeSocket = null;
let bridgeWsReconnectTimer = null;
let bridgeFallbackTimer = null;

function connectBridgeWs() {
  clearTimeout(bridgeWsReconnectTimer);
  try {
    const wsUrl = BRIDGE_URL.replace(/^http/, "ws") + "/events";
    bridgeSocket = new WebSocket(wsUrl);

    bridgeSocket.on("open", () => {
      clearInterval(bridgeFallbackTimer);
      bridgeFallbackTimer = setInterval(() => void pollBridgeState(), 5000);
      bridgeFallbackTimer.unref();
    });

    bridgeSocket.on("message", (raw) => {
      try {
        latestState = JSON.parse(String(raw));
        renderAll();
      } catch {}
    });

    bridgeSocket.on("close", () => {
      bridgeSocket = null;
      clearInterval(bridgeFallbackTimer);
      bridgeFallbackTimer = setInterval(() => void pollBridgeState(), 3000);
      bridgeFallbackTimer.unref();
      bridgeWsReconnectTimer = setTimeout(connectBridgeWs, 2000);
      bridgeWsReconnectTimer.unref();
    });

    bridgeSocket.on("error", () => {
      bridgeSocket?.close();
    });
  } catch {
    bridgeWsReconnectTimer = setTimeout(connectBridgeWs, 2000);
    bridgeWsReconnectTimer.unref();
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

  if (name === "approve" || name === "reject" || name === "resume" || name === "queue") {
    await invokeAction(name);
  } else {
    await fetch(`${BRIDGE_URL}/focus`, { method: "POST", signal: AbortSignal.timeout(1500) }).catch(() => {});
  }
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
    if (actionName(instance.uuid) === "resume") {
      void fetch(`${BRIDGE_URL}/focus`, { method: "POST" }).catch(() => {});
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
    connectBridgeWs();
    void pollBridgeState();
  });

  socket.on("message", handleMessage);

  socket.on("close", () => {
    clearInterval(bridgeFallbackTimer);
    bridgeSocket?.close();
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
    clearTimeout(bridgeWsReconnectTimer);
    clearInterval(bridgeFallbackTimer);
    bridgeSocket?.close();
    socket?.close();
    process.exit(0);
  });
}
