"""Admin dashboard API tests: auth, overview, server detail, control."""
import os
import pytest
import requests

BASE_URL = os.environ['REACT_APP_BACKEND_URL'].rstrip('/') if os.environ.get('REACT_APP_BACKEND_URL') else None
if not BASE_URL:
    # fallback: read frontend/.env
    with open('/app/frontend/.env') as f:
        for line in f:
            if line.startswith('REACT_APP_BACKEND_URL='):
                BASE_URL = line.split('=', 1)[1].strip().strip('"').rstrip('/')

ADMIN = f"{BASE_URL}/api/admin"
USER = "pupu"
PASS = "pupu2026"


@pytest.fixture(scope="module")
def token():
    r = requests.post(f"{ADMIN}/login", json={"username": USER, "password": PASS}, timeout=10)
    assert r.status_code == 200, f"login failed: {r.status_code} {r.text}"
    data = r.json()
    assert "token" in data and isinstance(data["token"], str) and len(data["token"]) > 20
    assert data.get("username") == "pupu"
    return data["token"]


@pytest.fixture
def auth_headers(token):
    return {"Authorization": f"Bearer {token}"}


# --- Auth ---
class TestAdminAuth:
    def test_login_wrong_password(self):
        r = requests.post(f"{ADMIN}/login", json={"username": "pupu", "password": "wrong-xyz"}, timeout=10)
        assert r.status_code == 401

    def test_login_success(self, token):
        assert token

    def test_me_with_token(self, auth_headers):
        r = requests.get(f"{ADMIN}/me", headers=auth_headers, timeout=10)
        assert r.status_code == 200
        assert r.json().get("username") == "pupu"

    def test_overview_without_token(self):
        r = requests.get(f"{ADMIN}/overview", timeout=10)
        assert r.status_code == 401

    def test_overview_invalid_token(self):
        r = requests.get(f"{ADMIN}/overview", headers={"Authorization": "Bearer not.a.jwt"}, timeout=10)
        assert r.status_code == 401


# --- Overview ---
class TestAdminOverview:
    def test_overview_shape(self, auth_headers):
        r = requests.get(f"{ADMIN}/overview", headers=auth_headers, timeout=15)
        assert r.status_code == 200
        d = r.json()
        for k in ("online", "guilds", "users", "active_voice", "active_players", "latency_ms", "servers"):
            assert k in d, f"missing key {k}"
        assert isinstance(d["servers"], list)
        assert isinstance(d["active_voice"], int)
        assert isinstance(d["active_players"], int)
        # per-server keys
        if d["servers"]:
            s = d["servers"][0]
            for k in ("id", "name", "members", "voice_connected", "voice_channel",
                      "listeners", "playing", "paused", "volume", "queue_len", "loop"):
                assert k in s, f"server missing key {k}"

    def test_overview_online_and_guilds_positive(self, auth_headers):
        r = requests.get(f"{ADMIN}/overview", headers=auth_headers, timeout=15)
        d = r.json()
        assert d["online"] is True, "bot should be online"
        assert d["guilds"] >= 1

    def test_overview_voice_first_sort(self, auth_headers):
        r = requests.get(f"{ADMIN}/overview", headers=auth_headers, timeout=15)
        servers = r.json()["servers"]
        # servers with voice_connected=True should come first
        seen_false = False
        for s in servers:
            if not s["voice_connected"]:
                seen_false = True
            elif seen_false:
                pytest.fail("voice_connected=True appears after a False entry (sort violated)")


# --- Server detail ---
class TestServerDetail:
    def test_unknown_server_returns_404(self, auth_headers):
        r = requests.get(f"{ADMIN}/servers/999999999999999999", headers=auth_headers, timeout=10)
        assert r.status_code == 404

    def test_known_server_returns_object(self, auth_headers):
        ov = requests.get(f"{ADMIN}/overview", headers=auth_headers, timeout=15).json()
        if not ov["servers"]:
            pytest.skip("no servers to test")
        gid = ov["servers"][0]["id"]
        r = requests.get(f"{ADMIN}/servers/{gid}", headers=auth_headers, timeout=10)
        assert r.status_code == 200
        assert r.json()["id"] == gid


# --- Control ---
class TestAdminControl:
    def test_invalid_action_returns_400(self, auth_headers):
        r = requests.post(f"{ADMIN}/control", headers=auth_headers,
                          json={"guild_id": "1", "action": "nuke"}, timeout=15)
        assert r.status_code == 400

    def test_pause_on_idle_returns_no_player(self, auth_headers):
        ov = requests.get(f"{ADMIN}/overview", headers=auth_headers, timeout=15).json()
        if not ov["servers"]:
            pytest.skip("no servers")
        gid = ov["servers"][0]["id"]
        r = requests.post(f"{ADMIN}/control", headers=auth_headers,
                          json={"guild_id": gid, "action": "pause"}, timeout=20)
        assert r.status_code == 200
        d = r.json()
        assert d["ok"] is False
        # Expect no_player since bot isn't in a voice channel currently
        assert d["result"] in ("no_player", "timeout — bot may be offline"), d


# --- Regression: public status ---
class TestPublicRegression:
    def test_bot_status_public(self):
        r = requests.get(f"{BASE_URL}/api/bot/status", timeout=10)
        assert r.status_code == 200
        assert r.json().get("online") is True
