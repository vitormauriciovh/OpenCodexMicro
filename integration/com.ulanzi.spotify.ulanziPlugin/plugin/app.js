import { createServer } from "node:http";
import { execFile } from "node:child_process";
import WebSocket from "ws";
import { SpotifyLocalController } from "./spotify-local.js";
import { SpotifyApiClient } from "./spotify-api.js";

const rawArgs = process.argv.slice(2);
let address = "127.0.0.1";
let port = "3906";
let pluginUUID = "com.ulanzi.ulanzistudio.spotify";

if (rawArgs.length >= 2 && !rawArgs[0].startsWith("-")) {
  address = rawArgs[0];
  port = rawArgs[1];
}

for (let i = 0; i < rawArgs.length; i++) {
  const arg = rawArgs[i];
  if (arg === "-port" || arg === "--port") {
    port = rawArgs[++i];
  } else if (arg === "-pluginUUID" || arg === "--pluginUUID") {
    pluginUUID = rawArgs[++i];
  }
}

const PLUGIN_UUID = pluginUUID;
const HTTP_PORT = Number(process.env.SPOTIFY_PLUGIN_HTTP_PORT || 17375);
const HOST_URL = `ws://${address}:${port}`;

const spotifyLocal = new SpotifyLocalController();
const spotifyApi = new SpotifyApiClient();

let socket = null;
let reconnectTimer = null;
let pollTimer = null;
let pollInFlight = false;
let currentState = null;
let playlists = [];
let playlistOffset = 0;

const instances = new Map();

function contextOf(message) {
  return String(message.actionid || `${message.uuid}___${message.key || ""}`);
}

function actionName(uuid) {
  return String(uuid || "").split(".").pop();
}

