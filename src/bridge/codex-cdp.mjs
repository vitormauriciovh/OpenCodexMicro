import { contextPercent } from "../shared/token-metrics.mjs";
import { readNativeModelPicker, cycleNativeModelPicker } from "./model-picker.mjs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import WebSocket from "ws";
import { localThreadKey } from "./thread-key.mjs";
import { readNativeTaskAttention, taskAttentionStatus } from "./task-attention.mjs";

const execFileAsync = promisify(execFile);
const USAGE_REFRESH_MS = Math.max(
  15000,
  Number(process.env.CODEX_KEYBOARD_USAGE_REFRESH_SECONDS || 600) * 1000
);
const DEVICE_STATE = {
  type: "codex-micro-device-state-changed",
  state: { status: "connected", error: null, battery: { percentage: 100, isCharging: true } }
};
const MICRO_ACTION_KEYS = Object.freeze({
  fast: "ACT06",
  approve: "ACT07",
  reject: "ACT08",
  fork: "ACT09",
  mic: "ACT10",
  submit: "ACT12"
});
const RENDERER_ACTIONS = new Set(["pin", "new", "approve", "reject", "stop", "model", "reasoning", "goal", "subagents", "plan"]);
const PIN_ACTION_LABELS = Object.freeze([
  "Pin chat",
  "Unpin chat",
  "置顶聊天",
  "取消置顶聊天",
  "釘選聊天",
  "取消釘選聊天"
]);
const NEW_ACTION_LABELS = Object.freeze([
  "New task",
  "New chat",
  "New conversation",
  "新对话",
  "新對話",
  "新建任务",
  "新建聊天",
  "新增任務",
  "新增聊天"
]);
const STEER_ACTION_LABELS = Object.freeze([
  "Steer",
  "调整方向",
  "調整方向",
  "引導"
]);
const APPROVE_ACTION_LABELS = Object.freeze([
  "Approve",
  "Allow",
  "Run",
  "Accept",
  "Confirm",
  "Yes",
  "Proceed",
  "Aprovar",
  "Permitir",
  "Executar",
  "Aceitar",
  "Confirmar",
  "Sim",
  "Prosseguir",
  "批准",
  "允许",
  "运行",
  "接受",
  "确认",
  "是",
  "继续",
  "承認",
  "許可",
  "実行",
  "同意",
  "確認",
  "はい",
  "続行",
  "Genehmigen",
  "Zulassen",
  "Ausführen",
  "Bestätigen"
]);
const REJECT_ACTION_LABELS = Object.freeze([
  "Reject",
  "Deny",
  "Cancel",
  "Decline",
  "No",
  "Dismiss",
  "Stop",
  "Rejeitar",
  "Negar",
  "Cancelar",
  "Recusar",
  "Não",
  "Dispensar",
  "Parar",
  "拒绝",
  "否认",
  "取消",
  "否",
  "关闭",
  "停止",
  "拒否",
  "却下",
  "キャンセル",
  "辞退",
  "いいえ",
  "閉じる",
  "Ablehnen",
  "Verweigern",
  "Abbrechen"
]);

export function threadGuardExpression(threadId) {
  return `const expectedThread = ${JSON.stringify(threadId)};
    if (expectedThread !== undefined) {
      const actualThread = document.querySelector('[data-above-composer-conversation-id]')?.getAttribute('data-above-composer-conversation-id')
        ?? document.querySelector('[data-app-action-sidebar-thread-id][data-app-action-sidebar-thread-active=true]')?.getAttribute('data-app-action-sidebar-thread-id') ?? null;
      const normalizeThread = value => value == null ? null : String(value).replace(/^local:/, '');
      if (normalizeThread(actualThread) !== normalizeThread(expectedThread)) throw new Error('Codex task changed; refresh the deck and try again');
    }`;
}

// Exact labels from localConversation.planSummary.openInSidePanel in the
// installed desktop bundle. Never match Implement, Download, or summary text.
export function findNativePlanControl(document) {
  const labels = new Set(["Open plan in side panel", "Abrir plano no painel lateral", "Plan im Seitenbereich öffnen", "Abrir plan en el panel lateral", "サイドパネルでプランを開く", "사이드 패널에서 계획 열기", "在侧边面板中打开套餐", "在側邊面板中開啟計劃", "在側邊面板開啟方案"]);
  const matches = [...document.querySelectorAll('button[aria-label]')].filter(button =>
    button.offsetParent !== null && !button.disabled && button.getAttribute('aria-disabled') !== 'true' &&
    !button.closest?.('[role="dialog"], [aria-modal="true"], [inert], [aria-hidden="true"]') &&
    labels.has(button.getAttribute('aria-label')));
  return matches.length === 1 ? matches[0] : null;
}

