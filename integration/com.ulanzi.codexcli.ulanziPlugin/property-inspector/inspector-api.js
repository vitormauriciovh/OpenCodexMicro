/* Browser-side Ulanzi relay. Bridge credentials never enter the inspector. */
(() => {
  const query = new URLSearchParams(location.search);
  const context = { uuid: query.get("uuid") || document.documentElement.dataset.action, actionid: query.get("actionid") || "", key: query.get("key") || "" };
  const pending = new Map();
  let socket, sequence = 0, ready;
  function connect() {
    ready = new Promise(resolve => {
      socket = new WebSocket(`ws://${query.get("address") || "127.0.0.1"}:${query.get("port") || "3906"}`);
      socket.addEventListener("open", () => { socket.send(JSON.stringify({ code: 0, cmd: "connected", uuid: context.uuid })); resolve(); });
      socket.addEventListener("message", event => {
        let message; try { message = JSON.parse(event.data); } catch { return; }
        const result = message.payload;
        if (message.cmd !== "sendToPropertyInspector" || result?.type !== "localApiResult") return;
        const request = pending.get(result.requestId);
        if (request) { pending.delete(result.requestId); clearTimeout(request.timer); result.error ? request.reject(new Error(result.error)) : request.resolve(result.data); }
      });
      socket.addEventListener("close", () => {
        for (const request of pending.values()) { clearTimeout(request.timer); request.reject(new Error("Ulanzi connection closed")); }
        pending.clear(); setTimeout(connect, 1000);
      });
    });
  }
  connect();
  window.localFetch = async (url, options = {}) => {
    let timeout;
    try { await Promise.race([ready, new Promise((_, reject) => { timeout = setTimeout(() => reject(new Error("Open this inspector in Ulanzi Studio")), 5000); })]); }
    finally { clearTimeout(timeout); }
    const target = new URL(url, location.href);
    const data = await new Promise((resolve, reject) => {
      const requestId = ++sequence;
      const timer = setTimeout(() => { pending.delete(requestId); reject(new Error("Local operation timed out; check status before retrying")); }, 120000);
      pending.set(requestId, { resolve, reject, timer });
      socket.send(JSON.stringify({ cmd: "sendToPlugin", ...context, payload: { type: "localApi", requestId, path: target.pathname + target.search, method: options.method || "GET", body: options.body } }));
    });
    return { ok: true, status: 200, json: async () => data };
  };
})();
