import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";

export class AntigravityStateReader {
  constructor(options = {}) {
    this.brainDir = options.brainDir || process.env.ANTIGRAVITY_BRAIN_DIR || path.join(os.homedir(), ".gemini/antigravity/brain");
    this.cachedState = null;
    this.lastReadTime = 0;
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
    let subagentsCount = 0;
    let hasPlan = false;
    let hasWalkthrough = false;
    let transcriptMtimeMs = convDir.mtimeMs;

    // 1. Check implementation_plan.md & metadata
    try {
      const planMetaPath = path.join(convPath, "implementation_plan.md.metadata.json");
      const metaRaw = await fs.readFile(planMetaPath, "utf-8");
      const meta = JSON.parse(metaRaw);
      hasPlan = true;
      if (meta.RequestFeedback === true) {
        pendingFeedback = true;
      }
    } catch {
      // no plan metadata
    }

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
      const content = await fs.readFile(transcriptPath, "utf-8");
      const lines = content.trim().split("\n").filter(Boolean);

      // Extract title: first try latest user message, fallback to initial message
      let initialTitle = convId.slice(0, 8);
      let latestPrompt = "";
      for (let i = 0; i < lines.length; i++) {
        try {
          const entry = JSON.parse(lines[i]);
          if (entry.type === "USER_INPUT" && entry.content) {
            const rawText = typeof entry.content === "string" ? entry.content : "";
            const cleanText = rawText.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
            if (cleanText) {
              if (!initialTitle || initialTitle === convId.slice(0, 8)) {
                initialTitle = cleanText.slice(0, 32);
              }
              latestPrompt = cleanText.slice(0, 32);
            }
          }
        } catch {}
      }
      title = latestPrompt || initialTitle;

      agentStatus = "IDLE";
      // Check the latest entries for current activity
      if (lines.length > 0) {
        let lastEntry = null;
        let lastUserInputIndex = -1;
        for (let i = lines.length - 1; i >= 0; i--) {
          try {
            const entry = JSON.parse(lines[i]);
            if (entry.type === "USER_INPUT" && lastUserInputIndex === -1) {
              lastUserInputIndex = i;
            }
          } catch {}
        }

        try {
          lastEntry = JSON.parse(lines[lines.length - 1]);
        } catch {}

        if (lastEntry?.created_at) {
          startedAt = new Date(lastEntry.created_at).getTime();
        }

        const ageMs = Date.now() - transcriptMtimeMs;
        const isRecentlyActive = ageMs < 15000;
        const isRecentlyCompleted = ageMs < 8000;

        if (pendingFeedback && ageMs < 60000) {
          status = "attention";
          agentStatus = "WAITING";
        } else if (isRecentlyActive) {
          if (lastEntry?.status === "ERROR") {
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
            if (lastEntry.status !== "DONE" || hasTools) {
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
          status = isRecentlyCompleted ? "completed" : "idle";
          agentStatus = "IDLE";
        }
      }
    } catch {
      // transcript read error or empty
    }

    return {
      id: convId,
      threadKey: convId,
      title,
      status,
      agentStatus: agentStatus || "IDLE",
      startedAt,
      pendingFeedback,
      subagentsCount,
      hasPlan,
      hasWalkthrough,
      mtimeMs: transcriptMtimeMs,
      fullPath: convPath
    };
  }

  async snapshot() {
    const dirs = await this.getConversationDirs();
    if (dirs.length === 0) {
      return {
        connected: true,
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
      pendingFeedback: t.pendingFeedback,
      hasPlan: t.hasPlan,
      hasWalkthrough: t.hasWalkthrough,
      fullPath: t.fullPath
    }));

    const usage = await this.calculateRollingUsage(dirs);

    return {
      connected: true,
      agentStatus: tasks[0]?.agentStatus || "IDLE",
      slots,
      activeTasks,
      lastTask: activeTasks[0] || null,
      pendingAttentionCount,
      subagentsCount: totalSubagentsCount,
      usage,
      updatedAt: Date.now()
    };
  }

