"""Tests for /api/bot/status endpoint used by Pupu Discord bot status page."""
import os
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL") or open("/app/frontend/.env").read().split("REACT_APP_BACKEND_URL=")[1].split("\n")[0].strip()
BASE_URL = BASE_URL.rstrip("/")


@pytest.fixture
def api_client():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


class TestBotStatus:
    def test_status_endpoint_reachable(self, api_client):
        r = api_client.get(f"{BASE_URL}/api/bot/status", timeout=15)
        assert r.status_code == 200

    def test_status_schema_keys(self, api_client):
        r = api_client.get(f"{BASE_URL}/api/bot/status", timeout=15)
        data = r.json()
        for key in ["online", "name", "guilds", "users", "active_players", "players", "updated_at"]:
            assert key in data, f"missing key: {key}"
        assert isinstance(data["online"], bool)
        assert isinstance(data["guilds"], int)
        assert isinstance(data["users"], int)
        assert isinstance(data["active_players"], int)
        assert isinstance(data["players"], list)

    def test_bot_is_online_with_guilds(self, api_client):
        r = api_client.get(f"{BASE_URL}/api/bot/status", timeout=15)
        data = r.json()
        assert data["online"] is True, f"bot reports offline: {data}"
        assert data["guilds"] > 0, f"expected guilds > 0, got {data['guilds']}"

    def test_latency_present(self, api_client):
        r = api_client.get(f"{BASE_URL}/api/bot/status", timeout=15)
        data = r.json()
        # latency_ms may be None if node not ready, but bot is verified ready
        assert "latency_ms" in data
        if data["latency_ms"] is not None:
            assert isinstance(data["latency_ms"], (int, float))

    def test_no_mongo_id_field(self, api_client):
        r = api_client.get(f"{BASE_URL}/api/bot/status", timeout=15)
        assert "_id" not in r.json()
