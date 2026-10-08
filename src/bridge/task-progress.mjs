// Serialized into the renderer. Read only the latest execution's structured plan.
export function readTaskProgress(conversation) {
  if (!conversation) return null;
  let turn;
  if (conversation.turnHistory?.kind === "canonical") {
    const history = conversation.turnHistory.history;
    const tail = history?.islands?.at(-1);
    if (tail?.newerBoundary?.status !== "exhausted") return null;
    const key = tail.entries?.at(-1)?.value;
    turn = key == null ? null : history.entitiesByKey?.[key];
  } else {
    turn = conversation.turns?.at(-1);
  }
  if (!turn?.turnId || !Array.isArray(turn.items)) return null;
  // Never search earlier turns: a new execution must not inherit a finished plan.
  const item = turn.items.findLast(item => item?.type === "todo-list");
  const plan = item?.plan;
  if (!Array.isArray(plan) || !plan.length || plan.length > 200) return null;
  const statuses = new Set(["pending", "inProgress", "in_progress", "completed"]);
  if (plan.some(step => typeof step?.step !== "string" || !statuses.has(step.status))) return null;
  const completed = plan.filter(step => step.status === "completed").length;
  const current = plan.find(step => ["inProgress", "in_progress"].includes(step.status))
    ?? plan.find(step => step.status === "pending");
  return { turnId: turn.turnId, completed, total: plan.length,
    currentStep: current?.step.slice(0, 240) ?? null };
}

// Resolve existing local native clients, without resuming or loading conversations.
export function readNativeTaskData(source, tasks, summarize) {
  const result = new Map();
  const clients = new Set();
  for (const node of new Set([source?.node, ...(source?.contextMap?.values?.() ?? [])])) {
    for (const members of node?.familyBindings?.values?.() ?? []) {
      if (!(members instanceof Map)) continue;
      try {
        const signal = members.get("local")?.value;
        const client = typeof signal?.get === "function" ? signal.get()
          : typeof signal?.resolve === "function" ? node.store.get(signal.resolve(node, source.contextMap)) : null;
        if (client?.hostId === "local" && !client.disposed && typeof client.getConversation === "function") clients.add(client);
      } catch { /* Optional binding may have been disposed. */ }
    }
  }
  for (const task of tasks) {
    if (!task?.threadId || !task.threadKey?.startsWith("local:")) continue;
    for (const client of clients) {
      try {
        const conversation = client.getConversation(task.threadId);
        if (conversation?.id !== task.threadId || conversation.hostId !== "local") continue;
        result.set(task.threadKey, summarize(conversation));
        break;
      } catch { /* Unavailable history stays unknown. */ }
    }
  }
  return result;
}

// Copy only public task metrics, never prompts, history or permission settings.
export function taskMetadata(conversation) {
  return {
    id: conversation.id,
    title: conversation.title,
    originator: conversation.originator,
    latestModel: conversation.latestModel,
    latestThreadSettings: { model: conversation.latestThreadSettings?.model },
    previousTurnModel: conversation.previousTurnModel,
    latestReasoningEffort: conversation.latestReasoningEffort,
    threadRuntimeStatus: conversation.threadRuntimeStatus,
    latestTokenUsageInfo: conversation.latestTokenUsageInfo ?? null
  };
}
