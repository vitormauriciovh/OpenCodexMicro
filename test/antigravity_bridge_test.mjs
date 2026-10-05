import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { AntigravityStateReader, windowedQuotaSummary } from "../src/bridge-antigravity/state-reader.mjs";

test("empty reader is independent of personal session history", async () => {
  const reader = new AntigravityStateReader({ brainDir: "/nonexistent/test/dir", quotaFetch: async () => null });
  const snapshot = await reader.snapshot();
  assert.equal(snapshot.slots.length, 6); assert.equal(snapshot.activeTasks.length, 0);
  assert.equal(snapshot.capabilities.approve, false);
});
test("missing quota remains unknown and live quota is cached", async () => {
  let calls = 0;
  const reader = new AntigravityStateReader({ quotaFetch: async () => { calls++; return null; } });
  const quota = await reader.calculateRollingUsage([]);
  assert.equal(quota.windows[0].remainingPercent, null); assert.equal(quota.windows[1].resetsAt, null);
  await reader.calculateRollingUsage([]); assert.equal(calls, 1);
});
test("old unfinished transcripts report unknown rather than idle and tokens are labelled estimated", async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "agy-test-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const fullPath = path.join(root, "session");
  const logs = path.join(fullPath, ".system_generated/logs");
  await fs.mkdir(logs, { recursive: true });
  const transcript = path.join(logs, "transcript.jsonl");
  await fs.writeFile(transcript, JSON.stringify({ type: "USER_INPUT", content: "Long task", created_at: new Date(0).toISOString() }) + '\n');
  await fs.utimes(transcript, 1, 1);
  const reader = new AntigravityStateReader({ brainDir: root, quotaFetch: async () => null });
  const state = await reader.snapshot();
  assert.equal(state.slots[0].status, "unknown");
  assert.equal(state.tokenUsage.estimated, true);
  assert.equal(state.slots[0].model, null);
  assert.equal(state.slots[0].ctxPct, null);
  assert.equal(state.tokenUsage.modelContextWindow, null);
  assert.equal(state.tokenUsage.contextTokens, null);
});

test("missing transcript preserves unknown model and token usage", async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "agy-no-transcript-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.mkdir(path.join(root, "session"));
  const reader = new AntigravityStateReader({ brainDir: root, quotaFetch: async () => null });
  const state = await reader.snapshot();
  assert.equal(state.slots[0].model, null);
  assert.equal(state.slots[0].tokenUsage, null);
  assert.equal(state.slots[0].ctxPct, null);
});

test("unlabeled model quota never becomes five-hour or weekly usage", async () => {
  const unlabeled = { userStatus: { cascadeModelConfigData: { clientModelConfigs: [{ label: "Gemini", quotaInfo: { remainingFraction: 0.8, resetTime: "2026-09-22T00:00:00Z" } }] } } };
  assert.equal(windowedQuotaSummary(unlabeled), null);
  assert.equal(windowedQuotaSummary({ response: { groups: [{ buckets: [{ bucketId: "model-15h", remainingFraction: 0.8 }] }] } }), null);
  const requests = [];
  const reader = new AntigravityStateReader({ fetchImpl: async url => {
    requests.push(url);
    return requests.length === 1 ? { ok: true, text: async () => '{"csrfToken":"fixture"}' } : { ok: true, json: async () => unlabeled };
  } });
  reader._cachedAgyPort = 12345; reader._cachedAgyPortTime = Date.now();
  const quota = await reader.calculateRollingUsage();
  assert.equal(requests.length, 2);
  assert.ok(requests[1].endsWith("/RetrieveUserQuotaSummary"));
  assert.ok(requests.every(url => !url.includes("GetUserStatus")));
  assert.equal(quota.source, "unavailable");
  assert.ok(quota.windows.every(window => window.remainingPercent === null && window.resetsAt === null));
});
test("quota summary accepts only explicit valid unambiguous windows", () => {
  const summary = buckets => ({ response: { groups: [{ displayName: "Gemini", buckets }] } });
  const quota = windowedQuotaSummary(summary([
    { window: "5h", remainingFraction: 0, resetTime: "2026-09-22T00:00:00Z" },
    { window: "weekly", remainingFraction: 0.5, resetTime: "invalid" }
  ]));
  assert.equal(quota.fiveHourRemaining, 0); assert.equal(quota.weeklyRemaining, 50);
  assert.equal(quota.fiveHourReset, Date.parse("2026-09-22T00:00:00Z")); assert.equal(quota.weeklyReset, null);
  for (const remainingFraction of [null, "0.5", NaN, Infinity, -1, 1.1]) {
    assert.equal(windowedQuotaSummary(summary([{ window: "5h", remainingFraction }])), null);
  }
  assert.equal(windowedQuotaSummary(summary([{ window: "5h", remainingFraction: 0.8 }, { window: "5h", remainingFraction: 0.2 }])), null);
});
