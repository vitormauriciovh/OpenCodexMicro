import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { SpotifyApiClient } from "../integration/com.ulanzi.spotify.ulanziPlugin/plugin/spotify-api.js";
import { SpotifyLocalController } from "../integration/com.ulanzi.spotify.ulanziPlugin/plugin/spotify-local.js";
import { spotifyUri } from "../src/shared/spotify-uri.mjs";
const id = "4iV5W9uYEdYUVa79Axb7Rh", uri = `spotify:track:${id}`;
async function fixture(t, fetchImpl = async () => { throw new Error("No network fixture"); }) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "spotify-test-"));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  return new SpotifyApiClient({ cacheDir: dir, fetchImpl });
}
test("playback uses fixed script and positional args; invalid input never executes", async () => {
  const commands = [];
  const player = new SpotifyLocalController({ execute: async (...args) => { commands.push(args); return {}; } });
  await player.playUri(uri);
  await player.playUri(`https://open.spotify.com/playlist/${id}?si=legit`);
  assert.equal(commands[0][1][2], uri); assert.ok(!commands[0][1][1].includes(id));
  for (const bad of [`${uri}"\ndo shell script "echo test"`, `https://attacker.invalid/open.spotify.com/track/${id}`, `spotify:track:${id}%22`, {}, null, `spotify:track:${id}\n`]) await assert.rejects(player.playUri(bad));
  assert.equal(commands.length, 2);
  assert.equal(spotifyUri(`https://open.spotify.com/intl-pt/album/${id}`), `spotify:album:${id}`);
});
test("failed catalog sync preserves previous file", async t => {
  const api = await fixture(t, async () => ({ ok: false, status: 429, headers: new Headers({ "retry-after": "4" }) }));
  api.getValidAccessToken = async () => "fixture";
  const original = JSON.stringify([{ uri, title: "Keep me" }]);
  await fs.writeFile(api.playlistsFile, original);
  await assert.rejects(api.fetchUserPlaylistsFromApi(), /429/);
  assert.equal(await fs.readFile(api.playlistsFile, "utf8"), original);
});
test("manual empty list remains empty and unsafe cached URIs fail explicitly", async t => {
  const api = await fixture(t);
  await api.savePlaylists([]);
  assert.deepEqual(await api.getSavedPlaylists(), []);
  await fs.writeFile(api.playlistsFile, JSON.stringify([{ uri: `${uri}"` }]));
  await assert.rejects(api.loadResolvedPlaylists(), /Invalid|Spotify/);
});
test("manual links are validated as a whole before saving", async t => {
  const api = await fixture(t);
  await fs.writeFile(api.manualFile, "[]");
  await assert.rejects(api.savePlaylists([uri, 'https://evil.invalid']), /Invalid/);
  assert.equal(await fs.readFile(api.manualFile, "utf8"), "[]");
});
test("sync follows pages and preserves manually curated items", async t => {
  const api = await fixture(t, async url => ({ ok: true, json: async () => url.includes('offset=50') ? { items: [{ uri: `spotify:album:${id}`, name: "Second" }], next: null } : url.includes('me/playlists') ? { items: [{ uri: `spotify:playlist:${id}`, name: "First" }], next: 'https://api.spotify.com/v1/me/playlists?offset=50' } : { items: [], next: null } }));
  api.getValidAccessToken = async () => "fixture";
  await fs.writeFile(api.manualFile, JSON.stringify([{ uri, title: "Manual" }]));
  const result = await api.fetchUserPlaylistsFromApi();
  assert.equal(result.length, 2); assert.equal((await api.getSavedPlaylists()).length, 3);
  assert.equal((await fs.stat(api.playlistsFile)).mode & 0o777, 0o600);
});
test("Like saves exact track via current library endpoint and propagates failure", async t => {
  const calls = [];
  const api = await fixture(t, async (url, options) => { calls.push([url, options]); return { ok: true }; });
  api.getValidAccessToken = async () => "fixture";
  await api.saveTrack(uri);
  assert.equal(new URL(calls[0][0]).pathname, "/v1/me/library");
  assert.equal(new URL(calls[0][0]).searchParams.get("uris"), uri);
  assert.equal(calls[0][1].method, "PUT");
});
test("OAuth rejects expired or mismatched state and stores private credentials", async t => {
  const api = await fixture(t, async () => ({ ok: true, json: async () => ({ access_token: "access", refresh_token: "refresh", expires_in: 3600 }) }));
  api.createPkceAuthUrl("a".repeat(32));
  await assert.rejects(api.handleAuthCallback("code", "wrong"), /Invalid/);
  const state = api.pendingAuth.state;
  await api.handleAuthCallback("code", state);
  assert.equal((await fs.stat(api.tokensFile)).mode & 0o777, 0o600);
  await assert.rejects(api.handleAuthCallback("code", state), /Invalid/);
  api.createPkceAuthUrl("a".repeat(32)); api.pendingAuth.expiresAt = 0;
  await assert.rejects(api.handleAuthCallback("code", api.pendingAuth.state), /expired/);
});
test("legacy manual selections migrate once, remain editable and survive API sync", async t => {
  const api = await fixture(t, async () => ({ ok: true, json: async () => ({ items: [], next: null }) }));
  api.getValidAccessToken = async () => 'fixture';
  await fs.writeFile(api.legacyPlaylistsFile, JSON.stringify([{ uri, title: 'Legacy manual' }]));
  const manual = await api.getManualPlaylists();
  assert.equal(manual[0].uri, uri);
  await api.fetchUserPlaylistsFromApi();
  assert.equal((await api.getSavedPlaylists())[0].uri, uri);
  await api.savePlaylists([]);
  assert.deepEqual(await api.getSavedPlaylists(), []);
  const restarted = new SpotifyApiClient({ cacheDir: api.cacheDir });
  assert.deepEqual(await restarted.getManualPlaylists(), []);
  assert.equal(JSON.parse(await fs.readFile(api.legacyPlaylistsFile))[0].title, 'Legacy manual');
});
