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

## Notes / requirements outside build
- Discord Developer Portal: Message Content Intent must be ON (enabled in code intents; also toggle in portal)
- Bot must be invited with Connect + Speak voice permissions
- Slash commands registered globally (can take up to ~1h to appear first time)
- Security: token/password were shared in plain chat — recommend regenerating the token

## Backlog / P1
- Filters/bassboost, 24/7 stay-in-channel mode, autoplay related tracks
- DJ/permission role restriction
- Per-user playlists, favorites, history, lyrics
