import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import WebSocket from 'ws';

// Selectors verified against Antigravity Desktop's locally served UI. All
// effects are scoped to an observed conversation, never the foreground app.
export async function desktopOperation(request, env = { document: globalThis.document, location: globalThis.location }) {
  const { document, location } = env;
  const activeId = location.pathname.match(/^\/c\/([a-f0-9-]{36})$/i)?.[1] || null;
  const visible = e => Boolean(e && e.getClientRects().length > 0);
  const enabled = e => visible(e) && !e.disabled && e.getAttribute('aria-disabled') !== 'true' && e.getAttribute('data-disabled') === null;
  const all = (selector, root = document) => [...root.querySelectorAll(selector)].filter(visible);
  const unique = (items, label) => {
    if (items.length !== 1) throw new Error(items.length ? `Multiple ${label} controls; choose in Antigravity` : `${label} is unavailable in this conversation`);
    return items[0];
  };
  const row = id => all('[data-testid="conversation-row-sidebar"]').find(e => e.getAttribute('data-cascade-id') === id);
  const assertSelected = () => {
    if ((location.pathname.match(/^\/c\/([a-f0-9-]{36})$/i)?.[1] || null) !== activeId) throw new Error('Antigravity task changed; refresh the deck and try again');
  };
  const pause = () => new Promise(resolve => setTimeout(resolve, 80));
  const view = document.querySelector('[data-testid="conversation-view"]');
  const composer = document.querySelector('[data-testid="agent-input-box"]');
  const stopButtons = composer ? all('button[data-tooltip-id="input-send-button-cancel-tooltip"]', composer).filter(enabled) : [];
  const rowStop = row(activeId)?.querySelector('button[aria-label="Stop execution"]');
  if (!stopButtons.length && enabled(rowStop)) stopButtons.push(rowStop);
  const lastToolbar = view ? all('[data-testid="cascade-system-message-toolbar"]', view).at(-1) : null;
  const forkButton = lastToolbar?.querySelector('button[aria-label="Fork Conversation"]');
  const modelTrigger = composer?.querySelector('[data-testid="model-selector-trigger"]');
  // Antigravity Desktop 2.15.1 QueuedMessagesCard/Vnb exposes Send Now per
  // queued message. Its handler explicitly uses NEXT_INVOCATION, preserving
  // the independent composer draft. Never guess among multiple queue rows.
  const queuedCards = view ? all('[data-testid="queued-messages-card"]', view) : [];
  const queuedCard = queuedCards.length === 1 ? queuedCards[0] : null;
  const queueExpanded = queuedCard?.querySelector('[data-testid="queued-messages-expand-button"]')?.getAttribute('aria-expanded') === 'true';
  const queuedButtons = activeId && queueExpanded
    ? all('[data-testid="queued-decorators"]', queuedCard).flatMap(decorator => all('button', decorator)).filter(button => {
      const label = button.getAttribute('aria-label') || '';
      return enabled(button) && (label === 'Send Now' || label.startsWith('Send now: '));
    }) : [];

  const approvalLabels = new Set(['Accept', 'Allow once', 'Run command', 'Approve']);
  const rejectionLabels = new Set(['Reject', 'Deny']);
  const approvals = labels => view ? all('button', view).filter(e => enabled(e) && labels.has((e.innerText || e.textContent || '').trim())) : [];
  const approveButtons = approvals(approvalLabels), rejectButtons = approvals(rejectionLabels);
  if (request.action === 'snapshot') {
    const rows = all('[data-testid="conversation-row-sidebar"]').map(e => ({
      threadKey: e.getAttribute('data-cascade-id'),
      title: e.querySelector('a[href^="/c/"]')?.getAttribute('aria-label') || 'Antigravity',
      pinned: e.getAttribute('data-pinned') === 'true',
      running: enabled(e.querySelector('button[aria-label="Stop execution"]')), 
      selected: e.getAttribute('data-cascade-id') === activeId
    }));
    const editor = composer?.querySelector('[contenteditable="true"][aria-label="Message input"]');
    return { connected: true, activeThreadKey: activeId, tasks: rows,
      activeStatus: approveButtons.length ? 'attention' : stopButtons.length ? 'working' : composer ? 'idle' : 'unknown',
      pendingApprovalCount: approveButtons.length,
      model: modelTrigger?.textContent?.trim() || null,
      reasoningEffort: modelTrigger?.textContent?.trim()?.match(/\b(Minimal|Low|Medium|High|Extra High)$/i)?.[1]?.toLowerCase() || null,
      composerHasText: Boolean(editor?.textContent?.trim()),
      controls: { steer: queuedButtons.length === 1, approve: approveButtons.length === 1, reject: rejectButtons.length === 1, stop: stopButtons.length === 1,
        submit: enabled(composer?.querySelector('[data-testid="send-button"]')), pin: enabled(row(activeId)?.querySelector('[data-testid="conversation-pin-button"]')),
        fork: enabled(forkButton) && stopButtons.length === 0, reasoning: enabled(modelTrigger), model: enabled(modelTrigger),
        mic: Boolean(composer?.querySelector('button[aria-label="Record voice memo"],button[aria-label="Stop recording"]')) } };
  }
  if (request.action === 'select') {
    if (activeId === request.threadId) return { ok: true, threadId: activeId };
    const target = row(request.threadId)?.querySelector('a[href^="/c/"]');
    if (!target || new URL(target.getAttribute('href'), location.href).pathname !== `/c/${request.threadId}`) throw new Error('Task is not visible in the Antigravity sidebar');
    target.click(); return { ok: true, threadId: request.threadId };
  }
  // A stale deck state must never apply an action to the newly selected task.
  if (request.threadId !== activeId) throw new Error('Antigravity task changed; refresh the deck and try again');
  let target;
  if (request.action === 'new') {
    const section = new URL(location.href).searchParams.get('section');
    const links = all('a[href]');
    target = links.find(e => {
      const url = new URL(e.getAttribute('href'), location.href);
      return url.origin === location.origin && url.pathname === '/' && url.searchParams.get('section') === section;
    });
    if (!target) throw new Error('New conversation control is unavailable');
  } else if (request.action === 'pin') {
    target = row(activeId)?.querySelector('[data-testid="conversation-pin-button"]');
  } else if (request.action === 'stop') target = unique(stopButtons, 'Stop');
  else if (request.action === 'approve') target = unique(approveButtons, 'approval');
  else if (request.action === 'reject') target = unique(rejectButtons, 'rejection');
  else if (request.action === 'steer') target = unique(queuedButtons, 'queued Send Now');
  else if (request.action === 'mic') {
    target = unique(all('button[aria-label="Record voice memo"],button[aria-label="Stop recording"]', composer || document).filter(enabled), 'microphone');
  } else if (request.action === 'model') target = modelTrigger;
  else if (request.action === 'reasoning') {
    if (!enabled(modelTrigger)) throw new Error('Model options are unavailable');
    const originalModel = modelTrigger.textContent.trim();
    if (modelTrigger.getAttribute('aria-expanded') !== 'true') { modelTrigger.click(); await pause(); }
    assertSelected();
    const groups = all('[data-testid="model-selector-effort-group"]').filter(e => {
      const base = e.getAttribute('data-model-base');
      return base && originalModel.startsWith(`${base} `);
    });
    const group = unique(groups, 'current model reasoning').closest('[role="menuitem"]');
    if (!enabled(group)) throw new Error('Reasoning options are disabled');
    group.focus();
    group.dispatchEvent(new (env.KeyboardEvent || globalThis.KeyboardEvent)('keydown', { key: 'ArrowRight', code: 'ArrowRight', bubbles: true }));
    await pause(); assertSelected();
    const options = all('[data-testid="model-selector-effort-option"]').map(e => ({ effort: e.getAttribute('data-effort'), control: e.closest('[role="menuitemradio"]') })).filter(e => enabled(e.control));
    const selected = options.filter(e => e.control.getAttribute('aria-checked') === 'true');
    if (selected.length !== 1 || options.length < 2) throw new Error('No unambiguous reasoning choices for the current model');
    if (modelTrigger.textContent.trim() !== originalModel) throw new Error('Model changed while selecting reasoning');
    const index = options.indexOf(selected[0]);
    target = options[(index + 1) % options.length].control;
  } else if (request.action === 'fork') {
    if (stopButtons.length) throw new Error('Wait for the task to stop before forking');
    if (!activeId || !enabled(forkButton)) throw new Error('Fork is not available on the latest visible response');
    if (composer?.querySelector('[contenteditable="true"][aria-label="Message input"]')?.textContent?.trim()) throw new Error('Composer contains a draft; send or clear it before forking');
    forkButton.click(); await pause(); assertSelected();
    // The app offers other targets that create workspaces. Only reuse the
    // current workspace, preserving files exactly as they are.
    target = unique(all('[data-testid="fork-target-option"]').filter(e => e.textContent.trim() === 'Create fork in current workspace'), 'current workspace fork').closest('button');
  }
  else if (request.action === 'scroll') {
    const viewport = view?.querySelector('[data-testid="autoscroll-viewport"]');
    if (!viewport) throw new Error('Conversation scroll area is unavailable');
    if (!Number.isFinite(request.ticks) || !request.ticks || Math.abs(request.ticks) > 20) throw new Error('Invalid scroll movement');
    viewport.scrollBy({ top: request.ticks * 360, behavior: 'auto' });
    return { ok: true, threadId: activeId };
  } else if (request.action === 'submit' || request.action === 'prompt') {
    const editor = composer?.querySelector('[contenteditable="true"][aria-label="Message input"]');
    if (!visible(editor)) throw new Error('Message composer is unavailable');
    if (request.action === 'prompt') {
      if (typeof request.text !== 'string' || !request.text.trim() || request.text.length > 16000) throw new Error('Invalid prompt');
      if (editor.textContent.trim()) throw new Error('Composer already contains a draft; send or clear it in Antigravity first');
      editor.focus();
      if (!document.execCommand('insertText', false, request.text)) throw new Error('Could not insert prompt');
      // Let the application process its editor input before checking Send.
      await new Promise(resolve => setTimeout(resolve, 50));
      if ((location.pathname.match(/^\/c\/([a-f0-9-]{36})$/i)?.[1] || null) !== activeId) throw new Error('Task changed while preparing prompt; inspect the composer');
    }
    if (!editor.textContent.trim()) throw new Error('Composer is empty');
    target = composer.querySelector('[data-testid="send-button"]');
  } else throw new Error('Unsupported Antigravity desktop action');
  if (!enabled(target)) throw new Error(`${request.action} control is unavailable or disabled`);
  assertSelected();
  target.click();
  return { ok: true, threadId: activeId };
}

