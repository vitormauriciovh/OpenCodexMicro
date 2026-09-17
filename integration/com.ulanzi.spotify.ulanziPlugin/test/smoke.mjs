import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const packageRootUrl = new URL("..", import.meta.url);
const manifest = JSON.parse(await readFile(new URL("manifest.json", packageRootUrl)));

assert.equal(manifest.UUID, "com.ulanzi.ulanzistudio.spotify");
assert.equal(manifest.Version, "0.4.1");
assert.equal(manifest.Type, "JavaScript");
assert.equal(manifest.CodePath, "dist/app.js");

const nowPlayingAction = manifest.Actions.find(a => a.UUID === "com.ulanzi.ulanzistudio.spotify.nowplaying");
assert.ok(nowPlayingAction, "Now Playing action must exist");

const volumeAction = manifest.Actions.find(a => a.UUID === "com.ulanzi.ulanzistudio.spotify.volume");
assert.ok(volumeAction, "Volume dial action must exist");
assert.deepEqual(volumeAction.Controllers, ["Encoder"]);

console.log("Spotify Ulanzi plugin manifest smoke test passed.");

