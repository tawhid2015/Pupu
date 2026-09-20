# Plan: All-in-One 1-Click Railway Deployment

## Overview
Transform the repository into an **All-in-One Single Container** deployment so the entire Pupu stack (Lavalink, yt-cipher, Discord Bot, FastAPI backend, and React web dashboard) runs inside **1 single service on Railway** from your existing single GitHub repository (`tawhid2015/Pupu`).

---

## Key Answers to User Questions
1. **Do you need to create more repos?**
   **NO.** Everything stays in your single `tawhid2015/Pupu` repo.
2. **Do you need to deploy 4 or 5 separate services?**
   **NO.** With this All-in-One setup, you only deploy **1 service** + **1 MongoDB database**.

---

## What We Will Build
1. **Root `Dockerfile`**:
   - Base: Debian/Ubuntu with OpenJDK 21 (for Lavalink), Deno (for yt-cipher), Python 3.11 (for Discord bot + FastAPI), and Node.js (builds React frontend into static assets served directly by FastAPI).
   - Includes `supervisord` to manage and auto-restart all internal processes.
2. **Supervisor Configuration (`supervisord.conf`)**:
   - Manages:
     - `lavalink` on `localhost:2333`
     - `yt-cipher` on `localhost:8001`
     - `pupu_bot` connected to local Lavalink
     - `server` (FastAPI + React frontend) listening on `$PORT` provided by Railway.
3. **Internal Networking**:
   - Zero complex URL configuration: Lavalink, yt-cipher, and Bot all talk locally via `localhost`.
4. **Environment Variables on Railway**:
   Only 3 required variables in Railway:
   - `DISCORD_BOT_TOKEN` = your bot token
   - `SUPABASE_DB_URL` = your Supabase postgres DSN
   - `MONGO_URL` = `${{MongoDB.MONGO_URL}}` (from Railway MongoDB plugin)

---

## User Steps After Implementation
1. Click **"Save to GitHub"** in Emergent to push the new root Dockerfile to `tawhid2015/Pupu`.
2. In Railway:
   - Add MongoDB database (1 click).
   - Add `tawhid2015/Pupu` repository as 1 service (root directory: empty / default `/`).
   - Add the 3 environment variables and click **Deploy**.
