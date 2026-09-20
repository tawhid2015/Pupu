#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# ⚠ LEGACY multi-service path — superseded by the root all-in-one Dockerfile
#   (see README §7.1). Kept only if you intentionally want 5 separate services.
#   NOTE: MongoDB is no longer used anywhere — Supabase Postgres stores
#   playlists, live status and the admin command channel (backend/bot_db.py).
# ─────────────────────────────────────────────────────────────────────────────
# Pupu — one-command Railway bootstrap
#
# Creates a Railway project with ALL services and deploys them:
#   MongoDB · yt-cipher · lavalink · pupu-bot · pupu-api · pupu-web
#
# Usage:
#   1. Install the CLI:   npm i -g @railway/cli      (or brew install railway)
#   2. Authenticate:      railway login
#   3. Push this repo to GitHub first (Save to GitHub) — optional but recommended
#   4. Run:               bash deploy/railway-deploy.sh
#
# The script deploys each service from its subfolder via `railway up`, so it
# works even before the GitHub repo is connected. Afterwards you can connect
# each service to the repo (Service → Settings → Source) with the Root
# Directories below so future pushes auto-deploy:
#   yt-cipher → lavalink/yt-cipher · lavalink → lavalink
#   pupu-bot / pupu-api → backend  · pupu-web → frontend
#
# If a CLI flag differs in your CLI version, check `railway <command> --help`.
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail
cd "$(dirname "$0")/.."   # repo root

# ── config (edit if you rename services) ─────────────────────────────────────
MONGO_SVC="MongoDB"        # name Railway gives the database service
CIPHER_SVC="yt-cipher"
LL_SVC="lavalink"
BOT_SVC="pupu-bot"
API_SVC="pupu-api"
WEB_SVC="pupu-web"
CIPHER_PORT=8001           # fixed so lavalink can reach it over private DNS
CIPHER_TOKEN="pupu-cipher-2026"
LL_PASSWORD="pupu2026"

say()  { printf "\n\033[1;35m▶ %s\033[0m\n" "$*"; }
warn() { printf "\033[1;33m⚠ %s\033[0m\n" "$*"; }
need() { command -v "$1" >/dev/null 2>&1 || { echo "missing: $1 — $2"; exit 1; }; }

need railway "npm i -g @railway/cli"

say "Railway auth"
railway whoami || { echo "Run: railway login"; exit 1; }

say "Create / link project"
if ! railway status >/dev/null 2>&1; then
  railway init --name pupu
fi
railway status

# ── secrets (prompted; sensible defaults) ────────────────────────────────────
say "Secrets"
read -rp "Discord bot token (DISCORD_BOT_TOKEN): " DISCORD_BOT_TOKEN
[ -n "$DISCORD_BOT_TOKEN" ] || { echo "bot token is required"; exit 1; }
read -rp "Supabase session-pooler DSN (SUPABASE_DB_URL): " SUPABASE_DB_URL
[ -n "$SUPABASE_DB_URL" ] || { echo "Supabase DSN is required"; exit 1; }
JWT_SECRET=$(openssl rand -hex 32)
read -rp "Admin username [pupu]: " ADMIN_USERNAME; ADMIN_USERNAME=${ADMIN_USERNAME:-pupu}
read -rp "Admin password [pupu2026] (CHANGE for production): " ADMIN_PASSWORD; ADMIN_PASSWORD=${ADMIN_PASSWORD:-pupu2026}
read -rp "YouTube OAuth refresh token [Enter = use the one baked into application.yml]: " YT_REFRESH

# ── 1. MongoDB ───────────────────────────────────────────────────────────────
say "1/6 MongoDB database"
railway add --database mongo || warn "database may already exist — continuing"
MONGO_REF="\${{${MONGO_SVC}.MONGO_URL}}"
warn "If the Mongo reference fails, check the service name in the dashboard and update MONGO_REF in this script."

# ── 2. yt-cipher ─────────────────────────────────────────────────────────────
say "2/6 yt-cipher (YouTube signature decryption)"
railway add --service "$CIPHER_SVC" || warn "service may already exist — continuing"
railway variables --service "$CIPHER_SVC" \
  --set "API_TOKEN=$CIPHER_TOKEN" \
  --set "OVERRIDE_PLAYER_VARIANT=IAS" \
  --set "PORT=$CIPHER_PORT"
