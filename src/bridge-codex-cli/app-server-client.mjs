import net from "node:net";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export class CodexCliClient {
  constructor(options = {}) {
    this.codexHome = options.codexHome || process.env.CODEX_HOME || path.join(os.homedir(), ".codex");
    this.socketPath = options.socketPath ||
      process.env.CODEX_APP_SERVER_SOCKET ||
      path.join(this.codexHome, "app-server-control/app-server-control.sock");
    
    this.socket = null;
    this.connected = false;
    this.pendingApprovals = new Map(); // id -> request info
    this.sessions = new Map();         // id -> session info
    this.activeTurn = null;
    this.tokenUsage = { totalTokens: 0, inputTokens: 0, outputTokens: 0 };
    this.lastTask = null;
    this.nextReqId = 1;
    this.pendingRpc = new Map();
    this.buffer = "";
    this.reconnectTimer = null;
  }

  async start() {
    this.connect();
  }

  connect() {
    if (this.socket) {
      try { this.socket.destroy(); } catch {}
      this.socket = null;
    }

    try {
      const socket = net.createConnection(this.socketPath);
      this.socket = socket;

      socket.on("connect", () => {
        this.connected = true;
        this.buffer = "";
        this.sendHandshake();
      });

      socket.on("data", (chunk) => {
        this.buffer += chunk.toString("utf8");
        this.processBuffer();
      });

      socket.on("close", () => {
        this.connected = false;
        this.scheduleReconnect();
      });

      socket.on("error", () => {
        this.connected = false;
        this.scheduleReconnect();
      });
    } catch {
      this.connected = false;
      this.scheduleReconnect();
    }
  }

  scheduleReconnect() {
    if (this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, 2500);
  }

  processBuffer() {
    let newlineIndex;
    while ((newlineIndex = this.buffer.indexOf("\n")) !== -1) {
      const line = this.buffer.slice(0, newlineIndex).trim();
      this.buffer = this.buffer.slice(newlineIndex + 1);
      if (line) {
        try {
          const msg = JSON.parse(line);
          this.handleMessage(msg);
        } catch {
          // ignore malformed lines
        }
      }
    }
  }

  send(msg) {
    if (this.socket && this.connected) {
      try {
        this.socket.write(JSON.stringify(msg) + "\n");
      } catch (err) {
        console.error("Failed to write to codex socket:", err);
      }
    }
  }

  sendHandshake() {
    // Query initial sessions if supported
    this.callRpc("session/list", {}).catch(() => {});
  }

  callRpc(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = this.nextReqId++;
      this.pendingRpc.set(id, { resolve, reject, timer: setTimeout(() => {
        this.pendingRpc.delete(id);
        reject(new Error(`RPC timeout for ${method}`));
      }, 5000) });

      this.send({ jsonrpc: "2.0", id, method, params });
    });
  }

  handleMessage(msg) {
    // 1. Handle RPC responses
    if (msg.id !== undefined && (msg.result !== undefined || msg.error !== undefined)) {
      const handler = this.pendingRpc.get(msg.id);
      if (handler) {
        clearTimeout(handler.timer);
        this.pendingRpc.delete(msg.id);
        if (msg.error) handler.reject(new Error(msg.error.message || "RPC error"));
        else handler.resolve(msg.result);
      }
      return;
    }

    // 2. Handle Server Requests (Approvals from Codex)
    if (msg.id !== undefined && msg.method) {
      this.handleServerRequest(msg);
      return;
    }

    // 3. Handle Server Notifications
    if (msg.method) {
      this.handleNotification(msg);
    }
  }

  handleServerRequest(req) {
    const { id, method, params } = req;
    if (
      method === "item/commandExecution/requestApproval" ||
      method === "item/fileChange/requestApproval" ||
      method === "item/permissions/requestApproval" ||
      method === "applyPatchApproval" ||
      method === "execCommandApproval"
    ) {
      this.pendingApprovals.set(id, {
        id,
        method,
        params,
        timestamp: Date.now()
      });
    }
  }

  handleNotification(notification) {
    const { method, params } = notification;

    if (method === "turn/started") {
      this.activeTurn = {
        id: params?.turnId || params?.id,
        startedAt: Date.now(),
        model: params?.model || "Codex CLI",
        status: "WORKING"
      };
      if (params?.session || params?.sessionId) {
        const sid = params.sessionId || params.session?.id;
        const s = this.sessions.get(sid) || {
          id: sid,
          title: params.session?.title || params.session?.name || `CLI Session ${sid.slice(0, 6)}`
        };
        if (params.session?.title) {
          s.title = params.session.title;
        }
        s.status = "WORKING";
        s.updatedAt = Date.now();
        this.sessions.set(sid, s);
      }
    } else if (method === "turn/completed") {
      this.activeTurn = null;
      if (params?.sessionId) {
        const s = this.sessions.get(params.sessionId);
        if (s) {
          s.status = "COMPLETED";
          s.updatedAt = Date.now();
        }
      }
      if (params?.tokenUsage) {
        this.tokenUsage = {
          totalTokens: (this.tokenUsage.totalTokens || 0) + (params.tokenUsage.totalTokens || 0),
          inputTokens: (this.tokenUsage.inputTokens || 0) + (params.tokenUsage.inputTokens || 0),
          outputTokens: (this.tokenUsage.outputTokens || 0) + (params.tokenUsage.outputTokens || 0)
        };
      }
    } else if (method === "session/created" || method === "session/updated") {
      const s = params?.session || params;
      if (s?.id) {
        this.sessions.set(s.id, {
          id: s.id,
          title: s.title || s.name || `CLI Session ${s.id.slice(0, 6)}`,
          status: s.status || "IDLE",
          updatedAt: Date.now()
        });
      }
    }
  }

  async approveLatest() {
    if (this.pendingApprovals.size > 0) {
      const [id, req] = [...this.pendingApprovals.entries()][0];
      this.pendingApprovals.delete(id);

      // Reply according to method schema
      if (req.method.startsWith("item/commandExecution") || req.method.startsWith("item/fileChange")) {
        this.send({
          jsonrpc: "2.0",
          id,
          result: { decision: "accept" }
        });
      } else {
        this.send({
          jsonrpc: "2.0",
          id,
          result: { approved: true }
        });
      }
      return { ok: true, source: "rpc", id };
    }

    // Fallback: Terminal Enter keycode (36)
    return this.sendTerminalKeystroke(36);
  }

  async rejectLatest() {
    if (this.pendingApprovals.size > 0) {
      const [id, req] = [...this.pendingApprovals.entries()][0];
      this.pendingApprovals.delete(id);

      if (req.method.startsWith("item/commandExecution") || req.method.startsWith("item/fileChange")) {
        this.send({
          jsonrpc: "2.0",
          id,
          result: { decision: "reject" }
        });
      } else {
        this.send({
          jsonrpc: "2.0",
          id,
          result: { approved: false }
        });
      }
      return { ok: true, source: "rpc", id };
    }

    // Fallback: Terminal Escape (53) or Ctrl+C
    return this.sendTerminalKeystroke(53);
  }

  async focusTerminal() {
    const script = `
tell application "System Events"
  set termList to {"iTerm2", "Ghostty", "Terminal", "Code", "Alacritty"}
  repeat with termApp in termList
    if exists (application process termApp) then
      tell application termApp to activate
      return termApp
    end if
  end repeat
  tell application "Terminal" to activate
  return "Terminal"
end tell
`;
    try {
      const { stdout } = await execFileAsync("/usr/bin/osascript", ["-e", script], { timeout: 3000 });
      return stdout.trim();
    } catch {
      await execFileAsync("/usr/bin/open", ["-a", "Terminal"]).catch(() => {});
      return "Terminal";
    }
  }

  async sendTerminalKeystroke(keyCode) {
    await this.focusTerminal();
    const script = `
tell application "System Events"
  key code ${keyCode}
end tell
`;
    await execFileAsync("/usr/bin/osascript", ["-e", script], { timeout: 3000 });
    return { ok: true, source: "terminal", keyCode };
  }

  async queuePrompt(message) {
    if (!message) return { ok: false, error: "Empty prompt" };
    if (this.connected) {
      try {
        const res = await this.callRpc("turn/start", { message });
        return { ok: true, res };
      } catch (err) {
        // fallback to CLI
      }
    }

    // Fallback: invoke codex queue CLI
    try {
      await execFileAsync("codex", ["queue", "--message", message], { timeout: 5000 });
      return { ok: true, source: "cli" };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  }

  async resumeLast() {
    await this.focusTerminal();
    const script = `
tell application "System Events"
  keystroke "codex resume --last"
  key code 36
end tell
`;
    try {
      await execFileAsync("/usr/bin/osascript", ["-e", script], { timeout: 3000 });
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  }

  async checkCliProcess() {
    try {
      const { stdout } = await execFileAsync("/bin/ps", ["-axo", "command="], { timeout: 3000 });
      const lines = stdout.split("\n");
      return lines.some(line =>
        (line.includes("/bin/codex") || line.includes("@openai/codex")) &&
        !line.includes("bridge-codex-cli") &&
        !line.includes("com.ulanzi.codexcli")
      );
    } catch {
      return false;
    }
  }

  async readLocalCodexState() {
    const stateDb = path.join(this.codexHome, "state_5.sqlite");
    const historyDb = path.join(this.codexHome, "thread_history_1.sqlite");
    const locksDir = path.join(this.codexHome, "thread-writer-locks");

    let runningThreadId = null;
    let runningStartedAt = null;

    // 1. Check active locks
    try {
      if (fs.existsSync(locksDir)) {
        const lockFiles = fs.readdirSync(locksDir);
        for (const f of lockFiles) {
          if (f.endsWith(".lock") && f !== ".coordination.lock") {
            runningThreadId = f.replace(/\.lock$/, "");
            break;
          }
        }
      }
    } catch {}

    // 2. Query recent turns from thread_history_1.sqlite
    const turnStatusMap = new Map();
    try {
      if (fs.existsSync(historyDb)) {
        const { stdout } = await execFileAsync("/usr/bin/sqlite3", [
          "-readonly",
          "-json",
          historyDb,
          "SELECT thread_id, status, started_at, completed_at FROM thread_turns ORDER BY rowid DESC LIMIT 15;"
        ], { timeout: 2000 });
        const turns = JSON.parse(stdout || "[]");
        for (const t of turns) {
          if (!turnStatusMap.has(t.thread_id)) {
            turnStatusMap.set(t.thread_id, t);
            if (t.status === "running" && !runningThreadId) {
              runningThreadId = t.thread_id;
              runningStartedAt = t.started_at ? t.started_at * 1000 : Date.now();
            }
          }
        }
      }
    } catch {}

    // 3. Query threads from state_5.sqlite
    let dbThreads = [];
    try {
      if (fs.existsSync(stateDb)) {
        const { stdout } = await execFileAsync("/usr/bin/sqlite3", [
          "-readonly",
          "-json",
          stateDb,
          "SELECT id, title, model, tokens_used, updated_at FROM threads WHERE archived = 0 AND (model IS NULL OR model != 'codex-auto-review') ORDER BY updated_at DESC LIMIT 5;"
        ], { timeout: 2000 });
        dbThreads = JSON.parse(stdout || "[]");
      }
    } catch {}

    // 4. Fallback to session_index.jsonl if sqlite query was empty
    if (dbThreads.length === 0) {
      const indexFile = path.join(this.codexHome, "session_index.jsonl");
      try {
        if (fs.existsSync(indexFile)) {
          const lines = fs.readFileSync(indexFile, "utf8").trim().split("\n");
          for (let i = lines.length - 1; i >= Math.max(0, lines.length - 10); i--) {
            try {
              const item = JSON.parse(lines[i]);
              if (item.id && !dbThreads.some(d => d.id === item.id)) {
                dbThreads.push({
                  id: item.id,
                  title: item.thread_name || "CLI Session",
                  model: "Codex CLI",
                  tokens_used: 0,
                  updated_at: Math.floor(new Date(item.updated_at).getTime() / 1000)
                });
              }
            } catch {}
          }
        }
      } catch {}
    }

    return { dbThreads, runningThreadId, runningStartedAt, turnStatusMap };
  }

  async snapshot() {
    const isProcessRunning = await this.checkCliProcess();
    const { dbThreads, runningThreadId, runningStartedAt } = await this.readLocalCodexState();

    const isRunning = Boolean(runningThreadId || isProcessRunning || this.activeTurn);
    const pendingAttentionCount = this.pendingApprovals.size;

    let agentStatus = "IDLE";
    if (pendingAttentionCount > 0) {
      agentStatus = "ATTENTION";
    } else if (isRunning) {
      agentStatus = "WORKING";
    }

    const sessionList = [];
    for (const dbt of dbThreads) {
      const s = this.sessions.get(dbt.id) || {};
      const threadIsRunning = runningThreadId === dbt.id || (dbt.id === dbThreads[0]?.id && isProcessRunning);
      let status = "COMPLETED";
      if (threadIsRunning) {
        status = pendingAttentionCount > 0 ? "ATTENTION" : "WORKING";
      }

      sessionList.push({
        id: dbt.id,
        title: s.title || dbt.title || "CLI Session",
        model: dbt.model || "Codex CLI",
        status: s.status || status,
        tokens_used: dbt.tokens_used || 0,
        updatedAt: dbt.updated_at ? dbt.updated_at * 1000 : Date.now(),
        startedAt: threadIsRunning ? (runningStartedAt || Date.now()) : null
      });
    }

    // If socket has active sessions not in db yet, prepend them
    for (const [sid, s] of this.sessions.entries()) {
      if (!sessionList.some(item => item.id === sid)) {
        sessionList.unshift(s);
      }
    }

    const slots = Array.from({ length: 6 }, (_, id) => {
      const session = sessionList[id];
      if (session) {
        return {
          id,
          threadKey: session.id,
          title: session.title,
          status: session.status.toLowerCase(),
          selected: id === 0
        };
      }
      return {
        id,
        threadKey: null,
        title: null,
        status: "off",
        selected: false
      };
    });

    const activeTasks = sessionList.slice(0, 5).map((s, idx) => ({
      slot: idx,
      threadKey: s.id,
      title: s.title,
      status: s.status,
      model: s.model || "Codex CLI",
      elapsedSec: s.startedAt ? Math.floor((Date.now() - s.startedAt) / 1000) : 0,
      tokensUsed: s.tokens_used || 0
    }));

    const lastTask = activeTasks[0] || (isProcessRunning ? {
      title: "Codex CLI Active",
      status: agentStatus,
      model: "CLI",
      elapsedSec: 0
    } : null);

    const latestTokens = activeTasks[0]?.tokensUsed || 0;
    const totalTokens = this.tokenUsage?.totalTokens ? this.tokenUsage.totalTokens : latestTokens;

    return {
      connected: this.connected || isProcessRunning || dbThreads.length > 0,
      daemonConnected: this.connected,
      isProcessRunning,
      agentStatus,
      pendingAttentionCount,
      slots,
      activeTasks,
      lastTask,
      tokenUsage: {
        totalTokens,
        inputTokens: this.tokenUsage?.inputTokens || Math.round(totalTokens * 0.8),
        outputTokens: this.tokenUsage?.outputTokens || Math.round(totalTokens * 0.2)
      },
      updatedAt: Date.now()
    };
  }
}
