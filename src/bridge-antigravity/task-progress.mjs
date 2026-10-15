import { summarizePlan } from '../shared/task-progress.mjs';

// Antigravity's native task artifact is a saved checklist, not a live percentage.
export function readChecklistProgress(markdown) {
  if (typeof markdown !== 'string' || Buffer.byteLength(markdown) > 65536) return null;
  const steps = [];
  let fence = null;
  for (const line of markdown.split(/\r?\n/)) {
    const marker = line.match(/^\s{0,3}(`{3,}|~{3,})/);
    if (marker) {
      if (!fence) fence = marker[1];
      else if (marker[1][0] === fence[0] && marker[1].length >= fence.length) fence = null;
      continue;
    }
    if (fence) continue;
    // Some native task artifacts wrap the checkbox in Markdown backticks.
    const match = line.match(/^\s*[-*+]\s+(?:\[([ xX/\-])\]|`\[([ xX/\-])\]`)\s+(.+?)\s*$/);
    if (!match) continue;
    const mark = match[1] ?? match[2];
    steps.push({ step: match[3], status: /[xX]/.test(mark) ? 'completed' : ['/', '-'].includes(mark) ? 'inProgress' : 'pending' });
    if (steps.length > 200) return null;
  }
  const progress = summarizePlan(steps);
  return progress ? { ...progress, source: 'saved-checklist' } : null;
}