export function rendererActionExpression(action, threadId) {
  if (action === "model" || action === "reasoning") {
    return `(async () => {
      const guard = () => { ${threadGuardExpression(threadId)} };
      const readPicker = () => (${readNativeModelPicker.toString()})(document);
      guard();
      const expected = (${cycleNativeModelPicker.toString()})(readPicker(), ${JSON.stringify(action)});
      for (let attempt = 0; attempt < 40; attempt++) {
        await new Promise(resolve => setTimeout(resolve, 50));
        guard();
        const { props } = readPicker();
        if (props.model === expected.model && props.reasoningEffort === expected.reasoningEffort) return true;
      }
      throw new Error('Codex did not confirm the model settings change');
    })()`;
  }
  return `(() => {
    ${threadGuardExpression(threadId)}
    const action = ${JSON.stringify(action)};
    const visible = (element) => element && element.offsetParent !== null;
    let target = null;
    if (action === "pin") {
      const active = document.querySelector(
        "[data-app-action-sidebar-thread-active=true]"
      ) ?? document.querySelector(
        "[data-app-action-sidebar-thread-id][aria-current=page]"
      );
      const labels = new Set(${JSON.stringify(PIN_ACTION_LABELS)});
      target = active && [...active.querySelectorAll("button")].find(
        (button) => visible(button) && labels.has(button.getAttribute("aria-label"))
      );
    } else if (action === "new") {
      const sidebarAnchor = document.querySelector(
        "[data-app-action-sidebar-project-create]"
      ) ?? document.querySelector("[data-app-action-sidebar-thread-id]");
      const sidebar = sidebarAnchor?.closest("nav");
      const structuralCandidates = [...(
        sidebar?.querySelectorAll(
          ".sidebar-item.relative > button.sidebar-item"
        ) ?? []
      )].filter(visible);
      if (structuralCandidates.length === 1) {
        target = structuralCandidates[0];
      } else {
        const labels = new Set(${JSON.stringify(NEW_ACTION_LABELS)});
        const buttons = [...document.querySelectorAll("button")].filter(visible);
        target = buttons.find((button) => [
          button.getAttribute("aria-label"),
          button.getAttribute("title"),
          (button.innerText || "").trim()
        ].some((label) => labels.has(label)));
      }
    } else if (action === "approve") {
      const labels = new Set(${JSON.stringify(APPROVE_ACTION_LABELS)});
      const buttons = [...document.querySelectorAll("button, [role=button]")].filter(visible);
      target = buttons.find((button) => [
        button.getAttribute("aria-label"),
        button.getAttribute("title"),
        (button.innerText || "").trim()
      ].some((label) => labels.has(label))) ?? buttons.find((button) =>
        button.matches?.('[data-testid*="approve"],[data-testid*="allow"],[data-testid*="run"]')
      );
    } else if (action === "reject") {
      const stopLabels = ["Stop", "Stop generating", "Cancel", "Parar", "Cancelar", "Interromper", "停止", "停止生成", "取消", "中止", "Abbrechen", "Stoppen"];
      const rejectLabels = new Set(${JSON.stringify(REJECT_ACTION_LABELS)});
      const buttons = [...document.querySelectorAll("button, [role=button]")].filter(visible);
      target = buttons.find((button) => {
        const aria = button.getAttribute("aria-label") || "";
        const title = button.getAttribute("title") || "";
        const text = (button.innerText || "").trim();
        return stopLabels.some((l) => aria.includes(l) || title.includes(l) || text.includes(l)) ||
               rejectLabels.has(aria) || rejectLabels.has(title) || rejectLabels.has(text);
      }) ?? buttons.find((button) =>
        button.matches?.('[data-testid*="stop"],[data-testid*="cancel"],[data-testid*="reject"],[data-testid*="deny"]')
      );
    } else if (action === "stop") {
      const labels = new Set(["Stop", "Stop generating", "Parar", "Interromper", "停止", "停止生成", "中止", "Stoppen"]);
      const matches = [...document.querySelectorAll("button, [role=button]")].filter(button =>
        visible(button) && !button.disabled && button.getAttribute("aria-disabled") !== "true" &&
        !button.closest?.('[role="dialog"], [aria-modal="true"]') &&
        [button.getAttribute("aria-label"), button.getAttribute("title"), (button.innerText || "").trim()].some(label => labels.has(label))
      );
      if (matches.length !== 1) throw new Error("No unique stop control is available for this task");
      target = matches[0];
    } else if (action === "plan") {
      target = (${findNativePlanControl.toString()})(document);
      if (!target) throw new Error("No unique plan control is available for this task");
    } else if (action === "goal" || action === "subagents") {
      const labels = action === "goal" ? ["Pause goal", "Resume goal", "Pausar objetivo", "Retomar objetivo"] : ["Open subagents", "Abrir subagentes"];
      const matches = [...document.querySelectorAll("button")].filter(button => visible(button) && !button.disabled && labels.includes(button.getAttribute("aria-label")));
      if (matches.length !== 1) throw new Error("No unique " + action + " control is available for this task");
      target = matches[0];
    }
    if (!target) return false;
    target.click();
    return true;
  })()`;
}

export function composerSteerExpression(threadId) {
  return `(() => {
    ${threadGuardExpression(threadId)}
    const editor = [...document.querySelectorAll('[contenteditable="true"][role="textbox"]')]
      .find((element) => element.offsetParent !== null);
    if (!editor) throw new Error("Codex composer is not available");
    editor.focus();
    const labels = new Set(${JSON.stringify(STEER_ACTION_LABELS)});
    const steer = [...document.querySelectorAll('button')]
      .find((element) =>
        element.offsetParent !== null && [
          element.getAttribute("aria-label"),
          element.getAttribute("title"),
          (element.innerText || "").trim()
        ].some((label) => labels.has(label))
      );
    if (!steer) return false;
    steer.click();
    return true;
  })()`;
}

