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
          dirStats.push({ name: entry.name, fullPath, mtimeMs: stat.mtimeMs });
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
    let startedAt = null;
    let pendingFeedback = false;
    let subagentsCount = 0;
    let hasPlan = false;
    let hasWalkthrough = false;

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
      const content = await fs.readFile(transcriptPath, "utf-8");
      const lines = content.trim().split("\n").filter(Boolean);

      // Extract title from early user message or plan
      for (let i = 0; i < Math.min(lines.length, 10); i++) {
        try {
          const entry = JSON.parse(lines[i]);
          if (entry.type === "USER_INPUT" && entry.content) {
            const rawText = typeof entry.content === "string" ? entry.content : "";
            const cleanText = rawText.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
            if (cleanText) {
              title = cleanText.slice(0, 32);
              break;
            }
          }
        } catch {}
      }

      // Check the latest entries for current activity
      if (lines.length > 0) {
        const lastEntry = JSON.parse(lines[lines.length - 1]);
        if (lastEntry.created_at) {
          startedAt = new Date(lastEntry.created_at).getTime();
        }

        if (pendingFeedback) {
          status = "attention";
        } else if (lastEntry.status === "ERROR") {
          status = "error";
        } else if (lastEntry.type === "PLANNER_RESPONSE" && lastEntry.status !== "DONE") {
          status = "working";
        } else if (lastEntry.type === "USER_INPUT") {
          status = "working";
        } else {
          // Check if tasks are active in tasks directory
          try {
            const tasksDir = path.join(convPath, ".system_generated/tasks");
            const taskFiles = await fs.readdir(tasksDir);
            if (taskFiles.length > 0) {
              status = "working";
            }
          } catch {}
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
      startedAt,
      pendingFeedback,
      subagentsCount,
      hasPlan,
      hasWalkthrough,
      mtimeMs: convDir.mtimeMs,
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
      startedAt: t.startedAt,
      pendingFeedback: t.pendingFeedback,
      hasPlan: t.hasPlan,
      hasWalkthrough: t.hasWalkthrough,
      fullPath: t.fullPath
    }));

    // Estimate context usage from active conversation
    let contextRemainingPercent = 95;
    if (activeTasks.length > 0 && activeTasks[0].fullPath) {
      try {
        const transcriptPath = path.join(activeTasks[0].fullPath, ".system_generated/logs/transcript.jsonl");
        const st = await fs.stat(transcriptPath);
        // Approx tokens = bytes / 4. Max context = 200k tokens (~800KB)
        const usedPercent = Math.min(99, Math.max(1, Math.round((st.size / 800000) * 100)));
        contextRemainingPercent = Math.max(1, 100 - usedPercent);
      } catch {}
    }

    // Next hour boundary for session reset
    const now = Date.now();
    const resetsAt = Math.ceil(now / 3600000) * 3600000;

    const usage = {
      windows: [
        { kind: "context", remainingPercent: contextRemainingPercent, resetsAt: null },
        { kind: "session", remainingPercent: 92, resetsAt }
      ]
    };

    return {
      connected: true,
      slots,
      activeTasks,
      lastTask: activeTasks[0] || null,
      pendingAttentionCount,
      subagentsCount: totalSubagentsCount,
      usage,
      updatedAt: Date.now()
    };
  }
}

