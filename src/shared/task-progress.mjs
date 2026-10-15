// Counts represent completed plan steps, never time or estimated work remaining.
export function taskProgressMarkup(progress, { running = false, color = "#94a3b8", now = Date.now() } = {}) {
  const valid = Number.isInteger(progress?.total) && progress.total > 0 && progress.total <= 200
    && Number.isInteger(progress.completed) && progress.completed >= 0 && progress.completed <= progress.total;
  const escape = text => String(text).replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[char]);
  const rawStep = valid ? String(progress.currentStep ?? "") : "";
  const step = [...rawStep];
  const label = valid ? `${progress.completed}/${progress.total}` : running ? "…" : "—";
  const width = valid ? 172 * progress.completed / progress.total : running ? 34 : 0;
  const x = valid ? 12 : 12 + (Math.floor(now / 1000) % 5) * 34;
  return `<text x="98" y="112" text-anchor="middle" font-family="-apple-system,BlinkMacSystemFont,Arial,sans-serif" font-size="13" fill="${color}">${label}</text>
    <text x="98" y="130" text-anchor="middle" font-family="-apple-system,BlinkMacSystemFont,Arial,sans-serif" font-size="12" fill="#cbd5e1">${escape(step.length > 23 ? step.slice(0, 22).join("") + "…" : rawStep)}</text>
    <rect x="12" y="138" width="172" height="6" rx="3" fill="#21262d"/>
    ${width > 0 ? `<rect x="${x}" y="138" width="${width}" height="6" rx="3" fill="${color}"/>` : ""}`;
}

export function summarizePlan(steps, turnId = null) {
  if (!Array.isArray(steps) || steps.length === 0 || steps.length > 200) return null;
  if (steps.some(step => typeof step?.step !== "string" || !["pending", "inProgress", "in_progress", "completed"].includes(step.status))) return null;
  const completed = steps.filter(step => step.status === "completed").length;
  const current = steps.find(step => ["inProgress", "in_progress"].includes(step.status)) ?? steps.find(step => step.status === "pending");
  return { turnId, completed, total: steps.length, currentStep: current?.step.slice(0, 240) ?? null };
}