export function composerPromptExpression(text, threadId) {
  return `(() => {
    ${threadGuardExpression(threadId)}
    const editor = [...document.querySelectorAll('[contenteditable="true"][role="textbox"]')]
      .find((element) => element.offsetParent !== null);
    if (!editor) throw new Error("Codex composer is not available");
    if (editor.textContent?.trim()) throw new Error("Composer already contains a draft; send or clear it in Codex first");
    editor.focus();
    if (!document.execCommand("insertText", false, ${JSON.stringify(text)})) throw new Error("Could not insert prompt");
    return true;
  })()`;
}

const ENABLE_EXPRESSION = `(async () => {
  const gateName = "3207467860";
  const statsig = globalThis.__STATSIG__;
  const clients = [...new Set([statsig?.firstInstance, ...Object.values(statsig?.instances ?? {})].filter(Boolean))];
  for (const client of clients) {
    if (client.overrideAdapter?.__codexKeyboardGate !== gateName) {
      const original = client.overrideAdapter ?? {};
      client.overrideAdapter = new Proxy(original, {
        get(target, property) {
          if (property === "__codexKeyboardGate") return gateName;
          if (property === "getGateOverride") return (gate, user, options) => {
            if (gate?.name === gateName) return { ...gate, value: true };
            const fallback = Reflect.get(target, property, target);
            return typeof fallback === "function" ? fallback.call(target, gate, user, options) : gate;
          };
          const value = Reflect.get(target, property, target);
          return typeof value === "function" ? value.bind(target) : value;
        }
      });
    }
    client._memoCache = {};
    client.$emt?.({ name: "values_updated" });
  }
  const urls = [...new Set([
    ...[...document.querySelectorAll("link[href],script[src]")].map((el) => el.href || el.src),
    ...performance.getEntriesByType("resource").map((entry) => entry.name)
  ])].filter((url) => url.includes("/assets/") && url.endsWith(".js"));
  for (const url of urls.filter((url) => /vscode-api|codex-micro|app-initial/.test(url)).slice(0, 120)) {
    try {
      const namespace = await import(url);
      const bus = Object.values(namespace).find((candidate) =>
        candidate && typeof candidate === "object" &&
        candidate.handlers instanceof Map &&
        (typeof candidate.dispatchHostMessage === "function" || typeof candidate.dispatchMessage === "function")
      );
      if (!bus) continue;
      globalThis[Symbol.for("codex-keyboard-micro-bus")] = bus;
      const dispatch = bus.dispatchHostMessage ?? bus.dispatchMessage;
      dispatch.call(bus, ${JSON.stringify(DEVICE_STATE)});
      return { ready: true, clients: clients.length };
    } catch {}
  }
  return { ready: clients.length > 0, clients: clients.length };
})()`;

