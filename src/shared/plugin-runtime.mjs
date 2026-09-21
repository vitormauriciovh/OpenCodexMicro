import WebSocket from "ws";
import { localHeaders } from "./local-api.mjs";

export function encoderTicks(message) {
  const named = { left: -1, "hold-left": -1, right: 1, "hold-right": 1 }[message.rotateEvent];
  if (named !== undefined) return named;
  const raw = message.param?.ticks ?? message.param?.rotate ?? message.rotate;
  const n = Number(raw);
  return Number.isFinite(n) ? Math.max(-20, Math.min(20, Math.trunc(n))) : 0;
}
export function stateDigest(state) {
  // Only sampling metadata is excluded; all consumer-visible state participates.
  const { updatedAt, bridgeSnapshot, ...publicState } = state;
  return JSON.stringify(publicState, (key, value) => key === "observedAt" ? undefined : value);
}
export function invalidateDisplays(instances) {
  for (const instance of instances.values()) instance.lastDisplay = null;
}
export function reportActionError(send, instance, error) {
  send({ cmd: "logMessage", uuid: instance.uuid, actionid: instance.actionid, key: instance.key, level: "error", message: error.message });
  send({ cmd: "showAlert", uuid: instance.uuid, actionid: instance.actionid, key: instance.key });
}
export function bridgeFeed({ component, url, poll, onState }) {
  let socket, retry, fallback, generation = 0;
  function stop() {
    generation++;
    clearTimeout(retry); clearInterval(fallback);
    const previous = socket; socket = null;
    previous?.close();
  }
  function start() {
    stop();
    const current = generation;
    const connect = () => {
      if (current !== generation) return;
      const ws = new WebSocket(url.replace(/^http/, "ws") + "/events", { headers: localHeaders(component), handshakeTimeout: 4000 });
      socket = ws;
      ws.on("message", raw => {
        if (current !== generation || socket !== ws) return;
        try {
          const state = JSON.parse(String(raw));
          if (typeof state.connected !== "boolean" || !Array.isArray(state.slots)) throw new Error("Invalid bridge state");
          onState(state);
        } catch { void poll(); }
      });
      ws.on("error", () => ws.close());
      ws.on("close", () => {
        if (current !== generation || socket !== ws) return;
        socket = null;
        retry = setTimeout(connect, 2000); retry.unref();
        void poll();
      });
    };
    fallback = setInterval(() => void poll(), 5000); fallback.unref();
    connect();
  }
  return { start, stop };
}
export function inspectorReply(send, message, payload) {
  send({ cmd: "sendToPropertyInspector", uuid: message.uuid, actionid: message.actionid, key: message.key, payload: { type: "localApiResult", requestId: message.payload.requestId, ...payload } });
}
export function unavailableIcon() {
  return `data:image/svg+xml;base64,${Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="196" height="196"><rect width="196" height="196" rx="20" fill="#171b22"/><text x="98" y="88" text-anchor="middle" fill="#aab2bf" font-family="sans-serif" font-size="17">USE EDITOR</text><text x="98" y="118" text-anchor="middle" fill="#78818f" font-family="sans-serif" font-size="12">Control unavailable</text></svg>').toString("base64")}`;
}
