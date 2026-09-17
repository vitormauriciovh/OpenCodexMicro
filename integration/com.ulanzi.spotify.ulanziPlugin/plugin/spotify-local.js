import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export class SpotifyLocalController {
  constructor() {
    this._cachedState = null;
    this._lastPolled = 0;
  }

  async runJxa(script) {
    try {
      const { stdout } = await execFileAsync("osascript", ["-l", "JavaScript", "-e", script], {
        timeout: 1500
      });
      return JSON.parse(stdout.trim());
    } catch {
      return null;
    }
  }

  async getState() {
    const script = `
      (() => {
        try {
          const se = Application("System Events");
          const isRunning = se.processes.byName("Spotify").exists();
          if (!isRunning) return JSON.stringify({ isRunning: false, playerState: "stopped" });
          const sp = Application("Spotify");
          const track = sp.currentTrack;
          let trackData = null;
          try {
            trackData = {
              name: track.name() || "",
              artist: track.artist() || "",
              album: track.album() || "",
              artworkUrl: track.artworkUrl() || "",
              duration: track.duration() || 0,
              id: track.id() || "",
              spotifyUrl: track.spotifyUrl() || ""
            };
          } catch {}
          return JSON.stringify({
            isRunning: true,
            playerState: String(sp.playerState() || "stopped").toLowerCase(),
            track: trackData,
            playerPosition: sp.playerPosition() || 0,
            soundVolume: sp.soundVolume() || 0,
            repeating: sp.repeating() || false,
            shuffling: sp.shuffling() || false
          });
        } catch (e) {
          return JSON.stringify({ isRunning: false, error: e.message });
        }
      })()
    `;
    const res = await this.runJxa(script);
    if (res) {
      this._cachedState = res;
      this._lastPolled = Date.now();
      return res;
    }
    return this._cachedState || { isRunning: false, playerState: "stopped" };
  }

  async playPause() {
    return this.runJxa(`
      (() => {
        try {
          const sp = Application("Spotify");
          sp.playpause();
          return JSON.stringify({ ok: true });
        } catch (e) { return JSON.stringify({ ok: false, error: e.message }); }
      })()
    `);
  }

  async next() {
    return this.runJxa(`
      (() => {
        try {
          const sp = Application("Spotify");
          sp.nextTrack();
          return JSON.stringify({ ok: true });
        } catch (e) { return JSON.stringify({ ok: false, error: e.message }); }
      })()
    `);
  }

  async previous() {
    return this.runJxa(`
      (() => {
        try {
          const sp = Application("Spotify");
          sp.previousTrack();
          return JSON.stringify({ ok: true });
        } catch (e) { return JSON.stringify({ ok: false, error: e.message }); }
      })()
    `);
  }

  async setVolume(volume) {
    const vol = Math.max(0, Math.min(100, Math.round(volume)));
    return this.runJxa(`
      (() => {
        try {
          const sp = Application("Spotify");
          sp.setSoundVolume(${vol});
          return JSON.stringify({ ok: true, volume: ${vol} });
        } catch (e) { return JSON.stringify({ ok: false, error: e.message }); }
      })()
    `);
  }

  async changeVolume(delta) {
    return this.runJxa(`
      (() => {
        try {
          const sp = Application("Spotify");
          const cur = sp.soundVolume() || 0;
          const next = Math.max(0, Math.min(100, cur + (${delta})));
          sp.setSoundVolume(next);
          return JSON.stringify({ ok: true, volume: next });
        } catch (e) { return JSON.stringify({ ok: false, error: e.message }); }
      })()
    `);
  }

  async playUri(uri) {
    if (!uri) return null;
    const cleanUri = uri.trim();
    const isTrack = cleanUri.startsWith("spotify:track:");
    const script = isTrack
      ? `tell application "Spotify" to play track "${cleanUri}"`
      : `tell application "Spotify" to play track "" in context "${cleanUri}"`;

    try {
      await execFileAsync("osascript", ["-e", script], { timeout: 2000 });
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  }

  async toggleShuffle() {
    return this.runJxa(`
      (() => {
        try {
          const sp = Application("Spotify");
          sp.shuffling = !sp.shuffling();
          return JSON.stringify({ ok: true, shuffling: sp.shuffling() });
        } catch (e) { return JSON.stringify({ ok: false, error: e.message }); }
      })()
    `);
  }

  async toggleRepeat() {
    return this.runJxa(`
      (() => {
        try {
          const sp = Application("Spotify");
          sp.repeating = !sp.repeating();
          return JSON.stringify({ ok: true, repeating: sp.repeating() });
        } catch (e) { return JSON.stringify({ ok: false, error: e.message }); }
      })()
    `);
  }
}

