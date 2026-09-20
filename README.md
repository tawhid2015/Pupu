# 🎵 Pupu — Discord Music Bot + Admin Dashboard

A production-grade Discord music bot powered by **Lavalink v4**, with **dual command support**
(both `.` prefix commands **and** `/` slash commands), a **per-user playlist system** backed by
Supabase Postgres, **collaborative server playlists**, **Spotify/YouTube playlist import**, and a
**private, real-time Admin Web Dashboard**.

---

## ✨ Features

### Music Bot (`pupu` / prefix `.`)
- Play from **YouTube, SoundCloud, Bandcamp, Vimeo, Twitch, HTTP streams**
- Works in **multiple servers simultaneously** — every server has its own independent
  player, queue, and voice connection
- Full playback control: play, pause, resume, skip, stop, seek, volume, now-playing
- Queue tools: queue, shuffle, remove, clear, loop (off/track/queue)
- **Auto-disconnect** after 3 minutes idle
- Automatic **SoundCloud fallback** if a YouTube track can't stream
- Rich embeds with artwork + progress bar

### Playlist System (Supabase Postgres)
- **Personal playlists** per user: `.pl create/save/add/load/view/remove/delete/import/list`
- **Server-shared playlists** (collaborative): `.spl …` — everyone can build, creator deletes
- **Shuffle-load**: `.pl load <name> shuffle`
- **Import from URLs**: YouTube playlists natively; **Spotify** playlist/album/track links
  (no API key needed — matches songs on YouTube)

### Admin Web Dashboard (`/admin`)
- Private, JWT-protected (default `pupu` / `pupu2026` — **change it**)
- Live stats: servers, members, servers in voice, now-playing count, latency
- Full server list with voice channel, listeners, current track + progress
- Per-server remote control: Pause/Resume, Skip, Stop, Leave, Volume
- Near-real-time (4s refresh), search + "in voice only" filter
- Public status page at `/` (no login)

---

## 🏗️ Architecture

```
Discord Gateway
      │
┌─────▼───────────────────────────────────────────────────────────┐
│  pupu_bot.py  (discord.py 2.7 + Wavelink 3.5)                   │
│  • 18 hybrid commands (prefix . and / slash)                    │
│  • One wavelink.Player per guild → independent music sessions   │
│  • push_status()  → writes live server/voice state to MongoDB   │
│  • poll_commands()→ executes admin actions queued by the web API│
└─────┬──────────────────────┬───────────────────────┬────────────┘
      │ audio                │ MongoDB               │ asyncpg
      ▼                      ▼                       ▼
┌──────────────┐      ┌─────────────┐         ┌──────────────────┐
│ Lavalink v4  │      │  MongoDB    │         │ Supabase Postgres│
│ (self-hosted)│      │ bot_status  │         │ playlists tables │
│ youtube-1.18 │      │ bot_commands│         └──────────────────┘
└──────────────┘      └──────▲──────┘
                             │
                      ┌──────┴──────┐        ┌────────────────┐
                      │ FastAPI API │  ◄───  │ React frontend │
                      │ server.py   │  /api  │ status + admin │
                      └─────────────┘        └────────────────┘
```

### How playback works
1. `.play never gonna give you up` → wavelink searches via the Lavalink REST API
2. Track is queued on the guild's own `wavelink.Player`
3. Lavalink resolves the audio stream (YouTube/SoundCloud/…) and streams it into the
   server's voice channel over Discord's voice gateway
4. Every guild gets a **separate** player — simultaneous playback in many servers is native

### Project layout
```
/app
├── backend/
│   ├── pupu_bot.py       # Discord bot (commands, voice, status, admin command poller)
│   ├── playlist_db.py    # Supabase Postgres playlist storage layer
│   ├── server.py         # FastAPI: public status + admin auth/dashboard APIs
│   ├── requirements.txt  # discord.py, wavelink, fastapi, asyncpg, pyjwt, bcrypt…
│   └── .env              # all secrets/config (see Configuration)
├── lavalink/
│   ├── Lavalink.jar      # Lavalink v4.2.2 server
│   ├── application.yml   # Lavalink config (youtube-plugin 1.18.2)
│   └── plugins/youtube-plugin-1.18.2.jar
├── frontend/             # React status page + admin dashboard
│   └── src/admin/        # login, dashboard, protected route, styles
├── supervisor configs    # /etc/supervisor/conf.d/{pupu_bot,lavalink}.conf
└── memory/PRD.md         # project log
```