( cd lavalink/yt-cipher && railway up --service "$CIPHER_SVC" --detach )

# ── 3. lavalink ──────────────────────────────────────────────────────────────
say "3/6 lavalink (audio node)"
railway add --service "$LL_SVC" || warn "service may already exist — continuing"
railway variables --service "$LL_SVC" \
  --set "LAVALINK_PASSWORD=$LL_PASSWORD" \
  --set "YTCIPHER_URL=http://${CIPHER_SVC}.railway.internal:${CIPHER_PORT}" \
  --set "YTCIPHER_PASSWORD=$CIPHER_TOKEN" \
  ${YT_REFRESH:+--set "YOUTUBE_REFRESH_TOKEN=$YT_REFRESH"}
( cd lavalink && railway up --service "$LL_SVC" --detach )
railway domain --service "$LL_SVC" || warn "generate the lavalink domain in the dashboard (Settings → Networking)"

# ── 4. pupu-bot ──────────────────────────────────────────────────────────────
say "4/6 pupu-bot (Discord worker)"
railway add --service "$BOT_SVC" || warn "service may already exist — continuing"
railway variables --service "$BOT_SVC" \
  --set "DISCORD_BOT_TOKEN=$DISCORD_BOT_TOKEN" \
  --set "LAVALINK_URL=https://\${{${LL_SVC}.RAILWAY_PUBLIC_DOMAIN}}" \
  --set "LAVALINK_PASSWORD=$LL_PASSWORD" \
  --set "MONGO_URL=$MONGO_REF" \
  --set "DB_NAME=pupu" \
  --set "SUPABASE_DB_URL=$SUPABASE_DB_URL"
( cd backend && railway up --service "$BOT_SVC" --detach )

# ── 5. pupu-api ──────────────────────────────────────────────────────────────
say "5/6 pupu-api (FastAPI dashboard API)"
railway add --service "$API_SVC" || warn "service may already exist — continuing"
# start command: uvicorn instead of the bot
railway variables --service "$API_SVC" \
  --set "MONGO_URL=$MONGO_REF" \
  --set "DB_NAME=pupu" \
  --set "JWT_SECRET=$JWT_SECRET" \
  --set "ADMIN_USERNAME=$ADMIN_USERNAME" \
  --set "ADMIN_PASSWORD=$ADMIN_PASSWORD" \
  --set "CORS_ORIGINS=https://\${{${WEB_SVC}.RAILWAY_PUBLIC_DOMAIN}}" \
  --set "RAILWAY_RUN_COMMAND=uvicorn server:app --host 0.0.0.0 --port \$PORT"
( cd backend && railway up --service "$API_SVC" --detach )
warn "pupu-api must start uvicorn, not the bot: Service → Settings → Deploy → Custom Start Command:"
warn "  uvicorn server:app --host 0.0.0.0 --port \$PORT"
railway domain --service "$API_SVC" || warn "generate the pupu-api domain in the dashboard"

# ── 6. pupu-web ──────────────────────────────────────────────────────────────
say "6/6 pupu-web (React status page + admin dashboard)"
railway add --service "$WEB_SVC" || warn "service may already exist — continuing"
railway variables --service "$WEB_SVC" \
  --set "REACT_APP_BACKEND_URL=https://\${{${API_SVC}.RAILWAY_PUBLIC_DOMAIN}}"
( cd frontend && railway up --service "$WEB_SVC" --detach )
railway domain --service "$WEB_SVC" || warn "generate the pupu-web domain in the dashboard"

say "Done — verification checklist"
cat <<EOF
  1. lavalink : curl -H "Authorization: $LL_PASSWORD" https://<lavalink-domain>/version   → 4.2.2
  2. bot logs : railway logs --service $BOT_SVC   → "Lavalink node ready" + "Pupu online as ..."
  3. api      : curl https://<api-domain>/api/bot/status   → {"online":true,...}
  4. web      : open the pupu-web domain → / status page, /admin login ($ADMIN_USERNAME)
  5. If YouTube shows a device code in lavalink logs, authorize it once (burner account).

  Optional: connect each service to GitHub for push-to-deploy:
    Service → Settings → Source → your repo, Root Directory:
      $CIPHER_SVC → lavalink/yt-cipher · $LL_SVC → lavalink
      $BOT_SVC / $API_SVC → backend · $WEB_SVC → frontend
EOF
