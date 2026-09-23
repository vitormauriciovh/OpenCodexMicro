// Runs inside the renderer. Read existing native bindings rather than parsing
// question text or depending on version-specific, minified export names.
export function readNativeTaskAttention(source, slots) {
  const threadIds = new Map();
  const asyncQuestionThreads = new Set();
  const nodes = new Set([source?.node, ...(source?.contextMap?.values?.() ?? [])]);
  const threadKeys = slots.map(slot => slot?.threadKey).filter(key => typeof key === "string");
  for (const node of nodes) {
    if (!(node?.familyBindings instanceof Map)) continue;
    const read = binding => {
      const signal = binding?.value;
      if (typeof signal?.get === "function") return signal.get();
      if (typeof signal?.resolve === "function" && node.store?.get) {
        return node.store.get(signal.resolve(node, source.contextMap));
      }
      return null;
    };
    for (const members of node.familyBindings.values()) {
      if (!(members instanceof Map)) continue;
      try {
        // Native async-question groups are keyed by host, then thread ID.
        // Answering, dismissing or expiring a question removes its group.
        const groups = read(members.get("local"));
        if (groups instanceof Map) {
          for (const [threadId, group] of groups) {
            const key = group?.selectedQuestionKey;
            if (typeof threadId !== "string" || key?.hostId !== "local" || key.threadId !== threadId ||
                !Array.isArray(group.questionIds) || !group.questionIds.includes(key.itemId)) continue;
            let item;
            try { item = JSON.parse(key.itemId); } catch { continue; }
            if (Array.isArray(item) && item[0] === "request_user_input_async") asyncQuestionThreads.add(threadId);
          }
        }
      } catch { /* Optional native state may have been disposed. */ }
      for (const threadKey of threadKeys) {
        try {
          const task = read(members.get(threadKey));
          if (task?.kind !== "local" || task.key !== threadKey || task.conversation?.hostId !== "local") continue;
          if (typeof task.conversation.id === "string") threadIds.set(threadKey, task.conversation.id);
        } catch { /* Keep the original ID when the binding is unavailable. */ }
      }
    }
  }
  return { threadIds, asyncQuestionThreads };
}

export function taskAttentionStatus(status, hasAsyncQuestion) {
  const value = String(status ?? "idle").toLowerCase();
  if (!hasAsyncQuestion || ["approval", "awaiting-approval", "error", "failed", "failure", "off"].includes(value)) {
    return status ?? "idle";
  }
  return "awaiting-response";
}
