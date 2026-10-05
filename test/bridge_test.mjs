import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import { contextPercent } from "../src/shared/token-metrics.mjs";

import {
  decodeThreadPathSegment,
  localThreadKey,
  validateThreadId
} from "../src/bridge/thread-key.mjs";
import {
  CodexCdpClient,
  composerPromptExpression,
  composerSteerExpression,
  rendererActionExpression,
  threadGuardExpression,
  findNativePlanControl
} from "../src/bridge/codex-cdp.mjs";

const UUID = "f6805b8a-332a-43a0-a118-52d3e59542f6";

test("context metrics distinguish unknown capacity, cumulative usage and measured zero", () => {
  assert.equal(contextPercent(null), null);
  assert.equal(contextPercent({ last: { totalTokens: 250 } }), null);
  assert.equal(contextPercent({ total: { totalTokens: 250 }, modelContextWindow: 1000 }), null);
  assert.equal(contextPercent({ last: { totalTokens: 0 }, modelContextWindow: 1000 }), 0);
  assert.equal(contextPercent({ last: { totalTokens: 250 }, modelContextWindow: 1000 }), 25);
  const serialized = vm.runInNewContext(`(${contextPercent.toString()})`);
  assert.equal(serialized({ contextTokens: 50, modelContextWindow: 100 }), 50);
});

test("accepts formal and explicit temporary Codex thread ids", () => {
  assert.equal(validateThreadId(UUID), UUID);
  assert.equal(
    validateThreadId(`client-new-thread:${UUID}`),
    `client-new-thread:${UUID}`
  );
  assert.equal(localThreadKey(UUID), `local:${UUID}`);
  assert.equal(
    localThreadKey(`client-new-thread:${UUID}`),
    `local:client-new-thread:${UUID}`
  );
});

test("decodes one URL path segment and rejects arbitrary ids", () => {
  assert.equal(
    decodeThreadPathSegment(`client-new-thread%3A${UUID}`),
    `client-new-thread:${UUID}`
  );
  assert.throws(() => validateThreadId("arbitrary-thread"), /Invalid/);
  assert.throws(() => decodeThreadPathSegment("%not-encoded"), /encoded/);
});

test("named Micro actions preserve press and release phases", async () => {
  const client = new CodexCdpClient();
  const calls = [];
  client.dispatchAction = async (...args) => calls.push(args);

  for (const [action, key] of [
    ["fast", "ACT06"],
    ["fork", "ACT09"],
    ["submit", "ACT12"]
  ]) {
    await client.dispatchNamedAction(action, true);
    await client.dispatchNamedAction(action, false);
    assert.deepEqual(calls.splice(0), [[key, 1, undefined], [key, 0, undefined]]);
  }
});

test("renderer actions execute once on key down", async () => {
  const client = new CodexCdpClient();
  const calls = [];
  client.dispatchRendererAction = async (action) => calls.push(action);

  for (const action of ["pin", "new", "stop", "model", "reasoning", "goal", "subagents", "plan"]) {
    await client.dispatchNamedAction(action, true);
    await client.dispatchNamedAction(action, false);
  }
  assert.deepEqual(calls, ["pin", "new", "stop", "model", "reasoning", "goal", "subagents", "plan"]);
});

test("new renderer action accepts the current localized New conversation control", () => {
  let clicks = 0;
  const button = {
    offsetParent: {},
    innerText: "",
    getAttribute(name) {
      return name === "aria-label" ? "新对话" : null;
    },
    click() { clicks += 1; }
  };
  const document = {
    querySelector() { return null; },
    querySelectorAll(selector) {
      assert.equal(selector, "button");
      return [button];
    }
  };

  assert.equal(
    vm.runInNewContext(rendererActionExpression("new"), { document }),
    true
  );
  assert.equal(clicks, 1);
});

