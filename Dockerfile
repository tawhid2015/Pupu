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
COPY frontend/package.json ./
# yarn.lock may be absent from the repo — install without it
RUN yarn install --non-interactive
COPY frontend/ ./
RUN yarn build

# Stage 2: Fetch + patch yt-dlp/ejs (YouTube player solver for yt-cipher).
# The ejs/ folder is gitignored, so it must be rebuilt here exactly like
# lavalink/yt-cipher/Dockerfile does.
FROM denoland/deno:latest AS cipher-builder
WORKDIR /usr/src/app
RUN apt-get update && apt-get install -y git && rm -rf /var/lib/apt/lists/*
ARG EJS_COMMIT=cd4e87f52e87ab6d8b318fd3a817adda6fafa8dc
RUN git init ejs && \
    cd ejs && \
    git remote add origin https://github.com/yt-dlp/ejs.git && \
    git fetch --depth 1 origin "$EJS_COMMIT" && \
    git checkout --detach FETCH_HEAD && \
    cd ..
COPY lavalink/yt-cipher/scripts/patch-ejs.ts ./scripts/patch-ejs.ts
RUN deno run --allow-read --allow-write ./scripts/patch-ejs.ts
RUN rm -rf ./ejs/.git ./ejs/node_modules || true

# Stage 3: Runtime image
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

# Install Python dependencies (lean public-PyPI set for the image;
# requirements.txt stays for the dev pod and includes Emergent-internal pkgs)
COPY backend/requirements.docker.txt /app/backend/requirements.docker.txt
RUN pip install --no-cache-dir -r /app/backend/requirements.docker.txt

# Copy built frontend assets
COPY --from=frontend-builder /app/frontend/build /app/frontend/build

# Copy backend and lavalink configuration
COPY backend/ /app/backend/
COPY lavalink/ /app/lavalink/
# Overlay the patched ejs solver sources (gitignored, built in cipher-builder)
COPY --from=cipher-builder /usr/src/app/ejs /app/lavalink/yt-cipher/ejs
COPY supervisord.conf /app/supervisord.conf
COPY entrypoint.sh /app/entrypoint.sh
RUN chmod +x /app/entrypoint.sh

EXPOSE 8001

CMD ["/app/entrypoint.sh"]
