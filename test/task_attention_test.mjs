import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import { readNativeTaskAttention, taskAttentionStatus } from "../src/bridge/task-attention.mjs";

function fixture() {
  const itemId = JSON.stringify(["request_user_input_async", "call-test", 0]);
  const groups = new Map();
  const alias = "local:client-new-thread:temporary";
  const group = threadId => ({
    selectedQuestionKey: { hostId: "local", threadId, entityKey: "turn:1", itemId },
    questionIds: [itemId]
  });
  const node = {
    store: { get: atom => atom.read() },
    familyBindings: new Map([
      ["questions", new Map([["local", { value: { get: () => groups } }]])],
      ["threads", new Map([[alias, { value: { resolve: () => ({ read: () => ({
        kind: "local", key: alias, conversation: { id: "current", hostId: "local" }
      }) }) } }]])],
      ["disposed", new Map([["local", { value: { get() { throw Error("Disposed"); } } }]])]
    ])
  };
  return { source: { node, contextMap: new Map([["scope", node]]) }, slots: [{ threadKey: alias, status: "working" }], groups, group, alias };
}

test("live async questions override working status for the correct task and clear without latching", () => {
  const { source, slots, groups, group, alias } = fixture();
  const read = () => readNativeTaskAttention(source, slots);
  assert.equal(read().threadIds.get(alias), "current");
  assert.equal(read().asyncQuestionThreads.size, 0);
  groups.set("current", group("current"));
  groups.set("background", group("background"));
  assert.deepEqual([...read().asyncQuestionThreads], ["current", "background"]);
  assert.equal(taskAttentionStatus(slots[0].status, read().asyncQuestionThreads.has(read().threadIds.get(alias))), "awaiting-response");
  // Native submission, dismissal and expiry all remove the active group.
  groups.delete("current");
  assert.equal(taskAttentionStatus(slots[0].status, read().asyncQuestionThreads.has("current")), "working");
  assert.equal(read().asyncQuestionThreads.has("background"), true);
  groups.clear();
  assert.equal(read().asyncQuestionThreads.size, 0);
});

test("unrelated maps, stale question IDs and other hosts do not trigger attention", () => {
  const { source, slots, groups, group } = fixture();
  groups.set("old", { ...group("old"), questionIds: [] });
  groups.set("wrong-thread", group("current"));
  groups.set("remote", { ...group("remote"), selectedQuestionKey: { ...group("remote").selectedQuestionKey, hostId: "remote" } });
  groups.set("unrelated", { ...group("unrelated"), selectedQuestionKey: { ...group("unrelated").selectedQuestionKey, itemId: "not-json" }, questionIds: ["not-json"] });
  assert.equal(readNativeTaskAttention(source, slots).asyncQuestionThreads.size, 0);
  assert.equal(readNativeTaskAttention(null, slots).asyncQuestionThreads.size, 0);
});

test("async questions never masquerade as approval and preserve errors and empty slots", () => {
  for (const status of ["working", "thinking", "idle", "unread"]) {
    assert.equal(taskAttentionStatus(status, true), "awaiting-response");
    assert.equal(taskAttentionStatus(status, false), status);
  }
  for (const status of ["approval", "awaiting-approval", "error", "failed", "off"]) {
    assert.equal(taskAttentionStatus(status, true), status);
  }
});

test("renderer helpers serialize without closures or dependence on minified exports", () => {
  const { source, slots, groups, group } = fixture();
  groups.set("current", group("current"));
  const result = vm.runInNewContext(`(${readNativeTaskAttention.toString()})(source, slots)`, { source, slots, Map, Set });
  assert.equal(result.asyncQuestionThreads.has("current"), true);
  assert.equal(vm.runInNewContext(`(${taskAttentionStatus.toString()})("working", true)`), "awaiting-response");
});
