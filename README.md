<div align="center">

# 🎵 Pupu — Discord Music Bot + Admin Dashboard

**A production-grade Discord music bot** powered by Lavalink v4, with dual command support
(`.` prefix **and** `/` slash), per-user & collaborative server playlists on Supabase Postgres,
Spotify/YouTube playlist import, and a private real-time admin web dashboard.

`discord.py 2.7` · `Wavelink 3.5` · `Lavalink 4.2.2` · `FastAPI` · `React` · `MongoDB` · `Supabase Postgres`

</div>

---

## 📑 Table of Contents

1. [Overview](#1-overview)
2. [Architecture — how the systems connect](#2-architecture--how-the-systems-connect)
3. [Complete project structure — file by file](#3-complete-project-structure--file-by-file)
4. [How the main features work](#4-how-the-main-features-work)
5. [Configuration reference](#5-configuration-reference)
6. [Local development](#6-local-development)
7. [Railway deployment guide (complete)](#7-railway-deployment-guide-complete)
8. [Discord setup (required)](#8-discord-setup-required)
9. [Command reference](#9-command-reference)
10. [Maintainer's guide — add features, fix bugs, modify safely](#10-maintainers-guide)
11. [Testing infrastructure](#11-testing-infrastructure)
12. [Security](#12-security)
13. [Troubleshooting](#13-troubleshooting)

---

## 1. Overview

Pupu is a Discord music bot (`Pupu#4710`) with three runtime pillars:

| Pillar | Technology | Responsibility |
|---|---|---|
| **Discord bot** | Python · discord.py 2.7 · Wavelink 3.5 | Commands, voice sessions, queues, playlists, live status reporting, admin command execution |
| **Lavalink node** | Java · Lavalink 4.2.2 · youtube-plugin 1.18.2 | Audio search, stream resolution, voice streaming to Discord |
| **Web layer** | FastAPI (Python) + React (CRA) | Public status page `/`, private admin dashboard `/admin`, admin API |

Data stores: **MongoDB** (live bot status + admin command queue) and **Supabase Postgres**
(user/server playlists). The bot plays music in **many servers simultaneously** — every guild
has its own fully independent player and voice connection.

---

## 2. Architecture — how the systems connect

```
                          ┌────────────────────────┐
                          │      Discord Gateway    │
                          └───────────┬────────────┘
                                      │ commands / voice events
            ┌─────────────────────────▼──────────────────────────┐
            │  pupu_bot.py  — discord.py + Wavelink  (supervisor) │
            │  • 18 hybrid commands (`.` prefix and `/` slash)    │
            │  • wavelink.Player per guild → independent sessions │
            │  • push_status()  every 5s ─────────┐               │
            │  • poll_commands() every 2s ◄───────┼───┐           │
            └───────┬─────────────────────────────┘   │           │
                    │ REST + WebSocket                │ MongoDB   │ MongoDB
                    ▼                                 ▼           ▲
        ┌───────────────────────┐          ┌──────────────────────┴───┐
        │   Lavalink v4 node    │          │          MongoDB          │
        │   (localhost:2333)    │          │  bot_status  (live state) │
        │   youtube-plugin 1.18 │          │  bot_commands (admin ops) │
        └───────────────────────┘          └──────────▲───────────────┘
                    │                                  │ reads / writes
                    │ asyncpg                  ┌──────┴───────────┐
        ┌───────────▼───────────┐              │  server.py        │
        │   Supabase Postgres   │              │  FastAPI (:8001)  │
        │   playlists tables    │              │  /api/...         │
        └───────────────────────┘              └──────┬────────────┘
                                                      │ HTTPS
                                               ┌──────▼───────────┐
                                               │  React frontend   │
                                               │  / status page    │
                                               │  /admin dashboard │
                                               └──────────────────┘
```

### How the pieces talk

- **Bot ↔ Lavalink**: Wavelink opens a WebSocket (`/v4/websocket`) for real-time events
  (track start/end/exception, player position) and calls the REST API (`/v4/loadtracks`,
  `/v4/sessions/{id}/players/{guild}`) to search, play, pause, seek, set volume.
- **Bot ↔ MongoDB**: `push_status()` writes one `bot_status` document every 5 s containing
  **every** guild's live state. `poll_commands()` reads pending rows from `bot_commands`
  every 2 s, executes them on the matching guild's player, and writes back a result.
- **API ↔ MongoDB**: `/api/bot/status` serves the public page; `/api/admin/*` (JWT-protected)
  serves the dashboard and enqueues control commands into `bot_commands`.
- **Bot ↔ Supabase**: `playlist_db.py` holds an asyncpg pool; all playlist commands run
  parameterized SQL. Schemas are created idempotently at startup (`ensure_schema`).
- **Frontend ↔ API**: public status polls every 5 s; admin dashboard polls every 4 s with a
  `Bearer` JWT stored in `localStorage`.

---

## 3. Complete project structure — file by file

```
/app
├── backend/
│   ├── pupu_bot.py            # ★ The Discord bot. Commands, voice/wavelink handlers,
│   │                          #   playlist command groups, status pusher, admin command
│   │                          #   poller, DIAG + IMPORTTEST self-test harnesses.
│   ├── playlist_db.py         # Supabase Postgres layer: schema + scoped CRUD for
│   │                          #   personal ("user") and shared ("guild") playlists.
│   ├── server.py              # FastAPI app: /api/bot/status (public) and /api/admin/*
│   │                          #   (JWT auth, overview, server detail, control).
│   ├── requirements.txt       # pinned Python deps (discord.py, wavelink, asyncpg, jwt…)
│   ├── Dockerfile             # Railway image for bot/API services
│   ├── railway.toml           # Railway build/deploy config for backend services
│   ├── tests/                 # pytest suites (admin API, playlist DB, bot status)
│   └── .env                   # ALL secrets — never commit (see §5)
│
├── lavalink/
│   ├── application.yml        # Lavalink config; ${PORT}/${LAVALINK_PASSWORD} templated
│   ├── Lavalink.jar           # Lavalink 4.2.2 (local run; gitignored)
│   ├── plugins/
│   │   └── youtube-plugin-1.18.2.jar   # YouTube source (local; gitignored, Docker downloads it)
│   ├── Dockerfile             # Railway image (official lavalink base + plugin download)
│   └── railway.toml
│
├── frontend/
│   ├── src/
│   │   ├── App.js             # Router: / (status page) + /admin/login + /admin
│   │   ├── App.css            # status-page styles (dark violet theme)
│   │   ├── admin/
│   │   │   ├── api.js         # axios helpers + token storage (localStorage)
│   │   │   ├── AdminLogin.js  # login form (data-testid admin-login-*)
│   │   │   ├── AdminDashboard.js  # live stats, server list, controls (4s polling)
│   │   │   ├── ProtectedRoute.js  # verifies JWT, redirects to /admin/login
│   │   │   └── admin.css
│   │   └── index.js           # React entry
│   ├── Dockerfile / railway.toml
│   └── .env                   # REACT_APP_BACKEND_URL only
│
├── memory/
│   ├── PRD.md                 # project log / decisions / backlog
│   └── test_credentials.md    # admin login + endpoint list (gitignored)
├── test_reports/              # iteration_N.json QA reports
└── README.md                  # this file
```

### Runtime processes (this environment)

| Process | Manager | Logs |
|---|---|---|
| `pupu_bot` | supervisor `/etc/supervisor/conf.d/pupu_bot.conf` | `/var/log/supervisor/pupu_bot.err.log` |
| `lavalink` | supervisor `/etc/supervisor/conf.d/lavalink.conf` | `/var/log/supervisor/lavalink.out.log` |
| `backend` (FastAPI) | supervisor | `/var/log/supervisor/backend.*.log` |
| `frontend` (React dev) | supervisor | `/var/log/supervisor/frontend.*.log` |

---

## 4. How the main features work

### 4.1 Playing music (multi-server)
1. `.play <query>` → `search_tracks()` adds the correct Lavalink search prefix
   (`ytsearch:` by default; explicit prefixes like `scsearch:` pass through untouched —
   wavelink 3.5 would otherwise double-prefix them).
2. The guild's `wavelink.Player` is created by connecting to the author's voice channel.
3. Tracks go into `player.queue`; the first starts immediately at volume 60.
4. Lavalink streams audio directly into the voice channel. **Each guild = one player =
   one independent session**, so servers never interfere.
5. `on_wavelink_track_exception`: if a **YouTube** track fails to stream, the bot searches
   SoundCloud for the same title and plays that instead (one fallback per track), and tells
   the channel what happened. `on_wavelink_track_stuck` auto-skips.
6. After 3 minutes with nothing playing, `on_wavelink_inactive_player` disconnects the bot.

### 4.2 Playlists (Supabase Postgres)
- Two scopes: personal `("user", user_id)` and server-shared `("guild", guild_id)`, isolated
  by partial unique indexes (`playlists_personal_uq`, `playlists_shared_uq`). Same name can
  exist in both scopes.
- Personal group `.playlist` / `.pl`; server group `.serverplaylist` / `.spl`. Both call the
  same `_do_*` handlers with a different `owner` tuple.
- Limits: 25 playlists per scope, 100 tracks per playlist, 32-char names.
- Shared playlists are collaborative (anyone adds/loads), but only the **creator** can delete.
- `save` snapshots current track + queue. `load` re-resolves each stored URI through
  Lavalink (falls back to a title search if the URI died). `load <name> shuffle` randomizes order.

### 4.3 Playlist import (Spotify / YouTube URLs)
- **YouTube** playlist URLs: Lavalink loads them natively (`loadType=playlist`).
- **Spotify** playlist/album/track URLs: the bot fetches the public **embed page**
  (`open.spotify.com/embed/...`), parses the `__NEXT_DATA__` JSON for title+artist pairs —
  *no Spotify API key required* — then resolves each pair on YouTube concurrently
  (semaphore of 8) and stores the playable results.
- Self-test: `run_import_test()` (see §11).

### 4.4 Admin dashboard (private, near-real-time)
- Login: `POST /api/admin/login` (bcrypt check against env credentials, 5-attempts/15-min
  lockout per IP+username) → JWT (HS256, 12 h).
- The React dashboard polls `/api/admin/overview` every 4 s: stats (servers, members, voice
  count, playing count, latency) and the full server list with voice channel, listeners,
  now-playing + progress, volume, queue length, loop mode.
- Controls (pause/resume/skip/stop/leave/volume) insert a pending row into MongoDB
  `bot_commands`; the bot's 2 s poller executes it and the API waits (≤6 s) for the result.
- `/admin` is guarded by `ProtectedRoute`; every API call sends `Authorization: Bearer …`;
  a 401 bounces the user back to login.

### 4.5 Public status page
`GET /api/bot/status` reads the same `bot_status` doc (marks the bot offline if the doc is
stale > 40 s) and renders online state, server/user counts, latency, live sessions and the
command reference.

---

## 5. Configuration reference

All backend config lives in **`backend/.env`** (never commit it — already gitignored).

| Key | Required by | Description |
|---|---|---|
| `DISCORD_BOT_TOKEN` | bot | Discord bot token (Developer Portal → Bot → Token) |
| `LAVALINK_URL` | bot | Lavalink base URL. Local: `http://localhost:2333`. Railway: the node's public URL or private hostname |
| `LAVALINK_PASSWORD` | bot + Lavalink | Shared secret. Must equal `lavalink.server.password` |
| `MONGO_URL` | bot + API | MongoDB connection string |
| `DB_NAME` | bot + API | Mongo database name |
| `SUPABASE_DB_URL` | bot | Supabase **session pooler** DSN (see note below) |
| `JWT_SECRET` | API | 64-char hex for signing admin JWTs |
| `ADMIN_USERNAME` | API | dashboard login (default `pupu`) |
| `ADMIN_PASSWORD` | API | dashboard password (**change it**) |
| `CORS_ORIGINS` | API | `*` locally; lock to your frontend origin in prod |

**Lavalink** takes config from `lavalink/application.yml`; two values are env-templated:
`${PORT:2333}` and `${LAVALINK_PASSWORD:pupu2026}` — so the same file works locally and on Railway.

**Frontend** takes one variable: `REACT_APP_BACKEND_URL` (in `frontend/.env`; on Railway set it
as a service variable *before* build — CRA bakes env into the bundle).

**Supabase DSN note:** the direct host `db.<ref>.supabase.co` is IPv6-only on free tiers and
often won't resolve. Use the **Session Pooler** string from
*Supabase → Project Settings → Database → Connection string → Session pooler*:

```
postgresql://postgres.<PROJECT_REF>:<PASSWORD>@aws-0-<REGION>.pooler.supabase.com:5432/postgres
```

URL-encode special characters in the password (`@` → `%40`). asyncpg connects with
`statement_cache_size=0` (required for pooler compatibility).

---

## 6. Local development

Prerequisites: **Java 17+**, **Python 3.11+**, **Node 18+**, **MongoDB**.

```bash
# 1 ─ Lavalink (audio server, :2333)
cd lavalink && java -jar Lavalink.jar

# 2 ─ API (:8001)
cd backend && pip install -r requirements.txt
uvicorn server:app --host 0.0.0.0 --port 8001 --reload

# 3 ─ Discord bot (separate long-running process)
cd backend && python pupu_bot.py

# 4 ─ Frontend (:3000)
cd frontend && yarn install && yarn start
```

- Public status: `http://localhost:3000` · Admin: `http://localhost:3000/admin`
- Sanity: `curl -H "Authorization: pupu2026" http://localhost:2333/version` → `4.2.2`
- Bot logs should show: `Playlist DB connected` → `Lavalink node ready` → `Synced N slash commands` → `Pupu online as Pupu#4710`

---

## 7. Railway deployment guide (complete)

The repo ships Railway-ready: each deployable folder has a **`Dockerfile` + `railway.toml`**.
You will create **one Railway project with 4 services**:

| # | Service | Root Directory | Purpose |
|---|---|---|---|
| 1 | `lavalink` | `/lavalink` | audio node |
| 2 | `pupu-bot` | `/backend` | Discord bot (worker, no public port) |
| 3 | `pupu-api` | `/backend` | FastAPI (public, for dashboard) |
| 4 | `pupu-web` | `/frontend` | static React (public) |

Plus one **MongoDB** database (Railway plugin or Atlas).

### 7.1 Create the project & database
1. Railway → **New Project → Deploy from GitHub repo** (select this repo).
2. **+ New → Database → MongoDB** (or use MongoDB Atlas). Copy the connection string —
   prefer the **private** one (`*.railway.internal`) for services in the same project.

### 7.2 Lavalink service
1. **+ New → GitHub repo → same repo**, then **Settings → Root Directory = `lavalink`**.
   Railway auto-detects `lavalink/Dockerfile` (official Lavalink 4-alpine image +
   downloads `youtube-plugin` at build time).
2. **Variables:**
   | Key | Value |
   |---|---|
   | `LAVALINK_PASSWORD` | `pupu2026` (or your own — must match the bot's `LAVALINK_PASSWORD`) |
   `PORT` is injected by Railway automatically (`application.yml` reads `${PORT:2333}`).
3. **Settings → Networking → Generate Domain** → copy the public URL, e.g.
   `https://lavalink-production-adb0.up.railway.app`.
4. Verify: `curl -H "Authorization: pupu2026" https://<domain>/version` → `4.2.2`.

### 7.3 Bot service (`pupu-bot`)
1. **+ New → same repo → Root Directory = `backend`**. Dockerfile `CMD` already runs the bot.
2. **Variables** (all required):
   ```
   DISCORD_BOT_TOKEN=<bot token>
   LAVALINK_URL=https://<lavalink-domain>        # or http://lavalink.railway.internal:${PORT}
   LAVALINK_PASSWORD=pupu2026
   MONGO_URL=mongodb://mongo:<pass>@mongodb.railway.internal:27017
   DB_NAME=pupu
   SUPABASE_DB_URL=postgresql://postgres.<ref>:<pass>@aws-0-<region>.pooler.supabase.com:5432/postgres
   ```
3. No public networking needed — it's an outbound-only worker.
4. Logs must show `Lavalink node ready` and `Pupu online as …`.

### 7.4 API service (`pupu-api`)
1. **+ New → same repo → Root Directory = `backend`** (same image).
2. **Settings → Deploy → Custom Start Command:**
   ```
   uvicorn server:app --host 0.0.0.0 --port $PORT
   ```
3. **Variables:** `MONGO_URL`, `DB_NAME`, `JWT_SECRET` (64-hex), `ADMIN_USERNAME`,
   `ADMIN_PASSWORD`, `CORS_ORIGINS=https://<your-frontend-domain>`.
4. **Generate Domain** → this URL becomes the frontend's `REACT_APP_BACKEND_URL`.
5. Verify: `curl https://<api-domain>/api/bot/status` → JSON with `"online": true`.

### 7.5 Frontend service (`pupu-web`)
1. **+ New → same repo → Root Directory = `frontend`**
2. **Variables:** `REACT_APP_BACKEND_URL=https://<api-domain>` — **must be set before the
   first build** (CRA inlines it). If you change it later, trigger **Redeploy** to rebuild.
3. **Generate Domain.** Visit `/` (public status) and `/admin` (login → dashboard).

### 7.6 Private networking (recommended)
In one Railway project, services reach each other over the internal network:
`LAVALINK_URL=http://lavalink.railway.internal:2333`… note Railway binds the container to
`${PORT}`; if Railway assigns a port ≠ 2333, use `http://lavalink.railway.internal:${PORT}`
— or simply use the public domain (works fine, small latency cost). MongoDB: always prefer
the `*.railway.internal` URL.

### 7.7 Environment variable matrix

| Variable | lavalink | yt-cipher | pupu-bot | pupu-api | pupu-web |
|---|:-:|:-:|:-:|:-:|:-:|
| `LAVALINK_PASSWORD` | ✅ | | ✅ | | |
| `YTCIPHER_URL` + `YTCIPHER_PASSWORD` | ✅ | | | | |
| `YOUTUBE_REFRESH_TOKEN` | ✅ | | | | |
| `API_TOKEN` (= `YTCIPHER_PASSWORD`) | | ✅ | | | |
| `OVERRIDE_PLAYER_VARIANT=IAS` | | ✅ | | | |
| `DISCORD_BOT_TOKEN` | | | ✅ | | |
| `LAVALINK_URL` | | | ✅ | | |
| `MONGO_URL` + `DB_NAME` | | | ✅ | ✅ | |
| `SUPABASE_DB_URL` | | | ✅ | | |
| `JWT_SECRET`, `ADMIN_USERNAME`, `ADMIN_PASSWORD` | | | | ✅ | |
| `CORS_ORIGINS` | | | | ✅ | |
| `REACT_APP_BACKEND_URL` | | | | | ✅ |

> **yt-cipher is a 5th service** (Root Directory `lavalink/yt-cipher/`, its own `Dockerfile`
> + `railway.toml`). Set Lavalink's `YTCIPHER_PASSWORD` equal to yt-cipher's `API_TOKEN`, and
> point `YTCIPHER_URL` at yt-cipher's private hostname
> (`http://yt-cipher.railway.internal:${PORT}`). `application.yml` reads all three
> (`YTCIPHER_URL`, `YTCIPHER_PASSWORD`, `YOUTUBE_REFRESH_TOKEN`) with local-default fallbacks,
> so the same file works locally and on Railway.

### 7.8 Keeping everything running
- `railway.toml` sets `restartPolicyType = ON_FAILURE` on every service → auto-recovery.
- The bot auto-reconnects to Discord (gateway resume) and Lavalink (wavelink node retries).
- Lavalink cold-start: the YouTube plugin needs ~1–3 min to fetch its first visitor token —
  searches can return empty during that window; it self-heals.
- Watch **Metrics** in Railway: Lavalink ~512 MB JVM is enough for this workload; raise
  `-Xmx` (JAVA_TOOL_OPTIONS) if you see OOM.

### 7.9 Updating / redeploying
1. Push to GitHub → Railway auto-deploys (or **Deploy → Redeploy**).
2. Order doesn't matter; worst case the bot retries its Lavalink connection until it's back.
3. **YouTube suddenly stops working** (`No supported audio streams` / `AllClientsFailedException:
   All clients failed to load the item`): this is YouTube's bot-check against datacenter IPs.
   Fix = refresh the **poToken** (see §7.11) and/or bump `YT_PLUGIN_VERSION` in
   `lavalink/Dockerfile` to the latest
   [youtube-source release](https://github.com/lavalink-devs/youtube-source/releases), then redeploy.

### 7.11 YouTube on datacenter IPs — OAuth (current, working) + yt-cipher
YouTube blocks anonymous playback from datacenter IPs. Pupu's final, working setup:

1. **OAuth (primary auth):** `plugins.youtube.oauth.enabled: true` with a `refreshToken`
   obtained by a one-time device-code flow (Lavalink prints `go to https://www.google.com/device
   and enter code XXXX` at startup when no token is stored). Use a **burner Google account**.
   ⚠️ Never combine OAuth with a `pot:` (poToken) block — they conflict ("The page needs to be
   reloaded"). The poToken generator in `lavalink/potoken/` + `refresh_potoken.py` is retained
   as a fallback tool but intentionally disabled.
2. **yt-cipher (signature decryption):** self-hosted Deno service in `lavalink/yt-cipher/`
   (port 8002, `API_TOKEN`), referenced from `application.yml` → `plugins.youtube.remoteCipher`.
   Handles YouTube's SABR signature rotation.
3. **Clients:** `TV` (OAuth-capable, resolves to TVHTML5), then IOS/MUSIC/WEB/WEBEMBEDDED/
   ANDROID_VR as fallbacks.
4. **Bot-side resilience:** if a YouTube track still fails, Pupu auto-retries with a cleaned
   title (another YouTube upload, then SoundCloud) and reconnects the voice player if needed —
   users hear music either way.

#### Errors we hit → root cause → fix (field notes)

| Error / symptom | Root cause | Fix that worked |
|---|---|---|
| `AllClientsFailedException: All clients failed to load the item` on every YouTube track | YouTube bot-check against the datacenter IP — all anonymous Innertube clients refused | Enabled `plugins.youtube.oauth` and completed the **Google OAuth Device Code** flow once with a burner account; the plugin stores a refresh token and plays as an authenticated TV client |
| `No supported audio streams` / SABR format errors | YouTube rotated to SABR streaming; the signature cipher could not be decrypted locally | Self-hosted **yt-cipher** (Deno, port 8002) and pointed `plugins.youtube.remoteCipher` at it — deciphering happens off-Lavalink and tracks resolve again |
| "The page needs to be reloaded" after enabling poToken + OAuth together | `pot:` block and OAuth tokens conflict — clients get mixed credentials | Removed the poToken block entirely; kept OAuth only (poToken generator retained in `lavalink/potoken/` but intentionally disabled) |
| "Added to Queue / Now Playing but **no sound**" | Wavelink's default `inactive_channel_tokens` throttled the voice session; the default player User-Agent was also being rejected | Disabled `inactive_channel_tokens` on the wavelink node and pinned a PlayStation client User-Agent in the youtube-plugin snapshot — playback position now advances and audio is audible |
| Searches return empty right after Lavalink boots | youtube-plugin visitor-token warm-up (1–3 min) | Expected — self-heals, no action needed |


On Railway: run yt-cipher as an extra service (Root Directory `lavalink/yt-cipher`, start
`deno run --no-check --allow-net --allow-read --allow-write --allow-env server.ts` with env
`API_TOKEN`, `OVERRIDE_PLAYER_VARIANT=IAS`, `PORT`) and point `remoteCipher.url` at its private
hostname. OAuth: after first deploy, read the device code from the lavalink service logs,
authorize once, then set the printed refresh token as variable `YOUTUBE_REFRESH_TOKEN`…
(or paste into application.yml and redeploy).

### 7.10 Railway troubleshooting
| Symptom | Cause → Fix |
|---|---|
| Bot: `Lavalink node ready` never appears | Wrong `LAVALINK_URL`/password → verify with curl `/version` |
| `401` from Lavalink | `LAVALINK_PASSWORD` mismatch between bot and `application.yml` |
| Searches return nothing right after deploy | youtube-plugin warm-up — wait 2–3 min |
| `No supported audio streams` on YouTube | plugin outdated → bump `YT_PLUGIN_VERSION`, redeploy |
| Playlists error "storage unavailable" | `SUPABASE_DB_URL` wrong → use **session pooler** DSN, URL-encode password |
| API healthy but dashboard blank | `REACT_APP_BACKEND_URL` missing at build → set var, **Redeploy** frontend |
| Admin login 401 | `ADMIN_USERNAME/ADMIN_PASSWORD` not set on `pupu-api` |
| Service keeps restarting | Check service logs; usually missing env var (KeyError at boot) |
| MongoDB connection timeout | Use the `railway.internal` URL; check IP allowances on Atlas |

---

## 8. Discord setup (required)

1. **Developer Portal → Bot → Privileged Gateway Intents → enable "Message Content Intent"**
   (mandatory for `.` prefix commands).
2. Invite URL (scopes `bot` + `applications.commands`, perms Connect/Speak/Send/Embed):
   ```
   https://discord.com/oauth2/authorize?client_id=<CLIENT_ID>&permissions=36710400&scope=bot%20applications.commands
   ```
3. Slash commands sync globally — up to **1 hour** to appear the first time; prefix commands
   work instantly.
4. The bot needs **Connect + Speak** on voice channels it should join.

---

## 9. Command reference

Every command works as `.cmd` and `/cmd`. Groups: `.playlist` alias `.pl`, `.serverplaylist` alias `.spl`.

| Group | Commands |
|---|---|
| ▶️ Playback | `play <song/url>` · `pause` · `resume` · `skip` · `stop` · `nowplaying` · `seek <1:30>` |
| 📜 Queue | `queue` · `shuffle` · `remove <#>` · `clear` · `loop` (off→track→queue) |
| 🔊 Voice | `join` · `leave` · `volume <0-100>` · `help` |
| 💾 Personal playlists | `pl create/save/add/load/view/remove/delete/list/import` |
| 🌐 Server playlists | `spl …` (same actions; collaborative; creator-only delete) |

---

## 10. Maintainer's guide

Patterns and rules that keep this codebase safe to extend (for humans **and** AI agents):

### Add a new bot command
1. In `pupu_bot.py`, add `@bot.hybrid_command(name="…")` (hybrid = prefix + slash for free).
2. Reply with `emb("…")` embeds; use `get_player(ctx)` (no join) or `ensure_player(ctx)` (join).
3. Restart `pupu_bot` → slash commands re-sync automatically (log: `Synced N slash commands`).

### Add a playlist feature
1. Pure storage logic → add a function to `playlist_db.py` (asyncpg, parameterized SQL only;
   owner scope via `_scope()`).
2. Shared handler `_do_<x>(ctx, owner, …)` in `pupu_bot.py`, then two thin wrappers
   (`pl_<x>`, `spl_<x>`) passing `("user", ctx.author.id)` / `("guild", ctx.guild.id)`.
3. Add a pytest case in `backend/tests/test_playlist_db.py` and run it against the pooler.

### Add/change an API endpoint
- Public → extend `server.py` near `/api/bot/status`.
- Admin-only → decorate with `Depends(require_admin)`; never trust the client.

### Fix bugs — where to look first
| Layer | Log / tool |
|---|---|
| Bot | `/var/log/supervisor/pupu_bot.err.log` |
| Lavalink | `/var/log/supervisor/lavalink.out.log` (+ `/v4/info`) |
| API | `/var/log/supervisor/backend.err.log` |
| Frontend | browser console + `frontend.err.log` |

### Modify safely
- **Never** break the status contract: `bot_status` doc fields consumed by both frontends;
  add fields, don't rename.
- Admin control channel is one-directional (API → Mongo → bot). Keep `action` whitelist in
  **both** `server.py` and `poll_commands()` in sync.
- After any bot change, run the playback proof (§11). After any API change, run
  `pytest backend/tests -o addopts=''`.
- Keep secrets in `.env`; code must read them via `os.environ[...]` (fail fast, no defaults).

---

## 11. Testing infrastructure

| Harness | How to run | Proves |
|---|---|---|
| **DIAG playback test** | `touch /tmp/pupu_diag.flag && restart pupu_bot` → grep `DIAG:` in bot log | Bot joins an empty voice channel and **actually streams** HTTP + SoundCloud + YouTube (position advances) |
| **IMPORT test** | `touch /tmp/pupu_import_test.flag && restart pupu_bot` → grep `IMPORTTEST:` | Spotify→YouTube resolution + YouTube playlist import + DB writes (self-cleans) |
| **pytest: admin API** | `python -m pytest backend/tests/test_admin_api.py -o addopts=''` | auth, guards, overview schema, control enqueue (13 tests) |
| **pytest: playlists** | `python -m pytest backend/tests/test_playlist_db.py -o addopts=''` | scoped CRUD, dedupe, caps, cascade (real Supabase; cleans up) |
| **pytest: status** | `python -m pytest backend/tests/test_bot_status.py -o addopts=''` | public status endpoint contract |

Both flag-file harnesses self-delete the flag and clean up their data; they only run on bot
startup when the flag exists.

---

## 12. Security

- Secrets live **only** in `.env` / Railway variables. `.env`, `*.key`, credentials and the
  Lavalink jar are gitignored.
- Admin auth: bcrypt-checked credentials, HS256 JWT (12 h), Bearer-only, per-IP+username
  login lockout (5 fails → 15 min).
- The dashboard never exposes the bot token or DB credentials — it proxies through JWT-guarded APIs.
- ⚠️ **Action required:** the original bot token was shared in plain chat during development.
  **Regenerate it** (Developer Portal → Bot → Reset Token) and update `DISCORD_BOT_TOKEN`.
- Change `ADMIN_PASSWORD` and `JWT_SECRET` before any public deployment.

---

## 13. Troubleshooting

| Problem | Diagnosis → Fix |
|---|---|
| Bot online but **no sound** | Check bot log for `TrackException`. `No supported audio streams` = YouTube blocked → update youtube-plugin (§7.9). Also confirm Connect/Speak perms. |
| `AllClientsFailedException: All clients failed to load the item` (YouTube) | Datacenter IP bot-check → complete the Google OAuth Device Code login (§7.11). Never combine OAuth with a poToken block |
| SABR / `No supported audio streams` after a plugin update | Signature cipher rotation → run `yt-cipher` and set `plugins.youtube.remoteCipher` (§7.11) |
| Queued, "Now Playing" shows, but **silent** | Wavelink `inactive_channel_tokens` throttling → disabled on the node; verify playback position advances in the bot log (§7.11) |
| `.` commands ignored, `/` works | **Message Content Intent** off → enable in Developer Portal |
| `/` commands missing | Global sync takes ≤1 h on first deploy; check `Synced N slash commands` in bot log |
| `scsearch:` returns nothing | Old wavelink double-prefix bug — fixed in `search_tracks()`; keep using it |
| Dashboard shows "Offline" | `bot_status.updated_at` stale >40 s → check `pupu_bot` process/logs |
| Control button does nothing | API returns `no_player` if bot isn't in voice in that guild — expected |
| Playlist commands error | `Playlist storage is unavailable` → `SUPABASE_DB_URL` issue (pooler DSN, `%40`) |

---

<div align="center">
Made with discord.py · Wavelink · Lavalink · FastAPI · React · MongoDB · Supabase 🎶
</div>
