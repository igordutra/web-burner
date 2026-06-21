# silky-bohr-burner 💿

A premium, custom self-hosted web interface built specifically for headless home Linux servers. It lets you upload, organise, search and download from Spotify, manage playlists, burn music CDs, and rip and archive physical Audio CDs directly from any device on your local network (laptops, phones, tablets) through a beautiful, luxury glassmorphic dashboard.

---

## 🚀 Automated Deployment (Recommended)

To set up everything on your home Linux server in under a minute, we have provided an automated deployment script. It automatically detects your environment, installs package dependencies (`ffmpeg`, `cdrskin`, `xorriso`, `cdparanoia`, `nodejs`, `npm`), installs the Spotify downloader (`spotdl`), configures CD burner/reader write permissions for your current user, installs local Node packages, and optionally registers the application as a **persistent Systemd background daemon** (which auto-starts on system boot and restarts if it encounters a crash!).

### Run the Installer

1. Transfer this project folder to your home server.
2. SSH into your server, navigate to the folder, and execute the installer:
   ```bash
   chmod +x deploy.sh
   ./deploy.sh
   ```
3. Follow the simple interactive prompts. If you choose to set up the Systemd service, the web server will instantly start and run in the background!

---

## Key Features

- **Gorgeous Luxury Dashboard**: Dark mode, retro-neon glowing accents, floating interactive panels, and modern glassmorphic styling (`backdrop-filter`) across a three-view SPA layout:
  - **Tab 1: Master & Burn CD**
  - **Tab 2: Archive & Rip CD**
  - **Tab 3: Playlists**
- **Spotify Search & Download**: Search Spotify directly from the web UI, browse results with album art, and download tracks as high-quality MP3s with one click.
- **Playlist Management**: Create named playlists, add/remove tracks from the burn queue, rename and delete playlists. Persisted to disk across server restarts.
- **Burn Playlist to CD**: Load any playlist's tracks directly into the burn queue and switch to the Mastering tab with one click.
- **Drag & Drop Upload**: Upload multiple audio files concurrently with a smooth, live-updating file progress bar.
- **Interactive iTunes Playlist Queue**: Rearrange tracks dynamically using intuitive HTML5 drag-and-drop handles.
- **Accurate Capacity Management**: Active length tracking with standard 74-minute and 80-minute tick markers. Warns in glowing red and disables burning if the total length exceeds the standard 80-minute Audio CD maximum.
- **Robust Audio Burning**: Converts all uploaded files (MP3, FLAC, M4A, WAV, etc.) to raw Red Book CD-DA WAV format (16-bit, 44.1 kHz, stereo) on-the-fly using `ffmpeg` and writes them using `cdrskin`.
- **High-Fidelity CD Ripping**: Extract physical CD audio tracks using the industry-standard `cdparanoia` engine with jitter-correction.
- **Flexible Compression Encodes**: Compresses ripped tracks on-the-fly to high-fidelity MP3 (320kbps), lossless FLAC, or uncompressed WAV formats with custom metadata tags.
- **Interactive Connection Badges & Animators**: Glowing compact disc lens widget lights up cyan and spins when a CD is detected, and pauses when the drive is empty. Turntable mechanical needle arms swing out to represent active conversion and rip phases.
- **Custom Tag Editor**: Change track titles directly in the ripping tracks grid before starting, automatically embedding tags into final encoded files.
- **Seamless Mastering Sync**: Ripped files instantly flow into the Mastering queue of Tab 1, enabling mixed mastering compiles.
- **Live Terminal Logging Dialogue**: Spawns physical optical burning (`cdrskin`) or ripping (`cdparanoia`) engines and streams active terminal logs to separate retro CRT-styled console log modals in the browser via Server-Sent Events (SSE).
- **Intelligent Dev Mock Mode**: Features an automatic simulator fallback when physical devices or CLI tools are missing (e.g., developing/reviewing on macOS), providing realistic simulated logs, sector progress updates, CD scans, and spinning animations.

---

## System Requirements

To burn and rip physical discs, the host Linux server needs the following system dependencies installed:

1. **Node.js** (v18 or higher recommended)
2. **FFmpeg** (provides `ffmpeg` for transcoding and `ffprobe` for audio metadata reading)
3. **cdrskin** (modern CD writing utility, active fork maintained as part of libburn)
4. **Cdparanoia** (audio CD extraction utility)

For Spotify search & download, you also need:

5. **spotdl** (pip package) — installed automatically by `deploy.sh`:
   ```bash
   pip3 install spotdl --break-system-packages
   ```
