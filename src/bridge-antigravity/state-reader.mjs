import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";

// A model quota without an explicit window does not establish either account
// allowance. In particular GetUserStatus.quotaInfo cannot be labeled "5h".
export function windowedQuotaSummary(data) {
  const groups = Array.isArray(data?.response?.groups) ? data.response.groups : [];
  const group = groups.find(item => item.displayName?.includes("Gemini")) || groups[0];
  const buckets = Array.isArray(group?.buckets) ? group.buckets : [];
  const readWindow = name => {
    const matches = buckets.filter(bucket => bucket.window === name);
    if (matches.length !== 1) return { remaining: null, reset: null };
    const bucket = matches[0], fraction = bucket.remainingFraction;
    if (typeof fraction !== "number" || !Number.isFinite(fraction) || fraction < 0 || fraction > 1) return { remaining: null, reset: null };
    const reset = typeof bucket.resetTime === "string" ? Date.parse(bucket.resetTime) : NaN;
    return { remaining: Math.round(fraction * 100), reset: Number.isFinite(reset) ? reset : null };
  };
  const fiveHour = readWindow("5h"), weekly = readWindow("weekly");
  if (fiveHour.remaining === null && weekly.remaining === null) return null;
  return { fiveHourRemaining: fiveHour.remaining, fiveHourReset: fiveHour.reset,
    weeklyRemaining: weekly.remaining, weeklyReset: weekly.reset };
}

export class AntigravityStateReader {
  constructor(options = {}) {
    this.brainDir = options.brainDir || process.env.ANTIGRAVITY_BRAIN_DIR || path.join(os.homedir(), ".gemini/antigravity/brain");
    this.cachedState = null;
    this.lastReadTime = 0;
    this.transcriptCache = new Map();
    this.quotaTtl = options.quotaTtl ?? 60000;
    this.fetch = options.fetchImpl || fetch;
    this.quotaFetch = options.quotaFetch || (() => this.fetchLiveAgyQuota());
  }

  async getConversationDirs() {
    try {
      const entries = await fs.readdir(this.brainDir, { withFileTypes: true });
      const dirStats = [];
      for (const entry of entries) {
        if (!entry.isDirectory() || entry.name.startsWith(".") || entry.name === "tempmediaStorage") {
          continue;
        }
        const fullPath = path.join(this.brainDir, entry.name);
        try {
          const stat = await fs.stat(fullPath);
          let mtimeMs = stat.mtimeMs;
          try {
            const transcriptStat = await fs.stat(path.join(fullPath, ".system_generated/logs/transcript.jsonl"));
            if (transcriptStat.mtimeMs > mtimeMs) {
              mtimeMs = transcriptStat.mtimeMs;
            }
          } catch {}
          dirStats.push({ name: entry.name, fullPath, mtimeMs });
        } catch {
          // ignore stat errors
        }
      }
      dirStats.sort((a, b) => b.mtimeMs - a.mtimeMs);
      return dirStats;
    } catch {
      return [];
    }
  }

