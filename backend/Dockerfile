# ── Pupu backend (Discord bot + FastAPI) ─────────────────────────────────────
# Deploy on Railway: service with Root Directory = backend/
# Default CMD runs the Discord bot. For the API/dashboard service, set the
# Railway start command override to:
#   uvicorn server:app --host 0.0.0.0 --port $PORT
FROM python:3.11-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

CMD ["python", "pupu_bot.py"]
