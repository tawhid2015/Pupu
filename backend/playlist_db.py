"""Playlist storage for Pupu, backed by Supabase Postgres (asyncpg).

Supports two scopes:
- personal: owned by a user  -> owner = ("user", user_id)
- shared:   owned by a guild -> owner = ("guild", guild_id), collaborative
"""

MAX_PLAYLISTS = 25
MAX_TRACKS_PER_PLAYLIST = 100
MAX_NAME_LEN = 32

SCHEMA = """
CREATE TABLE IF NOT EXISTS playlists (
    id BIGSERIAL PRIMARY KEY,
    user_id BIGINT NOT NULL,
    name TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE playlists ADD COLUMN IF NOT EXISTS guild_id BIGINT;
ALTER TABLE playlists ADD COLUMN IF NOT EXISTS shared BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE playlists DROP CONSTRAINT IF EXISTS playlists_user_id_name_key;
CREATE UNIQUE INDEX IF NOT EXISTS playlists_personal_uq
    ON playlists (user_id, name) WHERE shared = false;
CREATE UNIQUE INDEX IF NOT EXISTS playlists_shared_uq
    ON playlists (guild_id, name) WHERE shared = true;
CREATE TABLE IF NOT EXISTS playlist_tracks (
    id BIGSERIAL PRIMARY KEY,
    playlist_id BIGINT NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
    position INT NOT NULL,
    title TEXT NOT NULL,
    author TEXT,
    uri TEXT,
    length_ms BIGINT,
    artwork TEXT,
    UNIQUE(playlist_id, position)
);
"""


async def ensure_schema(pool):
    async with pool.acquire() as con:
        await con.execute(SCHEMA)


def clean_name(name: str) -> str:
    return name.strip()[:MAX_NAME_LEN]


def _scope(owner):
    """Return (where_sql, value, is_shared)."""
    kind, val = owner
    if kind == "guild":
        return "guild_id=$1 AND shared=true", val, True
    return "user_id=$1 AND shared=false", val, False


async def create_playlist(pool, owner, name: str, creator_id: int) -> str:
    """Returns 'ok', 'exists', or 'limit'."""
    name = clean_name(name)
    where, val, shared = _scope(owner)
    async with pool.acquire() as con:
        count = await con.fetchval(f"SELECT count(*) FROM playlists WHERE {where}", val)
        if count >= MAX_PLAYLISTS:
            return "limit"
        if shared:
            row = await con.fetchrow(
                "INSERT INTO playlists (user_id, guild_id, name, shared) "
                "VALUES ($1, $2, $3, true) "
                "ON CONFLICT (guild_id, name) WHERE shared = true DO NOTHING RETURNING id",
                creator_id, val, name)
        else:
            row = await con.fetchrow(
                "INSERT INTO playlists (user_id, name, shared) VALUES ($1, $2, false) "
                "ON CONFLICT (user_id, name) WHERE shared = false DO NOTHING RETURNING id",
                val, name)
        return "ok" if row else "exists"


async def list_playlists(pool, owner):
    where, val, _ = _scope(owner)
    async with pool.acquire() as con:
        return await con.fetch(
            f"SELECT p.name, p.created_at, p.user_id AS creator, count(t.id) AS tracks "
            f"FROM playlists p LEFT JOIN playlist_tracks t ON t.playlist_id = p.id "
            f"WHERE {where} GROUP BY p.id ORDER BY p.created_at", val)


async def _get_row(con, owner, name):
    where, val, _ = _scope(owner)
    return await con.fetchrow(
        f"SELECT id, user_id AS creator FROM playlists WHERE {where} AND name=$2",
        val, clean_name(name))


async def delete_playlist(pool, owner, name: str, requester_id: int) -> str:
    """Returns 'ok', 'missing', or 'forbidden' (shared: only creator may delete)."""
    async with pool.acquire() as con:
        row = await _get_row(con, owner, name)
        if not row:
            return "missing"
        _, _, shared = _scope(owner)
        if shared and row["creator"] != requester_id:
            return "forbidden"
        await con.execute("DELETE FROM playlists WHERE id=$1", row["id"])
        return "ok"