const SNAPSHOT_EXPRESSION = `(async () => {
  const startedAt = performance.now();
  const root = document.getElementById("root");
  const reactKey = root && Object.getOwnPropertyNames(root).find((key) => key.startsWith("__reactContainer$"));
  if (!root || !reactKey) throw new Error("Codex React root was not found");
  const sourceKey = Symbol.for("codex-keyboard-micro-snapshot-source");
  const validSlots = (slots) =>
    Array.isArray(slots) && slots.length === 6 &&
    slots.every((slot, index) => slot?.id === index);
  const readSource = (source) => {
    if (!source || source.root !== root || !source.node?.store) {
      throw new Error("Cached Codex Micro source is stale");
    }
    const slots = source.node.store.get(
      source.resolver.resolve(source.node, source.contextMap)
    );
    if (!validSlots(slots)) throw new Error("Cached Codex Micro slots are stale");
    return slots;
  };

  let source = globalThis[sourceKey];
  let found = null;
  let queryClients = new Set();
  let cacheHit = false;
  if (source) {
    try {
      found = readSource(source);
      queryClients = new Set(source.queryClients ?? []);
      cacheHit = true;
    } catch {
      delete globalThis[sourceKey];
      source = null;
    }
  }

  if (!found) {
    const urls = [...new Set([
      ...[...document.querySelectorAll("link[href],script[src]")].map((el) => el.href || el.src),
      ...performance.getEntriesByType("resource").map((entry) => entry.name)
    ])].filter((url) => url.includes("/assets/") && url.endsWith(".js"));
    const slotSignalsUrl = urls.find((url) => url.includes("/assets/codex-micro-slot-signals-"));
    if (!slotSignalsUrl) throw new Error("Codex Micro slot signals are not loaded");

    const namespaces = [];
    for (const url of urls) {
      try { namespaces.push(await import(url)); } catch {}
    }
    const exportedValues = namespaces.flatMap((namespace) => Object.values(namespace));
    const bus = exportedValues.find((candidate) =>
      candidate && typeof candidate === "object" && candidate.handlers instanceof Map &&
      (typeof candidate.dispatchHostMessage === "function" || typeof candidate.dispatchMessage === "function")
    );
    if (bus) {
      globalThis[Symbol.for("codex-keyboard-micro-bus")] = bus;
      if ((bus.handlers.get("codex-micro-hid-event")?.size ?? 0) === 0) {
        (bus.dispatchHostMessage ?? bus.dispatchMessage).call(bus, ${JSON.stringify(DEVICE_STATE)});
      }
    }

    const signals = await import(slotSignalsUrl);
    const resolvers = Object.values(signals).filter((candidate) =>
      candidate && typeof candidate === "object" &&
      typeof candidate.resolve === "function" && typeof candidate.createSubscriberAtom === "function"
    );
    const queue = [root[reactKey]];
    const seen = new Set();
    queryClients = new Set();
    while (queue.length && seen.size < 30000 && !found) {
      const fiber = queue.pop();
      if (!fiber || seen.has(fiber)) continue;
      seen.add(fiber);
      const values = [fiber.memoizedProps?.value];
      let dependency = fiber.dependencies?.firstContext;
      while (dependency) { values.push(dependency.memoizedValue); dependency = dependency.next; }
      for (const value of values) {
        if (
          value && typeof value.getQueryCache === "function" &&
          typeof value.getQueryData === "function"
        ) queryClients.add(value);
        if (!(value instanceof Map)) continue;
        for (const node of value.values()) {
          if (!node?.store || typeof node.store.get !== "function") continue;
          for (const resolver of resolvers) {
            try {
              const slots = node.store.get(resolver.resolve(node, value));
              if (validSlots(slots)) {
                found = slots;
                source = {
                  root,
                  node,
                  resolver,
                  contextMap: value,
                  queryClients: [...queryClients]
                };
                globalThis[sourceKey] = source;
                break;
              }
            } catch {}
          }
          if (found) break;
        }
        if (found) break;
      }
      queue.push(fiber.child, fiber.sibling);
    }
    if (!found) throw new Error("Codex Micro slot store was not found");
  }
  let usage = null;
  for (const queryClient of queryClients) {
    try {
      const query = queryClient.getQueryCache().getAll().find((candidate) =>
        JSON.stringify(candidate.queryKey) === '["rate-limit-status"]'
      );
      const now = Date.now();
      const updatedAt = Number(query?.state?.dataUpdatedAt) || 0;
      const refreshKey = Symbol.for("codex-keyboard-rate-limit-refresh-at");
      const lastAttempt = Number(globalThis[refreshKey]) || 0;
      if (
        query && typeof query.fetch === "function" &&
        now - updatedAt >= ${USAGE_REFRESH_MS} && now - lastAttempt >= ${USAGE_REFRESH_MS}
      ) {
        globalThis[refreshKey] = now;
        try { Promise.resolve(query.fetch()).catch(() => {}); } catch {}
      }
      const data = query?.state?.data;
      const rateLimit = data?.rate_limit;
      if (!rateLimit || typeof rateLimit !== "object") continue;
      const parseResetTimestamp = (win, nowTime) => {
        if (!win || typeof win !== "object") return null;
        const raw = win.reset_at ?? win.resets_at ?? win.reset_time ?? win.resetAt ?? win.resetsAt;
        if (raw != null) {
          if (typeof raw === "number" && Number.isFinite(raw)) {
            return raw > 1e11 ? raw : raw * 1000;
          }
          if (typeof raw === "string") {
            const parsed = Date.parse(raw);
            if (Number.isFinite(parsed)) return parsed;
            const num = Number(raw);
            if (Number.isFinite(num)) return num > 1e11 ? num : num * 1000;
          }
        }
        const relSec = Number(win.reset_after_seconds ?? win.reset_in_seconds ?? win.resets_in ?? win.reset_in ?? win.reset_after);
        if (Number.isFinite(relSec) && relSec > 0) {
          return nowTime + relSec * 1000;
        }
        return null;
      };
      const normalizeWindow = (window, role) => {
        if (!window || typeof window !== "object") return null;
        const usedPercent = Number(window.used_percent);
        if (!Number.isFinite(usedPercent)) return null;
        const seconds = Number(window.limit_window_seconds);
        const minutes = Number.isFinite(seconds) && seconds > 0 ? seconds / 60 : null;
        const kind = minutes != null && Math.abs(minutes - 300) <= 1 ? "five-hour"
          : minutes != null && Math.abs(minutes - 10080) <= 1 ? "weekly"
            : "other";
        const used = Math.min(100, Math.max(0, usedPercent));
        const parsedReset = parseResetTimestamp(window, now);
        const defaultWindowMs = kind === "weekly" ? 7 * 86400 * 1000 : 5 * 3600 * 1000;
        const fallbackReset = (updatedAt || now) + defaultWindowMs;
        return {
          id: kind === "other" ? role : kind,
          kind,
          usedPercent: used,
          remainingPercent: 100 - used,
          resetsAt: parsedReset || fallbackReset
        };
      };
      usage = {
        windows: [
          normalizeWindow(rateLimit.primary_window, "primary"),
          normalizeWindow(rateLimit.secondary_window, "secondary")
        ].filter(Boolean),
        observedAt: updatedAt || now
      };
      break;
    } catch {}
  }
  const conversationsMeta = new Map();
  for (const queryClient of queryClients) {
    try {
      const queries = queryClient.getQueryCache().getAll();
      for (const query of queries) {
        if (JSON.stringify(query.queryKey).includes("recent-conversations-meta")) {
          const items = query.state?.data?.items || query.state?.data || [];
          const list = Array.isArray(items) ? items : (items.conversations || []);
          for (const item of list) {
            if (item && item.id && !conversationsMeta.has(item.id)) {
              conversationsMeta.set(item.id, item);
            }
          }
        }
      }
    } catch {}
  }

  const isWorkTask = (item) => {
    if (!item) return false;
    const originator = String(item.originator || "").toLowerCase();
    const serviceName = String(item.serviceName || "").toLowerCase();
    return originator.includes("work") || serviceName.includes("work");
  };

  const formatModel = (raw) => {
    if (!raw) return "DEFAULT";
    const str = String(raw).trim();
    if (/luna/i.test(str)) return /5\.6/i.test(str) ? "5.6 LUNA" : "LUNA";
    if (/terra/i.test(str)) return /5\.6/i.test(str) ? "5.6 TERRA" : "TERRA";
    if (/daybreak/i.test(str)) return "DAYBREAK";
    if (/gpt-5\.5/i.test(str)) return "GPT-5.5";
    if (/gpt-5/i.test(str)) return "GPT-5";
    if (/gpt-4o/i.test(str)) return "GPT-4o";
    if (/o1/i.test(str)) return "o1";
    if (/o3/i.test(str)) return "o3";
    if (/claude/i.test(str)) return "CLAUDE";
    return str.replace(/^gpt-/i, "").replace(/-latest$/i, "").toUpperCase();
  };

  const active = document.querySelector("[data-app-action-sidebar-thread-id][data-app-action-sidebar-thread-active=true]")
    ?? document.querySelector("[data-app-action-sidebar-thread-id][aria-current=page]");
  const activeThreadKey = document.querySelector("[data-above-composer-conversation-id]")
    ?.getAttribute("data-above-composer-conversation-id")
    ?? active?.getAttribute("data-app-action-sidebar-thread-id")
    ?? null;
  const normalizeThreadKey = (value) => String(value ?? "").replace(/^local:/, "");

  const computeCtxPct = ${contextPercent.toString()};
  const { threadIds, asyncQuestionThreads } = (${readNativeTaskAttention.toString()})(source, found);
  const attentionStatus = ${taskAttentionStatus.toString()};

  const enrichedSlots = found.map((slot) => {
    const threadId = threadIds.get(slot.threadKey) ?? normalizeThreadKey(slot.threadKey);
    const meta = threadId ? conversationsMeta.get(threadId) : null;
    const rawModel = meta?.latestModel || meta?.latestThreadSettings?.model || meta?.previousTurnModel || null;
    const isSlotRunning = ["working", "thinking", "running", "in_progress"].includes(String(slot.status || "").toLowerCase());
    const isMetaRunning = ["working", "thinking", "running", "in_progress"].includes(String(meta?.threadRuntimeStatus?.type || "").toLowerCase());
    const running = isSlotRunning || isMetaRunning;
    const taskType = isWorkTask(meta) ? "WORK" : "CODEX";
    const model = formatModel(rawModel);
    const tokenUsage = meta?.latestTokenUsageInfo || meta?.tokenUsageInfo || meta?.tokenUsage || null;
    const ctxPct = computeCtxPct(tokenUsage);
    return {
      id: slot.id,
      threadKey: slot.threadKey ?? null,
      threadId: threadId || null,
      title: slot.title ?? slot.thread?.title ?? slot.task?.title ?? meta?.title ?? null,
      status: attentionStatus(slot.status ?? meta?.threadRuntimeStatus?.type, asyncQuestionThreads.has(threadId)),
      running,
      taskType,
      model,
      rawModel,
      tokenUsage,
      ctxPct,
      selected: Boolean(slot.selected) || Boolean(
        activeThreadKey && threadId === normalizeThreadKey(activeThreadKey)
      )
    };
  });

  const activeTasks = [];
  const seenRunningKeys = new Set();
  for (const slot of enrichedSlots) {
    if (slot.running && slot.threadKey) {
      activeTasks.push({
        threadKey: slot.threadKey,
        threadId: slot.threadId,
        slot: slot.id,
        title: slot.title,
        status: slot.status,
        taskType: slot.taskType,
        model: slot.model,
        rawModel: slot.rawModel,
        tokenUsage: slot.tokenUsage,
        ctxPct: slot.ctxPct
      });
      seenRunningKeys.add(slot.threadId);
    }
  }

  for (const [id, meta] of conversationsMeta.entries()) {
    if (!seenRunningKeys.has(id)) {
      const isMetaRunning = ["working", "thinking", "running", "in_progress"].includes(String(meta?.threadRuntimeStatus?.type || "").toLowerCase());
      if (isMetaRunning) {
        const rawModel = meta?.latestModel || meta?.latestThreadSettings?.model || meta?.previousTurnModel || null;
        const tokenUsage = meta?.latestTokenUsageInfo || meta?.tokenUsageInfo || meta?.tokenUsage || null;
        activeTasks.push({
          threadKey: "local:" + id,
          threadId: id,
          slot: null,
          title: meta.title || "Untitled",
          status: attentionStatus(meta.threadRuntimeStatus?.type || "working", asyncQuestionThreads.has(id)),
          taskType: isWorkTask(meta) ? "WORK" : "CODEX",
          model: formatModel(rawModel),
          rawModel,
          tokenUsage,
          ctxPct: computeCtxPct(tokenUsage)
        });
        seenRunningKeys.add(id);
      }
    }
  }

  let lastTask = null;
  if (activeTasks.length > 0) {
    lastTask = activeTasks[0];
  } else if (activeThreadKey && conversationsMeta.has(normalizeThreadKey(activeThreadKey))) {
    const meta = conversationsMeta.get(normalizeThreadKey(activeThreadKey));
    const rawModel = meta?.latestModel || meta?.latestThreadSettings?.model || meta?.previousTurnModel || null;
    const tokenUsage = meta?.latestTokenUsageInfo || meta?.tokenUsageInfo || meta?.tokenUsage || null;
    lastTask = {
      threadKey: "local:" + meta.id,
      threadId: meta.id,
      slot: null,
      title: meta.title,
      status: attentionStatus(meta.threadRuntimeStatus?.type, asyncQuestionThreads.has(meta.id)),
      taskType: isWorkTask(meta) ? "WORK" : "CODEX",
      model: formatModel(rawModel),
      rawModel,
      tokenUsage,
      ctxPct: computeCtxPct(tokenUsage)
    };
  } else if (enrichedSlots[0]?.threadKey) {
    lastTask = enrichedSlots[0];
  }

  const activeMeta = (activeThreadKey && conversationsMeta.get(normalizeThreadKey(activeThreadKey))) || null;
  const tokenUsage = activeMeta?.latestTokenUsageInfo || activeMeta?.tokenUsageInfo || activeMeta?.tokenUsage || null;
  let modelPicker = null;
  try { modelPicker = (${readNativeModelPicker.toString()})(document).props; } catch {}
  
  const detectLiveReasoningEffort = () => {
    if (modelPicker?.reasoningEffort) return modelPicker.reasoningEffort;
    const srEffort = document.querySelector("[class*='ModelPickerTriggerEffortLabel'] .sr-only")?.textContent?.trim()?.toLowerCase();
    if (srEffort) return srEffort;
    const activeEffortEl = document.querySelector("[data-reasoning-effort][style*='opacity: 1']")
      ?? document.querySelector("[data-reasoning-effort]:not([style*='opacity: 0'])");
    if (activeEffortEl) {
      return activeEffortEl.getAttribute("data-reasoning-effort") || activeEffortEl.textContent?.trim()?.toLowerCase();
    }
    return activeMeta?.latestReasoningEffort || activeMeta?.reasoningEffort || null;
  };
  const reasoningEffort = detectLiveReasoningEffort();

  return {
    activeThreadKey,
    planAvailable: Boolean((${findNativePlanControl.toString()})(document)),
    model: modelPicker?.model || activeMeta?.latestModel || activeMeta?.latestThreadSettings?.model || activeMeta?.previousTurnModel || null,
    goalState: [...document.querySelectorAll('button')].some(b => b.offsetParent !== null && ['Pause goal', 'Pausar objetivo'].includes(b.getAttribute('aria-label'))) ? 'active'
      : [...document.querySelectorAll('button')].some(b => b.offsetParent !== null && ['Resume goal', 'Retomar objetivo'].includes(b.getAttribute('aria-label'))) ? 'paused' : null,
    subagentsSummary: [...document.querySelectorAll('button')].find(b => b.offsetParent !== null && ['Open subagents', 'Abrir subagentes'].includes(b.getAttribute('aria-label')))?.innerText?.trim() || null,
    slots: enrichedSlots,
    activeTasks,
    lastTask,
    tokenUsage,
    reasoningEffort,
    usage,
    bridgeSnapshot: {
      source: cacheHit ? "cache" : "discovery",
      durationMs: performance.now() - startedAt
    }
  };
})()`;

