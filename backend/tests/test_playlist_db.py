"""Backend tests: Supabase Postgres playlist DB layer + bot status.

Tests /app/backend/playlist_db.py against real Supabase pooler DSN.
Uses throwaway user_id and cleans up rows afterwards.
"""
import os
import sys
import asyncio
import pytest
import requests
import asyncpg
import pytest_asyncio
from dotenv import load_dotenv

sys.path.insert(0, "/app/backend")
load_dotenv("/app/backend/.env")

import playlist_db  # noqa: E402

DSN = os.environ.get("SUPABASE_DB_URL")
BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://pupu-audio-bot.preview.emergentagent.com").rstrip("/")
TEST_USER = 999999999998


# ---------------- Fixtures ----------------

@pytest.fixture(scope="module")
def event_loop():
    loop = asyncio.new_event_loop()
    yield loop
    loop.close()


@pytest_asyncio.fixture
async def pool():
    p = await asyncpg.create_pool(DSN, statement_cache_size=0, min_size=1, max_size=3)
    await playlist_db.ensure_schema(p)
    yield p
    # cleanup any stray test rows
    async with p.acquire() as con:
        await con.execute("DELETE FROM playlists WHERE user_id=$1", TEST_USER)
    await p.close()


# ---------------- Bot / API wiring ----------------

def test_bot_status_endpoint():
    r = requests.get(f"{BASE_URL}/api/bot/status", timeout=15)
    assert r.status_code == 200, r.text
    data = r.json()
    assert data.get("online") is True, data


# ---------------- Schema check ----------------

@pytest.mark.asyncio
async def test_schema_tables_exist(pool):
    async with pool.acquire() as con:
        tbls = await con.fetch(
            "SELECT tablename FROM pg_tables WHERE schemaname='public' "
            "AND tablename IN ('playlists','playlist_tracks')")
        names = {r["tablename"] for r in tbls}
        assert "playlists" in names
        assert "playlist_tracks" in names

        # unique(user_id,name) on playlists
        pl_uniques = await con.fetch("""
            SELECT conname FROM pg_constraint
            WHERE conrelid = 'public.playlists'::regclass AND contype='u'
        """)
        assert len(pl_uniques) >= 1

        # FK cascade + unique(playlist_id,position) on playlist_tracks
        pt_cons = await con.fetch("""
            SELECT conname, contype, confdeltype FROM pg_constraint
            WHERE conrelid = 'public.playlist_tracks'::regclass
        """)
        has_cascade = any(c["contype"] in ("f", b"f") and c["confdeltype"] in ("c", b"c") for c in pt_cons)
        has_unique = any(c["contype"] in ("u", b"u") for c in pt_cons)
        assert has_cascade, f"missing FK cascade: {pt_cons}"
        assert has_unique, f"missing unique(playlist_id,position): {pt_cons}"


# ---------------- CRUD ----------------

@pytest.mark.asyncio
async def test_full_crud_flow(pool):
    # start clean
    async with pool.acquire() as con:
        await con.execute("DELETE FROM playlists WHERE user_id=$1", TEST_USER)

    # create
    assert await playlist_db.create_playlist(pool, TEST_USER, "mytest") == "ok"
    # duplicate -> exists
    assert await playlist_db.create_playlist(pool, TEST_USER, "mytest") == "exists"

    # add_track
    t1 = {"title": "Song A", "author": "Artist A", "uri": "http://a", "length": 1000, "artwork": None}
    t2 = {"title": "Song B", "author": "Artist B", "uri": "http://b", "length": 2000, "artwork": None}
    t3 = {"title": "Song C", "author": "Artist C", "uri": "http://c", "length": 3000, "artwork": None}
    assert await playlist_db.add_track(pool, TEST_USER, "mytest", t1) == "ok"
    assert await playlist_db.add_track(pool, TEST_USER, "mytest", t2) == "ok"
    assert await playlist_db.add_track(pool, TEST_USER, "mytest", t3) == "ok"

    # add to missing playlist
    assert await playlist_db.add_track(pool, TEST_USER, "nope", t1) == "missing"

    # get_tracks ordering
    tracks = await playlist_db.get_tracks(pool, TEST_USER, "mytest")
    titles = [r["title"] for r in tracks]
    assert titles == ["Song A", "Song B", "Song C"], titles

    # remove middle track, positions reindex
    removed = await playlist_db.remove_track(pool, TEST_USER, "mytest", 2)
    assert removed == "Song B"
    tracks = await playlist_db.get_tracks(pool, TEST_USER, "mytest")
    titles = [r["title"] for r in tracks]
    assert titles == ["Song A", "Song C"], titles
    # confirm sequential positions
    async with pool.acquire() as con:
        pid = await playlist_db.get_playlist_id(con, TEST_USER, "mytest")
        rows = await con.fetch(
            "SELECT position, title FROM playlist_tracks WHERE playlist_id=$1 ORDER BY position", pid)
        positions = [r["position"] for r in rows]
        assert positions == [1, 2], positions

    # bad index
    assert await playlist_db.remove_track(pool, TEST_USER, "mytest", 999) == "badindex"
    # remove from missing playlist
    assert await playlist_db.remove_track(pool, TEST_USER, "unknown", 1) == "missing"

    # save_tracks overwrite
    new_tracks = [
        {"title": "X", "author": "ax", "uri": "http://x", "length": 100, "artwork": None},
        {"title": "Y", "author": "ay", "uri": "http://y", "length": 200, "artwork": None},
    ]
    assert await playlist_db.save_tracks(pool, TEST_USER, "mytest", new_tracks) == "ok"
    tracks = await playlist_db.get_tracks(pool, TEST_USER, "mytest")
    assert [r["title"] for r in tracks] == ["X", "Y"]
    # empty save
    assert await playlist_db.save_tracks(pool, TEST_USER, "mytest", []) == "empty"
    # missing playlist save
    assert await playlist_db.save_tracks(pool, TEST_USER, "no-such", new_tracks) == "missing"

    # list_playlists shows count
    await playlist_db.create_playlist(pool, TEST_USER, "second")
    listed = await playlist_db.list_playlists(pool, TEST_USER)
    by_name = {r["name"]: r["tracks"] for r in listed}
    assert by_name.get("mytest") == 2
    assert by_name.get("second") == 0

    # delete_playlist and cascade
    async with pool.acquire() as con:
        pid = await playlist_db.get_playlist_id(con, TEST_USER, "mytest")
    assert await playlist_db.delete_playlist(pool, TEST_USER, "mytest") is True
    # tracks gone (cascade)
    async with pool.acquire() as con:
        remaining = await con.fetchval(
            "SELECT count(*) FROM playlist_tracks WHERE playlist_id=$1", pid)
        assert remaining == 0
    # delete non-existent
    assert await playlist_db.delete_playlist(pool, TEST_USER, "mytest") is False

    # final cleanup
    async with pool.acquire() as con:
        await con.execute("DELETE FROM playlists WHERE user_id=$1", TEST_USER)


@pytest.mark.asyncio
async def test_get_tracks_missing_returns_none(pool):
    assert await playlist_db.get_tracks(pool, TEST_USER, "does-not-exist") is None
