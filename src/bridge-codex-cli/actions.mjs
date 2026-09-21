import { promptShortcuts } from '../shared/prompt-shortcuts.mjs';
export { promptShortcuts } from '../shared/prompt-shortcuts.mjs';
export const cliActions = Object.freeze([
  'approve', 'proceed', 'reject', 'cancel', 'stop', 'resume', 'queue',
  'new', 'fork', 'navigate', 'goal', 'subagents', 'plan', 'attention', 'submit', 'steer', 'model', 'reasoning', 'fast', ...Object.keys(promptShortcuts)
]);
export async function dispatchCliAction(client, action, body = {}) {
  const { threadId, requestId } = body;
  if (Object.hasOwn(promptShortcuts, action)) return client.queuePrompt(promptShortcuts[action], threadId);
  switch (action) {
    case 'approve': case 'proceed': return client.approveLatest(threadId, requestId);
    case 'reject': return client.rejectLatest(threadId, requestId);
    case 'cancel': return client.cancelLatest(threadId, requestId);
    case 'stop': return client.stopTurn(threadId);
    case 'resume': return client.resumeLast(threadId);
    case 'queue': return client.queuePrompt(body.prompt ?? body.message ?? 'continue', threadId);
    case 'new': return client.newThread(threadId);
    case 'fork': return client.forkThread(threadId);
    case 'navigate': return client.navigate(body.ticks ?? 1, threadId);
    case 'plan': return client.refreshPlan(threadId);
    case 'subagents': return client.refreshSubagents(threadId);
    case 'goal': return client.toggleGoal(threadId);
    case 'attention': return client.selectAttention();
    case 'submit': return client.submitDraft(threadId, false);
    case 'steer': return client.submitDraft(threadId, true);
    case 'model': case 'reasoning': case 'fast': return client.cycleSetting(action, threadId);
    default: throw new Error('Unsupported Codex CLI action');
  }
}
