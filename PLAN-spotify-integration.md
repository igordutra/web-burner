# Spotify Search + Download Integration Plan

## Goal
Add a search bar to the silky-bohr-burner web UI that lets your daughter search Spotify, pick a track, and download it directly as MP3 into the burn queue — no file uploads needed.

## Architecture

### Search: Spotify Web API (from Node.js)
- `GET /api/search?q=query` → calls Spotify Web API → returns `[{ title, artist, album, duration, albumArt, spotifyUrl }]`
- Uses Node.js built-in `fetch()` — no extra npm packages
- Requires a free Spotify Developer App (Client ID + Secret)

### Download: spotdl CLI (from Node.js)
- `POST /api/download` with `{ spotifyUrl }` → spawns `spotdl download <url>` → saves MP3 to `uploads/` → extracts metadata via ffprobe → adds to tracks array
- `spotdl` v4.5.0 installed via `pip3 install spotdl --break-system-packages`
- Bundles yt-dlp internally, no extra deps needed

## Files to Change

| File | What | Size |
|---|---|---|
| `server.js` | Spotify auth, search endpoint, download endpoint | ~80 lines |
| `public/index.html` | Search bar + results panel markup | ~40 lines |
| `public/app.js` | Search logic, results rendering, download flow | ~120 lines |
| `public/styles.css` | Search/results styling | ~50 lines |
| `deploy.sh` | Add `pip3 install spotdl --break-system-packages` | ~3 lines |
| `package.json` | No new deps (uses built-in `fetch`) | — |

## User Flow
1. Search bar on the Master view (below the upload zone)
2. Type a query → press Enter or click Search
3. Results appear: thumbnail, title, artist, album, duration
4. Click **"Add to Queue"** on a result
5. Server downloads via spotdl → file lands in `uploads/` → metadata extracted → track appears in the queue
6. Burn button becomes available as normal

## Setup Required (5 minutes)
1. Go to https://developer.spotify.com/dashboard → **Create App**
2. Copy **Client ID** and **Client Secret**
3. Start the server with:
   ```bash
   SPOTIFY_CLIENT_ID=your_id SPOTIFY_CLIENT_SECRET=your_secret npm start
   ```

## Trade-offs vs YouTube-only (yt-dlp)
- **Pros**: Accurate Spotify metadata (correct song titles, artists, albums, album art)
- **Cons**: Requires free API credentials (5-min setup), Python + spotdl dependency
