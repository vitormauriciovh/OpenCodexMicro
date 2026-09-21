export function mergeDesktopState(history, desktop, error = null) {
  const selectedThreadId = desktop?.activeThreadKey || null;
  const known = new Map((history.activeTasks || []).map(task => [task.threadKey, { ...task }]));
  for (const row of desktop?.tasks || []) {
    const task = { ...(known.get(row.threadKey) || { threadKey: row.threadKey, status: 'unknown' }), ...row };
    if (row.running) { task.status = "working"; task.agentStatus = "WORKING"; }
    if (row.threadKey === selectedThreadId) {
      task.status = desktop.activeStatus;
      task.agentStatus = desktop.activeStatus.toUpperCase();
      task.reasoningEffort = desktop.reasoningEffort || null;
      task.model = desktop.model || task.model;
      task.pendingFeedback = desktop.pendingApprovalCount > 0;
    }
    known.set(row.threadKey, task);
  }
  const tasks = [...known.values()].map(task => ({ ...task, selected: task.threadKey === selectedThreadId }));
  const selected = tasks.find(task => task.selected);
  const visible = tasks.slice(0, 6);
  if (selected && !visible.some(t => t.selected)) visible[5] = selected;
  return { ...history, applicationConnected: Boolean(desktop?.connected), selectedThreadId,
    activeThreadKey: selectedThreadId, desktopError: error,
    agentStatus: selected?.status?.toUpperCase() || history.agentStatus,
    lastTask: selected || null, tokenUsage: selected?.tokenUsage || null,
    pendingAttentionCount: tasks.filter(task => task.pendingFeedback || task.status === 'attention').length,
    activeTasks: visible, slots: Array.from({ length: 6 }, (_, id) => ({ id, ...(visible[id] || { threadKey: null, status: 'off', selected: false }) })),
    capabilities: { ...history.capabilities, select: Boolean(desktop), new: Boolean(desktop), pin: Boolean(desktop),
      approve: Boolean(desktop), reject: Boolean(desktop), stop: Boolean(desktop), submit: Boolean(desktop), prompt: Boolean(desktop),
      scroll: Boolean(desktop), mic: Boolean(desktop), model: Boolean(desktop),
      steer: Boolean(desktop?.controls?.steer), fork: Boolean(desktop?.controls?.fork), reasoning: Boolean(desktop?.controls?.reasoning) },
    desktopControls: desktop?.controls || {}, reasoningEffort: desktop?.reasoningEffort || null, composerHasText: desktop?.composerHasText || false };
}
