const STATUS_BY_COLOR = new Map([
  [0x000000, "off"],
  [0xFFFFFF, "idle"],
  [0x304FFE, "working"],
  [0x00FF4C, "unread"],
  [0xFF0033, "error"]
]);

export function normalizeWindowsHidState(payload) {
  const threads = Array.isArray(payload?.threads) ? payload.threads : [];
  const slots = Array.from({ length: 6 }, (_, id) => {
    const thread = threads.find(item => Number(item?.id) === id);
    const color = Number(thread?.c) || 0;
    const active = Number(thread?.b) > 0 && color > 0;
    const selected = active && Number(thread?.e) === 4;
    return {
      id,
      threadKey: active ? `slot:${id}` : null,
      title: active ? `Task ${id + 1}` : null,
      status: active ? STATUS_BY_COLOR.get(color) ?? "idle" : "off",
      selected
    };
  });
  return {
    connected: payload?.connected === true,
    slots,
    usage: null,
    lighting: payload?.lighting ?? null,
    updatedAt: payload?.updatedAt ?? null
  };
}
