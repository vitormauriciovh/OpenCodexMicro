import { AntigravityDesktopClient } from "./desktop-client.mjs";
import { mergeDesktopState } from "./desktop-state.mjs";
import { promptShortcuts } from "../shared/prompt-shortcuts.mjs";
import { secureHandler, allowedRequest, readJson } from "../shared/local-api.mjs";
import { stateDigest } from "../shared/plugin-runtime.mjs";
import { createServer } from "node:http";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import { WebSocketServer } from "ws";
import { AntigravityStateReader } from "./state-reader.mjs";

const execFileAsync = promisify(execFile);
const HOST = "127.0.0.1";
const PORT = Number(process.env.ANTIGRAVITY_BRIDGE_PORT || 17374);
const REFRESH_MS = 500;

const reader = new AntigravityStateReader();
const desktop = new AntigravityDesktopClient();
let cached = {
  connected: false,
  slots: Array.from({ length: 6 }, (_, id) => ({
    id, threadKey: null, title: null, status: "off", selected: false
  })),
  activeTasks: [],
  lastTask: null,
  pendingAttentionCount: 0,
  subagentsCount: 0,
  error: "Starting Antigravity bridge...",
  updatedAt: Date.now()
};

let refreshPromise = null;
let lastBroadcastDigest = "";

const wss = new WebSocketServer({ noServer: true });
const wsClients = new Set();

function broadcastState() {
  const digest = stateDigest(cached);
  if (digest === lastBroadcastDigest && wsClients.size > 0) return;
  lastBroadcastDigest = digest;
  const payload = JSON.stringify(cached);
  for (const ws of wsClients) {
    if (ws.readyState === 1) { // WebSocket.OPEN
      try { ws.send(payload); } catch {}
    }
  }
}

wss.on("connection", (ws) => {
  wsClients.add(ws);
  try { ws.send(JSON.stringify(cached)); } catch {}
  ws.on("close", () => wsClients.delete(ws));
  ws.on("error", () => wsClients.delete(ws));
});

async function focusVSCode() {
  await execFileAsync("/usr/bin/open", ["-a", process.env.ANTIGRAVITY_EDITOR_APP || (cached.applicationConnected ? "Antigravity" : "Visual Studio Code")], { timeout: 3000 });
}
async function openFileInEditor(filePath) {
  const { access } = await import("node:fs/promises");
  await access(filePath);
  await execFileAsync("/usr/bin/open", ["-a", process.env.ANTIGRAVITY_EDITOR_APP || "Visual Studio Code", filePath], { timeout: 3000 });
}
function unavailable() {
  return { ok: false, error: "This Antigravity version exposes no verified session control. Use the editor for this action." };
}

async function refresh() {
  if (refreshPromise) return refreshPromise;
  refreshPromise = (async () => {
    try {
      const [history, live] = await Promise.all([
        reader.snapshot(), desktop.snapshot().then(state => ({ state }), error => ({ error: error.message }))
      ]);
      const snapshot = mergeDesktopState(history, live.state, live.error);
      cached = {
        ...snapshot,
        error: null,
        updatedAt: Date.now()
      };
      broadcastState();
    } catch (error) {
      if (cached.connected !== false || cached.error !== error.message) {
        cached = { ...cached, connected: false, error: error.message, updatedAt: Date.now() };
        broadcastState();
      }
    }
  })();
  try {
    await refreshPromise;
  } finally {
    refreshPromise = null;
  }
}

setInterval(refresh, REFRESH_MS).unref();

function json(response, status, body) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  });
  response.end(`${JSON.stringify(body)}\n`);
}

