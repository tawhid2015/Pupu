"""Playlist storage for Pupu, backed by Supabase Postgres (asyncpg)."""

MAX_PLAYLISTS_PER_USER = 25
MAX_TRACKS_PER_PLAYLIST = 100
MAX_NAME_LEN = 32

SCHEMA = """
CREATE TABLE IF NOT EXISTS playlists (
    id BIGSERIAL PRIMARY KEY,
    user_id BIGINT NOT NULL,
    name TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE(user_id, name)
);
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


async def create_playlist(pool, user_id: int, name: str) -> str:
    """Returns 'ok', 'exists', or 'limit'."""
    name = clean_name(name)
    async with pool.acquire() as con:
        count = await con.fetchval("SELECT count(*) FROM playlists WHERE user_id=$1", user_id)
        if count >= MAX_PLAYLISTS_PER_USER:
            return "limit"
        row = await con.fetchrow(
            "INSERT INTO playlists (user_id, name) VALUES ($1, $2) "
            "ON CONFLICT (user_id, name) DO NOTHING RETURNING id",
            user_id, name)
        return "ok" if row else "exists"


async def list_playlists(pool, user_id: int):
    async with pool.acquire() as con:
        return await con.fetch(
            "SELECT p.name, p.created_at, count(t.id) AS tracks "
            "FROM playlists p LEFT JOIN playlist_tracks t ON t.playlist_id = p.id "
            "WHERE p.user_id=$1 GROUP BY p.id ORDER BY p.created_at", user_id)


async def get_playlist_id(con, user_id: int, name: str):
    return await con.fetchval(
        "SELECT id FROM playlists WHERE user_id=$1 AND name=$2", user_id, clean_name(name))


async def delete_playlist(pool, user_id: int, name: str) -> bool:
    async with pool.acquire() as con:
        res = await con.execute(
            "DELETE FROM playlists WHERE user_id=$1 AND name=$2", user_id, clean_name(name))
        return res == "DELETE 1"


async def get_tracks(pool, user_id: int, name: str):
    async with pool.acquire() as con:
        pid = await get_playlist_id(con, user_id, name)
        if not pid:
            return None
        return await con.fetch(
            "SELECT title, author, uri, length_ms, artwork FROM playlist_tracks "
            "WHERE playlist_id=$1 ORDER BY position", pid)


async def add_track(pool, user_id: int, name: str, track: dict) -> str:
    """Returns 'ok', 'missing', or 'full'."""
    async with pool.acquire() as con:
        pid = await get_playlist_id(con, user_id, name)
        if not pid:
            return "missing"
        count = await con.fetchval(
            "SELECT count(*) FROM playlist_tracks WHERE playlist_id=$1", pid)
        if count >= MAX_TRACKS_PER_PLAYLIST:
            return "full"
        await con.execute(
            "INSERT INTO playlist_tracks (playlist_id, position, title, author, uri, length_ms, artwork) "
            "VALUES ($1, $2, $3, $4, $5, $6, $7)",
            pid, count + 1, track.get("title", "Unknown"), track.get("author"),
            track.get("uri"), track.get("length"), track.get("artwork"))
        return "ok"


async def save_tracks(pool, user_id: int, name: str, tracks: list[dict]) -> str:
    """Overwrite playlist contents. Returns 'ok', 'missing', or 'empty'."""
    if not tracks:
        return "empty"
    tracks = tracks[:MAX_TRACKS_PER_PLAYLIST]
    async with pool.acquire() as con:
        pid = await get_playlist_id(con, user_id, name)
        if not pid:
            return "missing"
        async with con.transaction():
            await con.execute("DELETE FROM playlist_tracks WHERE playlist_id=$1", pid)
            await con.executemany(
                "INSERT INTO playlist_tracks (playlist_id, position, title, author, uri, length_ms, artwork) "
                "VALUES ($1, $2, $3, $4, $5, $6, $7)",
                [(pid, i, t.get("title", "Unknown"), t.get("author"), t.get("uri"),
                  t.get("length"), t.get("artwork")) for i, t in enumerate(tracks, 1)])
        return "ok"


async def remove_track(pool, user_id: int, name: str, position: int):
    """Returns removed track title, 'missing', or 'badindex'."""
    async with pool.acquire() as con:
        pid = await get_playlist_id(con, user_id, name)
        if not pid:
            return "missing"
        async with con.transaction():
            row = await con.fetchrow(
                "DELETE FROM playlist_tracks WHERE playlist_id=$1 AND position=$2 RETURNING title",
                pid, position)
            if not row:
                return "badindex"
            await con.execute(
                "UPDATE playlist_tracks SET position = position - 1 "
                "WHERE playlist_id=$1 AND position>$2", pid, position)
        return row["title"]
