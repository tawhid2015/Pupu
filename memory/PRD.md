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
- Lavalink: https://lavalink-2026-production-adb0.up.railway.app (v4.2.2, YouTube + SoundCloud)

## Implemented (2026-09-20)
- Hybrid commands (prefix `.` + slash): play, pause, resume, skip, stop, nowplaying, seek,
  queue, shuffle, remove, clear, loop, join, leave, volume, help
- Auto-disconnect after 180s inactivity
- Now-playing embeds with artwork + progress
- Web status dashboard: online state, server/listener counts, latency, live sessions, command reference
- Verified: bot online (98 guilds), Lavalink node ready, 16 slash cmds synced, YouTube search working, status API live

## Notes / requirements outside build
- Discord Developer Portal: Message Content Intent must be ON (enabled in code intents; also toggle in portal)
- Bot must be invited with Connect + Speak voice permissions
- Slash commands registered globally (can take up to ~1h to appear first time)
- Security: token/password were shared in plain chat — recommend regenerating the token

## Backlog / P1
- Filters/bassboost, 24/7 stay-in-channel mode, autoplay related tracks
- DJ/permission role restriction
- Per-user playlists, favorites, history, lyrics
