import { createServer } from "node:http";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { WebSocketServer } from "ws";
import { CodexCdpClient } from "./codex-cdp.mjs";
import { decodeThreadPathSegment } from "./thread-key.mjs";

const execFileAsync = promisify(execFile);
const HOST = "127.0.0.1";
const PORT = Number(process.env.CODEX_KEYBOARD_PORT || 17373);
const configuredRefreshMs = Number(process.env.CODEX_KEYBOARD_REFRESH_MS || 500);
const REFRESH_MS = Number.isFinite(configuredRefreshMs)
  ? Math.max(250, configuredRefreshMs)
  : 500;
const client = new CodexCdpClient();
let cached = {
  connected: false,
  slots: Array.from({ length: 6 }, (_, id) => ({
    id, threadKey: null, title: null, status: "off", selected: false
  })),
  activeTasks: [],
  lastTask: null,
  error: "Waiting for Codex",
  updatedAt: Date.now()
};
let rememberedLastTask = null;
let refreshPromise = null;
let nextReconnectAt = 0;
let lastBroadcastDigest = "";

const wss = new WebSocketServer({ noServer: true });
const wsClients = new Set();

function broadcastState() {
  const digest = `${cached.connected}:${cached.error}:${cached.activeTasks?.length}:${cached.slots?.map((s) => `${s.id}-${s.status}-${s.selected}`).join(",")}:${cached.usage?.windows?.[0]?.remainingPercent}:${cached.reasoningEffort}`;
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

async function focusCodex() {
  await execFileAsync("/usr/bin/open", ["-b", "com.openai.codex"], {
    timeout: 3000
  });
}

async function refresh(force = false) {
  if (refreshPromise) return refreshPromise;
  if (!force && Date.now() < nextReconnectAt) return;
  refreshPromise = (async () => {
    try {
      const snapshot = await client.snapshot();
      if (Array.isArray(snapshot.activeTasks) && snapshot.activeTasks.length > 0) {
        rememberedLastTask = snapshot.activeTasks[0];
      } else if (snapshot.lastTask) {
        rememberedLastTask = snapshot.lastTask;
      }
      cached = {
        connected: true,
        ...snapshot,
        lastTask: rememberedLastTask || snapshot.lastTask || null,
        error: null,
        updatedAt: Date.now()
      };
      nextReconnectAt = 0;
      broadcastState();
    } catch (error) {
      if (cached.connected !== false || cached.error !== error.message) {
        cached = { ...cached, connected: false, error: error.message, updatedAt: Date.now() };
        broadcastState();
      }
      nextReconnectAt = Date.now() + 2000;
    }
  })();
  try {
    await refreshPromise;
  } finally {
    refreshPromise = null;
  }
}

function json(response, status, body) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "Access-Control-Allow-Origin": "http://127.0.0.1"
  });
  response.end(`${JSON.stringify(body)}\n`);
}

const server = createServer(async (request, response) => {
  const url = new URL(request.url || "/", `http://${HOST}:${PORT}`);
  if (request.method === "GET" && url.pathname === "/health") {
    await refresh(true);
    return json(response, 200, { ok: true, codexConnected: cached.connected, updatedAt: cached.updatedAt });
  }
  if (request.method === "GET" && url.pathname === "/state") {
    return json(response, 200, cached);
  }
  if (request.method === "POST" && url.pathname === "/focus") {
    try {
      await focusCodex();
      return json(response, 200, { ok: true });
    } catch (error) {
      return json(response, 503, { ok: false, error: error.message });
    }
  }
  const match = request.method === "POST" && url.pathname.match(/^\/agent\/([0-5])\/click$/);
  if (match) {
    try {
      await Promise.all([
        client.clickAgent(Number(match[1])),
        focusCodex()
      ]);
      return json(response, 200, { ok: true });
    } catch (error) {
      return json(response, 503, { ok: false, error: error.message });
    }
  }
  const threadMatch = request.method === "POST" && url.pathname.match(
    /^\/thread\/([^/]+)\/click$/
  );
  if (threadMatch) {
    try {
      const threadId = decodeThreadPathSegment(threadMatch[1]);
      const slot = Number(url.searchParams.get("slot") || 0);
      if (!Number.isInteger(slot) || slot < 0 || slot > 5) {
        throw new Error("Invalid Codex Micro slot");
      }
      await Promise.all([
        client.clickThread(threadId, slot),
        focusCodex()
      ]);
      return json(response, 200, { ok: true, bridge: true });
    } catch (error) {
      return json(response, 503, {
        ok: false,
        bridge: false,
        error: error.message
      });
    }
  }
  const action = request.method === "POST" && url.pathname.match(
    /^\/action\/(fast|approve|reject|pin|new|fork|mic|steer|submit|stop|reasoning)\/(down|up)$/
  );
  if (action) {
    try {
      if (action[1] === "steer") {
        if (action[2] === "down") {
          await focusCodex();
          await client.dispatchComposerSteer();
        }
        return json(response, 200, { ok: true });
      }
      await client.dispatchNamedAction(action[1], action[2] === "down");
      return json(response, 200, { ok: true, bridge: true });
    } catch (error) {
      return json(response, 503, { ok: false, error: error.message });
    }
  }
  if (request.method === "POST" && url.pathname === "/prompt") {
    try {
      let body = "";
      for await (const chunk of request) body += chunk;
      const { text } = JSON.parse(body || "{}");
      if (!text) throw new Error("Prompt text is required");
      await focusCodex();
      await client.submitPrompt(text);
      return json(response, 200, { ok: true });
    } catch (error) {
      return json(response, 500, { ok: false, error: error.message });
    }
  }
  const joystick = request.method === "POST" && url.pathname.match(
    /^\/joystick\/(up|right|down|left)\/(down|up)$/
  );
  if (joystick) {
    try {
      await client.dispatchJoystick(joystick[1], joystick[2] === "down" ? 1 : 0);
      return json(response, 200, { ok: true });
    } catch (error) {
      return json(response, 503, { ok: false, error: error.message });
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

server.listen(PORT, HOST, () => {
  console.log(`Codex Keyboard bridge listening on http://${HOST}:${PORT}`);
  void refresh();
});

const timer = setInterval(() => void refresh(), REFRESH_MS);
timer.unref();

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    clearInterval(timer);
    client.disconnect();
    server.close(() => process.exit(0));
  });
}
