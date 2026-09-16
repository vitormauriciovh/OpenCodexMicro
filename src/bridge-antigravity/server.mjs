import { createServer } from "node:http";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
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
    } catch (error) {
      cached = { ...cached, connected: false, error: error.message, updatedAt: Date.now() };
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

if (process.argv[1] && (process.argv[1].endsWith("server.mjs") || process.argv[1].endsWith("bridge-antigravity.mjs"))) {
  server.listen(PORT, HOST, () => {
    console.log(`Antigravity Bridge listening on http://${HOST}:${PORT}`);
    refresh();
  });
}

