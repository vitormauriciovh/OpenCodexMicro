import { mkdirSync, readFileSync, writeFileSync, chmodSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { randomBytes, timingSafeEqual } from "node:crypto";

export function localHeaders(component) {
  if (!/^[a-z-]+$/.test(component)) throw new Error("Invalid component");
  const root = process.env.ULANZI_AUTH_DIR || join(homedir(), ".local/share/ulanzi-bridges");
  mkdirSync(root, { recursive: true, mode: 0o700 });
  chmodSync(root, 0o700);
  const file = join(root, `${component}.token`);
  try { writeFileSync(file, randomBytes(32).toString("hex"), { flag: "wx", mode: 0o600 }); }
  catch (error) { if (error.code !== "EEXIST") throw error; }
  chmodSync(file, 0o600);
  const token = readFileSync(file, "utf8").trim();
  if (!/^[a-f0-9]{64}$/.test(token)) throw new Error("Invalid local bridge credential; remove the component token file to regenerate it");
  return { Authorization: `Bearer ${token}` };
}
export function allowedRequest(request, component, port, { oauthCallback = false } = {}) {
  // Check the authority even for OAuth redirects to reject DNS rebinding.
  if (![ `127.0.0.1:${port}`, `localhost:${port}`, `[::1]:${port}` ].includes(request.headers.host)) return false;
  if (oauthCallback && request.method === "GET" && new URL(request.url, "http://localhost").pathname === "/callback") return true;
  if (request.headers.origin || (request.headers["sec-fetch-site"] && request.headers["sec-fetch-site"] !== "none")) return false;
  const actual = Buffer.from(request.headers.authorization || "");
  const expected = Buffer.from(localHeaders(component).Authorization);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
export function json(response, status, payload) {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  response.end(JSON.stringify(payload));
}
export function secureHandler(component, port, handler, options = {}) {
  return async (request, response) => {
    try {
      if (!allowedRequest(request, component, port, options)) return json(response, 403, { ok: false, error: "Unauthorized local client" });
      await handler(request, response);
    } catch (error) {
      if (!response.headersSent) json(response, error.status || 500, { ok: false, error: error.message });
      else response.end();
    }
  };
}
export async function readJson(request, limit = 65536) {
  let size = 0;
  const chunks = [];
  for await (const chunk of request) {
    size += Buffer.byteLength(chunk);
    if (size > limit) throw Object.assign(new Error("Request body too large"), { status: 413 });
    chunks.push(Buffer.from(chunk));
  }
  try {
    const value = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error();
    return value;
  } catch { throw Object.assign(new Error("Expected a JSON object"), { status: 400 }); }
}
export function localClient(component, baseUrl) {
  const url = new URL(baseUrl);
  if (url.protocol !== "http:" || !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)) throw new Error("Bridge URL must use HTTP loopback");
  return async (path, options = {}) => {
    if (!path.startsWith("/") || path.startsWith("//")) throw new Error("Invalid bridge path");
    const response = await fetch(new URL(path, url), { ...options, redirect: "error", signal: options.signal || AbortSignal.timeout(12000), headers: { ...options.headers, ...localHeaders(component) } });
    const payload = await response.json();
    if (!response.ok || payload.ok === false || payload.result?.ok === false) throw new Error(payload.error || payload.result?.error || `Bridge HTTP ${response.status}`);
    return payload;
  };
}