  async fetchLiveAgyQuota() {
    try {
      const { execSync } = await import("node:child_process");
      const ps = execSync("ps aux | grep -E \"agy.*--hub-port=\" | grep -v grep", { timeout: 1000 }).toString();
      const match = ps.match(/--hub-port=(\d+)/);
      const port = match ? Number(match[1]) : 65350;

      const htmlRes = await fetch(`http://127.0.0.1:${port}/`, { signal: AbortSignal.timeout(1000) });
      const html = await htmlRes.text();
      const csrfMatch = html.match(/"csrfToken":"([^"]+)"/);
      const csrfToken = csrfMatch ? csrfMatch[1] : null;
      if (!csrfToken) return null;

      const statusRes = await fetch(`http://127.0.0.1:${port}/exa.language_server_pb.LanguageServerService/GetUserStatus`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-codeium-csrf-token": csrfToken
        },
        body: "{}",
        signal: AbortSignal.timeout(1200)
      });
      const data = await statusRes.json();
      const configs = data?.userStatus?.cascadeModelConfigData?.clientModelConfigs || [];
      const geminiConfig = configs.find(c => c.label && c.label.includes("Gemini") && c.quotaInfo) || configs.find(c => c.quotaInfo);

      if (geminiConfig?.quotaInfo) {
        const remaining = Math.round(Number(geminiConfig.quotaInfo.remainingFraction) * 100);
        const resetMs = new Date(geminiConfig.quotaInfo.resetTime).getTime();
        return {
          fiveHourRemaining: Math.max(0, Math.min(100, remaining)),
          fiveHourReset: resetMs
        };
      }
    } catch {
      // fallback
    }
    return null;
  }

  async calculateRollingUsage(dirs) {
    const now = Date.now();
    const liveQuota = await this.fetchLiveAgyQuota();

    const fiveHoursAgo = now - 5 * 3600 * 1000;
    const sevenDaysAgo = now - 7 * 24 * 3600 * 1000;

    let turnsLast5h = 0;
    let turnsLast7d = 0;
    let oldestIn5h = null;

    for (const dir of dirs || []) {
      const transcriptPath = path.join(dir.fullPath, ".system_generated/logs/transcript.jsonl");
      try {
        const content = await fs.readFile(transcriptPath, "utf-8");
        const lines = content.trim().split("\n").filter(Boolean);
        for (const line of lines) {
          try {
            const item = JSON.parse(line);
            if (item.type === "USER_INPUT" && item.created_at) {
              const t = new Date(item.created_at).getTime();
              if (t >= fiveHoursAgo) {
                turnsLast5h++;
                if (oldestIn5h === null || t < oldestIn5h) {
                  oldestIn5h = t;
                }
              }
              if (t >= sevenDaysAgo) {
                turnsLast7d++;
              }
            }
          } catch {}
        }
      } catch {}
    }

    const fiveHourUsed = Math.min(99, Math.max(1, Math.round((turnsLast5h / 50) * 100)));
    const fiveHourRemaining = liveQuota ? liveQuota.fiveHourRemaining : Math.max(1, 100 - fiveHourUsed);
    const fiveHourReset = liveQuota?.fiveHourReset || (oldestIn5h ? oldestIn5h + 5 * 3600 * 1000 : now + 5 * 3600 * 1000);

    // Weekly limit: calculated from weekly rolling activity (calibrated to quota scale)
    const weeklyUsed = Math.min(99, Math.max(1, Math.round((turnsLast7d / 200) * 100)));
    const weeklyRemaining = Math.max(1, 100 - weeklyUsed);

    const d = new Date(now);
    const day = d.getUTCDay();
    const daysUntilMon = (8 - day) % 7 || 7;
    const weeklyReset = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + daysUntilMon, 0, 0, 0)).getTime();

    return {
      windows: [
        {
          id: "five-hour",
          kind: "five-hour",
          usedPercent: 100 - fiveHourRemaining,
          remainingPercent: fiveHourRemaining,
          resetsAt: fiveHourReset
        },
        {
          id: "weekly",
          kind: "weekly",
          usedPercent: 100 - weeklyRemaining,
          remainingPercent: weeklyRemaining,
          resetsAt: weeklyReset
        }
      ],
      observedAt: now
    };
  }
}