test("new renderer action prefers the language-independent sidebar structure", () => {
  let structuralClicks = 0;
  let localizedClicks = 0;
  const structuralButton = {
    offsetParent: {},
    click() { structuralClicks += 1; }
  };
  const localizedButton = {
    offsetParent: {},
    innerText: "New conversation",
    getAttribute() { return null; },
    click() { localizedClicks += 1; }
  };
  const sidebar = {
    querySelectorAll(selector) {
      assert.equal(selector, ".sidebar-item.relative > button.sidebar-item");
      return [structuralButton];
    }
  };
  const anchor = { closest: selector => selector === "nav" ? sidebar : null };
  const document = {
    querySelector(selector) {
      return selector === "[data-app-action-sidebar-project-create]" ? anchor : null;
    },
    querySelectorAll() { return [localizedButton]; }
  };

  assert.equal(
    vm.runInNewContext(rendererActionExpression("new"), { document }),
    true
  );
  assert.equal(structuralClicks, 1);
  assert.equal(localizedClicks, 0);
});

test("pin renderer action accepts the current localized Pin chat control", () => {
  let clicks = 0;
  const button = {
    offsetParent: {},
    getAttribute(name) {
      return name === "aria-label" ? "置顶聊天" : null;
    },
    click() { clicks += 1; }
  };
  const active = { querySelectorAll: () => [button] };
  const document = {
    querySelector(selector) {
      return selector === "[data-app-action-sidebar-thread-active=true]" ? active : null;
    }
  };

  assert.equal(
    vm.runInNewContext(rendererActionExpression("pin"), { document }),
    true
  );
  assert.equal(clicks, 1);
});

test("task DOM fallback clicks the thread row instead of nested Pin or Unpin controls", async () => {
  let taskClicks = 0;
  let pinClicks = 0;
  const pinButton = {
    getAttribute(name) {
      return name === "aria-label" ? "置顶聊天" : null;
    },
    click() { pinClicks += 1; }
  };
  const item = {
    getAttribute(name) {
      if (name === "data-app-action-sidebar-thread-id") return `local:${UUID}`;
      if (name === "role") return "button";
      return null;
    },
    matches(selector) {
      return selector === "[data-app-action-sidebar-thread-id][role=button]";
    },
    querySelector() { return pinButton; },
    click() { taskClicks += 1; }
  };
  const document = {
    querySelector() { return null; },
    querySelectorAll(selector) {
      assert.equal(selector, "[data-app-action-sidebar-thread-id]");
      return [item];
    }
  };
  const client = new CodexCdpClient();
  client.evaluate = expression => vm.runInNewContext(expression, { document });

  await client.activateThread(`local:${UUID}`);

  assert.equal(taskClicks, 1);
  assert.equal(pinClicks, 0, "Task navigation must never click a nested Pin control");

  const pinControl = {
    ...item,
    getAttribute(name) {
      if (name === "data-app-action-sidebar-thread-id") return `local:${UUID}`;
      if (name === "role") return "button";
      if (name === "aria-label") return "置顶聊天";
      return null;
    },
    click() { pinClicks += 1; }
  };
  const pinDocument = {
    querySelector() { return null; },
    querySelectorAll() { return [pinControl]; }
  };
  client.evaluate = expression => vm.runInNewContext(expression, { document: pinDocument });
  await assert.rejects(
    client.activateThread(`local:${UUID}`),
    /Task navigation control is not available/
  );
  assert.equal(pinClicks, 0, "Pin and Unpin controls must be explicitly rejected");
});

test("steer renderer action accepts the current localized control", () => {
  let focused = 0;
  let clicks = 0;
  const editor = { offsetParent: {}, focus() { focused += 1; } };
  const button = {
    offsetParent: {},
    innerText: "",
    getAttribute(name) {
      return name === "aria-label" ? "调整方向" : null;
    },
    click() { clicks += 1; }
  };
  const document = {
    querySelectorAll(selector) {
      return selector === "button" ? [button] : [editor];
    }
  };

  assert.equal(
    vm.runInNewContext(composerSteerExpression(), { document }),
    true
  );
  assert.equal(focused, 1);
  assert.equal(clicks, 1);
});