  async readConversationDetails(convDir) {
    const convPath = convDir.fullPath;
    const convId = convDir.name;
    let title = convId.slice(0, 8);
    let status = "idle";
    let agentStatus = "IDLE";
    let startedAt = null;
    let pendingFeedback = false;
    let subagentsCount = 0;  // Will be parsed from transcript tool_calls
    let hasPlan = false;
    let hasWalkthrough = false;
    let transcriptMtimeMs = convDir.mtimeMs;
    let planMtimeMs = 0;

    // 1. Check all artifact metadata files in conversation directory for requestFeedback
    try {
      const files = await fs.readdir(convPath);
      for (const file of files) {
        if (file.endsWith(".metadata.json")) {
          try {
            const metaPath = path.join(convPath, file);
            const stat = await fs.stat(metaPath);
            if (stat.mtimeMs > planMtimeMs) {
              planMtimeMs = stat.mtimeMs;
            }
            const metaRaw = await fs.readFile(metaPath, "utf-8");
            const meta = JSON.parse(metaRaw);
            if (file.startsWith("implementation_plan")) {
              hasPlan = true;
            }
            if (meta.requestFeedback === true || meta.RequestFeedback === true) {
              pendingFeedback = true;
            }
          } catch {}
        }
      }
    } catch {
      // no metadata files
    }

    try { await fs.access(path.join(convPath, "implementation_plan.md")); hasPlan = true; } catch {}
    try {
      await fs.access(path.join(convPath, "walkthrough.md"));
      hasWalkthrough = true;
    } catch {
      // no walkthrough
    }

    // 2. Read transcript for title & status
    const transcriptPath = path.join(convPath, ".system_generated/logs/transcript.jsonl");
    try {
      const tStat = await fs.stat(transcriptPath);
      transcriptMtimeMs = tStat.mtimeMs;
      let cached = this.transcriptCache.get(transcriptPath);
      if (!cached || cached.mtimeMs !== tStat.mtimeMs || cached.size !== tStat.size) {
        const content = await fs.readFile(transcriptPath, "utf-8");
        cached = { mtimeMs: tStat.mtimeMs, size: tStat.size, lines: content.trim().split("\n").filter(Boolean) };
        this.transcriptCache.set(transcriptPath, cached);
        while (this.transcriptCache.size > 6) this.transcriptCache.delete(this.transcriptCache.keys().next().value);
      }
      const lines = cached.lines;

      // Extract title, model & subagents:
      let initialTitle = convId.slice(0, 8);
      let latestPrompt = "";
      let detectedModel = null;
      let lastUserInputIndex = -1;
      let lastUserInputTime = 0;
      let invokedSubagentIds = new Set();
      let killedSubagentIds = new Set();
      let killedAll = false;

      let lastPlannerResponseIndex = -1;

      for (let i = 0; i < lines.length; i++) {
        try {
          const entry = JSON.parse(lines[i]);
          if (entry.type === "USER_INPUT") {
            lastUserInputIndex = i;
            if (entry.created_at) {
              lastUserInputTime = new Date(entry.created_at).getTime();
            }
            if (entry.content) {
              const rawText = typeof entry.content === "string" ? entry.content : "";
              const cleanText = rawText.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
              if (cleanText) {
                if (!initialTitle || initialTitle === convId.slice(0, 8)) {
                  initialTitle = cleanText.slice(0, 32);
                }
                latestPrompt = cleanText.slice(0, 32);
              }
            }
          } else if (entry.type === "PLANNER_RESPONSE") {
            lastPlannerResponseIndex = i;
          }
          const contentStr = typeof entry.content === "string" ? entry.content : "";
          const modelMatch = contentStr.match(/Model Selection`?\s*from\s*[^ ]+\s*to\s*([^<\n\r]+)/i);
          if (modelMatch) {
            detectedModel = modelMatch[1].trim();
          }

          // Track subagent invocations and kills
          if (Array.isArray(entry.tool_calls)) {
            for (const tc of entry.tool_calls) {
              const tcName = tc?.name || tc?.function?.name || "";
              if (tcName === "invoke_subagent") {
                const subs = tc?.arguments?.Subagents || tc?.function?.arguments?.Subagents || [];
                for (const sub of (Array.isArray(subs) ? subs : [])) {
                  const id = sub?.conversationId || sub?.TypeName || `sub-${invokedSubagentIds.size}`;
                  invokedSubagentIds.add(id);
                }
                // Also check tool result for created conversation IDs
                const result = typeof tc?.result === "string" ? tc.result : "";
                const convIdMatches = result.match(/"conversationId"\s*:\s*"([^"]+)"/g);
                if (convIdMatches) {
                  for (const m of convIdMatches) {
                    const idMatch = m.match(/"([^"]+)"$/);
                    if (idMatch) invokedSubagentIds.add(idMatch[1]);
                  }
                }
              }
              if (tcName === "manage_subagents") {
                const action = tc?.arguments?.Action || tc?.function?.arguments?.Action || "";
                if (action === "kill_all") {
                  killedAll = true;
                } else if (action === "kill") {
                  const ids = tc?.arguments?.ConversationIds || tc?.function?.arguments?.ConversationIds || [];
                  for (const id of (Array.isArray(ids) ? ids : [])) {
                    killedSubagentIds.add(id);
                  }
                }
              }
            }
          }
        } catch {}
      }

      if (killedAll) {
        subagentsCount = 0;
      } else {
        subagentsCount = Math.max(0, invokedSubagentIds.size - killedSubagentIds.size);
      }
      title = latestPrompt || initialTitle;

      // Preserve the model identifier from evidence. Transcript characters
      // cannot reveal the model's actual context capacity or compaction state.
      const model = detectedModel || null;
      const modelContextWindow = null;

      // Token usage calculation aligned with Codex schema
      let totalInputChars = 0;
      let totalOutputChars = 0;
      let lastTurnInputChars = 0;
      let lastTurnOutputChars = 0;

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const isLastTurn = lastUserInputIndex >= 0 && i >= lastUserInputIndex;
        try {
          const entry = JSON.parse(line);
          const type = entry.type || "";
          if (type === "PLANNER_RESPONSE") {
            const outLen = (entry.content?.length || 0) + (entry.thinking?.length || 0) + (entry.tool_calls ? JSON.stringify(entry.tool_calls).length : 0);
            totalOutputChars += outLen;
            if (isLastTurn) lastTurnOutputChars += outLen;
          } else {
            const inLen = entry.content ? (typeof entry.content === "string" ? entry.content.length : JSON.stringify(entry.content).length) : line.length;
            totalInputChars += inLen;
            if (isLastTurn) lastTurnInputChars += inLen;
          }
        } catch {
          totalInputChars += line.length;
          if (isLastTurn) lastTurnInputChars += line.length;
        }
      }

      // Approximate transcript size at 3.5 characters/token; this is not billed usage.
      const inputTokens = Math.round(totalInputChars / 3.5);
      const outputTokens = Math.round(totalOutputChars / 3.5);
      const totalTokens = inputTokens + outputTokens;

      const lastTurnInputTokens = Math.round(lastTurnInputChars / 3.5);
      const lastTurnOutputTokens = Math.round(lastTurnOutputChars / 3.5);
      const lastTurnTokens = lastTurnInputTokens + lastTurnOutputTokens;

      const activeContextTokens = null;
      const ctxPct = null;

      const tokenUsage = {
        total: {
          totalTokens,
          inputTokens,
          outputTokens
        },
        last: {
          totalTokens: lastTurnTokens,
          inputTokens: lastTurnInputTokens,
          outputTokens: lastTurnOutputTokens
        },
        contextTokens: activeContextTokens,
        modelContextWindow,
        estimated: true,
        source: "transcript-character-estimate",
        usedPercent: ctxPct,
        percentage: ctxPct
      };

      agentStatus = "IDLE";
      // Check the latest entries for current activity
      if (lines.length > 0) {
        let lastEntry = null;
        try {
          lastEntry = JSON.parse(lines[lines.length - 1]);
        } catch {}

        if (lastEntry?.created_at) {
          startedAt = new Date(lastEntry.created_at).getTime();
        }

        const ageMs = Date.now() - transcriptMtimeMs;
        const isRecentlyActive = ageMs < 15000;
        const isRecentlyCompleted = ageMs < 8000;

        // Check if plan or artifact is awaiting feedback and no user reply has followed
        // ONLY pending if the artifact was modified AFTER the last user input
        const isPlanPending = pendingFeedback && (planMtimeMs > lastUserInputTime);
        if (!isPlanPending) {
          pendingFeedback = false;
        }

        const entryStatus = String(lastEntry?.status || "").toUpperCase();
        const isWaitingStatus = entryStatus === "WAITING_FOR_INPUT" || entryStatus === "WAITING" || entryStatus === "NEEDS_INPUT";

        // ask_question is actively waiting for user input if the last transcript entry is the PLANNER_RESPONSE invoking it
        const hasActiveAskQuestion = lastEntry?.type === "PLANNER_RESPONSE" && Array.isArray(lastEntry?.tool_calls) && lastEntry.tool_calls.some(tc => {
          const name = tc?.name || tc?.function?.name || "";
          return name === "ask_question";
        });

        if (isPlanPending || isWaitingStatus || hasActiveAskQuestion) {
          status = "attention";
          agentStatus = "WAITING";
          pendingFeedback = true;
        } else if (isRecentlyActive) {
          if (entryStatus === "ERROR") {
            status = "error";
            agentStatus = "ERROR";
          } else if (lastEntry?.type === "USER_INPUT") {
            status = "working";
            agentStatus = "PLANNING";
          } else if (lastEntry?.type === "GENERIC") {
            status = "working";
            agentStatus = "EXECUTING";
          } else if (lastEntry?.type === "PLANNER_RESPONSE") {
            const hasTools = Array.isArray(lastEntry.tool_calls) && lastEntry.tool_calls.length > 0;
            if (entryStatus !== "DONE") {
              status = "working";
              agentStatus = hasTools ? "EXECUTING" : "PLANNING";
            } else {
              status = isRecentlyCompleted ? "completed" : "idle";
              agentStatus = "IDLE";
            }
          } else {
            status = "working";
            agentStatus = "EXECUTING";
          }
        } else {
          status = entryStatus === "DONE" ? "completed" : entryStatus === "ERROR" ? "error" : "unknown";
          agentStatus = status === "unknown" ? "UNKNOWN" : status === "error" ? "ERROR" : "IDLE";
        }
      }

      return {
        id: convId,
        threadKey: convId,
        title,
        status,
        agentStatus: agentStatus || "IDLE",
        startedAt,
        model,
        ctxPct,
        tokenUsage,
        pendingFeedback,
        subagentsCount,
        hasPlan,
        hasWalkthrough,
        mtimeMs: transcriptMtimeMs,
        fullPath: convPath
      };
    } catch {
      // transcript read error or empty
      return {
        id: convId,
        threadKey: convId,
        title,
        status,
        agentStatus: agentStatus || "IDLE",
        startedAt,
        model: null,
        ctxPct: null,
        tokenUsage: null,
        pendingFeedback,
        subagentsCount,
        hasPlan,
        hasWalkthrough,
        mtimeMs: transcriptMtimeMs,
        fullPath: convPath
      };
    }
  }

  async snapshot() {
    const dirs = await this.getConversationDirs();
    if (dirs.length === 0) {
      return {
        schemaVersion: 1,
      connected: true,
      applicationConnected: null,
      capabilities: { approve: false, stop: false, navigate: false, scroll: false, artifacts: true },
        slots: Array.from({ length: 6 }, (_, id) => ({
          id, threadKey: null, title: null, status: "off", selected: false
        })),
        activeTasks: [],
        lastTask: null,
        pendingAttentionCount: 0,
        subagentsCount: 0,
        updatedAt: Date.now()
      };
    }

    const tasks = [];
    let pendingAttentionCount = 0;
    let totalSubagentsCount = 0;

    for (let i = 0; i < Math.min(dirs.length, 6); i++) {
      const detail = await this.readConversationDetails(dirs[i]);
      tasks.push(detail);
      if (detail.status === "attention" || detail.pendingFeedback) {
        pendingAttentionCount++;
      }
      totalSubagentsCount += detail.subagentsCount || 0;
    }

    const slots = Array.from({ length: 6 }, (_, id) => {
      const task = tasks[id];
      if (!task) {
        return { id, threadKey: null, title: null, status: "off", selected: false };
      }
      return {
        id,
        threadKey: task.threadKey,
        title: task.title,
        status: task.status,
        startedAt: task.startedAt,
        model: task.model,
        ctxPct: task.ctxPct,
        tokenUsage: task.tokenUsage,
        selected: id === 0
      };
    });

    const activeTasks = tasks.map((t, idx) => ({
      index: idx,
      id: t.id,
      threadKey: t.threadKey,
      title: t.title,
      status: t.status,
      agentStatus: t.agentStatus || "IDLE",
      startedAt: t.startedAt,
      model: t.model,
      ctxPct: t.ctxPct,
      tokenUsage: t.tokenUsage,
      pendingFeedback: t.pendingFeedback,
      hasPlan: t.hasPlan,
      hasWalkthrough: t.hasWalkthrough,
      fullPath: t.fullPath
    }));

    const usage = await this.calculateRollingUsage(dirs);

    return {
      schemaVersion: 1,
      connected: true,
      applicationConnected: null,
      capabilities: { approve: false, stop: false, navigate: false, scroll: false, artifacts: true },
      agentStatus: tasks[0]?.agentStatus || "IDLE",
      slots,
      activeTasks,
      lastTask: activeTasks[0] || null,
      tokenUsage: tasks[0]?.tokenUsage || null,
      pendingAttentionCount,
      subagentsCount: totalSubagentsCount,
      usage,
      updatedAt: Date.now()
    };
  }

  async fetchLiveAgyQuota() {
    try {
      const { execFile } = await import("node:child_process");
      const { promisify } = await import("node:util");
      const execFileAsync = promisify(execFile);

      // Cache the discovered port for 10 seconds to avoid running ps aux every 500ms
      const now = Date.now();
      if (this._cachedAgyPort && this._cachedAgyPortTime && (now - this._cachedAgyPortTime) < 10000) {
        // Use cached port
      } else {
        try {
          const { stdout: ps } = await execFileAsync("/bin/ps", ["aux"], { timeout: 2000 });
          const lines = ps.split("\n").filter(l => /agy.*--hub-port=/.test(l) && !/grep/.test(l));
          const match = lines[0]?.match(/--hub-port=(\d+)/);
          this._cachedAgyPort = match ? Number(match[1]) : 51548;
        } catch {
          this._cachedAgyPort = this._cachedAgyPort || 51548;
        }
        this._cachedAgyPortTime = now;
      }
      const port = this._cachedAgyPort;

      const htmlRes = await this.fetch(`http://127.0.0.1:${port}/`, { signal: AbortSignal.timeout(1000) });
      if (!htmlRes.ok) return null;
      const html = await htmlRes.text();
      const csrfMatch = html.match(/"csrfToken":"([^"]+)"/);
      const csrfToken = csrfMatch ? csrfMatch[1] : null;
      if (!csrfToken) return null;

      const summaryRes = await this.fetch(`http://127.0.0.1:${port}/exa.language_server_pb.LanguageServerService/RetrieveUserQuotaSummary`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-codeium-csrf-token": csrfToken },
        body: "{}",
        signal: AbortSignal.timeout(1200)
      });
      if (!summaryRes.ok) return null;
      return windowedQuotaSummary(await summaryRes.json());
    } catch {
      // Missing or invalid measured quota remains unknown.
    }
    return null;
  }

  async calculateRollingUsage() {
    const now = Date.now();
    if (this.quotaCache && now - this.quotaCache.observedAt < this.quotaTtl) return this.quotaCache;
    const live = await this.quotaFetch();
    this.quotaCache = {
      windows: [
        { id: "five-hour", kind: "five-hour", remainingPercent: live?.fiveHourRemaining ?? null, resetsAt: live?.fiveHourReset ?? null },
        { id: "weekly", kind: "weekly", remainingPercent: live?.weeklyRemaining ?? null, resetsAt: live?.weeklyReset ?? null }
      ].map(window => ({ ...window, usedPercent: window.remainingPercent == null ? null : 100 - window.remainingPercent })),
      source: live ? "live-quota" : "unavailable", estimated: false, observedAt: now
    };
    return this.quotaCache;
  }
}
