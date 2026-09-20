"""Backend tests: Supabase Postgres playlist DB layer (v2: scoped owner tuples).

Covers:
- Personal (owner=('user',id)) vs shared (owner=('guild',id)) isolation
- Per-scope dedupe -> 'exists'
- add_tracks appends respecting 100 cap
- list_playlists returns creator
- delete_playlist: 'ok', 'missing', 'forbidden' (shared non-creator)
- Bot status endpoint online=true
"""
import os
import sys
import asyncio
import pytest
import pytest_asyncio
import requests
import asyncpg
from dotenv import load_dotenv

sys.path.insert(0, "/app/backend")
load_dotenv("/app/backend/.env")

import playlist_db  # noqa: E402

DSN = os.environ.get("SUPABASE_DB_URL")
BASE_URL = os.environ.get(
    "REACT_APP_BACKEND_URL", "https://pupu-audio-bot.preview.emergentagent.com"
).rstrip("/")

# throwaway ids
TEST_USER_A = 999999999901
TEST_USER_B = 999999999902
TEST_GUILD = 999999999999

TEST_NAME = "TEST_pl_scope"


@pytest.fixture(scope="module")
def event_loop():
    loop = asyncio.new_event_loop()
    yield loop
    loop.close()


@pytest_asyncio.fixture
async def pool():
    p = await asyncpg.create_pool(DSN, statement_cache_size=0, min_size=1, max_size=3)
    await playlist_db.ensure_schema(p)
    # pre-clean
    async with p.acquire() as con:
        await con.execute(
            "DELETE FROM playlists WHERE user_id = ANY($1::bigint[]) OR guild_id=$2",
            [TEST_USER_A, TEST_USER_B], TEST_GUILD)
    yield p
    async with p.acquire() as con:
        await con.execute(
            "DELETE FROM playlists WHERE user_id = ANY($1::bigint[]) OR guild_id=$2",
            [TEST_USER_A, TEST_USER_B], TEST_GUILD)
    await p.close()


# ---------- Bot / API wiring ----------

def test_bot_status_endpoint():
    r = requests.get(f"{BASE_URL}/api/bot/status", timeout=15)
    assert r.status_code == 200, r.text
    data = r.json()
    assert data.get("online") is True, data


# ---------- Scope isolation ----------

@pytest.mark.asyncio
async def test_personal_and_shared_isolated_same_name(pool):
    personal = ("user", TEST_USER_A)
    shared = ("guild", TEST_GUILD)

    # Same name allowed in each scope
    assert await playlist_db.create_playlist(pool, personal, TEST_NAME, TEST_USER_A) == "ok"
    assert await playlist_db.create_playlist(pool, shared, TEST_NAME, TEST_USER_A) == "ok"

    # Duplicates dedupe per scope
    assert await playlist_db.create_playlist(pool, personal, TEST_NAME, TEST_USER_A) == "exists"
    assert await playlist_db.create_playlist(pool, shared, TEST_NAME, TEST_USER_B) == "exists"

    # Each list shows only its own scope
    p_list = await playlist_db.list_playlists(pool, personal)
    s_list = await playlist_db.list_playlists(pool, shared)
    p_names = [r["name"] for r in p_list]
    s_names = [r["name"] for r in s_list]
    assert TEST_NAME in p_names
    assert TEST_NAME in s_names
    # user B has none personally
    assert not await playlist_db.list_playlists(pool, ("user", TEST_USER_B))

    # list_playlists returns creator
    for r in s_list:
        if r["name"] == TEST_NAME:
            assert r["creator"] == TEST_USER_A


# ---------- add_tracks cap behaviour ----------

@pytest.mark.asyncio
async def test_add_tracks_respects_cap(pool):
    owner = ("user", TEST_USER_A)
    name = "TEST_cap"
    assert await playlist_db.create_playlist(pool, owner, name, TEST_USER_A) == "ok"

    def mk(n):
        return [{"title": f"t{i}", "author": "a", "uri": f"http://x/{i}", "length": 1000}
                for i in range(n)]

    # First add 60
    added = await playlist_db.add_tracks(pool, owner, name, mk(60))
    assert added == 60
    # Add 60 more -> only 40 room -> returns 40
    added2 = await playlist_db.add_tracks(pool, owner, name, mk(60))
    assert added2 == 40
    # Now full -> 0
    added3 = await playlist_db.add_tracks(pool, owner, name, mk(5))
    assert added3 == 0

    tracks = await playlist_db.get_tracks(pool, owner, name)
    assert len(tracks) == playlist_db.MAX_TRACKS_PER_PLAYLIST


# ---------- delete_playlist permission ----------

@pytest.mark.asyncio
async def test_delete_shared_forbidden_for_non_creator(pool):
    shared = ("guild", TEST_GUILD)
    name = "TEST_shared_del"
    # creator = A
    assert await playlist_db.create_playlist(pool, shared, name, TEST_USER_A) == "ok"
    # B tries -> forbidden
    assert await playlist_db.delete_playlist(pool, shared, name, TEST_USER_B) == "forbidden"
    # A succeeds
    assert await playlist_db.delete_playlist(pool, shared, name, TEST_USER_A) == "ok"
    # Missing
    assert await playlist_db.delete_playlist(pool, shared, name, TEST_USER_A) == "missing"


@pytest.mark.asyncio
async def test_delete_personal_ok_and_missing(pool):
    owner = ("user", TEST_USER_A)
    name = "TEST_personal_del"
    assert await playlist_db.create_playlist(pool, owner, name, TEST_USER_A) == "ok"
    assert await playlist_db.delete_playlist(pool, owner, name, TEST_USER_A) == "ok"
    assert await playlist_db.delete_playlist(pool, owner, name, TEST_USER_A) == "missing"
