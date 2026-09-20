"""Pupu — Discord music bot (discord.py + Wavelink v3)."""
import os
import re
import json
import random
import asyncio
import logging
from datetime import datetime, timezone
from pathlib import Path

import discord
from discord.ext import commands, tasks
import wavelink
import asyncpg
import aiohttp
from dotenv import load_dotenv

import playlist_db
import bot_db

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / ".env")

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
logger = logging.getLogger("pupu")

TOKEN = os.environ["DISCORD_BOT_TOKEN"]
LAVALINK_URL = os.environ.get("LAVALINK_URL", "http://localhost:2333")
LAVALINK_PASSWORD = os.environ.get("LAVALINK_PASSWORD", "pupu2026")
PREFIX = "."
INACTIVE_TIMEOUT = 180  # seconds

EMBED_COLOR = 0x7C5CFF
pg: asyncpg.Pool | None = None


def track_dict(t: wavelink.Playable) -> dict:
    return {"title": t.title, "author": t.author, "uri": t.uri,
            "length": t.length, "artwork": t.artwork}


def fmt_time(ms: int) -> str:
    s = int(ms // 1000)
    h, rem = divmod(s, 3600)
    m, sec = divmod(rem, 60)
    return f"{h}:{m:02d}:{sec:02d}" if h else f"{m}:{sec:02d}"


def emb(desc: str, title: str = None) -> discord.Embed:
    e = discord.Embed(description=desc, color=EMBED_COLOR)
    if title:
        e.title = title
    return e


SEARCH_PREFIXES = ("scsearch:", "ytsearch:", "ytmsearch:", "spsearch:", "amsearch:", "dzsearch:")


def clean_query(title: str, author: str = "") -> str:
    """Strip decorations like '8K Full Song (Title Track) | ...' for a retry search."""
    base = title.split("|")[0]
    base = re.sub(r"\([^)]*\)", "", base)
    base = re.sub(r"\[[^\]]*\]", "", base)
    base = re.sub(r"(?i)\b(8k|4k|official|video|audio|full song|lyrical|hd)\b", "", base)
    base = re.sub(r"\s+", " ", base).strip()
    if author and author.endswith(" - Topic"):
        author = author[:-8]
    return f"{base} {author}".strip()


async def search_tracks(query: str) -> wavelink.Search:
    if query.lower().startswith(SEARCH_PREFIXES):
        return await wavelink.Playable.search(query, source=None)
    return await wavelink.Playable.search(query, source=wavelink.TrackSource.YouTube)


class Pupu(commands.Bot):
    def __init__(self):
        intents = discord.Intents.default()
        intents.message_content = True
        intents.voice_states = True
        super().__init__(command_prefix=PREFIX, intents=intents, help_command=None)

    async def setup_hook(self) -> None:
        global pg
        dsn = os.environ.get("SUPABASE_DB_URL")
        if dsn:
            try:
                pg = await asyncpg.create_pool(dsn, min_size=1, max_size=3,
                                               statement_cache_size=0)
                await playlist_db.ensure_schema(pg)
                logger.info("Playlist DB connected (Supabase Postgres)")
                await bot_db.init_schema()
                logger.info("Control DB connected (Supabase Postgres)")
            except Exception as e:
                pg = None
                logger.error("Playlist DB connection failed: %s", e)
        node = wavelink.Node(uri=LAVALINK_URL, password=LAVALINK_PASSWORD, retries=3)
        await wavelink.Pool.connect(nodes=[node], client=self, cache_capacity=100)
        try:
            synced = await self.tree.sync()
            logger.info("Synced %d slash commands", len(synced))
        except Exception as e:
            logger.error("Slash sync failed: %s", e)

    async def on_ready(self):
        logger.info("Pupu online as %s (%d guilds)", self.user, len(self.guilds))
        if not push_status.is_running():
            push_status.start()
        if not poll_commands.is_running():
            poll_commands.start()

    async def on_wavelink_node_ready(self, payload: wavelink.NodeReadyEventPayload):
        logger.info("Lavalink node ready: %s", payload.node.uri)

    async def on_wavelink_track_start(self, payload: wavelink.TrackStartEventPayload):
        player: wavelink.Player = payload.player
        if not player:
            return
        player._fallback_count = 0
        mark_playing(player, payload.track)
        track = payload.track
        chan = getattr(player, "home", None)
        if chan:
            e = emb(f"**[{track.title}]({track.uri})**\nby {track.author}", "🎶 Now Playing")
            if track.artwork:
                e.set_thumbnail(url=track.artwork)
            e.add_field(name="Duration", value=fmt_time(track.length))
            try:
                await chan.send(embed=e)
            except Exception:
                pass

    async def on_wavelink_inactive_player(self, player: wavelink.Player):
        chan = getattr(player, "home", None)
        if chan:
            try:
                await chan.send(embed=emb("Left the channel due to inactivity. 💤"))
            except Exception:
                pass
        await player.disconnect()

    async def on_wavelink_track_exception(self, payload: wavelink.TrackExceptionEventPayload):
        track = payload.track
        player: wavelink.Player = payload.player or next(
            (p for p in _PLAYERS.values() if getattr(p, "_last_tried", None) == track.identifier),
            None)
        exc = payload.exception or {}
        msg = exc.get("message", "unknown error")
        logger.error("TrackException on %s (%s): %s", track.title, track.source, msg)
        if not player:
            return
        player = await revive_player(player)
        if not player:
            return
        chan = getattr(player, "home", None)

        # Retry chain with a cleaned-up title: another YouTube upload, then SoundCloud.
        attempts = getattr(player, "_fallback_count", 0)
        if track.source == "youtube" and attempts < 2:
            player._fallback_count = attempts + 1
            q = clean_query(track.title, track.author)
            source = wavelink.TrackSource.SoundCloud if attempts == 1 else wavelink.TrackSource.YouTube
            try:
                results = await wavelink.Playable.search(q, source=source)
            except Exception as e:
                results = None
                logger.error("fallback search failed: %s", e)
            if results:
                alt = results.tracks[0] if isinstance(results, wavelink.Playlist) else results[0]
                logger.info("fallback #%d (%s): %s -> %s", attempts + 1, source, track.title, alt.title)
                if chan and attempts == 1:
                    try:
                        await chan.send(embed=emb(
                            f"**{track.title}** couldn't stream from YouTube. "
                            f"Playing the SoundCloud version instead: **{alt.title}** 🔁"))
                    except Exception:
                        pass
                mark_playing(player, alt)
                if player.playing or player.paused:
                    player.queue.put_at(0, alt)
                    await player.skip(force=True)
                else:
                    await player.play(alt)
                return
        if chan:
            try:
                await chan.send(embed=emb(
                    f"Couldn't play **{track.title}** — the source blocked it "
                    f"({track.source}). Try another track. ⚠️"))
            except Exception:
                pass

    async def on_wavelink_track_stuck(self, payload: wavelink.TrackStuckEventPayload):
        player: wavelink.Player = payload.player
        logger.error("Track stuck: %s", payload.track.title)
        if player and player.playing:
            await player.skip(force=True)


bot = Pupu()

# guild_id -> wavelink.Player, for recovering players when events arrive with player=None
_PLAYERS: dict[int, wavelink.Player] = {}


def mark_playing(player, track):
    _PLAYERS[player.guild.id] = player
    player._last_tried = track.identifier


def player_alive(player) -> bool:
    """True if the player is still registered on the Lavalink node and voice-connected."""
    try:
        node = wavelink.Pool.get_node()
        players = getattr(node, "players", None) or getattr(node, "_players", {})
        return player.guild.id in players and player.connected
    except Exception:
        return True


async def revive_player(player):
    """Return a live player, recreating it if wavelink destroyed it after a failed load."""
    if player and player_alive(player):
        return player
    ch = getattr(player, "channel", None) if player else None
    if not ch:
        return None
    try:
        p2 = await ch.connect(cls=wavelink.Player, self_deaf=True)
        p2.home = getattr(player, "home", None)
        p2.inactive_timeout = INACTIVE_TIMEOUT
        p2._fallback_count = getattr(player, "_fallback_count", 0)
        _PLAYERS[ch.guild.id] = p2
        logger.info("revived player for guild %s", ch.guild.id)
        return p2
    except Exception as e:
        logger.error("revive failed: %s", e)
        return None


# ---------- helpers ----------
async def ensure_player(ctx) -> wavelink.Player | None:
    if ctx.guild is None:
        await ctx.reply(embed=emb("Commands only work inside a server."))
        return None
    player: wavelink.Player = ctx.voice_client
    if player:
        if not player_alive(player):
            # player was silently destroyed (e.g. after a failed load) — reconnect cleanly
            try:
                await player.disconnect()
            except Exception:
                pass
            player = None
        else:
            return player
    if not ctx.author.voice or not ctx.author.voice.channel:
        await ctx.reply(embed=emb("Join a voice channel first. 🔊"))
        return None
    player = await ctx.author.voice.channel.connect(cls=wavelink.Player, self_deaf=True)
    player.home = ctx.channel
    player.inactive_timeout = INACTIVE_TIMEOUT
    return player


def get_player(ctx) -> wavelink.Player | None:
    return ctx.voice_client


# ---------- commands ----------
@bot.hybrid_command(name="play", aliases=["p"], description="Play a song or add it to the queue")
@discord.app_commands.describe(query="Song name or URL (YouTube / SoundCloud)")
async def play(ctx: commands.Context, *, query: str):
    await ctx.defer()
    player = await ensure_player(ctx)
    if not player:
        return
    player.home = ctx.channel
    try:
        results = await search_tracks(query)
    except Exception as e:
        logger.error("search error: %s", e)
        return await ctx.reply(embed=emb("Search failed. Try again."))
    if not results:
        return await ctx.reply(embed=emb(f"No results for **{query}**."))

    if isinstance(results, wavelink.Playlist):
        added = await player.queue.put_wait(results)
        await ctx.reply(embed=emb(f"Added **{added}** tracks from playlist **{results.name}**.", "➕ Queued"))
    else:
        track = results[0]
        await player.queue.put_wait(track)
        await ctx.reply(embed=emb(f"**[{track.title}]({track.uri})**\nby {track.author}", "➕ Added to Queue"))

    if not player.playing:
        first = player.queue.get()
        mark_playing(player, first)
        await player.play(first, volume=60)


@bot.hybrid_command(name="pause", description="Pause playback")
async def pause(ctx: commands.Context):
    player = get_player(ctx)
    if not player or not player.playing:
        return await ctx.reply(embed=emb("Nothing is playing."))
    await player.pause(True)
    await ctx.reply(embed=emb("Paused. ⏸️"))


@bot.hybrid_command(name="resume", description="Resume playback")
async def resume(ctx: commands.Context):
    player = get_player(ctx)
    if not player:
        return await ctx.reply(embed=emb("Nothing to resume."))
    await player.pause(False)
    await ctx.reply(embed=emb("Resumed. ▶️"))


@bot.hybrid_command(name="skip", aliases=["s"], description="Skip the current track")
async def skip(ctx: commands.Context):
    player = get_player(ctx)
    if not player or not player.playing:
        return await ctx.reply(embed=emb("Nothing to skip."))
    await player.skip(force=True)
    await ctx.reply(embed=emb("Skipped. ⏭️"))


@bot.hybrid_command(name="stop", description="Stop playback and clear the queue")
async def stop(ctx: commands.Context):
    player = get_player(ctx)
    if not player:
        return await ctx.reply(embed=emb("Nothing is playing."))
    player.queue.clear()
    await player.stop()
    await ctx.reply(embed=emb("Stopped and cleared the queue. ⏹️"))


@bot.hybrid_command(name="nowplaying", aliases=["np"], description="Show the current track")
async def nowplaying(ctx: commands.Context):
    player = get_player(ctx)
    if not player or not player.current:
        return await ctx.reply(embed=emb("Nothing is playing."))
    t = player.current
    pos, total = player.position, t.length
    filled = int((pos / total) * 20) if total else 0
    bar = "▬" * filled + "🔘" + "▬" * (20 - filled)
    e = emb(f"**[{t.title}]({t.uri})**\nby {t.author}", "🎧 Now Playing")
    e.add_field(name="Progress", value=f"{bar}\n`{fmt_time(pos)} / {fmt_time(total)}`", inline=False)
    e.add_field(name="Loop", value=player.queue.mode.name, inline=True)
    e.add_field(name="Volume", value=f"{player.volume}%", inline=True)
    if t.artwork:
        e.set_thumbnail(url=t.artwork)
    await ctx.reply(embed=e)


@bot.hybrid_command(name="seek", description="Jump to a position, e.g. 1:30")
@discord.app_commands.describe(position="Time like 90 or 1:30")
async def seek(ctx: commands.Context, position: str):
    player = get_player(ctx)
    if not player or not player.current:
        return await ctx.reply(embed=emb("Nothing is playing."))
    try:
        if ":" in position:
            m, s = position.split(":")
            secs = int(m) * 60 + int(s)
        else:
            secs = int(position)
    except ValueError:
        return await ctx.reply(embed=emb("Invalid time. Use `90` or `1:30`."))
    await player.seek(secs * 1000)
    await ctx.reply(embed=emb(f"Seeked to `{fmt_time(secs * 1000)}`. ⏩"))


@bot.hybrid_command(name="queue", aliases=["q"], description="Show the queue")
async def queue_cmd(ctx: commands.Context):
    player = get_player(ctx)
    if not player:
        return await ctx.reply(embed=emb("Nothing is playing."))
    lines = []
    if player.current:
        lines.append(f"**Now:** [{player.current.title}]({player.current.uri})")
    upcoming = list(player.queue)[:10]
    for i, t in enumerate(upcoming, 1):
        lines.append(f"`{i}.` [{t.title}]({t.uri}) — {fmt_time(t.length)}")
    extra = len(player.queue) - len(upcoming)
    if extra > 0:
        lines.append(f"...and **{extra}** more")
    if not lines:
        return await ctx.reply(embed=emb("The queue is empty."))
    await ctx.reply(embed=emb("\n".join(lines), "📜 Queue"))


@bot.hybrid_command(name="shuffle", description="Shuffle the queue")
async def shuffle(ctx: commands.Context):
    player = get_player(ctx)
    if not player or len(player.queue) < 2:
        return await ctx.reply(embed=emb("Not enough tracks to shuffle."))
    player.queue.shuffle()
    await ctx.reply(embed=emb("Queue shuffled. 🔀"))


@bot.hybrid_command(name="remove", description="Remove a track by its queue number")
@discord.app_commands.describe(index="Position in the queue")
async def remove(ctx: commands.Context, index: int):
    player = get_player(ctx)
    if not player or len(player.queue) < index or index < 1:
        return await ctx.reply(embed=emb("Invalid track number."))
    track = player.queue[index - 1]
    del player.queue[index - 1]
    await ctx.reply(embed=emb(f"Removed **{track.title}**. 🗑️"))


@bot.hybrid_command(name="clear", description="Clear the queue")
async def clear(ctx: commands.Context):
    player = get_player(ctx)
    if not player:
        return await ctx.reply(embed=emb("Nothing is playing."))
    player.queue.clear()
    await ctx.reply(embed=emb("Queue cleared. 🧹"))


@bot.hybrid_command(name="loop", description="Cycle loop mode: off / track / queue")
async def loop(ctx: commands.Context):
    player = get_player(ctx)
    if not player:
        return await ctx.reply(embed=emb("Nothing is playing."))
    mode = player.queue.mode
    if mode == wavelink.QueueMode.normal:
        player.queue.mode = wavelink.QueueMode.loop
        msg = "Looping **current track**. 🔂"
    elif mode == wavelink.QueueMode.loop:
        player.queue.mode = wavelink.QueueMode.loop_all
        msg = "Looping **whole queue**. 🔁"
    else:
        player.queue.mode = wavelink.QueueMode.normal
        msg = "Loop **off**. ➡️"
    await ctx.reply(embed=emb(msg))


@bot.hybrid_command(name="volume", aliases=["vol"], description="Set volume 0-100")
@discord.app_commands.describe(level="Volume between 0 and 100")
async def volume(ctx: commands.Context, level: int):
    player = get_player(ctx)
    if not player:
        return await ctx.reply(embed=emb("Nothing is playing."))
    level = max(0, min(100, level))
    await player.set_volume(level)
    await ctx.reply(embed=emb(f"Volume set to **{level}%**. 🔊"))


@bot.hybrid_command(name="join", description="Make Pupu join your voice channel")
async def join(ctx: commands.Context):
    if get_player(ctx):
        return await ctx.reply(embed=emb("Already connected."))
    player = await ensure_player(ctx)
    if player:
        await ctx.reply(embed=emb(f"Joined **{ctx.author.voice.channel.name}**. 👋"))


@bot.hybrid_command(name="leave", aliases=["dc", "disconnect"], description="Disconnect Pupu")
async def leave(ctx: commands.Context):
    player = get_player(ctx)
    if not player:
        return await ctx.reply(embed=emb("Not connected."))
    await player.disconnect()
    await ctx.reply(embed=emb("Disconnected. See you! 👋"))


@bot.hybrid_command(name="help", description="Show all commands")
async def help_cmd(ctx: commands.Context):
    e = discord.Embed(title="🎵 Pupu — Commands", color=EMBED_COLOR,
                      description=f"Use `{PREFIX}command` or `/command`. Both work!")
    e.add_field(name="▶️ Playback",
                value=("`play <song/url>` · `pause` · `resume`\n"
                       "`skip` · `stop` · `nowplaying` · `seek <time>`"), inline=False)
    e.add_field(name="📜 Queue",
                value=("`queue` · `shuffle` · `remove <#>`\n"
                       "`clear` · `loop`"), inline=False)
    e.add_field(name="🔊 Voice",
                value="`join` · `leave` · `volume <0-100>`", inline=False)
    e.add_field(name="💾 Playlists (personal)",
                value=("`playlist create <name>` · `playlist save <name>`\n"
                       "`playlist add <name> <song>` · `playlist load <name> [shuffle]`\n"
                       "`playlist import <name> <url>` · `playlist view <name>`\n"
                       "`playlist remove <name> <#>` · `playlist delete <name>` · `playlist list`"),
                inline=False)
    e.add_field(name="🌐 Server Playlists (shared)",
                value=("`serverplaylist …` (alias `spl`) — same actions, shared by everyone\n"
                       "e.g. `spl create <name>` · `spl add <name> <song>` · `spl load <name>`"),
                inline=False)
    e.set_footer(text="Pupu • powered by designertawhid")
    await ctx.reply(embed=e)


# ---------- playlists (Supabase Postgres) ----------
def pg_check() -> bool:
    return pg is not None


async def name_invalid(ctx, name: str) -> bool:
    if not playlist_db.clean_name(name):
        await ctx.reply(embed=emb("Please provide a valid playlist name."))
        return True
    return False


SPOTIFY_RE = re.compile(r"open\.spotify\.com/(?:intl-[a-z]+/)?(playlist|album|track)/([A-Za-z0-9]+)")


async def _fetch_spotify(url: str):
    """Scrape a public Spotify playlist/album/track via its embed page. Returns (name, [(title, artist)])."""
    m = SPOTIFY_RE.search(url)
    if not m:
        return None, []
    kind, sid = m.group(1), m.group(2)
    embed_url = f"https://open.spotify.com/embed/{kind}/{sid}"
    async with aiohttp.ClientSession(headers={"User-Agent": "Mozilla/5.0"}) as s:
        async with s.get(embed_url, timeout=aiohttp.ClientTimeout(total=20)) as r:
            html = await r.text()
    mm = re.search(r'<script id="__NEXT_DATA__" type="application/json">(.*?)</script>', html, re.S)
    if not mm:
        return None, []
    try:
        entity = json.loads(mm.group(1))["props"]["pageProps"]["state"]["data"]["entity"]
    except Exception:
        return None, []
    name = entity.get("name")
    tl = entity.get("trackList") or []
    if not tl and entity.get("title"):
        tl = [entity]
    pairs = [(t.get("title", ""), t.get("subtitle", "")) for t in tl if t.get("title")]
    return name, pairs


async def _resolve_query(q: str):
    try:
        res = await wavelink.Playable.search(q, source=wavelink.TrackSource.YouTube)
        if res:
            t = res.tracks[0] if isinstance(res, wavelink.Playlist) else res[0]
            return track_dict(t)
    except Exception:
        pass
    return None


async def resolve_import(url: str):
    """Returns (playlist_name|None, [track_dict]). Handles Spotify + native (YouTube/SC) URLs."""
    if "open.spotify.com" in url:
        name, pairs = await _fetch_spotify(url)
        pairs = pairs[:playlist_db.MAX_TRACKS_PER_PLAYLIST]
        sem = asyncio.Semaphore(8)

        async def one(title, artist):
            async with sem:
                return await _resolve_query(f"{title} {artist}".strip())

        resolved = await asyncio.gather(*(one(t, a) for t, a in pairs))
        return name, [t for t in resolved if t]
    # native playlist / track URL
    try:
        res = await wavelink.Playable.search(url)
    except Exception:
        return None, []
    if isinstance(res, wavelink.Playlist):
        return res.name, [track_dict(t) for t in res.tracks[:playlist_db.MAX_TRACKS_PER_PLAYLIST]]
    if res:
        return None, [track_dict(res[0])]
    return None, []


# ---------- shared command implementations (personal + server) ----------
async def _do_list(ctx, owner, title):
    rows = await playlist_db.list_playlists(pg, owner)
    if not rows:
        return await ctx.reply(embed=emb(f"No playlists yet. Create one with `create <name>`.", title))
    lines = []
    for i, r in enumerate(rows, 1):
        extra = ""
        if owner[0] == "guild":
            extra = f" · by <@{r['creator']}>"
        lines.append(f"`{i}.` **{r['name']}** — {r['tracks']} track"
                     f"{'s' if r['tracks'] != 1 else ''}{extra}")
    await ctx.reply(embed=emb("\n".join(lines), title))


async def _do_create(ctx, owner, name):
    if await name_invalid(ctx, name):
        return
    res = await playlist_db.create_playlist(pg, owner, name, ctx.author.id)
    cn = playlist_db.clean_name(name)
    if res == "ok":
        scope = "Server playlist" if owner[0] == "guild" else "Playlist"
        await ctx.reply(embed=emb(f"{scope} **{cn}** created. ✅\nAdd songs with `add {cn} <song>`."))
    elif res == "exists":
        await ctx.reply(embed=emb("A playlist with that name already exists here."))
    else:
        await ctx.reply(embed=emb(f"Limit reached ({playlist_db.MAX_PLAYLISTS} playlists)."))


async def _do_save(ctx, owner, name):
    if await name_invalid(ctx, name):
        return
    player = get_player(ctx)
    tracks = []
    if player and player.current:
        tracks.append(track_dict(player.current))
    if player:
        tracks.extend(track_dict(t) for t in list(player.queue))
    if not tracks:
        return await ctx.reply(embed=emb("Nothing is playing or queued to save."))
    await playlist_db.create_playlist(pg, owner, name, ctx.author.id)
    res = await playlist_db.save_tracks(pg, owner, name, tracks)
    if res == "ok":
        await ctx.reply(embed=emb(f"Saved **{len(tracks)}** tracks to **{playlist_db.clean_name(name)}**. 💾"))
    else:
        await ctx.reply(embed=emb("Couldn't save the playlist."))


async def _do_add(ctx, owner, name, query):
    await ctx.defer()
    try:
        results = await search_tracks(query)
    except Exception:
        return await ctx.reply(embed=emb("Search failed. Try again."))
    if not results:
        return await ctx.reply(embed=emb(f"No results for **{query}**."))
    track = results.tracks[0] if isinstance(results, wavelink.Playlist) else results[0]
    res = await playlist_db.add_track(pg, owner, name, track_dict(track))
    cn = playlist_db.clean_name(name)
    if res == "ok":
        await ctx.reply(embed=emb(f"**[{track.title}]({track.uri})** added to **{cn}**. ➕"))
    elif res == "missing":
        await ctx.reply(embed=emb(f"Playlist **{cn}** not found. Create it with `create {cn}`."))
    else:
        await ctx.reply(embed=emb(f"Playlist is full ({playlist_db.MAX_TRACKS_PER_PLAYLIST} tracks)."))


async def _do_import(ctx, owner, name, url):
    if await name_invalid(ctx, name):
        return
    await ctx.defer()
    note = await ctx.reply(embed=emb("Importing… this can take a moment for big playlists. ⏳"))
    src_name, tracks = await resolve_import(url)
    if not tracks:
        return await note.edit(embed=emb(
            "Couldn't import that link. Use a **public** Spotify or YouTube playlist/track URL. ⚠️"))
    await playlist_db.create_playlist(pg, owner, name, ctx.author.id)
    added = await playlist_db.add_tracks(pg, owner, name, tracks)
    cn = playlist_db.clean_name(name)
    if added == -1:
        await note.edit(embed=emb(f"Playlist **{cn}** not found."))
    elif added == 0:
        await note.edit(embed=emb(f"Playlist **{cn}** is already full."))
    else:
        extra = f" from *{src_name}*" if src_name else ""
        await note.edit(embed=emb(f"Imported **{added}** tracks{extra} into **{cn}**. 📥"))


async def _do_load(ctx, owner, name, shuffle=False):
    await ctx.defer()
    rows = await playlist_db.get_tracks(pg, owner, name)
    cn = playlist_db.clean_name(name)
    if rows is None:
        return await ctx.reply(embed=emb(f"Playlist **{cn}** not found."))
    if not rows:
        return await ctx.reply(embed=emb(f"Playlist **{cn}** is empty."))
    player = await ensure_player(ctx)
    if not player:
        return
    player.home = ctx.channel
    ordered = list(rows)
    if shuffle:
        random.shuffle(ordered)
    added = 0
    for r in ordered:
        try:
            results = await wavelink.Playable.search(r["uri"]) if r["uri"] else None
            if not results:
                results = await search_tracks(f"{r['title']} {r['author'] or ''}")
            if not results:
                continue
            track = results.tracks[0] if isinstance(results, wavelink.Playlist) else results[0]
            await player.queue.put_wait(track)
            added += 1
        except Exception as e:
            logger.warning("playlist load skip %s: %s", r["title"], e)
    if not player.playing and len(player.queue):
        await player.play(player.queue.get(), volume=60)
    if added:
        tag = " (shuffled 🔀)" if shuffle else ""
        await ctx.reply(embed=emb(
            f"Loaded **{added}** track{'s' if added != 1 else ''} from **{cn}**{tag}. 🎶"))
    else:
        await ctx.reply(embed=emb("Couldn't load any tracks from that playlist. ⚠️"))


async def _do_view(ctx, owner, name):
    rows = await playlist_db.get_tracks(pg, owner, name)
    cn = playlist_db.clean_name(name)
    if rows is None:
        return await ctx.reply(embed=emb(f"Playlist **{cn}** not found."))
    if not rows:
        return await ctx.reply(embed=emb(f"Playlist **{cn}** is empty."))
    lines = [f"`{i}.` [{r['title']}]({r['uri']}) — {fmt_time(r['length_ms'] or 0)}"
             if r["uri"] else f"`{i}.` {r['title']} — {fmt_time(r['length_ms'] or 0)}"
             for i, r in enumerate(rows[:15], 1)]
    extra = len(rows) - 15
    if extra > 0:
        lines.append(f"...and **{extra}** more")
    await ctx.reply(embed=emb("\n".join(lines), f"💾 {cn} ({len(rows)} tracks)"))


async def _do_remove(ctx, owner, name, index):
    res = await playlist_db.remove_track(pg, owner, name, index)
    if res == "missing":
        await ctx.reply(embed=emb(f"Playlist **{playlist_db.clean_name(name)}** not found."))
    elif res == "badindex":
        await ctx.reply(embed=emb("Invalid track number."))
    else:
        await ctx.reply(embed=emb(f"Removed **{res}**. 🗑️"))


async def _do_delete(ctx, owner, name):
    res = await playlist_db.delete_playlist(pg, owner, name, ctx.author.id)
    cn = playlist_db.clean_name(name)
    if res == "ok":
        await ctx.reply(embed=emb(f"Playlist **{cn}** deleted. 🗑️"))
    elif res == "forbidden":
        await ctx.reply(embed=emb("Only the creator can delete this server playlist."))
    else:
        await ctx.reply(embed=emb(f"Playlist **{cn}** not found."))


# ---------- personal playlist group ----------
@bot.hybrid_group(name="playlist", aliases=["pl"], fallback="list",
                  description="Manage your personal playlists")
async def playlist_group(ctx: commands.Context):
    if not pg_check():
        return await ctx.reply(embed=emb("Playlist storage is unavailable right now. ⚠️"))
    await _do_list(ctx, ("user", ctx.author.id), "💾 Your Playlists")


@playlist_group.command(name="create", description="Create a new playlist")
async def pl_create(ctx, name: str):
    if not pg_check():
        return await ctx.reply(embed=emb("Playlist storage is unavailable right now. ⚠️"))
    await _do_create(ctx, ("user", ctx.author.id), name)


@playlist_group.command(name="save", description="Save the current queue into a playlist")
async def pl_save(ctx, name: str):
    if not pg_check():
        return await ctx.reply(embed=emb("Playlist storage is unavailable right now. ⚠️"))
    await _do_save(ctx, ("user", ctx.author.id), name)


@playlist_group.command(name="add", description="Add a song to a playlist")
async def pl_add(ctx, name: str, *, query: str):
    if not pg_check():
        return await ctx.reply(embed=emb("Playlist storage is unavailable right now. ⚠️"))
    await _do_add(ctx, ("user", ctx.author.id), name, query)


@playlist_group.command(name="import", description="Import a Spotify/YouTube playlist URL")
@discord.app_commands.describe(name="Playlist to import into", url="Public Spotify or YouTube URL")
async def pl_import(ctx, name: str, url: str):
    if not pg_check():
        return await ctx.reply(embed=emb("Playlist storage is unavailable right now. ⚠️"))
    await _do_import(ctx, ("user", ctx.author.id), name, url)


@playlist_group.command(name="load", description="Queue a saved playlist")
@discord.app_commands.describe(shuffle="Shuffle the tracks while loading")
async def pl_load(ctx, name: str, shuffle: bool = False):
    if not pg_check():
        return await ctx.reply(embed=emb("Playlist storage is unavailable right now. ⚠️"))
    await _do_load(ctx, ("user", ctx.author.id), name, shuffle)


@playlist_group.command(name="view", description="Show tracks in a playlist")
async def pl_view(ctx, name: str):
    if not pg_check():
        return await ctx.reply(embed=emb("Playlist storage is unavailable right now. ⚠️"))
    await _do_view(ctx, ("user", ctx.author.id), name)


@playlist_group.command(name="remove", description="Remove track # from a playlist")
async def pl_remove(ctx, name: str, index: int):
    if not pg_check():
        return await ctx.reply(embed=emb("Playlist storage is unavailable right now. ⚠️"))
    await _do_remove(ctx, ("user", ctx.author.id), name, index)


@playlist_group.command(name="delete", description="Delete a playlist")
async def pl_delete(ctx, name: str):
    if not pg_check():
        return await ctx.reply(embed=emb("Playlist storage is unavailable right now. ⚠️"))
    await _do_delete(ctx, ("user", ctx.author.id), name)


# ---------- server (shared, collaborative) playlist group ----------
def _guild_owner(ctx):
    return ("guild", ctx.guild.id)


async def _server_guard(ctx) -> bool:
    if not pg_check():
        await ctx.reply(embed=emb("Playlist storage is unavailable right now. ⚠️"))
        return False
    if ctx.guild is None:
        await ctx.reply(embed=emb("Server playlists only work inside a server."))
        return False
    return True


@bot.hybrid_group(name="serverplaylist", aliases=["spl"], fallback="list",
                  description="Shared, collaborative playlists for this server")
async def server_group(ctx: commands.Context):
    if not await _server_guard(ctx):
        return
    await _do_list(ctx, _guild_owner(ctx), f"🌐 {ctx.guild.name} — Server Playlists")


@server_group.command(name="create", description="Create a shared server playlist")
async def spl_create(ctx, name: str):
    if not await _server_guard(ctx):
        return
    await _do_create(ctx, _guild_owner(ctx), name)


@server_group.command(name="save", description="Save the current queue as a server playlist")
async def spl_save(ctx, name: str):
    if not await _server_guard(ctx):
        return
    await _do_save(ctx, _guild_owner(ctx), name)


@server_group.command(name="add", description="Add a song to a server playlist")
async def spl_add(ctx, name: str, *, query: str):
    if not await _server_guard(ctx):
        return
    await _do_add(ctx, _guild_owner(ctx), name, query)


@server_group.command(name="import", description="Import a Spotify/YouTube URL into a server playlist")
@discord.app_commands.describe(name="Server playlist name", url="Public Spotify or YouTube URL")
async def spl_import(ctx, name: str, url: str):
    if not await _server_guard(ctx):
        return
    await _do_import(ctx, _guild_owner(ctx), name, url)


@server_group.command(name="load", description="Queue a server playlist")
@discord.app_commands.describe(shuffle="Shuffle the tracks while loading")
async def spl_load(ctx, name: str, shuffle: bool = False):
    if not await _server_guard(ctx):
        return
    await _do_load(ctx, _guild_owner(ctx), name, shuffle)


@server_group.command(name="view", description="Show tracks in a server playlist")
async def spl_view(ctx, name: str):
    if not await _server_guard(ctx):
        return
    await _do_view(ctx, _guild_owner(ctx), name)


@server_group.command(name="remove", description="Remove track # from a server playlist")
async def spl_remove(ctx, name: str, index: int):
    if not await _server_guard(ctx):
        return
    await _do_remove(ctx, _guild_owner(ctx), name, index)


@server_group.command(name="delete", description="Delete a server playlist (creator only)")
async def spl_delete(ctx, name: str):
    if not await _server_guard(ctx):
        return
    await _do_delete(ctx, _guild_owner(ctx), name)


@play.error
@volume.error
@remove.error
@seek.error
async def arg_error(ctx, error):
    if isinstance(error, (commands.MissingRequiredArgument, commands.BadArgument)):
        await ctx.reply(embed=emb("Missing or invalid argument. Check `.help`."))


# ---------- status writer for the web page ----------
def _player_for(guild):
    vc = guild.voice_client
    return vc if isinstance(vc, wavelink.Player) else None


@tasks.loop(seconds=5)
async def push_status():
    players = []
    servers = []
    active_voice = 0
    for g in bot.guilds:
        p = _player_for(g)
        entry = {
            "id": str(g.id),
            "name": g.name,
            "icon": str(g.icon.url) if g.icon else None,
            "members": g.member_count or 0,
            "owner_id": str(g.owner_id) if g.owner_id else None,
            "voice_connected": False,
            "voice_channel": None,
            "listeners": 0,
            "playing": None,
            "paused": False,
            "volume": None,
            "queue_len": 0,
            "loop": None,
        }
        if p and p.connected:
            active_voice += 1
            ch = p.channel
            entry["voice_connected"] = True
            entry["voice_channel"] = ch.name if ch else None
            entry["listeners"] = sum(1 for m in ch.members if not m.bot) if ch else 0
            entry["volume"] = p.volume
            entry["paused"] = p.paused
            entry["queue_len"] = len(p.queue)
            try:
                entry["loop"] = p.queue.mode.name
            except Exception:
                pass
            if p.current:
                t = p.current
                entry["playing"] = {
                    "title": t.title, "author": t.author, "uri": t.uri,
                    "artwork": t.artwork, "position": p.position, "length": t.length,
                    "source": t.source,
                }
                players.append({
                    "guild": g.name, "guild_id": str(g.id),
                    "title": t.title, "author": t.author, "uri": t.uri,
                    "artwork": t.artwork, "paused": p.paused,
                    "position": p.position, "length": t.length,
                })
        servers.append(entry)

    servers.sort(key=lambda s: (not s["voice_connected"], -s["members"]))
    session_id = None
    try:
        session_id = wavelink.Pool.get_node().session_id
    except Exception:
        pass
    doc = {
        "_id": "pupu",
        "online": True,
        "name": str(bot.user) if bot.user else "Pupu",
        "avatar": str(bot.user.display_avatar.url) if bot.user else None,
        "guilds": len(bot.guilds),
        "users": sum(g.member_count or 0 for g in bot.guilds),
        "active_players": len(players),
        "active_voice": active_voice,
        "players": players,
        "servers": servers,
        "latency_ms": round(bot.latency * 1000) if bot.latency else None,
        "session_id": session_id,
        "test_guild_id": str(bot.guilds[0].id) if bot.guilds else None,
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }
    try:
        await bot_db.save_status(doc)
    except Exception as e:
        logger.error("status write failed: %s", e)


# ---------- admin control command channel ----------
@tasks.loop(seconds=2)
async def poll_commands():
    try:
        cmds = await bot_db.fetch_pending_commands()
    except Exception:
        return
    for c in cmds:
        action = c.get("action")
        gid = int(c.get("guild_id", 0))
        value = c.get("value")
        result = "ok"
        try:
            guild = bot.get_guild(gid)
            p = _player_for(guild) if guild else None
            if action in ("pause", "resume", "skip", "stop", "leave", "volume") and not p:
                result = "no_player"
            elif action == "pause":
                await p.pause(True)
            elif action == "resume":
                await p.pause(False)
            elif action == "skip":
                await p.skip(force=True)
            elif action == "stop":
                p.queue.clear()
                await p.stop()
            elif action == "leave":
                await p.disconnect()
            elif action == "volume":
                await p.set_volume(max(0, min(100, int(value))))
            else:
                result = "unknown_action"
        except Exception as e:
            result = f"error: {e}"[:120]
        try:
            await bot_db.complete_command(c["id"], result)
        except Exception:
            pass


async def _rest_position(session_id: str, guild_id: int):
    import aiohttp
    url = f"{LAVALINK_URL}/v4/sessions/{session_id}/players/{guild_id}"
    async with aiohttp.ClientSession() as s:
        async with s.get(url, headers={"Authorization": LAVALINK_PASSWORD}) as r:
            d = await r.json(content_type=None)
            if not isinstance(d, dict):
                return 0, {}
            state = d.get("state") or {}
            track = d.get("track") or {}
            return state.get("position", 0), track.get("info") or {}


async def run_import_test():
    await bot.wait_until_ready()
    flag = Path("/tmp/pupu_import_test.flag")
    if not flag.exists():
        return
    flag.unlink(missing_ok=True)
    if not pg_check():
        logger.info("IMPORTTEST: pg not connected")
        return
    owner = ("user", 123456789012345)
    try:
        await playlist_db.delete_playlist(pg, owner, "sp", 123456789012345)
        await playlist_db.delete_playlist(pg, owner, "yt", 123456789012345)
        # Spotify import
        sp_url = "https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M"
        name, tracks = await resolve_import(sp_url)
        logger.info("IMPORTTEST: spotify '%s' resolved=%d (sample=%s)",
                    name, len(tracks), tracks[0]["title"] if tracks else None)
        await playlist_db.create_playlist(pg, owner, "sp", 123456789012345)
        added = await playlist_db.add_tracks(pg, owner, "sp", tracks)
        logger.info("IMPORTTEST: SPOTIFY %s (added=%d)", "OK" if added > 5 else "FAILED", added)
        # YouTube playlist import
        yt_url = "https://www.youtube.com/playlist?list=PLBCF2DAC6FFB574DE"
        yname, ytracks = await resolve_import(yt_url)
        logger.info("IMPORTTEST: youtube '%s' resolved=%d", yname, len(ytracks))
        await playlist_db.create_playlist(pg, owner, "yt", 123456789012345)
        yadded = await playlist_db.add_tracks(pg, owner, "yt", ytracks)
        logger.info("IMPORTTEST: YOUTUBE %s (added=%d)", "OK" if yadded > 3 else "FAILED", yadded)
        # cleanup
        await playlist_db.delete_playlist(pg, owner, "sp", 123456789012345)
        await playlist_db.delete_playlist(pg, owner, "yt", 123456789012345)
        logger.info("IMPORTTEST: done")
    except Exception as e:
        logger.error("IMPORTTEST error: %s", e)


async def run_diagnostic():
    await bot.wait_until_ready()
    flag = Path("/tmp/pupu_diag.flag")
    if not flag.exists():
        return
    flag.unlink(missing_ok=True)
    logger.info("DIAG: starting playback diagnostic")
    for guild in bot.guilds:
        for ch in guild.voice_channels:
            if any(not m.bot for m in ch.members):
                continue
            perms = ch.permissions_for(guild.me)
            if not (perms.connect and perms.speak):
                continue
            try:
                player = await ch.connect(cls=wavelink.Player, self_deaf=True)
            except Exception as e:
                logger.info("DIAG: connect failed in %s/%s: %s", guild.name, ch.name, e)
                continue
            player.inactive_timeout = 9999
            player.inactive_channel_tokens = None  # diag runs in an empty channel
            await asyncio.sleep(2)
            sid = wavelink.Pool.get_node().session_id

            async def probe(ident, label, timeout=20):
                tracks = await search_tracks(ident)
                if not tracks:
                    logger.info("DIAG: %s search returned nothing", label)
                    return
                mark_playing(player, tracks[0])
                await player.play(tracks[0], volume=20)
                for _ in range(timeout // 2):
                    await asyncio.sleep(2)
                    pos, info = await _rest_position(sid, guild.id)
                    if pos > 3000:
                        logger.info("DIAG: %s OK (pos=%dms now=%s via=%s)",
                                    label, pos, info.get("title"), info.get("sourceName"))
                        return
                pos, info = await _rest_position(sid, guild.id)
                logger.info("DIAG: %s FAILED (pos=%dms tried=%s)",
                            label, pos, tracks[0].title)

            try:
                await probe("https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3", "HTTP-DIRECT")
                await probe("scsearch:lofi beats", "SOUNDCLOUD")
                custom = os.environ.get("PUPU_DIAG_QUERY")
                cq = Path("/tmp/pupu_diag_query.txt")
                if not custom and cq.exists():
                    custom = cq.read_text().strip()
                    cq.unlink(missing_ok=True)
                if custom:
                    await probe(custom, "CUSTOM", 40)
                # YouTube attempt: expect TrackException -> SoundCloud fallback handler fires
                await probe("ytsearch:never gonna give you up rick astley", "YOUTUBE+FB", 30)
            except Exception as e:
                logger.info("DIAG: error: %s", e)
            try:
                await player.disconnect()
            except Exception:
                pass
            logger.info("DIAG: done")
            return
    logger.info("DIAG: no usable empty voice channel found")


async def main():
    asyncio.create_task(run_diagnostic())
    asyncio.create_task(run_import_test())
    async with bot:
        await bot.start(TOKEN)


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        pass
