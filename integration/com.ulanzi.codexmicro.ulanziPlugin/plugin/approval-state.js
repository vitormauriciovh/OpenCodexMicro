export function hasSelectedApproval(state) {
  if (!state?.connected || !state.activeThreadKey) return false;
  const normalize = key => String(key ?? "").replace(/^local:/, "");
  const activeKey = normalize(state.activeThreadKey);
  const slots = Array.isArray(state.slots) ? state.slots : [];
  const activeTasks = Array.isArray(state.activeTasks) ? state.activeTasks : [];
  const matches = task => [task?.threadKey, task?.threadId].some(key =>
    key != null && normalize(key) === activeKey);
  let task = slots.find(matches) ?? activeTasks.find(matches);
  if (!task) {
    // Native slots can retain the client alias after the open task gets its
    // permanent ID. Only the uniquely selected native slot identifies it.
    const selected = slots.filter(slot => slot?.selected);
    if (selected.length === 1 && normalize(selected[0].threadKey).startsWith("client-new-thread:")) {
      task = selected[0];
    }
  }
  return ["approval", "awaiting-approval"].includes(String(task?.status ?? "").toLowerCase());
}
