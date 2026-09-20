# Pupu — Discord Music Bot

## Problem statement
Build a Discord music bot named "Pupu" that plays music via a Lavalink v4 server. Both `.`
prefix commands and `/` slash commands must work (e.g. `.help` and `/help`).

## Stack
- Bot: Python, discord.py 2.7.1 + Wavelink 3.5.2 (Lavalink v4)
- Runs as supervisor program `pupu_bot` (`/app/backend/pupu_bot.py`)
- Web status page: FastAPI (`/api/bot/status`) + React (status dashboard)
- MongoDB collection `bot_status` bridges bot -> web page

## Config (backend/.env)
- DISCORD_BOT_TOKEN, LAVALINK_URL, LAVALINK_PASSWORD (secrets, not hardcoded)
- Lavalink: SELF-HOSTED locally since 2026-09-20 — Lavalink 4.2.2 at http://localhost:2333
  (supervisor program `lavalink`, /app/lavalink/, youtube-plugin 1.18.2 in plugins/)
- Old Railway Lavalink (lavalink-2026-production-adb0.up.railway.app) abandoned:
  its youtube-plugin 1.16.0 was broken by YouTube ("must find sig function")

## Bug fix (2026-09-20): bot joined voice but no sound
Root causes: (1) Railway Lavalink's outdated youtube-plugin 1.16.0 broke ALL YouTube streams;
(2) wavelink 3.5.2 `Playable.search` double-prefixed explicit prefixes (ytmsearch:scsearch:...)
so scsearch returned nothing; (3) track-exception handler crashed on track.source_name.
Fixes: self-hosted Lavalink + youtube-plugin 1.18.2; `search_tracks()` helper with proper
`source=` param (YouTube default, SoundCloud for fallback); fixed exception handler using
`track.source` + TypedDict access. Verified via DIAG harness (touch /tmp/pupu_diag.flag +
restart → auto-joins empty VC, plays HTTP/SoundCloud/YouTube, logs pos): all three OK,
pos>3900ms. Test report: /app/test_reports/iteration_2.json (100%).

## Implemented (2026-09-20)
- Hybrid commands (prefix `.` + slash): play, pause, resume, skip, stop, nowplaying, seek,
  queue, shuffle, remove, clear, loop, join, leave, volume, help
- Auto-disconnect after 180s inactivity
- Now-playing embeds with artwork + progress
- Web status dashboard: online state, server/listener counts, latency, live sessions, command reference
- Verified: bot online (98 guilds), Lavalink node ready, 16 slash cmds synced, YouTube search working, status API live

## Playlist system (2026-09-20)
- Supabase Postgres via pooler (SUPABASE_DB_URL in backend/.env; direct db.* host doesn't
  resolve, use aws-0-ap-southeast-1.pooler.supabase.com:5432, user postgres.<ref>)
- /app/backend/playlist_db.py: playlists + playlist_tracks tables, asyncpg pool
  (statement_cache_size=0, min1/max3), limits: 25 playlists/user, 100 tracks/playlist
- Hybrid group `.playlist` / `/playlist` (alias `.pl`): create, save (current+queue), add,
  load (re-resolves by URI, falls back to title search), view, remove, delete, list
- Tests: /app/backend/tests/test_playlist_db.py, report iteration_3.json (100%)

## Playlist v2 (2026-09-20): shuffle-load, server playlists, URL import
- Scoped playlists: personal owner=("user",id) and shared owner=("guild",id), isolated via
  partial unique indexes (playlists_personal_uq / playlists_shared_uq)
- Server-shared (collaborative): group `.serverplaylist`/`.spl` — anyone in the guild can
  create/add/load; only the creator can delete
- Shuffle-load: `.pl load <name> shuffle` (boolean) randomises order via random.shuffle
- Import: `.pl import <name> <url>` — YouTube playlist URLs load natively; public Spotify
  playlist/album/track URLs are scraped via the embed page (__NEXT_DATA__, NO API key) and each
  track resolved to a playable YouTube track (concurrency 8)
- 18 slash commands. Verified: iteration_4.json 100% (scope isolation, dedupe, cap, creator-only
  delete, IMPORTTEST SPOTIFY 50 + YOUTUBE 10)

## Admin dashboard (2026-09-20)
- Multi-server simultaneous playback is inherent to wavelink: each guild has its own
  independent Player + voice connection (confirmed). No shared/global player state.
