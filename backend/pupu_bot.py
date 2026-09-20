"""Pupu — Discord music bot (discord.py + Wavelink v3, Lavalink v4)."""
import os
import asyncio
import logging
from datetime import datetime, timezone
from pathlib import Path

import discord
from discord.ext import commands, tasks
import wavelink
import asyncpg
from dotenv import load_dotenv
from motor.motor_asyncio import AsyncIOMotorClient

import playlist_db

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / ".env")

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
logger = logging.getLogger("pupu")

TOKEN = os.environ["DISCORD_BOT_TOKEN"]
LAVALINK_URL = os.environ["LAVALINK_URL"]
LAVALINK_PASSWORD = os.environ["LAVALINK_PASSWORD"]
PREFIX = "."
INACTIVE_TIMEOUT = 180  # seconds

EMBED_COLOR = 0xB388FF
mongo = AsyncIOMotorClient(os.environ["MONGO_URL"])
db = mongo[os.environ["DB_NAME"]]
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

    async def on_wavelink_node_ready(self, payload: wavelink.NodeReadyEventPayload):
        logger.info("Lavalink node ready: %s", payload.node.uri)

    async def on_wavelink_track_start(self, payload: wavelink.TrackStartEventPayload):
        player: wavelink.Player = payload.player
        if not player:
            return
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
        player: wavelink.Player = payload.player
        track = payload.track
        exc = payload.exception or {}
        msg = exc.get("message", "unknown error")
        logger.error("TrackException on %s (%s): %s", track.title, track.source, msg)
        if not player:
            return
        chan = getattr(player, "home", None)

        # One-shot SoundCloud fallback when a YouTube track can't stream
        failed = getattr(player, "_fallback_failed", set())
        if track.source == "youtube" and track.identifier not in failed:
            failed.add(track.identifier)
            player._fallback_failed = failed
            try:
                results = await wavelink.Playable.search(
                    f"{track.title} {track.author}",
                    source=wavelink.TrackSource.SoundCloud,
                )
            except Exception as e:
                results = None
                logger.error("fallback search failed: %s", e)
            if results:
                alt = results[0]
                logger.info("DIAG/fallback: %s -> %s", track.title, alt.title)
                if chan:
                    try:
                        await chan.send(embed=emb(
                            f"**{track.title}** couldn't stream from YouTube. "
                            f"Playing the SoundCloud version instead: **{alt.title}** 🔁"))
                    except Exception:
                        pass
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


# ---------- helpers ----------
async def ensure_player(ctx) -> wavelink.Player | None:
    if ctx.guild is None:
        await ctx.reply(embed=emb("Commands only work inside a server."))
        return None
    player: wavelink.Player = ctx.voice_client
    if player:
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
        await player.play(player.queue.get(), volume=60)


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
    e.add_field(name="💾 Playlists",
                value=("`playlist create <name>` · `playlist save <name>`\n"
                       "`playlist add <name> <song>` · `playlist load <name>`\n"
                       "`playlist view <name>` · `playlist remove <name> <#>`\n"
                       "`playlist delete <name>` · `playlist list`"), inline=False)
    e.set_footer(text="Pupu • powered by Lavalink v4")
    await ctx.reply(embed=e)


# ---------- playlists (Supabase Postgres) ----------
def pg_check() -> bool:
    return pg is not None


async def name_invalid(ctx, name: str) -> bool:
    if not playlist_db.clean_name(name):
        await ctx.reply(embed=emb("Please provide a valid playlist name."))
        return True
    return False


@bot.hybrid_group(name="playlist", aliases=["pl"], fallback="list",
                  description="Manage your saved playlists")
async def playlist_group(ctx: commands.Context):
    if not pg_check():
        return await ctx.reply(embed=emb("Playlist storage is unavailable right now. ⚠️"))
    rows = await playlist_db.list_playlists(pg, ctx.author.id)
    if not rows:
        return await ctx.reply(embed=emb(
            f"You have no playlists yet. Create one with `{PREFIX}playlist create <name>`.",
            "💾 Your Playlists"))
    lines = [f"`{i}.` **{r['name']}** — {r['tracks']} track{'s' if r['tracks'] != 1 else ''}"
             for i, r in enumerate(rows, 1)]
    await ctx.reply(embed=emb("\n".join(lines), "💾 Your Playlists"))


