/**
 * Smoke test for Antigravity Ulanzi Plugin
 *
 * Validates that the plugin source can be parsed and key exports/functions
 * are structurally sound without requiring a live Ulanzi Studio connection.
 */

import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PLUGIN_ROOT = resolve(__dirname, "..");

let passed = 0;
let failed = 0;

function assert(condition, label) {
  if (condition) {
    console.log(`  ✓ ${label}`);
    passed++;
  } else {
    console.error(`  ✗ ${label}`);
    failed++;
  }
}

// --- 1. Source file exists and parses ---
console.log("\n1. Source file validation");
const appPath = resolve(PLUGIN_ROOT, "plugin/app.js");
assert(existsSync(appPath), "plugin/app.js exists");

let appSource;
try {
  appSource = readFileSync(appPath, "utf-8");
  assert(true, "plugin/app.js is readable");
} catch {
  assert(false, "plugin/app.js is readable");
}

// Syntax check via dynamic import would require ws, so we just validate structure
assert(appSource.includes("PLUGIN_UUID"), "PLUGIN_UUID constant defined");
assert(appSource.includes("BRIDGE_URL"), "BRIDGE_URL constant defined");
assert(appSource.includes("ACTION_LABELS"), "ACTION_LABELS constant defined");

// --- 2. Manifest validation ---
console.log("\n2. Manifest validation");
const manifestPath = resolve(PLUGIN_ROOT, "manifest.json");
assert(existsSync(manifestPath), "manifest.json exists");

let manifest;
try {
  manifest = JSON.parse(readFileSync(manifestPath, "utf-8"));
  assert(true, "manifest.json is valid JSON");
} catch {
  assert(false, "manifest.json is valid JSON");
}

assert(manifest?.UUID === "com.ulanzi.ulanzistudio.antigravity", "UUID matches expected value");
assert(manifest?.CodePath === "dist/app.js", "CodePath points to dist/app.js");
assert(Array.isArray(manifest?.Actions), "Actions array exists");
assert(manifest?.Actions?.length >= 20, `Actions count is ${manifest?.Actions?.length} (expected >= 20)`);

// Check every action has required fields
const actionIssues = [];
for (const action of manifest?.Actions || []) {
  if (!action.UUID) actionIssues.push(`Missing UUID for ${action.Name}`);
  if (!action.Name) actionIssues.push(`Missing Name`);
  if (!action.PropertyInspectorPath) actionIssues.push(`Missing PropertyInspectorPath for ${action.Name}`);
}
assert(actionIssues.length === 0, `All actions have required fields${actionIssues.length > 0 ? ": " + actionIssues.join(", ") : ""}`);

// --- 3. Action names match app.js ACTION_LABELS ---
console.log("\n3. Action label coverage");
const expectedActions = [
  "task1", "task2", "task3", "task4", "task5",
  "proceed", "cancel", "attention", "subagents",
  "plan", "walkthrough", "usage", "usage5h", "usageweekly",
  "new", "navigate", "hud", "boost", "grillme", "goal", "tokens"
];
for (const name of expectedActions) {
  assert(appSource.includes(`${name}:`), `ACTION_LABELS has '${name}'`);
}

// --- 4. Property Inspector exists ---
console.log("\n4. Property Inspector");
const piPath = resolve(PLUGIN_ROOT, "property-inspector/setup.html");
assert(existsSync(piPath), "setup.html exists");

const piSource = readFileSync(piPath, "utf-8");
assert(piSource.includes("127.0.0.1:17374"), "PI references bridge endpoint");

// --- 5. Bridge source validation ---
console.log("\n5. Bridge source files");
const bridgeDir = resolve(PLUGIN_ROOT, "../../src/bridge-antigravity");
const serverPath = resolve(bridgeDir, "server.mjs");
const readerPath = resolve(bridgeDir, "state-reader.mjs");

assert(existsSync(serverPath), "server.mjs exists");
assert(existsSync(readerPath), "state-reader.mjs exists");

if (existsSync(serverPath)) {
  const serverSrc = readFileSync(serverPath, "utf-8");
  assert(serverSrc.includes("scrollMatch"), "server.mjs has scroll endpoint");
  assert(serverSrc.includes("agentStatus"), "server.mjs includes agentStatus in digest");
  assert(serverSrc.includes('keystroke "l" using {command down}'), "slash commands focus chat input first");
}

if (existsSync(readerPath)) {
  const readerSrc = readFileSync(readerPath, "utf-8");
  assert(!readerSrc.includes("execSync"), "state-reader.mjs does not use execSync");
  assert(readerSrc.includes("invoke_subagent"), "state-reader.mjs parses subagent invocations");
}

// --- Summary ---
console.log(`\n${"=".repeat(40)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
console.log(`${"=".repeat(40)}\n`);

process.exit(failed > 0 ? 1 : 0);