- Private admin dashboard at `/admin` (login `/admin/login`), JWT Bearer auth, single admin
  from env (ADMIN_USERNAME=pupu / ADMIN_PASSWORD=pupu2026). Token in localStorage
  `pupu_admin_token`, 12h expiry. Brute-force lockout (5 tries/15min) via login_attempts.
- Bot push_status() (5s) writes servers[] with per-guild voice channel, listeners, now-playing,
  volume, queue, loop + active_voice count. poll_commands() (2s) executes admin control
  commands from db.bot_commands (pause/resume/skip/stop/leave/volume).
- Backend admin API: /api/admin/login, /me, /overview, /servers/{id}, /control.
- Frontend: src/admin/{api,AdminLogin,AdminDashboard,ProtectedRoute,admin.css}; near-real-time
  polling every 4s; search, voice-only filter, per-server controls.
- Verified iteration_5.json 100% (backend 13/13, full frontend flow).

## Railway-ready packaging (2026-09-20)
- lavalink/Dockerfile + railway.toml (official lavalink:4-alpine image, downloads
  youtube-plugin at build via YT_PLUGIN_VERSION arg; application.yml uses ${PORT:2333}
  and ${LAVALINK_PASSWORD:pupu2026} templating)
- backend/Dockerfile + railway.toml (default CMD runs bot; API = same image with start
  override `uvicorn server:app --host 0.0.0.0 --port $PORT`)
- frontend/Dockerfile + railway.toml (yarn build → serve static, REACT_APP_BACKEND_URL
  must be set before build)
- README.md fully rewritten: architecture, file-by-file structure, feature internals,
  config matrix, complete Railway guide (4 services + Mongo), maintainer guide, testing
  harnesses, troubleshooting tables

## Rebrand (2026-09-20)
- Watermark everywhere: "Pupu • powered by designertawhid" (bot help footer, web footer)
- Theme: dominant deep violet #7c5cff everywhere (bot EMBED_COLOR 0x7C5CFF, web CSS vars
  --violet #7c5cff / --violet-deep #5537e0, glows + accents re-based to 124,92,255)
- "Lavalink" hidden from all user-facing surfaces (bot embeds, status page, admin UI);
  internals (env names, logs, README) unchanged by design

