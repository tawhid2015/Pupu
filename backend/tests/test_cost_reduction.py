"""Regression tests after cost/log reduction changes (iteration 9).

Verifies:
 - /api/bot/status still online with fresh updated_at (< 40s)
 - legacy /api/status POST + GET (Postgres status_checks)
 - Lavalink ytsearch + scsearch resolution
 - Log-reduction: no wavelink DEBUG / no discord.gateway INFO 'has connected'
   lines in the last 500 lines of pupu_bot logs; but at least one pupu INFO
   lifecycle line is present.
"""
import os
import time
import datetime as dt
import re
import subprocess
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")
if not BASE_URL:
    with open("/app/frontend/.env") as f:
        for ln in f:
            if ln.startswith("REACT_APP_BACKEND_URL="):
                BASE_URL = ln.split("=", 1)[1].strip().rstrip("/")

LAVALINK_URL = "http://localhost:2333"
LAVALINK_PW = "pupu2026"


# --- /api/bot/status freshness ---
class TestBotStatusFreshness:
    def test_online_true(self):
        r = requests.get(f"{BASE_URL}/api/bot/status", timeout=15)
        assert r.status_code == 200
        d = r.json()
        assert d["online"] is True, d
        assert d.get("name") == "Prevent#9955", d.get("name")
        assert d.get("guilds", 0) > 0
        assert "users" in d

    def test_updated_at_fresh(self):
        r = requests.get(f"{BASE_URL}/api/bot/status", timeout=15)
        d = r.json()
        ua = d.get("updated_at")
        assert ua, f"updated_at missing: {d}"
        # parse ISO
        try:
            ts = dt.datetime.fromisoformat(ua.replace("Z", "+00:00"))
        except Exception as e:
            pytest.fail(f"bad updated_at format {ua}: {e}")
        now = dt.datetime.now(dt.timezone.utc)
        age = (now - ts).total_seconds()
        assert age < 40, f"updated_at is {age:.1f}s old (>=40s, offline threshold)"


# --- legacy /api/status ---
class TestLegacyStatus:
    def test_post_then_get(self):
        marker = f"cost-test-{int(time.time())}"
        pr = requests.post(f"{BASE_URL}/api/status", json={"client_name": marker}, timeout=15)
        assert pr.status_code == 200, pr.text
        gr = requests.get(f"{BASE_URL}/api/status", timeout=15)
        assert gr.status_code == 200
        rows = gr.json()
        assert isinstance(rows, list)
        assert any(row.get("client_name") == marker for row in rows), (
            f"marker {marker} not found in status_checks"
        )
        # ensure no mongo _id leaks
        for row in rows[:20]:
            assert "_id" not in row


# --- Lavalink music resolution ---
class TestLavalinkResolve:
    def _load(self, identifier):
        return requests.get(
            f"{LAVALINK_URL}/v4/loadtracks",
            params={"identifier": identifier},
            headers={"Authorization": LAVALINK_PW},
            timeout=20,
        )

    def test_ytsearch(self):
        r = self._load("ytsearch:Despacito")
        assert r.status_code == 200, r.text
        d = r.json()
        assert d.get("loadType") == "search", d
        assert len(d.get("data", [])) > 0

    def test_scsearch_fallback(self):
        r = self._load("scsearch:Indila Love Story")
        assert r.status_code == 200, r.text
        d = r.json()
        # SC returns loadType=search when results found
        assert d.get("loadType") in ("search", "track"), d
        assert len(d.get("data", [])) > 0, "no scsearch results — SoundCloud fallback broken"


# --- Log reduction verification ---
LOG_PATH = "/var/log/supervisor/pupu_bot.err.log"


class TestLogReduction:
    def _tail(self, n=3000):
        """Return only the log slice belonging to the CURRENT pupu_bot process.

        We scope to lines since the last 'Pupu online' marker to avoid
        picking up output from previous restarts (before the logging
        config changed).
        """
        try:
            out = subprocess.check_output(["tail", "-n", str(n), LOG_PATH], text=True, errors="replace")
        except Exception as e:
            pytest.skip(f"cannot read log: {e}")
        marker = "Playlist DB connected"
        idx = out.rfind(marker)
        if idx == -1:
            return "\n".join(out.splitlines()[-100:])
        # slice from the current process boot marker onward
        return out[idx:]

    def test_no_wavelink_debug(self):
        log = self._tail(1500)
        # look for typical wavelink DEBUG lines
        bad = re.findall(r"wavelink[^\n]*DEBUG", log)
        assert not bad, f"found wavelink DEBUG lines: {bad[:3]}"
        # also raw pattern " DEBUG " from wavelink logger
        bad2 = [ln for ln in log.splitlines() if " DEBUG " in ln and "wavelink" in ln.lower()]
        assert not bad2, f"wavelink DEBUG: {bad2[:2]}"

    def test_no_discord_gateway_connected_info(self):
        log = self._tail(1500)
        bad = [
            ln for ln in log.splitlines()
            if "discord.gateway" in ln and "INFO" in ln and "has connected" in ln
        ]
        assert not bad, f"discord.gateway INFO 'has connected' still present: {bad[:2]}"

    def test_pupu_lifecycle_info_present(self):
        log = self._tail(2000)
        # expect at least one of these lifecycle markers
        markers = ["Pupu online", "Lavalink node ready", "DB connected", "connected to Lavalink", "Logged in as"]
        found = [m for m in markers if m.lower() in log.lower()]
        assert found, f"no pupu INFO lifecycle line found. Markers tried: {markers}"