test("approve renderer action accepts localized and testid controls", () => {
  let clicks = 0;
  const button = {
    offsetParent: {},
    innerText: "Aprovar",
    getAttribute(name) { return name === "aria-label" ? "Aprovar" : null; },
    matches() { return false; },
    click() { clicks += 1; }
  };
  const document = {
    querySelector() { return null; },
    querySelectorAll() { return [button]; }
  };
  assert.equal(
    vm.runInNewContext(rendererActionExpression("approve"), { document }),
    true
  );
  assert.equal(clicks, 1);
});

test("reject renderer action accepts localized and testid controls", () => {
  let clicks = 0;
  const button = {
    offsetParent: {},
    innerText: "Cancel",
    getAttribute(name) { return name === "title" ? "Cancel" : null; },
    matches() { return false; },
    click() { clicks += 1; }
  };
  const document = {
    querySelector() { return null; },
    querySelectorAll() { return [button]; }
  };
  assert.equal(
    vm.runInNewContext(rendererActionExpression("reject"), { document }),
    true
  );
  assert.equal(clicks, 1);
});

test("stop renderer action accepts localized Stop buttons", () => {
  let clicks = 0;
  const button = {
    offsetParent: {},
    innerText: "Stop generating",
    getAttribute(name) { return name === "aria-label" ? "Stop generating" : null; },
    matches() { return false; },
    click() { clicks += 1; }
  };
  const document = {
    querySelector() { return null; },
    querySelectorAll() { return [button]; }
  };
  assert.equal(
    vm.runInNewContext(rendererActionExpression("stop"), { document }),
    true
  );
  assert.equal(clicks, 1);
});

test("stop ignores recording and modal controls and refuses ambiguity", () => {
  const clicked = [];
  const button = (label, extra = {}) => ({ offsetParent: {}, innerText: label,
    getAttribute: name => name === 'aria-label' ? label : null,
    click: () => clicked.push(label), ...extra });
  let buttons = [button('Stop recording'), button('Cancel'), button('Stop', { closest: () => ({}) }), button('Stop generating')];
  const document = { querySelector: () => null, querySelectorAll: () => buttons };
  assert.equal(vm.runInNewContext(rendererActionExpression('stop'), { document }), true);
  assert.deepEqual(clicked, ['Stop generating']);
  buttons = [button('Stop generating', { disabled: true }), button('Cancel')];
  assert.throws(() => vm.runInNewContext(rendererActionExpression('stop'), { document }), /No unique/);
  buttons = [button('Stop generating'), button('Stop')];
  assert.throws(() => vm.runInNewContext(rendererActionExpression('stop'), { document }), /No unique/);
  assert.equal(clicked.length, 1);
});

test("composerPromptExpression focuses editor and inserts prompt text", () => {
  let focused = 0;
  const commands = [];
  const editor = {
    offsetParent: {},
    focus() { focused += 1; }
  };
  const document = {
    querySelectorAll(sel) {
      return sel.includes("contenteditable") ? [editor] : [];
    },
    execCommand(cmd, showUi, val) {
      commands.push({ cmd, val });
      return true;
    }
  };

  assert.equal(
    vm.runInNewContext(composerPromptExpression("Execute os testes"), { document }),
    true
  );
  assert.equal(focused, 1);
  assert.deepEqual(commands, [
    { cmd: "insertText", val: "Execute os testes" }
  ]);
});

test("prompt shortcuts preserve composer drafts and reject a changed task before insertion", () => {
  let writes = 0;
  const editor = { offsetParent: {}, textContent: "My unfinished draft", focus() {} };
  const document = {
    querySelector: () => ({ getAttribute: () => `local:${UUID}` }),
    querySelectorAll: () => [editor],
    execCommand() { writes++; return true; }
  };
  assert.throws(() => vm.runInNewContext(composerPromptExpression("Test", UUID), { document }), /draft/);
  editor.textContent = "";
  assert.throws(() => vm.runInNewContext(composerPromptExpression("Test", "different-task"), { document }), /task changed/);
  assert.equal(writes, 0);
  assert.doesNotThrow(() => vm.runInNewContext(threadGuardExpression(UUID), { document }));
});

