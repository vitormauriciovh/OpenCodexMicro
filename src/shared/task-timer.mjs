// Wall-clock execution duration. Waiting is part of the same execution.
export class TaskTimers {
  constructor() { this.entries = new Map(); }
  observe(key, { status, startedAt = null, runId = null, elapsedSec = null }, now = Date.now()) {
    const running = ['active', 'working', 'thinking', 'running', 'in_progress', 'executing', 'planning', 'attention', 'notification', 'input', 'approval', 'waiting_input', 'needs_input', 'waiting', 'feedback', 'awaiting-approval', 'awaiting-response'].includes(String(status).toLowerCase());
    let entry = this.entries.get(key);
    if (running) {
      if (!entry || entry.endedAt != null || (runId && entry.runId && runId !== entry.runId)) {
        entry = { startedAt: Number.isFinite(startedAt) ? startedAt : now, endedAt: null, runId };
        this.entries.set(key, entry);
      } else {
        if (Number.isFinite(startedAt)) entry.startedAt = startedAt;
        if (runId) entry.runId = runId;
      }
    } else if (entry && entry.endedAt == null) {
      entry.endedAt = Number.isFinite(elapsedSec) ? entry.startedAt + elapsedSec * 1000 : now;
    }
    return this.elapsed(key, now);
  }
  elapsed(key, now = Date.now()) {
    const entry = this.entries.get(key);
    return entry ? Math.max(0, (entry.endedAt ?? now) - entry.startedAt) : null;
  }
  retain(keys) { for (const key of this.entries.keys()) if (!keys.has(key)) this.entries.delete(key); }
  clear() { this.entries.clear(); }
}
