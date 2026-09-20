#!/usr/bin/env python3
"""Generate a fresh YouTube poToken+visitorData and inject it into application.yml,
then restart Lavalink. Run this whenever YouTube playback starts failing
(AllClientsFailedException). Requires node deps in ./potoken (already installed).

Usage:  python3 /app/lavalink/refresh_potoken.py
"""
import json
import re
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).parent
YML = HERE / "application.yml"


def main():
    out = subprocess.run(
        ["node", "gen.mjs"], cwd=HERE / "potoken",
        capture_output=True, text=True, timeout=120)
    line = out.stdout.strip().splitlines()[-1] if out.stdout.strip() else ""
    try:
        data = json.loads(line)
        token, vdata = data["poToken"], data["visitorData"]
    except Exception:
        print("Failed to generate poToken:", out.stdout[-500:], out.stderr[-500:])
        sys.exit(1)

    text = YML.read_text()
    text = re.sub(r'(\n\s*token:\s*").*?(")', rf'\g<1>{token}\g<2>', text, count=1)
    text = re.sub(r'(\n\s*visitorData:\s*").*?(")', rf'\g<1>{vdata}\g<2>', text, count=1)
    YML.write_text(text)
    print(f"Injected poToken ({len(token)} chars) + visitorData into application.yml")

    subprocess.run(["sudo", "supervisorctl", "restart", "lavalink"], check=False)
    print("Lavalink restarted.")


if __name__ == "__main__":
    main()
