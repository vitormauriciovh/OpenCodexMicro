import test from "node:test";
import assert from "node:assert/strict";
import { CodexCliClient } from "../src/bridge-codex-cli/app-server-client.mjs";

test("CodexCliClient initializes and generates a standard snapshot", async () => {
  const client = new CodexCliClient({ socketPath: "/nonexistent/test/socket.sock" });
  const snapshot = await client.snapshot();
  assert.equal(typeof snapshot.connected, "boolean");
  assert.equal(Array.isArray(snapshot.slots), true);
  assert.equal(snapshot.slots.length, 6);
  assert.equal(typeof snapshot.pendingAttentionCount, "number");
  assert.equal(typeof snapshot.tokenUsage, "object");
});

test("CodexCliClient handles turn notifications and approval requests", async () => {
  const client = new CodexCliClient({ socketPath: "/nonexistent/test/socket.sock" });
  
  // Simulate turn started
  client.handleNotification({
    method: "turn/started",
    params: {
      turnId: "turn-123",
      model: "o3",
      session: { id: "sess-abc", title: "Refactor API" }
    }
  });

  let snapshot = await client.snapshot();
  assert.equal(snapshot.agentStatus, "WORKING");
  assert.equal(snapshot.activeTasks.length, 1);
  assert.equal(snapshot.activeTasks[0].title, "Refactor API");

  // Simulate server requesting approval for a bash command
  client.handleServerRequest({
    id: 42,
    method: "item/commandExecution/requestApproval",
    params: { command: "npm test" }
  });

  snapshot = await client.snapshot();
  assert.equal(snapshot.pendingAttentionCount, 1);
  assert.equal(snapshot.agentStatus, "ATTENTION");

  // Simulate turn completed
  client.handleNotification({
    method: "turn/completed",
    params: {
      sessionId: "sess-abc",
      tokenUsage: { totalTokens: 1500, inputTokens: 1200, outputTokens: 300 }
    }
  });

  snapshot = await client.snapshot();
  assert.equal(snapshot.tokenUsage.totalTokens, 1500);
});
