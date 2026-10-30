// Keep active tasks on stable keys; history is only shown when selected.
export class SessionSlots {
  constructor({ size = 6, graceMs = 30000 } = {}) {
    this.slots = Array(size).fill(null);
    this.graceMs = graceMs;
    this.selection = null;
  }
  update(tasks, selectedId, selectionVersion, now) {
    const byId = new Map(tasks.map(task => [task.threadKey, task]));
    const active = task => Boolean(task?.isRunning || task?.needsAttention);
    const selection = `${selectedId}:${selectionVersion}`;
    const selectionChanged = this.selection !== selection;
    this.selection = selection;
    for (let i = 0; i < this.slots.length; i++) {
      const slot = this.slots[i];
      if (!slot) continue;
      const task = byId.get(slot.threadKey);
      if (!task) { this.slots[i] = null; continue; }
      if (active(task)) { slot.expiresAt = null; slot.history = false; }
      else {
        slot.expiresAt ??= now + this.graceMs;
        if (selectionChanged && slot.threadKey === selectedId) slot.expiresAt = now + this.graceMs;
        if (now >= slot.expiresAt || (selectionChanged && slot.history && slot.threadKey !== selectedId)) this.slots[i] = null;
      }
    }
    const place = (task, history = false) => {
      if (!task || this.slots.some(slot => slot?.threadKey === task.threadKey)) return;
      let index = this.slots.indexOf(null);
      if (index < 0) {
        // Active work can reclaim a non-active key; never displace active work.
        index = this.slots.findIndex(slot => !active(byId.get(slot.threadKey)));
      }
      if (index >= 0) this.slots[index] = { threadKey: task.threadKey, history: history && !active(task), expiresAt: active(task) ? null : now + this.graceMs };
    };
    for (const task of tasks.filter(active)) place(task);
    if (selectionChanged) place(byId.get(selectedId), true);
    return this.slots.map((slot, id) => ({ id, ...(byId.get(slot?.threadKey) || { threadKey: null, title: null, status: 'off', selected: false }) }));
  }
}
