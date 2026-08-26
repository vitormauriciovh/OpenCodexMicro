import assert from "node:assert/strict";
import { normalizeCodexRateLimits } from "../plugin/windows-codex-usage.js";

const usage = normalizeCodexRateLimits({
  rateLimits: {
    primary: { usedPercent: 9, windowDurationMins: 10080, resetsAt: 1787801767 },
    secondary: { usedPercent: 25, windowDurationMins: 300, resetsAt: 1787231800 }
  }
}, 1234);

assert.deepEqual(usage, {
  windows: [
    {
      id: "weekly",
      kind: "weekly",
      usedPercent: 9,
      remainingPercent: 91,
      resetsAt: 1787801767
    },
    {
      id: "five-hour",
      kind: "five-hour",
      usedPercent: 25,
      remainingPercent: 75,
      resetsAt: 1787231800
    }
  ],
  observedAt: 1234
});

const preferred = normalizeCodexRateLimits({
  rateLimits: { primary: { usedPercent: 99, windowDurationMins: 10080 } },
  rateLimitsByLimitId: {
    codex: { primary: { usedPercent: 12, windowDurationMins: 10080 } }
  }
});
assert.equal(preferred.windows[0].remainingPercent, 88);
assert.equal(normalizeCodexRateLimits({ rateLimits: {} }), null);

process.stdout.write("Windows Codex usage mapping test passed.\n");