---

## ⚙️ Configuration (`backend/.env`)

| Key | Description |
|---|---|
| `DISCORD_BOT_TOKEN` | Discord bot token (Developer Portal → Bot) |
| `LAVALINK_URL` | Lavalink base URL, e.g. `http://localhost:2333` or your Railway URL |
| `LAVALINK_PASSWORD` | Lavalink password (must match `application.yml`) |
| `MONGO_URL` / `DB_NAME` | MongoDB connection + database name |
| `SUPABASE_DB_URL` | Supabase Postgres **pooler** DSN (see below) |
| `JWT_SECRET` | Random 64-char hex for admin tokens |
| `ADMIN_USERNAME` / `ADMIN_PASSWORD` | Admin dashboard login |

**Supabase DSN tip:** the direct host `db.<ref>.supabase.co` is IPv6-only on the free tier.
Use the **session pooler** instead:

```
postgresql://postgres.<PROJECT_REF>:<PASSWORD>@aws-0-<REGION>.pooler.supabase.com:5432/postgres
```

Get it from Supabase → Project Settings → Database → Connection string → *Session pooler*.
URL-encode `@` in passwords as `%40`.

---

## 🚀 Local Development

```bash
# 1. Lavalink (needs Java 17+)
cd lavalink && java -jar Lavalink.jar          # listens on :2333

# 2. Backend API (FastAPI on :8001)
cd backend && pip install -r requirements.txt
uvicorn server:app --host 0.0.0.0 --port 8001 --reload

# 3. Discord bot (separate long-running process)
cd backend && python pupu_bot.py

# 4. Frontend (React on :3000)
cd frontend && yarn install && yarn start
```

Open `http://localhost:3000` (public status) and `http://localhost:3000/admin` (dashboard).

---

## ☁️ Hosting on Railway (Lavalink + Bot, both)

Deploy as **two services** inside one Railway project: `lavalink` and `pupu` (bot + API).

### A. Lavalink service

Create a small repo (or folder) with:

**`Dockerfile`**
```dockerfile
FROM ghcr.io/lavalink-devs/lavalink:4-alpine
COPY application.yml /opt/Lavalink/application.yml
COPY plugins/ /opt/Lavalink/plugins/
```

**`application.yml`** (note `${PORT}` — Railway assigns it)
```yaml
server:
  port: ${PORT:2333}
  address: 0.0.0.0
lavalink:
  server:
    password: ${LAVALINK_PASSWORD:pupu2026}
    sources:
      youtube: false
      bandcamp: true
      soundcloud: true
      twitch: true
      vimeo: true
      http: true
    bufferDurationMs: 400
    frameBufferDurationMs: 5000
    youtubeSearchEnabled: true
    soundcloudSearchEnabled: true
plugins:
  youtube:
    enabled: true
    allowSearch: true
    allowDirectVideoIds: true
    allowDirectPlaylistIds: true
    clients: [MUSIC, ANDROID_VR, WEB, WEBEMBEDDED]
```

**`plugins/`** — place `youtube-plugin-1.18.2.jar` from
<https://github.com/lavalink-devs/youtube-source/releases> (already included in this repo's
`/app/lavalink/plugins/`). Always use the **latest** — YouTube breaks old versions
(the `1.16.0 → "must find sig function"` incident).

Then in Railway:
1. **New Project → Deploy from GitHub** (select the lavalink repo/folder). Railway detects the Dockerfile.
2. Set variable `LAVALINK_PASSWORD=pupu2026` (or your own).
3. **Settings → Networking → Generate Domain** → note the public URL, e.g.
   `https://lavalink-production-xxxx.up.railway.app`.

### B. Bot + API service