async def get_tracks(pool, owner, name: str):
    async with pool.acquire() as con:
        row = await _get_row(con, owner, name)
        if not row:
            return None
        return await con.fetch(
            "SELECT title, author, uri, length_ms, artwork FROM playlist_tracks "
            "WHERE playlist_id=$1 ORDER BY position", row["id"])


async def add_track(pool, owner, name: str, track: dict) -> str:
    """Returns 'ok', 'missing', or 'full'."""
    async with pool.acquire() as con:
        row = await _get_row(con, owner, name)
        if not row:
            return "missing"
        count = await con.fetchval(
            "SELECT count(*) FROM playlist_tracks WHERE playlist_id=$1", row["id"])
        if count >= MAX_TRACKS_PER_PLAYLIST:
            return "full"
        await con.execute(
            "INSERT INTO playlist_tracks (playlist_id, position, title, author, uri, length_ms, artwork) "
            "VALUES ($1, $2, $3, $4, $5, $6, $7)",
            row["id"], count + 1, track.get("title", "Unknown"), track.get("author"),
            track.get("uri"), track.get("length"), track.get("artwork"))
        return "ok"


async def add_tracks(pool, owner, name: str, tracks: list[dict]) -> int:
    """Append many tracks (respecting the cap). Returns number added."""
    if not tracks:
        return 0
    async with pool.acquire() as con:
        row = await _get_row(con, owner, name)
        if not row:
            return -1
        count = await con.fetchval(
            "SELECT count(*) FROM playlist_tracks WHERE playlist_id=$1", row["id"])
        room = MAX_TRACKS_PER_PLAYLIST - count
        if room <= 0:
            return 0
        batch = tracks[:room]
        await con.executemany(
            "INSERT INTO playlist_tracks (playlist_id, position, title, author, uri, length_ms, artwork) "
            "VALUES ($1, $2, $3, $4, $5, $6, $7)",
            [(row["id"], count + i, t.get("title", "Unknown"), t.get("author"), t.get("uri"),
              t.get("length"), t.get("artwork")) for i, t in enumerate(batch, 1)])
        return len(batch)


async def save_tracks(pool, owner, name: str, tracks: list[dict]) -> str:
    """Overwrite playlist contents. Returns 'ok', 'missing', or 'empty'."""
    if not tracks:
        return "empty"
    tracks = tracks[:MAX_TRACKS_PER_PLAYLIST]
    async with pool.acquire() as con:
        row = await _get_row(con, owner, name)
        if not row:
            return "missing"
        async with con.transaction():
            await con.execute("DELETE FROM playlist_tracks WHERE playlist_id=$1", row["id"])
            await con.executemany(
                "INSERT INTO playlist_tracks (playlist_id, position, title, author, uri, length_ms, artwork) "
                "VALUES ($1, $2, $3, $4, $5, $6, $7)",
                [(row["id"], i, t.get("title", "Unknown"), t.get("author"), t.get("uri"),
                  t.get("length"), t.get("artwork")) for i, t in enumerate(tracks, 1)])
        return "ok"


async def remove_track(pool, owner, name: str, position: int):
    """Returns removed track title, 'missing', or 'badindex'."""
    async with pool.acquire() as con:
        row = await _get_row(con, owner, name)
        if not row:
            return "missing"
        async with con.transaction():
            trow = await con.fetchrow(
                "DELETE FROM playlist_tracks WHERE playlist_id=$1 AND position=$2 RETURNING title",
                row["id"], position)
            if not trow:
                return "badindex"
            await con.execute(
                "UPDATE playlist_tracks SET position = position - 1 "
                "WHERE playlist_id=$1 AND position>$2", row["id"], position)
        return trow["title"]
