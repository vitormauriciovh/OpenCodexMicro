import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { createHash, randomBytes } from "node:crypto";
import { spotifyUri, spotifyUrl } from "../../../src/shared/spotify-uri.mjs";
import { atomicJson } from "../../../src/shared/storage.mjs";

export class SpotifyApiClient {
  constructor({ cacheDir = path.join(os.homedir(), ".local/share/ulanzi-spotify"), fetchImpl = fetch, now = Date.now } = {}) {
    this.cacheDir = cacheDir;
    this.legacyPlaylistsFile = path.join(cacheDir, "playlists.json");
    this.playlistsFile = path.join(cacheDir, "imported-playlists.json");
    this.manualFile = path.join(cacheDir, "manual-playlists.json");
    this.tokensFile = path.join(cacheDir, "tokens.json");
    this.fetch = fetchImpl;
    this.now = now;
    this.coverCache = new Map();
    this.coverRequests = new Map();
    this.pendingAuth = null;
  }
  urlToUri(value) { return spotifyUri(value); }
  async request(url, options = {}) {
    const response = await this.fetch(url, { ...options, redirect: "error", signal: options.signal || AbortSignal.timeout(8000) });
    if (!response.ok) {
      const delay = response.headers?.get("retry-after");
      throw new Error(`Spotify HTTP ${response.status}${delay ? `; retry after ${delay}s` : ""}`);
    }
    return response;
  }
  async getCoverBase64(url) {
    if (!url) return null;
    let parsed;
    try { parsed = new URL(url); } catch { return null; }
    if (parsed.protocol !== "https:" || !["i.scdn.co", "mosaic.scdn.co", "image-cdn-ak.spotifycdn.com", "image-cdn-fa.spotifycdn.com"].includes(parsed.hostname)) return null;
    if (this.coverCache.has(url)) {
      const value = this.coverCache.get(url); this.coverCache.delete(url); this.coverCache.set(url, value); return value;
    }
    if (this.coverRequests.has(url)) return this.coverRequests.get(url);
    const pending = (async () => {
      try {
        const response = await this.request(url, { signal: AbortSignal.timeout(4000) });
        const chunks = []; let size = 0;
        for await (const chunk of response.body) {
          size += chunk.length;
          if (size > 2 * 1024 * 1024) throw new Error("Artwork too large");
          chunks.push(Buffer.from(chunk));
        }
        const value = Buffer.concat(chunks).toString("base64");
        this.coverCache.set(url, value);
        while (this.coverCache.size > 32) this.coverCache.delete(this.coverCache.keys().next().value);
        return value;
      } catch { return null; }
      finally { this.coverRequests.delete(url); }
    })();
    this.coverRequests.set(url, pending);
    return pending;
  }
  async fetchOEmbed(value) {
    const url = spotifyUrl(value);
    try {
      const response = await this.request(`https://open.spotify.com/oembed?url=${encodeURIComponent(url)}`);
      const data = await response.json();
      return { title: data.title, thumbnailUrl: data.thumbnail_url };
    } catch { return null; }
  }
  createPkceAuthUrl(clientId, redirectUri = "http://127.0.0.1:17375/callback") {
    if (typeof clientId !== "string" || !/^[a-fA-F0-9]{32}$/.test(clientId)) throw new Error("Invalid Spotify Client ID");
    const verifier = randomBytes(32).toString("base64url");
    const state = randomBytes(24).toString("base64url");
    this.pendingAuth = { clientId, verifier, state, redirectUri, expiresAt: this.now() + 10 * 60000 };
    const query = new URLSearchParams({ client_id: clientId, response_type: "code", redirect_uri: redirectUri,
      scope: "playlist-read-private playlist-read-collaborative user-library-read user-library-modify user-top-read",
      code_challenge_method: "S256", code_challenge: createHash("sha256").update(verifier).digest("base64url"), state });
    return `https://accounts.spotify.com/authorize?${query}`;
  }
  async handleAuthCallback(code, state) {
    const auth = this.pendingAuth;
    if (!auth || state !== auth.state || this.now() >= auth.expiresAt || typeof code !== "string" || !code || code.length > 4096) throw new Error("Invalid or expired Spotify authorization");
    this.pendingAuth = null;
    const response = await this.request("https://accounts.spotify.com/api/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ client_id: auth.clientId, grant_type: "authorization_code", code, redirect_uri: auth.redirectUri, code_verifier: auth.verifier }).toString() });
    const data = await response.json();
    if (!data.access_token || !data.refresh_token) throw new Error("Invalid Spotify token response");
    const record = { clientId: auth.clientId, accessToken: data.access_token, refreshToken: data.refresh_token, expiresAt: this.now() + (data.expires_in || 3600) * 1000 };
    await atomicJson(this.tokensFile, record);
    return record;
  }
  async getValidAccessToken() {
    if (this.refreshPromise) return this.refreshPromise;
    this.refreshPromise = this.readOrRefreshToken();
    try { return await this.refreshPromise; } finally { this.refreshPromise = null; }
  }
  async readOrRefreshToken() {
    let record;
    try { record = JSON.parse(await fs.readFile(this.tokensFile, "utf8")); }
    catch (error) { if (error.code === "ENOENT") return null; throw error; }
    await fs.chmod(this.cacheDir, 0o700); await fs.chmod(this.tokensFile, 0o600);
    if (!record.accessToken || !record.refreshToken) throw new Error("Invalid Spotify credentials; reconnect your account");
    if (this.now() < record.expiresAt - 60000) return record.accessToken;
    const response = await this.request("https://accounts.spotify.com/api/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ client_id: record.clientId, grant_type: "refresh_token", refresh_token: record.refreshToken }).toString() });
    const data = await response.json();
    if (!data.access_token) throw new Error("Invalid Spotify refresh response");
    record.accessToken = data.access_token;
    record.refreshToken = data.refresh_token || record.refreshToken;
    record.expiresAt = this.now() + (data.expires_in || 3600) * 1000;
    await atomicJson(this.tokensFile, record);
    return record.accessToken;
  }
  async apiRequest(url, options = {}) {
    const parsed = new URL(url, "https://api.spotify.com/v1/");
    if (parsed.origin !== "https://api.spotify.com" || !parsed.pathname.startsWith("/v1/")) throw new Error("Invalid Spotify API URL");
    const token = await this.getValidAccessToken();
    if (!token) throw new Error("Connect your Spotify account first");
    return this.request(parsed.href, { ...options, headers: { ...options.headers, Authorization: `Bearer ${token}` } });
  }
  async saveTrack(value) {
    const uri = spotifyUri(value);
    if (!uri.startsWith("spotify:track:")) throw new Error("No current Spotify track");
    // Current library endpoint; PUT is idempotent (Like, rather than toggle).
    await this.apiRequest(`https://api.spotify.com/v1/me/library?${new URLSearchParams({ uris: uri })}`, { method: "PUT" });
    return { ok: true };
  }
  async pages(endpoint) {
    let next = `https://api.spotify.com/v1/${endpoint}`;
    const items = [], seen = new Set();
    while (next) {
      if (seen.has(next) || seen.size >= 25) throw new Error("Spotify catalog exceeds sync limit; saved selection was kept");
      seen.add(next);
      const response = await this.apiRequest(next);
      const data = await response.json();
      if (!Array.isArray(data.items)) throw new Error("Invalid Spotify catalog response");
      items.push(...data.items.filter(Boolean)); next = data.next || null;
    }
    return items;
  }
  async fetchUserPlaylistsFromApi() {
    if (this.syncPromise) return this.syncPromise;
    this.syncPromise = (async () => {
      await this.migratePlaylists();
      const [playlists, tracks, albums] = await Promise.all([this.pages("me/playlists?limit=50"), this.pages("me/top/tracks?limit=50"), this.pages("me/albums?limit=50")]);
      const catalog = new Map();
      for (const item of [...playlists, ...tracks, ...albums.map(a => a.album).filter(Boolean)]) {
        const uri = spotifyUri(item.uri);
        catalog.set(uri, { uri, url: spotifyUrl(uri), title: item.name || "Spotify", thumbnailUrl: item.images?.[0]?.url || item.album?.images?.[0]?.url || null });
      }
      const processed = [...catalog.values()];
      // Every page must succeed before replacing the previous catalog.
      await atomicJson(this.playlistsFile, processed);
      return processed;
    })();
    try { return await this.syncPromise; } finally { this.syncPromise = null; }
  }
  async readList(file) {
    try {
      const list = JSON.parse(await fs.readFile(file, "utf8"));
      if (!Array.isArray(list)) throw new Error("Invalid playlist file");
      return list.map(item => ({ ...item, uri: spotifyUri(item.uri || item.url), url: spotifyUrl(item.uri || item.url) }));
    } catch (error) { if (error.code === "ENOENT") return []; throw error; }
  }
  async migratePlaylists() {
    if (this.migrationPromise) return this.migrationPromise;
    this.migrationPromise = (async () => {
      try { await fs.access(this.manualFile); return; }
      catch (error) { if (error.code !== "ENOENT") throw error; }
      // The old catalog did not distinguish manual selections from imports.
      // Preserve all validated legacy entries as editable selections and leave
      // the original file intact as a backup. New imports have a separate file.
      const legacy = await this.readList(this.legacyPlaylistsFile);
      await atomicJson(this.manualFile, legacy);
    })();
    try { await this.migrationPromise; }
    catch (error) { this.migrationPromise = null; throw error; }
  }
  async getManualPlaylists() {
    await this.migratePlaylists();
    return this.readList(this.manualFile);
  }
  async getSavedPlaylists() {
    await this.migratePlaylists();
    const [manual, imported] = await Promise.all([this.readList(this.manualFile), this.readList(this.playlistsFile)]);
    return [...new Map([...manual, ...imported].map(item => [item.uri, item])).values()];
  }
  async savePlaylists(entries) {
    if (!Array.isArray(entries) || entries.length > 200) throw new Error("Provide at most 200 Spotify links");
    // Validate the entire collection before network requests or persistence.
    const normalized = entries.map(entry => {
      const uri = spotifyUri(typeof entry === "string" ? entry : entry?.url || entry?.link);
      return { uri, url: spotifyUrl(uri), title: typeof entry?.title === "string" ? entry.title.slice(0, 200) : null };
    });
    await this.migratePlaylists();
    const items = await Promise.all(normalized.map(async item => {
      const embed = await this.fetchOEmbed(item.uri);
      return { ...item, title: item.title || embed?.title || "Spotify", thumbnailUrl: embed?.thumbnailUrl || null };
    }));
    await atomicJson(this.manualFile, items);
    return items;
  }
  async loadResolvedPlaylists() {
    return (await this.getSavedPlaylists()).map((item, i) => ({ ...item, id: `slot_${i + 1}`, coverBase64: null }));
  }
}
