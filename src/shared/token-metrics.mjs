// Keep self-contained: the desktop bridge also evaluates this in its renderer.
export function contextPercent(usage) {
  if (!usage || typeof usage !== 'object') return null;
  const direct = usage.usedPercent ?? usage.used_percent ?? usage.percentage ?? usage.percent;
  if (Number.isFinite(direct)) return Math.min(100, Math.max(0, Math.round(direct)));
  const window = usage.modelContextWindow ?? usage.model_context_window ?? usage.contextWindow ?? usage.context_window;
  let tokens = usage.contextTokens ?? usage.context_tokens ?? usage.last?.totalTokens ?? usage.last?.total_tokens;
  if (tokens == null) {
    const input = usage.last?.inputTokens ?? usage.last?.input_tokens;
    const output = usage.last?.outputTokens ?? usage.last?.output_tokens;
    if (Number.isFinite(input) && Number.isFinite(output)) tokens = input + output;
  }
  if (!Number.isFinite(window) || window <= 0 || !Number.isFinite(tokens) || tokens < 0) return null;
  return Math.min(100, Math.max(0, Math.round(tokens / window * 100)));
}