function selectMainTarget(targets) {
  const pages = targets.filter((target) =>
    target.type === "page" && target.webSocketDebuggerUrl && target.url?.startsWith("app://")
  );
  return pages.find((target) => {
    try { return new URL(target.url).pathname === "/index.html" && !new URL(target.url).search; }
    catch { return false; }
  }) ?? pages.find((target) => !/avatar-overlay|composition-surface/i.test(target.url || ""));
}

async function fetchJson(url, timeout = 1200) {
  const response = await fetch(url, { signal: AbortSignal.timeout(timeout) });
  if (!response.ok) throw new Error(`${url} returned HTTP ${response.status}`);
  return response.json();
}

async function discoverDebugPort() {
  const { stdout } = await execFileAsync("/bin/ps", ["-axo", "command="], { timeout: 4000 });
  for (const line of stdout.split("\n")) {
    if (!line.includes("--remote-debugging-address=127.0.0.1")) continue;
    const port = Number(line.match(/--remote-debugging-port(?:=|\s+)(\d+)/)?.[1]);
    if (!Number.isInteger(port)) continue;
    try {
      await fetchJson(`http://127.0.0.1:${port}/json/version`, 500);
      return port;
    } catch {}
  }
  throw new Error("Codex is not running with the local debug bridge");
}

