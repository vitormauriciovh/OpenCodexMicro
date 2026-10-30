import { spotifyUri } from "../../../src/shared/spotify-uri.mjs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export class SpotifyLocalController {
  constructor({ execute = execFileAsync } = {}) {
    this.execute = execute;
    this._cachedState = null;
    this._lastPolled = 0;
  }

  async runJxa(script) {
    try {
      const { stdout } = await this.execute("osascript", ["-l", "JavaScript", "-e", script], {
        timeout: 1500
      });
      const result = JSON.parse(stdout.trim());
      if (result?.ok === false || result?.error) throw new Error(result.error || "Spotify action failed");
      return result;
    } catch (error) {
      throw new Error(`Spotify automation failed: ${error.message}`);
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
    if (!Number.isFinite(volume)) throw new Error("Invalid volume");
    const vol = Math.max(0, Math.min(100, Math.round(volume)));
    return this.runJxa(`
      (() => {
        try {
          const sp = Application("Spotify");
          sp.soundVolume = ${vol};
          return JSON.stringify({ ok: true, volume: ${vol} });
        } catch (e) { return JSON.stringify({ ok: false, error: e.message }); }
      })()
    `);
  }

  async changeVolume(delta) {
    if (!Number.isFinite(delta) || Math.abs(delta) > 100) throw new Error("Invalid volume change");
    return this.runJxa(`
      (() => {
        try {
          const sp = Application("Spotify");
          const cur = sp.soundVolume() || 0;
          const next = Math.max(0, Math.min(100, cur + (${delta})));
          sp.soundVolume = next;
          return JSON.stringify({ ok: true, volume: next });
        } catch (e) { return JSON.stringify({ ok: false, error: e.message }); }
      })()
    `);
  }

  async playUri(uri) {
    const cleanUri = spotifyUri(uri);
    const script = `on run argv
      set targetUri to item 1 of argv
      tell application "Spotify"
        if targetUri starts with "spotify:track:" then
          play track targetUri
        else
          play track "" in context targetUri
        end if
      end tell
    end run`;
    await this.execute("/usr/bin/osascript", ["-e", script, cleanUri], { timeout: 3000 });
    return { ok: true };
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

