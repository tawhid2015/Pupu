# Pupu — Discord Music Bot

## Problem statement
Build a Discord music bot named "Pupu" that plays music via a Lavalink v4 server. Both `.`
prefix commands and `/` slash commands must work (e.g. `.help` and `/help`).

## Stack
- Bot: Python, discord.py 2.7.1 + Wavelink 3.5.2 (Lavalink v4)
- Runs as supervisor program `pupu_bot` (`/app/backend/pupu_bot.py`)
- Web status page: FastAPI (`/api/bot/status`) + React (status dashboard)
- MongoDB collection `bot_status` bridges bot -> web page

## Config (backend/.env)
- DISCORD_BOT_TOKEN, LAVALINK_URL, LAVALINK_PASSWORD (secrets, not hardcoded)
- Lavalink: SELF-HOSTED locally since 2026-09-20 — Lavalink 4.2.2 at http://localhost:2333
  (supervisor program `lavalink`, /app/lavalink/, youtube-plugin 1.18.2 in plugins/)
- Old Railway Lavalink (lavalink-2026-production-adb0.up.railway.app) abandoned:
  its youtube-plugin 1.16.0 was broken by YouTube ("must find sig function")

## Bug fix (2026-09-20): bot joined voice but no sound
Root causes: (1) Railway Lavalink's outdated youtube-plugin 1.16.0 broke ALL YouTube streams;
(2) wavelink 3.5.2 `Playable.search` double-prefixed explicit prefixes (ytmsearch:scsearch:...)
so scsearch returned nothing; (3) track-exception handler crashed on track.source_name.
Fixes: self-hosted Lavalink + youtube-plugin 1.18.2; `search_tracks()` helper with proper
`source=` param (YouTube default, SoundCloud for fallback); fixed exception handler using
`track.source` + TypedDict access. Verified via DIAG harness (touch /tmp/pupu_diag.flag +
restart → auto-joins empty VC, plays HTTP/SoundCloud/YouTube, logs pos): all three OK,
pos>3900ms. Test report: /app/test_reports/iteration_2.json (100%).

## Implemented (2026-09-20)
- Hybrid commands (prefix `.` + slash): play, pause, resume, skip, stop, nowplaying, seek,
  queue, shuffle, remove, clear, loop, join, leave, volume, help
- Auto-disconnect after 180s inactivity
- Now-playing embeds with artwork + progress
- Web status dashboard: online state, server/listener counts, latency, live sessions, command reference
- Verified: bot online (98 guilds), Lavalink node ready, 16 slash cmds synced, YouTube search working, status API live

## Playlist system (2026-09-20)
- Supabase Postgres via pooler (SUPABASE_DB_URL in backend/.env; direct db.* host doesn't
  resolve, use aws-0-ap-southeast-1.pooler.supabase.com:5432, user postgres.<ref>)
- /app/backend/playlist_db.py: playlists + playlist_tracks tables, asyncpg pool
  (statement_cache_size=0, min1/max3), limits: 25 playlists/user, 100 tracks/playlist
- Hybrid group `.playlist` / `/playlist` (alias `.pl`): create, save (current+queue), add,
  load (re-resolves by URI, falls back to title search), view, remove, delete, list
- Tests: /app/backend/tests/test_playlist_db.py, report iteration_3.json (100%)

## Playlist v2 (2026-09-20): shuffle-load, server playlists, URL import
- Scoped playlists: personal owner=("user",id) and shared owner=("guild",id), isolated via
  partial unique indexes (playlists_personal_uq / playlists_shared_uq)
- Server-shared (collaborative): group `.serverplaylist`/`.spl` — anyone in the guild can
  create/add/load; only the creator can delete
- Shuffle-load: `.pl load <name> shuffle` (boolean) randomises order via random.shuffle
- Import: `.pl import <name> <url>` — YouTube playlist URLs load natively; public Spotify
  playlist/album/track URLs are scraped via the embed page (__NEXT_DATA__, NO API key) and each
  track resolved to a playable YouTube track (concurrency 8)
- 18 slash commands. Verified: iteration_4.json 100% (scope isolation, dedupe, cap, creator-only
  delete, IMPORTTEST SPOTIFY 50 + YOUTUBE 10)

## Admin dashboard (2026-09-20)
- Multi-server simultaneous playback is inherent to wavelink: each guild has its own
  independent Player + voice connection (confirmed). No shared/global player state.
- Private admin dashboard at `/admin` (login `/admin/login`), JWT Bearer auth, single admin
  from env (ADMIN_USERNAME=pupu / ADMIN_PASSWORD=pupu2026). Token in localStorage
  `pupu_admin_token`, 12h expiry. Brute-force lockout (5 tries/15min) via login_attempts.
- Bot push_status() (5s) writes servers[] with per-guild voice channel, listeners, now-playing,
  volume, queue, loop + active_voice count. poll_commands() (2s) executes admin control
  commands from db.bot_commands (pause/resume/skip/stop/leave/volume).
- Backend admin API: /api/admin/login, /me, /overview, /servers/{id}, /control.
- Frontend: src/admin/{api,AdminLogin,AdminDashboard,ProtectedRoute,admin.css}; near-real-time
  polling every 4s; search, voice-only filter, per-server controls.
