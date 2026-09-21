import { createServer } from "node:http";
import { WebSocketServer } from "ws";
import { CodexCliClient } from "./app-server-client.mjs";

const HOST = "127.0.0.1";
const PORT = Number(process.env.CODEX_CLI_BRIDGE_PORT || 17376);
const REFRESH_MS = 500;

const client = new CodexCliClient();
client.start();

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
  const digest = `${cached.connected}:${cached.error}:${cached.agentStatus}:${cached.pendingAttentionCount}:${cached.tokenUsage?.totalTokens}:${cached.activeTasks?.length}:${cached.slots?.map((s) => `${s.id}-${s.status}-${s.selected}`).join(",")}`;
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
    "Cache-Control": "no-store",
    "Access-Control-Allow-Origin": "*"
  });
  response.end(`${JSON.stringify(body)}\n`);
}

async function readBodyJson(request) {
  return new Promise((resolve) => {
    let data = "";
    request.on("data", chunk => { data += chunk; });
    request.on("end", () => {
      try { resolve(JSON.parse(data || "{}")); }
      catch { resolve({}); }
    });
    request.on("error", () => resolve({}));
  });
}

export const server = createServer(async (request, response) => {
  const url = new URL(request.url || "/", `http://${HOST}:${PORT}`);

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

  if (request.method === "POST" && (url.pathname === "/action/approve" || url.pathname === "/action/proceed")) {
    try {
      const result = await client.approveLatest();
      return json(response, 200, { ok: true, action: "approve", result });
    } catch (error) {
      return json(response, 500, { ok: false, error: error.message });
    }
  }

  if (request.method === "POST" && (url.pathname === "/action/reject" || url.pathname === "/action/cancel" || url.pathname === "/action/stop")) {
    try {
      const result = await client.rejectLatest();
      return json(response, 200, { ok: true, action: "reject", result });
    } catch (error) {
      return json(response, 500, { ok: false, error: error.message });
    }
  }

  if (request.method === "POST" && url.pathname === "/action/resume") {
    try {
      const result = await client.resumeLast();
      return json(response, 200, { ok: true, action: "resume", result });
    } catch (error) {
      return json(response, 500, { ok: false, error: error.message });
    }
  }

  if (request.method === "POST" && url.pathname === "/action/queue") {
    try {
      const body = await readBodyJson(request);
      const prompt = body.prompt || body.message || "continue";
      const result = await client.queuePrompt(prompt);
      return json(response, 200, { ok: true, action: "queue", result });
    } catch (error) {
      return json(response, 500, { ok: false, error: error.message });
    }
  }

  if (request.method === "POST" && url.pathname === "/action/tokens") {
    try {
      await client.focusTerminal();
      return json(response, 200, { ok: true, action: "tokens" });
    } catch (error) {
      return json(response, 500, { ok: false, error: error.message });
    }
  }

  const matchTask = request.method === "POST" && url.pathname.match(/^\/task\/([0-5])\/click$/);
  if (matchTask) {
    try {
      await client.focusTerminal();
      return json(response, 200, { ok: true });
    } catch (error) {
      return json(response, 500, { ok: false, error: error.message });
    }
  }

  return json(response, 404, { ok: false, error: "Not found" });
});

server.on("upgrade", (request, socket, head) => {
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
  server.listen(PORT, HOST, () => {
    console.log(`Codex CLI Bridge listening on http://${HOST}:${PORT}`);
    refresh();
  });
}
