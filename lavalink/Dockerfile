# ── Lavalink v4 server for Pupu ──────────────────────────────────────────────
# Deploy on Railway: create a service with Root Directory = lavalink/
# The official image already contains Lavalink.jar + Java 21 and starts with:
#   java -jar Lavalink.jar   (reads /opt/Lavalink/application.yml)
FROM ghcr.io/lavalink-devs/lavalink:4-alpine

COPY application.yml /opt/Lavalink/application.yml

# YouTube source plugin. Currently pinned to a SNAPSHOT build because the latest
# release (1.18.2) is broken by YouTube's TV-client User-Agent block
# ("The page needs to be reloaded", fixed in upstream PR #82).
# To update: get the newest commit-hash version from
#   https://maven.lavalink.dev/snapshots/dev/lavalink/youtube/youtube-plugin/maven-metadata.xml
# or switch back to a GitHub release >= the fix:
#   https://github.com/lavalink-devs/youtube-source/releases
ARG YT_PLUGIN_URL=https://maven.lavalink.dev/snapshots/dev/lavalink/youtube/youtube-plugin/2be8e542d3f6f178e048dca565892684c2e40177/youtube-plugin-2be8e542d3f6f178e048dca565892684c2e40177.jar
ADD ${YT_PLUGIN_URL} /opt/Lavalink/plugins/youtube-plugin.jar

# ── yt-cipher (YouTube signature decryption, required for SABR) ──────────────
# The youtube-plugin expects a remote cipher server (application.yml:
# plugins.youtube.remoteCipher). Deploy lavalink/yt-cipher as a SEPARATE Railway
# service:  start command → deno run --no-check --allow-net --allow-read
#   --allow-write --allow-env server.ts
# env: API_TOKEN=<secret>, OVERRIDE_PLAYER_VARIANT=IAS, PORT=<any>
# then set remoteCipher.url in application.yml to that service's private hostname.
