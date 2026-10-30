import { protectDirectory } from "../platform/windows/privacy.mjs";
import { readFileSync, statSync, mkdirSync, chmodSync, writeFileSync, renameSync, rmSync } from "node:fs";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";

// Only deck drafts live here, never Codex credentials or conversation history.
export class CliDraftStore {
  constructor(file) { this.file = file; }
  load() {
    try {
      if (process.platform === "win32") protectDirectory(dirname(this.file));
      if (statSync(this.file).size > 10 * 1024 * 1024) throw new Error("Draft file is too large");
      const data = JSON.parse(readFileSync(this.file, "utf8"));
      if (data.version !== 1 || !Array.isArray(data.drafts) || data.drafts.length > 100) throw new Error("Invalid draft file");
      const seen = new Set();
      for (const entry of data.drafts) {
        if (!entry || typeof entry.threadId !== "string" || !entry.threadId || entry.threadId.length > 512 || seen.has(entry.threadId) ||
            typeof entry.text !== "string" || entry.text.length > 16000 || !["ready", "uncertain"].includes(entry.delivery)) throw new Error("Invalid draft entry");
        seen.add(entry.threadId);
      }
      chmodSync(this.file, 0o600);
      return data.drafts;
    } catch (error) {
      if (error.code === "ENOENT") return [];
      throw new Error("Saved drafts could not be read; the existing file was preserved");
    }
  }
  save(drafts, uncertain) {
    if (drafts.size > 100) throw new Error("The limit of 100 saved drafts was reached; clear or send a draft first");
    const data = { version: 1, drafts: [...drafts].map(([threadId, text]) => ({ threadId, text, delivery: uncertain.has(threadId) ? "uncertain" : "ready" })) };
    const directory = dirname(this.file), temp = `${this.file}.${randomUUID()}.tmp`;
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    chmodSync(directory, 0o700);
    if (process.platform === "win32") protectDirectory(directory);
    try {
      writeFileSync(temp, JSON.stringify(data) + "\n", { mode: 0o600, flag: "wx" });
      renameSync(temp, this.file);
    } finally { rmSync(temp, { force: true }); }
  }
}