@playlist_group.command(name="create", description="Create a new playlist")
@discord.app_commands.describe(name="Playlist name")
async def pl_create(ctx: commands.Context, name: str):
    if not pg_check():
        return await ctx.reply(embed=emb("Playlist storage is unavailable right now. ⚠️"))
    if await name_invalid(ctx, name):
        return
    res = await playlist_db.create_playlist(pg, ctx.author.id, name)
    if res == "ok":
        await ctx.reply(embed=emb(f"Playlist **{playlist_db.clean_name(name)}** created. ✅\n"
                                  f"Add songs with `{PREFIX}pl add {playlist_db.clean_name(name)} <song>`."))
    elif res == "exists":
        await ctx.reply(embed=emb("You already have a playlist with that name."))
    else:
        await ctx.reply(embed=emb(f"Limit reached ({playlist_db.MAX_PLAYLISTS_PER_USER} playlists)."))


@playlist_group.command(name="save", description="Save the current queue into a playlist")
@discord.app_commands.describe(name="Playlist name (created if missing)")
async def pl_save(ctx: commands.Context, name: str):
    if not pg_check():
        return await ctx.reply(embed=emb("Playlist storage is unavailable right now. ⚠️"))
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
    await playlist_db.create_playlist(pg, ctx.author.id, name)
    res = await playlist_db.save_tracks(pg, ctx.author.id, name, tracks)
    if res == "ok":
        await ctx.reply(embed=emb(
            f"Saved **{len(tracks)}** tracks to **{playlist_db.clean_name(name)}**. 💾"))
    else:
        await ctx.reply(embed=emb("Couldn't save the playlist."))


@playlist_group.command(name="add", description="Add a song to a playlist")
@discord.app_commands.describe(name="Playlist name", query="Song name or URL")
async def pl_add(ctx: commands.Context, name: str, *, query: str):
    if not pg_check():
        return await ctx.reply(embed=emb("Playlist storage is unavailable right now. ⚠️"))
    await ctx.defer()
    try:
        results = await search_tracks(query)
    except Exception:
        return await ctx.reply(embed=emb("Search failed. Try again."))
    if not results:
        return await ctx.reply(embed=emb(f"No results for **{query}**."))
    track = results.tracks[0] if isinstance(results, wavelink.Playlist) else results[0]
    res = await playlist_db.add_track(pg, ctx.author.id, name, track_dict(track))
    if res == "ok":
        await ctx.reply(embed=emb(
            f"**[{track.title}]({track.uri})** added to **{playlist_db.clean_name(name)}**. ➕"))
    elif res == "missing":
        await ctx.reply(embed=emb(
            f"Playlist **{playlist_db.clean_name(name)}** not found. "
            f"Create it with `{PREFIX}pl create {playlist_db.clean_name(name)}`."))
    else:
        await ctx.reply(embed=emb(
            f"Playlist is full ({playlist_db.MAX_TRACKS_PER_PLAYLIST} tracks)."))


@playlist_group.command(name="load", description="Queue a saved playlist")
@discord.app_commands.describe(name="Playlist name")
async def pl_load(ctx: commands.Context, name: str):
    if not pg_check():
        return await ctx.reply(embed=emb("Playlist storage is unavailable right now. ⚠️"))
    await ctx.defer()
    rows = await playlist_db.get_tracks(pg, ctx.author.id, name)
    if rows is None:
        return await ctx.reply(embed=emb(f"Playlist **{playlist_db.clean_name(name)}** not found."))
    if not rows:
        return await ctx.reply(embed=emb(f"Playlist **{playlist_db.clean_name(name)}** is empty."))
    player = await ensure_player(ctx)
    if not player:
        return
    player.home = ctx.channel
    added = 0
    for r in rows:
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
        await ctx.reply(embed=emb(
            f"Loaded **{added}** track{'s' if added != 1 else ''} from "
            f"**{playlist_db.clean_name(name)}** into the queue. 🎶"))
    else:
        await ctx.reply(embed=emb("Couldn't load any tracks from that playlist. ⚠️"))


