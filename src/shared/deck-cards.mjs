const xml = value => String(value ?? '').replace(/[<>&"']/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' }[c]));
export function textCard(title, value, detail = '', connected = true) {
  const shown = String(connected ? value ?? 'Unknown' : 'OFFLINE').replace(/\s+/g, ' ');
  const display = shown.length > 32 ? shown.slice(0, 31) + '…' : shown;
  const fontSize = Math.max(12, Math.min(25, Math.floor(168 / Math.max(1, display.length * 0.58))));
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="196" height="196"><rect width="196" height="196" rx="24" fill="#0d1117"/><rect x="2" y="2" width="192" height="192" rx="22" fill="none" stroke="#334155" stroke-width="2"/><text x="98" y="40" text-anchor="middle" font-family="sans-serif" font-size="15" fill="#94a3b8">${xml(title)}</text><text x="98" y="105" text-anchor="middle" font-family="sans-serif" font-size="${fontSize}" fill="#f1f5f9">${xml(display)}</text><text x="98" y="160" text-anchor="middle" font-family="sans-serif" font-size="11" fill="#38bdf8">${xml(detail)}</text></svg>`;
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
}
export function usageCard(usage, kind, connected, now = Date.now()) {
  const windows = usage?.windows || [];
  const label = kind === 'weekly' ? 'WEEKLY USAGE' : kind === 'five-hour' ? '5H USAGE' : 'USAGE';
  const remaining = window => window?.remainingPercent == null ? '—' : `${Math.round(window.remainingPercent)}%`;
  if (!kind) return textCard(label, remaining(windows.find(w => w.kind === 'five-hour')), `Weekly ${remaining(windows.find(w => w.kind === 'weekly'))}`, connected);
  const window = windows.find(w => w.kind === kind);
  const resetMs = window?.resetsAt ? window.resetsAt * 1000 - now : null;
  const reset = resetMs === null ? 'Reset unknown' : resetMs <= 0 ? 'Refreshing allowance' : `Reset in ${Math.ceil(resetMs / 60000)} min`;
  return textCard(label, remaining(window), reset, connected);
}
