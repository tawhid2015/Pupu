"""Tests for Spotify single-track/playlist fix in pupu_bot."""
import os
import sys
import asyncio
import importlib
import pytest
import requests

os.environ.setdefault("DISCORD_BOT_TOKEN", "dummy")
os.environ.setdefault("LAVALINK_HOST", "localhost")
os.environ.setdefault("LAVALINK_PORT", "2333")
os.environ.setdefault("LAVALINK_PASSWORD", "pupu2026")

sys.path.insert(0, "/app/backend")
pupu_bot = importlib.import_module("pupu_bot")


# ---------- SPOTIFY_RE regex ----------
class TestSpotifyRegex:
    def test_playlist(self):
        m = pupu_bot.SPOTIFY_RE.search(
            "https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M"
        )
        assert m and m.group(1) == "playlist" and m.group(2) == "37i9dQZF1DXcBWIGoYBM5M"

    def test_album(self):
        m = pupu_bot.SPOTIFY_RE.search(
            "https://open.spotify.com/album/4LH4d3cOWNNsVw41Gqt2kv"
        )
        assert m and m.group(1) == "album"

    def test_track(self):
        m = pupu_bot.SPOTIFY_RE.search(
            "https://open.spotify.com/track/5CtI0qwDJkDQGwXD1H1cLb"
        )
        assert m and m.group(1) == "track" and m.group(2) == "5CtI0qwDJkDQGwXD1H1cLb"

    def test_intl_locale(self):
        m = pupu_bot.SPOTIFY_RE.search(
            "https://open.spotify.com/intl-fr/track/5CtI0qwDJkDQGwXD1H1cLb"
        )
        assert m and m.group(1) == "track" and m.group(2) == "5CtI0qwDJkDQGwXD1H1cLb"


# ---------- _fetch_spotify ----------
class TestFetchSpotify:
    def test_single_track(self):
        name, pairs = asyncio.run(
            pupu_bot._fetch_spotify(
                "https://open.spotify.com/track/5CtI0qwDJkDQGwXD1H1cLb"
            )
        )
        print(f"Track fetch: name={name} pairs={pairs[:3]}")
        assert pairs, "expected at least one (title, artist) pair"
        title = pairs[0][0].lower()
        assert "despacito" in title, f"expected Despacito in title, got {title}"

    def test_playlist(self):
        name, pairs = asyncio.run(
            pupu_bot._fetch_spotify(
                "https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M"
            )
        )
        print(f"Playlist fetch: name={name} count={len(pairs)}")
        assert name, "playlist should have a name"
        assert len(pairs) > 5, f"expected >5 tracks, got {len(pairs)}"


# ---------- Lavalink REST resolution ----------
class TestLavalinkResolve:
    def test_ytsearch_despacito(self):
        try:
            r = requests.get(
                "http://localhost:2333/v4/loadtracks",
                params={"identifier": "ytsearch:Despacito Luis Fonsi"},
                headers={"Authorization": "pupu2026"},
                timeout=15,
            )
        except Exception as e:
            pytest.skip(f"Lavalink unreachable: {e}")
        if r.status_code != 200:
            pytest.skip(f"Lavalink returned {r.status_code}")
        data = r.json()
        assert data.get("loadType") == "search"
        assert len(data.get("data", [])) > 0


# ---------- Public API regression ----------
BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/") or \
    "https://pupu-audio-bot.preview.emergentagent.com"


class TestPublicAPI:
    def test_bot_status(self):
        r = requests.get(f"{BASE_URL}/api/bot/status", timeout=15)
        assert r.status_code == 200, r.text
        data = r.json()
        print(f"bot status: {data}")
        assert "online" in data

    def test_admin_login(self):
        r = requests.post(
            f"{BASE_URL}/api/admin/login",
            json={"username": "pupu", "password": "pupu2026"},
            timeout=15,
        )
        assert r.status_code == 200, r.text
        data = r.json()
        assert data.get("token"), "expected token in response"
