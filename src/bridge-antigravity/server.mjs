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
  const digest = `${cached.connected}:${cached.error}:${cached.pendingAttentionCount}:${cached.tokenUsage?.total?.totalTokens}:${cached.subagentsCount}:${cached.activeTasks?.length}:${cached.slots?.map((s) => `${s.id}-${s.status}-${s.selected}`).join(",")}`;
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
  try {
    await execFileAsync("/usr/bin/open", ["-a", "Visual Studio Code"], { timeout: 3000 });
  } catch {
    try {
      await execFileAsync("/usr/bin/open", ["-b", "com.microsoft.VSCode"], { timeout: 3000 });
    } catch {
      // fallback
    }
  }
}

async function openFileInEditor(filePath) {
  try {
    await execFileAsync("/usr/local/bin/code", [filePath], { timeout: 3000 });
  } catch {
    await execFileAsync("/usr/bin/open", [filePath], { timeout: 3000 });
  }
}

async function sendSlashCommand(cmdName) {
  await focusVSCode();
  const textMap = {
    boost: "/boost",
    grillme: "/grill-me",
    goal: "/goal"
  };
  const commandText = textMap[cmdName] || `/${cmdName}`;
  const script = `
tell application "Visual Studio Code" to activate
delay 0.15
tell application "System Events"
  keystroke "${commandText}"
  delay 0.1
  key code 36
end tell
`;
  try {
    await execFileAsync("/usr/bin/osascript", ["-e", script], { timeout: 3000 });
  } catch (err) {
    console.error("Failed to execute osascript keystroke:", err);
  }
}

async function refresh() {
  if (refreshPromise) return refreshPromise;
  refreshPromise = (async () => {
    try {
      const snapshot = await reader.snapshot();
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

export const server = createServer(async (request, response) => {
  const url = new URL(request.url || "/", `http://${HOST}:${PORT}`);

  if (request.method === "GET" && url.pathname === "/health") {
    await refresh();
    return json(response, 200, { ok: true, antigravityConnected: cached.connected, updatedAt: cached.updatedAt });
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
      const latest = cached.activeTasks[0];
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
      const latest = cached.activeTasks[0];
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

  if (request.method === "POST" && (url.pathname === "/action/proceed" || url.pathname === "/action/approve")) {
    try {
      await focusVSCode();
      return json(response, 200, { ok: true, action: "proceed" });
    } catch (error) {
      return json(response, 500, { ok: false, error: error.message });
    }
  }

  if (request.method === "POST" && url.pathname === "/action/tokens") {
    try {
      await focusVSCode();
      return json(response, 200, { ok: true, action: "tokens" });
    } catch (error) {
      return json(response, 500, { ok: false, error: error.message });
    }
  }

  if (request.method === "POST" && (url.pathname === "/action/cancel" || url.pathname === "/action/stop" || url.pathname === "/action/reject")) {
    try {
      await focusVSCode();
      return json(response, 200, { ok: true, action: "cancel" });
    } catch (error) {
      return json(response, 500, { ok: false, error: error.message });
    }
  }

  if (request.method === "POST" && url.pathname === "/action/attention") {
    try {
      await focusVSCode();
      return json(response, 200, { ok: true, action: "attention" });
    } catch (error) {
      return json(response, 500, { ok: false, error: error.message });
    }
  }

  const slashMatch = request.method === "POST" && url.pathname.match(/^\/action\/(boost|grillme|goal)$/);
  if (slashMatch) {
    try {
      const slash = slashMatch[1];
      await sendSlashCommand(slash);
      return json(response, 200, { ok: true, slash });
    } catch (error) {
      return json(response, 500, { ok: false, error: error.message });
    }
  }

  const matchTask = request.method === "POST" && url.pathname.match(/^\/task\/([0-5])\/click$/);
  if (matchTask) {
    try {
      await focusVSCode();
      const taskIndex = Number(matchTask[1]);
      const task = cached.activeTasks[taskIndex];
      if (task && task.fullPath) {
        const planPath = path.join(task.fullPath, "implementation_plan.md");
        try {
          await openFileInEditor(planPath);
        } catch {}
      }
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

if (process.argv[1] && (process.argv[1].endsWith("server.mjs") || process.argv[1].endsWith("bridge-antigravity.mjs"))) {
  server.listen(PORT, HOST, () => {
    console.log(`Antigravity Bridge listening on http://${HOST}:${PORT}`);
    refresh();
  });
}