## YouTube datacenter-IP fix — FINAL (2026-09-20, OAuth + snapshot plugin)
- Root cause chain: datacenter IP → YouTube bot-check (requires login / SABR-only formats);
  poToken CONFLICTS with OAuth (TVHTML5 "The page needs to be reloaded"); plugin 1.18.2's TV
  User-Agent is blocked by YouTube (fixed upstream PR #82, only in SNAPSHOT builds);
  wavelink's inactive_channel_tokens (default 3) fired in the empty DIAG channel and my
  on_wavelink_inactive_player disconnected mid-fallback (players=0, player=None events).
- FINAL working stack:
  • youtube-plugin SNAPSHOT 2be8e542 (PlayStation UA fix) — lavalink/plugins/youtube-plugin-snapshot.jar
    (backup of 1.18.2 kept at lavalink/youtube-plugin-1.18.2.jar.bak; Dockerfile uses the snapshot URL)
  • OAuth-only: plugins.youtube.oauth.enabled + refreshToken (user's burner Google account,
    device flow). NO pot: block (conflicts with OAuth).
  • clients [TV, MUSIC, WEB, WEBEMBEDDED, ANDROID_VR, IOS] + clientOptions: TV playback-only
    (TVHTML5 cannot search), MUSIC/WEB searching enabled.
  • remoteCipher → self-hosted yt-cipher :8002 (supervisor `ytcipher`, Deno,
    API_TOKEN pupu-cipher-2026, OVERRIDE_PLAYER_VARIANT=IAS).
- Bot resilience: _PLAYERS registry + mark_playing + revive_player() (reconnect destroyed
  players), clean_query() 2-step fallback (cleaned YT → cleaned SC), ensure_player()
  reconnects dead players, diag sets inactive_channel_tokens=None (empty-channel artifact).
- Verified: exact reported song plays via=youtube directly (DIAG CUSTOM OK), Rick Astley OK.
  iteration_7 (100%) pre-snapshot; final DIAG 10:24 all 4 probes OK incl. direct YouTube.

## Notes / requirements outside build
- Discord Developer Portal: Message Content Intent must be ON (enabled in code intents; also toggle in portal)
- Bot must be invited with Connect + Speak voice permissions
- Slash commands registered globally (can take up to ~1h to appear first time)
- Security: token/password were shared in plain chat — recommend regenerating the token

## Backlog / P1
- Filters/bassboost, 24/7 stay-in-channel mode, autoplay related tracks
- DJ/permission role restriction
- Per-user playlists, favorites, history, lyrics

## 2026-09-20 — Web UI command copy buttons + README error docs (DONE)
- User asked (msg 580): show BOTH `.` and `/` variants for every command in the Web UI with a
  per-command "Copy" button, and document the YouTube errors/fixes in the README.
- App.js: COMMANDS restructured to {c, a, d} objects (16 individual commands); new CmdRow
  component renders `.cmd args` + `/cmd` chips and a copy button (copies the `.` prefix version,
  e.g. `.play`, with inline "Copied!" feedback; data-testid `copy-cmd-<cmd>`).
- App.css: .cmd-line, .cmd-slash, .cmd-copy (+hover/copied states), .cmd-desc styles.
- README.md: new §7.11 field-notes table (AllClientsFailedException → OAuth device code;
  SABR → yt-cipher; poToken+OAuth conflict; silent playback → inactive_channel_tokens +
  PlayStation UA) and 3 new rows in §13 Troubleshooting.
- Verified via screenshot: desktop 1920 + mobile 390 render correctly, copy button flips to
  "Copied!" on click. No real horizontal overflow (only fixed decorative glow).

## 2026-09-20 — Railway one-command deploy (DONE)
- User chose "all services import in one click" → built a CLI bootstrap since Railway has no
  true repo-based one-click for monorepos (templates must be published from a deployed project).
- NEW: deploy/railway-deploy.sh — interactive Railway CLI bootstrap: creates project, adds
  MongoDB, creates + configures + deploys all 5 services (yt-cipher, lavalink, pupu-bot,
  pupu-api, pupu-web) via `railway up`, generates domains, uses reference variables
  (${{svc.RAILWAY_PUBLIC_DOMAIN}}, ${{MongoDB.MONGO_URL}}). Prompts only for Discord token +
  Supabase DSN. bash -n syntax-checked. yt-cipher PORT pinned to 8001 for private-DNS reachability.
- NEW: lavalink/yt-cipher/railway.toml (was missing — Dockerfile already existed).
- application.yml now env-templates YTCIPHER_URL, YTCIPHER_PASSWORD, YOUTUBE_REFRESH_TOKEN
  (defaults = current working values → local Lavalink untouched, no restart needed).
- README §7: new 7.0 bootstrap section + one-click Deploy-button instructions (publish template
  → button), service table updated to 5 services, env-var matrix includes yt-cipher column.
- User must still: `railway login` + run the script (needs their Railway account), optionally
  connect GitHub sources for push-to-deploy.

## 2026-09-20 — All-in-One 1-Click Railway Deployment (DONE)
- Implemented single-container deployment architecture:
  • Root multi-stage `Dockerfile`: builds React static assets in Node 20 stage, runtime Python 3.11 with OpenJDK 17 + Deno + Supervisor + Lavalink 4.2.2 + youtube-plugin snapshot.
  • `supervisord.conf` & `entrypoint.sh`: runs all 5 components internally (Lavalink, yt-cipher, Discord bot, FastAPI serving static React at `/` & `/admin` on `$PORT`).
  • `backend/server.py`: updated with static file mounting and SPA fallback route for React frontend, plus safe env defaults.
  • `backend/pupu_bot.py`: updated with localhost default fallbacks for Lavalink connection.
  • `lavalink/application.yml`: updated port to `${LAVALINK_PORT:2333}` so Railway's `$PORT` does not conflict.
  • Railway requirements simplified to just 1 service (`tawhid2015/Pupu`) + 1 MongoDB database + 3 environment variables (`DISCORD_BOT_TOKEN`, `SUPABASE_DB_URL`, `MONGO_URL`).

## 2026-09-20 — MongoDB fully removed → Supabase Postgres for EVERYTHING (DONE)
- User: "mongodb not good lets use supabase". Their old Atlas URI (cluster0.rjxzn) was dead
  (NXDOMAIN — cluster deleted). Their new direct DSN db.gjlptminalswifyfehpw.supabase.co is
  IPv6-only (unreachable from pod) → derived working session-pooler DSN, verified CONNECT OK:
  postgresql://postgres.gjlptminalswifyfehpw:<pwd url-encoded>@aws-0-ap-southeast-1.pooler.supabase.com:5432/postgres
  (same project that already hosts playlists tables). .env SUPABASE_DB_URL updated to this.
- NEW backend/bot_db.py: asyncpg pool + schema (bot_kv, bot_commands, login_attempts,
  status_checks) + helpers; replaces ALL motor/MongoDB usage.
- pupu_bot.py: push_status → bot_db.save_status (bot_kv upsert), poll_commands →
  fetch_pending_commands/complete_command; setup_hook calls bot_db.init_schema().
- server.py: all endpoints (status, bot/status, admin login/overview/control) use bot_db;
  startup event inits schema; shutdown closes pool. motor import removed everywhere.
- Verified: bot online 98 guilds pushing status via Postgres; admin login+overview OK;
  status_checks POST/GET OK; pytest 23/23 passed.
- README purged of all MongoDB mentions (17 edits: diagram, config table, deploy steps).
- Railway All-in-One now needs only 2 vars: DISCORD_BOT_TOKEN + SUPABASE_DB_URL (no DB plugin).
- deploy/railway-deploy.sh marked LEGACY (it provisioned MongoDB).
- NOTE: motor/pymongo still in requirements.txt (unused, harmless) — could be pruned later.

## 2026-09-20 — Railway build failure fixed (yarn.lock + ejs)
- Build failed: "/frontend/yarn.lock": not found → yarn.lock exists locally but is UNTRACKED
  in git (platform commits never included it). Dockerfile stage 1 now copies only package.json
  and runs plain `yarn install --non-interactive`.
- Second latent bug found by audit: lavalink/yt-cipher/ejs/ is gitignored (per yt-cipher's own
  .gitignore) but server.ts imports from ../ejs/... → added `cipher-builder` stage to root
  Dockerfile that clones yt-dlp/ejs@cd4e87f + runs scripts/patch-ejs.ts (mirrors official
  yt-cipher Dockerfile), then COPY --from=cipher-builder ejs into the runtime image.
- Audited every Docker COPY source against `git ls-files` — all tracked (backend/*, lavalink/
  application.yml, yt-cipher src, frontend/*). Untracked & intentionally excluded:
  frontend/yarn.lock, lavalink/plugins/*.jar (downloaded at build), lavalink/Lavalink.jar
  (downloaded at build), backend/.env (secrets — correctly NOT in image; env via Railway vars).
- No docker daemon in this pod → could not run a local image build; Dockerfile is static-verified.
  User must Save to GitHub → Railway Redeploy.

## 2026-09-20 — Railway build failure #2 fixed (emergentintegrations)
- Build failed at pip install: `No matching distribution found for emergentintegrations==0.2.0`
  — it's an Emergent-internal package on a private CloudFront index, unreachable from Railway.
- Audited backend imports: emergentintegrations, boto3, requests-oauthlib, passlib, jose,
  pandas, numpy, typer, jq, cryptography, requests all UNUSED in code; aiohttp used.
- NEW backend/requirements.docker.txt: lean 13-package public-PyPI set (fastapi, uvicorn,
  pydantic, email-validator, dotenv, pyjwt, bcrypt, discord.py 2.7.1, wavelink 3.5.2, PyNaCl,
  asyncpg 0.30.0, aiohttp, tzdata). Dockerfile now installs from it; requirements.txt untouched
  (pod still uses it).
- Verified in clean venv: installs OK + all module imports resolve.
- Log review: cipher-builder (ejs clone+patch) completed all 7 steps; yarn [err] line was just
  parallel-stage cancellation after pip failed — no yarn problem.

## 2026-09-20 — New test bot token (Prevent#9955) active in pod
- User provided a NEW Discord bot token (test bot). Updated backend/.env DISCORD_BOT_TOKEN.
- Bot online as Prevent#9955 (bot id 905383277840445471), 7 guilds, Lavalink + Postgres OK.
- Old bot Pupu#4710 (98 guilds) token still set on Railway deployment — user deciding which
  token goes where. WARNING: never run both environments with the same token (gateway fights).
- Pod incident: after pod resume, Lavalink was down (FATAL: can't find command 'java' on boot,
  then restart worked) and wavelink exhausted retries → needed pupu_bot restart. If bot reports
  Lavalink connection refused after a pod resume: restart lavalink, THEN restart pupu_bot.

## 2026-09-20 — Auto-advance queue + leave-when-alone (DONE, needs user Discord test)
- ROOT CAUSE of "next song won't auto-play": player.autoplay was never set → Wavelink v3
  defaults to AutoPlayMode.disabled, so the queue never advances after a track ends.
- FIX: set `player.autoplay = wavelink.AutoPlayMode.enabled` in ensure_player() AND
  revive_player(). This: (a) auto-advances the normal queue after each track,
  (b) when the whole queue is exhausted, auto-fills auto_queue with recommended tracks
  (= "auto play randomly"). Covers manual .play, .queue, and playlist load paths.
- NEW leave-when-alone via on_voice_state_update:
  • channel empties (no non-bot members) → pause current track, notify, schedule leave.
  • EMPTY_LEAVE_DELAY=60s later still empty → disconnect + message.
  • a human returns before timeout → cancel leave, resume playback.
  • module helpers _leave_tasks / _cancel_leave / _schedule_leave / _empty_leave_after.
- Bot restarts clean (Prevent#9955, Lavalink ready, 18 cmds). NOTE: real voice playback /
  track-end / empty-channel behavior can only be fully verified by the user in a live Discord
  voice channel — automated tools can't join voice.

## 2026-09-20 — "Now Playing" spam / infinite fallback loop fixed
- SYMPTOM: after playlist load, same song's "Now Playing" embed spammed repeatedly.
- ROOT CAUSE (from logs): Indila track failed to load (TrackException: All clients failed).
  Fallback handler searched YouTube again → found the SAME video → played it → failed again.
  on_wavelink_track_start reset _fallback_count=0 on every retry → INFINITE LOOP, each loop
  spamming Now Playing. Also our fallback's play() fought wavelink AutoPlay's loadFailed
  queue advancement (double advance).
- FIXES in pupu_bot.py:
  1. track_start no longer resets _fallback_count; new on_wavelink_track_end resets it ONLY
     when reason=="finished" (a track that fully played proves the chain works).
  2. Fallback reduced to ONE SoundCloud swap: put_at(0)+skip if mid-play; if the track failed
     to load, just queue-front it and let AutoPlay advance (no self-play → no fight).
  3. Failure message changed to "Skipping to the next track" — AutoPlay owns advancement.
  4. Now Playing debounce: same track identifier not re-announced within 120s
     (player._announced = (identifier, ts)).
- Bot restarted clean (Prevent#9955). Needs user confirmation in Discord.

## 2026-09-20 — Empty-channel pause moved to song boundary only
- User feedback: pausing mid-song when the channel empties is bad for users with flaky
  internet (reconnect spam = constant pause/resume). Pause must happen ONLY at song end.
- CHANGE: on_voice_state_update is now RESUME-ONLY (rejoin → cancel leave + resume).
  Empty-channel detection moved to on_wavelink_track_start: if a new song starts and the
  channel has no humans → pause(True) at 0:00, notify, _schedule_leave (60s).
- Net behavior: current song always plays to its natural end; pause happens at the next
  song's start only if nobody is listening; rejoin → "Welcome back" + resume; 60s empty → leave.
- Diag harness sets player._diag=True to skip empty-channel logic (it joins empty channels).
- Bot restarted clean (Prevent#9955). Needs user Discord verification.

## 2026-09-20 — Region-blocked video handling (Indila DF3XjEhJ40Y) fixed
- Video DF3XjEhJ40Y (Indila - Love Story) fails playback on ALL YT clients: "This video is
  not available" = region/availability lock (NOT bot-check). Unfixable without proxy.
- But SoundCloud fallback silently failed: query was "Indila - Love Story IndilaVEVO" →
  scsearch 0 results. clean_query() now strips VEVO/official author suffixes and dashes →
  "Indila Love Story Indila" → 10 SC results. DIAG-verified: SoundCloud stream plays
  (pos advanced, source=soundcloud).
- NEW: player._blocked set — identifiers failing with "not available/unavailable" are
  remembered per session; repeat attempts (e.g. YouTube RD autoplay mixes re-suggesting the
  same blocked video) are skipped silently, no message spam.