@playlist_group.command(name="view", description="Show tracks in a playlist")
@discord.app_commands.describe(name="Playlist name")
async def pl_view(ctx: commands.Context, name: str):
    if not pg_check():
        return await ctx.reply(embed=emb("Playlist storage is unavailable right now. ⚠️"))
    rows = await playlist_db.get_tracks(pg, ctx.author.id, name)
    if rows is None:
        return await ctx.reply(embed=emb(f"Playlist **{playlist_db.clean_name(name)}** not found."))
    if not rows:
        return await ctx.reply(embed=emb(f"Playlist **{playlist_db.clean_name(name)}** is empty."))
    lines = [f"`{i}.` [{r['title']}]({r['uri']}) — {fmt_time(r['length_ms'] or 0)}"
             if r["uri"] else f"`{i}.` {r['title']} — {fmt_time(r['length_ms'] or 0)}"
             for i, r in enumerate(rows[:15], 1)]
    extra = len(rows) - 15
    if extra > 0:
        lines.append(f"...and **{extra}** more")
    await ctx.reply(embed=emb("\n".join(lines),
                              f"💾 {playlist_db.clean_name(name)} ({len(rows)} tracks)"))


@playlist_group.command(name="remove", description="Remove track # from a playlist")
@discord.app_commands.describe(name="Playlist name", index="Track number (see playlist view)")
async def pl_remove(ctx: commands.Context, name: str, index: int):
    if not pg_check():
        return await ctx.reply(embed=emb("Playlist storage is unavailable right now. ⚠️"))
    res = await playlist_db.remove_track(pg, ctx.author.id, name, index)
    if res == "missing":
        await ctx.reply(embed=emb(f"Playlist **{playlist_db.clean_name(name)}** not found."))
    elif res == "badindex":
        await ctx.reply(embed=emb("Invalid track number."))
    else:
        await ctx.reply(embed=emb(f"Removed **{res}**. 🗑️"))


@playlist_group.command(name="delete", description="Delete a playlist")
@discord.app_commands.describe(name="Playlist name")
async def pl_delete(ctx: commands.Context, name: str):
    if not pg_check():
        return await ctx.reply(embed=emb("Playlist storage is unavailable right now. ⚠️"))
    if await playlist_db.delete_playlist(pg, ctx.author.id, name):
        await ctx.reply(embed=emb(f"Playlist **{playlist_db.clean_name(name)}** deleted. 🗑️"))
    else:
        await ctx.reply(embed=emb(f"Playlist **{playlist_db.clean_name(name)}** not found."))


@play.error
@volume.error
@remove.error
@seek.error
async def arg_error(ctx, error):
    if isinstance(error, (commands.MissingRequiredArgument, commands.BadArgument)):
        await ctx.reply(embed=emb("Missing or invalid argument. Check `.help`."))


# ---------- status writer for the web page ----------
@tasks.loop(seconds=10)
async def push_status():
    players = []
    for vc in bot.voice_clients:
        if isinstance(vc, wavelink.Player) and vc.current:
            players.append({
                "guild": vc.guild.name if vc.guild else "?",
                "title": vc.current.title,
                "author": vc.current.author,
                "uri": vc.current.uri,
                "artwork": vc.current.artwork,
                "paused": vc.paused,
                "position": vc.position,
                "length": vc.current.length,
            })
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
        "players": players,
        "latency_ms": round(bot.latency * 1000) if bot.latency else None,
        "session_id": session_id,
        "test_guild_id": str(bot.guilds[0].id) if bot.guilds else None,
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }
    try:
        await db.bot_status.replace_one({"_id": "pupu"}, doc, upsert=True)
    except Exception as e:
        logger.error("status write failed: %s", e)


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
            await asyncio.sleep(2)
            sid = wavelink.Pool.get_node().session_id

            async def probe(ident, label, timeout=20):
                tracks = await search_tracks(ident)
                if not tracks:
                    logger.info("DIAG: %s search returned nothing", label)
                    return
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
    async with bot:
        await bot.start(TOKEN)


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        pass