export class AntigravityDesktopClient {
  constructor({ portFile = path.join(os.homedir(), 'Library/Application Support/Antigravity/DevToolsActivePort'), fetchImpl = fetch, socketFactory = url => new WebSocket(url) } = {}) {
    this.portFile = portFile; this.fetch = fetchImpl; this.socketFactory = socketFactory;
    this.socket = null; this.pending = new Map(); this.sequence = 0; this.connecting = null; this.actionQueue = Promise.resolve();
  }
  async connect() {
    if (this.socket?.readyState === WebSocket.OPEN) return;
    if (this.connecting) return this.connecting;
    this.connecting = this.open();
    try { await this.connecting; } finally { this.connecting = null; }
  }
  async open() {
    const port = Number((await fs.readFile(this.portFile, 'utf8')).split('\n')[0]);
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid Antigravity desktop port');
    const response = await this.fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(2000), redirect: 'error' });
    if (!response.ok) throw new Error('Antigravity desktop discovery failed');
    const targets = (await response.json()).filter(t => {
      try { const u = new URL(t.url); return t.type === 'page' && ['http:', 'https:'].includes(u.protocol) && u.hostname === '127.0.0.1'; } catch { return false; }
    });
    if (targets.length !== 1) throw new Error('Open one Antigravity Desktop task window to use deck controls');
    const endpoint = new URL(targets[0].webSocketDebuggerUrl);
    if (endpoint.protocol !== 'ws:' || endpoint.hostname !== '127.0.0.1' || Number(endpoint.port) !== port) throw new Error('Invalid Antigravity desktop endpoint');
    const socket = this.socketFactory(endpoint.href);
    this.socket = socket;
    socket.on('message', raw => {
      if (this.socket !== socket) return;
      let message; try { message = JSON.parse(raw); } catch { return; }
      const pending = this.pending.get(message.id);
      if (!pending) return;
      clearTimeout(pending.timer); this.pending.delete(message.id);
      if (message.error) pending.reject(new Error(message.error.message));
      else pending.resolve(message.result);
    });
    socket.on('close', () => { if (this.socket === socket) this.close(); });
    socket.on('error', () => { if (this.socket === socket) this.close(); });
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.close(); reject(new Error('Antigravity desktop connection timed out')); }, 3000);
      socket.once('open', () => { clearTimeout(timer); resolve(); });
      socket.once('error', error => { clearTimeout(timer); reject(error); });
      socket.once('close', () => { clearTimeout(timer); reject(new Error('Antigravity desktop disconnected')); });
    });
  }
  async evaluate(request) {
    await this.connect();
    const id = ++this.sequence;
    const result = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error('Antigravity action timed out; check its state before retrying')); }, 8000);
      this.pending.set(id, { resolve, reject, timer });
      this.socket.send(JSON.stringify({ id, method: 'Runtime.evaluate', params: { expression: `(${desktopOperation.toString()})(${JSON.stringify(request)})`, returnByValue: true, awaitPromise: true } }), error => {
        if (error) { clearTimeout(timer); this.pending.delete(id); reject(error); }
      });
    });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text || 'Antigravity action failed');
    if (!result.result || !('value' in result.result)) throw new Error('Antigravity returned no action result');
    return result.result.value;
  }
  snapshot() { return this.evaluate({ action: 'snapshot' }); }
  enqueue(operation) {
    const next = this.actionQueue.then(operation);
    this.actionQueue = next.catch(() => {});
    return next;
  }
  select(threadId) { return this.enqueue(() => this.selectTask(threadId)); }
  async selectTask(threadId) {
    if (!/^[a-f0-9-]{36}$/i.test(threadId || '')) throw new Error('Invalid Antigravity task ID');
    await this.evaluate({ action: 'select', threadId });
    for (let attempt = 0; attempt < 15; attempt++) {
      const state = await this.snapshot();
      if (state.activeThreadKey === threadId) return { ok: true, threadId };
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    throw new Error('Antigravity did not select the requested task');
  }
  action(action, threadId, options = {}) { return this.enqueue(() => this.evaluate({ ...options, action, threadId })); }
  close() {
    const previous = this.socket; this.socket = null;
    previous?.close();
    for (const item of this.pending.values()) { clearTimeout(item.timer); item.reject(new Error('Antigravity desktop disconnected')); }
    this.pending.clear();
  }
}