export class CodexCdpClient {
  socket = null;
  nextId = 0;
  pending = new Map();
  lastSnapshot = null;
  modelActionQueue = Promise.resolve();

  async connect() {
    if (this.socket?.readyState === WebSocket.OPEN) return;
    const port = await discoverDebugPort();
    const target = selectMainTarget(await fetchJson(`http://127.0.0.1:${port}/json/list`));
    if (!target?.webSocketDebuggerUrl) throw new Error("Codex main renderer was not found");
    const socket = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Timed out connecting to Codex")), 3000);
      socket.once("open", () => { clearTimeout(timer); resolve(); });
      socket.once("error", reject);
    });
    socket.on("message", (raw) => this.handleMessage(String(raw)));
    socket.on("close", () => this.disconnect());
    socket.on("error", () => this.disconnect());
    this.socket = socket;
    await this.evaluate(ENABLE_EXPRESSION);
  }

  async snapshot() {
    await this.connect();
    try {
      this.lastSnapshot = await this.evaluate(SNAPSHOT_EXPRESSION);
      return this.lastSnapshot;
    } catch (error) {
      this.disconnect();
      throw error;
    }
  }

  async clickAgent(slot) {
    await this.connect();
    const snapshot = this.lastSnapshot ?? await this.snapshot();
    const agent = snapshot.slots[slot];
    if (!agent?.threadKey) throw new Error(`Agent slot ${slot + 1} is empty`);
    return this.clickThreadKey(agent.threadKey, slot);
  }

  async clickThread(threadId, slot = 0) {
    await this.connect();
    return this.clickThreadKey(localThreadKey(threadId), slot);
  }

  async clickThreadKey(threadKey, slot) {
    // Use the same native HID path as Codex Micro. The DOM click introduced
    // perceptible navigation scheduling; it is now only a non-blocking fallback.
    try {
      await this.dispatchAgent(slot, threadKey, 1);
      void (async () => {
        await new Promise((resolve) => setTimeout(resolve, 35));
        await this.dispatchAgent(slot, threadKey, 0);
        await this.activateThread(threadKey);
      })().catch(() => {});
    } catch {
      await this.activateThread(threadKey);
    }
  }

  async dispatchAgent(slot, threadKey, act) {
    return this.dispatchMicroMessage({
      type: "codex-micro-hid-event",
      event: { key: `AG0${slot}`, act, slot, threadKey }
    }, "codex-micro-hid-event");
  }

  async dispatchAction(key, act, threadId) {
    return this.dispatchMicroMessage({
      type: "codex-micro-hid-event",
      event: { key, act, slot: null, threadKey: null }
    }, "codex-micro-hid-event", act === 1 ? threadId : undefined);
  }

  async dispatchNamedAction(action, pressed, threadId) {
    const key = MICRO_ACTION_KEYS[action];
    if (key) {
      // Native approval handlers must not be followed by a second DOM click:
      // the first approval may already have exposed a different request.
      return this.dispatchAction(key, pressed ? 1 : 0, threadId);
    }
    if (!RENDERER_ACTIONS.has(action)) {
      throw new Error(`Unsupported Codex bridge action: ${action}`);
    }
    if (!pressed) return true;
    if (action === "model" || action === "reasoning") {
      const pending = this.modelActionQueue.catch(() => {}).then(() => this.dispatchRendererAction(action, threadId));
      this.modelActionQueue = pending;
      return pending;
    }
    return this.dispatchRendererAction(action, threadId);
  }

  async dispatchRendererAction(action, threadId) {
    await this.connect();
    const invoked = await this.evaluate(rendererActionExpression(action, threadId));
    if (!invoked) throw new Error(`Codex ${action} action is not available`);
    return true;
  }

  async dispatchComposerSteer(threadId) {
    await this.connect();
    const clicked = await this.evaluate(composerSteerExpression(threadId));
    if (!clicked) throw new Error("Codex Steer action is not available");
  }

  async submitPrompt(text, threadId) {
    await this.connect();
    await this.evaluate(composerPromptExpression(text, threadId));
    await new Promise((resolve) => setTimeout(resolve, 60));
    await this.dispatchAction(MICRO_ACTION_KEYS.submit, 1, threadId);
    await new Promise((resolve) => setTimeout(resolve, 35));
    await this.dispatchAction(MICRO_ACTION_KEYS.submit, 0);
    return true;
  }

  async dispatchJoystick(direction, distance, threadId) {
    const angle = { up: 0.75, right: 0, down: 0.25, left: 0.5 }[direction];
    if (angle === undefined) throw new Error(`Unknown joystick direction: ${direction}`);
    return this.dispatchMicroMessage({
      type: "codex-micro-joystick-event",
      event: { angle, distance }
    }, "codex-micro-joystick-event", distance ? threadId : undefined);
  }

  async dispatchMicroMessage(message, requiredHandler, threadId) {
    return this.evaluate(`(async () => {
      const cacheKey = Symbol.for("codex-keyboard-micro-bus");
      const isMicroBus = (candidate) =>
        candidate && candidate.handlers instanceof Map &&
        (
          candidate.handlers.has(${JSON.stringify(requiredHandler)}) ||
          [...candidate.handlers.keys()].some((key) => String(key).startsWith("codex-micro-"))
        ) &&
        (
          typeof candidate.dispatchHostMessage === "function" ||
          typeof candidate.dispatchMessage === "function"
        );
      let bus = globalThis[cacheKey];
      if (!isMicroBus(bus)) {
        const urls = [...new Set([
          ...[...document.querySelectorAll("link[href],script[src]")].map((element) => element.href || element.src),
          ...performance.getEntriesByType("resource").map((entry) => entry.name)
        ])]
          .filter((url) => url.includes("/assets/") && url.endsWith(".js"));
        bus = null;
        for (const url of urls) {
          try {
            const namespace = await import(url);
            bus = Object.values(namespace).find(isMicroBus);
            if (bus) {
              globalThis[cacheKey] = bus;
              break;
            }
          } catch {}
        }
      }
      if (!bus) throw new Error("Codex Micro event bus was not found");
      const dispatch = bus.dispatchHostMessage ?? bus.dispatchMessage;
      if ((bus.handlers.get(${JSON.stringify(requiredHandler)})?.size ?? 0) === 0) {
        dispatch.call(bus, ${JSON.stringify(DEVICE_STATE)});
        for (let attempt = 0; attempt < 3 && !(bus.handlers.get(${JSON.stringify(requiredHandler)})?.size > 0); attempt++) {
          await new Promise(resolve => setTimeout(resolve, 35));
        }
      }
      if (!(bus.handlers.get(${JSON.stringify(requiredHandler)})?.size > 0)) throw new Error("Codex has no handler for this control");
      ${threadGuardExpression(threadId)}
      dispatch.call(bus, ${JSON.stringify(message)});
      return true;
    })()`);
  }

  async activateThread(threadKey) {
    return this.evaluate(`(async () => {
      const key = ${JSON.stringify(threadKey)};
      const normalize = (value) => String(value ?? "").replace(/^local:/, "");
      const current = () => document.querySelector("[data-above-composer-conversation-id]")
        ?.getAttribute("data-above-composer-conversation-id")
        ?? document.querySelector("[data-app-action-sidebar-thread-id][data-app-action-sidebar-thread-active=true]")
          ?.getAttribute("data-app-action-sidebar-thread-id");
      if (normalize(current()) === normalize(key)) return true;
      const item = [...document.querySelectorAll("[data-app-action-sidebar-thread-id]")]
        .find((el) => normalize(el.getAttribute("data-app-action-sidebar-thread-id")) === normalize(key));
      if (!item) throw new Error("Task is not loaded in the Codex sidebar");
      const pinLabels = new Set(${JSON.stringify(PIN_ACTION_LABELS)});
      const isPinControl = (element) =>
        element.matches(
          "[data-app-action-sidebar-thread-pin],[data-app-action-sidebar-thread-unpin]"
        ) || [
          element.getAttribute("aria-label"),
          element.getAttribute("title")
        ].some((label) => pinLabels.has(label));
      const isTaskNavigation =
        item.matches("[data-app-action-sidebar-thread-id][role=button]") ||
        item.matches("a[data-app-action-sidebar-thread-id][href]");
      if (!isTaskNavigation || isPinControl(item)) {
        throw new Error("Task navigation control is not available");
      }
      item.click();
      return true;
    })()`);
  }

  evaluate(expression) {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      return Promise.reject(new Error("Codex bridge is disconnected"));
    }
    const id = ++this.nextId;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error("Codex runtime response timed out"));
      }, 7000);
      this.pending.set(id, { resolve, reject, timer });
      this.socket.send(JSON.stringify({
        id,
        method: "Runtime.evaluate",
        params: { expression, awaitPromise: true, returnByValue: true }
      }));
    });
  }

  handleMessage(raw) {
    let message;
    try { message = JSON.parse(raw); } catch { return; }
    const pending = this.pending.get(message.id);
    if (!pending) return;
    this.pending.delete(message.id);
    clearTimeout(pending.timer);
    if (message.error) return pending.reject(new Error(message.error.message));
    if (message.result?.exceptionDetails) {
      return pending.reject(new Error(
        message.result.exceptionDetails.exception?.description
        ?? message.result.exceptionDetails.text
        ?? "Codex evaluation failed"
      ));
    }
    pending.resolve(message.result?.result?.value);
  }

  disconnect() {
    const socket = this.socket;
    this.socket = null;
    if (socket?.readyState === WebSocket.OPEN) socket.close();
    for (const { reject, timer } of this.pending.values()) {
      clearTimeout(timer);
      reject(new Error("Codex bridge disconnected"));
    }
    this.pending.clear();
  }
}
