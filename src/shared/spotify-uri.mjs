export function spotifyUri(value) {
  if (typeof value !== "string" || /[\r\n\0]/.test(value)) throw new Error("Invalid Spotify URI");
  const text = value.trim();
  const uri = /^spotify:(track|playlist|album|artist):([A-Za-z0-9]{22})$/.exec(text);
  if (uri) return uri[0];
  let url;
  try { url = new URL(text); } catch { throw new Error("Use a Spotify track, playlist, album, or artist link"); }
  if (url.protocol !== "https:" || url.hostname !== "open.spotify.com" || url.port || url.username || url.password || url.hash) throw new Error("Invalid Spotify link");
  const match = /^\/(?:intl-[a-z]{2}\/)?(track|playlist|album|artist)\/([A-Za-z0-9]{22})\/?$/.exec(url.pathname);
  if (!match) throw new Error("Invalid Spotify link");
  return `spotify:${match[1]}:${match[2]}`;
}
export function spotifyUrl(value) { return "https://open.spotify.com/" + spotifyUri(value).slice(8).replace(":", "/"); }
