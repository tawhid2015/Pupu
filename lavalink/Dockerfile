# ── Lavalink v4 server for Pupu ──────────────────────────────────────────────
# Deploy on Railway: create a service with Root Directory = lavalink/
# The official image already contains Lavalink.jar + Java 21 and starts with:
#   java -jar Lavalink.jar   (reads /opt/Lavalink/application.yml)
FROM ghcr.io/lavalink-devs/lavalink:4-alpine

COPY application.yml /opt/Lavalink/application.yml

# Latest YouTube source plugin (downloaded at build time so the repo stays binary-free).
# ALWAYS bump this when YouTube playback breaks — old versions get bricked by YouTube.
ARG YT_PLUGIN_VERSION=1.18.2
ADD https://github.com/lavalink-devs/youtube-source/releases/download/${YT_PLUGIN_VERSION}/youtube-plugin-${YT_PLUGIN_VERSION}.jar /opt/Lavalink/plugins/youtube-plugin.jar