export const server = createServer(secureHandler("antigravity", PORT, async (request, response) => {
  const url = new URL(request.url || "/", `http://${HOST}:${PORT}`);
  const body = request.method === "POST" ? await readJson(request) : {};

  if (request.method === "GET" && url.pathname === "/health") {
    await refresh();
    return json(response, 200, { ok: true, antigravityConnected: cached.applicationConnected, historyAvailable: cached.connected, updatedAt: cached.updatedAt });
  }

  if (request.method === "GET" && url.pathname === "/state") {
    return json(response, 200, cached);
  }

  if (request.method === "POST" && url.pathname === "/focus") {
    try {
      await focusVSCode();
      return json(response, 200, { ok: true });
    } catch (error) {
      return json(response, 503, { ok: false, error: error.message });
    }
  }

  if (request.method === "POST" && url.pathname === "/action/plan") {
    try {
      const latest = cached.activeTasks.find(task => task.threadKey === body.threadId);
      if (latest && latest.fullPath) {
        const planPath = path.join(latest.fullPath, "implementation_plan.md");
        await openFileInEditor(planPath);
        return json(response, 200, { ok: true, opened: planPath });
      }
      return json(response, 404, { ok: false, error: "No plan found" });
    } catch (error) {
      return json(response, 500, { ok: false, error: error.message });
    }
  }

  if (request.method === "POST" && url.pathname === "/action/walkthrough") {
    try {
      const latest = cached.activeTasks.find(task => task.threadKey === body.threadId);
      if (latest && latest.fullPath) {
        const wtPath = path.join(latest.fullPath, "walkthrough.md");
        await openFileInEditor(wtPath);
        return json(response, 200, { ok: true, opened: wtPath });
      }
      return json(response, 404, { ok: false, error: "No walkthrough found" });
    } catch (error) {
      return json(response, 500, { ok: false, error: error.message });
    }
  }

  if (request.method === "POST" && ["/action/boost", "/action/grillme", "/action/goal"].includes(url.pathname)) {
    return json(response, 409, unavailable());
  }
  if (request.method === "POST" && url.pathname === "/action/attention") {
    const pending = cached.activeTasks.filter(t => t.pendingFeedback || t.status === "attention");
    if (!pending.length) return json(response, 404, { ok: false, error: "No task needs attention" });
    const index = pending.findIndex(task => task.threadKey === cached.selectedThreadId);
    const result = await desktop.select(pending[(index + 1) % pending.length].threadKey);
    await refresh();
    return json(response, 200, result);
  }
  const matchTask = request.method === "POST" && url.pathname.match(/^\/task\/([0-5])\/click$/);
  if (matchTask) {
    if (!cached.activeTasks.some(task => task.threadKey === body.threadId)) throw new Error("Unknown Antigravity task");
    const result = await desktop.select(body.threadId);
    await refresh();
    return json(response, 200, result);
  }
  const action = url.pathname.startsWith("/action/") ? url.pathname.slice(8) : null;
  if (request.method === "POST" && Object.hasOwn(promptShortcuts, action)) {
    const result = await desktop.action("prompt", body.threadId, { text: promptShortcuts[action] });
    await refresh();
    return json(response, 200, result);
  }
  const aliases = { proceed: "approve", cancel: "stop" };
  if (request.method === "POST" && ["approve", "proceed", "reject", "stop", "cancel", "new", "pin", "submit", "mic", "model", "reasoning", "fork", "steer"].includes(action)) {
    const result = await desktop.action(aliases[action] || action, body.threadId);
    await refresh();
    return json(response, 200, result);
  }
  const scroll = request.method === "POST" && url.pathname.match(/^\/scroll\/(up|down)$/);
  if (scroll) {
    const result = await desktop.action("scroll", body.threadId, { ticks: scroll[1] === "up" ? -1 : 1 });
    return json(response, 200, result);
  }

  return json(response, 404, { ok: false, error: "Not found" });
}));

server.on("upgrade", (request, socket, head) => {
  if (!allowedRequest(request, "antigravity", PORT)) { socket.destroy(); return; }
  const { pathname } = new URL(request.url || "/", `http://${HOST}:${PORT}`);
  if (pathname === "/events" || pathname === "/ws") {
    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit("connection", ws, request);
    });
  } else {
    socket.destroy();
  }
});

if (process.argv[1] && (process.argv[1].endsWith("server.mjs") || process.argv[1].endsWith("bridge-antigravity.mjs"))) {
  server.listen(PORT, HOST, () => {
    console.log(`Antigravity Bridge listening on http://${HOST}:${PORT}`);
    refresh();
  });
}


for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => { desktop.close(); wss.close(); server.close(() => process.exit(0)); });
