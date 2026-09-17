import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { createHash, randomBytes } from "node:crypto";

function base64url(buf) {
  return buf.toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

export class SpotifyApiClient {
  constructor() {
    this.cacheDir = path.join(os.homedir(), ".local", "share", "ulanzi-spotify");
    this.playlistsFile = path.join(this.cacheDir, "playlists.json");
    this.configFile = path.join(this.cacheDir, "config.json");
    this.tokensFile = path.join(this.cacheDir, "tokens.json");
    this.coverCache = new Map();
    this.pendingAuth = null;
    this._initDirs();
  }

  async _initDirs() {
    try {
      await fs.mkdir(this.cacheDir, { recursive: true });
    } catch {}
  }

  urlToUri(urlStr) {
    if (!urlStr) return null;
    const clean = urlStr.split("?")[0].trim();
    if (clean.startsWith("spotify:")) return clean;
    const match = clean.match(/open\.spotify\.com\/(playlist|album|track|artist)\/([a-zA-Z0-9]+)/);
    if (match) {
      return `spotify:${match[1]}:${match[2]}`;
    }
    return null;
  }

  async getCoverBase64(url) {
    if (!url) return null;
    if (this.coverCache.has(url)) return this.coverCache.get(url);

    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(4000) });
      if (!res.ok) return null;
      const buffer = Buffer.from(await res.arrayBuffer());
      const base64 = buffer.toString("base64");
      this.coverCache.set(url, base64);
      return base64;
    } catch {
      return null;
    }
  }

  async fetchOEmbed(spotifyUrl) {
    try {
      const oembedUrl = `https://open.spotify.com/oembed?url=${encodeURIComponent(spotifyUrl)}`;
      const res = await fetch(oembedUrl, { signal: AbortSignal.timeout(3000) });
      if (!res.ok) return null;
      const data = await res.json();
      return {
        title: data.title || "Spotify",
        thumbnailUrl: data.thumbnail_url || null,
        type: data.type
      };
    } catch {
      return null;
    }
  }

  // --- OAuth PKCE Flow ---

  createPkceAuthUrl(clientId, redirectUri = "http://127.0.0.1:17375/callback") {
    const verifier = base64url(randomBytes(32));
    const challenge = base64url(createHash("sha256").update(verifier).digest());
    const state = base64url(randomBytes(16));

    this.pendingAuth = {
      clientId,
      verifier,
      state,
      redirectUri
    };

    const scopes = [
      "user-read-playback-state",
      "user-modify-playback-state",
      "user-read-currently-playing",
      "playlist-read-private",
      "playlist-read-collaborative",
      "user-library-read",
      "user-library-modify",
      "user-top-read",
      "user-read-recently-played"
    ].join(" ");

    const params = new URLSearchParams({
      client_id: clientId,
      response_type: "code",
      redirect_uri: redirectUri,
      scope: scopes,
      code_challenge_method: "S256",
      code_challenge: challenge,
      state
    });

    return `https://accounts.spotify.com/authorize?${params.toString()}`;
  }

  async handleAuthCallback(code, state) {
    if (!this.pendingAuth) {
      throw new Error("Nenhuma sessão de autorização pendente.");
    }
    if (state !== this.pendingAuth.state) {
      throw new Error("Validação de estado OAuth inválida.");
    }

    const { clientId, verifier, redirectUri } = this.pendingAuth;
    const bodyParams = new URLSearchParams({
      client_id: clientId,
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
      code_verifier: verifier
    });

    const res = await fetch("https://accounts.spotify.com/api/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: bodyParams.toString()
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Falha ao obter token do Spotify: ${errText}`);
    }

    const tokenData = await res.json();
    const tokenRecord = {
      clientId,
      accessToken: tokenData.access_token,
      refreshToken: tokenData.refresh_token,
      expiresAt: Date.now() + ((tokenData.expires_in || 3600) * 1000)
    };

    await fs.writeFile(this.tokensFile, JSON.stringify(tokenRecord, null, 2), "utf-8");
    this.pendingAuth = null;
    return tokenRecord;
  }

  async getValidAccessToken() {
    try {
      const raw = await fs.readFile(this.tokensFile, "utf-8");
      const record = JSON.parse(raw);
      if (!record.accessToken || !record.refreshToken) return null;

      if (Date.now() < record.expiresAt - 60000) {
        return record.accessToken;
      }

      // Refresh token
      const bodyParams = new URLSearchParams({
        client_id: record.clientId,
        grant_type: "refresh_token",
        refresh_token: record.refreshToken
      });

      const res = await fetch("https://accounts.spotify.com/api/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: bodyParams.toString()
      });

      if (!res.ok) return null;
      const data = await res.json();
      record.accessToken = data.access_token;
      if (data.refresh_token) record.refreshToken = data.refresh_token;
      record.expiresAt = Date.now() + ((data.expires_in || 3600) * 1000);
      await fs.writeFile(this.tokensFile, JSON.stringify(record, null, 2), "utf-8");
      return record.accessToken;
    } catch {
      return null;
    }
  }

  async fetchUserPlaylistsFromApi() {
    const token = await this.getValidAccessToken();
    if (!token) return null;

    try {
      const [playlistsRes, topRes, albumsRes] = await Promise.all([
        fetch("https://api.spotify.com/v1/me/playlists?limit=20", { headers: { Authorization: `Bearer ${token}` } }).then(r => r.json()).catch(() => ({})),
        fetch("https://api.spotify.com/v1/me/top/tracks?limit=20", { headers: { Authorization: `Bearer ${token}` } }).then(r => r.json()).catch(() => ({})),
        fetch("https://api.spotify.com/v1/me/albums?limit=20", { headers: { Authorization: `Bearer ${token}` } }).then(r => r.json()).catch(() => ({}))
      ]);

      const items = [];

      // 1. Playlists
      for (const p of playlistsRes.items || []) {
        if (!p) continue;
        items.push({
          id: p.id,
          title: p.name,
          uri: p.uri,
          url: p.external_urls?.spotify || `https://open.spotify.com/playlist/${p.id}`,
          thumbnailUrl: p.images?.[0]?.url || null
        });
      }

      // 2. Top Tracks / Albums
      for (const t of topRes.items || []) {
        if (!t) continue;
        const exists = items.some(i => i.title === t.name || i.uri === t.uri);
        if (!exists) {
          items.push({
            id: t.id,
            title: t.name,
            artist: t.artists?.[0]?.name,
            uri: t.uri,
            url: t.external_urls?.spotify || `https://open.spotify.com/track/${t.id}`,
            thumbnailUrl: t.album?.images?.[0]?.url || null
          });
        }
      }

      // 3. Saved Albums
      for (const a of albumsRes.items || []) {
        const album = a.album;
        if (!album) continue;
        const exists = items.some(i => i.title === album.name || i.uri === album.uri);
        if (!exists) {
          items.push({
            id: album.id,
            title: album.name,
            artist: album.artists?.[0]?.name,
            uri: album.uri,
            url: album.external_urls?.spotify || `https://open.spotify.com/album/${album.id}`,
            thumbnailUrl: album.images?.[0]?.url || null
          });
        }
      }

      // Cache and save
      const processed = [];
      for (const item of items) {
        let coverBase64 = null;
        if (item.thumbnailUrl) {
          coverBase64 = await this.getCoverBase64(item.thumbnailUrl);
        }
        processed.push({
          ...item,
          coverBase64
        });
      }

      await fs.writeFile(this.playlistsFile, JSON.stringify(processed, null, 2), "utf-8");
      return processed;
    } catch {
      return null;
    }
  }

  async getSavedPlaylists() {
    try {
      const raw = await fs.readFile(this.playlistsFile, "utf-8");
      const list = JSON.parse(raw);
      if (Array.isArray(list) && list.length > 0) return list;
    } catch {}

    return [
      { title: "Daily Mix 1", url: "https://open.spotify.com/playlist/37i9dQZF1E37yE2Mh0i123" },
      { title: "Discover Weekly", url: "https://open.spotify.com/playlist/37i9dQZEVXcQ9JaJVt2wt" },
      { title: "Release Radar", url: "https://open.spotify.com/playlist/37i9dQZEVXbo6nvG9zXw7b" },
      { title: "On Repeat", url: "https://open.spotify.com/playlist/37i9dQZF1Epz1Xy0Mh0abc" },
      { title: "Chill Mix", url: "https://open.spotify.com/playlist/37i9dQZF1EIe0g4p7s9xyz" }
    ];
  }

  async savePlaylists(linksOrItems) {
    await this._initDirs();
    const items = [];
    for (const entry of linksOrItems) {
      if (!entry) continue;
      const url = typeof entry === "string" ? entry.trim() : (entry.url || entry.link || "").trim();
      const customTitle = typeof entry === "object" ? entry.title : null;
      if (!url) continue;

      const uri = this.urlToUri(url);
      const embed = await this.fetchOEmbed(url);
      let coverBase64 = null;
      if (embed?.thumbnailUrl) {
        coverBase64 = await this.getCoverBase64(embed.thumbnailUrl);
      }
      items.push({
        title: customTitle || embed?.title || "Playlist",
        url,
        uri: uri || url,
        thumbnailUrl: embed?.thumbnailUrl || null,
        coverBase64
      });
    }

    await fs.writeFile(this.playlistsFile, JSON.stringify(items, null, 2), "utf-8");
    return items;
  }

  async loadResolvedPlaylists() {
    const saved = await this.getSavedPlaylists();
    const resolved = [];

    for (let i = 0; i < saved.length; i++) {
      const item = saved[i];
      let coverBase64 = item.coverBase64 || null;
      let title = item.title;
      const uri = item.uri || this.urlToUri(item.url) || item.url;

      if (!coverBase64 && item.url) {
        const embed = await this.fetchOEmbed(item.url);
        if (embed?.thumbnailUrl) {
          coverBase64 = await this.getCoverBase64(embed.thumbnailUrl);
        }
        if (!title && embed?.title) {
          title = embed.title;
        }
      }

      resolved.push({
        id: `slot_${i + 1}`,
        title: title || `Playlist ${i + 1}`,
        url: item.url,
        uri,
        coverBase64,
        thumbnailUrl: item.thumbnailUrl
      });
    }

    return resolved;
  }
}