- Verified iteration_5.json 100% (backend 13/13, full frontend flow).

## Railway-ready packaging (2026-09-20)
- lavalink/Dockerfile + railway.toml (official lavalink:4-alpine image, downloads
  youtube-plugin at build via YT_PLUGIN_VERSION arg; application.yml uses ${PORT:2333}
  and ${LAVALINK_PASSWORD:pupu2026} templating)
- backend/Dockerfile + railway.toml (default CMD runs bot; API = same image with start
  override `uvicorn server:app --host 0.0.0.0 --port $PORT`)
- frontend/Dockerfile + railway.toml (yarn build → serve static, REACT_APP_BACKEND_URL
  must be set before build)
- README.md fully rewritten: architecture, file-by-file structure, feature internals,
  config matrix, complete Railway guide (4 services + Mongo), maintainer guide, testing
  harnesses, troubleshooting tables

## Rebrand (2026-09-20)
- Watermark everywhere: "Pupu • powered by designertawhid" (bot help footer, web footer)
- Theme: dominant deep violet #7c5cff everywhere (bot EMBED_COLOR 0x7C5CFF, web CSS vars
  --violet #7c5cff / --violet-deep #5537e0, glows + accents re-based to 124,92,255)
- "Lavalink" hidden from all user-facing surfaces (bot embeds, status page, admin UI);
  internals (env names, logs, README) unchanged by design

## YouTube datacenter-IP fix — FINAL (2026-09-20, OAuth + snapshot plugin)
- Root cause chain: datacenter IP → YouTube bot-check (requires login / SABR-only formats);
  poToken CONFLICTS with OAuth (TVHTML5 "The page needs to be reloaded"); plugin 1.18.2's TV
  User-Agent is blocked by YouTube (fixed upstream PR #82, only in SNAPSHOT builds);
  wavelink's inactive_channel_tokens (default 3) fired in the empty DIAG channel and my
  on_wavelink_inactive_player disconnected mid-fallback (players=0, player=None events).
- FINAL working stack:
  • youtube-plugin SNAPSHOT 2be8e542 (PlayStation UA fix) — lavalink/plugins/youtube-plugin-snapshot.jar
    (backup of 1.18.2 kept at lavalink/youtube-plugin-1.18.2.jar.bak; Dockerfile uses the snapshot URL)
  • OAuth-only: plugins.youtube.oauth.enabled + refreshToken (user's burner Google account,
    device flow). NO pot: block (conflicts with OAuth).
  • clients [TV, MUSIC, WEB, WEBEMBEDDED, ANDROID_VR, IOS] + clientOptions: TV playback-only
    (TVHTML5 cannot search), MUSIC/WEB searching enabled.
  • remoteCipher → self-hosted yt-cipher :8002 (supervisor `ytcipher`, Deno,
    API_TOKEN pupu-cipher-2026, OVERRIDE_PLAYER_VARIANT=IAS).
- Bot resilience: _PLAYERS registry + mark_playing + revive_player() (reconnect destroyed
  players), clean_query() 2-step fallback (cleaned YT → cleaned SC), ensure_player()
  reconnects dead players, diag sets inactive_channel_tokens=None (empty-channel artifact).
- Verified: exact reported song plays via=youtube directly (DIAG CUSTOM OK), Rick Astley OK.
  iteration_7 (100%) pre-snapshot; final DIAG 10:24 all 4 probes OK incl. direct YouTube.

## Notes / requirements outside build
- Discord Developer Portal: Message Content Intent must be ON (enabled in code intents; also toggle in portal)
- Bot must be invited with Connect + Speak voice permissions
- Slash commands registered globally (can take up to ~1h to appear first time)
- Security: token/password were shared in plain chat — recommend regenerating the token

## Backlog / P1
- Filters/bassboost, 24/7 stay-in-channel mode, autoplay related tracks
- DJ/permission role restriction
- Per-user playlists, favorites, history, lyrics

## 2026-09-20 — Web UI command copy buttons + README error docs (DONE)
- User asked (msg 580): show BOTH `.` and `/` variants for every command in the Web UI with a
  per-command "Copy" button, and document the YouTube errors/fixes in the README.
- App.js: COMMANDS restructured to {c, a, d} objects (16 individual commands); new CmdRow
  component renders `.cmd args` + `/cmd` chips and a copy button (copies the `.` prefix version,
  e.g. `.play`, with inline "Copied!" feedback; data-testid `copy-cmd-<cmd>`).
- App.css: .cmd-line, .cmd-slash, .cmd-copy (+hover/copied states), .cmd-desc styles.
- README.md: new §7.11 field-notes table (AllClientsFailedException → OAuth device code;
  SABR → yt-cipher; poToken+OAuth conflict; silent playback → inactive_channel_tokens +
  PlayStation UA) and 3 new rows in §13 Troubleshooting.
- Verified via screenshot: desktop 1920 + mobile 390 render correctly, copy button flips to
  "Copied!" on click. No real horizontal overflow (only fixed decorative glow).