function escapeXml(str) {
  return String(str || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function renderNowPlayingSvg(state, coverBase64) {
  const isRunning = state?.isRunning && state?.playerState === "playing";
  const track = state?.track || {};
  const title = escapeXml(track.name || "Spotify Paused");
  const artist = escapeXml(track.artist || (state?.isRunning ? "No active track" : "Spotify not running"));

  const posSec = Math.round(state?.playerPosition || 0);
  const durSec = Math.round((track.duration || 0) / 1000) || 1;
  const progressPct = Math.min(100, Math.max(0, Math.round((posSec / durSec) * 100)));
  const progressWidth = Math.round((progressPct / 100) * 160);

  const posMin = Math.floor(posSec / 60);
  const posRemSec = String(posSec % 60).padStart(2, "0");
  const durMin = Math.floor(durSec / 60);
  const durRemSec = String(durSec % 60).padStart(2, "0");
  const timeText = `${posMin}:${posRemSec} / ${durMin}:${durRemSec}`;

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="200" height="200" viewBox="0 0 200 200">
    <defs>
      <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="#181818"/>
        <stop offset="100%" stop-color="#0a0a0a"/>
      </linearGradient>
      <linearGradient id="bar" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0%" stop-color="#1DB954"/>
        <stop offset="100%" stop-color="#1ed760"/>
      </linearGradient>
      <clipPath id="artClip">
        <rect x="16" y="16" width="60" height="60" rx="8" ry="8"/>
      </clipPath>
    </defs>
    <rect width="200" height="200" rx="18" fill="url(#bg)"/>
    
    <!-- Cover Art -->
    ${coverBase64 ? `
      <image x="16" y="16" width="60" height="60" clip-path="url(#artClip)" href="data:image/jpeg;base64,${coverBase64}" xlink:href="data:image/jpeg;base64,${coverBase64}"/>
    ` : `
      <rect x="16" y="16" width="60" height="60" rx="8" fill="#282828"/>
      <circle cx="46" cy="46" r="14" fill="#1DB954" fill-opacity="0.8"/>
      <path d="M40 38 L55 46 L40 54 Z" fill="#ffffff"/>
    `}
    <rect x="16" y="16" width="60" height="60" rx="8" fill="none" stroke="#1DB954" stroke-width="2" stroke-opacity="${isRunning ? '0.8' : '0.2'}"/>

    <!-- Status & Info -->
    <text x="86" y="32" font-family="-apple-system,BlinkMacSystemFont,Arial,sans-serif" font-size="10" font-weight="700" fill="${isRunning ? '#1DB954' : '#888888'}" letter-spacing="1">
      ${isRunning ? "▶ PLAYING" : "❚❚ PAUSED"}
    </text>
    <text x="86" y="52" font-family="-apple-system,BlinkMacSystemFont,Arial,sans-serif" font-size="13" font-weight="700" fill="#ffffff">
      ${title.length > 14 ? title.slice(0, 13) + "…" : title}
    </text>
    <text x="86" y="68" font-family="-apple-system,BlinkMacSystemFont,Arial,sans-serif" font-size="10" font-weight="500" fill="#b3b3b3">
      ${artist.length > 16 ? artist.slice(0, 15) + "…" : artist}
    </text>

    <!-- Progress Track -->
    <rect x="20" y="96" width="160" height="6" rx="3" fill="#333333"/>
    <rect x="20" y="96" width="${progressWidth}" height="6" rx="3" fill="url(#bar)"/>
    <circle cx="${20 + progressWidth}" cy="99" r="5" fill="#ffffff"/>

    <!-- Time & Volume -->
    <text x="20" y="118" font-family="-apple-system,BlinkMacSystemFont,Arial,sans-serif" font-size="9" font-weight="600" fill="#a0a0a0">
      ${timeText}
    </text>
    <text x="180" y="118" text-anchor="end" font-family="-apple-system,BlinkMacSystemFont,Arial,sans-serif" font-size="9" font-weight="600" fill="#1DB954">
      VOL ${state?.soundVolume || 0}%
    </text>
  </svg>`;
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
}

function renderPlaylistItemSvg(item, isCurrent, slotNum = 1) {
  const title = escapeXml(item?.title || `Slot ${slotNum}`);
  const coverBase64 = item?.coverBase64;

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="200" height="200" viewBox="0 0 200 200">
    <defs>
      <linearGradient id="cardBg" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stop-color="#181818"/>
        <stop offset="100%" stop-color="#0e0e0e"/>
      </linearGradient>
      <linearGradient id="overlay" x1="0" y1="0.3" x2="0" y2="1">
        <stop offset="0%" stop-color="#000000" stop-opacity="0"/>
        <stop offset="100%" stop-color="#000000" stop-opacity="0.95"/>
      </linearGradient>
      <clipPath id="cardClip">
        <rect width="200" height="200" rx="20"/>
      </clipPath>
    </defs>
    <rect width="200" height="200" rx="20" fill="url(#cardBg)"/>
    
    ${coverBase64 ? `
      <image width="200" height="200" clip-path="url(#cardClip)" preserveAspectRatio="xMidYMid slice" href="data:image/jpeg;base64,${coverBase64}" xlink:href="data:image/jpeg;base64,${coverBase64}"/>
    ` : `
      <g transform="translate(100, 75)">
        <circle cx="0" cy="0" r="32" fill="#242424" stroke="#333333" stroke-width="2"/>
        <circle cx="-6" cy="6" r="6" fill="#1DB954"/>
        <circle cx="10" cy="0" r="6" fill="#1DB954"/>
        <path d="M0 6 L0 -14 L16 -20 L16 0" stroke="#1DB954" stroke-width="3" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
      </g>
    `}
    
    <rect width="200" height="200" rx="20" fill="url(#overlay)"/>
    
    <!-- Active Highlight Border -->
    <rect x="2" y="2" width="196" height="196" rx="18" fill="none" stroke="${isCurrent ? '#1DB954' : '#2e2e2e'}" stroke-width="${isCurrent ? '5' : '1.5'}"/>
    
    ${isCurrent ? `
      <g transform="translate(26, 26)">
        <circle cx="0" cy="0" r="10" fill="#1DB954"/>
        <polygon points="-3,-5 5,0 -3,5" fill="#000000"/>
      </g>
    ` : ""}

    <!-- Top Slot Badge -->
    <g transform="translate(100, 24)">
      <rect x="-35" y="-10" width="70" height="20" rx="10" fill="rgba(0,0,0,0.6)" stroke="rgba(255,255,255,0.15)" stroke-width="1"/>
      <text x="0" y="4" text-anchor="middle" font-family="-apple-system,BlinkMacSystemFont,Arial,sans-serif" font-size="10" font-weight="800" fill="#1DB954" letter-spacing="0.5">SLOT ${slotNum}</text>
    </g>

    <!-- Title text -->
    <text x="100" y="168" text-anchor="middle" font-family="-apple-system,BlinkMacSystemFont,Arial,sans-serif" font-size="14" font-weight="800" fill="#ffffff" letter-spacing="0.2">
      ${title.length > 16 ? title.slice(0, 15) + "…" : title}
    </text>
  </svg>`;
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
}

function renderTransportSvg(type, state) {
  const isPlaying = state?.playerState === "playing";
  const isShuffle = state?.shuffling;
  const isRepeat = state?.repeating;

  let iconSvg = "";
  let label = "";
  let accent = "#ffffff";

  if (type === "playpause") {
    label = isPlaying ? "PAUSE" : "PLAY";
    accent = isPlaying ? "#1DB954" : "#ffffff";
    iconSvg = isPlaying
      ? `<rect x="75" y="65" width="18" height="50" rx="4" fill="${accent}"/><rect x="107" y="65" width="18" height="50" rx="4" fill="${accent}"/>`
      : `<polygon points="75,60 140,90 75,120" fill="${accent}"/>`;
  } else if (type === "next") {
    label = "NEXT";
    iconSvg = `<polygon points="70,65 110,90 70,115" fill="#ffffff"/><polygon points="105,65 145,90 105,115" fill="#ffffff"/>`;
  } else if (type === "prev") {
    label = "PREV";
    iconSvg = `<polygon points="130,65 90,90 130,115" fill="#ffffff"/><polygon points="95,65 55,90 95,115" fill="#ffffff"/>`;
  } else if (type === "like") {
    label = "LIKE";
    accent = "#1DB954";
    iconSvg = `<path d="M100 120 L55 75 C40 60, 65 35, 85 55 L100 70 L115 55 C135 35, 160 60, 145 75 Z" fill="${accent}"/>`;
  } else if (type === "shuffle") {
    label = "SHUFFLE";
    accent = isShuffle ? "#1DB954" : "#888888";
    iconSvg = `<path d="M60 115 L95 115 L125 65 L145 65 M135 55 L145 65 L135 75 M60 65 L95 65 L125 115 L145 115 M135 105 L145 115 L135 125" stroke="${accent}" stroke-width="8" stroke-linecap="round" stroke-linejoin="round" fill="none"/>`;
  } else if (type === "repeat") {
    label = "REPEAT";
    accent = isRepeat ? "#1DB954" : "#888888";
    iconSvg = `<path d="M70 75 L130 75 C140 75, 145 80, 145 90 L145 95 M135 65 L145 75 L135 85 M130 115 L70 115 C60 115, 55 110, 55 100 L55 95 M65 125 L55 115 L65 105" stroke="${accent}" stroke-width="8" stroke-linecap="round" stroke-linejoin="round" fill="none"/>`;
  }

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200" viewBox="0 0 200 200">
    <rect width="200" height="200" rx="16" fill="#181818"/>
    <rect width="200" height="200" rx="16" fill="none" stroke="#282828" stroke-width="2"/>
    ${iconSvg}
    <text x="100" y="165" text-anchor="middle" font-family="-apple-system,BlinkMacSystemFont,Arial,sans-serif" font-size="12" font-weight="700" fill="${accent}" letter-spacing="1">
      ${label}
    </text>
  </svg>`;
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
}

function renderVolumeDialSvg(state) {
  const vol = state?.soundVolume || 0;
  const r = 60;
  const circ = 2 * Math.PI * r;
  const fill = (vol / 100) * circ;

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200" viewBox="0 0 200 200">
    <rect width="200" height="200" rx="16" fill="#141414"/>
    <circle cx="100" cy="90" r="${r}" fill="none" stroke="#282828" stroke-width="12"/>
    <circle cx="100" cy="90" r="${r}" fill="none" stroke="#1DB954" stroke-width="12" stroke-linecap="round" stroke-dasharray="${fill} ${circ - fill}" transform="rotate(-90 100 90)"/>
    <text x="100" y="98" text-anchor="middle" font-family="-apple-system,BlinkMacSystemFont,Arial,sans-serif" font-size="24" font-weight="800" fill="#ffffff">
      ${vol}%
    </text>
    <text x="100" y="165" text-anchor="middle" font-family="-apple-system,BlinkMacSystemFont,Arial,sans-serif" font-size="12" font-weight="700" fill="#1DB954" letter-spacing="1">
      VOLUME
    </text>
  </svg>`;
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
}

function send(payload) {
  if (socket && socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify(payload));
  }
}

function ack(message) {
  send({
    code: 0,
    cmd: message.cmd,
    uuid: message.uuid,
    actionid: message.actionid,
    key: message.key,
    active: message.active,
    param: message.param || {}
  });
}

function sendSvgState(instance, dataUrl) {
  if (!instance.active || instance.lastDisplay === dataUrl) return;
  instance.lastDisplay = dataUrl;
  send({
    cmd: "state",
    param: {
      statelist: [
        {
          uuid: instance.uuid,
          actionid: instance.actionid,
          key: instance.key,
          type: 1,
          data: dataUrl,
          showtext: false,
          textdata: ""
        },
        {
          uuid: instance.uuid,
          actionid: instance.actionid,
          key: instance.key,
          type: 0,
          state: 0,
          showtext: false,
          textdata: ""
        }
      ]
    }
  });
}

async function renderInstance(instance) {
  if (!instance.active) return;
  const name = actionName(instance.uuid);
  const state = currentState || (await spotifyLocal.getState());

  if (name === "nowplaying") {
    let coverBase64 = null;
    if (state?.track?.artworkUrl) {
      coverBase64 = await spotifyApi.getCoverBase64(state.track.artworkUrl);
    }
    sendSvgState(instance, renderNowPlayingSvg(state, coverBase64));
    return;
  }

  if (name === "volume") {
    sendSvgState(instance, renderVolumeDialSvg(state));
    return;
  }

  if (["playpause", "next", "prev", "like", "shuffle", "repeat"].includes(name)) {
    sendSvgState(instance, renderTransportSvg(name, state));
    return;
  }

  if (name.startsWith("item")) {
    const slotIndex = Number(name.replace("item", "")) - 1;
    const actualIndex = slotIndex + playlistOffset;
    const item = playlists[actualIndex] || null;
    const isCurrent = Boolean(item && state?.track && (
      (item.uri && state.track.spotifyUrl && state.track.spotifyUrl.includes(item.uri)) ||
      (item.title && state.track.album && state.track.album.includes(item.title))
    ));
    sendSvgState(instance, renderPlaylistItemSvg(item, isCurrent, slotIndex + 1));
  }
}

function renderAll() {
  for (const instance of instances.values()) {
    renderInstance(instance);
  }
}

async function pollCycle() {
  if (pollInFlight) return;
  pollInFlight = true;
  try {
    currentState = await spotifyLocal.getState();
    renderAll();
  } catch {} finally {
    pollInFlight = false;
  }
}

async function reloadPlaylists() {
  try {
    playlists = await spotifyApi.loadResolvedPlaylists();
    renderAll();
  } catch {}
}

function addInstance(message) {
  const context = contextOf(message);
  const existing = instances.get(context);
  const instance = existing || {
    uuid: message.uuid,
    actionid: message.actionid,
    key: message.key,
    active: true,
    lastDisplay: null
  };
  instance.active = true;
  instances.set(context, instance);
  renderInstance(instance);
  return instance;
}

async function invokeKey(instance) {
  const name = actionName(instance.uuid);
  if (name === "playpause" || name === "nowplaying") {
    await spotifyLocal.playPause();
  } else if (name === "next") {
    await spotifyLocal.next();
  } else if (name === "prev") {
    await spotifyLocal.previous();
  } else if (name === "shuffle") {
    await spotifyLocal.toggleShuffle();
  } else if (name === "repeat") {
    await spotifyLocal.toggleRepeat();
  } else if (name.startsWith("item")) {
    const slotIndex = Number(name.replace("item", "")) - 1;
    const item = playlists[slotIndex + playlistOffset];
    if (item?.uri) {
      await spotifyLocal.playUri(item.uri);
    }
  }
  setTimeout(pollCycle, 150);
}

function handleMessage(raw) {
  let message;
  try {
    message = JSON.parse(String(raw));
  } catch {
    return;
  }

  if (message.cmd === "add" || message.cmd === "paramfromapp") {
    addInstance(message);
    ack(message);
    return;
  }

  if (message.cmd === "setactive") {
    const instance = instances.get(contextOf(message)) || addInstance(message);
    instance.active = Boolean(message.active);
    if (instance.active) {
      instance.lastDisplay = null;
      renderInstance(instance);
    }
    ack(message);
    return;
  }

  if (message.cmd === "clear") {
    for (const item of message.param || []) {
      instances.delete(contextOf(item));
    }
    ack(message);
    return;
  }

  if (message.cmd === "run") {
    ack(message);
    return;
  }

  if (["dialdown", "dialup", "dialrotate"].includes(message.cmd)) {
    const instance = instances.get(contextOf(message)) || addInstance(message);
    const name = actionName(instance.uuid);
    if (message.cmd === "dialrotate") {
      const ticks = Number(message.param?.rotate || message.rotate || 1);
      if (name === "volume") {
        void spotifyLocal.changeVolume(ticks * 4);
      } else if (name === "scroll") {
        playlistOffset = Math.max(0, playlistOffset + (ticks > 0 ? 1 : -1));
        renderAll();
      }
    } else if (message.cmd === "dialdown") {
      if (name === "volume") {
        void spotifyLocal.playPause();
      }
    }
    ack(message);
    return;
  }

  if (["keydown", "keyup"].includes(message.cmd)) {
    const instance = instances.get(contextOf(message)) || addInstance(message);
    if (message.cmd === "keydown") {
      void invokeKey(instance);
    }
    ack(message);
  }
}

function startHttpServer() {
  const server = createServer(async (req, res) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");

    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    const url = new URL(req.url, `http://${req.headers.host || "127.0.0.1"}`);

    if (url.pathname === "/status" && req.method === "GET") {
      const state = currentState || (await spotifyLocal.getState());
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        state,
        playlists,
        playlistsFile: spotifyApi.playlistsFile
      }));
      return;
    }

    if (url.pathname === "/playlists" && req.method === "POST") {
      let body = "";
      req.on("data", chunk => { body += chunk; });
      req.on("end", async () => {
        try {
          const payload = JSON.parse(body);
          const links = Array.isArray(payload.links) ? payload.links : [];
          await spotifyApi.savePlaylists(links);
          await reloadPlaylists();
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: true, count: playlists.length }));
        } catch (e) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: false, error: e.message }));
        }
      });
      return;
    }

    if (url.pathname === "/play" && req.method === "POST") {
      let body = "";
      req.on("data", chunk => { body += chunk; });
      req.on("end", async () => {
        try {
          const payload = JSON.parse(body);
          if (payload.uri) {
            await spotifyLocal.playUri(payload.uri);
          }
          setTimeout(pollCycle, 150);
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: true }));
        } catch (e) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: false, error: e.message }));
        }
      });
      return;
    }

    if (url.pathname === "/auth/start" && req.method === "GET") {
      const clientId = url.searchParams.get("clientId") || "";
      if (!clientId) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: false, error: "Missing clientId" }));
        return;
      }
      const authUrl = spotifyApi.createPkceAuthUrl(clientId, `http://127.0.0.1:${HTTP_PORT}/callback`);
      execFile("/usr/bin/open", [authUrl], () => {});
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, url: authUrl }));
      return;
    }

    if (url.pathname === "/callback" && req.method === "GET") {
      const code = url.searchParams.get("code");
      const state = url.searchParams.get("state");
      const error = url.searchParams.get("error");

      if (error || !code) {
        res.writeHead(400, { "Content-Type": "text/html; charset=utf-8" });
        res.end(`<html><body style="font-family:sans-serif;background:#121212;color:#ef8585;text-align:center;padding:50px;">
          <h2>Erro na Autorização do Spotify</h2>
          <p>${escapeXml(error || "Código de autorização não recebido")}</p>
        </body></html>`);
        return;
      }

      try {
        await spotifyApi.handleAuthCallback(code, state);
        const fetched = await spotifyApi.fetchUserPlaylistsFromApi();
        await reloadPlaylists();

        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(`<html><body style="font-family:sans-serif;background:#121212;color:#1DB954;text-align:center;padding:50px;">
          <h1 style="color:#1DB954;">✓ Conectado ao Spotify com Sucesso!</h1>
          <p style="color:#ffffff;font-size:16px;">${fetched?.length || 0} playlists foram sincronizadas com o seu Ulanzi D200.</p>
          <p style="color:#888888;font-size:14px;">Você já pode fechar esta aba e voltar ao Ulanzi Studio.</p>
        </body></html>`);
      } catch (e) {
        res.writeHead(500, { "Content-Type": "text/html; charset=utf-8" });
        res.end(`<html><body style="font-family:sans-serif;background:#121212;color:#ef8585;text-align:center;padding:50px;">
          <h2>Erro ao processar autorização</h2>
          <p>${escapeXml(e.message)}</p>
        </body></html>`);
      }
      return;
    }

    if (url.pathname === "/auth/status" && req.method === "GET") {
      const token = await spotifyApi.getValidAccessToken();
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, isAuthenticated: Boolean(token) }));
      return;
    }

    if (url.pathname === "/sync" && req.method === "POST") {
      try {
        const fetched = await spotifyApi.fetchUserPlaylistsFromApi();
        if (fetched) {
          await reloadPlaylists();
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: true, count: fetched.length }));
        } else {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: false, error: "Não autenticado via Spotify Web API." }));
        }
      } catch (e) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: false, error: e.message }));
      }
      return;
    }

    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Not found" }));
  });

  server.listen(HTTP_PORT, "127.0.0.1", () => {
    // HTTP bridge running on 127.0.0.1:17375
  });

  server.on("error", () => {
    // Port might be in use, ignore
  });
}

function connect() {
  clearTimeout(reconnectTimer);
  socket = new WebSocket(HOST_URL);

  socket.on("open", () => {
    send({ code: 0, cmd: "connected", uuid: PLUGIN_UUID });
    clearInterval(pollTimer);
    pollTimer = setInterval(pollCycle, 500);
    pollTimer.unref();
    void pollCycle();
  });

  socket.on("message", handleMessage);

  socket.on("close", () => {
    clearInterval(pollTimer);
    reconnectTimer = setTimeout(connect, 1000);
    reconnectTimer.unref();
  });

  socket.on("error", () => {
    socket?.close();
  });
}

startHttpServer();
reloadPlaylists().then(connect);

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    clearTimeout(reconnectTimer);
    clearInterval(pollTimer);
    socket?.close();
    process.exit(0);
  });
}