Deploy this repository's `backend` as a Railway service:

- **Build:** `pip install -r requirements.txt`
- **Start (bot):** `python pupu_bot.py`
- **Start (API):** `uvicorn server:app --host 0.0.0.0 --port $PORT`
  - Either run two Railway services (bot + api) from the same repo, or run the API as a
    background task inside the bot process.
- **Variables:** all keys from the Configuration table above, with

```
LAVALINK_URL=https://lavalink-production-xxxx.up.railway.app
LAVALINK_PASSWORD=pupu2026
```

- Add **MongoDB**: Railway's MongoDB plugin (or MongoDB Atlas) and set `MONGO_URL`/`DB_NAME`.

> 💡 If Lavalink and the bot live in the same Railway project, prefer Railway **private
> networking**: `LAVALINK_URL=http://lavalink.railway.internal:2333` (no public hops).

### C. Frontend
Deploy `frontend/` to Vercel/Netlify/Railway static with env
`REACT_APP_BACKEND_URL=<your API public URL>`.

### Railway checklist
| Service | Port | Env |
|---|---|---|
| lavalink | `${PORT}` | `LAVALINK_PASSWORD` |
| pupu-bot | none | `DISCORD_BOT_TOKEN`, `LAVALINK_*`, `MONGO_URL`, `SUPABASE_DB_URL`, `JWT_SECRET`, `ADMIN_*` |
| pupu-api | `${PORT}` | `MONGO_URL`, `JWT_SECRET`, `ADMIN_*` |

---

## 🤖 Discord Setup (required)

1. **Developer Portal → Applications → your bot → Bot → enable "Message Content Intent"**
   (needed for `.` prefix commands).
2. Invite with scopes `bot` + `applications.commands` and permissions
   *Connect, Speak, Send Messages, Embed Links*:
   ```
   https://discord.com/oauth2/authorize?client_id=<CLIENT_ID>&permissions=36710400&scope=bot%20applications.commands
   ```
3. Slash commands register globally — first appearance can take up to **1 hour**;
   prefix commands work instantly.

---

## 📖 Command Reference

Prefix `.` **and** `/` both work. Groups have aliases: `.pl`, `.spl`.

**Playback:** `play <song|url>` · `pause` · `resume` · `skip` · `stop` · `nowplaying` · `seek <1:30>`
**Queue:** `queue` · `shuffle` · `remove <#>` · `clear` · `loop` (off → track → queue)
**Voice:** `join` · `leave` · `volume <0-100>` · `help`

**Personal playlists:** `pl create <name>` · `pl save <name>` (saves current+queue) ·
`pl add <name> <song>` · `pl import <name> <spotify/youtube url>` · `pl load <name> [shuffle]` ·
`pl view <name>` · `pl remove <name> <#>` · `pl delete <name>` · `pl list`

**Server playlists (collaborative):** same actions under `.spl` — shared by everyone in the
server; only the creator can delete.

---

## 🔐 Security notes

- All secrets live in `.env` — **never commit it** (add to `.gitignore`).
- The Discord token used during development was shared in chat → **regenerate it** in the
  Developer Portal and update `DISCORD_BOT_TOKEN`.
- Change `ADMIN_USERNAME`/`ADMIN_PASSWORD` and `JWT_SECRET` before going public.
- Admin endpoints are JWT-protected (Bearer, 12h expiry) with login-attempt lockout.

---

## 🧪 Testing helpers (built-in, opt-in)

- **Playback self-test:** `touch /tmp/pupu_diag.flag && restart bot` → the bot joins an empty
  voice channel, plays HTTP + SoundCloud + YouTube tracks, and logs `DIAG: … OK`.
- **Import self-test:** `touch /tmp/pupu_import_test.flag && restart bot` → imports a public
  Spotify + YouTube playlist and logs results.
- Backend test suites: `backend/tests/test_admin_api.py`, `test_playlist_db.py`,
  `test_bot_status.py`.

---

Made with discord.py + Wavelink 3.5 + Lavalink 4.2.2 + FastAPI + React + MongoDB + Supabase. 🎶
