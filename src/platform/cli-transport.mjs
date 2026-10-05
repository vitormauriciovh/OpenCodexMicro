import net from "node:net";
import WebSocket from "ws";
import { localHeaders } from "../shared/local-api.mjs";

export const WINDOWS_CLI_URL = "ws://127.0.0.1:17377";
export function validateCliUrl(endpoint) {
  const url = new URL(endpoint);
  if (url.protocol !== "ws:" || url.hostname !== "127.0.0.1" || !url.port || url.username || url.password || url.search || url.hash || url.pathname !== "/") {
    throw new Error("Windows CLI app-server must use an authenticated ws://127.0.0.1:PORT endpoint");
  }
  return url.href;
}
export function createCliConnection(endpoint, { platform = process.platform, headers = () => localHeaders("codex-cli-server") } = {}) {
  const options = { handshakeTimeout: 8000, perMessageDeflate: false, maxPayload: 16 * 1024 * 1024 };
  if (platform === "win32") return new WebSocket(validateCliUrl(endpoint), { ...options, headers: headers(), followRedirects: false });
  return new WebSocket("ws://localhost/", { ...options, createConnection: () => net.createConnection(endpoint) });
}
