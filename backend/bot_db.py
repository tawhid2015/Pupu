"""Pupu control-plane storage on Supabase Postgres (replaces MongoDB).

Stores: live bot status (bot_kv), admin command channel (bot_commands),
admin login rate limiting (login_attempts), legacy status_checks.
Each process (bot / API) creates its own small pool on first use.
"""
import json
import os
from datetime import datetime

import asyncpg

_pool: asyncpg.Pool | None = None

SCHEMA = """
create table if not exists bot_kv (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);
create table if not exists bot_commands (
  id text primary key,
  guild_id text,
  action text,
  value integer,
  status text not null default 'pending',
  result text,
  created_at timestamptz not null default now(),
  done_at timestamptz
);
create table if not exists login_attempts (
  id text primary key,
  count integer not null default 0,
  locked_until timestamptz
);
create table if not exists status_checks (
  id text primary key,
  client_name text not null,
  ts timestamptz not null default now()
);
"""


async def get_pool() -> asyncpg.Pool:
    global _pool
    if _pool is None:
        _pool = await asyncpg.create_pool(
            os.environ["SUPABASE_DB_URL"],
            min_size=1, max_size=3, statement_cache_size=0,
        )
    return _pool


async def init_schema() -> None:
    pool = await get_pool()
    async with pool.acquire() as c:
        await c.execute(SCHEMA)


async def close() -> None:
    global _pool
    if _pool is not None:
        await _pool.close()
        _pool = None


# ── live bot status ──────────────────────────────────────────────────────────
async def save_status(doc: dict) -> None:
    doc = {k: v for k, v in doc.items() if k != "_id"}
    pool = await get_pool()
    async with pool.acquire() as c:
        await c.execute(
            """insert into bot_kv (key, value) values ('pupu', $1::jsonb)
               on conflict (key) do update set value = excluded.value, updated_at = now()""",
            json.dumps(doc),
        )


async def get_status() -> dict | None:
    pool = await get_pool()
    async with pool.acquire() as c:
        row = await c.fetchrow("select value, updated_at from bot_kv where key = 'pupu'")
    if not row:
        return None
    doc = json.loads(row["value"])
    doc["updated_at"] = row["updated_at"].isoformat()
    return doc


# ── admin command channel ────────────────────────────────────────────────────
async def enqueue_command(cmd_id: str, guild_id: str, action: str, value) -> None:
    pool = await get_pool()
    async with pool.acquire() as c:
        await c.execute(
            "insert into bot_commands (id, guild_id, action, value) values ($1, $2, $3, $4)",
            cmd_id, guild_id, action, value,
        )


async def fetch_pending_commands(limit: int = 20) -> list[dict]:
    pool = await get_pool()
    async with pool.acquire() as c:
        rows = await c.fetch(
            """select id, guild_id, action, value from bot_commands
               where status = 'pending' order by created_at limit $1""",
            limit,
        )
    return [dict(r) for r in rows]


async def complete_command(cmd_id: str, result: str) -> None:
    pool = await get_pool()
    async with pool.acquire() as c:
        await c.execute(
            "update bot_commands set status = 'done', result = $2, done_at = now() where id = $1",
            cmd_id, result,
        )


async def command_result(cmd_id: str) -> dict | None:
    pool = await get_pool()
    async with pool.acquire() as c:
        row = await c.fetchrow("select status, result from bot_commands where id = $1", cmd_id)
    return dict(row) if row else None


# ── admin login rate limiting ────────────────────────────────────────────────
async def get_login_attempt(ident: str) -> dict | None:
    pool = await get_pool()
    async with pool.acquire() as c:
        row = await c.fetchrow("select count, locked_until from login_attempts where id = $1", ident)
    return dict(row) if row else None


async def record_login_attempt(ident: str, count: int, locked_until: datetime | None) -> None:
    pool = await get_pool()
    async with pool.acquire() as c:
        await c.execute(
            """insert into login_attempts (id, count, locked_until) values ($1, $2, $3)
               on conflict (id) do update set count = excluded.count,
               locked_until = excluded.locked_until""",
            ident, count, locked_until,
        )


async def clear_login_attempt(ident: str) -> None:
    pool = await get_pool()
    async with pool.acquire() as c:
        await c.execute("delete from login_attempts where id = $1", ident)


# ── legacy status_checks API ─────────────────────────────────────────────────
async def insert_status_check(check_id: str, client_name: str) -> None:
    pool = await get_pool()
    async with pool.acquire() as c:
        await c.execute(
            "insert into status_checks (id, client_name) values ($1, $2)",
            check_id, client_name,
        )


async def list_status_checks(limit: int = 1000) -> list[dict]:
    pool = await get_pool()
    async with pool.acquire() as c:
        rows = await c.fetch(
            "select id, client_name, ts from status_checks order by ts desc limit $1", limit)
    return [{"id": r["id"], "client_name": r["client_name"], "timestamp": r["ts"]} for r in rows]
