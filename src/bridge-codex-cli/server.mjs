import { secureHandler, allowedRequest, readJson } from "../shared/local-api.mjs";
import { dispatchCliAction, cliActions } from "./actions.mjs";
import { stateDigest } from "../shared/plugin-runtime.mjs";
import { createServer } from "node:http";
import { WebSocketServer } from "ws";
import { CodexCliClient } from "./app-server-client.mjs";

const HOST = "127.0.0.1";
const PORT = Number(process.env.CODEX_CLI_BRIDGE_PORT || 17376);
const REFRESH_MS = 500;

const client = new CodexCliClient();


let cached = {
  connected: false,
  agentStatus: "IDLE",
  pendingAttentionCount: 0,
  slots: Array.from({ length: 6 }, (_, id) => ({
    id, threadKey: null, title: null, status: "off", selected: false
  })),
  activeTasks: [],
  lastTask: null,
  tokenUsage: { totalTokens: 0, inputTokens: 0, outputTokens: 0 },
  error: "Initializing Codex CLI Bridge...",
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

async function refresh() {
  if (refreshPromise) return refreshPromise;
  refreshPromise = (async () => {
    try {
      const snapshot = await client.snapshot();
      cached = {
        ...snapshot,
        error: snapshot.error || null,
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

export const server = createServer(secureHandler("codex-cli", PORT, async (request, response) => {
  const url = new URL(request.url || "/", `http://${HOST}:${PORT}`);

  const body = request.method === "POST" ? await readJson(request) : {};

  if (request.method === "GET" && url.pathname === "/health") {
    await refresh();
    return json(response, 200, {
      ok: true,
      connected: cached.connected,
      daemonConnected: cached.daemonConnected,
      updatedAt: cached.updatedAt
    });
  }

  if (request.method === "GET" && url.pathname === "/state") {
    return json(response, 200, cached);
  }

  if (request.method === "POST" && url.pathname === "/focus") {
    try {
      const focused = await client.focusTerminal();
      return json(response, 200, { ok: true, focused });
    } catch (error) {
      return json(response, 503, { ok: false, error: error.message });
    }
  }

  if (request.method === "POST" && url.pathname === "/draft") {
    const result = client.setDraft(body.text, body.threadId);
    await refresh();
    return json(response, 200, result);
  }
  if (request.method === "POST" && url.pathname === "/goal") {
    const result = await client.createGoal(body.objective, body.threadId);
    await refresh();
    return json(response, 200, result);
  }
  const action = url.pathname.startsWith("/action/") ? url.pathname.slice(8) : null;
  if (request.method === "POST" && cliActions.includes(action)) {
    const result = await dispatchCliAction(client, action, body);
    await refresh();
    return json(response, 200, { ok: true, action, result });
  }

  const matchTask = request.method === "POST" && url.pathname.match(/^\/task\/([0-5])\/click$/);
  if (matchTask) {
    try {
      if (typeof body.threadId !== "string") throw new Error("Session ID is required");
      const result = await client.selectThread(body.threadId);
      await refresh();
      return json(response, 200, result);
    } catch (error) {
      return json(response, 500, { ok: false, error: error.message });
    }
  }

  return json(response, 404, { ok: false, error: "Not found" });
}));

server.on("upgrade", (request, socket, head) => {
  if (!allowedRequest(request, "codex-cli", PORT)) { socket.destroy(); return; }
  const { pathname } = new URL(request.url || "/", `http://${HOST}:${PORT}`);
  if (pathname === "/events" || pathname === "/ws") {
    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit("connection", ws, request);
    });
  } else {
    socket.destroy();
  }
});

if (process.argv[1] && (process.argv[1].endsWith("server.mjs") || process.argv[1].endsWith("bridge-codex-cli.mjs"))) {
  client.start();
  server.listen(PORT, HOST, () => {
    console.log(`Codex CLI Bridge listening on http://${HOST}:${PORT}`);
    refresh();
  });
}

for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => { client.stop(); wss.close(); server.close(() => process.exit(0)); });
