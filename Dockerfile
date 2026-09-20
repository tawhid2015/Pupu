# ── Pupu All-in-One Multi-Stage Container for Railway ──────────────────────
# Runs all 5 components in 1 single container:
#   1. React web dashboard (built static & served by FastAPI)
#   2. FastAPI backend & API
#   3. Discord Music Bot (pupu_bot.py)
#   4. Lavalink v4.2.2 Audio Server (Java 17)
#   5. yt-cipher SABR Signature Decryption Server (Deno)

# Stage 1: Build React frontend
FROM node:20-alpine AS frontend-builder
WORKDIR /app/frontend
COPY frontend/package.json frontend/yarn.lock ./
RUN yarn install --frozen-lockfile || yarn install
COPY frontend/ ./
RUN yarn build

# Stage 2: Runtime image
FROM python:3.11-slim-bookworm

ENV DEBIAN_FRONTEND=noninteractive \
    PYTHONUNBUFFERED=1 \
    PORT=8001 \
    LAVALINK_PORT=2333 \
    LAVALINK_PASSWORD=pupu2026 \
    LAVALINK_URL=http://localhost:2333 \
    API_TOKEN=pupu-cipher-2026 \
    OVERRIDE_PLAYER_VARIANT=IAS \
    YTCIPHER_URL=http://localhost:8002 \
    YTCIPHER_PASSWORD=pupu-cipher-2026

WORKDIR /app

# Install OpenJDK 17 (for Lavalink), supervisor, curl, ca-certificates
RUN apt-get update && apt-get install -y --no-install-recommends \
    openjdk-17-jre-headless \
    supervisor \
    curl \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Install Deno for yt-cipher
COPY --from=denoland/deno:bin /deno /usr/local/bin/deno

# Create required directories
RUN mkdir -p /app/lavalink/plugins /app/lavalink/yt-cipher /var/log/supervisor /app/backend /app/frontend

# Download Lavalink 4.2.2 jar and YouTube snapshot plugin
RUN curl -fsSL -o /app/lavalink/Lavalink.jar https://github.com/lavalink-devs/Lavalink/releases/download/4.2.2/Lavalink.jar
RUN curl -fsSL -o /app/lavalink/plugins/youtube-plugin.jar https://maven.lavalink.dev/snapshots/dev/lavalink/youtube/youtube-plugin/2be8e542d3f6f178e048dca565892684c2e40177/youtube-plugin-2be8e542d3f6f178e048dca565892684c2e40177.jar

# Install Python dependencies
COPY backend/requirements.txt /app/backend/requirements.txt
RUN pip install --no-cache-dir -r /app/backend/requirements.txt

# Copy built frontend assets
COPY --from=frontend-builder /app/frontend/build /app/frontend/build

# Copy backend and lavalink configuration
COPY backend/ /app/backend/
COPY lavalink/ /app/lavalink/
COPY supervisord.conf /app/supervisord.conf
COPY entrypoint.sh /app/entrypoint.sh
RUN chmod +x /app/entrypoint.sh

EXPOSE 8001

CMD ["/app/entrypoint.sh"]
