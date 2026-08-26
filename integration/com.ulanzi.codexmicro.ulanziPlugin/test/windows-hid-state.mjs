import assert from "node:assert/strict";
import { normalizeWindowsHidState } from "../plugin/windows-hid-state.js";

const state = normalizeWindowsHidState({
  connected: true,
  threads: [
    { id: 0, c: 0xFFFFFF, b: 1, e: 4 },
    { id: 1, c: 0x304FFE, b: 1, e: 1 },
    { id: 2, c: 0x00FF4C, b: 1, e: 1 },
    { id: 3, c: 0xFF0033, b: 1, e: 1 },
    { id: 4, c: 0, b: 0, e: 0 }
  ]
});

assert.equal(state.connected, true);
assert.equal(state.slots[0].status, "idle", "selected idle tasks must stay idle");
assert.equal(state.slots[0].selected, true, "breathing effect identifies selection only");
assert.equal(state.slots[1].status, "working");
assert.equal(state.slots[1].selected, false);
assert.equal(state.slots[2].status, "unread");
assert.equal(state.slots[3].status, "error");
assert.equal(state.slots[4].status, "off");
assert.equal(state.slots[4].threadKey, null);

process.stdout.write("Windows HID state mapping test passed.\n");