test("native approval executes once without a second renderer approval", async () => {
  const client = new CodexCdpClient(), calls = [];
  client.dispatchAction = async (...args) => calls.push(args);
  client.dispatchRendererAction = async () => { throw new Error("Must not duplicate native approval"); };
  for (const [action, key] of [["approve", "ACT07"], ["reject", "ACT08"]]) {
    await client.dispatchNamedAction(action, true, UUID);
    await client.dispatchNamedAction(action, false, UUID);
    assert.deepEqual(calls.splice(0), [[key, 1, UUID], [key, 0, UUID]]);
  }
});

test("goal and subagent controls require a unique enabled control for the expected task", () => {
  let clicks = 0;
  const button = { offsetParent: {}, getAttribute: name => name === 'aria-label' ? 'Resume goal' : null, click() { clicks++; } };
  const document = { querySelector: () => ({ getAttribute: () => UUID }), querySelectorAll: () => [button] };
  assert.equal(vm.runInNewContext(rendererActionExpression('goal', UUID), { document }), true);
  assert.equal(clicks, 1);
  document.querySelectorAll = () => [button, button];
  assert.throws(() => vm.runInNewContext(rendererActionExpression('goal', UUID), { document }), /unique/);
  document.querySelectorAll = () => [{ ...button, getAttribute: () => 'Open subagents' }];
  assert.equal(vm.runInNewContext(rendererActionExpression('subagents', UUID), { document }), true);
  assert.equal(clicks, 2);
});

test("native controls report absent handlers instead of pretending an action succeeded", async () => {
  const client = new CodexCdpClient(), messages = [];
  const bus = { handlers: new Map([['codex-micro-hid-event', new Set()]]), dispatchHostMessage: message => messages.push(message) };
  const context = { Map, Symbol, setTimeout: callback => { callback(); }, [Symbol.for('codex-keyboard-micro-bus')]: bus };
  client.evaluate = expression => vm.runInNewContext(expression, context);
  await assert.rejects(client.dispatchAction('ACT07', 1), /no handler/);
  assert.equal(messages.length, 1); assert.equal(messages[0].type, 'codex-micro-device-state-changed');
});

test("unknown bridge actions are rejected", async () => {
  const client = new CodexCdpClient();
  await assert.rejects(
    client.dispatchNamedAction("unknown", true),
    /Unsupported Codex bridge action/
  );
});

test('plan opens only the unique enabled native control of the expected task', () => {
  let clicks = 0;
  const make = (label, extras = {}) => ({ offsetParent: {}, getAttribute: name => name === 'aria-label' ? label : null, click: () => clicks++, ...extras });
  let buttons = [make('Implement plan'), make('Download plan'), make('Abrir plano no painel lateral')];
  const document = { querySelectorAll: () => buttons, querySelector: () => ({ getAttribute: () => 'local:task-a' }) };
  assert.equal(vm.runInNewContext(rendererActionExpression('plan', 'local:task-a'), { document }), true);
  assert.throws(() => vm.runInNewContext(rendererActionExpression('plan', 'local:task-b'), { document }), /task changed/);
  for (const extras of [{ disabled: true }, { offsetParent: null }, { closest: () => ({}) }, { getAttribute: name => name === 'aria-disabled' ? 'true' : 'Open plan in side panel' }]) {
    buttons = [make('Open plan in side panel', extras)];
    assert.equal(findNativePlanControl(document), null);
    assert.throws(() => vm.runInNewContext(rendererActionExpression('plan', 'task-a'), { document }), /No unique plan/);
  }
  buttons = [make('Open plan in side panel'), make('Open plan in side panel')];
  assert.equal(findNativePlanControl(document), null);
  assert.throws(() => vm.runInNewContext(rendererActionExpression('plan', 'task-a'), { document }), /No unique plan/);
  buttons = [make('Implement plan'), make('Plan')];
  assert.equal(findNativePlanControl(document), null);
  assert.equal(clicks, 1);
});
