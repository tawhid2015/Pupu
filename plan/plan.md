# Pupu — Discord Music Bot Plan

## What this is
A Discord music bot named **Pupu** that streams audio into voice channels using your
existing Lavalink v4 server. Every command works two ways:
- **Prefix commands** using `.` (e.g. `.play`, `.help`)
- **Slash commands** (e.g. `/play`, `/help`)

The bot runs as a long-lived background process and connects to your Lavalink server at
`https://lavalink-2026-production-adb0.up.railway.app`.

## Decisions made for you (assumptions)
Since no preferences were given, these are the choices being made. Push back on any.

- **Language/library:** Python with discord.py + Wavelink v3 (the current standard for
  Lavalink v4). Chosen for reliability and clean hybrid (prefix + slash) command support.
- **Music sources:** whatever your Lavalink server is configured to support (typically
  YouTube and SoundCloud out of the box; Spotify/Apple links only if your server has those
  plugins installed). The bot will not add its own source plugins — it relies on your server.
- **Web presence:** a small status page will be included showing whether Pupu is online, how
  many servers it is in, and what it is currently playing. This is a nice-to-have on top of
  the bot itself.

## Commands the bot will have
**Playback**
- `play <song or URL>` — search and play / add to queue
- `pause`, `resume`, `stop`, `skip`
- `nowplaying` — show current track with progress
- `seek <time>` — jump to a position in the track

**Queue**
- `queue` — list upcoming tracks
- `shuffle` — shuffle the queue
- `remove <number>` — remove a track from the queue
- `clear` — empty the queue
- `loop` — cycle off / track / queue repeat modes

**Voice / session**
- `join`, `leave` (disconnect)
- `volume <0–100>`

**Utility**
- `help` — lists all commands and how to use them (works as `.help` and `/help`)

If any of these are unwanted, or something is missing (e.g. filters/bassboost, 24/7 stay-in-
channel, autoplay of related tracks), say so and it will be adjusted.

## Behavior details worth confirming
- **Prefix** is `.` as requested.
- **Auto-disconnect:** Pupu will leave the voice channel after a period of inactivity (nothing
  playing for a few minutes) to avoid sitting idle. Tell me if you'd rather it stay 24/7.
- **Who can control it:** anyone in the server can use the commands. There is no DJ/permission
  restriction unless you want one.
- **Slash command availability:** slash commands are registered globally, which can take up to
  ~1 hour for Discord to show them everywhere the first time. Prefix commands work instantly.

## Security note (needs your input)
Your **bot token** and **Lavalink password** were shared in plain chat, so they are now
exposed. They will be stored as environment secrets, never hardcoded in the source. Strong
recommendation: **regenerate the bot token** in the Discord Developer Portal after the bot is
running and provide the new one, since the current token could be used by anyone who saw it.
The plan will proceed using the provided token for now unless you say otherwise.

## What you need to do on Discord (outside this build)
For Pupu to actually join servers and play music, in the Discord Developer Portal the bot must
have the **Message Content Intent** enabled (so `.` prefix commands are readable) and be
invited to your server with permissions to connect and speak in voice channels. If these
aren't set, prefix commands and/or voice playback will silently fail. Confirm you can access
the Developer Portal for this bot, or let me know and I'll provide the exact invite link and
toggle steps.

## Out of scope (unless requested)
- Playlists saved per user, favorites, or history
- Lyrics lookup
- Multi-language support
- Moderation or non-music features