6. **Spotify API credentials** (free) — set as environment variables:
   ```bash
   export SPOTIFY_CLIENT_ID="your_client_id"
   export SPOTIFY_CLIENT_SECRET="your_client_secret"
   ```
   Get these at https://developer.spotify.com/dashboard (Create App, no redirect URI needed).

### Quick Server Installation (Ubuntu/Debian)

```bash
# Update repositories and install burning/ripping backend utilities
sudo apt update
sudo apt install -y nodejs npm ffmpeg cdrskin xorriso cdparanoia

# Install Spotify downloader
pip3 install spotdl --break-system-packages
```

---

## Burner & Reader Write Permissions (Important!)

On Linux systems, access to CD/DVD burner/reader drives (`/dev/cdrom` or `/dev/sr0`) is restricted to the root user and members of the `cdrom` group. To allow the Node.js web server process to execute burning and ripping commands without requiring `sudo` (root), add your user account to the `cdrom` system group:

```bash
# Add current user to the cdrom group
sudo usermod -aG cdrom $USER

# Log out and log back in, or run the following to apply immediately:
newgrp cdrom
```

---

## How to Run

1. Clone or copy the project files to your server.
2. Inside the project folder (`silly-bohr`), install the lightweight Node dependencies:
   ```bash
   npm install
   ```
3. Set Spotify credentials (optional, for search/download):
   ```bash
   export SPOTIFY_CLIENT_ID="your_client_id"
   export SPOTIFY_CLIENT_SECRET="your_client_secret"
   ```
4. Boot the application server:
   ```bash
   npm start
   ```
5. The server will launch on port **3123** (e.g., `http://localhost:3123` or `http://your-server-ip:3123`). Access it from any web browser on your home network!

---

## Configuration & Mocking

The application will **automatically** determine its capabilities on startup:
* If running on your home server and the necessary tools (`ffmpeg`, `cdrskin`, and `cdparanoia`) are found, it will perform **real, physical CD burning and CD ripping**.
* If running on a system without those tools (like your personal laptop or a development Mac), it will automatically activate **Mock Mode** so you can safely test the entire upload, drag reordering, CD detection scanning, tracks editing, and console progress interface without throwing errors.

If you want to force Mock Mode on your server to run dry-run tests, run the server with the `MOCK_BURN` environment variable set:

```bash
MOCK_BURN=true npm start
```

---

## Track Persistence

Track metadata is persisted to `tracks.json` in the project root, surviving server restarts. On startup, the server:
1. Loads any previously saved tracks from `tracks.json`
2. Scans the `uploads/` directory for orphaned audio files not yet tracked
3. Extracts their metadata (title, artist, album, duration) using `ffprobe`
4. Saves the updated track list back to `tracks.json`

Playlists (`playlists.json`) reference tracks by ID and are reconciled on load — tracks whose source files no longer exist on disk are removed from playlists automatically.

---

## Burning Troubleshooting

### Simulation Mode
Simulation Mode (Dummy Burn) is **off by default**. When enabled, it passes the `-dummy` flag to `cdrskin`, which spins the disc and simulates writing but never activates the laser. Use it to verify your track list before a real burn.

### Media Write Errors
If you see errors like:
```
Sense Key: 0x3 Medium Error
Sense Code: 0x0C Qual 0x00 (write error)
```
This is a **hardware write error** — the CD-R disc is incompatible with the drive, dirty, or damaged. Try:
- A different brand of CD-R (Verbatim, Sony are well-supported)
- Cleaning the drive laser with a lens cleaning disc
- A slower write speed (8x is the most compatible)

The disc remains blank and reusable after a write error (no data was committed).

### WAV Alignment (‑pad)
All audio tracks are padded with silence to a multiple of 2352 bytes (one CD-DA sector) using `cdrskin`'s `-pad` flag, ensuring compatibility with the CD specification.

### DMA Speed Test
The `CDR_NODMATEST` environment variable is set automatically to skip `cdrskin`'s slow DMA speed test on startup.

---

## Spotify Integration

The Spotify search & download feature uses two components:

1. **Search**: Calls the Spotify Web API directly from Node.js (Client Credentials flow). No user OAuth needed.
2. **Download**: Spawns `spotdl` as a subprocess, which finds the song on YouTube and downloads it as MP3. Progress is streamed to the browser via Server-Sent Events (SSE), parsing yt-dlp's download percentage.

Playlists are stored in `playlists.json` in the project root.
