import test from "node:test";
import assert from "node:assert/strict";
import { AntigravityStateReader } from "../src/bridge-antigravity/state-reader.mjs";

test("AntigravityStateReader initializes and returns standard snapshot", async () => {
  const reader = new AntigravityStateReader();
  const snapshot = await reader.snapshot();
  assert.equal(snapshot.connected, true);
  assert.equal(Array.isArray(snapshot.slots), true);
  assert.equal(snapshot.slots.length, 6);
  assert.equal(typeof snapshot.pendingAttentionCount, "number");
  assert.equal(typeof snapshot.subagentsCount, "number");
});

test("AntigravityStateReader handles empty and populated conversations gracefully", async () => {
  const reader = new AntigravityStateReader({ brainDir: "/nonexistent/test/dir" });
  const snapshot = await reader.snapshot();
  assert.equal(snapshot.connected, true);
  assert.equal(snapshot.slots.length, 6);
  assert.equal(snapshot.activeTasks.length, 0);
  assert.equal(snapshot.pendingAttentionCount, 0);
  assert.equal(snapshot.subagentsCount, 0);
});


